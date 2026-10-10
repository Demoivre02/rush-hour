// Racing disciplines. Each one binds a vehicle class (js/vehicleClasses.js) to
// a set of venues, a car source and a session format, so the same simulation
// core can run an open-wheel championship, a street race, an oval pack race or
// a lap of a 20 km forest circuit without special-casing the physics.
//
// `formula` is the original game and is deliberately unchanged: same class,
// same 24-round calendar, same session structure.
import { CAR_ROSTER } from './carRoster.js';
import { modelRoster } from './modelCars.js';
import { vehicleClass } from './vehicleClasses.js';

const STREET_CIRCUITS = ['monaco', 'singapore', 'baku', 'jeddah', 'lasvegas', 'miami', 'melbourne',
  'tokyo', 'rio'];
const DIRT_TRACKS = ['kalahari', 'highland', 'canyon'];
const PERMANENT_CIRCUITS = ['spa', 'silverstone', 'suzuka', 'monza', 'barcelona', 'austin',
  'interlagos', 'zandvoort', 'spielberg', 'hungaroring'];
const CHAMPIONSHIP_CALENDAR = ['melbourne', 'shanghai', 'suzuka', 'bahrain', 'jeddah', 'miami',
  'montreal', 'monaco', 'barcelona', 'spielberg', 'silverstone', 'spa', 'hungaroring',
  'zandvoort', 'monza', 'madrid', 'baku', 'singapore', 'austin', 'mexico', 'interlagos',
  'lasvegas', 'lusail', 'yasmarina'];

// Every discipline except Formula races to arcade rules (js/race.js `arcade`):
// straight to the grid, 3-2-1-GO, no fuel, tyre wear or pit stops.
export const DISCIPLINES = Object.freeze({
  formula: Object.freeze({
    id: 'formula',
    label: 'Formula',
    tagline: 'Open-wheel championship',
    blurb: 'The 2026 regulations: active aero, 350 kW manual override and four times ' +
      'the downforce of anything else here. Nothing on this list corners like it.',
    vehicleClass: 'formula',
    carSource: 'teams',            // grid comes from data.js TEAMS/DRIVERS
    tracks: Object.freeze(CHAMPIONSHIP_CALENDAR),
    gridSize: 20,
    laps: Object.freeze({ short: 5, normal: 12, long: 24 }),
    format: Object.freeze({ qualifying: true, pitStops: true, championship: true, damage: true }),
    features: Object.freeze({ ers: true, override: true, activeAero: true, slipstream: true }),
    compounds: Object.freeze(['S', 'M', 'H', 'I', 'W']),
  }),

  street: Object.freeze({
    id: 'street',
    label: 'Street',
    tagline: 'Road cars, city circuits',
    blurb: 'Hatchbacks, tuner icons and muscle cars on closed public roads. ' +
      'No downforce, real body roll, and walls where the run-off should be.',
    vehicleClass: 'street',
    carSource: 'roster',
    carFilter: Object.freeze(['base', 'tuned']),
    tracks: Object.freeze(STREET_CIRCUITS),
    gridSize: 12,
    laps: Object.freeze({ short: 3, normal: 6, long: 12 }),
    format: Object.freeze({ qualifying: false, pitStops: false, championship: true, damage: true }),
    features: Object.freeze({ ers: false, override: true, activeAero: false, slipstream: true }),
    compounds: Object.freeze(['S', 'M', 'H']),
  }),

  rally: Object.freeze({
    id: 'rally',
    label: 'Dirt & Offroad',
    tagline: 'Gravel stages and open desert',
    blurb: 'Loose dirt, dust and jumps in the terrain. Grip is two-thirds of tarmac, ' +
      'so brake early, get it sideways and steer with the throttle.',
    vehicleClass: 'street',
    carSource: 'roster',
    carFilter: Object.freeze(['base', 'tuned', 'super']),
    tracks: Object.freeze(DIRT_TRACKS),
    gridSize: 10,
    laps: Object.freeze({ short: 2, normal: 4, long: 8 }),
    format: Object.freeze({ qualifying: false, pitStops: false, championship: true, damage: true }),
    features: Object.freeze({ ers: false, override: true, activeAero: false, slipstream: false }),
    compounds: Object.freeze(['S', 'M', 'H']),
  }),

  hypercar: Object.freeze({
    id: 'hypercar',
    label: 'Hypercar',
    tagline: 'Supercars and hypercars',
    blurb: 'Everything from a 640 hp V10 to a 2,000 hp quad-motor EV, on the fastest ' +
      'circuits on the calendar. Power arrives faster than grip does.',
    vehicleClass: 'hyper',
    carSource: 'roster',
    carFilter: Object.freeze(['super', 'hyper']),
    tracks: Object.freeze(PERMANENT_CIRCUITS),
    gridSize: 12,
    laps: Object.freeze({ short: 3, normal: 8, long: 16 }),
    format: Object.freeze({ qualifying: false, pitStops: false, championship: true, damage: true }),
    features: Object.freeze({ ers: false, override: true, activeAero: true, slipstream: true }),
    compounds: Object.freeze(['S', 'M', 'H']),
  }),

  stock: Object.freeze({
    id: 'stock',
    label: 'Stock Car',
    tagline: 'Oval pack racing',
    blurb: 'Fifteen hundred kilos, almost no downforce and a wall on your right. ' +
      'The draft is worth more than the horsepower.',
    vehicleClass: 'stock',
    carSource: 'class',
    tracks: Object.freeze(['thunderdome']),
    gridSize: 18,
    laps: Object.freeze({ short: 10, normal: 30, long: 60 }),
    format: Object.freeze({ qualifying: false, pitStops: false, championship: true, damage: true }),
    // Oval racing lives and dies on the tow: a much stronger slipstream than
    // the road disciplines, which is what creates the pack.
    features: Object.freeze({ ers: false, override: false, activeAero: false,
      slipstream: true, slipstreamGain: 1.8 }),
    compounds: Object.freeze(['M', 'H']),
  }),

  gt: Object.freeze({
    id: 'gt',
    label: 'GT Racing',
    tagline: 'Closed-wheel endurance',
    blurb: 'Purpose-built GT machinery: real aero, real brakes, and a pit stop that ' +
      'decides the race.',
    vehicleClass: 'gt3',
    carSource: 'class',
    tracks: Object.freeze(PERMANENT_CIRCUITS),
    gridSize: 16,
    laps: Object.freeze({ short: 6, normal: 18, long: 40 }),
    format: Object.freeze({ qualifying: false, pitStops: false, championship: true, damage: true }),
    features: Object.freeze({ ers: false, override: true, activeAero: false, slipstream: true }),
    compounds: Object.freeze(['S', 'M', 'H', 'I', 'W']),
  }),

  nordschleife: Object.freeze({
    id: 'nordschleife',
    label: 'Nordschleife',
    tagline: 'Eifelring time attack',
    blurb: 'Seven and a half kilometres of Eifel forest, blind crests and no run-off - ' +
      'the longest lap in the game. ' +
      'One lap, no grid, nobody to blame.',
    vehicleClass: 'hyper',
    carSource: 'roster',
    carFilter: Object.freeze(['tuned', 'super', 'hyper']),
    tracks: Object.freeze(['eifelring']),
    gridSize: 1,
    laps: Object.freeze({ short: 1, normal: 1, long: 2 }),
    format: Object.freeze({ qualifying: false, pitStops: false, championship: false,
      damage: true, timeAttack: true }),
    features: Object.freeze({ ers: false, override: true, activeAero: false, slipstream: false }),
    compounds: Object.freeze(['S', 'M', 'H']),
  }),
});

