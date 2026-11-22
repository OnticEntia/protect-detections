"""Recorded clips of detections, exported from Protect for playback.

Protect's /video/export returns the recording between two times as MP4. It
ends exactly at the requested end and starts at the keyframe before the
requested start, so the clip's real first frame is `end - duration`
(measured). Channel 0 is the full recording (4K HEVC on a 4K camera);
channels 1 and 2 are 640x360. Browsers that can't play HEVC get
the 360p recording converted to H.264; quality="low" asks for the 360p
recording (kept as HEVC where the browser can play it) to save bandwidth.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
import json
import logging
from pathlib import Path
import re
import shutil
import tempfile
from typing import Any

_LOGGER = logging.getLogger(__name__)

CLIP_DIR = Path(tempfile.gettempdir()) / "protect_detections"
MAX_CLIPS = 24
MAX_BYTES = 600 * 1024 * 1024
LEAD_S = 4  # seconds of recording before the detection
TAIL_S = 3  # and after it
MAX_S = 90  # longest clip
# An export holds the whole recording in memory and may convert it, so only
# this many run at once; the rest wait their turn.
MAX_EXPORTS = 2


async def _run(*args: str, timeout: float = 120) -> bytes:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except BaseException:  # timed out or cancelled: don't leave it running
        if proc.returncode is None:
            proc.kill()
        raise
    if proc.returncode:
        raise RuntimeError(f"{args[0]} failed: {err.decode(errors='replace')[-300:]}")
    return out


async def probe(path: Path) -> tuple[float, str]:
    """(duration in seconds, video codec name)."""
    out = await _run(
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "format=duration:stream=codec_name", "-of", "json", str(path),
        timeout=30,
    )
    info = json.loads(out)
    codec = (info.get("streams") or [{}])[0].get("codec_name", "")
    return float(info["format"]["duration"]), codec


class ClipStore:
    def __init__(self) -> None:
        self._clips: OrderedDict[str, dict[str, Any]] = OrderedDict()
        # exports under way, so two requests for the same clip share one
        self._exports: dict[str, asyncio.Task] = {}
        self._slots = asyncio.Semaphore(MAX_EXPORTS)
        self._ready = False

    @staticmethod
    def _reset_dir() -> None:
        shutil.rmtree(CLIP_DIR, ignore_errors=True)
        CLIP_DIR.mkdir(parents=True, exist_ok=True)

    async def close(self) -> None:
        """Stop exports under way and delete the clips."""
        for task in list(self._exports.values()):
            task.cancel()
        await asyncio.gather(*self._exports.values(), return_exceptions=True)
        self._clips.clear()
        await asyncio.to_thread(shutil.rmtree, CLIP_DIR, True)
        self._ready = False

    def path(self, name: str) -> Path | None:
        for info in self._clips.values():
            if info["path"].name == name and info["path"].exists():
                return info["path"]
        return None

    async def get(self, api, event: dict[str, Any], hevc_ok: bool, quality: str = "high") -> dict[str, Any]:
        """Export (once) and return {"file", "start_ms", "end_ms", "duration", "codec"}."""
        # high: the full recording (4K HEVC), for browsers that decode HEVC.
        # low: the 640x360 recording, e.g. for viewing over the internet.
        channel = 0 if hevc_ok and quality == "high" else 1
        # also the file name: the whole event id, so two events never share a file
        key = f"{re.sub(r'[^A-Za-z0-9-]', '', str(event['id']))}-c{channel}-{'h' if hevc_ok else 'a'}"
        hit = self._clips.get(key)
        if hit and hit["path"].exists():
            self._clips.move_to_end(key)
            return self._public(hit)
        task = self._exports.get(key)
        if task is None:
            task = self._exports[key] = asyncio.create_task(self._export(api, event, key, channel, hevc_ok))
            task.add_done_callback(lambda _t: self._exports.pop(key, None))
        # shielded: one viewer going away doesn't cancel it for another
        return self._public(await asyncio.shield(task))

    async def _export(self, api, event: dict[str, Any], key: str, channel: int, hevc_ok: bool) -> dict[str, Any]:
        async with self._slots:
            if not self._ready:
                await asyncio.to_thread(self._reset_dir)
                self._ready = True
            start = int(event["start"]) - LEAD_S * 1000
            end = int(event["end"] or event["start"]) + TAIL_S * 1000
            end = min(end, start + MAX_S * 1000)
            raw = CLIP_DIR / f"{key}-raw.mp4"
            final = CLIP_DIR / f"{key}.mp4"
            try:
                data = await api.api_request_raw(
                    f"video/export?camera={event['camera_id']}&start={start}&end={end}&channel={channel}"
                )
                if not data:
                    raise RuntimeError("Protect returned no recording for that time")
                await asyncio.to_thread(raw.write_bytes, data)
                del data
                duration, codec = await probe(raw)
                if codec in ("hevc", "h265") and not hevc_ok:
                    await _run(
                        "ffmpeg", "-y", "-v", "error", "-i", str(raw), "-an",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(final),
                    )
                    duration, codec = await probe(final)
                else:
                    await asyncio.to_thread(raw.replace, final)
                size = (await asyncio.to_thread(final.stat)).st_size
            except BaseException:
                await asyncio.to_thread(final.unlink, True)
                raise
            finally:
                await asyncio.to_thread(raw.unlink, True)
            info = {
                "path": final,
                "start_ms": int(end - duration * 1000),
                "end_ms": end,
                "duration": duration,
                "codec": codec,
                "size": size,
            }
            _LOGGER.debug("Clip %s: %.1fs %s %d KB", key, duration, codec, size // 1024)
            self._clips[key] = info
            self._trim()
            return info

    def _trim(self) -> None:
        total = sum(i["size"] for i in self._clips.values())
        while len(self._clips) > MAX_CLIPS or (total > MAX_BYTES and len(self._clips) > 1):
            _, old = self._clips.popitem(last=False)
            total -= old["size"]
            asyncio.get_running_loop().run_in_executor(None, old["path"].unlink, True)

    @staticmethod
    def _public(info: dict[str, Any]) -> dict[str, Any]:
        return {
            "file": info["path"].name,
            "start_ms": info["start_ms"],
            "end_ms": info["end_ms"],
            "duration": info["duration"],
            "codec": info["codec"],
        }
