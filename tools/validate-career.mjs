// Headless checks for js/career.js: the starting garage, the dealership,
// paid upgrades kept apart from free play, stars, payouts and class unlocks.
//
// Usage: node tools/validate-career.mjs
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const C = await import('../js/career.js');
const G = await import('../js/garage.js');
const { carsForDiscipline } = await import('../js/disciplines.js');

let fails = 0;
const check = (ok, label) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
const cars = [...carsForDiscipline('street'), ...carsForDiscipline('hypercar')];
const byClass = (k) => cars.filter((c) => c.performance.performance_class === k);

console.log('[career] events and tiers');
check(C.CAREER_EVENTS.length === 20 && C.CLASS_ORDER.every((t) => C.CAREER_EVENTS.filter((e) => e.tier === t).length === 4),
  'four events in each of the five classes');
check(C.TIERS.every((t, i) => i === 0 || t.stars > C.TIERS[i - 1].stars), 'each class needs more stars than the last');
check(['D', 'C', 'B', 'A'].every((t) => byClass(t).length) && byClass('S').length > 0, 'every class has cars to race');

console.log('[career] start and dealership');
let s = C.ensureStarted(C.loadCareer(), cars);
check(s.credits === 15000 && s.owned.length === 2 && s.owned.every((id) => byClass('D').some((c) => c.id === id)),
  'a new career has 15,000 CR and two D-class cars');
const again = C.ensureStarted(C.loadCareer(), cars);
check(again.owned.length === 2, 'starting again does not hand out more cars');
const cCar = byClass('C')[0];
check(C.buyCar(s, cCar).reason === 'credits', 'a C-class car (20,000) is out of reach at the start');
s.credits += 10000;                              // as if earned in class D
const buy = C.buyCar(s, cCar);
check(buy.ok && s.credits === 25000 - C.CAR_PRICE.C && s.owned.includes(cCar.id), 'buying a C-class car costs its price');
check(!C.buyCar(s, cCar).ok, 'a car cannot be bought twice');
const aCar = byClass('A')[0];
check(C.buyCar(s, aCar).reason === 'credits', 'a car you cannot afford is refused');

console.log('[career] paid garage');
const before = s.credits;
const cost = C.upgradeCost(cCar, 'engine');
const up = C.buyUpgrade(s, cCar, 'engine');
check(up.ok && s.credits === before - cost && G.garageFor(C.careerSetupKey(cCar.id)).levels.engine === 1,
  'an upgrade costs credits and raises the career setup');
check(G.garageFor(cCar.id).levels.engine === 0, 'the free-play setup of the same car is untouched');
check(C.upgradeCost(cCar, 'engine') === cost * 2, 'each level costs more than the last');

console.log('[career] stars, payouts and unlocks');
const race = C.eventById('d1'), drift = C.eventById('d4');
check(C.scoreResult(race, { pos: 1 }).stars === 3 && C.scoreResult(race, { pos: 3 }).stars === 2
  && C.scoreResult(race, { pos: 6 }).stars === 1 && C.scoreResult(race, { pos: 9 }).stars === 0,
  'race stars: win 3, podium 2, top six 1');
check(C.scoreResult(drift, { success: true }).stars === 3 && C.scoreResult(drift, { success: false }).stars === 0,
  'timed events: success 3 stars, else none');
check(C.scoreResult(race, { pos: 1, takedowns: 2, nearMisses: 4 }).credits === race.reward + 500 + 200,
  'takedowns and near misses add to the payout');
check(!C.tierUnlocked(s, 'C'), 'class C starts locked');
C.recordResult(s, race, { pos: 1 });
C.recordResult(s, C.eventById('d2'), { pos: 1 });
check(C.totalStars(s) === 6 && C.tierUnlocked(s, 'C'), 'six stars open class C');
const r = C.recordResult(s, race, { pos: 5 });
check(s.stars.d1 === 3 && !r.newBest, 'a worse rerun keeps the best stars');
check(C.carEligible(byClass('D')[0], C.eventById('c1')) && !C.carEligible(aCar, C.eventById('c1')),
  'lower-class cars may enter, faster ones may not');
check(JSON.parse(store.get('rushhour_career_v1')).stars.d1 === 3, 'progress is saved');

console.log('[career] daily challenge');
const d1 = C.dailyEvent('2026-10-10', 'C'), d1b = C.dailyEvent('2026-10-10', 'C'), d2 = C.dailyEvent('2026-10-11', 'C');
check(d1.id === d1b.id && d1.trackId === d1b.trackId && d1.event === d1b.event, 'the same date gives the same challenge');
check(d1.id !== d2.id, 'a new day gives a new challenge');
check(C.eventById(d1.id)?.trackId === d1.trackId && C.eventById(d1.id).daily, 'a daily id resolves back to its event');
check(C.todaysChallenge(s).tier === 'C', 'the challenge runs at your highest open class');
const today = C.todaysChallenge(s);
const credits0 = s.credits, stars0 = C.totalStars(s);
const lose = C.recordResult(s, today, { pos: 7, success: false });
check(lose.credits === 0 && s.dailyDone !== today.dateKey, 'losing pays nothing and leaves it open');
const win = C.recordResult(s, today, { pos: 2, success: true });
check(win.credits === today.reward && s.credits === credits0 + today.reward && C.totalStars(s) === stars0,
  'a top-three finish pays the daily reward (no stars)');
check(C.recordResult(s, today, { pos: 1, success: true }).credits === 0, 'it pays only once a day');

if (fails) { console.log(`\n[career] ${fails} FAILED`); process.exit(1); }
console.log('\n[career] ALL CAREER CHECKS PASSED');
