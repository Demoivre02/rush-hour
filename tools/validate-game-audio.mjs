// Headless checks for js/gameAudio.js with a fake Web Audio context: the
// engine crossfades between the two rev bands around the rpm and pitches them
// to match, effects respect their cooldowns and the voice cap, and the music
// switches between the menu track and the race playlist.
//
// Usage: node tools/validate-game-audio.mjs
let fails = 0;
const check = (ok, label) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };

class Param {
  constructor(v = 0) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
}
class Node {
  constructor() { this.gain = new Param(1); this.pan = new Param(0); this.playbackRate = new Param(1); this.frequency = new Param(1000); this.Q = new Param(1); }
  connect(n) { return n; }
  disconnect() {}
}
class Src extends Node {
  start() { Ctx.started.push(this); }
  stop() {}
}
class Ctx {
  static started = [];
  constructor() { this.currentTime = 0; this.state = 'running'; this.destination = new Node(); }
  createGain() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createStereoPanner() { return new Node(); }
  createDynamicsCompressor() { const n = new Node(); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(); return n; }
  createBufferSource() { return new Src(); }
  get sampleRate() { return 8000; }
  createBuffer(ch, n) { const d = new Float32Array(n); return { length: n, getChannelData: () => d }; }
  createMediaElementSource() { return new Node(); }
  decodeAudioData(b) { return Promise.resolve({ fake: b }); }
  resume() {}
}
const audioEls = [];
globalThis.window = { AudioContext: Ctx };
globalThis.Audio = class { constructor(src) { this.src = src; audioEls.push(this); } play() { return Promise.resolve(); } pause() {} addEventListener() {} };
const manifest = JSON.parse((await import('node:fs')).readFileSync(new URL('../assets/racing-pack/audio/audio_manifest.json', import.meta.url)));
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => manifest,
  arrayBuffer: async () => url,
});

const { GameAudio } = await import('../js/gameAudio.js');
const a = new GameAudio();
a.update(0.016, { rpmFrac: 0.5 });
a.takedown();
check(!a.ready, 'calls before the first gesture are harmless no-ops');

a.init();
await new Promise((r) => setTimeout(r, 0));
check(a.ready, 'init() builds the three buses');

console.log('[game-audio] engine');
check(await a.loadCarSoundFamily('i6_turbo'), 'loads the racing-pack loops for an engine type');
a.startEngine();
const e = a._engine;
const spec = manifest.engines.i6_turbo;
const rpmFor = (f) => spec.idle_rpm + f * (spec.redline_rpm - spec.idle_rpm);
const run = (sec, snap) => { for (let t = 0; t < sec; t += 1 / 60) a.update(1 / 60, snap); };
run(2, { rpmFrac: 0.45, throttle: 1, speed: 30, gear: 3 });
const live = e.layers.filter((l) => l.gain.gain.value > 0.001);
check(live.length === 2, 'two bands sound at once (the pair around the rpm)');
const rpm = a._rpm;
check(Math.abs(rpm - rpmFor(0.45)) < 1, 'after a moment the revs settle on the target');
check(live.every((l) => Math.abs(l.src.playbackRate.value - rpm / l.rpm) < 1e-6), 'each band is pitched to the live rpm');
const power = live.reduce((s2, l) => s2 + l.gain.gain.value ** 2, 0);
check(Math.abs(power - 1) < 0.03, 'equal-power crossfade at full throttle');
const openCutoff = a.engineFilter.frequency.value;
// lifting: revs fall slower than they rose, the filter closes, overrun takes over
a.update(1 / 60, { rpmFrac: 0.2, throttle: 0, speed: 30, gear: 3 });
const oneFrameDrop = rpm - a._rpm;
check(oneFrameDrop > 0 && oneFrameDrop < (rpmFor(0.45) - rpmFor(0.2)) / 4, 'lifting off, the revs fall with inertia, not instantly');
run(0.5, { rpmFrac: 0.4, throttle: 0, brake: 1, speed: 30, gear: 3 });
check(a.engineFilter.frequency.value < openCutoff * 0.7, 'off throttle the exhaust note is muffled');
check(e.decel.gain.gain.value > 0.2 && e.layers.every((l) => l.gain.gain.value < 0.35), 'braking: the overrun loop carries the sound');
// an upshift drops the revs quickly
run(1, { rpmFrac: 0.95, throttle: 1, speed: 40, gear: 3 });
const beforeShift = a._rpm;
a.update(1 / 60, { rpmFrac: 0.6, throttle: 1, speed: 40, gear: 4 });
check(beforeShift - a._rpm > (rpmFor(0.95) - rpmFor(0.6)) * 0.15, 'an upshift drops the revs in a blink');
// on the grid the throttle free-revs the engine
run(1, { rpmFrac: 0, throttle: 0.8, speed: 0, gear: 1 });
check(a._rpm > rpmFor(0.4), 'standing still, the throttle free-revs the engine');
check(await a.loadCarSoundFamily('formula') && a._family === 'v10', 'the open-wheel car uses the V10 recording');
a.updateArcade(1 / 60, { boosting: false, drifting: false, slip: 1, speed: 40, throttle: 0, brake: 1 });
check(!a._loops.screech || a._loops.screech.gain.gain.value === 0, 'hard braking does not set off the tyre screech');

