"""A camera's live picture the way Protect's own web page gets it.

Protect's web page does not play the RTSP feed: it opens a websocket per
camera (ws/livestream) that sends fragmented MP4, with (as it asks for it)
the camera's wall clock as the time of each frame. Boxes (live.py) carry the
same clock, so a picture played from this can have its boxes put on the
very frame they belong to, with nothing measured or guessed.

This passes that websocket on to a card that asks for it (VideoView), and
can describe what comes down it without keeping it (probe(), for finding
out how it is made). Opt-in: the cards play Home Assistant's own stream
unless told otherwise.

- The socket is opened with the UniFi Protect integration's own login, as
  the box relay's is: nothing is logged in separately, no credentials are
  handled here, and nothing is written to Protect.
- The picture goes from the console to the browser through memory only. It
  is never written to disk and nothing of it is kept once sent.
- One socket to the console per viewer (each starts at a keyframe of its
  own), and a limit on how many at once.
- Not part of Protect's documented interface: an update could change or
  remove it, and the cards then play Home Assistant's stream as before.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator, Awaitable, Callable
import logging
import struct
import time
from typing import Any
from urllib.parse import quote
import uuid

_LOGGER = logging.getLogger(__name__)

DOMAIN = "protect_detections"
VIDEO_PATH = "/proxy/protect/ws/livestream"
MAX_VIEWERS = 6  # sockets to the console at once, all cameras together
SEND_TIMEOUT = 5.0  # a browser that cannot take a piece for this long is let go
MAX_PROBE_S = 15
CHANNELS = (0, 1, 2)

# What Protect's web page asks for, and what may be asked otherwise.
FLAGS = ("allowPartialGOP", "extendedVideoMetadata", "progressive")
DEFAULT_FLAGS = FLAGS
RANGES = {"chunkSize": (256, 65536, 1024), "fragmentDurationMillis": (50, 2000, 100)}
BOOLS = {"rebaseTimestampsToZero": False, "useWallClock": True}


class BadRequest(ValueError):
    """What was asked for is not something this passes on."""


def stream_query(camera_id: str, channel: int = 1, options: dict[str, Any] | None = None) -> str:
    """The query Protect's web page sends, for this camera and channel.
    `options` may change the few things in FLAGS, RANGES and BOOLS, within
    their limits; anything else is refused. The request and session ids are
    made up afresh each time."""
    options = dict(options or {})
    if not isinstance(camera_id, str) or not camera_id.isalnum():
        raise BadRequest("not a camera id")
    if channel not in CHANNELS:
        raise BadRequest("no such channel")
    parts: list[tuple[str, str | None]] = []
    flags = options.pop("flags", DEFAULT_FLAGS)
    if not isinstance(flags, (list, tuple)) or any(f not in FLAGS for f in flags):
        raise BadRequest("unknown flag")
    for flag in flags:
        parts.append((flag, None))
    parts += [("camera", camera_id), ("channel", str(channel))]
    for key, (low, high, default) in RANGES.items():
        value = options.pop(key, default)
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            raise BadRequest(f"{key} out of range")
        parts.append((key, str(value)))
    for key, default in BOOLS.items():
        value = options.pop(key, default)
        if not isinstance(value, bool):
            raise BadRequest(f"{key} is yes or no")
        parts.append((key, "true" if value else "false"))
    if options:
        raise BadRequest("unknown option")
    parts += [("requestId", uuid.uuid4().hex[:12]), ("sessionId", str(uuid.uuid4())), ("type", "fmp4")]
    return "&".join(k if v is None else f"{k}={quote(v, safe='')}" for k, v in sorted(parts))


# --------------------------------------------------------------- the relay


async def relay(
    source: AsyncIterator[tuple[str, Any]],
    send_bytes: Callable[[bytes], Awaitable[None]],
    send_text: Callable[[str], Awaitable[None]],
    timeout: float = SEND_TIMEOUT,
) -> dict[str, Any]:
    """Pass what the console sends on to one browser, piece by piece, as it
    is, in order. Nothing is held but the piece in hand. A browser that
    cannot keep up is let go (pieces cannot be left out of a picture, and
    are not piled up here). Returns the count, and why it ended."""
    pieces = size = 0
    why = "ended"
    try:
        async for kind, data in source:
            try:
                async with asyncio.timeout(timeout):
                    if kind == "bytes":
                        await send_bytes(data)
                        size += len(data)
                    elif kind == "text":
                        await send_text(data)
                    else:
                        continue
            except TimeoutError:
                why = "slow"
                break
            pieces += 1
    except ConnectionError:
        why = "gone"
    return {"pieces": pieces, "bytes": size, "why": why}


async def console_stream(api: Any, camera_id: str, channel: int, options: dict[str, Any] | None = None) -> AsyncIterator[tuple[str, Any]]:
    """The console's messages for a camera's picture: ("bytes" | "text", data),
    until the socket closes. Opened with the UniFi Protect integration's login."""
    from aiohttp import WSMsgType  # noqa: PLC0415
    from yarl import URL  # noqa: PLC0415

    query = stream_query(camera_id, channel, options)
    base = getattr(api, "_ws_url", None)  # noqa: SLF001
    base = URL(str(base)) if base else URL(api.base_url.replace("https://", "wss://", 1))
    url = URL(str(base.with_path(VIDEO_PATH)) + "?" + query, encoded=True)
    verify = bool(getattr(api, "_verify_ssl", True))  # noqa: SLF001
    await api.ensure_authenticated()
    session = await api.get_session()
    async with session.ws_connect(url, headers=api.headers or {}, ssl=verify, heartbeat=30, max_msg_size=8 * 1024 * 1024) as ws:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                yield "bytes", msg.data
            elif msg.type == WSMsgType.TEXT:
                yield "text", msg.data
            elif msg.type in (WSMsgType.CLOSED, WSMsgType.ERROR):
                break


