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

// Effects by event: layers played together (one random variant from each),
// gain and cooldown. 'k:' = a recording in assets/sfx (Kenney, CC0),
// 'g:' = synthesized at start-up (synthEffects() below). Nothing comes from
// the racing pack any more.
const v3 = (name) => [0, 1, 2].map((i) => `k:${name}_00${i}`);
const SFX = Object.freeze({
  nitroOn: { layers: [['g:nitroOn']], gain: 0.5, cool: 0.6 },
  // crashes are synthesized crunches (the metal-impact recordings rang like bells)
  takedown: { layers: [['g:crunch1', 'g:crunch2', 'g:crunch3'], ['g:shatter1', 'g:shatter2'], v3('impactPunch_heavy')], gain: 0.85, cool: 0.3 },
  crashHeavy: { layers: [['g:crunch1', 'g:crunch2', 'g:crunch3'], v3('impactPunch_heavy')], gain: 0.75, cool: 0.35 },
  crashMedium: { layers: [['g:crunchMed1', 'g:crunchMed2', 'g:crunchMed3']], gain: 0.6, cool: 0.25 },
  crashLight: { layers: [['g:bump1', 'g:bump2']], gain: 0.5, cool: 0.18 },
  blowoff: { layers: [['g:blowoff']], gain: 0.3, cool: 1.2 },
  backfire: { layers: [['g:pop1', 'g:pop2']], gain: 0.36, cool: 0.35 },
  hornA: { layers: [['g:hornA']], gain: 0.26, cool: 1.5 },
  hornB: { layers: [['g:hornB']], gain: 0.26, cool: 1.5 },
  shiftUp: { layers: [['g:shift']], gain: 0.22, cool: 0.12 },
  shiftDown: { layers: [['g:shift']], gain: 0.2, cool: 0.12 },
  beep: { layers: [['g:beep']], gain: 0.4, cool: 0.3 },
  go: { layers: [['g:go']], gain: 0.45, cool: 0.5 },
  finish: { layers: [['g:finish']], gain: 0.4, cool: 2 },
  uiSelect: { layers: [['k:ui_click_002']], gain: 0.35, cool: 0.05 },
  uiConfirm: { layers: [['k:ui_confirmation_002']], gain: 0.4, cool: 0.1 },
  whoosh: { layers: [['g:whoosh']], gain: 0.4, cool: 0.6 },
});
const LOOPS = Object.freeze({ nitro: 'g:nitroLoop', screech: 'g:screech', scrape: 'g:scrape' });

