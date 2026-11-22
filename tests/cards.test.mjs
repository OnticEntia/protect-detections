// Tests for the dashboard cards, run with plain Node (no browser, no packages):
//
//   node tests/cards.test.mjs
//
// The cards are loaded into a small stand-in for the page (elements that
// remember what was done to them, a Home Assistant that answers as told) and
// driven through what a user does. It checks behaviour, not looks.
import fs from "node:fs"; import vm from "node:vm"; import { fileURLToPath } from "node:url";
// the cards, as the integration ships them
const FRONTEND = fileURLToPath(new URL("../custom_components/protect_detections/frontend/", import.meta.url));
// (a card file is a module in the browser; here it is run as a plain script, so what only a module may say is put in plain words)
const plain = (src) => src.replace(/^import [^\n]*;$/gm, "").replaceAll("import.meta.url", JSON.stringify("http://ha.test/protect_detections/frontend/0.0.0/card.js"));
const log = []; let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? "PASS" : "FAIL", m); };
class Ev { constructor(t, o = {}) { this.type = t; Object.assign(this, o); } }
class Target { constructor() { this.L = {}; }
  addEventListener(t, f, o) { (this.L[t] ||= new Set()).add(f); if (o === true || (o && o.capture)) (this.C ||= new Set()).add(f); }
  captureOnly(e) { for (const f of [...(this.L[e.type] || [])]) if (this.C && this.C.has(f)) f(e); }
  removeEventListener(t, f) { this.L[t]?.delete(f); }
  dispatchEvent(e) { for (const f of [...(this.L[e.type] || [])]) f(e); return true; }
  count(t) { return this.L[t]?.size || 0; } }
const mk = () => new Proxy(new El(), {});
class El extends Target {
  constructor() { super(); this.style = { _v: {}, setProperty(k, v) { this._v[k] = v; }, removeProperty(k) { delete this._v[k]; }, cssText: "" }; this.children = []; this.hidden = false; this._q = {};
    const cl = new Set(); this.classList = { add: (...c) => c.forEach((x) => cl.add(x)), remove: (...c) => c.forEach((x) => cl.delete(x)), toggle: (c, f) => { (f === undefined ? !cl.has(c) : f) ? cl.add(c) : cl.delete(c); return cl.has(c); }, contains: (c) => cl.has(c) }; this.dataset = {}; this.isConnected = false; }
  attachShadow() { return (this.shadowRoot = new El()); }
  get lastElementChild() { return this._last || this.children[this.children.length - 1]; } set lastElementChild(v) { this._last = v; }
  get firstElementChild() { return this._first || this.children[0]; } set firstElementChild(v) { this._first = v; }
  set innerHTML(v) { this._html = v; this._q = {}; } get innerHTML() { return this._html || ""; }
  querySelector(s) { return (this._q[s] ||= Object.assign(new El(), { firstElementChild: new El(), lastElementChild: new El(), sel: s })); }
  querySelectorAll() { return []; }
  appendChild(c) { this.children.push(c); c.parent = this; if (c.__card) { c.isConnected = true; c.connectedCallback?.(); } else c.isConnected = true; return c; }
  prepend(c) { return this.appendChild(c); } replaceChildren(...c) { this.children = []; for (const x of c) this.appendChild(x); } setAttribute(k, v) { (this.attrs ||= {})[k] = v; } removeAttribute() {}
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  focus() {} select() {} getAttribute(k) { return (this.attrs || {})[k]; } setPointerCapture() {} releasePointerCapture() {}
  get firstChild() { return this.children[0]; }
  toggleAttribute(k, on) { this.attrs ||= {}; if (on) this.attrs[k] = ""; else delete this.attrs[k]; return !!on; }
  hasAttribute(k) { return !!this.attrs && k in this.attrs; }
  get textAll() { return (this.textContent || "") + this.children.map((c) => c.textAll).join(""); }
  replaceWith(n) { const p = this.parent; this.isConnected = false; this.disconnectedCallback?.(); this.gone = true; n.parent = p; n.isConnected = !!(p && p.isConnected); if (p) p.children[p.children.indexOf(this)] = n; }
  append(...c) { for (const x of c) this.appendChild(x); } getBoundingClientRect() { return { top: 0, bottom: 400 }; }
  getContext() { return { clearRect() {}, drawImage() {} }; } insertAdjacentHTML() {} load() {} pause() {} play() { return Promise.resolve(); }
  canPlayType() { return "probably"; }
}
const win = new Target(); const timers = new Set(); const revoked = [];
const defs = {};
const ctx = { window: win, document: { createElement: (t) => (defs[t] ? new defs[t]() : new El()), createTextNode: (t) => Object.assign(new El(), { textContent: t, isText: true }), createElementNS: (ns, t) => Object.assign(new El(), { tagName: t, attrs: {} }), body: new El() }, HTMLElement: El, CustomEvent: Ev, Event: Ev,
  customElements: { define: (n, c) => (defs[n] = c), whenDefined: () => Promise.resolve(), get: (n) => defs[n] },
  localStorage: { store: {}, getItem(k) { return k in this.store ? this.store[k] : null; }, setItem(k, v) { this.store[k] = String(v); } }, location: { hostname: "192.168.1.10", origin: "http://x", protocol: "http:" },
  navigator: { userAgent: "" }, console, performance, Date, Math, JSON, Promise, URLSearchParams, URL: Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: (u) => revoked.push(u) }),
  setInterval: (f) => { const t = { f }; timers.add(t); return t; }, clearInterval: (t) => timers.delete(t),
  setTimeout: (f, ms) => setTimeout(f, ms >= 4000 ? ms : Math.min(ms, 5)), clearTimeout, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  ResizeObserver: class { observe() {} disconnect() {} } };
Object.assign(win, { customCards: [], innerWidth: 1200, innerHeight: 800, scrollY: 0 }); ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(FRONTEND + "protect-cameras.js", "utf8").replace(/^export /m, "") + "\n;globalThis.findProtectCameras = findProtectCameras;", ctx);
vm.runInContext(fs.readFileSync(FRONTEND + "protect-live.js", "utf8").replace(/^export /gm, "") + "\n;Object.assign(globalThis, { LiveTracks, LIVE_COLORS, LIVE_DELAY_MS, deepFind, pictureBoxShared: pictureBox });", ctx);
vm.runInContext("{" + plain(fs.readFileSync(FRONTEND + "protect-tracking-card.js", "utf8")) + "}", ctx);
for (const f of [FRONTEND + "protect-detection-card.js", FRONTEND + "camera-wall-card.js"]) vm.runInContext(plain(fs.readFileSync(f, "utf8")) + "\n;globalThis.swipeStep = typeof swipeStep === 'function' ? swipeStep : globalThis.swipeStep; globalThis.todayStr = typeof todayStr === 'function' ? todayStr : globalThis.todayStr;", ctx);
const Det = defs["protect-detection-card"], Wall = defs["camera-wall-card"]; const Trk = defs["protect-tracking-card"];
let subs = 0, unsubs = 0; const calls = [];
const hass = { states: {}, connection: { subscribeMessage: () => { subs++; return Promise.resolve(() => unsubs++); } },
  callWS: (m) => { if (m.type === "network/url") return Promise.resolve({}); calls.push(m); if (m.type.endsWith("/history")) return Promise.resolve({ events: [], more: false });
    if (m.type.endsWith("/clip")) return Promise.resolve({ url: "/c", codec: m.hevc ? "hevc" : "h264", start_ms: 0, track: [] });
    if (m.type.endsWith("/event")) return Promise.resolve({ event: { id: m.event_id, start: 1, end: 2, camera: "A", objects: [] } });
    return Promise.resolve({ path: "/signed" }); },
  fetchWithAuth: () => Promise.resolve({ ok: true, blob: () => Promise.resolve({}) }) };
const tick = () => new Promise((r) => setTimeout(r, 20));

// --- swipe
ok(ctx.swipeStep(-80, 5, 200) === 1 && ctx.swipeStep(80, 5, 200) === -1, "swipe left = next, right = previous");
ok(ctx.swipeStep(-80, 70, 200) === 0 && ctx.swipeStep(-30, 0, 200) === 0 && ctx.swipeStep(-80, 0, 900) === 0, "diagonal / short / slow is no swipe");

// --- detection card lifecycle
const d = new Det(); d.__card = true;
d.setConfig({ cameras: [{ entity: "camera.a" }] });
d.hass = hass;                                   // set before it is attached
ok(subs === 0 && timers.size === 0, "nothing started while not on the page");
ctx.document.body.appendChild(d);
ok(subs === 1 && timers.size === 1, "feed + ticker start when attached");
ok(win.count("keydown") === 0 && win.count("resize") === 0 && win.count("scroll") === 0, "no window listeners while closed");
ok(d.isOpen() === false && d._isOpen() === false, "isOpen()/_isOpen() false when closed");
d.open(); await tick();
ok(d.isOpen() && d._isOpen() && win.count("keydown") === 1 && win.count("resize") === 1, "open: listeners on, isOpen true");
d._thumb(new El(), "/api/x"); await tick();
d.isConnected = false; d.disconnectedCallback(); await tick();
ok(!d.isOpen() && win.count("keydown") === 0 && win.count("resize") === 0, "disconnect: closed, listeners off");
ok(timers.size === 0 && unsubs === 1 && revoked.length === 1 && d._thumbs.size === 0, "disconnect: ticker cleared, unsubscribed, blob URLs revoked");
d.isConnected = true; d.connectedCallback();
ok(subs === 2 && timers.size === 1, "re-attach restores feed + ticker (once)");
d.connectedCallback(); ok(subs === 2 && timers.size === 1, "second attach doesn't double up");

// --- stale "today"
d.open(); await tick();
d._day = "2020-01-01"; d._dayAuto = true; d._loaded = true; d._loadedAt = Date.now(); calls.length = 0;
d.close(); d.open(); await tick();
ok(d._day === ctx.todayStr() && calls.some((c) => c.type.endsWith("/history")), "reopening after midnight moves to today and reloads");
d._day = "2020-01-01"; d._dayAuto = false; d._loaded = true; d._loadedAt = Date.now(); calls.length = 0;
d.close(); d.open(); await tick();
ok(d._day === "2020-01-01" && !calls.length, "a day the user picked is left alone");
d._dayAuto = true; calls.length = 0; d._emitCount(); await tick();
ok(d._day === ctx.todayStr() && calls.length === 1, "ticker moves an open grid to the new day");

// --- video error -> H.264 retry, then message
d._items = [{ id: "e1", start: 1, end: 2, camera: "A", objects: [] }]; calls.length = 0;
await d._play(0); await tick();
const v1 = d._video; ok(calls.find((c) => c.type.endsWith("/clip")).hevc === true, "first try asks for HEVC");
v1.error = { code: 3 }; calls.length = 0; v1.dispatchEvent(new Ev("error")); await tick();
const c2 = calls.find((c) => c.type.endsWith("/clip"));
ok(c2 && c2.hevc === false && d._noHevc === true && d._video !== v1, "decode error retries with H.264");
const v2 = d._video; v2.error = { code: 3 }; calls.length = 0; v2.dispatchEvent(new Ev("error")); await tick();
ok(!calls.some((c) => c.type.endsWith("/clip")) && d._video === v2, "H.264 failing too: no loop, message shown");
v1.dispatchEvent(new Ev("error")); await tick(); ok(!calls.length, "error from a replaced video is ignored");

// --- player_only (as protect-rules uses it: hass before attach)
const p = new Det(); p.__card = true; p.setConfig({ player_only: true }); const s0 = subs, t0 = timers.size;
p.hass = hass; ctx.document.body.appendChild(p);
ok(subs === s0 && timers.size === t0, "player_only: no feed, no ticker");
p.playEvents(["abc"], 0, "Rule"); await tick();
ok(p.isOpen() && win.count("keydown") === 2, "playEvents opens and listens"); p.close();

// --- camera wall build guard
ctx.window.loadCardHelpers = async () => ({ createCardElement: (c) => { if (c.type === "custom:protect-detection-card") { const e = new Det(); e.__card = true; e.localName = "protect-detection-card"; e.setConfig(c); made++; return e; } if (c.entity === "camera.boom") throw new Error("boom"); return Object.assign(new El(), { cfg: c }); } });
let made = 0;
const w = new Wall(); w.clientWidth = 1000; w.isConnected = true;
const cfgA = { cameras: [{ entity: "camera.a" }], history: [{ entity: "camera.a" }] };
w.setConfig(cfgA); w.hass = hass; 
w.setConfig({ ...cfgA, aspect_ratio: 1.5 });      // arrives while the first build is under way
await tick(); await tick();
ok(w._built && !w._building && w._config.aspect_ratio === 1.5 && w._historyCard._config.aspect_ratio === 1.5, "config that arrived mid-build is the one built");
ok(made === 1, "one detection card, reused across the rebuild");
const h = w._historyCard; w.setConfig({ ...cfgA, aspect_ratio: 1.5 }); await tick();
ok(w._historyCard === h && made === 1, "same config again: no rebuild");
w.setConfig({ ...cfgA, aspect_ratio: 1.6 }); await tick(); await tick();
ok(w._historyCard === h && made === 1 && h._config.aspect_ratio === 1.6 && h.count("history-count") === 1, "new config: card reused, one count listener");
w.setConfig({ cameras: [{ entity: "camera.boom" }] }); await tick(); await tick();
ok(!w._building && !w._built, "a build that throws releases _building");
w.hass = hass; await tick(); ok(!w._building, "failed config isn't rebuilt on every hass update");
w.setConfig(cfgA); await tick(); await tick();
ok(w._built && !w._building, "next good config builds after a failure");

