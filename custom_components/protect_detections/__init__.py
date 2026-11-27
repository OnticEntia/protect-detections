"""Protect Detections: live UniFi Protect smart detections for dashboards.

Listens to Protect's live update stream (the same one the Protect app uses)
and keeps the most recent smart detections: what was seen (type, color,
vehicle type, plate), a cropped photo of each object, the rough area of the
frame it is in while it happens, and the exact per-frame bounding boxes
(the object's path) as soon as Protect has them.

Past detections play Protect's recording of the event with its per-frame
track drawn in step (clips.py).

Frontend access:
  websocket  protect_detections/subscribe   snapshot, then live updates
  websocket  protect_detections/clip        export an event's recording
  websocket  protect_detections/history     finished detections, by object type
  websocket  protect_detections/event       one detection by its Protect event id
  websocket  protect_detections/speakers    cameras that can be talked through
  websocket  protect_detections/overlaps    other detections' boxes during a clip
  websocket  protect_detections/live/...    where things are right now (live.py)
  websocket  protect_detections/live/seen   what live tracking saw, kept here (sightings.py)
  websocket  protect_detections/ptz, ptz/goto, ptz/patrol   presets and patrols of a camera
             that moves, for administrators (ptz.py)
  http       /protect_detections/frontend/<version>/<file>   the cards (cards.py)
  http       /api/protect_detections/thumb/object/<thumbnail id>
             /api/protect_detections/thumb/event/<event id>
             /api/protect_detections/clip/<file>   (signed path)
             /api/protect_detections/talk/<camera id>   (signed path, websocket:
             microphone audio in, out of the camera's speaker; talk.py)
             /api/protect_detections/video/<camera id>  (signed path, websocket:
             the camera's picture as Protect's own page gets it; video.py)
  websocket  protect_detections/live/video_probe   what that picture's stream is made of
             (administrators; nothing of the picture is kept or returned)

A companion to the UniFi Protect integration: the live stream connection is
the one shared by the Protect companions (protect_zones/stream.py).

It reuses the logged-in client of HA's own UniFi Protect integration, so it
holds no credentials of its own. It uses Protect's internal API, which is
undocumented: a Protect update could change it.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta
from collections import OrderedDict
import logging
import time
from typing import Any

from aiohttp import web
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryError, ConfigEntryNotReady
from homeassistant.helpers import entity_registry as er, issue_registry as ir
from homeassistant.helpers.event import async_track_time_interval

# The connection to Protect's live updates is Protect Zones' (one connection
# for all the Protect companions). Only its code is needed, not a set-up
# entry: the stream is made on first use and connects by itself. Protect
# Zones is another repository, so it can't be a dependency in the manifest;
# it is looked for here instead, and setting up says so if it is missing.
try:
    from custom_components.protect_zones.stream import async_get_stream
except ImportError:  # Protect Zones isn't installed (or is too old to have it)
    async_get_stream = None

from .cameras import CameraBook
from .cards import CardsView, async_card_urls, load_cards, unload_cards
from .clips import ClipStore
from .live import LiveTracks
from .ptz import Ptz, Refused
from .sightings import SightingRecorder
from .talk import TalkView, speakers
from .video import BadRequest, MAX_PROBE_S, VideoView, console_stream, probe, stream_query

_LOGGER = logging.getLogger(__name__)

DOMAIN = "protect_detections"
ISSUE_ZONES = "zones_not_installed"
SUBSCRIBERS = f"{DOMAIN}_subscribers"
TALK_VIEW = f"{DOMAIN}_talk_view"
CARD_URLS = f"{DOMAIN}_card_urls"
CONF_RECORD = "record_sightings"  # option: listen to every camera's live tracking and keep what it saw
KEEP_EVENTS = 60
HISTORY_HOURS = 3
DETECT_TYPES = ("smartDetectZone", "smartDetectLine")
CAMERAS_SETTLE = 3.0  # seconds after word of a camera coming or going before the list is read again
CAMERAS_CHECK = 300  # seconds between looks at the list anyway (word of a change can be missed)
TRACK_POLL = 2.0  # seconds between box fetches while a detection is live
THUMB_CACHE = 200


def _describe(attrs: dict[str, Any] | None, plate: Any = None) -> str:
    """'gray SUV', 'red', 'ABC1234' ... from Protect's object attributes."""
    attrs = attrs or {}
    parts = []
    for key in ("color", "vehicleType"):
        val = attrs.get(key)
        if isinstance(val, dict):
            val = val.get("val")
        if val:
            parts.append(str(val).replace("_", " "))
    plate = plate or attrs.get("licensePlate")
    if isinstance(plate, dict):
        plate = plate.get("name") or plate.get("val")
    if plate:
        parts.append(str(plate))
    return " ".join(parts)


def _protect_api(hass: HomeAssistant):
    """The UniFi Protect integration's logged-in client, or None if it isn't loaded."""
    for entry in hass.config_entries.async_entries("unifiprotect"):
        if entry.state is ConfigEntryState.LOADED and getattr(entry, "runtime_data", None):
            return entry.runtime_data.api
    return None


def zones_installed() -> bool:
    """Is Protect Zones there to share its connection to Protect?"""
    return async_get_stream is not None


FILTER_TYPES = ("person", "vehicle", "face", "licensePlate", "animal", "package", "loiter")
LOITER_TYPE = "smartDetectLoiterZone"  # someone/something staying in a loiter zone
HISTORY_DAYS = 7
HISTORY_CACHE = 500


