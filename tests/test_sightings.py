"""Tests for the record of live sightings, run with plain Python:

    python tests/test_sightings.py

Only the record itself (SightingLog) is tested; it needs no Home Assistant.
"""

import importlib.util
import json
from pathlib import Path
import sys

path = Path(__file__).parent.parent / "custom_components" / "protect_detections" / "sightings.py"
spec = importlib.util.spec_from_file_location("sightings", path)
mod = importlib.util.module_from_spec(spec)
sys.modules["sightings"] = mod
spec.loader.exec_module(mod)
SightingLog = mod.SightingLog

fails = 0


def ok(cond, what):
    global fails
    if not cond:
        fails += 1
    print("PASS" if cond else "FAIL", what)


def tr(tid, kind, **extra):
    return {"id": tid, "coord": [1, 2, 3, 4], "objectType": kind, "confidence": 50, "stationary": False,
            "zones": [], "loiterZones": [], "lines": [], "desc": "", **extra}


def msg(at, tracks, event=None, edge="moving"):
    return {"arrived": at, "clockWall": at - 400, "eventId": event, "edgeType": edge, "tracks": tracks}


T = 1_700_000_000_000

# --- one person walking through
log = SightingLog()
log.feed("cam1", {"status": "connected"}, now=T)
log.feed("cam1", msg(T + 1000, [tr("7", "person", confidence=60, zones=[3])], event="ev1"))
log.feed("cam1", msg(T + 1250, [tr("7", "person", confidence=91, zones=[3, 4], loiterZones=[8]), tr("9", "vehicle", desc="white car")], event="ev1"))
log.feed("cam1", msg(T + 1500, [tr("7", "person", confidence=70, lines=[2])], event="ev2", edge="leave"))
snap = log.snapshot(now=T + 2000)
ok(snap["cameras"]["cam1"]["connected"] and snap["cameras"]["cam1"]["last"]["person"] == {"seen": T + 1500, "moved": T + 1500, "seen_protect": T + 1500}, "last seen per camera and kind")
ok(snap["cameras"]["cam1"]["last"]["vehicle"]["seen"] == T + 1250, "each kind has its own time")
ok(len(snap["sightings"]) == 2 and all(s["open"] for s in snap["sightings"]), "while they are reported, their sightings are open")
snap = log.snapshot(now=T + 60_000)
p = next(s for s in snap["sightings"] if s["type"] == "person")
ok(not p["open"] and p["start"] == T + 1000 and p["end"] == T + 1500 and p["reports"] == 3, "no longer reported: the sighting is closed, from its first report to its last")
ok(p["confidence"] == 91, "peak confidence")
ok(p["zones"] == [3, 4] and p["loiter_zones"] == [8] and p["lines"] == [2], "zones, loiter zones and lines it was in, each once")
ok(p["events"] == ["ev1", "ev2"] and p["edges"] == ["moving", "leave"], "Protect's event ids and edge types as they came")
ok(next(s for s in snap["sightings"] if s["type"] == "vehicle")["desc"] == "white car", "a description when Protect gives one")
ok(snap["sightings"][0]["start"] >= snap["sightings"][1]["start"], "newest first")

# --- the same track id later is another sighting; a silent feed closes nothing early
log.feed("cam1", msg(T + 100_000, [tr("7", "person")]))
snap = log.snapshot(types=["person"], now=T + 100_100)
ok(len(snap["sightings"]) == 2 and snap["sightings"][0]["open"] and not snap["sightings"][1]["open"], "a track id seen again after a pause is a new sighting")
ok(set(snap["cameras"]["cam1"]["last"]) == {"person"}, "asked for one kind: only that kind")

# --- standing still: seen, but not moved
log = SightingLog()
log.feed("cam1", msg(T, [tr("b", "vehicle", stationary=True, desc="bike")]))
log.feed("cam1", msg(T + 4000, [tr("b", "vehicle", stationary=True)]))
last = log.snapshot(now=T + 4100)["cameras"]["cam1"]["last"]["vehicle"]
ok(last == {"seen": T + 4000, "seen_protect": T + 4000}, "something standing still is seen, not 'moved'")
ok(log.snapshot(now=T + 4100)["sightings"][0]["moving"] is False, "and its sighting says it never moved")

