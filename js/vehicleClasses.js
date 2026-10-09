// Per-discipline vehicle profiles.
//
// Everything that used to be a module constant in physics.js lives here, so a
// stock car, a GT3 machine and a road car can share one solver while behaving
// like genuinely different vehicles. The `formula` profile reproduces the
// original 2026 open-wheel constants EXACTLY — it is the regression baseline,
// and every existing validator runs against it.
//
// Aero note: `cla`/`cda` are areas fed to 0.5 * rho * A * v^2. An open-wheel car
// makes several times its own weight in downforce; a road car makes almost
// none, which is why the street classes corner on mechanical grip and run out
// of front end much earlier.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const BODY_FOOTPRINT = Object.freeze({
  city: [3.62, 1.68],
  hatch: [4.06, 1.79],
  sedan: [4.66, 1.83],
  wagon: [4.78, 1.86],
  coupe: [4.46, 1.81],
  roadster: [3.98, 1.73],
  muscle: [4.88, 1.93],
  pony: [4.79, 1.91],
  suv: [4.96, 1.96],
  pickup: [5.58, 2.03],
  rally: [4.44, 1.84],
  gt: [4.72, 1.95],
  supercar: [4.55, 1.99],
  hypercar: [4.66, 2.06],
  trackcar: [4.18, 1.90],
});

function bodyFootprint(type) {
  const dims = BODY_FOOTPRINT[type] || BODY_FOOTPRINT.sedan;
  return {
    contactHalfLength: Number((dims[0] * 0.5).toFixed(3)),
    contactHalfWidth: Number((dims[1] * 0.5).toFixed(3)),
  };
}

// Geometric gear ladder: top speed split across N ratios, first gear short.
export function gearLadder(topSpeedMps, gears = 6, firstShare = 0.285) {
  const count = clamp(Math.round(gears), 1, 8);
  const top = Math.max(12, topSpeedMps);
  const first = top * firstShare;
  const ladder = [0];
  for (let i = 0; i < count; i++) {
    ladder.push(Number((first * Math.pow(top / first, i / Math.max(1, count - 1))).toFixed(2)));
  }
  while (ladder.length < 9) ladder.push(ladder[ladder.length - 1]);
  return ladder;
}