// ---- synthesized effects ------------------------------------------------------
// Rendered once into buffers when audio starts: small, licence-free, and
// shaped for this game rather than borrowed.
export function* synthEffects(ctx) {
  const sr = ctx.sampleRate;
  let seed = 12345;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
  // filters as small closures with their own state (fast in a tight loop)
  const BP = () => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, lf = -1, b0 = 0, a1 = 0, a2 = 0;
    return (x, f, q) => {
      if (f !== lf) {
        lf = f;
        const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w);
        b0 = al / (1 + al); a1 = -2 * c / (1 + al); a2 = (1 - al) / (1 + al);
      }
      const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      return y;
    };
  };
  const LP = (f) => { const a = 1 - Math.exp(-2 * Math.PI * f / sr); let y = 0; return (x) => (y += (x - y) * a); };
  const finish = (d) => {
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.85 / peak;
    const buf = ctx.createBuffer(1, d.length, sr);
    buf.getChannelData(0).set(d);
    return buf;
  };
  const make = (secs, fn) => {
    const n = Math.round(secs * sr), d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = fn(i / sr, i);
    return finish(d);
  };
  const ends = (t, secs) => Math.min(1, t / 0.05, (secs - t) / 0.05);   // soft ends so loops do not click
  // tyre squeal: rubber stick-slip, a resonant band of noise wandering in pitch
  { const a = BP(), b = BP();
    yield ['screech', make(2, (t) => {
      const f = Math.round(1500 + 260 * Math.sin(t * 2 * Math.PI * 3.1) + 120 * Math.sin(t * 2 * Math.PI * 7.7));
      return (a(rnd(), f, 14) * 0.9 + b(rnd(), f * 2, 18) * 0.35) * ends(t, 2);
    })]; }
  // nitro: rushing gas, low roar plus hiss, with a slight flutter
  { const l = LP(700), h = BP();
    yield ['nitroLoop', make(2, (t) => (l(rnd()) * 1.6 + h(rnd(), 4200, 0.8) * 0.5) * (0.85 + 0.15 * Math.sin(t * 2 * Math.PI * 9)) * ends(t, 2))]; }
  { const sw = BP(), l = LP(500);
    yield ['nitroOn', make(0.9, (t) => (sw(rnd(), Math.round(300 + 3000 * Math.min(1, t / 0.5)), 1.4) * 1.2 + l(rnd())) * Math.min(1, t / 0.06) * Math.exp(-t * 3.2))]; }
  // metal scraping along a wall: grinding band noise with crackles
  { const a = BP(), b = BP();
    yield ['scrape', make(2, (t) => (a(rnd(), Math.round(2300 + 400 * Math.sin(t * 13)), 3) + b(rnd(), 900, 2) * 0.6 + (rnd() > 0.99 ? rnd() * 4 : 0)) * ends(t, 2))]; }
  // turbo blow-off valve: a hiss falling in pitch
  { const a = BP(); yield ['blowoff', make(0.45, (t) => a(rnd(), Math.round(3600 - 2600 * (t / 0.45)), 2.2) * Math.exp(-t * 7) * Math.min(1, t / 0.01))]; }
  // exhaust pops: a low thump and a sharp crack
  const pop = (pitch) => { const l = LP(2500); return make(0.16, (t) => Math.sin(2 * Math.PI * pitch * t) * Math.exp(-t * 40) + l(rnd()) * Math.exp(-t * 60) * 1.4); };
  yield ['pop1', pop(70)]; yield ['pop2', pop(95)];
  // car horns: two notes together, a little buzzy, as real horns are
  const horn = (f1, f2) => { const l = LP(2600); return make(0.55, (t) => {
    const sq = (f) => Math.tanh(Math.sin(2 * Math.PI * f * t) * 4);
    return l((sq(f1) + sq(f2)) * 0.5) * Math.min(1, t / 0.02) * Math.min(1, (0.55 - t) / 0.06);
  }); };
  yield ['hornA', horn(415, 520)]; yield ['hornB', horn(350, 440)];
  // gear change: a short mechanical clunk
  { const l = LP(1800); yield ['shift', make(0.09, (t) => (Math.sin(2 * Math.PI * 140 * t) * 0.8 + l(rnd()) * 0.7) * Math.exp(-t * 55))]; }
  // near-miss: air ripped past the car, sweeping down
  { const a = BP(); yield ['whoosh', make(0.6, (t) => a(rnd(), Math.round(2400 - 1800 * (t / 0.6)), 1.2) * Math.sin(Math.PI * Math.min(1, t / 0.6)) ** 2)]; }

  // Crashes: a car hitting something is a crunch, not a ring. A deep body
  // thud, a dense cluster of short gritty bursts as panels crumple, and a
  // dying scrape of debris; big hits add shattering glass. Each fragment is
  // rendered only over its own few milliseconds.
  const grains = (d, list, q, gain) => {
    for (const g of list) {
      const bp = BP(), start = Math.round(g.t * sr), len = Math.min(d.length - start, Math.round(g.d * 6 * sr));
      for (let i = 0; i < len; i++) d[start + i] += bp(rnd(), g.f, q) * g.a * gain * Math.exp(-(i / sr) / g.d);
    }
  };
  const crunch = (secs, weight, count, n) => {
    seed = 9000 + n * 7919;
    const d = new Float32Array(Math.round(secs * sr));
    const deb = LP(1400);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      d[i] = (Math.sin(2 * Math.PI * 52 * t) * 1.2 + Math.sin(2 * Math.PI * 87 * t) * 0.7) * Math.exp(-t * 11) * weight
        + deb(rnd()) * Math.exp(-t * 4.5) * 0.35;
    }
    const list = Array.from({ length: count }, () => ({
      t: Math.pow(Math.abs(rnd()), 1.8) * secs * 0.4, f: Math.round(250 + Math.abs(rnd()) * 2600),
      d: 0.006 + Math.abs(rnd()) * 0.03, a: 0.3 + Math.abs(rnd()) * 0.9,
    }));
    grains(d, list, 1.3, 1.4);
    return finish(d);
  };
  yield ['crunch1', crunch(0.9, 1, 46, 1)]; yield ['crunch2', crunch(0.9, 1, 46, 2)]; yield ['crunch3', crunch(0.9, 1, 46, 3)];
  yield ['crunchMed1', crunch(0.55, 0.7, 24, 4)]; yield ['crunchMed2', crunch(0.55, 0.7, 24, 5)]; yield ['crunchMed3', crunch(0.55, 0.7, 24, 6)];
  // a light knock: short dull bump and a scuff
  const bump = (n) => { seed = 4000 + n * 131; const l = LP(1100); return make(0.25, (t) => Math.sin(2 * Math.PI * (75 + n * 9) * t) * Math.exp(-t * 26) + l(rnd()) * Math.exp(-t * 30) * 0.7); };
  yield ['bump1', bump(1)]; yield ['bump2', bump(2)];
  // glass shattering: many tiny bright tinkles over half a second, a crack first
  const shatter = (n) => {
    seed = 7000 + n * 977;
    const d = new Float32Array(Math.round(0.75 * sr));
    const crack = BP(), crackLen = Math.round(0.02 * sr);
    for (let i = 0; i < crackLen; i++) d[i] = crack(rnd(), 2500, 0.8) * (1 - i / crackLen) * 1.5;
    grains(d, Array.from({ length: 70 }, () => ({
      t: 0.01 + Math.pow(Math.abs(rnd()), 1.4) * 0.6, f: Math.round(3000 + Math.abs(rnd()) * 6000),
      d: 0.004 + Math.abs(rnd()) * 0.012, a: 0.8,
    })), 8, 1);
    return finish(d);
  };
  yield ['shatter1', shatter(1)]; yield ['shatter2', shatter(2)];
  // start lights and the flag
  const tone = (f, secs, harm = 0.3) => make(secs, (t) => (Math.sin(2 * Math.PI * f * t) + harm * Math.sin(4 * Math.PI * f * t)) * Math.min(1, t / 0.005) * Math.exp(-t * (3 / secs)));
  yield ['beep', tone(880, 0.18)];
  yield ['go', tone(1320, 0.5, 0.45)];
  yield ['finish', make(1.4, (t) => {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    let y = 0;
    notes.forEach((f, k) => { const s0 = k * 0.12; if (t > s0) y += Math.sin(2 * Math.PI * f * (t - s0)) * Math.exp(-(t - s0) * 2.2); });
    return y * 0.4;
  })];
}

