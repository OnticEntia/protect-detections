"""What other integrations call in this one is still there, in the same shape.

    python tests/test_interface.py

Other integrations may use `hass.data["protect_detections"].smart_cameras()` and
`.live.subscribe(camera_id, send)`. This reads the source (no Home Assistant
needed) and fails if either is renamed or takes other arguments.
"""

import ast
from pathlib import Path
import sys

base = Path(__file__).parent.parent / "custom_components" / "protect_detections"
fails = 0


def ok(cond, what):
    global fails
    if not cond:
        fails += 1
    print("PASS" if cond else "FAIL", what)


def method(path, cls, name):
    tree = ast.parse((base / path).read_text())
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == cls:
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name == name:
                    return item
    return None


def assigned(path, cls, attr):
    """Is self.<attr> set in the class's __init__?"""
    init = method(path, cls, "__init__")
    return init is not None and any(
        isinstance(n, ast.Attribute) and n.attr == attr and isinstance(n.ctx, ast.Store) for n in ast.walk(init)
    )


smart = method("__init__.py", "DetectionHub", "smart_cameras")
ok(isinstance(smart, ast.FunctionDef) and [a.arg for a in smart.args.args] == ["self"], "hub.smart_cameras() takes nothing and is not a coroutine")
ok(assigned("__init__.py", "DetectionHub", "live"), "hub.live is there")
sub = method("live.py", "LiveTracks", "subscribe")
ok(isinstance(sub, ast.FunctionDef) and [a.arg for a in sub.args.args] == ["self", "camera_id", "send"], "hub.live.subscribe(camera_id, send) is not a coroutine and takes those two")
ok(method("__init__.py", "DetectionHub", "record_live") is None, "hub.record_live is gone (nothing but Protect makes sightings)")
src = (base / "__init__.py").read_text()
ok('DOMAIN = "protect_detections"' in src and "hass.data[DOMAIN] = hub" in src, 'the hub is hass.data["protect_detections"]')
keys = ast.literal_eval(next(n.value for n in ast.parse((base / "live.py").read_text()).body if isinstance(n, ast.Assign) and n.targets[0].id == "TRACK_KEYS"))
ok({"id", "coord", "objectType", "confidence", "stationary", "zones", "loiterZones", "lines"} <= set(keys), "a track in a message keeps its fields")

print(f"{fails} FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
