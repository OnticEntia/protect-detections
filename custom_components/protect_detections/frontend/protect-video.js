/**
 * A camera's live picture played the way Protect's own web page gets it.
 *
 * <protect-direct-stream> stands where a <ha-camera-stream> would (it is
 * given `hass` and `stateObj` the same way and holds a <video>). It opens
 * the integration's relay of the console's livestream websocket
 * (/api/protect_detections/video/<camera id>, see video.py) and plays it
 * with Media Source Extensions. Opt-in (the tracking card's
 * `direct_stream: true`); when anything about it cannot be done it fires
 * "direct-failed" {reason} and the card plays Home Assistant's stream.
 *
 * What comes down the socket is fragmented MP4 taken apart, as units of
 * [1 byte kind][3 bytes length][that many bytes]:
 *
 *   f8  the codecs, as text ("hev1.1.2.L93,mp4a.40.2")
 *   fa  the start of the file (ftyp + moov), once
 *   then for each fragment (about four frames, 133 ms):
 *   f9  a fragment begins (empty)
 *   fc  one video frame        fd  one piece of sound      (as they are made)
 *   fb  the fragment's header (moof), in pieces
 *   f7  the stream clock (ms) of its first and last frame
 *   fe  the header of its data (mdat)
 *   ff  the fragment is complete (empty)
 *
 * ProtectFrames puts each fragment back together (moof + mdat, the frames
 * where the header says they are). A fragment's own time (tfdt) is the
 * console's wall clock in 90 000ths of a second; f7 is the clock the
 * positions of tracked things carry (`clockStream`), so the frame on screen
 * can be told on that very clock: frameStream().
 *
 * None of this is Protect's documented interface: it was read off the
 * stream, and an update could change it. Then the card plays the usual one.
 */

const KIND = { CLOCK: 0xf7, CODEC: 0xf8, START: 0xf9, INIT: 0xfa, MOOF: 0xfb, VIDEO: 0xfc, AUDIO: 0xfd, MDAT: 0xfe, END: 0xff };
const MAX_UNIT = 16 * 1024 * 1024; // (a unit bigger than this is not a unit)
const DIRECT_DELAY_MS = 700;
const EDGE_MS = 150; // what the newest fragment in hand is behind the camera, about
const KEEP_S = 8; // picture kept behind the one on screen
const MAX_QUEUE = 120; // fragments waiting to be handed to the browser: more is a browser that cannot keep up

const u32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u64 = (b, at) => u32(b, at) * 2 ** 32 + u32(b, at + 4);
const name = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const join = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

// The boxes directly inside b[from..to): [{type, at (of its contents), end}].
function boxes(b, from = 0, to = b.length) {
  const out = [];
  while (from + 8 <= to) {
    const size = u32(b, from);
    if (size < 8 || from + size > to) break;
    out.push({ type: name(b, from + 4), at: from + 8, end: from + size });
    from += size;
  }
  return out;
}

// Which track of the file is the picture: {video: id, audio: id | null}.
export function trackKinds(init) {
  const out = { video: null, audio: null };
  const moov = boxes(init).find((x) => x.type === "moov");
  for (const trak of moov ? boxes(init, moov.at, moov.end).filter((x) => x.type === "trak") : []) {
    const inside = boxes(init, trak.at, trak.end);
    const tkhd = inside.find((x) => x.type === "tkhd");
    const mdia = inside.find((x) => x.type === "mdia");
    const hdlr = mdia && boxes(init, mdia.at, mdia.end).find((x) => x.type === "hdlr");
    if (!tkhd || !hdlr) continue;
    const id = u32(init, tkhd.at + (init[tkhd.at] ? 20 : 12));
    const kind = name(init, hdlr.at + 8);
    if (kind === "vide" && out.video == null) out.video = id;
    else if (kind === "soun" && out.audio == null) out.audio = id;
  }
  return out;
}

// What a fragment's header says of each track: [{track, time, offset, count, key (its first keyframe: which frame, or null)}].
function fragmentTracks(moof) {
  const out = [];
  for (const traf of boxes(moof, 8).filter((x) => x.type === "traf")) {
    const t = { track: null, time: null, offset: null, count: 0, key: null };
    for (const x of boxes(moof, traf.at, traf.end)) {
      if (x.type === "tfhd") t.track = u32(moof, x.at + 4);
      else if (x.type === "tfdt") t.time = moof[x.at] ? u64(moof, x.at + 4) : u32(moof, x.at + 4);
      else if (x.type === "trun") {
        const flags = u32(moof, x.at) & 0xffffff;
        t.count += u32(moof, x.at + 4);
        let at = x.at + 8;
        if (flags & 0x1) {
          if (t.offset == null) t.offset = u32(moof, at) | 0;
          at += 4;
        }
        // which frame is the first keyframe (bit 16 of a frame's flags: it needs others, so is none)
        const count = u32(moof, x.at + 4);
        if (flags & 0x4) {
          if (t.key == null && !(u32(moof, at) & 0x10000)) t.key = 0;
          at += 4;
        }
        if (flags & 0x400) {
          const step = 4 * ((flags & 0x100 ? 1 : 0) + (flags & 0x200 ? 1 : 0) + 1 + (flags & 0x800 ? 1 : 0));
          const skip = (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0);
          for (let i = 0; i < count && t.key == null; i++) if (!(u32(moof, at + i * step + skip) & 0x10000)) t.key = i;
        }
      }
    }
    out.push(t);
  }
  return out;
}