const MAX_VOICES = 8;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---- engines: one physically modelled engine per car (js/engineWorklet.js) --
// Firing angles over the 720° four-stroke cycle and the exhaust bank each
// cylinder feeds; the layouts are what give each engine its voice.
const LAYOUT = {
  i4: { firing: [0, 180, 360, 540], banks: [0, 0, 0, 0] },
  boxer4: { firing: [0, 180, 360, 540], banks: [0, 1, 0, 1] },            // unequal headers: the rumble
  i6: { firing: [0, 120, 240, 360, 480, 600], banks: [0, 0, 0, 0, 0, 0] },
  i6twin: { firing: [0, 120, 240, 360, 480, 600], banks: [0, 1, 0, 1, 0, 1] }, // 1-5-3-6-2-4, front/rear turbo
  v6: { firing: [0, 120, 240, 360, 480, 600], banks: [0, 1, 0, 1, 0, 1] },
  flat6: { firing: [0, 120, 240, 360, 480, 600], banks: [0, 1, 0, 1, 0, 1] },
  // crossplane V8, 1-8-4-3-6-5-7-2: uneven pulses into each bank, the burble
  v8cross: { firing: [0, 90, 180, 270, 360, 450, 540, 630], banks: [0, 1, 1, 0, 1, 0, 0, 1] },
  // flat-plane V8 alternates banks evenly: the shriek
  v8flat: { firing: [0, 90, 180, 270, 360, 450, 540, 630], banks: [0, 1, 0, 1, 0, 1, 0, 1] },
  v10: { firing: [0, 72, 144, 216, 288, 360, 432, 504, 576, 648], banks: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1] },
  v12: { firing: [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660], banks: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1] },
};

const eng = (layout, o) => Object.freeze({ ...LAYOUT[layout], ...o });

