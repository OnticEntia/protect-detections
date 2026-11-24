"""Which cameras there are, and which there no longer are.

A camera can be two kinds of "not there":

  offline   Protect still has it; it just isn't answering. Nothing here
            changes for it: it is listed as before, and picked up again by
            itself. (Home Assistant shows its entities as unavailable.)
  removed   Protect no longer has it. It is kept here, marked as removed,
            so that what still refers to it (a detection in the history, a
            sighting on record, a card that was showing it) can say whose it
            was and that it has gone, rather than "unknown camera" or
            nothing. Nothing is listened to or written for it any more.

CameraBook is plain Python (no Home Assistant), so it can be tested alone.
"""

from __future__ import annotations

from typing import Any

REMOVED_NAME = "Removed camera"  # one that had gone before it was ever seen here


class CameraBook:
    """Protect camera id -> {id, name, entity, tap_entity, removed, was}.

    `entity` / `tap_entity` are the Home Assistant camera entities (the
    lighter stream / the best one); None for a removed camera, whose last
    ones are kept in `was` so that a card still naming one can be told why
    it gets nothing."""

    def __init__(self) -> None:
        self.cams: dict[str, dict[str, Any]] = {}

    def update(self, found: list[dict[str, Any]]) -> dict[str, list[str]]:
        """Take the cameras Protect has now ([{id, name, entity, tap_entity}]).
        Returns what changed: {"added": [...], "removed": [...], "back":
        [...], "changed": [...]} (camera ids; `changed`: its name or
        entities)."""
        out: dict[str, list[str]] = {"added": [], "removed": [], "back": [], "changed": []}
        seen = set()
        for cam in found:
            cam_id = cam.get("id")
            if not cam_id:
                continue
            seen.add(cam_id)
            new = {
                "id": cam_id, "name": cam.get("name"), "entity": cam.get("entity"),
                "tap_entity": cam.get("tap_entity"), "removed": False, "was": [],
            }
            old = self.cams.get(cam_id)
            if old is None:
                out["added"].append(cam_id)
            elif old.get("removed"):
                out["back"].append(cam_id)
            elif any(old.get(k) != new[k] for k in ("name", "entity", "tap_entity")):
                out["changed"].append(cam_id)
            self.cams[cam_id] = new
        for cam_id, cam in self.cams.items():
            if cam_id in seen or cam.get("removed"):
                continue
            cam["was"] = [e for e in (cam.get("entity"), cam.get("tap_entity")) if e]
            cam["entity"] = cam["tap_entity"] = None
            cam["removed"] = True
            out["removed"].append(cam_id)
        return out

    def present(self, cam_id: Any) -> bool:
        """Does Protect have this camera now?"""
        cam = self.cams.get(cam_id)
        return cam is not None and not cam.get("removed")

    def label(self, cam_id: Any) -> tuple[str, bool]:
        """What to call a camera, and whether it has been removed: its name;
        for one never seen here (gone before this started), a plain word."""
        cam = self.cams.get(cam_id)
        if cam is None:
            return REMOVED_NAME, True
        return cam.get("name") or ("Camera" if not cam.get("removed") else REMOVED_NAME), bool(cam.get("removed"))

    def of_entity(self, entity: str) -> tuple[str | None, bool]:
        """The camera a Home Assistant camera entity (either stream) belongs
        to: (id, False); (id, True) for a removed camera's last entity;
        (None, False) when it isn't one of Protect's at all."""
        gone = None
        for cam_id, cam in self.cams.items():
            if entity in (cam.get("entity"), cam.get("tap_entity")):
                return cam_id, False
            if cam.get("removed") and entity in (cam.get("was") or []):
                gone = cam_id
        return gone, gone is not None
