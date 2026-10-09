// Vehicle-class regression + differentiation.
//   (a) the `formula` profile still holds the original open-wheel constants
//   (b) each class produces a genuinely different steady-state corner
//   (c) per-car profiles respect the car's own mass/power/gearing
import * as THREE from 'three';
import { CarPhysics } from '../js/physics.js';
import { createVehicleState, resetVehicleState, stepVehicleDynamics } from '../js/vehicleDynamics.js';
import { VEHICLE_CLASSES, buildVehicleProfile, gearLadder, vehicleClass } from '../js/vehicleClasses.js';

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (cond) console.log(`  PASS  ${label}${detail ? `  ${detail}` : ''}`);
  else { failures++; console.error(`  FAIL  ${label}${detail ? `  ${detail}` : ''}`); }
};

console.log('[classes] formula profile is the untouched 2026 baseline');
const f = vehicleClass('formula');
ok(f.baseMu === 1.62, 'baseMu 1.62');
ok(f.cdaZ === 1.45 && f.cdaX === 0.92, 'drag areas 1.45 / 0.92');
ok(f.claZ === 4.3 && f.claX === 1.5, 'downforce areas 4.3 / 1.5');
ok(f.powerBase === 585e3 && f.powerOverride === 240e3, 'power 585kW + 240kW override');
ok(f.ersStd === 110e3 && f.ersAttack === 40e3, 'ERS 110kW / 40kW');
ok(f.massDry === 768 && f.fuelMass === 62, 'mass 768 + 62 fuel');
ok(JSON.stringify(f.gearTop) === JSON.stringify([0, 27.5, 37, 46.5, 56, 65.5, 75, 85.5, 96.5]),
  '8-speed ladder unchanged');

console.log('[classes] peak sustained lateral acceleration at 60 m/s');
// Drive the four-corner solver directly at a fixed speed and sweep steering
// until the tyres saturate. This isolates what the class split actually
// changes — tyre mu, downforce and mass — from lap-time noise.
const SURFACE = {
  grade: 0, camber: 0, bump: 0, grip: 1, wetness: 0, gripIncludesWetness: false,
  bumpFL: 0, bumpFR: 0, bumpRL: 0, bumpRR: 0,
};
const SPEED = 60;

function peakLateralG(classId) {
  const profile = vehicleClass(classId);
  const state = createVehicleState(profile.vehicle);
  const mass = profile.massDry + profile.fuelMass * 0.5;
  const downforce = 0.5 * 1.2 * profile.claZ * SPEED * SPEED;
  resetVehicleState(state, SPEED, 90);
  let best = 0;
  for (let i = 0; i < 2400; i++) {
    // Ramp steering in, then hold. Peak lateral accel is the grip limit.
    const steer = Math.min(0.16, i * 0.00016);
    stepVehicleDynamics(state, {
      mass, surface: SURFACE, steerAngle: steer, mu: profile.baseMu,
      downforce, driveForce: 0, brakeForce: 0, engineBrakeForce: 0,
      brakeBias: 0.56, diffLock: 0.45, abs: true, tc: true,
      yawInertia: state.config.yawInertia, aeroBalance: 0.45,
      rideHeightFront: 0.038, rideHeightRear: 0.038,
    }, 1 / 120);
    // Hold longitudinal speed: this rig tests grip, not power.
    state.velocityLong = SPEED;
    if (i > 400) best = Math.max(best, Math.abs(state.accelLat));
  }
  return best / 9.81;
}

const gs = {};
for (const id of Object.keys(VEHICLE_CLASSES)) gs[id] = peakLateralG(id);
for (const [id, g] of Object.entries(gs)) {
  const c = vehicleClass(id);
  const df = 0.5 * 1.2 * c.claZ * SPEED * SPEED;
  console.log(`    ${id.padEnd(8)} ${g.toFixed(2)} g` +
    `   (${c.massDry}kg, mu ${c.baseMu}, ${(df / 1000).toFixed(1)}kN downforce at ${SPEED}m/s)`);
}
ok(Object.values(gs).every((g) => Number.isFinite(g) && g > 0.5),
  'every class produces stable, plausible grip');
ok(gs.formula > gs.gt3, 'open-wheel downforce out-corners GT',
  `${gs.formula.toFixed(2)}g > ${gs.gt3.toFixed(2)}g`);
ok(gs.gt3 > gs.street, 'GT out-corners a road car',
  `${gs.gt3.toFixed(2)}g > ${gs.street.toFixed(2)}g`);
ok(gs.hyper > gs.street, 'hypercar out-corners a road car',
  `${gs.hyper.toFixed(2)}g > ${gs.street.toFixed(2)}g`);
ok(gs.street > gs.stock * 0.8, 'a stock car is not a sports car', 
  `street ${gs.street.toFixed(2)}g vs stock ${gs.stock.toFixed(2)}g`);
ok(gs.formula / gs.street > 1.6, 'the split is worth having',
  `open-wheel pulls ${(gs.formula / gs.street).toFixed(2)}x a road car`);

console.log('[classes] per-car profiles follow the car database');
const demo = {
  id: 'demo-hyper', name: 'Demo Hyper', tier: 'hyper',
  performance: { power_hp: 1200, weight_kg: 1400, top_speed_kmh: 380, drivetrain: 'RWD' },
  drivetrain_detail: { gears: 7 },
};
const p = buildVehicleProfile('hyper', demo);
ok(p.massDry === 1400, 'mass taken from the car', `${p.massDry} kg`);
ok(Math.round(p.powerBase / 745.7) === 1200, 'power taken from the car',
  `${Math.round(p.powerBase / 745.7)} hp`);
ok(p.gears === 7 && p.gearTop[7] > 100, 'gear ladder reaches the car top speed',
  `${(p.gearTop[7] * 3.6).toFixed(0)} km/h in 7th`);
ok(p.classId === 'hyper' && p.carId === 'demo-hyper', 'class and car identity retained');
const fwd = buildVehicleProfile('street', {
  id: 'fwd', tier: 'base',
  performance: { power_hp: 130, weight_kg: 1100, top_speed_kmh: 195, drivetrain: 'FWD' },
});
ok(fwd.vehicle.cornerStiffness < vehicleClass('street').vehicle.cornerStiffness,
  'front-drive car carries an understeer bias');
ok(gearLadder(90, 6)[6] === 90 && gearLadder(90, 6)[1] < 30, 'gear ladder spans the range');

console.log(failures ? `vehicle-classes validator: ${failures} FAILURE(S)` : 'vehicle-classes validator: PASS');
process.exit(failures ? 1 : 0);
