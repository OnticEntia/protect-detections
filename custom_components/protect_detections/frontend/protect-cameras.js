/**
 * protect-cameras — finds the UniFi Protect cameras in Home Assistant, for
 * camera-wall-card and protect-detection-card when their config names none.
 * Not a card and not a dashboard resource of its own: the two cards import
 * it (it must sit next to them).
 */

/**
 * How a camera entity stands:
 *   "ok"       it is there;
 *   "offline"  Home Assistant has it but it isn't answering (unavailable):
 *              for now, and it comes back by itself;
 *   "removed"  it is no longer the UniFi Protect integration's: Home
 *              Assistant doesn't know it at all, or keeps only the state it
 *              holds for an entity whose integration has let go of it
 *              (`restored`). It stays that way until someone acts.
 * (One Home Assistant knows of but has no state for, as while a page is
 * still loading, counts as there: nothing is said to be gone on a guess.)
 */
export function cameraStatus(hass, entity) {
  const st = hass && hass.states && hass.states[entity];
  if (!st) return hass && hass.entities && hass.entities[entity] ? "ok" : "removed";
  if (st.state !== "unavailable") return "ok";
  return st.attributes && st.attributes.restored ? "removed" : "offline";
}

// The same for a camera (any of its entities there: it is there).
export function camerasStatus(hass, entities) {
  const all = [...new Set((entities || []).filter(Boolean))].map((e) => cameraStatus(hass, e));
  if (!all.length) return "removed";
  return all.includes("ok") ? "ok" : all.includes("offline") ? "offline" : "removed";
}

/**
 * The UniFi Protect cameras, one per camera device, sorted by name:
 * [{entity, tap_entity, name, device}]. `entity` is the lighter of the
 * camera's enabled streams (for showing several at once), `tap_entity` the
 * best one; the same when only one is enabled. `name` is the device's, the
 * one the user gave it first. `status` is "ok" or "offline" (cameraStatus).
 * A camera that has been removed (every entity of it left behind in Home
 * Assistant's registry without the integration) is left out, unless
 * given.removed is true.
 *
 * given.exclude: cameras to leave out, given.order: cameras to put first in
 * that order. Each a list of names (* and ? allowed), entity ids or device ids.
 */
export function findProtectCameras(hass, given = {}) {
  const entities = (hass && hass.entities) || {};
  const devices = (hass && hass.devices) || {};
  const states = (hass && hass.states) || {};
  const byDevice = new Map();
  for (const [id, ent] of Object.entries(entities)) {
    if (!id.startsWith("camera.") || !ent || ent.platform !== "unifiprotect" || !ent.device_id || ent.hidden) continue;
    if (!byDevice.has(ent.device_id)) byDevice.set(ent.device_id, []);
    const attrs = (states[id] && states[id].attributes) || {};
    const label = `${id} ${ent.name || ""}`.toLowerCase();
    // which of the camera's streams: Protect numbers them 0 (best) upwards
    let channel = Number.isInteger(attrs.channel_id) ? attrs.channel_id : null;
    if (channel == null) channel = /high/.test(label) ? 0 : /medium/.test(label) ? 1 : /low/.test(label) ? 2 : null;
    byDevice.get(ent.device_id).push({
      id,
      channel,
      pixels: (Number(attrs.width) || 0) * (Number(attrs.height) || 0),
      // a doorbell's parcel camera and the unencrypted copies are not "the camera"
      side: /package|insecure/.test(label),
    });
  }
  const cams = [];
  for (const [device, all] of byDevice) {
    const main = all.filter((c) => !c.side);
    const list = (main.length ? main : all).sort(
      (a, b) => (a.channel ?? 99) - (b.channel ?? 99) || b.pixels - a.pixels || a.id.localeCompare(b.id)
    );
    // opened on tap: the best stream there is. On the wall: the next one
    // down (lighter), or the same one when it is the only one.
    const tap = list[0];
    const wall = list.find((c) => c !== tap && (c.channel == null || c.channel > (tap.channel ?? -1))) || tap;
    const dev = devices[device] || {};
    const status = camerasStatus(hass, all.map((c) => c.id));
    if (status === "removed" && !given.removed) continue;
    cams.push({ entity: wall.id, tap_entity: tap.id, name: dev.name_by_user || dev.name || wall.id, device, status });
  }
  const globs = (list) =>
    (Array.isArray(list) ? list : list == null ? [] : [list]).map((g) => {
      const text = String(g).trim().toLowerCase();
      const re = new RegExp(`^${text.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
      return (cam) => [cam.entity, cam.tap_entity, cam.device, cam.name].some((v) => re.test(String(v).toLowerCase()));
    });
  const exclude = globs(given.exclude);
  const order = globs(given.order);
  const rank = (cam) => {
    const at = order.findIndex((hit) => hit(cam));
    return at < 0 ? order.length : at;
  };
  return cams
    .filter((cam) => !exclude.some((hit) => hit(cam)))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || a.entity.localeCompare(b.entity));
}
