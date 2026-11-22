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
 * (WebRTC: the browser is asked to keep some picture in hand) and each
 * position is used when the frame it belongs to is on screen.
 *
 * Which moment is on screen is found in one of two ways:
 *  - exactly, where the browser tells (WebRTC, requestVideoFrameCallback):
 *    every frame carries the camera's stream clock as its RTP timestamp,
 *    and every message says what that clock was for its positions
 *    (clockStream). The frame on screen is then matched to the positions
 *    without any guess about delays on the way;
 *  - otherwise by estimate: our clock against the camera's (taken from the
 *    quickest message of late, so the two clocks needn't agree), less what
 *    the picture is behind: a measured part for the camera's stream, plus
 *    what the browser holds (WebRTC, read from the connection), or what the
 *    player says it is behind (HLS, rough: expect to trim with live_offset).
 *
 * How far the positions' stamps are from the frames' is measured in the
 * browser itself, against the picture (see _fitLook: what moves in each
 * frame against the boxes): on a camera's main stream the positions for a
 * frame are stamped about 125 ms after the frame is. There is no error in
 * place: the boxes are right where the timing is. (Measuring the same from
 * outside the browser, by when frames arrive, gave figures that were off by
 * hundreds of ms: a stream first sends what it has in hand, and arrival
 * times stay late for a long while after.)
 */

