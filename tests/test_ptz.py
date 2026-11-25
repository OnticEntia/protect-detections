"""Tests for the presets and patrols of a camera that moves (ptz.py), run with
plain Python:

    python tests/test_ptz.py

Everything Home Assistant and Protect would do is stood in for here: no
camera is asked anything and none is moved.
"""

import asyncio
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace as NS

base = Path(__file__).parent.parent / "custom_components" / "protect_detections"
spec = importlib.util.spec_from_file_location("pd_ptz", base / "ptz.py")
ptz = importlib.util.module_from_spec(spec)
sys.modules["pd_ptz"] = ptz
spec.loader.exec_module(ptz)
fails = 0


def ok(cond, what):
    global fails
    if not cond:
        fails += 1
    print("PASS" if cond else "FAIL", what)


class House:
    """A stand-in Home Assistant with one moving camera, one fixed, one removed."""

    def __init__(self, *, presets=None, presets_fail=None, service=True, patrol="some", fail=None):
        self.calls = []
        self.reads = 0
        self.service = service
        self.fail = fail
        if presets is None:
            presets = [NS(name="Gate", slot=2), NS(name="Drive", slot=0), NS(name="home", slot=-1), NS(name="Gate", slot=5), NS(name="", slot=7)]

        async def get_ptz_presets():
            self.reads += 1
            if presets_fail:
                raise presets_fail
            return presets

        self.cams = {
            "camera.mover": (NS(feature_flags=NS(is_ptz=True), get_ptz_presets=get_ptz_presets), False),
            "camera.fixed": (NS(feature_flags=NS(is_ptz=False), get_ptz_presets=get_ptz_presets), False),
            "camera.odd": (NS(), False),  # (a camera that says nothing about moving)
            "camera.gone": (None, True),
        }
        self.patrols = {
            "some": {"entity": "select.mover_patrol", "options": ["stop", "Round", "Night"], "state": "stop"},
            "running": {"entity": "select.mover_patrol", "options": ["stop", "Round", "Night"], "state": "Night"},
            "empty": {"entity": "select.mover_patrol", "options": ["stop"], "state": "stop"},
            "down": {"entity": "select.mover_patrol", "options": ["stop", "Round"], "state": "unavailable"},
            "none": None,
        }[patrol]

    async def call(self, domain, service, data, context):
        self.calls.append((domain, service, data, context))
        if self.fail:
            raise self.fail

    def make(self):
        return ptz.Ptz(
            camera=lambda e: self.cams.get(e, (None, False)),
            device=lambda e: {"camera.mover": "dev1", "camera.fixed": "dev2"}.get(e),
            patrol=lambda d: self.patrols if d == "dev1" else None,
            has_service=lambda d, s: self.service and (d, s) == ("unifiprotect", "ptz_goto_preset"),
            call=self.call,
        )


def refused(coro):
    """The code a request was refused with (None when it went through)."""
    try:
        asyncio.run(coro)
    except ptz.Refused as err:
        return err.code, err.message
    return None, None


run = asyncio.run

# --- a camera that moves, for an administrator
h = House()
info = run(h.make().info(True, "camera.mover"))
ok(info["ptz"] is True and info["home"] is True and info["presets_error"] is None, "a camera that moves: said so, with Home")
ok(info["presets"] == ["Drive", "Gate"], "its presets by name, in their order, Home and nameless ones left out, a name once")
ok(info["patrol"] == {"entity": "select.mover_patrol", "options": ["Round", "Night"], "running": None, "available": True}, "its patrols (stop is not one of them), none running")
ok(h.reads == 1 and h.calls == [], "the presets were read once and nothing was sent")
ok(run(House(patrol="running").make().info(True, "camera.mover"))["patrol"]["running"] == "Night", "a running patrol is named")

# --- one that does not
h = House()
ok(run(h.make().info(True, "camera.fixed")) == {"ptz": False} and h.reads == 0, "a camera that does not move: just that, nothing read")
ok(run(h.make().info(True, "camera.odd")) == {"ptz": False}, "a camera that says nothing about moving: not one that moves")
ok(refused(h.make().info(True, "camera.other"))[0] == "not_found", "not one of Protect's cameras: said")
ok(refused(h.make().info(True, "camera.gone"))[0] == "camera_removed", "a camera Protect no longer has: said as that")
ok(refused(h.make().goto(True, "camera.fixed", "Home"))[0] == "not_ptz" and h.calls == [], "a camera that does not move is not sent anywhere")
ok(refused(h.make().patrol(True, "camera.fixed", "stop"))[0] == "not_ptz" and h.calls == [], "nor given a patrol")

# --- not an administrator: refused before anything is looked at
h = House()
for name, coro in (("info", h.make().info(False, "camera.mover")), ("goto", h.make().goto(False, "camera.mover", "Home")), ("patrol", h.make().patrol(False, "camera.mover", "Round"))):
    ok(refused(coro)[0] == "unauthorized", f"not an administrator: {name} is refused")
