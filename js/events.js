// Arcade event types. Every non-Formula race can be run as one of these; the
// rules live in RaceSession._eventTick (js/race.js) and the HUD shows the
// event's live status (js/hud.js).
//
//   race         first past the flag after the set laps
//   sprint       one lap from a flying start (the field rolling at ~80 km/h)
//   elimination  every `interval` seconds the last car is knocked out; the
//                last car standing wins
//   takedown     wreck `target` rivals before the clock runs out
//   drift        score `target` drift points before the clock runs out
export const EVENTS = Object.freeze([
  Object.freeze({ id: 'race', label: 'RACE', blurb: 'First to the flag' }),
  Object.freeze({ id: 'sprint', label: 'SPRINT', blurb: 'One flat-out lap, flying start', laps: 1, flyingStart: 22 }),
  Object.freeze({ id: 'elimination', label: 'ELIMINATION', blurb: 'Last place is out every 20 s', interval: 20, laps: 99 }),
  Object.freeze({ id: 'takedown', label: 'TAKEDOWN RUSH', blurb: 'Wreck 5 rivals in 2 minutes', target: 5, timeLimit: 120, laps: 99, unit: 'TAKEDOWNS' }),
  Object.freeze({ id: 'drift', label: 'DRIFT CHALLENGE', blurb: 'Score 3,000 drift points in 2 minutes', target: 3000, timeLimit: 120, laps: 99, unit: 'PTS' }),
]);

export function eventSpec(id) {
  return EVENTS.find((e) => e.id === id) || EVENTS[0];
}
