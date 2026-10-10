// gameAudio.js: the game's sound, as a clean arcade mix.
//
//   music  ─► musicGain ─► musicDuck ─┐
//   engine ─► engineGain ─────────────┼─► master ─► limiter ─► speakers
//   sfx    ─► sfxGain ────────────────┘
//
// Three buses and nothing else. The older broadcast package (js/audio.js)
// layered dozens of synthesized beds (wind, crowd, MGU-K whine, kerb noise,
// opponent engines, radio) on top of the sampled sounds, which played as one
// mashed-together noise; it is no longer used by the game.
//
// * Music: CC0 tracks in assets/music (see ASSET_PROVENANCE.md), streamed with
//   <audio> elements: a menu track and a shuffled race playlist with
//   crossfades. Big crashes duck it briefly.
// * Engine: only the player's car, from the racing pack's recorded loops for its
//   engine type, crossfaded between the two rev bands that bracket the rpm and
//   pitched to match, driven through a small engine model (rev inertia, load,
//   gear changes) so it rises, falls and burbles like the real thing.
// * Effects: one recorded sample per event, each with its own cooldown, and a
//   cap on simultaneous voices so nothing stacks into noise.
//
// The AudioContext starts on the first user gesture (init()); every call
// before that is a harmless no-op.

const MUSIC = Object.freeze({
  menu: Object.freeze(['assets/music/menu_synth_wave.mp3']),
  race: Object.freeze([
    'assets/music/race_diamond_race.mp3',
    'assets/music/race_drum_and_bass.mp3',
    'assets/music/race_synthwave_type.mp3',
  ]),
});

const BANDS = ['idle', 'low', 'mid', 'high', 'redline'];