// Per car, from the real engine: layout, rev range, exhaust pipe resonance
// (pipeMs), how open the exhaust is (muffler / mufflerOpen Hz), induction
// (intake), forced induction (turbo / whine), cam lope (rough), pops.
const ENGINE_SPECS = {
  // Honda B18C / K20A: high-revving VTEC fours, the cam change at the top
  integra: eng('i4', { idle: 850, redline: 8400, vtecRpm: 5800, pipeMs: [2.3], fb: 0.5, damp: 0.45, muffler: 2100, mufflerOpen: 7200, intake: 0.55, noise: 0.62, pops: 0.15, rough: 0.05, drive: 1.8 }),
  rsx: eng('i4', { idle: 800, redline: 8100, vtecRpm: 6000, pipeMs: [2.5], fb: 0.52, damp: 0.42, muffler: 1900, mufflerOpen: 6600, intake: 0.5, noise: 0.6, pops: 0.15, rough: 0.05, drive: 1.8 }),
  giulietta: eng('i4', { idle: 800, redline: 6500, pipeMs: [2.8], fb: 0.5, muffler: 1500, mufflerOpen: 4300, intake: 0.3, turbo: 0.8, turboHz: 3600, pops: 0.5, drive: 1.7 }),
  crv: eng('i4', { idle: 750, redline: 6300, pipeMs: [3.0], fb: 0.45, muffler: 1000, mufflerOpen: 2600, intake: 0.15, turbo: 0.35, turboHz: 3000, pops: 0, level: 0.38 }),
  // Nissan RB26 / Toyota 2JZ / B58 / L28: straight-sixes, smooth and turbo-whistly
  r34: eng('i6twin', { idle: 950, redline: 8000, pipeMs: [3.0, 3.1], fb: 0.56, muffler: 1600, mufflerOpen: 5600, intake: 0.35, turbo: 1, turboHz: 4200, pops: 0.4, drive: 2 }),
  supramk4: eng('i6twin', { idle: 800, redline: 7200, pipeMs: [3.4, 3.5], fb: 0.58, muffler: 1400, mufflerOpen: 5000, intake: 0.3, turbo: 1.1, turboHz: 3400, pops: 0.35, drive: 2 }),
  grsupraveilside: eng('i6', { idle: 750, redline: 7000, pipeMs: [3.3], fb: 0.55, muffler: 1300, mufflerOpen: 4800, intake: 0.25, turbo: 0.6, turboHz: 3800, pops: 0.9, drive: 2 }),
  fairladyz: eng('i6twin', { idle: 900, redline: 7000, pipeMs: [3.1, 3.3], fb: 0.5, muffler: 1800, mufflerOpen: 5200, noise: 0.7, intake: 0.4, turbo: 0.8, turboHz: 3300, rough: 0.25, pops: 0.6, drive: 2.1 }),
  // American V8s: crossplane burble, lumpy cams, the Charger's blower whine
  charger: eng('v8cross', { idle: 700, redline: 6500, pipeMs: [4.2, 4.4], fb: 0.6, damp: 0.3, thumpHz: 55, muffler: 1100, mufflerOpen: 3700, intake: 0.3, whine: 2.4, whineRatio: 3.2, rough: 0.6, pops: 0.6, drive: 2.4 }),
  // (the 'Cuda gets the Hellcat-style blower too, as asked)
  cuda: eng('v8cross', { idle: 700, redline: 6800, pipeMs: [4.0, 4.3], fb: 0.62, damp: 0.3, thumpHz: 52, muffler: 1200, mufflerOpen: 3900, intake: 0.35, whine: 2.1, whineRatio: 3.0, rough: 0.7, pops: 0.6, drive: 2.4 }),
  slsamg: eng('v8cross', { idle: 750, redline: 7200, pipeMs: [3.6, 3.8], fb: 0.62, damp: 0.32, thumpHz: 60, muffler: 1300, mufflerOpen: 4800, intake: 0.35, rough: 0.25, pops: 0.75, drive: 2.4 }),
  // flat-plane V8s: high and shrieking
  jesko: eng('v8flat', { idle: 1000, redline: 8500, pipeMs: [2.6, 2.6], fb: 0.55, muffler: 2000, mufflerOpen: 7500, intake: 0.4, turbo: 0.8, turboHz: 3800, noise: 0.65, pops: 0.6, drive: 2.2 }),
  sf90xx: eng('v8flat', { idle: 1000, redline: 8000, pipeMs: [2.7, 2.7], fb: 0.52, muffler: 1700, mufflerOpen: 6200, intake: 0.35, turbo: 0.6, turboHz: 3600, pops: 0.4, level: 0.48, drive: 2 }),
  mclaren720gt3: eng('v8flat', { idle: 1100, redline: 8000, pipeMs: [2.4, 2.4], fb: 0.55, muffler: 2400, mufflerOpen: 8000, intake: 0.4, turbo: 0.7, turboHz: 3900, pops: 1, drive: 2.6 }),
  audia4dtm: eng('v8flat', { idle: 1200, redline: 9000, pipeMs: [2.3, 2.3], fb: 0.56, muffler: 2600, mufflerOpen: 8500, intake: 0.45, pops: 0.8, drive: 2.8 }),
  mercedesccoupedtm: eng('v8flat', { idle: 1200, redline: 9000, pipeMs: [2.5, 2.5], fb: 0.56, muffler: 2500, mufflerOpen: 8200, intake: 0.45, pops: 0.8, drive: 2.8 }),
  mercedesclkdtm: eng('v8cross', { idle: 1200, redline: 8800, pipeMs: [2.7, 2.8], fb: 0.58, muffler: 2400, mufflerOpen: 8000, intake: 0.45, rough: 0.2, pops: 0.8, drive: 2.8 }),
  // V6s: the NSX's induction howl, the 296's "piccolo V12", a 11k-rpm race V6
  acuransx: eng('v6', { idle: 900, redline: 8000, pipeMs: [2.8, 2.8], fb: 0.52, muffler: 1800, mufflerOpen: 6400, intake: 0.6, noise: 0.55, pops: 0.2, drive: 1.9 }),
  ferrari296gt3: eng('v6', { idle: 1100, redline: 8500, pipeMs: [2.3, 2.3], fb: 0.55, muffler: 2400, mufflerOpen: 8200, intake: 0.4, turbo: 0.7, turboHz: 4000, pops: 0.9, drive: 2.5 }),
  opelcalibradtm: eng('v6', { idle: 1500, redline: 11500, pipeMs: [2.0, 2.0], fb: 0.55, muffler: 3000, mufflerOpen: 9000, intake: 0.5, noise: 0.7, pops: 0.6, drive: 2.6 }),
  // V12s: overlapping firings, a smooth scream
  eb110: eng('v12', { idle: 1000, redline: 8250, pipeMs: [2.6, 2.6], fb: 0.5, muffler: 1800, mufflerOpen: 6500, intake: 0.35, turbo: 1.2, turboHz: 4500, pops: 0.4, drive: 1.9 }),
  db11: eng('v12', { idle: 750, redline: 7000, pipeMs: [3.1, 3.1], fb: 0.6, muffler: 1300, mufflerOpen: 4600, intake: 0.3, turbo: 0.5, turboHz: 3400, pops: 0.55, drive: 1.9 }),
  // Porsche flat-sixes and Subaru's boxer four
  porsche996gt300: eng('flat6', { idle: 1100, redline: 8800, pipeMs: [2.4, 2.6], fb: 0.56, muffler: 2600, mufflerOpen: 8500, intake: 0.45, noise: 0.62, pops: 0.6, drive: 2.6 }),
  porsche992gt3r: eng('flat6', { idle: 1100, redline: 9400, pipeMs: [2.5, 2.7], fb: 0.56, muffler: 2500, mufflerOpen: 8800, intake: 0.5, noise: 0.62, pops: 0.6, drive: 2.6 }),
  brzgt300: eng('boxer4', { idle: 1000, redline: 8000, pipeMs: [2.6, 4.0], fb: 0.58, muffler: 2200, mufflerOpen: 7000, intake: 0.4, turbo: 0.8, turboHz: 3700, pops: 0.9, rough: 0.2, drive: 2.4 }),
};