export const VEHICLE_CLASSES = Object.freeze({
  // ---- open-wheel: the original model, unchanged --------------------------
  formula: Object.freeze({
    id: 'formula', label: 'Formula', shortLabel: 'F',
    baseMu: 1.62,
    cdaZ: 1.45, cdaX: 0.92, claZ: 4.3, claX: 1.5,
    powerBase: 585e3, powerOverride: 240e3, ersStd: 110e3, ersAttack: 40e3,
    massDry: 768, fuelMass: 62,
    gears: 8, gearTop: Object.freeze([0, 27.5, 37, 46.5, 56, 65.5, 75, 85.5, 96.5]),
    idleRpm: 4200, redlineRpm: 15000, soundFamily: 'formula',
    contactHalfLength: 2.48, contactHalfWidth: 0.99,
    steerLock: 1, activeAero: true, ers: true, override: true, pitStops: true,
    vehicle: Object.freeze({}),
  }),

  // ---- closed-wheel GT racing --------------------------------------------
  gt3: Object.freeze({
    id: 'gt3', label: 'GT Racing', shortLabel: 'GT',
    baseMu: 1.42,
    cdaZ: 1.02, cdaX: 0.88, claZ: 1.95, claX: 1.35,
    powerBase: 420e3, powerOverride: 60e3, ersStd: 0, ersAttack: 0,
    massDry: 1255, fuelMass: 78,
    gears: 6, gearTop: gearLadder(84, 6),
    idleRpm: 780, redlineRpm: 7200, soundFamily: 'v8',
    contactHalfLength: 2.36, contactHalfWidth: 0.98,
    steerLock: 1.12, activeAero: false, ers: false, override: true, pitStops: true,
    vehicle: Object.freeze({
      wheelbase: 2.68, frontCg: 1.32, rearCg: 1.36, frontTrack: 1.66, rearTrack: 1.62,
      cgHeight: 0.44, yawInertia: 1850, cornerStiffness: 96000,
      rollGradient: 0.085, camberCompensation: 0.5, ackermann: 0.8,
    }),
  }),

  // ---- oval stock car ------------------------------------------------------
  stock: Object.freeze({
    id: 'stock', label: 'Stock Car', shortLabel: 'SC',
    baseMu: 1.28,
    // Heavy, draggy, and deliberately short on downforce: these cars are
    // aero-loose in traffic, which is what makes pack racing on an oval work.
    cdaZ: 1.62, cdaX: 1.34, claZ: 1.28, claX: 0.95,
    powerBase: 500e3, powerOverride: 0, ersStd: 0, ersAttack: 0,
    massDry: 1497, fuelMass: 110,
    gears: 4, gearTop: gearLadder(90, 4, 0.36),
    idleRpm: 760, redlineRpm: 7200, soundFamily: 'v8',
    contactHalfLength: 2.52, contactHalfWidth: 1.03,
    steerLock: 1.05, activeAero: false, ers: false, override: false, pitStops: true,
    vehicle: Object.freeze({
      wheelbase: 2.92, frontCg: 1.36, rearCg: 1.56, frontTrack: 1.75, rearTrack: 1.73,
      cgHeight: 0.52, yawInertia: 2450, cornerStiffness: 88000,
      longitudinalStiffness: 86000, rollGradient: 0.105, camberCompensation: 0.42,
      ackermann: 0.55, springRate: 132000,
    }),
  }),

  // ---- road cars: the 100-car roster ---------------------------------------
  street: Object.freeze({
    id: 'street', label: 'Street', shortLabel: 'ST',
    baseMu: 1.12,
    cdaZ: 0.74, cdaX: 0.70, claZ: 0.22, claX: 0.16,
    powerBase: 224e3, powerOverride: 55e3, ersStd: 0, ersAttack: 0,
    massDry: 1380, fuelMass: 45,
    gears: 6, gearTop: gearLadder(68, 6),
    idleRpm: 800, redlineRpm: 6800, soundFamily: 'i4',
    contactHalfLength: 2.18, contactHalfWidth: 0.92,
    steerLock: 1.24, activeAero: false, ers: false, override: true, pitStops: false,
    vehicle: Object.freeze({
      wheelbase: 2.66, frontCg: 1.20, rearCg: 1.46, frontTrack: 1.56, rearTrack: 1.55,
      cgHeight: 0.55, yawInertia: 2100, cornerStiffness: 72000,
      longitudinalStiffness: 78000, rollGradient: 0.135, camberCompensation: 0.34,
      ackermann: 0.92, springRate: 96000, tyreRelaxationLength: 0.62,
    }),
  }),

  // ---- hypercars: the top of the roster ------------------------------------
  hyper: Object.freeze({
    id: 'hyper', label: 'Hypercar', shortLabel: 'HY',
    baseMu: 1.36,
    cdaZ: 0.86, cdaX: 0.70, claZ: 1.05, claX: 0.62,
    powerBase: 730e3, powerOverride: 130e3, ersStd: 0, ersAttack: 0,
    massDry: 1340, fuelMass: 58,
    gears: 7, gearTop: gearLadder(104, 7),
    idleRpm: 900, redlineRpm: 9000, soundFamily: 'v10',
    contactHalfLength: 2.28, contactHalfWidth: 1.03,
    steerLock: 1.14, activeAero: true, ers: false, override: true, pitStops: false,
    vehicle: Object.freeze({
      wheelbase: 2.72, frontCg: 1.24, rearCg: 1.48, frontTrack: 1.68, rearTrack: 1.66,
      cgHeight: 0.42, yawInertia: 1720, cornerStiffness: 92000,
      rollGradient: 0.075, camberCompensation: 0.55, ackermann: 0.78,
    }),
  }),
});

export const DEFAULT_VEHICLE_CLASS = 'formula';

export function vehicleClass(id) {
  return VEHICLE_CLASSES[id] || VEHICLE_CLASSES[DEFAULT_VEHICLE_CLASS];
}

