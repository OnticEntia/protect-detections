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
 *   warm: false                             # true: the live picture while standing by
 *                                           # too (dimmed, under the scanner), so it is
 *                                           # there at once when someone appears. Costs
 *                                           # that stream, and decoding it, all the time
 *                                           # the card is on screen
 *   stream: auto                            # auto (the best stream at home, the light
 *                                           # one elsewhere) | high | low
 *   max_zoom: 4                             # how far it zooms in, at most
 *   aspect_ratio: 1.7778                    # width / height of the card's picture
 *   height: 300px                           # instead: a set height (px, or a CSS length)
 *   live_delay: 700                         # ms the picture is held back so the boxes
 *                                           # line up with it (see protect-live.js)
 *   live_offset: 0                          # ms to place the boxes later (+) / earlier (-)
 *   source: auto                            # whose positions: auto (the Protect Tracker
 *                                           # integration's when it is installed, else
 *                                           # Protect's own) | local (what Protect
 *                                           # Tracker's own model sees, whether or not
 *                                           # Protect reports it) | protect
 *   box_style: reticle                      # how the followed thing is marked: reticle
 *                                           # (the scanner's own brackets close onto it,
 *                                           # follow it and let it go) | plain (a box)
 *   face_pip: auto                          # auto: while a person is followed and their
 *                                           # face is reported, the face enlarged in a
 *                                           # corner | off
 *   split: off                              # 2, 3 or 4: with that many things of a watched
 *                                           # kind on the move, a pane for each (at most),
 *                                           # each zoomed in on its own; off: one view, on
 *                                           # the subject
 *   live_debug: false                       # true: write on the picture how the boxes
 *                                           # are being timed
 *   sound: none                             # a sound when it starts following someone:
 *                                           # ping | chirp | sweep | lock (none: silent)
 *   sound_volume: 0.5                       # 0 to 1
 *   sound_gap: 25                           # seconds it stays quiet after sounding
 *
 * Size: in a sections view the card can be dragged to any width and height
 * and its picture fills the cell (the whole picture always shows: with bars
 * if the cell has another shape). Elsewhere it takes its height from
 * `aspect_ratio`, or from `height:` if that is set.
 *
 * camera-wall-card shows one of these per camera that recognises things, as
 * a tile among its feeds (its config `tracking:`).
 *
 * Whom it follows. The thing that woke it is its subject, and the view
 * stays on that one alone: through its standing still, through short
 * losses, and through its reports going on under another id (Protect's and
 * Protect Tracker's can differ). Things standing still never wake the card,
 * never become the subject and never widen the view: a thing counts as
 * moving while Protect said so in the last two seconds. When the subject has
 * gone and something else of a watched kind is moving, the view goes over
 * to the nearest such thing, once; a tap on another box makes that one the
 * subject. With nothing moving left it stands by again after `linger`,
 * whatever is parked in view. A subject that is not a person and hasn't
 * moved for `linger` seconds has parked, and is let go.
 *
 * Whether a thing moves is judged from its box (protect-live.js), not from
 * what its reports say alone. And a subject is followed by its id only as
 * far as that makes sense: a tracker can hand a passing car's id to a
 * parked car it drove past. So where things stand is remembered, and a
 * subject that comes to rest on such a place, or jumps across the picture
 * from one report to the next, counts as lost there and then, not followed.
 *
 * One look, from standing by to following and back (`box_style: reticle`).
 * The scanner's reticle and the box round the followed thing are the same
 * brackets, in the card's accent colour:
 *   acquire  on waking, the reticle flies to the thing and takes its shape;
 *            the sweep and rings fall in towards it; the brackets close on
 *            it as the picture comes up (with the sound, if one is set)
 *   track    the brackets follow it, a tag on them saying what it is, how
 *            sure, and where (zones). Solid edges for a box made on this
 *            machine, dashed for one of UniFi Protect's, dotted for one
 *            only Protect Tracker has seen so far (its local mode: Protect
 *            hasn't reported it); dimmer when it
 *            stands still; breathing gently on a sure one. A face found on
 *            it is a small bracket set; other moving things of a watched
 *            kind are faint brackets in their kind's colour
 *   lost     the brackets stay where it was and pulse while the card waits
 *   hand-over  another thing becomes the subject: the brackets move across
 *   release  standing by again: the reticle opens out from where the
 *            brackets were, back to its place, as the scanner returns
 * All of it is CSS on a handful of elements (nothing drawn per frame beyond
 * placing the boxes, and nothing at all while standing by out of sight). For
 * those who ask for less motion there are no flights: things are where they
 * belong at once.
 *
 * The face inset (`face_pip: auto`). While the card follows a person whose
 * face is reported (by Protect Tracker as a track of that person, or by
 * Protect as a face inside the person's box), the face is shown enlarged in
 * a corner, moving with the picture. It is the playing video itself, cut
 * out onto a canvas each frame, as the panes of a split view are: no second
 * stream. Nothing of it is kept: no picture is read back from the canvas,
 * saved, or sent anywhere, and it is gone with the frame. It keeps to the
 * corner the person is furthest from, keeps its place for two seconds when
 * the face is not reported (a head turned), and fades when there has been
 * none for longer or the person is lost. How sharp it is depends on the
 * stream: a face 3 % of the picture wide is about 115 px across on a 4K
 * main stream and about 38 px on a 720p one (`stream: high` is what it
 * wants; `auto` uses the main stream on the home network). Not in a split
 * view, and never for anything but a person.
 *
 * Split view (`split: 2` to `4`). When a second thing of a watched kind has
 * been moving for a second, the picture splits into panes, one for each
 * (up to the number given), each zoomed in on its own thing. The panes are
 * drawn from the one stream that is playing: copies of its picture, cut
 * out, on canvases (no second stream, on WebRTC and HLS alike). A thing
 * keeps its pane while it is there; one that goes is given a moment, and a
 * new one takes a free pane or the place of one just gone. With one thing
 * left for a second and a half it is one view again, on that thing. Parked
 * things get no pane, and a small card (under 260 x 150 px) never splits.
 *
 * Standing by, no video is playing: the card listens to where Protect says
 * things are (while it is on screen and the page is in front; not otherwise)
 * and shows a still picture now and then. Tapping it opens the camera.
 * With the Protect Zones integration it also names the zone the person is in.
 *
 * The sound is made in the browser (Web Audio: no sound files). It plays once
 * when the card goes from standing by to following, and not again until it
 * has stood by again and `sound_gap` has passed; several cards waking together
 * make one sound. A browser plays no sound on a page that hasn't been clicked
 * or typed on yet: the speaker mark in the card's corner says so until it has,
 * and a click on the mark turns the sound off or on for this browser.
 *
 * Part of the Protect Detections integration, which serves it and loads it
 * into Home Assistant by itself (no dashboard resource to add).
 */

// Shared with the other cards here (served from the same folder).
import { findProtectCameras } from "./protect-cameras.js";
import { LiveTracks, LIVE_COLORS, LIVE_SOURCES, subscribeLive, deepFind, pictureBox } from "./protect-live.js";

const KINDS = { person: ["Person", "people"], vehicle: ["Vehicle", "vehicles"], animal: ["Animal", "animals"], package: ["Package", "packages"] };
const STANDBY = ["radar", "pulse", "scanline", "none"]; // how standing by looks
const LOCK_MS = 520; // the "there they are" beat as the picture comes in
const HOLD_MS = 1500; // the view stays this long where they were last seen, before easing out
const EASE_MS = 350;
// The subject: the one thing the card stays on.
const MOVING_MS = 2000; // a thing counts as on the move while a report said so this recently
const SWITCH_MS = 900; // the subject gone this long: another moving thing may be taken instead
const HANDOVER_MS = 1500; // the subject's reports going on under another id: taken up within this, where it was
const STOOD_MS = 3000; // a thing that hasn't moved for this long is standing: where it stands is remembered
const SPOT_KEEP_MS = 15000; // ... for this long after it was last seen there
const SETTLED_MS = 800; // the subject still for this long on such a place: it is that parked thing, not the subject
const BAN_MS = 5000; // an id the subject was lost on isn't taken up again for this long
// Split view (`split`): a pane each for several things on the move.
const SPLIT_IN_MS = 1000; // a second thing must be moving this long before the view splits
const SPLIT_OUT_MS = 1500; // and only one left this long before it is one view again
const SPLIT_MIN = [260, 150]; // a card smaller than this (px) stays one view
const BOX_STYLES = ["reticle", "plain"];
const HOP_MS = 300; // the brackets moving over to another subject
const CLOSE_MS = 380; // the brackets closing onto a subject just acquired
const RELEASE_MS = 450; // the reticle opening back out to its place
// The face inset (`face_pip`): the followed person's face, enlarged, in a corner.
const PIP_HOLD_MS = 2000; // the face not reported (a head turned): its place is kept this long
const PIP_PAD = 1.7; // the cut-out is this many times the face's larger side (some room round it)
const PIP_MIN = 150; // a card smaller than this (px, its shorter side) has no inset
const PIP_CORNER_MS = 1200; // the inset stays in its corner at least this long
const FAIL_MS = 12000; // no picture this long after starting: say so
const LAST_KEY = "protect-tracking-card:last:";

// ---------------------------------------------------------------- sound
const SOUNDS = { ping: "Rising ping", chirp: "Scanner chirp", sweep: "Soft sweep", lock: "Lock-on" };
const SOUND_GAP_S = 25; // a card that has sounded stays quiet this long, however often it wakes (sound_gap)
const CHORD_MS = 1500; // cards waking within this of each other: one sound
const MUTE_KEY = "protect-tracking-card:muted";

// What each sound is made of: tones, each [wave, from Hz, to Hz, starts at s,
// lasts s, level 0-1, and for a softened one: low-pass from Hz, to Hz].
function soundVoices(name) {
  if (name === "ping") return [["sine", 620, 1480, 0, 0.55, 0.9], ["sine", 1240, 2960, 0, 0.3, 0.22]];
  if (name === "chirp") return [["triangle", 980, 1040, 0, 0.09, 0.8], ["triangle", 1480, 1560, 0.11, 0.16, 0.8]];
  if (name === "sweep") return [["sawtooth", 180, 540, 0, 0.75, 0.45, 300, 3200], ["sine", 360, 1080, 0, 0.75, 0.35]];
  if (name === "lock") return [["square", 740, 740, 0, 0.06, 0.3, 2400, 2400], ["square", 990, 990, 0.08, 0.06, 0.3, 2400, 2400], ["square", 1320, 1320, 0.16, 0.06, 0.3, 2400, 2400], ["sine", 1760, 1760, 0.24, 0.42, 0.55]];
  return null;
}

// One for the page, shared by every tracking card on it.
const Sound = {
  ctx: null,
  gesture: false, // the page has been clicked or typed on (browsers play nothing before)
  gestureAt: 0,
  lastAt: 0,
  cards: new Set(),

  unlocked() {
    const ua = typeof navigator !== "undefined" && navigator.userActivation;
    return this.gesture || !!(ua && ua.hasBeenActive) || !!(this.ctx && this.ctx.state === "running");
  },

  muted() {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch (e) {
      return !!this._muted;
    }
  },

  setMuted(on) {
    this._muted = !!on;
    try {
      localStorage.setItem(MUTE_KEY, on ? "1" : "0");
    } catch (e) {}
    this.tell();
  },

  tell() {
    for (const card of this.cards) card._mark();
  },

  watch(card) {
    this.cards.add(card);
    if (this._on || this.gesture) return;
    this._on = () => {
      this.gesture = true;
      this.gestureAt = Date.now();
      for (const t of ["pointerdown", "keydown"]) window.removeEventListener(t, this._on, true);
      this._on = null;
      if (this.ctx && this.ctx.state === "suspended") Promise.resolve(this.ctx.resume()).catch(() => {});
      this.tell();
    };
    for (const t of ["pointerdown", "keydown"]) window.addEventListener(t, this._on, true);
  },

  unwatch(card) {
    this.cards.delete(card);
  },

  // Plays it; false when it can't or mustn't (turned off here, the page not
  // yet clicked on, another card sounding right now, no Web Audio).
  // `preview` (the editor, the speaker mark): heard whatever just sounded,
  // and it doesn't count as the card having sounded.
  play(name, volume, preview) {
    const voices = soundVoices(name);
    if (!voices || this.muted() || !this.unlocked()) return false;
    const now = Date.now();
    if (!preview && now - this.lastAt < CHORD_MS) return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      const ctx = (this.ctx = this.ctx || new AC());
      if (ctx.state === "suspended") Promise.resolve(ctx.resume()).catch(() => {});
      const vol = volume == null || volume === "" || !Number.isFinite(Number(volume)) ? 0.5 : Math.max(0, Math.min(1, Number(volume)));
      const out = ctx.createGain();
      out.gain.value = vol * 0.5;
      out.connect(ctx.destination);
      const t0 = ctx.currentTime + 0.03;
      for (const [wave, from, to, at, lasts, level, lpFrom, lpTo] of voices) {
        const t = t0 + at;
        const osc = ctx.createOscillator();
        osc.type = wave;
        osc.frequency.setValueAtTime(from, t);
        if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + lasts);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(level, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + lasts);
        let node = osc;
        if (lpFrom) {
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass";
          lp.frequency.setValueAtTime(lpFrom, t);
          if (lpTo !== lpFrom) lp.frequency.exponentialRampToValueAtTime(lpTo, t + lasts);
          node.connect(lp);
          node = lp;
        }
        node.connect(gain);
        gain.connect(out);
        osc.start(t);
        osc.stop(t + lasts + 0.05);
      }
    } catch (err) {
      return false;
    }
    if (!preview) this.lastAt = now;
    return true;
  },
};

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
  /* someone is there: the still stands in until the live picture plays, then
     goes. Only one picture at a time: the still fills the card and the live
     one is shown whole, so in a card of another shape than the camera's the
     still would show round the live picture's edges. */
  .active .snap { opacity: 1; filter: none; }
  .playing .snap { opacity: 0; visibility: hidden; transition: opacity .3s, visibility 0s .3s; }
  .zoomer { position: absolute; inset: 0; transform-origin: 0 0; will-change: transform; }
  /* the whole picture, whatever the frame's shape (bars beside or above it
     rather than a cut-off edge: nobody followed is ever outside it) */
  .video { position: absolute; inset: 0; display: grid; align-items: center; --video-max-height: 100cqh; }
  .video > * { width: 100%; }
  .zoomer { transition: opacity .45s ease .15s; }
  .frame:not(.active) .zoomer { opacity: 0; pointer-events: none; transition: opacity .3s; }
  /* warm: standing by, the stream that is running anyway is the picture
     behind the scanner, dimmed as the still is, and the still is put away
     (one picture at a time). It is fitted as when following (the whole
     picture), so that going from one to the other moves nothing. With
     standby: none it is the plain picture, not dimmed. */
  .frame.warmlive:not(.active) .zoomer { opacity: .55; filter: saturate(.7); }
  .frame.warmlive.s-none:not(.active) .zoomer { opacity: 1; filter: none; }
  .frame.warmlive:not(.active) .snap { opacity: 0; visibility: hidden; transition: opacity .3s, visibility 0s .3s; }
  .boxes { position: absolute; pointer-events: none; }
  .box { position: absolute; box-sizing: border-box; border: calc(2px * var(--k, 1)) solid var(--c, #fff); border-radius: calc(3px * var(--k, 1));
    pointer-events: auto; }
  .box.part { border-width: calc(1.5px * var(--k, 1)); border-radius: 50% / 45%; pointer-events: none; }
  .box.other { border-style: dashed; border-width: calc(1px * var(--k, 1)); opacity: .6; pointer-events: none; }
  .box.also { border-width: calc(1px * var(--k, 1)); opacity: .75; }
  .box .tag { display: none; }
  /* --- reticle style: the scanner's brackets are the box (--bc: their colour; --k keeps them the same on screen at any zoom) */
  .bs-reticle .box { border-color: transparent; border-radius: 0; --bc: var(--c, #fff); --bt: calc(2px * var(--k, 1)); --bl: 26%; }
  .bs-reticle .box.main { --bc: var(--tracking-accent, var(--primary-color, #e0102a)); }
  .bs-reticle .box::before { content: ""; position: absolute; inset: calc(-3px * var(--k, 1));
    background:
      linear-gradient(var(--bc), var(--bc)) top left / var(--bl) var(--bt) no-repeat, linear-gradient(var(--bc), var(--bc)) top left / var(--bt) var(--bl) no-repeat,
      linear-gradient(var(--bc), var(--bc)) top right / var(--bl) var(--bt) no-repeat, linear-gradient(var(--bc), var(--bc)) top right / var(--bt) var(--bl) no-repeat,
      linear-gradient(var(--bc), var(--bc)) bottom left / var(--bl) var(--bt) no-repeat, linear-gradient(var(--bc), var(--bc)) bottom left / var(--bt) var(--bl) no-repeat,
      linear-gradient(var(--bc), var(--bc)) bottom right / var(--bl) var(--bt) no-repeat, linear-gradient(var(--bc), var(--bc)) bottom right / var(--bt) var(--bl) no-repeat;
    filter: drop-shadow(0 0 calc(3px * var(--k, 1)) color-mix(in srgb, var(--bc) 65%, transparent)); }
  /* thin edges between the brackets: solid for a box made here, dashed for one of Protect's */
  .bs-reticle .box::after { content: ""; position: absolute; inset: 0; border: calc(1px * var(--k, 1)) solid color-mix(in srgb, var(--bc) 32%, transparent); }
  .bs-reticle .box.passed::after { border-style: dashed; }
  /* seen by the local model only so far (Protect hasn't reported it): dotted edges, lighter brackets; confirmed: as usual */
  .bs-reticle .box.seen::after { border-style: dotted; }
  .bs-reticle .box.seen { --bt: calc(1.5px * var(--k, 1)); }
  .bs-reticle .box.still::before { opacity: .55; }
  .bs-reticle .box.main.sure:not(.still):not(.lostb)::before { animation: trk-breathe 2.8s ease-in-out infinite; }
  .bs-reticle .box.main.acq::before { animation: trk-close .38s cubic-bezier(.2,.9,.25,1.1) 1 both; }
  .bs-reticle .box.main.hop { transition: left .3s ease, top .3s ease, width .3s ease, height .3s ease; }
  .bs-reticle .box.main.lostb::before { animation: trk-lost .9s ease-in-out infinite; }
  .bs-reticle .box.main.lostb::after, .bs-reticle .box.main.lostb .tag { display: none; }
  .bs-reticle .box.also { opacity: .6; --bt: calc(1.5px * var(--k, 1)); }
  .bs-reticle .box.other { opacity: .4; --bt: calc(1px * var(--k, 1)); border-style: none; }
  .bs-reticle .box.other::after { border-style: dotted; }
  .bs-reticle .box.part { --bc: var(--tracking-accent, var(--primary-color, #e0102a)); --bt: calc(1.5px * var(--k, 1)); --bl: 34%; }
  .bs-reticle .box.part::before { inset: 0; filter: none; }
  .bs-reticle .box.part::after { display: none; }
  /* the tag: what it is, on the brackets, the same size at any zoom; under the box when there is no room above */
  .bs-reticle .box.main .tag { display: block; position: absolute; left: calc(-3px * var(--k, 1)); bottom: 100%; margin-bottom: calc(7px * var(--k, 1)); white-space: nowrap; pointer-events: none;
    font-size: calc(11px * var(--k, 1)); line-height: 1.35; font-weight: 600; letter-spacing: .02em; color: #fff; padding: calc(1px * var(--k, 1)) calc(6px * var(--k, 1));
    background: color-mix(in srgb, var(--bc) 82%, #000); border-radius: calc(2px * var(--k, 1)); text-shadow: none; }
  .bs-reticle .box.main .tag.below { bottom: auto; top: 100%; margin: calc(7px * var(--k, 1)) 0 0; }
  .bs-reticle .info { display: none; }
  @keyframes trk-close { 0% { transform: scale(1.3); opacity: .35; filter: brightness(2); } 100% { transform: scale(1); opacity: 1; } }
  @keyframes trk-lost { 0%, 100% { opacity: .9; transform: scale(1); } 50% { opacity: .3; transform: scale(1.06); } }
  /* acquire: the reticle takes the thing's shape as it flies there; the sweep and rings fall in towards it */
  .bs-reticle.lock .scan .reticle { width: var(--rw, 30%); height: var(--rh, auto); aspect-ratio: auto; max-height: none;
    transform: translate(-50%, -50%) translate(var(--dx, 0px), var(--dy, 0px)); transition: transform .32s cubic-bezier(.2,.9,.25,1.15), width .32s ease, height .32s ease; }
  .bs-reticle.lock .scan .reticle::after { opacity: 0; }
  .bs-reticle.lock .scan .sweep, .bs-reticle.lock .scan .rings { translate: var(--dx, 0px) var(--dy, 0px); scale: .12; opacity: 0; transition: translate .4s ease-in, scale .4s ease-in, opacity .4s ease-in; }
  /* release: it starts from where the brackets were (put there without a flight), then opens back out */
  .scan .reticle.put { transition: none; }
  .bs-reticle .scan .reticle.from { width: var(--rw, 30%); height: var(--rh, auto); aspect-ratio: auto; max-height: none; transform: translate(-50%, -50%) translate(var(--dx, 0px), var(--dy, 0px)); }
  .bs-reticle .scan .reticle { transition: transform .45s cubic-bezier(.3,.7,.3,1), width .45s ease, height .45s ease; }
  @media (prefers-reduced-motion: reduce) {
    .box, .box::before, .scan .reticle, .scan .sweep, .scan .rings { transition: none !important; animation: none !important; }
  }
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
  .frame.warmlive.s-none .idle { top: auto; align-items: flex-start; justify-content: flex-start; text-align: left; padding: 22px 12px 9px;
    background: linear-gradient(to top, rgba(0,0,0,.78), rgba(0,0,0,0)); }
  .frame.warmlive.s-none .idle ha-icon { display: none; }

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
  .top { top: 8px; right: 40px; }
  .info { bottom: 8px; }
  .frame:not(.active) .top, .frame:not(.active) .info { display: none; }
  /* the speaker mark: faint while all is well, plain when no sound can be heard */
  .snd { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; display: grid; place-items: center;
    background: rgba(0,0,0,.45); color: #fff; opacity: .4; cursor: pointer; --mdc-icon-size: 16px; transition: opacity .2s; }
  .snd[hidden] { display: none; }
  .snd:hover, .snd.locked, .snd.muted { opacity: .95; }
  .snd.locked { color: var(--warning-color, #fbbf24); }
  /* split view: the panes lie over the picture they are cut from */
  .panes { position: absolute; inset: 0; display: grid; gap: 2px; background: #000; }
  .frame:not(.split) .panes { display: none; }
  .panes canvas { display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; }
  .frame.split .zoomer { opacity: 0; }
  .frame.split .info { display: none; }
  /* the face inset, and the line from the face to it */
  .pip { position: absolute; visibility: hidden; opacity: 0; pointer-events: none; background: #000; transition: opacity .35s, visibility 0s .35s; --bc: var(--tracking-accent, var(--primary-color, #e0102a)); }
  .pip.on { visibility: visible; opacity: 1; transition: opacity .25s; }
  .pip canvas { display: block; width: 100%; height: 100%; }
  .bs-plain .pip { outline: 1px solid rgba(255,255,255,.75); border-radius: 3px; overflow: hidden; }
  .bs-reticle .pip { outline: 1px solid color-mix(in srgb, var(--bc) 35%, transparent); }
  .bs-reticle .pip::before { content: ""; position: absolute; inset: -3px; pointer-events: none;
    background:
      linear-gradient(var(--bc), var(--bc)) top left / 22% 2px no-repeat, linear-gradient(var(--bc), var(--bc)) top left / 2px 22% no-repeat,
      linear-gradient(var(--bc), var(--bc)) top right / 22% 2px no-repeat, linear-gradient(var(--bc), var(--bc)) top right / 2px 22% no-repeat,
      linear-gradient(var(--bc), var(--bc)) bottom left / 22% 2px no-repeat, linear-gradient(var(--bc), var(--bc)) bottom left / 2px 22% no-repeat,
      linear-gradient(var(--bc), var(--bc)) bottom right / 22% 2px no-repeat, linear-gradient(var(--bc), var(--bc)) bottom right / 2px 22% no-repeat; }
  .tether { position: absolute; left: 0; top: 0; height: 1px; transform-origin: 0 0; pointer-events: none; visibility: hidden;
    background: color-mix(in srgb, var(--tracking-accent, var(--primary-color, #e0102a)) 60%, transparent); }
  .bs-reticle .tether.on { visibility: visible; }
  .frame:not(.active) .pip, .frame.split .pip, .frame:not(.active) .tether, .frame.split .tether { visibility: hidden; opacity: 0; }
  @media (prefers-reduced-motion: reduce) { .pip { transition: none !important; } }
  .dbg { position: absolute; left: 8px; right: 8px; bottom: 36px; padding: 3px 7px; border-radius: 4px; background: rgba(0,0,0,.7); color: #fff;
    font: 11px/1.4 ui-monospace, monospace; pointer-events: none; }
  .dbg[hidden], .frame:not(.active) .dbg { display: none; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600;
    line-height: 16px; background: rgba(0,0,0,.62); color: #fff; white-space: nowrap; }
  .chip i { width: 8px; height: 8px; border-radius: 50%; background: var(--c, #e0102a); }
  .chip.live i { animation: pulse 1.2s infinite; }
  .chip.src { font-weight: 500; font-size: 11px; padding: 2px 7px; opacity: .75; }
  .chip.src[hidden] { display: none; }
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
    if (config.source != null && !LIVE_SOURCES.includes(config.source)) throw new Error(`protect-tracking-card: 'source' is one of ${LIVE_SOURCES.join(", ")}`);
    if (typeof config.sound === "string" && config.sound !== "none" && !SOUNDS[config.sound]) {
      throw new Error(`protect-tracking-card: 'sound' is one of none, ${Object.keys(SOUNDS).join(", ")}`);
    }
    this._config = { types: ["person"], linger: 10, snapshot: 60, aspect_ratio: 16 / 9, max_zoom: 4, stream: "auto", ...config };
    this._stopAll();
    this._cams = null;
    this._liveCams = undefined;
    this._build();
    this._size();
    if (this._hass) this._discover();
  }

  // How the followed thing is marked: "reticle" (the scanner's brackets) or "plain".
  _boxStyle() {
    const v = this._config && this._config.box_style;
    return BOX_STYLES.includes(v) ? v : "reticle";
  }

  // (no flights for those who ask for less motion)
  _calmNow() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }

  // ----------------------------------------------------------- split view

  // How many panes at most (0: no split view).
  _splitMax() {
    const v = this._config && this._config.split;
    const n = v === true || v === "auto" ? 2 : Number(v);
    return n >= 2 ? Math.min(4, Math.floor(n)) : 0;
  }

  // Which things have a pane. `st` is what was decided before (null at
  // first), `ids` the things of a watched kind on the move now (the subject
  // first), `max` the most panes. Returns {on, panes: [{id, lostAt}], ...}:
  // split or not, and the panes in their places. Things keep their places;
  // nothing changes for a thing there or gone only a moment.
  static splitPlan(st, ids, max, now) {
    st = st || { on: false, panes: [], moreAt: 0, lessAt: 0 };
    if (max < 2) return Object.assign(st, { on: false, panes: [], moreAt: 0, lessAt: 0 });
    if (!st.on) {
      if (ids.length < 2) st.moreAt = 0;
      else {
        st.moreAt = st.moreAt || now;
        if (now - st.moreAt >= SPLIT_IN_MS) Object.assign(st, { on: true, lessAt: 0, panes: ids.slice(0, max).map((id) => ({ id, lostAt: 0 })) });
      }
      return st;
    }
    const here = new Set(ids);
    for (const p of st.panes) p.lostAt = here.has(p.id) ? 0 : p.lostAt || now;
    // a new thing: into the place of one that has just gone (its reports may
    // be going on under another id), else a free pane
    for (const id of ids) {
      if (st.panes.some((p) => p.id === id)) continue;
      const gone = st.panes.find((p) => p.lostAt);
      if (gone) Object.assign(gone, { id, lostAt: 0 });
      else if (st.panes.length < max) st.panes.push({ id, lostAt: 0 });
    }
    st.panes = st.panes.filter((p) => !p.lostAt || now - p.lostAt < SWITCH_MS);
    if (st.panes.filter((p) => !p.lostAt).length > 1) st.lessAt = 0;
    else {
      st.lessAt = st.lessAt || now;
      if (now - st.lessAt >= SPLIT_OUT_MS) Object.assign(st, { on: false, panes: [], moreAt: 0, lessAt: 0 });
    }
    return st;
  }

  // The panes, drawn: each a cut-out of the playing picture round its thing.
  _splitDraw(a, nodes, W, H, now) {
    const root = this._root;
    const host = root.querySelector(".panes");
    const panes = a.split.panes;
    const cols = panes.length >= 3 ? 2 : W >= H * 1.2 ? 2 : 1;
    const rows = Math.max(1, Math.ceil(panes.length / cols));
    const grid = `grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr)`;
    if (host.style.cssText !== grid) host.style.cssText = grid;
    a.paneEls = a.paneEls || new Map();
    const order = panes.map((p) => String(p.id)).join("|");
    if (order !== a.paneOrder) {
      a.paneOrder = order;
      const next = new Map();
      for (const p of panes) {
        // (a thing taking another's place takes over its canvas and its view, so the picture moves over rather than jumps)
        const el = a.paneEls.get(p.id) || [...a.paneEls].filter(([id]) => !panes.some((q) => q.id === id) && ![...next.values()].includes(a.paneEls.get(id))).map(([, e]) => e)[0] || document.createElement("canvas");
        next.set(p.id, el);
      }
      a.paneEls = next;
      host.replaceChildren(...panes.map((p) => next.get(p.id)));
    }
    const video = a.video;
    const vw = video && video.videoWidth;
    const vh = video && video.videoHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (a.accent === undefined) {
      // (the card's accent, for the brackets drawn on the panes)
      a.accent = (typeof this._config.accent === "string" && this._config.accent) || "";
      try {
        if (!a.accent) a.accent = getComputedStyle(root.querySelector(".frame")).getPropertyValue("--primary-color").trim();
      } catch (e) {}
    }
    const pw = W / cols;
    const ph = H / rows;
    const f = a.paneAt ? 1 - Math.exp(-Math.min(250, now - a.paneAt) / EASE_MS) : 1;
    a.paneAt = now;
    for (const p of panes) {
      const cv = a.paneEls.get(p.id);
      const cw = Math.max(1, Math.round(pw * dpr));
      const ch = Math.max(1, Math.round(ph * dpr));
      if (cv.width !== cw) cv.width = cw;
      if (cv.height !== ch) cv.height = ch;
      const node = nodes.get(p.id);
      // its view (0..1000 of the picture): how far in, and the middle
      const v = (cv._view = cv._view || null);
      if (node) {
        const [x, y, w, h] = node.box;
        let s = Math.max(1, Math.min(Number(this._config.max_zoom) || 4, 1000 / (Math.max(1, w) * 3), 1000 / (Math.max(1, h) * 2)));
        if (v && Math.abs(s - v.ws) / v.ws < 0.08) s = v.ws;
        const want = [s, x + w / 2, y + h / 2];
        if (!v) cv._view = { s: want[0], x: want[1], y: want[2], ws: s };
        else Object.assign(v, { s: v.s + (want[0] - v.s) * f, x: v.x + (want[1] - v.x) * f, y: v.y + (want[2] - v.y) * f, ws: s });
      }
      const view = cv._view;
      if (!view || !vw || !vh) continue;
      const g = cv.getContext("2d");
      // the cut-out: the pane's shape, as much of the picture as the zoom leaves
      const ar = pw / ph;
      let sh = vh / view.s;
      let sw = sh * ar;
      if (sw > vw) {
        sw = vw;
        sh = Math.min(vh, sw / ar);
      }
      const sx = Math.max(0, Math.min(vw - sw, (view.x / 1000) * vw - sw / 2));
      const sy = Math.max(0, Math.min(vh - sh, (view.y / 1000) * vh - sh / 2));
      try {
        g.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
      } catch (e) {
        continue;
      }
      if (!node) continue;
      const [x, y, w, h] = node.box;
      const color = (this._boxStyle() === "reticle" && a.accent) || LIVE_COLORS[node.t.type] || "#e5e7eb";
      const [bx, by, bw, bh] = [(((x / 1000) * vw - sx) / sw) * cw, (((y / 1000) * vh - sy) / sh) * ch, (((w / 1000) * vw) / sw) * cw, (((h / 1000) * vh) / sh) * ch];
      g.strokeStyle = color;
      if (this._boxStyle() === "reticle") {
        // the same brackets as in one view: thin edges, the corners strong
        g.globalAlpha = 0.32;
        g.lineWidth = dpr;
        g.strokeRect(bx, by, bw, bh);
        g.globalAlpha = 1;
        g.lineWidth = 2 * dpr;
        const [lx, ly] = [bw * 0.26, bh * 0.26];
        g.beginPath();
        for (const [cx, cy, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) {
          g.moveTo(cx + dx * lx, cy);
          g.lineTo(cx, cy);
          g.lineTo(cx, cy + dy * ly);
        }
        g.stroke();
      } else {
        g.lineWidth = 2 * dpr;
        g.strokeRect(bx, by, bw, bh);
      }
      const label = `${KINDS[node.t.type] ? KINDS[node.t.type][0] : node.t.type}${node.t.desc ? ` · ${node.t.desc}` : ""}`;
      g.font = `600 ${11 * dpr}px sans-serif`;
      g.fillStyle = "rgba(0,0,0,.6)";
      g.fillRect(6 * dpr, 6 * dpr, g.measureText(label).width + 10 * dpr, 18 * dpr);
      g.fillStyle = "#fff";
      g.fillText(label, 11 * dpr, 19 * dpr);
    }
  }

  // ------------------------------------------------------- the face inset

  // The face that goes with a followed person: one reported as theirs, or
  // (Protect's own) one inside the upper part of their box.
  static faceOf(subject, all) {
    if (!subject || subject.t.type !== "person") return null;
    const sid = String(subject.t.id);
    const [sx, sy, sw, sh] = subject.box;
    return (
      all.find((n) => n.t.type === "face" && n.of === sid) ||
      all.find((n) => {
        if (n.t.type !== "face" || n.of != null) return false;
        const [cx, cy] = [n.box[0] + n.box[2] / 2, n.box[1] + n.box[3] / 2];
        return cx >= sx && cx <= sx + sw && cy >= sy && cy <= sy + sh * 0.6;
      }) ||
      null
    );
  }

  // Which corner the inset goes in: the one where it covers least of the
  // person (rects as [left, top, width, height] on the card). It stays where
  // it is unless that corner now covers them and another covers much less.
  static pipCorner(prev, person, W, H, size) {
    const m = 8;
    const top = 40; // (clear of the chips along the top)
    const spots = { br: [W - size - m, H - size - m], bl: [m, H - size - m], tr: [W - size - m, top], tl: [m, top] };
    const cover = ([l, t]) => {
      if (!person) return 0;
      const w = Math.min(l + size, person[0] + person[2]) - Math.max(l, person[0]);
      const h = Math.min(t + size, person[1] + person[3]) - Math.max(t, person[1]);
      return w > 0 && h > 0 ? w * h : 0;
    };
    let best = "br";
    for (const k of Object.keys(spots)) if (cover(spots[k]) < cover(spots[best])) best = k;
    const keep = prev && spots[prev] && (cover(spots[prev]) === 0 || cover(spots[best]) > cover(spots[prev]) * 0.5);
    const corner = keep ? prev : best;
    return { corner, left: spots[corner][0], top: spots[corner][1] };
  }

  // One frame of the inset: shown or not, where, and the face cut out of the playing picture.
  _pip(a, subject, all, place, view, W, H, now, split) {
    const root = this._root;
    const wrap = root.querySelector(".pip");
    const line = root.querySelector(".tether");
    const p = (a.pip = a.pip || { at: 0, view: null, forId: null, corner: null, cornerAt: 0, px: 0 });
    const off = this._config.face_pip === "off" || this._config.face_pip === false;
    const video = a.video;
    const vw = video && video.videoWidth;
    const vh = video && video.videoHeight;
    const roomy = Math.min(W, H) >= PIP_MIN;
    const face = !off && !split && roomy ? ProtectTrackingCard.faceOf(subject, all) : null;
    if (subject && p.forId !== subject.t.id) Object.assign(p, { view: null, forId: subject.t.id, at: 0 }); // (another person: not the last one's face)
    if (face && vw && vh) {
      // where the face is, in the stream's own pixels: a square round it with some room
      const [fx, fy, fw, fh] = [(face.box[0] / 1000) * vw, (face.box[1] / 1000) * vh, (face.box[2] / 1000) * vw, (face.box[3] / 1000) * vh];
      const want = { x: fx + fw / 2, y: fy + fh / 2, side: Math.max(24, Math.max(fw, fh) * PIP_PAD) };
      const f = p.view && p.drawnAt && !a.calm ? 1 - Math.exp(-Math.min(250, now - p.drawnAt) / EASE_MS) : 1;
      p.view = p.view ? { x: p.view.x + (want.x - p.view.x) * f, y: p.view.y + (want.y - p.view.y) * f, side: p.view.side + (want.side - p.view.side) * f } : want;
      p.at = now;
      p.px = fw;
    }
    // (not reported for a moment, a head turned: its place is kept)
    const show = !off && !split && roomy && !!subject && !!p.view && !!vw && now - p.at < PIP_HOLD_MS;
    wrap.classList.toggle("on", show);
    line.classList.toggle("on", show && !!face);
    if (!show) {
      if (now - p.at >= PIP_HOLD_MS) p.view = null;
      p.drawnAt = 0;
      return;
    }
    p.drawnAt = now;
    // its size and corner: away from the person, as they are on the card now
    const size = Math.max(64, Math.min(200, Math.round(Math.min(W, H) * 0.34)));
    const onCard = (b) => [(place[0] + (b[0] / 1000) * place[2]) * view.s + view.x, (place[1] + (b[1] / 1000) * place[3]) * view.s + view.y, (b[2] / 1000) * place[2] * view.s, (b[3] / 1000) * place[3] * view.s];
    // (it stays put for a moment after a move, whatever the person does: no hopping about)
    const settled = !!p.corner && now - p.cornerAt < PIP_CORNER_MS;
    const use = ProtectTrackingCard.pipCorner(p.corner, settled ? null : onCard(subject.box), W, H, size);
    if (use.corner !== p.corner) {
      p.corner = use.corner;
      p.cornerAt = now;
    }
    const css = `left:${use.left.toFixed(0)}px;top:${use.top.toFixed(0)}px;width:${size}px;height:${size}px`;
    if (wrap.style.cssText !== css) wrap.style.cssText = css;
    // the cut-out, drawn from the playing video (nothing is read back from the canvas or kept)
    const cv = wrap.firstElementChild;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    if (cv.width !== px) cv.width = px;
    if (cv.height !== px) cv.height = px;
    const side = Math.min(p.view.side, vw, vh);
    const sx = Math.max(0, Math.min(vw - side, p.view.x - side / 2));
    const sy = Math.max(0, Math.min(vh - side, p.view.y - side / 2));
    try {
      cv.getContext("2d").drawImage(video, sx, sy, side, side, 0, 0, px, px);
    } catch (e) {}
    // the line from the face on the picture to the inset's nearest corner
    if (face) {
      const fb = onCard(face.box);
      const [x1, y1] = [fb[0] + fb[2] / 2, fb[1] + fb[3] / 2];
      const x2 = x1 < use.left ? use.left : use.left + size;
      const y2 = y1 < use.top ? use.top : use.top + size;
      const len = Math.hypot(x2 - x1, y2 - y1);
      line.style.cssText = `width:${len.toFixed(1)}px;transform:translate(${x1.toFixed(1)}px, ${y1.toFixed(1)}px) rotate(${Math.atan2(y2 - y1, x2 - x1).toFixed(4)}rad)`;
    }
  }

  _pipEnd() {
    const root = this._root;
    if (!root) return;
    root.querySelector(".pip").classList.remove("on");
    root.querySelector(".tether").classList.remove("on");
  }

  _splitEnd(a) {
    const root = this._root;
    if (!root) return;
    root.querySelector(".frame").classList.remove("split");
    root.querySelector(".panes").replaceChildren();
    if (a) Object.assign(a, { paneEls: null, paneOrder: null, paneAt: 0 });
  }

  // ---------------------------------------------------------------- sound

  _soundName() {
    const s = this._config && this._config.sound;
    return s === true ? "ping" : typeof s === "string" && SOUNDS[s] ? s : null;
  }

  // Once as the card starts following: not again until it has stood by
  // again, nor within the gap after it last sounded.
  _chime() {
    const name = this._soundName();
    if (!name || this._sounded) return;
    this._sounded = true;
    const set = this._config.sound_gap;
    const gap = set != null && set !== "" && Number(set) >= 0 ? Number(set) : SOUND_GAP_S;
    const now = Date.now();
    if (now - (this._soundAt || 0) < gap * 1000) return;
    // (another card sounding at this moment counts: it was heard)
    if (Sound.play(name, this._config.sound_volume) || now - Sound.lastAt < CHORD_MS) this._soundAt = now;
  }

  // The speaker mark in the corner: whether the sound can be heard here.
  _mark() {
    const el = this._root && this._root.querySelector(".snd");
    if (!el) return;
    const on = !!this._soundName();
    el.hidden = !on;
    if (!on) return;
    const muted = Sound.muted();
    const locked = !muted && !Sound.unlocked();
    el.classList.toggle("locked", locked);
    el.classList.toggle("muted", muted);
    el.querySelector("ha-icon").setAttribute("icon", muted || locked ? "mdi:volume-off" : "mdi:volume-high");
    el.title = muted ? "Sound is off in this browser. Click to turn it on" : locked ? "The browser plays no sound until this page has been clicked. Click here" : "Sound is on. Click to turn it off in this browser";
  }

  _markClick() {
    // the click that let the browser play sound: it is heard, nothing is turned off
    const first = Date.now() - Sound.gestureAt < 800 && !Sound.muted();
    if (!first) Sound.setMuted(!Sound.muted());
    if (!Sound.muted()) Sound.play(this._soundName(), this._config.sound_volume, true);
    this._mark();
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

  // The card's editor (the rest is YAML: see the top of this file).
  static getConfigElement() {
    return document.createElement("protect-tracking-card-editor");
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
    Sound.watch(this);
    this._mark();
    this._tick = setInterval(() => {
      if (!document.hidden && this._onScreen !== false) this._askSeen();
      this._quietCheck();
      this._idle();
    }, 30000);
    this._sync();
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this._onVisible);
    this._seenBy?.disconnect();
    Sound.unwatch(this);
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
          <div class="top"><span class="chip live"><i></i><span class="cam"></span></span><span class="chip src" hidden></span><span class="chip warn" hidden></span></div>
          <div class="info"></div>
          <div class="panes"></div>
          <div class="tether"></div>
          <div class="pip"><canvas></canvas></div>
          <div class="dbg" hidden></div>
          <button class="snd" type="button" hidden><ha-icon></ha-icon></button>
        </div>
      </ha-card>`;
    this._root = root;
    const frame = root.querySelector(".frame");
    frame.classList.add(`s-${STANDBY.includes(this._config.standby) ? this._config.standby : "radar"}`);
    frame.classList.add(`bs-${this._boxStyle()}`);
    this._phase = "standby";
    if (typeof this._config.accent === "string" && this._config.accent) frame.style.setProperty("--tracking-accent", this._config.accent);
    frame.addEventListener("click", () => this._open());
    root.querySelector(".snd").addEventListener("click", (ev) => {
      ev.stopPropagation(); // (not a tap on the card)
      this._markClick();
    });
    this._mark();
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
    // (what this card saw itself, what the integration recorded, and for an
    // integration that keeps no record, what this browser remembers)
    let seen = Math.max(this._lastSeen || 0, this._serverSeen || 0);
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

  // When the watched kinds were last seen, as the integration recorded it:
  // it listens whether or not a dashboard is open, so this is the same on
  // every device. An older integration doesn't know the question, and the
  // card then goes by what this browser saw.
  _askSeen(now) {
    const hass = this._hass;
    const cams = this._cams || [];
    if (!hass || !cams.length || this._state || this._noSeen) return;
    if (!now && Date.now() - (this._seenAsked || 0) < 50000) return;
    this._seenAsked = Date.now();
    const types = this._config.types;
    Promise.resolve(hass.callWS({ type: "protect_detections/live/seen", limit: 0, types })).then(
      (res) => {
        if (this._cams !== cams || !res || !res.cameras) return;
        let seen = 0;
        for (const cam of cams) {
          const last = (res.cameras[cam.id] && res.cameras[cam.id].last) || {};
          for (const t of types) seen = Math.max(seen, Number(last[t] && last[t].seen) || 0);
        }
        // (told in the server's clock; this device's may differ)
        if (seen && Number(res.now)) seen = Math.min(Date.now(), seen + Date.now() - res.now);
        this._serverSeen = seen;
        if (!this._active) this._idle();
      },
      (err) => {
        if (err && err.code === "unknown_command") this._noSeen = true;
      }
    );
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
        this._serverSeen = 0;
      }
      this._idle();
      this._askSeen(!same);
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
      const sub = { cam, lt: new LiveTracks(), stop: null, using: null, matchAt: 0 };
      this._subs.set(cam.id, sub);
      const mine = () => this._subs && this._subs.get(cam.id) === sub;
      sub.stop = subscribeLive(
        this._hass,
        cam.entity,
        this._config.source,
        (msg) => mine() && this._message(sub, msg),
        (st) => {
          if (!mine()) return;
          sub.using = st.using;
          sub.lt.mode = st.mode || null;
          if (st.using && this._config.source === "local" && st.mode !== "local") {
            // a Protect Tracker from before its local mode: what its model made, out of its mixed feed
            this._note = "This Protect Tracker has no local mode yet: going by its model's boxes from the mixed feed";
            this._srcNote = true;
          } else if (st.using) {
            if (this._srcNote) this._note = "";
            this._srcNote = false;
          } else if (this._config.source === "local") {
            // asked for by name: said, and it is looked for again by itself
            this._note = st.code === "unknown_command" ? "Protect Tracker isn't installed (source: local)" : st.code === "not_ready" ? "Protect Tracker's engine isn't running (source: local)" : "Protect Tracker isn't answering (source: local)";
            this._srcNote = true;
          } else if (st.code === "unknown_command") this._state = "norelay";
          else this._note = "Couldn't start listening for this camera";
          if (!this._active) this._idle();
        }
      );
    }
    if (this._config.warm && !this._warm) {
      // the stream kept running unseen, so the picture is there at once
      const cam = cams[0];
      const entity = this._entity(cam);
      this._warm = { cam, entity, stream: this._stream(entity) };
      // (looked at now and then: is its picture there, to stand in for the still?)
      this._warmTimer = this._warmTimer || setInterval(() => this._warmCheck(), 1000);
    }
    this._snap();
    this._idle();
  }

  _stopAll() {
    this._leave();
    for (const sub of (this._subs && this._subs.values()) || []) {
      if (sub.stop) sub.stop();
    }
    this._subs = null;
    if (this._warm) {
      this._warm.stream.remove();
      this._warm = null;
    }
    clearInterval(this._warmTimer);
    this._warmTimer = null;
    this._warmCheck();
    clearTimeout(this._snapTimer);
    this._snapTimer = null;
  }

  // warm: is the stream kept running showing a picture? Then it is what
  // standing by shows; until it is, and whenever it isn't, the still is.
  _warmCheck() {
    const frame = this._root && this._root.querySelector(".frame");
    if (!frame) return;
    const warm = this._warm;
    // (while another camera's picture is up, the warm stream is not in the card)
    const mine = warm && (!this._active || this._active.stream === warm.stream);
    const live = !!mine && deepFind(warm.stream, ["VIDEO"]).some((v) => !v.ended && v.readyState !== 0 && pictureBox(v));
    frame.classList.toggle("warmlive", live);
  }

  // Protect Tracker's local mode tells every second, even with nothing to
  // tell: gone quiet, this camera isn't being served, and the card says so.
  _quietCheck() {
    const quiet = [...((this._subs && this._subs.values()) || [])].some((sub) => sub.lt.quiet);
    const was = !!this._quietNote;
    if (quiet) this._note = "Protect Tracker has gone quiet: this camera isn't being served";
    else if (was) this._note = "";
    this._quietNote = quiet;
    if (quiet !== was && !this._active) this._idle();
  }

  _message(sub, msg) {
    if (msg && msg.status) {
      // (Protect Tracker's local mode tells when its engine's connection goes and comes back)
      const engine = msg.mode === "local" || sub.lt.mode === "local";
      const say = msg.status === "error" ? "Protect's live tracking can't be reached (trying again)" : msg.status === "disconnected" && engine ? "Protect Tracker's engine is not connected" : "";
      // (what is said about the source itself, such as a tracker too old for local mode, stays through a "connected")
      if (say || !this._srcNote) this._note = say;
      if (!this._active) this._idle();
      return;
    }
    sub.lt.message(msg);
    if (this._quietNote) this._quietCheck();
    const types = this._config.types;
    // (a face found on someone being followed is part of them, not a thing of its own)
    const own = (msg.tracks || []).filter((tr) => tr && tr.of == null);
    // (source: local means what Protect Tracker's own model made, and nothing else)
    const only = this._config.source === "local";
    // (and something standing still wakes nothing: a parked car, a bike on the porch)
    // (whether it is moving is the positions' own judgement as well as the report's: see protect-live.js)
    const moves = (tr) => {
      const t = sub.lt.tracks.get(tr.id);
      return !!t && sub.lt.latest != null && sub.lt.latest - t.moved <= 400;
    };
    const hit = own.find((tr) => types.includes(tr.objectType) && !tr.stationary && tr.moving !== false && moves(tr) && (!only || tr.local === true));
    const now = Date.now();
    if (!hit) {
      // (messages can come thirty a second: the dots needn't)
      if (this._config.show_others && !this._active && now - (this._blipAt || 0) >= 200) {
        this._blipAt = now;
        this._blips(own);
      }
      return;
    }
    sub.matchAt = now;
    this._lastSeen = now;
    if (now - (this._lastSaved || 0) >= 5000) {
      this._lastSaved = now;
      try {
        localStorage.setItem(LAST_KEY + this._lastKey(), String(now));
      } catch (e) {}
    }
    if (!this._active) this._enter(sub, hit.coord, hit.id);
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
      if (this._root && this._root.querySelector(".frame").classList.contains("warmlive")) return; // (the live picture is showing: no still needed)
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
  _enter(sub, coord, id) {
    const cam = sub.cam;
    const warm = this._warm && this._warm.cam.id === cam.id ? this._warm : null;
    const entity = warm ? warm.entity : this._entity(cam);
    const stream = warm ? warm.stream : this._stream(entity);
    const a = (this._active = { sub, entity, stream, since: Date.now(), seen: Date.now(), view: { s: 1, cx: null, cy: null, at: 0, want: null }, els: new Map(), subject: id, subjectAt: Date.now(), subjectBox: Array.isArray(coord) && coord.length === 4 ? coord.map(Number) : null, place: null, placeAt: 0 });
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
      // (reticle style: it takes the thing's own shape)
      reticle.style.setProperty("--rw", `${Math.max(14, (coord[2] / 1000) * W + 6).toFixed(1)}px`);
      reticle.style.setProperty("--rh", `${Math.max(14, (coord[3] / 1000) * H + 6).toFixed(1)}px`);
    }
    reticle.classList.remove("from", "put");
    clearTimeout(this._releaseTimer);
    a.calm = this._calmNow();
    this._phase = a.calm ? "track" : "acquire";
    root.querySelector(".blips").replaceChildren();
    frame.classList.add("active", "lock");
    this._chime();
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
    this._sounded = false; // standing by again: the next one may sound
    cancelAnimationFrame(a.raf);
    const root = this._root;
    if (this._warm && this._warm.stream === a.stream) LiveTracks.hold(a.stream, 0);
    else {
      a.stream.remove();
      // (the stream kept warm goes back in its place, if another camera's took it)
      if (this._warm) root.querySelector(".video").replaceChildren(this._warm.stream);
    }
    this._warmCheck();
    clearTimeout(this._lockTimer);
    root.querySelector(".frame").classList.remove("active", "lock", "playing");
    this._splitEnd(null);
    this._pipEnd();
    // Release: the reticle starts where the brackets were (the picture is
    // whole again by now) and opens back out to its place as the scanner
    // fades in. For those who ask for less motion it is simply back.
    const reticle = root.querySelector(".reticle");
    const frame = root.querySelector(".frame");
    const last = a.subjectBox;
    const fly = !a.calm && this._boxStyle() === "reticle" && Array.isArray(last);
    if (fly) {
      const W = frame.clientWidth || 0;
      const H = frame.clientHeight || 0;
      reticle.classList.add("put", "from");
      reticle.style.setProperty("--dx", `${(((last[0] + last[2] / 2) / 1000 - 0.5) * W).toFixed(1)}px`);
      reticle.style.setProperty("--dy", `${(((last[1] + last[3] / 2) / 1000 - 0.5) * H).toFixed(1)}px`);
      reticle.style.setProperty("--rw", `${Math.max(14, (last[2] / 1000) * W + 6).toFixed(1)}px`);
      reticle.style.setProperty("--rh", `${Math.max(14, (last[3] / 1000) * H + 6).toFixed(1)}px`);
      void reticle.offsetWidth; // (it is there now; from here it flies)
      reticle.classList.remove("put");
    }
    reticle.classList.remove("from");
    for (const v of ["--dx", "--dy", "--ls", "--rw", "--rh"]) reticle.style.removeProperty(v);
    this._phase = fly ? "release" : "standby";
    clearTimeout(this._releaseTimer);
    if (fly) this._releaseTimer = setTimeout(() => !this._active && (this._phase = "standby"), RELEASE_MS);
    root.querySelector(".zoomer").style.transform = "";
    root.querySelector(".boxes").replaceChildren();
    root.querySelector(".info").replaceChildren();
    this._idle();
    this._askSeen();
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
    const behind = lt.behind(a.stream, { delay: cfg.live_delay, offset: cfg.live_offset, debug: !!cfg.live_debug });
    const all = lt.visible(lt.moment(behind), true, cfg.source === "local");
    const whole = all.filter((n) => n.of == null);
    const mine = whole.filter((n) => cfg.types.includes(n.t.type)); // (standing still counts too)
    const others = cfg.show_others ? whole.filter((n) => !cfg.types.includes(n.t.type) && lt.moment(behind) - n.t.moved <= 5000) : [];
    // --- the subject (see the top of this file)
    const at = lt.moment(behind);
    const moving = (n) => at - n.t.moved <= MOVING_MS;
    const centre = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
    const far = (b) => {
      const [x, y] = centre(b);
      const [px, py] = a.subjectBox ? centre(a.subjectBox) : [x, y];
      return Math.hypot(x - px, y - py);
    };
    // where things stand: a subject must not end up on one of these
    a.spots = a.spots || new Map();
    a.banned = a.banned || new Map();
    for (const n of all) {
      if (n.of != null || n.t.id === a.subject) continue;
      if (at - n.t.moved > STOOD_MS && at - n.t.first > STOOD_MS) a.spots.set(n.t.id, { box: n.box, type: n.t.type, at: now });
    }
    for (const [id, spot] of a.spots) if (now - spot.at > SPOT_KEEP_MS) a.spots.delete(id);
    for (const [id, when] of a.banned) if (now - when > BAN_MS) a.banned.delete(id);
    const over = (p, q) => {
      const w = Math.min(p[0] + p[2], q[0] + q[2]) - Math.max(p[0], q[0]);
      const h = Math.min(p[1] + p[3], q[1] + q[3]) - Math.max(p[1], q[1]);
      return w > 0 && h > 0 ? (w * h) / (p[2] * p[3] + q[2] * q[3] - w * h) : 0;
    };
    const lingerMs = Math.max(1, Number(cfg.linger) || 10) * 1000;
    let subject = mine.find((n) => n.t.id === a.subject) || null;
    if (subject) {
      const t = subject.t;
      const still = at - Math.max(t.went, t.first); // how long its box hasn't moved
      let lost = false;
      // it jumped across the picture between two looks: not the same thing any more
      if (a.subjectBox && now - a.subjectAt < 400 && far(subject.box) > Math.max(150, 1.5 * Math.max(a.subjectBox[2], a.subjectBox[3]))) lost = true;
      // it has come to rest where something of its kind has been standing: that thing, under the subject's id
      else if (still > SETTLED_MS && [...a.spots].some(([id, spot]) => id !== t.id && spot.type === t.type && over(subject.box, spot.box) > 0.45)) lost = true;
      // it isn't a person and hasn't moved for the linger: it has parked
      else if (t.type !== "person" && still > lingerMs) lost = true;
      if (lost) {
        a.banned.set(t.id, now);
        a.subject = null;
        subject = null;
        a.view.want = null; // (no staying a moment on where it was: that is the wrong thing)
        // (nor do the brackets stay there, pulsing on a parked car)
        if (a.mainEl) {
          a.els.delete(a.mainId);
          a.mainEl.remove();
          a.mainEl = null;
          a.mainId = undefined;
          a.dropped = true;
        }
      }
    }
    if (!subject) {
      const tr = a.subject == null ? null : lt.tracks.get(a.subject);
      const early = !!tr && tr.pts.length > 0 && tr.pts[0][0] > at; // (reported, but that moment isn't on screen yet)
      if (!early) {
        const free = mine.filter((n) => moving(n) && n.t.id !== a.subject && !a.banned.has(n.t.id));
        free.sort((p, q) => far(p.box) - far(q.box));
        const next = free[0];
        // its reports going on under another id, right where it was: the same subject
        const same = next && a.subjectBox && now - a.subjectAt < HANDOVER_MS && far(next.box) <= Math.max(80, a.subjectBox[2], a.subjectBox[3]);
        if (next && (same || now - a.subjectAt > SWITCH_MS)) {
          a.subject = next.t.id;
          subject = next;
        }
      }
    }
    if (subject) {
      a.subjectAt = now;
      a.subjectBox = subject.box;
    }
    // what keeps the picture up: the subject, or something moving that it could go over to
    if (subject || mine.some((n) => moving(n) && !a.banned.has(n.t.id))) a.seen = now;
    // boxed: the subject, and whatever else of a watched kind is on the move (parked things are not)
    const shown = mine.filter((n) => n === subject || (moving(n) && !a.banned.has(n.t.id)));
    // faces found on those drawn: boxed with them, never followed or counted by themselves
    const drawn = new Set([...shown, ...others].map((n) => String(n.t.id)));
    const parts = all.filter((n) => n.of != null && drawn.has(n.of));

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
      a.video = null;
      for (const el of deepFind(a.stream, ["VIDEO"])) {
        const b = pictureBox(el);
        if (b && (!pic || b.width * b.height > pic.width * pic.height)) {
          pic = b;
          a.video = el; // (the panes of a split view are drawn from it)
        }
      }
      if (pic) {
        const z = root.querySelector(".zoomer").getBoundingClientRect();
        const k = a.view.s || 1;
        a.place = [(pic.left - z.left) / k, (pic.top - z.top) / k, pic.width / k, pic.height / k];
        a.playing = true;
      } else a.place = [0, 0, W, H];
      // (the still behind it is shown only while there is no live picture)
      frame.classList.toggle("playing", !!pic);
      const warn = root.querySelector(".chip.warn");
      const failed = !a.playing && now - a.since > FAIL_MS;
      warn.hidden = !failed;
      if (failed) warn.textContent = "The live picture didn't start";
      // whose positions these are, when there is a choice
      const src = root.querySelector(".chip.src");
      const by = lt.source || (a.sub.using === "tracker" ? "local" : "protect");
      src.hidden = !(a.sub.using === "tracker" || cfg.source);
      if (!src.hidden) {
        src.textContent = by === "local" ? "local" : "Protect";
        src.title = by === "local" ? "Positions from Protect Tracker, frame by frame" : a.sub.using === "tracker" ? "Positions from Protect, passed on by Protect Tracker" : "Positions from Protect";
      }
      // live_debug: how the boxes are being timed
      const dbg = root.querySelector(".dbg");
      dbg.hidden = !cfg.live_debug;
      if (cfg.live_debug) dbg.textContent = lt.describe(behind) + (a.pip && a.pip.px ? ` · face ${Math.round(a.pip.px)} px across in the stream` : "");
    }
    const place = a.place || [0, 0, W, H];

    // boxes
    const layer = root.querySelector(".boxes");
    layer.style.cssText = `left:${place[0].toFixed(1)}px;top:${place[1].toFixed(1)}px;width:${place[2].toFixed(1)}px;height:${place[3].toFixed(1)}px;--k:${(1 / (a.view.s || 1)).toFixed(4)}`;
    const keep = new Set();
    // The subject has one element of its own, whichever thing it is: when
    // another becomes the subject the brackets move across (a hand-over),
    // and while there is none they stay where it was (lost).
    if (subject && a.mainId !== subject.t.id) {
      const old = a.els.get(subject.t.id);
      if (old && old !== a.mainEl) old.remove();
      if (a.mainId !== undefined) a.els.delete(a.mainId);
      if (!a.mainEl) {
        a.mainEl = document.createElement("div");
        const tag = document.createElement("span");
        tag.className = "tag";
        a.mainEl.appendChild(tag);
        layer.appendChild(a.mainEl);
      }
      if (!a.calm) {
        if (a.mainId !== undefined) a.hopUntil = now + HOP_MS;
        else a.acqUntil = now + CLOSE_MS;
      }
      a.mainId = subject.t.id;
      a.els.set(a.mainId, a.mainEl);
    }
    if (!subject && a.mainEl) {
      keep.add(a.mainId);
      a.mainEl.className = "box main lostb";
    }
    this._phase = subject ? (!a.calm && now - a.since < LOCK_MS ? "acquire" : "track") : a.mainEl || a.dropped ? "lost" : this._phase;
    for (const n of [...shown, ...others, ...parts]) {
      const { t, box } = n;
      keep.add(t.id);
      let el = a.els.get(t.id);
      if (n === subject) {
        const sure = Number(t.confidence) >= 80;
        const still = at - t.moved > MOVING_MS;
        const passed = a.sub.using === "tracker" && !t.local;
        // (Protect Tracker's local mode: seen by its model only so far, or reported by Protect too)
        const seen = t.confirmed === false;
        el.className = `box main${sure ? " sure" : ""}${still ? " still" : ""}${passed ? " passed" : ""}${seen ? " seen" : ""}${now < (a.hopUntil || 0) ? " hop" : ""}${now < (a.acqUntil || 0) ? " acq" : ""}`;
        el.style.cssText = `left:${(box[0] / 10).toFixed(2)}%;top:${(box[1] / 10).toFixed(2)}%;width:${(box[2] / 10).toFixed(2)}%;height:${(box[3] / 10).toFixed(2)}%;--c:${LIVE_COLORS[t.type] || "#e5e7eb"}`;
        // its tag: what it is, how sure, where
        const names = (this._zones && this._zones[a.sub.cam.id]) || {};
        const where = [...new Set([...(t.zones || []).map((id) => names[`zone:${id}`]), ...(t.loiterZones || []).map((id) => names[`loiter:${id}`]), ...(t.lines || []).map((id) => names[`line:${id}`])].filter(Boolean))].join(", ");
        const text = `${KINDS[t.type] ? KINDS[t.type][0] : t.type}${t.desc ? ` · ${t.desc}` : ""}${Number.isFinite(t.confidence) ? ` ${Math.round(t.confidence)}%` : ""}${where ? ` · ${where}` : ""}`;
        const tag = el.firstChild;
        if (tag.textContent !== text) tag.textContent = text;
        tag.className = box[1] < 70 ? "tag below" : "tag";
        continue;
      }
      if (el === a.mainEl) el = null; // (it was the subject; it gets a box of its own like the others now)
      if (!el) {
        el = document.createElement("div");
        el.onclick = (ev) => {
          // this one is the subject from now on
          ev.stopPropagation();
          a.subject = t.id;
          a.subjectAt = Date.now();
          a.subjectBox = null; // (a choice, not a jump)
          if (a.banned) a.banned.delete(t.id);
        };
        layer.appendChild(el);
        a.els.set(t.id, el);
      }
      const other = n.of == null && !cfg.types.includes(t.type);
      el.className = `box${other ? " other" : ""}${n.of != null ? " part" : ""}${!other && n.of == null && n !== subject ? " also" : ""}`;
      el.style.cssText = `left:${(box[0] / 10).toFixed(2)}%;top:${(box[1] / 10).toFixed(2)}%;width:${(box[2] / 10).toFixed(2)}%;height:${(box[3] / 10).toFixed(2)}%;--c:${LIVE_COLORS[t.type] || "#e5e7eb"}`;
    }
    for (const [id, el] of a.els) {
      if (keep.has(id)) continue;
      if (el !== a.mainEl) el.remove();
      a.els.delete(id);
    }

    // split view: with several things on the move, a pane each
    const max = this._splitMax();
    if (max) {
      const was = !!(a.split && a.split.on);
      const roomy = W >= SPLIT_MIN[0] && H >= SPLIT_MIN[1];
      const movers = roomy ? [...(subject ? [subject] : []), ...shown.filter((n) => n !== subject)].map((n) => n.t.id) : [];
      a.split = ProtectTrackingCard.splitPlan(a.split, movers, max, now);
      if (a.split.on) {
        frame.classList.add("split");
        this._splitDraw(a, new Map(shown.map((n) => [n.t.id, n])), W, H, now);
      } else if (was) this._splitEnd(a);
    }
    const split = !!(a.split && a.split.on);
    // the view: on the subject, and on nothing else (in a split view the whole picture lies under the panes)
    const group = subject && !split ? [subject] : [];
    const v = a.view;
    if (split) Object.assign(v, { want: null, s: 1, cx: W / 2, cy: H / 2 }); // (nothing to ease: it can't be seen)
    let want = null;
    if (subject && !split) {
      const [x0, y0, w0, h0] = subject.box;
      const w = Math.max(1, w0);
      const h = Math.max(1, h0);
      let s = Math.max(1, Math.min(Number(cfg.max_zoom) || 4, 1000 / (w * 3), 1000 / (h * 2)));
      // (how far in: left alone while it differs little, so the picture doesn't breathe with the box's wobble)
      if (v.want && Math.abs(s - v.want[0]) / v.want[0] < 0.08) s = v.want[0];
      want = [s, place[0] + ((x0 + w / 2) / 1000) * place[2], place[1] + ((y0 + h / 2) / 1000) * place[3]];
      v.want = want;
      v.wantAt = now;
    } else if (v.want && now - (v.wantAt || 0) < HOLD_MS) want = v.want; // just lost: stay a moment
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
    this._pip(a, subject, all, place, { s, x, y }, W, H, now, split);

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

// ---------------------------------------------------------------- editor
//
// The card's editor is its own, not a form Home Assistant builds from a
// list of fields, for two things such a form can't do: show what the card
// really does for everything the config leaves out (a field left out is
// shown with its default, and stays left out until it is changed), and play
// a sound on every click on it, the one already picked included.

// What the card does where the config says nothing (as setConfig has it).
const EDIT_DEFAULTS = { face_pip: "auto", box_style: "reticle", types: ["person"], standby: "radar", linger: 10, show_others: false, warm: false, split: "off", sound: "none", sound_volume: 0.5 };
const EDIT_FORM = [
  { name: "camera", selector: { entity: { domain: "camera", integration: "unifiprotect" } } },
  { name: "name", selector: { text: {} } },
  { name: "types", selector: { select: { multiple: true, options: Object.entries(KINDS).map(([value, [label]]) => ({ value, label })) } } },
  { name: "standby", selector: { select: { options: STANDBY.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })) } } },
  { name: "linger", selector: { number: { min: 1, max: 120, mode: "box", unit_of_measurement: "s" } } },
  { name: "show_others", selector: { boolean: {} } },
  { name: "warm", selector: { boolean: {} } },
  { name: "box_style", selector: { select: { options: [{ value: "reticle", label: "Reticle: the scanner's brackets close onto it" }, { value: "plain", label: "Plain box" }] } } },
  { name: "face_pip", selector: { select: { options: [{ value: "auto", label: "Shown while a followed person's face is reported" }, { value: "off", label: "Off" }] } } },
  { name: "split", selector: { select: { options: [{ value: "off", label: "One view, on the subject" }, { value: "2", label: "Up to 2 panes" }, { value: "3", label: "Up to 3 panes" }, { value: "4", label: "Up to 4 panes" }] } } },
  { name: "height", selector: { text: {} } },
];
const EDIT_LABELS = { camera: "Camera (empty: every camera that recognises things)", name: "Name (empty: the camera's)", types: "Watch for", standby: "Standing-by look",
  linger: "Stay after last seen", show_others: "Also box other things", warm: "Live picture while standing by (keeps the stream running)", height: "Height, e.g. 300px (empty: by shape)",
  split: "Several things moving at once", box_style: "How the followed thing is marked", face_pip: "Face inset (the face enlarged in a corner)" };
const EDIT_STYLE = `
  :host { display: block; }
  .sound { margin-top: 20px; }
  .label { font-size: 14px; color: var(--secondary-text-color); margin-bottom: 8px; }
  .picks { display: flex; flex-wrap: wrap; gap: 8px; }
  .picks button { font: inherit; font-size: 14px; padding: 7px 14px; border-radius: 999px; cursor: pointer; color: var(--primary-text-color);
    background: transparent; border: 1px solid var(--divider-color, #8884); }
  .picks button.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .vol { display: flex; align-items: center; gap: 12px; margin-top: 14px; font-size: 14px; color: var(--secondary-text-color); }
  .vol input { flex: 1; accent-color: var(--primary-color); }
  .vol b { min-width: 3.2em; text-align: right; font-weight: 500; color: var(--primary-text-color); }
  .note { margin-top: 10px; font-size: 13px; color: var(--warning-color, #b45309); display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .note[hidden] { display: none; }
  .note button { font: inherit; padding: 3px 10px; border-radius: 999px; cursor: pointer; background: transparent; color: inherit; border: 1px solid currentColor; }
`;

function sameValue(a, b) {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n") : a === b;
}

class ProtectTrackingCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...(config || {}) };
    this._show();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  connectedCallback() {
    Sound.watch(this); // (told when sound is turned off or on, or the page is first clicked)
    this._show();
  }

  disconnectedCallback() {
    Sound.unwatch(this);
  }

  // What each field shows: the config's value, or what the card does without one.
  _values() {
    const cfg = this._config || {};
    const out = {};
    for (const { name } of EDIT_FORM) {
      if (cfg[name] != null && cfg[name] !== "") out[name] = cfg[name];
      else if (name in EDIT_DEFAULTS) out[name] = EDIT_DEFAULTS[name];
    }
    if (typeof out.height === "number") out.height = String(out.height); // (a text field)
    out.split = out.split === true || out.split === "auto" ? "2" : Number(out.split) >= 2 ? String(Math.min(4, Math.floor(Number(out.split)))) : "off"; // (a number in YAML)
    return out;
  }

  _sound() {
    const s = this._config && this._config.sound;
    return s === true ? "ping" : typeof s === "string" && SOUNDS[s] ? s : "none";
  }

  _volume() {
    const v = this._config && this._config.sound_volume;
    return v == null || v === "" || !Number.isFinite(Number(v)) ? EDIT_DEFAULTS.sound_volume : Math.max(0, Math.min(1, Number(v)));
  }

  _make() {
    const root = this.attachShadow({ mode: "open" });
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    };
    const style = el("style", "", EDIT_STYLE);
    const form = (this._form = el("ha-form"));
    form.schema = EDIT_FORM;
    form.computeLabel = (field) => EDIT_LABELS[field.name] || field.name;
    form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._formChanged((ev.detail && ev.detail.value) || {});
    });
    const sound = el("div", "sound");
    const picks = el("div", "picks");
    this._picks = new Map();
    for (const [value, label] of [["none", "None"], ...Object.entries(SOUNDS)]) {
      const b = el("button", "", label);
      b.type = "button";
      b.addEventListener("click", () => this._pick(value));
      this._picks.set(value, b);
      picks.appendChild(b);
    }
    const vol = el("label", "vol");
    const range = (this._range = el("input"));
    Object.assign(range, { type: "range", min: "0", max: "1", step: "0.05" });
    this._volText = el("b");
    range.addEventListener("input", () => (this._volText.textContent = `${Math.round(Number(range.value) * 100)}%`));
    range.addEventListener("change", () => this._volumeSet(Number(range.value))); // (let go of)
    vol.append(el("span", "", "Volume"), range, this._volText);
    this._note = el("div", "note");
    sound.append(el("div", "label", "Sound when it starts following (click one to hear it)"), picks, vol, this._note);
    root.append(style, form, sound);
    // (Home Assistant loads its form element only where one is used: ask for it)
    if (!customElements.get("ha-form") && window.loadCardHelpers) {
      Promise.resolve(window.loadCardHelpers())
        .then((h) => h.createCardElement({ type: "entities", entities: [] }))
        .then(() => customElements.whenDefined("hui-entities-card"))
        .then(() => customElements.get("hui-entities-card").getConfigElement())
        .catch(() => {});
    }
  }

  _show() {
    if (!this._config) return;
    if (!this._form) this._make();
    this._form.hass = this._hass;
    this._form.data = this._values();
    const now = this._sound();
    for (const [value, b] of this._picks) b.classList.toggle("on", value === now);
    const vol = this._volume();
    this._range.value = String(vol);
    this._volText.textContent = `${Math.round(vol * 100)}%`;
    this._mark();
  }

  // Why nothing is heard, said beside the picker.
  _mark(failed) {
    const note = this._note;
    if (!note) return;
    let text = "";
    let fix = null;
    if (!(window.AudioContext || window.webkitAudioContext)) text = "This browser can't make these sounds.";
    else if (Sound.muted()) {
      text = "Sound is turned off in this browser (the speaker mark on the card), so nothing is heard.";
      fix = () => {
        Sound.setMuted(false);
        if (this._sound() !== "none") Sound.play(this._sound(), this._volume(), true);
      };
    } else if (!Sound.unlocked()) text = "The browser plays no sound until this page has been clicked. Click a sound.";
    else if (failed) text = "The browser didn't play the sound.";
    note.hidden = !text;
    note.replaceChildren();
    if (!text) return;
    note.append(document.createTextNode(text));
    if (fix) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "Turn on";
      b.addEventListener("click", fix);
      note.append(b);
    }
  }

  _hear(name, volume) {
    Sound.gesture = true; // (this is a click on the page: the browser plays sound from here on)
    const played = name === "none" || Sound.play(name, volume, true);
    this._mark(!played);
    for (const card of Sound.cards) if (card !== this) card._mark();
  }

  // A click on a sound: heard every time, the one already picked too.
  _pick(value) {
    this._hear(value, this._volume());
    if (value === this._sound()) return;
    const config = { ...this._config };
    if (value === "none") delete config.sound;
    else config.sound = value;
    this._emit(config);
  }

  _volumeSet(value) {
    value = Math.max(0, Math.min(1, Math.round(value * 100) / 100));
    this._hear(this._sound(), value);
    // (left out of the config and still the default: stays left out)
    const had = this._config.sound_volume != null && this._config.sound_volume !== "";
    if (had ? Number(this._config.sound_volume) === value : value === EDIT_DEFAULTS.sound_volume) return;
    this._emit({ ...this._config, sound_volume: value });
  }

  // The form's fields: one left out of the config stays out while it shows
  // its default; an emptied one is taken out.
  _formChanged(data) {
    const config = { ...this._config };
    for (const { name } of EDIT_FORM) {
      const v = data[name];
      const empty = v == null || v === "" || (Array.isArray(v) && !v.length);
      if (empty) delete config[name];
      else if (!(name in this._config) && name in EDIT_DEFAULTS && sameValue(v, EDIT_DEFAULTS[name])) continue;
      else config[name] = v;
    }
    if (JSON.stringify(config) !== JSON.stringify(this._config)) this._emit(config);
  }

  _emit(config) {
    this._config = config;
    this._show();
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}
if (!customElements.get("protect-tracking-card-editor")) customElements.define("protect-tracking-card-editor", ProtectTrackingCardEditor);

// (the camera wall brings this file in too, for its tracking tiles: whichever
// comes first defines the card)
ProtectTrackingCard.sound = Sound; // (for the tests)
ProtectTrackingCard.soundVoices = soundVoices;
ProtectTrackingCard.editDefaults = EDIT_DEFAULTS;
if (!customElements.get("protect-tracking-card")) customElements.define("protect-tracking-card", ProtectTrackingCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "protect-tracking-card")) window.customCards.push({
  type: "protect-tracking-card",
  name: "Protect Tracking",
  description: "Stands by until a UniFi Protect camera tracks a person, then shows it live, zoomed in on them.",
});
