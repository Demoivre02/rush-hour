// Allocation-light 2D contact helpers shared by race collisions and validators.

export const CAR_HALF_LENGTH = 2.48;
export const CAR_HALF_WIDTH = 0.99;
export const CAR_BROADPHASE_RADIUS_SQ = Math.pow(2 * Math.hypot(CAR_HALF_LENGTH, CAR_HALF_WIDTH), 2);

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

function halfLengthOf(phys) {
  return clamp(finite(phys?.contactHalfLength, phys?.profile?.contactHalfLength ?? CAR_HALF_LENGTH), 1.35, 3.6);
}

function halfWidthOf(phys) {
  return clamp(finite(phys?.contactHalfWidth, phys?.profile?.contactHalfWidth ?? CAR_HALF_WIDTH), 0.55, 1.35);
}

export function syncContactBody(out, phys) {
  const heading = phys.heading;
  out.phys = phys;
  out.x = phys.pos.x;
  out.z = phys.pos.z;
  out.fx = Math.sin(heading);
  out.fz = Math.cos(heading);
  out.rx = Math.cos(heading);
  out.rz = -Math.sin(heading);
  out.halfLength = halfLengthOf(phys);
  out.halfWidth = halfWidthOf(phys);
  out.radius = Math.hypot(out.halfLength, out.halfWidth);
  out.invMass = 1 / Math.max(1, phys.mass || 830);
  return out;
}

function projectionRadius(body, ax, az) {
  return body.halfWidth * Math.abs(ax * body.rx + az * body.rz) +
    body.halfLength * Math.abs(ax * body.fx + az * body.fz);
}

// SAT for two oriented car footprints. Returned normal points from B to A.
export function orientedCarContact(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const broadphase = (a.radius || Math.hypot(CAR_HALF_LENGTH, CAR_HALF_WIDTH)) +
    (b.radius || Math.hypot(CAR_HALF_LENGTH, CAR_HALF_WIDTH));
  if (dx * dx + dz * dz > broadphase * broadphase) return null;

  let bestOverlap = Infinity;
  let bestX = 0;
  let bestZ = 0;
  const consider = (axisX, axisZ) => {
    const center = dx * axisX + dz * axisZ;
    const overlap = projectionRadius(a, axisX, axisZ) +
      projectionRadius(b, axisX, axisZ) - Math.abs(center);
    if (overlap <= 0) return false;
    if (overlap < bestOverlap) {
      const direction = center < 0 ? -1 : 1;
      bestOverlap = overlap;
      bestX = axisX * direction;
      bestZ = axisZ * direction;
    }
    return true;
  };

  if (!consider(a.rx, a.rz) || !consider(a.fx, a.fz) ||
      !consider(b.rx, b.rz) || !consider(b.fx, b.fz)) return null;

  // Exact center overlap has no signed projection. Pick a deterministic axis so
  // the solver never emits NaN or depends on object iteration order.
  if (!Number.isFinite(bestOverlap)) return null;
  return { nx: bestX, nz: bestZ, penetration: bestOverlap };
}

export function velocityOf(body, out) {
  const lateral = Number.isFinite(body.phys.vehicle?.velocityLat)
    ? body.phys.vehicle.velocityLat
    : (Number.isFinite(body.phys.velocityLat) ? body.phys.velocityLat : 0);
  out.x = body.fx * body.phys.v + body.rx * lateral;
  out.z = body.fz * body.phys.v + body.rz * lateral;
  return out;
}