// Pops and bangs per car: boom pitch (popHz; lower = deeper) and whether it
// bangs on full-throttle upshifts. The muscle V8s boom deep; flat-plane V8s,
// race cars and small fours crack sharper.
const POP_TUNING = {
  charger: { popHz: 68 }, cuda: { popHz: 66 }, slsamg: { popHz: 74, bangs: true },
  r34: { popHz: 98, bangs: true }, supramk4: { popHz: 92, bangs: true }, grsupraveilside: { popHz: 96, bangs: true },
  fairladyz: { popHz: 104 }, jesko: { popHz: 118, bangs: true }, sf90xx: { popHz: 112 },
  mclaren720gt3: { popHz: 120, bangs: true }, audia4dtm: { popHz: 110, bangs: true },
  mercedesccoupedtm: { popHz: 104, bangs: true }, mercedesclkdtm: { popHz: 96, bangs: true },
  ferrari296gt3: { popHz: 125, bangs: true }, opelcalibradtm: { popHz: 135, bangs: true },
  acuransx: { popHz: 118 }, eb110: { popHz: 108 }, db11: { popHz: 90 },
  porsche996gt300: { popHz: 120, bangs: true }, porsche992gt3r: { popHz: 116, bangs: true },
  brzgt300: { popHz: 112, bangs: true }, integra: { popHz: 135 }, rsx: { popHz: 130 },
  giulietta: { popHz: 125 }, crv: { popHz: 120 },
};
for (const [id, t] of Object.entries(POP_TUNING)) ENGINE_SPECS[id] = Object.freeze({ ...ENGINE_SPECS[id], ...t });

