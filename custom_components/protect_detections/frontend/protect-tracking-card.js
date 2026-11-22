/**
 * protect-tracking-card — stands by until a camera tracks a person (or
 * whatever kinds of thing it is told to watch for), then shows that camera
 * live, zoomed in on them and staying on them, and stands by again once they
 * have gone.
 *
 * Needs the protect_detections custom integration (its live relay) and the
 * UniFi Protect integration. The whole config can be just:
 *
 *   type: custom:protect-tracking-card
 *
 * It then watches every UniFi Protect camera that recognises things, for
 * people, and shows whichever one sees someone first (until they have gone).
 * Optional:
 *
 *   camera: camera.x_medium_resolution_channel   # only this camera (either of its
 *                                           # stream entities)
 *   types: [person]                         # what to react to and stay on: person,
 *                                           # vehicle, animal, package
 *   show_others: false                      # true: also box other things, faintly
 *   name: Front door                        # shown while standing by
 *   linger: 10                              # seconds the picture stays after they were
 *                                           # last seen (someone stepping behind a
 *                                           # tree doesn't stop and start it)
 *   snapshot: 60                            # seconds between still pictures behind the
 *                                           # standing-by text; 0 for none
 *   standby: radar                          # how standing by looks: radar (a sweep), pulse
 *                                           # (rings), scanline, or none (just the still)
 *   accent: "#e0102a"                       # the scanner's colour (default: the theme's
 *                                           # primary colour)
 *   warm: false                             # true: keep the camera's stream running
 *                                           # unseen, so the picture is there at once
 *                                           # (costs that stream all the time)
 *   stream: auto                            # auto (the best stream at home, the light
 *                                           # one elsewhere) | high | low
 *   max_zoom: 4                             # how far it zooms in, at most
 *   aspect_ratio: 1.7778                    # width / height of the card's picture
 *   height: 300px                           # instead: a set height (px, or a CSS length)
 *   live_delay: 700                         # ms the picture is held back so the boxes
 *                                           # line up with it (see protect-live.js)
 *   live_offset: 0                          # ms to place the boxes later (+) / earlier (-)
 *
 * Size: in a sections view the card can be dragged to any width and height
 * and its picture fills the cell (the whole picture always shows: with bars
 * if the cell has another shape). Elsewhere it takes its height from
 * `aspect_ratio`, or from `height:` if that is set.
 *
 * camera-wall-card shows one of these per camera that recognises things, as
 * a tile among its feeds (its config `tracking:`).
 *
 * Standing by, no video is playing: the card listens to where Protect says
 * things are (while it is on screen and the page is in front; not otherwise)
 * and shows a still picture now and then. Tapping it opens the camera.
 * With the Protect Zones integration it also names the zone the person is in.
 *
 * Part of the Protect Detections integration, which serves it and loads it
 * into Home Assistant by itself (no dashboard resource to add).
 */

// Shared with the other cards here (served from the same folder).
import { findProtectCameras } from "./protect-cameras.js";
import { LiveTracks, LIVE_COLORS, deepFind, pictureBox } from "./protect-live.js";

const KINDS = { person: ["Person", "people"], vehicle: ["Vehicle", "vehicles"], animal: ["Animal", "animals"], package: ["Package", "packages"] };
const STANDBY = ["radar", "pulse", "scanline", "none"]; // how standing by looks
const LOCK_MS = 520; // the "there they are" beat as the picture comes in
const HOLD_MS = 1500; // the view stays this long where they were last seen, before easing out
const EASE_MS = 350;
const FAIL_MS = 12000; // no picture this long after starting: say so
const LAST_KEY = "protect-tracking-card:last:";