# --- a kind the cards don't know, or none at all, is kept as it came
log.feed("cam1", msg(T + 5000, [tr("x", "smartThing"), tr("y", None)]))
kinds = set(log.snapshot(now=T + 5100)["cameras"]["cam1"]["last"])
ok({"smartThing", "unknown"} <= kinds, "an unexpected kind is recorded under its own name (none: 'unknown')")
log.feed("cam1", msg(T + 5250, [tr("x", "person")]))
rows = log.snapshot(now=T + 5300)["sightings"]
ok(sum(1 for s in rows if s["track"] == "x") == 2, "a track that changes kind gets a sighting per kind")

# --- broken input does no harm
log.feed("cam1", {"arrived": "soon", "tracks": [None, "x", {"id": 1}]}, now=T + 6000)
log.feed("cam1", {}, now=T + 6000)
ok(True, "odd messages are taken without an error")

# --- bounded: per camera and kind
log = SightingLog()
for n in range(mod.KEEP + 40):
    log.feed("cam1", msg(T + n * 10_000, [tr(f"v{n}", "vehicle")]))
log.feed("cam1", msg(T + 5, [tr("p", "person")]))
snap = log.snapshot(limit=2000, now=T + 10**8)
ok(sum(1 for s in snap["sightings"] if s["type"] == "vehicle") == mod.KEEP, "only the newest of a kind are kept")
ok(any(s["type"] == "person" for s in snap["sightings"]), "many cars don't push the one person out")
ok(len(log.snapshot(limit=3, now=T + 10**8)["sightings"]) == 3 and log.snapshot(limit=0, now=T + 10**8)["sightings"] == [], "limit (0: the times only)")
ok(all(s["end"] >= T + 10**6 for s in log.snapshot(limit=2000, since=T + 10**6, now=T + 10**8)["sightings"]), "since")
many = [tr("z", "person", zones=list(range(n, n + 5))) for n in range(0, 100, 5)]
log = SightingLog()
for n, t in enumerate(many):
    log.feed("cam1", msg(T + n, [t]))
ok(len(log.snapshot(now=T + 50)["sightings"][0]["zones"]) == mod.KEEP_IDS, "the lists inside a sighting are bounded too")

# --- feed gaps
log = SightingLog()
log.feed("cam1", {"status": "connected"}, now=T)
log.feed("cam1", {"status": "disconnected"}, now=T + 10_000)
log.feed("cam1", {"status": "error", "error": "TimeoutError: no answer"}, now=T + 12_000)
log.feed("cam1", {"status": "error", "error": "OSError: refused"}, now=T + 16_000)
snap = log.snapshot(now=T + 17_000)
g = snap["gaps"][0]
ok(len(snap["gaps"]) == 1 and g["from"] == T + 10_000 and g["to"] is None and g["tries"] == 2 and g["error"] == "OSError: refused" and g["camera"] == "cam1", "a drop is one gap, however often reconnecting fails, with the newest reason")
ok(snap["cameras"]["cam1"]["connected"] is False and snap["cameras"]["cam1"]["since"] == T + 10_000, "the camera shows as not connected, since the drop")
log.feed("cam1", {"status": "connected"}, now=T + 30_000)
snap = log.snapshot(now=T + 31_000)
ok(snap["gaps"][0]["to"] == T + 30_000 and snap["cameras"]["cam1"] ["connected"] and snap["cameras"]["cam1"]["since"] == T + 30_000, "reconnected: the gap has its end")
log.feed("cam2", {"status": "error", "error": "x"}, now=T)
ok(log.snapshot(["cam2"], now=T + 1)["gaps"][0]["reason"] == "error" and list(log.snapshot(["cam2"], now=T + 1)["cameras"]) == ["cam2"], "never connected at all is a gap too; asked for one camera: only that one")
for n in range(mod.KEEP_GAPS + 10):
    log.feed("cam1", {"status": "disconnected"}, now=T + 40_000 + n * 10)
    log.feed("cam1", {"status": "connected"}, now=T + 40_005 + n * 10)
