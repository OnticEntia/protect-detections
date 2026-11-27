"""Tests for the live picture relay (video.py), run with plain Python:

    python tests/test_video.py

The console is stood in for by made-up MP4 boxes: no camera, no console and
no picture are involved.
"""

import asyncio
import importlib.util
from pathlib import Path
import struct
import sys

base = Path(__file__).parent.parent / "custom_components" / "protect_detections"
spec = importlib.util.spec_from_file_location("pd_video", base / "video.py")
video = importlib.util.module_from_spec(spec)
sys.modules["pd_video"] = video
spec.loader.exec_module(video)
fails = 0


def ok(cond, what):
    global fails
    if not cond:
        fails += 1
    print("PASS" if cond else "FAIL", what)


def refused(*args):
    try:
        video.stream_query(*args)
    except video.BadRequest as err:
        return str(err)
    return None


# --- what the console is asked
q = video.stream_query("abc123", 1)
parts = dict(p.split("=", 1) if "=" in p else (p, None) for p in q.split("&"))
ok(parts["camera"] == "abc123" and parts["channel"] == "1" and parts["type"] == "fmp4", "the camera, the channel, fragmented MP4")
ok(parts["useWallClock"] == "true" and parts["rebaseTimestampsToZero"] == "false", "the camera's wall clock is asked for, not times from zero")
ok(parts["fragmentDurationMillis"] == "100" and parts["chunkSize"] == "1024", "pieces as Protect's own page asks for them")
ok(all(parts.get(f, 0) is None for f in ("allowPartialGOP", "extendedVideoMetadata", "progressive")), "its three flags, with no value")
ok(len(parts["sessionId"]) == 36 and parts["requestId"].isalnum(), "a session and request id are made up")
ok(video.stream_query("abc123", 1) != q, "afresh each time (nobody's is reused)")
q2 = video.stream_query("abc123", 0, {"fragmentDurationMillis": 250, "flags": ["progressive"], "useWallClock": False})
ok("channel=0" in q2 and "fragmentDurationMillis=250" in q2 and "extendedVideoMetadata" not in q2 and "useWallClock=false" in q2, "the few things that may be asked otherwise")
ok(refused("abc123", 3) and refused("abc123", "1") and refused("abc/../x", 1) and refused("a&b=c", 1) and refused("", 1), "no other channel, and nothing but a plain id for the camera")
ok(refused("abc123", 1, {"chunkSize": 10}) and refused("abc123", 1, {"fragmentDurationMillis": 99999}) and refused("abc123", 1, {"chunkSize": True}), "sizes within limits")
ok(refused("abc123", 1, {"flags": ["x&y=1"]}) and refused("abc123", 1, {"sessionId": "someone-else"}) and refused("abc123", 1, {"useWallClock": "true&x=1"}), "nothing else can be put into the query")


# --- passing it on
async def feed(items, wait=0):
    for item in items:
        if wait:
            await asyncio.sleep(wait)
        yield item


def run_relay(items, slow=0.0, timeout=5.0, breaks=None):
    got = []

    async def send_bytes(data):
        if slow:
            await asyncio.sleep(slow)
        if breaks is not None and len(got) >= breaks:
            raise ConnectionResetError
        got.append(data)

    async def send_text(text):
        got.append(text)

    return asyncio.run(video.relay(feed(items), send_bytes, send_text, timeout)), got


pieces = [("bytes", bytes([i]) * 1024) for i in range(20)]
result, got = run_relay(pieces[:3] + [("text", "{}"), ("ping", b"")] + pieces[3:])
ok(got == [p[1] for p in pieces[:3]] + ["{}"] + [p[1] for p in pieces[3:]], "every piece is passed on as it is, in order (text too; anything else is left)")
ok(result == {"pieces": 21, "bytes": 20 * 1024, "why": "ended"}, "and counted; it ends when the console's socket does")
result, got = run_relay(pieces, slow=0.05, timeout=0.01)
ok(result["why"] == "slow" and got == [], "a browser that cannot take a piece in time is let go, nothing piled up for it")
result, got = run_relay(pieces, breaks=4)
ok(result["why"] == "gone" and len(got) == 4, "a browser that has gone ends it")