export function applyContactVelocity(phys, vx, vz, maxHeadingChange = 0.1) {
  const sin = Math.sin(phys.heading), cos = Math.cos(phys.heading);
  const oldLong = phys.v;
  const oldLat = Number.isFinite(phys.vehicle?.velocityLat)
    ? phys.vehicle.velocityLat
    : (Number.isFinite(phys.velocityLat) ? phys.velocityLat : 0);
  // RaceSession passes `heading * v + collisionDelta` for compatibility with
  // the former scalar model. Reapply that delta to the full pre-impact world
  // velocity so an existing drift angle survives the impulse.
  const deltaX = vx - sin * oldLong;
  const deltaZ = vz - cos * oldLong;
  const nextX = sin * oldLong + cos * oldLat + deltaX;
  const nextZ = cos * oldLong - sin * oldLat + deltaZ;
  if (!(Math.hypot(nextX, nextZ) > 1e-8)) {
    if (phys.vehicle) {
      phys.vehicle.velocityLong = 0;
      phys.vehicle.velocityLat = 0;
      phys.vehicle.sideslip = 0;
    } else {
      phys.v = 0;
    }
    phys.velocityLat = 0;
    phys.sideslip = 0;
    return;
  }
  const nextLong = nextX * sin + nextZ * cos;
  const nextLat = nextX * cos - nextZ * sin;
  if (phys.vehicle) {
    phys.vehicle.velocityLong = nextLong;
    phys.vehicle.velocityLat = nextLat;
    phys.vehicle.sideslip = Math.atan2(nextLat, Math.max(0.5, Math.abs(nextLong)));
  } else {
    phys.v = nextLong;
  }
  phys.velocityLat = nextLat;
  phys.sideslip = Math.atan2(nextLat, Math.max(0.5, Math.abs(nextLong)));
}

// Lever arm from this car's centre of mass to the estimated contact point,
// in world space. SAT gives a separating axis rather than a point, so the
// midpoint of the two centres is used and then clamped into this car's own
// footprint — that keeps the moment arm physically bounded no matter how deep
// the overlap gets, which matters in a multi-car pile-up.
export function contactLeverArm(body, otherX, otherZ, out) {
  const midX = (otherX - body.x) * 0.5;
  const midZ = (otherZ - body.z) * 0.5;
  const long = clamp(midX * body.fx + midZ * body.fz, -body.halfLength, body.halfLength);
  const lat = clamp(midX * body.rx + midZ * body.rz, -body.halfWidth, body.halfWidth);
  out.x = body.fx * long + body.rx * lat;
  out.z = body.fz * long + body.rz * lat;
  return out;
}

// Scalar yaw impulse (N.m.s) from a world-space linear impulse applied at a
// world-space lever arm. Sign convention matches stepVehicleDynamics:
// yaw = longitudinalOffset * lateralForce - lateralOffset * longitudinalForce.
export function contactYawImpulse(body, leverX, leverZ, impulseX, impulseZ) {
  const leverLong = leverX * body.fx + leverZ * body.fz;
  const leverLat = leverX * body.rx + leverZ * body.rz;
  const impulseLong = impulseX * body.fx + impulseZ * body.fz;
  const impulseLat = impulseX * body.rx + impulseZ * body.rz;
  return leverLong * impulseLat - leverLat * impulseLong;
}

// Nose-to-tail and door-to-door contact must be able to rotate a car, not just
// shove it sideways. The change is clamped so a deep overlap in a pile-up can
// never launch a car into an unrecoverable spin.
export const MAX_CONTACT_YAW_DELTA = 0.26;

export function applyContactYaw(phys, yawImpulse, maxDelta = MAX_CONTACT_YAW_DELTA) {
  if (!Number.isFinite(yawImpulse) || yawImpulse === 0) return 0;
  const inertia = Math.max(200,
    phys.vehicle?.config?.yawInertia ?? phys.yawInertia ?? 1080);
  const delta = clamp(yawImpulse / inertia, -maxDelta, maxDelta);
  if (phys.vehicle) {
    phys.vehicle.yawRate = clamp(phys.vehicle.yawRate + delta, -3.2, 3.2);
  }
  phys.yawRate = clamp((Number.isFinite(phys.yawRate) ? phys.yawRate : 0) + delta, -3.2, 3.2);
  return delta;
}

export function contactSideFor(body, nx, nz, bodyIsA) {
  // `normal` points B -> A. Convert the other car's direction into the local
  // right-axis convention: -1 left, +1 right.
  const towardOtherX = bodyIsA ? -nx : nx;
  const towardOtherZ = bodyIsA ? -nz : nz;
  return clamp(towardOtherX * body.rx + towardOtherZ * body.rz, -1, 1);
}

// +1 means the other body is at this car's nose, -1 at its tail. Keeping this
// separate from the lateral side lets race damage distinguish a front-wing hit
// from a sidepod rub or a car being struck from behind.
export function contactLongitudinalFor(body, nx, nz, bodyIsA) {
  const towardOtherX = bodyIsA ? -nx : nx;
  const towardOtherZ = bodyIsA ? -nz : nz;
  return clamp(towardOtherX * body.fx + towardOtherZ * body.fz, -1, 1);
}