export const LIVE_COLORS = { person: "#ff2d55", vehicle: "#4ea8ff", animal: "#34d399", package: "#fbbf24", licensePlate: "#c084fc", face: "#f472b6" };
export const LIVE_DELAY_MS = 700; // how far the picture is held back so the positions can keep up with it
const LIVE_TRANSIT_MS = 330; // the quickest a position gets here after its moment (measured)
// By the camera's stream (0: main, others: the lighter ones), measured:
const LIVE_STAMP_MS = [-125, -25]; // a frame's timestamp, against the clock its positions carry (minus: the positions' is later). Main stream: measured; the others: reckoned from it
const LIVE_WEBRTC_BASE_MS = [0, 100]; // a position's moment to its frame on screen, without any held-back time (the same figures, said for the estimate)
const LIVE_AHEAD_MS = 300; // positions not here yet: a thing keeps moving as it did for this long, at most
const RTP_WRAP_MS = 2 ** 32 / 90; // a video RTP timestamp (90 kHz) starts over after this
// Checking the timing against the picture itself (live_debug): which "a
// frame's timestamp is this far ahead" makes the boxes cover what moves.
const FIT_W = 320;
const FIT_H = 180;
const FIT_STEPS = Array.from({ length: 101 }, (_, i) => -1500 + i * 25); // ms tried: -1500 .. 1000
const FIT_WAIT_MS = 2800; // a frame is judged this long after it was shown, when the positions round it are in
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
    this.clock = null; // the newest message's clocks: {wall, stream (ms), at (ours)}
    this.frame = null; // the frame on screen, where the browser tells: {rtp, at (ours)}
    this.sync = "estimate"; // or "rtp": how the moment on screen was found
    this.lag = null; // (rtp) the frame on screen is this far behind the newest positions
    this.channel = 1;
    this.debug = false; // (live_debug) also check the timing against the picture
    this.fit = null; // {sum: per step, n, queue: frames waiting to be judged}
  }

  message(msg) {
    if (!msg || msg.status || !Number.isFinite(msg.clockWall)) return;
    // our clock against the camera's: the quickest of the last messages
    this.gaps.push(Date.now() - msg.clockWall);
    if (this.gaps.length > 120) this.gaps.shift();
    this.gap = Math.min(...this.gaps);
    const rate = Number(msg.clockStreamRate) || 1000;
    if (Number.isFinite(msg.clockStream)) this.clock = { wall: msg.clockWall, stream: (msg.clockStream * 1000) / rate, at: Date.now() };
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
    if (!b) {
      const past = at - a[0];
      if (past > LIVE_HOLD_MS) return null;
      // its next position isn't here yet: it keeps moving as it just did, for a moment
      const p = pts[i - 1];
      if (!p || a[0] - p[0] > 600 || a[0] <= p[0]) return a.slice(1);
      const f = Math.min(past, LIVE_AHEAD_MS) / (a[0] - p[0]);
      return [a[1] + (a[1] - p[1]) * f, a[2] + (a[2] - p[2]) * f, a[3], a[4]];
    }
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

  // Has the browser tell which frame is on screen (its RTP timestamp), where
  // it can: the newest one is kept in this.frame.
  watch(video) {
    if (this._video === video) return;
    this._video = video;
    this.frame = null;
    if (!video || typeof video.requestVideoFrameCallback !== "function") return;
    const step = (now, meta) => {
      if (this._video !== video) return;
      if (meta && Number.isFinite(meta.rtpTimestamp)) {
        // (when it is shown, on our clock: the callback comes a little before)
        const wait = Number.isFinite(meta.expectedDisplayTime) && typeof performance !== "undefined" ? Math.max(0, Math.min(100, meta.expectedDisplayTime - performance.now())) : 0;
        // (how long this frame was kept before it was shown: about what the browser holds, if this is the frame shown)
        const waited = Number.isFinite(meta.receiveTime) && Number.isFinite(meta.presentationTime) ? meta.presentationTime - meta.receiveTime : null;
        this.frame = { rtp: meta.rtpTimestamp, at: Date.now() + wait, waited };
        if (this.debug) {
          try {
            this._fitLook(video);
          } catch (e) {}
        }
      } else this.frame = null;
      video.requestVideoFrameCallback(step);
    };
    video.requestVideoFrameCallback(step);
  }

  // The camera's moment of the frame on screen, from that frame's own
  // timestamp; null where that can't be told (or doesn't add up).
  exact() {
    const wall = this.frameWall();
    return wall == null ? null : wall - (LIVE_STAMP_MS[this.channel] ?? LIVE_STAMP_MS[1]);
  }

  // The timestamp of the frame on screen, as the camera's wall clock.
  frameWall() {
    const f = this.frame;
    const c = this.clock;
    const now = Date.now();
    if (!f || !c || now - f.at > 1500) return null;
    // the frame's timestamp on the stream clock: it counts in 90 000ths of a
    // second and starts over every 13 hours, so the round nearest to now
    const rtp = f.rtp / 90;
    const about = c.stream + (now - c.at);
    const stream = rtp + Math.round((about - rtp) / RTP_WRAP_MS) * RTP_WRAP_MS;
    // (a frame on screen is a little older than the newest positions, never
    // seconds newer: anything else is some other clock, and not used)
    const lag = about - stream;
    if (lag < -1500 || lag > 8000) return null;
    this.lag = lag;
    return stream + (c.wall - c.stream);
  }

  // ---- live_debug: the timing checked against the picture.
  // Each frame is made small, and what changed since the frame before is
  // noted (that is where things move). A little later, when the positions
  // round that frame's time are in, each candidate timing is scored by how
  // much of that movement lies inside the boxes it would have drawn. Over a
  // minute or so of traffic the right one stands out.
  _fitLook(video) {
    const wall = this.frameWall();
    if (wall == null || typeof document === "undefined") return;
    const cv = (this._fitCanvas = this._fitCanvas || Object.assign(document.createElement("canvas"), { width: FIT_W, height: FIT_H }));
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.drawImage(video, 0, 0, FIT_W, FIT_H);
    const px = g.getImageData(0, 0, FIT_W, FIT_H).data;
    const gray = new Uint8Array(FIT_W * FIT_H);
    for (let i = 0; i < gray.length; i++) gray[i] = px[i * 4 + 1];
    const prev = this._fitPrev;
    this._fitPrev = gray;
    if (!prev) return;
    const mask = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) mask[i] = Math.abs(gray[i] - prev[i]) > 18 ? 1 : 0;
    this.fitFrame(wall, mask);
  }

  // One frame for the check: its timestamp (camera's wall clock) and where
  // the picture changed (FIT_W x FIT_H, 1 = changed).
  fitFrame(wall, mask) {
    const fit = (this.fit = this.fit || { sum: FIT_STEPS.map(() => 0), cnt: FIT_STEPS.map(() => 0), n: 0, queue: [] });
    fit.queue.push({ wall, mask });
    while (fit.queue.length && fit.queue[0].wall < wall - FIT_WAIT_MS) this._fitJudge(fit.queue.shift());
    if (fit.queue.length > 200) fit.queue.shift();
  }

  _fitJudge({ wall, mask }) {
    const fit = this.fit;
    let used = 0;
    for (const t of this.tracks.values()) {
      const pts = t.pts;
      const first = pts[0][0];
      const last = pts[pts.length - 1][0];
      // only things on the move at that time
      if (pts.length < 3 || first > wall - 300 || last < wall + 300) continue;
      const a = LiveTracks.at(t, wall - 300);
      const b = LiveTracks.at(t, wall + 300);
      if (!a || !b || Math.abs(a[0] + a[2] / 2 - (b[0] + b[2] / 2)) + Math.abs(a[1] + a[3] / 2 - (b[1] + b[3] / 2)) < 6) continue;
      used++;
      FIT_STEPS.forEach((step, k) => {
        const when = wall - step;
        if (when < first || when > last) return; // (only where it was really reported, nothing guessed)
        const box = LiveTracks.at(t, when);
        if (!box) return;
        const x0 = Math.max(0, Math.floor((box[0] / 1000) * FIT_W));
        const x1 = Math.min(FIT_W, Math.ceil(((box[0] + box[2]) / 1000) * FIT_W));
        const y0 = Math.max(0, Math.floor((box[1] / 1000) * FIT_H));
        const y1 = Math.min(FIT_H, Math.ceil(((box[1] + box[3]) / 1000) * FIT_H));
        if (x1 <= x0 || y1 <= y0) return;
        let hit = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hit += mask[y * FIT_W + x];
        fit.sum[k] += hit / ((x1 - x0) * (y1 - y0));
        fit.cnt[k]++;
      });
    }
    if (used) fit.n++;
  }

  // What the check says so far: {best (ms), from, to (as good within 5 %), n frames}.
  fitResult() {
    const fit = this.fit;
    if (!fit || !fit.n) return null;
    // (each timing by the average over the frames it could be tried on; one tried on few doesn't count)
    const most = Math.max(...fit.cnt);
    const avg = fit.sum.map((v, k) => (fit.cnt[k] >= Math.max(5, most * 0.5) ? v / fit.cnt[k] : 0));
    const top = Math.max(...avg);
    if (!(top > 0)) return null;
    const good = FIT_STEPS.filter((_, k) => avg[k] >= top * 0.95);
    // (and how well the timing in use does: the step nearest to it)
    const stamp = LIVE_STAMP_MS[this.channel] ?? LIVE_STAMP_MS[1];
    const now = FIT_STEPS.reduce((b, v, k) => (Math.abs(v - stamp) < Math.abs(FIT_STEPS[b] - stamp) ? k : b), 0);
    return { best: FIT_STEPS[avg.indexOf(top)], from: good[0], to: good[good.length - 1], n: fit.n, top, used: avg[now] };
  }

  // How far behind the camera the stream's picture on screen is (ms), as
  // well as can be told, seeing to it that it is held back as wanted.
  // delay: ms to hold back (default 700); offset: ms to add to the answer;
  // talking: true while the user talks through the camera (no holding back).
  behind(stream, { delay, offset, talking, debug } = {}) {
    this.debug = !!debug;
    const want = talking ? 0 : Math.max(0, Math.min(3000, Number.isFinite(delay) ? delay : LIVE_DELAY_MS));
    const now = Date.now();
    if (now - this.statsAt > 1000) {
      this.statsAt = now;
      this.can = LiveTracks.hold(stream, want);
      const rtc = deepFind(stream, ["HA-WEB-RTC-PLAYER"])[0];
      const pc = rtc && rtc._peerConnection;
      const hls = pc ? null : deepFind(stream, ["HA-HLS-PLAYER"])[0];
      this.kind = pc ? "webrtc" : hls ? "hls" : "other";
      // which of the camera's streams this is (the lighter ones run later)
      const ch = Number(stream && stream.stateObj && stream.stateObj.attributes && stream.stateObj.attributes.channel_id);
      this.channel = ch === 0 ? 0 : 1;
      this.watch(pc ? deepFind(stream, ["VIDEO"])[0] || null : null);
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
    // exactly, from the frame on screen (said as "behind", so moment() gives it back)
    const exact = this.kind === "webrtc" && this.gap != null ? this.exact() : null;
    this.sync = exact != null ? "rtp" : "estimate";
    if (exact != null) return now - this.gap + LIVE_TRANSIT_MS - exact + trim;
    if (this.kind === "webrtc") return (LIVE_WEBRTC_BASE_MS[this.channel] ?? LIVE_WEBRTC_BASE_MS[1]) + (this.jb != null ? this.jb : this.can ? want : 80) + trim;
    if (this.kind === "hls") return (this.hls != null ? this.hls : 4000) + LIVE_HLS_EXTRA_MS + trim;
    return 300 + trim;
  }

  // The timing in words, for looking into it (the cards' live_debug option).
  describe(behind) {
    const n = (v) => (v == null || !Number.isFinite(v) ? "?" : String(Math.round(v)));
    return [
      this.kind || "?",
      this.channel === 0 ? "main stream" : "second stream",
      this.sync === "rtp" ? "by frame timestamps" : "by estimate",
      `picture ${n(behind)} ms behind`,
      this.kind === "webrtc" ? `held ${n(this.jb)} ms${this.can ? "" : " (can't hold)"}` : this.kind === "hls" ? `player says ${n(this.hls)} ms` : "",
      this.sync === "rtp" ? `frame ${n(this.lag)} ms older than newest positions` : this.frame ? "frame timestamps don't add up" : "no frame timestamps",
      this.sync === "rtp" ? `stamp ${LIVE_STAMP_MS[this.channel] ?? LIVE_STAMP_MS[1]} ms` : "",
      this.frame && this.frame.waited != null ? `frame waited ${n(this.frame.waited)} ms` : "",
      ((r) => (r ? `picture check: fits at ${r.best} ms (${r.from} to ${r.to}; ${r.n} frames; boxes ${Math.round(r.top * 100)}% movement there, ${Math.round(r.used * 100)}% as timed now)` : this.debug && this.sync === "rtp" ? "picture check: waiting for something to move" : ""))(this.fitResult()),
    ].filter(Boolean).join(" · ");
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
