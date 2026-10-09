// Gamepad wiring. The Gamepad API addresses sticks and buttons through two
// SEPARATE index spaces, and reading one out of the other's table yields
// `undefined` -> `|| 0` -> an input that is silently always neutral. That is
// exactly how analog steering was lost while the triggers kept working, so
// every index main.js uses is checked against the table it came from.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AXES, STANDARD_BUTTONS, applyDeadzone, padNames, RepeatButton, DRIVING_BINDS, MENU_BINDS }
  from '../js/controls.js';

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (cond) console.log(`  PASS  ${label}${detail ? `  ${detail}` : ''}`);
  else { failures++; console.error(`  FAIL  ${label}${detail ? `  ${detail}` : ''}`); }
};

console.log('[gamepad] index tables are disjoint and complete');
for (const [k, v] of Object.entries(STANDARD_BUTTONS)) {
  ok(Number.isInteger(v) && v >= 0 && v <= 16, `button '${k}' is a valid index`, `[${v}]`);
}
for (const [k, v] of Object.entries(AXES)) {
  ok(Number.isInteger(v) && v >= 0 && v <= 3, `axis '${k}' is a valid index`, `[${v}]`);
}
ok(Object.keys(AXES).every((k) => !(k in STANDARD_BUTTONS)),
  'no axis name also exists as a button name (that is how leftX got misread)');

console.log('[gamepad] every index main.js dereferences actually resolves');
const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const axisRefs = [...main.matchAll(/gp\.axes\[\s*([A-Za-z_]+)\.([A-Za-z0-9_]+)\s*\]/g)];
const buttonRefs = [...main.matchAll(/gp\.buttons\[\s*([A-Za-z_]+)\.([A-Za-z0-9_]+)\s*\]/g)];
ok(axisRefs.length > 0, 'main.js reads at least one stick axis', `[${axisRefs.length}]`);
ok(buttonRefs.length > 0, 'main.js reads at least one button', `[${buttonRefs.length}]`);
const TABLES = { AXES, PAD: STANDARD_BUTTONS, STANDARD_BUTTONS };
for (const [, table, key] of axisRefs) {
  ok(TABLES[table] === AXES && Number.isInteger(AXES[key]),
    `gp.axes[${table}.${key}] resolves through the AXES table`, `[${AXES[key]}]`);
}
for (const [, table, key] of buttonRefs) {
  const t = TABLES[table];
  ok(t === STANDARD_BUTTONS && Number.isInteger(t?.[key]),
    `gp.buttons[${table}.${key}] resolves through the button table`, `[${t?.[key]}]`);
}
// Nothing may read a stick out of the button table or vice versa.
for (const [raw, table, key] of axisRefs) {
  ok(!(key in STANDARD_BUTTONS), `${raw} is not secretly a button name`);
}

console.log('[gamepad] steering shaping');
ok(applyDeadzone(0.05, 0.12) === 0, 'inside the deadzone the stick is neutral');
ok(Math.abs(applyDeadzone(1, 0.12) - 1) < 1e-9, 'full lock still reaches 1.0');
ok(applyDeadzone(-0.6, 0.12) < 0 && applyDeadzone(0.6, 0.12) > 0, 'sign is preserved');
ok(Math.abs(applyDeadzone(0.6, 0.12) + applyDeadzone(-0.6, 0.12)) < 1e-9, 'response is symmetric');
// the exact curve the pre-existing inline code produced, so feel is unchanged
const legacy = (ax) => Math.sign(ax) * Math.max(0, (Math.abs(ax) - 0.12) / 0.88);
let worst = 0;
for (let a = -1; a <= 1; a += 0.01) worst = Math.max(worst, Math.abs(applyDeadzone(a, 0.12) - legacy(a)));
ok(worst < 1e-9, 'matches the original inline deadzone curve exactly', `[max delta ${worst.toExponential(1)}]`);

console.log('[gamepad] a simulated stick actually steers');
const pad = { id: 'DualSense Wireless Controller', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
const readStick = () => -applyDeadzone(pad.axes[AXES.leftX] || 0, 0.12);
pad.axes[AXES.leftX] = 0.8;
ok(Math.abs(readStick()) > 0.5, 'a stick at 0.8 produces real steering', `[${readStick().toFixed(3)}]`);
pad.axes[AXES.leftX] = 0;
ok(readStick() === 0, 'a centred stick produces none');
pad.buttons[STANDARD_BUTTONS.r2] = { pressed: true, value: 1 };
ok(pad.buttons[STANDARD_BUTTONS.r2].value === 1, 'and the throttle trigger still reads');

console.log('[gamepad] button naming');
ok(padNames('DualSense Wireless Controller').south === 'Cross', 'PlayStation pads say Cross');
ok(padNames('Xbox Wireless Controller').south === 'A',
  'Xbox pads say A even though they call themselves a "Wireless Controller"');
ok(padNames('Xbox 360 Controller (XInput STANDARD GAMEPAD)').south === 'A', 'XInput pads say A');
ok(padNames('DualSense Wireless Controller (Vendor: 054c Product: 0ce6)').south === 'Cross',
  'DualSense still says Cross');
ok(padNames('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)').south === 'Cross',
  'a bare "Wireless Controller" from Sony still says Cross');
ok(padNames('Logitech Rumblepad').south === 'Btn 1', 'anything else falls back to generic labels');
ok(DRIVING_BINDS.length >= 10 && MENU_BINDS.length >= 5, 'the overlay has both bind sets');
const rb = new RepeatButton();
ok(rb.step(true, 1 / 60) === true && rb.step(true, 1 / 60) === false, 'held buttons fire once, then repeat');

console.log(failures ? `gamepad validator: ${failures} FAILURE(S)` : 'gamepad validator: PASS');
process.exit(failures ? 1 : 0);