/**
 * The units of the socket, put back together. feed(bytes) returns what has
 * become complete: {kind: "codec", text} | {kind: "init", data, tracks} |
 * {kind: "segment", data, time (s, the console's wall clock), stream (ms on
 * the positions' clock, or null), frames, key (has a keyframe), keyAt (which
 * frame)}. `broken` says why it gave up.
 */
export class ProtectFrames {
  constructor() {
    this.buf = new Uint8Array(0);
    this.cur = null;
    this.tracks = { video: null, audio: null };
    this.broken = null;
  }

  feed(chunk) {
    const out = [];
    if (this.broken) return out;
    this.buf = this.buf.length ? join([this.buf, chunk]) : chunk;
    let at = 0;
    const b = this.buf;
    while (at + 4 <= b.length && !this.broken) {
      const kind = b[at];
      const size = (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
      if (kind < KIND.CLOCK || size > MAX_UNIT) {
        this.broken = `not a unit this knows (${kind.toString(16)}, ${size} bytes)`;
        break;
      }
      if (at + 4 + size > b.length) break;
      const body = b.subarray(at + 4, at + 4 + size);
      at += 4 + size;
      try {
        this._unit(kind, body, out);
      } catch (err) {
        this.broken = `a fragment that could not be read (${err && err.message})`;
      }
    }
    this.buf = this.broken ? new Uint8Array(0) : at ? b.slice(at) : b;
    return out;
  }

  _unit(kind, body, out) {
    const cur = this.cur;
    if (kind === KIND.CODEC) out.push({ kind: "codec", text: String.fromCharCode(...body) });
    else if (kind === KIND.INIT) {
      const data = body.slice();
      this.tracks = trackKinds(data);
      out.push({ kind: "init", data, tracks: this.tracks });
    } else if (kind === KIND.START) this.cur = { video: [], audio: [], moof: [], clock: null, mdat: null };
    else if (!cur) return; // (joined in the middle of a fragment: the next one is whole)
    else if (kind === KIND.VIDEO) cur.video.push(body.slice());
    else if (kind === KIND.AUDIO) cur.audio.push(body.slice());
    else if (kind === KIND.MOOF) cur.moof.push(body.slice());
    else if (kind === KIND.CLOCK) cur.clock = body.length >= 8 ? u64(body, 0) : null;
    else if (kind === KIND.MDAT) cur.mdat = body.slice();
    else if (kind === KIND.END) {
      this.cur = null;
      const seg = this._segment(cur);
      if (seg) out.push(seg);
    }
  }

  _segment(cur) {
    const moof = join(cur.moof);
    if (moof.length < 16 || name(moof, 4) !== "moof" || u32(moof, 0) !== moof.length) throw new Error("its header is not whole");
    const data = { [this.tracks.video]: cur.video, [this.tracks.audio]: cur.audio };
    const tracks = fragmentTracks(moof).sort((a, b) => (a.offset || 0) - (b.offset || 0));
    const video = tracks.find((t) => t.track === this.tracks.video);
    if (!video || video.count !== cur.video.length) throw new Error("its frames are not the ones its header counts");
    const parts = [moof, cur.mdat || new Uint8Array(0)];
    let at = moof.length + 8;
    for (const t of tracks) {
      const mine = data[t.track] || [];
      if (t.count !== mine.length || (t.offset != null && t.offset !== at)) throw new Error("its data is not where its header says");
      for (const p of mine) {
        parts.push(p);
        at += p.length;
      }
    }
    if (!cur.mdat || cur.mdat.length !== 8 || name(cur.mdat, 4) !== "mdat" || u32(cur.mdat, 0) !== at - moof.length) throw new Error("its data has another size than said");
    return { kind: "segment", data: join(parts), time: video.time / 90000, stream: cur.clock, frames: video.count, key: video.key != null, keyAt: video.key };
  }
}

// The codecs as this browser's Media Source takes them, or null.
export function pickType(MS, text) {
  const [video, ...rest] = String(text || "").split(",");
  if (!video) return null;
  const names = [video.replace(/^hev1/, "hvc1"), video];
  const tries = [];
  for (const v of names) {
    tries.push(v);
    if (/^h(vc|ev)1\.[^.]+\.[^.]+\.[^.]+$/.test(v)) tries.push(v + ".B0"); // (some want the last part said)
  }
  for (const v of tries) {
    const type = `video/mp4; codecs="${[v, ...rest].join(",")}"`;
    if (MS.isTypeSupported(type)) return type;
  }
  return null;
}

// The stream clock (ms) of the frame at media time t (s), from the fragments
// played: [{t, stream}], oldest first. null when it cannot be told.
export function streamAt(segs, t) {
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s.t <= t + 0.0005) return s.stream == null || t - s.t > 1 ? null : s.stream + (t - s.t) * 1000;
  }
  return null;
}

