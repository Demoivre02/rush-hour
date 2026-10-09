// Pure steering-input shaping shared by the live game and deterministic tests.

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export const STEERING_PROFILES = Object.freeze({
  // Calm slows initial turn-in but recentres promptly. The old calm return was
  // slower than balanced, so a supposedly safer profile held lock after the
  // key was released and encouraged correction oscillation.
  calm: Object.freeze({ inputRate: 0.78, returnRate: 1.18, filter: 0.88 }),
  balanced: Object.freeze({ inputRate: 1, returnRate: 1, filter: 1 }),
  direct: Object.freeze({ inputRate: 1.22, returnRate: 1.18, filter: 1.14 }),
});

// Binary keys must not request a full Formula steering rack at 180-300 km/h.
// Low-speed authority is retained for hairpins and recovery, while the high-
// speed envelope maps a held arrow to a physically usable road-wheel angle.
export function digitalSteeringLimit(speed) {
  const velocity = Math.abs(Number.isFinite(speed) ? speed : 0);
  return clamp(1.15 - velocity * 0.0105, 0.42, 1);
}

export function steeringProfile(value) {
  return STEERING_PROFILES[value] || STEERING_PROFILES.balanced;
}

export function advanceSteeringInput(current, target, speed, dt, digital = false, profile = null) {
  const from = clamp(Number.isFinite(current) ? current : 0, -1, 1);
  const to = clamp(Number.isFinite(target) ? target : 0, -1, 1);
  // Fixed simulation ticks are normally 1/60s, but tests and recovery paths may
  // intentionally sample a full second. Preserve the established analog snap in
  // that case instead of imposing a second hidden long-frame clamp here.
  const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 1);
  const rawVelocity = Number.isFinite(speed) ? speed : 0;
  // Digital direction is symmetric in forward/reverse. Analog retains the
  // established signed-speed curve exactly (the playable reverse range is only
  // -4m/s, where the denominator remains safely positive).
  const velocity = digital ? Math.abs(rawVelocity) : rawVelocity;

  let rate;
  if (to !== 0) {
    // Keys turn in up to 40% quicker in slow corners (tight corners felt
    // sluggish); from 40 m/s up the established high-speed response is kept.
    rate = digital
      ? 6.8 / (1 + velocity * 0.01) * (1 + 0.4 * clamp((40 - velocity) / 25, 0, 1))
      : 3.4 / (1 + velocity * 0.02);
    // Binary keys need a decisive crossover through chicanes and corrections;
    // analog sticks retain their established response curve.
    if (digital && from * to < 0) rate *= 1.25;
  } else {
    rate = digital
      ? 9 / (1 + velocity * 0.006)
      : 6 / (1 + velocity * 0.01);
  }

  // Optional keyboard tuning is deliberately multiplicative so callers and
  // deterministic validators that omit it retain the established response.
  if (digital && profile) {
    const cfg = typeof profile === 'string' ? steeringProfile(profile) : profile;
    rate *= to !== 0 ? (cfg.inputRate || 1) : (cfg.returnRate || 1);
    // `filter` is a bounded final-stage response control: lower values smooth
    // noisy key taps, higher values make the same fixed-step curve more direct.
    rate *= clamp(Number.isFinite(cfg.filter) ? cfg.filter : 1, 0.65, 1.35);
  }

  const next = from + (to - from) * Math.min(1, rate * step);
  return Math.abs(next) < 1e-5 ? 0 : clamp(next, -1, 1);
}

// ---- controller mapping and on-screen legend ----------------------------
//
// The browser Gamepad API reports DualSense/DualShock and Xbox pads in the
// "standard" layout, so one index table covers both; only the button NAMES
// differ. We detect the pad family from its id string and label the overlay
// accordingly, because telling a PlayStation player to "press A" is useless.

export const STANDARD_BUTTONS = Object.freeze({
  south: 0, east: 1, west: 2, north: 3,
  l1: 4, r1: 5, l2: 6, r2: 7,
  select: 8, start: 9, l3: 10, r3: 11,
  dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
  home: 16,
});

export const AXES = Object.freeze({ leftX: 0, leftY: 1, rightX: 2, rightY: 3 });

