// Headless checks for the arcade event types (js/events.js, rules in
// RaceSession._eventTick): Elimination knocks out the last car on its clock
// and classifies by elimination order; Takedown Rush and Drift Challenge end
// on their target or their time limit; a plain race and Formula are untouched.
//
// Usage: node tools/validate-events.mjs

const ctxStub = () => ({
  fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '', textBaseline: '',
  lineWidth: 1, lineJoin: '', shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
  fillRect() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
  moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, arcTo() {},
  fillText() {}, strokeText() {}, createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
  measureText: () => ({ width: 0 }),
  save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
  ellipse() {}, bezierCurveTo() {}, setTransform() {}, drawImage() {},
});
globalThis.document = {
  createElement: (tag) => tag === 'canvas'
    ? { width: 0, height: 0, getContext: ctxStub }
    : { style: {} },
};
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const THREE = await import('../lib/three.module.js');
const { buildCircuit } = await import('../js/trackBuilder.js');
const { TRACKS } = await import('../js/tracks.js');
const { RaceSession } = await import('../js/race.js');
const { DRIVERS } = await import('../js/data.js');
const { EVENTS, eventSpec } = await import('../js/events.js');
const { createRandom } = await import('../js/random.js');

let fails = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) fails++;
};

const circuit = buildCircuit('miami', TRACKS.miami, new THREE.Scene());
const DT = 1 / 60;
const drive = { steer: 0, throttle: 0, brake: 0, boost: false };

function session(event, discipline = 'street') {
  return new RaceSession({
    scene: new THREE.Scene(), circuit,
    playerDriverId: DRIVERS[0].id,
    laps: 3, difficulty: 1,
    assists: { tc: true, abs: true, autoGear: true },
    mode: 'race', discipline, event, seed: 7, random: createRandom(7),
    onMessage: () => {},
  });
}
function runUntil(s, cond, maxS) {
  for (let t = 0; t < maxS; t += DT) {
    s.update(DT, drive);
    if (cond()) return true;
  }
  return false;
}
const racing = (s) => runUntil(s, () => s.phase === 'racing', 30);

console.log('[events] registry');
check(EVENTS.length === 5 && eventSpec('nope').id === 'race', 'five events, unknown ids fall back to a plain race');

console.log('[events] plain race and Formula');
{
  const s = session('race');
  check(s.event.id === 'race' && s.laps === 3, 'a plain race keeps its lap count');
  const f = session('elimination', 'formula');
  check(f.event.id === 'race' && f.laps === 3, 'Formula ignores arcade events');
}

console.log('[events] sprint');
{
  const s = session('sprint');
  check(s.laps === 1, 'a sprint is one lap');
  racing(s);
  check(s.entries.every((e) => e.phys.v >= 21.9), 'flying start: the whole field is rolling at lights out');
  for (let t = 0; t < 5; t += DT) s.update(DT, drive);
  check(!s.eventState.done && s.phase === 'racing', 'a sprint runs to the flag (no clock, no score)');
}

console.log('[events] elimination');
{
  const s = session('elimination');
  check(s.laps === 99, 'elimination is open-ended (no lap target)');
  check(racing(s), 'reaches lights out');
  // the clock knocks out whoever is last at that moment
  runUntil(s, () => s.eventState.timer < 0.5, 25);
  const alive = s.entries.filter((e) => !e.dnf);
  const last = alive.reduce((a, b) => ((b.position || 0) > (a.position || 0) ? b : a));
  runUntil(s, () => s.entries.some((e) => e.dnf), 2);
  const out = s.entries.filter((e) => e.dnf);
  check(out.length === 1 && out[0] === last && out[0].failureCause === 'eliminated',
    'the first knockout is the car in last place');
  check(Math.abs(s.eventState.timer - 20) < 0.5, 'the knockout clock restarts');
  // put the player last for the next knockout
  s._posTimer = 1e9;
  let p = 1;
  for (const e of s.entries) if (!e.dnf && !e.isPlayer) e.position = p++;
  s.player.position = p;
  s.eventState.timer = DT / 2;
  s.update(DT, drive);
  check(s.player.dnf && s.eventState.done && !s.eventState.success, 'the player in last is knocked out and the event ends');
  check(s.phase === 'finished' && runUntil(s, () => !!s.results, 10), 'player knocked out ends the event and classifies');
  const pr = s.results.find((r) => r.isPlayer);
  check(pr.gapText === 'OUT' && pr.pos === 11 && s.results.at(-1).gapText === 'OUT',
    'the player is classified behind the survivors, ahead of the first car out');

  // last car standing: knock the field out quickly with the player kept in front
  const w = session('elimination');
  racing(w);
  const order = [];
  w._posTimer = 1e9;                             // positions set by hand below
  for (let k = 0; k < 11 && !w.eventState.done; k++) {
    let p = 1;                                     // player leads, the field in entry order
    w.player.position = p++;
    for (const e of w.entries) if (!e.dnf && !e.isPlayer) e.position = p++;
    w.eventState.timer = DT / 2;
    w.update(DT, drive);
    const latest = w.entries.filter((e) => e.dnf && !order.includes(e));
    order.push(...latest);
  }
  check(w.eventState.done && order.length === 11 && !w.player.dnf, 'eleven knockouts leave the player standing');
  check(w.winner === w.player && w.player.finished, 'the last car standing wins');
  runUntil(w, () => !!w.results, 10);
  const ranks = order.map((e) => w.results.findIndex((r) => r.driver.id === e.driver.id));
  check(w.results[0].isPlayer && ranks.every((r, i) => i === 0 || r < ranks[i - 1]),
    'classification runs in reverse elimination order');
}

