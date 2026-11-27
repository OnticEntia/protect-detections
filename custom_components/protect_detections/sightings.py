"""What the cameras' live tracking saw, remembered on the server.

The live relay (live.py) passes Protect's "this is where things are now"
messages on to the cards, and only while a card is asking. Nothing of it was
kept, so "when was a person last seen" lived in each browser, and afterwards
nobody could tell whether a person had been reported at all.

This listens to every camera that recognises things, all the time, and keeps:

  last      per camera and kind: when it was last reported, and last moving
  sightings one per tracked thing, from its first report to its last: kind,
            peak confidence, zones, loiter zones, lines, Protect's event ids
            (the newest KEEP per camera and kind)
  gaps      when a camera's feed was not connected, so "nothing was seen" can
            be told from "nobody was listening"

Only Protect's own reports are recorded. (For a while a tracker on this
machine could hand in sightings of its own; it is gone. What it left in a
saved record is still read: a sighting of its own keeps the mark
`source: "local"` so that it can be told from Protect's, and the other
marks it brought, which mean nothing now, are dropped when the record is
read and no longer written.)

It is saved now and then and when Home Assistant stops, and read back when it
starts. A kind is kept as Protect names it, whatever that is, so a name the
cards don't know shows up here rather than disappearing.

The cost: one more websocket to the console per camera that recognises
things, open all the time; a few small messages a second on it while that
camera is tracking something, nothing otherwise. It can be turned off in the
integration's options.

SightingLog is plain Python (no Home Assistant), so it can be tested alone.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
import copy
import logging
import time
from typing import Any

_LOGGER = logging.getLogger(__name__)

VERSION = 1
IDLE_MS = 5000  # no report for this long: the tracked thing has gone
KEEP = 100  # sightings kept per camera and kind
KEEP_GAPS = 50  # feed gaps kept per camera
KEEP_IDS = 16  # zones, lines, event ids ... kept per sighting
DEAD_KEYS = ("attached", "protect_id", "local_at", "protect_at")  # in older saved records: read past, not written
SAVE_EVERY = 300  # seconds between saves while there is something new (and once when stopping)


def _now() -> int:
    return int(time.time() * 1000)


def _add(have: list, new: Any) -> None:
    """Add to a short list of things seen, each once."""
    for item in new if isinstance(new, (list, tuple)) else [new]:
        if item is None or item == "" or isinstance(item, (dict, list)):
            continue
        if item not in have and len(have) < KEEP_IDS:
            have.append(item)


class SightingLog:
    """The record itself. Times are this machine's clock, in ms."""

    def __init__(self, saved: dict[str, Any] | None = None, now: int | None = None) -> None:
        self.last: dict[str, dict[str, dict[str, int]]] = {}  # camera -> kind -> {seen, moved}
        self.done: dict[str, dict[str, list[dict[str, Any]]]] = {}  # camera -> kind -> oldest first
        self.open: dict[tuple[str, str], dict[str, Any]] = {}  # (camera, track id) -> being seen now
        self.gaps: dict[str, list[dict[str, Any]]] = {}  # camera -> oldest first
        self.state: dict[str, dict[str, Any]] = {}  # camera -> {connected, since}
        self.dirty = False
        if isinstance(saved, dict) and saved.get("version") == VERSION:
            self._load(saved, _now() if now is None else now)

    # ------------------------------------------------------------- feeding

    def feed(self, camera: str, payload: dict[str, Any], now: int | None = None) -> None:
        """One message for a camera (tracks, or a status), from this
        integration's relay of Protect's reports."""
        now = _now() if now is None else now
        if payload.get("status"):
            self.status(camera, payload["status"], payload.get("error"), now)
            return
        at = payload.get("arrived")
        at = int(at) if isinstance(at, (int, float)) and not isinstance(at, bool) and at > 0 else now
        self.sweep(at)
        tracks = payload.get("tracks")
        for tr in tracks if isinstance(tracks, list) else []:
            if not isinstance(tr, dict) or tr.get("id") is None:
                continue
            kind = str(tr.get("objectType") or "unknown")
            tid = str(tr.get("id"))[:80]  # (whatever the ids are: text, numbers)
            key = (camera, tid)
            cur = self.open.get(key)
            if cur is not None and cur["type"] != kind:
                self._finish(key)  # the same track, now called something else
                cur = None
            if cur is None:
                cur = self.open[key] = {
                    "camera": camera, "track": tid, "type": kind, "start": at, "end": at,
                    "confidence": 0, "reports": 0, "moving": False, "desc": "",
                    "zones": [], "loiter_zones": [], "lines": [], "events": [], "edges": [],
                }
            self._note(cur, tr, payload, at, kind, camera)

    def _note(self, cur: dict[str, Any], tr: dict[str, Any], payload: dict[str, Any], at: int, kind: str, camera: str) -> None:
        """One report of a thing, added to its sighting."""
        cur["end"] = max(cur["end"], at)
        cur["reports"] += 1
        conf = tr.get("confidence")
        if isinstance(conf, (int, float)) and not isinstance(conf, bool) and conf > cur["confidence"]:
            cur["confidence"] = conf
        if tr.get("desc") and isinstance(tr["desc"], str):
            cur["desc"] = tr["desc"][:60]
        _add(cur["zones"], tr.get("zones"))
        _add(cur["loiter_zones"], tr.get("loiterZones"))
        _add(cur["lines"], tr.get("lines"))
        _add(cur["events"], tr.get("eventId"))
        _add(cur["events"], payload.get("eventId"))
        _add(cur["edges"], payload.get("edgeType"))
        last = self.last.setdefault(camera, {}).setdefault(kind, {})
        last["seen"] = max(last.get("seen", 0), at)
        if not tr.get("stationary"):
            cur["moving"] = True
            last["moved"] = max(last.get("moved", 0), at)
        self.dirty = True

    def sweep(self, now: int | None = None) -> None:
        """Close the sightings of things that are no longer reported. (The
        feed says nothing when nothing is tracked, so this is done whenever
        the record is next touched; a sighting ends at its own last report.)"""
        now = _now() if now is None else now
        for key in [k for k, s in self.open.items() if now - s["end"] > IDLE_MS]:
            self._finish(key)

    def _finish(self, key: tuple[str, str]) -> None:
        cur = self.open.pop(key, None)
        if cur is None:
            return
        rows = self.done.setdefault(cur["camera"], {}).setdefault(cur["type"], [])
        rows.append(cur)
        del rows[:-KEEP]
        self.dirty = True

    def status(self, camera: str, status: str, error: Any = None, now: int | None = None) -> None:
        """The feed of a camera connected, dropped, or failed to connect."""
        now = _now() if now is None else now
        gaps = self.gaps.setdefault(camera, [])
        gap = gaps[-1] if gaps and gaps[-1].get("to") is None else None
        if status == "connected":
            if gap is not None:
                gap["to"] = now
            self.state[camera] = {"connected": True, "since": now}
            self.dirty = True
            return
        if status not in ("disconnected", "error"):
            return
        if (self.state.get(camera) or {}).get("connected", True):
            self.state[camera] = {"connected": False, "since": now}
        if gap is None:
            gap = {"from": now, "to": None, "reason": status, "tries": 0}
            gaps.append(gap)
            del gaps[:-KEEP_GAPS]
        if status == "error":
            gap["tries"] = gap.get("tries", 0) + 1
            if error:
                gap["error"] = str(error)[:200]  # the newest reason
        self.dirty = True

    def forget(self, camera: str, now: int | None = None, reason: str = "not_listening") -> None:
        """A camera is no longer listened to: what was open is closed, and the
        time from now on counts as a gap."""
        now = _now() if now is None else now
        for key in [k for k in self.open if k[0] == camera]:
            self._finish(key)
        gaps = self.gaps.setdefault(camera, [])
        if not gaps or gaps[-1].get("to") is not None:
            gaps.append({"from": now, "to": None, "reason": reason, "tries": 0})
            del gaps[:-KEEP_GAPS]
        self.state[camera] = {"connected": False, "since": now}
        self.dirty = True

    # ------------------------------------------------------- keeping it

    def dump(self, now: int | None = None) -> dict[str, Any]:
        """Everything, as it is saved."""
        now = _now() if now is None else now
        self.sweep(now)
        rows = [s for kinds in self.done.values() for part in kinds.values() for s in part]
        rows += list(self.open.values())
        # (a copy: it is written to disk in another thread while this goes on)
        return copy.deepcopy({
            "version": VERSION,
            "at": now,
            "last": self.last,
            "sightings": sorted(rows, key=lambda s: s["start"]),
            "gaps": self.gaps,
        })

    def _load(self, saved: dict[str, Any], now: int) -> None:
        for cam, kinds in (saved.get("last") or {}).items():
            if isinstance(kinds, dict):
                self.last[str(cam)] = {
                    str(k): {a: int(b) for a, b in v.items() if a in ("seen", "moved") and isinstance(b, (int, float))}
                    for k, v in kinds.items()
                    if isinstance(v, dict)
                }
        for s in saved.get("sightings") or []:
            if isinstance(s, dict) and s.get("camera") and s.get("type") and s.get("start"):
                rows = self.done.setdefault(str(s["camera"]), {}).setdefault(str(s["type"]), [])
                # (marks from when a tracker on this machine handed sightings in: only "it was that tracker's own" is kept)
                s = {k: v for k, v in s.items() if k not in DEAD_KEYS and not (k == "source" and v != "local")}
                rows.append(s)
                del rows[:-KEEP]
        # between that save and now nothing was listening
        at = saved.get("at")
        at = int(at) if isinstance(at, (int, float)) and 0 < at <= now else now
        cams = set(self.last) | set(self.done) | set(saved.get("gaps") or {})
        for cam, gaps in (saved.get("gaps") or {}).items():
            if isinstance(gaps, list):
                self.gaps[str(cam)] = [g for g in gaps if isinstance(g, dict) and g.get("from")][-KEEP_GAPS:]
        for cam in cams:
            gaps = self.gaps.setdefault(cam, [])
            if not gaps or gaps[-1].get("to") is not None:
                gaps.append({"from": at, "to": None, "reason": "not_running", "tries": 0})
                del gaps[:-KEEP_GAPS]
            self.state[cam] = {"connected": False, "since": at}

    # ----------------------------------------------------------- asking

    def snapshot(
        self,
        cameras: Iterable[str] | None = None,
        types: Iterable[str] | None = None,
        limit: int = 50,
        since: int | None = None,
        now: int | None = None,
    ) -> dict[str, Any]:
        """What a card or a person looking into it gets: per camera when each
        kind was last seen and whether its feed is connected, then the newest
        sightings and feed gaps (newest first)."""
        now = _now() if now is None else now
        self.sweep(now)
        want = None if cameras is None else set(cameras)
        kinds = None if types is None else set(types)
        cams: dict[str, Any] = {}
        for cam in sorted(set(self.last) | set(self.state) | set(self.gaps) | set(self.done)):
            if want is not None and cam not in want:
                continue
            state = self.state.get(cam) or {}
            cams[cam] = {
                "connected": bool(state.get("connected")),
                "since": state.get("since"),
                "last": {k: dict(v) for k, v in (self.last.get(cam) or {}).items() if kinds is None or k in kinds},
            }
        rows: list[dict[str, Any]] = []
        gaps: list[dict[str, Any]] = []
        if limit > 0:
            for cam in cams:
                for kind, part in (self.done.get(cam) or {}).items():
                    if kinds is None or kind in kinds:
                        rows += [{**s, "open": False} for s in part]
                gaps += [{**g, "camera": cam} for g in self.gaps.get(cam) or []]
            rows += [
                {**s, "open": True}
                for s in self.open.values()
                if s["camera"] in cams and (kinds is None or s["type"] in kinds)
            ]
            if since:
                rows = [s for s in rows if s["end"] >= since]
                gaps = [g for g in gaps if (g.get("to") or now) >= since]
            rows = sorted(rows, key=lambda s: s["start"], reverse=True)[:limit]
            gaps = sorted(gaps, key=lambda g: g["from"], reverse=True)[:limit]
        return {"now": now, "cameras": cams, "sightings": rows, "gaps": gaps}


