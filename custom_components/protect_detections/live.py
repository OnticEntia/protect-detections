"""Where things are in a camera's picture right now.

Protect's own web page draws its live boxes from a websocket of its own, one
per camera (ws/liveDetectTrack?camera=<id>): about four times a second while
something is being tracked it says where each tracked thing is, with the
camera's clock for that moment. This passes those messages on to a card that
asks for a camera's, so it can draw the boxes over the live picture.

The socket is opened with the UniFi Protect integration's own login (nothing
is logged in separately and nothing is written to Protect), only while at
least one card is asking for that camera, and closed when the last one
leaves. It is not part of Protect's documented interface: an update could
change or remove it, and the cards then simply go without boxes.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import logging
import time
from typing import Any

try:
    from homeassistant.core import HomeAssistant, callback
except ImportError:  # (read on its own, as the tests do: nothing here needs Home Assistant to be thought through)
    HomeAssistant = Any  # type: ignore[assignment,misc]

    def callback(func):  # type: ignore[no-redef]
        return func

_LOGGER = logging.getLogger(__name__)

LIVE_PATH = "/proxy/protect/ws/liveDetectTrack"
LINGER = 5.0  # seconds a camera's socket is kept after its last listener left
TRACK_KEYS = ("id", "coord", "objectType", "confidence", "stationary", "zones", "loiterZones", "lines")

Send = Callable[[dict[str, Any]], None]


def _describe(attrs: Any) -> str:
    """'gray suv' ... from a track's attributes."""
    parts = []
    if isinstance(attrs, dict):
        for key in ("color", "vehicleType"):
            val = attrs.get(key)
            if isinstance(val, dict):
                val = val.get("val")
            if val:
                parts.append(str(val).replace("_", " "))
    return " ".join(parts)


def compact(data: dict[str, Any], arrived: int) -> dict[str, Any]:
    """One of Protect's messages, as it is passed on to the cards."""
    tracks = []
    for tr in data.get("tracks") or []:
        if not isinstance(tr, dict) or not isinstance(tr.get("coord"), list) or len(tr["coord"]) != 4:
            continue
        item = {key: tr.get(key) for key in TRACK_KEYS}
        item["id"] = str(tr.get("id"))
        item["desc"] = _describe(tr.get("attributes"))
        tracks.append(item)
    return {
        "arrived": arrived,  # this machine's clock (ms) when the message came in
        "clockWall": data.get("clockWall"),  # the camera's clock (ms) for these boxes
        "clockStream": data.get("clockStream"),
        "clockStreamRate": data.get("clockStreamRate"),
        "edgeType": data.get("edgeType"),
        "eventId": data.get("eventId"),
        "tracks": tracks,
    }


class _Feed:
    """One camera's socket, and the cards listening to it."""

    def __init__(self, live: LiveTracks, camera_id: str) -> None:
        self.live = live
        self.camera_id = camera_id
        self.listeners: set[Send] = set()
        self.task: asyncio.Task | None = None
        self.linger: asyncio.TimerHandle | None = None
        self.connected = False

    def tell(self, payload: dict[str, Any]) -> None:
        for send in list(self.listeners):
            try:
                send(payload)
            except Exception:  # noqa: BLE001 - one listener gone is no reason to stop
                _LOGGER.debug("A live-track listener failed", exc_info=True)

    async def run(self) -> None:
        """Stay connected while there are listeners; start over after a drop.
        Until the camera is no longer in Protect: then the listeners are told
        so, once, and that is the end of it (no trying again for good)."""
        backoff = 2.0
        while True:
            if not self.live.exists(self.camera_id):
                self.live.ended(self)
                return
            try:
                await self._connection()
                backoff = 2.0  # it had been connected
            except asyncio.CancelledError:
                raise
            except Exception as err:  # noqa: BLE001
                _LOGGER.debug("Live tracks of %s: %s", self.camera_id, err)
                self.tell({"status": "error", "error": f"{type(err).__name__}: {err}"[:200]})
            if self.connected:
                self.connected = False
                self.tell({"status": "disconnected"})
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60.0)

    async def _connection(self) -> None:
        from aiohttp import WSMsgType  # noqa: PLC0415
        from uiprotect.data.websocket import WSPacket  # noqa: PLC0415
        from yarl import URL  # noqa: PLC0415

        api = self.live.api()
        if api is None:
            raise RuntimeError("the UniFi Protect integration isn't loaded")
        base = getattr(api, "_ws_url", None)  # noqa: SLF001
        base = URL(str(base)) if base else URL(api.base_url.replace("https://", "wss://", 1))
        url = base.with_path(LIVE_PATH).with_query(camera=self.camera_id)
        # the certificate is checked whenever the integration checks it (and
        # when that can no longer be told)
        verify = bool(getattr(api, "_verify_ssl", True))  # noqa: SLF001
        await api.ensure_authenticated()
        session = await api.get_session()
        # (the ping also tells a dead connection from a quiet one: nothing is
        # sent while nothing is being tracked)
        async with session.ws_connect(str(url), headers=api.headers or {}, ssl=verify, heartbeat=30) as ws:
            self.connected = True
            self.tell({"status": "connected"})
            async for msg in ws:
                if msg.type in (WSMsgType.CLOSED, WSMsgType.ERROR):
                    break
                if msg.type != WSMsgType.BINARY:
                    continue
                try:
                    data = WSPacket(msg.data).data_frame.data
                except Exception:  # noqa: BLE001 - one unreadable message is skipped
                    _LOGGER.debug("Skipped a live-track message", exc_info=True)
                    continue
                if isinstance(data, dict) and self.listeners:
                    self.tell(compact(data, int(time.time() * 1000)))