// Effects used, by event: [file in the pack's sfx folder, gain, cooldown s].
const SFX = Object.freeze({
  nitroOn: ['nitro_activate', 0.42, 0.6],
  takedown: ['collision_heavy', 0.62, 0.3],
  crashHeavy: ['collision_heavy', 0.5, 0.35],
  crashMedium: ['collision_medium', 0.42, 0.25],
  crashLight: ['collision_light', 0.32, 0.18],
  blowoff: ['turbo_blowoff', 0.22, 1.2],
  backfire: ['backfire_pop', 0.26, 0.5],
  hornA: ['horn_a', 0.22, 1.5],
  hornB: ['horn_b', 0.22, 1.5],
  shiftUp: ['gearshift_up', 0.16, 0.12],
  shiftDown: ['gearshift_down', 0.16, 0.12],
  beep: ['countdown_beep', 0.38, 0.3],
  go: ['countdown_go', 0.45, 0.5],
  finish: ['race_finish', 0.45, 2],
  uiSelect: ['ui_select', 0.18, 0.05],
  uiConfirm: ['ui_confirm', 0.22, 0.1],
  chirp: ['tyre_chirp', 0.16, 0.6],
});
const LOOPS = Object.freeze({ nitro: 'nitro_loop', screech: 'tyre_screech_loop', scrape: 'scrape_loop' });
const MAX_VOICES = 8;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class GameAudio {
  constructor() {
    this.ctx = null;
    this._ready = false;
    this._volume = 1;
    this._musicVolume = 0.8;
    this._muted = false;
    this._buffers = new Map();        // url -> Promise<AudioBuffer>
    this._sfx = {};                   // event -> AudioBuffer
    this._cool = {};                  // event -> audio-clock time it may play again
    this._voices = 0;
    this._loops = {};                 // name -> { src, gain }
    this._engine = null;              // { spec, layers: [{ src, gain, rpm }], decel }
    this._engineOn = false;
    this._wantMusic = null;
    this._music = null;               // { kind, el, node, gain, index }
    this._packBase = 'assets/racing-pack/audio/';
  }

  get ready() { return this._ready; }

  // ---- setup ---------------------------------------------------------------

  init() {
    if (this._ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : this._volume;
    this.master.connect(limiter);
    this.musicDuck = ctx.createGain();
    this.musicDuck.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.42 * this._musicVolume;
    this.musicGain.connect(this.musicDuck);
    // engine: loops -> load filter (bright on throttle, muffled off it) -> gain
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.master);
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 6000;
    this.engineFilter.Q.value = 0.7;
    this.engineFilter.connect(this.engineGain);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);
    this._ready = true;
    this.loadArcadeSfx(this._packBase);
    if (this._family) this.loadCarSoundFamily(this._family, this._packBase);
    if (this._wantMusic) this.playMusic(this._wantMusic);
  }

  setVolume(v) {
    this._volume = clamp(Number(v) || 0, 0, 1);
    if (this.master) this.master.gain.setTargetAtTime(this._muted ? 0 : this._volume, this.ctx.currentTime, 0.05);
  }

  setMuted(m) {
    this._muted = !!m;
    this.setVolume(this._volume);
  }

  setMusicVolume(v) {
    this._musicVolume = clamp(Number(v) || 0, 0, 1);
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(0.42 * this._musicVolume, this.ctx.currentTime, 0.1);
  }

  _load(url) {
    if (!this._buffers.has(url)) {
      this._buffers.set(url, fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${url}`))))
        .then((b) => this.ctx.decodeAudioData(b)));
    }
    return this._buffers.get(url);
  }

  _pack(rel) {
    // the manifest names .wav files; the pack ships .ogg
    return `${this._packBase.replace(/\/$/, '')}/${String(rel).replace(/\.wav$/i, '.ogg')}`;
  }

  async _manifest() {
    if (!this._manifestPromise) {
      this._manifestPromise = fetch(`${this._packBase.replace(/\/$/, '')}/audio_manifest.json`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('audio manifest'))))
        .catch((e) => { this._manifestPromise = null; throw e; });
    }
    return this._manifestPromise;
  }

  // ---- music ---------------------------------------------------------------

  /** 'menu', 'race' or null (silence). Crossfades from whatever is playing. */
  playMusic(kind) {
    this._wantMusic = kind;
    if (!this._ready) return;
    if (this._music?.kind === kind) return;
    this._fadeOutMusic(1.2);
    if (!kind || !MUSIC[kind]) return;
    const list = MUSIC[kind];
    const index = kind === 'race' ? Math.floor(Math.random() * list.length) : 0;
    this._startTrack(kind, index);
  }

  _startTrack(kind, index) {
    const list = MUSIC[kind];
    const el = new Audio(list[index % list.length]);
    el.crossOrigin = 'anonymous';
    el.loop = list.length === 1;
    el.preload = 'auto';
    const node = this.ctx.createMediaElementSource(el);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    node.connect(gain).connect(this.musicGain);
    gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.6);
    const track = { kind, el, node, gain, index };
    // the race playlist runs on: next track when this one ends
    el.addEventListener('ended', () => {
      if (this._music === track && !el.loop) {
        this._fadeOutMusic(0.3);
        this._startTrack(kind, index + 1);
      }
    });
    el.play().catch(() => {});
    this._music = track;
  }

  _fadeOutMusic(seconds) {
    const m = this._music;
    if (!m) return;
    this._music = null;
    m.gain.gain.setTargetAtTime(0, this.ctx.currentTime, seconds / 3);
    setTimeout(() => {
      try { m.el.pause(); m.node.disconnect(); m.gain.disconnect(); } catch { /* already gone */ }
    }, seconds * 1000 + 200);
  }

  /** Dip the music under a big moment. */
  _duck(amount = 0.45, hold = 0.35) {
    if (!this._ready) return;
    const t = this.ctx.currentTime;
    const g = this.musicDuck.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - amount, t, 0.03);
    g.setTargetAtTime(1, t + hold, 0.4);
  }

  // ---- engine ----------------------------------------------------------------

  async loadCarSoundFamily(family, base = this._packBase) {
    this._packBase = base || this._packBase;
    // the open-wheel car has no recording of its own: the screaming V10 fits
    this._family = family && family !== 'formula' ? family : 'v10';
    if (!this._ready) return false;
    const want = this._family;
    const manifest = await this._manifest().catch(() => null);
    const spec = manifest?.engines?.[want] || manifest?.engines?.v8;
    if (!spec?.loops) return false;
    const buffers = await Promise.all(BANDS.map((b) => this._load(this._pack(spec.loops[b].file)).catch(() => null)));
    const decel = spec.decel ? await this._load(this._pack(spec.decel)).catch(() => null) : null;
    const start = spec.start ? await this._load(this._pack(spec.start)).catch(() => null) : null;
    if (this._family !== want || buffers.some((b) => !b)) return false;
    this._disposeEngine();
    const mk = (buffer) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.engineFilter);
      src.start();
      return { src, gain };
    };
    this._engine = {
      idle: spec.idle_rpm || 800,
      redline: spec.redline_rpm || 7000,
      layers: BANDS.map((b, i) => ({ ...mk(buffers[i]), rpm: spec.loops[b].rpm })),
      decel: decel ? mk(decel) : null,
      start,
    };
    this._rpm = this._engine.idle;
    this._load01 = 0;
    this._started = false;
    if (this._engineOn) this.startEngine();
    return true;
  }

  clearCarSoundFamily() {
    this._family = null;
    this._disposeEngine();
  }

  _disposeEngine() {
    const e = this._engine;
    this._engine = null;
    if (!e) return;
    for (const l of [...e.layers, e.decel].filter(Boolean)) {
      try { l.src.stop(); l.src.disconnect(); l.gain.disconnect(); } catch { /* stopped */ }
    }
  }

  startEngine() {
    this._engineOn = true;
    if (!this._ready) return;
    this.engineGain.gain.setTargetAtTime(0.5, this.ctx.currentTime, 0.25);
    // the starter motor and catch, once per car
    const e = this._engine;
    if (e?.start && !this._started) {
      this._started = true;
      const src = this.ctx.createBufferSource();
      src.buffer = e.start;
      const g = this.ctx.createGain();
      g.gain.value = 0.45;
      src.connect(g).connect(this.engineGain);
      src.start();
    }
  }

  stopEngine() {
    this._engineOn = false;
    if (this._ready) this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
    for (const l of Object.values(this._loops)) l.gain.gain.setTargetAtTime(0, this.ctx?.currentTime || 0, 0.08);
  }

  /**
   * Per frame. s = { rpmFrac (0-1 of the rev range), throttle, brake, speed,
   * gear }. The sound follows an engine model rather than the raw value:
   * - revs have inertia: they climb fast under throttle, fall slowly when you
   *   lift, and drop quickly through an upshift;
   * - standing still, the throttle free-revs the engine (the grid);
   * - load: on throttle the recorded loops play bright through an open filter;
   *   off throttle and under braking they fade toward the overrun loop and
   *   the filter closes, the muffled burble of engine braking.
   */
  update(dt, s) {
    if (!this._ready) return;
    const e = this._engine;
    if (!e || !s) return;
    dt = clamp(dt || 0.016, 0.001, 0.1);
    const t = this.ctx.currentTime;
    const range = e.redline - e.idle;
    const thr = clamp(s.throttle || 0, 0, 1);
    const speed = s.speed || 0;
    let target = e.idle + clamp(s.rpmFrac || 0, 0, 1) * range;
    if (speed < 2) target = e.idle + thr * 0.62 * range;          // free revs on the grid
    // gear changes: an upshift drops the revs in a blink
    const shifted = s.gear != null && this._gear != null && s.gear !== this._gear;
    this._gear = s.gear;
    if (shifted) this._shiftT = 0.09;
    this._shiftT = Math.max(0, (this._shiftT || 0) - dt);
    const rise = (thr > 0.1 ? 1.6 : 0.5) * range;               // rpm per second
    const fall = this._shiftT > 0 ? 12 * range : (thr > 0.1 ? 1.4 : 0.55) * range;
    const d = target - this._rpm;
    this._rpm += d > 0 ? Math.min(d, rise * dt) : Math.max(d, -fall * dt);
    const rpm = this._rpm;
    const revs = clamp((rpm - e.idle) / range, 0, 1);
    // load follows the throttle with a little lag; braking means none
    const loadTarget = (s.brake || 0) > 0.1 ? 0 : thr;
    this._load01 += (loadTarget - this._load01) * Math.min(1, dt * 9);
    const load = this._load01;
    // the two bands either side of the rpm, equal-power crossfade, pitched
    let hi = e.layers.findIndex((l) => l.rpm >= rpm);
    if (hi < 0) hi = e.layers.length - 1;
    const lo = Math.max(0, hi - 1);
    const span = Math.max(1, e.layers[hi].rpm - e.layers[lo].rpm);
    const x = lo === hi ? 1 : clamp((rpm - e.layers[lo].rpm) / span, 0, 1);
    const onLoad = 0.3 + 0.7 * load;
    e.layers.forEach((l, i) => {
      const w = i === hi ? Math.sin(x * Math.PI / 2) : i === lo ? Math.cos(x * Math.PI / 2) : 0;
      l.gain.gain.setTargetAtTime(w * onLoad, t, 0.03);
      l.src.playbackRate.setTargetAtTime(clamp(rpm / l.rpm, 0.5, 2), t, 0.03);
    });
    if (e.decel) {
      // the overrun loop carries the sound while coasting and braking
      const overrun = (1 - load) * clamp(revs * 1.6, 0, 1) * (speed > 3 ? 0.75 : 0.2);
      e.decel.gain.gain.setTargetAtTime(overrun, t, 0.05);
      e.decel.src.playbackRate.setTargetAtTime(clamp(0.7 + revs * 0.6, 0.5, 1.6), t, 0.05);
    }
    // the exhaust note opens up with load and revs
    const cutoff = 700 + (2200 + 9000 * load) * (0.55 + 0.45 * revs);
    this.engineFilter.frequency.setTargetAtTime(cutoff, t, 0.04);
  }

  // ---- effects -------------------------------------------------------------

  async loadArcadeSfx(base = this._packBase) {
    this._packBase = base || this._packBase;
    if (!this._ready || this._sfxLoading) return;
    this._sfxLoading = true;
    const names = new Set([...Object.values(SFX).map((v) => v[0]), ...Object.values(LOOPS)]);
    await Promise.allSettled([...names].map(async (n) => {
      this._sfx[n] = await this._load(this._pack(`sfx/${n}.wav`));
    }));
  }

  /** Play one effect, respecting its cooldown and the voice cap. */
  _play(event, { gain = 1, rate = 1, pan = 0, jitter = 0.04 } = {}) {
    const def = SFX[event];
    if (!this._ready || !def) return false;
    const buffer = this._sfx[def[0]];
    const now = this.ctx.currentTime;
    if (!buffer || now < (this._cool[event] || 0) || this._voices >= MAX_VOICES) return false;
    this._cool[event] = now + def[2];              // next time this event may sound
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 2 * jitter);
    const g = this.ctx.createGain();
    g.gain.value = def[1] * gain;
    let out = g;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p);
      out = p;
    }
    src.connect(g);
    out.connect(this.sfxGain);
    this._voices++;
    src.onended = () => { this._voices--; try { src.disconnect(); g.disconnect(); out.disconnect(); } catch { /* gone */ } };
    src.start();
    return true;
  }

  _loop(name) {
    if (this._loops[name]) return this._loops[name];
    const buffer = this._sfx[LOOPS[name]];
    if (!buffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.sfxGain);
    src.start();
    return (this._loops[name] = { src, gain });
  }

  /** Arcade layers: nitro roar, drift screech, wall scrape, lift-off pops. */
  updateArcade(dt, a) {
    if (!this._ready || !this._engineOn) return;
    const t = this.ctx.currentTime;
    const nitro = this._loop('nitro');
    if (nitro) nitro.gain.gain.setTargetAtTime(a.boosting ? 0.22 : 0, t, a.boosting ? 0.08 : 0.2);
    if (a.boosting && !this._wasBoosting) this._play('nitroOn');
    this._wasBoosting = !!a.boosting;
    const screech = this._loop('screech');
    // only a drift screeches: braking is the engine winding down, not tyres
    const slide = a.drifting ? clamp(0.5 + (a.driftAngle || 0) * 1.4, 0, 1) : 0;
    if (screech) screech.gain.gain.setTargetAtTime(slide * 0.2, t, slide ? 0.06 : 0.15);
    const scrape = this._loop('scrape');
    if (scrape) scrape.gain.gain.setTargetAtTime(a.scraping && a.speed > 6 ? 0.18 : 0, t, 0.05);
    if ((this._lastThrottle || 0) > 0.7 && (a.throttle || 0) < 0.2 && (a.rpmFrac || 0) > 0.6) {
      if (this._turbo) this._play('blowoff');
      if (Math.random() < 0.5) this._play('backfire');
    }
    this._lastThrottle = a.throttle || 0;
  }

  setEngineTraits({ turbo = false } = {}) { this._turbo = !!turbo; }

  takedown() { if (this._play('takedown')) this._duck(0.5, 0.45); }
  nearMiss(side = 0) { this._play('chirp', { pan: side * 0.5 }); }
  trafficHit(boosting = false) {
    this._play(boosting ? 'crashMedium' : 'crashHeavy');
    this._play(Math.random() < 0.5 ? 'hornA' : 'hornB', { pan: (Math.random() - 0.5) });
    if (!boosting) this._duck(0.35, 0.3);
  }
  trafficHorn(pan = 0) { this._play(Math.random() < 0.5 ? 'hornA' : 'hornB', { pan, gain: 0.7 }); }

  shift(dir) { this._play(dir > 0 ? 'shiftUp' : 'shiftDown'); }

  wallImpact(event) {
    const i = clamp(typeof event === 'number' ? event : (event?.intensity ?? 1), 0, 1);
    if (i <= 0.05) return;
    this._play(i > 0.66 ? 'crashHeavy' : i > 0.3 ? 'crashMedium' : 'crashLight', { pan: clamp(event?.side || 0, -1, 1) * 0.6 });
    if (i > 0.66) this._duck(0.3, 0.3);
  }

  carImpact(event) {
    const i = clamp(typeof event === 'number' ? event : (event?.intensity ?? 0.4), 0, 1);
    if (i <= 0.05) return;
    this._play(i > 0.55 ? 'crashMedium' : 'crashLight', { pan: clamp(event?.side || 0, -1, 1) * 0.6 });
  }

  countdownBeep(final) { this._play(final ? 'go' : 'beep'); }
  finishFanfare() { this._play('finish'); }
  uiClick() { this._play('uiSelect'); }
  uiConfirm() { this._play('uiConfirm'); }

  // Kept for the callers of the old package; the clean mix leaves them silent.
  passBy() {}
  updateOpponents() {}
  crowdAmbience() {}
  radioTone() {}
  vscBeep() {}
  pitStop() {}
  startCrescendo() {}
  stopCrescendo() {}
  async loadSamplePack() {}
}
