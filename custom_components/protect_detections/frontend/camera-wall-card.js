/**
 * camera-wall-card — a centered, screen-fitting wall of live camera feeds.
 *
 * - A compact alarm control, centered at the top (optional).
 * - Cameras in a grid that is centered both ways in the remaining space and
 *   sized so every feed fits on screen without scrolling (desktop/tablet).
 *   On narrow screens it falls back to one feed per row and scrolls.
 *
 * Tapping a feed opens it in a dialog (HD at home). While that dialog or the
 * History lightbox is open, the feeds behind it are released and show their
 * last frame; they start again when it closes. With `history:` set, a feed
 * gets a pulsing red outline while its camera has a detection in progress.
 *
 * If the Protect Zones integration is installed, the dialog can draw each
 * camera's zones and lines over the picture (a "Zones" button switches them),
 * and a feed shows a small badge naming a zone that is occupied. Without that
 * integration none of this appears and the wall works as before.
 *
 * The picture in the dialog can be zoomed (digitally, up to 8x): the mouse
 * wheel or a pinch zooms where the pointer is, dragging moves the picture,
 * and the button showing the zoom puts it back.
 *
 * On a phone the dialog fills the screen and shows the picture landscape:
 * the screen is turned for real where the browser can do that (full screen,
 * locked to landscape), otherwise the dialog itself is drawn turned a
 * quarter, so the phone is held sideways. `phone_landscape: false` in the
 * config keeps the ordinary dialog.
 *
 * The wall can be arranged: the "Arrange" button shows the grid's cells and
 * puts a handle on every feed. Drag a feed to any cell (with a finger: by
 * its grip); cells left empty stay empty, so a blank centre or a row of its
 * own is fine. Dropped on another feed the two change places, and where
 * there is no room it goes back. Drag a feed's corner or tap its size to
 * make it span more cells (never into another feed). The bar adds and
 * removes columns and rows (up to 8; the last one only when it is empty), and
 * the wall still shrinks to fit the screen. Done keeps it, Cancel drops the
 * changes, Reset goes back to the automatic grid in the config's order.
 * The arrangement belongs to the Home Assistant user, so it follows them to
 * every device (a copy in the browser stands in if Home Assistant can't be
 * reached), and it knows a camera by its device: renaming it or changing its
 * streams changes nothing, a camera that is gone leaves its cell empty and a
 * new one takes the first free cell (on a new row if there is none). The
 * arranged grid keeps its columns on any screen with room for two or more.
 * A screen with one column (a phone held upright) shows every camera in a
 * plain list instead; arranging there changes only the list's order, which
 * is kept on its own, so neither layout disturbs the other (until it has an
 * order of its own, the list reads as the wide wall does, row by row). At
 * home a feed two or more columns wide shows the camera's best stream.
 *
 * With the Protect Detections backend, a camera that recognises things also
 * gets a tracking tile beside its feed: it stands by (no video) until that
 * camera tracks a person, then shows them live and close up, and stands by
 * again when they have gone. It is a tile like the feeds: arranged with them,
 * resting while a dialog is open, and a tap opens the camera's dialog.
 *
 * With the Protect Detections backend, the dialog of a camera that recognises
 * things has a "Boxes" button: a box round each thing the camera is
 * tracking. Protect reports positions about half a second late, so while it
 * is on the picture is held back a little, the way Protect's own page does
 * it, and every box is drawn with the frame it belongs to. Talking through
 * the camera drops that delay. (Staying on a person, zoomed in, is what the
 * tracking tile does.)
 *
 * Right-click the wall (on a touch screen: press and hold) for its menu. On a
 * tile: open it, give it another size, take it off the wall; for a camera
 * that recognises things, add or remove its tracking tile; for a tracking
 * tile, what it watches for and which stream it uses. On the wall itself (or
 * "Add…" on a tile): put back anything that was taken off, where it was
 * clicked if that cell is free. "Reset layout" brings everything back. What
 * is off the wall is kept with the user's arrangement, so it stays off, and
 * a feed that is off isn't playing. A camera that is new still appears.
 *
 * Best in a "panel" view. The whole config can be just:
 *
 *   type: custom:camera-wall-card
 *
 * What is left out is found in Home Assistant, and found again when its
 * entities or devices change (a camera added, removed or renamed shows
 * without touching the config):
 *   - cameras: one feed per UniFi Protect camera, by name. On the wall its
 *     lighter stream, opened on tap its best one (the same one when only one
 *     is enabled).
 *   - alarm: UniFi Protect's alarm panel, if there is one.
 *   - history: those same cameras, if Protect Detections and its card
 *     (protect-detection-card) are installed.
 *   - local_url / remote_url: Home Assistant's own internal and external
 *     addresses; the Local / Remote switch shows only when it has both.
 *
 * Everything can still be written out, and is then used as written:
 *
 *   type: custom:camera-wall-card
 *   exclude: ["Garage*", camera.x_high_resolution_channel]   # found cameras to leave
 *                                           # out: names (* and ? allowed), entity
 *                                           # or device ids
 *   order: ["Front*", "Drive*"]             # found cameras to put first, in this
 *                                           # order (the rest follow by name)
 *   cameras:                                # or: the cameras, spelled out
 *     - entity: camera.x_medium_resolution_channel   # shown live
 *       tap_entity: camera.x_high_resolution_channel # opened on tap
 *       name: Front
 *       # protect_id: 6a8c...                # only if its zones aren't found by
 *                                           # themselves (Protect's id of the camera)
 *   alarm: alarm_control_panel.xxx          # or false for none
 *   alarm_modes: [armed_home, armed_away, disarmed]
 *   history:                                # the History lightbox's cameras, like
 *     - entity: camera.x_medium_resolution_channel   # `cameras`; or false for none
 *       tap_entity: camera.x_high_resolution_channel
 *       name: Front
 *   local_url: http://homeassistant.local:8123    # or false for no switch
 *   remote_url: https://example.org
 *   aspect_ratio: 1.7778                    # width / height of each feed (16:9)
 *   breakpoints: [[1024, 3], [600, 2], [0, 1]]   # [min screen width, columns]
 *   arrange: false                          # optional: no Arrange button
 *   layout: garage                          # optional: a name for this wall's saved
 *                                           # arrangement, when there are several walls
 *   zone_overlay: false                     # optional: never show zones
 *   tracking: false                         # optional: no tracking tiles; or options
 *                                           # for them, e.g. {types: [person], linger: 10,
 *                                           # stream: low} (see protect-tracking-card)
 *   live_tracks: false                      # optional: no Boxes button
 *   live_delay: 700                         # optional: ms the picture is held back
 *                                           # while Boxes is on (WebRTC)
 *   source: auto                            # optional: whose positions the boxes are:
 *                                           # auto (the Protect Tracker integration's when
 *                                           # installed, else Protect's own) | local (only
 *                                           # what its model made) | protect (only Protect's).
 *                                           # In the live view a chip beside Boxes switches
 *                                           # between them (kept in the browser)
 *   live_offset: 0                          # optional: ms to draw the boxes later (+)
 *                                           # or earlier (-), if they don't sit right
 *   phone_landscape: false                  # optional: on a phone, don't turn the
 *                                           # dialog to landscape
 *
 * Part of the Protect Detections integration, which serves it and loads it
 * into Home Assistant by itself (no dashboard resource to add).
 */

// The cards' shared parts, and the tracking tile's card (which is also a
// card of its own: whichever file comes first defines it). All of them are
// served from one folder whose address carries the integration's version,
// so a new version is a new address for every file at once.
import { findProtectCameras } from "./protect-cameras.js";
import { LiveTracks, LIVE_COLORS, subscribeLive } from "./protect-live.js";
import "./protect-tracking-card.js";

const GAP = 12;
const PAD = 16;
const QUALITY_KEY = "camera-wall-card:live-hd";
// the arrangement: kept with the Home Assistant user (so it follows them to
// every device), and a copy in this browser for when that can't be reached
const ARRANGE_USER_KEY = "camera_wall_card";
const ARRANGE_LOCAL_KEY = "camera-wall-card:arrange:";
const GRID_MAX = 8; // columns or rows of an arranged wall, at most
const ZONES_KEY = "camera-wall-card:zones";
// live boxes (needs the Protect Detections backend's live relay)
const EDIT_DIALOG = "hui-dialog-edit-card"; // Home Assistant's own dialog for editing a card
const LIVE_BOXES_KEY = "camera-wall-card:live-boxes";
const LIVE_SOURCE_KEY = "camera-wall-card:live-source"; // whose boxes, as picked in the live view
const LIVE_TRACKER_KEY = "camera-wall-card:live-tracker"; // Protect Tracker has been seen from this browser
const LIVE_SOURCE_NAMES = { auto: "Auto", local: "Local", protect: "UniFi" };
const ZOOM_MAX = 8;
const SVG_NS = "http://www.w3.org/2000/svg";
// zone colours when Protect gives none
const ZONE_COLORS = { zone: "#38bdf8", line: "#facc15", loiter: "#c084fc" };

// At home the full-quality feed is cheap; through the public tunnel it buffers.
function onHomeNetwork() {
  const h = location.hostname;
  return h === "localhost" || h.endsWith(".local") || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/.test(h);
}

// The HA phone app picks its own address (Internal/External URL) and blocks
// plain-http pages away from home, so the Local/Remote switch is hidden there.
function inCompanionApp() {
  return !!(window.externalApp || window.webkit?.messageHandlers?.getExternalAuth) || /Home ?Assistant\//i.test(navigator.userAgent);
}

// Every <video> under an element, through nested shadow roots.
function findVideos(node, out = [], tags = ["VIDEO"]) {
  if (node.shadowRoot) findVideos(node.shadowRoot, out, tags);
  for (const el of node.querySelectorAll ? node.querySelectorAll("*") : []) {
    if (tags.includes(el.tagName)) out.push(el);
    if (el.shadowRoot) findVideos(el.shadowRoot, out, tags);
  }
  return out;
}

// A MAC address the same way however it was written.
function normMac(mac) {
  return String(mac || "").toLowerCase().replace(/[^0-9a-f]/g, "");
}

// The valid points of a zone, as numbers.
function zonePoints(zone) {
  return (Array.isArray(zone && zone.points) ? zone.points : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]))
    .map((p) => [+p[0], +p[1]]);
}

function inPolygon(pt, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// The point of segment a-b nearest to p, and how far away it is.
function nearestOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  const at = [a[0] + t * dx, a[1] + t * dy];
  return { at, dist: Math.hypot(p[0] - at[0], p[1] - at[1]) };
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a) / 2;
}

const ZONE_KINDS = { zone: "Detection zone", loiter: "Loiter zone", line: "Line" };
const ZONE_MAX_POINTS = 32; // Protect Zones refuses more
// what to say for an error that comes without words of its own
const ZONE_ERRORS = {
  invalid_points: "Protect Zones didn't accept that shape",
  invalid_name: "Protect Zones didn't accept that name",
  invalid_color: "Protect Zones didn't accept that colour",
  invalid_types: "Protect Zones didn't accept those detections",
  invalid_dwell: "Protect Zones didn't accept those loiter times (0.5 to 600 seconds each)",
  nothing_to_change: "Nothing was changed",
  zone_not_found: "Protect no longer has this zone",
  nothing_to_undo: "There is no zone change to undo for this camera",
  protect_error: "Protect didn't accept the change",
  unauthorized: "Only an administrator can change zones",
};

// What Protect can tell apart, as it names them and as we do.
const ZONE_TYPES = { person: "Person", vehicle: "Vehicle", animal: "Animal", package: "Package", licensePlate: "Licence plate", face: "Face" };
const DWELL_MIN = 0.5;
const DWELL_MAX = 600;

// One outline as text, to tell whether two zones have the very same one.
function zoneOutline(zone) {
  return zonePoints(zone).map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(" ");
}

// Where the picture itself is on screen inside a <video> or <img>: the
// element's box minus the bars object-fit leaves around it. null until the
// picture's size is known.
function pictureBox(el, r = el.getBoundingClientRect()) {
  const w = el.videoWidth || el.naturalWidth;
  const h = el.videoHeight || el.naturalHeight;
  if (!w || !h || !r.width || !r.height) return null;
  let fit = "contain";
  try {
    fit = getComputedStyle(el).objectFit || fit;
  } catch (e) {}
  if (fit === "fill") return { left: r.left, top: r.top, width: r.width, height: r.height };
  const k = fit === "cover" ? Math.max(r.width / w, r.height / h) : fit === "none" ? 1 : Math.min(r.width / w, r.height / h);
  return { left: r.left + (r.width - w * k) / 2, top: r.top + (r.height - h * k) / 2, width: w * k, height: h * k };
}