# --- how many at once
v = video.Viewers(limit=3)
ok(v.enter("a") and v.enter("a") and v.enter("b") and not v.enter("c") and v.count == 3, "no more viewers than the limit, all cameras together")
v.leave("a")
ok(v.enter("c") and v.now == {"a": 1, "b": 1, "c": 1}, "one leaving makes room")
v.leave("a"); v.leave("b"); v.leave("c"); v.leave("c")
ok(v.count == 0 and v.now == {}, "and nothing is left counted")


# --- what the stream is made of
def box(kind, body=b""):
    return struct.pack(">I4s", 8 + len(body), kind) + body


def full(kind, version, flags, body):
    return box(kind, bytes([version]) + flags.to_bytes(3, "big") + body)


def entry(kind, conf_kind, conf):
    return box(kind, bytes(24) + struct.pack(">HH", 1280, 720) + bytes(50) + box(conf_kind, conf))


def moov(kind=b"avc1", conf_kind=b"avcC", conf=bytes([1, 0x64, 0x00, 0x28, 0xFF]), timescale=90000):
    stsd = full(b"stsd", 0, 0, struct.pack(">I", 1) + entry(kind, conf_kind, conf))
    mdhd = full(b"mdhd", 0, 0, struct.pack(">IIII", 0, 0, timescale, 0))
    hdlr = full(b"hdlr", 0, 0, bytes(4) + b"vide" + bytes(12))
    tkhd = full(b"tkhd", 0, 0, struct.pack(">III", 0, 0, 1) + bytes(8))
    return box(b"moov", box(b"mvhd", bytes(100)) + box(b"trak", tkhd + box(b"mdia", mdhd + hdlr + box(b"minf", box(b"stbl", stsd)))))


def moof(seq, time, samples=3, dur=3000, key=True, version=1):
    tfdt = full(b"tfdt", version, 0, struct.pack(">Q" if version else ">I", time))
    rows = b"".join(struct.pack(">II", dur, 500) for _ in range(samples))
    trun = full(b"trun", 0, 0x000305, struct.pack(">IiI", samples, 0, 0x02000000 if key else 0x01010000) + rows)
    return box(b"moof", full(b"mfhd", 0, 0, struct.pack(">I", seq)) + box(b"traf", full(b"tfhd", 0, 0x020000, struct.pack(">I", 1)) + tfdt + trun))


WALL = 1_760_000_000_000  # (a wall clock in ms, as a made-up example)
stream = box(b"ftyp", b"isom" + bytes(4)) + moov()
picture = bytes(range(256)) * 20
for i in range(4):
    stream += moof(i + 1, (WALL + i * 100) * 90, key=i == 0) + box(b"mdat", picture)
stream += box(b"prft", bytes(20)) + box(b"zzzz", b"\x01\x02\x03")

w = video.Mp4Walk()
for at in range(0, len(stream), 1024):
    w.feed(stream[at : at + 1024], arrived=at)
