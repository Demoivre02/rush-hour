/** cars.js — loader and query helpers for the 100-Car Pack. */
export async function loadCars(basePath = '.') {
  const db = await (await fetch(`${basePath}/cars.json`)).json();
  db.byId = Object.fromEntries(db.cars.map(c => [c.id, c]));
  return db;
}

export const TIERS = ['base', 'tuned', 'super', 'hyper'];

export const byTier    = (db, t)   => db.cars.filter(c => c.tier === t);
export const byMaker   = (db, m)   => db.cars.filter(c => c.manufacturer === m);
export const byTag     = (db, tag) => db.cars.filter(c => c.tags.includes(tag));
export const affordable= (db, cr)  => db.cars.filter(c => c.economy.price_credits <= cr);
export const unlocked  = (db, lvl) => db.cars.filter(c => c.economy.unlock_level <= lvl);

/** Cars within +/- tolerance of a performance index — use this to build fair grids. */
export const matchmake = (db, pi, tol = 40, n = 7) =>
  db.cars.filter(c => Math.abs(c.performance.performance_index - pi) <= tol)
         .sort(() => Math.random() - 0.5).slice(0, n);

export const sortBy = (cars, key, desc = true) => {
  const get = c => key.split('.').reduce((o, k) => o?.[k], c);
  return [...cars].sort((a, b) => (desc ? 1 : -1) * (get(b) - get(a)));
};

/** Rough top-speed-limited acceleration curve, for arcade-style movement. */
export function accelerationAt(car, speedKmh) {
  const p = car.performance;
  const vmax = p.top_speed_kmh;
  const base = (100 / 3.6) / p.accel_0_100_kmh_s;      // m/s^2 average to 100
  const f = Math.max(0, 1 - Math.pow(speedKmh / vmax, 2.2));
  return base * (0.55 + 0.45 * f) * f;
}

/** Engine rpm for a given road speed, from the car's gearing. */
export function rpmFor(car, speedKmh, gearIndex) {
  const d = car.drivetrain_detail;
  const g = d.gear_ratios[Math.min(gearIndex, d.gear_ratios.length - 1)];
  const wheelCircum = 2.0;                              // metres, approximate
  const rpm = (speedKmh / 3.6) / wheelCircum * 60 * g * d.final_drive;
  return Math.min(car.engine.redline_rpm, Math.max(car.engine.idle_rpm || 900, rpm));
}
