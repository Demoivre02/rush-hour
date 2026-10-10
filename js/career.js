// Career: a tour of events across five classes (D, C, B, A, S), with credits,
// stars, a dealership and a paid garage. Saved in the browser.
//
// Free play (Race Modes, Play Now) is untouched: there every car is available
// and upgrades are free. Career keeps its own garage setups (keyed
// `career:<carId>` in js/garage.js storage), so free upgrades never leak in.
// Pure data and bookkeeping: js/ui.js draws the screens, js/main.js starts the
// races and reports results through recordResult().
import { garageFor, setLevel, MAX_LEVEL, UPGRADES } from './garage.js';

export const CLASS_ORDER = Object.freeze(['D', 'C', 'B', 'A', 'S']);

// Stars needed (in total) to open each class; every event pays up to 3.
export const TIERS = Object.freeze([
  Object.freeze({ id: 'D', label: 'Rookie Streets', stars: 0, discipline: 'street' }),
  Object.freeze({ id: 'C', label: 'Night Runners', stars: 6, discipline: 'street' }),
  Object.freeze({ id: 'B', label: 'Downtown Kings', stars: 15, discipline: 'street' }),
  Object.freeze({ id: 'A', label: 'City Legends', stars: 27, discipline: 'street' }),
  Object.freeze({ id: 'S', label: 'Hypercar Finale', stars: 39, discipline: 'hypercar' }),
]);

const ev = (id, tier, title, trackId, event, laps, reward) =>
  Object.freeze({ id, tier, title, trackId, event, laps, reward });

// Four events per class. `laps` applies to plain races (a sprint is one lap);
// the timed events end on their own clock (js/events.js).
export const CAREER_EVENTS = Object.freeze([
  ev('d1', 'D', 'First Night Out', 'miami', 'race', 2, 3000),
  ev('d2', 'D', 'Last One Standing', 'melbourne', 'elimination', 0, 3500),
  ev('d3', 'D', 'Harbour Sprint', 'monaco', 'sprint', 1, 4000),
  ev('d4', 'D', 'Sideways in Miami', 'miami', 'drift', 0, 4500),
  ev('c1', 'C', 'Marina Bay Run', 'singapore', 'race', 3, 6000),
  ev('c2', 'C', 'Wreck Them All', 'jeddah', 'takedown', 0, 6500),
  ev('c3', 'C', 'Old Town Knockout', 'baku', 'elimination', 0, 7000),
  ev('c4', 'C', 'Strip Showdown', 'lasvegas', 'race', 3, 8000),
  ev('b1', 'B', 'Corniche Dash', 'jeddah', 'sprint', 1, 11000),
  ev('b2', 'B', 'Neon Drift', 'lasvegas', 'drift', 0, 12000),
  ev('b3', 'B', 'Castle Walls', 'baku', 'takedown', 0, 13000),
  ev('b4', 'B', 'Principality GP', 'monaco', 'race', 4, 15000),
  ev('a1', 'A', 'Midnight Express', 'singapore', 'elimination', 0, 20000),
  ev('a2', 'A', 'Ocean Drive', 'miami', 'race', 4, 22000),
  ev('a3', 'A', 'Albert Park Brawl', 'melbourne', 'takedown', 0, 24000),
  ev('a4', 'A', 'Vegas Royale', 'lasvegas', 'race', 5, 28000),
  ev('s1', 'S', 'Hypercar Debut', 'monza', 'race', 3, 40000),
  ev('s2', 'S', 'Spa Shootout', 'spa', 'elimination', 0, 45000),
  ev('s3', 'S', 'Suzuka Rush', 'suzuka', 'race', 3, 50000),
  ev('s4', 'S', 'The Final Lap', 'silverstone', 'race', 4, 60000),
]);

// Dealership prices and the cost of one upgrade level, by class.
export const CAR_PRICE = Object.freeze({ D: 8000, C: 20000, B: 45000, A: 90000, S: 180000 });
const UPGRADE_UNIT = Object.freeze({ D: 600, C: 1000, B: 1600, A: 2500, S: 4000 });