console.log('[events] takedown rush');
{
  const s = session('takedown');
  racing(s);
  const rivals = s.entries.filter((e) => !e.isPlayer);
  for (let k = 0; k < 4; k++) s._takedown(rivals[k]);
  s.update(DT, drive);
  check(!s.eventState.done && s.eventState.score === 4, 'four takedowns are counted, not yet a win');
  s._takedown(rivals[4]);
  s.update(DT, drive);
  check(s.eventState.done && s.eventState.success, 'the fifth takedown completes the event');
  check(runUntil(s, () => !!s.results, 10), 'a finished event classifies');

  const t = session('takedown');
  racing(t);
  check(runUntil(t, () => t.eventState.done, 125) && !t.eventState.success, 'no takedowns: fails when the clock runs out');
}

console.log('[events] drift challenge');
{
  const s = session('drift');
  racing(s);
  s.eventState.score = 2990;
  s.player.phys.drifting = true;
  s.player.phys.driftAngle = 0.4;
  s.player.phys.v = 30;
  const before = s.eventState.score;
  s._eventTick(0.1);
  check(s.eventState.score > before || s.eventState.done, 'drifting scores points (speed x angle)');
  s.eventState.score = 3000;
  s.player.phys.drifting = false;
  s._eventTick(DT);
  check(s.eventState.done && s.eventState.success, 'reaching the target completes the event');

  const t = session('drift');
  racing(t);
  check(runUntil(t, () => t.eventState.done, 125) && !t.eventState.success, 'no drifting: fails when the clock runs out');
}

console.log('[events] traffic');
{
  check(!!session('race').traffic && session('race').traffic.cars.length === 10, 'city venue arcade race has 10 traffic cars');
  check(!session('drift').traffic && !session('race', 'formula').traffic, 'no traffic in Drift Challenge or Formula');
  const s = session('race');
  racing(s);
  const car = s.traffic.cars[s.traffic.cars.length - 1];   // furthest from the grid
  const s0 = car.s;
  for (let t = 0; t < 1; t += DT) s.update(DT, drive);
  check(car.hit === 0 && car.s > s0 + 10, 'traffic cruises forward along the lap');
  // drop the player just behind it at speed, in its lane
  const p = s.player.phys;
  p.pos.x = car.x - Math.sin(car.heading) * 1.5;
  p.pos.z = car.z - Math.cos(car.heading) * 1.5;
  p.heading = car.heading;
  p.v = 50;
  const hits = s.traffic.update(DT, s.entries);
  check(hits.length === 1 && hits[0].entry === s.player && car.hit > 0, 'catching a traffic car hits it');
  check(Math.abs(p.v - 35) < 0.01, 'a hit without nitro costs 30% of your speed');
  for (let t = 0; t < 3; t += DT) s.traffic.update(DT, s.entries);
  const ps = s.player.phys.sampleIdx * circuit.ds;
  const d = Math.abs(car.s - ps);
  check(car.hit === 0 && Math.min(d, circuit.length - d) >= 250, 'a struck car respawns well away from the racers');
}

console.log('[events] crashes');
{
  const s = session('race');
  racing(s);
  const v = s.entries.find((e) => !e.isPlayer);
  s.crashEvents.length = 0;
  s._takedown(v);
  check(v.wreckT > 0 && Math.abs(v.wreckRoll) >= Math.PI * 2 && s.crashEvents.length === 1,
    'a takedown wrecks the car (barrel roll) and throws a crash burst');
  s.update(DT, drive);
  s.render(1);
  for (let t = 0; t < 0.7; t += DT) s.update(DT, drive);
  s.render(1);
  check(Math.abs(v.mesh.rotation.z) > 0.5, 'mid-wreck the car is rolling');
  for (let t = 0; t < 1; t += DT) s.update(DT, drive);
  s.render(1);
  check(Math.abs(Math.abs(v.mesh.rotation.z) % (Math.PI * 2)) < 0.05, 'after the roll it is back on its wheels');
  for (let t = 0; t < 1.5; t += DT) s.update(DT, drive);
  s.render(1);
  check(v.wreckT === 0 && v.mesh.rotation.z === 0, 'it rejoins upright once the sit-out ends');

  const p = s.player;
  p.phys.wallImpactNormalSpeed = 30;
  s._handleWallImpact(p, 0.9);
  check(p.wreckT > 0 && s.playerWrecks === 1 && s.takedownCam?.victim === p, 'a head-on wall hit at speed wrecks the player (with the replay)');
  const q = session('race');
  racing(q);
  q.player.phys.wallImpactNormalSpeed = 8;
  q._handleWallImpact(q.player, 0.5);
  check(!q.player.wreckT, 'a glancing wall hit does not');
  const f = session('race', 'formula');
  racing(f);
  f.player.phys.wallImpactNormalSpeed = 30;
  f._handleWallImpact(f.player, 0.9);
  check(!f.player.wreckT && !f.crashEvents.length, 'Formula keeps its own damage model (no arcade wrecks)');
}

if (fails) {
  console.log(`\n[events] ${fails} FAILED`);
  process.exit(1);
}
console.log('\n[events] ALL EVENT CHECKS PASSED');