function onHomeNetwork() {
  const h = location.hostname;
  return h === "localhost" || h.endsWith(".local") || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/.test(h);
}

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; height: 100%; }
  /* its size: by the shape (aspect_ratio) as a rule; a set height (the height option),
     or the cell a sections view gives it, is filled instead */
  .frame { container-type: size; }
  :host([fixed]) .frame { aspect-ratio: auto; height: var(--tracking-height, 100%); }
  :host([fill]) { height: 100%; }
  :host([fill]) .frame { aspect-ratio: auto; height: 100%; min-height: 96px; }
  .frame { position: relative; width: 100%; aspect-ratio: var(--tile-ar, var(--ar, 1.7778)); overflow: hidden; background: #000; cursor: pointer;
    color: #fff; font-family: var(--paper-font-body1_-_font-family, inherit); }
  .snap { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .55; filter: saturate(.7); transition: opacity .4s; }
  .snap:not([src]) { visibility: hidden; }
  .active .snap { opacity: 1; filter: none; }
  .zoomer { position: absolute; inset: 0; transform-origin: 0 0; will-change: transform; }
  /* the whole picture, whatever the frame's shape (bars beside or above it
     rather than a cut-off edge: nobody followed is ever outside it) */
  .video { position: absolute; inset: 0; display: grid; align-items: center; --video-max-height: 100cqh; }
  .video > * { width: 100%; }
  .zoomer { transition: opacity .45s ease .15s; }
  .frame:not(.active) .zoomer { opacity: 0; pointer-events: none; transition: opacity .3s; }
  .boxes { position: absolute; pointer-events: none; }
  .box { position: absolute; box-sizing: border-box; border: calc(2px * var(--k, 1)) solid var(--c, #fff); border-radius: calc(3px * var(--k, 1));
    pointer-events: auto; }
  .box.other { border-style: dashed; border-width: calc(1px * var(--k, 1)); opacity: .6; pointer-events: none; }
  .box.picked { box-shadow: 0 0 0 calc(1px * var(--k, 1)) #fff; }
  /* standing by: the words, small, along the bottom */
  .idle { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
    padding: 22px 12px 9px; background: linear-gradient(to top, rgba(0,0,0,.78), rgba(0,0,0,0)); text-shadow: 0 1px 2px #000;
    transition: opacity .3s; pointer-events: none; }
  .active .idle { opacity: 0; }
  .idle ha-icon { display: none; }
  .idle b { font-size: 14px; font-weight: 600; letter-spacing: .02em; }
  .idle span { font-size: 12px; opacity: .92; }
  .idle small { font-size: 11px; opacity: .7; }
  .frame.s-none .idle { top: 0; align-items: center; justify-content: center; text-align: center; background: rgba(0,0,0,.35); padding: 12px; }
  .frame.s-none .idle ha-icon { display: block; --mdc-icon-size: 34px; opacity: .9; margin-bottom: 4px; }

  /* standing by: the scanner. All of it moves by transform and opacity only,
     stops while the card can't be seen, and holds still for those who ask
     for less motion. --acc is its colour: the theme's, or \`accent:\`. */
  .scan { position: absolute; inset: 0; overflow: hidden; pointer-events: none; --acc: var(--tracking-accent, var(--primary-color, #e0102a));
    background: radial-gradient(ellipse at center, rgba(0,0,0,.15) 0%, rgba(0,0,0,.6) 100%); transition: opacity .35s ease; }
  .active .scan { opacity: 0; transition: opacity .45s ease .22s; }
  .frame.s-none .scan, .frame.noscan .scan > :not(.grid) { display: none; }
  .scan > * { position: absolute; }
  .scan .grid { inset: 0; opacity: .13;
    background-image: linear-gradient(var(--acc) 1px, transparent 1px), linear-gradient(90deg, var(--acc) 1px, transparent 1px);
    background-size: 100% 16.667%, 10% 100%; }
  .scan .sweep { left: 50%; top: 50%; width: 160%; aspect-ratio: 1; border-radius: 50%; opacity: .55;
    background: conic-gradient(from 0deg, transparent 0deg, transparent 285deg, color-mix(in srgb, var(--acc) 12%, transparent) 320deg, color-mix(in srgb, var(--acc) 75%, transparent) 359deg, transparent 360deg);
    transform: translate(-50%, -50%) rotate(0deg); animation: trk-sweep 4s linear infinite; will-change: transform; }
  .scan .rings, .scan .blips { inset: 0; }
  .scan .rings i { position: absolute; left: 50%; top: 50%; width: 34%; aspect-ratio: 1; border-radius: 50%;
    border: 1.5px solid var(--acc); box-shadow: 0 0 10px color-mix(in srgb, var(--acc) 60%, transparent);
    transform: translate(-50%, -50%) scale(.15); opacity: 0; animation: trk-ring 3.6s cubic-bezier(.2,.6,.3,1) infinite; will-change: transform, opacity; }
  .scan .rings i:nth-child(2) { animation-delay: 1.2s; }
  .scan .rings i:nth-child(3) { animation-delay: 2.4s; }
  .scan .line { inset: 0; background: linear-gradient(to bottom, transparent 82%, color-mix(in srgb, var(--acc) 22%, transparent) 97%, color-mix(in srgb, var(--acc) 90%, transparent) 100%);
    transform: translateY(-100%); animation: trk-line 3.2s cubic-bezier(.45,.05,.55,.95) infinite; will-change: transform; }
  /* the reticle: brackets in the middle; it jumps to whoever turns up */
  .scan .reticle { left: 50%; top: 50%; width: 30%; aspect-ratio: 1; max-height: 70%;
    transform: translate(-50%, -50%) translate(var(--dx, 0px), var(--dy, 0px)) scale(var(--ls, 1));
    transition: transform .32s cubic-bezier(.2,.9,.25,1.15); will-change: transform; }
  .scan .reticle::before { content: ""; position: absolute; inset: 0; animation: trk-breathe 2.8s ease-in-out infinite;
    background:
      linear-gradient(var(--acc), var(--acc)) top left / 22% 2px no-repeat, linear-gradient(var(--acc), var(--acc)) top left / 2px 22% no-repeat,
      linear-gradient(var(--acc), var(--acc)) top right / 22% 2px no-repeat, linear-gradient(var(--acc), var(--acc)) top right / 2px 22% no-repeat,
      linear-gradient(var(--acc), var(--acc)) bottom left / 22% 2px no-repeat, linear-gradient(var(--acc), var(--acc)) bottom left / 2px 22% no-repeat,
      linear-gradient(var(--acc), var(--acc)) bottom right / 22% 2px no-repeat, linear-gradient(var(--acc), var(--acc)) bottom right / 2px 22% no-repeat;
    filter: drop-shadow(0 0 4px color-mix(in srgb, var(--acc) 70%, transparent)); }
  .scan .reticle::after { content: ""; position: absolute; left: 50%; top: 50%; width: 10%; aspect-ratio: 1; transform: translate(-50%, -50%);
    background: linear-gradient(var(--acc), var(--acc)) center / 100% 1.5px no-repeat, linear-gradient(var(--acc), var(--acc)) center / 1.5px 100% no-repeat; opacity: .8; }
  .lock .scan .reticle::before { animation: trk-lock .5s ease-out 1 both; }
  .scan .blips i { position: absolute; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 50%; background: var(--acc);
    box-shadow: 0 0 8px var(--acc); opacity: 0; animation: trk-blip 1.6s ease-out 1 both; }
  /* which parts each style has */
  .frame.s-radar .line { display: none; }
  .frame.s-radar .rings i { animation-duration: 5.4s; opacity: 0; border-width: 1px; }
  .frame.s-radar .rings i:nth-child(2) { animation-delay: 1.8s; }
  .frame.s-radar .rings i:nth-child(3) { animation-delay: 3.6s; }
  .frame.s-pulse .sweep, .frame.s-pulse .line, .frame.s-pulse .grid { display: none; }
  .frame.s-scanline .sweep, .frame.s-scanline .rings { display: none; }
  /* out of sight, or picture showing: nothing runs */
  .frame.paused .scan *, .frame.paused .scan *::before, .frame.active:not(.lock) .scan *, .frame.active:not(.lock) .scan *::before { animation-play-state: paused; }
  @keyframes trk-sweep { to { transform: translate(-50%, -50%) rotate(360deg); } }
  @keyframes trk-ring { 0% { transform: translate(-50%, -50%) scale(.15); opacity: 0; } 12% { opacity: .85; } 100% { transform: translate(-50%, -50%) scale(3.4); opacity: 0; } }
  @keyframes trk-line { to { transform: translateY(100%); } }
  @keyframes trk-breathe { 0%, 100% { transform: scale(1); opacity: .75; } 50% { transform: scale(1.07); opacity: 1; } }
  @keyframes trk-lock { 0% { transform: scale(1.35); opacity: 1; filter: brightness(2.2) drop-shadow(0 0 10px var(--acc)); } 100% { transform: scale(1); opacity: 1; filter: brightness(1.2) drop-shadow(0 0 4px var(--acc)); } }
  @keyframes trk-blip { 0% { opacity: .9; transform: scale(1.6); } 100% { opacity: 0; transform: scale(.7); } }
  @media (prefers-reduced-motion: reduce) {
    .scan *, .scan *::before { animation: none !important; }
    .scan .reticle { transition: none; }
    .scan .sweep { opacity: .3; }
    .scan .rings i { opacity: .35; transform: translate(-50%, -50%) scale(1); }
    .scan .rings i:nth-child(2) { transform: translate(-50%, -50%) scale(1.9); opacity: .22; }
    .scan .rings i:nth-child(3) { transform: translate(-50%, -50%) scale(2.8); opacity: .12; }
    .scan .line { transform: translateY(-45%); opacity: .6; }
    .scan .blips i { opacity: .6; }
  }
  .idle .note { color: var(--warning-color, #fbbf24); opacity: 1; }
  .idle .note:empty { display: none; }
  .top, .info { position: absolute; left: 8px; right: 8px; display: flex; flex-wrap: wrap; gap: 6px; pointer-events: none; }
  .top { top: 8px; }
  .info { bottom: 8px; }
  .frame:not(.active) .top, .frame:not(.active) .info { display: none; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600;
    line-height: 16px; background: rgba(0,0,0,.62); color: #fff; white-space: nowrap; }
  .chip i { width: 8px; height: 8px; border-radius: 50%; background: var(--c, #e0102a); }
  .chip.live i { animation: pulse 1.2s infinite; }
  .chip.warn { background: color-mix(in srgb, var(--warning-color, #fbbf24) 80%, #000); color: #000; }
  @keyframes pulse { 50% { opacity: .25; } }
`;

class ProtectTrackingCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    config = config || {};
    if (config.types != null && (!Array.isArray(config.types) || !config.types.length || config.types.some((t) => typeof t !== "string"))) {
      throw new Error("protect-tracking-card: 'types' must be a list such as [person]");
    }
    if (config.camera != null && typeof config.camera !== "string") throw new Error("protect-tracking-card: 'camera' must be a camera entity");
    this._config = { types: ["person"], linger: 10, snapshot: 60, aspect_ratio: 16 / 9, max_zoom: 4, stream: "auto", ...config };
    this._stopAll();
    this._cams = null;
    this._liveCams = undefined;
    this._build();
    this._size();
    if (this._hass) this._discover();
  }

  set hass(hass) {
    const first = !this._hass;
    const lists = !first && (this._hass.entities !== hass.entities || this._hass.devices !== hass.devices);
    this._hass = hass;
    if (first || lists) this._discover(); // (a camera added or removed is picked up)
    const a = this._active;
    if (a && a.stream) this._feed(a.stream, a.entity);
    if (this._warm) this._feed(this._warm.stream, this._warm.entity);
  }

  // (in units of about 50 px, for views that stack cards in columns)
  getCardSize() {
    const px = this._heightPx();
    return px ? Math.max(1, Math.ceil(px / 50)) : 5;
  }

  // A sections view: any width and height from 3 x 2 cells up (rows are
  // numbers, so the height can be dragged too; the picture fills the cell).
  getGridOptions() {
    return { columns: 12, rows: 5, min_columns: 3, min_rows: 2 };
  }

  // The view tells its cards how it lays them out: "grid" is a sections
  // view, where the card is given a cell to fill.
  set layout(value) {
    this._layout = value;
    this._size();
  }

  get layout() {
    return this._layout;
  }

  // `height:` as a CSS length ("" when it isn't one), and in px when it is given so.
  _height() {
    const h = this._config && this._config.height;
    if (typeof h === "number" && h > 0) return `${h}px`;
    return typeof h === "string" && /^\d+(\.\d+)?(px|em|rem|vh|vw|%)$/.test(h.trim()) ? h.trim() : "";
  }

  _heightPx() {
    const m = /^(\d+(?:\.\d+)?)px$/.exec(this._height());
    return m ? Number(m[1]) : 0;
  }

  // How the card gets its height: the cell it is given (a sections view),
  // a set height, or else its shape. On the camera wall: the wall's tile.
  _size() {
    if (!this._config) return;
    const embedded = !!this._config.embedded;
    const fill = !embedded && this._layout === "grid";
    const height = embedded || fill ? "" : this._height();
    this.toggleAttribute("fill", fill);
    this.toggleAttribute("fixed", !!height);
    if (height) this.style.setProperty("--tracking-height", height);
    else this.style.removeProperty("--tracking-height");
  }

  // The card editor's form (the rest is YAML: see the top of this file).
  static getConfigForm() {
    return {
      schema: [
        { name: "camera", selector: { entity: { domain: "camera", integration: "unifiprotect" } } },
        { name: "name", selector: { text: {} } },
        { name: "types", selector: { select: { multiple: true, options: Object.entries(KINDS).map(([value, [label]]) => ({ value, label })) } } },
        { name: "standby", selector: { select: { options: STANDBY.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })) } } },
        { name: "linger", selector: { number: { min: 1, max: 120, mode: "box", unit_of_measurement: "s" } } },
        { name: "show_others", selector: { boolean: {} } },
        { name: "warm", selector: { boolean: {} } },
        { name: "height", selector: { text: {} } },
      ],
      computeLabel: (field) =>
        ({ camera: "Camera (empty: every camera that recognises things)", name: "Name", types: "Watch for", standby: "Standing-by look", linger: "Stay after last seen",
          show_others: "Also box other things", warm: "Keep the stream running (instant picture)", height: "Height, e.g. 300px (empty: by shape)" })[field.name] || field.name,
    };
  }

  connectedCallback() {
    this._onVisible = this._onVisible || (() => this._sync());
    document.addEventListener("visibilitychange", this._onVisible);
    if (!this._seenBy && window.IntersectionObserver) {
      this._onScreen = true;
      this._seenBy = new IntersectionObserver((entries) => {
        this._onScreen = entries.some((e) => e.isIntersecting);
        this._sync();
      });
    }
    this._seenBy?.observe(this);
    this._tick = setInterval(() => this._idle(), 30000);
    this._sync();
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this._onVisible);
    this._seenBy?.disconnect();
    clearInterval(this._tick);
    this._stopAll();
  }

  // ---------------------------------------------------------------- build

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="frame" style="--ar:${Number(this._config.aspect_ratio) || 16 / 9}">
          <img class="snap" alt="">
          <div class="zoomer"><div class="video"></div><div class="boxes"></div></div>
          <div class="scan"><div class="grid"></div><div class="sweep"></div><div class="rings"><i></i><i></i><i></i></div><div class="line"></div><div class="blips"></div><div class="reticle"></div></div>
          <div class="idle"><ha-icon icon="mdi:account-eye-outline"></ha-icon><b></b><span></span><small></small><small class="note"></small></div>
          <div class="top"><span class="chip live"><i></i><span class="cam"></span></span><span class="chip warn" hidden></span></div>
          <div class="info"></div>
        </div>
      </ha-card>`;
    this._root = root;
    const frame = root.querySelector(".frame");
    frame.classList.add(`s-${STANDBY.includes(this._config.standby) ? this._config.standby : "radar"}`);
    if (typeof this._config.accent === "string" && this._config.accent) frame.style.setProperty("--tracking-accent", this._config.accent);
    frame.addEventListener("click", () => this._open());
    this._idle();
  }

  // What is watched for, in words: "people", "people and vehicles".
  _what() {
    const names = this._config.types.map((t) => (KINDS[t] ? KINDS[t][1] : t));
    return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  }

  // The standing-by text.
  _idle() {
    const root = this._root;
    if (!root || !this._config) return;
    const cams = this._cams || [];
    const [name, status, last, note] = ["b", "span", "small", ".note"].map((q) => root.querySelector(`.idle ${q}`));
    name.textContent = this._config.name || (cams.length === 1 ? cams[0].name : cams.length ? `${cams.length} cameras` : "Tracking");
    let text = `Watching for ${this._what()}`;
    if (this._state === "norelay") text = "Needs the Protect Detections integration (with its live tracking)";
    else if (this._state === "nocams") text = this._config.camera ? "This camera doesn't recognise things" : "No camera here recognises things";
    else if (!this._cams) text = "Looking for cameras…";
    else if (this._listening === false) text = "Paused while out of sight";
    status.textContent = text;
    let seen = this._lastSeen || 0;
    if (!seen && cams.length) {
      try {
        seen = Number(localStorage.getItem(LAST_KEY + this._lastKey())) || 0;
      } catch (e) {}
    }
    last.textContent = !this._cams || this._state ? "" : seen ? `Last seen ${ago(Date.now() - seen)}` : "Nothing seen yet";
    note.textContent = this._note || "";
    // the scanner runs only while the card is really watching
    const frame = root.querySelector(".frame");
    frame.classList.toggle("paused", this._listening !== true);
    frame.classList.toggle("noscan", !!this._state || !this._cams || !this._cams.length);
  }

  _lastKey() {
    return `${(this._cams || []).map((c) => c.id).join(",")}:${this._config.types.join(",")}`;
  }

  // -------------------------------------------------------------- cameras

  // Which cameras to watch: [{id (Protect's), entity (light), tap_entity (best), name}].
  _discover() {
    const hass = this._hass;
    if (!hass || !this._config) return;
    const use = (live) => {
      this._liveCams = live;
      const cfg = this._config;
      const cams = [];
      if (cfg.camera) {
        const id = live[cfg.camera];
        if (id) {
          const found = findProtectCameras(hass).find((c) => c.entity === cfg.camera || c.tap_entity === cfg.camera);
          const state = hass.states[cfg.camera];
          cams.push({ id, entity: (found && found.entity) || cfg.camera, tap_entity: (found && found.tap_entity) || cfg.camera,
            name: (found && found.name) || (state && state.attributes.friendly_name) || cfg.camera });
        }
      } else {
        for (const c of findProtectCameras(hass, cfg)) {
          const id = live[c.entity] || live[c.tap_entity];
          if (id && !cams.some((x) => x.id === id)) cams.push({ id, entity: c.entity, tap_entity: c.tap_entity, name: c.name });
        }
      }
      const same = this._cams && JSON.stringify(this._cams) === JSON.stringify(cams);
      this._state = cams.length ? null : "nocams";
      if (!same) {
        this._stopAll();
        this._cams = cams;
      }
      this._idle();
      this._sync();
    };
    const ask = (this._asking = {});
    Promise.resolve(hass.callWS({ type: "protect_detections/live/cameras" })).then(
      (res) => this._asking === ask && use((res && res.cameras) || {}),
      (err) => {
        if (this._asking !== ask) return;
        if (err && err.code === "unknown_command") {
          this._state = "norelay";
          this._cams = [];
          this._stopAll();
        } else this._note = "Couldn't ask Home Assistant about the cameras";
        this._idle();
      }
    );
  }

  // ------------------------------------------------------------ listening

  // For a card that holds this one (the camera wall, while one of its
  // dialogs is open): stop listening and playing, and start again.
  pause() {
    this._paused = true;
    this._sync();
  }

  resume() {
    this._paused = false;
    this._sync();
  }

  // Listens while the card can be seen (on the page, on screen, the page in
  // front), and not otherwise.
  _sync() {
    if (!this._root || !this._hass) return;
    const cams = this._cams || [];
    const want = this.isConnected && this._onScreen !== false && !document.hidden && !this._paused && cams.length > 0 && !this._state;
    this._listening = cams.length ? want : undefined;
    if (!want) {
      this._stopAll();
      this._idle();
      return;
    }
    this._subs = this._subs || new Map();
    for (const cam of cams) {
      if (this._subs.has(cam.id)) continue;
      const sub = { cam, lt: new LiveTracks(), unsub: null, matchAt: 0 };
      this._subs.set(cam.id, sub);
      Promise.resolve(this._hass.connection.subscribeMessage((msg) => this._subs && this._subs.get(cam.id) === sub && this._message(sub, msg), { type: "protect_detections/live/subscribe", entity: cam.entity })).then(
        (unsub) => {
          if (this._subs && this._subs.get(cam.id) === sub) sub.unsub = unsub;
          else Promise.resolve(unsub()).catch(() => {});
        },
        (err) => {
          if (this._subs && this._subs.get(cam.id) === sub) this._subs.delete(cam.id);
          this._note = err && err.code === "unknown_command" ? "" : "Couldn't start listening for this camera";
          if (err && err.code === "unknown_command") this._state = "norelay";
          this._idle();
        }
      );
    }
    if (this._config.warm && !this._warm) {
      // the stream kept running unseen, so the picture is there at once
      const cam = cams[0];
      const entity = this._entity(cam);
      this._warm = { cam, entity, stream: this._stream(entity) };
    }
    this._snap();
    this._idle();
  }

  _stopAll() {
    this._leave();
    for (const sub of (this._subs && this._subs.values()) || []) {
      if (sub.unsub) {
        try {
          Promise.resolve(sub.unsub()).catch(() => {});
        } catch (e) {}
      }
    }
    this._subs = null;
    if (this._warm) {
      this._warm.stream.remove();
      this._warm = null;
    }
    clearTimeout(this._snapTimer);
    this._snapTimer = null;
  }

  _message(sub, msg) {
    if (msg && msg.status) {
      this._note = msg.status === "error" ? "Protect's live tracking can't be reached (trying again)" : "";
      if (!this._active) this._idle();
      return;
    }
    sub.lt.message(msg);
    const types = this._config.types;
    const hit = (msg.tracks || []).find((tr) => tr && types.includes(tr.objectType));
    if (!hit) {
      if (this._config.show_others && !this._active) this._blips(msg.tracks || []);
      return;
    }
    sub.matchAt = Date.now();
    this._lastSeen = sub.matchAt;
    try {
      localStorage.setItem(LAST_KEY + this._lastKey(), String(sub.matchAt));
    } catch (e) {}
    if (!this._active) this._enter(sub, hit.coord);
  }

  // Standing by with `show_others`: the other things Protect is tracking, as
  // faint dots on the scanner where they are (each fades by itself; they come
  // with Protect's messages, a few a second at most, so this costs nothing
  // between them).
  _blips(tracks) {
    const layer = this._root && this._root.querySelector(".blips");
    if (!layer) return;
    const dots = [];
    for (const tr of tracks.slice(0, 12)) {
      if (!tr || tr.stationary || !Array.isArray(tr.coord) || tr.coord.length !== 4) continue;
      const dot = document.createElement("i");
      dot.style.cssText = `left:${((tr.coord[0] + tr.coord[2] / 2) / 10).toFixed(1)}%;top:${((tr.coord[1] + tr.coord[3] / 2) / 10).toFixed(1)}%`;
      dots.push(dot);
    }
    layer.replaceChildren(...dots);
  }

  // -------------------------------------------------------------- picture

  _entity(cam) {
    const how = this._config.stream;
    const best = how === "high" || (how !== "low" && onHomeNetwork());
    return best ? cam.tap_entity || cam.entity : cam.entity || cam.tap_entity;
  }

  _stream(entity) {
    const el = document.createElement("ha-camera-stream");
    el.controls = false;
    el.muted = true;
    el.allowExoPlayer = false;
    this._root.querySelector(".video").replaceChildren(el);
    this._feed(el, entity);
    return el;
  }

  // (only a change of state is passed on: Home Assistant renews a camera's
  // access token every few minutes, and the player would start over for it)
  _feed(stream, entity) {
    const state = this._hass.states[entity];
    stream.hass = this._hass;
    if (state && (!stream.stateObj || stream.stateObj.entity_id !== entity || stream.stateObj.state !== state.state)) stream.stateObj = state;
  }

  // A still picture behind the standing-by text, now and then.
  _snap() {
    const every = Number(this._config.snapshot);
    if (this._snapTimer || !(every > 0)) return;
    const take = () => {
      const cam = (this._active && this._active.sub.cam) || (this._cams || [])[0];
      if (!cam || !this._hass || this._active) return;
      this._hass
        .callWS({ type: "auth/sign_path", path: `/api/camera_proxy/${cam.entity}`, expires: 60 })
        .then((r) => {
          if (this._root && r && r.path) this._root.querySelector(".snap").src = r.path;
        })
        .catch(() => {});
    };
    take();
    const loop = () => {
      this._snapTimer = setTimeout(() => {
        take();
        loop();
      }, Math.max(10, every) * 1000);
    };
    loop();
  }

  // Someone is there: the live picture, staying on them.
  _enter(sub, coord) {
    const cam = sub.cam;
    const warm = this._warm && this._warm.cam.id === cam.id ? this._warm : null;
    const entity = warm ? warm.entity : this._entity(cam);
    const stream = warm ? warm.stream : this._stream(entity);
    const a = (this._active = { sub, entity, stream, since: Date.now(), seen: Date.now(), view: { s: 1, cx: null, cy: null, at: 0, want: null }, els: new Map(), pick: null, place: null, placeAt: 0 });
    const root = this._root;
    // the reticle jumps to where they are and flashes while the picture
    // comes in over it (the stream is already starting: this delays nothing)
    const frame = root.querySelector(".frame");
    const reticle = root.querySelector(".reticle");
    if (Array.isArray(coord) && coord.length === 4) {
      const W = frame.clientWidth || 0;
      const H = frame.clientHeight || 0;
      const size = reticle.offsetWidth || W * 0.3 || 1;
      reticle.style.setProperty("--dx", `${(((coord[0] + coord[2] / 2) / 1000 - 0.5) * W).toFixed(1)}px`);
      reticle.style.setProperty("--dy", `${(((coord[1] + coord[3] / 2) / 1000 - 0.5) * H).toFixed(1)}px`);
      reticle.style.setProperty("--ls", Math.max(0.3, Math.min(1.2, (Math.max(coord[2] * W, coord[3] * H) / 1000) * 1.5 / size)).toFixed(3));
    }
    root.querySelector(".blips").replaceChildren();
    frame.classList.add("active", "lock");
    clearTimeout(this._lockTimer);
    this._lockTimer = setTimeout(() => frame.classList.remove("lock"), LOCK_MS);
    root.querySelector(".cam").textContent = cam.name;
    root.querySelector(".chip.warn").hidden = true;
    this._zoneNames(cam);
    const step = () => {
      if (this._active !== a) return;
      a.raf = requestAnimationFrame(step);
      try {
        this._frame(a);
      } catch (err) {
        console.error("protect-tracking-card", err);
      }
    };
    a.raf = requestAnimationFrame(step);
  }

  // They have gone: standing by again.
  _leave() {
    const a = this._active;
    if (!a) return;
    this._active = null;
    cancelAnimationFrame(a.raf);
    const root = this._root;
    if (this._warm && this._warm.stream === a.stream) LiveTracks.hold(a.stream, 0);
    else {
      a.stream.remove();
      // (the stream kept warm goes back in its place, if another camera's took it)
      if (this._warm) root.querySelector(".video").replaceChildren(this._warm.stream);
    }
    clearTimeout(this._lockTimer);
    root.querySelector(".frame").classList.remove("active", "lock");
    // (the reticle drifts back to the middle as the scanner fades in again)
    for (const v of ["--dx", "--dy", "--ls"]) root.querySelector(".reticle").style.removeProperty(v);
    root.querySelector(".zoomer").style.transform = "";
    root.querySelector(".boxes").replaceChildren();
    root.querySelector(".info").replaceChildren();
    this._idle();
  }

  // The names of the camera's zones, if Protect Zones is there to ask.
  _zoneNames(cam) {
    this._zones = this._zones || {};
    if (this._zones[cam.id]) return;
    this._zones[cam.id] = {};
    Promise.resolve(this._hass.callWS({ type: "protect_zones/overlay" }))
      .then((res) => {
        const zc = res && res.cameras && res.cameras[cam.id];
        for (const z of (zc && zc.zones) || []) if (z && z.name) this._zones[cam.id][`${z.kind}:${z.id}`] = String(z.name).trim();
      })
      .catch(() => {}); // not installed: no zone names
  }

  // One screen frame while someone is there.
  _frame(a) {
    const cfg = this._config;
    const root = this._root;
    const lt = a.sub.lt;
    const now = Date.now();
    const behind = lt.behind(a.stream, { delay: cfg.live_delay, offset: cfg.live_offset });
    const all = lt.visible(lt.moment(behind), true);
    const mine = all.filter((n) => cfg.types.includes(n.t.type)); // (standing still counts too)
    const others = cfg.show_others ? all.filter((n) => !cfg.types.includes(n.t.type) && lt.moment(behind) - n.t.moved <= 5000) : [];
    if (mine.length) a.seen = now;

    // gone for good: back to standing by (a new report keeps it going)
    const linger = Math.max(1, Number(cfg.linger) || 10) * 1000;
    if (now - a.seen > linger && now - a.sub.matchAt > linger) return this._leave();

    // where the picture is inside the card (looked up now and then)
    const frame = root.querySelector(".frame");
    const W = frame.clientWidth || 0;
    const H = frame.clientHeight || 0;
    if (now - a.placeAt > 500) {
      a.placeAt = now;
      let pic = null;
      for (const el of deepFind(a.stream, ["VIDEO"])) {
        const b = pictureBox(el);
        if (b && (!pic || b.width * b.height > pic.width * pic.height)) pic = b;
      }
      if (pic) {
        const z = root.querySelector(".zoomer").getBoundingClientRect();
        const k = a.view.s || 1;
        a.place = [(pic.left - z.left) / k, (pic.top - z.top) / k, pic.width / k, pic.height / k];
        a.playing = true;
      } else a.place = [0, 0, W, H];
      const warn = root.querySelector(".chip.warn");
      const failed = !a.playing && now - a.since > FAIL_MS;
      warn.hidden = !failed;
      if (failed) warn.textContent = "The live picture didn't start";
    }
    const place = a.place || [0, 0, W, H];

    // boxes
    const layer = root.querySelector(".boxes");
    layer.style.cssText = `left:${place[0].toFixed(1)}px;top:${place[1].toFixed(1)}px;width:${place[2].toFixed(1)}px;height:${place[3].toFixed(1)}px;--k:${(1 / (a.view.s || 1)).toFixed(4)}`;
    const keep = new Set();
    for (const n of [...mine, ...others]) {
      const { t, box } = n;
      keep.add(t.id);
      let el = a.els.get(t.id);
      if (!el) {
        el = document.createElement("div");
        el.onclick = (ev) => {
          // stay on this one (again: on all of them)
          ev.stopPropagation();
          a.pick = a.pick === t.id ? null : t.id;
        };
        layer.appendChild(el);
        a.els.set(t.id, el);
      }
      const other = !cfg.types.includes(t.type);
      el.className = `box${other ? " other" : ""}${a.pick === t.id ? " picked" : ""}`;
      el.style.cssText = `left:${(box[0] / 10).toFixed(2)}%;top:${(box[1] / 10).toFixed(2)}%;width:${(box[2] / 10).toFixed(2)}%;height:${(box[3] / 10).toFixed(2)}%;--c:${LIVE_COLORS[t.type] || "#e5e7eb"}`;
    }
    for (const [id, el] of a.els) {
      if (keep.has(id)) continue;
      el.remove();
      a.els.delete(id);
    }

    // the view: on the one picked while it is there, else round all of them
    const picked = mine.find((n) => n.t.id === a.pick);
    const group = picked ? [picked] : mine;
    const v = a.view;
    let want = null;
    if (group.length) {
      const x0 = Math.min(...group.map((n) => n.box[0]));
      const y0 = Math.min(...group.map((n) => n.box[1]));
      const x1 = Math.max(...group.map((n) => n.box[0] + n.box[2]));
      const y1 = Math.max(...group.map((n) => n.box[1] + n.box[3]));
      const w = Math.max(1, x1 - x0);
      const h = Math.max(1, y1 - y0);
      const s = Math.max(1, Math.min(Number(cfg.max_zoom) || 4, 1000 / (w * 3), 1000 / (h * 2)));
      want = [s, place[0] + ((x0 + w / 2) / 1000) * place[2], place[1] + ((y0 + h / 2) / 1000) * place[3]];
      v.want = want;
    } else if (v.want && now - a.seen < HOLD_MS) want = v.want; // just lost: stay a moment
    if (!want) {
      v.want = null;
      want = [1, W / 2, H / 2];
    }
    if (v.cx == null) [v.cx, v.cy] = [W / 2, H / 2];
    const f = v.at ? 1 - Math.exp(-Math.min(250, now - v.at) / EASE_MS) : 0;
    v.at = now;
    v.s += (want[0] - v.s) * f;
    v.cx += (want[1] - v.cx) * f;
    v.cy += (want[2] - v.cy) * f;
    const s = Math.abs(v.s - 1) < 0.004 && want[0] === 1 ? 1 : v.s;
    const x = Math.min(0, Math.max(W * (1 - s), W / 2 - v.cx * s));
    const y = Math.min(0, Math.max(H * (1 - s), H / 2 - v.cy * s));
    const key = s === 1 ? "" : `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(3)})`;
    if (key !== a.viewKey) {
      a.viewKey = key;
      root.querySelector(".zoomer").style.transform = key;
    }

    // who it is on: kind, how sure, which zones
    const names = (this._zones && this._zones[a.sub.cam.id]) || {};
    const chips = group.slice(0, 3).map((n) => {
      const t = n.t;
      const zones = [...(t.zones || []).map((id) => names[`zone:${id}`]), ...(t.loiterZones || []).map((id) => names[`loiter:${id}`]), ...(t.lines || []).map((id) => names[`line:${id}`])];
      const where = [...new Set(zones.filter(Boolean))].join(", ");
      return `${LIVE_COLORS[t.type] || "#e5e7eb"}|${KINDS[t.type] ? KINDS[t.type][0] : t.type}${Number.isFinite(t.confidence) ? ` ${Math.round(t.confidence)}%` : ""}${where ? ` · ${where}` : ""}`;
    });
    const sig = chips.join("\n");
    if (sig !== a.infoKey) {
      a.infoKey = sig;
      const info = root.querySelector(".info");
      info.replaceChildren(
        ...chips.map((c) => {
          const [color, text] = [c.slice(0, c.indexOf("|")), c.slice(c.indexOf("|") + 1)];
          const el = document.createElement("span");
          el.className = "chip";
          const dot = document.createElement("i");
          dot.style.setProperty("--c", color);
          const label = document.createElement("span");
          label.textContent = text;
          el.append(dot, label);
          return el;
        })
      );
    }
  }

  // Tapped: the camera itself, in Home Assistant's own dialog (a card that
  // holds this one opens its own instead: `embedded`).
  _open() {
    const cam = (this._active && this._active.sub.cam) || (this._cams || [])[0];
    if (!cam || this._config.embedded) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: cam.tap_entity || cam.entity } }));
  }
}

// (the camera wall brings this file in too, for its tracking tiles: whichever
// comes first defines the card)
if (!customElements.get("protect-tracking-card")) customElements.define("protect-tracking-card", ProtectTrackingCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "protect-tracking-card")) window.customCards.push({
  type: "protect-tracking-card",
  name: "Protect Tracking",
  description: "Stands by until a UniFi Protect camera tracks a person, then shows it live, zoomed in on them.",
});