// The frame a tile is showing right now, as a canvas; null if it has no
// picture (still loading, or its stream failed).
function lastFrame(card, maxWidth = 960) {
  for (const v of findVideos(card)) {
    if (!v.videoWidth || v.readyState < 2) continue;
    try {
      const k = Math.min(1, maxWidth / v.videoWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(v.videoWidth * k);
      c.height = Math.round(v.videoHeight * k);
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      return c;
    } catch (e) {}
  }
  return null;
}

// Same look as the History lightbox (protect-detection-card).
// The context menus: the same look in the camera dialog (zones) and on the wall.
const MENU_STYLE = `
  .zmenu-back { position: absolute; inset: 0; z-index: 3; }
  .zmenu { position: absolute; z-index: 4; min-width: 200px; max-width: min(300px, calc(100vw - 16px)); padding: 6px; border-radius: 12px;
    background: #161616; border: 1px solid #333; box-shadow: 0 12px 32px rgba(0,0,0,.6); color: #f3f4f6; font-size: 14px;
    font-family: var(--ha-font-family-body, Roboto, sans-serif); }
  .zmenu .head { padding: 6px 10px 8px; border-bottom: 1px solid #2a2a2a; margin-bottom: 4px; font-weight: 600; display: block; }
  .zmenu .head small { display: block; font-weight: 400; color: #9ca3af; font-size: 12px; }
  .zmenu button { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer;
    background: none; border: 0; border-radius: 8px; padding: 9px 10px; }
  .zmenu button:hover, .zmenu button:focus-visible { background: #262626; outline: none; }
  .zmenu button:disabled { opacity: .5; cursor: default; }
  .zmenu button i { flex: none; width: 10px; height: 10px; border-radius: 50%; }
  .zmenu hr { border: 0; border-top: 1px solid #2a2a2a; margin: 4px 0; }
`;

const LIVE_STYLE = `
  /* everything in the dialog; on a phone held upright it is turned a quarter */
  .wrap { position: absolute; inset: 0; }
  .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
  .lb { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(max(50vw, 720px), calc(100vw - 24px)); height: min(max(50vh, 480px), calc(100vh - 24px));
    background: #0a0a0a; border: 1px solid #262626; border-radius: 18px; overflow: hidden;
    box-shadow: 0 24px 64px rgba(0,0,0,.7); color: #f3f4f6; display: flex; flex-direction: column;
    font-family: var(--ha-font-family-body, Roboto, sans-serif); }
  .lb.full { width: calc(100vw - 24px); height: calc(100vh - 24px); }
  /* on a phone: the whole screen, landscape, clear of the notch and the home bar */
  .lb.fill { left: 0; top: 0; transform: none; width: 100%; height: 100%; border: 0; border-radius: 0; box-sizing: border-box;
    padding: 0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
  .lb.fill.rot { padding: 0 env(safe-area-inset-bottom, 0px) 0 env(safe-area-inset-top, 0px); }
  .lb.fill .head { padding: 6px 10px; gap: 6px; flex-wrap: nowrap; }
  .lb.fill .title { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .lb.fill .live, .lb.fill .expand { display: none; }
  .lb.fill button.icon { width: 36px; height: 36px; }
  .lb.fill button.chip { padding: 5px 9px; white-space: nowrap; }
  .lb.fill .stage { padding: 0 4px 4px; gap: 4px; }
  .lb.fill .frame { border-radius: 6px; }
  .head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 14px 18px; border-bottom: 1px solid #222; }
  .title { font-size: 18px; font-weight: 600; margin-right: 6px; }
  .live { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #fca5a5; }
  .live .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary-color, #e0102a); animation: pulse 1.2s infinite; }
  @keyframes pulse { 50% { opacity: .25; } }
  .spacer { flex: 1; }
  button.chip { font: inherit; font-size: 13px; cursor: pointer; border-radius: 999px; padding: 6px 12px;
    border: 1px solid #333; background: #111; color: #9ca3af; display: inline-flex; gap: 6px; align-items: center; }
  button.chip.on { color: #fff; border-color: var(--primary-color, #e0102a); background: color-mix(in srgb, var(--primary-color, #e0102a) 30%, transparent); }
  button.chip ha-icon { --mdc-icon-size: 16px; }
  button.icon { font: inherit; cursor: pointer; border: 0; background: #1f1f1f; color: #fff; width: 40px; height: 40px;
    border-radius: 50%; display: grid; place-items: center; flex: none; }
  button.icon:hover { background: #2d2d2d; }
  button.icon[hidden], button.chip[hidden] { display: none; }
  .stage { flex: 1; min-height: 0; display: flex; align-items: center; gap: 12px; padding: 12px; }
  .body { flex: 1; align-self: stretch; min-width: 0; container-type: size; display: grid; place-items: center; }
  .frame { width: min(100cqw, calc(100cqh * var(--ar))); aspect-ratio: var(--ar); background: #000;
    border-radius: 12px; overflow: hidden; position: relative; }
  /* the picture and the zones on it: what digital zoom enlarges */
  .frame .zoom { position: absolute; inset: 0; transform-origin: 0 0; }
  .frame.zoomed { cursor: grab; touch-action: none; }
  /* what the camera is tracking, live */
  .lbox-it.passed { border-style: dashed; }
  .lbox-it.seen { border-style: dotted; }
  button.chip.lsrc { padding-left: 10px; padding-right: 10px; opacity: .85; }
  button.chip.lsrc.warn { color: var(--warning-color, #fbbf24); }
  .lboxes { position: absolute; pointer-events: none; }
  .ldebug { position: absolute; left: 8px; bottom: 8px; max-width: calc(100% - 16px); padding: 3px 7px; border-radius: 4px; background: rgba(0,0,0,.7); color: #fff;
    font: 11px/1.4 ui-monospace, monospace; pointer-events: none; z-index: 3; }
  .ldebug[hidden] { display: none; }
  .lbox-it { position: absolute; box-sizing: border-box; border: calc(2px * var(--k, 1)) solid var(--c, #fff); border-radius: calc(3px * var(--k, 1));
    pointer-events: none; }
  .lbox-it.part { border-width: calc(1.5px * var(--k, 1)); border-radius: 50% / 45%; }
  .lbox-it.part span { display: none; }
  .lbox-it span { position: absolute; left: 0; bottom: 100%; margin-bottom: 3px; white-space: nowrap; font-size: 12px; font-weight: 600; color: #fff;
    padding: 2px 6px; border-radius: 4px; background: color-mix(in srgb, var(--c, #fff) 70%, #000 30%); transform: scale(var(--k, 1)); transform-origin: 0 100%; }
  .lbox-it span.below { bottom: auto; top: 100%; margin: 3px 0 0; transform-origin: 0 0; }
  .frame.panning { cursor: grabbing; }
  .frame .video { position: absolute; inset: 0; }
  .frame ha-camera-stream { display: block; width: 100%; height: 100%; --video-max-height: 100%; }
  .frame ha-camera-stream, .frame video, .frame img { object-fit: contain; }
  /* zones drawn over the picture: looked at, never clicked */
  .zones { position: absolute; pointer-events: none; overflow: hidden; }
  /* --k is 1 / zoom: lines, names and handles keep their size on screen when the picture is zoomed */
  .zones .shape { stroke-width: calc(2px * var(--k, 1)); stroke-linejoin: round; stroke-linecap: round; fill-opacity: .12; }
  .zones .shape.line { fill: none; stroke-width: calc(3px * var(--k, 1)); }
  .zones .shape.loiter { stroke-dasharray: 7 5; }
  .zones .shape.occ { fill-opacity: .42; stroke-width: calc(3px * var(--k, 1)); animation: zone-occ 1.2s ease-in-out infinite; }
  .zones .shape.line.occ { stroke-width: calc(5px * var(--k, 1)); }
  @keyframes zone-occ { 50% { fill-opacity: .16; } }
  @media (prefers-reduced-motion: reduce) { .zones .shape.occ { animation: none; } }
  .zones text { font-size: calc(13px * var(--k, 1)); font-weight: 600; fill: #fff; stroke: rgba(0,0,0,.8); stroke-width: calc(3px * var(--k, 1));
    paint-order: stroke; text-anchor: middle; dominant-baseline: middle; }
  .zone-note { position: absolute; left: 10px; top: 10px; max-width: calc(100% - 20px); box-sizing: border-box; pointer-events: none;
    font-size: 12px; padding: 5px 10px; border-radius: 999px; background: rgba(0,0,0,.65); color: #e5e7eb; }
  .zone-note[hidden] { display: none; }
  /* editing a zone: only its points and edges take the pointer */
  .zones .dim { opacity: .3; animation: none; }
  .zones .shape.edit { stroke-width: calc(2.5px * var(--k, 1)); fill-opacity: .18; }
  .zones .edge { stroke: transparent; stroke-width: calc(16px * var(--k, 1)); fill: none; pointer-events: stroke; cursor: copy; }
  .zones .dot { fill: #fff; stroke-width: 2.5; pointer-events: none; }
  .zones .dot, .zones .grab { transform-box: fill-box; transform-origin: center; transform: scale(var(--k, 1)); }
  .zones .grab { fill: transparent; pointer-events: all; cursor: grab; touch-action: none; }
  .zbar { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); max-width: calc(100% - 20px); box-sizing: border-box;
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; padding: 8px 10px; border-radius: 14px;
    background: rgba(10,10,10,.88); border: 1px solid #333; color: #f3f4f6; font-size: 13px; z-index: 2; }
  .zbar[hidden] { display: none; }
  .zbar.error { border-color: #f87171; }
  .zbar .msg { min-width: 0; }
  .zbar .msg small { display: block; color: #9ca3af; font-size: 11px; }
  .zbar .err { flex-basis: 100%; color: #fca5a5; text-align: center; }
  .zbar input[type=text] { font: inherit; color: #fff; background: #111; border: 1px solid #444; border-radius: 8px; padding: 6px 8px; width: 180px; max-width: 50vw; }
  .zbar .zopts { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 6px 14px; justify-content: center; }
  .zbar .zopts label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap; }
  .zbar .zopts input[type=checkbox] { width: 16px; height: 16px; margin: 0; accent-color: var(--primary-color, #e0102a); }
  .zbar input[type=number] { font: inherit; color: #fff; background: #111; border: 1px solid #444; border-radius: 8px; padding: 4px 6px; width: 62px; }
  .zbar input[type=number]:disabled { opacity: .4; }
  .zbar input[type=color] { width: 44px; height: 32px; padding: 0; border: 1px solid #444; border-radius: 8px; background: #111; cursor: pointer; }
  .zbar button { font: inherit; cursor: pointer; border-radius: 999px; padding: 6px 14px; border: 1px solid #444; background: #1f1f1f; color: #f3f4f6; }
  .zbar button.main { border-color: var(--primary-color, #e0102a); background: color-mix(in srgb, var(--primary-color, #e0102a) 45%, transparent); color: #fff; }
  .zbar button:disabled { opacity: .5; cursor: progress; }
${MENU_STYLE}`;

class CameraWallCard extends HTMLElement {
  setConfig(config) {
    config = config || {};
    if (config.cameras != null && config.cameras !== "auto" && !Array.isArray(config.cameras)) {
      throw new Error("camera-wall-card: 'cameras' must be a list, or left out to find them");
    }
    // HA may hand over the same config again: nothing to rebuild then
    let json = null;
    try {
      json = JSON.stringify(config);
    } catch (e) {}
    if (json && json === this._configJson && (this._built || this._building)) return;
    this._configJson = json;
    // as written; what is left out is filled in from Home Assistant (_resolve)
    this._given = {
      aspect_ratio: 16 / 9,
      breakpoints: [[1024, 3], [600, 2], [0, 1]],
      alarm_modes: ["armed_home", "armed_away", "disarmed"],
      ...config,
    };
    this._found = null;
    this._discover(true);
    this._built = false;
    this._failedConfig = null;
    if (this._hass) this._build();
  }

  // ------------------------------------------------------- finding things
  //
  // Whatever the config leaves out is looked up in Home Assistant: the
  // UniFi Protect cameras (one feed per camera device), the alarm panel,
  // the History list and Home Assistant's own two addresses. Looked up again
  // when Home Assistant's lists of entities or devices change, so a camera
  // that is added, removed or renamed shows without touching the config.

  // UniFi Protect's alarm panel (or Protect Rules', should it have one).
  static _findAlarm(hass) {
    const entities = (hass && hass.entities) || {};
    const found = Object.keys(entities)
      .filter((id) => id.startsWith("alarm_control_panel.") && !entities[id].hidden && hass.states && hass.states[id])
      .filter((id) => ["protect_rules", "unifiprotect"].includes(entities[id].platform))
      .sort((a, b) => (entities[a].platform === "protect_rules" ? 0 : 1) - (entities[b].platform === "protect_rules" ? 0 : 1) || a.localeCompare(b));
    return found[0] || null;
  }

  // The config with everything filled in. `auto` says what was looked up.
  _resolve() {
    const given = this._given;
    const hass = this._hass;
    const cfg = { ...given };
    const explicit = Array.isArray(given.cameras) && given.cameras.length > 0;
    cfg.auto_cameras = !explicit;
    cfg.cameras = explicit ? given.cameras : hass ? findProtectCameras(hass, given) : [];
    if (given.alarm === undefined) cfg.alarm = hass ? CameraWallCard._findAlarm(hass) : null;
    else if (!given.alarm) cfg.alarm = null;
    if (given.history === undefined || given.history === "auto" || given.history === true) {
      // needs the Protect Detections integration and its card
      const able =
        hass && hass.config && (hass.config.components || []).includes("protect_detections") && !!customElements.get("protect-detection-card");
      cfg.history = able && cfg.cameras.length ? cfg.cameras.map(({ entity, tap_entity, name }) => ({ entity, tap_entity, name })) : null;
    } else if (!Array.isArray(given.history) || !given.history.length) cfg.history = null;
    const urls = this._urls || {};
    if (given.local_url === undefined) cfg.local_url = urls.internal || null;
    else if (!given.local_url) cfg.local_url = null;
    if (given.remote_url === undefined) cfg.remote_url = urls.external || urls.cloud || null;
    else if (!given.remote_url) cfg.remote_url = null;
    return cfg;
  }

  // Looks things up again if Home Assistant's lists changed (or `force`), and
  // has the wall rebuilt when the outcome is a different one.
  _discover(force) {
    if (!this._given) return;
    const hass = this._hass;
    const seen = this._seen || {};
    const comps = hass && hass.config && hass.config.components;
    const same = hass && seen.entities === hass.entities && seen.devices === hass.devices && seen.comps === comps && seen.card === !!customElements.get("protect-detection-card");
    if (!force && same && this._found) return;
    this._seen = hass ? { entities: hass.entities, devices: hass.devices, comps, card: !!customElements.get("protect-detection-card") } : {};
    const g = this._given;
    if (hass && this._urls === undefined && (g.local_url === undefined || g.remote_url === undefined)) {
      // Home Assistant's own addresses, asked once (the answer comes later)
      this._urls = null;
      this._urlsAsked = Promise.resolve(hass.callWS({ type: "network/url" })).then(
        (urls) => {
          this._urls = urls && typeof urls === "object" ? urls : {};
          this._discover(true);
          if (!this._built && this._hass) this._build();
        },
        () => {
          this._urls = {};
        }
      );
    }
    if (hass && !customElements.get("protect-detection-card") && !this._waitCard) {
      // the History card is a resource of its own and may arrive a moment later
      this._waitCard = true;
      this._cardAsked = customElements.whenDefined("protect-detection-card").then(() => {
        this._discover(true);
        if (!this._built && this._hass) this._build();
      });
    }
    const cfg = this._resolve();
    const sig = JSON.stringify([cfg.cameras, cfg.alarm, cfg.history, cfg.local_url, cfg.remote_url]);
    if (this._found && sig === this._foundSig) return;
    const camsChanged = this._found && JSON.stringify(cfg.cameras) !== JSON.stringify(this._config.cameras);
    this._found = true;
    this._foundSig = sig;
    this._config = cfg;
    this._built = false;
    this._failedConfig = null;
    // an open camera dialog points at the old list
    if (camsChanged && this._liveIndex != null && this._closeLive) this._closeLive();
  }

  set hass(hass) {
    this._hass = hass;
    this._discover(false);
    if (!this._built) {
      // a config that failed to build is not retried on every state change
      if (this._failedConfig !== this._config) this._build();
      return;
    }
    if (this._alarmCard) this._alarmCard.hass = hass;
    if (this._historyCard) this._historyCard.hass = hass;
    const camHass = this._cameraHass(hass);
    for (const card of this._camCards) if (card) card.hass = camHass;
    for (const x of this._xTiles || []) x.card.hass = hass;
    this._updateLive();
  }

  /**
   * HA rotates every camera's access token each 5 minutes, which changes the
   * entity's attributes and makes camera cards tear down and restart their
   * live player (a visible blink). Live video doesn't use that token, so the
   * camera cards are handed a view of hass where a camera's state only
   * changes when something other than the token changes.
   */
  _cameraHass(hass) {
    this._frozen = this._frozen || {};
    let changed = false;
    const ids = new Set(this._config.cameras.flatMap((c) => [c.entity, c.tap_entity].filter(Boolean)));
    for (const id of ids) {
      const cur = hass.states[id];
      const old = this._frozen[id];
      if (cur && (!old || !CameraWallCard._sameIgnoringToken(old, cur))) {
        this._frozen[id] = cur;
        changed = true;
      }
    }
    if (!this._camHass || changed || this._camHassBase !== hass) {
      this._camHassBase = hass;
      this._camHass = { ...hass, states: { ...hass.states, ...this._frozen } };
    }
    return this._camHass;
  }

  /**
   * Does HA answer at this address from this browser? Going from the public
   * (https) page to the plain-http home address is a "local network" request:
   * the browser may ask once for permission to reach devices on the network.
   */
  static async _reachable(target) {
    const insecureFromSecure = location.protocol === "https:" && target.protocol === "http:";
    // the first time, the browser shows its permission prompt: give time to answer it
    let wait = 4000;
    if (insecureFromSecure) {
      try {
        const perm = await navigator.permissions.query({ name: "local-network-access" });
        if (perm.state === "prompt") wait = 30000;
      } catch (e) {}
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), wait);
    const url = `${target.origin}/manifest.json?_=${Date.now()}`;
    const opts = { mode: "no-cors", cache: "no-store", signal: ctl.signal };
    try {
      await fetch(url, insecureFromSecure ? { ...opts, targetAddressSpace: "local" } : opts);
      return true;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  static _sameIgnoringToken(a, b) {
    if (a.state !== b.state) return false;
    const skip = new Set(["access_token", "entity_picture"]);
    const keys = new Set([...Object.keys(a.attributes), ...Object.keys(b.attributes)]);
    for (const k of keys) {
      if (skip.has(k)) continue;
      if (JSON.stringify(a.attributes[k]) !== JSON.stringify(b.attributes[k])) return false;
    }
    return true;
  }

  getCardSize() {
    return 12;
  }

  // One build at a time. A config that arrives while one is under way is
  // built right after it, and a build that throws doesn't block the next.
  async _build() {
    if (this._building) return; // the loop below picks up a newer config
    this._building = true;
    let cfg;
    try {
      // what is being looked up arrives within moments: better a short wait
      // than building the wall twice (the feeds would start over)
      const g = this._given || {};
      const waits = [];
      if (this._urls === null && this._urlsAsked) waits.push(this._urlsAsked);
      const comps = (this._hass && this._hass.config && this._hass.config.components) || [];
      if (g.history === undefined && comps.includes("protect_detections") && !customElements.get("protect-detection-card") && this._cardAsked) waits.push(this._cardAsked);
      if (waits.length) await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 2000))]);
      do {
        cfg = this._config;
        await this._buildOnce(cfg);
      } while (cfg !== this._config);
      this._built = true;
      requestAnimationFrame(() => this._layout());
    } catch (err) {
      console.error("camera-wall-card: couldn't build", err);
      this._failedConfig = cfg;
      const root = this.shadowRoot || this.attachShadow({ mode: "open" });
      const alert = document.createElement("ha-alert");
      alert.setAttribute("alert-type", "error");
      alert.setAttribute("title", "Camera wall couldn't be built");
      alert.textContent = String((err && err.message) || err);
      root.replaceChildren(alert);
      this._grid = null;
    } finally {
      this._building = false;
    }
    // a config that came in just as a build failed
    if (!this._built && this._hass && this._config !== cfg) this._build();
  }

  async _buildOnce(cfg) {
    const helpers = await window.loadCardHelpers();

    // (arranging stops with a rebuild: its handles go with the old tiles)
    this._arranging = false;
    this._arrEdit = null;
    this._arrEls = null;
    this._eff = null;
    if (this._hass) this._arrLoad();
    const canArrange = cfg.arrange !== false && cfg.cameras.length > 0;
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          align-items: center;
          box-sizing: border-box;
          padding: ${PAD}px;
          gap: ${GAP}px;
        }
        /* alarm centred, History at the right edge */
        .top {
          flex: none;
          width: 100%;
          display: grid;
          grid-template-columns: 1fr minmax(0, 440px) 1fr;
          gap: ${GAP}px;
          align-items: center;
          position: relative;
          z-index: 2;
        }
        .alarm { grid-column: 2; min-width: 0; }
        /* Local / Remote address switch, left edge */
        .route { grid-column: 1; grid-row: 1; justify-self: start; display: inline-flex; height: 56px; box-sizing: border-box; padding: 4px;
          gap: 4px; border-radius: var(--ha-card-border-radius, 18px); border: 1px solid var(--divider-color, #333);
          background: var(--card-background-color, #111); }
        .route button { font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; border: 0; padding: 0 12px;
          border-radius: 14px; background: none; color: var(--secondary-text-color); display: inline-flex; align-items: center; gap: 6px; }
        .route button ha-icon { --mdc-icon-size: 18px; }
        .route button.busy { opacity: .6; cursor: progress; }
        .route button.fail { color: var(--error-color, #f87171); }
        .route button.on { background: color-mix(in srgb, var(--primary-color) 30%, transparent); color: var(--primary-text-color); cursor: default; }
        @media (max-width: 700px) { .route span { display: none; } }
        .right { grid-column: 3; justify-self: end; display: inline-flex; align-items: center; gap: ${GAP}px; }
        .hist { position: relative; }
        .arr-btn { cursor: pointer; width: 56px; height: 56px; padding: 0; border-radius: var(--ha-card-border-radius, 18px);
          border: 1px solid var(--divider-color, #333); background: var(--card-background-color, #111); color: var(--primary-text-color);
          display: inline-grid; place-items: center; --mdc-icon-size: 20px; }
        .arr-btn.on { border-color: var(--primary-color); color: var(--primary-color); }
        /* arranging the wall */
        .arrbar { flex: none; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; max-width: 100%;
          box-sizing: border-box; padding: 8px 12px; border-radius: 14px; border: 1px solid var(--primary-color);
          background: var(--card-background-color, #111); color: var(--primary-text-color); font-size: 14px; }
        .arrbar[hidden] { display: none; }
        .arrbar span { margin-right: 6px; color: var(--secondary-text-color); }
        .arrbar button { font: inherit; cursor: pointer; border-radius: 999px; padding: 6px 14px; border: 1px solid var(--divider-color, #444);
          background: none; color: var(--primary-text-color); }
        .arrbar button.main { border-color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 40%, transparent); }
        .grid.spans > .tile { overflow: hidden; background: #000; border-radius: var(--ha-card-border-radius, 12px); display: grid; align-content: center; }
        .arr { position: absolute; inset: 0; z-index: 3; box-sizing: border-box; border: 2px dashed var(--primary-color);
          border-radius: var(--ha-card-border-radius, 12px); background: rgba(0,0,0,.3); cursor: grab; touch-action: pan-y;
          user-select: none; -webkit-user-select: none; color: #fff; }
        .arr .grip, .arr .size { position: absolute; width: 44px; height: 44px; display: grid; place-items: center; touch-action: none;
          background: rgba(0,0,0,.6); --mdc-icon-size: 22px; }
        .arr .grip { left: 0; top: 0; border-radius: 10px 0 10px 0; cursor: grab; }
        .arr .size { right: 0; bottom: 0; border-radius: 10px 0 10px 0; cursor: nwse-resize; }
        .arr .dim { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font: inherit; font-size: 14px; font-weight: 600;
          cursor: pointer; color: #fff; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.5); background: rgba(0,0,0,.6); white-space: nowrap; }
        ${MENU_STYLE}
        .zmenu-back.wall { position: fixed; z-index: 9; }
        .zmenu.wall { position: fixed; z-index: 10; max-height: calc(100vh - 16px); overflow-y: auto; }
        .zmenu button b { margin-left: auto; font-weight: 400; color: #9ca3af; }
        .none[hidden] { display: none; }
        .none button { font: inherit; cursor: pointer; margin-top: 12px; padding: 8px 18px; border-radius: 999px; border: 1px solid var(--primary-color);
          background: color-mix(in srgb, var(--primary-color) 30%, transparent); color: var(--primary-text-color); }
        .tile.dragging { z-index: 5; opacity: .85; }
        .tile.dragging .arr { cursor: grabbing; }
        .tile.drop .arr { background: color-mix(in srgb, var(--primary-color) 45%, transparent); border-style: solid; }
        .arr .mv { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 8px; }
        .arr .mv button { width: 44px; height: 44px; padding: 0; cursor: pointer; border-radius: 50%; border: 1px solid rgba(255,255,255,.5);
          background: rgba(0,0,0,.6); color: #fff; display: grid; place-items: center; --mdc-icon-size: 22px; }
        .arrbar .grp { display: inline-flex; align-items: center; gap: 4px; }
        .arrbar .grp button { padding: 4px 11px; font-weight: 600; }
        .arrbar .grp b { min-width: 16px; text-align: center; }
        .arrbar .why { flex-basis: 100%; text-align: center; color: var(--error-color, #f87171); }
        .arrbar .why:empty { display: none; }
        /* the grid's cells, shown while arranging */
        .cell { box-sizing: border-box; border: 1px dashed color-mix(in srgb, var(--primary-text-color) 35%, transparent);
          border-radius: var(--ha-card-border-radius, 12px); pointer-events: none; }
        .cell.on { background: color-mix(in srgb, var(--primary-color) 40%, transparent); border-style: solid; border-color: var(--primary-color); }
        .cell.bad { background: color-mix(in srgb, var(--error-color, #e0102a) 35%, transparent); border-color: var(--error-color, #e0102a); }
        .hist-btn {
          font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; height: 56px; padding: 0 18px;
          border-radius: var(--ha-card-border-radius, 18px); border: 1px solid var(--divider-color, #333);
          background: var(--card-background-color, #111); color: var(--primary-text-color);
          display: inline-flex; align-items: center; gap: 8px;
        }
        .hist-btn ha-icon { --mdc-icon-size: 20px; }
        .hist-btn .count { min-width: 20px; padding: 0 6px; height: 20px; border-radius: 10px; font-size: 12px;
          display: inline-grid; place-items: center; background: var(--primary-color); color: #fff; }
        .hist-btn .count[hidden] { display: none; }
        .hist-btn .live { width: 8px; height: 8px; border-radius: 50%; background: var(--primary-color);
          animation: pulse 1.2s infinite; }
        .hist-btn .live[hidden] { display: none; }
        @keyframes pulse { 50% { opacity: .25; } }
        .stage {
          flex: 1 1 auto;
          width: 100%;
          display: flex;
          align-items: center;      /* vertical centering */
          justify-content: center;  /* horizontal centering */
        }
        .grid {
          display: grid;
          gap: ${GAP}px;
          justify-content: center;
        }
        .grid > * {
          display: block;
          min-width: 0;
          position: relative;
        }
        .grid > .cell { position: static; }
        .tile > :first-child { display: block; }
        /* a zone of this camera is occupied (needs Protect Zones) */
        .zone-badge { position: absolute; left: 10px; top: 10px; max-width: calc(100% - 56px); box-sizing: border-box; z-index: 1;
          pointer-events: none; display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;
          font-size: 12px; font-weight: 500; line-height: 16px; background: rgba(0,0,0,.65); color: #fff; }
        .zone-badge[hidden] { display: none; }
        .zone-badge i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dot, #38bdf8); }
        .zone-badge span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        /* a camera with a detection in progress: a pulsing red outline */
        .grid > .detecting { border-radius: var(--ha-card-border-radius, 12px); animation: detecting 1.2s ease-in-out infinite; }
        @keyframes detecting {
          0%, 100% { box-shadow: 0 0 0 3px var(--error-color, #e0102a), 0 0 16px 2px color-mix(in srgb, var(--error-color, #e0102a) 65%, transparent); }
          50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--error-color, #e0102a) 25%, transparent), 0 0 0 0 transparent; }
        }
        @media (prefers-reduced-motion: reduce) {
          .grid > .detecting { animation: none; box-shadow: 0 0 0 3px var(--error-color, #e0102a); }
        }
        /* a tile whose stream is released while a dialog is open: its last frame */
        .paused { position: relative; overflow: hidden; background: #000; box-sizing: border-box;
          border-radius: var(--ha-card-border-radius, 12px); border: 1px solid var(--ha-card-border-color, var(--divider-color, #333)); }
        .paused canvas, .paused img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .paused img:not([src]) { visibility: hidden; }
        .paused .name { position: absolute; left: 0; right: 0; bottom: 0; padding: 16px; font-size: 16px; line-height: 16px;
          color: var(--ha-picture-card-text-color, #fff); background: var(--ha-picture-card-background-color, rgba(0,0,0,.3)); }
        .none { max-width: 460px; margin: 40px auto; padding: 0 16px; text-align: center; line-height: 1.5; color: var(--secondary-text-color, #9ca3af); }
        .paused .mark { position: absolute; right: 10px; top: 10px; width: 28px; height: 28px; border-radius: 50%;
          display: grid; place-items: center; background: rgba(0,0,0,.55); color: #fff; --mdc-icon-size: 18px; }
      </style>
      ${cfg.alarm || cfg.history || canArrange || (cfg.local_url && cfg.remote_url && !inCompanionApp()) ? `<div class="top">
        ${cfg.local_url && cfg.remote_url && !inCompanionApp() ? `<div class="route">
          <button data-url="${cfg.local_url}" title="Use the home-network address (direct, full quality)"><ha-icon icon="mdi:lan"></ha-icon><span>Local</span></button>
          <button data-url="${cfg.remote_url}" title="Use the public address (works anywhere)"><ha-icon icon="mdi:cloud-outline"></ha-icon><span>Remote</span></button>
        </div>` : ""}
        ${cfg.alarm ? '<div class="alarm"></div>' : ""}
        <div class="right">
        ${canArrange ? '<button class="arr-btn" title="Arrange the cameras: move them and change their size"><ha-icon icon="mdi:view-dashboard-edit-outline"></ha-icon></button>' : ""}
        ${cfg.history ? `<div class="hist">
          <button class="hist-btn" title="Detection history"><ha-icon icon="mdi:history"></ha-icon>History<span class="count" hidden></span><span class="live" hidden title="Detections in progress"></span></button>
        </div>` : ""}
        </div>
      </div>` : ""}
      <div class="arrbar" hidden></div>
      <div class="stage"><div class="grid"></div>${cfg.cameras.length ? "" : `<div class="none">${
        cfg.auto_cameras
          ? "No UniFi Protect cameras were found in Home Assistant. They appear here by themselves once the UniFi Protect integration has cameras, or list them under <code>cameras:</code>."
          : "No cameras to show."
      }</div>`}<div class="none allgone" hidden>Nothing is on the wall.<br><button type="button" class="add-btn">Add…</button></div></div>
    `;

    // Local / Remote: jump to the same page on the other address
    for (const b of root.querySelectorAll(".route button")) {
      const target = new URL(b.dataset.url);
      const here = target.origin === location.origin;
      b.classList.toggle("on", here);
      b.onclick = async () => {
        if (here || b.classList.contains("busy")) return;
        const go = () => (location.href = target.origin + location.pathname + location.search);
        if (b.classList.contains("fail")) return go(); // second click: go anyway
        const label = b.querySelector("span");
        const name = label.textContent;
        b.classList.add("busy");
        label.textContent = "Checking…";
        const ok = await CameraWallCard._reachable(target);
        b.classList.remove("busy");
        if (ok) return go();
        // stay put rather than land on a dead page
        b.classList.add("fail");
        label.textContent = "Unreachable";
        b.title = `${target.origin} did not answer from here. Click again to go anyway.`;
        setTimeout(() => {
          b.classList.remove("fail");
          label.textContent = name;
        }, 6000);
      };
    }

    this._cards = [];
    this._camCards = [];
    this._alarmCard = null;
    if (cfg.alarm) {
      const alarm = helpers.createCardElement({
        type: "tile",
        entity: cfg.alarm,
        name: cfg.alarm_name || "Alarm",
        features: [{ type: "alarm-modes", modes: cfg.alarm_modes }],
        features_position: "inline",
      });
      root.querySelector(".alarm").appendChild(alarm);
      this._cards.push(alarm);
      this._alarmCard = alarm;
    }

    // The history card outlives a rebuild: it is given the new config rather
    // than replaced (a new one each time left the old one's work behind).
    let hist = this._historyCard;
    this._historyCard = null;
    if (hist) hist.removeEventListener("history-count", this._onHistCount);
    if (cfg.history) {
      // the history card is a separate resource: make sure it is defined first
      await Promise.race([customElements.whenDefined("protect-detection-card"), new Promise((r) => setTimeout(r, 5000))]);
      const histCfg = {
        type: "custom:protect-detection-card",
        embedded: true,
        cameras: cfg.history,
        aspect_ratio: cfg.aspect_ratio,
      };
      if (hist && hist.localName === "protect-detection-card") hist.setConfig(histCfg);
      else hist = helpers.createCardElement(histCfg);
      const btn = root.querySelector(".hist-btn");
      const count = root.querySelector(".count");
      const live = root.querySelector(".hist-btn .live");
      hist.style.display = "none";
      this._onHistCount = (ev) => {
        count.textContent = ev.detail.hour;
        count.hidden = !ev.detail.hour;
        count.title = `${ev.detail.hour} detection(s) in the last hour`;
        live.hidden = !ev.detail.live;
        this._detecting = new Set(ev.detail.cameras || []);
        this._markDetecting();
      };
      hist.addEventListener("history-count", this._onHistCount);
      // the History lightbox covers the wall too: the tiles rest while it is open
      this._onHistOpen = this._onHistOpen || ((ev) => {
        this._histOpen = !!ev.detail.open;
        this._syncPause();
      });
      hist.addEventListener("history-open", this._onHistOpen); // the same function each time: added once
      root.querySelector(".hist").appendChild(hist); // the lightbox itself opens over the page
      this._historyCard = hist;
      btn.onclick = () => hist.open?.(); // a centred dialog; its expand button makes it bigger
    }

    const grid = root.querySelector(".grid");
    this._helpers = helpers;
    this._builtCfg = cfg;
    this._pausedTiles = null; // any placeholders went with the old content
    // each feed sits in a tile of its own, which also carries its zone badge
    this._tiles = [];
    this._badges = [];
    // the feeds are made in the shape their tiles will have
    if (cfg === this._config && cfg.cameras.length) this._plan();
    for (const i of cfg.cameras.keys()) {
      // (a camera the user took off the wall gets no feed at all)
      const off = cfg === this._config && this._isHidden(this._camKey(cfg.cameras[i]));
      const card = off ? null : this._makeCamCard(cfg, i);
      const tile = document.createElement("div");
      tile.className = "tile";
      if (off) tile.style.display = "none";
      const badge = document.createElement("div");
      badge.className = "zone-badge";
      badge.hidden = true;
      badge.append(document.createElement("i"), document.createElement("span"));
      if (card) tile.append(card, badge);
      else tile.append(badge);
      grid.appendChild(tile);
      this._tiles.push(tile);
      this._badges.push(badge);
      this._cards.push(card);
      this._camCards.push(card);
    }
    if (this._alarmCard) this._alarmCard.hass = this._hass;
    if (this._historyCard) this._historyCard.hass = this._hass;
    const camHass = this._cameraHass(this._hass);
    for (const card of this._camCards) if (card) card.hass = camHass;

    this._grid = grid;
    this._alarmEl = root.querySelector(".top");
    if (!this._observer) {
      this._observer = new ResizeObserver(() => this._layout());
      this._onWindowResize = () => this._layout();
    }
    if (this.isConnected) {
      // (else connectedCallback does this)
      this._observer.observe(this);
      if (this._alarmEl) this._observer.observe(this._alarmEl);
      window.addEventListener("resize", this._onWindowResize);
    }
    this._wMenuClose();
    this._wMenuWire(root.querySelector(".stage"));
    const addBtn = root.querySelector(".add-btn");
    if (addBtn) addBtn.onclick = (ev) => this._wMenuOpen(ev.clientX || window.innerWidth / 2, ev.clientY || window.innerHeight / 2, (kit) => [kit.head("Add to the wall"), ...this._menuAdd(kit, null)]);
    this._xTiles = null;
    this._applyShown();
    if (cfg.tracking !== false || cfg.live_tracks !== false) this._ltAsk();
    this._trackTiles(); // (if it is known already which cameras get one)
    const arrBtn = root.querySelector(".arr-btn");
    if (arrBtn) arrBtn.onclick = () => (this._arranging ? this._arrExit("cancel") : this._arrEnter());
    this._arrLoad();
    this._syncPause(); // rebuilt with a dialog open: the new tiles rest too
    this._markDetecting();
    this._startZones(); // (or stops them, if the new config says so)
    this._markZones();
    this._fitZones();
  }

  // Outline the tiles of cameras that have a detection in progress (reported
  // by the history card, so this needs `history:` in the config).
  _markDetecting() {
    if (!this._tiles || !this._builtCfg) return;
    const on = this._historyCard ? this._detecting || new Set() : new Set();
    this._builtCfg.cameras.forEach((cam, i) => {
      const tile = this._tiles[i];
      if (tile) tile.classList.toggle("detecting", on.has(cam.entity) || on.has(cam.tap_entity));
    });
  }

  // ------------------------------------------------------------ zones
  //
  // Optional, from the Protect Zones integration: where each camera's zones
  // are and which are occupied. Asked for once; if that integration isn't
  // there (or the request fails) the wall simply goes without.

  _startZones() {
    if (!this._config || this._config.zone_overlay === false) return this._stopZones();
    if (this._zonesUnsub || this._zonesAsk || this._zonesOff || !this.isConnected) return;
    const conn = this._hass && this._hass.connection;
    if (!conn || !conn.subscribeMessage) return;
    const ask = (this._zonesAsk = this._zonesFeed = {});
    const failed = () => {
      if (this._zonesAsk !== ask) return;
      this._zonesAsk = this._zonesFeed = null;
      this._zonesOff = true; // not asked again until the wall is next put on the page
    };
    let pending;
    try {
      pending = conn.subscribeMessage((msg) => this._zonesFeed === ask && this._onZones(msg), {
        type: "protect_zones/overlay/subscribe",
      });
    } catch (e) {
      return failed();
    }
    Promise.resolve(pending).then((unsub) => {
      if (this._zonesAsk !== ask) {
        // the wall left the page (or zones were switched off) meanwhile
        try { Promise.resolve(unsub()).catch(() => {}); } catch (e) {}
        return;
      }
      this._zonesAsk = null;
      this._zonesUnsub = unsub;
      if (this._zones) return;
      // nothing pushed yet: ask for the current state once
      this._hass
        .callWS({ type: "protect_zones/overlay" })
        .then((r) => {
          if (this._zonesFeed === ask && !this._zones) this._onZones(r);
        })
        .catch(() => {});
    }, failed);
  }

  _stopZones() {
    const unsub = this._zonesUnsub;
    this._zonesUnsub = this._zonesAsk = this._zonesFeed = null;
    if (unsub) {
      try { Promise.resolve(unsub()).catch(() => {}); } catch (e) {}
    }
    if (!this._zones) return;
    this._zones = null;
    this._markZones();
    this._fitZones();
  }

  _onZones(msg) {
    const cams = msg && msg.cameras && typeof msg.cameras === "object" ? msg.cameras : {};
    this._zones = cams;
    this._zonesEditable = !!msg && msg.editable === true; // admins only, says the server
    this._zonesByMac = new Map();
    for (const cam of Object.values(cams)) {
      if (cam && cam.mac) this._zonesByMac.set(normMac(cam.mac), cam);
    }
    this._zonesRev = (this._zonesRev || 0) + 1;
    this._markZones();
    this._fitZones();
  }

  // The zones of one of the wall's cameras: by the Protect id in the config
  // if given, else by the MAC address of the device its entity belongs to.
  _zoneCam(cam) {
    if (!this._zones || !cam) return null;
    if (cam.protect_id && this._zones[cam.protect_id]) return this._zones[cam.protect_id];
    const hass = this._hass || {};
    for (const id of [cam.entity, cam.tap_entity]) {
      const dev = id && hass.entities && hass.entities[id] && hass.devices && hass.devices[hass.entities[id].device_id];
      for (const [kind, value] of (dev && dev.connections) || []) {
        const hit = kind === "mac" && this._zonesByMac.get(normMac(value));
        if (hit) return hit;
      }
    }
    return null;
  }

  static _zoneColor(zone) {
    return /^#[0-9a-f]{6}$/i.test(zone.color || "") ? zone.color : ZONE_COLORS[zone.kind] || ZONE_COLORS.zone;
  }

  // What a zone reports seeing ("person,vehicle"), spaced for reading.
  static _zoneSeen(zone) {
    return String(zone.detected || "").split(",").map((t) => t.trim()).filter(Boolean).join(", ");
  }

  // On each feed: a small badge naming a zone that is occupied.
  _markZones() {
    if (!this._badges || !this._builtCfg) return;
    this._builtCfg.cameras.forEach((cam, i) => {
      const badge = this._badges[i];
      if (!badge) return;
      const zc = this._zoneCam(cam);
      const busy = ((zc && Array.isArray(zc.zones) && zc.zones) || []).filter((z) => z && z.occupied === true);
      badge.hidden = busy.length === 0;
      if (!busy.length) return;
      // a loiter zone and a detection zone often share a name: named once
      const names = [...new Set(busy.map((z) => z.name || "Zone"))];
      badge.lastElementChild.textContent = names[0] + (names.length > 1 ? ` +${names.length - 1}` : "");
      badge.title = `Occupied: ${names.map((n) => {
        const what = busy.filter((z) => (z.name || "Zone") === n).map((z) => CameraWallCard._zoneSeen(z)).filter(Boolean)[0];
        return what ? `${n} (${what})` : n;
      }).join("; ")}`;
      badge.style.setProperty("--dot", CameraWallCard._zoneColor(busy[0]));
    });
  }

  _zonesWanted() {
    let v = null;
    try {
      v = localStorage.getItem(ZONES_KEY);
    } catch (e) {}
    return v !== "0";
  }

  // In the live dialog: put the zone layer exactly over the picture and draw
  // it. Called on every change and a few times a second while the dialog is
  // open; it only redraws when the picture's place or the zones changed.
  _fitZones() {
    const root = this._liveRoot;
    if (!root || this._liveIndex == null) return;
    const svg = root.querySelector(".zones");
    const note = root.querySelector(".zone-note");
    const btn = root.querySelector(".zbtn");
    if (!svg || !note || !btn) return;
    let ed = this._zEdit;
    if (ed && ed.drag != null) return; // a point is being dragged: nothing moves under the pointer
    const zc = this._zoneCam(this._config.cameras[this._liveIndex]);
    const has = !!zc && Array.isArray(zc.zones) && zc.zones.length > 0;
    if (ed && (!has || normMac(zc.mac) !== normMac(ed.mac))) {
      this._zEditEnd(); // its camera's zones are gone
      ed = null;
    }
    const show = has && (this._zonesWanted() || !!ed);
    btn.hidden = !has;
    btn.classList.toggle("on", show);
    // a camera that has turned away from where its zones were drawn
    const away = show && zc.aligned === false && !ed;
    note.hidden = !away;
    let box = null;
    if (has && this._liveStream) {
      for (const el of findVideos(this._liveStream, [], ["VIDEO", "IMG"])) {
        const b = pictureBox(el, this._rect(el));
        if (b && (!box || b.width * b.height > box.width * box.height)) box = b;
      }
    }
    this._zPic = box; // where the picture is on screen (for the menu and for dragging)
    if (!box || !show || away) {
      svg.style.display = "none";
      this._zonesDrawn = null;
      return;
    }
    // the layer sits inside the element that zooms: placed in that element's own pixels
    const frame = this._rect(root.querySelector(".zoom"));
    const k = (this._zoom && this._zoom.s) || 1;
    const place = [(box.left - frame.left) / k, (box.top - frame.top) / k, box.width / k, box.height / k].map((n) => Math.round(n));
    const key = `${place.join()}|${this._zonesRev}|${this._liveIndex}|${ed ? `${ed.kind}${ed.id}:${ed.rev}` : ""}`;
    if (key === this._zonesDrawn) return;
    this._zonesDrawn = key;
    const [left, top, w, h] = place;
    svg.style.cssText = `display:block;left:${left}px;top:${top}px;width:${w}px;height:${h}px;--k:${(1 / k).toFixed(4)}`;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.replaceChildren();
    const labels = [];
    const seen = new Set(); // outlines and names already drawn
    for (const zone of zc.zones) {
      // the zone being edited is drawn below, from the edit; its other half
      // (which will change with it) isn't shown at the old place
      if (ed && zone && ((zone.kind === ed.kind && zone.id === ed.id) || ed.partners.some((q) => q.kind === zone.kind && q.id === zone.id))) continue;
      const pts = zonePoints(zone).map((p) => [p[0] * w, p[1] * h]);
      const line = zone.kind === "line";
      if (pts.length < (line ? 2 : 3)) continue;
      const color = CameraWallCard._zoneColor(zone);
      const outline = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
      // Protect often has a loiter zone with the very outline of a detection
      // zone: drawn once, unless the second one is the occupied one
      if (seen.has(outline) && zone.occupied !== true) continue;
      seen.add(outline);
      const shape = document.createElementNS(SVG_NS, line ? "polyline" : "polygon");
      shape.setAttribute("points", outline);
      shape.setAttribute(
        "class",
        `shape ${line ? "line" : zone.kind === "loiter" ? "loiter" : "area"}${zone.occupied === true ? " occ" : ""}${ed ? " dim" : ""}`
      );
      shape.setAttribute("stroke", color);
      if (!line) shape.setAttribute("fill", color);
      svg.appendChild(shape);
      if (!zone.name || ed) continue; // no names while a zone is being edited
      // the name: in the middle of an area, at the middle of a line
      let at;
      if (line) {
        const a = pts[Math.floor((pts.length - 1) / 2)];
        const b = pts[Math.floor((pts.length - 1) / 2) + 1];
        at = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 12];
      } else {
        at = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
      }
      const x = Math.min(w - 8, Math.max(8, at[0])).toFixed(1);
      const y = Math.min(h - 10, Math.max(10, at[1])).toFixed(1);
      const what = zone.occupied === true ? CameraWallCard._zoneSeen(zone) : "";
      // the same name at the same spot is written once (saying what is there, if either zone does)
      const twin = labels.find((t) => t._at === `${zone.name}@${x},${y}`);
      if (twin) {
        if (what && !twin._what) twin.textContent = `${zone.name} · ${(twin._what = what)}`;
        continue;
      }
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", x);
      text.setAttribute("y", y);
      text._at = `${zone.name}@${x},${y}`;
      text._what = what;
      text.textContent = what ? `${zone.name} · ${what}` : zone.name;
      labels.push(text);
    }
    svg.append(...labels); // names on top of every shape
    if (ed) this._zEditDraw(svg, w, h);
  }

  // ------------------------------------------------------- editing zones
  //
  // For admins (the server says who): right-click, or a long press, on the
  // picture in the live dialog opens a menu for the zone there. Its shape is
  // edited with a handle on each point; nothing is sent until Save. Outside
  // of that the zone layer takes no clicks at all.

  // Protect keeps a detection zone and a loiter zone as one zone in two
  // lists (same name and outline); a change to one changes the other too.
  // The other half of such a pair, if this zone has one.
  static _zPartners(zc, zone) {
    if (!zone || zone.kind === "line") return [];
    const outline = zoneOutline(zone);
    return (zc.zones || []).filter(
      (z) => z && z !== zone && z.kind !== "line" && z.kind !== zone.kind && (z.name || "") === (zone.name || "") && zoneOutline(z) === outline
    );
  }

  static _zKindLabel(zc, zone) {
    return CameraWallCard._zPartners(zc, zone).length ? "Detection and loiter zone" : ZONE_KINDS[zone.kind] || "";
  }

  _zCanEdit(zc) {
    return !!zc && !this._zEditOff && (this._zonesEditable === true || zc.editable === true);
  }

  // Zones under a point of the picture (0..1 both ways), the smallest first.
  _zonesAt(zc, x, y) {
    const pic = this._zPic;
    if (!pic) return [];
    const p = [x * pic.width, y * pic.height];
    const hits = [];
    for (const zone of zc.zones || []) {
      const pts = zonePoints(zone).map((q) => [q[0] * pic.width, q[1] * pic.height]);
      if (zone.kind === "line") {
        if (pts.length < 2) continue;
        let near = Infinity;
        for (let i = 0; i + 1 < pts.length; i++) near = Math.min(near, nearestOnSegment(p, pts[i], pts[i + 1]).dist);
        if (near <= 12) hits.push({ zone, size: 0 });
      } else if (pts.length >= 3 && inPolygon(p, pts)) hits.push({ zone, size: polygonArea(pts) });
    }
    // a pair is one zone to the user: listed once, by its detection zone
    const zones = hits.sort((a, b) => a.size - b.size || (a.zone.kind === "zone" ? -1 : 1)).map((hit) => hit.zone);
    return zones.filter((zone, i) => !CameraWallCard._zPartners(zc, zone).some((partner) => zones.indexOf(partner) < i && zones.includes(partner)));
  }

  // A right-click or long press at these screen coordinates. True if it was
  // on the picture of a camera whose zones can be edited (the browser's own
  // menu is then not wanted); false leaves it to the browser.
  _zoneContext(clientX, clientY) {
    if (this._liveIndex == null) return false;
    [clientX, clientY] = this._pt(clientX, clientY); // (as the dialog sees it, from here on)
    const zc = this._zoneCam(this._config.cameras[this._liveIndex]);
    const pic = this._zPic;
    if (!this._zCanEdit(zc) || !pic) return false;
    const x = (clientX - pic.left) / pic.width;
    const y = (clientY - pic.top) / pic.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return false;
    if (this._zEdit || Date.now() - (this._zHeldAt || 0) < 800) return true; // editing: no menu
    const drawn = this._zonesWanted() && zc.aligned !== false;
    this._zMenuAt(clientX, clientY, zc, drawn ? this._zonesAt(zc, x, y) : []);
    return true;
  }

  _zMenuClose() {
    if (!this._zMenu) return;
    this._zMenu.back.remove();
    this._zMenu.menu.remove();
    this._zMenu = null;
  }

  _zMenuAt(clientX, clientY, zc, hits) {
    this._zMenuClose();
    const back = document.createElement("div");
    back.className = "zmenu-back";
    const menu = document.createElement("div");
    menu.className = "zmenu";
    back.addEventListener("pointerdown", () => this._zMenuClose());
    back.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      this._zMenuClose();
    });
    menu.addEventListener("contextmenu", (ev) => ev.preventDefault());
    this._liveRoot.querySelector(".wrap").append(back, menu);
    this._zMenu = { back, menu };
    const item = (label, fn, color) => {
      const b = document.createElement("button");
      b.type = "button";
      if (color) {
        const dot = document.createElement("i");
        dot.style.background = color;
        b.appendChild(dot);
      }
      b.appendChild(document.createTextNode(label));
      b.onclick = () => fn();
      return b;
    };
    const head = (title, sub) => {
      const el = document.createElement("span");
      el.className = "head";
      el.textContent = title;
      if (sub) {
        const small = document.createElement("small");
        small.textContent = sub;
        el.appendChild(small);
      }
      return el;
    };
    const general = () => {
      const wanted = this._zonesWanted();
      const track = this._trackSwitch(this._config.cameras[this._liveIndex]);
      const tracking = track && this._hass.states[track];
      const items = [];
      if (tracking) {
        // the camera's own switch: for the whole camera, whichever zone was picked
        const known = tracking.state === "on" || tracking.state === "off";
        const b = item(known ? `Person tracking is ${tracking.state} · turn ${tracking.state === "on" ? "off" : "on"}` : "Person tracking isn't available", () => {
          this._zMenuClose();
          this._trackToggle(track);
        });
        b.disabled = !known;
        items.push(b);
      }
      return [
        ...items,
        item("Undo last zone change", () => {
          this._zMenuClose();
          this._zUndo(zc.mac);
        }),
        item(wanted ? "Hide zones" : "Show zones", () => {
          this._zMenuClose();
          this._zonesToggle();
        }),
      ];
    };
    const forZone = (zone) => {
      const go = (fn) => () => {
        this._zMenuClose();
        fn.call(this, zc, zone);
      };
      // what it detects is kept per list, so a pair gets an item for each half
      // (and none at all from a Protect Zones that doesn't say)
      const detect = [zone, ...CameraWallCard._zPartners(zc, zone)]
        .filter((z) => (z.kind === "zone" && z.types !== undefined) || (z.kind === "loiter" && z.dwell !== undefined))
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "zone" ? -1 : 1))
        .map((z) => item(z.kind === "zone" ? "Edit detections" : "Edit loiter times", () => {
          this._zMenuClose();
          this._zDetect(zc, z);
        }));
      menu.replaceChildren(
        head(zone.name || "Zone", CameraWallCard._zKindLabel(zc, zone)),
        item("Edit shape", go(this._zEditStart)),
        item("Rename", go(this._zRename)),
        item("Change colour", go(this._zRecolor)),
        ...detect,
        document.createElement("hr"),
        ...general()
      );
      fit();
    };
    const fit = () => {
      // kept on screen
      const mw = menu.offsetWidth || 220;
      const mh = menu.offsetHeight || 200;
      const [vw, vh] = this._view();
      menu.style.left = `${Math.max(8, Math.min(clientX, vw - mw - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(clientY, vh - mh - 8))}px`;
    };
    if (hits.length === 1) return forZone(hits[0]);
    if (hits.length > 1) {
      // zones on top of each other: say which one
      menu.replaceChildren(
        head("Which zone?"),
        ...hits.map((zone) =>
          item(`${zone.name || "Zone"} · ${CameraWallCard._zKindLabel(zc, zone) || zone.kind}`, () => forZone(zone), CameraWallCard._zoneColor(zone))
        ),
        document.createElement("hr"),
        ...general()
      );
    } else menu.replaceChildren(...general());
    fit();
  }

  _zonesToggle() {
    try {
      localStorage.setItem(ZONES_KEY, this._zonesWanted() ? "0" : "1");
    } catch (e) {}
    this._fitZones();
  }

  // The small bar at the top of the picture: what is being edited, a field
  // to fill in, or a message. `buttons`: [label, what it does, is it the main one].
  _zBar(mode, text, { hint, input, buttons = [], error = false, hideAfter = 0 } = {}) {
    const bar = this._liveRoot && this._liveRoot.querySelector(".zbar");
    if (!bar) return;
    clearTimeout(this._zBarTimer);
    this._zBarMode = mode;
    this._zBarCancel = null;
    bar.hidden = !mode;
    bar.classList.toggle("error", !!error);
    bar.replaceChildren();
    if (!mode) return;
    const msg = document.createElement("span");
    msg.className = "msg";
    msg.textContent = text;
    if (hint) {
      const small = document.createElement("small");
      small.textContent = hint;
      msg.appendChild(small);
    }
    bar.appendChild(msg);
    if (input) bar.appendChild(input);
    for (const [label, fn, main] of buttons) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (main) b.className = "main";
      b.onclick = () => fn();
      bar.appendChild(b);
    }
    const err = document.createElement("span");
    err.className = "err";
    err.hidden = true;
    bar.appendChild(err);
    if (hideAfter) this._zBarTimer = setTimeout(() => this._zBarMode === mode && this._zBar(null), hideAfter);
  }

  // A problem with what the bar is doing, shown in it (the work stays).
  _zBarError(text) {
    const bar = this._liveRoot && this._liveRoot.querySelector(".zbar");
    const err = bar && bar.querySelector(".err");
    if (!err) return;
    err.textContent = text;
    err.hidden = !text;
    for (const b of bar.querySelectorAll("button")) b.disabled = false;
  }

  _zBarBusy() {
    const bar = this._liveRoot && this._liveRoot.querySelector(".zbar");
    if (bar) for (const b of bar.querySelectorAll("button")) b.disabled = true;
  }

  // One of the zone commands. Resolves to true when it worked; a failure is
  // shown, never swallowed.
  async _zSend(msg, done, inBar) {
    if (this._zBusy) return false;
    this._zBusy = true;
    if (inBar) this._zBarBusy();
    try {
      const entry = await this._hass.callWS(msg);
      this._zApply(entry);
      this._zBusy = false;
      done();
      return true;
    } catch (err) {
      this._zBusy = false;
      const code = err && err.code;
      const text = (err && err.message) || ZONE_ERRORS[code] || code || String(err);
      if (code === "nothing_to_change") {
        // not a failure: it already was like that
        this._zEditEnd();
        this._zBar("msg", ZONE_ERRORS[code], { hideAfter: 4000 });
      } else if (code === "unknown_command") {
        // this Protect Zones can't edit: the zones stay, the editing goes
        this._zEditOff = true;
        this._zEditEnd();
        this._zBar("msg", "Zone editing isn't available: Protect Zones needs updating", { error: true, hideAfter: 8000 });
      } else if (inBar && this._zBarMode && this._zBarMode !== "msg") this._zBarError(text);
      else this._zBar("msg", text, { error: true, buttons: [["Dismiss", () => this._zBar(null)]], hideAfter: 12000 });
      return false;
    }
  }

  // A camera's zones as a command returned them (the same also arrives as
  // an update a moment later).
  _zApply(entry) {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.zones) || !this._zones) return;
    const mac = normMac(entry.mac);
    for (const [id, cam] of Object.entries(this._zones)) {
      if (!cam || !mac || normMac(cam.mac) !== mac) continue;
      this._zones[id] = { ...cam, ...entry };
      this._zonesByMac.set(mac, this._zones[id]);
      this._zonesRev = (this._zonesRev || 0) + 1;
      this._markZones();
      this._fitZones();
      return;
    }
  }

  _zSaved(text, mac) {
    this._zBar("msg", text, { buttons: [["Undo", () => this._zUndo(mac)]], hideAfter: 10000 });
  }

  _zUndo(mac) {
    this._zBar(null);
    return this._zSend({ type: "protect_zones/zone/undo", mac }, () => this._zBar("msg", "Last zone change undone", { hideAfter: 5000 }));
  }

  _zRename(zc, zone) {
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 64;
    input.value = zone.name || "";
    const save = () => {
      const name = input.value.trim();
      if (!name) return this._zBarError("Give it a name");
      if (name === (zone.name || "")) return this._zBar(null);
      return this._zSend({ type: "protect_zones/zone/update", mac: zc.mac, kind: zone.kind, zone_id: zone.id, name }, () => this._zSaved(`Renamed to ${name}`, zc.mac), true);
    };
    // typing stays in the field (arrow keys don't change camera, letters aren't HA's shortcuts)
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") return;
      ev.stopPropagation();
      if (ev.key === "Enter") save();
    });
    this._zBar("rename", `Rename ${zone.name || "zone"}`, { input, buttons: [["Save", save, true], ["Cancel", () => this._zBar(null)]] });
    this._zBarCancel = () => this._zBar(null);
    input.focus();
    input.select();
  }

  _zRecolor(zc, zone) {
    const input = document.createElement("input");
    input.type = "color";
    input.value = CameraWallCard._zoneColor(zone).toLowerCase();
    const save = () => {
      const color = String(input.value || "").toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(color)) return this._zBarError("Pick a colour");
      return this._zSend({ type: "protect_zones/zone/update", mac: zc.mac, kind: zone.kind, zone_id: zone.id, color }, () => this._zSaved(`Colour of ${zone.name || "zone"} changed`, zc.mac), true);
    };
    input.addEventListener("keydown", (ev) => ev.key !== "Escape" && ev.stopPropagation());
    this._zBar("color", `Colour of ${zone.name || "zone"}`, { input, buttons: [["Save", save, true], ["Cancel", () => this._zBar(null)]] });
    this._zBarCancel = () => this._zBar(null);
  }

  static _zTypeLabel(type) {
    return ZONE_TYPES[type] || String(type);
  }

  // What a zone detects, as the overlay has it now, in words.
  static _zDetectText(zone) {
    if (zone.kind === "loiter") {
      const dwell = zone.dwell && typeof zone.dwell === "object" ? Object.entries(zone.dwell) : [];
      return dwell.length
        ? `loiters: ${dwell.map(([t, secs]) => `${CameraWallCard._zTypeLabel(t).toLowerCase()} after ${+secs} s`).join(", ")}`
        : "has no loiter times";
    }
    const types = Array.isArray(zone.types) ? zone.types : [];
    return types.length ? `detects ${types.map((t) => CameraWallCard._zTypeLabel(t).toLowerCase()).join(", ")}` : "detects nothing";
  }

  // What a detection zone looks for (a tick per kind of thing), or how long
  // each has to stay in a loiter zone. After a save the message says what
  // Protect Zones reports back, which need not be what was asked for.
  _zDetect(zc, zone) {
    const loiter = zone.kind === "loiter";
    const dwell = loiter && zone.dwell && typeof zone.dwell === "object" ? zone.dwell : {};
    const had = loiter ? Object.keys(dwell) : Array.isArray(zone.types) ? zone.types : [];
    const box = document.createElement("div");
    box.className = "zopts";
    const rows = [];
    let save = () => {};
    const keys = (ev) => {
      if (ev.key === "Escape") return;
      ev.stopPropagation();
      if (ev.key === "Enter") {
        ev.preventDefault();
        save();
      }
    };
    for (const type of [...Object.keys(ZONE_TYPES), ...had.filter((t) => !(t in ZONE_TYPES))]) {
      const label = document.createElement("label");
      const tick = document.createElement("input");
      tick.type = "checkbox";
      tick.checked = had.includes(type);
      tick.addEventListener("keydown", keys);
      label.append(tick, document.createTextNode(CameraWallCard._zTypeLabel(type)));
      let secs = null;
      if (loiter) {
        secs = document.createElement("input");
        secs.type = "number";
        secs.min = DWELL_MIN;
        secs.max = DWELL_MAX;
        secs.step = "0.5";
        secs.inputMode = "decimal";
        secs.value = type in dwell ? String(+dwell[type]) : "10";
        secs.disabled = !tick.checked;
        secs.addEventListener("keydown", keys);
        tick.addEventListener("change", () => {
          secs.disabled = !tick.checked;
        });
        label.append(secs, document.createTextNode("s"));
      }
      box.appendChild(label);
      rows.push({ type, tick, secs });
    }
    const name = zone.name || "zone";
    save = () => {
      const msg = { type: "protect_zones/zone/update", mac: zc.mac, kind: zone.kind, zone_id: zone.id };
      const on = rows.filter((row) => row.tick.checked);
      if (loiter) {
        msg.dwell = {};
        for (const row of on) {
          const secs = Number(row.secs.value);
          if (!row.secs.value.trim() || !(secs >= DWELL_MIN && secs <= DWELL_MAX)) {
            return this._zBarError(`${CameraWallCard._zTypeLabel(row.type)}: ${DWELL_MIN} to ${DWELL_MAX} seconds`);
          }
          msg.dwell[row.type] = secs;
        }
        const same = on.length === had.length && on.every((row) => Number(dwell[row.type]) === msg.dwell[row.type]);
        if (same) return this._zBar(null);
      } else {
        msg.types = on.map((row) => row.type);
        if (msg.types.length === had.length && msg.types.every((t) => had.includes(t))) return this._zBar(null);
      }
      return this._zSend(
        msg,
        () => {
          const cam = this._zonesByMac && this._zonesByMac.get(normMac(zc.mac));
          const now = ((cam && cam.zones) || []).find((z) => z && z.kind === zone.kind && z.id === zone.id);
          this._zSaved(now ? `${now.name || name} now ${CameraWallCard._zDetectText(now)}` : `Saved ${name}`, zc.mac);
        },
        true
      );
    };
    this._zBar("detect", loiter ? `Loiter times of ${name}` : `Detections of ${name}`, {
      hint: loiter ? "Seconds each has to stay before it counts" : "",
      input: box,
      buttons: [["Save", save, true], ["Cancel", () => this._zBar(null)]],
    });
    this._zBarCancel = () => this._zBar(null);
  }

  // The camera's "Tracking: person" switch of the UniFi Protect integration,
  // found by the device the feed belongs to. Null when it has none.
  _trackSwitch(cam) {
    const hass = this._hass || {};
    if (!cam || !hass.entities || !hass.states) return null;
    const devices = [cam.entity, cam.tap_entity].map((id) => id && hass.entities[id] && hass.entities[id].device_id).filter(Boolean);
    if (!devices.length) return null;
    for (const [id, ent] of Object.entries(hass.entities)) {
      if (!id.startsWith("switch.") || !ent || !devices.includes(ent.device_id) || ent.platform !== "unifiprotect") continue;
      if ((ent.translation_key === "tracking_person" || id.endsWith("_tracking_person")) && hass.states[id]) return id;
    }
    return null;
  }

  _trackToggle(id) {
    const state = this._hass.states[id];
    if (!state) return;
    const turn = state.state === "on" ? "turn_off" : "turn_on";
    Promise.resolve(this._hass.callService("switch", turn, { entity_id: id })).then(
      () => {
        // said as the switch then reports it, not as it was asked
        setTimeout(() => {
          const now = this._hass.states[id];
          if (this._liveIndex == null || !now || (this._zBarMode && this._zBarMode !== "msg")) return;
          this._zBar("msg", `Person tracking is ${now.state === "on" || now.state === "off" ? now.state : "not available"}`, { hideAfter: 5000 });
        }, 1200);
      },
      (err) => this._zBar("msg", (err && err.message) || "Person tracking couldn't be changed", { error: true, buttons: [["Dismiss", () => this._zBar(null)]], hideAfter: 12000 })
    );
  }

  _zEditStart(zc, zone) {
    const line = zone.kind === "line";
    const min = line ? 2 : 3;
    const points = zonePoints(zone).map((p) => [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))]);
    if (points.length < min) {
      return this._zBar("msg", `The shape of ${zone.name || "this zone"} couldn't be read, so it can't be edited here`, { error: true, hideAfter: 8000 });
    }
    this._zEdit = { mac: zc.mac, kind: zone.kind, id: zone.id, name: zone.name || "zone", color: CameraWallCard._zoneColor(zone), line, min, points, rev: 0, drag: null };
    this._zEdit.partners = CameraWallCard._zPartners(zc, zone).map((z) => ({ kind: z.kind, id: z.id }));
    this._zEdit.was = JSON.stringify(points.map((p) => [+p[0].toFixed(4), +p[1].toFixed(4)]));
    let touch = false;
    try {
      touch = window.matchMedia("(pointer: coarse)").matches;
    } catch (e) {}
    this._zEdit.touch = touch;
    this._zBar("edit", `Editing ${this._zEdit.name}`, {
      hint: touch ? "Drag a point · tap an edge to add one · hold a point to remove it" : "Drag a point · click an edge to add one · right-click a point to remove it",
      buttons: [["Save", () => this._zEditSave(), true], ["Cancel", () => this._zEditEnd()]],
    });
    this._zBarCancel = () => this._zEditEnd();
    this._fitZones();
  }

  // Leave edit mode without saving.
  _zEditEnd() {
    const ed = this._zEdit;
    if (!ed) return;
    clearTimeout(ed.hold);
    this._zEdit = null;
    if (this._zBarMode === "edit") this._zBar(null);
    this._fitZones();
  }

  _zEditSave() {
    const ed = this._zEdit;
    if (!ed || ed.drag != null) return;
    const points = ed.points.map((p) => [+p[0].toFixed(4), +p[1].toFixed(4)]);
    if (JSON.stringify(points) === ed.was) {
      // nothing moved: nothing to send
      this._zEditEnd();
      return this._zBar("msg", `${ed.name} wasn't changed`, { hideAfter: 4000 });
    }
    if (new Set(points.map((q) => q.join())).size < ed.min) {
      return this._zBarError(ed.line ? "A line needs 2 different points" : "A zone needs 3 different points");
    }
    return this._zSend(
      { type: "protect_zones/zone/update", mac: ed.mac, kind: ed.kind, zone_id: ed.id, points },
      () => {
        if (this._zEdit === ed) this._zEditEnd();
        this._zSaved(`Saved ${ed.name}`, ed.mac);
      },
      true
    );
  }

  _zEditChanged() {
    const ed = this._zEdit;
    if (!ed) return;
    ed.rev++;
    this._zBarError("");
    this._fitZones();
  }

  _zEditRemove(i) {
    const ed = this._zEdit;
    if (!ed) return;
    if (ed.points.length <= ed.min) return this._zBarError(ed.line ? "A line needs at least 2 points" : "A zone needs at least 3 points");
    ed.points.splice(i, 1);
    this._zEditChanged();
  }

  // The zone being edited: its outline, an edge to click between each pair
  // of points, and a handle on each point.
  _zEditDraw(svg, w, h) {
    const ed = this._zEdit;
    const px = (p) => [p[0] * w, p[1] * h];
    const shape = document.createElementNS(SVG_NS, ed.line ? "polyline" : "polygon");
    shape.setAttribute("class", `shape edit${ed.line ? " line" : ""}`);
    shape.setAttribute("stroke", ed.color);
    if (!ed.line) shape.setAttribute("fill", ed.color);
    svg.appendChild(shape);
    const n = ed.points.length;
    const edges = [];
    for (let i = 0; i < (ed.line ? n - 1 : n); i++) {
      const edge = document.createElementNS(SVG_NS, "line");
      edge.setAttribute("class", "edge");
      edge.addEventListener("click", (ev) => {
        const pic = this._zPic;
        if (!pic || this._zEdit !== ed) return;
        ev.stopPropagation();
        if (n >= ZONE_MAX_POINTS) return this._zBarError(`A zone can have at most ${ZONE_MAX_POINTS} points`);
        const a = px(ed.points[i]);
        const b = px(ed.points[(i + 1) % n]);
        const [ex, ey] = this._pt(ev.clientX, ev.clientY);
        const at = nearestOnSegment([((ex - pic.left) / pic.width) * w, ((ey - pic.top) / pic.height) * h], a, b).at;
        ed.points.splice(i + 1, 0, [at[0] / w, at[1] / h]);
        this._zEditChanged();
      });
      svg.appendChild(edge);
      edges.push(edge);
    }
    const dots = [];
    const grabs = [];
    const place = () => {
      shape.setAttribute("points", ed.points.map((p) => px(p).map((v) => v.toFixed(1)).join(",")).join(" "));
      edges.forEach((edge, i) => {
        const a = px(ed.points[i]);
        const b = px(ed.points[(i + 1) % n]);
        edge.setAttribute("x1", a[0].toFixed(1));
        edge.setAttribute("y1", a[1].toFixed(1));
        edge.setAttribute("x2", b[0].toFixed(1));
        edge.setAttribute("y2", b[1].toFixed(1));
      });
      ed.points.forEach((p, i) => {
        const [x, y] = px(p);
        for (const c of [dots[i], grabs[i]]) {
          c.setAttribute("cx", x.toFixed(1));
          c.setAttribute("cy", y.toFixed(1));
        }
      });
    };
    ed.points.forEach((_, i) => {
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("class", "dot");
      dot.setAttribute("r", "6");
      dot.setAttribute("stroke", ed.color);
      const grab = document.createElementNS(SVG_NS, "circle");
      grab.setAttribute("class", "grab");
      grab.setAttribute("r", ed.touch ? "20" : "11");
      const end = (ev) => {
        if (ed.drag !== i) return;
        clearTimeout(ed.hold);
        ed.drag = null;
        try {
          grab.releasePointerCapture(ev.pointerId);
        } catch (e) {}
        this._fitZones(); // anything that was held back while dragging
      };
      grab.addEventListener("pointerdown", (ev) => {
        if (ev.button > 0 || this._zEdit !== ed) return; // the right button removes (contextmenu)
        ev.preventDefault();
        ev.stopPropagation();
        ed.drag = i;
        ed.from = [ev.clientX, ev.clientY];
        try {
          grab.setPointerCapture(ev.pointerId);
        } catch (e) {}
        clearTimeout(ed.hold);
        if (ev.pointerType !== "mouse") {
          // held still on a touch screen: remove the point
          ed.hold = setTimeout(() => {
            if (ed.drag !== i || this._zEdit !== ed) return;
            ed.drag = null;
            this._zHeldAt = Date.now();
            this._zEditRemove(i);
          }, 600);
        }
      });
      grab.addEventListener("pointermove", (ev) => {
        const pic = this._zPic;
        if (ed.drag !== i || !pic) return;
        if (ed.from && Math.hypot(ev.clientX - ed.from[0], ev.clientY - ed.from[1]) < 6) return; // not moved yet
        ed.from = null;
        clearTimeout(ed.hold);
        // never outside the picture
        const [ex, ey] = this._pt(ev.clientX, ev.clientY);
        ed.points[i] = [Math.min(1, Math.max(0, (ex - pic.left) / pic.width)), Math.min(1, Math.max(0, (ey - pic.top) / pic.height))];
        place();
      });
      grab.addEventListener("pointerup", end);
      grab.addEventListener("pointercancel", end);
      grab.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (Date.now() - (this._zHeldAt || 0) < 800) return; // the long press already did it
        clearTimeout(ed.hold);
        ed.drag = null;
        this._zEditRemove(i);
      });
      dots.push(dot);
      grabs.push(grab);
    });
    svg.append(...dots, ...grabs);
    place();
  }

  _makeCamCard(cfg, i) {
    const cam = cfg.cameras[i];
    // a tile made bigger (Arrange) is shaped like its cells, and at home shows
    // the camera's best stream once it is two or more columns wide
    const eff = (this._eff && this._eff[i]) || { w: 1, h: 1 };
    const best = eff.w >= 2 && !!cam.tap_entity && onHomeNetwork();
    const card = this._helpers.createCardElement({
      type: "picture-entity",
      entity: best ? cam.tap_entity : cam.entity,
      name: cam.name,
      camera_view: cam.camera_view || "live",
      aspect_ratio: `${((cfg.aspect_ratio * eff.w) / eff.h) * 100}:100`,
      show_state: false,
      tap_action: { action: "none" },
      hold_action: { action: "none" }, // (a long press is the wall's menu)
    });
    // Tap opens the live dialog (same frame as History); hold keeps HA's
    // more-info. On a touch screen HA's own tap handling swallows the click
    // and reports the tap as an "action" event instead, so listen for both
    // (a mouse gives both: the second is dropped, as is the click that ends a hold).
    const tapped = (ev) => {
      const now = Date.now();
      if (now - (this._menuAt || 0) < 800) return; // the press that opened the menu
      const again = now - (this._tapAt || 0) < 600;
      if (ev.type === "action" && ev.detail?.action !== "tap") {
        if (ev.detail?.action === "hold") this._tapAt = now;
        return;
      }
      this._tapAt = now;
      if (!again) this._openLive(i);
    };
    card.addEventListener("action", tapped);
    card.addEventListener("click", tapped);
    card._span = `${eff.w}x${eff.h}`;
    return card;
  }

  // ------------------------------------------------- resting the wall
  //
  // While the live dialog (or the History lightbox) is open, the tiles behind
  // it give up their streams, so only the one being watched uses bandwidth
  // and decoding. A tile is taken off the page, which closes its connection,
  // and a picture of its last frame stands in for it. Afterwards a new tile
  // is made in its place: one stream per tile, however often this happens.

  _syncPause() {
    if (!this._grid || !this._camCards) return;
    if (this.isConnected && (this._liveIndex != null || this._histOpen)) this._pauseWall();
    else this._resumeWall();
  }

  _pauseWall() {
    for (const x of this._xTiles || []) x.card.pause(); // (asked every time: one may be new)
    if (this._pausedTiles) return; // already resting
    const cfg = this._builtCfg;
    this._pausedTiles = this._camCards.map((card, i) => {
      if (!card) return null; // (not on the wall)
      const cam = cfg.cameras[i];
      const ph = document.createElement("div");
      ph.className = "paused";
      const eff = (this._eff && this._eff[i]) || { w: 1, h: 1 };
      ph.style.aspectRatio = String((cfg.aspect_ratio * eff.w) / eff.h);
      const frame = lastFrame(card);
      if (frame) ph.appendChild(frame);
      else {
        // no picture yet (still loading, or the stream failed): one snapshot instead
        const img = document.createElement("img");
        img.alt = "";
        ph.appendChild(img);
        this._hass
          .callWS({ type: "auth/sign_path", path: `/api/camera_proxy/${cam.entity}`, expires: 60 })
          .then((r) => {
            if (ph.isConnected) img.src = r.path;
          })
          .catch(() => {});
      }
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = cam.name || this._hass.states[cam.entity]?.attributes.friendly_name || "";
      const mark = document.createElement("div");
      mark.className = "mark";
      mark.title = "Paused while a camera or the history is open";
      mark.innerHTML = '<ha-icon icon="mdi:pause"></ha-icon>';
      ph.append(name, mark);
      card.replaceWith(ph); // off the page: its player closes the stream
      return ph;
    });
    this._markDetecting();
  }

  _resumeWall() {
    for (const x of this._xTiles || []) if (!x.hidden) x.card.resume();
    const tiles = this._pausedTiles;
    if (!tiles) return; // not resting
    this._pausedTiles = null;
    const camHass = this._cameraHass(this._hass);
    tiles.forEach((ph, i) => {
      if (!ph) return;
      const card = this._makeCamCard(this._builtCfg, i);
      ph.replaceWith(card);
      card.hass = camHass;
      this._camCards[i] = card;
    });
    this._markDetecting();
  }

  // HA detaches and re-attaches cards as views re-render; keep the built
  // cards (and their running streams) instead of rebuilding everything.
  disconnectedCallback() {
    this._observer?.disconnect();
    window.removeEventListener("resize", this._onWindowResize);
    this._closeLive();
    this._liveHost?.remove();
    // taken off the page with a dialog open: put the tiles back, so the wall
    // is whole (and streams again) when it returns
    this._histOpen = false;
    this._resumeWall();
    this._liveResize?.disconnect();
    this._stopZones();
    this._zonesOff = false; // worth one more try when the wall is back
  }

  connectedCallback() {
    if (this._liveHost && !this._liveHost.isConnected) document.body.appendChild(this._liveHost);
    if (!this._hass || !this._config) return;
    if (!this._built) return this._build();
    this._observer.observe(this);
    if (this._alarmEl) this._observer.observe(this._alarmEl);
    window.addEventListener("resize", this._onWindowResize);
    requestAnimationFrame(() => this._layout());
    this._startZones();
  }

  // ------------------------------------------------------------ live dialog

  _hd() {
    let v = null;
    try {
      v = localStorage.getItem(QUALITY_KEY);
    } catch (e) {}
    return v === null ? onHomeNetwork() : v === "1";
  }

  _buildLive() {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:9999;display:none";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${LIVE_STYLE}</style>
      <div class="wrap"><div class="backdrop"></div>
      <div class="lb">
        <div class="head">
          <span class="title"></span>
          <span class="live"><span class="dot"></span>Live</span>
          <span class="spacer"></span>
          <button class="chip mic" hidden title="Talk through the camera's speaker"><ha-icon icon="mdi:microphone"></ha-icon><span>Talk</span></button>
          <button class="chip zbtn" hidden title="Show this camera's zones over the picture"><ha-icon icon="mdi:vector-polygon"></ha-icon>Zones</button>
          <button class="chip lbox" hidden title="Box what the camera is tracking (the picture is held back a little so they line up)"><ha-icon icon="mdi:vector-square"></ha-icon>Boxes</button>
          <button class="chip lsrc" hidden></button>
          <button class="chip hd" title="Full-quality feed (slower through the public address)"><ha-icon icon="mdi:high-definition"></ha-icon>HD</button>
          <button class="chip zoomx" hidden title="Zoomed in: click for the whole picture"><ha-icon icon="mdi:magnify-minus-outline"></ha-icon><span></span></button>
          <button class="icon expand" title="Bigger"><ha-icon icon="mdi:arrow-expand"></ha-icon></button>
          <button class="icon close" title="Close (Esc)"><ha-icon icon="mdi:close"></ha-icon></button>
        </div>
        <div class="stage">
          <button class="icon prev" title="Previous camera (←)"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
          <div class="body"><div class="frame" style="--ar:${this._config.aspect_ratio}">
            <div class="zoom">
              <div class="video"></div>
              <svg class="zones" style="display:none"></svg>
              <div class="lboxes" style="display:none"></div>
              <div class="ldebug" hidden></div>
            </div>
            <div class="zone-note" hidden>Zones hidden: the camera isn't at the position they were drawn for</div>
            <div class="zbar" hidden></div>
          </div></div>
          <button class="icon next" title="Next camera (→)"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
        </div>
      </div></div>`;
    // leaving full screen (the phone's back button, Esc) closes the dialog it was entered for
    this._onFullscreen = () => {
      if (this._fs && this._fs.on && this._liveIndex != null && document.fullscreenElement !== this._liveHost) this._closeLive();
    };
    root.querySelector(".close").onclick = () => this._closeLive();
    // (a click beside the dialog doesn't throw away a zone being edited)
    root.querySelector(".backdrop").onclick = () => this._zEdit || this._closeLive();
    root.querySelector(".prev").onclick = () => this._stepLive(-1);
    root.querySelector(".next").onclick = () => this._stepLive(1);
    root.querySelector(".expand").onclick = () => {
      const full = root.querySelector(".lb").classList.toggle("full");
      const ex = root.querySelector(".expand");
      ex.title = full ? "Smaller" : "Bigger";
      ex.firstElementChild.setAttribute("icon", full ? "mdi:arrow-collapse" : "mdi:arrow-expand");
    };
    root.querySelector(".mic").onclick = () => (this._talk ? this._stopTalk() : this._startTalk());
    root.querySelector(".zbtn").onclick = () => this._zEdit || this._zonesToggle();
    root.querySelector(".lbox").onclick = () => this._ltToggle();
    root.querySelector(".lsrc").onclick = () => this._ltNextSource();
    // Zone menu: right-click on the picture, or a long press on a touch
    // screen. Anywhere else the browser's own menu is left alone.
    const frame = root.querySelector(".frame");
    this._zoomSetup(frame);
    root.querySelector(".zoomx").onclick = () => this._zoomTo(1);
    frame.addEventListener("contextmenu", (ev) => {
      if (this._zoneContext(ev.clientX, ev.clientY)) ev.preventDefault();
    });
    let press = null;
    const unpress = () => {
      if (press) clearTimeout(press.timer);
      press = null;
    };
    frame.addEventListener(
      "touchstart",
      (ev) => {
        unpress();
        this._zPressed = false;
        const first = ev.composedPath ? ev.composedPath()[0] : ev.target;
        const cls = (first && first.getAttribute && first.getAttribute("class")) || "";
        if (ev.touches.length !== 1 || this._zEdit || /\b(grab|edge)\b/.test(cls)) return;
        const t = ev.touches[0];
        press = { x: t.clientX, y: t.clientY };
        press.timer = setTimeout(() => {
          const at = press;
          press = null;
          if (at && this._zoneContext(at.x, at.y)) {
            this._zPressed = true; // the finger lifting isn't a tap on the video
            this._zHeldAt = Date.now(); // nor is the browser's own long-press menu wanted
          }
        }, 550);
      },
      { passive: true }
    );
    frame.addEventListener(
      "touchmove",
      (ev) => {
        const t = ev.touches[0];
        if (press && (!t || Math.hypot(t.clientX - press.x, t.clientY - press.y) > 10)) unpress();
      },
      { passive: true }
    );
    frame.addEventListener("touchcancel", unpress, { passive: true });
    frame.addEventListener("touchend", (ev) => {
      unpress();
      if (this._zPressed && ev.cancelable) ev.preventDefault();
      this._zPressed = false;
    });
    // the zone layer follows the picture as the dialog changes size
    if (window.ResizeObserver) this._liveResize = new ResizeObserver(() => this._fitZones());
    root.querySelector(".hd").onclick = () => {
      try {
        localStorage.setItem(QUALITY_KEY, this._hd() ? "0" : "1");
      } catch (e) {}
      this._showLive();
    };
    // on the window only while the dialog is open (_openLive / _closeLive)
    this._onLiveKey = (ev) => {
      if (this._liveIndex == null) return;
      // Esc first closes the zone menu, then leaves what the zone bar is
      // doing; the arrows don't change camera in the middle of either
      if (this._zMenu || (this._zBarMode && this._zBarMode !== "msg")) {
        if (ev.key !== "Escape") return;
        if (this._zMenu) this._zMenuClose();
        else if (this._zBarCancel) this._zBarCancel();
        ev.preventDefault();
        return;
      }
      if (ev.key === "Escape") this._closeLive();
      else if (ev.key === "ArrowLeft") this._stepLive(-1);
      else if (ev.key === "ArrowRight") this._stepLive(1);
      else return;
      ev.preventDefault();
    };
    // ha-camera-stream gets its connection through Lit context requests that
    // bubble up to HA's root; this dialog lives on <body>, outside that tree,
    // so hand the requests to the card (which is inside it).
    host.addEventListener("context-request", (ev) => {
      ev.stopPropagation();
      const fwd = new Event("context-request", { bubbles: true, composed: true });
      for (const k of ["context", "callback", "subscribe"]) fwd[k] = ev[k];
      fwd.contextTarget = ev.contextTarget || ev.composedPath()[0];
      this.dispatchEvent(fwd);
    });
    document.body.appendChild(host);
    this._liveHost = host;
    this._liveRoot = root;
  }

  _openLive(i) {
    if (!this._liveHost) this._buildLive();
    this._liveIndex = i;
    window.addEventListener("keydown", this._onLiveKey); // the same function each time: added once
    this._liveHost.style.display = "block";
    const lb = this._liveRoot.querySelector(".lb");
    lb.classList.remove("full");
    this._phoneEnter(); // on a phone: the whole screen, landscape
    this._liveRoot.querySelector(".expand").firstElementChild.setAttribute("icon", "mdi:arrow-expand");
    const many = this._config.cameras.length > 1;
    this._liveRoot.querySelector(".prev").hidden = !many;
    this._liveRoot.querySelector(".next").hidden = !many;
    this._syncPause(); // the tiles behind give up their streams
    this._liveResize?.observe(this._liveRoot.querySelector(".frame"));
    this._showLive();
  }

  _stepLive(d) {
    const n = this._config.cameras.length;
    // in the order the wall shows them
    const shown = (this._order || []).filter((i) => i < n); // (tracking tiles aside; cameras off the wall too)
    const order = shown.includes(this._liveIndex) && shown.length ? shown : [...Array(n).keys()];
    this._liveIndex = order[(order.indexOf(this._liveIndex) + d + n) % n];
    this._showLive();
  }

  _liveEntity() {
    const cam = this._config.cameras[this._liveIndex];
    return this._hd() && cam.tap_entity ? cam.tap_entity : cam.entity;
  }

  _showLive() {
    const cam = this._config.cameras[this._liveIndex];
    const root = this._liveRoot;
    root.querySelector(".title").textContent = cam.name || this._hass.states[cam.entity]?.attributes.friendly_name || cam.entity;
    const hd = root.querySelector(".hd");
    hd.hidden = !cam.tap_entity;
    hd.classList.toggle("on", this._hd());
    this._stopTalk();
    this._showMic();
    root.querySelector(".video").replaceChildren();
    this._liveStream = null;
    this._liveStreamEntity = null;
    this._zLeave(); // zone work belongs to the camera that was on screen
    this._zoom = { s: 1, x: 0, y: 0 }; // and each camera starts with its whole picture
    this._zoomApply();
    this._updateLive();
    this._fitZones();
    this._ltStop(); // the boxes were the other camera's
    this._ltSync();
  }

  // ------------------------------------------------- landscape on a phone
  //
  // A phone held upright leaves a wide picture a thin strip. So on a phone
  // the dialog takes the whole screen, landscape. Where the browser can turn
  // the screen (full screen + orientation lock: Chrome on Android) it does.
  // Where it can't (iPhones, some in-app browsers) the dialog is drawn
  // turned a quarter instead and the phone is held sideways; the screen
  // itself is then still upright, so every pointer position and measured
  // rectangle goes through _pt() / _rect() to become what the dialog sees.

  _isPhone() {
    if (this._config.phone_landscape === false) return false;
    try {
      const sc = window.screen;
      return window.matchMedia("(pointer: coarse)").matches && Math.min(sc.width, sc.height) <= 540;
    } catch (e) {
      return false;
    }
  }

  // A point on screen, as the dialog sees it.
  _pt(x, y) {
    return this._rot ? [y, this._rotW - x] : [x, y];
  }

  // An element's rectangle on screen, as the dialog sees it.
  _rect(el) {
    const r = el.getBoundingClientRect();
    if (!this._rot) return { left: r.left, top: r.top, width: r.width, height: r.height };
    return { left: r.top, top: this._rotW - r.left - r.width, width: r.height, height: r.width };
  }

  // The dialog's width and height.
  _view() {
    return this._rot ? [window.innerHeight, window.innerWidth] : [window.innerWidth, window.innerHeight];
  }

  _phoneEnter() {
    if (this._phone || !this._isPhone()) return;
    this._phone = true;
    this._liveRoot.querySelector(".lb").classList.add("fill");
    this._onPhoneTurn = this._onPhoneTurn || (() => this._phoneFit());
    window.addEventListener("resize", this._onPhoneTurn);
    window.addEventListener("orientationchange", this._onPhoneTurn);
    this._phoneFit(); // turned by drawing, at once; undone below if the screen turns for real
    const host = this._liveHost;
    const orientation = window.screen && window.screen.orientation;
    if (!host.requestFullscreen || !orientation || !orientation.lock) return;
    const mine = (this._fs = { on: false });
    document.addEventListener("fullscreenchange", this._onFullscreen);
    Promise.resolve()
      .then(() => host.requestFullscreen({ navigationUI: "hide" }))
      .then(() => {
        if (this._fs !== mine) {
          // closed before full screen had begun: leave it again
          if (this._liveIndex == null && document.fullscreenElement === host) Promise.resolve(document.exitFullscreen()).catch(() => {});
          return;
        }
        mine.on = true;
        return orientation.lock("landscape");
      })
      .catch(() => {}) // not allowed here: the turned drawing stays
      .then(() => this._fs === mine && this._phoneFit());
  }

  // Turned by drawing exactly while the screen is upright.
  _phoneFit() {
    if (!this._phone || !this._liveRoot) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const rot = h > w;
    this._rot = rot;
    this._rotW = w;
    this._liveRoot.querySelector(".wrap").style.cssText = rot
      ? `inset:auto;left:0;top:0;width:${h}px;height:${w}px;transform-origin:0 0;transform:translateX(${w}px) rotate(90deg)`
      : "";
    this._liveRoot.querySelector(".lb").classList.toggle("rot", rot);
    this._zMenuClose(); // it was placed for the other way up
    this._zonesDrawn = null;
    this._zoomApply(); // the frame has another size: zoom limits and the zone layer follow
  }

  _phoneLeave() {
    if (!this._phone) return;
    this._phone = false;
    this._rot = false;
    window.removeEventListener("resize", this._onPhoneTurn);
    window.removeEventListener("orientationchange", this._onPhoneTurn);
    document.removeEventListener("fullscreenchange", this._onFullscreen);
    const root = this._liveRoot;
    root.querySelector(".wrap").style.cssText = "";
    root.querySelector(".lb").classList.remove("fill");
    root.querySelector(".lb").classList.remove("rot");
    const fs = this._fs;
    this._fs = null;
    if (!fs) return;
    try {
      window.screen.orientation.unlock();
    } catch (e) {}
    try {
      if (document.fullscreenElement === this._liveHost) Promise.resolve(document.exitFullscreen()).catch(() => {});
    } catch (e) {}
  }

  // --------------------------------------------------------- digital zoom
  //
  // The picture (with the zones on it) is enlarged inside its frame: `s`
  // times, moved by x, y pixels. Never smaller than the frame, never moved
  // so far that the frame shows past the picture's edge.

  // ---------------------------------------------------------- live boxes
  //
  // Where the camera's tracked things are, live, from the Protect Detections
  // backend (which listens to Protect for it, only while a dialog asks):
  // "Boxes" draws them over the picture. The button doesn't appear without
  // that backend.
  //
  // A box reaches us about half a second after its moment, so while it
  // is on the picture is held back a little (`live_delay` ms, 700) and each
  // box is drawn when the frame it belongs to is on screen: protect-live.js
  // has the how. `live_offset` trims it. While talking through the camera
  // the picture isn't held back.

  _ltPref(key) {
    try {
      return localStorage.getItem(key) === "1";
    } catch (e) {
      return false;
    }
  }

  // Whose boxes the live view shows: as picked there (kept in this browser),
  // else the card's `source`, else auto.
  _ltSource() {
    let own = null;
    try {
      own = localStorage.getItem(LIVE_SOURCE_KEY);
    } catch (e) {}
    const cfg = this._config.source;
    return LIVE_SOURCE_NAMES[own] ? own : LIVE_SOURCE_NAMES[cfg] ? cfg : "auto";
  }

  // The chip beside Boxes: the next of Auto, Local, UniFi.
  _ltNextSource() {
    const all = Object.keys(LIVE_SOURCE_NAMES);
    const next = all[(all.indexOf(this._ltSource()) + 1) % all.length];
    try {
      localStorage.setItem(LIVE_SOURCE_KEY, next);
    } catch (e) {}
    this._ltSync();
  }

  _ltToggle() {
    try {
      localStorage.setItem(LIVE_BOXES_KEY, this._ltPref(LIVE_BOXES_KEY) ? "0" : "1");
    } catch (e) {}
    this._ltSync();
  }

  // Which cameras have live positions at all: asked once. The answer brings
  // the dialog's buttons and the wall's tracking tiles.
  _ltAsk() {
    if (this._ltCams !== undefined || this._ltNone || !this._hass) return;
    this._ltCams = null;
    Promise.resolve(this._hass.callWS({ type: "protect_detections/live/cameras" })).then(
      (res) => {
        this._ltCams = (res && res.cameras) || {};
        this._ltSync();
        this._trackTiles();
      },
      (err) => {
        if (err && err.code === "unknown_command") this._ltNone = true; // a backend without it: none of this
        else this._ltCams = undefined; // worth asking again
      }
    );
  }

  // ------------------------------------------------------ tracking tiles
  //
  // Beside its ordinary feed, a camera that recognises things gets a
  // tracking tile: protect-tracking-card itself, standing by until that
  // camera tracks a person, then live and zoomed in on them. A tile like any
  // other: it is moved and sized in Arrange mode (kept as "track:" + the
  // camera's device), and rests while a dialog is open. `tracking: false`
  // in the config leaves them out; `tracking: {types: [...], linger: ...}`
  // is handed on to the card. Tapping one opens that camera's dialog.

  // Made once the cameras are known to recognise things (added to the wall
  // as it stands: nothing is rebuilt, no feed starts over).
  _trackTiles() {
    const cfg = this._builtCfg;
    if (!this._grid || !cfg || cfg !== this._config || this._xTiles || !this._ltCams) return;
    if (cfg.tracking === false || !customElements.get("protect-tracking-card")) return;
    const opts = cfg.tracking && typeof cfg.tracking === "object" ? cfg.tracking : {};
    const n = cfg.cameras.length;
    const seen = new Set();
    this._xTiles = [];
    cfg.cameras.forEach((cam, i) => {
      const id = this._ltCams[cam.entity] || this._ltCams[cam.tap_entity];
      if (!id || seen.has(id)) return;
      seen.add(id);
      const card = document.createElement("protect-tracking-card");
      const x = { key: `track:${this._camKey(cam)}`, cam: i, card, base: { ...opts, type: "custom:protect-tracking-card", camera: this._ltCams[cam.entity] ? cam.entity : cam.tap_entity, name: opts.name || cam.name, embedded: true } };
      try {
        x.cfgKey = JSON.stringify(this._trackConfig(x));
        card.setConfig(JSON.parse(x.cfgKey));
      } catch (err) {
        console.error("camera-wall-card: tracking tile", err);
        return;
      }
      const tile = document.createElement("div");
      tile.className = "tile track";
      // a tap opens this camera's dialog (a tap on a box is the card's own)
      tile.addEventListener(
        "click",
        (ev) => {
          if (this._arranging) return; // (its handles take the clicks then)
          if (Date.now() - (this._menuAt || 0) < 800) return ev.stopPropagation(); // the press that opened the menu
          const at = ev.composedPath ? ev.composedPath()[0] : ev.target;
          if (at && at.classList && at.classList.contains("box")) return;
          ev.stopPropagation();
          this._openLive(i);
        },
        true
      );
      tile.appendChild(card);
      this._grid.appendChild(tile);
      card.hass = this._hass;
      this._tiles[n + this._xTiles.length] = tile;
      x.tile = tile;
      this._xTiles.push(x);
    });
    if (!this._xTiles.length) return;
    this._applyShown();
    this._syncPause(); // (a dialog may be open already)
    if (this._arranging) this._arrExit("cancel"); // its handles don't know the new tiles
    this._layout();
  }

  // A tracking tile's config: the wall's `tracking:` options, then what the
  // user chose for this one from its menu.
  _trackConfig(x) {
    const own = (this._arr && this._arr.opts && this._arr.opts[x.key]) || {};
    // (the wall's `source` goes for its tracking tiles too, unless one says otherwise)
    return { ...(this._config.source ? { source: this._config.source } : {}), ...x.base, ...own };
  }

  // What every tile is known by when arranged: the cameras', then the
  // tracking tiles'.
  _tileKeys() {
    return [...this._config.cameras.map((cam) => this._camKey(cam)), ...(this._xTiles || []).map((x) => x.key)];
  }

  // ------------------------------------------------- what is on the wall
  //
  // Every tile is an element of the wall: a camera's feed, a camera's
  // tracking tile (other kinds can join: _elements() is the one list of
  // them). The user can take any off the wall and put it back, from the
  // wall's menu (right-click, or a long press). What is off is kept with
  // their arrangement, by the element's key, so it stays off across reloads
  // while a camera that is new still shows. A feed that is off isn't
  // playing: its card is gone.

  _isHidden(key) {
    return !!(this._arr && Array.isArray(this._arr.hidden) && this._arr.hidden.includes(key));
  }

  // The tiles' keys, null for those that are off the wall.
  _shownKeys() {
    return this._tileKeys().map((key) => (this._isHidden(key) ? null : key));
  }

  // [{key, kind, i (its tile), cam (its camera), name, shown}]
  _elements() {
    const cams = this._config.cameras;
    const out = cams.map((cam, i) => ({ key: this._camKey(cam), kind: "camera", i, cam: i, name: cam.name || cam.entity }));
    (this._xTiles || []).forEach((x, k) => out.push({ key: x.key, kind: "track", i: cams.length + k, cam: x.cam, name: `${cams[x.cam].name || cams[x.cam].entity} · tracking` }));
    for (const el of out) el.shown = !this._isHidden(el.key);
    return out;
  }

  // Makes the page fit what is on the wall: a tile that is off is not shown
  // and plays nothing; one that is back gets its feed again.
  _applyShown() {
    const cfg = this._builtCfg;
    if (!this._grid || !cfg || cfg !== this._config || !this._tiles) return;
    const n = cfg.cameras.length;
    const resting = this.isConnected && (this._liveIndex != null || !!this._histOpen);
    let any = false;
    this._tileKeys().forEach((key, i) => {
      const tile = this._tiles[i];
      if (!tile) return;
      const off = this._isHidden(key);
      tile.style.display = off ? "none" : "";
      any = any || !off;
      if (i < n) {
        const card = this._camCards[i];
        const ph = this._pausedTiles && this._pausedTiles[i];
        if (off) {
          if (ph) ph.remove();
          else if (card) card.remove(); // off the page: its stream stops
          if (this._pausedTiles) this._pausedTiles[i] = null;
          this._camCards[i] = null;
        } else if (!card) {
          const fresh = this._makeCamCard(cfg, i);
          tile.prepend(fresh);
          fresh.hass = this._cameraHass(this._hass);
          this._camCards[i] = fresh;
        }
        return;
      }
      const x = this._xTiles[i - n];
      x.hidden = off;
      const want = JSON.stringify(this._trackConfig(x));
      if (want !== x.cfgKey) {
        x.cfgKey = want;
        try {
          x.card.setConfig(JSON.parse(want));
          x.card.hass = this._hass;
        } catch (err) {
          console.error("camera-wall-card: tracking tile", err);
        }
      }
      if (off || resting) x.card.pause();
      else x.card.resume();
    });
    const gone = this.shadowRoot.querySelector(".allgone");
    if (gone) gone.hidden = any || n === 0;
  }

  // Changes the user's saved arrangement (what is where, what is off, each
  // tile's own options) and shows the result. Nothing left in it: none kept.
  _arrChange(change) {
    const a = { tiles: [], ...(this._arr || {}) };
    change(a);
    if (a.hidden && !a.hidden.length) delete a.hidden;
    if (a.opts && !Object.keys(a.opts).length) delete a.opts;
    this._arr = a.grid || a.tiles.length || a.list || a.hidden || a.opts ? a : null;
    this._arrStore(this._arr, "success");
    this._applyShown();
    this._layout();
  }

  // Takes an element off the wall, or puts it back: at `cell` ({c, r}) if
  // one is given and free (a wide wall), else in the first free place.
  _setShown(key, shown, cell) {
    const wide = this._bpCols() > 1;
    const now = wide ? this._plan() : null; // as it stands
    this._arrChange((a) => {
      const hidden = new Set(a.hidden || []);
      if (shown) hidden.delete(key);
      else hidden.add(key);
      a.hidden = [...hidden];
      if (!shown || !cell || !now) return;
      if (now.places.some((t) => t.c <= cell.c && cell.c < t.c + t.w && t.r <= cell.r && cell.r < t.r + t.h)) return; // taken
      if (!a.grid) {
        // places for everything, from the wall as it stands
        a.grid = { cols: now.cols, rows: now.rows };
        a.tiles = now.places.map(({ id, c, r, w, h }) => ({ id, c, r, w, h }));
      }
      if (cell.c >= a.grid.cols || cell.r >= a.grid.rows) return;
      a.tiles = [...a.tiles.filter((t) => t.id !== key), { id: key, c: cell.c, r: cell.r, w: 1, h: 1 }];
    });
  }

  // Can the tile take w x h cells where it is (a wide wall)?
  _sizeFits(key, w, h) {
    const now = this._plan();
    const t = now.places.find((p) => p.id === key);
    const g = { cols: now.cols, rows: now.rows, tiles: now.places };
    return !!t && now.cols > 1 && t.c + w <= g.cols && t.r + h <= g.rows && !CameraWallCard._arrHits(g, t.c, t.r, w, h, t).length;
  }

  _setSize(key, w, h) {
    if (!this._sizeFits(key, w, h)) return this._arrNote("No room for that size there: make room in Arrange first", 5000);
    const now = this._plan();
    this._arrChange((a) => {
      // places for everything as it stands (so the others stay where they are)
      const placed = now.places.map(({ id, c, r, w: tw, h: th }) => ({ id, c, r, w: tw, h: th }));
      a.tiles = [...placed, ...a.tiles.filter((t) => !placed.some((q) => q.id === t.id))];
      if (!a.grid) a.grid = { cols: now.cols, rows: now.rows };
      const t = a.tiles.find((q) => q.id === key);
      t.w = w;
      t.h = h;
    });
  }

  // ------------------------------------------------------------- editing
  //
  // "Edit the wall…" and "Edit this tracker…" open Home Assistant's own
  // edit-card dialog (the card's editor or YAML, with the preview). The wall
  // is a card of the dashboard: what the dialog saves is written into the
  // dashboard, at the wall's place. A tracking tile is not: its options are
  // the user's own, kept with the arrangement. It is shown to the dialog as
  // the tracking card it is, and what is saved goes to where the tile's
  // options are kept. The dialog is asked for as the frontend asks for it
  // (a `show-dialog` event naming it): none of that is a public API, so
  // when it can't be had the wall says so, and nothing is half done.
  // For administrators only, as editing a dashboard is.

  _mayEdit() {
    const user = this._hass && this._hass.user;
    return !!(user && user.is_admin);
  }

  _say(message) {
    this.dispatchEvent(new CustomEvent("hass-notification", { bubbles: true, composed: true, detail: { message } }));
  }

  // Home Assistant's own handle on the dashboard, when it can be found from here.
  _lovelace() {
    for (let n = this; n; n = n.parentNode || n.host) {
      const ll = n.lovelace;
      if (ll && ll.config && typeof ll.saveConfig === "function") return ll;
    }
    return null;
  }

  // The dashboard's config and how to save it: {conf, save, yaml}; null when it can't be read.
  async _dashboard() {
    const ll = this._lovelace();
    if (ll) return { conf: JSON.parse(JSON.stringify(ll.config)), save: (c) => ll.saveConfig(c), yaml: ll.mode === "yaml" };
    try {
      const first = location.pathname.split("/")[1] || "";
      const url_path = !first || first === "lovelace" ? null : first;
      const conf = await this._hass.callWS({ type: "lovelace/config", url_path, force: false });
      const save = async (c) => {
        await this._hass.callWS({ type: "lovelace/config/save", url_path, config: c });
        this.dispatchEvent(new CustomEvent("config-refresh", { bubbles: true, composed: true }));
      };
      return { conf, save, yaml: false };
    } catch (err) {
      return null;
    }
  }

  // The frontend's own way of loading the dialog (it is not loaded until a
  // card is first edited). The view answers `ll-edit-card` by asking for the
  // dialog with it: that request is caught here before it is shown, and only
  // the loader is kept. Null when it cannot be had.
  _dialogImport(conf) {
    if (customElements.get(EDIT_DIALOG)) return () => Promise.resolve();
    let path = null;
    ((conf && conf.views) || []).some((v, i) => {
      if (!v || typeof v !== "object") return false;
      if (Array.isArray(v.cards) && v.cards.length) path = [i, 0];
      else (Array.isArray(v.sections) ? v.sections : []).some((sec, j) => (sec && Array.isArray(sec.cards) && sec.cards.length ? !!(path = [i, j, 0]) : false));
      return !!path;
    });
    if (!path) return null;
    let load = null;
    const grab = (ev) => {
      const d = ev.detail || {};
      if (d.dialogTag !== EDIT_DIALOG) return;
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
      load = d.dialogImport;
    };
    window.addEventListener("show-dialog", grab, true);
    try {
      this.dispatchEvent(new CustomEvent("ll-edit-card", { bubbles: true, composed: true, detail: { path } }));
    } finally {
      window.removeEventListener("show-dialog", grab, true);
    }
    return typeof load === "function" ? load : null;
  }

  // Opens Home Assistant's dialog on a card config; `save(next)` is called with what it saves.
  _openEditor(dash, cardConfig, save) {
    const load = this._dialogImport(dash.conf);
    if (!load) {
      this._say("Home Assistant's card editor could not be opened from here. Use Edit dashboard instead.");
      return false;
    }
    const saveCardConfig = async (next) => {
      if (!next || typeof next !== "object" || Array.isArray(next) || !next.type) throw new Error("A card needs a type.");
      await save(next);
    };
    this.dispatchEvent(new CustomEvent("show-dialog", { bubbles: true, composed: true, detail: { dialogTag: EDIT_DIALOG, dialogImport: load, dialogParams: { lovelaceConfig: dash.conf, cardConfig, saveCardConfig } } }));
    return true;
  }

  // The wall's own config, in the dashboard.
  async _editWall() {
    if (!this._mayEdit()) return false;
    const mine = this._configJson;
    const dash = await this._dashboard();
    if (!dash || !mine) return this._say("This dashboard cannot be read from here: edit the wall with Edit dashboard."), false;
    if (dash.yaml) return this._say("This dashboard is kept in YAML: edit the wall there."), false;
    const find = (conf) => {
      let found = null;
      const walk = (node, set) => {
        if (found || !node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach((v, i) => walk(v, (nv) => (node[i] = nv)));
        if (node.type === "custom:camera-wall-card" && set && JSON.stringify(node) === mine) return void (found = set);
        for (const k of Object.keys(node)) walk(node[k], (nv) => (node[k] = nv));
      };
      walk(conf && conf.views, null);
      return found;
    };
    if (!find(dash.conf)) return this._say("The wall could not be found in the dashboard (it may have changed): reload the page and try again."), false;
    return this._openEditor(dash, JSON.parse(mine), async (next) => {
      // (read afresh: the dashboard may have been changed meanwhile)
      const now = await this._dashboard();
      const set = now && find(now.conf);
      if (!set) throw new Error("The wall could not be saved: the dashboard has changed. Reload the page and try again.");
      set(next);
      await now.save(now.conf);
    });
  }

  // A tracking tile's options, as the tracking card they are for.
  async _editTracker(key) {
    if (!this._mayEdit()) return false;
    const x = (this._xTiles || []).find((t) => t.key === key);
    if (!x) return false;
    const dash = await this._dashboard();
    if (!dash) return this._say("Home Assistant's card editor could not be opened from here."), false;
    const { embedded, ...card } = this._trackConfig(x);
    return this._openEditor(dash, card, async (next) => {
      if (next.type !== x.base.type) throw new Error("This tile is a tracking card: its type can't be changed here.");
      this._arrChange((a) => {
        a.opts = { ...(a.opts || {}), [key]: CameraWallCard.tileOptions(x.base, next) };
      });
    });
  }

  // What of an edited tracking card is the tile's own: all that differs from
  // what the wall gives every tile (its `tracking:` options). The camera and
  // the kind of card are the tile's and stay.
  static tileOptions(base, next) {
    const own = {};
    for (const [k, v] of Object.entries(next || {})) {
      if (["type", "camera", "embedded"].includes(k) || v === undefined) continue;
      if (JSON.stringify(v) !== JSON.stringify(base[k])) own[k] = v;
    }
    return own;
  }

  // A tile's own options (a tracking tile's: what it watches for, its stream).
  _setOpts(key, patch) {
    this._arrChange((a) => {
      a.opts = { ...(a.opts || {}), [key]: { ...((a.opts || {})[key] || {}), ...patch } };
    });
  }

  // The cell of the grid under a point on screen, or null.
  _cellAt(x, y) {
    const cell = this._cell;
    if (!cell || !this._grid || this._bpCols() === 1) return null;
    const g = this._grid.getBoundingClientRect();
    const c = Math.floor((x - g.left) / (cell.w + GAP));
    const r = Math.floor((y - g.top) / (cell.h + GAP));
    return c >= 0 && r >= 0 && c < cell.cols && r < cell.rows ? { c, r } : null;
  }

  // ------------------------------------------------------ the wall's menu
  //
  // Right-click (a long press on a touch screen) on a tile or on the wall
  // itself: what can be done with that tile, what can be added, the layout.
  // The same menu as the zones' in the camera dialog: it stays on screen,
  // and a click elsewhere or Esc closes it. Not while arranging: the tiles'
  // handles have the pointer then.

  _wMenuClose() {
    const m = this._wMenu;
    if (!m) return;
    this._wMenu = null;
    m.back.remove();
    m.menu.remove();
    window.removeEventListener("keydown", m.key, true);
  }

  // Opens the menu at a point on screen; `fill(menu, kit)` puts its items in
  // (and may be called again by an item, for a menu within the menu).
  _wMenuOpen(x, y, fill) {
    this._wMenuClose();
    this._menuAt = Date.now();
    const back = document.createElement("div");
    back.className = "zmenu-back wall";
    const menu = document.createElement("div");
    menu.className = "zmenu wall";
    const close = () => this._wMenuClose();
    back.addEventListener("pointerdown", close);
    back.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      close();
    });
    menu.addEventListener("contextmenu", (ev) => ev.preventDefault());
    const key = (ev) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      close();
    };
    window.addEventListener("keydown", key, true);
    this.shadowRoot.append(back, menu);
    this._wMenu = { back, menu, key };
    const fit = () => {
      // kept on screen
      const mw = menu.offsetWidth || 220;
      const mh = menu.offsetHeight || 200;
      menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - mw - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - mh - 8))}px`;
    };
    const kit = {
      // an item: `fn` runs and the menu closes (unless `stay`)
      item: (label, fn, { mark, disabled, stay } = {}) => {
        const b = document.createElement("button");
        b.type = "button";
        b.appendChild(document.createTextNode(label));
        if (mark) {
          const tick = document.createElement("b");
          tick.textContent = mark;
          b.appendChild(tick);
        }
        b.disabled = !!disabled;
        b.onclick = () => {
          if (!stay) close();
          fn();
        };
        return b;
      },
      head: (title, sub) => {
        const el = document.createElement("span");
        el.className = "head";
        el.textContent = title;
        if (sub) {
          const small = document.createElement("small");
          small.textContent = sub;
          el.appendChild(small);
        }
        return el;
      },
      hr: () => document.createElement("hr"),
      // another set of items in the same menu
      show: (again) => {
        menu.replaceChildren(...again(kit));
        fit();
      },
    };
    kit.show(fill);
  }

  // The items that put back what is off the wall (at `cell`, if given).
  _menuAdd(kit, cell) {
    const off = this._elements().filter((el) => !el.shown);
    if (!off.length) return [kit.item("Everything is on the wall", () => {}, { disabled: true })];
    return off.map((el) => kit.item(el.name, () => this._setShown(el.key, true, cell)));
  }

  // The menu for the tile `i` (null: the wall itself) at a point on screen.
  _wallContext(x, y, i) {
    if (this._arranging || !this._grid || !this._builtCfg) return;
    const els = this._elements();
    const el = i == null ? null : els.find((e) => e.i === i && e.shown);
    const cell = el ? null : this._cellAt(x, y);
    const wide = this._bpCols() > 1;
    const anyOff = els.some((e) => !e.shown);
    const cams = this._config.cameras;
    const admin = this._mayEdit();
    const layout = (kit) => [
      ...(admin ? [kit.item("Edit the wall…", () => this._editWall())] : []),
      kit.item("Arrange…", () => this._arrEnter()),
      // (everything back: places, sizes, what was taken off, the tiles' own options)
      kit.item("Reset layout", () =>
        this._arrChange((a) => {
          for (const k of Object.keys(a)) delete a[k];
          a.tiles = [];
        })
      ),
    ];
    if (!el) {
      return this._wMenuOpen(x, y, (kit) => [kit.head("Add to the wall"), ...this._menuAdd(kit, cell), kit.hr(), ...layout(kit)]);
    }
    const eff = (this._eff && this._eff[el.i]) || { w: 1, h: 1 };
    const sizes = (kit) =>
      wide
        ? [[1, 1], [2, 1], [2, 2]].map(([w, h]) =>
            kit.item(`Size ${w} × ${h}`, () => this._setSize(el.key, w, h), { mark: eff.w === w && eff.h === h ? "✓" : "", disabled: !(eff.w === w && eff.h === h) && !this._sizeFits(el.key, w, h) })
          )
        : [];
    const more = (kit) => [
      kit.hr(),
      ...(anyOff ? [kit.item("Add…", () => kit.show((k) => [k.head("Add to the wall"), ...this._menuAdd(k, null)]), { stay: true })] : []),
      ...layout(kit),
    ];
    // what each kind of element offers
    const kinds = {
      camera: (kit) => {
        const track = els.find((e) => e.kind === "track" && e.cam === el.cam);
        return [
          kit.head(el.name, "Camera"),
          kit.item("Open live view", () => this._openLive(el.cam)),
          ...sizes(kit),
          ...(track ? [kit.item(track.shown ? "Remove tracking tile" : "Add tracking tile", () => this._setShown(track.key, !track.shown))] : []),
          kit.item("Remove from wall", () => this._setShown(el.key, false)),
        ];
      },
      track: (kit) => {
        const x = this._xTiles[el.i - this._config.cameras.length];
        const conf = this._trackConfig(x);
        const types = Array.isArray(conf.types) && conf.types.length ? conf.types : ["person"];
        const watch = [["person", "People"], ["vehicle", "Vehicles"], ["animal", "Animals"], ["package", "Packages"]].map(([type, label]) => {
          const on = types.includes(type);
          const next = on ? types.filter((t) => t !== type) : [...types, type];
          // (it has to watch for something)
          return kit.item(`Watch for ${label.toLowerCase()}`, () => this._setOpts(el.key, { types: next }), { mark: on ? "✓" : "", disabled: on && types.length === 1 });
        });
        const low = conf.stream === "low";
        return [
          kit.head(cams[el.cam].name || cams[el.cam].entity, "Tracking tile"),
          kit.item("Open camera", () => this._openLive(el.cam)),
          ...(admin ? [kit.item("Edit this tracker…", () => this._editTracker(el.key))] : []),
          ...sizes(kit),
          kit.hr(),
          ...watch,
          kit.item("Sharpest stream at home", () => this._setOpts(el.key, { stream: low ? "auto" : "low" }), { mark: low ? "" : "✓" }),
          kit.hr(),
          // how it looks while standing by
          ...[["radar", "Radar"], ["pulse", "Pulse"], ["scanline", "Scan line"], ["static", "Static"], ["none", "None"]].map(([style, label]) =>
            kit.item(`Standby: ${label.toLowerCase()}`, () => this._setOpts(el.key, { standby: style }), { mark: (conf.standby || "radar") === style ? "✓" : "" })
          ),
          kit.hr(),
          kit.item("Remove from wall", () => this._setShown(el.key, false)),
        ];
      },
    };
    this._wMenuOpen(x, y, (kit) => [...(kinds[el.kind] ? kinds[el.kind](kit) : [kit.head(el.name)]), ...more(kit)]);
  }

  // Right-click and long press on the wall.
  _wMenuWire(stage) {
    const tileAt = (ev) => {
      const path = ev.composedPath ? ev.composedPath() : [];
      const i = (this._tiles || []).findIndex((t) => path.includes(t));
      return i < 0 ? null : i;
    };
    stage.addEventListener("contextmenu", (ev) => {
      if (this._arranging) return;
      ev.preventDefault();
      if (Date.now() - (this._menuAt || 0) < 700) return; // (the long press has just opened it)
      this._wallContext(ev.clientX, ev.clientY, tileAt(ev));
      // on the way down: Home Assistant's own cards (the camera tiles) stop a
      // right-click from travelling back up, so it would never get here
    }, true);
    // a finger held still (no right button there); moving, as in scrolling, is not it
    let press = null;
    const drop = () => {
      if (press) clearTimeout(press.timer);
      press = null;
    };
    stage.addEventListener("pointerdown", (ev) => {
      drop();
      if (ev.pointerType !== "touch" || this._arranging) return;
      const [x, y, i] = [ev.clientX, ev.clientY, tileAt(ev)];
      press = { id: ev.pointerId, x, y, timer: setTimeout(() => {
        press = null;
        this._wallContext(x, y, i);
      }, 550) };
    }, true); // (on the way down too: nothing in a tile can keep the press from us)
    stage.addEventListener("pointermove", (ev) => {
      if (press && ev.pointerId === press.id && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 10) drop();
    }, true);
    stage.addEventListener("pointerup", drop, true);
    stage.addEventListener("pointercancel", drop, true);
    // (one listener for the page's scrolling, however often the wall is rebuilt)
    if (this._wScroll) window.removeEventListener("scroll", this._wScroll, true);
    this._wScroll = drop;
    window.addEventListener("scroll", drop, { passive: true, capture: true });
  }

  // Starts or stops listening, to fit the camera on screen and the button.
  _ltSync() {
    const root = this._liveRoot;
    if (!root || !this._hass) return;
    const cfg = this._config;
    if (cfg.live_tracks === false || this._ltNone) {
      root.querySelector(".lbox").hidden = true;
      return this._ltStop();
    }
    this._ltAsk();
    const cam = this._liveIndex != null ? this._config.cameras[this._liveIndex] : null;
    const able = !!(cam && this._ltCams && (this._ltCams[cam.entity] || this._ltCams[cam.tap_entity]));
    const boxes = able && this._ltPref(LIVE_BOXES_KEY);
    const bBtn = root.querySelector(".lbox");
    bBtn.hidden = !able;
    bBtn.classList.toggle("on", boxes);
    if (!boxes) return this._ltStop();
    const entity = this._ltCams[cam.entity] ? cam.entity : cam.tap_entity;
    const src = this._ltSource();
    let lt = this._lt;
    if (!lt || lt.entity !== entity || lt.src !== src) {
      this._ltStop();
      lt = this._lt = Object.assign(new LiveTracks(), { entity, src, els: new Map(), placeAt: 0, place: null });
      // (whose positions: see `source` in protect-live.js)
      lt.stop = subscribeLive(
        this._hass,
        entity,
        src,
        (msg) => this._lt === lt && this._ltMessage(lt, msg),
        (st) => {
          if (this._lt !== lt) return;
          lt.using = st.using;
          lt.mode = st.mode || null;
          lt.missing = !st.using;
          lt.why = st.code || null;
          if (st.using === "tracker") {
            try {
              localStorage.setItem(LIVE_TRACKER_KEY, "1"); // (so the choice is offered from now on)
            } catch (e) {}
          }
          this._ltMark(lt);
          if (st.using || src === "local") return; // (local, not there: said on the chip; it is looked for again)
          if (st.code === "unknown_command") this._ltNone = true;
          this._ltStop();
          this._ltSync(); // (hides the buttons if it is gone)
        }
      );
    }
    if (!lt.raf) {
      const step = () => {
        if (this._lt !== lt) return;
        lt.raf = requestAnimationFrame(step);
        try {
          this._ltFrame(lt);
        } catch (err) {
          console.error("camera-wall-card: live boxes", err);
        }
      };
      lt.raf = requestAnimationFrame(step);
    }
  }

  _ltStop() {
    const lt = this._lt;
    if (!lt) return;
    this._lt = null;
    cancelAnimationFrame(lt.raf);
    if (lt.stop) lt.stop();
    this._ltMark(null);
    this._ltHold(0); // the picture as live as it gets again
    const layer = this._liveRoot && this._liveRoot.querySelector(".lboxes");
    if (layer) {
      layer.replaceChildren();
      layer.style.display = "none";
    }
  }

  _ltMessage(lt, msg) {
    if (msg && msg.status) {
      // (Protect Tracker's local mode says when its engine's connection goes and comes back)
      if (msg.mode) lt.mode = msg.mode;
      const down = msg.status === "disconnected" && lt.mode === "local";
      if (down !== !!lt.down) {
        lt.down = down;
        this._ltMark(lt);
      }
      return;
    }
    lt.message(msg);
  }

  // The chip beside Boxes says whose boxes are shown, and is where that is
  // picked: Auto (Protect Tracker's where it has them, Protect's otherwise),
  // Local (only what Protect Tracker's own model made), UniFi (only
  // Protect's own, nothing from Protect Tracker). It says the choice, not
  // who made the last packet, so it stays still. It is offered once Protect
  // Tracker has been seen, or when the card's `source` is set.
  _ltMark(lt) {
    const chip = this._liveRoot && this._liveRoot.querySelector(".lsrc");
    if (!chip) return;
    let known = false;
    let picked = null;
    try {
      known = localStorage.getItem(LIVE_TRACKER_KEY) === "1";
      picked = localStorage.getItem(LIVE_SOURCE_KEY);
    } catch (e) {}
    const show = !!lt && (known || !!this._config.source || !!LIVE_SOURCE_NAMES[picked] || lt.using === "tracker");
    chip.hidden = !show;
    if (!show) return;
    const src = lt.src;
    let text = LIVE_SOURCE_NAMES[src];
    let title = { auto: "Boxes: Protect Tracker's where it has them, UniFi Protect's otherwise (dashed). Click for only the local ones", local: "Boxes: what Protect Tracker's own model sees, whether or not UniFi Protect reports it (dotted until it does). Click for only UniFi Protect's", protect: "Boxes: only UniFi Protect's own. Click for the best of both" }[src];
    if (src === "local" && lt.missing) {
      text += lt.why === "not_ready" ? " · engine not running" : lt.why === "unknown_command" ? " · not installed" : " · not answering";
      title = "Protect Tracker isn't answering, so there are no local boxes. Click for UniFi Protect's";
    } else if (src === "local" && (lt.down || lt.quiet)) {
      text += " · engine down";
      title = "Protect Tracker's engine is not connected, or has gone quiet. Click for UniFi Protect's";
    } else if (src === "local" && lt.using === "tracker" && lt.mode !== "local") {
      text += " · older tracker";
      title = "This Protect Tracker has no local mode yet: these are its model's boxes out of its mixed feed. Click for UniFi Protect's";
    } else if (src === "local" && lt.idle) {
      text += " · nothing now";
      title = "Protect Tracker's model has nothing in view right now (UniFi Protect does). Click for UniFi Protect's";
    }
    if (chip.textContent !== text) chip.textContent = text;
    chip.title = title;
    chip.classList.toggle("warn", src === "local" && (!!lt.missing || !!lt.idle || !!lt.down || lt.quiet));
  }

  static _ltAt(t, at) {
    return LiveTracks.at(t, at);
  }

  _ltHold(ms) {
    return LiveTracks.hold(this._liveStream, ms);
  }

  // How far behind the camera the picture on screen is (ms); also sees to
  // it that the picture is held back as wanted (not while talking).
  _ltBehind(lt) {
    const cfg = this._config;
    return lt.behind(this._liveStream, { delay: cfg.live_delay, offset: cfg.live_offset, talking: !!this._talk, debug: !!cfg.live_debug });
  }

  // One screen frame: the boxes where they belong now.
  _ltFrame(lt) {
    const root = this._liveRoot;
    const layer = root.querySelector(".lboxes");
    const behind = this._ltBehind(lt);
    // the camera's moment that is on screen now
    const at = lt.moment(behind);
    const now = lt.visible(at, false, lt.src === "local"); // (nothing parked: not worth a box)
    // where the picture is, in the zooming element's own pixels (looked up now and then)
    const stamp = Date.now();
    if (stamp - lt.placeAt > 500) {
      lt.placeAt = stamp;
      let pic = null;
      for (const el of this._liveStream ? findVideos(this._liveStream, [], ["VIDEO", "IMG"]) : []) {
        const b = pictureBox(el, this._rect(el));
        if (b && (!pic || b.width * b.height > pic.width * pic.height)) pic = b;
      }
      if (pic) {
        const frame = this._rect(root.querySelector(".zoom"));
        const k = (this._zoom && this._zoom.s) || 1;
        lt.place = [(pic.left - frame.left) / k, (pic.top - frame.top) / k, pic.width / k, pic.height / k];
      } else lt.place = null;
      // (gone quiet, or back: the chip says so)
      if (lt.src === "local" && lt.quiet !== !!lt.wasQuiet) {
        lt.wasQuiet = lt.quiet;
        this._ltMark(lt);
      }
      // Local picked and the model has nothing while Protect does: said on the chip (after a moment, so it doesn't blink)
      if (lt.src === "local") {
        const none = lt.using === "tracker" && !now.length && lt.visible(at).length > 0;
        if (!none) lt.noneSince = 0;
        else if (!lt.noneSince) lt.noneSince = stamp;
        const idle = !!lt.noneSince && stamp - lt.noneSince >= 1500;
        if (idle !== !!lt.idle) {
          lt.idle = idle;
          this._ltMark(lt);
        }
      }
      // live_debug: how the boxes are being timed, written on the picture
      const dbg = root.querySelector(".ldebug");
      if (dbg) {
        dbg.hidden = !this._config.live_debug;
        if (this._config.live_debug) dbg.textContent = lt.describe(behind);
      }
    }
    const place = lt.place;
    // boxes
    const keep = new Set();
    if (place) {
      layer.style.cssText = `left:${place[0].toFixed(1)}px;top:${place[1].toFixed(1)}px;width:${place[2].toFixed(1)}px;height:${place[3].toFixed(1)}px;--k:${(1 / ((this._zoom && this._zoom.s) || 1)).toFixed(4)}`;
      for (const { t, box, of } of now) {
        keep.add(t.id);
        let el = lt.els.get(t.id);
        if (!el) {
          el = document.createElement("div");
          el.className = "lbox-it";
          el.appendChild(document.createElement("span"));
          layer.appendChild(el);
          lt.els.set(t.id, el);
        }
        // (a face found on the person it is drawn with needs no name of its own)
        const label = of != null ? "" : `${t.type.charAt(0).toUpperCase()}${t.type.slice(1)}${t.desc ? ` · ${t.desc}` : ""}`;
        el.classList.toggle("part", of != null);
        // (Auto, with Protect Tracker: a box that is Protect's own, passed on, is dashed)
        el.classList.toggle("passed", lt.using === "tracker" && lt.src !== "protect" && of == null && !t.local);
        // (local mode: seen by the model only so far; Protect hasn't reported it)
        el.classList.toggle("seen", t.confirmed === false && of == null);
        if (el.firstChild.textContent !== label) el.firstChild.textContent = label;
        el.style.cssText = `left:${(box[0] / 10).toFixed(2)}%;top:${(box[1] / 10).toFixed(2)}%;width:${(box[2] / 10).toFixed(2)}%;height:${(box[3] / 10).toFixed(2)}%;--c:${LIVE_COLORS[t.type] || "#e5e7eb"}`;
        el.firstChild.classList.toggle("below", box[1] < 60);
      }
    } else layer.style.display = "none";
    for (const [id, el] of lt.els) {
      if (keep.has(id)) continue;
      el.remove();
      lt.els.delete(id);
    }
  }

  _zoomApply() {
    const root = this._liveRoot;
    if (!root) return;
    const z = (this._zoom = this._zoom || { s: 1, x: 0, y: 0 });
    const frame = root.querySelector(".frame");
    const w = frame.clientWidth || 0;
    const h = frame.clientHeight || 0;
    z.s = Math.max(1, Math.min(ZOOM_MAX, z.s));
    if (z.s < 1.02) z.s = 1;
    z.x = Math.min(0, Math.max(w * (1 - z.s), z.x));
    z.y = Math.min(0, Math.max(h * (1 - z.s), z.y));
    root.querySelector(".zoom").style.transform = z.s === 1 ? "" : `translate(${z.x.toFixed(1)}px, ${z.y.toFixed(1)}px) scale(${z.s.toFixed(3)})`;
    frame.classList.toggle("zoomed", z.s > 1);
    const chip = root.querySelector(".zoomx");
    chip.hidden = z.s === 1;
    chip.lastElementChild.textContent = `${z.s.toFixed(1)}×`;
    this._fitZones(); // where the picture is on screen has changed
    root.querySelector(".zones").style.setProperty("--k", (1 / z.s).toFixed(4));
  }

  // Zoom to `s`, keeping the point of the picture under (clientX, clientY)
  // where it is (the middle of the frame if no point is given). The point is
  // one the dialog sees: _pt() of where the pointer is on screen.
  _zoomTo(s, clientX, clientY) {
    const root = this._liveRoot;
    if (!root) return;
    const z = (this._zoom = this._zoom || { s: 1, x: 0, y: 0 });
    const r = this._rect(root.querySelector(".frame"));
    const px = clientX == null ? r.width / 2 : clientX - r.left;
    const py = clientY == null ? r.height / 2 : clientY - r.top;
    const to = Math.max(1, Math.min(ZOOM_MAX, s));
    z.x = px - ((px - z.x) / z.s) * to;
    z.y = py - ((py - z.y) / z.s) * to;
    z.s = to;
    this._zoomApply();
  }

  _zoomSetup(frame) {
    this._zoom = { s: 1, x: 0, y: 0 };
    frame.addEventListener(
      "wheel",
      (ev) => {
        if (ev.ctrlKey && !ev.deltaY) return;
        ev.preventDefault(); // the page behind doesn't scroll
        const step = Math.max(-1, Math.min(1, -ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0018)));
        this._zoomTo(this._zoom.s * Math.exp(step), ...this._pt(ev.clientX, ev.clientY));
      },
      { passive: false }
    );
    // Mouse: drag the zoomed picture. It only counts as a drag once the
    // pointer has moved, so a plain click still reaches the video's controls.
    let drag = null;
    frame.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType === "touch" || ev.button !== 0 || this._zoom.s === 1 || this._zEdit) return;
      const [x, y] = this._pt(ev.clientX, ev.clientY);
      drag = { id: ev.pointerId, x, y, zx: this._zoom.x, zy: this._zoom.y, moved: false };
    });
    frame.addEventListener("pointermove", (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const [x, y] = this._pt(ev.clientX, ev.clientY);
      const dx = x - drag.x;
      const dy = y - drag.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 5) return;
        drag.moved = true;
        frame.classList.add("panning");
        try {
          frame.setPointerCapture(ev.pointerId);
        } catch (e) {}
      }
      this._zoom.x = drag.zx + dx;
      this._zoom.y = drag.zy + dy;
      this._zoomApply();
    });
    const drop = (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      if (drag.moved) this._zoomDragged = Date.now(); // the click that ends a drag isn't one
      drag = null;
      frame.classList.remove("panning");
    };
    frame.addEventListener("pointerup", drop);
    frame.addEventListener("pointercancel", drop);
    frame.addEventListener(
      "click",
      (ev) => {
        if (Date.now() - (this._zoomDragged || 0) < 250) {
          ev.stopPropagation();
          ev.preventDefault();
        }
      },
      true
    );
    // Touch: two fingers zoom and move; one finger moves a zoomed picture.
    let touch = null;
    const span = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t) => this._pt(...(t.length > 1 ? [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2] : [t[0].clientX, t[0].clientY]));
    const begin = (ev) => {
      const t = ev.touches;
      if (this._zEdit || !t.length || (t.length === 1 && this._zoom.s === 1)) return (touch = null);
      touch = { n: t.length, span: t.length > 1 ? span(t) : 0, at: mid(t), s: this._zoom.s, moved: false };
    };
    frame.addEventListener("touchstart", begin, { passive: true });
    frame.addEventListener(
      "touchmove",
      (ev) => {
        const t = ev.touches;
        if (!touch || !t.length) return;
        if (t.length !== touch.n) begin(ev); // a finger added or lifted: carry on from here
        if (!touch) return;
        const at = mid(t);
        if (!touch.moved && t.length === 1 && Math.hypot(at[0] - touch.at[0], at[1] - touch.at[1]) < 8) return;
        touch.moved = true;
        ev.preventDefault(); // ours, not the browser's own zoom or scroll
        this._zoom.x += at[0] - touch.at[0];
        this._zoom.y += at[1] - touch.at[1];
        touch.at = at;
        if (t.length > 1 && touch.span > 0) this._zoomTo((touch.s * span(t)) / touch.span, at[0], at[1]);
        else this._zoomApply();
      },
      { passive: false }
    );
    const lift = (ev) => {
      if (touch && touch.moved) this._zoomDragged = Date.now();
      if (ev.touches.length) begin(ev);
      else touch = null;
    };
    frame.addEventListener("touchend", lift, { passive: true });
    frame.addEventListener("touchcancel", lift, { passive: true });
  }

  _zLeave() {
    this._zMenuClose();
    this._zEditEnd();
    this._zBar(null);
    this._zPic = null;
  }

  // (re)attach the stream; only a real state change restarts it
  _updateLive() {
    if (this._liveIndex == null || !this._liveRoot || !this._hass) return;
    const id = this._liveEntity();
    const stateObj = (this._camHass || this._hass).states[id];
    if (!stateObj) return;
    if (!this._liveStream || this._liveStreamEntity !== id) {
      const el = document.createElement("ha-camera-stream");
      el.controls = true;
      // HA's player drops the audio track altogether when told "muted", so
      // ask for sound and mute the <video> itself (see _liveSound)
      el.muted = false;
      el.allowExoPlayer = true;
      this._liveRoot.querySelector(".video").replaceChildren(el);
      this._liveStream = el;
      this._liveStreamEntity = id;
      this._liveSound();
    }
    this._liveStream.hass = this._hass;
    if (this._liveStream.stateObj !== stateObj) this._liveStream.stateObj = stateObj;
  }

  // Start each live <video> silent, or with sound if that's how it was left
  // last time; the player's own speaker button switches it and is remembered.
  _liveSound() {
    clearInterval(this._soundTimer);
    const find = (root, out = []) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.tagName === "VIDEO") out.push(el);
        if (el.shadowRoot) find(el.shadowRoot, out);
      }
      return out;
    };
    const apply = () => {
      if (!this._liveStream || !this._liveStream.isConnected) return clearInterval(this._soundTimer);
      for (const v of this._liveStream.shadowRoot ? find(this._liveStream.shadowRoot) : []) {
        if (v._wallSound) continue;
        v._wallSound = true;
        let on = false;
        try { on = localStorage.getItem("camera-wall-card:live-sound") === "1"; } catch (e) {}
        v.muted = !on;
        v.addEventListener("volumechange", () => {
          try { localStorage.setItem("camera-wall-card:live-sound", v.muted ? "0" : "1"); } catch (e) {}
        });
      }
    };
    apply();
    // the same tick keeps the zone layer on the picture (it appears, changes
    // shape with the stream, moves when the dialog is resized)
    this._soundTimer = setInterval(() => {
      apply();
      this._fitZones();
    }, 300);
  }

  // ------------------------------------------------------------- talkback

  // Protect camera id of the camera on screen, if it has a speaker
  _speakerId() {
    const cam = this._config.cameras[this._liveIndex];
    const map = this._speakers || {};
    return (cam && (map[cam.entity] || map[cam.tap_entity])) || null;
  }

  _showMic() {
    const mic = this._liveRoot && this._liveRoot.querySelector(".mic");
    if (!mic) return;
    if (!this._speakers && !this._speakersAsked && this._hass) {
      this._speakersAsked = true;
      this._hass
        .callWS({ type: "protect_detections/speakers" })
        .then((r) => {
          this._speakers = r.speakers || {};
          if (this._liveIndex != null) this._showMic();
        })
        .catch(() => {
          this._speakersAsked = false; // e.g. HA was restarting: ask again next time
        });
    }
    mic.hidden = !this._speakerId();
    this._micLabel();
  }

  _micLabel(note) {
    const mic = this._liveRoot.querySelector(".mic");
    const on = !!this._talk;
    mic.classList.toggle("on", on);
    mic.firstElementChild.setAttribute("icon", on ? "mdi:microphone" : "mdi:microphone-outline");
    mic.lastElementChild.textContent = note || (on ? (this._talk.live ? "Talking" : "Connecting…") : "Talk");
    clearTimeout(this._micNote);
    if (note) this._micNote = setTimeout(() => this._liveRoot && this._micLabel(), 5000);
  }

  // microphone -> MediaRecorder chunks -> websocket -> the camera's speaker
  async _startTalk() {
    const id = this._speakerId();
    if (!id || this._talk) return;
    const mime = window.MediaRecorder && ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) return this._micLabel("Not supported here");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // browsers only hand out the microphone on https (or in the app): on the
      // plain home-network address, talk from a small window on the https one
      const remote = this._config.remote_url || "";
      if (window.isSecureContext || !remote.startsWith("https://")) return this._micLabel(window.isSecureContext ? "No microphone" : "Needs the https address");
      return this._talkWindow(id, mime, remote);
    }
    const talk = (this._talk = { live: false });
    this._micLabel();
    try {
      talk.media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this._talk !== talk) return talk.media.getTracks().forEach((t) => t.stop());
      const fmt = mime.startsWith("audio/mp4") ? "mp4" : "webm";
      const signed = await this._hass.callWS({
        type: "auth/sign_path",
        path: `/api/protect_detections/talk/${id}?fmt=${fmt}`,
        expires: 30,
      });
      if (this._talk !== talk) return talk.media.getTracks().forEach((t) => t.stop());
      const ws = (talk.ws = new WebSocket(location.origin.replace(/^http/, "ws") + signed.path));
      ws.onmessage = (ev) => {
        let msg = {};
        try { msg = JSON.parse(ev.data); } catch (e) {}
        if (msg.error) return this._stopTalk(msg.error);
        if (!msg.ready || talk.rec) return;
        talk.rec = new MediaRecorder(talk.media, { mimeType: mime, audioBitsPerSecond: 32000 });
        talk.rec.ondataavailable = (e) => {
          if (e.data.size && ws.readyState === 1) ws.send(e.data);
        };
        talk.rec.start(60);
        talk.live = true;
        if (this._talk === talk) this._micLabel();
      };
      ws.onclose = () => {
        if (this._talk === talk) this._stopTalk(talk.live ? "" : "Couldn't connect");
      };
    } catch (err) {
      const denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
      if (this._talk === talk) this._stopTalk(denied ? "Microphone blocked" : "No microphone");
    }
  }

  async _talkWindow(id, mime, remote) {
    const win = window.open("", "protect-talk", "popup,width=340,height=260");
    if (!win) return this._micLabel("Pop-up blocked");
    const talk = (this._talk = { live: false, win });
    this._micLabel();
    try {
      const fmt = mime.startsWith("audio/mp4") ? "mp4" : "webm";
      const signed = await this._hass.callWS({
        type: "auth/sign_path",
        path: `/api/protect_detections/talk/${id}?fmt=${fmt}`,
        expires: 120, // leaves time to answer the microphone prompt
      });
      if (this._talk !== talk) return win.close();
      const cam = this._config.cameras[this._liveIndex];
      const name = cam.name || this._hass.states[cam.entity]?.attributes.friendly_name || "Camera";
      const hash = new URLSearchParams({ p: signed.path, m: mime, n: name });
      // (the talk page sits next to this file)
      win.location.replace(`${remote.replace(/\/$/, "")}${new URL("./talk.html", import.meta.url).pathname}#${hash}`);
      talk.live = true;
      this._micLabel();
      talk.watch = setInterval(() => {
        if (win.closed && this._talk === talk) this._stopTalk();
      }, 500);
    } catch (err) {
      win.close();
      if (this._talk === talk) this._stopTalk("Couldn't start");
    }
  }

  _stopTalk(note) {
    const talk = this._talk;
    this._talk = null;
    if (talk) {
      clearInterval(talk.watch);
      try { if (talk.win) talk.win.close(); } catch (e) {}
      try { if (talk.rec && talk.rec.state !== "inactive") talk.rec.stop(); } catch (e) {}
      if (talk.media) talk.media.getTracks().forEach((t) => t.stop());
      if (talk.ws) {
        talk.ws.onclose = null;
        try { talk.ws.close(); } catch (e) {}
      }
    }
    if (this._liveRoot) this._micLabel(note);
  }

  _closeLive() {
    if (this._liveIndex == null) return;
    this._zLeave();
    this._stopTalk();
    this._ltStop();
    clearInterval(this._soundTimer);
    window.removeEventListener("keydown", this._onLiveKey);
    this._liveIndex = null;
    this._phoneLeave(); // the screen as it was
    this._liveHost.style.display = "none";
    this._liveRoot.querySelector(".video").replaceChildren(); // stops the stream
    this._liveResize?.disconnect();
    this._liveRoot.querySelector(".zones").style.display = "none";
    this._zonesDrawn = null;
    this._liveStream = null;
    this._liveStreamEntity = null;
    this._syncPause(); // and the tiles take theirs back
  }

  _layout() {
    if (!this._grid) return;
    const cfg = this._config;
    const n = cfg.cameras.length;
    if (!n) return;
    const width = this.clientWidth - 2 * PAD;
    if (width <= 0) return;

    const { cols, rows, fixed, places } = this._plan();
    for (const { i, c, r, w, h } of places) {
      const el = this._tiles[i];
      if (el) {
        el.style.gridColumn = `${c + 1} / span ${w}`;
        el.style.gridRow = `${r + 1} / span ${h}`;
      }
      const dim = this._arrEls && this._arrEls[i] && this._arrEls[i].querySelector(".dim");
      if (dim) dim.textContent = `${w} × ${h}`;
      // a tracking tile takes the shape of its cells
      const x = (this._xTiles || [])[i - n];
      if (x) x.card.style.setProperty("--tile-ar", String((cfg.aspect_ratio * w) / h));
    }

    // Height available from the top of this card to the bottom of the window.
    const top = this.getBoundingClientRect().top + window.scrollY;
    const available = Math.max(0, window.innerHeight - top);
    this.style.minHeight = `${available}px`;

    const bar = this.shadowRoot && this.shadowRoot.querySelector(".arrbar");
    const alarmH = (this._alarmEl ? (this._alarmEl.offsetHeight || 0) + GAP : 0) + (bar && !bar.hidden ? (bar.offsetHeight || 0) + GAP : 0);
    const stageH = available - 2 * PAD - alarmH;

    const byWidth = (width - GAP * (cols - 1)) / cols;
    let tile = byWidth;
    if (cols > 1) {
      // Shrink tiles until every row fits on screen (keeps it centered, no scroll).
      const byHeight = ((stageH - GAP * (rows - 1)) / rows) * cfg.aspect_ratio;
      // (a wall arranged by hand keeps its columns, however small the screen)
      tile = Math.max(this._arrWide() ? 60 : 160, Math.min(byWidth, byHeight));
    }
    tile = Math.floor(tile);
    this._cell = { w: tile, h: Math.ceil(tile / cfg.aspect_ratio), cols, rows };
    this._grid.style.gridTemplateColumns = `repeat(${cols}, ${tile}px)`;
    // rows as high as a feed, once the wall is arranged by hand: its cells
    // may be empty or spanned (else each row is its feed's height, as ever)
    this._grid.style.gridAutoRows = fixed ? `${this._cell.h}px` : "";
    this._grid.style.gridTemplateRows = fixed ? `repeat(${rows}, ${this._cell.h}px)` : "";
    this._grid.classList.toggle("spans", fixed);
    if (this._arranging && fixed) this._arrCells(cols, rows);
    else if (!this._arranging) this._fitCards();
  }

  _bpCols() {
    // Columns from the configured breakpoints (screen width -> columns).
    const screen = window.innerWidth;
    for (const [minWidth, c] of [...this._config.breakpoints].sort((a, b) => b[0] - a[0])) {
      if (screen >= minWidth) return Math.max(1, c);
    }
    return 1;
  }

  // Which cells each tile takes (nothing is drawn here):
  // {cols, rows, fixed, places: [{i (which camera), id, c, r, w, h}]}.
  //  - nothing arranged: the cameras in the config's order, one cell each, in
  //    as many columns as the screen width allows;
  //  - arranged: where the user put them, on the grid they made, empty cells
  //    and all (the grid keeps its columns; the feeds get smaller instead);
  //  - a screen with one column: a plain list, in reading order.
  _plan() {
    const keys = this._shownKeys(); // (null: off the wall)
    const count = keys.filter(Boolean).length;
    const bp = this._bpCols();
    const src = this._arrWide();
    let g = src
      ? this._arrFree(src)
      : CameraWallCard._arrFlow(keys.map((id, i) => ({ i, id, w: 1, h: 1 })).filter((t) => t.id), Math.max(1, Math.min(bp, count)));
    let fixed = !!src;
    const reading = (a, b) => a.r - b.r || a.c - b.c;
    const list = this._arranging ? this._arrMode === "list" : bp === 1;
    if (list) {
      // one column: every camera, one under the other. In the order made
      // for this (a list of its own, so the wide wall isn't touched by it),
      // the rest as the wide wall reads, row by row.
      const wide = [...g.tiles].sort(reading);
      const own = this._arrListEdit || (this._arr && this._arr.list) || [];
      const rank = (t) => {
        const at = own.indexOf(t.id);
        return at < 0 ? own.length + wide.indexOf(t) : at;
      };
      g = { cols: 1, rows: count, tiles: [...wide].sort((a, b) => rank(a) - rank(b)).map((t, k) => ({ ...t, c: 0, r: k, w: 1, h: 1 })) };
      fixed = false;
    }
    this._eff = [];
    for (const t of g.tiles) this._eff[t.i] = { w: t.w, h: t.h };
    this._order = [...g.tiles].sort(reading).map((t) => t.i);
    return { cols: g.cols, rows: g.rows, fixed: fixed || (!!this._arranging && !list), places: g.tiles };
  }

  // -------------------------------------------------------- arranging
  //
  // The user's own order and sizes of the tiles, changed in "Arrange" mode
  // and kept with their Home Assistant user. It is only about where a tile is
  // shown: the list of cameras (and everything counted by it) stays as the
  // config or the lookup gave it, and a camera is known by its device, so a
  // rename or another stream changes nothing. A saved camera that is gone is
  // skipped, one that is new comes last at the usual size.

  // The wide wall's arrangement (being edited, else saved), if there is one.
  // (The saved thing may hold only the order of the one-column list.)
  _arrWide() {
    const a = this._arr;
    return this._arrEdit || (a && (a.grid || (a.tiles && a.tiles.length)) ? a : null);
  }

  _camKey(cam) {
    const ents = (this._hass && this._hass.entities) || {};
    const ent = ents[cam.entity] || ents[cam.tap_entity];
    return cam.device || (ent && ent.device_id) || cam.entity || "";
  }

  // The tiles of grid g that have a cell in the given area (but for `skip`).
  static _arrHits(g, c, r, w, h, skip) {
    return g.tiles.filter((t) => t !== skip && t.c < c + w && c < t.c + t.w && t.r < r + h && r < t.r + t.h);
  }

  // The first free place for w x h cells, reading across then down. Below
  // the last row too if `grow` (there always is one then), else maybe null.
  static _arrSpot(g, w, h, grow) {
    for (let r = 0; grow || r + h <= g.rows; r++) {
      for (let c = 0; c + w <= g.cols; c++) {
        if (!CameraWallCard._arrHits(g, c, r, w, h).length) return { c, r };
      }
    }
    return null;
  }

  // Tiles [{i, id, w, h}] put into a grid `cols` wide one after the other,
  // each in the first free place.
  static _arrFlow(items, cols) {
    cols = Math.max(1, Math.min(cols, items.reduce((sum, t) => sum + Math.min(t.w, cols), 0)));
    const g = { cols, rows: 0, tiles: [] };
    for (const t of items) {
      const w = Math.min(t.w, cols);
      const at = CameraWallCard._arrSpot(g, w, t.h, true);
      g.tiles.push({ ...t, w, c: at.c, r: at.r });
      g.rows = Math.max(g.rows, at.r + t.h);
    }
    return g;
  }

  // A saved arrangement as a grid for the cameras there are now:
  // {cols, rows, tiles: [{i, id, c, r, w, h}]}. A saved camera that is gone
  // leaves its cells empty; a camera not in it (or saved where it can't be)
  // takes the first free cell, on a new row if the grid is full. What an
  // earlier version saved, an order with sizes, becomes places here.
  _arrFree(src) {
    const keys = this._shownKeys(); // (null: off the wall)
    const int = (v, min) => (Number.isInteger(v) && v >= min ? Math.min(v, GRID_MAX) : min);
    const used = new Set();
    const find = (t) => (t && typeof t.id === "string" ? keys.findIndex((k, at) => k === t.id && !used.has(at)) : -1);
    const tiles = Array.isArray(src.tiles) ? src.tiles : [];
    if (!src.grid) {
      const items = [];
      for (const t of tiles) {
        const i = find(t);
        if (i < 0) continue;
        used.add(i);
        items.push({ i, id: keys[i], w: int(t.w, 1), h: Math.min(int(t.h, 1), 3) });
      }
      keys.forEach((key, i) => {
        if (key && !used.has(i)) items.push({ i, id: key, w: 1, h: 1 });
      });
      // as wide as the widest layout: where it was most likely made
      return CameraWallCard._arrFlow(items, Math.max(1, ...this._config.breakpoints.map((b) => b[1])));
    }
    const g = { cols: int(src.grid.cols, 1), rows: int(src.grid.rows, 1), tiles: [] };
    const later = [];
    for (const t of tiles) {
      const i = find(t);
      if (i < 0) continue;
      used.add(i);
      const place = { i, id: keys[i], c: int(t.c, 0), r: int(t.r, 0), w: int(t.w, 1), h: int(t.h, 1) };
      const fits = place.c + place.w <= g.cols && place.r + place.h <= g.rows;
      if (fits && !CameraWallCard._arrHits(g, place.c, place.r, place.w, place.h).length) g.tiles.push(place);
      else later.push(place);
    }
    keys.forEach((key, i) => {
      if (key && !used.has(i)) later.push({ i, id: key });
    });
    for (const t of later) {
      const at = CameraWallCard._arrSpot(g, 1, 1, true);
      g.tiles.push({ i: t.i, id: t.id, c: at.c, r: at.r, w: 1, h: 1 });
      g.rows = Math.max(g.rows, at.r + 1);
    }
    return g;
  }

  // A feed whose tile changed shape gets a card of that shape (this starts
  // its stream anew, so it is left until arranging is done).
  _fitCards() {
    if (!this._camCards || !this._eff || !this._builtCfg || this._builtCfg !== this._config) return;
    const camHass = this._cameraHass(this._hass);
    this._camCards.forEach((card, i) => {
      const eff = this._eff[i] || { w: 1, h: 1 };
      const span = `${eff.w}x${eff.h}`;
      if (this._pausedTiles) {
        // resting: the stand-in takes the shape, the card is made on waking
        const ph = this._pausedTiles[i];
        if (ph) ph.style.aspectRatio = String((this._builtCfg.aspect_ratio * eff.w) / eff.h);
        return;
      }
      if (!card || (card._span || "1x1") === span) return;
      const fresh = this._makeCamCard(this._builtCfg, i);
      card.replaceWith(fresh);
      fresh.hass = camHass;
      this._camCards[i] = fresh;
    });
  }

  _arrName() {
    return String((this._config && this._config.layout) || "default");
  }

  static _arrValid(a) {
    if (!a || typeof a !== "object" || !Array.isArray(a.tiles)) return null;
    const out = { tiles: a.tiles.filter((t) => t && typeof t.id === "string") };
    // (with a grid: places; without: the order and sizes an earlier version kept)
    if (a.grid && Number.isInteger(a.grid.cols) && Number.isInteger(a.grid.rows)) out.grid = { cols: a.grid.cols, rows: a.grid.rows };
    // the order of the one-column list, kept apart from the wide wall
    if (Array.isArray(a.list)) out.list = a.list.filter((id) => typeof id === "string");
    // what the user took off the wall, and each tile's own options
    if (Array.isArray(a.hidden)) out.hidden = a.hidden.filter((id) => typeof id === "string");
    if (a.opts && typeof a.opts === "object" && !Array.isArray(a.opts)) out.opts = a.opts;
    return out;
  }

  // The saved arrangement: this browser's copy at once, the user's own from
  // Home Assistant when it answers (that one counts, unless this browser has
  // a change Home Assistant never took).
  _arrLoad() {
    if (this._arrAsked === this._arrName() || !this._hass) return;
    const name = (this._arrAsked = this._arrName());
    let local = null;
    try {
      local = JSON.parse(localStorage.getItem(ARRANGE_LOCAL_KEY + name) || "null");
    } catch (e) {}
    this._arr = local && local.cleared ? null : CameraWallCard._arrValid(local);
    const unsent = !!(local && local.unsent);
    Promise.resolve(this._hass.callWS({ type: "frontend/get_user_data", key: ARRANGE_USER_KEY })).then(
      (res) => {
        if (this._arrAsked !== name) return;
        const all = res && res.value && typeof res.value === "object" ? res.value : {};
        this._arrAll = all;
        if (unsent) return this._arrStore(this._arr, true); // hand it over now
        const mine = CameraWallCard._arrValid(all.walls && all.walls[name]);
        if (JSON.stringify(mine) === JSON.stringify(this._arr)) return;
        this._arrLocal(mine, false);
        if (this._arranging) return; // (not under the user's hands)
        this._arr = mine;
        this._applyShown();
        this._layout();
      },
      () => {} // this browser's copy it is
    );
  }

  _arrLocal(arr, unsent) {
    try {
      if (arr || unsent) localStorage.setItem(ARRANGE_LOCAL_KEY + this._arrName(), JSON.stringify({ ...(arr || { tiles: [] }), unsent: !!unsent, cleared: !arr }));
      else localStorage.removeItem(ARRANGE_LOCAL_KEY + this._arrName());
    } catch (e) {}
  }

  // Keeps the arrangement (null: none, back to the config's own order).
  async _arrStore(arr, quiet) {
    const name = this._arrName();
    this._arrLocal(arr, true); // until Home Assistant has it
    try {
      if (!this._arrAll) {
        const res = await this._hass.callWS({ type: "frontend/get_user_data", key: ARRANGE_USER_KEY });
        this._arrAll = res && res.value && typeof res.value === "object" ? res.value : {};
      }
      const walls = { ...(this._arrAll.walls || {}) };
      if (arr) walls[name] = CameraWallCard._arrValid(arr);
      else delete walls[name];
      const value = { ...this._arrAll, v: 1, walls };
      await this._hass.callWS({ type: "frontend/set_user_data", key: ARRANGE_USER_KEY, value });
      this._arrAll = value;
      if (this._arrName() === name) this._arrLocal(arr, false);
      if (!quiet) this._arrNote(arr ? "Arrangement saved" : "Back to the usual arrangement", 3000);
    } catch (err) {
      if (quiet !== true) this._arrNote("Kept in this browser only: Home Assistant didn't take it. It is sent again next time.", 8000);
    }
  }

  _arrNote(text, ms) {
    const bar = this.shadowRoot && this.shadowRoot.querySelector(".arrbar");
    if (!bar || this._arranging) return;
    clearTimeout(this._arrNoteTimer);
    const span = document.createElement("span");
    span.textContent = text;
    bar.replaceChildren(span);
    bar.hidden = false;
    this._layout();
    this._arrNoteTimer = setTimeout(() => {
      if (this._arranging) return;
      bar.hidden = true;
      this._layout();
    }, ms);
  }

  _arrEnter() {
    if (this._arranging || !this._grid || !this._tiles || !this._tiles.length) return;
    clearTimeout(this._arrNoteTimer);
    if (this._bpCols() === 1) return this._arrEnterList();
    // starts from the wall as it is shown now
    const now = this._plan();
    this._arranging = true;
    this._arrMode = "grid";
    this._arrEdit = { grid: { cols: now.cols, rows: now.rows }, tiles: now.places.map(({ id, c, r, w, h }) => ({ id, c, r, w, h })) };
    const root = this.shadowRoot;
    const bar = root.querySelector(".arrbar");
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      if (tag === "button") e.type = "button";
      return e;
    };
    const hint = el("span", "", "Drag a camera to any cell; drag its corner, or tap its size, to resize.");
    const stepper = (label, key) => {
      const grp = el("div", "grp");
      const minus = el("button", "", "−");
      const plus = el("button", "", "+");
      const count = el("b", `n-${key}`, "");
      minus.title = `One ${label.toLowerCase().replace(/s$/, "")} fewer`;
      plus.title = `One ${label.toLowerCase().replace(/s$/, "")} more`;
      minus.onclick = () => this._arrGrid(key, -1);
      plus.onclick = () => this._arrGrid(key, 1);
      grp.append(el("span", "", label), minus, count, plus);
      return grp;
    };
    const exit = (label, how, main) => {
      const b = el("button", main ? "main" : "", label);
      b.onclick = () => this._arrExit(how);
      return b;
    };
    bar.replaceChildren(hint, stepper("Columns", "cols"), stepper("Rows", "rows"), exit("Done", "save", true), exit("Reset", "reset"), exit("Cancel", "cancel"), el("div", "why", ""));
    bar.hidden = false;
    root.querySelector(".arr-btn")?.classList.add("on");
    this._arrEls = this._tiles.map((tile, i) => {
      const o = document.createElement("div");
      o.className = "arr";
      o.innerHTML = `<div class="grip" title="Drag to move"><ha-icon icon="mdi:drag"></ha-icon></div>
        <button class="dim" type="button" title="Tap for the next size"></button>
        <div class="size" title="Drag to resize"><ha-icon icon="mdi:resize-bottom-right"></ha-icon></div>`;
      this._arrWire(o, tile, i);
      tile.appendChild(o);
      return o;
    });
    this._layout();
  }

  // On one column the wall is a list: only its order can be changed, by a
  // feed's grip or its arrows. That order is this layout's own.
  _arrEnterList() {
    const now = this._plan();
    this._arranging = true;
    this._arrMode = "list";
    this._arrListEdit = now.places.map((t) => t.id);
    const root = this.shadowRoot;
    const bar = root.querySelector(".arrbar");
    const hint = document.createElement("span");
    hint.textContent = "Change the order with the arrows, or drag a camera by its grip.";
    const exit = (label, how, main) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (main) b.className = "main";
      b.onclick = () => this._arrExit(how);
      return b;
    };
    bar.replaceChildren(hint, exit("Done", "save", true), exit("Reset", "reset"), exit("Cancel", "cancel"));
    bar.hidden = false;
    root.querySelector(".arr-btn")?.classList.add("on");
    this._arrEls = this._tiles.map((tile, i) => {
      const o = document.createElement("div");
      o.className = "arr list";
      o.innerHTML = `<div class="grip" title="Drag to move"><ha-icon icon="mdi:drag"></ha-icon></div>
        <div class="mv"><button class="up" type="button" title="Move up"><ha-icon icon="mdi:arrow-up"></ha-icon></button><button class="down" type="button" title="Move down"><ha-icon icon="mdi:arrow-down"></ha-icon></button></div>`;
      this._arrWireList(o, tile, i);
      tile.appendChild(o);
      return o;
    });
    this._layout();
  }

  // Camera i to position `to` of the list being ordered.
  _arrListMove(i, to) {
    const list = this._arrListEdit;
    const id = this._tileKeys()[i];
    const from = list ? list.indexOf(id) : -1;
    if (from < 0 || to < 0 || to >= list.length || to === from) return;
    list.splice(to, 0, list.splice(from, 1)[0]);
    this._layout();
  }

  _arrWireList(el, tile, i) {
    const where = () => this._arrListEdit.indexOf(this._tileKeys()[i]);
    el.querySelector(".up").onclick = () => this._arrListMove(i, where() - 1);
    el.querySelector(".down").onclick = () => this._arrListMove(i, where() + 1);
    let op = null;
    const over = (y) =>
      this._tiles.findIndex((other, j) => {
        if (j === i) return false;
        const r = other.getBoundingClientRect();
        return y >= r.top && y <= r.bottom;
      });
    el.addEventListener("pointerdown", (ev) => {
      if (op || (ev.button != null && ev.button > 0) || !ev.target) return;
      const on = (cls) => !!(ev.target.closest && ev.target.closest(cls));
      if (on(".mv")) return;
      if (ev.pointerType !== "mouse" && !on(".grip")) return; // a finger elsewhere: scrolling
      op = { id: ev.pointerId, y: ev.clientY, target: -1 };
      try {
        el.setPointerCapture(ev.pointerId);
      } catch (e) {}
      tile.classList.add("dragging");
      ev.preventDefault();
    });
    el.addEventListener("pointermove", (ev) => {
      if (!op || ev.pointerId !== op.id) return;
      tile.style.transform = `translate(0px, ${ev.clientY - op.y}px)`;
      const target = over(ev.clientY);
      if (target === op.target) return;
      if (op.target >= 0) this._tiles[op.target].classList.remove("drop");
      if (target >= 0) this._tiles[target].classList.add("drop");
      op.target = target;
    });
    const end = (ev, drop) => {
      if (!op || ev.pointerId !== op.id) return;
      const done = op;
      op = null;
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch (e) {}
      tile.classList.remove("dragging");
      tile.style.transform = "";
      if (done.target < 0) return;
      this._tiles[done.target].classList.remove("drop");
      // takes the place of the one it was dropped on
      if (drop) this._arrListMove(i, this._arrListEdit.indexOf(this._tileKeys()[done.target]));
    };
    el.addEventListener("pointerup", (ev) => end(ev, true));
    el.addEventListener("pointercancel", (ev) => end(ev, false));
    el.addEventListener("click", (ev) => ev.stopPropagation());
  }

  // how: "save" keeps the changes, "reset" forgets the arrangement, "cancel"
  // drops the changes. The wide wall and the one-column list are kept apart:
  // each is saved, and reset, without touching the other.
  _arrExit(how) {
    if (!this._arranging) return;
    const edit = this._arrEdit;
    const listEdit = this._arrListEdit;
    const mode = this._arrMode;
    this._arranging = false;
    this._arrEdit = null;
    this._arrListEdit = null;
    this._arrMode = null;
    for (const el of [...(this._arrEls || []), ...(this._arrCellEls || [])]) el.remove();
    this._arrEls = null;
    this._arrCellEls = null;
    for (const tile of this._tiles || []) {
      tile.classList.remove("dragging", "drop");
      tile.style.transform = "";
    }
    const root = this.shadowRoot;
    root.querySelector(".arrbar").hidden = true;
    root.querySelector(".arr-btn")?.classList.remove("on");
    if (how === "save" || how === "reset") {
      const had = this._arr || {};
      const next = {};
      if (mode === "list") {
        if (had.grid) next.grid = had.grid;
        next.tiles = had.tiles || [];
        if (how === "save" && listEdit) next.list = listEdit;
      } else {
        if (how === "save" && edit) next.grid = edit.grid;
        next.tiles = how === "save" && edit ? edit.tiles : [];
        if (had.list) next.list = had.list;
      }
      // (what is off the wall and the tiles' own options aren't part of this)
      if (had.hidden) next.hidden = had.hidden;
      if (had.opts) next.opts = had.opts;
      // (nothing left of any of it: nothing to keep at all)
      this._arr = next.grid || next.tiles.length || next.list || next.hidden || next.opts ? next : null;
      this._arrStore(this._arr);
    }
    this._layout(); // (and now the feeds take their new shapes)
  }

  _arrItem(i) {
    const id = this._tileKeys()[i];
    return ((this._arrEdit && this._arrEdit.tiles) || []).find((t) => t.id === id);
  }

  // Why something wasn't done, in the bar ("" clears it).
  _arrWhy(text) {
    const why = this.shadowRoot && this.shadowRoot.querySelector(".arrbar .why");
    if (why) why.textContent = text || "";
  }

  // One column or row more or fewer. The last one goes only when it is empty:
  // nothing is moved behind the user's back.
  _arrGrid(key, d) {
    const e = this._arrEdit;
    if (!e) return;
    const grid = { ...e.grid, [key]: e.grid[key] + d };
    if (grid[key] < 1) return;
    if (grid[key] > GRID_MAX) return this._arrWhy(`No more than ${GRID_MAX} ${key === "cols" ? "columns" : "rows"}`);
    const inLast = e.tiles.some((t) => (key === "cols" ? t.c + t.w > grid.cols : t.r + t.h > grid.rows));
    if (d < 0 && inLast) return this._arrWhy(`The last ${key === "cols" ? "column" : "row"} still has a camera in it: move or shrink that first`);
    e.grid = grid;
    this._arrWhy("");
    this._layout();
  }

  // The grid's cells, drawn while arranging (the empty ones are where a
  // camera can go).
  _arrCells(cols, rows) {
    const n = cols * rows;
    const cells = (this._arrCellEls = this._arrCellEls || []);
    while (cells.length > n) cells.pop().remove();
    while (cells.length < n) {
      const cell = document.createElement("div");
      cell.className = "cell";
      this._grid.prepend(cell); // under the tiles
      cells.push(cell);
    }
    cells.forEach((cell, k) => {
      cell.style.gridColumn = `${(k % cols) + 1}`;
      cell.style.gridRow = `${Math.floor(k / cols) + 1}`;
    });
    this._arrCols = cols;
    const root = this.shadowRoot;
    const set = (cls, v) => {
      const el = root.querySelector(`.arrbar .${cls}`);
      if (el) el.textContent = String(v);
    };
    set("n-cols", cols);
    set("n-rows", rows);
  }

  // What putting tile t at (c, r) would take: [[tile, c, r], ...], or null
  // when there is no room. A free place: just that. A place taken by one
  // other tile: the two change places, if each fits where the other was.
  _arrTry(t, c, r) {
    const e = this._arrEdit;
    const g = { cols: e.grid.cols, rows: e.grid.rows, tiles: e.tiles };
    if (c < 0 || r < 0 || c + t.w > g.cols || r + t.h > g.rows) return null;
    const hits = CameraWallCard._arrHits(g, c, r, t.w, t.h, t);
    if (!hits.length) return [[t, c, r]];
    if (hits.length > 1) return null;
    const o = hits[0];
    if (t.c + o.w > g.cols || t.r + o.h > g.rows) return null;
    // the other one where this one was: clear of everything else, and of this one's new place
    const rest = { ...g, tiles: g.tiles.filter((x) => x !== t && x !== o) };
    if (CameraWallCard._arrHits(rest, t.c, t.r, o.w, o.h).length || CameraWallCard._arrHits(rest, c, r, t.w, t.h).length) return null;
    const apart = t.c + o.w <= c || c + t.w <= t.c || t.r + o.h <= r || r + t.h <= t.r;
    return apart ? [[t, c, r], [o, t.c, t.r]] : null;
  }

  // One tile's handles. A mouse moves the tile from anywhere on it; a finger
  // only by the grip, so that the page still scrolls under it.
  _arrWire(el, tile, i) {
    const fitsAt = (t, w, h) => {
      const e = this._arrEdit;
      const g = { cols: e.grid.cols, rows: e.grid.rows, tiles: e.tiles };
      return t.c + w <= g.cols && t.r + h <= g.rows && !CameraWallCard._arrHits(g, t.c, t.r, w, h, t).length;
    };
    const dim = el.querySelector(".dim");
    dim.onclick = () => {
      const t = this._arrItem(i);
      if (!t) return;
      // the next of the usual sizes there is room for (one cell always is)
      const sizes = [[1, 1], [2, 1], [2, 2], [3, 2], [3, 3]];
      const at = sizes.findIndex(([w, h]) => w === t.w && h === t.h);
      for (let k = 1; k <= sizes.length; k++) {
        const [w, h] = sizes[(at + k) % sizes.length];
        if (!fitsAt(t, w, h)) continue;
        t.w = w;
        t.h = h;
        break;
      }
      this._arrWhy("");
      this._layout();
    };
    let op = null;
    const mark = (to) => {
      for (const cell of this._arrCellEls || []) cell.classList.remove("on", "bad");
      if (!to) return;
      const t = this._arrItem(i);
      const cols = this._arrCols || 1;
      const ok = !!this._arrTry(t, to.c, to.r);
      for (let y = to.r; y < to.r + t.h; y++) {
        for (let x = to.c; x < to.c + t.w; x++) {
          const cell = (this._arrCellEls || [])[y * cols + x];
          if (cell) cell.classList.add(ok ? "on" : "bad");
        }
      }
    };
    el.addEventListener("pointerdown", (ev) => {
      if (op || (ev.button != null && ev.button > 0) || !ev.target) return;
      const on = (cls) => !!(ev.target.closest && ev.target.closest(cls));
      if (on(".dim")) return;
      const resize = on(".size");
      if (!resize && ev.pointerType !== "mouse" && !on(".grip")) return; // a finger elsewhere: scrolling
      const t = this._arrItem(i);
      const cell = this._cell;
      if (!t || !cell) return;
      const rect = tile.getBoundingClientRect();
      const grid = this._grid.getBoundingClientRect();
      op = {
        id: ev.pointerId, resize, x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top, gridLeft: grid.left, gridTop: grid.top,
        // which of the tile's own cells is held
        gx: Math.max(0, Math.min(t.w - 1, Math.floor((ev.clientX - rect.left) / (cell.w + GAP)))),
        gy: Math.max(0, Math.min(t.h - 1, Math.floor((ev.clientY - rect.top) / (cell.h + GAP)))),
        to: null,
      };
      try {
        el.setPointerCapture(ev.pointerId);
      } catch (e) {}
      if (!resize) tile.classList.add("dragging");
      this._arrWhy("");
      ev.preventDefault();
    });
    el.addEventListener("pointermove", (ev) => {
      if (!op || ev.pointerId !== op.id) return;
      const t = this._arrItem(i);
      const cell = this._cell;
      const e = this._arrEdit;
      if (!t || !cell || !e) return;
      if (op.resize) {
        // as far as the grid goes, and not into another camera
        const w = Math.max(1, Math.min(e.grid.cols - t.c, Math.round((ev.clientX - op.left + GAP) / (cell.w + GAP))));
        const h = Math.max(1, Math.min(e.grid.rows - t.r, Math.round((ev.clientY - op.top + GAP) / (cell.h + GAP))));
        if (w === t.w && h === t.h) return;
        if (!fitsAt(t, w, h)) return this._arrWhy("Another camera is in the way");
        t.w = w;
        t.h = h;
        this._arrWhy("");
        this._layout();
        return;
      }
      tile.style.transform = `translate(${ev.clientX - op.x}px, ${ev.clientY - op.y}px)`;
      // the cell under the pointer, kept on the grid whatever the pointer does
      const c = Math.max(0, Math.min(e.grid.cols - t.w, Math.floor((ev.clientX - op.gridLeft) / (cell.w + GAP)) - op.gx));
      const r = Math.max(0, Math.min(e.grid.rows - t.h, Math.floor((ev.clientY - op.gridTop) / (cell.h + GAP)) - op.gy));
      if (op.to && op.to.c === c && op.to.r === r) return;
      op.to = { c, r };
      mark(op.to);
    });
    const end = (ev, drop) => {
      if (!op || ev.pointerId !== op.id) return;
      const done = op;
      op = null;
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch (e) {}
      tile.classList.remove("dragging");
      tile.style.transform = "";
      mark(null);
      const t = this._arrItem(i);
      if (done.resize || !drop || !done.to || !t || (done.to.c === t.c && done.to.r === t.r)) return;
      const moves = this._arrTry(t, done.to.c, done.to.r);
      if (!moves) return this._arrWhy("No room there: make it smaller, or move the cameras in the way first");
      for (const [x, c, r] of moves) {
        x.c = c;
        x.r = r;
      }
      this._layout();
    };
    el.addEventListener("pointerup", (ev) => end(ev, true));
    el.addEventListener("pointercancel", (ev) => end(ev, false));
    // (a click on the tile under it would open the camera)
    el.addEventListener("click", (ev) => ev.stopPropagation());
  }
}

// (defined once, however the file got here)
// ---------------------------------------------------------------- editor
//
// The wall's editor: its options as a form. A field the config leaves out
// shows what the wall does by default, and stays left out until it is
// changed. The camera lists (`cameras`, a `history` list), `alarm_modes`,
// `breakpoints` and a tracking tile's options (`tracking: {...}`) are YAML.
const WALL_DEFAULTS = { history: true, tracking: true, arrange: true, aspect_ratio: 1.7778, live_tracks: true, source: "auto", live_delay: 700, live_offset: 0, live_debug: false, zone_overlay: true, phone_landscape: true };
const WALL_SWITCH_OR_MORE = ["history", "tracking"]; // false, or left out, or more said in YAML
const WALL_FORM = [
  { name: "exclude", selector: { text: { multiple: true } } },
  { name: "order", selector: { text: { multiple: true } } },
  { name: "alarm", selector: { entity: { domain: "alarm_control_panel" } } },
  { name: "history", selector: { boolean: {} } },
  { name: "tracking", selector: { boolean: {} } },
  { name: "arrange", selector: { boolean: {} } },
  { name: "layout", selector: { text: {} } },
  { name: "aspect_ratio", selector: { number: { min: 0.5, max: 3, step: 0.0001, mode: "box" } } },
  { name: "live_tracks", selector: { boolean: {} } },
  { name: "source", selector: { select: { options: [{ value: "auto", label: "Auto: the live view shows the best of both; the tracking tiles go by Protect Tracker's own sightings first" }, { value: "local", label: "Local: only Protect Tracker's own" }, { value: "protect", label: "UniFi: only UniFi Protect's own" }] } } },
  { name: "live_delay", selector: { number: { min: 0, max: 3000, step: 50, mode: "box", unit_of_measurement: "ms" } } },
  { name: "live_offset", selector: { number: { min: -3000, max: 3000, step: 10, mode: "box", unit_of_measurement: "ms" } } },
  { name: "live_debug", selector: { boolean: {} } },
  { name: "zone_overlay", selector: { boolean: {} } },
  { name: "phone_landscape", selector: { boolean: {} } },
  { name: "local_url", selector: { text: {} } },
  { name: "remote_url", selector: { text: {} } },
];
const WALL_LABELS = { exclude: "Cameras to leave out (names, entity ids or device ids)", order: "Cameras to put first, in this order", alarm: "Alarm panel (empty: the one that is found)",
  history: "History button", tracking: "Tracking tiles", arrange: "Arrange button", layout: "Name of this wall's saved arrangement (empty: default)", aspect_ratio: "Shape of each feed (width / height)",
  live_tracks: "Boxes button in the live view", source: "Whose boxes", live_delay: "Live picture held back for the boxes", live_offset: "Draw the boxes later (+) or earlier (−)",
  live_debug: "Write on the live picture how the boxes are timed", zone_overlay: "Zones in the live view", phone_landscape: "Turn the live view on a phone", local_url: "Local address (empty: Home Assistant's)", remote_url: "Remote address (empty: Home Assistant's)" };

class CameraWallCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...(config || {}) };
    this._show();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  connectedCallback() {
    this._show();
  }

  // What each field shows: the config's value, or what the wall does without one.
  _values() {
    const cfg = this._config || {};
    const out = {};
    for (const { name } of WALL_FORM) {
      if (WALL_SWITCH_OR_MORE.includes(name)) out[name] = cfg[name] !== false;
      else if (cfg[name] != null && cfg[name] !== "" && cfg[name] !== false) out[name] = cfg[name];
      else if (name in WALL_DEFAULTS) out[name] = cfg[name] === false ? false : WALL_DEFAULTS[name];
    }
    return out;
  }

  _show() {
    if (!this._config) return;
    if (!this._form) {
      const root = this.attachShadow({ mode: "open" });
      const form = (this._form = document.createElement("ha-form"));
      form.schema = WALL_FORM;
      form.computeLabel = (field) => WALL_LABELS[field.name] || field.name;
      form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._changed((ev.detail && ev.detail.value) || {});
      });
      const note = document.createElement("p");
      note.style.cssText = "margin:16px 0 0;font-size:13px;color:var(--secondary-text-color)";
      note.textContent = "The camera lists (cameras, a history list), alarm: false, alarm_modes, breakpoints and options for the tracking tiles are set in YAML (Show code editor). What each viewer arranges on the wall is kept for that viewer, not here.";
      root.append(form, note);
      // (Home Assistant loads its form element only where one is used: ask for it)
      if (!customElements.get("ha-form") && window.loadCardHelpers) {
        Promise.resolve(window.loadCardHelpers())
          .then((h) => h.createCardElement({ type: "entities", entities: [] }))
          .then(() => customElements.whenDefined("hui-entities-card"))
          .then(() => customElements.get("hui-entities-card").getConfigElement())
          .catch(() => {});
      }
    }
    this._form.hass = this._hass;
    this._form.data = this._values();
  }

  // One left out of the config stays out while it shows its default; an emptied one is taken out.
  _changed(data) {
    const config = { ...this._config };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const { name } of WALL_FORM) {
      const v = data[name];
      if (WALL_SWITCH_OR_MORE.includes(name)) {
        // off: false. On: as it was (a list or options said in YAML are kept), or left out
        if (v === false) config[name] = false;
        else if (this._config[name] === false) delete config[name];
        continue;
      }
      const empty = v == null || v === "" || (Array.isArray(v) && !v.length);
      if (empty) {
        // (a `false` said in YAML, such as alarm: false, has no field here and is left as it is)
        if (this._config[name] !== false) delete config[name];
      } else if (!(name in this._config) && name in WALL_DEFAULTS && same(v, WALL_DEFAULTS[name])) continue;
      else config[name] = v;
    }
    if (same(config, this._config)) return;
    this._config = config;
    this._show();
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}
if (!customElements.get("camera-wall-card-editor")) customElements.define("camera-wall-card-editor", CameraWallCardEditor);
CameraWallCard.getConfigElement = () => document.createElement("camera-wall-card-editor");
CameraWallCard.editDefaults = WALL_DEFAULTS;

if (!customElements.get("camera-wall-card")) customElements.define("camera-wall-card", CameraWallCard);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "camera-wall-card")) window.customCards.push({
  type: "camera-wall-card",
  name: "Camera Wall",
  description: "Centered, screen-fitting grid of live camera feeds with a compact alarm bar.",
});