// Cars without a model of their own (spec class cars, the open-wheel car)
// by the racing pack's engine family.
const FAMILY_SPECS = Object.freeze({
  formula: eng('v6', { idle: 4000, redline: 15000, pipeMs: [1.6, 1.6], fb: 0.5, muffler: 3500, mufflerOpen: 10000, intake: 0.4, turbo: 0.3, turboHz: 5200, pops: 0.2, drive: 2.2 }),
  v8: ENGINE_SPECS.slsamg, v8_sc: ENGINE_SPECS.charger, v8_turbo: ENGINE_SPECS.jesko,
  v10: eng('v10', { idle: 900, redline: 9000, pipeMs: [2.4, 2.4], fb: 0.55, muffler: 2200, mufflerOpen: 8000, intake: 0.45, pops: 0.5, drive: 2.3 }),
  v12: ENGINE_SPECS.db11, v12_turbo: ENGINE_SPECS.eb110, v6: ENGINE_SPECS.acuransx, v6_turbo: ENGINE_SPECS.ferrari296gt3,
  i6_turbo: ENGINE_SPECS.r34, i4: ENGINE_SPECS.rsx, i4_vtec: ENGINE_SPECS.integra, i4_turbo: ENGINE_SPECS.giulietta,
  flat6: ENGINE_SPECS.porsche996gt300, flat6_turbo: ENGINE_SPECS.porsche992gt3r, flat4: ENGINE_SPECS.brzgt300,
});

/** Every car with an engine of its own (tools/engine-lab.html lists them). */
export const ENGINE_CARS = Object.freeze(Object.keys(ENGINE_SPECS));