class Viewers:
    """How many are watching through here, and no more than the limit."""

    def __init__(self, limit: int = MAX_VIEWERS) -> None:
        self.limit = limit
        self.now: dict[str, int] = {}

    @property
    def count(self) -> int:
        return sum(self.now.values())

    def enter(self, camera_id: str) -> bool:
        if self.count >= self.limit:
            return False
        self.now[camera_id] = self.now.get(camera_id, 0) + 1
        return True

    def leave(self, camera_id: str) -> None:
        left = self.now.get(camera_id, 0) - 1
        if left > 0:
            self.now[camera_id] = left
        else:
            self.now.pop(camera_id, None)


# ------------------------------------------------- what the stream is made of
#
# Reads the MP4 boxes as they go by and notes what they say (kinds, sizes,
# clocks, codecs). The picture itself (mdat) is counted and let go: no part
# of it is kept.

CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"mvex", b"moof", b"traf", b"edts"}
MAX_HEAD = 1 << 20  # a box other than the picture is not expected to be bigger


def _hevc_codec(c: bytes) -> str:
    """The codec string of an hvcC box's contents (as browsers want it)."""
    space = ("", "A", "B", "C")[c[1] >> 6]
    tier = "H" if c[1] & 0x20 else "L"
    profile = c[1] & 0x1F
    compat = int(f"{struct.unpack('>I', c[2:6])[0]:032b}"[::-1], 2)
    constraint = c[6:12].rstrip(b"\x00")
    out = f"{space}{profile}.{compat:X}.{tier}{c[12]}"
    return out + "".join(f".{b:X}" for b in constraint)