export const DISCIPLINE_ORDER = Object.freeze(
  ['formula', 'street', 'rally', 'hypercar', 'gt', 'stock', 'nordschleife']);

export const DEFAULT_DISCIPLINE = 'formula';

export function discipline(id) {
  return DISCIPLINES[id] || DISCIPLINES[DEFAULT_DISCIPLINE];
}

// The cars a discipline can field. `teams` defers to the championship entry
// list in data.js; `class` means the grid is spec machinery with no roster.
// Roster disciplines field only the detailed car models (js/modelCars.js):
// one car per model whose body type the discipline's tiers include.
export function carsForDiscipline(id) {
  const d = discipline(id);
  if (d.carSource === 'class') return modelRoster([classBaseCar(d)], { race: d.vehicleClass !== 'stock' });
  if (d.carSource !== 'roster') return [];
  const tiers = d.carFilter || [];
  return modelRoster(CAR_ROSTER.filter((car) => tiers.includes(car.tier)));
}

// Spec-class disciplines (GT, stock) have no roster; their selectable cars are
// the matching models, each standing on this class template for the parts a
// model does not specify (sound, colours).
function classBaseCar(d) {
  const profile = vehicleClass(d.vehicleClass);
  const stock = d.vehicleClass === 'stock';
  return {
    id: `class-${d.id}`,
    tier: 'super',
    vehicleClass: d.vehicleClass,
    body: stock ? 'muscle' : 'gt',
    colour: '#c8ccd2',
    accent: '#20242a',
    engine: stock ? 'V8' : 'GT V8',
    soundFamily: profile.soundFamily,
    idleRpm: profile.idleRpm,
    redlineRpm: profile.redlineRpm,
    performance: { drivetrain: 'RWD' },
    drivetrain_detail: { gears: profile.gears },
  };
}

export function tracksForDiscipline(id) {
  return discipline(id).tracks;
}

export function disciplineForTrack(trackId) {
  for (const key of DISCIPLINE_ORDER) {
    if (DISCIPLINES[key].tracks.includes(trackId)) return DISCIPLINES[key];
  }
  return DISCIPLINES[DEFAULT_DISCIPLINE];
}