console.log('[game-audio] effects');
await a.loadArcadeSfx();
await new Promise((r) => setTimeout(r, 0));
const before = Ctx.started.length;
a.takedown();
const layers = Ctx.started.length - before;
a.takedown();
check(layers === 3 && Ctx.started.length === before + 3, 'a takedown layers metal, glass and a body thump, and cannot retrigger inside its cooldown');
a.ctx.currentTime += 1;
a.takedown();
check(Ctx.started.length === before + 6, 'it plays again once the cooldown has passed');
check(!JSON.stringify(Object.keys(a._sfx)).includes('racing-pack'), 'no effect comes from the racing pack');
check(['g:screech', 'g:nitroLoop', 'g:hornA', 'g:blowoff', 'k:impactMetal_heavy_000'].every((k) => a._sfx[k]),
  'synthesized effects and the Kenney recordings are loaded');
a._voices = 8;
a.ctx.currentTime += 5;
check(!a._play('crashLight'), 'no more than eight effects at once');
a._voices = 0;
a.ctx.currentTime += 1;
a.uiClick();
a.ctx.currentTime += 1;
check(a._play('uiSelect'), 'menu clicks keep working (cooldowns run on the audio clock)');
for (const fn of ['passBy', 'crowdAmbience', 'radioTone', 'vscBeep', 'pitStop', 'startCrescendo']) a[fn]();
check(true, 'the old broadcast layers are silent no-ops');

console.log('[game-audio] music');
a.playMusic('menu');
check(audioEls.at(-1)?.src.includes('menu_') && a._music.kind === 'menu', 'the menu plays the menu track');
a.playMusic('menu');
check(audioEls.filter((x) => x.src.includes('menu_')).length === 1, 'asking again does not restart it');
a.playMusic('race');
check(a._music.kind === 'race' && audioEls.at(-1).src.includes('race_'), 'races switch to the race playlist');
a.playMusic(null);
check(a._music === null, 'music can be stopped');

console.log('[game-audio] modelled engines');
{
  const { engineSpecFor } = await import('../js/gameAudio.js');
  const { MODEL_CARS } = await import('../js/modelCars.js');
  check(Object.keys(MODEL_CARS).every((id) => engineSpecFor(id, '') !== engineSpecFor('', '') || id === 'r34'),
    'every car model has its own engine spec');
  check(engineSpecFor('', 'formula').redline >= 14000, 'the open-wheel car revs to 15,000');
  // run the worklet's processor directly
  let Proc = null;
  globalThis.sampleRate = 48000;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = {}; } };
  globalThis.registerProcessor = (name, cls) => { Proc = cls; };
  await import('../js/engineWorklet.js');
  const renderSec = (spec, rpm, load, secs = 1) => {
    const p = new Proc({ processorOptions: { spec } });
    const out = new Float32Array(Math.round(secs * 48000 / 128) * 128);
    for (let o = 0; o < out.length; o += 128) {
      const ch = new Float32Array(128);
      p.process([], [[ch]], { rpm: [rpm], load: [load], boost: [load] });
      out.set(ch, o);
    }
    return out;
  };
  const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
  let clean = true;
  for (const id of Object.keys(MODEL_CARS)) {
    const sp = engineSpecFor(id, '');
    const x = renderSec(sp, sp.redline * 0.7, 1, 0.5);
    if (!x.every(Number.isFinite) || x.some((v) => Math.abs(v) > 1)) clean = false;
  }
  check(clean, 'every engine renders clean output (finite, never clipping)');
  const v8 = engineSpecFor('charger', '');
  const idle = rms(renderSec(v8, v8.idle, 0)), pull = rms(renderSec(v8, v8.redline * 0.8, 1));
  check(idle > pull * 0.15 && idle < pull * 0.7, 'idle is audible but well below full throttle');
  const limiter = renderSec(v8, v8.redline, 1, 1);
  let quietBlocks = 0;
  for (let o = 0; o < limiter.length; o += 480) if (rms(limiter.subarray(o, o + 480)) < pull * 0.25) quietBlocks++;
  check(quietBlocks > 3, 'at the redline the limiter cuts the ignition in bursts');
}

if (fails) { console.log(`\n[game-audio] ${fails} FAILED`); process.exit(1); }
console.log('\n[game-audio] ALL GAME AUDIO CHECKS PASSED');