def _objects_from_meta(meta: dict[str, Any]) -> list[dict[str, Any]]:
    """Protect's best shot of each object (metadata.detectedThumbnails): its
    crop (thumbnails/<croppedId>) and attributes, incl. the read plate."""
    out = []
    for t in meta.get("detectedThumbnails") or []:
        if not t.get("croppedId") or not t.get("confidence"):
            continue  # objects seen only in passing come as whole-frame, 0 % boxes
        attrs = t.get("attributes") or {}
        out.append({
            "id": t.get("objectId") or t.get("croppedId"),
            "tracker": str(attrs.get("trackerId") or ""),
            "type": t.get("type") or attrs.get("objectType"),
            "desc": _describe(attrs, attrs.get("matchedName")),
            "thumb": t.get("croppedId"),
            "confidence": t.get("confidence"),
            "plate": attrs.get("matchedName") or None,
            "best_at": t.get("clockBestWall") or None,  # when the best shot was taken
        })
    return out


class DetectionHub:
    """Keeps recent detections and fans changes out to subscribers."""

    def __init__(self, hass: HomeAssistant, record: bool = True) -> None:
        self.hass = hass
        self.record = record
        self.events: OrderedDict[str, dict[str, Any]] = OrderedDict()
        # Open dashboards. Kept outside the hub, so they carry over when the
        # integration is reloaded and get the new hub's detections.
        self.subscribers: set[Any] = hass.data.setdefault(SUBSCRIBERS, set())
        self._tasks: set[asyncio.Task] = set()
        self._was_connected = False
        # Protect's cameras, and those it no longer has (cameras.py)
        self.book = CameraBook()
        self.cameras: dict[str, dict[str, Any]] = self.book.cams
        self._cam_timer: asyncio.TimerHandle | None = None
        self._cam_unsubs: list[Any] = []
        self.thumbs: OrderedDict[str, bytes] = OrderedDict()
        self._track_tasks: dict[str, asyncio.Task] = {}
        self._track_done: set[str] = set()
        self._unsub_stream = None
        self._stopping = False
        self.clips = ClipStore()
        self.live = LiveTracks(hass, lambda: _protect_api(hass), self._in_protect)
        self.sightings = SightingRecorder(hass, self.live, DOMAIN)
        self.sightings.known = self.book.present  # (nothing is written for a camera that has gone)
        self.history: OrderedDict[str, dict[str, Any]] = OrderedDict()

    @property
    def api(self):
        return _protect_api(self.hass)

    @property
    def connected(self) -> bool:
        return async_get_stream(self.hass).connected

    # ---------------------------------------------------------------- setup

    def load_cameras(self) -> dict[str, list[str]]:
        """Protect camera id -> name and HA camera entities (medium / high).
        A camera Protect no longer has is kept, marked as removed. Returns
        what changed (see CameraBook.update)."""
        api = self.api
        if api is None:
            return {"added": [], "removed": [], "back": [], "changed": []}
        reg = er.async_get(self.hass)
        by_uid = {
            e.unique_id: e.entity_id
            for e in reg.entities.values()
            if e.platform == "unifiprotect" and e.domain == "camera" and not e.disabled_by
        }
        found = []
        for cam in api.bootstrap.cameras.values():
            mac = (cam.mac or "").replace(":", "").upper()
            high = by_uid.get(f"{mac}_0")
            found.append({
                "id": cam.id,
                "name": cam.name,
                "entity": by_uid.get(f"{mac}_1") or high,
                "tap_entity": high or by_uid.get(f"{mac}_1"),
            })
        return self.book.update(found)

    def _in_protect(self, camera_id: str) -> bool:
        """Does Protect still have this camera? (Asked of Protect's own list:
        yes while that can't be told, so that nothing is given up wrongly.)"""
        api = self.api
        try:
            return api is None or camera_id in api.bootstrap.cameras
        except AttributeError:
            return True

    @callback
    def cameras_changed_soon(self, *_: Any) -> None:
        """Word that a camera may have come or gone: the list is read again
        in a moment (once, however many words come together)."""
        if self._stopping or self._cam_timer is not None:
            return
        self._cam_timer = self.hass.loop.call_later(CAMERAS_SETTLE, self.refresh_cameras)

    @callback
    def refresh_cameras(self, *_: Any) -> None:
        """Read the cameras again, and act on what changed: a new camera is
        there without a restart; a removed one is no longer listened to, its
        open live subscriptions are told why they end, and what is shown of
        its past detections says it has gone."""
        self._cam_timer = None
        if self._stopping:
            return
        try:
            what = self.load_cameras()
        except Exception:  # noqa: BLE001
            _LOGGER.debug("Couldn't read the cameras again", exc_info=True)
            return
        if not any(what.values()):
            return
        _LOGGER.info(
            "Protect's cameras changed: %d new, %d removed, %d back, %d renamed or re-linked",
            len(what["added"]), len(what["removed"]), len(what["back"]), len(what["changed"]),
        )
        for cam_id in what["removed"]:
            self.live.drop(cam_id)
        self._watch()
        # the detections on show: whose they are now
        for ev in [*self.events.values(), *self.history.values()]:
            self._label(ev)
        self._push_snapshot()

    def _label(self, ev: dict[str, Any]) -> dict[str, Any]:
        """A detection's camera, as it is now: its name and entities, or that it has been removed."""
        cam = self.cameras.get(ev.get("camera_id")) or {}
        name, removed = self.book.label(ev.get("camera_id"))
        ev["camera"] = name
        ev["camera_removed"] = removed
        ev["entity"] = cam.get("entity")
        ev["tap_entity"] = cam.get("tap_entity")
        return ev

    def smart_cameras(self) -> list[str]:
        """The cameras (Protect ids) that recognise things, so have live tracking.

        Other integrations use this and `hub.live.subscribe(camera_id, send)`
        (the Protect Tracker integration does): the two are kept as they are.
        The hub itself is `hass.data["protect_detections"]`."""
        api = self.api
        out = []
        for cam in api.bootstrap.cameras.values() if api is not None else []:
            try:
                smart = bool(cam.feature_flags.smart_detect_types)
            except AttributeError:
                smart = False
            if smart:
                out.append(cam.id)
        return out

    @callback
    def record_live(self, camera_id: str, packet: dict[str, Any]) -> None:
        """For another integration that makes live positions of its own (the
        Protect Tracker integration, in its local mode): one of its packets
        for a camera (Protect's id), in the shape of this integration's own,
        to be kept in the record of sightings (sightings.py) beside Protect's.
        Call it from the event loop, as often as packets come: it never
        raises, and writes nothing to disk by itself. Kept as it is: see
        smart_cameras()."""
        try:
            self.sightings.record_live(camera_id, packet)
        except Exception:  # noqa: BLE001 - the record is an extra; a caller must not suffer for it
            _LOGGER.debug("A live packet could not be recorded", exc_info=True)

    def _watch(self) -> None:
        """Keep a record of what those cameras' live tracking sees (sightings.py)."""
        if not self.record:
            return
        try:
            self.sightings.watch(self.smart_cameras())
        except Exception:  # noqa: BLE001 - the record is an extra
            _LOGGER.warning("Couldn't start recording live sightings", exc_info=True)

    async def start(self) -> None:
        self.load_cameras()
        await self.sightings.load()
        self._watch()
        try:
            await self._load_history()
        except Exception as err:  # history is a nice-to-have
            _LOGGER.warning("Couldn't load recent detections: %s", err)
        # Protect's live updates, over the connection the Protect companions share
        stream = async_get_stream(self.hass)
        self._was_connected = stream.connected
        self._unsub_stream = stream.subscribe(self._handle, self._disconnected, self._connected)
        # cameras coming and going while this runs: told by Home Assistant's
        # entity registry (a camera's entities made or taken away), by
        # Protect's own updates (_handle), and looked for now and then anyway
        self._cam_unsubs = [
            self.hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, self._registry_changed),
            async_track_time_interval(self.hass, self.refresh_cameras, timedelta(seconds=CAMERAS_CHECK)),
        ]
        self._push_snapshot()  # dashboards that were open across a reload

    @callback
    def _registry_changed(self, event: Any) -> None:
        if str(event.data.get("entity_id", "")).startswith("camera."):
            self.cameras_changed_soon()

    async def stop(self) -> None:
        self._stopping = True
        for unsub in self._cam_unsubs:
            unsub()
        self._cam_unsubs = []
        if self._cam_timer is not None:
            self._cam_timer.cancel()
            self._cam_timer = None
        if self._unsub_stream:
            self._unsub_stream()
            self._unsub_stream = None
        tasks = [*self._track_tasks.values(), *self._tasks]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        try:
            await self.sightings.stop()
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Couldn't save the live sightings", exc_info=True)
        await self.live.stop()
        await self.clips.close()

    @callback
    def _disconnected(self) -> None:
        self._push_snapshot()  # tells the dashboards the feed is down

    @callback
    def _connected(self) -> None:
        if not self._was_connected:
            self._was_connected = True  # the first connection: nothing was missed
            self._push_snapshot()
            return
        task = self.hass.async_create_background_task(self._resync(), f"{DOMAIN} resync")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _resync(self) -> None:
        """Back after a gap: detections may have started or ended unseen."""
        self.refresh_cameras()  # cameras may have been added, renamed or removed too
        self._watch()
        try:
            now = int(time.time() * 1000)
            types = "&".join(f"types={t}" for t in DETECT_TYPES)
            rows = await self.api.api_request(
                f"events?start={now - HISTORY_HOURS * 3600 * 1000}&end={now}&{types}&limit=30&orderDirection=DESC"
            )
            seen = set()
            for raw in reversed(rows or []):
                seen.add(raw.get("id"))
                self._apply_event(raw, notify=False)
            # still shown as happening, but too old for that list: ask one by one
            for ev in [e for e in self.events.values() if not e["end"] and e["id"] not in seen]:
                try:
                    raw = await self.api.api_request(f"events/{ev['id']}")
                except Exception:  # noqa: BLE001 - Protect no longer has it
                    raw = None
                if isinstance(raw, dict) and raw.get("id"):
                    self._apply_event(raw, notify=False)
                else:
                    ev["end"] = ev["end"] or now
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Couldn't catch up on detections after reconnecting: %s", err)
        self._push_snapshot()

    async def _load_history(self) -> None:
        now = int(time.time() * 1000)
        start = now - HISTORY_HOURS * 3600 * 1000
        types = "&".join(f"types={t}" for t in DETECT_TYPES)
        rows = await self.api.api_request(
            f"events?start={start}&end={now}&{types}&limit=30&orderDirection=DESC"
        )
        for raw in reversed(rows or []):
            self._apply_event(raw, notify=False)
        # Boxes for the newest few, so the card has something to show.
        for ev in list(self.events.values())[-10:]:
            if ev["end"]:
                await self._fetch_track(ev["id"], notify=False)

    # --------------------------------------------------------- live stream

    @callback
    def _handle(self, action: dict[str, Any], data: Any) -> None:
        model = action.get("modelKey")
        if model == "camera" and action.get("action") in ("add", "remove"):
            self.cameras_changed_soon()  # (adopted, or taken out of Protect)
            return
        if model == "event" and isinstance(data, dict):
            data = {**data, "id": action.get("id") or data.get("id")}
            if action.get("action") == "add" or data["id"] in self.events:
                self._apply_event(data)
        elif model == "smartDetectObject" and isinstance(data, dict):
            for obj in data.get("objects") or []:
                ev = self.events.get(obj.get("eventId") or data.get("eventId"))
                if ev is not None:
                    self._apply_object(ev, obj)

    # ------------------------------------------------------------- model

    def _apply_event(self, raw: dict[str, Any], notify: bool = True) -> None:
        eid = raw.get("id")
        ev = self.events.get(eid)
        if ev is None:
            if raw.get("type") not in DETECT_TYPES:
                return
            cam_id = raw.get("camera") or raw.get("device")
            if cam_id not in self.cameras:
                self.refresh_cameras()  # a camera added since we started
            ev = self._label({
                "id": eid,
                "camera_id": cam_id,
                "type": raw.get("type"),
                "start": raw.get("start"),
                "end": None,
                "types": [],
                "areas": [],
                "objects": [],
                "track": None,
            })
            self.events[eid] = ev
            while len(self.events) > KEEP_EVENTS:
                old_id, _ = self.events.popitem(last=False)
                self._track_done.discard(old_id)
                task = self._track_tasks.pop(old_id, None)
                if task:
                    task.cancel()
        if raw.get("start"):
            ev["start"] = raw["start"]
        if "end" in raw:
            ev["end"] = raw["end"]
        if raw.get("smartDetectTypes"):
            ev["types"] = raw["smartDetectTypes"]
        meta = raw.get("metadata") or {}
        if meta.get("detectedAreas"):
            ev["areas"] = [a.get("areaIndexes") or [] for a in meta["detectedAreas"]]
        best = _objects_from_meta(meta)
        if best:
            ev["objects"] = best
        if notify:
            self._push(ev)
        if notify and eid not in self._track_tasks and eid not in self._track_done:
            self._track_tasks[eid] = self.hass.async_create_background_task(
                self._follow_track(eid), f"{DOMAIN} track {eid}"
            )

    def event_from_raw(self, raw: dict[str, Any]) -> dict[str, Any]:
        """A detection record for an event that isn't in the live list."""
        cam_id = raw.get("camera") or raw.get("device")
        meta = raw.get("metadata") or {}
        return self._label({
            "id": raw.get("id"),
            "camera_id": cam_id,
            "type": raw.get("type"),
            "start": raw.get("start"),
            "end": raw.get("end"),
            "types": raw.get("smartDetectTypes") or [],
            "areas": [a.get("areaIndexes") or [] for a in meta.get("detectedAreas") or []],
            "objects": _objects_from_meta(meta),
            "track": None,
        })

    async def search(
        self, kind: str | None, before: int | None, limit: int, start: int | None = None
    ) -> tuple[list[dict[str, Any]], bool]:
        """Finished detections, newest first, optionally of one object type,
        between start (default: 7 days back) and before (default: now)."""
        end = before or int(time.time() * 1000)
        start = start or end - HISTORY_DAYS * 86400 * 1000
        if kind == "loiter":
            # loiter events are their own event type, not an object type
            query = f"events?start={start}&end={end}&types={LOITER_TYPE}"
        else:
            # loiter events carry object types too (a person who stayed), so
            # they belong under All and under their object-type filter
            types = (*DETECT_TYPES, LOITER_TYPE)
            query = f"events?start={start}&end={end}&" + "&".join(f"types={t}" for t in types)
            if kind:
                query += f"&smartDetectTypes={kind}"
        rows = await self.api.api_request(f"{query}&limit={limit}&orderDirection=DESC")
        out = []
        for raw in rows or []:
            if not raw.get("end"):
                continue
            ev = self.events.get(raw.get("id"))
            if ev is None or not ev["objects"]:
                ev = self.history.get(raw.get("id")) or self.event_from_raw(raw)
            self.history[ev["id"]] = ev
            self.history.move_to_end(ev["id"])
            out.append(ev)
        while len(self.history) > HISTORY_CACHE:
            self.history.popitem(last=False)
        return out, len(rows or []) >= limit

    async def overlapping(self, ev: dict[str, Any], start: int, end: int, limit: int) -> list[dict[str, Any]]:
        """The other finished detections on ev's camera that ran at some
        point between start and end, those nearest ev first, with their boxes
        (Protect files each kind of thing under an event of its own, so what
        else was in view is in these). One that has no boxes is left out."""
        # Protect picks events by when they began: reach back for the ones
        # that began earlier and were still running
        events, _ = await self.search(None, end, 100, start - 120_000)
        mid = (ev["start"] + (ev["end"] or ev["start"])) / 2
        near = sorted(
            (
                e for e in events
                if e["id"] != ev["id"] and e["camera_id"] == ev["camera_id"]
                and e["start"] <= end and (e["end"] or e["start"]) >= start
            ),
            key=lambda e: abs((e["start"] + (e["end"] or e["start"])) / 2 - mid),
        )[:limit]
        gate = asyncio.Semaphore(4)

        async def boxes(e: dict[str, Any]) -> None:
            if e["track"]:
                return
            async with gate:
                try:
                    await self._fetch_track(e["id"], notify=False)
                except Exception:  # noqa: BLE001 - one without boxes is no loss
                    pass

        await asyncio.gather(*(boxes(e) for e in near))
        return [
            {k: e[k] for k in ("id", "type", "types", "start", "end", "track")}
            for e in near if e["track"]
        ]

    def find(self, eid: str) -> dict[str, Any] | None:
        return self.events.get(eid) or self.history.get(eid)

    async def lookup(self, eid: str) -> dict[str, Any] | None:
        """A detection by its Protect event id: from the lists, else asked of
        Protect (and then remembered). None if Protect doesn't have it; raises
        if Protect can't be asked."""
        ev = self.find(eid)
        if ev is not None:
            return ev
        if not eid or not eid.replace("-", "").isalnum():
            return None
        raw = await self.api.api_request(f"events/{eid}")
        if not isinstance(raw, dict) or not raw.get("id") or not (raw.get("camera") or raw.get("device")):
            return None
        ev = self.event_from_raw(raw)
        self.history[ev["id"]] = ev
        while len(self.history) > HISTORY_CACHE:
            self.history.popitem(last=False)
        return ev

    def _apply_object(self, ev: dict[str, Any], obj: dict[str, Any]) -> None:
        attrs = obj.get("attributes") or {}
        entry = {
            "id": obj.get("id"),
            "tracker": str(attrs.get("trackerId") or ""),
            "type": obj.get("objectType") or attrs.get("objectType"),
            "desc": _describe(attrs, obj.get("licensePlate")),
            "thumb": obj.get("thumbnailId"),
        }
        objs = [o for o in ev["objects"] if o["id"] != entry["id"]]
        objs.append(entry)
        ev["objects"] = objs
        self._push(ev)

    async def _follow_track(self, eid: str) -> None:
        """Fetch boxes while the detection runs, then once more after it ends."""
        try:
            while not self._stopping:
                ev = self.events.get(eid)
                if ev is None:
                    return
                if ev["end"]:
                    self._track_done.add(eid)
                    for delay in (1.5, 3, 6):
                        await asyncio.sleep(delay)
                        if await self._fetch_track(eid):
                            return
                    return
                await asyncio.sleep(TRACK_POLL)
                if ev["start"] and time.time() * 1000 - ev["start"] > 15 * 60 * 1000:
                    self._track_done.add(eid)
                    return  # stuck "live" event; stop polling
        finally:
            self._track_tasks.pop(eid, None)

    async def _fetch_track(self, eid: str, notify: bool = True) -> bool:
        try:
            raw = await self.api.api_request(f"events/{eid}/smartDetectTrack")
        except Exception:
            return False
        ev = self.find(eid)
        if ev is None or not isinstance(raw, dict):
            return False
        trackers: dict[str, dict[str, Any]] = {}
        for item in raw.get("payload") or []:
            coord = item.get("coord")
            if not coord or len(coord) != 4:
                continue
            tid = str(item.get("id"))
            tr = trackers.setdefault(tid, {"tracker": tid, "type": item.get("objectType"), "desc": "", "points": []})
            desc = _describe(item.get("attributes"), item.get("licensePlate"))
            if desc:
                tr["desc"] = desc
            tr["points"].append([item.get("timestamp") or 0, *coord, item.get("confidence") or 0])
        for tr in trackers.values():
            tr["points"].sort(key=lambda p: p[0])
        if not trackers:
            return False
        ev["track"] = list(trackers.values())
        if notify:
            self._push(ev)
        return True

    # ------------------------------------------------------- subscribers

    @callback
    def _push(self, ev: dict[str, Any]) -> None:
        for send in list(self.subscribers):
            send({"event": ev})

    def snapshot(self) -> dict[str, Any]:
        # (the cameras Protect has now; those it no longer has are told of only by the detections that were theirs)
        cams = [c for c in self.cameras.values() if not c.get("removed")]
        return {"snapshot": list(self.events.values()), "connected": self.connected, "cameras": cams}

    @callback
    def _push_snapshot(self) -> None:
        for send in list(self.subscribers):
            send(self.snapshot())

    async def thumbnail(self, kind: str, ident: str) -> bytes | None:
        key = f"{kind}:{ident}"
        if key in self.thumbs:
            self.thumbs.move_to_end(key)
            return self.thumbs[key]
        path = f"thumbnails/{ident}" if kind == "object" else f"events/{ident}/thumbnail"
        try:
            data = await self.api.api_request_raw(path)
        except Exception as err:
            _LOGGER.debug("Thumbnail %s failed: %s", path, err)
            return None
        if not data:
            return None
        self.thumbs[key] = data
        while len(self.thumbs) > THUMB_CACHE:
            self.thumbs.popitem(last=False)
        return data