const START_CREDITS = 15000;
const KEY = 'rushhour_career_v1';

export const careerSetupKey = (carId) => `career:${carId}`;
export const classRank = (c) => Math.max(0, CLASS_ORDER.indexOf(c));
export const eventById = (id) => CAREER_EVENTS.find((e) => e.id === id) || null;
export const tierOf = (id) => TIERS.find((t) => t.id === id) || TIERS[0];

function blank() {
  return { credits: START_CREDITS, owned: [], stars: {}, started: false };
}

export function loadCareer() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && typeof s.credits === 'number' && Array.isArray(s.owned)) {
      return { ...blank(), ...s, stars: { ...(s.stars || {}) } };
    }
  } catch { /* private mode or bad data */ }
  return blank();
}

export function saveCareer(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
  return state;
}

/** First visit: hand over the two cheapest D-class cars. */
export function ensureStarted(state, cars) {
  if (state.started) return state;
  const starters = cars.filter((c) => c.performance.performance_class === 'D')
    .sort((a, b) => a.performance.performance_index - b.performance.performance_index)
    .slice(0, 2).map((c) => c.id);
  state.owned = [...new Set([...state.owned, ...starters])];
  state.started = true;
  return saveCareer(state);
}

export function totalStars(state) {
  return Object.values(state.stars).reduce((a, b) => a + (b || 0), 0);
}

export function tierUnlocked(state, tierId) {
  return totalStars(state) >= tierOf(tierId).stars;
}

/** A car may enter an event of its own class or any higher class. */
export function carEligible(car, event) {
  return classRank(car.performance.performance_class) <= classRank(event.tier);
}

export function buyCar(state, car) {
  const price = CAR_PRICE[car.performance.performance_class] ?? CAR_PRICE.S;
  if (state.owned.includes(car.id)) return { ok: false, reason: 'owned' };
  if (state.credits < price) return { ok: false, reason: 'credits', price };
  state.credits -= price;
  state.owned.push(car.id);
  saveCareer(state);
  return { ok: true, price };
}

/** Price of the next level of `part` for `car` (null at max). */
export function upgradeCost(car, part) {
  const level = garageFor(careerSetupKey(car.id)).levels[part] || 0;
  if (level >= MAX_LEVEL) return null;
  return (UPGRADE_UNIT[car.performance.performance_class] ?? UPGRADE_UNIT.S) * (level + 1);
}

export function buyUpgrade(state, car, part) {
  if (!UPGRADES.some((u) => u.id === part)) return { ok: false, reason: 'part' };
  const cost = upgradeCost(car, part);
  if (cost == null) return { ok: false, reason: 'max' };
  if (state.credits < cost) return { ok: false, reason: 'credits', cost };
  state.credits -= cost;
  const key = careerSetupKey(car.id);
  setLevel(key, part, garageFor(key).levels[part] + 1);
  saveCareer(state);
  return { ok: true, cost };
}

/**
 * Stars and credits for a finished career event.
 * `result`: { pos, finished, success (timed events), takedowns, nearMisses }.
 */
export function scoreResult(event, result) {
  let stars = 0;
  if (event.event === 'race' || event.event === 'sprint' || event.event === 'elimination') {
    if (result.finished !== false) stars = result.pos === 1 ? 3 : result.pos <= 3 ? 2 : result.pos <= 6 ? 1 : 0;
  } else {
    stars = result.success ? 3 : 0;
  }
  const share = [0, 0.4, 0.75, 1][stars];
  const credits = Math.round(event.reward * share / 50) * 50
    + (result.takedowns || 0) * 250 + (result.nearMisses || 0) * 50;
  return { stars, credits };
}

export function recordResult(state, event, result) {
  const { stars, credits } = scoreResult(event, result);
  const best = state.stars[event.id] || 0;
  state.stars[event.id] = Math.max(best, stars);
  state.credits += credits;
  saveCareer(state);
  return { stars, credits, newBest: stars > best, totalStars: totalStars(state) };
}
