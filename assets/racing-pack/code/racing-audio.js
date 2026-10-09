/**
 * racing-audio.js — engine sound engine for the 100-Car Pack.
 * Zero dependencies, Web Audio API.
 *
 * The pack ships five seamless loops per engine family (idle / low / mid /
 * high / redline), each recorded at a known RPM. This class keeps all five
 * playing at once, pitch-shifts each to the target RPM and cross-fades
 * between the two nearest bands, which gives a continuous, artefact-free
 * engine note across the whole rev range.
 *
 *   const audio = new RacingAudio('./audio');
 *   await audio.init();
 *   const engine = await audio.createEngine('v8');   // family from car.engine.sound_family
 *   engine.start();
 *   engine.setRpm(4200);      // call every frame
 *   engine.setLoad(0.8);      // 0 = coasting, 1 = full throttle
 *   audio.playSfx('tyre_skid_short');
 */
const BANDS = ['idle', 'low', 'mid', 'high', 'redline'];

export class RacingAudio {
  constructor(basePath = './audio', { format = 'ogg' } = {}) {
    this.base = basePath.replace(/\/$/, '');
    this.format = format;                 // 'ogg' (small) or 'wav' (uncompressed)
    this.ctx = null;
    this.manifest = null;
    this.buffers = new Map();
    this.master = null;
    this.engineBus = null;
    this.sfxBus = null;
  }

  async init(existingContext) {
    this.ctx = existingContext || new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.engineBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.engineBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.manifest = await (await fetch(`${this.base}/audio_manifest.json`)).json();
    return this;
  }

  setVolume(v)       { this.master.gain.value = v; }
  setEngineVolume(v) { this.engineBus.gain.value = v; }
  setSfxVolume(v)    { this.sfxBus.gain.value = v; }

  _url(rel) { return `${this.base}/${rel.replace(/\.wav$/, '.' + this.format)}`; }

  async load(rel) {
    if (this.buffers.has(rel)) return this.buffers.get(rel);
    const p = fetch(this._url(rel))
      .then(r => r.arrayBuffer())
      .then(b => this.ctx.decodeAudioData(b));
    this.buffers.set(rel, p);
    return p;
  }

  /** Pre-load every engine family and SFX the given cars need. */
  async preload(cars) {
    const rel = new Set();
    for (const c of cars) {
      const e = this.manifest.engines[c.engine.sound_family];
      if (!e) continue;
      for (const b of BANDS) rel.add(e.loops[b].file);
      rel.add(e.rev); rel.add(e.start);
    }
    for (const s of Object.values(this.manifest.sfx)) rel.add(s.file);
    await Promise.all([...rel].map(r => this.load(r)));
  }

  async createEngine(family) {
    const spec = this.manifest.engines[family];
    if (!spec) throw new Error(`unknown engine family: ${family}`);
    const bufs = await Promise.all(BANDS.map(b => this.load(spec.loops[b].file)));
    return new EngineVoice(this, spec, bufs);
  }

  async playSfx(name, { volume = 1, rate = 1, loop = false, pan = 0 } = {}) {
    const s = this.manifest.sfx[name];
    if (!s) throw new Error(`unknown sfx: ${name}`);
    const src = this.ctx.createBufferSource();
    src.buffer = await this.load(s.file);
    src.loop = loop || s.loop;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = volume;
    const p = this.ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(g).connect(p).connect(this.sfxBus);
    src.start();
    return { source: src, gain: g, panner: p, stop: (t = 0.05) => {
      g.gain.setTargetAtTime(0, this.ctx.currentTime, t / 3);
      src.stop(this.ctx.currentTime + t);
    }};
  }
}

class EngineVoice {
  constructor(host, spec, buffers) {
    this.host = host; this.spec = spec;
    this.ctx = host.ctx;
    this.rpms = BANDS.map(b => spec.loops[b].rpm);
    this.out = this.ctx.createGain();
    this.out.gain.value = 0;
    this.panner = this.ctx.createStereoPanner();
    this.out.connect(this.panner).connect(host.engineBus);
    this.layers = buffers.map(buf => {
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const g = this.ctx.createGain(); g.gain.value = 0;
      src.connect(g).connect(this.out);
      return { src, g };
    });
    this.rpm = spec.idle_rpm || 900;
    this.load = 0;
    this.started = false;
  }

  start(fadeIn = 0.12) {
    if (this.started) return this;
    const t = this.ctx.currentTime;
    this.layers.forEach(l => l.src.start(t));
    this.out.gain.setTargetAtTime(1, t, fadeIn / 3);
    this.started = true;
    this._apply();
    return this;
  }

  /** Play the one-shot starter-motor sample, then fade the idle in behind it. */
  async cranking() {
    const buf = await this.host.load(this.spec.start);
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.connect(this.host.engineBus); src.start();
    setTimeout(() => this.start(0.4), (buf.duration - 0.5) * 1000);
    return src;
  }

  setRpm(rpm)  { this.rpm = Math.max(1, rpm); this._apply(); return this; }
  setLoad(l)   { this.load = Math.min(1, Math.max(0, l)); this._apply(); return this; }
  setPan(p)    { this.panner.pan.value = p; return this; }

  _apply() {
    if (!this.started) return;
    const t = this.ctx.currentTime, tc = 0.03;
    const r = this.rpm;
    // pick the two bands that bracket the current rpm
    let hi = this.rpms.findIndex(x => x >= r);
    if (hi < 0) hi = this.rpms.length - 1;
    const lo = Math.max(0, hi - 1);
    const span = this.rpms[hi] - this.rpms[lo];
    const mixHi = span > 0 ? Math.min(1, Math.max(0, (r - this.rpms[lo]) / span)) : 1;
    // load leans the mix toward the higher, more aggressive band
    const bias = 0.18 * this.load;
    const wHi = Math.min(1, mixHi + bias), wLo = 1 - wHi;
    this.layers.forEach((l, i) => {
      const w = i === hi ? wHi : i === lo ? wLo : 0;
      // equal-power cross-fade, and a little quieter off-throttle
      const gain = Math.sqrt(w) * (0.55 + 0.45 * this.load);
      l.g.gain.setTargetAtTime(gain, t, tc);
      if (w > 0) l.src.playbackRate.setTargetAtTime(r / this.rpms[i], t, tc);
    });
  }

  stop(fade = 0.25) {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    this.layers.forEach(l => l.src.stop(t + fade + 0.05));
    this.started = false;
  }
}

export default RacingAudio;