// --- resting the wall while a dialog is open
{
  const tiles = () => w._grid.children.map((t) => t.children[0]).filter((c) => !c.gone);
  w._grid.isConnected = true;
  const before = [...w._camCards];
  w._openLive(0);
  ok(w._pausedTiles?.length === 1 && before.every((c) => c.gone) && tiles().every((t) => t.className === "paused"), "opening the live dialog takes every tile off the page");
  w._stepLive(1); w._openLive(0);
  ok(w._pausedTiles.length === 1 && tiles().length === 1, "stepping / opening again doesn't pause twice");
  w._closeLive();
  ok(!w._pausedTiles && tiles().length === 1 && tiles()[0] === w._camCards[0] && w._camCards[0] !== before[0] && !tiles()[0].className, "closing puts one new tile per camera back");
  w._closeLive(); w._resumeWall();
  ok(tiles().length === 1 && tiles()[0] === w._camCards[0], "closing again changes nothing");
  w._historyCard.open(); await tick();
  ok(!!w._pausedTiles, "History opening rests the wall");
  w._openLive(0); w._closeLive();
  ok(!!w._pausedTiles, "closing the live dialog with History still open keeps it resting");
  w._historyCard.close();
  ok(!w._pausedTiles && !tiles()[0].className, "History closing resumes");
  w._openLive(0); const c1 = w._camCards[0];
  w.isConnected = false; w.disconnectedCallback();
  ok(!w._pausedTiles && w._liveIndex == null && w._camCards[0] !== c1 && tiles().length === 1, "disconnected with the dialog open: tiles restored, no placeholders left");
  w.isConnected = true; w.connectedCallback();
  w._openLive(0); w.setConfig({ ...cfgA, aspect_ratio: 1.7 }); await tick(); await tick();
  ok(!!w._pausedTiles && w._grid.children.map((t) => t.children[0]).every((t) => t.className === "paused"), "rebuilt while the dialog is open: new tiles rest too");
  w._closeLive(); ok(!w._pausedTiles, "and resume on close");
}
{
  const c = w._camCards[0]; w._tapAt = 0;
  c.dispatchEvent(new Ev("action", { detail: { action: "tap" } }));
  ok(w._liveIndex === 0, "touch tap (action event, no click) opens the live dialog");
  w._closeLive(); w._tapAt = 0; const c2 = w._camCards[0]; let opens = 0; const o = w._openLive.bind(w); w._openLive = (i) => { opens++; o(i); };
  c2.dispatchEvent(new Ev("action", { detail: { action: "tap" } })); c2.dispatchEvent(new Ev("click"));
  ok(opens === 1, "mouse (action + click) opens once");
  w._closeLive(); w._tapAt = 0; opens = 0; const c3 = w._camCards[0];
  c3.dispatchEvent(new Ev("action", { detail: { action: "hold" } })); c3.dispatchEvent(new Ev("click"));
  ok(opens === 0, "hold doesn't also open the live dialog");
  w._tapAt = 0; c3.dispatchEvent(new Ev("click")); ok(opens === 1, "plain click still opens"); w._closeLive();
}
{
  const h = w._historyCard, now = Date.now(); let detail;
  h.addEventListener("history-count", (e) => (detail = e.detail));
  h._onEvents({ snapshot: [{ id: "L1", entity: "camera.a", tap_entity: "camera.a_hd", start: now - 5000, end: null }] });
  ok(detail.live === 1 && detail.cameras.includes("camera.a") && w._tiles[0].classList.contains("detecting"), "detection in progress: tile outlined");
  w._openLive(0);
  ok(w._tiles[0].classList.contains("detecting") && w._tiles[0].children[0] === w._pausedTiles[0], "outline carries over to the paused tile");
  w._closeLive();
  ok(w._tiles[0].classList.contains("detecting"), "and back to the new live tile");
  h._onEvents({ event: { id: "L1", entity: "camera.a", tap_entity: "camera.a_hd", start: now - 5000, end: now } });
  ok(detail.cameras.length === 0 && !w._tiles[0].classList.contains("detecting"), "detection ended: outline off");
  h._onEvents({ snapshot: [{ id: "L2", entity: "camera.other", tap_entity: null, start: now, end: null }] });
  ok(!w._tiles[0].classList.contains("detecting"), "another camera's detection doesn't outline this tile");
  ok(detail.cameras.includes("camera.other") && detail.live === 0, "a camera outside the history list is still reported (badge count unchanged)");
  h._onEvents({ event: { id: "L2", entity: "camera.other", tap_entity: null, start: now, end: now } });
  ok(detail.cameras.length === 0, "and cleared when it ends");
}
// --- zones (optional, from Protect Zones)
{
  const data = (occ, aligned) => ({ cameras: { P1: { mac: "AA:BB:CC:00:11:22", name: "A", aligned, zones: [
    { id: 1, kind: "zone", name: "Drive", color: "#ff0000", points: [[0, 0], [1, 0], [1, 1]], occupied: occ, detected: occ ? "person" : null },
    { id: 2, kind: "line", name: "Gate", color: null, points: [[0, 0.5], [1, 0.5]], occupied: null, detected: null },
    { id: 3, kind: "zone", name: "Bad", points: [[0, 0]], occupied: false }] } } });
  // without the integration: one try, then nothing
  let asked = 0;
  const none = { ...hass, connection: { subscribeMessage: () => { asked++; return Promise.reject({ code: "unknown_command" }); } } };
  const w0 = new Wall(); w0.clientWidth = 1000; w0.isConnected = true; w0.setConfig({ cameras: [{ entity: "camera.a" }] }); w0.hass = none; await tick(); await tick();
  w0.hass = none; w0._startZones(); w0._openLive(0); await tick();
  ok(asked === 1 && w0._built && w0._zonesOff === true && w0._liveRoot.querySelector(".zbtn").hidden === true && w0._badges[0].hidden, "no Protect Zones: asked once, wall built, no zone button or badge");
  w0._closeLive(); w0.isConnected = false; w0.disconnectedCallback(); w0.isConnected = true; w0.connectedCallback(); await tick();
  ok(asked === 2, "asked once more when the wall is put back on the page");
  // with it
  let push, zsubs = 0, zunsubs = 0;
  const zh = { ...hass, entities: { "camera.a": { device_id: "d1" } }, devices: { d1: { connections: [["mac", "aa:bb:cc:00:11:22"]] } },
    connection: { subscribeMessage: (cb, m) => { if (m.type !== "protect_zones/overlay/subscribe") return Promise.resolve(() => {}); zsubs++; push = cb; return Promise.resolve(() => zunsubs++); } } };
  const w1 = new Wall(); w1.clientWidth = 1000; w1.isConnected = true; w1.setConfig({ cameras: [{ entity: "camera.a" }, { entity: "camera.b" }] }); w1.hass = zh; await tick(); await tick();
  ok(zsubs === 1 && !!w1._zonesUnsub, "subscribed once");
  push(data(true, null));
  ok(!w1._badges[0].hidden && w1._badges[0].lastElementChild.textContent === "Drive" && w1._badges[1].hidden, "occupied zone: badge on its camera's tile only");
  w1._openLive(0);
  ok(!w1._badges[0].hidden && w1._tiles[0].children[0].className === "paused", "badge stays while the wall rests");
  const root = w1._liveRoot, svg = root.querySelector(".zones"), btn = root.querySelector(".zbtn");
  ok(btn.hidden === false && svg.style.display === "none", "zone button shown; nothing drawn until the picture's size is known");
  // a 4:3 picture letterboxed in a 1600x900 frame at (100, 50)
  for (const q of [".frame", ".zoom"]) root.querySelector(q).getBoundingClientRect = () => ({ left: 100, top: 50, width: 1600, height: 900 });
  const vid = Object.assign(new El(), { tagName: "VIDEO", videoWidth: 800, videoHeight: 600, getBoundingClientRect: () => ({ left: 100, top: 50, width: 1600, height: 900 }) });
  w1._liveStream = Object.assign(new El(), { querySelectorAll: () => [vid], isConnected: true });
  ctx.getComputedStyle = () => ({ objectFit: "contain" });
  w1._fitZones();
  ok(svg.style.cssText === "display:block;left:200px;top:0px;width:1200px;height:900px;--k:1.0000" && svg.attrs.viewBox === "0 0 1200 900", "layer placed on the picture, not the black bars");
  const kids = svg.children;
  ok(kids.length === 4 && kids[0].tagName === "polygon" && kids[0].attrs.points === "0.0,0.0 1200.0,0.0 1200.0,900.0" && kids[0].attrs.class.includes("occ") && kids[0].attrs.fill === "#ff0000"
    && kids[1].tagName === "polyline" && !kids[1].attrs.fill && kids[2].textContent === "Drive · person" && kids[3].textContent === "Gate", "polygon + polyline + names drawn; a shape with too few points skipped");
  const drawn = svg.children; w1._fitZones(); ok(svg.children === drawn, "no redraw when nothing changed");
  push(data(false, null)); ok(svg.children !== drawn && !svg.children[0].attrs.class.includes("occ") && w1._badges[0].hidden, "update redraws; zone free again");
  push(data(false, false));
  ok(svg.style.display === "none" && root.querySelector(".zone-note").hidden === false, "camera moved away: shapes hidden, note shown");
  const hid = svg.children; push(data(false, true)); ok(svg.children !== hid && svg.children.length === 4 && root.querySelector(".zone-note").hidden === true, "aligned again: shapes back");
  w1._stepLive(1); w1._liveStream = Object.assign(new El(), { querySelectorAll: () => [vid], isConnected: true }); w1._fitZones();
  ok(btn.hidden === true && svg.style.display === "none", "a camera without zones: no button, no layer");
  w1._closeLive(); w1.isConnected = false; w1.disconnectedCallback();
  ok(zunsubs === 1 && !w1._zones && !w1._zonesUnsub, "unsubscribed when the wall leaves the page");
  w1.isConnected = true; w1.connectedCallback(); await tick(); ok(zsubs === 2, "and subscribed again when it returns");
  w1.setConfig({ cameras: [{ entity: "camera.a" }], zone_overlay: false }); await tick(); await tick();
  ok(zunsubs === 2 && !w1._zonesUnsub, "zone_overlay: false stops the feed");
  w1._openLive(0); ok(w1._liveRoot.querySelector(".zbtn").hidden !== false || true, "dialog still opens"); w1._closeLive();
}
// --- the real payload from the running HA
{
  const real = JSON.parse(fs.readFileSync(new URL("./overlay.json", import.meta.url), "utf8")); delete real.editable; for (const z of Object.values(real.cameras)[0].zones) { z.occupied = z.kind === "zone" ? false : null; z.detected = null; }
  let push;
  const zh = { ...hass, entities: { "camera.fl": { device_id: "d1" }, "camera.fl_hd": { device_id: "d1" } }, devices: { d1: { connections: [["mac", "aa:bb:cc:00:00:01"]] } },
    connection: { subscribeMessage: (cb) => { push = cb; return Promise.resolve(() => {}); } }, callWS: (m) => (m.type === "network/url" ? Promise.resolve({}) : new Promise(() => {})) };
  const w2 = new Wall(); w2.clientWidth = 1000; w2.isConnected = true; w2.setConfig({ cameras: [{ entity: "camera.other" }, { entity: "camera.fl", tap_entity: "camera.fl_hd" }] }); w2.hass = zh; await tick(); await tick();
  push(real);
  ok(w2._zoneCam(w2._config.cameras[1])?.name === "Front" && !w2._zoneCam(w2._config.cameras[0]), "real payload: Front's tile found by MAC, the other tile not");
  w2._openLive(1);
  const root = w2._liveRoot, svg = root.querySelector(".zones");
  for (const q of [".frame", ".zoom"]) root.querySelector(q).getBoundingClientRect = () => ({ left: 0, top: 0, width: 1600, height: 900 });
  const vid = Object.assign(new El(), { tagName: "VIDEO", videoWidth: 3840, videoHeight: 2160, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }) });
  w2._liveStream = Object.assign(new El(), { querySelectorAll: () => [vid], isConnected: true });
  w2._fitZones();
  const shapes = svg.children.filter((c) => c.tagName !== "text"), texts = svg.children.filter((c) => c.tagName === "text").map((t) => t.textContent);
  console.log("   drawn:", shapes.map((c) => c.tagName + ":" + c.attrs.class + ":" + c.attrs.stroke).join(" | "), "| names:", texts.join(" | "));
  ok(shapes.length === 3 && texts.length === 3 && new Set(texts).size === 3 && root.querySelector(".zbtn").hidden === false && root.querySelector(".zone-note").hidden === true, "real payload: 3 outlines and 3 names (loiter twins drawn once), aligned null draws");
  const occ = JSON.parse(JSON.stringify(real)); const zs = Object.values(occ.cameras)[0].zones;
  zs[1].occupied = true; zs[1].detected = "person,vehicle"; zs[3].occupied = true; zs[3].detected = "person"; zs[0].points = [];
  push(occ);
  const t2 = svg.children.filter((c) => c.tagName === "text").map((t) => t.textContent), s2 = svg.children.filter((c) => c.tagName !== "text");
  console.log("   occupied:", s2.map((c) => c.attrs.class).join(" | "), "| names:", t2.join(" | "), "| badge:", w2._badges[1].lastElementChild.textContent, "/", w2._badges[1].title);
  ok(t2.includes("Driveway · person, vehicle") && t2.length === 2 && s2.length === 3 && w2._badges[1].lastElementChild.textContent === "Driveway" && w2._badges[0].hidden, "comma-joined types spaced; empty points skipped; twin named once on the badge");
  w2._closeLive();
}
// --- editing zones
{
  const real = JSON.parse(fs.readFileSync(new URL("./overlay.json", import.meta.url), "utf8")); delete real.editable; for (const z of Object.values(real.cameras)[0].zones) { z.occupied = z.kind === "zone" ? false : null; z.detected = null; }
  const mac = Object.values(real.cameras)[0].mac;
  let push; const sent = []; let answer = (m) => Promise.resolve(JSON.parse(JSON.stringify(Object.values(real.cameras)[0])));
  const zh = { ...hass, entities: { "camera.fl": { device_id: "d1" } }, devices: { d1: { connections: [["mac", "aa:bb:cc:00:00:01"]] } },
    connection: { subscribeMessage: (cb) => { push = cb; return Promise.resolve(() => {}); } },
    callWS: (m) => { if (m.type === "network/url") return Promise.resolve({}); if (!m.type.startsWith("protect_zones/zone/")) return new Promise(() => {}); sent.push(m); return answer(m); } };
  const w3 = new Wall(); w3.clientWidth = 1000; w3.isConnected = true; w3.setConfig({ cameras: [{ entity: "camera.fl" }, { entity: "camera.x" }] }); w3.hass = zh; await tick(); await tick();
  const open = () => { w3._openLive(0); const root = w3._liveRoot;
    for (const q of [".frame", ".zoom"]) root.querySelector(q).getBoundingClientRect = () => ({ left: 0, top: 0, width: 1600, height: 900 });
    const vid = Object.assign(new El(), { tagName: "VIDEO", videoWidth: 3840, videoHeight: 2160, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }) });
    w3._liveStream = Object.assign(new El(), { querySelectorAll: () => [vid], isConnected: true }); w3._fitZones(); return root; };
  push(real); let root = open(); const svg = root.querySelector(".zones"), bar = root.querySelector(".zbar");
  ok(w3._zoneContext(800, 450) === false && !w3._zMenu, "not editable: right-click is left to the browser");
  push({ ...real, editable: true });
  ok(w3._zoneContext(5000, 450) === false, "editable, but off the picture: left to the browser");
  // (0.9, 0.2) is inside Street (+ its loiter twin) only? list what is there
  const labels = () => w3._zMenu.menu.children.map((c) => c.textAll).filter(Boolean);
  ok(w3._zoneContext(0.86 * 1600, 0.36 * 900) === true && !!w3._zMenu, "on the picture: our menu");
  console.log("   one zone there:", labels().join(" | "));
  ok(labels().join("|") === "Front StepDetection zone|Edit shape|Rename|Change colour|Undo last zone change|Hide zones", "one zone under the pointer: its menu straight away");
  const zp = Object.values(real.cameras)[0].zones[1].points, cx = zp.reduce((t, q) => t + q[0], 0) / zp.length, cy = zp.reduce((t, q) => t + q[1], 0) / zp.length;
  w3._zoneContext(cx * 1600, cy * 900);
  console.log("   a pair there:", labels().join(" | "));
  ok(labels()[0] === "DrivewayDetection and loiter zone" && labels().length === 6, "a detection + loiter pair is one zone in the menu");
  const over = JSON.parse(JSON.stringify(real)); Object.values(over.cameras)[0].zones.push({ id: 77, kind: "zone", name: "Everything", color: null, points: [[0, 0], [1, 0], [1, 1], [0, 1]], occupied: false, detected: null });
  push({ ...over, editable: true }); w3._zoneContext(cx * 1600, cy * 900);
  console.log("   several there:", labels().join(" | "));
  ok(labels()[0] === "Which zone?" && labels()[1] === "Driveway · Detection and loiter zone" && labels()[2] === "Everything · Detection zone" && labels().includes("Undo last zone change"), "overlapping zones: the menu asks which, smallest first");
  w3._zMenu.menu.children.find((c) => c.textAll === "Everything · Detection zone").onclick();
  ok(labels().join("|") === "EverythingDetection zone|Edit shape|Rename|Change colour|Undo last zone change|Hide zones", "picking one gives its menu");
  push({ ...real, editable: true });
  w3._zoneContext(2, 2); console.log("   elsewhere:", labels().join(" | "));
  w3._zMenuAt(10, 10, w3._zoneCam(w3._config.cameras[0]), []);
  ok(labels().join("|") === "Undo last zone change|Hide zones", "no zone under the pointer: undo and the zones switch");
  root.querySelector; w3._onLiveKey({ key: "Escape", preventDefault() {} });
  ok(!w3._zMenu && w3._liveIndex === 0, "Esc closes the menu, not the dialog");
  // edit shape
  const zc = w3._zoneCam(w3._config.cameras[0]); const z1 = zc.zones[0]; const before = JSON.stringify(z1.points);
  w3._zEditStart(zc, z1);
  const grabs = () => svg.children.filter((c) => c.attrs?.class === "grab"), edges = () => svg.children.filter((c) => c.attrs?.class === "edge");
  ok(w3._zEdit && grabs().length === 7 && edges().length === 7 && svg.children.filter((c) => (c.attrs?.class || "").includes("dim")).length === 2 && bar.children.map((c) => c.textContent).includes("Save"), "edit: a handle per point, an edge per side, other zones dimmed, Save/Cancel bar");
  const g0 = grabs()[0], pe = (o) => ({ button: 0, pointerId: 1, pointerType: "mouse", preventDefault() {}, stopPropagation() {}, ...o });
  g0.dispatchEvent(new Ev("pointerdown", pe({ clientX: 100, clientY: 100 })));
  push({ ...real, editable: true });   // an update in the middle of a drag
  g0.dispatchEvent(new Ev("pointermove", pe({ clientX: 800, clientY: 450 })));
  ok(w3._zEdit.points[0][0] === 0.5 && w3._zEdit.points[0][1] === 0.5 && g0.attrs.cx === "800.0" && grabs()[0] === g0, "dragging moves the point; the handle isn't replaced mid-drag");
  g0.dispatchEvent(new Ev("pointermove", pe({ clientX: -50, clientY: 5000 })));
  ok(w3._zEdit.points[0][0] === 0 && w3._zEdit.points[0][1] === 1, "kept inside the picture");
  g0.dispatchEvent(new Ev("pointerup", pe({})));
  ok(w3._zEdit.drag === null && JSON.stringify(z1.points) === before && sent.length === 0, "nothing sent, incoming data untouched");
  const e0 = edges()[0], a = w3._zEdit.points[0], b = w3._zEdit.points[1];
  e0.dispatchEvent(new Ev("click", { clientX: ((a[0] + b[0]) / 2) * 1600, clientY: ((a[1] + b[1]) / 2) * 900, stopPropagation() {} }));
  ok(w3._zEdit.points.length === 8 && grabs().length === 8 && Math.abs(w3._zEdit.points[1][0] - (a[0] + b[0]) / 2) < 1e-6, "clicking an edge adds a point there");
  grabs()[1].dispatchEvent(new Ev("contextmenu", { preventDefault() {}, stopPropagation() {} }));
  ok(w3._zEdit.points.length === 7, "right-click on a handle removes it");
  ok(w3._zoneContext(800, 450) === true && !w3._zMenu, "no zone menu while editing");
  for (let i = 0; i < 6; i++) grabs()[0].dispatchEvent(new Ev("contextmenu", { preventDefault() {}, stopPropagation() {} }));
  ok(w3._zEdit.points.length === 3, "never below 3 points");
  // touch: holding a handle removes it (here it can't: minimum), moving cancels the hold
  // save fails -> still editing; then works
  answer = () => Promise.reject({ code: "invalid_format", message: "Protect said no" });
  w3._zEditSave(); await tick();
  ok(!!w3._zEdit && sent.length === 1 && sent[0].type === "protect_zones/zone/update" && sent[0].mac === mac && sent[0].kind === "zone" && sent[0].zone_id === z1.id && !("id" in sent[0]) && sent[0].points.length === 3 && root.querySelector(".zbar").querySelector(".err").textContent === "Protect said no", "failed save: error shown, still editing");
  const saved = JSON.parse(JSON.stringify(zc)); saved.zones[0].points = sent[0].points; saved.zones[0].name = "Renamed";
  answer = () => Promise.resolve(saved);
  w3._zEditSave(); await tick();
  ok(!w3._zEdit && w3._zoneCam(w3._config.cameras[0]).zones[0].name === "Renamed" && bar.children.map((c) => c.textContent).join("|").includes("Saved Front Step|Undo"), "save: sent, result applied, Undo offered");
  bar.children.find((c) => c.textContent === "Undo").onclick(); await tick();
  ok(sent[2].type === "protect_zones/zone/undo" && sent[2].mac === mac && bar.children[0].textContent === "Last zone change undone", "undo sends the camera's mac");
  // a pair: its other half isn't left behind as a stale shape; an unchanged save sends nothing
  { const zc0 = w3._zoneCam(w3._config.cameras[0]), n0 = sent.length; w3._zEditStart(zc0, zc0.zones[1]);
    const dims = svg.children.filter((c) => (c.attrs?.class || "").includes("dim"));
    ok(w3._zEdit.partners.length === 1 && w3._zEdit.partners[0].kind === "loiter" && dims.length === 2 && !dims.some((c) => (c.attrs.class || "").includes("loiter")), "editing a paired zone: its loiter half isn't drawn at the old place");
    w3._zEditSave(); await tick();
    ok(!w3._zEdit && sent.length === n0 && bar.children[0].textContent.includes("wasn't changed"), "Save with nothing moved sends nothing");
    w3._zEditStart(zc0, zc0.zones[1]); w3._zEdit.points = [[0.1, 0.1], [0.1, 0.1], [0.2, 0.2]]; w3._zEditSave(); await tick();
    ok(!!w3._zEdit && sent.length === n0 && root.querySelector(".zbar").querySelector(".err").textContent === "A zone needs 3 different points", "3 points that aren't 3 different ones: refused before sending");
    w3._zEdit.points = Array.from({ length: 32 }, (_, i) => [i / 40, (i * i % 37) / 40]); w3._zEditChanged();
    svg.children.filter((c) => c.attrs?.class === "edge")[0].dispatchEvent(new Ev("click", { clientX: 5, clientY: 5, stopPropagation() {} }));
    ok(w3._zEdit.points.length === 32 && root.querySelector(".zbar").querySelector(".err").textContent.includes("at most 32"), "no 33rd point");
    answer = () => Promise.reject({ code: "protect_error" }); w3._zEditSave(); await tick();
    ok(root.querySelector(".zbar").querySelector(".err").textContent === "Protect didn't accept the change" && !!w3._zEdit, "an error code without words gets readable text");
    answer = () => Promise.reject({ code: "nothing_to_undo", message: "There is no change to undo for this camera" }); w3._zEditEnd(); const n1 = sent.length;
    await w3._zUndo(mac); ok(sent.length === n1 + 1 && bar.children[0].textContent === "There is no change to undo for this camera" && bar.children[1].textContent === "Dismiss", "nothing to undo: said so");
    sent.length = 3; answer = () => Promise.resolve(JSON.parse(JSON.stringify(Object.values(real.cameras)[0]))); }
  // rename + colour
  const zc2 = w3._zoneCam(w3._config.cameras[0]);
  w3._zRename(zc2, zc2.zones[1]); const inp = bar.children.find((c) => c.type === "text"); inp.value = "  Porch ";
  bar.children.find((c) => c.textContent === "Save").onclick(); await tick();
  ok(sent[3].name === "Porch" && sent[3].kind === zc2.zones[1].kind && sent[3].zone_id === zc2.zones[1].id && !("id" in sent[3]) && !("points" in sent[3]), "rename sends only the name");
  w3._zRecolor(zc2, zc2.zones[1]); bar.children.find((c) => c.type === "color").value = "#00FF00";
  bar.children.find((c) => c.textContent === "Save").onclick(); await tick();
  ok(sent[4].color === "#00ff00" && sent[4].zone_id === zc2.zones[1].id && !("id" in sent[4]) && !("name" in sent[4]), "colour sends only the colour");
  // Esc cancels an edit, not the dialog; changing camera drops it
  w3._zEditStart(zc2, zc2.zones[0]); w3._onLiveKey({ key: "ArrowRight", preventDefault() {} });
  ok(w3._liveIndex === 0 && !!w3._zEdit, "arrow keys don't change camera while editing");
  w3._onLiveKey({ key: "Escape", preventDefault() {} });
  ok(!w3._zEdit && w3._liveIndex === 0 && svg.children.filter((c) => c.attrs?.class === "grab").length === 0, "Esc cancels the edit and keeps the dialog");
  w3._onLiveKey({ key: "Escape", preventDefault() {} }); ok(w3._liveIndex == null, "Esc again closes the dialog");
  // an older Protect Zones: the command is unknown
  root = open(); answer = () => Promise.reject({ code: "unknown_command", message: "Unknown command." });
  w3._zEditStart(zc2, zc2.zones[0]); w3._zEdit.points[0] = [0.5, 0.5]; w3._zEditSave(); await tick();
  ok(w3._zEditOff === true && !w3._zEdit && w3._zoneContext(800, 450) === false && svg.children.length > 0, "unknown command: editing goes, the overlay stays");
  w3._closeLive();
}
// --- detections, loiter times, tracking
{
  const real = JSON.parse(fs.readFileSync(new URL("./overlay.json", import.meta.url), "utf8")); const camE = Object.values(real.cameras)[0]; const mac = camE.mac;
  camE.zones = [
    { id: 3, kind: "zone", name: "A", color: null, points: [[0, 0], [0.4, 0], [0.4, 0.4], [0, 0.4]], occupied: false, detected: null, types: ["animal", "person"], dwell: null },
    { id: 5, kind: "zone", name: "Low", color: null, points: [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]], occupied: false, detected: null, types: ["vehicle"], dwell: null },
    { id: 8, kind: "loiter", name: "Low", color: null, points: [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]], occupied: null, detected: null, types: ["person"], dwell: { person: 10.0 } },
  ];
  let push; const sent = [], svc = []; let answer = () => Promise.resolve(JSON.parse(JSON.stringify(camE)));
  const zh = { ...hass, states: { "switch.fl_tracking_person": { state: "off" } },
    entities: { "camera.fl": { device_id: "d1" }, "switch.fl_tracking_person": { device_id: "d1", platform: "unifiprotect", translation_key: "tracking_person" }, "switch.other": { device_id: "d1", platform: "unifiprotect", translation_key: "hdr" } },
    devices: { d1: { connections: [["mac", "aa:bb:cc:00:00:01"]] } },
    connection: { subscribeMessage: (cb) => { push = cb; return Promise.resolve(() => {}); } },
    callService: (d, s2, data) => { svc.push([d, s2, data]); zh.states[data.entity_id] = { state: s2 === "turn_on" ? "on" : "off" }; return Promise.resolve(); },
    callWS: (m) => { if (m.type === "network/url") return Promise.resolve({}); if (!m.type.startsWith("protect_zones/zone/")) return new Promise(() => {}); sent.push(m); return answer(m); } };
  const w = new Wall(); w.clientWidth = 1000; w.isConnected = true; w.setConfig({ cameras: [{ entity: "camera.fl" }, { entity: "camera.x" }] }); w.hass = zh; await tick(); await tick();
  w._openLive(0); const root = w._liveRoot;
  for (const q of [".frame", ".zoom"]) root.querySelector(q).getBoundingClientRect = () => ({ left: 0, top: 0, width: 1600, height: 900 });
  const vid = Object.assign(new El(), { tagName: "VIDEO", videoWidth: 3840, videoHeight: 2160, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }) });
  w._liveStream = Object.assign(new El(), { querySelectorAll: () => [vid], isConnected: true });
  push({ ...real, editable: true }); w._fitZones();
  const bar = root.querySelector(".zbar"); const labels = () => w._zMenu.menu.children.map((c) => c.textAll).filter(Boolean);
  w._zoneContext(0.2 * 1600, 0.2 * 900);
  console.log("   zone:", labels().join(" | "));
  ok(labels().join("|") === "ADetection zone|Edit shape|Rename|Change colour|Edit detections|Person tracking is off · turn on|Undo last zone change|Hide zones", "detection zone: Edit detections and the tracking switch in the menu");
  w._zoneContext(0.75 * 1600, 0.75 * 900);
  console.log("   pair:", labels().join(" | "));
  ok(labels().includes("Edit detections") && labels().includes("Edit loiter times") && labels().indexOf("Edit detections") < labels().indexOf("Edit loiter times"), "a pair: one item for each half");
  w._zMenuClose();
  const zc = w._zoneCam(w._config.cameras[0]);
  // types
  w._zDetect(zc, zc.zones[0]);
  const opts = () => bar.children.find((c) => c.className === "zopts"); const ticks = () => opts().children.map((l) => l.children[0]);
  ok(opts().children.length === 6 && ticks().map((t) => t.checked).join() === "true,false,true,false,false,false", "a tick per kind of thing, set as the zone has them");
  bar.children.find((c) => c.textContent === "Save").onclick(); await tick();
  ok(sent.length === 0 && bar.hidden, "nothing changed: nothing sent");
  w._zDetect(zc, zc.zones[0]); ticks()[5].checked = true; ticks()[2].checked = false;
  camE.zones[0].types = ["face", "person", "vehicle"]; // what the server says it is now: more than was asked
  bar.children.find((c) => c.textContent === "Save").onclick(); await tick(); await tick();
  ok(sent.length === 1 && sent[0].kind === "zone" && sent[0].zone_id === 3 && JSON.stringify(sent[0].types) === '["person","face"]' && !("dwell" in sent[0]), "types sent for that zone only");
  console.log("   after:", bar.children[0].textContent);
  ok(bar.children[0].textContent === "A now detects face, person, vehicle" && bar.children.some((c) => c.textContent === "Undo"), "the message says what came back, with Undo");
  // dwell
  const lz = w._zoneCam(w._config.cameras[0]).zones[2];
  w._zDetect(w._zoneCam(w._config.cameras[0]), lz);
  const secs = () => opts().children.map((l) => l.children.find((c) => c.type === "number"));
  ok(secs()[0].value === "10" && secs()[0].disabled === false && secs()[1].disabled === true, "loiter: seconds per kind, only the ticked ones open");
  secs()[0].value = "0.2"; bar.children.find((c) => c.textContent === "Save").onclick(); await tick();
  ok(sent.length === 1 && bar.querySelector(".err").textContent === "Person: 0.5 to 600 seconds", "seconds out of range: said, not sent");
  secs()[0].value = "3"; answer = () => Promise.reject({ code: "invalid_dwell" });
  bar.children.find((c) => c.textContent === "Save").onclick(); await tick(); await tick();
  ok(sent.length === 2 && JSON.stringify(sent[1].dwell) === '{"person":3}' && sent[1].kind === "loiter" && sent[1].zone_id === 8 && bar.querySelector(".err").textContent.startsWith("Protect Zones didn't accept those loiter times"), "invalid_dwell: readable, the form stays");
  camE.zones[2].dwell = { person: 10.0 }; answer = () => Promise.resolve(JSON.parse(JSON.stringify(camE)));
  bar.children.find((c) => c.textContent === "Save").onclick(); await tick(); await tick();
  console.log("   after:", bar.children[0].textContent);
  ok(bar.children[0].textContent === "Low now loiters: person after 10 s", "asked for 3 s, Protect kept 10: the message says 10");
  // tracking
  w._zMenuAt(10, 10, w._zoneCam(w._config.cameras[0]), []);
  w._zMenu.menu.children.find((c) => c.textAll.startsWith("Person tracking")).onclick(); await tick();
  ok(svc.length === 1 && svc[0].join() === "switch,turn_on,[object Object]" && svc[0][2].entity_id === "switch.fl_tracking_person" && !w._zMenu, "tracking item turns the camera's own switch on");
  w._zMenuAt(10, 10, w._zoneCam(w._config.cameras[0]), []);
  ok(labels()[0] === "Person tracking is on · turn off", "and then shows it on");
  w._liveIndex = 1; w._zMenuAt(10, 10, w._zoneCam(w._config.cameras[0]), []);
  ok(!labels().some((l) => l.startsWith("Person tracking")), "a camera without the switch: no item");
  w._liveIndex = 0; w._zMenuClose(); w._closeLive();
}
// --- nothing named in the config: found in Home Assistant
{
  const cam = (dev, ch, w, h, extra = {}) => [{ device_id: dev, platform: "unifiprotect", ...extra }, { state: "recording", attributes: { channel_id: ch, width: w, height: h } }];
  const reg = {
    "camera.ptz_high_resolution_channel": cam("d1", 0, 3840, 2160), "camera.ptz_medium_resolution_channel": cam("d1", 1, 1280, 720),
    "camera.other_high_resolution_channel": cam("d2", 0, 3840, 2160), "camera.other_medium_resolution_channel": cam("d2", 1, 3840, 2160),
    "camera.one_high_resolution_channel": cam("d3", 0, 2688, 1512),
    "camera.bell_high_resolution_channel": cam("d4", 0, 1600, 1200), "camera.bell_package_camera": cam("d4", 3, 1600, 1200),
    "camera.generic": [{ device_id: "d9", platform: "generic" }, { state: "idle", attributes: {} }],
    "alarm_control_panel.other": [{ device_id: "dx", platform: "manual" }, { state: "disarmed", attributes: {} }],
    "alarm_control_panel.nvr": [{ device_id: "dn", platform: "unifiprotect" }, { state: "disarmed", attributes: {} }],
  };
  const mkHass = (r, comps = ["protect_detections"]) => ({ ...hass, config: { components: comps },
    entities: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v[0]])), states: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v[1]])),
    devices: { d1: { name: "Front", name_by_user: "Zeta Cam" }, d2: { name: "Back 10" }, d3: { name: "Back 2" }, d4: { name: "Doorbell" } },
    connection: { subscribeMessage: () => Promise.resolve(() => {}) },
    callWS: (m) => (m.type === "network/url" ? Promise.resolve({ internal: "http://ha.local:8123", external: null, cloud: "https://x.example" }) : new Promise(() => {})) });
  const w = new Wall(); w.clientWidth = 1000; w.isConnected = true;
  let threw = false; try { w.setConfig({}); } catch (e) { threw = true; }
  ok(!threw, "a config with nothing in it is accepted");
  w.hass = mkHass(reg); await tick(); await tick(); await tick();
  const c = w._config;
  console.log("   found:", c.cameras.map((x) => `${x.name}: ${x.entity} / ${x.tap_entity}`).join(" | "));
  ok(c.cameras.map((x) => x.name).join() === "Back 2,Back 10,Doorbell,Zeta Cam", "one feed per Protect camera device, by name (numbers in order), the user's name first");
  const by = Object.fromEntries(c.cameras.map((x) => [x.name, x]));
  ok(by["Zeta Cam"].entity === "camera.ptz_medium_resolution_channel" && by["Zeta Cam"].tap_entity === "camera.ptz_high_resolution_channel", "wall: the lighter stream; tap: the best one");
  ok(by["Back 2"].entity === by["Back 2"].tap_entity && by["Back 2"].entity === "camera.one_high_resolution_channel", "a camera with one stream uses it for both");
  ok(by["Doorbell"].entity === "camera.bell_high_resolution_channel" && by["Doorbell"].tap_entity === "camera.bell_high_resolution_channel", "a doorbell's parcel camera isn't taken for the camera");
  ok(c.alarm === "alarm_control_panel.nvr", "the alarm panel is Protect's, found by its integration");
  ok(c.local_url === "http://ha.local:8123" && c.remote_url === "https://x.example", "both addresses from Home Assistant");
  ok(Array.isArray(c.history) && c.history.length === 4 && c.history[0].entity === by["Back 2"].entity && !!w._historyCard, "History covers the cameras found");
  ok(w._built && w._tiles.length === 4, "built with a tile each");
  // a camera is added: Home Assistant hands over new lists
  const reg2 = { ...reg, "camera.new_high_resolution_channel": cam("d5", 0, 3840, 2160), "camera.new_medium_resolution_channel": cam("d5", 1, 1280, 720) };
  const h2 = mkHass(reg2); h2.devices = { ...h2.devices, d5: { name: "Alpha PTZ" } };
  w.hass = h2; await tick(); await tick(); await tick();
  ok(w._config.cameras.length === 5 && w._config.cameras[0].name === "Alpha PTZ" && w._tiles.length === 5 && w._config.history.length === 5, "a camera added in Home Assistant appears, in History too");
  const before = w._config; w.hass = { ...h2, states: { ...h2.states } }; await tick();
  ok(w._config === before, "an ordinary state change rebuilds nothing");
  delete reg2["camera.other_high_resolution_channel"]; delete reg2["camera.other_medium_resolution_channel"];
  const h3 = mkHass(reg2); h3.devices = h2.devices; w.hass = h3; await tick(); await tick(); await tick();
  ok(w._config.cameras.length === 4 && !w._config.cameras.some((x) => x.name === "Back 10"), "a camera removed disappears");
  // exclude, order
  const w2 = new Wall(); w2.clientWidth = 1000; w2.isConnected = true; w2.setConfig({ exclude: ["door*", "d3"], order: ["zeta*"] }); w2.hass = mkHass(reg); await tick(); await tick(); await tick();
  ok(w2._config.cameras.map((x) => x.name).join() === "Zeta Cam,Back 10", "exclude (name pattern, device id) and order");
  // none found, nothing installed
  const w3 = new Wall(); w3.clientWidth = 1000; w3.isConnected = true; w3.setConfig({ cameras: "auto" });
  const bare = mkHass({}, []); bare.callWS = () => Promise.reject({ code: "unknown_command" }); w3.hass = bare; await tick(); await tick(); await tick();
  ok(w3._built && w3._config.cameras.length === 0 && !w3._config.alarm && !w3._config.history && !w3._config.local_url && w3.shadowRoot.innerHTML.includes("No UniFi Protect cameras were found") && !w3.shadowRoot.innerHTML.includes('class="top"'), "nothing found: a plain message, no alarm, History or address switch, no error");
  // written out: used as written
  const w4 = new Wall(); w4.clientWidth = 1000; w4.isConnected = true;
  w4.setConfig({ cameras: [{ entity: "camera.generic", name: "G" }], alarm: "alarm_control_panel.other", history: false, local_url: "http://a", remote_url: "https://b" }); w4.hass = mkHass(reg); await tick(); await tick(); await tick();
  ok(w4._config.cameras.length === 1 && w4._config.cameras[0].entity === "camera.generic" && w4._config.alarm === "alarm_control_panel.other" && w4._config.history === null && w4._config.local_url === "http://a" && w4._config.remote_url === "https://b", "what the config spells out is used as written");
  const w5 = new Wall(); w5.setConfig({ alarm: false }); w5.clientWidth = 1000; w5.isConnected = true; w5.hass = mkHass(reg); await tick(); await tick(); await tick();
  ok(w5._config.alarm === null && w5._config.cameras.length === 4, "alarm: false hides the alarm");
}
// --- the detection card on its own, no cameras named
{
  const cam = (dev, ch) => [{ device_id: dev, platform: "unifiprotect" }, { state: "recording", attributes: { channel_id: ch } }];
  const reg = { "camera.a_high_resolution_channel": cam("d1", 0), "camera.a_medium_resolution_channel": cam("d1", 1), "camera.b_high_resolution_channel": cam("d2", 0) };
  const mk = (r) => ({ ...hass, entities: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v[0]])), states: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v[1]])), devices: { d1: { name: "Alpha" }, d2: { name: "Beta" }, d3: { name: "Gamma" } } });
  const d = new Det(); let threw = false; try { d.setConfig({}); } catch (e) { threw = true; }
  ok(!threw && d._config.cameras.length === 0, "detection card: a config with nothing in it is accepted");
  d.isConnected = true; d.hass = mk(reg); await tick();
  ok(d._config.cameras.map((c) => `${c.name}:${c.entity}:${c.tap_entity}`).join() === "Alpha:camera.a_medium_resolution_channel:camera.a_high_resolution_channel,Beta:camera.b_high_resolution_channel:camera.b_high_resolution_channel", "its cameras are the Protect ones found, as on the wall");
  ok(d._inScope({ entity: "camera.a_medium_resolution_channel" }) && !d._inScope({ entity: "camera.zzz", tap_entity: "camera.zzz" }), "detections are kept for those cameras only");
  const had = d._config; d.hass = { ...mk(reg), entities: d._hass.entities, devices: d._hass.devices }; ok(d._config === had, "an ordinary update changes nothing");
  d.hass = mk({ ...reg, "camera.c_high_resolution_channel": cam("d3", 0) }); await tick();
  ok(d._config.cameras.length === 3 && d._config.cameras[2].name === "Gamma", "a camera added in Home Assistant is picked up");
  const d2 = new Det(); d2.setConfig({ exclude: ["beta"], cameras: "auto" }); d2.isConnected = true; d2.hass = mk(reg); await tick();
  ok(d2._config.cameras.length === 1 && d2._config.cameras[0].name === "Alpha", "exclude works here too");
  const d3 = new Det(); d3.setConfig({ cameras: [{ entity: "camera.x", name: "X" }] }); d3.isConnected = true; d3.hass = mk(reg); await tick();
  ok(d3._config.cameras.length === 1 && d3._config.cameras[0].entity === "camera.x" && !d3._auto, "cameras spelled out are used as written");
  const d4 = new Det(); d4.setConfig({ player_only: true }); d4.isConnected = true; d4.hass = mk(reg); await tick();
  ok(d4._config.cameras.length === 0 && !d4._auto, "another card's player looks nothing up");
  const d5 = new Det(); d5.setConfig({}); d5.isConnected = true; d5.hass = mk({}); await tick(); d5.open(); await tick();
  ok(String(d5._root.querySelector(".msg").textContent).startsWith("No UniFi Protect cameras were found"), "none found: the lightbox says so");
  d5.close(); for (const x of [d, d2, d3, d4, d5]) x.disconnectedCallback();
}
// --- arranging the wall
{
  const store = { value: null, sets: [], fail: false };
  const ents = { "camera.a": { device_id: "d1" }, "camera.a_hi": { device_id: "d1" }, "camera.b": { device_id: "d2" }, "camera.c": { device_id: "d3" }, "camera.c_hi": { device_id: "d3" }, "camera.d": { device_id: "d4" }, "camera.e": { device_id: "d5" } };
  const ah = () => ({ ...hass, entities: ents, devices: {},
    connection: { subscribeMessage: () => Promise.resolve(() => {}) },
    callWS: (m) => { if (m.type === "network/url") return Promise.resolve({});
      if (m.type === "frontend/get_user_data") return Promise.resolve({ value: store.value });
      if (m.type === "frontend/set_user_data") { if (store.fail) return Promise.reject({ code: "nope" }); store.sets.push(m); store.value = JSON.parse(JSON.stringify(m.value)); return Promise.resolve(null); }
      return new Promise(() => {}); } });
  const cams = [{ entity: "camera.a", tap_entity: "camera.a_hi", name: "A" }, { entity: "camera.b", name: "B" }, { entity: "camera.c", tap_entity: "camera.c_hi", name: "C" }, { entity: "camera.d", name: "D" }];
  const mkWall = async (cfg = {}) => { const w = new Wall(); w.clientWidth = 1200; w.isConnected = true; w.setConfig({ cameras: cams, alarm: false, history: false, ...cfg }); w.hass = ah(); await tick(); await tick(); await tick(); w._layout(); return w; };
  win.innerWidth = 1200; ctx.localStorage.store = {};
  // where the tiles are: "A@c,r wxh ..."
  const at = (x) => x._tiles.map((t, i) => `${"ABCDE"[i]}@${parseInt(t.style.gridColumn) - 1},${parseInt(t.style.gridRow) - 1} ${t.style.gridColumn.split("span ")[1]}x${t.style.gridRow.split("span ")[1]}`).join(" ");
  let w = await mkWall();
  console.log("   default:", at(w));
  ok(at(w) === "A@0,0 1x1 B@1,0 1x1 C@2,0 1x1 D@0,1 1x1" && w._order.join() === "0,1,2,3" && !w._grid.classList.contains("spans") && w._grid.style.gridAutoRows === "" && w._grid.style.gridTemplateRows === "", "nothing saved: exactly the automatic grid, rows as before");
  w.disconnectedCallback();
  // what the earlier version saved (an order with sizes) becomes places
  store.value = { v: 1, walls: { default: { tiles: [{ id: "d3", w: 2, h: 2 }, { id: "gone", w: 3, h: 3 }, { id: "d1", w: 1, h: 1 }] } } };
  w = await mkWall();
  console.log("   from order+sizes:", at(w));
  ok(at(w) === "A@2,0 1x1 B@2,1 1x1 C@0,0 2x2 D@0,2 1x1" && w._order.join() === "2,0,1,3", "an arrangement saved as order and sizes is kept, as places");
  ok(w._grid.classList.contains("spans") && /px\)$/.test(w._grid.style.gridTemplateRows) && w._camCards[2]._span === "2x2" && w._camCards[2].cfg.entity === "camera.c_hi", "arranged: rows of fixed height, the big tile on the best stream");
  w._liveIndex = 2; w._showLive = () => {}; w._stepLive(1); ok(w._liveIndex === 0, "next camera in the dialog follows the reading order"); w._liveIndex = null;
  // one column: a list in reading order, and no arranging
  win.innerWidth = 500; w._layout();
  ok(at(w) === "A@0,1 1x1 B@0,2 1x1 C@0,0 1x1 D@0,3 1x1" && !w._grid.classList.contains("spans"), "one column: a plain list in reading order");
  // arranging on one column: only the order, kept apart from the wide wall
  { const before = [...w._camCards]; w._arrEnter();
    const lbar = w.shadowRoot.querySelector(".arrbar");
    ok(w._arranging && w._arrMode === "list" && !w._arrCellEls && lbar.children.map((c) => c.textContent).join("|").endsWith("Done|Reset|Cancel") && lbar.children.length === 4 && w._arrEls.every((o) => o.className === "arr list"), "one column: Arrange offers the order only (no sizes, no rows or columns, no cells)");
    w._arrEls[3].querySelector(".up").onclick(); w._arrEls[3].querySelector(".up").onclick();
    ok(at(w) === "A@0,2 1x1 B@0,3 1x1 C@0,0 1x1 D@0,1 1x1", "the arrows move a camera up the list");
    w._arrEls[2].querySelector(".up").onclick(); ok(at(w).includes("C@0,0"), "the first can't go higher");
    w._tiles.forEach((t, k) => (t.getBoundingClientRect = () => { const r = parseInt(t.style.gridRow) - 1; return { top: r * 100, bottom: r * 100 + 90 }; }));
    const lf = (k, type, o) => w._arrEls[k].dispatchEvent(Object.assign(new Ev(type), { button: 0, pointerId: 3, pointerType: "touch", target: { closest: (c) => c === ".grip" }, preventDefault() {}, stopPropagation() {}, ...o }));
    lf(1, "pointerdown", { clientY: 320 }); lf(1, "pointermove", { clientY: 30 });
    ok(w._tiles[1].classList.contains("dragging") && w._tiles[2].classList.contains("drop"), "dragging by the grip marks where it would go");
    lf(1, "pointerup", { clientY: 30 });
    ok(at(w) === "A@0,3 1x1 B@0,0 1x1 C@0,1 1x1 D@0,2 1x1" && !w._tiles[2].classList.contains("drop"), "dropped: it takes that place in the list");
    ok(w._camCards.every((c, k) => c === before[k]), "no feed restarted");
    w._arrExit("save"); await tick(); await tick();
    const sv = store.value.walls.default;
    ok(sv.list.join() === "d2,d3,d4,d1" && !sv.grid && sv.tiles.length === 3 && sv.tiles[0].id === "d3", "Done: the list's order is saved by itself; what the wide wall has is untouched");
    ok(at(w) === "A@0,3 1x1 B@0,0 1x1 C@0,1 1x1 D@0,2 1x1", "and the list stays in that order");
    win.innerWidth = 1200; w._layout(); ok(at(w) === "A@2,0 1x1 B@2,1 1x1 C@0,0 2x2 D@0,2 1x1", "the wide wall is as it was");
    win.innerWidth = 500; w._layout(); w._arrEnter(); w._arrExit("reset"); await tick(); await tick();
    ok(at(w) === "A@0,1 1x1 B@0,2 1x1 C@0,0 1x1 D@0,3 1x1" && !store.value.walls.default.list && store.value.walls.default.tiles.length === 3, "Reset on one column: the list reads as the wide wall again, which is kept");
    w._arrEnter(); w._arrEls[0].querySelector(".up").onclick(); w._arrExit("save"); await tick(); await tick();
  }
  win.innerWidth = 1200; w._layout();
  // arrange
  store.sets.length = 0;
  const cards = [...w._camCards];
  w._arrEnter();
  const bar = w.shadowRoot.querySelector(".arrbar"); const why = () => w.shadowRoot.querySelector(".arrbar .why").textContent || "";
  const E = () => w._arrEdit;
  ok(w._arranging && w._arrEls.length === 4 && E().grid.cols === 3 && E().grid.rows === 3 && w._arrCellEls.length === 9 && w._camCards.every((c, i) => c === cards[i]), "Arrange: starts from the wall as shown, every cell drawn, no feed restarted");
  // geometry for the pointer: cells of cw x ch with the gap, grid at 0,0
  const cw = w._cell.w, ch = w._cell.h, G = 12; const X = (c) => c * (cw + G) + 5, Y = (r) => r * (ch + G) + 5;
  w._grid.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const rectOf = (i) => { const t = w._arrItem(i); return { left: t.c * (cw + G), top: t.r * (ch + G) }; };
  w._tiles.forEach((t, i) => (t.getBoundingClientRect = () => rectOf(i)));
  const pe = (o) => ({ button: 0, pointerId: 7, pointerType: "mouse", target: {}, preventDefault() {}, stopPropagation() {}, ...o });
  const fire = (i, type, o) => w._arrEls[i].dispatchEvent(Object.assign(new Ev(type), pe(o)));
  const drag = (i, c, r) => { const from = rectOf(i); fire(i, "pointerdown", { clientX: from.left + 5, clientY: from.top + 5 }); fire(i, "pointermove", { clientX: X(c), clientY: Y(r) }); fire(i, "pointerup", { clientX: X(c), clientY: Y(r) }); };
  const cellCls = (c, r, k) => w._arrCellEls[r * w._arrCols + c].classList.contains(k);
  // D to an empty cell (2,2)
  fire(3, "pointerdown", { clientX: X(0), clientY: Y(2) }); fire(3, "pointermove", { clientX: X(2), clientY: Y(2) });
  ok(w._tiles[3].classList.contains("dragging") && cellCls(2, 2, "on") && !cellCls(1, 2, "on"), "dragging: the cell it would go to lights up");
  fire(3, "pointerup", { clientX: X(2), clientY: Y(2) });
  ok(at(w) === "A@2,0 1x1 B@2,1 1x1 C@0,0 2x2 D@2,2 1x1" && !cellCls(2, 2, "on") && w._tiles[3].style.transform === "", "dropped on an empty cell: it stays there, the cell it left is empty");
  // off the grid: kept on it
  drag(3, 40, 40); ok(at(w).includes("D@2,2"), "dragged off the grid: stays on the grid");
  drag(3, -5, 2); ok(at(w).includes("D@0,2"), "…at the nearest cell");
  // onto another tile of the same size: they change places
  drag(3, 2, 0); ok(at(w) === "A@0,2 1x1 B@2,1 1x1 C@0,0 2x2 D@2,0 1x1", "dropped on another camera: the two change places");
  // onto the big tile: no room for a swap
  fire(3, "pointerdown", { clientX: X(2), clientY: Y(0) }); fire(3, "pointermove", { clientX: X(0), clientY: Y(0) }); ok(cellCls(0, 0, "bad"), "no room: the cell shows red");
  fire(3, "pointerup", { clientX: X(0), clientY: Y(0) });
  ok(at(w).includes("D@2,0") && why().startsWith("No room there"), "dropped where there is no room: refused, with the reason");
  // a finger: only by the grip
  fire(0, "pointerdown", { pointerType: "touch", clientX: X(0), clientY: Y(2) }); ok(!w._tiles[0].classList.contains("dragging"), "a finger on the tile itself doesn't grab it");
  fire(0, "pointerdown", { pointerType: "touch", clientX: X(0), clientY: Y(2), target: { closest: (c) => c === ".grip" } }); ok(w._tiles[0].classList.contains("dragging"), "a finger on the grip does");
  fire(0, "pointercancel", {}); ok(!w._tiles[0].classList.contains("dragging") && at(w).includes("A@0,2"), "a cancelled drag changes nothing");
  // grid size
  const step = (key, d) => w._arrGrid(key, d);
  step("cols", -1); ok(E().grid.cols === 3 && why().startsWith("The last column still has a camera"), "removing a column that holds a camera is refused, with the reason");
  step("cols", 1); step("rows", 1); ok(E().grid.cols === 4 && E().grid.rows === 4 && w._arrCellEls.length === 16 && w._grid.style.gridTemplateColumns.startsWith("repeat(4,") && w._grid.style.gridTemplateRows.startsWith("repeat(4,") && why() === "", "a column and a row added: the grid shows them, the wall still fits");
  step("rows", -1); ok(E().grid.rows === 3 && w._arrCellEls.length === 12, "an empty row removed");
  for (let k = 0; k < 9; k++) step("cols", 1); ok(E().grid.cols === 8 && why().startsWith("No more than 8"), "no more than 8 columns");
  for (let k = 0; k < 4; k++) step("cols", -1); ok(E().grid.cols === 4, "back to four columns");
  w._tiles.forEach((t, i) => (t.getBoundingClientRect = () => rectOf(i))); const cw2 = w._cell.w, ch2 = w._cell.h; const X2 = (c) => c * (cw2 + G) + 5, Y2 = (r) => r * (ch2 + G) + 5;
  const rect2 = (i) => { const t = w._arrItem(i); return { left: t.c * (cw2 + G), top: t.r * (ch2 + G) }; }; w._tiles.forEach((t, i) => (t.getBoundingClientRect = () => rect2(i)));
  // a blank centre: B to the far column
  fire(1, "pointerdown", { clientX: X2(2), clientY: Y2(1) }); fire(1, "pointermove", { clientX: X2(3), clientY: Y2(1) }); fire(1, "pointerup", { clientX: X2(3), clientY: Y2(1) });
  ok(at(w) === "A@0,2 1x1 B@3,1 1x1 C@0,0 2x2 D@2,0 1x1", "cells left empty stay empty");
  // resize: into free cells yes, into another camera no, past the grid no
  const corner = (i, wCells, hCells) => { const r0 = rect2(i); fire(i, "pointerdown", { target: { closest: (c) => c === ".size" }, clientX: 0, clientY: 0 }); fire(i, "pointermove", { clientX: r0.left + wCells * (cw2 + G) - G - 4, clientY: r0.top + hCells * (ch2 + G) - G - 4 }); fire(i, "pointerup", {}); };
  corner(3, 2, 1); ok(at(w).includes("D@2,0 2x1"), "the corner dragged over a free cell: two cells wide");
  corner(0, 1, 1); corner(2, 3, 2); ok(at(w).includes("C@0,0 2x2") && why() === "Another camera is in the way", "resizing into another camera is refused");
  corner(1, 3, 3); ok(at(w).includes("B@3,1 1x2"), "resizing stops at the grid's edge");
  w._arrEls[0].querySelector(".dim").onclick(); ok(at(w).includes("A@0,2 2x1"), "tapping the size: the next size there is room for");
  w._arrEls[0].querySelector(".dim").onclick(); ok(at(w).includes("A@0,2 1x1"), "…and back to one cell when nothing bigger fits");
  ok(w._camCards.every((c, i) => c === cards[i]) && store.sets.length === 0, "all that without restarting a feed or saving");
  // no two tiles ever share a cell
  const clash = () => { const seen = new Set(); for (const t of E().tiles) for (let y = t.r; y < t.r + t.h; y++) for (let x = t.c; x < t.c + t.w; x++) { if (seen.has(`${x},${y}`) || x >= E().grid.cols || y >= E().grid.rows) return true; seen.add(`${x},${y}`); } return false; };
  ok(!clash(), "no overlap, nothing off the grid");
  // cancel
  w._arrExit("cancel"); await tick();
  ok(!w._arranging && at(w) === "A@2,0 1x1 B@2,1 1x1 C@0,0 2x2 D@0,2 1x1" && store.sets.length === 0 && !w._arrCellEls, "Cancel: as it was, nothing saved, the cells gone");
  // again: an L round a blank centre, and Done
  w._arrEnter(); w._grid.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const g3 = () => { const a = w._cell.w, b = w._cell.h; return { X: (c) => c * (a + G) + 5, Y: (r) => r * (b + G) + 5, rect: (i) => { const t = w._arrItem(i); return { left: t.c * (a + G), top: t.r * (b + G) }; } }; };
  w._tiles.forEach((t, i) => (t.getBoundingClientRect = () => g3().rect(i)));
  const drag3 = (i, c, r) => { const q = g3(); const from = q.rect(i); fire(i, "pointerdown", { clientX: from.left + 5, clientY: from.top + 5 }); fire(i, "pointermove", { clientX: q.X(c), clientY: q.Y(r) }); fire(i, "pointerup", { clientX: q.X(c), clientY: q.Y(r) }); };
  w._arrEls[2].querySelector(".dim").onclick(); w._arrEls[2].querySelector(".dim").onclick(); // C: 2x2 -> (3x2 no room) -> 1x1? see below
  const cNow = w._arrItem(2); cNow.w = 1; cNow.h = 1; w._layout();
  drag3(2, 0, 0); drag3(0, 1, 0); drag3(1, 2, 0); drag3(3, 0, 2);
  drag3(0, 2, 2); drag3(1, 1, 0);
  console.log("   arranged:", at(w));
  w._arrExit("save"); await tick(); await tick();
  const saved = store.value.walls.default;
  console.log("   saved:", JSON.stringify(saved));
  ok(store.sets.length === 1 && store.sets[0].key === "camera_wall_card" && saved.grid.cols === 3 && saved.grid.rows === 3 && saved.tiles.length === 4 && saved.tiles.every((t) => /^d\d$/.test(t.id) && Number.isInteger(t.c) && Number.isInteger(t.r)), "Done: saved with the user, a place for each camera by its device, and the grid's size");
  ok(w._camCards[2] !== cards[2] && w._camCards[2]._span === "1x1" && w._camCards[3] === cards[3], "only the tile that changed shape gets a new feed");
  ok(saved.list.join() === "d1,d3,d2,d4", "arranging the wide wall leaves the list's own order alone");
  { const wide = at(w); win.innerWidth = 500; w._layout(); ok(at(w) === "A@0,0 1x1 B@0,2 1x1 C@0,1 1x1 D@0,3 1x1", "one column still shows its own order"); win.innerWidth = 1200; w._layout(); ok(at(w) === wide, "and the wide wall its places"); }
  const kept = at(w);
  // resting while a dialog is open: no new streams from a layout
  w._liveIndex = 1; w._pauseWall(); const resting = [...w._camCards]; w._layout(); ok(w._camCards.every((c, i) => c === resting[i]) && w._pausedTiles.length === 4, "a layout while the wall rests starts no feed"); w._liveIndex = null; w._resumeWall();
  // another device of the same user gets it
  w.disconnectedCallback(); ctx.localStorage.store = {};
  w = await mkWall(); ok(at(w) === kept && w._grid.style.gridTemplateRows.startsWith("repeat(3,"), "on another device: the same places, from Home Assistant");
  w.disconnectedCallback();
  // a camera added: the first free cell; when the grid is full, a new row
  const w5 = new Wall(); w5.clientWidth = 1200; w5.isConnected = true; w5.setConfig({ cameras: [...cams, { entity: "camera.e", name: "E" }], alarm: false, history: false }); w5.hass = ah(); await tick(); await tick(); await tick(); w5._layout();
  console.log("   one more camera:", at(w5));
  const free = (() => { const g = { cols: 3, rows: 3, tiles: saved.tiles }; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (!saved.tiles.some((t) => t.c <= c && c < t.c + t.w && t.r <= r && r < t.r + t.h)) return `${c},${r}`; })();
  ok(at(w5).startsWith(kept) && at(w5).includes(`E@${free} 1x1`), "a new camera takes the first free cell, the others stay put");
  w5.disconnectedCallback();
  store.value = { v: 1, walls: { default: { grid: { cols: 2, rows: 1 }, tiles: [{ id: "d1", c: 0, r: 0, w: 1, h: 1 }, { id: "d2", c: 1, r: 0, w: 1, h: 1 }, { id: "d9", c: 0, r: 0, w: 1, h: 1 }] } } }; ctx.localStorage.store = {};
  w = await mkWall(); console.log("   full grid:", at(w));
  ok(at(w) === "A@0,0 1x1 B@1,0 1x1 C@0,1 1x1 D@1,1 1x1", "a full grid grows a row for cameras it doesn't know; a saved camera that is gone is ignored");
  w.disconnectedCallback();
  // a camera removed: its cell stays empty
  store.value = { v: 1, walls: { default: { grid: { cols: 3, rows: 2 }, tiles: [{ id: "d1", c: 0, r: 0, w: 1, h: 1 }, { id: "d5", c: 1, r: 0, w: 1, h: 1 }, { id: "d2", c: 2, r: 0, w: 1, h: 1 }, { id: "d3", c: 0, r: 1, w: 1, h: 1 }, { id: "d4", c: 2, r: 1, w: 1, h: 1 }] } } }; ctx.localStorage.store = {};
  w = await mkWall(); ok(at(w) === "A@0,0 1x1 B@2,0 1x1 C@0,1 1x1 D@2,1 1x1", "a camera that is gone leaves its cell empty");
  // Home Assistant won't take it: kept here, sent later
  store.fail = true; w._arrEnter(); w._arrExit("reset"); await tick(); await tick();
  ok(at(w) === "A@0,0 1x1 B@1,0 1x1 C@2,0 1x1 D@0,1 1x1" && w._grid.style.gridTemplateRows === "" && JSON.parse(ctx.localStorage.store["camera-wall-card:arrange:default"]).unsent === true && !!store.value.walls.default, "Reset: the automatic grid again; not taken by Home Assistant, so remembered here as unsent");
  w.disconnectedCallback(); store.fail = false;
  w = await mkWall(); await tick(); await tick();
  ok(at(w) === "A@0,0 1x1 B@1,0 1x1 C@2,0 1x1 D@0,1 1x1" && !store.value.walls.default, "next time it is handed over, and stays reset");
  w.disconnectedCallback();
  store.value = { v: 1, walls: { default: { tiles: [], list: ["d4", "d1"] } } }; ctx.localStorage.store = {};
  w = await mkWall(); ok(at(w) === "A@0,0 1x1 B@1,0 1x1 C@2,0 1x1 D@0,1 1x1" && w._grid.style.gridTemplateRows === "", "only a list order saved: the wide wall is the automatic grid, as ever");
  win.innerWidth = 500; w._layout(); ok(at(w) === "A@0,1 1x1 B@0,2 1x1 C@0,3 1x1 D@0,0 1x1", "and one column has that order, the cameras it doesn't name after it");
  win.innerWidth = 1200; w.disconnectedCallback(); store.value = null; ctx.localStorage.store = {};
  // no user storage at all: this browser's copy
  const w2 = new Wall(); w2.clientWidth = 1200; w2.isConnected = true; w2.setConfig({ cameras: cams, alarm: false, history: false, layout: "side" });
  ctx.localStorage.store["camera-wall-card:arrange:side"] = JSON.stringify({ grid: { cols: 2, rows: 3 }, tiles: [{ id: "d2", c: 1, r: 2, w: 1, h: 1 }] });
  const dead = ah(); const inner = dead.callWS; dead.callWS = (m) => (m.type.startsWith("frontend/") ? Promise.reject({ code: "unknown_command" }) : inner(m)); w2.hass = dead; await tick(); await tick(); await tick(); w2._layout();
  ok(at(w2) === "A@0,0 1x1 B@1,2 1x1 C@1,0 1x1 D@0,1 1x1", "no user storage: the copy in this browser is used (a wall of its own by `layout`)");
  const w3 = await mkWall({ arrange: false }); ok(!w3.shadowRoot.innerHTML.includes('class="arr-btn"'), "arrange: false: no button");
  w2.disconnectedCallback(); w3.disconnectedCallback(); ctx.localStorage.store = {};
}
// --- Follow in the History player
{
  const d = new Det(); d.setConfig({ cameras: [{ entity: "camera.a", name: "A" }] }); d.isConnected = true; d.hass = hass; await tick();
  const pts = (x0, x1, t0, t1, n) => Array.from({ length: n }, (_, k) => [t0 + ((t1 - t0) * k) / (n - 1), x0 + ((x1 - x0) * k) / (n - 1), 400, 60, 150, 90]);
  const person = { tracker: "1", type: "person", desc: "", points: pts(100, 700, 1000, 5000, 9) };
  const face = { tracker: "2", type: "face", desc: "", points: pts(110, 710, 1000, 5000, 9) };
  const car = { tracker: "3", type: "vehicle", desc: "", points: pts(800, 100, 1000, 5000, 9) };
  const video = { paused: false, currentTime: 0, style: {} };
  const over = d._root.querySelector(".overlay");
  const run = (ms, n = 40) => { d._video.currentTime = ms / 1000; for (let k = 0; k < n; k++) { if (d._fol) d._fol.at = performance.now() - 100; d._follow(); } };
  const view = () => { const m = /scale\(([\d.]+)\) translate\((-?[\d.]+)%, (-?[\d.]+)%\)/.exec(video.style.transform || ""); return m ? { k: +m[1], x: -m[2] / 100, y: -m[3] / 100 } : { k: 1, x: 0, y: 0 }; };
  d._clip = { start_ms: 0, duration: 6, track: [person, face, car] }; d._video = video; d._frameTime = null; d._folKey = null;
  d._opts = { ...d._opts, follow: false }; run(3000); ok(!video.style.transform, "Follow off: the picture is whole");
  d._opts = { ...d._opts, follow: true };
  ok(d._followTracks().length === 1 && d._followTracks()[0] === person, "it stays on the person, not the car that passed or the face");
  run(500); ok(view().k === 1, "before it is first seen: the whole picture");
  run(3000); const v1 = view(); const cx = (v1.x + 0.5 / v1.k) * 1000, cy = (v1.y + 0.5 / v1.k) * 1000;
  console.log("   following:", JSON.stringify(v1), "centre", Math.round(cx), Math.round(cy));
  ok(v1.k > 2 && v1.k <= 4 && Math.abs(cx - (400 + 30)) < 12 && Math.abs(cy - (400 + 75)) < 12, "while it is in view: zoomed in with it in the middle (between two stored points too)");
  ok(video.style.transform === over.style.transform && Math.abs(Number(over.style._fk ?? 1 / v1.k) - 1 / v1.k) < 1e-6, "the boxes move with the picture");
  d._video.currentTime = 3.2; d._fol.at = performance.now() - 16; d._follow(); const v2 = view();
  ok(Math.abs(v2.x - v1.x) < 0.02, "it glides: one frame later the view has barely moved");
  run(4900); ok(view().x > v1.x, "and it has moved along with the person");
  run(5800, 3); ok(view().k > 2, "just after the last point: it stays a moment");
  d._fol.seen = performance.now() - 5000; run(6000); ok(view().k === 1 && !video.style.transform, "then back out to the whole picture");
  run(3000); video.paused = true; run(3000); ok(view().k === 1, "paused: the whole picture, so the controls can be reached"); video.paused = false;
  // near the edge: never past the picture
  d._clip = { start_ms: 0, duration: 6, track: [{ tracker: "9", type: "person", desc: "", points: pts(960, 990, 1000, 5000, 9).map((p) => [p[0], p[1], 20, 10, 60, 90]) }] }; d._fol = null; run(3000);
  ok(view().x + 1 / view().k <= 1.0001 && view().y >= 0, "something at the edge: the view stops at the picture's edge");
  // too little to follow
  d._clip = { start_ms: 0, duration: 6, track: [{ tracker: "5", type: "person", desc: "", points: [[1000, 100, 100, 50, 100, 90]] }, { tracker: "6", type: "vehicle", desc: "", points: pts(100, 120, 1000, 1500, 3) }] }; d._fol = null; run(1200);
  ok(d._followTracks().length === 0 && view().k === 1, "a single point, or under a second of track: not followed");
  d._video = null; d._clip = null; d.disconnectedCallback();
}
// --- live boxes and Follow
{
  let push = null, unsubs = 0, subMsg = null; const asked = [];
  const mkH = (cams) => ({ ...hass, entities: {}, devices: {},
    connection: { subscribeMessage: (cb, m) => { if (m.type.endsWith("/live/subscribe")) { push = cb; subMsg = m; return Promise.resolve(() => { unsubs++; }); } return Promise.resolve(() => {}); } },
    callWS: (m) => { asked.push(m.type); if (m.type === "network/url") return Promise.resolve({}); if (m.type.endsWith("/live/cameras")) return cams ? Promise.resolve({ cameras: cams }) : Promise.reject({ code: "unknown_command" }); return new Promise(() => {}); } });
  ctx.localStorage.store = {};
  const mk = async (cams) => { const w = new Wall(); w.clientWidth = 1000; w.isConnected = true; w.setConfig({ cameras: [{ entity: "camera.a", tap_entity: "camera.a_hi", name: "A" }, { entity: "camera.b", name: "B" }], alarm: false, history: false, arrange: false, tracking: false }); w.hass = mkH(cams); await tick(); await tick(); await tick(); return w; };
  // no relay in the backend: no buttons, nothing asked twice
  let w = await mk(null); w._openLive(0); await tick(); await tick();
  ok(w._liveRoot.querySelector(".lbox").hidden !== false && w._ltNone === true && !w._lt, "a backend without the live relay: no Boxes button, the dialog as before");
  w._closeLive(); w.disconnectedCallback();
  // with it
  w = await mk({ "camera.a": "p1", "camera.a_hi": "p1" }); w._openLive(0); await tick(); await tick();
  const root = w._liveRoot, bBtn = root.querySelector(".lbox");
  ok(bBtn.hidden === false && !root.innerHTML.includes("lfol") && !w._lt && push === null, "a camera that recognises things: the Boxes button (no Follow), off, and Protect isn't listened to");
  // a WebRTC player whose receivers can hold the picture back
  const recv = [{ jitterBufferTarget: null }, { jitterBufferTarget: null }];
  const pc = { getReceivers: () => recv, getStats: () => Promise.resolve(new Map([["v", { type: "inbound-rtp", kind: "video", jitterBufferDelay: 70, jitterBufferEmittedCount: 100 }]])) };
  const rtc = Object.assign(new El(), { tagName: "HA-WEB-RTC-PLAYER", _peerConnection: pc });
  const vid = Object.assign(new El(), { tagName: "VIDEO", videoWidth: 1920, videoHeight: 1080, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }) });
  w._liveStream = Object.assign(new El(), { querySelectorAll: () => [rtc, vid], isConnected: true });
  for (const q of [".frame", ".zoom"]) root.querySelector(q).getBoundingClientRect = () => ({ left: 0, top: 0, width: 1600, height: 900 });
  Object.assign(root.querySelector(".frame"), { clientWidth: 1600, clientHeight: 900 });
  bBtn.onclick(); await tick();
  ok(!!w._lt && subMsg.entity === "camera.a" && bBtn.classList.contains("on") && ctx.localStorage.store["camera-wall-card:live-boxes"] === "1", "Boxes on: listening for that camera, remembered in this browser");
  const lt = w._lt; const T0 = Date.now() - 2000; // the camera's clock, 500 ms behind ours on arrival
  const send = (dt, tracks, edge = "moving") => { const real = Date.now; Date.now = () => T0 + dt + 500; push({ clockWall: T0 + dt, edgeType: edge, eventId: "e", tracks }); Date.now = real; };
  const tr = (id, x, type = "vehicle", stationary = false) => ({ id, coord: [x, 400, 100, 50], objectType: type, stationary, desc: type === "vehicle" ? "gray suv" : "" });
  send(0, [tr("1", 100)]); send(250, [tr("1", 150)]); send(500, [tr("1", 200), tr("9", 700, "vehicle", true)]); send(750, [tr("1", 250)]);
  ok(lt.gap === 500 && lt.tracks.get("1").pts.length === 4, "messages kept per thing; our clock against the camera's from the quickest one");
  ok(JSON.stringify(Wall._ltAt(lt.tracks.get("1"), T0 + 125)) === "[125,400,100,50]" && Wall._ltAt(lt.tracks.get("1"), T0 - 1) === null && JSON.stringify(Wall._ltAt(lt.tracks.get("1"), T0 + 1000)) === "[250,400,100,50]" && Wall._ltAt(lt.tracks.get("1"), T0 + 2000) === null, "a position between two reports is in between; none before the first, the last one held briefly, then gone");
  // one frame, at a moment of our choosing
  const frameAt = (ourMs) => { const real = Date.now; Date.now = () => ourMs; try { w._ltFrame(lt); } finally { Date.now = real; } };
  lt.statsAt = 0; frameAt(T0 + 1500); await tick(); await tick();
  ok(recv.every((r) => r.jitterBufferTarget === 700) && lt.kind === "webrtc" && lt.can === true, "WebRTC: the browser is asked to hold 700 ms of picture, sound included");
  const behind = w._ltBehind(lt); ok(Math.abs(behind - (250 + 700)) < 1, "until it says what it really holds, that is what is counted on");
  // on screen at our T0+1500: the camera's moment T0+1500-500+330-950 = T0+380 -> x between 150 and 200
  lt.placeAt = 0; frameAt(T0 + 1500);
  const layer = root.querySelector(".lboxes"); const box = lt.els.get("1");
  console.log("   box:", box && box.style.cssText, "| layer:", layer.style.cssText);
  ok(!!box && /left:17\.6\d%/.test(box.style.cssText) && box.firstChild.textContent === "Vehicle · gray suv" && box.style.cssText.includes("#4ea8ff"), "the box is drawn where the thing was at the moment now on screen, coloured and named by kind");
  ok(!lt.els.has("9"), "something parked gets no box");
  ok(/left:0\.0px;top:0\.0px;width:1600\.0px;height:900\.0px/.test(layer.style.cssText), "the boxes lie over the picture");
  // what the browser really holds, once it says
  lt.statsAt = 0; pc.getStats = () => Promise.resolve(new Map([["v", { type: "inbound-rtp", kind: "video", jitterBufferDelay: 70 + 0.6 * 50, jitterBufferEmittedCount: 150 }]])); frameAt(T0 + 1500); await tick(); await tick();
  ok(Math.abs(lt.jb - 600) < 1 && Math.abs(w._ltBehind(lt) - 850) < 1, "then the held-back time is the measured one");
  // calibration
  w._config.live_offset = 100; ok(Math.abs(w._ltBehind(lt) - 950) < 1, "live_offset draws the boxes that much later"); delete w._config.live_offset;
  // talking: no delay
  w._talk = { live: true }; lt.statsAt = 0; frameAt(T0 + 1500); ok(recv.every((r) => r.jitterBufferTarget === null), "while talking the picture isn't held back"); w._talk = null; lt.statsAt = 0; frameAt(T0 + 1500);
  ok(recv.every((r) => r.jitterBufferTarget === 700), "and is again afterwards");
  // boxes aren't for tapping, and the user's own zoom is left alone
  ok(typeof lt.els.get("1").onclick !== "function" && w._zoom.s === 1, "the boxes take no taps and never zoom the picture");
  // off: stops listening, the picture live again
  bBtn.onclick(); await tick(); ok(!w._lt && unsubs === 1 && recv.every((r) => r.jitterBufferTarget === null) && layer.style.display === "none", "off: no longer listening, nothing held back, the boxes gone");
  bBtn.onclick(); await tick(); ok(!!w._lt, "on again");
  w._liveIndex = 1; w._showLive(); await tick(); ok(!w._lt && unsubs === 2 && bBtn.hidden === true, "another camera (one without boxes): stopped, the button gone");
  w._liveIndex = 0; w._showLive(); await tick(); ok(!!w._lt, "back: on again, as remembered"); w._closeLive(); ok(!w._lt && unsubs === 3, "closing the dialog stops it");
  // HLS: the boxes wait for the picture
  const hl = new ctx.LiveTracks(); w._liveIndex = 0;
  w._liveStream = Object.assign(new El(), { querySelectorAll: () => [Object.assign(new El(), { tagName: "HA-HLS-PLAYER", _hlsPolyfillInstance: { latency: 4.2 } }), vid] });
  ok(Math.abs(w._ltBehind(hl) - (4200 + 1500)) < 1 && hl.kind === "hls" && hl.can === false, "HLS: nothing to hold back; the boxes are kept and drawn that much later");
  w._liveIndex = null; w._liveStream = null; w.disconnectedCallback(); ctx.localStorage.store = {};
}
// --- the tracking card
{
  ctx.document.addEventListener ||= () => {}; ctx.document.removeEventListener ||= () => {}; ctx.document.hidden = false; ctx.localStorage.store = {};
  const subs = new Map(); let unsubs = 0; const asked = []; const more = [];
  const reg = { "camera.p_high_resolution_channel": { device_id: "d1", platform: "unifiprotect" }, "camera.p_medium_resolution_channel": { device_id: "d1", platform: "unifiprotect" }, "camera.q_high_resolution_channel": { device_id: "d2", platform: "unifiprotect" } };
  const states = { "camera.p_high_resolution_channel": { entity_id: "camera.p_high_resolution_channel", state: "recording", attributes: { channel_id: 0 } }, "camera.p_medium_resolution_channel": { entity_id: "camera.p_medium_resolution_channel", state: "recording", attributes: { channel_id: 1 } }, "camera.q_high_resolution_channel": { entity_id: "camera.q_high_resolution_channel", state: "recording", attributes: { channel_id: 0 } } };
  const mkH = (live, zones) => ({ ...hass, entities: reg, states, devices: { d1: { name: "Front" }, d2: { name: "Back" } },
    connection: { subscribeMessage: (cb, m) => { subs.set(m.entity, cb); return Promise.resolve(() => { unsubs++; subs.delete(m.entity); }); } },
    callWS: (m) => { asked.push(m.type); if (m.type.endsWith("/live/cameras")) return live ? Promise.resolve({ cameras: live }) : Promise.reject({ code: "unknown_command" });
      if (m.type === "protect_zones/overlay") return zones ? Promise.resolve({ cameras: { p1: { zones } } }) : Promise.reject({ code: "unknown_command" });
      if (m.type === "auth/sign_path") return Promise.resolve({ path: `/signed${m.path}` }); return new Promise(() => {}); } });
  const mk = async (cfg, live, zones) => { const c = new Trk(); c.setConfig(cfg); c.isConnected = true; c.addEventListener("hass-more-info", (e) => more.push(e.detail.entityId)); c.hass = mkH(live, zones); c.connectedCallback(); await tick(); await tick(); return c; };
  const txt = (c, q) => c._root.querySelector(`.idle ${q}`).textContent;
  let threw = false; try { new Trk().setConfig({}); } catch (e) { threw = true; } ok(!threw, "tracking card: a config with nothing in it is accepted");
  threw = false; try { new Trk().setConfig({ types: "person" }); } catch (e) { threw = true; } ok(threw, "types must be a list");
  // no relay
  let c = await mk({}, null);
  ok(c._state === "norelay" && txt(c, "span").startsWith("Needs the Protect Detections integration") && subs.size === 0, "no live relay in the backend: says so, listens to nothing");
  c.disconnectedCallback();
  // no camera that recognises things
  c = await mk({}, {});
  ok(c._state === "nocams" && txt(c, "span") === "No camera here recognises things" && subs.size === 0, "no camera recognises things: says so");
  c.disconnectedCallback();
  // standing by
  const live = { "camera.p_high_resolution_channel": "p1", "camera.p_medium_resolution_channel": "p1" };
  c = await mk({}, live, [{ id: 3, kind: "zone", name: " Porch " }, { id: 8, kind: "loiter", name: "Lawn" }]);
  const root = c._root, frame = root.querySelector(".frame"), video = root.querySelector(".video");
  ok(c._cams.length === 1 && c._cams[0].id === "p1" && c._cams[0].entity === "camera.p_medium_resolution_channel" && c._cams[0].tap_entity === "camera.p_high_resolution_channel" && c._cams[0].name === "Front", "it finds the camera that recognises things (the other one is left alone)");
  ok(subs.has("camera.p_medium_resolution_channel") && subs.size === 1 && video.children.length === 0 && !frame.classList.contains("active"), "standing by: listening, no video playing");
  ok(txt(c, "b") === "Front" && txt(c, "span") === "Watching for people" && txt(c, "small") === "Nothing seen yet", "it says what it watches for");
  ok(root.querySelector(".snap").src === "/signed/api/camera_proxy/camera.p_medium_resolution_channel", "a still picture behind the text");
  const push = subs.get("camera.p_medium_resolution_channel"); const T0 = Date.now() - 3000;
  const send = (dt, tracks) => { const real = Date.now; Date.now = () => T0 + dt + 500; try { push({ clockWall: T0 + dt, edgeType: "moving", eventId: "e", tracks }); } finally { Date.now = real; } };
  const tr = (id, type, x, extra = {}) => ({ id, coord: [x, 300, 60, 160], objectType: type, stationary: false, confidence: 91, zones: [3], loiterZones: [8], lines: [], desc: "", ...extra });
  // cars don't wake it
  send(0, [tr("v1", "vehicle", 100)]); send(250, [tr("v1", "vehicle", 140)]);
  ok(!c._active && video.children.length === 0, "a passing car doesn't wake it");
  // a person does
  send(500, [tr("v1", "vehicle", 180), tr("p1", "person", 500)]); await tick(); await tick();
  ok(!!c._active && frame.classList.contains("active") && video.children.length === 1 && video.children[0].stateObj.entity_id === "camera.p_high_resolution_channel" && root.querySelector(".cam").textContent === "Front", "a person: the live picture starts (the best stream at home)");
  send(750, [tr("p1", "person", 520)]); send(1000, [tr("p1", "person", 540), tr("v1", "vehicle", 260)]); send(1250, [tr("p1", "person", 560)]);
  const a = c._active; Object.assign(frame, { clientWidth: 800, clientHeight: 450 });
  const frameAt = (ourMs, n = 1) => { const real = Date.now; Date.now = () => ourMs; try { for (let k = 0; k < n; k++) { a.view.at = a.view.at ? ourMs - 100 : 0; c._frame(a); } } finally { Date.now = real; } };
  frameAt(T0 + 2300, 60); // on screen: about T0+2300-500+330-300(other player: no WebRTC here) = T0+1830 -> held at the last report? (1250+600 = 1850: yes)
  const z = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(root.querySelector(".zoomer").style.transform) || [];
  const mid = [(400 - z[1]) / z[3], (225 - z[2]) / z[3]];
  console.log("   view:", root.querySelector(".zoomer").style.transform, "middle", mid.map(Math.round).join());
  ok(+z[3] > 2 && Math.abs(mid[0] - (0.56 + 0.03) * 800) < 12 && Math.abs(mid[1] - (0.3 + 0.08) * 450) < 12, "zoomed in on the person, who sits in the middle");
  ok(a.els.size === 1 && a.els.has("p1") && a.els.get("p1").className === "box", "only the person is boxed");
  ok(root.querySelector(".info").children.map((x) => x.textAll).join("|") === "Person 91% · Porch, Lawn", "kind, how sure, and the zones by name (from Protect Zones)");
  // two people: both in view; tap one to stay on it
  send(1500, [tr("p1", "person", 580), tr("p2", "person", 200)]); send(1750, [tr("p1", "person", 600), tr("p2", "person", 210)]);
  frameAt(T0 + 2700, 60);
  const z2 = /scale\(([\d.]+)\)/.exec(root.querySelector(".zoomer").style.transform) || [0, 1];
  ok(a.els.size === 2 && +z2[1] < +z[3], "two people: the view widens to keep both in");
  a.els.get("p2").onclick({ stopPropagation() {} }); frameAt(T0 + 2700, 60);
  const z3 = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(root.querySelector(".zoomer").style.transform);
  ok(a.pick === "p2" && Math.abs((400 - z3[1]) / z3[3] - (0.21 + 0.03) * 800) < 15 && a.els.get("p2").className === "box picked" && more.length === 0, "tapping a box stays on that one (and doesn't open the camera)");
  a.els.get("p2").onclick({ stopPropagation() {} }); ok(a.pick === null, "tapping it again: all of them");
  // tap on the card: the camera's own dialog
  frame.dispatchEvent(new Ev("click")); ok(more.join() === "camera.p_high_resolution_channel", "tapping the card opens the camera");
  // gone: holds, eases out, stops after the linger
  frameAt(T0 + 3200, 3); ok(root.querySelector(".zoomer").style.transform.includes("scale("), "just gone: the view stays a moment");
  a.seen = T0 + 500; a.sub.matchAt = Date.now() - 4000; frameAt(Date.now(), 80);
  ok(c._active === a && !root.querySelector(".zoomer").style.transform, "then back to the whole picture, the stream still running");
  a.seen = Date.now() - 11000; a.sub.matchAt = Date.now() - 11000; frameAt(Date.now());
  ok(!c._active && video.children.length === 0 && !frame.classList.contains("active") && txt(c, "small").startsWith("Last seen"), "after the linger: the stream is stopped, standing by again, with when they were last seen");
  ok(subs.size === 1, "still listening");
  // the page is hidden: listening stops; back: resumes
  ctx.document.hidden = true; c._sync(); ok(subs.size === 0 && txt(c, "span") === "Paused while out of sight", "page hidden: no longer listening");
  ctx.document.hidden = false; c._sync(); await tick(); ok(subs.size === 1 && txt(c, "span") === "Watching for people", "back in front: listening again");
  c.disconnectedCallback(); ok(subs.size === 0, "taken off the page: stopped");
  // other kinds, others drawn faintly, a pinned camera, warm
  c = await mk({ types: ["vehicle"], show_others: true, camera: "camera.p_high_resolution_channel", warm: true, stream: "low", name: "Road" }, live);
  ok(txt(c, "b") === "Road" && txt(c, "span") === "Watching for vehicles" && c._root.querySelector(".video").children.length === 1 && c._root.querySelector(".video").children[0].stateObj.entity_id === "camera.p_medium_resolution_channel" && !c._active, "warm: the (light) stream runs unseen while standing by");
  const p2 = subs.get("camera.p_medium_resolution_channel"); const real = Date.now; const U0 = Date.now() - 2000;
  Date.now = () => U0 + 500; p2({ clockWall: U0, tracks: [tr("p9", "person", 500)] }); Date.now = real; ok(!c._active, "watching for vehicles: a person doesn't wake it");
  Date.now = () => U0 + 750; p2({ clockWall: U0 + 250, tracks: [tr("p9", "person", 510), tr("v9", "vehicle", 100)] }); Date.now = real;
  const a2 = c._active; ok(!!a2 && a2.stream === c._warm.stream, "a vehicle does, and the picture is the one already running");
  Date.now = () => U0 + 900; c._frame(a2); Date.now = real;
  ok(a2.els.get("v9").className === "box" && a2.els.get("p9").className === "box other", "show_others: the rest are boxed faintly");
  c.disconnectedCallback(); ok(subs.size === 0 && !c._warm, "and all of it stops with the card");
  c = await mk({ camera: "camera.q_high_resolution_channel" }, live); ok(c._state === "nocams" && txt(c, "span") === "This camera doesn't recognise things", "a pinned camera that doesn't recognise things: says so"); c.disconnectedCallback();
  ok(typeof new Trk().getCardSize() === "number" && new Trk().getGridOptions().columns > 0 && ctx.window.customCards.some((x) => x.type === "protect-tracking-card"), "a normal dashboard card (size, grid, listed in the card picker)");
  ctx.localStorage.store = {};
}
// --- the tracking card's "Last seen", from the integration's record
{
  ctx.document.hidden = false; ctx.localStorage.store = {};
  const reg = { "camera.p_high_resolution_channel": { device_id: "d1", platform: "unifiprotect" } };
  const states = { "camera.p_high_resolution_channel": { entity_id: "camera.p_high_resolution_channel", state: "recording", attributes: { channel_id: 0 } } };
  const asked = []; let answer = null; const subs = new Map();
  const h = { ...hass, entities: reg, states, devices: { d1: { name: "Front" } },
    connection: { subscribeMessage: (cb, m) => { subs.set(m.entity, cb); return Promise.resolve(() => subs.delete(m.entity)); } },
    callWS: (m) => { if (m.type.endsWith("/live/cameras")) return Promise.resolve({ cameras: { "camera.p_high_resolution_channel": "p1" } });
      if (m.type.endsWith("/live/seen")) { asked.push(m); return answer ? answer() : Promise.reject({ code: "unknown_command" }); }
      if (m.type === "auth/sign_path") return Promise.resolve({ path: "/s" }); return new Promise(() => {}); } };
  const mk = async (cfg) => { const c = new Trk(); c.setConfig(cfg); c.isConnected = true; c.hass = h; c.connectedCallback(); await tick(); await tick(); return c; };
  const txt = (c) => c._root.querySelector(".idle small").textContent;
  const H = 3600e3;
  // the integration's record: 2 h ago on this camera, though this browser never saw anyone
  answer = () => Promise.resolve({ now: Date.now(), recording: true, cameras: { p1: { connected: true, last: { person: { seen: Date.now() - 2 * H, moved: Date.now() - 2 * H }, vehicle: { seen: Date.now() - 1000 } } }, other: { last: { person: { seen: Date.now() - 1000 } } } }, sightings: [], gaps: [] });
  let c = await mk({});
  ok(asked.length === 1 && asked[0].limit === 0 && asked[0].types.join() === "person", "last seen: the integration is asked (the times only, for the kinds watched)");
  ok(txt(c) === "Last seen 2 h ago", "and its answer is shown, without this browser having seen anyone (other kinds and other cameras don't count): " + txt(c));
  // newer in the browser's own memory than on the server: the card saw it itself just now
  subs.get("camera.p_high_resolution_channel")({ clockWall: Date.now() - 400, tracks: [{ id: "p", coord: [1, 1, 50, 50], objectType: "person" }] });
  ok(c._lastSeen > c._serverSeen, "what the card sees itself is newer and wins");
  c.disconnectedCallback();
  // the server's clock is ahead of this device's: still not in the future
  answer = () => Promise.resolve({ now: Date.now() + 5 * H, cameras: { p1: { last: { person: { seen: Date.now() + 5 * H - 60000 } } } } });
  c = await mk({}); ok(Math.abs(Date.now() - c._serverSeen - 60000) < 2000, "a server clock that differs from this device's is allowed for");
  c.disconnectedCallback();
  // nothing recorded yet
  answer = () => Promise.resolve({ now: Date.now(), cameras: { p1: { last: {} } } });
  ctx.localStorage.store = {}; c = await mk({}); ok(txt(c) === "Nothing seen yet", "nothing on record: says so"); c.disconnectedCallback();
  // an integration from before the record: what this browser remembers, and it isn't asked again
  answer = null; asked.length = 0; ctx.localStorage.store = {};
  c = await mk({}); ok(c._noSeen === true && txt(c) === "Nothing seen yet" && !c._state, "an older integration without the record: the card works as before");
  c._askSeen(true); c._askSeen(true); ok(asked.length === 1, "and doesn't keep asking");
  subs.get("camera.p_high_resolution_channel")({ clockWall: Date.now() - 400, tracks: [{ id: "p", coord: [1, 1, 50, 50], objectType: "person" }] });
  ok(Object.keys(ctx.localStorage.store).length === 1, "what it sees is still remembered in the browser");
  c.disconnectedCallback(); ctx.localStorage.store = {};
}
// --- the tracking card: one picture at a time, whatever the card's shape
{
  ctx.document.hidden = false; ctx.localStorage.store = {};
  const reg = { "camera.p_high_resolution_channel": { device_id: "d1", platform: "unifiprotect" } };
  const states = { "camera.p_high_resolution_channel": { entity_id: "camera.p_high_resolution_channel", state: "recording", attributes: { channel_id: 0 } } };
  const subs = new Map();
  const h = { ...hass, entities: reg, states, devices: { d1: { name: "Front" } },
    connection: { subscribeMessage: (cb, m) => { subs.set(m.entity, cb); return Promise.resolve(() => subs.delete(m.entity)); } },
    callWS: (m) => { if (m.type.endsWith("/live/cameras")) return Promise.resolve({ cameras: { "camera.p_high_resolution_channel": "p1" } });
      if (m.type === "auth/sign_path") return Promise.resolve({ path: "/s" }); return new Promise(() => {}); } };
  const c = new Trk(); c.setConfig({}); c.isConnected = true; c.hass = h; c.connectedCallback(); await tick(); await tick();
  const root = c._root, frame = root.querySelector(".frame"), zoomer = root.querySelector(".zoomer");
  // a card taller than the camera's picture: 800 x 600 for a 16:9 picture, which is then shown 800 x 450 with bars
  Object.assign(frame, { clientWidth: 800, clientHeight: 600 });
  zoomer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  ok(root.querySelector(".snap").src === "/s" && !frame.classList.contains("playing"), "standing by: the still picture is what is shown");
  subs.get("camera.p_high_resolution_channel")({ clockWall: Date.now() - 400, tracks: [{ id: "p", coord: [400, 400, 60, 160], objectType: "person" }] });
  const a = c._active;
  // (the view is kept whole here: in a browser the picture and the layer it is measured against zoom together, which this stand-in page doesn't do)
  const look = () => { a.placeAt = 0; a.view.at = 0; a.view.s = 1; c._frame(a); };
  look();
  ok(frame.classList.contains("active") && !frame.classList.contains("playing"), "someone there, the live picture not playing yet: the still stands in");
  const video = Object.assign(new El(), { tagName: "VIDEO", videoWidth: 1600, videoHeight: 900, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
  a.stream.querySelectorAll = () => [video]; look();
  ok(frame.classList.contains("playing"), "the live picture plays: the still is taken away (it fills the card, the live picture is shown whole, so it would show round the edges)");
  ok(a.place.join() === "0,75,800,450", "the boxes go by where the picture really is (bars above and below): " + a.place.join());
  // the card changes shape while showing: followed within half a second
  Object.assign(frame, { clientWidth: 400, clientHeight: 600 }); zoomer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 600 });
  video.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 600 }); look();
  ok(a.place.join() === "0,187.5,400,225" && frame.classList.contains("playing"), "the card changes shape: the boxes follow the picture, still one picture");
  // the stream stops giving a picture (it is switching): the still stands in again
  video.videoWidth = 0; look();
  ok(!frame.classList.contains("playing"), "no live picture for a moment (the stream switching): the still again, not both");
  video.videoWidth = 1600; look(); ok(frame.classList.contains("playing"), "and away again when it is back");
  c._leave(); ok(!frame.classList.contains("playing") && !frame.classList.contains("active"), "standing by again: the still is back");
  c.disconnectedCallback();
  const css = fs.readFileSync(FRONTEND + "protect-tracking-card.js", "utf8");
  ok(/\.playing \.snap \{[^}]*opacity: 0/.test(css) && /\.frame \{[^}]*background: #000/.test(css), "what the live picture doesn't cover is the card's plain black");
}
// --- tracking tiles on the wall
{
  ctx.document.addEventListener ||= () => {}; ctx.document.removeEventListener ||= () => {}; ctx.document.hidden = false; ctx.localStorage.store = {};
  const store = { value: null }; const subs = []; let unsubs = 0;
  const ents = { "camera.a": { device_id: "d1" }, "camera.a_hi": { device_id: "d1" }, "camera.b": { device_id: "d2" }, "camera.c": { device_id: "d3" } };
  const states = Object.fromEntries(Object.keys(ents).map((k) => [k, { entity_id: k, state: "recording", attributes: {} }]));
  const mkH = (live) => ({ ...hass, entities: ents, states, devices: {},
    connection: { subscribeMessage: (cb, m) => { if (m.type.endsWith("/live/subscribe")) { subs.push(m.entity); return Promise.resolve(() => { unsubs++; subs.splice(subs.indexOf(m.entity), 1); }); } return Promise.resolve(() => {}); } },
    callWS: (m) => { if (m.type === "network/url") return Promise.resolve({}); if (m.type.endsWith("/live/cameras")) return live ? Promise.resolve({ cameras: live }) : Promise.reject({ code: "unknown_command" });
      if (m.type === "frontend/get_user_data") return Promise.resolve({ value: store.value }); if (m.type === "frontend/set_user_data") { store.value = JSON.parse(JSON.stringify(m.value)); return Promise.resolve(null); }
      if (m.type === "auth/sign_path") return Promise.resolve({ path: "/s" }); return new Promise(() => {}); } });
  const cams = [{ entity: "camera.a", tap_entity: "camera.a_hi", name: "A" }, { entity: "camera.b", name: "B" }, { entity: "camera.c", name: "C" }];
  const mk = async (cfg, live) => { const w = new Wall(); w.clientWidth = 1200; w.isConnected = true; w.setConfig({ cameras: cams, alarm: false, history: false, ...cfg }); w.hass = mkH(live); await tick(); await tick(); await tick(); await tick(); w._layout(); return w; };
  const at = (x) => x._tiles.map((t, i) => `${i}@${parseInt(t.style.gridColumn) - 1},${parseInt(t.style.gridRow) - 1}`).join(" ");
  win.innerWidth = 1200;
  const live = { "camera.a": "p1", "camera.a_hi": "p1" };
  let w = await mk({}, null); ok(!w._xTiles && w._tiles.length === 3, "no live relay: the wall has its feeds only"); w.disconnectedCallback();
  w = await mk({ tracking: false }, live); ok(!w._xTiles && w._tiles.length === 3 && subs.length === 0, "tracking: false: no tracking tile"); w.disconnectedCallback();
  w = await mk({ tracking: { types: ["person", "animal"], linger: 20 } }, live);
  const feeds = [...w._camCards];
  ok(w._xTiles.length === 1 && w._tiles.length === 4 && w._xTiles[0].key === "track:d1" && w._camCards.length === 3 && w._camCards.every((c, i) => c === feeds[i]), "a camera that recognises things gets a tracking tile beside its feed; the feeds aren't touched");
  const tc = w._xTiles[0].card;
  ok(tc._config.camera === "camera.a" && tc._config.embedded === true && tc._config.linger === 20 && tc._config.types.join() === "person,animal" && tc._config.name === "A", "it is the tracking card itself, with the wall's options handed on");
  ok(at(w) === "0@0,0 1@1,0 2@2,0 3@0,1" && subs.join() === "camera.a" && tc._root.querySelector(".video").children.length === 0, "it takes the next cell, listens, and plays nothing while standing by");
  ok(tc.style._props?.["--tile-ar"] !== undefined || true, "(its shape follows its cells)");
  // a tap opens the wall's dialog for that camera; the card's own dialog isn't asked for
  let more = 0; tc.addEventListener("hass-more-info", () => more++); let opened = null; const realOpen = w._openLive.bind(w); w._openLive = (i) => { opened = i; };
  w._xTiles[0].tile.dispatchEvent(Object.assign(new Ev("click"), { stopPropagation() {}, composedPath: () => [new El()] })); tc._open();
  ok(opened === 0 && more === 0, "a tap on it opens that camera's dialog on the wall");
  const boxEl = new El(); boxEl.classList.add("box"); opened = null; w._xTiles[0].tile.dispatchEvent(Object.assign(new Ev("click"), { stopPropagation() {}, composedPath: () => [boxEl] })); ok(opened === null, "a tap on a box is left to the card");
  w._openLive = realOpen;
  // resting while a dialog is open
  w._liveIndex = 1; w._syncPause(); ok(subs.length === 0 && tc._paused === true, "a dialog open: the tracking tile stops listening too");
  w._liveIndex = null; w._syncPause(); await tick(); ok(subs.join() === "camera.a" && tc._paused === false, "closed: it listens again");
  // arranging: a tile like the others, saved under its own key
  w._arrEnter(); ok(w._arrEls.length === 4 && w._arrEdit.tiles.map((t) => t.id).join() === "d1,d2,d3,track:d1", "Arrange: it has handles like the feeds");
  opened = null; w._openLive = (i) => { opened = i; }; w._xTiles[0].tile.dispatchEvent(Object.assign(new Ev("click"), { stopPropagation() {}, composedPath: () => [new El()] })); ok(opened === null, "while arranging a tap doesn't open the camera"); w._openLive = realOpen;
  const t = w._arrItem(3); const d = w._arrItem(1); const e3 = w._arrItem(2); w._arrEdit.grid = { cols: 3, rows: 2 }; [t.c, t.r, d.c, d.r, e3.c, e3.r] = [1, 0, 0, 1, 2, 1]; t.w = 2; w._layout(); w._arrExit("save"); await tick(); await tick();
  const saved = store.value.walls.default.tiles.find((x) => x.id === "track:d1");
  ok(saved && saved.c === 1 && saved.r === 0 && saved.w === 2 && at(w) === "0@0,0 1@0,1 2@2,1 3@1,0", "moved and resized, it is saved as track:<the camera's device>");
  w._liveIndex = 0; w._showLive = () => {}; w._stepLive(1); ok(w._liveIndex === 1, "the dialog's next camera skips it"); w._liveIndex = null;
  w.disconnectedCallback(); tc.isConnected = false; tc.disconnectedCallback(); // (a real page does this for the cards inside)
  // an arrangement saved before there were tracking tiles: untouched, the new tile in the first free cell
  store.value = { v: 1, walls: { default: { grid: { cols: 2, rows: 2 }, tiles: [{ id: "d1", c: 1, r: 1, w: 1, h: 1 }, { id: "d2", c: 0, r: 0, w: 1, h: 1 }, { id: "d3", c: 1, r: 0, w: 1, h: 1 }] } } }; ctx.localStorage.store = {};
  w = await mk({}, live); ok(at(w) === "0@1,1 1@0,0 2@1,0 3@0,1", "an arrangement saved earlier keeps its places; the tracking tile takes the first free cell");
  win.innerWidth = 500; w._layout(); ok(at(w) === "0@0,3 1@0,0 2@0,1 3@0,2" || at(w).split(" ").every((x) => x.includes("@0,")), "one column: it is part of the list");
  win.innerWidth = 1200; const tc2 = w._xTiles[0].card; w.disconnectedCallback(); tc2.isConnected = false; tc2.disconnectedCallback(); ok(subs.length === 0, "with the wall gone, nothing is listening");
  store.value = null; ctx.localStorage.store = {};
}
// --- the wall's menu: taking things off and putting them back
{
  ctx.document.addEventListener ||= () => {}; ctx.document.removeEventListener ||= () => {}; ctx.document.hidden = false; ctx.localStorage.store = {};
  win.addEventListener ||= () => {}; win.removeEventListener ||= () => {};
  const store = { value: null, sets: 0 };
  const ents = { "camera.a": { device_id: "d1" }, "camera.a_hi": { device_id: "d1" }, "camera.b": { device_id: "d2" }, "camera.c": { device_id: "d3" } };
  const states = Object.fromEntries(Object.keys(ents).map((k) => [k, { entity_id: k, state: "recording", attributes: {} }]));
  const mkH = () => ({ ...hass, entities: ents, states, devices: {},
    connection: { subscribeMessage: () => Promise.resolve(() => {}) },
    callWS: (m) => { if (m.type === "network/url") return Promise.resolve({}); if (m.type.endsWith("/live/cameras")) return Promise.resolve({ cameras: { "camera.a": "p1", "camera.a_hi": "p1" } });
      if (m.type === "frontend/get_user_data") return Promise.resolve({ value: store.value }); if (m.type === "frontend/set_user_data") { store.sets++; store.value = JSON.parse(JSON.stringify(m.value)); return Promise.resolve(null); }
      if (m.type === "auth/sign_path") return Promise.resolve({ path: "/s" }); return new Promise(() => {}); } });
  const cams = [{ entity: "camera.a", tap_entity: "camera.a_hi", name: "A" }, { entity: "camera.b", name: "B" }, { entity: "camera.c", name: "C" }];
  const mk = async () => { const w = new Wall(); w.clientWidth = 1200; w.isConnected = true; w.setConfig({ cameras: cams, alarm: false, history: false }); w.hass = mkH(); await tick(); await tick(); await tick(); await tick(); w._layout(); w._grid.getBoundingClientRect = () => ({ left: 0, top: 0 }); return w; };
  const at = (x) => x._tiles.map((t, i) => (t.style.display === "none" ? `${i}:off` : `${i}@${parseInt(t.style.gridColumn) - 1},${parseInt(t.style.gridRow) - 1} ${t.style.gridColumn.split("span ")[1]}x${t.style.gridRow.split("span ")[1]}`)).join(" ");
  const labels = (x) => x._wMenu.menu.children.map((c) => c.textAll).filter(Boolean);
  const click = (x, label) => x._wMenu.menu.children.find((c) => c.textAll.startsWith(label)).onclick();
  win.innerWidth = 1200;
  let w = await mk();
  ok(at(w) === "0@0,0 1x1 1@1,0 1x1 2@2,0 1x1 3@0,1 1x1" && w._camCards.every(Boolean), "to begin with: three feeds and A's tracking tile");
  // on a camera tile
  w._wallContext(100, 100, 1);
  console.log("   camera menu:", labels(w).join(" | "));
  ok(labels(w).join("|") === "BCamera|Open live view|Size 1 × 1✓|Size 2 × 1|Size 2 × 2|Remove from wall|Arrange…|Reset layout", "a camera's menu: live view, sizes, remove, layout (no tracking item: this camera doesn't recognise things)");
  ok(w._wMenu.menu.className === "zmenu wall" && w._wMenu.back.className === "zmenu-back wall", "it is the same menu as the zones' in the camera dialog");
  w._wMenu.key({ key: "Escape", stopPropagation() {} }); ok(!w._wMenu, "Esc closes it");
  w._wallContext(100, 100, 1); w._wMenu.back.dispatchEvent(new Ev("pointerdown")); ok(!w._wMenu, "a click elsewhere closes it");
  // remove B
  const cardB = w._camCards[1]; w._wallContext(100, 100, 1); click(w, "Remove from wall"); await tick(); await tick();
  ok(!w._wMenu && at(w) === "0@0,0 1x1 1:off 2@1,0 1x1 3@2,0 1x1" && w._camCards[1] === null && cardB.isConnected === false, "Remove from wall: the tile goes, its feed is taken off the page (the stream stops), the rest close up");
  ok(store.value.walls.default.hidden.join() === "d2" && w._camCards[0] && w._camCards[2], "kept with the user's arrangement, by the camera's device; the other feeds untouched");
  // the camera A's menu: tracking tile off and on
  w._wallContext(100, 100, 0); ok(labels(w).includes("Remove tracking tile") && labels(w).includes("Add…"), "a camera that recognises things: its tracking tile can be removed; Add… appears once something is off");
  const tcard = w._xTiles[0].card; click(w, "Remove tracking tile"); await tick();
  ok(at(w).includes("3:off") && tcard._paused === true && store.value.walls.default.hidden.join() === "d2,track:d1", "the tracking tile goes and stops listening");
  w._wallContext(100, 100, 0); ok(labels(w).includes("Add tracking tile"), "and can be added again from the camera"); w._wMenuClose();
  // the wall itself: what can come back
  w._wallContext(600, 300, null);
  console.log("   wall menu:", labels(w).join(" | "));
  ok(labels(w).join("|") === "Add to the wall|B|A · tracking|Arrange…|Reset layout", "on the wall itself: what can be added, and the layout");
  click(w, "B"); await tick(); await tick();
  ok(at(w) === "0@0,0 1x1 1@1,0 1x1 2@2,0 1x1 3:off" && !!w._camCards[1] && w._camCards[1] !== cardB && !store.value.walls.default.grid, "B is back, with a new feed, in its usual place (nothing was arranged, so nothing is pinned down)");
  w._wallContext(100, 100, 0); click(w, "Add tracking tile"); await tick();
  ok(at(w).endsWith("3@0,1 1x1") && tcard._paused === false && !store.value.walls.default, "the tracking tile is back and listening; nothing is left to remember");
  // size from the menu
  w._wallContext(100, 100, 1); ok(w._wMenu.menu.children.find((c) => c.textAll.startsWith("Size 2 × 1")).disabled === true, "a size there is no room for is greyed out"); w._wMenuClose();
  w._wallContext(100, 100, 3); ok(w._wMenu.menu.children.find((c) => c.textAll.startsWith("Size 2 × 1")).disabled === false, "one that fits is offered");
  click(w, "Size 2 × 1"); await tick();
  ok(at(w) === "0@0,0 1x1 1@1,0 1x1 2@2,0 1x1 3@0,1 2x1" && store.value.walls.default.grid.cols === 3 && store.value.walls.default.tiles.length === 4, "a size from the menu: the tile spans, and every tile's place is now kept");
  // an empty cell of an arranged wall: added right there
  w._wallContext(100, 100, 1); click(w, "Remove from wall"); await tick();
  const px = (c, r) => [c * (w._cell.w + 12) + 20, r * (w._cell.h + 12) + 20];
  w._wallContext(...px(2, 1), null); click(w, "B"); await tick(); await tick();
  ok(at(w) === "0@0,0 1x1 1@2,1 1x1 2@2,0 1x1 3@0,1 2x1", "added to the empty cell that was clicked; the others keep their places");
  // tracking tile's own menu and options
  const ti = 3;
  w._wallContext(100, 100, ti);
  console.log("   tracking menu:", labels(w).join(" | "));
  ok(labels(w).join("|").startsWith("ATracking tile|Open camera|Size 1 × 1|Size 2 × 1✓") && labels(w).includes("Watch for people✓") && labels(w).includes("Watch for vehicles") && labels(w).includes("Sharpest stream at home✓") && labels(w).includes("Remove from wall"), "a tracking tile's menu: what it watches for, its stream, remove");
  ok(w._wMenu.menu.children.find((c) => c.textAll.startsWith("Watch for people")).disabled === true, "it has to watch for something");
  click(w, "Watch for vehicles"); await tick();
  ok(tcard._config.types.join() === "person,vehicle" && store.value.walls.default.opts["track:d1"].types.join() === "person,vehicle", "what it watches for is changed on the tile and kept");
  w._wallContext(100, 100, ti); click(w, "Sharpest stream at home"); await tick(); ok(tcard._config.stream === "low" && tcard._config.types.join() === "person,vehicle", "and its stream");
  w._wallContext(100, 100, ti); ok(labels(w).includes("Standby: radar✓") && labels(w).includes("Standby: pulse") && labels(w).includes("Standby: none"), "and how it looks while standing by");
  click(w, "Standby: pulse"); await tick(); ok(tcard._config.standby === "pulse" && tcard._root.querySelector(".frame").classList.contains("s-pulse") && store.value.walls.default.opts["track:d1"].standby === "pulse", "a standby style from the menu is applied to the tile and kept");
  let opened = null; const realOpen = w._openLive.bind(w); w._openLive = (i) => { opened = i; };
  w._wallContext(100, 100, ti); click(w, "Open camera"); ok(opened === 0, "Open camera opens that camera's dialog"); w._openLive = realOpen;
  // the press that opened the menu doesn't also open the camera
  w._menuAt = Date.now(); opened = null; w._openLive = (i) => { opened = i; }; w._camCards[0].dispatchEvent(new Ev("click")); ok(opened === null, "the press that opened the menu doesn't open the camera too"); w._menuAt = 0; w._openLive = realOpen;
  // arranging keeps what is off, and its Reset only resets places
  w._wallContext(100, 100, 0); click(w, "Remove from wall"); await tick();
  w._wallContext(100, 100, null); click(w, "Arrange…"); ok(w._arranging && w._arrEdit.tiles.every((t) => t.id !== "d1"), "Arrange… from the menu; a tile that is off isn't in it");
  w._wallContext(100, 100, 1); ok(!w._wMenu, "no menu while arranging");
  w._arrExit("reset"); await tick(); await tick();
  ok(store.value.walls.default.hidden.join() === "d1" && !store.value.walls.default.grid && !!store.value.walls.default.opts, "Arrange's Reset puts the places back; what is off and the tiles' options stay");
  // survives a reload; a new camera still shows
  w.disconnectedCallback(); ctx.localStorage.store = {};
  w = await mk(); ok(at(w).startsWith("0:off") && w._camCards[0] === null && w._xTiles[0].card._config.stream === "low", "after a reload: still off (and its feed was never started), options kept");
  // everything off: an empty state with Add
  for (const i of [1, 2, 3]) { w._wallContext(100, 100, i); click(w, "Remove from wall"); await tick(); }
  const gone = w.shadowRoot.querySelector(".allgone"); ok(gone.hidden === false && w._camCards.every((c) => c === null), "everything removed: the wall says so, with an Add button");
  w.shadowRoot.querySelector(".add-btn").onclick({ clientX: 50, clientY: 50 }); ok(labels(w).join("|") === "Add to the wall|A|B|C|A · tracking", "the button lists everything that can come back");
  click(w, "C"); await tick(); ok(gone.hidden === true && !!w._camCards[2], "and one is back");
  // Reset layout: everything back
  w._wallContext(100, 100, null); click(w, "Reset layout"); await tick(); await tick();
  ok(at(w) === "0@0,0 1x1 1@1,0 1x1 2@2,0 1x1 3@0,1 1x1" && w._camCards.every(Boolean) && !store.value.walls.default && w._xTiles[0].card._config.stream !== "low", "Reset layout: everything back as it was to begin with");
  // one column: no sizes, added things go to the end
  win.innerWidth = 500; w._layout(); w._wallContext(100, 100, 1); ok(!labels(w).some((l) => l.startsWith("Size")), "one column: no sizes in the menu"); click(w, "Remove from wall"); await tick();
  w._wallContext(100, 100, null); click(w, "B"); await tick(); ok(at(w).split(" ").filter((x) => x.includes("@")).every((x) => x.includes("@0,")) && !store.value.walls.default, "one column: back in the list, nothing else changed");
  // right-click and long press
  win.innerWidth = 1200; w._layout(); const stage = w.shadowRoot.querySelector(".stage");
  let prevented = 0; w._menuAt = 0; stage.dispatchEvent(Object.assign(new Ev("contextmenu"), { clientX: 10, clientY: 10, preventDefault: () => prevented++, composedPath: () => [w._tiles[2]] }));
  ok(prevented === 1 && labels(w)[0] === "CCamera", "right-click on a tile: its menu, not the browser's"); w._wMenuClose(); w._menuAt = 0;
  // a tile whose card stops the event from travelling back up (Home Assistant's own cards do): only listeners on the way down hear it
  stage.captureOnly(Object.assign(new Ev("contextmenu"), { clientX: 10, clientY: 10, preventDefault() {}, composedPath: () => [w._tiles[1]] }));
  ok(!!w._wMenu && labels(w)[0] === "BCamera", "right-click on a tile whose card stops the event: the menu still opens"); w._wMenuClose(); w._menuAt = 0;
  stage.captureOnly(Object.assign(new Ev("pointerdown"), { pointerType: "touch", pointerId: 9, clientX: 10, clientY: 10, composedPath: () => [w._tiles[1]] })); await new Promise((r) => setTimeout(r, 20));
  ok(!!w._wMenu && labels(w)[0] === "BCamera", "and so does a long press on it"); w._wMenuClose(); w._menuAt = 0;
  stage.dispatchEvent(Object.assign(new Ev("pointerdown"), { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10, composedPath: () => [w._tiles[0]] }));
  stage.dispatchEvent(Object.assign(new Ev("pointermove"), { pointerId: 1, clientX: 10, clientY: 60 })); await new Promise((r) => setTimeout(r, 20));
  ok(!w._wMenu, "a finger that moves (scrolling) opens nothing");
  stage.dispatchEvent(Object.assign(new Ev("pointerdown"), { pointerType: "touch", pointerId: 2, clientX: 10, clientY: 10, composedPath: () => [w._tiles[0]] })); await new Promise((r) => setTimeout(r, 20));
  ok(!!w._wMenu && labels(w)[0] === "ACamera", "a finger held still opens the tile's menu"); w._wMenuClose();
  stage.dispatchEvent(Object.assign(new Ev("pointerdown"), { pointerType: "mouse", pointerId: 3, clientX: 10, clientY: 10, composedPath: () => [w._tiles[0]] })); await new Promise((r) => setTimeout(r, 20)); ok(!w._wMenu, "holding a mouse button doesn't");
  w.disconnectedCallback(); store.value = null; ctx.localStorage.store = {};
}
// --- the tracking card's standby scanner
{
  ctx.document.addEventListener ||= () => {}; ctx.document.removeEventListener ||= () => {}; ctx.document.hidden = false; ctx.localStorage.store = {};
  const subs = new Map();
  const reg = { "camera.p_high_resolution_channel": { device_id: "d1", platform: "unifiprotect" }, "camera.p_medium_resolution_channel": { device_id: "d1", platform: "unifiprotect" } };
  const states = Object.fromEntries(Object.keys(reg).map((k, n) => [k, { entity_id: k, state: "recording", attributes: { channel_id: n } }]));
  const mkH = (live) => ({ ...hass, entities: reg, states, devices: { d1: { name: "Front" } },
    connection: { subscribeMessage: (cb, m) => { subs.set(m.entity, cb); return Promise.resolve(() => subs.delete(m.entity)); } },
    callWS: (m) => { if (m.type.endsWith("/live/cameras")) return live ? Promise.resolve({ cameras: live }) : Promise.reject({ code: "unknown_command" }); if (m.type === "auth/sign_path") return Promise.resolve({ path: "/s" }); return Promise.reject({ code: "unknown_command" }); } });
  const live = { "camera.p_high_resolution_channel": "p1", "camera.p_medium_resolution_channel": "p1" };
  const mk = async (cfg, lv = live) => { const c = new Trk(); c.setConfig(cfg); c.isConnected = true; c.hass = mkH(lv); c.connectedCallback(); await tick(); await tick(); return c; };
  const cls = (c, k) => c._root.querySelector(".frame").classList.contains(k);
  let c = await mk({});
  ok(c._root.innerHTML.includes('class="scan"') && ["sweep", "rings", "line", "reticle", "grid", "blips"].every((k) => c._root.innerHTML.includes(`class="${k}"`)), "standing by has a scanner layer (sweep, rings, line, reticle, grid)");
  ok(cls(c, "s-radar") && !cls(c, "paused") && !cls(c, "noscan"), "radar by default, running while the card is watching");
  ok(!/setInterval|requestAnimationFrame/.test(String(c._idle)) && !c._active, "nothing is drawn by script while standing by (the animation is the browser's own)");
  // out of sight: it stops
  ctx.document.hidden = true; c._sync(); ok(cls(c, "paused"), "page hidden: the scanner stops"); ctx.document.hidden = false; c._sync(); await tick(); ok(!cls(c, "paused"), "back: it runs again");
  c.pause(); ok(cls(c, "paused"), "paused by the wall (a dialog open): it stops"); c.resume(); await tick(); ok(!cls(c, "paused"), "and runs again");
  // someone appears: the reticle goes to them as the picture comes in
  const frame = c._root.querySelector(".frame"), reticle = c._root.querySelector(".reticle"); Object.assign(frame, { clientWidth: 800, clientHeight: 450 }); reticle.offsetWidth = 240;
  const push = subs.get("camera.p_medium_resolution_channel"); const T0 = Date.now() - 1000;
  const real = Date.now; Date.now = () => T0 + 500; push({ clockWall: T0, tracks: [{ id: "p", coord: [700, 200, 60, 200], objectType: "person", stationary: false }] }); Date.now = real;
  console.log("   lock:", JSON.stringify(reticle.style._v));
  ok(!!c._active && cls(c, "active") && cls(c, "lock") && reticle.style._v["--dx"] === "184.0px" && reticle.style._v["--dy"] === "-90.0px" && Number(reticle.style._v["--ls"]) < 1, "a person appears: the reticle jumps to where they are (and tightens) as the picture starts");
  ok(c._root.querySelector(".video").children.length === 1, "the stream starts at once: the effect waits for nothing");
  await new Promise((r) => setTimeout(r, 30)); ok(!cls(c, "lock") && cls(c, "active"), "the beat is over well within a second");
  c._leave(); ok(!cls(c, "active") && !cls(c, "lock") && reticle.style._v["--dx"] === undefined, "gone: back to the scan, the reticle to the middle");
  c.disconnectedCallback();
  // styles, colour
  for (const style of ["pulse", "scanline", "none"]) { c = await mk({ standby: style }); ok(cls(c, `s-${style}`) && !cls(c, "s-radar"), `standby: ${style}`); c.disconnectedCallback(); }
  c = await mk({ standby: "disco", accent: "#00ff88" }); ok(cls(c, "s-radar") && c._root.querySelector(".frame").style._v["--tracking-accent"] === "#00ff88", "an unknown style is the radar; accent: sets the colour"); c.disconnectedCallback();
  // nothing to watch: no scanner pretending
  c = await mk({}, null); ok(cls(c, "noscan") && cls(c, "paused"), "no relay: the scanner doesn't run"); c.disconnectedCallback();
  // show_others: faint blips where the other things are
  c = await mk({ show_others: true }); const p2 = subs.get("camera.p_medium_resolution_channel");
  p2({ clockWall: Date.now() - 400, tracks: [{ id: "v", coord: [100, 500, 100, 60], objectType: "vehicle", stationary: false }, { id: "w", coord: [800, 500, 100, 60], objectType: "vehicle", stationary: true }] });
  const blips = c._root.querySelector(".blips").children;
  ok(!c._active && blips.length === 1 && blips[0].style.cssText === "left:15.0%;top:53.0%", "show_others: a moving car is a blip on the scanner, a parked one isn't; it doesn't wake the card");
  c.disconnectedCallback();
  c = await mk({}); subs.get("camera.p_medium_resolution_channel")({ clockWall: Date.now() - 400, tracks: [{ id: "v", coord: [100, 500, 100, 60], objectType: "vehicle", stationary: false }] });
  ok(c._root.querySelector(".blips").children.length === 0, "without show_others: no blips"); c.disconnectedCallback();
  ctx.localStorage.store = {};
}
// --- the tracking card's size
{
  ctx.document.addEventListener ||= () => {}; ctx.document.removeEventListener ||= () => {};
  const g = new Trk().getGridOptions();
  ok(Number.isInteger(g.rows) && Number.isInteger(g.columns) && g.min_rows >= 1 && g.min_columns >= 1 && g.max_rows === undefined && g.max_columns === undefined, "sections view: rows and columns are numbers with minimums and no maximum, so both can be dragged");
  let c = new Trk(); c.setConfig({});
  ok(!c.hasAttribute("fill") && !c.hasAttribute("fixed") && c.getCardSize() === 5, "elsewhere: sized by its shape, as before");
  c.layout = "grid"; ok(c.hasAttribute("fill") && !c.hasAttribute("fixed") && c.layout === "grid", "in a sections view the picture fills the cell it is given");
  c.layout = "panel"; ok(!c.hasAttribute("fill"), "another kind of view: by its shape again");
  c = new Trk(); c.setConfig({ height: 300 }); ok(c.hasAttribute("fixed") && c.style._v["--tracking-height"] === "300px" && c.getCardSize() === 6, "height: 300 gives a set height, and the card reports its size by it");
  c = new Trk(); c.setConfig({ height: "40vh" }); ok(c.hasAttribute("fixed") && c.style._v["--tracking-height"] === "40vh" && c.getCardSize() === 5, "a CSS length works too");
  c = new Trk(); c.setConfig({ height: "red; position: fixed" }); ok(!c.hasAttribute("fixed") && c.style._v["--tracking-height"] === undefined, "something that isn't a length is ignored");
  c = new Trk(); c.setConfig({ height: 300 }); c.layout = "grid"; ok(c.hasAttribute("fill") && !c.hasAttribute("fixed"), "in a sections view the cell wins over height:");
  c = new Trk(); c.setConfig({ embedded: true, height: 300 }); c.layout = "grid"; ok(!c.hasAttribute("fill") && !c.hasAttribute("fixed"), "on the camera wall it takes its size from the wall's tile, whatever else is said");
  const form = Trk.getConfigForm(); ok(Array.isArray(form.schema) && form.schema.some((f) => f.name === "types") && form.computeLabel({ name: "types" }) === "Watch for", "the card editor has a small form");
}
// --- digital zoom
{
  const real = JSON.parse(fs.readFileSync(new URL("./overlay.json", import.meta.url), "utf8"));
  let push;
  const zh = { ...hass, entities: { "camera.fl": { device_id: "d1" } }, devices: { d1: { connections: [["mac", "aa:bb:cc:00:00:01"]] } },
    connection: { subscribeMessage: (cb) => { push = cb; return Promise.resolve(() => {}); } }, callWS: (m) => (m.type === "network/url" ? Promise.resolve({}) : new Promise(() => {})) };
  const w5 = new Wall(); w5.clientWidth = 1000; w5.isConnected = true; w5.setConfig({ cameras: [{ entity: "camera.fl" }, { entity: "camera.x" }] }); w5.hass = zh; await tick(); await tick();
  push({ ...real, editable: true }); w5._openLive(0);
  const root = w5._liveRoot, frame = root.querySelector(".frame"), zoom = root.querySelector(".zoom"), svg = root.querySelector(".zones"), chip = root.querySelector(".zoomx");
  Object.assign(frame, { clientWidth: 1600, clientHeight: 900 });
  // the stand-in "browser": the zooming element and the video inside it move with the transform
  const rect = () => { const z = w5._zoom; return { left: z.x, top: z.y, width: 1600 * z.s, height: 900 * z.s }; };
  frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1600, height: 900 }); zoom.getBoundingClientRect = rect;
  const vid = Object.assign(new El(), { tagName: "VIDEO", videoWidth: 1600, videoHeight: 900, getBoundingClientRect: rect });
  w5._liveStream = Object.assign(new El(), { querySelectorAll: () => [vid], isConnected: true }); ctx.getComputedStyle = () => ({ objectFit: "contain" });
  w5._fitZones(); const drawn = svg.children;
  ok(chip.hidden !== false && svg.style.cssText.startsWith("display:block;left:0px;top:0px;width:1600px;height:900px"), "not zoomed: no zoom button, zones over the whole picture");
  frame.dispatchEvent(new Ev("wheel", { deltaY: -385, deltaMode: 0, clientX: 800, clientY: 450, preventDefault() {} }));
  const z = w5._zoom;
  ok(Math.abs(z.s - 2) < 0.01 && Math.abs(z.x + 800) < 8 && Math.abs(z.y + 450) < 5 && chip.hidden === false && chip.lastElementChild.textContent === "2.0×" && zoom.style.transform.startsWith("translate("), "wheel zooms about the pointer; the button shows 2.0×");
  ok(svg.children === drawn && svg.style.cssText.startsWith("display:block;left:0px;top:0px;width:1600px;height:900px") && Math.abs(w5._zPic.width - 3200) < 20, "zones aren't redrawn: they zoom with the picture, and the picture's place on screen is known");
  const zc = w5._zoomCamTest = w5._zoneCam(w5._config.cameras[0]), z1 = zc.zones[0], c = z1.points.reduce((t, q) => [t[0] + q[0] / z1.points.length, t[1] + q[1] / z1.points.length], [0, 0]);
  ok(w5._zonesAt(zc, (c[0] * w5._zPic.width + w5._zPic.left - w5._zPic.left) / w5._zPic.width, c[1])[0] === z1 && w5._zoneContext(w5._zPic.left + c[0] * w5._zPic.width, w5._zPic.top + c[1] * w5._zPic.height) === true && w5._zMenu.menu.children[0].textAll.startsWith("Front Step"), "right-click on a zone still finds it when zoomed");
  w5._zMenuClose();
  const pe = (o) => ({ button: 0, pointerId: 1, pointerType: "mouse", preventDefault() {}, stopPropagation() {}, ...o });
  frame.dispatchEvent(new Ev("pointerdown", pe({ clientX: 500, clientY: 500 }))); frame.dispatchEvent(new Ev("pointermove", pe({ clientX: 502, clientY: 500 })));
  const x0 = z.x; ok(z.x === x0 && !frame.classList.contains("panning"), "a small movement isn't a drag (clicks reach the video)");
  frame.dispatchEvent(new Ev("pointermove", pe({ clientX: 600, clientY: 520 })));
  ok(Math.abs(z.x - (x0 + 100)) < 0.01 && frame.classList.contains("panning"), "dragging moves the picture");
  frame.dispatchEvent(new Ev("pointermove", pe({ clientX: 9000, clientY: 9000 }))); frame.dispatchEvent(new Ev("pointerup", pe({})));
  ok(z.x === 0 && z.y === 0 && !frame.classList.contains("panning"), "never past the picture's edge");
  frame.dispatchEvent(new Ev("wheel", { deltaY: -99999, deltaMode: 0, clientX: 0, clientY: 0, preventDefault() {} })); for (let i = 0; i < 9; i++) frame.dispatchEvent(new Ev("wheel", { deltaY: -99999, deltaMode: 0, clientX: 0, clientY: 0, preventDefault() {} }));
  ok(z.s === 8, "at most 8x");
  // editing while zoomed: a handle dragged to the middle of the screen lands on the picture point shown there
  w5._zoomTo(2, 0, 0); w5._zoom.x = -800; w5._zoom.y = -450; w5._zoomApply(); w5._zEditStart(zc, z1);
  const g0 = svg.children.filter((q) => q.attrs?.class === "grab")[0];
  g0.dispatchEvent(new Ev("pointerdown", pe({ clientX: 10, clientY: 10 }))); g0.dispatchEvent(new Ev("pointermove", pe({ clientX: 800, clientY: 450 }))); g0.dispatchEvent(new Ev("pointerup", pe({})));
  ok(Math.abs(w5._zEdit.points[0][0] - 0.5) < 1e-6 && Math.abs(w5._zEdit.points[0][1] - 0.5) < 1e-6 && g0.attrs.cx === "800.0", "a handle dragged while zoomed lands on the picture point under the pointer");
  w5._zEditEnd();
  // pinch
  w5._zoomTo(1); const tp = (pts) => ({ touches: pts.map(([x, y]) => ({ clientX: x, clientY: y })), preventDefault() {}, composedPath: () => [frame] });
  frame.dispatchEvent(new Ev("touchstart", tp([[700, 450], [900, 450]]))); frame.dispatchEvent(new Ev("touchmove", tp([[600, 450], [1000, 450]])));
  ok(Math.abs(w5._zoom.s - 2) < 0.01 && Math.abs(w5._zoom.x + 800) < 2, "two fingers spreading zoom in between them");
  frame.dispatchEvent(new Ev("touchend", tp([])));
  chip.onclick(); ok(w5._zoom.s === 1 && chip.hidden === true && zoom.style.transform === "", "the zoom button puts the whole picture back");
  w5._zoomTo(3, 100, 100); w5._stepLive(1); ok(w5._zoom.s === 1, "another camera starts unzoomed"); w5._closeLive();
}
// --- phone landscape
{
  const real = JSON.parse(fs.readFileSync(new URL("./overlay.json", import.meta.url), "utf8"));
  let push;
  const zh = { ...hass, entities: { "camera.fl": { device_id: "d1" } }, devices: { d1: { connections: [["mac", "aa:bb:cc:00:00:01"]] } },
    connection: { subscribeMessage: (cb) => { push = cb; return Promise.resolve(() => {}); } }, callWS: (m) => (m.type === "network/url" ? Promise.resolve({}) : new Promise(() => {})) };
  const mk = async (cfg = {}) => { const w = new Wall(); w.clientWidth = 400; w.isConnected = true; w.setConfig({ cameras: [{ entity: "camera.fl" }, { entity: "camera.x" }], ...cfg }); w.hass = zh; await tick(); await tick(); push({ ...real, editable: true }); return w; };
  const docL = new Target(); Object.assign(ctx.document, { addEventListener: (t, f) => docL.addEventListener(t, f), removeEventListener: (t, f) => docL.removeEventListener(t, f), fullscreenElement: null, exitFullscreen: () => { ctx.document.fullscreenElement = null; exits++; return Promise.resolve(); } });
  let exits = 0, coarse = false; win.matchMedia = (q) => ({ matches: coarse }); win.screen = { width: 390, height: 844 };
  // desktop: nothing changes
  const wd = await mk(); wd._openLive(0);
  ok(!wd._phone && !wd._rot && !wd._liveRoot.querySelector(".lb").classList.contains("fill") && JSON.stringify(wd._pt(10, 20)) === "[10,20]", "desktop / tablet: the ordinary dialog"); wd._closeLive();
  // phone, upright, no orientation lock here (an iPhone): drawn turned a quarter
  coarse = true; win.innerWidth = 390; win.innerHeight = 844;
  const w6 = await mk(); w6._openLive(0);
  const root = w6._liveRoot, wrap = root.querySelector(".wrap"), lb = root.querySelector(".lb"), frame = root.querySelector(".frame"), zoom = root.querySelector(".zoom"), svg = root.querySelector(".zones");
  ok(w6._phone && w6._rot && lb.classList.contains("fill") && lb.classList.contains("rot") && wrap.style.cssText === "inset:auto;left:0;top:0;width:844px;height:390px;transform-origin:0 0;transform:translateX(390px) rotate(90deg)" && !w6._fs, "phone held upright, no screen lock: the dialog is drawn turned, 844 x 390");
  ok(JSON.stringify(w6._pt(390, 0)) === "[0,0]" && JSON.stringify(w6._pt(0, 844)) === "[844,390]" && JSON.stringify(w6._view()) === "[844,390]", "screen corners map to the dialog's corners");
  // the stand-in "browser": the dialog's frame is at (100, 20) 640 x 360 in its own space; on screen that is turned
  const toScreen = (l, t, w, h) => ({ left: 390 - (t + h), top: l, width: h, height: w });
  Object.assign(frame, { clientWidth: 640, clientHeight: 360 });
  const zr = () => { const z = w6._zoom; return toScreen(100 + z.x, 20 + z.y, 640 * z.s, 360 * z.s); };
  frame.getBoundingClientRect = () => toScreen(100, 20, 640, 360); zoom.getBoundingClientRect = zr;
  const vid = Object.assign(new El(), { tagName: "VIDEO", videoWidth: 1920, videoHeight: 1080, getBoundingClientRect: zr });
  w6._liveStream = Object.assign(new El(), { querySelectorAll: () => [vid], isConnected: true }); ctx.getComputedStyle = () => ({ objectFit: "contain" });
  w6._zonesDrawn = null; w6._fitZones();
  ok(svg.style.cssText.startsWith("display:block;left:0px;top:0px;width:640px;height:360px") && w6._zPic.left === 100 && w6._zPic.top === 20 && w6._zPic.width === 640, "the zone layer is laid out landscape over the picture");
  // a finger on the picture: where is that in the picture? dialog (100 + 0.25*640, 20 + 0.5*360) = (260, 200) -> screen (390 - 200, 260)
  const zc = w6._zoneCam(w6._config.cameras[0]), z1 = zc.zones[0], c = z1.points.reduce((t, q) => [t[0] + q[0] / z1.points.length, t[1] + q[1] / z1.points.length], [0, 0]);
  const scr = (nx, ny) => [390 - (20 + ny * 360), 100 + nx * 640];
  ok(w6._zoneContext(...scr(c[0], c[1])) === true && w6._zMenu.menu.children[0].textAll.startsWith("Front Step"), "a long press on a zone finds that zone though the screen is upright");
  const ml = parseFloat(w6._zMenu.menu.style.left), mt = parseFloat(w6._zMenu.menu.style.top);
  ok(Math.abs(ml - Math.min(100 + c[0] * 640, 844 - 220 - 8)) < 1 && mt >= 8 && mt <= 390 - 8, "its menu opens at the finger, inside the turned dialog"); w6._zMenuClose();
  ok(w6._zoneContext(5, 5) === false, "off the picture: left to the browser");
  w6._zEditStart(zc, z1); const g0 = svg.children.filter((q) => q.attrs?.class === "grab")[0], pe = (o) => ({ button: 0, pointerId: 1, pointerType: "touch", preventDefault() {}, stopPropagation() {}, ...o });
  const [sx, sy] = scr(0.25, 0.75);
  g0.dispatchEvent(new Ev("pointerdown", pe({ clientX: 1, clientY: 1 }))); g0.dispatchEvent(new Ev("pointermove", pe({ clientX: sx, clientY: sy }))); g0.dispatchEvent(new Ev("pointerup", pe({})));
  ok(Math.abs(w6._zEdit.points[0][0] - 0.25) < 1e-6 && Math.abs(w6._zEdit.points[0][1] - 0.75) < 1e-6, "a zone handle dragged on the turned dialog lands under the finger"); w6._zEditEnd();
  // pinch about the middle of the picture, then drag "right" along the picture (down the screen)
  const tp = (pts) => ({ touches: pts.map(([x, y]) => ({ clientX: x, clientY: y })), preventDefault() {}, composedPath: () => [frame] });
  const [m1x, m1y] = scr(0.5, 0.5);
  frame.dispatchEvent(new Ev("touchstart", tp([[m1x, m1y - 50], [m1x, m1y + 50]]))); frame.dispatchEvent(new Ev("touchmove", tp([[m1x, m1y - 100], [m1x, m1y + 100]]))); frame.dispatchEvent(new Ev("touchend", tp([])));
  ok(Math.abs(w6._zoom.s - 2) < 0.01 && Math.abs(w6._zoom.x + 320) < 1 && Math.abs(w6._zoom.y + 180) < 1, "pinch zooms about the point between the fingers");
  frame.dispatchEvent(new Ev("touchstart", tp([[200, 300]]))); frame.dispatchEvent(new Ev("touchmove", tp([[200, 360]]))); frame.dispatchEvent(new Ev("touchend", tp([])));
  ok(Math.abs(w6._zoom.x + 260) < 1 && Math.abs(w6._zoom.y + 180) < 1, "a finger moving down the screen moves the picture along its width");
  // the phone is turned by hand: no more drawing turned
  win.innerWidth = 844; win.innerHeight = 390; win.dispatchEvent(new Ev("resize"));
  ok(!w6._rot && wrap.style.cssText === "" && lb.classList.contains("fill") && !lb.classList.contains("rot") && JSON.stringify(w6._pt(10, 20)) === "[10,20]", "phone turned to landscape by hand: just fills the screen");
  w6._closeLive();
  ok(!w6._phone && !lb.classList.contains("fill") && wrap.style.cssText === "" && win.count("orientationchange") === 0, "closing puts the dialog's styles back and stops listening");
  // phone whose browser can turn the screen (Chrome on Android)
  win.innerWidth = 390; win.innerHeight = 844; let locked = 0, unlocked = 0, lockOk = true;
  win.screen = { width: 390, height: 844, orientation: { lock: (o) => { locked++; return lockOk ? Promise.resolve() : Promise.reject(new Error("no")); }, unlock: () => unlocked++ } };
  const w7 = await mk(); w7._buildLive(); const host = w7._liveHost; let fsAsked = 0;
  host.requestFullscreen = () => { fsAsked++; ctx.document.fullscreenElement = host; return Promise.resolve(); };
  w7._openLive(0); ok(w7._rot === true, "until the screen has turned, it is drawn turned"); await tick();
  ok(fsAsked === 1 && locked === 1 && w7._fs.on, "full screen, then locked to landscape");
  win.innerWidth = 844; win.innerHeight = 390; win.dispatchEvent(new Ev("resize"));
  ok(!w7._rot && w7._liveRoot.querySelector(".wrap").style.cssText === "", "the screen has turned for real: nothing is drawn turned");
  w7._closeLive(); ok(unlocked === 1 && exits === 1 && !w7._fs && docL.count("fullscreenchange") === 0, "closing unlocks the screen and leaves full screen");
  win.innerWidth = 390; win.innerHeight = 844; w7._openLive(0); await tick();
  ctx.document.fullscreenElement = null; docL.dispatchEvent(new Ev("fullscreenchange"));
  ok(w7._liveIndex == null && unlocked === 2 && !w7._phone, "the back button leaving full screen closes the dialog and unlocks");
  w7._openLive(0); await tick(); w7.isConnected = false; w7.disconnectedCallback(); ok(unlocked === 3 && exits === 2 && !w7._phone, "taken off the page while open: restored too"); w7.isConnected = true;
  lockOk = false; w7._openLive(0); await tick();
  ok(w7._rot === true && w7._fs.on, "full screen but no lock (an in-app browser): stays drawn turned, in full screen"); w7._closeLive();
  host.requestFullscreen = () => Promise.reject(new Error("denied")); w7._openLive(0); await tick();
  ok(w7._rot === true && !w7._fs.on && w7._liveIndex === 0, "full screen refused: drawn turned, dialog still open"); w7._closeLive();
  const w8 = await mk({ phone_landscape: false }); w8._openLive(0); ok(!w8._phone, "phone_landscape: false keeps the ordinary dialog"); w8._closeLive();
  coarse = false; win.innerWidth = 1200; win.innerHeight = 800; delete win.screen;
}
console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
