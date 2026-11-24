"""Tests for cameras going offline, being removed, and being added, run with
plain Python:

    python tests/test_cameras.py

The camera book (cameras.py), the live relay's ending for a removed camera
(live.py) and the record's refusal to write for one (sightings.py). None of
it needs Home Assistant.
"""

import asyncio
import importlib.util
from pathlib import Path
import sys

base = Path(__file__).parent.parent / "custom_components" / "protect_detections"


def load(name):
    spec = importlib.util.spec_from_file_location(f"pd_{name}", base / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[f"pd_{name}"] = mod
    spec.loader.exec_module(mod)
    return mod


cameras = load("cameras")
live = load("live")
sightings = load("sightings")
fails = 0


def ok(cond, what):
    global fails
    if not cond:
        fails += 1
    print("PASS" if cond else "FAIL", what)


def cam(n, **extra):
    return {"id": f"id{n}", "name": f"Camera {n}", "entity": f"camera.c{n}_medium", "tap_entity": f"camera.c{n}_high", **extra}


# --- the camera book
book = cameras.CameraBook()
what = book.update([cam(1), cam(2)])
ok(what == {"added": ["id1", "id2"], "removed": [], "back": [], "changed": []}, "the cameras Protect has: taken in as new")
ok(book.present("id1") and book.label("id1") == ("Camera 1", False) and book.of_entity("camera.c1_high") == ("id1", False), "a camera there: present, by its name, found by either entity")
ok(book.update([cam(1), cam(2)]) == {"added": [], "removed": [], "back": [], "changed": []}, "nothing changed: nothing reported")
# offline is not removed: Protect still lists it
ok(book.update([cam(1), cam(2)])["removed"] == [] and book.present("id2"), "a camera that is merely offline is still in Protect's list: nothing changes for it")
# renamed, or its entities changed
what = book.update([cam(1, name="Porch"), cam(2)])
ok(what["changed"] == ["id1"] and book.label("id1") == ("Porch", False), "renamed: reported as changed, the new name used")
# removed
what = book.update([cam(1, name="Porch")])
ok(what == {"added": [], "removed": ["id2"], "back": [], "changed": []}, "a camera no longer in Protect's list: reported as removed, once")
ok(not book.present("id2") and book.label("id2") == ("Camera 2", True), "it is kept, with its name, marked as removed")
ok(book.cams["id2"]["entity"] is None and book.cams["id2"]["tap_entity"] is None and book.cams["id2"]["was"] == ["camera.c2_medium", "camera.c2_high"], "its entities are no longer its (they are kept aside, as what they were)")
ok(book.of_entity("camera.c2_high") == ("id2", True) and book.of_entity("camera.other") == (None, False), "asked for by its old entity: 'that camera has been removed', not 'no such camera'")
ok(book.update([cam(1, name="Porch")]) == {"added": [], "removed": [], "back": [], "changed": []}, "still gone: not reported again")
# one never seen here
ok(book.label("never") == (cameras.REMOVED_NAME, True) and not book.present("never") and not book.present(None), "a camera gone before this ever saw it: a plain 'Removed camera'")
# back, and a new one adopted
what = book.update([cam(1, name="Porch"), cam(2), cam(3)])
ok(what["back"] == ["id2"] and what["added"] == ["id3"] and book.present("id2") and book.of_entity("camera.c2_high") == ("id2", False) and book.cams["id2"]["was"] == [], "put back into Protect: there again; a newly adopted one is simply new")
# everything gone at once
what = book.update([])
ok(sorted(what["removed"]) == ["id1", "id2", "id3"] and len(book.cams) == 3 and not any(book.present(c) for c in book.cams), "all removed: all kept as removed (nothing is forgotten by itself)")
ok(book.update([{"name": "no id"}, cam(4)])["added"] == ["id4"], "an entry without an id is passed over")


# --- the live relay: a camera that is no longer in Protect
class FakeHass:
    def __init__(self, loop):
        self.loop = loop

    def async_create_background_task(self, coro, name):
        return self.loop.create_task(coro)


async def relay():
    loop = asyncio.get_running_loop()
    there = {"id1"}
    def api():
        return None  # (no connection can be made here: each try fails at once, as with a console that doesn't answer)

    real_sleep = asyncio.sleep
    live.asyncio.sleep = lambda s: real_sleep(0)  # (no waiting between tries, in the test)
    rel = live.LiveTracks(FakeHass(loop), api, lambda cid: cid in there)
    # one that isn't there to begin with
    got = []
    rel.subscribe("gone", got.append)
    await real_sleep(0.01)
    ok(got == [{"status": "removed"}] and "gone" not in rel.feeds, "listening to a camera Protect doesn't have: told 'removed' at once, nothing tried, nothing left running")
    # one that is there, but can't be reached (offline, or the console down): tried again and again, quietly
    got2 = []
    unsub = rel.subscribe("id1", got2.append)
    await real_sleep(0.02)
    tries = len(got2)  # (each failed try tells its listeners of the error)
    ok(tries >= 3 and all(m["status"] == "error" for m in got2) and "id1" in rel.feeds, f"a camera that is there but can't be reached: tried again ({tries} times here), its listeners told of the error, never 'removed'")
    # ... and then it is taken out of Protect while being listened to
    there.clear()
    await real_sleep(0.02)
    after = len(got2)
    await real_sleep(0.02)
    ok(got2[-1] == {"status": "removed"} and "id1" not in rel.feeds and len(got2) == after, "taken out of Protect meanwhile: its listeners are told 'removed', and the trying stops for good")
    ok(sum(1 for m in got2 if m.get("status") == "removed") == 1, "(told once)")
    unsub()  # (a listener leaving afterwards does no harm)
    await real_sleep(0.01)
    # dropped by the hub the moment it hears of the removal
    there.add("id5")
    got3 = []
    rel.subscribe("id5", got3.append)
    await real_sleep(0.005)
    rel.drop("id5")
    n = len(got3)
    await real_sleep(0.02)
    ok(got3[-1] == {"status": "removed"} and "id5" not in rel.feeds and len(got3) == n, "dropped by the hub: ended there and then, the listeners told why")
    rel.drop("never-listened-to")
    ok(True, "dropping a camera nobody listens to is nothing")
    # put back: listened to again like any other
    got4 = []
    rel.subscribe("id5", got4.append)
    await real_sleep(0.01)
    ok("id5" in rel.feeds and got4 and got4[-1]["status"] == "error", "back in Protect: listening starts afresh")
    await rel.stop()
    live.asyncio.sleep = real_sleep


asyncio.run(relay())

# --- the record: nothing is written for a camera that has gone
rec = object.__new__(sightings.SightingRecorder)
rec.log = sightings.SightingLog()
rec.recording = True
rec._pending = True  # (as if a save were already due: no store here)
ended = []
rec._unsubs = {"id1": lambda: ended.append("id1")}
present = {"id1"}
rec.known = lambda cid: cid in present
T = 1_700_000_000_000
pkt = {"source": "local", "tracks": [{"id": "L1", "coord": [1, 2, 3, 4], "objectType": "person"}]}
rec.record_live("id1", pkt)
rec.record_live("id9", pkt)
ok(set(rec.log.last) == {"id1"}, "a tracker's packet for a camera Protect doesn't have is not recorded; one for a camera it has is")
before = rec.log.dump()["sightings"]
rec._feed("id1", {"status": "removed"})
ok(ended == ["id1"] and "id1" not in rec._unsubs, "word from the relay that a camera has been removed: it is no longer listened to")
snap = rec.log.snapshot()
ok(len(snap["sightings"]) == len(before) == 1 and snap["gaps"][0]["reason"] == "removed" and snap["cameras"]["id1"]["connected"] is False, "what was on record of it is kept, and the record says from when it was gone")
present.clear()
rec.record_live("id1", pkt)
rec._feed("id1", {"status": "removed"})
ok(len(rec.log.snapshot()["sightings"]) == 1 and len(rec.log.snapshot()["gaps"]) == 1, "nothing more is written for it afterwards")
rec.known = None
rec.record_live("id7", pkt)
ok("id7" in rec.log.last, "(with no way of telling, as in an older set-up, packets are recorded as before)")

print(f"{fails} FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