ok(h.reads == 0 and h.calls == [], "and nothing was read or sent for them")
ok(refused(h.make().goto(None, "camera.mover", "Home"))[0] == "unauthorized" and refused(h.make().goto(1, "camera.mover", "Home"))[0] == "unauthorized", "only a plain yes counts as an administrator")

# --- presets that cannot be read
h = House(presets_fail=RuntimeError("401  Unauthorized\n"))
info = run(h.make().info(True, "camera.mover"))
ok(info["ptz"] and info["home"] is True and info["presets"] is None and info["presets_error"] == "401 Unauthorized", "presets cannot be read: Home alone, and why, in a line")
info = run(House(presets_fail=TimeoutError()).make().info(True, "camera.mover"))
ok(info["presets"] is None and info["presets_error"] == "UniFi Protect did not give the presets", "an error with no words gets ours")
ok(run(House(presets=[]).make().info(True, "camera.mover"))["presets"] == [], "no presets saved: an empty list, not an error")

# --- no preset service (an older Home Assistant)
h = House(service=False)
info = run(h.make().info(True, "camera.mover"))
ok(info["home"] is False and info["presets"] is None and "too old" in info["presets_error"] and h.reads == 0, "no preset service: no Home, why is said, nothing read")
ok(info["patrol"]["options"] == ["Round", "Night"], "the patrols are still offered")
ok(refused(h.make().goto(True, "camera.mover", "Home"))[0] == "not_supported" and h.calls == [], "and going to a preset is refused, nothing sent")

# --- no patrols
ok(run(House(patrol="none").make().info(True, "camera.mover"))["patrol"] is None, "no patrol entity: none")
ok(run(House(patrol="empty").make().info(True, "camera.mover"))["patrol"]["options"] == [], "no patrols defined: an empty list")
ok(refused(House(patrol="none").make().patrol(True, "camera.mover", "stop"))[0] == "no_patrols", "no patrol entity: starting or stopping is refused")
h = House(patrol="empty")
ok(refused(h.make().patrol(True, "camera.mover", "Round"))[0] == "invalid" and h.calls == [], "a patrol the camera does not have is not started")
h = House(patrol="down")
ok(refused(h.make().patrol(True, "camera.mover", "Round"))[0] == "failed" and h.calls == [], "a patrol entity that is not available: said, nothing sent")

# --- sending
h = House()
ok(run(h.make().goto(True, "camera.mover", "Gate", "ctx")) == {"sent": "Gate"}, "a preset is sent")
ok(h.calls == [("unifiprotect", "ptz_goto_preset", {"device_id": "dev1", "preset": "Gate"}, "ctx")], "by the integration's own service, for the camera's device, in the user's name")
h = House()
run(h.make().goto(True, "camera.mover", "Home"))
ok(h.calls[0][2] == {"device_id": "dev1", "preset": "Home"} and h.reads == 0, "Home is sent by name (no list needed)")
ok(refused(House().make().goto(True, "camera.mover", "  "))[0] == "invalid", "no name: nothing sent")
h = House()
ok(run(h.make().patrol(True, "camera.mover", "Round", "ctx")) == {"sent": "Round"} and h.calls == [("select", "select_option", {"entity_id": "select.mover_patrol", "option": "Round"}, "ctx")], "a patrol is started by the integration's patrol entity")
h = House(patrol="running")
run(h.make().patrol(True, "camera.mover", "stop"))
ok(h.calls[0][2] == {"entity_id": "select.mover_patrol", "option": "stop"}, "and stopped by it")

# --- the service failing
h = House(fail=RuntimeError("Preset Gate not found on the camera"))
code, message = refused(h.make().goto(True, "camera.mover", "Gate"))
ok(code == "failed" and message == "Preset Gate not found on the camera" and len(h.calls) == 1, "the service failing: said in its own words, tried once")
code, message = refused(House(fail=RuntimeError()).make().goto(True, "camera.mover", "Home"))
ok(code == "failed" and message == "UniFi Protect did not take the command", "a failure with no words gets ours")
code, message = refused(House(fail=RuntimeError("x" * 500)).make().patrol(True, "camera.mover", "Round"))
ok(code == "failed" and len(message) == 200, "a patrol failing: said too, kept to a line")

# --- only the two services are ever called
src = (base / "ptz.py").read_text()
ok(src.count("self._call(") == 2 and 'PRESET_SERVICE = ("unifiprotect", "ptz_goto_preset")' in src and 'PATROL_SERVICE = ("select", "select_option")' in src, "only the two services are called, and nothing is written to Protect from here")
init = (base / "__init__.py").read_text()
ok(all(f"async_register_command(hass, {n})" in init for n in ("ws_ptz", "ws_ptz_goto", "ws_ptz_patrol")) and "connection.user.is_admin" in init, "the three requests are registered, and asked as the user who is connected")

print(f"{fails} FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
