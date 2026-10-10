// Civilian traffic for arcade races on the city venues (Asphalt style): slow
// cars cruising the circuit in two lanes. Racers who hit one knock it flying
// and lose speed; a hit under nitro barely slows you and tops the tank up.
//
// This module is the simulation only (positions, hits, respawns), so it runs
// headless in the validators. js/main.js gives each car a body from the race's
// already-loaded car models and draws it at the interpolated pose.

const CAR_RADIUS = 1.3;          // two of these apart = contact
const KNOCK_S = 2.4;             // a struck car tumbles away for this long
const SPAWN_CLEAR_M = 250;       // never (re)appear this close to a racer

export class Traffic {
  /**
   * @param circuit the built circuit (samples, N, ds, length, halfWidth, heightAt)
   * @param opts.count number of cars; opts.random a 0..1 generator
   */
  constructor(circuit, { count = 10, random = Math.random } = {}) {
    this.circuit = circuit;
    this.random = random;
    this.cars = [];
    const lane = Math.min(2.6, circuit.halfWidth * 0.42);
    // spread around the lap, clear of the grid (the first 300 m and the last 150)
    const span = circuit.length - 450;
    for (let k = 0; k < count; k++) {
      const s = 300 + span * ((k + 0.5) / count) + (random() - 0.5) * 60;
      const car = {
        id: k,
        s,
        lane: (random() < 0.5 ? -1 : 1) * lane,
        v: 13 + random() * 6,           // 47-68 km/h
        hit: 0, kx: 0, kz: 0, spin: 0, spinRate: 0,
        x: 0, y: 0, z: 0, heading: 0,
        px: 0, py: 0, pz: 0, pheading: 0,
      };
      // What the AI drivers see (the fields js/ai.js reads from another car),
      // so they overtake traffic, or queue behind it, like any slower car.
      car.proxy = { isTraffic: true, pos: { x: 0, z: 0 }, sampleIdx: 0, lat: car.lane, v: car.v, disabled: false };
      this._place(car);
      this._snapPrev(car);
      this.cars.push(car);
    }
  }

  _sample(s) {
    const c = this.circuit;
    const f = (((s / c.ds) % c.N) + c.N) % c.N;
    const i = Math.floor(f);
    return { a: c.samples[i], b: c.samples[(i + 1) % c.N], u: f - i, i: f };
  }

  _place(car) {
    const { a, b, u, i } = this._sample(car.s);
    const px = a.p.x + (b.p.x - a.p.x) * u, pz = a.p.z + (b.p.z - a.p.z) * u;
    car.x = px + a.n.x * car.lane;
    car.z = pz + a.n.z * car.lane;
    car.y = this.circuit.heightAt?.(i) ?? 0;
    car.heading = Math.atan2(a.t.x + (b.t.x - a.t.x) * u, a.t.z + (b.t.z - a.t.z) * u);
    if (car.proxy) {
      car.proxy.pos.x = car.x;
      car.proxy.pos.z = car.z;
      car.proxy.sampleIdx = Math.floor(i) % this.circuit.N;
      car.proxy.lat = car.lane;
      car.proxy.v = car.v;
      car.proxy.disabled = car.hit > 0;
    }
  }

  /** The AI-visible stand-ins for the cars still on the road. */
  proxies() {
    return this.cars.filter((c) => c.hit <= 0).map((c) => c.proxy);
  }

  _snapPrev(car) {
    car.px = car.x; car.py = car.y; car.pz = car.z; car.pheading = car.heading + car.spin;
  }

  /** Respawn a struck car on the far side of the lap from every racer. */
  _respawn(car, entries) {
    const c = this.circuit;
    const racers = entries.filter((e) => !e.dnf).map((e) => e.phys.sampleIdx * c.ds);
    for (let tries = 0; tries < 12; tries++) {
      const s = this.random() * c.length;
      const near = racers.some((r) => {
        const d = Math.abs(r - s);
        return Math.min(d, c.length - d) < SPAWN_CLEAR_M;
      });
      if (!near || tries === 11) {
        car.s = s;
        break;
      }
    }
    car.hit = 0; car.spin = 0; car.spinRate = 0;
    this._place(car);
    this._snapPrev(car);
    car.respawned = true;
  }

  /**
   * Advance one tick and resolve contact with the racers. Returns the hits
   * this tick as [{ entry, car, boosting }].
   */
  update(dt, entries) {
    const hits = [];
    for (const car of this.cars) {
      this._snapPrev(car);
      car.respawned = false;
      if (car.hit > 0) {
        // tumbling away from the impact
        car.x += car.kx * dt;
        car.z += car.kz * dt;
        const drag = Math.max(0, 1 - dt * 1.6);
        car.kx *= drag; car.kz *= drag;
        car.spin += car.spinRate * dt;
        car.spinRate *= drag;
        car.hit -= dt;
        if (car.hit <= 0) this._respawn(car, entries);
        continue;
      }
      car.s = (car.s + car.v * dt) % this.circuit.length;
      this._place(car);
      for (const e of entries) {
        const p = e.phys;
        if (e.dnf || e.pitState || p.disabled) continue;
        const dx = p.pos.x - car.x, dz = p.pos.z - car.z;
        if (dx * dx + dz * dz > (CAR_RADIUS * 2) ** 2) continue;
        // only a car catching it up hits it (they all drive the same way)
        if (p.v < car.v + 1) continue;
        const boosting = !!p.boosting;
        const hx = Math.sin(p.heading), hz = Math.cos(p.heading);
        const side = this.random() < 0.5 ? -1 : 1;
        car.hit = KNOCK_S;
        car.proxy.disabled = true;
        car.kx = hx * p.v * 0.85 + hz * side * 5;
        car.kz = hz * p.v * 0.85 - hx * side * 5;
        car.spinRate = side * (3 + this.random() * 4);
        p.v *= boosting ? 0.92 : e.isPlayer ? 0.7 : 0.85;
        p.impactKick = Math.max(p.impactKick || 0, boosting ? 0.25 : 0.6);
        hits.push({ entry: e, car, boosting });
        break;
      }
    }
    return hits;
  }
}
