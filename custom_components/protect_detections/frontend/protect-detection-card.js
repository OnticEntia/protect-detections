/**
 * protect-detection-card — UniFi Protect detection history as a lightbox.
 *
 * Needs the protect_detections custom integration (custom_components/).
 * camera-wall-card creates one (config `history:`) and calls open() from its
 * History button; the element itself takes no space on the page.
 *
 * The lightbox opens as a centred dialog, about half the screen each way, over
 * a dimmed page (the expand button makes it nearly full screen): a grid of finished detections (Protect's best-shot crop of
 * each object), filtered by All / Person / Vehicle / Face / License plate /
 * Animal / Package, for the last 7 days or one picked day, with "Load more". Detections still happening
 * aren't listed; a small "N in progress" indicator shows them instead.
 * Tap a tile to play Protect's recording of it with Protect's per-frame boxes
 * drawn in step (Boxes / Labels / Paths toggles; Follow zooms in on what was
 * detected and stays on it while the clip plays); tap an object under the
 * video to jump to the moment of its best shot. When Protect saw a face, a
 * picture-in-picture shows it: a live zoom of the face from the recording
 * while Protect tracks it, its best-shot photo (or the last zoom) otherwise; ‹ › or the arrow keys step
 * through the list, Esc goes back.
 *
 *   type: custom:protect-detection-card
 *
 * is a whole config: the cameras are then the UniFi Protect ones found in
 * Home Assistant (one per camera device, by name), found again when its
 * entities or devices change. Optional:
 *
 *   exclude: ["Garage*"]                    # found cameras to leave out: names (* and ?
 *                                           # allowed), entity or device ids
 *   order: ["Front*"]                       # found cameras to put first, in this order
 *   cameras:                                # or: the cameras, spelled out
 *     - entity: camera.x_medium_resolution_channel
 *       tap_entity: camera.x_high_resolution_channel
 *       name: Front
 *   aspect_ratio: 1.7778
 * Replays play the full 4K recording at home and Protect's 360p recording when
 * the page is opened over the internet; the "4K" chip overrides that. The
 * face zoom and the boxes follow the video's real frames
 * (requestVideoFrameCallback), so they match the frame on screen.
 *
 * Fires "history-count" {hour, live, cameras} for the History button's badge
 * (cameras: the camera entities with a detection in progress), and
 * "history-open" {open} when the lightbox opens and closes.
 * Part of the Protect Detections integration, which serves it and loads it
 * into Home Assistant by itself (no dashboard resource to add).
 */

// Shared with the other cards here (served from the same folder).
import { findProtectCameras } from "./protect-cameras.js";

const FOLLOW_MAX = 4; // how far Follow zooms in, at most
const FOLLOW_EASE_MS = 350; // how quickly the view glides to where it should be
const FOLLOW_HOLD_MS = 1200; // how long it stays where the thing was last seen

const OPTS_KEY = "protect-detection-card:opts:v2";
// quality: null = auto (4K at home, 360p over the internet), or "high" / "low"
const DEFAULT_OPTS = { boxes: true, labels: true, paths: false, pip: true, others: true, follow: false, filter: "all", quality: null };
const FILTERS = [
  ["all", "All", "mdi:motion-sensor"],
  ["person", "Person", "mdi:walk"],
  ["vehicle", "Vehicle", "mdi:car"],
  ["face", "Face", "mdi:face-recognition"],
  ["licensePlate", "License plate", "mdi:card-text-outline"],
  ["animal", "Animal", "mdi:paw"],
  ["package", "Package", "mdi:package-variant-closed"],
  ["loiter", "Loiter", "mdi:timer-sand"],
];
const COLORS = {
  person: "#ff2d55",
  vehicle: "#4ea8ff",
  animal: "#34d399",
  package: "#fbbf24",
  licensePlate: "#c084fc",
  face: "#f472b6",
};
const ICONS = Object.fromEntries(FILTERS.slice(1).map(([k, , i]) => [k, i]));
// Recordings: how long after its frame a box is stamped. Measured on 6 clips
// (both recording channels) by where the boxes best cover the motion: 0-50 ms.
// It used to be ~250 ms; a Protect or camera update removed that delay.
const TRACK_LEAD_MS = 25;
const MAX_GAP_MS = 2000;
const FACE_HOLD_MS = 1500; // face tracks are sparse: hold a face box this long around each sample
const FACE_GAP_MS = 3000; // ...and glide between samples up to this far apart
const PIP_FPS = 12; // fallback only (no requestVideoFrameCallback): refresh the zoom at most 12×/s
const PIP_W = 240;
const PIP_H = 300;
const PAGE = 48;

const color = (t) => COLORS[t] || "#e5e7eb";
const titleCase = (s) =>
  (s === "licensePlate" ? "License plate" : (s || "object").replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()));
const anchor = (type, [x, y, w, h]) =>
  type === "person" || type === "animal" ? [x + w / 2, y + h] : [x + w / 2, y + h / 2];

