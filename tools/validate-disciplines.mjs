// Discipline wiring: a session started in a road-car category must actually
// field road cars with that class's physics, and `formula` must be untouched.
// ---- minimal DOM stubs, matching tools/sim-race.mjs -----------------------
const ctxStub = () => ({
  fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '', textBaseline: '',
  lineWidth: 1, lineJoin: '',
  fillRect() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
  moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, arcTo() {},
  fillText() {}, strokeText() {}, createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
  measureText: () => ({ width: 10 }),
  save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
  ellipse() {}, bezierCurveTo() {}, setTransform() {}, drawImage() {},
});
globalThis.document = {
  createElement: (tag) => tag === 'canvas'
    ? { width: 0, height: 0, getContext: ctxStub } : { style: {} },
};
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

import * as THREE from 'three';
const { buildCircuit } = await import('../js/trackBuilder.js');
const { TRACKS } = await import('../js/tracks.js');
const { RaceSession } = await import('../js/race.js');
const { DISCIPLINES, DISCIPLINE_ORDER, carsForDiscipline } = await import('../js/disciplines.js');
const { vehicleClass } = await import('../js/vehicleClasses.js');

let failures = 0;
const ok = (c, label, detail = '') => {
  if (c) console.log(`  PASS  ${label}${detail ? `  ${detail}` : ''}`);
  else { failures++; console.error(`  FAIL  ${label}${detail ? `  ${detail}` : ''}`); }
};

console.log('[disciplines] definitions');
ok(DISCIPLINE_ORDER.length === 7, 'seven disciplines defined', `[${DISCIPLINE_ORDER.join(', ')}]`);
for (const id of DISCIPLINE_ORDER) {
  const d = DISCIPLINES[id];
  ok(!!vehicleClass(d.vehicleClass) && vehicleClass(d.vehicleClass).id === d.vehicleClass,
    `${id}: vehicle class '${d.vehicleClass}' exists`);
  ok(d.tracks.length > 0 && d.tracks.every((t) => TRACKS[t]),
    `${id}: every listed track exists`, `[${d.tracks.length} venues]`);
  ok(d.gridSize >= 1 && d.laps.normal >= 1, `${id}: has a usable session format`);
}
ok(carsForDiscipline('street').every((c) => ['base', 'tuned'].includes(c.tier)),
  'street fields only road-car tiers', `[${carsForDiscipline('street').length} cars]`);
ok(carsForDiscipline('hypercar').every((c) => ['super', 'hyper'].includes(c.tier)),
  'hypercar fields only supercars and hypercars', `[${carsForDiscipline('hypercar').length} cars]`);
ok(carsForDiscipline('formula').length === 0, 'formula uses the championship entry list, not the roster');

console.log('[disciplines] a session actually receives the right cars');
function session(disciplineId, trackId, playerCarId) {
  const scene = new THREE.Scene();
  const c = buildCircuit(trackId, TRACKS[trackId], scene);
  return new RaceSession({
    scene, circuit: c, mode: 'race', laps: 2, playerDriverId: 'hacker',
    discipline: disciplineId, playerCarId,
    assists: { tc: true, abs: true, autoGear: true },
    random: (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(),
  });
}

const f1 = session('formula', 'monza');
const f1Profile = f1.entries[0].phys.profile;
ok(f1Profile.id === 'formula' && f1Profile.massDry === 768 && f1Profile.claZ === 4.3,
  'formula session still builds the original open-wheel car',
  `[${f1Profile.id}, ${f1Profile.massDry}kg, cla ${f1Profile.claZ}]`);

const street = session('street', 'monaco', 'model-supramk4');
const sp = street.entries.map((e) => e.phys.profile);
ok(sp.every((p) => p.classId === 'street'), 'street session builds street-class cars');
ok(street.entries.find((e) => e.isPlayer)?.phys.profile.carId === 'model-supramk4',
  'the street player gets the car they picked',
  `[${street.entries.find((e) => e.isPlayer)?.phys.profile.carId}]`);
ok(new Set(sp.map((p) => p.carId)).size > 5, 'the grid is a mixed field, not one model',
  `[${new Set(sp.map((p) => p.carId)).size} distinct cars]`);
ok(sp.some((p) => p.massDry !== vehicleClass('street').massDry),
  'per-car mass comes from the roster, not the class template');
// Matchmaking only has room to work when the pool is bigger than the grid;
// with the model roster the street pool is exactly one grid, so it all races.
const pool = carsForDiscipline('street');
const pis = street._entryProfiles.roster.map((c) => c.performance.performance_index);
if (pool.length > DISCIPLINES.street.gridSize) {
  ok(Math.max(...pis.slice(0, 12)) - Math.min(...pis.slice(0, 12)) < 260,
    'the front of the grid is matchmade by performance index',
    `[PI spread ${(Math.max(...pis.slice(0, 12)) - Math.min(...pis.slice(0, 12)))}]`);
} else {
  ok(new Set(street._entryProfiles.roster.map((c) => c.id)).size === pool.length,
    'a pool no bigger than the grid races in full', `[${pool.length} cars]`);
}

ok(street.entries.length === DISCIPLINES.street.gridSize,
  'a street race fields the discipline grid size, not the full F1 entry list',
  `[${street.entries.length} cars]`);
ok(street.entries.some((e) => e.isPlayer), 'the player is always on that grid');
ok(f1.entries.length > 18, 'and the championship grid is untouched',
  `[${f1.entries.length} cars]`);

const stock = session('stock', 'thunderdome');
ok(stock.entries.every((e) => e.phys.profile.id === 'stock'),
  'stock session builds spec stock cars on the oval');
ok(stock.entries[0].phys.profile.gears === 4, 'stock cars run a 4-speed', 
  `[${stock.entries[0].phys.profile.gears}]`);

// Qualifying builds cars through its own path; it must use the same profiles.
function qualiSession(disciplineId, trackId, playerCarId) {
  const scene = new THREE.Scene();
  const c = buildCircuit(trackId, TRACKS[trackId], scene);
  return new RaceSession({
    scene, circuit: c, mode: 'quali', laps: 1, playerDriverId: 'hacker',
    discipline: disciplineId, playerCarId,
    assists: { tc: true, abs: true, autoGear: true },
    random: (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(),
  });
}
const q = qualiSession('hypercar', 'spa', 'model-jesko');
ok(q.entries[0].phys.profile.classId === 'hyper',
  'a qualifying session uses the discipline physics, not the open-wheel default',
  `[${q.entries[0].phys.profile.classId || q.entries[0].phys.profile.id}]`);
ok(q.entries.slice(1).every((e) => e.phys.profile.classId === 'hyper'),
  'qualifying rivals get it too');
ok(q.entries[0].carHandle.source === 'road-primitive',
  'and a closed-wheel body', `[${q.entries[0].carHandle.source}]`);

const nord = session('nordschleife', 'eifelring', 'model-jesko');
ok(nord.entries[0].phys.profile.classId === 'hyper', 'Nordschleife runs the hypercar class');
ok(nord.entries[0].phys.profile.carId === 'model-jesko',
  'the player gets the car they picked', `[${nord.entries[0].phys.profile.carId}]`);
ok(street.entries.every((e) => e.carHandle.source === 'road-primitive'),
  'every car in a street race has a road-car body, not an open-wheel one');
ok(f1.entries.every((e) => e.carHandle.source !== 'road-primitive'),
  'and the Formula grid still gets the open-wheel car');

console.log(failures ? `disciplines validator: ${failures} FAILURE(S)` : 'disciplines validator: PASS');
process.exit(failures ? 1 : 0);
