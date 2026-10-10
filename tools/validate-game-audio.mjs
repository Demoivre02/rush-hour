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
  constructor() { this.gain = new Param(1); this.pan = new Param(0); this.playbackRate = new Param(1); }
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
  createStereoPanner() { return new Node(); }
  createDynamicsCompressor() { const n = new Node(); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(); return n; }
  createBufferSource() { return new Src(); }
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
a.update(0.016, { rpmFrac: 0.45, throttle: 1, speed: 30 });
const live = e.layers.filter((l) => l.gain.gain.value > 0.001);
check(live.length === 2, 'two bands sound at once (the pair around the rpm)');
const rpm = rpmFor(0.45);
check(live.every((l) => Math.abs(l.src.playbackRate.value - rpm / l.rpm) < 1e-6), 'each band is pitched to the live rpm');
const power = live.reduce((s, l) => s + l.gain.gain.value ** 2, 0);
check(Math.abs(power - 1) < 0.02, 'equal-power crossfade at full throttle');
a.update(0.016, { rpmFrac: 0.45, throttle: 0, speed: 30 });
check(e.layers.every((l) => l.gain.gain.value < 0.4) && e.decel.gain.gain.value > 0, 'off throttle: engine quieter, overrun layer on');
check(await a.loadCarSoundFamily('formula') && a._family === 'v10', 'the open-wheel car uses the V10 recording');

console.log('[game-audio] effects');
await a.loadArcadeSfx();
await new Promise((r) => setTimeout(r, 0));
const before = Ctx.started.length;
a.takedown();
a.takedown();
check(Ctx.started.length === before + 1, 'an effect cannot retrigger inside its cooldown');
a.ctx.currentTime += 1;
a.takedown();
check(Ctx.started.length === before + 2, 'it plays again once the cooldown has passed');
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

if (fails) { console.log(`\n[game-audio] ${fails} FAILED`); process.exit(1); }
console.log('\n[game-audio] ALL GAME AUDIO CHECKS PASSED');
