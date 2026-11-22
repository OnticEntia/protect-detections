/**
 * protect-live — where a camera's tracked things are, live, for the cards
 * that draw or follow them (camera-wall-card's dialog, protect-tracking-card).
 * Not a card and not a dashboard resource of its own: the cards import it
 * (it must sit next to them).
 *
 * The positions come from the Protect Detections backend, which listens to
 * Protect for them: about four a second while something is tracked, each
 * about half a second after its moment. A live picture can be nearly in real
 * time, so, as Protect's own page does, the picture is held back a little
 * and each position is used when the frame it belongs to is on screen:
 *  - WebRTC: the browser is asked to keep some picture in hand; how much it
 *    really holds is read from the connection;
 *  - HLS: the picture is seconds behind by itself; the positions wait for
 *    it, by what the player says it is behind (roughly).
 * The camera's clock is in each message. Our clock against it is taken from
 * the quickest message of late, so the two clocks needn't agree.
 */

export const LIVE_COLORS = { person: "#ff2d55", vehicle: "#4ea8ff", animal: "#34d399", package: "#fbbf24", licensePlate: "#c084fc", face: "#f472b6" };
export const LIVE_DELAY_MS = 700; // how far the picture is held back so the positions can keep up with it
const LIVE_TRANSIT_MS = 330; // the quickest a position gets here after its moment (measured)
const LIVE_WEBRTC_BASE_MS = 250; // camera to screen without any held-back time (an estimate)
const LIVE_HLS_EXTRA_MS = 1500; // what an HLS picture is behind beyond what its player reports (an estimate)
const LIVE_KEEP_MS = 30000; // how long positions are kept (an HLS picture is seconds behind)
const LIVE_HOLD_MS = 600; // a thing stays this long past its last report
const LIVE_PARKED_MS = 5000; // not moved for this long: parked

// Every element with one of these tag names under node, shadow roots included.
export function deepFind(node, tags, out = []) {
  if (!node) return out;
  if (node.shadowRoot) deepFind(node.shadowRoot, tags, out);
  for (const el of node.querySelectorAll ? node.querySelectorAll("*") : []) {
    if (tags.includes(el.tagName)) out.push(el);
    if (el.shadowRoot) deepFind(el.shadowRoot, tags, out);
  }
  return out;
}

