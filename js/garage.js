// The garage: per-car paint and part upgrades, saved in the browser.
//
// Upgrades are free for now. Each part has five levels and changes a real
// physics input (power, mass, top-speed gearing, tyre grip or nitro power), so
// a tuned car is measurably quicker, not just a bigger number on the card.
// js/race.js applies the saved setup to the player's car through tunedCar();
// the menu reads and writes it through the rest of this module.
import { performanceIndex, performanceClass } from './modelCars.js';
// The showroom is re-exported so the menu reaches it through this module, which
// the race already loads (tools/validate-performance-budget.mjs keeps every
// lazily loaded module inside the session's module graph).
export { GarageView } from './garageView.js';

export const MAX_LEVEL = 5;

// Per level. `hp`, `kg` and `top` scale the stock figure; `grip` scales tyre
// friction (cornering and braking); `nitro` adds boost power in kW.
export const UPGRADES = Object.freeze([
  Object.freeze({ id: 'engine', label: 'Engine', blurb: 'Cams, intake and exhaust', hp: 0.07 }),
  Object.freeze({ id: 'turbo', label: 'Turbo', blurb: 'Bigger boost, intercooler', hp: 0.05, top: 0.01 }),
  Object.freeze({ id: 'gearbox', label: 'Gearbox', blurb: 'Close ratios, longer top gear', top: 0.03 }),
  Object.freeze({ id: 'weight', label: 'Weight', blurb: 'Carbon panels, stripped trim', kg: -0.03 }),
  Object.freeze({ id: 'tyres', label: 'Tyres', blurb: 'Softer compound, wider tread', grip: 0.03 }),
  Object.freeze({ id: 'nitro', label: 'Nitro', blurb: 'Bigger bottle, faster refill', nitro: 25 }),
]);

export const PAINTS = Object.freeze([
  Object.freeze({ id: 'factory', label: 'Factory', hex: null }),
  Object.freeze({ id: 'white', label: 'Pearl White', hex: '#f2f3f5' }),
  Object.freeze({ id: 'black', label: 'Midnight Black', hex: '#111317' }),
  Object.freeze({ id: 'silver', label: 'Liquid Silver', hex: '#a9b0b8' }),
  Object.freeze({ id: 'red', label: 'Rosso Corsa', hex: '#c8101a' }),
  Object.freeze({ id: 'orange', label: 'Blaze Orange', hex: '#ff6a10' }),
  Object.freeze({ id: 'yellow', label: 'Racing Yellow', hex: '#ffcc12' }),
  Object.freeze({ id: 'lime', label: 'Acid Green', hex: '#7cdc1e' }),
  Object.freeze({ id: 'teal', label: 'Lagoon Teal', hex: '#0fa3a8' }),
  Object.freeze({ id: 'blue', label: 'Electric Blue', hex: '#1f6dff' }),
  Object.freeze({ id: 'navy', label: 'Deep Navy', hex: '#14234f' }),
  Object.freeze({ id: 'purple', label: 'Ultraviolet', hex: '#7a2cff' }),
  Object.freeze({ id: 'pink', label: 'Hot Pink', hex: '#ff2d8a' }),
]);

const KEY = 'coastline_garage_v1';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

function writeAll(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ }
}

const clampLevel = (n) => Math.max(0, Math.min(MAX_LEVEL, Math.round(Number(n) || 0)));

/** The saved setup for one car: { paint: hex|null, levels: { engine: 0..5, ... } }. */
export function garageFor(carId) {
  const saved = readAll()[carId] || {};
  const levels = {};
  for (const u of UPGRADES) levels[u.id] = clampLevel(saved.levels?.[u.id]);
  return { paint: typeof saved.paint === 'string' ? saved.paint : null, levels };
}

function update(carId, fn) {
  const all = readAll();
  const entry = garageFor(carId);
  fn(entry);
  all[carId] = entry;
  writeAll(all);
  return entry;
}

export function setPaint(carId, hex) {
  return update(carId, (e) => { e.paint = hex || null; });
}

export function setLevel(carId, part, level) {
  return update(carId, (e) => { if (part in e.levels) e.levels[part] = clampLevel(level); });
}

export function resetCar(carId) {
  const all = readAll();
  delete all[carId];
  writeAll(all);
  return garageFor(carId);
}