class LiveTracks:
    """The cameras being listened to. `api` gives the Protect client;
    `exists` says whether Protect still has a camera (by its id)."""

    def __init__(self, hass: HomeAssistant, api: Callable[[], Any], exists: Callable[[str], bool] | None = None) -> None:
        self.hass = hass
        self.api = api
        self.exists = exists or (lambda camera_id: True)
        self.feeds: dict[str, _Feed] = {}

    @callback
    def ended(self, feed: _Feed) -> None:
        """A camera's feed is over because the camera has gone from Protect:
        its listeners are told why, and nothing is left running for it."""
        if self.feeds.get(feed.camera_id) is feed:
            self.feeds.pop(feed.camera_id, None)
        if feed.linger:
            feed.linger.cancel()
            feed.linger = None
        feed.connected = False
        feed.tell({"status": "removed"})

    @callback
    def drop(self, camera_id: str) -> None:
        """Stop listening to a camera that has gone from Protect, now (not
        at its feed's next attempt to connect)."""
        feed = self.feeds.get(camera_id)
        if feed is None:
            return
        if feed.task:
            feed.task.cancel()
        self.ended(feed)

    @callback
    def subscribe(self, camera_id: str, send: Send) -> Callable[[], None]:
        """Have `send` called with each of that camera's messages (see compact();
        or {"status": "connected" | "disconnected" | "error"}); returns the
        function that ends it. Called from the event loop. Also used by other
        integrations, so its shape is kept."""
        feed = self.feeds.get(camera_id)
        if feed is None:
            feed = self.feeds[camera_id] = _Feed(self, camera_id)
        if feed.linger:
            feed.linger.cancel()
            feed.linger = None
        feed.listeners.add(send)
        if feed.task is None or feed.task.done():
            feed.task = self.hass.async_create_background_task(feed.run(), f"protect_detections live {camera_id}")
        elif feed.connected:
            send({"status": "connected"})

        @callback
        def unsubscribe() -> None:
            feed.listeners.discard(send)
            if feed.listeners or feed.linger:
                return
            # (a card that changes stream asks again at once: no need to reconnect for that)
            feed.linger = self.hass.loop.call_later(LINGER, self._close, feed)

        return unsubscribe

    @callback
    def _close(self, feed: _Feed) -> None:
        feed.linger = None
        if feed.listeners:
            return
        if feed.task:
            feed.task.cancel()
        feed.connected = False
        if self.feeds.get(feed.camera_id) is feed:  # (not a newer one for the same camera)
            self.feeds.pop(feed.camera_id, None)

    async def stop(self) -> None:
        tasks = []
        for feed in list(self.feeds.values()):
            if feed.linger:
                feed.linger.cancel()
            if feed.task:
                feed.task.cancel()
                tasks.append(feed.task)
        self.feeds.clear()
        await asyncio.gather(*tasks, return_exceptions=True)