export function engineSpecFor(modelId, family) {
  return ENGINE_SPECS[modelId] || FAMILY_SPECS[family] || ENGINE_SPECS.r34;
}

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
    this.assetBase = '';               // path prefix to the game root (tools pages set '../')
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
    // the continuous effect loops (nitro, screech, scrape) share a bus that
    // dips under one-shot crashes, so the two never pile on top of each other
    this.loopBus = ctx.createGain();
    this.loopBus.connect(this.sfxGain);
    // the nearest rival's engine: its own gain and stereo position
    this.rivalGain = ctx.createGain();
    this.rivalGain.gain.value = 0;
    this.rivalPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (this.rivalPan) this.rivalGain.connect(this.rivalPan).connect(this.master);
    else this.rivalGain.connect(this.master);
    this._ready = true;
    // the modelled engines run on the audio thread; until (or unless) the
    // worklet loads, the recorded loops are the fallback
    ctx.audioWorklet?.addModule(`${this.assetBase}js/engineWorklet.js`)
      .then(() => this._buildVoices())
      .catch(() => {});
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

  /** Dip the music, and the effect loops, under a big moment. */
  _duck(amount = 0.45, hold = 0.35) {
    if (!this._ready) return;
    const t = this.ctx.currentTime;
    for (const [g, depth] of [[this.musicDuck.gain, amount], [this.loopBus.gain, Math.min(0.85, amount + 0.3)]]) {
      g.cancelScheduledValues(t);
      g.setTargetAtTime(1 - depth, t, 0.03);
      g.setTargetAtTime(1, t + hold, 0.4);
    }
  }

  // ---- engine ----------------------------------------------------------------

  async loadCarSoundFamily(family, base = this._packBase) {
    this._packBase = base || this._packBase;
    if (this._voice) return true;        // the modelled engine is in charge
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

  _buildVoices() {
    const mk = (spec) => new AudioWorkletNode(this.ctx, 'rush-engine', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { spec },
    });
    this._playerSpec = this._playerSpec || engineSpecFor(this._modelId, this._family);
    this._voice = mk(this._playerSpec);
    this._voice.connect(this.engineGain);
    this._rival = mk(engineSpecFor('', 'v8'));
    this._rival.connect(this.rivalGain);
    this._rivalId = null;
    this._rpm = this._playerSpec.idle;
    this._load01 = 0;
    // the recorded loops are only the fallback now
    this._disposeEngine();
  }

  /** The player's car: picks its modelled engine (by model, else engine family). */
  setPlayerCar(modelId, family) {
    this._modelId = modelId || '';
    this._family = family && family !== 'formula' ? family : (family || 'v10');
    this._playerSpec = engineSpecFor(this._modelId, family);
    this._rpm = this._playerSpec.idle;
    this._load01 = 0;
    this._started = false;
    this._voice?.port.postMessage({ spec: this._playerSpec });
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
    if (!this._ready || !s) return;
    dt = clamp(dt || 0.016, 0.001, 0.1);
    this._updateRival(dt, s);
    const voice = this._voice;
    const e = this._engine;
    const spec = voice ? this._playerSpec : null;
    const idle = spec ? spec.idle : e?.idle;
    const redline = spec ? spec.redline : e?.redline;
    if (!idle || !redline) return;
    const t = this.ctx.currentTime;
    const range = redline - idle;
    const thr = clamp(s.throttle || 0, 0, 1);
    const speed = s.speed || 0;
    let target = idle + clamp(s.rpmFrac || 0, 0, 1) * range;
    if (speed < 2) target = idle + thr * 0.62 * range;          // free revs on the grid
    if (thr > 0.9 && speed < 2) target = Math.max(target, redline);   // hold it flat: the limiter
    // gear changes: an upshift drops the revs in a blink
    const shifted = s.gear != null && this._gear != null && s.gear !== this._gear;
    this._gear = s.gear;
    if (shifted) this._shiftT = 0.09;
    this._shiftT = Math.max(0, (this._shiftT || 0) - dt);
    const rise = (thr > 0.1 ? 1.6 : 0.5) * range;               // rpm per second
    const fall = this._shiftT > 0 ? 12 * range : (thr > 0.1 ? 1.4 : 0.55) * range;
    if (!(this._rpm > 0)) this._rpm = idle;
    const d = target - this._rpm;
    this._rpm += d > 0 ? Math.min(d, rise * dt) : Math.max(d, -fall * dt);
    const rpm = this._rpm;
    const revs = clamp((rpm - idle) / range, 0, 1);
    // load follows the throttle with a little lag; braking means none
    const loadTarget = (s.brake || 0) > 0.1 || this._shiftT > 0 ? 0 : thr;
    this._load01 += (loadTarget - this._load01) * Math.min(1, dt * 9);
    const load = this._load01;

    if (voice) {
      const p = voice.parameters;
      p.get('rpm').setTargetAtTime(rpm, t, 0.015);
      p.get('load').setTargetAtTime(load, t, 0.03);
      p.get('boost').setTargetAtTime(s.boost ? 1 : load, t, 0.1);
      return;
    }

    // fallback: the recorded loops (no AudioWorklet)
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
      const overrun = (1 - load) * clamp(revs * 1.6, 0, 1) * (speed > 3 ? 0.75 : 0.2);
      e.decel.gain.gain.setTargetAtTime(overrun, t, 0.05);
      e.decel.src.playbackRate.setTargetAtTime(clamp(0.7 + revs * 0.6, 0.5, 1.6), t, 0.05);
    }
    const cutoff = 700 + (2200 + 9000 * load) * (0.55 + 0.45 * revs);
    this.engineFilter.frequency.setTargetAtTime(cutoff, t, 0.04);
  }

  /**
   * The nearest rival's engine, heard as it closes and passes: its own
   * modelled engine at its revs, louder as it nears, panned to its side and
   * Doppler-shifted (higher approaching, dropping as it pulls away).
   */
  _updateRival(dt, s) {
    const node = this._rival;
    if (!node) return;
    const t = this.ctx.currentTime;
    const cue = (s.opponents || []).find((c) => c.distance < 60);
    if (!cue || !this._engineOn) {
      this.rivalGain.gain.setTargetAtTime(0, t, 0.25);
      return;
    }
    const key = cue.modelId || cue.family || 'v8';
    if (key !== this._rivalId) {
      this._rivalId = key;
      this._rivalSpec = engineSpecFor(cue.modelId, cue.family);
      node.port.postMessage({ spec: this._rivalSpec });
    }
    const spec = this._rivalSpec;
    const frac = clamp(((cue.rpmFrac || 0) - 0.18) / 0.86, 0, 1);
    // closing speed along the line between the cars: + when coming together
    const along = Math.abs(cue.ahead || 0) / Math.max(1, cue.distance);
    const closing = (cue.relativeSpeed || 0) * (cue.ahead < 0 ? 1 : -1) * along;
    const doppler = clamp(343 / (343 - closing), 0.82, 1.22);
    const rpm = (spec.idle + frac * (spec.redline - spec.idle)) * doppler;
    node.parameters.get('rpm').setTargetAtTime(rpm, t, 0.04);
    node.parameters.get('load').setTargetAtTime(clamp(cue.throttle ?? 0.8, 0, 1), t, 0.06);
    node.parameters.get('boost').setTargetAtTime(cue.throttle ?? 0.8, t, 0.2);
    const gain = 0.55 / (1 + (cue.distance / 9) ** 2);
    this.rivalGain.gain.setTargetAtTime(gain, t, 0.06);
    if (this.rivalPan) this.rivalPan.pan.setTargetAtTime(clamp(cue.side * Math.min(1, 6 / Math.max(1, cue.distance) + 0.3), -0.85, 0.85), t, 0.06);
  }

  // ---- effects -------------------------------------------------------------

  async loadArcadeSfx(base = this._packBase) {
    this._packBase = base || this._packBase;
    if (!this._ready || this._sfxLoading) return;
    this._sfxLoading = true;
    // Synthesized effects are built one at a time with a pause between, so
    // the work never stalls a frame (they are not needed before a race).
    (async () => {
      for (const [name, buf] of synthEffects(this.ctx)) {
        this._sfx[`g:${name}`] = buf;
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    const files = new Set(Object.values(SFX).flatMap((d) => d.layers.flat()).filter((n) => n.startsWith('k:')));
    await Promise.allSettled([...files].map(async (n) => {
      this._sfx[n] = await this._load(`${this.assetBase}assets/sfx/${n.slice(2)}.mp3`);
    }));
  }

  /** Play one effect (all its layers), respecting its cooldown and the voice cap. */
  _play(event, { gain = 1, rate = 1, pan = 0, jitter = 0.04 } = {}) {
    const def = SFX[event];
    if (!this._ready || !def) return false;
    const now = this.ctx.currentTime;
    if (now < (this._cool[event] || 0) || this._voices >= MAX_VOICES) return false;
    const buffers = def.layers.map((variants) => this._sfx[variants[Math.floor(Math.random() * variants.length)]]).filter(Boolean);
    if (!buffers.length) return false;
    this._cool[event] = now + def.cool;              // next time this event may sound
    let out = this.sfxGain;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      p.connect(this.sfxGain);
      out = p;
    }
    let live = buffers.length;
    for (const buffer of buffers) {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 2 * jitter);
      const g = this.ctx.createGain();
      g.gain.value = def.gain * gain / Math.sqrt(buffers.length);
      src.connect(g).connect(out);
      this._voices++;
      src.onended = () => {
        this._voices--;
        try { src.disconnect(); g.disconnect(); if (--live === 0 && out !== this.sfxGain) out.disconnect(); } catch { /* gone */ }
      };
      src.start();
    }
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
    src.connect(gain).connect(this.loopBus);
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
  nearMiss(side = 0) { this._play('whoosh', { pan: side * 0.6 }); }
  trafficHit(boosting = false) {
    this._play(boosting ? 'crashMedium' : 'crashHeavy');
    this._play(Math.random() < 0.5 ? 'hornA' : 'hornB', { pan: (Math.random() - 0.5) });
    if (!boosting) this._duck(0.35, 0.3);
  }
  trafficHorn(pan = 0) { this._play(Math.random() < 0.5 ? 'hornA' : 'hornB', { pan, gain: 0.7 }); }

  shift(dir) {
    this._play(dir > 0 ? 'shiftUp' : 'shiftDown', { rate: dir > 0 ? 1 : 0.85 });
    // a flat-out upshift bangs on the cars that do it (js/engineWorklet.js)
    if (dir > 0 && (this._load01 || 0) > 0.7) this._voice?.port.postMessage({ bang: 1 });
  }

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