/**
 * A copy of `car` with a garage setup applied: tuned performance figures, the
 * chosen paint, and `tuning` multipliers that js/vehicleClasses.js reads.
 */
export function tunedCar(car, setup = garageFor(car?.id)) {
  if (!car?.performance) return car;
  const p = car.performance;
  let hp = 1, kg = 1, top = 1, grip = 1, nitroKw = 0;
  for (const u of UPGRADES) {
    const n = setup.levels[u.id] || 0;
    hp += (u.hp || 0) * n;
    kg += (u.kg || 0) * n;
    top += (u.top || 0) * n;
    grip += (u.grip || 0) * n;
    nitroKw += (u.nitro || 0) * n;
  }
  const power = Math.round(p.power_hp * hp);
  const weight = Math.round(p.weight_kg * kg);
  const topKmh = Math.round(p.top_speed_kmh * top);
  // 0-100 time scales with power-to-weight (a rough but monotonic estimate)
  const pwGain = (power / weight) / (p.power_hp / p.weight_kg);
  const accel = Number((p.accel_0_100_kmh_s / Math.pow(pwGain, 0.6)).toFixed(2));
  const pi = performanceIndex(power, weight, topKmh);
  return {
    ...car,
    paint: setup.paint || null,
    performance: {
      ...p,
      power_hp: power,
      weight_kg: weight,
      top_speed_kmh: topKmh,
      accel_0_100_kmh_s: accel,
      performance_index: pi,
      performance_class: performanceClass(pi),
    },
    tuning: { grip, nitroKw },
  };
}

/** Asphalt-style 0-100 bars for the garage card. */
export function statBars(car) {
  const p = car.performance;
  const pct = (v, lo, hi) => Math.round(Math.max(4, Math.min(100, ((v - lo) / (hi - lo)) * 100)));
  return {
    topSpeed: pct(p.top_speed_kmh, 180, 440),
    acceleration: pct(10 - p.accel_0_100_kmh_s, 0, 8.2),
    handling: pct((car.tuning?.grip || 1) * (1600 / p.weight_kg), 0.7, 2.0),
    nitro: pct(car.tuning?.nitroKw || 0, -20, 125 + 20),
  };
}

// ---- Formula: the player's team car ----------------------------------------
// Formula has no roster: the car is the team's 2026 F1 car. It goes through
// the same garage (paint + the same six parts), keyed per team, and the race
// applies the result to the open-wheel physics profile with tunedFormulaProfile().

export const FORMULA_CAR_PREFIX = 'formula-';

/** The garage card for a team's F1 car. */
export function formulaCar(team) {
  const pi = performanceIndex(1000, 798, 347);
  return {
    id: `${FORMULA_CAR_PREFIX}${team.id}`,
    make: team.name,
    model: '2026 F1',
    year: 2026,
    engine: '1.6 V6 Turbo Hybrid',
    name: `${team.name} 2026 F1`,
    formulaTeam: team,
    colour: `#${Number(team.color).toString(16).padStart(6, '0')}`,
    performance: {
      power_hp: 1000, weight_kg: 798, top_speed_kmh: 347, accel_0_100_kmh_s: 2.4,
      drivetrain: 'RWD', performance_index: pi, performance_class: performanceClass(pi),
    },
  };
}

/** The team colours with a chosen paint applied (null keeps the livery). */
export function paintedTeam(team, paint) {
  return paint ? { ...team, color: parseInt(paint.slice(1), 16) } : team;
}

/** The open-wheel physics profile with a garage setup applied. */
export function tunedFormulaProfile(profile, setup) {
  let hp = 1, kg = 1, top = 1, grip = 1, nitroKw = 0;
  for (const u of UPGRADES) {
    const n = setup.levels[u.id] || 0;
    hp += (u.hp || 0) * n;
    kg += (u.kg || 0) * n;
    top += (u.top || 0) * n;
    grip += (u.grip || 0) * n;
    nitroKw += (u.nitro || 0) * n;
  }
  return Object.freeze({
    ...profile,
    id: `${profile.id}:tuned`,
    classId: profile.classId || profile.id,   // still the open-wheel class everywhere
    powerBase: profile.powerBase * hp,
    massDry: Math.round(profile.massDry * kg),
    gearTop: Object.freeze(profile.gearTop.map((v) => v * top)),
    baseMu: profile.baseMu * grip,
    powerOverride: (profile.powerOverride || 0) + nitroKw * 1000,
  });
}
