"""Presets and patrols of a camera that pans, tilts and zooms.

The live view of the camera wall offers, to administrators, a camera's
presets (with Home) and its patrols. This is the server's side of it:

  what the camera has      read here: the presets from Protect (a read,
                           through the UniFi Protect integration's client),
                           the patrols from that integration's own patrol
                           entity
  going to a preset        Home Assistant's `unifiprotect.ptz_goto_preset`
  starting / stopping      Home Assistant's `select.select_option` on the
  a patrol                 integration's patrol entity

Nothing is sent to Protect from here: the two commands are the UniFi Protect
integration's own, called for the user who pressed the button. All three are
refused to anyone who is not an administrator.

Nothing in this file needs Home Assistant to be read or tested: what it needs
of it is handed in (see `Ptz`).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
import logging
from typing import Any

_LOGGER = logging.getLogger(__name__)

HOME = "Home"  # the integration's name for the home position (any case)
STOP = "stop"  # the patrol entity's option for "no patrol"
PRESET_SERVICE = ("unifiprotect", "ptz_goto_preset")
PATROL_SERVICE = ("select", "select_option")
HOME_SLOT = -1


class Refused(Exception):
    """A request that is not carried out, with a code for the card and words for the user."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _why(err: BaseException, fallback: str) -> str:
    """An error in words fit for the card (no more than a line)."""
    text = " ".join(str(err).split())
    return text[:200] if text else fallback


class Ptz:
    """The three requests, over what Home Assistant gives:

    camera(entity)       -> (the UniFi Protect camera or None, removed?)
    device(entity)       -> the camera's device id in Home Assistant, or None
    patrol(device_id)    -> {"entity", "options", "state"} of the patrol
                            entity, or None when there is none
    has_service(d, s)    -> is that service there?
    call(d, s, data, context) -> awaits the service (raises when it fails)
    """

    def __init__(
        self,
        *,
        camera: Callable[[str], tuple[Any, bool]],
        device: Callable[[str], str | None],
        patrol: Callable[[str], dict[str, Any] | None],
        has_service: Callable[[str, str], bool],
        call: Callable[[str, str, dict[str, Any], Any], Awaitable[Any]],
    ) -> None:
        self._camera = camera
        self._device = device
        self._patrol = patrol
        self._has_service = has_service
        self._call = call

    # ------------------------------------------------------------ who, what

    @staticmethod
    def _admin(admin: bool) -> None:
        if admin is not True:
            raise Refused("unauthorized", "Only an administrator can move a camera")

    def _find(self, entity: str) -> Any:
        """The camera behind an entity; None when it is not one that moves."""
        cam, removed = self._camera(entity)
        if removed:
            raise Refused("camera_removed", "This camera is no longer in UniFi Protect")
        if cam is None:
            raise Refused("not_found", "Not a UniFi Protect camera")
        try:
            return cam if cam.feature_flags.is_ptz else None
        except AttributeError:
            return None

    def _moving_camera(self, entity: str) -> str:
        """The device id of a camera that moves (refused otherwise)."""
        if self._find(entity) is None:
            raise Refused("not_ptz", "This camera cannot be moved")
        device = self._device(entity)
        if not device:
            raise Refused("not_found", "Home Assistant has no device for this camera")
        return device

    def _patrols(self, device: str | None) -> dict[str, Any] | None:
        """The patrol entity with the patrols it offers: None when there is none to use."""
        found = self._patrol(device) if device else None
        if not found or not found.get("entity"):
            return None
        names = [o for o in found.get("options") or [] if isinstance(o, str) and o != STOP]
        state = found.get("state")
        return {
            "entity": found["entity"],
            "options": names,
            "running": state if state in names else None,
            "available": state not in (None, "unavailable"),
        }

    # ------------------------------------------------------------- requests

    async def info(self, admin: bool, entity: str) -> dict[str, Any]:
        """What the live view shows for this camera. `{"ptz": False}` for one that does not move."""
        self._admin(admin)
        cam = self._find(entity)
        if cam is None:
            return {"ptz": False}
        out: dict[str, Any] = {
            "ptz": True,
            # (Home needs no list: the service knows it by name)
            "home": self._has_service(*PRESET_SERVICE),
            "presets": None,
            "presets_error": None,
            "patrol": self._patrols(self._device(entity)),
        }
        if not out["home"]:
            out["presets_error"] = "Home Assistant's UniFi Protect integration has no preset service here (it is too old)"
            return out
        try:
            presets = await cam.get_ptz_presets()
        except Exception as err:  # noqa: BLE001 (whatever went wrong, the card says it and offers Home alone)
            _LOGGER.debug("Presets of %s could not be read: %r", entity, err)
            out["presets_error"] = _why(err, "UniFi Protect did not give the presets")
            return out
        names: list[str] = []
        for preset in sorted(presets or [], key=lambda p: getattr(p, "slot", 0)):
            name = getattr(preset, "name", None)
            if getattr(preset, "slot", None) == HOME_SLOT or not isinstance(name, str) or not name.strip():
                continue
            # (the service goes by name: Home is its own button, and a name is offered once)
            if name.lower() != HOME.lower() and name not in names:
                names.append(name)
        out["presets"] = names
        return out

    async def goto(self, admin: bool, entity: str, preset: str, context: Any = None) -> dict[str, Any]:
        """Send the camera to a preset (or Home), through the integration's service."""
        self._admin(admin)
        device = self._moving_camera(entity)
        if not isinstance(preset, str) or not preset.strip():
            raise Refused("invalid", "No preset was named")
        if not self._has_service(*PRESET_SERVICE):
            raise Refused("not_supported", "Home Assistant's UniFi Protect integration has no preset service here (it is too old)")
        try:
            await self._call(*PRESET_SERVICE, {"device_id": device, "preset": preset}, context)
        except Exception as err:  # noqa: BLE001 (said on the card, whatever it was)
            _LOGGER.debug("Preset %r of %s was refused: %r", preset, entity, err)
            raise Refused("failed", _why(err, "UniFi Protect did not take the command")) from err
        return {"sent": preset}

    async def patrol(self, admin: bool, entity: str, option: str, context: Any = None) -> dict[str, Any]:
        """Start one of the camera's patrols, or stop (`option` "stop")."""
        self._admin(admin)
        device = self._moving_camera(entity)
        found = self._patrols(device)
        if found is None:
            raise Refused("no_patrols", "This camera has no patrol control in Home Assistant")
        if option != STOP and option not in found["options"]:
            raise Refused("invalid", "This camera has no such patrol")
        if not found["available"]:
            raise Refused("failed", "The patrol control is not available just now")
        try:
            await self._call(*PATROL_SERVICE, {"entity_id": found["entity"], "option": option}, context)
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Patrol %r of %s was refused: %r", option, entity, err)
            raise Refused("failed", _why(err, "UniFi Protect did not take the command")) from err
        return {"sent": option}