class ProtectDirectStream extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `<style>:host { display: block; } video { display: block; width: 100%; max-height: var(--video-max-height, 100%); object-fit: contain; background: #000; }</style><video muted playsinline autoplay></video>`;
    this.delay = DIRECT_DELAY_MS; // how far behind the newest picture it plays (ms), so positions can be in
    this.failed = null;
    this._run = null;
  }

  get video() {
    return this.shadowRoot.querySelector("video");
  }

  set hass(hass) {
    this._hass = hass;
    this._start();
  }

  get hass() {
    return this._hass;
  }

  set stateObj(state) {
    const was = this._state && this._state.entity_id;
    this._state = state;
    if (was && state && was !== state.entity_id) this._stop();
    this._start();
  }

  get stateObj() {
    return this._state;
  }

  connectedCallback() {
    this._start();
  }

  disconnectedCallback() {
    this._stop();
  }

  _fail(run, reason) {
    if (this._run !== run) return;
    this._stop();
    this.failed = reason;
    this.dispatchEvent(new CustomEvent("direct-failed", { detail: { reason } }));
  }

  async _start() {
    if (this._run || this.failed || !this._hass || !this._state || !this.isConnected) return;
    const run = (this._run = { frames: new ProtectFrames(), queue: [], segs: [], base: null, codec: "", frame: null, playing: false });
    const MS = globalThis.ManagedMediaSource || globalThis.MediaSource;
    if (!MS) return this._fail(run, "this browser cannot be handed a picture piece by piece (no Media Source)");
    run.MS = MS;
    try {
      const entity = this._state.entity_id;
      const known = await this._hass.callWS({ type: "protect_detections/live/cameras" });
      const id = known && known.cameras && known.cameras[entity];
      if (this._run !== run) return;
      if (!id) return this._fail(run, "not a camera whose picture can be had this way");
      const ch = Number(this._state.attributes && this._state.attributes.channel_id);
      run.channel = ch === 0 || ch === 2 ? ch : 1;
      const signed = await this._hass.callWS({ type: "auth/sign_path", path: `/api/protect_detections/video/${id}?channel=${run.channel}`, expires: 30 });
      if (this._run !== run) return;
      const ws = (run.ws = new WebSocket(location.origin.replace(/^http/, "ws") + signed.path));
      ws.binaryType = "arraybuffer";
      ws.onmessage = (ev) => {
        if (this._run !== run) return;
        if (typeof ev.data === "string") {
          let msg = {};
          try {
            msg = JSON.parse(ev.data);
          } catch (e) {}
          if (msg.error) this._fail(run, msg.error);
          return;
        }
        this._bytes(run, new Uint8Array(ev.data));
      };
      ws.onclose = () => this._fail(run, run.playing ? "the direct picture ended" : "the direct picture could not be opened (has Home Assistant been restarted since the update?)");
      run.timer = setInterval(() => this._tend(run), 500);
    } catch (err) {
      this._fail(run, (err && err.message) || "the direct picture could not be asked for");
    }
  }

  _bytes(run, bytes) {
    for (const item of run.frames.feed(bytes)) {
      if (item.kind === "codec") run.codec = item.text;
      else if (item.kind === "init") this._open(run, item.data);
      else if (item.kind === "segment") {
        // (the browser shows nothing before the first keyframe: what comes before one is not handed to it)
        if (run.base == null) {
          if (!item.key) continue;
          run.base = item.time;
        }
        run.segs.push({ t: item.time - run.base, stream: item.stream });
        if (run.segs.length > 400) run.segs.splice(0, 100);
        run.queue.push(item.data);
        if (run.queue.length > MAX_QUEUE) return this._fail(run, "this device could not keep up with the direct picture");
        this._pump(run);
      }
    }
    if (run.frames.broken) this._fail(run, `the direct picture is not made as expected: ${run.frames.broken}`);
  }

  _open(run, init) {
    run.type = pickType(run.MS, run.codec);
    if (!run.type) return this._fail(run, `this browser cannot play ${run.codec || "this picture"} handed to it piece by piece`);
    const video = this.video;
    const ms = (run.ms = new run.MS());
    video.disableRemotePlayback = true; // (asked of a page that uses the managed kind)
    run.url = URL.createObjectURL(ms);
    video.src = run.url;
    ms.addEventListener(
      "sourceopen",
      () => {
        if (this._run !== run) return;
        try {
          const sb = (run.sb = ms.addSourceBuffer(run.type));
          sb.mode = "segments";
          sb.addEventListener("updateend", () => this._pump(run));
          sb.addEventListener("error", () => this._fail(run, "the browser would not take the direct picture"));
          run.queue.unshift(init);
          run.first = true;
          this._pump(run);
        } catch (err) {
          this._fail(run, `the browser would not start the direct picture (${err && err.message})`);
        }
      },
      { once: true }
    );
    if (typeof video.requestVideoFrameCallback === "function") {
      const step = (now, meta) => {
        if (this._run !== run) return;
        const wait = meta && Number.isFinite(meta.expectedDisplayTime) && typeof performance !== "undefined" ? Math.max(0, Math.min(100, meta.expectedDisplayTime - performance.now())) : 0;
        if (meta && Number.isFinite(meta.mediaTime)) run.frame = { t: meta.mediaTime, at: Date.now() + wait };
        video.requestVideoFrameCallback(step);
      };
      video.requestVideoFrameCallback(step);
      run.frames_told = true;
    }
  }

  _pump(run) {
    const sb = run.sb;
    if (this._run !== run || !sb || sb.updating || !run.queue.length) return;
    try {
      if (run.first) run.first = false; // (the start of the file)
      else if (!run.offset && run.base != null) {
        // media time starts at nought: the console's clock is kept here, not in the player
        sb.timestampOffset = -run.base;
        run.offset = true;
      }
      sb.appendBuffer(run.queue.shift());
    } catch (err) {
      this._fail(run, `the browser would not take the direct picture (${err && err.name})`);
    }
  }

  // Twice a second: stay the wanted time behind the newest picture, and let go of what has been shown.
  _tend(run) {
    const video = this.video;
    const sb = run.sb;
    if (this._run !== run || !sb || !video.buffered || !video.buffered.length) return;
    const b = video.buffered;
    const start = b.start(0);
    const end = b.end(b.length - 1);
    const want = Math.max(0.25, ((Number.isFinite(this.delay) ? this.delay : DIRECT_DELAY_MS) - EDGE_MS) / 1000);
    const lag = end - video.currentTime;
    if (video.currentTime < start || lag > want + 2 || lag < 0) video.currentTime = Math.max(start, end - want);
    else video.playbackRate = lag > want + 0.2 ? 1.08 : lag < want - 0.2 ? 0.92 : 1;
    if (video.paused && typeof video.play === "function") Promise.resolve(video.play()).catch(() => {});
    if (video.currentTime > 0) run.playing = true;
    run.lag = lag * 1000;
    try {
      if (!sb.updating && video.currentTime - start > KEEP_S * 2.5) sb.remove(start, video.currentTime - KEEP_S);
    } catch (e) {}
  }

  // The stream clock (ms, the one positions carry) of the frame on screen; null when it cannot be told.
  frameStream() {
    const run = this._run;
    if (!run || run.base == null) return null;
    const f = run.frame;
    if (f) return Date.now() - f.at > 1500 ? null : streamAt(run.segs, f.t);
    // (a browser that does not tell its frames: the player's own time, good to a frame or so)
    return run.frames_told || !run.playing || this.video.paused ? null : streamAt(run.segs, this.video.currentTime);
  }

  // For looking into it (live_debug).
  info() {
    const run = this._run;
    if (!run) return this.failed ? `direct picture not used: ${this.failed}` : "direct picture not started";
    return [`direct picture ${run.codec || "?"}`, run.channel === 0 ? "main stream" : run.channel === 2 ? "third stream" : "second stream", run.lag != null ? `${Math.round(run.lag)} ms in hand` : "", run.frames_told ? "" : "frames not told (player's time used)"].filter(Boolean).join(", ");
  }

  _stop() {
    const run = this._run;
    this._run = null;
    if (!run) return;
    clearInterval(run.timer);
    if (run.ws) {
      run.ws.onclose = null;
      try {
        run.ws.close();
      } catch (e) {}
    }
    const video = this.video;
    try {
      video.removeAttribute("src");
      if (typeof video.load === "function") video.load();
    } catch (e) {}
    if (run.url) URL.revokeObjectURL(run.url);
  }
}

if (!customElements.get("protect-direct-stream")) customElements.define("protect-direct-stream", ProtectDirectStream);
