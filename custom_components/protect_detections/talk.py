"""Talk through a camera's speaker from the browser's microphone.

The card records the microphone (MediaRecorder: Opus in WebM, or AAC in MP4
on Safari) and sends the chunks over a websocket to TalkView. They are piped
into ffmpeg, which re-encodes them the way the camera wants and sends them
to the address Protect hands out for a talkback session.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any

from aiohttp import WSMsgType, web

from homeassistant.components.http import HomeAssistantView

_LOGGER = logging.getLogger(__name__)

DOMAIN = "protect_detections"
INPUT_FORMATS = {"webm": "webm", "mp4": "mp4"}
# what the camera expects -> ffmpeg encoder and container
CODECS = {"opus": ("libopus", "rtp"), "aac": ("aac", "adts"), "vorbis": ("libvorbis", "ogg")}
MAX_TALK_S = 300  # a talk session ends by itself after this long


def speakers(hub) -> dict[str, str]:
    """HA camera entity -> Protect camera id, for cameras that have a speaker."""
    out: dict[str, str] = {}
    api = hub.api
    if api is None:
        return out
    for cam in api.bootstrap.cameras.values():
        if not cam.feature_flags.has_speaker:
            continue
        known = hub.cameras.get(cam.id) or {}
        for key in ("entity", "tap_entity"):
            if known.get(key):
                out[known[key]] = cam.id
    return out


def ffmpeg_args(fmt: str, codec: str, rate: int, url: str) -> list[str]:
    encoder, container = CODECS[codec]
    args = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-fflags", "nobuffer", "-flags", "low_delay", "-probesize", "4096", "-analyzeduration", "0",
        "-f", fmt, "-i", "pipe:0",
        "-vn", "-ac", "1", "-ar", str(rate), "-c:a", encoder,
    ]
    if encoder == "libopus":
        args += ["-application", "lowdelay", "-frame_duration", "20", "-b:a", "32k"]
    return [*args, "-flush_packets", "1", "-f", container, url]


class TalkView(HomeAssistantView):
    """Websocket: binary messages are microphone audio for one camera."""

    url = "/api/protect_detections/talk/{camera_id}"
    name = "api:protect_detections:talk"
    requires_auth = True

    def __init__(self) -> None:
        self._busy: set[str] = set()
        self._procs: set[asyncio.subprocess.Process] = set()

    def stop_all(self) -> None:
        """End every talk session (the integration is being unloaded)."""
        for proc in list(self._procs):
            if proc.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()

    async def get(self, request: web.Request, camera_id: str) -> web.StreamResponse:
        hub = request.app["hass"].data.get(DOMAIN)
        fmt = INPUT_FORMATS.get(request.query.get("fmt", "webm"))
        if hub is None or hub.api is None or fmt is None or camera_id not in speakers(hub).values():
            return web.Response(status=404)
        ws = web.WebSocketResponse(heartbeat=20)
        await ws.prepare(request)

        async def fail(text: str) -> web.StreamResponse:
            await ws.send_json({"error": text})
            await ws.close()
            return ws

        if camera_id in self._busy:
            return await fail("Someone is already talking through this camera")
        self._busy.add(camera_id)
        proc = None
        errors = None  # reads ffmpeg's messages as they come, so its pipe never fills up
        try:
            try:
                session = await hub.api.create_talkback_session_public(camera_id)
            except Exception as err:
                _LOGGER.warning("Talkback session for %s failed: %s", camera_id, err)
                return await fail(f"Protect refused the talkback session: {err}")
            if session.codec not in CODECS or not session.url:
                return await fail(f"Unsupported speaker codec: {session.codec}")
            _LOGGER.debug(
                "Talkback for %s: %s at %s Hz, sent as %s", camera_id, session.codec, session.sampling_rate, fmt
            )
            try:
                proc = await asyncio.create_subprocess_exec(
                    *ffmpeg_args(fmt, session.codec, session.sampling_rate, session.url),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
            except OSError as err:
                _LOGGER.warning("Couldn't start the talkback encoder (ffmpeg): %s", err)
                return await fail("The audio encoder couldn't be started")
            self._procs.add(proc)
            errors = asyncio.create_task(proc.stderr.read())
            await ws.send_json({"ready": True})
            try:
                async with asyncio.timeout(MAX_TALK_S):
                    async for msg in ws:
                        if msg.type != WSMsgType.BINARY:
                            if msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                                break
                            continue
                        if proc.returncode is not None:  # why is logged below
                            return await fail("The audio encoder stopped")
                        proc.stdin.write(msg.data)
                        await proc.stdin.drain()
            except TimeoutError:
                return await fail(f"Talking stops after {MAX_TALK_S // 60} minutes; start again to continue")
        except ConnectionError as err:
            # the browser went away, or ffmpeg did (its pipe broke)
            _LOGGER.debug("Talkback for %s ended: %r", camera_id, err)
        finally:
            self._busy.discard(camera_id)
            if proc is not None:
                self._procs.discard(proc)
                if proc.returncode is None:
                    with contextlib.suppress(Exception):
                        proc.stdin.close()
                    try:
                        await asyncio.wait_for(proc.wait(), 1.5)
                    except (TimeoutError, asyncio.TimeoutError):
                        with contextlib.suppress(ProcessLookupError):
                            proc.kill()
                await self._log_encoder(camera_id, proc, errors)
        return ws

    @staticmethod
    async def _log_encoder(camera_id: str, proc: asyncio.subprocess.Process, errors: asyncio.Task | None) -> None:
        """Whatever way a talk session ended, say what ffmpeg had to say."""
        said = ""
        if errors is not None:
            try:
                said = (await asyncio.wait_for(errors, 2)).decode(errors="replace").strip()[-600:]
            except Exception:  # noqa: BLE001 - timed out (wait_for cancels it) or unreadable
                errors.cancel()
        code = proc.returncode
        if said or (code is not None and code > 0):
            _LOGGER.warning("Talkback encoder for %s (exit code %s) said: %s", camera_id, code, said or "nothing")
        else:
            _LOGGER.debug("Talkback encoder for %s ended (exit code %s)", camera_id, code)