ok(len(log.gaps["cam1"]) == mod.KEEP_GAPS, "gaps are bounded")

# --- saved and read back
log = SightingLog()
log.feed("cam1", {"status": "connected"}, now=T)
log.feed("cam1", msg(T + 1000, [tr("7", "person", zones=[3])], event="ev1"))
log.feed("cam1", msg(T + 99_000, [tr("8", "person")]))  # still being seen when saved
saved = json.loads(json.dumps(log.dump(now=T + 100_000)))
ok(saved["version"] == mod.VERSION and len(saved["sightings"]) == 2, "saved as plain JSON, open sightings included")
log.feed("cam1", msg(T + 100_100, [tr("8", "person", zones=[5])]))
ok(saved["sightings"][1]["zones"] == [] and saved["last"]["cam1"]["person"]["seen"] == T + 99_000, "what was handed over for saving doesn't change afterwards")
back = SightingLog(saved, now=T + 500_000)
snap = back.snapshot(now=T + 500_000)
ok(snap["cameras"]["cam1"]["last"]["person"]["seen"] == T + 99_000, "after a restart: last seen is still known")
ok(len(snap["sightings"]) == 2 and not any(s["open"] for s in snap["sightings"]) and snap["sightings"][1]["events"] == ["ev1"], "and the sightings (those cut short are closed)")
g = snap["gaps"][0]
ok(g["reason"] == "not_running" and g["from"] == T + 100_000 and g["to"] is None and not snap["cameras"]["cam1"]["connected"], "the time it was not running is a gap, from the last save")
back.feed("cam1", {"status": "connected"}, now=T + 501_000)
ok(back.snapshot(now=T + 502_000)["gaps"][0]["to"] == T + 501_000, "closed when the feed is back")
ok(SightingLog({"version": 99, "last": {"c": {}}}).snapshot()["cameras"] == {} and SightingLog("junk").snapshot()["cameras"] == {} and SightingLog({"version": mod.VERSION, "sightings": [1, {}], "gaps": {"c": "x"}, "last": {"c": 5}}).snapshot()["sightings"] == [], "a record that can't be read starts empty")

# --- a camera no longer listened to
log = SightingLog()
log.feed("cam1", {"status": "connected"}, now=T)
log.feed("cam1", msg(T + 1000, [tr("7", "person")]))
log.forget("cam1", now=T + 2000)
snap = log.snapshot(now=T + 2100)
ok(not snap["sightings"][0]["open"] and snap["gaps"][0]["reason"] == "not_listening" and not snap["cameras"]["cam1"]["connected"], "a camera taken off: its sighting is closed and a gap begins")

# --- a tracker on this machine hands its own in (source "local")
def lmsg(tracks, **extra):
    return {"clockWall": 1, "source": "local", "tracks": tracks, **extra}


log = SightingLog()
log.feed("cam1", {"status": "connected"}, now=T)
# someone the tracker sees and Protect never reports
for n in range(60):
    log.feed("cam1", lmsg([{"id": 4411, "coord": [1, 2, 3, 4], "objectType": "person", "confidence": 70 + n % 5, "stationary": False, "attached": False, "desc": "", "zones": [], "newField": {"x": 1}}]), now=T + 1000 + n * 33, source="local")