kinds = [e["box"] for e in w.events]
ok(w.broken is None and kinds == ["ftyp", "moov"] + ["moof", "mdat"] * 4 + ["prft", "zzzz"], "the boxes are read as they go by, whatever the pieces they come in")
m = w.events[1]["tracks"][1]
ok(m == {"timescale": 90000, "kind": "vide", "entry": "avc1", "width": 1280, "height": 720, "codec": "avc1.640028"}, "the track: its clock's rate, its size and its codec as a browser wants it")
f = w.events[2]["frags"][0]
ok(w.events[2]["sequence"] == 1 and f["time"] == WALL * 90 and f["timescale"] == 90000 and f["time"] / f["timescale"] * 1000 == WALL, "a fragment's time, and the rate to read it by")
ok(f["samples"] == 3 and f["duration"] == 9000 and f["keyframe"] is True and w.events[4]["frags"][0]["keyframe"] is False, "its frames, how long they last, and whether it starts on a keyframe")
ok(w.picture_bytes == 4 * len(picture) and w.buf == b"" and w.skip == 0, "the picture is counted and let go")
ok(not any(picture[:16].hex() in str(e) for e in w.events), "none of it is in what is noted")
ok(w.events[-1] == {"box": "zzzz", "size": 11, "arrived": w.events[-1]["arrived"], "starts": "010203"}, "a box not known here is shown by its start (it may be Protect's own)")
w = video.Mp4Walk()
w.feed(box(b"ftyp", b"isom" + bytes(4)) + moov(b"hvc1", b"hvcC", bytes([1, 0x01, 0x60, 0, 0, 0, 0x90, 0, 0, 0, 0, 0, 150])) + moof(1, 5000, version=0))
ok(w.events[1]["tracks"][1]["codec"] == "hvc1.1.6.L150.90" and w.events[2]["frags"][0]["time"] == 5000, "H.265 is named as a browser wants it; a short time is read too")
w = video.Mp4Walk()
w.feed(b"\x01\x02\x00\x00\x00\x10\x00\x01\x00\x00\x00\x00" + stream)
ok(w.broken and "not a box at byte 0" in w.broken and w.events == [] and w.buf == b"", "something that is not MP4 boxes (a wrapping of Protect's): said, with its first bytes, and nothing guessed")
w.feed(stream)
ok(w.events == [], "(and no more is read after that)")
w = video.Mp4Walk()
w.feed(b"\x01\x00\x00\x10junk" + stream)
ok(w.broken and "junk box of" in w.broken and w.events == [], "nor is an impossible size waited for")
w = video.Mp4Walk(limit=5)
w.feed(stream)
ok(len(w.events) == 5, "what is noted has a limit")


# --- the probe
async def probed(items, seconds=5, wait=0):
    return await video.probe(feed(items, wait), seconds)

chunks = [("bytes", stream[at : at + 1024]) for at in range(0, len(stream), 1024)]
r = asyncio.run(probed([("text", '{"hello":1}')] + chunks))
ok(r["ended"] == "closed" and r["messages"] == len(chunks) + 1 and r["bytes"] == len(stream) and r["texts"] == ['{"hello":1}'], "the probe counts what came, text apart")
ok(r["broken"] is None and [e["box"] for e in r["events"]][:3] == ["ftyp", "moov", "moof"] and r["picture_bytes"] == 4 * len(picture), "and says what it was made of")
ok(all(len(m["head"]) <= 16 for m in r["first_messages"]) and r["first_messages"][0]["head"] == stream[:8].hex() and len(r["first_messages"]) == len(chunks), "of each first message only its size and first 8 bytes (where a box's size and kind are)")
ok(isinstance(r["events"][2]["arrived"], int) and r["events"][2]["arrived"] > 1_600_000_000_000, "with this machine's clock at each fragment (to set against the fragment's own)")
r = asyncio.run(probed(chunks * 50, seconds=0.05, wait=0.01))
ok(r["ended"] == "time" and 0 < r["messages"] < len(chunks) * 50, "it stops after the time it was given")

# --- nothing is written anywhere
src = (base / "video.py").read_text()
ok(not any(word in src for word in ("open(", "tempfile", "write_bytes", "write_text", ".write(", "Store(", "executor")), "the module writes nothing to disk and keeps nothing")
init = (base / "__init__.py").read_text()
at = init.index("async def ws_video_probe")
ok("@websocket_api.require_admin" in init[at - 200 : at] and "register_view(VideoView())" in init and "async_register_command(hass, ws_video_probe)" in init, "the probe is for administrators; the view and the probe are registered")
ok(video.HomeAssistantView is None and not hasattr(video, "VideoView"), "(read here without Home Assistant)")

print(f"{fails} FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
