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
  http       /protect_detections/frontend/<version>/<file>   the cards (cards.py)
  http       /api/protect_detections/thumb/object/<thumbnail id>
             /api/protect_detections/thumb/event/<event id>
             /api/protect_detections/clip/<file>   (signed path)
             /api/protect_detections/talk/<camera id>   (signed path, websocket:
             microphone audio in, out of the camera's speaker; talk.py)

A companion to the UniFi Protect integration: the live stream connection is
the one shared by the Protect companions (protect_zones/stream.py).

It reuses the logged-in client of HA's own UniFi Protect integration, so it
holds no credentials of its own. It uses Protect's internal API, which is
undocumented: a Protect update could change it.
"""

from __future__ import annotations

import asyncio
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

# The connection to Protect's live updates is Protect Zones' (one connection
# for all the Protect companions). Only its code is needed, not a set-up
# entry: the stream is made on first use and connects by itself. Protect
# Zones is another repository, so it can't be a dependency in the manifest;
# it is looked for here instead, and setting up says so if it is missing.
try:
    from custom_components.protect_zones.stream import async_get_stream
except ImportError:  # Protect Zones isn't installed (or is too old to have it)
    async_get_stream = None

from .cards import CardsView, async_card_urls, load_cards, unload_cards
from .clips import ClipStore
from .live import LiveTracks
from .sightings import SightingRecorder
from .talk import TalkView, speakers

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
        self.cameras: dict[str, dict[str, Any]] = {}
        self.thumbs: OrderedDict[str, bytes] = OrderedDict()
        self._track_tasks: dict[str, asyncio.Task] = {}
        self._track_done: set[str] = set()
        self._unsub_stream = None
        self._stopping = False
        self.clips = ClipStore()
        self.live = LiveTracks(hass, lambda: _protect_api(hass))
        self.sightings = SightingRecorder(hass, self.live, DOMAIN)
        self.history: OrderedDict[str, dict[str, Any]] = OrderedDict()

    @property
    def api(self):
        return _protect_api(self.hass)

    @property
    def connected(self) -> bool:
        return async_get_stream(self.hass).connected

    # ---------------------------------------------------------------- setup

    def load_cameras(self) -> None:
        """Protect camera id -> name and HA camera entities (medium / high)."""
        api = self.api
        if api is None:
            return
        reg = er.async_get(self.hass)
        by_uid = {
            e.unique_id: e.entity_id
            for e in reg.entities.values()
            if e.platform == "unifiprotect" and e.domain == "camera" and not e.disabled_by
        }
        for cam in api.bootstrap.cameras.values():
            mac = (cam.mac or "").replace(":", "").upper()
            high = by_uid.get(f"{mac}_0")
            self.cameras[cam.id] = {
                "id": cam.id,
                "name": cam.name,
                "entity": by_uid.get(f"{mac}_1") or high,
                "tap_entity": high or by_uid.get(f"{mac}_1"),
            }

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
        self._push_snapshot()  # dashboards that were open across a reload

    async def stop(self) -> None:
        self._stopping = True
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
        self.load_cameras()  # cameras may have been added or renamed too
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
                self.load_cameras()  # a camera added since we started
            cam = self.cameras.get(cam_id, {})
            ev = {
                "id": eid,
                "camera_id": cam_id,
                "camera": cam.get("name") or "Camera",
                "entity": cam.get("entity"),
                "tap_entity": cam.get("tap_entity"),
                "type": raw.get("type"),
                "start": raw.get("start"),
                "end": None,
                "types": [],
                "areas": [],
                "objects": [],
                "track": None,
            }
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
        cam = self.cameras.get(cam_id, {})
        meta = raw.get("metadata") or {}
        return {
            "id": raw.get("id"),
            "camera_id": cam_id,
            "camera": cam.get("name") or "Camera",
            "entity": cam.get("entity"),
            "tap_entity": cam.get("tap_entity"),
            "type": raw.get("type"),
            "start": raw.get("start"),
            "end": raw.get("end"),
            "types": raw.get("smartDetectTypes") or [],
            "areas": [a.get("areaIndexes") or [] for a in meta.get("detectedAreas") or []],
            "objects": _objects_from_meta(meta),
            "track": None,
        }

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
        return {"snapshot": list(self.events.values()), "connected": self.connected, "cameras": list(self.cameras.values())}

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
    """The Protect camera an HA camera entity (either stream) belongs to."""
    for cam_id, cam in hub.cameras.items():
        if entity in (cam.get("entity"), cam.get("tap_entity")):
            return cam_id
    return None


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/live/cameras"})
@callback
def ws_live_cameras(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The camera entities whose cameras recognise things (so have live boxes)."""
    hub: DetectionHub | None = hass.data.get(DOMAIN)
    out: dict[str, str] = {}
    for cam_id in hub.smart_cameras() if hub else []:
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
        hub.load_cameras()  # a camera added since we started
        cam_id = _camera_of(hub, msg["entity"])
    if cam_id is None:
        connection.send_error(msg["id"], "not_found", "Not a UniFi Protect camera")
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
})
@callback
def ws_live_seen(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """What the cameras' live tracking has seen, as recorded here whether or
    not a dashboard was open (sightings.py): per camera (Protect's id) when
    each kind was last seen and whether its feed is connected, then the
    newest sightings and feed gaps. `limit: 0` gives the first part only."""
    hub: DetectionHub | None = hass.data.get(DOMAIN)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Protect Detections isn't loaded")
        return
    only = None
    if msg.get("entity"):
        cam_id = _camera_of(hub, msg["entity"])
        if cam_id is None:
            connection.send_error(msg["id"], "not_found", "Not a UniFi Protect camera")
            return
        only = [cam_id]
    out = hub.sightings.log.snapshot(only, msg.get("types"), msg["limit"], msg.get("since"))
    for cam_id, cam in out["cameras"].items():
        known = hub.cameras.get(cam_id) or {}
        cam["name"] = known.get("name")
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
        hass.data[TALK_VIEW] = TalkView()
        hass.http.register_view(hass.data[TALK_VIEW])
        hass.http.register_view(ThumbnailView())
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