// A finger moved (dx, dy) px in ms: +1 = next (swipe left), -1 = previous
// (swipe right), 0 = not a sideways swipe.
function swipeStep(dx, dy, ms) {
  if (ms > 800 || Math.abs(dx) < 50 || Math.abs(dx) < 1.5 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

function loadOpts() {
  try {
    return { ...DEFAULT_OPTS, ...JSON.parse(localStorage.getItem(OPTS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_OPTS };
  }
}
function saveOpts(o) {
  try {
    localStorage.setItem(OPTS_KEY, JSON.stringify(o));
  } catch {
    /* not remembered */
  }
}
function onHomeNetwork() {
  const h = location.hostname;
  return h === "localhost" || h.endsWith(".local") || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.startsWith("[");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Puts text on the clipboard; false if the browser won't. The clipboard API
// only exists on https (or localhost), so plain http falls back to the old way.
async function copyText(text, root) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;";
    (root || document.body).appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return !!ok;
  } catch (e) {
    return false;
  }
}

function when(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (s < 86400 && d.getDate() === new Date().getDate()) return time;
  return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

const STYLE = `
  :host { display: none; }
  .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
  .lb { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(max(50vw, 720px), calc(100vw - 24px)); height: min(max(50vh, 480px), calc(100vh - 24px));
    background: #0a0a0a; border: 1px solid #262626; border-radius: 18px; overflow: hidden;
    box-shadow: 0 24px 64px rgba(0,0,0,.7); color: #f3f4f6; display: flex; flex-direction: column;
    font-family: var(--ha-font-family-body, Roboto, sans-serif); }
  .head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 14px 18px; border-bottom: 1px solid #222; }
  .title { font-size: 18px; font-weight: 600; margin-right: 6px; }
  .live { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #fca5a5; }
  .live[hidden] { display: none; }
  .live .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary-color, #e0102a); animation: pulse 1.2s infinite; }
  @keyframes pulse { 50% { opacity: .25; } }
  .lb.full { width: calc(100vw - 24px); height: calc(100vh - 24px); }
  .day { display: inline-flex; align-items: center; gap: 4px; }
  .day input { font: inherit; font-size: 13px; color: #f3f4f6; background: #111; border: 1px solid #333; border-radius: 999px;
    padding: 5px 10px; color-scheme: dark; }
  .day input.on { border-color: var(--primary-color, #e0102a); }
  .day button { font: inherit; font-size: 12px; cursor: pointer; border: 0; background: none; color: #9ca3af; }
  .day button[hidden] { display: none; }
  .strip .obj { cursor: pointer; border: 1px solid transparent; }
  .strip .obj:hover { border-color: var(--primary-color, #e0102a); }
  .group { display: flex; flex-wrap: wrap; gap: 6px; }
  .group[hidden] { display: none; }
  .spacer { flex: 1; }
  button.chip { font: inherit; font-size: 13px; cursor: pointer; border-radius: 999px; padding: 6px 12px;
    border: 1px solid #333; background: #111; color: #9ca3af; display: inline-flex; gap: 6px; align-items: center; }
  button.chip.on { color: #fff; border-color: var(--primary-color, #e0102a); background: color-mix(in srgb, var(--primary-color, #e0102a) 30%, transparent); }
  button.chip ha-icon { --mdc-icon-size: 16px; }
  button.icon { font: inherit; cursor: pointer; border: 0; background: #1f1f1f; color: #fff; width: 40px; height: 40px;
    border-radius: 50%; display: grid; place-items: center; flex: none; }
  button.icon:hover { background: #2d2d2d; }
  button.icon[disabled] { opacity: .3; cursor: default; }
  button.icon[hidden] { display: none; }
  .gridwrap { flex: 1; overflow-y: auto; padding: 16px 18px 24px; }
  .gridwrap[hidden] { display: none; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, 180px); justify-content: center; gap: 12px; }
  .tile { position: relative; aspect-ratio: 1; border-radius: 14px; overflow: hidden; cursor: pointer; background: #1a1a1a;
    border: 2px solid transparent; }
  .tile:hover { border-color: var(--primary-color, #e0102a); }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tile .t { position: absolute; left: 8px; top: 8px; font-size: 11px; padding: 2px 6px; border-radius: 6px; background: rgba(0,0,0,.6); }
  .tile .n { position: absolute; right: 8px; top: 8px; font-size: 11px; padding: 2px 6px; border-radius: 6px; background: rgba(0,0,0,.6); }
  .tile .cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 22px 8px 8px;
    background: linear-gradient(transparent, rgba(0,0,0,.85)); font-size: 12px; }
  .tile .what { font-weight: 600; font-size: 13px; display: flex; gap: 5px; align-items: center; }
  .tile .what ha-icon { --mdc-icon-size: 16px; }
  .tile .desc { color: #d1d5db; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .tags { display: flex; gap: 4px; margin-top: 3px; }
  .tile .tag2 { font-size: 10px; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,.15); }
  .msg { color: #9ca3af; font-size: 14px; padding: 24px 0; text-align: center; }
  .msg[hidden] { display: none; }
  .more { display: flex; justify-content: center; padding-top: 16px; }
  .player { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .player[hidden] { display: none; }
  .pbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px 18px; }
  .ptitle { font-size: 15px; font-weight: 600; }
  .ptitle small { color: #9ca3af; font-weight: 400; margin-left: 6px; }
  .ptitle .eid { display: inline-block; margin-left: 6px; font-weight: 400; font-size: 11px; color: #6b7280; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    cursor: copy; user-select: all; -webkit-user-select: all; overflow-wrap: anywhere; padding: 4px 0; }
  .ptitle .eid:hover { color: #9ca3af; }
  .ptitle .eid.link { cursor: pointer; text-decoration: underline; text-underline-offset: 2px; user-select: text; -webkit-user-select: text; }
  .ptitle .eidcopy { background: none; border: 0; color: #6b7280; cursor: pointer; padding: 6px; margin-left: 2px; vertical-align: middle; --mdc-icon-size: 15px; }
  .ptitle .eidcopy:hover { color: #9ca3af; }
  .ptitle .eidcopy[hidden] { display: none; }
  .ptitle .eid.done { color: #4ade80; }
  .ptitle .eid[hidden] { display: none; }
  .stage { flex: 1; display: flex; align-items: center; justify-content: center; gap: 12px; min-height: 0; padding: 0 12px; }
  .frame { position: relative; border-radius: 14px; overflow: hidden; background: #000; flex: none; }
  .frame video { display: block; width: 100%; aspect-ratio: var(--ar); background: #000; }
  .overlay { position: absolute; left: 0; right: 0; top: 0; aspect-ratio: var(--ar); pointer-events: none; }
  .overlay svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .loading { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font-size: 14px; background: rgba(0,0,0,.4);
    aspect-ratio: var(--ar); }
  .pip { position: absolute; right: 12px; top: 12px; width: min(26%, 240px); aspect-ratio: ${PIP_W} / ${PIP_H};
    border-radius: 12px; overflow: hidden; background: #000; border: 2px solid ${COLORS.face};
    box-shadow: 0 8px 24px rgba(0,0,0,.6); pointer-events: none; }
  .pip[hidden] { display: none; }
  .pip canvas, .pip img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .pip canvas[hidden], .pip img[hidden] { display: none; }
  .pip .lbl { position: absolute; left: 6px; top: 6px; font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 5px;
    background: rgba(0,0,0,.65); color: #fff; display: flex; gap: 5px; align-items: center; }
  .pip .lbl .dot { width: 7px; height: 7px; border-radius: 50%; background: ${COLORS.face}; }
  .pip .lbl .dot.still { background: #9ca3af; }
  .strip { display: flex; gap: 8px; justify-content: center; padding: 10px 18px 16px; overflow-x: auto; }
  .strip .obj { display: flex; gap: 8px; align-items: center; background: #151515; border-radius: 12px; padding: 6px 10px 6px 6px; font-size: 12px; }
  .strip img { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; background: #222; }
  .box { position: absolute; --c: #4ea8ff; --l: 14px; --t: 2px;
    background:
      linear-gradient(var(--c), var(--c)) top left / var(--l) var(--t) no-repeat,
      linear-gradient(var(--c), var(--c)) top left / var(--t) var(--l) no-repeat,
      linear-gradient(var(--c), var(--c)) top right / var(--l) var(--t) no-repeat,
      linear-gradient(var(--c), var(--c)) top right / var(--t) var(--l) no-repeat,
      linear-gradient(var(--c), var(--c)) bottom left / var(--l) var(--t) no-repeat,
      linear-gradient(var(--c), var(--c)) bottom left / var(--t) var(--l) no-repeat,
      linear-gradient(var(--c), var(--c)) bottom right / var(--l) var(--t) no-repeat,
      linear-gradient(var(--c), var(--c)) bottom right / var(--t) var(--l) no-repeat; }
  .tag { position: absolute; left: -2px; bottom: 100%; margin-bottom: 3px; white-space: nowrap; font-size: 12px; font-weight: 600;
    color: #fff; padding: 2px 6px; border-radius: 4px; background: color-mix(in srgb, var(--c) 70%, #000 30%); }
  .tag.below { bottom: auto; top: 100%; margin: 3px 0 0; }
  /* following (the picture zoomed): lines and labels keep their size */
  .frame video, .overlay { transform-origin: 0 0; will-change: transform; }
  .boxes .box { --l: calc(14px * var(--fk, 1)); }
  .boxes .tag { transform: scale(var(--fk, 1)); transform-origin: 0 100%; }
  .boxes .tag.below { transform-origin: 0 0; }
  /* something from another detection that ran at the same time: plainly secondary */
  .box.other { background: none; outline: var(--t) dashed color-mix(in srgb, var(--c) 75%, transparent); outline-offset: -1px; opacity: .8; }
  .box.other .tag { font-size: 10px; font-weight: 500; padding: 1px 5px; background: color-mix(in srgb, var(--c) 35%, #000 65%); color: #e5e7eb; }
  .stage { position: relative; touch-action: pan-y; }
  /* phones: no room beside the video, so the arrows sit on its edges (and a swipe steps too) */
  @media (max-width: 700px) {
    .stage button.icon { position: absolute; top: 50%; transform: translateY(-50%); z-index: 2; width: 36px; height: 36px;
      background: rgba(0,0,0,.5); }
    .stage button.prev { left: 16px; }
    .stage button.next { right: 16px; }
    .grid { grid-template-columns: repeat(auto-fit, 130px); }
  }
`;

class ProtectDetectionCard extends HTMLElement {
  setConfig(config) {
    config = config || {};
    if (config.cameras != null && config.cameras !== "auto" && !Array.isArray(config.cameras)) {
      throw new Error("protect-detection-card: 'cameras' must be a list, or left out to find them");
    }
    const again = !!this._host; // a new config for a card that is already built
    if (again) this.close();
    // no cameras named: the UniFi Protect ones in Home Assistant (_findCameras)
    this._auto = !config.player_only && !(Array.isArray(config.cameras) && config.cameras.length);
    this._seen = null;
    this._config = { aspect_ratio: 16 / 9, ...config, cameras: this._auto ? [] : config.cameras || [] };
    if (this._auto) this._findCameras();
    this._opts = loadOpts();
    this._recent = new Map(); // live subscription: recent detections (incl. in progress)
    this._going = new Map(); // ...and those in progress on any camera
    this._items = []; // what the grid shows (finished only)
    this._more = false;
    this._loaded = false;
    this._thumbs = this._thumbs || new Map();
    this._boxEls = new Map();
    if (again) {
      this._root.querySelector(".frame").style.setProperty("--ar", this._config.aspect_ratio);
      // the cameras may have changed: start the live list afresh
      this._stopFeed();
      if (this.isConnected) this._startFeed();
      this._emitCount();
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._auto && this._findCameras() && !first) {
      // a camera added, removed or renamed: the lists start afresh
      this._recent = new Map();
      this._loaded = false;
      this._stopFeed();
      if (this.isConnected) this._startFeed();
      this._emitCount();
      if (this._host && this._isOpen() && this._index == null) this._load(true);
    }
    if (first) this._init();
  }

  // The cameras, when the config names none: looked up in Home Assistant, and
  // again when its lists of entities or devices change. True if they changed.
  _findCameras() {
    const hass = this._hass;
    if (!hass || !this._config) return false;
    if (this._seen && this._seen.entities === hass.entities && this._seen.devices === hass.devices) return false;
    this._seen = { entities: hass.entities, devices: hass.devices };
    const cameras = findProtectCameras(hass, this._config).map(({ entity, tap_entity, name }) => ({ entity, tap_entity, name }));
    if (JSON.stringify(cameras) === JSON.stringify(this._config.cameras)) return false;
    this._config = { ...this._config, cameras };
    return true;
  }

  getCardSize() {
    return 0;
  }

  // ------------------------------------------------------------ lifecycle

  _init() {
    this.attachShadow({ mode: "open" }); // nothing visible in the page itself
    this._buildLightbox();
    if (this.isConnected) this._startFeed();
  }

  connectedCallback() {
    if (this._host && !this._host.isConnected) document.body.appendChild(this._host);
    if (this._host) this._startFeed();
  }

  // Leaves nothing behind: HA detaches cards when the view changes and may
  // never attach this one again. connectedCallback restores all of it.
  disconnectedCallback() {
    this.close(); // also takes the window listeners off
    this._host?.remove();
    this._stopFeed();
    for (const src of this._thumbs?.values() || []) src.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    this._thumbs?.clear();
  }

  // The live list and the History button's badge; not for another card's
  // player (player_only), and only while the card is on the page.
  _startFeed() {
    if (!this._hass || this._config.player_only) return;
    if (!this._unsub) this._subscribe();
    if (!this._ticker) this._ticker = setInterval(() => this._emitCount(), 30000);
  }

  _stopFeed() {
    clearInterval(this._ticker);
    this._ticker = null;
    const unsub = this._unsub;
    this._unsub = null;
    unsub?.then((u) => u && u()).catch(() => {});
  }

  _subscribe() {
    const sub = (this._unsub = this._hass.connection
      .subscribeMessage((m) => this._onEvents(m), { type: "protect_detections/subscribe" })
      .catch(() => {
        if (this._unsub === sub) this._unsub = null; // tried again when the card is next attached
      }));
  }

  // Tells the card that owns this one when the lightbox opens and closes (the
  // camera wall rests its feeds meanwhile): "history-open" {open}, once per change.
  _announce(open) {
    if (open === !!this._announced) return;
    this._announced = open;
    this.dispatchEvent(new CustomEvent("history-open", { detail: { open } }));
  }

  // Window listeners are only needed while the lightbox is open.
  _listen(on) {
    if (on === !!this._listening) return;
    this._listening = on;
    const f = on ? "addEventListener" : "removeEventListener";
    window[f]("keydown", this._onKey);
    window[f]("resize", this._onPlace);
  }

  _inScope(e) {
    return this._config.cameras.some((c) => c.entity === e.entity || c.tap_entity === e.tap_entity);
  }

  _matches(e, kind = this._opts.filter) {
    return kind === "all" || (e.types || []).includes(kind) || (e.objects || []).some((o) => o.type === kind);
  }

  _onEvents(msg) {
    // every camera's detections in progress, not only this card's cameras:
    // the wall outlines any of its feeds (see _emitCount)
    if (msg.snapshot) this._going = new Map(msg.snapshot.filter((e) => !e.end).map((e) => [e.id, e]));
    else if (msg.event) msg.event.end ? this._going?.delete(msg.event.id) : (this._going = this._going || new Map()).set(msg.event.id, msg.event);
    if (msg.snapshot) {
      this._recent = new Map(msg.snapshot.filter((e) => this._inScope(e)).map((e) => [e.id, e]));
    } else if (msg.event && this._inScope(msg.event)) {
      const e = msg.event;
      const prev = this._recent.get(e.id);
      this._recent.delete(e.id);
      this._recent.set(e.id, e);
      while (this._recent.size > 100) this._recent.delete(this._recent.keys().next().value);
      // a detection just finished: add it to the grid if it fits the filter
      if (e.end && (!prev || !prev.end) && this._loaded && (!this._day || this._day === todayStr()) && this._matches(e) && !this._items.some((x) => x.id === e.id)) {
        this._items.unshift(e);
        if (this._index != null) this._index += 1; // keep the same item playing
        else if (this._isOpen()) this._renderGrid();
      }
      const i = this._items.findIndex((x) => x.id === e.id);
      if (i >= 0 && e.end) this._items[i] = e;
    }
    this._emitCount();
    this._renderLive();
  }

  _emitCount() {
    // every 30 s: past midnight with History open on the grid, move on to the new day
    if (this.isOpen() && !this._single && this._index == null && this._syncDay()) this._load(true);
    const now = Date.now();
    const list = [...this._recent.values()];
    const hour = list.filter((e) => e.end && now - e.start < 3600000).length;
    const going = list.filter((e) => !e.end && now - e.start < 15 * 60000);
    // cameras: the camera entities with a detection in progress, on any camera (the wall outlines them)
    const anywhere = [...(this._going?.values() || [])].filter((e) => now - e.start < 15 * 60000);
    const cameras = [...new Set(anywhere.flatMap((e) => [e.entity, e.tap_entity]).filter(Boolean))];
    this.dispatchEvent(new CustomEvent("history-count", { detail: { hour, live: going.length, cameras } }));
  }

  // ------------------------------------------------------------- lightbox

  _buildLightbox() {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:9999;display:none";
    this._host = host;
    const root = (this._root = host.attachShadow({ mode: "open" }));
    root.innerHTML = `<style>${STYLE}</style>
      <div class="backdrop"></div>
      <div class="lb">
        <div class="head">
          <span class="title">History</span>
          <span class="live" hidden><span class="dot"></span><span class="livetext"></span></span>
          <div class="group filters"></div>
          <span class="day" title="Show one day"><input type="date"><button class="clear" hidden>Last 7 days</button></span>
          <span class="spacer"></span>
          <button class="icon expand" title="Bigger"><ha-icon icon="mdi:arrow-expand"></ha-icon></button>
          <button class="icon close" title="Close (Esc)"><ha-icon icon="mdi:close"></ha-icon></button>
        </div>
        <div class="gridwrap"><div class="grid"></div><div class="msg"></div><div class="more"></div></div>
        <div class="player" hidden>
          <div class="pbar">
            <button class="chip back"><ha-icon icon="mdi:view-grid-outline"></ha-icon>All detections</button>
            <span class="ptitle"></span>
            <span class="spacer"></span>
            <div class="group toggles"></div>
          </div>
          <div class="stage">
            <button class="icon prev" title="Newer (←)"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
            <div class="frame" style="--ar:${this._config.aspect_ratio}">
              <div class="overlay"><svg viewBox="0 0 1000 1000" preserveAspectRatio="none"></svg><div class="boxes"></div></div>
              <div class="pip" hidden><canvas width="${PIP_W}" height="${PIP_H}"></canvas><img alt="" hidden>
                <span class="lbl"><span class="dot"></span><span class="txt">Face</span></span></div>
            </div>
            <button class="icon next" title="Older (→)"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
          </div>
          <div class="strip"></div>
        </div>
      </div>`;
    root.querySelector(".close").onclick = () => this.close();
    root.querySelector(".backdrop").onclick = () => this.close();
    root.querySelector(".expand").onclick = () => {
      this._full = !this._full;
      this._place();
    };
    const day = root.querySelector(".day input");
    const clear = root.querySelector(".day .clear");
    // opens on today, with the date shown; "Last 7 days" widens it
    day.max = todayStr();
    day.value = this._day = todayStr();
    this._dayAuto = true; // showing "today": follows the date (see _syncDay)
    day.classList.add("on");
    clear.hidden = false;
    day.onchange = () => {
      this._day = day.value || null;
      this._dayAuto = this._day === todayStr();
      day.classList.toggle("on", !!this._day);
      clear.hidden = !this._day;
      this._showGrid();
      this._load(true);
    };
    clear.onclick = () => {
      day.value = "";
      day.onchange();
    };
    this._onPlace = () => this.isOpen() && this._place();
    root.querySelector(".back").onclick = () => this._showGrid();
    root.querySelector(".prev").onclick = () => this._step(-1);
    root.querySelector(".next").onclick = () => this._step(1);
    root.querySelector(".gridwrap").addEventListener("scroll", () => this._maybeMore());
    this._onKey = (ev) => {
      if (!this.isOpen()) return;
      if (ev.key === "Escape") this._index != null ? this._showGrid() : this.close();
      else if (this._index != null && ev.key === "ArrowLeft") this._step(-1);
      else if (this._index != null && ev.key === "ArrowRight") this._step(1);
      else return;
      ev.preventDefault();
    };
    // phones: swipe left for the next (older) detection, right for the previous
    const stage = root.querySelector(".stage");
    let swipe = null;
    stage.addEventListener("touchstart", (ev) => {
      swipe = null;
      if (ev.touches.length !== 1) return;
      const t = ev.touches[0];
      // not from the video's own controls (its seek bar is dragged sideways too)
      const box = root.querySelector(".frame").getBoundingClientRect();
      if (this._video && t.clientY > box.bottom - 64 && t.clientY <= box.bottom) return;
      swipe = { x: t.clientX, y: t.clientY, at: Date.now() };
    }, { passive: true });
    stage.addEventListener("touchend", (ev) => {
      const s = swipe;
      swipe = null;
      const t = ev.changedTouches[0];
      if (!s || !t || ev.touches.length) return;
      const d = swipeStep(t.clientX - s.x, t.clientY - s.y, Date.now() - s.at);
      if (d) this._step(d);
    }, { passive: true });
    stage.addEventListener("touchcancel", () => (swipe = null), { passive: true });
    document.body.appendChild(host);
    this._renderFilters();
    this._renderToggles();
  }

  /** Is the lightbox showing? Public: other cards (protect-rules) ask this. */
  isOpen() {
    return this._host?.style.display === "block";
  }

  _isOpen() {
    return this.isOpen(); // the old name, still used by cards written against it
  }

  // "Today" is a moving target on a dashboard that stays open for days: while
  // the picker shows today (not a day that was picked), keep it on today.
  _syncDay() {
    const today = todayStr();
    const day = this._root.querySelector(".day input");
    day.max = today;
    if (!this._dayAuto || this._day === today) return false;
    this._day = day.value = today;
    this._loaded = false;
    return true;
  }

  // anchor: the element whose area the lightbox covers (the camera grid);
  // without one, or when expanded, it nearly fills the window.
  // Play a given list of detections (Protect event ids) instead of the
  // history grid, e.g. the events that fired a rule. Used by other cards.
  playEvents(ids, index = 0, title = "Detection") {
    if (!this._host || !ids.length) return;
    this._single = true;
    this._items = ids.map((id) => ({ id, stub: true }));
    this._more = false;
    this._anchor = null;
    this._full = false;
    this._host.style.display = "block";
    const r = this._root;
    r.querySelector(".title").textContent = title;
    for (const sel of [".filters", ".day", ".live", ".back"]) r.querySelector(sel).hidden = true;
    r.querySelector(".day").style.display = "none";
    this._listen(true);
    this._announce(true);
    this._place();
    this._play(index);
    this._loop();
  }

  open(anchor) {
    if (!this._host) return;
    if (this._single) {
      this._single = false;
      this._items = [];
      this._loaded = false;
      this._root.querySelector(".title").textContent = "History";
      this._root.querySelector(".back").hidden = false;
      this._root.querySelector(".day").style.display = "";
    }
    this._anchor = anchor || null;
    this._full = false;
    this._host.style.display = "block";
    this._listen(true);
    this._announce(true);
    this._syncDay();
    this._place();
    this._renderLive();
    this._showGrid();
    if (!this._loaded || Date.now() - this._loadedAt > 60000) this._load(true);
    else this._renderGrid();
    this._loop();
  }

  close() {
    if (!this._host) return;
    this._stopVideo();
    this._index = null;
    this._host.style.display = "none";
    this._listen(false);
    this._announce(false);
    cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _place() {
    this._host.style.cssText = "position:fixed;inset:0;z-index:9999;display:block";
    this._root.querySelector(".lb").classList.toggle("full", !!this._full);
    const ex = this._root.querySelector(".expand");
    ex.title = this._full ? "Smaller" : "Bigger";
    ex.firstElementChild.setAttribute("icon", this._full ? "mdi:arrow-collapse" : "mdi:arrow-expand");
    requestAnimationFrame(() => this._layout());
  }

  _renderLive() {
    const el = this._root?.querySelector(".live");
    if (!el) return;
    const n = [...this._recent.values()].filter((e) => !e.end && Date.now() - e.start < 15 * 60000).length;
    el.hidden = !n;
    el.querySelector(".livetext").textContent = `${n} detection${n === 1 ? "" : "s"} in progress`;
  }

  _renderFilters() {
    const box = this._root.querySelector(".filters");
    box.innerHTML = "";
    for (const [key, name, icon] of FILTERS) {
      const b = document.createElement("button");
      b.className = `chip${this._opts.filter === key ? " on" : ""}`;
      b.innerHTML = `<ha-icon icon="${icon}"></ha-icon>${name}`;
      b.onclick = () => {
        if (this._opts.filter === key) return;
        this._setOpt("filter", key);
        this._renderFilters();
        this._showGrid();
        this._load(true);
      };
      box.appendChild(b);
    }
  }

  _renderToggles() {
    const box = this._root.querySelector(".toggles");
    box.innerHTML = "";
    for (const [key, name, icon] of [["boxes", "Boxes", "mdi:vector-square"], ["labels", "Labels", "mdi:label-outline"], ["paths", "Paths", "mdi:vector-polyline"], ["pip", "Face zoom", "mdi:face-recognition"], ["others", "Others", "mdi:layers-outline"], ["follow", "Follow", "mdi:target-account"]]) {
      const b = document.createElement("button");
      b.className = `chip${this._opts[key] ? " on" : ""}`;
      b.innerHTML = `<ha-icon icon="${icon}"></ha-icon>${name}`;
      if (key === "others") b.title = "Also box what other detections saw at the same time (dashed)";
      if (key === "follow") b.title = "Zoom in on what was detected and stay on it (the whole picture again while paused)";
      b.onclick = () => {
        this._setOpt(key, !this._opts[key]);
        this._renderToggles();
        if (key === "others") this._loadOthers(); // (switched on mid-clip)
      };
      box.appendChild(b);
    }
    const q = document.createElement("button");
    const hi = this._quality() === "high";
    q.className = `chip${hi ? " on" : ""}`;
    q.title = `${hi ? "Full 4K recording" : "360p recording (less data)"}${this._opts.quality ? "" : " · chosen automatically"}`;
    q.innerHTML = `<ha-icon icon="mdi:high-definition"></ha-icon>4K${this._opts.quality ? "" : " · auto"}`;
    q.onclick = () => {
      this._setOpt("quality", hi ? "low" : "high");
      this._renderToggles();
      if (this._index != null) this._play(this._index, this._video?.currentTime); // same moment, new quality
    };
    box.appendChild(q);
  }

  _quality() {
    return this._opts.quality || (onHomeNetwork() ? "high" : "low");
  }

  _setOpt(key, val) {
    this._opts = { ...this._opts, [key]: val };
    saveOpts(this._opts);
  }

  // --------------------------------------------------------------- grid

  async _load(reset) {
    if (this._loading && !reset) return;
    const kind = this._opts.filter;
    const token = (this._loadToken = {});
    let start = null;
    let dayEnd = null;
    if (this._day) {
      const [y, m, d] = this._day.split("-").map(Number);
      start = new Date(y, m - 1, d).getTime();
      dayEnd = new Date(y, m - 1, d + 1).getTime() - 1;
    }
    const before = reset || !this._items.length ? dayEnd : Math.min(...this._items.map((e) => e.start)) - 1;
    this._loading = true;
    if (reset) {
      this._items = [];
      this._more = false;
      this._renderGrid();
    }
    try {
      const res = await this._hass.callWS({
        type: "protect_detections/history",
        kind: kind === "all" ? null : kind,
        before,
        start,
        limit: PAGE,
      });
      if (token !== this._loadToken) return; // filter changed meanwhile
      const seen = new Set(this._items.map((e) => e.id));
      this._items.push(...res.events.filter((e) => this._inScope(e) && !seen.has(e.id)));
      this._more = res.more;
      this._loaded = true;
      this._loadedAt = Date.now();
    } catch (err) {
      if (token === this._loadToken) this._msg(`Couldn't load the history: ${err.message || err.code || err}`);
      return;
    } finally {
      if (token === this._loadToken) this._loading = false;
    }
    if (this._index == null) this._renderGrid();
  }

  // Where Protect's own web app shows this detection, or "" when the
  // console's address isn't known. The address comes from the camera's device
  // in Home Assistant (its "Visit" link), or `protect_url` in the config;
  // `protect_event_url` is the pattern ({base}, {id}, {camera}), false for no link.
  _protectUrl(e) {
    const cfg = this._config || {};
    const pattern = cfg.protect_event_url === undefined ? "{base}/protect/events/event/{id}" : cfg.protect_event_url;
    if (!pattern || typeof pattern !== "string") return "";
    let base = typeof cfg.protect_url === "string" ? cfg.protect_url : "";
    if (!base) {
      const hass = this._hass || {};
      for (const ent of [e.entity, e.tap_entity]) {
        const dev = ent && hass.entities && hass.entities[ent] && hass.devices && hass.devices[hass.entities[ent].device_id];
        const link = dev && typeof dev.configuration_url === "string" ? dev.configuration_url : "";
        const at = link.indexOf("/protect/");
        if (at > 0) {
          base = link.slice(0, at);
          break;
        }
      }
    }
    base = base.replace(/\/+$/, "");
    if (!base && pattern.includes("{base}")) return "";
    const url = pattern
      .replace(/\{base\}/g, base)
      .replace(/\{id\}/g, encodeURIComponent(e.id))
      .replace(/\{camera\}/g, encodeURIComponent(e.camera_id || ""));
    return /^https?:\/\/[^/]+\//i.test(url) ? url : "";
  }

  _msg(text) {
    const el = this._root.querySelector(".msg");
    el.textContent = text || "";
    el.hidden = !text;
  }

  _maybeMore() {
    const w = this._root.querySelector(".gridwrap");
    if (this._more && !this._loading && w.scrollTop + w.clientHeight > w.scrollHeight - 400) this._load(false);
  }

  _renderGrid() {
    const grid = this._root.querySelector(".grid");
    grid.innerHTML = "";
    const kind = this._opts.filter;
    for (const [i, e] of this._items.entries()) {
      const objs = e.objects || [];
      const pick = (kind === "licensePlate" && objs.find((o) => o.plate && o.thumb)) ||
        objs.find((o) => o.type === kind && o.thumb) || objs.find((o) => o.thumb);
      const main = kind !== "all" ? kind : pick?.type || e.types?.[0] || "object";
      const shown = kind === "licensePlate" ? objs.filter((o) => o.plate) : objs.filter((o) => kind === "all" || o.type === kind);
      const descs = [...new Set(shown.map((o) => o.desc).filter(Boolean))];
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.innerHTML = `
        <img alt="">
        <span class="t">${when(e.start)}</span>
        ${objs.length > 1 ? `<span class="n">×${objs.length}</span>` : ""}
        <div class="cap">
          <div class="what"><ha-icon icon="${ICONS[main] || "mdi:motion-sensor"}" style="color:${color(main)}"></ha-icon>${titleCase(main)}</div>
          <div class="desc"></div>
          <div class="tags"></div>
        </div>`;
      tile.querySelector(".desc").textContent = descs.join(", ") || e.camera;
      const tags = tile.querySelector(".tags");
      if (e.type === "smartDetectLoiterZone") {
        const secs = Math.round(((e.end || e.start) - e.start) / 1000);
        tags.insertAdjacentHTML("beforeend", `<span class="tag2">Loitering${secs ? ` ${secs}s` : ""}</span>`);
      }
      for (const t of ["person", "vehicle", "face", "licensePlate", "animal"]) {
        if (t !== main && (e.types || []).includes(t)) tags.insertAdjacentHTML("beforeend", `<span class="tag2">${t === "licensePlate" ? "Plate" : titleCase(t)}</span>`);
      }
      this._thumb(tile.querySelector("img"), pick ? `/api/protect_detections/thumb/object/${pick.thumb}` : `/api/protect_detections/thumb/event/${e.id}`);
      tile.onclick = () => this._play(i);
      grid.appendChild(tile);
    }
    const range = this._day === todayStr()
      ? "today"
      : this._day
      ? `on ${new Date(`${this._day}T12:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}`
      : "in the last 7 days";
    if (this._auto && !this._config.cameras.length) {
      this._msg("No UniFi Protect cameras were found in Home Assistant. They are picked up by themselves once the UniFi Protect integration has cameras, or list them under cameras: in this card's config.");
    } else this._msg(this._items.length ? "" : this._loading ? "Loading…" : `No ${kind === "all" ? "" : kind === "loiter" ? "loitering " : `${titleCase(kind).toLowerCase()} `}detections ${range}.`);
    const more = this._root.querySelector(".more");
    more.innerHTML = "";
    if (this._more && this._items.length) {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = this._loading ? "Loading…" : "Load more";
      b.onclick = () => this._load(false);
      more.appendChild(b);
    }
  }

  async _thumb(img, url) {
    let src = this._thumbs.get(url);
    if (!src) {
      src = this._hass
        .fetchWithAuth(url)
        .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
        .then((b) => URL.createObjectURL(b));
      this._thumbs.set(url, src);
      if (this._thumbs.size > 600) {
        const [k, v] = this._thumbs.entries().next().value;
        this._thumbs.delete(k);
        v.then((u) => URL.revokeObjectURL(u)).catch(() => {});
      }
    }
    try {
      img.src = await src;
    } catch {
      this._thumbs.delete(url);
    }
  }

  // ------------------------------------------------------------- player

  _showGrid() {
    if (this._single) return this.close(); // no grid behind a given list
    this._stopVideo();
    this._index = null;
    this._root.querySelector(".player").hidden = true;
    this._root.querySelector(".gridwrap").hidden = false;
    this._root.querySelector(".filters").hidden = false;
    if (this._loaded) this._renderGrid();
  }

  _stopVideo() {
    this._playToken = null;
    if (this._video) {
      this._video.pause();
      this._video.removeAttribute("src");
      this._video.load();
      this._video.remove();
      this._video = null;
    }
    this._clip = null;
    this._others = null;
    this._fol = null;
    this._followApply(1, 0, 0);
    this._frameTime = null;
    if (this._root) {
      this._root.querySelector(".frame .loading")?.remove();
      this._root.querySelector(".boxes").innerHTML = "";
      this._root.querySelector(".overlay svg").innerHTML = "";
    }
    this._boxEls = new Map();
    this._lastSvg = "";
    this._pip = null;
    const pip = this._root?.querySelector(".pip");
    if (pip) {
      pip.hidden = true;
      pip.querySelector("img").removeAttribute("src");
      pip.querySelector("canvas").getContext("2d").clearRect(0, 0, PIP_W, PIP_H);
    }
  }

  _step(d) {
    if (this._index == null) return;
    const i = this._index + d;
    if (i < 0 || i >= this._items.length) return;
    this._play(i);
    if (i >= this._items.length - 3 && this._more) this._load(false);
  }

  // h264: ask for the H.264 version even if the browser says it plays HEVC
  // (some say so and then can't) — see the video's error handler below.
  async _play(i, resumeAt = null, h264 = false) {
    let e = this._items[i];
    if (!e) return;
    this._stopVideo();
    this._index = i;
    const token = (this._playToken = {});
    const r = this._root;
    r.querySelector(".gridwrap").hidden = true;
    r.querySelector(".filters").hidden = true;
    r.querySelector(".player").hidden = false;
    r.querySelector(".prev").disabled = i === 0;
    r.querySelector(".next").disabled = i === this._items.length - 1 && !this._more;
    if (e.stub) {
      // only the id is known yet: get the detection itself
      r.querySelector(".ptitle").textContent = "";
      r.querySelector(".strip").innerHTML = "";
      try {
        e = (await this._hass.callWS({ type: "protect_detections/event", event_id: e.id })).event;
      } catch (err) {
        if (this._playToken === token) r.querySelector(".ptitle").textContent = `Couldn't open this one: ${err.message || err.code || err}`;
        return;
      }
      if (this._playToken !== token) return;
      this._items[i] = e;
    }
    const main = !this._single && this._opts.filter !== "all" ? this._opts.filter : (e.objects?.[0]?.type || e.types?.[0] || "object").replace(/^alrm(?=[A-Z])/, ""); // sounds come as "alrmBark"
    r.querySelector(".ptitle").innerHTML =
      `${titleCase(main)}<small></small><a class="eid" target="_blank" rel="noopener noreferrer" hidden></a>` +
      `<button class="eidcopy" type="button" title="Copy the id" hidden><ha-icon icon="mdi:content-copy"></ha-icon></button>`;
    // Protect's own id of the detection, whole, to quote or look up later:
    // a link to it in Protect when the console's address is known (then the
    // button copies), else a tap on the id itself copies.
    const eid = r.querySelector(".ptitle .eid");
    const copyBtn = r.querySelector(".ptitle .eidcopy");
    const id = typeof e.id === "string" ? e.id : "";
    const url = id ? this._protectUrl(e) : "";
    eid.textContent = id;
    eid.hidden = !id;
    if (url) eid.setAttribute("href", url);
    eid.classList.toggle("link", !!url);
    eid.title = url ? "Open this detection in Protect" : "Protect's id of this detection: click to copy";
    copyBtn.hidden = !url;
    const copy = async () => {
      if (!id || eid.classList.contains("done")) return;
      const ok = await copyText(id, r);
      eid.textContent = ok ? "Copied" : "Couldn't copy: select it instead";
      eid.classList.toggle("done", ok);
      setTimeout(() => {
        eid.textContent = id;
        eid.classList.remove("done");
      }, 1500);
    };
    eid.onclick = url ? null : copy;
    copyBtn.onclick = copy;
    r.querySelector(".ptitle small").textContent =
      `${e.camera} · ${new Date(e.start).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
    const strip = r.querySelector(".strip");
    strip.innerHTML = "";
    for (const o of (e.objects || []).slice(0, 8)) {
      const el = document.createElement("div");
      el.className = "obj";
      el.innerHTML = `<img alt=""><div><b style="color:${color(o.type)}">${titleCase(o.type)}</b>${o.confidence ? ` ${o.confidence}%` : ""}<div class="d"></div></div>`;
      el.querySelector(".d").textContent = o.desc || "";
      el.title = "Go to this object in the video";
      el.onclick = () => this._seekTo(o);
      if (o.thumb) this._thumb(el.querySelector("img"), `/api/protect_detections/thumb/object/${o.thumb}`);
      strip.appendChild(el);
    }
    // face picture-in-picture: Protect's best face shot as the still
    const face = (e.objects || []).filter((o) => o.type === "face" && o.thumb).sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
    this._pip = { still: !!face, drew: false, rect: null };
    if (face) this._thumb(r.querySelector(".pip img"), `/api/protect_detections/thumb/object/${face.thumb}`);
    this._layout();
    const frame = r.querySelector(".frame");
    h264 = h264 || !!this._noHevc;
    const loading = Object.assign(document.createElement("div"), { className: "loading",
      textContent: h264 && this._noHevc ? "Converting the recording for this browser…" : "Fetching the recording from Protect…" });
    frame.appendChild(loading);
    const probe = document.createElement("video");
    const hevc = !h264 && !!(window.MediaSource?.isTypeSupported?.('video/mp4; codecs="hvc1.1.6.L153.B0"') ||
      probe.canPlayType('video/mp4; codecs="hvc1.1.6.L153.B0"'));
    try {
      const clip = await this._hass.callWS({ type: "protect_detections/clip", event_id: e.id, hevc, quality: this._quality() });
      if (this._playToken !== token) return;
      const signed = await this._hass.callWS({ type: "auth/sign_path", path: clip.url, expires: 3600 });
      if (this._playToken !== token) return;
      this._clip = clip;
      this._loadOthers(); // not waited for: the clip plays meanwhile
      const video = document.createElement("video");
      Object.assign(video, { src: signed.path, muted: true, autoplay: true, loop: true, controls: true, playsInline: true });
      const first = Math.min(...(clip.track || []).map((t) => t.points[0]?.[0] ?? Infinity));
      video.addEventListener("loadedmetadata", () => {
        if (resumeAt != null) video.currentTime = Math.min(resumeAt, Math.max(0, video.duration - 0.1));
        else if (Number.isFinite(first)) video.currentTime = Math.max(0, (first - clip.start_ms) / 1000 - 1);
        video.play().catch(() => {});
      }, { once: true });
      // The recording can't be loaded or decoded. If it was the HEVC one, try
      // the H.264 version once (and stop asking for HEVC); else say so.
      video.addEventListener("error", () => {
        if (this._video !== video) return; // already replaced or closed
        const code = video.error?.code;
        // 3 = can't decode, 4 = not supported / not loadable; a dropped connection (2) is no reason to give up on HEVC
        if (hevc && (code === 3 || code === 4) && /hevc|h265/i.test(clip.codec || "")) {
          this._noHevc = true;
          console.warn("protect-detection-card: HEVC playback failed (media error", code, "), using H.264");
          this._play(this._index, video.currentTime || resumeAt, true);
          return;
        }
        const why = { 1: "it was stopped", 2: "the connection dropped", 3: "this browser can't decode it", 4: "it couldn't be loaded" }[code];
        frame.querySelector(".loading")?.remove();
        frame.appendChild(Object.assign(document.createElement("div"), { className: "loading",
          textContent: `Couldn't play this recording${why ? `: ${why}` : ""}. Step to another one or try again.` }));
      });
      loading.remove();
      frame.prepend(video);
      this._video = video;
      this._folKey = null; // (a new picture: any zoom is put on it afresh)
      // follow the frames the video actually shows: their own timestamps for
      // the boxes, and the face zoom redrawn once per frame (~30/s, not 60)
      if (video.requestVideoFrameCallback) {
        const onFrame = (_now, meta) => {
          if (this._video !== video) return;
          this._frameTime = meta.mediaTime;
          this._drawPip(true);
          video.requestVideoFrameCallback(onFrame);
        };
        video.requestVideoFrameCallback(onFrame);
      }
    } catch (err) {
      loading.textContent = `Couldn't play this one: ${err.message || err.code || err}`;
    }
  }

  // What the other detections on this camera saw while this clip runs
  // (Protect files a loitering person and the passing cars under separate
  // events): their boxes, drawn dashed. An extra: any failure just leaves
  // them out, and a backend without the command isn't asked again.
  async _loadOthers() {
    const clip = this._clip;
    const e = this._index != null && this._items[this._index];
    if (!clip || !e || !this._opts.others || this._noOthers || clip.others) return;
    if (!clip.start_ms || !(clip.duration > 0)) return;
    clip.others = "asked";
    let res;
    try {
      res = await this._hass.callWS({
        type: "protect_detections/overlaps",
        event_id: e.id,
        start: Math.round(clip.start_ms),
        end: Math.round(clip.end_ms || clip.start_ms + clip.duration * 1000),
        limit: 12,
      });
    } catch (err) {
      if (err && err.code === "unknown_command") this._noOthers = true;
      else clip.others = null; // may be asked again
      return;
    }
    if (this._clip !== clip) return;
    // one box per thing: not what this clip's own detection already follows,
    // and something two other detections both saw only once
    const key = (t) => `${t.type}:${t.tracker}`;
    const own = new Set((clip.track || []).map(key));
    const byKey = new Map();
    for (const ev of (res && res.events) || []) {
      for (const t of (ev && ev.track) || []) {
        if (!t || !Array.isArray(t.points) || !t.points.length || own.has(key(t))) continue;
        const had = byKey.get(key(t));
        if (!had) byKey.set(key(t), { ...t, points: [...t.points] });
        else {
          const seen = new Set(had.points.map((p) => p[0]));
          had.points.push(...t.points.filter((p) => !seen.has(p[0])));
          had.points.sort((a, b) => a[0] - b[0]);
          had.desc = had.desc || t.desc;
        }
      }
    }
    this._others = [...byKey.values()];
  }

  // Jump to the object: a second before its best shot (or its first box).
  _seekTo(o) {
    const clip = this._clip;
    const v = this._video;
    if (!clip || !v) return;
    const tr = (clip.track || []).find((t) => o.tracker && t.tracker === o.tracker);
    const at = o.best_at || tr?.points[0]?.[0];
    if (!at) return;
    v.currentTime = Math.min(Math.max(0, (at - clip.start_ms) / 1000 - 1), Math.max(0, (v.duration || 1e9) - 0.1));
    v.play().catch(() => {});
  }

  _layout() {
    const frame = this._root?.querySelector(".frame");
    if (!frame || this._root.querySelector(".player").hidden) return;
    const head = this._root.querySelector(".head").offsetHeight;
    const bar = this._root.querySelector(".pbar").offsetHeight;
    const strip = this._root.querySelector(".strip").offsetHeight;
    const lb = this._root.querySelector(".lb");
    const W = lb.clientWidth;
    const H = lb.clientHeight;
    const arrows = W > 700 ? 2 * 52 : 0;
    const w = Math.min(W - 24 - arrows, (H - head - bar - strip - 16) * this._config.aspect_ratio);
    frame.style.width = `${Math.max(200, Math.floor(w))}px`;
  }

  // ------------------------------------------------------------- overlay

  _loop() {
    const step = () => {
      this._raf = requestAnimationFrame(step);
      try {
        this._drawOverlay();
      } catch (err) {
        console.error("protect-detection-card", err); // keep the loop alive
      }
    };
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(step);
  }

  _drawOverlay() {
    const boxesEl = this._root?.querySelector(".boxes");
    if (!boxesEl) return;
    const items = [];
    if (this._clip && this._video) {
      const clip = this._clip;
      const wall = clip.start_ms + this._mediaTime() * 1000 + TRACK_LEAD_MS;
      for (const tr of clip.track || []) {
        const at = this._boxAt(tr.points, wall);
        const path = tr.points.filter((p) => p[0] <= wall).map((p) => anchor(tr.type, p.slice(1, 5)));
        if (!at && path.length < 2) continue;
        const conf = at?.[5] ? ` (${at[5]}%)` : "";
        items.push({ id: tr.tracker, type: tr.type, coord: at && at.slice(1, 5), path,
          label: `${titleCase(tr.type)}${conf}${tr.desc ? `, ${tr.desc}` : ""}` });
      }
      for (const tr of (this._opts.others && this._others) || []) {
        const at = this._boxAt(tr.points, wall);
        if (!at) continue; // (no paths for these: the clip is not about them)
        items.push({ id: `other:${tr.type}:${tr.tracker}`, type: tr.type, coord: at.slice(1, 5), path: [], other: true,
          label: `${titleCase(tr.type)}${tr.desc ? `, ${tr.desc}` : ""}` });
      }
    }
    this._drawPip();
    this._follow();
    const svg = this._root.querySelector(".overlay svg");
    const parts = [];
    if (this._opts.paths) {
      for (const it of items) {
        if (it.path.length < 2) continue;
        parts.push(`<polyline points="${it.path.map(([x, y]) => `${x},${y}`).join(" ")}" fill="none"
          stroke="${color(it.type)}" stroke-width="2.5" stroke-dasharray="6 5" stroke-linecap="round"
          stroke-linejoin="round" opacity=".85" vector-effect="non-scaling-stroke"/>`);
      }
    }
    const html = parts.join("");
    if (html !== this._lastSvg) {
      svg.innerHTML = html;
      this._lastSvg = html;
    }
    const keep = new Set();
    if (this._opts.boxes || this._opts.labels) {
      for (const it of items) {
        if (!it.coord) continue;
        keep.add(it.id);
        let el = this._boxEls.get(it.id);
        if (!el) {
          el = document.createElement("div");
          el.className = it.other ? "box other" : "box";
          el.innerHTML = `<div class="tag"></div>`;
          boxesEl.appendChild(el);
          this._boxEls.set(it.id, el);
        }
        const [x, y, w, h] = it.coord;
        el.style.setProperty("--c", color(it.type));
        el.style.setProperty("--t", !this._opts.boxes ? "0px" : `calc(${it.other ? 1 : 2}px * var(--fk, 1))`);
        Object.assign(el.style, { left: `${x / 10}%`, top: `${y / 10}%`, width: `${w / 10}%`, height: `${h / 10}%` });
        const tag = el.firstChild;
        tag.hidden = !this._opts.labels;
        if (tag.textContent !== it.label) tag.textContent = it.label;
        tag.classList.toggle("below", y < 60);
      }
    }
    for (const [id, el] of this._boxEls) {
      if (!keep.has(id)) {
        el.remove();
        this._boxEls.delete(id);
      }
    }
  }

  // ---------------------------------------------------------------- follow
  //
  // "Follow": the picture zoomed in on what the detection is about, moving
  // with it. Protect's stored boxes say where it is at each moment (between
  // two of them: in between); the view glides there rather than jumping,
  // stays a moment where it was last seen, then eases back out. A track too
  // short to follow (under two points, or under a second) leaves the picture
  // whole, as does a paused clip, so its controls can be reached.

  // The tracks to stay on: the detection's main kind of thing (a person
  // before a vehicle, and so on; a face or a plate only if there is nothing
  // else), those of them that can be followed.
  _followTracks() {
    const clip = this._clip;
    if (!clip) return [];
    if (clip.followTracks) return clip.followTracks;
    const able = (clip.track || []).filter((t) => t.points.length >= 2 && t.points[t.points.length - 1][0] - t.points[0][0] >= 1000);
    const kinds = ["person", "vehicle", "animal", "package"];
    const kind = kinds.find((k) => able.some((t) => t.type === k)) || (able[0] && able[0].type);
    return (clip.followTracks = able.filter((t) => t.type === kind));
  }

  _follow() {
    const v = this._video;
    const clip = this._clip;
    const now = performance.now();
    const st = (this._fol = this._fol || { k: 1, x: 0, y: 0, at: now, seen: 0, want: null });
    let want = null; // [zoom, left, top] (left/top: of the whole picture, 0..1)
    if (this._opts.follow && v && clip && !v.paused) {
      const wall = clip.start_ms + this._mediaTime() * 1000 + TRACK_LEAD_MS;
      let box = null; // around all of them that are in view now
      for (const tr of this._followTracks()) {
        const at = this._boxAt(tr.points, wall);
        if (!at) continue;
        const [x, y, w, h] = at.slice(1, 5);
        box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x + w), Math.max(box[3], y + h)] : [x, y, x + w, y + h];
      }
      if (box) {
        // room round it: about a third of the view wide, half of it high
        const w = Math.max(1, box[2] - box[0]);
        const h = Math.max(1, box[3] - box[1]);
        const k = Math.max(1, Math.min(FOLLOW_MAX, 1000 / (w * 3), 1000 / (h * 2)));
        const left = Math.max(0, Math.min(1 - 1 / k, (box[0] + w / 2) / 1000 - 0.5 / k));
        const top = Math.max(0, Math.min(1 - 1 / k, (box[1] + h / 2) / 1000 - 0.5 / k));
        want = [k, left, top];
        st.want = want;
        st.seen = now;
      } else if (st.want && now - st.seen < FOLLOW_HOLD_MS) want = st.want; // just lost: stay a moment
    }
    if (!want) {
      st.want = null;
      want = [1, 0, 0];
    }
    // glide (the same at any frame rate)
    const f = 1 - Math.exp(-Math.min(250, now - st.at) / FOLLOW_EASE_MS);
    st.at = now;
    st.k += (want[0] - st.k) * f;
    st.x += (want[1] - st.x) * f;
    st.y += (want[2] - st.y) * f;
    if (Math.abs(st.k - 1) < 0.002 && want[0] === 1) {
      st.k = 1;
      st.x = st.y = 0;
    }
    // keeps inside the picture while the zoom changes
    st.x = Math.max(0, Math.min(1 - 1 / st.k, st.x));
    st.y = Math.max(0, Math.min(1 - 1 / st.k, st.y));
    this._followApply(st.k, st.x, st.y);
  }

  _followApply(k, x, y) {
    const key = k === 1 ? "" : `scale(${k.toFixed(4)}) translate(${(-x * 100).toFixed(3)}%, ${(-y * 100).toFixed(3)}%)`;
    if (key === this._folKey) return;
    this._folKey = key;
    const over = this._root && this._root.querySelector(".overlay");
    if (over) {
      over.style.transform = key;
      over.style.setProperty("--fk", String(1 / k));
    }
    if (this._video) this._video.style.transform = key;
  }

  // The face, if Protect tracked one: zoom into the recording around it while
  // it's tracked, show the still (best shot, else the last zoom) otherwise.
  // the time (s) of the frame on screen: from requestVideoFrameCallback when
  // available, else the playhead
  _mediaTime() {
    const v = this._video;
    if (!v) return 0;
    return this._frameTime != null && Math.abs(this._frameTime - v.currentTime) < 1 ? this._frameTime : v.currentTime;
  }

  // frame: called for a newly shown frame (requestVideoFrameCallback) — only
  // then is the zoom redrawn; the animation loop just keeps the state right.
  _drawPip(frame = false) {
    const el = this._root.querySelector(".pip");
    const st = this._pip;
    const v = this._video;
    const faces = (this._clip?.track || []).filter((t) => t.type === "face" && t.points.length);
    if (!this._opts.pip || !st || !v || (!faces.length && !st.still)) {
      el.hidden = true;
      return;
    }
    const wall = this._clip.start_ms + this._mediaTime() * 1000 + TRACK_LEAD_MS;
    let box = null;
    for (const tr of faces) {
      const b = this._faceAt(tr.points, wall);
      if (b && (!box || b[2] * b[3] > box[2] * box[3])) box = b;
    }
    const canvas = el.querySelector("canvas");
    const img = el.querySelector("img");
    const dot = el.querySelector(".dot");
    if (box && v.videoWidth) {
      // head-and-shoulders crop around the face, in the PiP's shape. Generous on
      // purpose: Protect's face boxes are sparse and run up to a face-width
      // off a walking person.
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      const [x, y, w, h] = [box[0] / 1000 * vw, box[1] / 1000 * vh, box[2] / 1000 * vw, box[3] / 1000 * vh];
      const cx = x + w / 2;
      const cy = y + h * 0.9;
      let ch = Math.max(h * 4, w * 4 * PIP_H / PIP_W, vh * 0.06);
      let cw = ch * PIP_W / PIP_H;
      cw = Math.min(cw, vw);
      ch = Math.min(ch, vh);
      const target = [Math.min(Math.max(0, cx - cw / 2), vw - cw), Math.min(Math.max(0, cy - ch / 2), vh - ch), cw, ch];
      // redraw once per shown frame; without requestVideoFrameCallback, when
      // the playhead moved and at most PIP_FPS times a second
      const now = performance.now();
      const due = v.requestVideoFrameCallback
        ? frame || !st.drew
        : v.currentTime !== st.lastTime && (!st.lastDraw || now - st.lastDraw >= 1000 / PIP_FPS);
      if (due) {
        st.rect = st.rect ? st.rect.map((p, k) => p + (target[k] - p) * 0.5) : target; // glide, don't jump
        canvas.getContext("2d").drawImage(v, ...st.rect, 0, 0, PIP_W, PIP_H);
        st.lastDraw = now;
        st.lastTime = v.currentTime;
        st.drew = true;
      }
      canvas.hidden = false;
      img.hidden = true;
      dot.classList.remove("still");
    } else {
      st.rect = null;
      if (st.still) {
        img.hidden = false;
        canvas.hidden = true;
      } else if (!st.drew) {
        el.hidden = true; // no photo and not seen yet: nothing to show
        return;
      }
      dot.classList.add("still"); // best shot, or the last zoomed frame
    }
    el.hidden = false;
  }

  _faceAt(points, t) {
    let i = 0;
    while (i < points.length && points[i][0] <= t) i++;
    const a = points[i - 1];
    const b = points[i];
    if (a && b && b[0] - a[0] <= FACE_GAP_MS) {
      const f = (t - a[0]) / (b[0] - a[0]);
      return [1, 2, 3, 4].map((k) => a[k] + (b[k] - a[k]) * f);
    }
    if (a && t - a[0] <= FACE_HOLD_MS) return a.slice(1, 5);
    if (b && b[0] - t <= FACE_HOLD_MS) return b.slice(1, 5);
    return null;
  }

  _boxAt(points, t) {
    let i = 0;
    while (i < points.length && points[i][0] <= t) i++;
    if (i === 0) return null;
    const a = points[i - 1];
    if (i < points.length && points[i][0] - a[0] <= MAX_GAP_MS) {
      const b = points[i];
      const f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
      return [t, ...[1, 2, 3, 4].map((k) => a[k] + (b[k] - a[k]) * f), a[5]];
    }
    return t - a[0] <= 600 ? a : null;
  }
}

// (defined once, however the file got here)
if (!customElements.get("protect-detection-card")) customElements.define("protect-detection-card", ProtectDetectionCard);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "protect-detection-card")) window.customCards.push({
  type: "protect-detection-card",
  name: "Protect Detections",
  description: "UniFi Protect detection history in a lightbox, with replays showing Protect's boxes and paths.",
});