// Where the picture itself is inside a <video> or <img> (it may be
// letterboxed): {left, top, width, height} in the units of r; null if the
// element has no picture yet.
export function pictureBox(el, r = el.getBoundingClientRect()) {
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

/**
 * One camera's tracked things, from the messages of
 * `protect_detections/live/subscribe` (hand each to message()), and the
 * timing against a live picture (a `ha-camera-stream` element).
 */
export class LiveTracks {
  constructor() {
    this.tracks = new Map(); // id -> {id, type, desc, confidence, zones, loiterZones, lines, pts: [[moment, x, y, w, h]], moved}
    this.gaps = [];
    this.gap = null; // our clock minus the camera's, at best
    this.jb = null; // ms of picture the browser really holds (WebRTC)
    this.stats = null;
    this.statsAt = 0;
    this.kind = null; // "webrtc" | "hls" | "other"
    this.can = false; // can this player hold the picture back
    this.hls = null;
  }

  message(msg) {
    if (!msg || msg.status || !Number.isFinite(msg.clockWall)) return;
    // our clock against the camera's: the quickest of the last messages
    this.gaps.push(Date.now() - msg.clockWall);
    if (this.gaps.length > 120) this.gaps.shift();
    this.gap = Math.min(...this.gaps);
    for (const tr of msg.tracks || []) {
      if (!tr || !Array.isArray(tr.coord) || tr.coord.length !== 4) continue;
      let t = this.tracks.get(tr.id);
      if (!t) this.tracks.set(tr.id, (t = { id: tr.id, type: tr.objectType || "object", desc: "", pts: [], moved: 0 }));
      if (tr.objectType) t.type = tr.objectType;
      if (tr.desc) t.desc = tr.desc;
      if (Number.isFinite(tr.confidence)) t.confidence = tr.confidence;
      for (const key of ["zones", "loiterZones", "lines"]) if (Array.isArray(tr[key])) t[key] = tr[key];
      if (!tr.stationary) t.moved = msg.clockWall;
      const last = t.pts[t.pts.length - 1];
      if (last && last[0] >= msg.clockWall) continue;
      t.pts.push([msg.clockWall, ...tr.coord.map(Number)]);
      while (t.pts.length > 2 && t.pts[0][0] < msg.clockWall - LIVE_KEEP_MS) t.pts.shift();
    }
    for (const [id, t] of this.tracks) {
      if (t.pts[t.pts.length - 1][0] < msg.clockWall - LIVE_KEEP_MS) this.tracks.delete(id);
    }
  }

  // Where track t is at the camera's moment `at`: [x, y, w, h] (0..1000), or
  // null when it isn't in view then. Between two reports: in between.
  static at(t, at) {
    const pts = t.pts;
    let i = pts.length - 1;
    while (i >= 0 && pts[i][0] > at) i--;
    if (i < 0) return null; // not there yet
    const a = pts[i];
    const b = pts[i + 1];
    if (!b) return at - a[0] <= LIVE_HOLD_MS ? a.slice(1) : null;
    if (b[0] - a[0] > 2000) return at - a[0] <= LIVE_HOLD_MS ? a.slice(1) : null; // lost and found again
    const f = (at - a[0]) / (b[0] - a[0]);
    return [1, 2, 3, 4].map((k) => a[k] + (b[k] - a[k]) * f);
  }

  // Holds the stream's picture back by `ms` (0: not at all). True if its
  // player can do that.
  static hold(stream, ms) {
    let can = false;
    for (const player of deepFind(stream, ["HA-WEB-RTC-PLAYER"])) {
      const pc = player._peerConnection;
      if (!pc || !pc.getReceivers) continue;
      for (const r of pc.getReceivers()) {
        try {
          if ("jitterBufferTarget" in r) {
            if ((r.jitterBufferTarget || 0) !== ms) r.jitterBufferTarget = ms || null;
            can = true;
          } else if ("playoutDelayHint" in r) {
            if ((r.playoutDelayHint || 0) !== ms / 1000) r.playoutDelayHint = ms ? ms / 1000 : null;
            can = true;
          }
        } catch (e) {}
      }
    }
    return can;
  }

  // How far behind the camera the stream's picture on screen is (ms), as
  // well as can be told, seeing to it that it is held back as wanted.
  // delay: ms to hold back (default 700); offset: ms to add to the answer;
  // talking: true while the user talks through the camera (no holding back).
  behind(stream, { delay, offset, talking } = {}) {
    const want = talking ? 0 : Math.max(0, Math.min(3000, Number.isFinite(delay) ? delay : LIVE_DELAY_MS));
    const now = Date.now();
    if (now - this.statsAt > 1000) {
      this.statsAt = now;
      this.can = LiveTracks.hold(stream, want);
      const rtc = deepFind(stream, ["HA-WEB-RTC-PLAYER"])[0];
      const pc = rtc && rtc._peerConnection;
      const hls = pc ? null : deepFind(stream, ["HA-HLS-PLAYER"])[0];
      this.kind = pc ? "webrtc" : hls ? "hls" : "other";
      if (pc && pc.getStats) {
        // what the browser really holds: the time frames spent waiting, of late
        Promise.resolve(pc.getStats())
          .then((stats) => {
            stats.forEach((st) => {
              if (st.type !== "inbound-rtp" || st.kind !== "video" || !st.jitterBufferEmittedCount) return;
              const was = this.stats;
              this.stats = { d: st.jitterBufferDelay, n: st.jitterBufferEmittedCount };
              if (was && this.stats.n > was.n) this.jb = ((this.stats.d - was.d) / (this.stats.n - was.n)) * 1000;
            });
          })
          .catch(() => {});
      } else if (hls) {
        const inst = hls._hlsPolyfillInstance;
        const video = deepFind(stream, ["VIDEO"])[0];
        if (inst && inst.latency > 0) this.hls = inst.latency * 1000;
        else if (video && video.seekable && video.seekable.length) this.hls = Math.max(0, (video.seekable.end(video.seekable.length - 1) - video.currentTime) * 1000);
      }
    }
    const trim = Number.isFinite(offset) ? offset : 0;
    if (this.kind === "webrtc") return LIVE_WEBRTC_BASE_MS + (this.jb != null ? this.jb : this.can ? want : 80) + trim;
    if (this.kind === "hls") return (this.hls != null ? this.hls : 4000) + LIVE_HLS_EXTRA_MS + trim;
    return 300 + trim;
  }

  // The camera's moment that is on screen now, for a picture `behind` ms
  // behind it; null before the first message.
  moment(behind) {
    return this.gap == null ? null : Date.now() - this.gap + LIVE_TRANSIT_MS - behind;
  }

  // The things in view at the camera's moment `at`: [{t, box: [x, y, w, h]}].
  // Parked ones (not moved for a while) are left out unless `parked`.
  visible(at, parked = false) {
    const out = [];
    if (at == null) return out;
    for (const t of this.tracks.values()) {
      if (!parked && at - t.moved > LIVE_PARKED_MS) continue;
      const box = LiveTracks.at(t, at);
      if (box) out.push({ t, box });
    }
    return out;
  }
}
