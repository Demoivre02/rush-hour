// Deterministic chase-camera composition. Keeping the photographic intent in a
// dependency-free module lets verification inspect it without booting WebGL.
export const CAMERA_FRAMING = Object.freeze({
  // The nose is foreshortened from a chase view, so its visible longitudinal
  // silhouette is shorter than the car's regulation length.
  representativeProjectedLengthM: 3.4,
  representativeCarHeightM: 0.9,
  normalSpeedSamplesMps: Object.freeze([45, 65, 85]),
  targetViewportHeight: Object.freeze([0.15, 0.20]),
  speedEffectCapMps: 90,
  boostFovDegrees: 6,   // the speed rush while nitro / override is firing
  lookHeightM: 0.75,
  // Keep the chase camera attached primarily to the car. Looking mostly down
  // the future racing line made the chassis slide sideways in frame before it
  // actually rotated, exaggerating even modest physical sideslip.
  // The chase view aims straight down the car's heading: any share of the track
  // direction pulls the car off-centre whenever it is angled to the road.
  headingAimWeight: 1,
  aheadAimWeight: 0,
});

// `pull`, `rise`, and `fovSpeed` are deliberately restrained: the car should
// remain the visual anchor as speed builds instead of shrinking into the road.
export const CAMERA_PROFILES = Object.freeze({
  tight: Object.freeze({
    back: 7.55, pull: 0.0038, height: 1.85, rise: 0.0014,
    look: 8.8, fov: 61.5, fovSpeed: 0.013,
  }),
  broadcast: Object.freeze({
    back: 8.25, pull: 0.003, height: 2.05, rise: 0.0015,
    look: 10.5, fov: 62, fovSpeed: 0.012,
  }),
  cinematic: Object.freeze({
    back: 9.1, pull: 0.0025, height: 2.28, rise: 0.0016,
    look: 12, fov: 63.5, fovSpeed: 0.012,
  }),
});

// Chase distance variants. `normal` sits about 6 m behind the car with a
// narrower lens than the open-wheel default, so a road car fills the lower
// middle of the frame; `near` is closer still, over the rear deck, for placing
// the car on kerbs and apexes; `far` pulls back and up for traffic awareness.
export const CHASE_VARIANTS = Object.freeze({
  near: Object.freeze({
    backScale: 0.62, heightScale: 0.80, lookScale: 0.85, fovBias: -6,
  }),
  normal: Object.freeze({
    backScale: 0.74, heightScale: 0.86, lookScale: 0.90, fovBias: -5,
  }),
  far: Object.freeze({
    backScale: 1.55, heightScale: 1.35, lookScale: 1.18, fovBias: 1.5,
  }),
});

export function chaseVariant(name) {
  return CHASE_VARIANTS[name] || CHASE_VARIANTS.normal;
}

export function resolveChaseCamera(
  profileName, speedMps, boosting = false, output = {}, variantName = 'normal',
) {
  const profile = CAMERA_PROFILES[profileName] || CAMERA_PROFILES.broadcast;
  const variant = chaseVariant(variantName);
  const finiteSpeed = Number.isFinite(speedMps) ? speedMps : 0;
  const framingSpeed = Math.min(CAMERA_FRAMING.speedEffectCapMps, Math.max(0, finiteSpeed));
  output.back = (profile.back + framingSpeed * profile.pull) * variant.backScale;
  output.height = (profile.height + framingSpeed * profile.rise) * variant.heightScale;
  output.look = profile.look * variant.lookScale;
  output.fov = profile.fov + framingSpeed * profile.fovSpeed +
    (boosting ? CAMERA_FRAMING.boostFovDegrees : 0) + variant.fovBias;
  return output;
}