const PLAYSTATION = Object.freeze({
  family: 'playstation',
  south: 'Cross', east: 'Circle', west: 'Square', north: 'Triangle',
  l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', l3: 'L3', r3: 'R3',
  select: 'Create', start: 'Options',
});
const XBOX = Object.freeze({
  family: 'xbox',
  south: 'A', east: 'B', west: 'X', north: 'Y',
  l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT', l3: 'LS', r3: 'RS',
  select: 'View', start: 'Menu',
});
const GENERIC = Object.freeze({
  family: 'generic',
  south: 'Btn 1', east: 'Btn 2', west: 'Btn 3', north: 'Btn 4',
  l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', l3: 'L3', r3: 'R3',
  select: 'Select', start: 'Start',
});

// DualSense reports 054c:0ce6, DualShock 4 054c:09cc / 05c4; Chrome also spells
// out the product name on some platforms.
const PS_PATTERN = /dualsense|dualshock|playstation|wireless controller|054c/i;
const XBOX_PATTERN = /xbox|xinput|045e/i;

export function padNames(padId = '') {
  const id = String(padId);
  // Xbox first: Xbox pads also call themselves a "Wireless Controller".
  if (XBOX_PATTERN.test(id)) return XBOX;
  if (PS_PATTERN.test(id)) return PLAYSTATION;
  return GENERIC;
}

// What each control does while driving. `key` is the equivalent keyboard bind,
// shown alongside so the overlay teaches both at once.
export const DRIVING_BINDS = Object.freeze([
  Object.freeze({ control: 'Left stick', names: null, action: 'Steer', key: '← →' }),
  Object.freeze({ control: 'r2', action: 'Throttle', key: '↑' }),
  Object.freeze({ control: 'l2', action: 'Brake / reverse · tap while steering to drift', key: '↓' }),
  Object.freeze({ control: 'r1', action: 'Shift up', key: 'E' }),
  Object.freeze({ control: 'l1', action: 'Shift down', key: 'Q' }),
  Object.freeze({ control: 'south', action: 'Nitro (hold) · override in Formula', key: 'Space' }),
  Object.freeze({ control: 'north', action: 'Change camera', key: 'C' }),
  Object.freeze({ control: 'west', action: 'ERS mode', key: 'V' }),
  Object.freeze({ control: 'east', action: 'Box this lap', key: 'P' }),
  Object.freeze({ control: 'dpadUp', action: 'Dash page', key: 'B' }),
  Object.freeze({ control: 'dpadDown', action: 'Toggle mirrors', key: 'R' }),
  Object.freeze({ control: 'select', action: 'This controls list', key: 'H' }),
  Object.freeze({ control: 'start', action: 'Pause', key: 'Esc' }),
]);

// Menu navigation. Without this a pad can drive but cannot start a race.
export const MENU_BINDS = Object.freeze([
  Object.freeze({ control: 'D-pad / left stick', names: null, action: 'Move selection', key: '↑ ↓ ← →' }),
  Object.freeze({ control: 'south', action: 'Confirm', key: 'Enter' }),
  Object.freeze({ control: 'east', action: 'Back', key: 'Esc' }),
  Object.freeze({ control: 'l1', action: 'Previous tab', key: '[' }),
  Object.freeze({ control: 'r1', action: 'Next tab', key: ']' }),
  Object.freeze({ control: 'start', action: 'Start session', key: 'Enter' }),
]);

export function labelFor(bind, names) {
  if (bind.names === null) return bind.control;
  return names[bind.control] || bind.control;
}

/** Rows ready to render: [{ control, action, key }] with pad-correct names. */
export function bindRows(binds, padId) {
  const names = padNames(padId);
  return binds.map((b) => ({
    control: labelFor(b, names),
    action: b.action,
    key: b.key,
  }));
}

// ---- edge/deadzone helpers shared by the live input loop -------------------
export function applyDeadzone(value, deadzone = 0.12) {
  const v = Number.isFinite(value) ? value : 0;
  const m = Math.abs(v);
  if (m <= deadzone) return 0;
  return Math.sign(v) * ((m - deadzone) / (1 - deadzone));
}

/** Rising-edge tracker for menu repeat: first press fires, then it repeats. */
export class RepeatButton {
  constructor(delay = 0.42, rate = 0.11) {
    this.delay = delay; this.rate = rate; this.held = 0; this.fired = false;
  }
  step(pressed, dt) {
    if (!pressed) { this.held = 0; this.fired = false; return false; }
    const was = this.held;
    this.held += dt;
    if (!this.fired) { this.fired = true; return true; }
    if (was < this.delay && this.held >= this.delay) return true;
    if (this.held >= this.delay) {
      return Math.floor((was - this.delay) / this.rate) !==
        Math.floor((this.held - this.delay) / this.rate);
    }
    return false;
  }
}