snap = log.snapshot(now=T + 3500)
s0 = snap["sightings"][0]
ok(len(snap["sightings"]) == 1 and s0["source"] == "local" and s0["attached"] is False and s0["protect_id"] is None and s0["track"] == "4411" and s0["reports"] == 60, "a local track with an id of the tracker's own (a number): one sighting, marked local and not attached; fields it doesn't know are no trouble")
last = snap["cameras"]["cam1"]["last"]["person"]
ok(last["seen"] == last["seen_local"] == last["seen_unattached"] == T + 1000 + 59 * 33 and "seen_protect" not in last, "last seen counts it (so 'Last seen' is right in local mode), and says it was the tracker's alone")
ok(log.snapshot(source="protect", now=T + 3500)["sightings"] == [] and len(log.snapshot(source="local", now=T + 3500)["sightings"]) == 1, "asked for one source: only that")
ok(log.gaps.get("cam1", []) == [] and log.feed("cam1", {"status": "error", "error": "engine down"}, now=T + 3600, source="local") is None and log.gaps.get("cam1", []) == [], "the tracker's status messages don't count as gaps of Protect's feed")

# the same thing from both: Protect's own report first, then the local track attached to it
log = SightingLog()
log.feed("cam1", msg(T + 1000, [tr("P7", "person", zones=[3], confidence=88)], event="ev1"))
log.feed("cam1", msg(T + 1250, [tr("P7", "person", zones=[3])], event="ev1"))
for n in range(30):
    at = T + 1300 + n * 33
    log.feed("cam1", lmsg([{"id": "e-1", "coord": [1, 2, 3, 4], "objectType": "person", "confidence": 75, "protect_id": "P7", "attached": True, "zones": [4], "eventId": "ev1"}]), now=at, source="local")
    if n % 8 == 0:
        log.feed("cam1", msg(at + 5, [tr("P7", "person", zones=[3, 5])], event="ev2"))
snap = log.snapshot(now=T + 2400)
ok(len(snap["sightings"]) == 1, "reported by Protect and by the tracker attached to it: one sighting, not two")
s0 = snap["sightings"][0]
ok(s0["source"] == "local" and s0["attached"] is True and s0["protect_id"] == "P7" and s0["track"] == "e-1", "it is the local one, marked attached, with Protect's track id")
ok(s0["start"] == T + 1000 and s0["confidence"] == 88 and sorted(s0["zones"]) == [3, 4, 5] and sorted(s0["events"]) == ["ev1", "ev2"], "and it has what Protect's reports gave before and since: the earlier start, the surer figure, the zones, the event ids")
ok(s0["reports"] == 30, "(its own reports are counted, Protect's of the same thing not twice)")
last = snap["cameras"]["cam1"]["last"]["person"]
ok(last["seen_local"] >= last["seen_protect"] > 0 and "seen_unattached" not in last, "last seen: by both, and never the tracker's alone")
# it ends; Protect goes on reporting that id for a while: Protect's own sighting again
log.feed("cam1", msg(T + 20_000, [tr("P7", "person")]))
snap = log.snapshot(now=T + 20_100)
ok(len(snap["sightings"]) == 2 and snap["sightings"][0]["source"] == "protect" and snap["sightings"][0]["open"], "the local track over and Protect still reporting that id: Protect's own sighting from then on")

# the other order: the tracker first, unattached; Protect catches up
log = SightingLog()
for n in range(20):
    log.feed("cam1", lmsg([{"id": "e-2", "coord": [1, 2, 3, 4], "objectType": "object", "attached": False}]), now=T + n * 33, source="local")
for n in range(20, 40):
    log.feed("cam1", lmsg([{"id": "e-2", "coord": [1, 2, 3, 4], "objectType": "vehicle", "protectId": "V9", "desc": "white car"}]), now=T + n * 33, source="local")
log.feed("cam1", msg(T + 1400, [tr("V9", "vehicle")]))
snap = log.snapshot(now=T + 1500)
ok(len(snap["sightings"]) == 1 and snap["sightings"][0]["type"] == "vehicle" and snap["sightings"][0]["attached"] is True and snap["sightings"][0]["desc"] == "white car" and snap["sightings"][0]["start"] == T, "seen by the tracker first, Protect's details attached in flight (its kind changing with them): still the one sighting, from the tracker's first sight of it")