# ------------------------------------------------------------------ frontend


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    hub: DetectionHub | None = hass.data.get(DOMAIN)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Protect Detections isn't loaded")
        return

    @callback
    def send(payload: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    subscribers = hass.data.setdefault(SUBSCRIBERS, set())
    subscribers.add(send)

    @callback
    def unsub() -> None:
        subscribers.discard(send)

    connection.subscriptions[msg["id"]] = unsub
    connection.send_result(msg["id"])
    send(hub.snapshot())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/clip",
        vol.Required("event_id"): str,
        vol.Optional("hevc", default=False): bool,
        vol.Optional("quality", default="high"): vol.In(("high", "low")),
    }
)
@websocket_api.async_response
async def ws_clip(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    hub: DetectionHub | None = hass.data.get(DOMAIN)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Protect Detections isn't loaded")
        return
    try:
        # not in memory any more (reloaded, or scrolled far back): ask Protect
        ev = await hub.lookup(msg["event_id"])
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("Couldn't look up event %s for its clip: %s", msg["event_id"], err)
        connection.send_error(msg["id"], "clip_failed", f"Couldn't ask Protect for this detection: {err}")
        return
    if ev is None:
        connection.send_error(msg["id"], "not_found", "Protect no longer has this detection")
        return
    if not ev["end"]:
        connection.send_error(msg["id"], "still_live", "This detection is still happening")
        return
    try:
        if not ev["track"]:
            await hub._fetch_track(ev["id"])
        clip = await hub.clips.get(hub.api, ev, msg["hevc"], msg["quality"])
    except Exception as err:
        if ev.get("camera_removed"):
            # (nothing to warn of: its recordings went with it, or will)
            _LOGGER.debug("Clip for %s (a removed camera's) failed: %s", ev["id"], err)
            connection.send_error(msg["id"], "camera_removed", "This camera is no longer in UniFi Protect, and its recording could not be had")
            return
        _LOGGER.warning("Clip for %s failed: %s", ev["id"], err)
        connection.send_error(msg["id"], "clip_failed", f"Couldn't get the recording: {err}")
        return
    connection.send_result(
        msg["id"], {**clip, "url": f"/api/protect_detections/clip/{clip['file']}", "track": ev["track"]}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/history",
        vol.Optional("kind"): vol.Any(None, vol.In(FILTER_TYPES)),
        vol.Optional("before"): vol.Any(None, int),
        vol.Optional("start"): vol.Any(None, int),
        vol.Optional("limit", default=48): vol.All(int, vol.Range(1, 200)),
    }
)
@websocket_api.async_response
async def ws_history(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    hub: DetectionHub | None = hass.data.get(DOMAIN)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Protect Detections isn't loaded")
        return
    try:
        events, more = await hub.search(msg.get("kind"), msg.get("before"), msg["limit"], msg.get("start"))
    except Exception as err:
        connection.send_error(msg["id"], "history_failed", f"Couldn't read Protect's history: {err}")
        return
    connection.send_result(msg["id"], {"events": events, "more": more})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/overlaps",
        vol.Required("event_id"): str,
        vol.Required("start"): int,
        vol.Required("end"): int,
        vol.Optional("limit", default=12): vol.All(int, vol.Range(1, 20)),
    }
)
@websocket_api.async_response
async def ws_overlaps(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The boxes of the other detections on the same camera during a stretch
    of time (a clip's), for drawing them over that clip too."""
    hub: DetectionHub | None = hass.data.get(DOMAIN)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Protect Detections isn't loaded")
        return
    if not 0 < msg["end"] - msg["start"] <= 10 * 60 * 1000:
        connection.send_error(msg["id"], "invalid_range", "start and end must be at most 10 minutes apart")
        return
    try:
        ev = await hub.lookup(msg["event_id"])
        events = await hub.overlapping(ev, msg["start"], msg["end"], msg["limit"]) if ev else []
    except Exception as err:  # noqa: BLE001
        connection.send_error(msg["id"], "overlaps_failed", f"Couldn't read Protect's history: {err}")
        return
    connection.send_result(msg["id"], {"events": events})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/event", vol.Required("event_id"): str})
@websocket_api.async_response
async def ws_event(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """One detection by its Protect event id (e.g. the one that fired a rule),
    looked up in Protect if it isn't in the lists; it can then be played."""
    hub: DetectionHub | None = hass.data.get(DOMAIN)
    eid = msg["event_id"]
    if hub is None or not eid.replace("-", "").isalnum():
        connection.send_error(msg["id"], "not_found", "No such detection")
        return
    try:
        ev = await hub.lookup(eid)
    except Exception as err:  # noqa: BLE001
        connection.send_error(msg["id"], "not_found", f"Protect no longer has this event: {err}")
        return
    if ev is None:
        connection.send_error(msg["id"], "not_found", "Protect no longer has this event")
        return
    connection.send_result(msg["id"], {"event": ev})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/speakers"})
@callback
def ws_speakers(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Camera entities that can be talked through (entity id -> Protect camera id)."""
    hub: DetectionHub | None = hass.data.get(DOMAIN)
    connection.send_result(msg["id"], {"speakers": speakers(hub) if hub else {}})


def _camera_of(hub: DetectionHub, entity: str) -> str | None:
    """The Protect camera an HA camera entity (either stream) belongs to
    (one Protect still has)."""
    cam_id, removed = hub.book.of_entity(entity)
    return None if removed else cam_id


def _no_camera(hub: DetectionHub, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Answer for an entity that is no camera to listen to: one of a camera
    Protect no longer has (said as that), or not one of Protect's at all."""
    _, removed = hub.book.of_entity(msg["entity"])
    if removed:
        connection.send_error(msg["id"], "camera_removed", "This camera is no longer in UniFi Protect")
    else:
        connection.send_error(msg["id"], "not_found", "Not a UniFi Protect camera")


def _ptz(hass: HomeAssistant, hub: DetectionHub) -> Ptz:
    """The presets and patrols requests (ptz.py), over this Home Assistant."""
    reg = er.async_get(hass)

    def camera(entity: str) -> tuple[Any, bool]:
        cam_id, removed = hub.book.of_entity(entity)
        if cam_id is None:
            hub.refresh_cameras()  # a camera added since we last looked
            cam_id, removed = hub.book.of_entity(entity)
        api = hub.api
        if removed or cam_id is None or api is None:
            return None, removed
        return api.bootstrap.cameras.get(cam_id), False

    def device(entity: str) -> str | None:
        entry = reg.async_get(entity)
        return entry.device_id if entry else None

    def patrol(device_id: str) -> dict[str, Any] | None:
        for entry in er.async_entries_for_device(reg, device_id):
            if entry.domain != "select" or entry.platform != "unifiprotect" or not entry.unique_id.endswith("_ptz_patrol"):
                continue
            state = hass.states.get(entry.entity_id)
            return {
                "entity": entry.entity_id,
                "options": list(state.attributes.get("options") or []) if state else [],
                "state": state.state if state else None,
            }
        return None

    async def call(domain: str, service: str, data: dict[str, Any], context: Any) -> None:
        await hass.services.async_call(domain, service, data, blocking=True, context=context)

    return Ptz(camera=camera, device=device, patrol=patrol, has_service=hass.services.has_service, call=call)


async def _ptz_answer(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any], what: str) -> None:
    """One of the three requests of ptz.py, answered (administrators only: refused there)."""
    hub: DetectionHub | None = hass.data.get(DOMAIN)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Protect Detections isn't loaded")
        return
    ptz = _ptz(hass, hub)
    admin = bool(connection.user and connection.user.is_admin)
    try:
        if what == "info":
            result = await ptz.info(admin, msg["entity"])
        elif what == "goto":
            result = await ptz.goto(admin, msg["entity"], msg["preset"], connection.context(msg))
        else:
            result = await ptz.patrol(admin, msg["entity"], msg["option"], connection.context(msg))
    except Refused as err:
        connection.send_error(msg["id"], err.code, err.message)
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/live/video_probe",
    vol.Required("entity"): str,
    vol.Optional("channel", default=1): vol.In([0, 1, 2]),
    vol.Optional("seconds", default=4): vol.All(vol.Coerce(float), vol.Range(min=0.5, max=MAX_PROBE_S)),
    vol.Optional("options"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_video_probe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """What a camera's live picture (video.py) is made of: box kinds, sizes,
    clocks and codecs over a few seconds, and what Protect says of the
    camera's channels. For finding out; nothing of the picture is kept."""
    hub: DetectionHub | None = hass.data.get(DOMAIN)
    api = hub.api if hub else None
    cam_id = _camera_of(hub, msg["entity"]) if hub else None
    if api is None or cam_id is None:
        connection.send_error(msg["id"], "not_found", "Not a UniFi Protect camera")
        return
    try:
        stream_query(cam_id, msg["channel"], dict(msg.get("options") or {}))
    except BadRequest as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    channels = []
    cam = api.bootstrap.cameras.get(cam_id)
    for ch in getattr(cam, "channels", None) or []:
        channels.append({key: getattr(ch, key, None) for key in ("id", "name", "width", "height", "fps", "bitrate", "is_rtsp_enabled")})
    source = console_stream(api, cam_id, msg["channel"], dict(msg.get("options") or {}))
    try:
        result = await probe(source, msg["seconds"])
    except Exception as err:  # noqa: BLE001 (the finding is that it failed, and how)
        result = {"failed": f"{type(err).__name__}: {err}"[:300]}
    finally:
        await source.aclose()
    result["channels"] = channels
    result["video_codec"] = str(getattr(cam, "video_codec", None))
    result["now"] = int(time.time() * 1000)
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/ptz", vol.Required("entity"): str})
@websocket_api.async_response
async def ws_ptz(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Whether a camera moves, and its presets and patrols (read only)."""
    await _ptz_answer(hass, connection, msg, "info")


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/ptz/goto",
    vol.Required("entity"): str,
    vol.Required("preset"): vol.All(str, vol.Length(min=1, max=100)),
})
@websocket_api.async_response
async def ws_ptz_goto(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Send a camera to a preset, by the UniFi Protect integration's own service."""
    await _ptz_answer(hass, connection, msg, "goto")


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/ptz/patrol",
    vol.Required("entity"): str,
    vol.Required("option"): vol.All(str, vol.Length(min=1, max=100)),
})
@websocket_api.async_response
async def ws_ptz_patrol(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Start or stop a camera's patrol, by the UniFi Protect integration's own patrol entity."""
    await _ptz_answer(hass, connection, msg, "patrol")


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/live/cameras"})
@callback
def ws_live_cameras(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The camera entities whose cameras recognise things (so have live boxes)."""
    hub: DetectionHub | None = hass.data.get(DOMAIN)
    out: dict[str, str] = {}
    smart = hub.smart_cameras() if hub else []
    if hub and any(cam_id not in hub.cameras for cam_id in smart):
        hub.refresh_cameras()  # a camera adopted since we last looked
    for cam_id in smart:
        known = hub.cameras.get(cam_id) or {}
        for key in ("entity", "tap_entity"):
            if known.get(key):
                out[known[key]] = cam_id
    connection.send_result(msg["id"], {"cameras": out})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/live/subscribe", vol.Required("entity"): str})
@callback
def ws_live_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Where things are in a camera's picture, as Protect reports it live
    (see live.py). Protect is listened to only while someone is subscribed."""
    hub: DetectionHub | None = hass.data.get(DOMAIN)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Protect Detections isn't loaded")
        return
    cam_id = _camera_of(hub, msg["entity"])
    if cam_id is None:
        hub.refresh_cameras()  # a camera added (or removed) since we last looked
        cam_id = _camera_of(hub, msg["entity"])
    if cam_id is None:
        _no_camera(hub, connection, msg)
        return

    @callback
    def send(payload: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    connection.send_result(msg["id"])
    connection.subscriptions[msg["id"]] = hub.live.subscribe(cam_id, send)


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/live/seen",
    vol.Optional("entity"): str,
    vol.Optional("types"): [str],
    vol.Optional("limit", default=50): vol.All(int, vol.Range(min=0, max=2000)),
    vol.Optional("since"): vol.All(int, vol.Range(min=0)),
    vol.Optional("source"): vol.In(["protect", "local"]),
})
@callback
def ws_live_seen(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """What the cameras' live tracking has seen, as recorded here whether or
    not a dashboard was open (sightings.py): per camera (Protect's id) when
    each kind was last seen and whether its feed is connected, then the
    newest sightings and feed gaps. `limit: 0` gives the first part only.
    Each sighting says who saw it (`source`: "protect", or "local" for a
    tracker on this machine) and whether Protect reported it too (`attached`,
    `protect_id`); `source` asks for one kind only. Last seen has `seen`
    (either), `seen_protect`, `seen_local` and `seen_unattached`."""
    hub: DetectionHub | None = hass.data.get(DOMAIN)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Protect Detections isn't loaded")
        return
    only = None
    if msg.get("entity"):
        # (a removed camera's sightings can still be asked for by its last entity)
        cam_id, _removed = hub.book.of_entity(msg["entity"])
        if cam_id is None:
            connection.send_error(msg["id"], "not_found", "Not a UniFi Protect camera")
            return
        only = [cam_id]
    out = hub.sightings.log.snapshot(only, msg.get("types"), msg["limit"], msg.get("since"), source=msg.get("source"))
    for cam_id, cam in out["cameras"].items():
        known = hub.cameras.get(cam_id) or {}
        cam["name"], cam["removed"] = hub.book.label(cam_id)  # (what is on record of a camera that has gone is kept, and says so)
        cam["entity"] = known.get("entity")
    out["recording"] = hub.sightings.recording
    connection.send_result(msg["id"], out)


class ClipView(HomeAssistantView):
    url = "/api/protect_detections/clip/{name}"
    name = "api:protect_detections:clip"
    requires_auth = True

    async def get(self, request: web.Request, name: str) -> web.StreamResponse:
        hub: DetectionHub | None = request.app["hass"].data.get(DOMAIN)
        path = hub and hub.clips.path(name)
        if not path:
            return web.Response(status=404)
        return web.FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})


class ThumbnailView(HomeAssistantView):
    url = "/api/protect_detections/thumb/{kind}/{ident}"
    name = "api:protect_detections:thumb"
    requires_auth = True

    async def get(self, request: web.Request, kind: str, ident: str) -> web.Response:
        hub: DetectionHub | None = request.app["hass"].data.get(DOMAIN)
        if hub is None or kind not in ("object", "event") or not ident.replace("-", "").isalnum():
            return web.Response(status=404)
        data = await hub.thumbnail(kind, ident)
        if data is None:
            return web.Response(status=404)
        return web.Response(
            body=data, content_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"}
        )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if not zones_installed():
        # said where the user will see it: on the entry, and under Repairs
        ir.async_create_issue(
            hass, DOMAIN, ISSUE_ZONES, is_fixable=False, severity=ir.IssueSeverity.ERROR, translation_key=ISSUE_ZONES
        )
        raise ConfigEntryError(
            "Protect Zones isn't installed. Install it, restart Home Assistant, then reload Protect Detections."
        )
    ir.async_delete_issue(hass, DOMAIN, ISSUE_ZONES)
    if _protect_api(hass) is None:
        raise ConfigEntryNotReady("Waiting for the UniFi Protect integration")
    hub = DetectionHub(hass, record=entry.options.get(CONF_RECORD, True))
    hass.data[DOMAIN] = hub
    if not hass.data.get(f"{DOMAIN}_registered"):
        websocket_api.async_register_command(hass, ws_subscribe)
        websocket_api.async_register_command(hass, ws_clip)
        websocket_api.async_register_command(hass, ws_history)
        websocket_api.async_register_command(hass, ws_speakers)
        websocket_api.async_register_command(hass, ws_event)
        websocket_api.async_register_command(hass, ws_overlaps)
        websocket_api.async_register_command(hass, ws_live_cameras)
        websocket_api.async_register_command(hass, ws_live_subscribe)
        websocket_api.async_register_command(hass, ws_live_seen)
        websocket_api.async_register_command(hass, ws_video_probe)
        websocket_api.async_register_command(hass, ws_ptz)
        websocket_api.async_register_command(hass, ws_ptz_goto)
        websocket_api.async_register_command(hass, ws_ptz_patrol)
        hass.data[TALK_VIEW] = TalkView()
        hass.http.register_view(hass.data[TALK_VIEW])
        hass.http.register_view(ThumbnailView())
        hass.http.register_view(VideoView())
        hass.http.register_view(ClipView())
        hass.http.register_view(CardsView())
        hass.data[f"{DOMAIN}_registered"] = True
    # the dashboard cards come with the integration (cards.py)
    hass.data[CARD_URLS] = await async_card_urls(hass)
    load_cards(hass, hass.data[CARD_URLS])
    await hub.start()
    entry.async_on_unload(entry.add_update_listener(_options_changed))
    return True


async def _options_changed(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hub: DetectionHub | None = hass.data.pop(DOMAIN, None)
    if hub:
        await hub.stop()
    unload_cards(hass, hass.data.pop(CARD_URLS, []))
    if view := hass.data.get(TALK_VIEW):
        view.stop_all()
    return True