class Mp4Walk:
    """Feed it the stream; `events` fills with what each box says."""

    def __init__(self, limit: int = 400) -> None:
        self.events: list[dict[str, Any]] = []
        self.limit = limit
        self.buf = b""
        self.skip = 0  # bytes of picture still to let go by
        self.offset = 0
        self.broken: str | None = None
        self.timescales: dict[int, int] = {}
        self.picture_bytes = 0
        self._track = 0

    def note(self, **event: Any) -> None:
        if len(self.events) < self.limit:
            self.events.append(event)

    def feed(self, data: bytes, arrived: int | None = None) -> None:
        if self.broken:
            return
        if self.skip:
            gone = min(self.skip, len(data))
            self.skip -= gone
            self.offset += gone
            data = data[gone:]
        if not data:
            return
        self.buf += data
        while len(self.buf) >= 8 and not self.broken:
            size, kind = struct.unpack(">I4s", self.buf[:8])
            head = 8
            if size == 1:
                if len(self.buf) < 16:
                    return
                size = struct.unpack(">Q", self.buf[8:16])[0]
                head = 16
            if size < head or not all(32 <= b < 127 for b in kind):
                self.broken = f"not a box at byte {self.offset}: {self.buf[:16].hex()}"
                self.buf = b""
                return
            name = kind.decode()
            if kind == b"mdat":
                self.note(box=name, size=size, arrived=arrived)
                self.picture_bytes += size - head
                have = len(self.buf) - head
                rest = size - head
                self.offset += head + min(have, rest)
                if have >= rest:
                    self.buf = self.buf[head + rest :]
                else:
                    self.skip = rest - have
                    self.buf = b""
                continue
            if size > MAX_HEAD:
                self.broken = f"a {name} box of {size} bytes at byte {self.offset}"
                self.buf = b""
                return
            if len(self.buf) < size:
                return
            body = self.buf[head:size]
            self.buf = self.buf[size:]
            self.offset += size
            try:
                self._top(name, kind, body, size, arrived)
            except (struct.error, IndexError) as err:
                self.note(box=name, size=size, unread=repr(err))

    def _top(self, name: str, kind: bytes, body: bytes, size: int, arrived: int | None) -> None:
        if kind in (b"moov", b"moof"):
            event: dict[str, Any] = {"box": name, "size": size, "arrived": arrived}
            self._inside(body, event)
            self.note(**event)
        elif kind in (b"ftyp", b"styp"):
            self.note(box=name, size=size, brand=body[:4].decode(errors="replace"))
        else:
            # something of Protect's own, or not yet known here: its start is shown
            self.note(box=name, size=size, arrived=arrived, starts=body[:64].hex())

    def _inside(self, data: bytes, event: dict[str, Any]) -> None:
        at = 0
        while at + 8 <= len(data):
            size, kind = struct.unpack(">I4s", data[at : at + 8])
            if size < 8 or at + size > len(data):
                return
            body = data[at + 8 : at + size]
            at += size
            if kind in CONTAINERS:
                self._inside(body, event)
            elif kind == b"tkhd":
                self._track = struct.unpack(">I", body[20:24] if body[0] else body[12:16])[0]
            elif kind == b"mdhd":
                scale = struct.unpack(">I", body[20:24] if body[0] else body[12:16])[0]
                self.timescales[self._track] = scale
                event.setdefault("tracks", {}).setdefault(self._track, {})["timescale"] = scale
            elif kind == b"hdlr":
                event.setdefault("tracks", {}).setdefault(self._track, {})["kind"] = body[8:12].decode(errors="replace")
            elif kind == b"stsd":
                self._entry(body[8:], event.setdefault("tracks", {}).setdefault(self._track, {}))
            elif kind == b"mfhd":
                event["sequence"] = struct.unpack(">I", body[4:8])[0]
            elif kind == b"tfhd":
                self._track = struct.unpack(">I", body[4:8])[0]
                event.setdefault("frags", []).append({"track": self._track, "tfhd_flags": int.from_bytes(body[1:4], "big")})
            elif kind == b"tfdt":
                base = struct.unpack(">Q", body[4:12])[0] if body[0] else struct.unpack(">I", body[4:8])[0]
                frag = event["frags"][-1] if event.get("frags") else event.setdefault("frags", [{}])[-1]
                frag["time"] = base
                frag["timescale"] = self.timescales.get(self._track)
            elif kind == b"trun":
                self._trun(body, event["frags"][-1] if event.get("frags") else event.setdefault("frags", [{}])[-1])
            elif kind not in (b"mvhd", b"vmhd", b"smhd", b"dinf", b"stts", b"stsc", b"stsz", b"stco", b"trex", b"mehd", b"elst"):
                event.setdefault("other", []).append({"box": kind.decode(errors="replace"), "size": size, "starts": body[:48].hex()})

    @staticmethod
    def _entry(data: bytes, track: dict[str, Any]) -> None:
        """The first sample entry of a track: what it is coded as."""
        if len(data) < 16:
            return
        size, kind = struct.unpack(">I4s", data[:8])
        name = kind.decode(errors="replace")
        track["entry"] = name
        body = data[8:size]
        if kind in (b"avc1", b"avc3", b"hvc1", b"hev1"):
            track["width"], track["height"] = struct.unpack(">HH", body[24:28])
            at = 78
            while at + 8 <= len(body):
                bsize, bkind = struct.unpack(">I4s", body[at : at + 8])
                if bsize < 8:
                    break
                conf = body[at + 8 : at + bsize]
                if bkind == b"avcC":
                    track["codec"] = f"{name}.{conf[1]:02x}{conf[2]:02x}{conf[3]:02x}"
                elif bkind == b"hvcC":
                    track["codec"] = f"{name}.{_hevc_codec(conf)}"
                at += bsize
        elif kind == b"mp4a":
            track["rate"] = struct.unpack(">H", body[24:26])[0]
            track["codec"] = "mp4a.40.2"  # (AAC-LC taken as read; the probe says the entry's name too)
        elif kind == b"Opus":
            track["rate"] = struct.unpack(">H", body[24:26])[0]
            track["codec"] = "opus"

    @staticmethod
    def _trun(body: bytes, frag: dict[str, Any]) -> None:
        flags = int.from_bytes(body[1:4], "big")
        count = struct.unpack(">I", body[4:8])[0]
        at = 8
        if flags & 0x1:
            at += 4
        if flags & 0x4:
            frag["first_flags"] = struct.unpack(">I", body[at : at + 4])[0]
            at += 4
        per = [bool(flags & bit) for bit in (0x100, 0x200, 0x400, 0x800)]
        step = 4 * sum(per)
        durations = 0
        first = None
        for i in range(count):
            row = body[at + i * step : at + (i + 1) * step]
            col = 0
            if per[0]:
                durations += struct.unpack(">I", row[col : col + 4])[0]
                col += 4
            if per[1]:
                col += 4
            if per[2] and i == 0:
                first = struct.unpack(">I", row[col : col + 4])[0]
        frag["samples"] = frag.get("samples", 0) + count
        frag["duration"] = frag.get("duration", 0) + durations
        frag["trun_flags"] = flags
        if first is not None:
            frag["first_flags"] = first
        if "first_flags" in frag:
            # (bit 16 of a sample's flags: it depends on others, so is no keyframe)
            frag["keyframe"] = not frag["first_flags"] & 0x10000