class SightingRecorder:
    """Keeps a SightingLog fed from the live relay, and saved."""

    def __init__(self, hass, live, domain: str) -> None:
        from homeassistant.helpers.storage import Store  # noqa: PLC0415

        self.hass = hass
        self.live = live
        self.log = SightingLog()
        self.recording = False
        self._store = Store(hass, VERSION, f"{domain}.sightings")
        self._unsubs: dict[str, Callable[[], None]] = {}
        self._pending = False

    async def load(self) -> None:
        try:
            self.log = SightingLog(await self._store.async_load())
        except Exception:  # noqa: BLE001 - an unreadable record is started afresh
            _LOGGER.warning("Couldn't read the saved sightings; starting a new record", exc_info=True)

    def watch(self, camera_ids: Iterable[str]) -> None:
        """Listen to exactly these cameras (called again when they change)."""
        want = set(camera_ids)
        self.recording = bool(want)
        for cam in [c for c in self._unsubs if c not in want]:
            self._unsubs.pop(cam)()
            self.log.forget(cam)
        for cam in want - set(self._unsubs):
            self._unsubs[cam] = self.live.subscribe(cam, lambda payload, cam=cam: self._feed(cam, payload))
        self._save_later()

    def _feed(self, camera: str, payload: dict[str, Any]) -> None:
        if payload.get("status") == "removed":
            # the camera has gone from Protect: what is on record of it is kept, and nothing more is written
            if camera in self._unsubs:
                self._unsubs.pop(camera)()
                self.log.forget(camera, reason="removed")
                self._save_later()
            return
        self.log.feed(camera, payload)
        self._save_later()

    def _save_later(self) -> None:
        if self._pending or not self.log.dirty:
            return
        self._pending = True
        self._store.async_delay_save(self._data, SAVE_EVERY)

    def _data(self) -> dict[str, Any]:
        self._pending = False
        self.log.dirty = False
        return self.log.dump()

    async def stop(self) -> None:
        was = bool(self._unsubs)
        for cam in list(self._unsubs):
            self._unsubs.pop(cam)()
        self.recording = False
        # (saved even with nothing new: the time of it is where the gap starts)
        if was or self.log.dirty or self._pending:
            await self._store.async_save(self._data())