# a Protect sighting that had just closed when the local one attached
log = SightingLog()
log.feed("cam1", msg(T, [tr("P1", "person")]))
for at in range(T + 1000, T + 5300, 100):  # (the tracker has it meanwhile, not yet matched; Protect's one report is closed as a sighting after 5 s)
    log.feed("cam1", lmsg([{"id": "e-3", "coord": [1, 2, 3, 4], "objectType": "person"}]), now=at, source="local")
log.feed("cam1", lmsg([{"id": "e-3", "coord": [1, 2, 3, 4], "objectType": "person", "protect_id": "P1"}]), now=T + 5300, source="local")
ok(len(log.snapshot(now=T + 5400)["sightings"]) == 1, "Protect's own sighting only just closed when the tracker's was matched to it: taken in as well")
# ... but not one from long before
log = SightingLog()
log.feed("cam1", msg(T, [tr("P1", "person")]))
log.feed("cam1", lmsg([{"id": "e-4", "coord": [1, 2, 3, 4], "objectType": "person", "protect_id": "P1"}]), now=T + 600_000, source="local")
ok(len(log.snapshot(now=T + 600_100)["sightings"]) == 2, "one from ten minutes before with the same id is another visit")

# a report of Protect's merely passed on by the tracker is Protect's thing, not a second one
log = SightingLog()
log.feed("cam1", msg(T, [tr("P2", "vehicle")]))
log.feed("cam1", lmsg([{"id": "P2", "coord": [1, 2, 3, 4], "objectType": "vehicle", "local": False}]), now=T + 100, source="local")
ok(len(log.snapshot(now=T + 200)["sightings"]) == 1, "Protect's report passed on by the tracker under Protect's id: not counted twice")

# odd input, and it stays plain JSON and survives a restart
log = SightingLog()
for bad in ({"tracks": "x"}, {"tracks": [None, 5, {"coord": [1]}, {"id": None}, {"id": {"a": 1}, "objectType": 7, "confidence": "high", "zones": "x", "desc": 9, "protect_id": ""}]}, {"tracks": [{"id": "ok", "objectType": "person", "confidence": True, "arrived": "x"}], "arrived": True}):
    log.feed("cam1", bad, now=T, source="local")
ok(True, "odd local packets are taken without an error")
log = SightingLog()
log.feed("cam1", lmsg([{"id": "e-9", "coord": [1, 2, 3, 4], "objectType": "person", "protect_id": "P9"}]), now=T, source="local")
back = SightingLog(json.loads(json.dumps(log.dump(now=T + 100))), now=T + 9000)
row = back.snapshot(now=T + 9000)["sightings"][0]
ok(row["source"] == "local" and row["attached"] is True and row["protect_id"] == "P9" and back.snapshot(now=T + 9000)["cameras"]["cam1"]["last"]["person"]["seen_local"] == T, "saved and read back with who saw it and whether it was attached")
old = {"version": mod.VERSION, "at": T, "last": {"cam1": {"person": {"seen": T}}}, "sightings": [{"camera": "cam1", "track": "7", "type": "person", "start": T, "end": T}], "gaps": {}}
ok(SightingLog(old, now=T + 1).snapshot(now=T + 1)["sightings"][0]["source"] == "protect", "a record saved before this: its sightings read as Protect's")

# thirty packets a second for a minute: bounded, and quick
import time as _time
log = SightingLog()
t0 = _time.perf_counter()
for n in range(1800):
    log.feed("cam1", lmsg([{"id": f"e-{n // 90}", "coord": [1, 2, 3, 4], "objectType": "vehicle"}, {"id": "parked", "coord": [5, 6, 7, 8], "objectType": "vehicle", "stationary": True}]), now=T + n * 33, source="local")
took = _time.perf_counter() - t0
ok(took < 2 and len(log.open) <= 3 and sum(len(v) for kinds in log.done.values() for v in kinds.values()) <= mod.KEEP, f"a minute at 30 packets a second: {took * 1000:.0f} ms to take in, and no more kept than before")

print(f"{fails} FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