async def probe(source: AsyncIterator[tuple[str, Any]], seconds: float, clock: Callable[[], float] = time.time) -> dict[str, Any]:
    """Watch a camera's stream for a little while and say what it is made
    of. Nothing of the picture is kept or returned: sizes, box kinds, clocks
    and codecs only (and the first 8 bytes of the first messages, which is
    where a box's size and kind are)."""
    walk = Mp4Walk()
    first: list[dict[str, Any]] = []
    texts: list[str] = []
    count = size = 0
    begun = clock()
    ended = "time"
    try:
        async with asyncio.timeout(seconds):
            async for kind, data in source:
                now = int(clock() * 1000)
                count += 1
                if kind == "text":
                    if len(texts) < 10:
                        texts.append(str(data)[:500])
                    continue
                size += len(data)
                if len(first) < 40:
                    first.append({"at": now - int(begun * 1000), "size": len(data), "head": bytes(data[:8]).hex()})
                walk.feed(bytes(data), now)
            ended = "closed"
    except TimeoutError:
        pass
    took = max(clock() - begun, 0.001)
    return {
        "seconds": round(took, 2),
        "ended": ended,
        "messages": count,
        "bytes": size,
        "kbps": round(size * 8 / took / 1000),
        "picture_bytes": walk.picture_bytes,
        "first_messages": first,
        "texts": texts,
        "broken": walk.broken,
        "events": walk.events,
    }


# ------------------------------------------------------------- the web view

try:
    from aiohttp import web
    from homeassistant.components.http import HomeAssistantView
except ImportError:  # (read on its own, as the tests do)
    HomeAssistantView = None  # type: ignore[assignment,misc]

if HomeAssistantView is not None:

    class VideoView(HomeAssistantView):
        """Websocket: a camera's picture as the console sends it (binary),
        after one line of JSON saying it has begun or why it has not."""

        url = "/api/protect_detections/video/{camera_id}"
        name = "api:protect_detections:video"
        requires_auth = True

        def __init__(self) -> None:
            self.viewers = Viewers()

        async def get(self, request: web.Request, camera_id: str) -> web.StreamResponse:
            hub = request.app["hass"].data.get(DOMAIN)
            if hub is None or hub.api is None or camera_id not in hub.cameras or not hub._in_protect(camera_id):  # noqa: SLF001
                return web.Response(status=404)
            try:
                channel = int(request.query.get("channel", "1"))
                options = {k: int(request.query[k]) for k in RANGES if k in request.query}
                stream_query(camera_id, channel, dict(options))
            except (ValueError, BadRequest):
                return web.Response(status=400)
            ws = web.WebSocketResponse(heartbeat=20)
            await ws.prepare(request)
            if not self.viewers.enter(camera_id):
                await ws.send_json({"error": "Too many live pictures are open through Home Assistant already"})
                await ws.close()
                return ws
            source = console_stream(hub.api, camera_id, channel, options)

            async def listen() -> None:
                # (nothing is expected from the browser; reading is what notices it has gone)
                async for _ in ws:
                    pass

            gone = asyncio.create_task(listen())
            pump = asyncio.create_task(relay(source, ws.send_bytes, ws.send_str))
            try:
                await ws.send_json({"ready": True, "channel": channel})
                await asyncio.wait({gone, pump}, return_when=asyncio.FIRST_COMPLETED)
                if pump.done() and not ws.closed:
                    result = pump.result()  # (raises what the console's socket raised)
                    _LOGGER.debug("Live picture of %s ended: %s", camera_id, result)
                    if result["why"] == "slow":
                        await ws.send_json({"error": "This device could not keep up with the picture"})
            except ConnectionError:
                pass
            except Exception as err:  # noqa: BLE001 (said to the card, which goes back to the usual stream)
                _LOGGER.debug("Live picture of %s failed: %r", camera_id, err)
                if not ws.closed:
                    with contextlib.suppress(ConnectionError):
                        await ws.send_json({"error": f"{type(err).__name__}: {err}"[:200]})
            finally:
                self.viewers.leave(camera_id)
                for task in (gone, pump):
                    task.cancel()
                await asyncio.gather(gone, pump, return_exceptions=True)
                await source.aclose()
                if not ws.closed:
                    await ws.close()
            return ws