// Build a concrete per-car profile: the class template, plus whatever the
// individual car's own numbers say. Returns a plain frozen object that
// CarPhysics can read directly.
export function buildVehicleProfile(classId, car = null) {
  const base = vehicleClass(classId);
  if (!car) return base;

  const hp = Number(car.performance?.power_hp ?? car.power_hp);
  const kg = Number(car.performance?.weight_kg ?? car.weight_kg);
  const topKmh = Number(car.performance?.top_speed_kmh ?? car.top_speed_kmh);
  const gears = Number(car.drivetrain_detail?.gears ?? car.gears ?? base.gears);
  const drive = String(car.performance?.drivetrain ?? car.drivetrain ?? 'RWD').toUpperCase();
  const tier = String(car.tier || '').toLowerCase();

  const topMps = Number.isFinite(topKmh) ? topKmh / 3.6 : null;
  const redlineRpm = Number(car.redlineRpm ?? car.engine?.redline_rpm);
  const idleRpm = Number(car.idleRpm ?? car.engine?.idle_rpm);
  const footprint = bodyFootprint(car.body);
  // Detailed models carry their real dimensions; collide on those.
  if (Number.isFinite(car.lengthM)) footprint.contactHalfLength = Number((car.lengthM / 2).toFixed(3));
  if (Number.isFinite(car.widthM)) footprint.contactHalfWidth = Number((car.widthM / 2).toFixed(3));
  // Tyre compound scales with how serious the car is, not with its price. Road
  // cars carry 8% more grip than the original tuning: tight corners were too
  // slow and pushed wide.
  const tyreMu = 1.08 * (tier === 'hyper' ? 1.34 : tier === 'super' ? 1.26
    : tier === 'tuned' ? 1.14 : 1.02);
  // Front-drive cars understeer: less rear stiffness bias, more front load.
  const driveBias = drive.startsWith('F') ? 0.92 : drive.startsWith('A') || drive === '4WD' ? 1.05 : 1;

  const profile = {
    ...base,
    id: `${base.id}:${car.id || 'custom'}`,
    label: car.name || base.label,
    carId: car.id || null,
    classId: base.id,
    drivetrain: drive,
    soundFamily: car.soundFamily || car.engine?.sound_family || base.soundFamily,
    idleRpm: Number.isFinite(idleRpm) ? idleRpm : base.idleRpm,
    redlineRpm: Number.isFinite(redlineRpm) ? redlineRpm : base.redlineRpm,
    contactHalfLength: footprint.contactHalfLength,
    contactHalfWidth: footprint.contactHalfWidth,
    visualBody: car.body || null,
    // garage upgrades (js/garage.js): tyre grip and nitro bottle
    baseMu: Number((base.baseMu * (tyreMu / 1.12) * (car.tuning?.grip || 1)).toFixed(4)),
    powerOverride: (base.powerOverride || 0) + (car.tuning?.nitroKw || 0) * 1000,
    massDry: Number.isFinite(kg) ? kg : base.massDry,
    powerBase: Number.isFinite(hp) ? Math.round(hp * 745.7) : base.powerBase,
    gears: clamp(Math.round(gears), 1, 8),
    gearTop: topMps ? gearLadder(topMps, gears) : base.gearTop,
    vehicle: Object.freeze({
      ...base.vehicle,
      // Heavier cars carry more rotational inertia; lighter ones change
      // direction faster. Scales off the class template's reference mass.
      yawInertia: Math.round((base.vehicle.yawInertia || 1080) *
        clamp((Number.isFinite(kg) ? kg : base.massDry) / base.massDry, 0.55, 1.85)),
      cornerStiffness: Math.round((base.vehicle.cornerStiffness || 78000) * driveBias),
      // Less front roll share = less load transfer onto the outside front tyre,
      // so road cars bite on turn-in instead of washing wide (was 0.52 / FWD 0.58).
      rollFrontShare: clamp(0.46 * (drive.startsWith('F') ? 1.09 : 1), 0.4, 0.65),
    }),
  };
  return Object.freeze(profile);
}