// A stable composition proxy: the fraction of viewport height occupied by the
// visible car silhouette after chase-view foreshortening. It intentionally
// omits suspension animation and track pitch so regressions are deterministic.
export function estimateCarViewportHeight(profileName, speedMps, variantName = 'normal') {
  const framing = resolveChaseCamera(profileName, speedMps, false, {}, variantName);
  const halfVerticalFov = framing.fov * Math.PI / 360;
  const aimY = CAMERA_FRAMING.lookHeightM - framing.height;
  const aimZ = framing.look + framing.back;
  const aimLength = Math.hypot(aimY, aimZ);
  const forwardY = aimY / aimLength;
  const forwardZ = aimZ / aimLength;
  const upY = forwardZ;
  const upZ = -forwardY;
  const projectedY = [];
  const halfLength = CAMERA_FRAMING.representativeProjectedLengthM / 2;
  for (const y of [0, CAMERA_FRAMING.representativeCarHeightM]) {
    for (const z of [-halfLength, halfLength]) {
      const relativeY = y - framing.height;
      const relativeZ = z + framing.back;
      const depth = relativeY * forwardY + relativeZ * forwardZ;
      const viewY = relativeY * upY + relativeZ * upZ;
      projectedY.push((viewY / depth) / Math.tan(halfVerticalFov));
    }
  }
  return (Math.max(...projectedY) - Math.min(...projectedY)) / 2;
}

// Every chase mode must still keep the car a readable size in frame. These are
// asserted by tools/validate-camera-modes.mjs.
export const CHASE_VARIANT_METRICS = Object.freeze(Object.fromEntries(
  Object.keys(CHASE_VARIANTS).map((variantName) => [variantName, Object.freeze({
    projectedCarViewportHeight: Object.freeze(CAMERA_FRAMING.normalSpeedSamplesMps.map((speed) =>
      Number(estimateCarViewportHeight('broadcast', speed, variantName).toFixed(4)))),
    distanceM: Object.freeze(CAMERA_FRAMING.normalSpeedSamplesMps.map((speed) =>
      Number(resolveChaseCamera('broadcast', speed, false, {}, variantName).back.toFixed(3)))),
  })]),
));

export const CAMERA_FRAMING_METRICS = Object.freeze(Object.fromEntries(
  Object.keys(CAMERA_PROFILES).map((profileName) => [profileName, Object.freeze({
    projectedCarViewportHeight: Object.freeze(CAMERA_FRAMING.normalSpeedSamplesMps.map((speed) =>
      Number(estimateCarViewportHeight(profileName, speed).toFixed(4)))),
    distanceM: Object.freeze(CAMERA_FRAMING.normalSpeedSamplesMps.map((speed) =>
      Number(resolveChaseCamera(profileName, speed).back.toFixed(3)))),
    fovDegrees: Object.freeze(CAMERA_FRAMING.normalSpeedSamplesMps.map((speed) =>
      Number(resolveChaseCamera(profileName, speed).fov.toFixed(3)))),
  })]),
));

// The camera cycle, kept declarative so the render loop branches on an intent
// ('chase' framing vs a fixed on-car mount) instead of a magic index, and so
// validators can assert the ordering without booting WebGL.
//
// `variant` selects a chase distance from CHASE_VARIANTS in cameraFraming.js.
// `stiffness` is the camera follow rate: chase views trail the car for a sense
// of mass, on-car mounts are rigidly attached.
export const CAMERA_MODES = Object.freeze([
  // `stiffness` is no longer used for placement: main.js puts every camera
  // exactly on its target and the chase views turn with a smoothed heading.
  Object.freeze({ id: 'chase-near', label: 'CHASE NEAR', kind: 'chase', variant: 'near', stiffness: 14 }),
  Object.freeze({ id: 'chase', label: 'CHASE', kind: 'chase', variant: 'normal', stiffness: 12 }),
  Object.freeze({ id: 'chase-far', label: 'CHASE FAR', kind: 'chase', variant: 'far', stiffness: 4.2 }),
  Object.freeze({ id: 'cockpit', label: 'COCKPIT', kind: 'cockpit', stiffness: 22 }),
  Object.freeze({ id: 't-cam', label: 'T-CAM', kind: 't-cam', stiffness: 16 }),
  Object.freeze({ id: 'nose', label: 'NOSE', kind: 'nose', stiffness: 18 }),
]);

export const CAM_CHASE_NEAR = 0;
export const CAM_CHASE = 1;
export const CAM_CHASE_FAR = 2;
export const CAM_COCKPIT = 3;
export const CAM_TCAM = 4;
export const CAM_NOSE = 5;

export function cameraModeSpec(index) {
  return CAMERA_MODES[index] || CAMERA_MODES[CAM_CHASE];
}

export function cameraModeIndex(id) {
  const found = CAMERA_MODES.findIndex((mode) => mode.id === id);
  return found < 0 ? CAM_CHASE : found;
}
