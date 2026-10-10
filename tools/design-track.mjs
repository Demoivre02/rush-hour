#!/usr/bin/env node
// Design a closed circuit outline for js/tracks.js from a few parameters.
//
// The outline is a "star-shaped" polar curve, r(θ) = 1 + Σ a·cos(kθ + φ),
// which can never cross itself while r > 0, then stretched (aspect), rotated,
// scaled so the lap is `lengthM`, and resampled to control points every
// ~`stepM` metres. Prints the points and the tightest corner radius.
//
//   node tools/design-track.mjs <name>      (presets below)
const PRESETS = {
  // targetR: the tightest corner wanted (m); the waves are scaled up until the
  // lap reaches it, so street layouts get hairpins and dirt ones fast sweepers
  // street circuits run round city blocks: straights and right-angle corners
  // (`grid`: corner points in block units, `unit` m per block, `fillet` m)
  tokyo: { lengthM: 5200, stepM: 30, unit: 100, fillet: 26, rot: 0.2,
    grid: [[0, 0], [12, 0], [12, 3], [9, 3], [9, 6], [14, 6], [14, 10], [5, 10], [5, 7], [0, 7]] },
  rio: { lengthM: 4600, stepM: 30, unit: 85, fillet: 24, rot: -0.15,
    grid: [[0, 0], [22, 0], [22, 3], [14, 3], [14, 2], [8, 2], [8, 4], [0, 4]] },
  kalahari: { lengthM: 6200, aspect: 1.3, rot: 0.9, stepM: 45, targetR: 55, waves: [[2, 0.28, 0.50], [3, 0.10, 1.70], [6, 0.045, 0.20]] },
  highland: { lengthM: 5000, aspect: 1.15, rot: 1.6, stepM: 40, targetR: 38, waves: [[3, 0.19, 0.40], [4, 0.11, 1.20], [7, 0.045, 2.00]] },
  canyon: { lengthM: 4800, aspect: 1.4, rot: 2.4, stepM: 40, targetR: 42, waves: [[2, 0.22, 1.30], [3, 0.17, 0.60], [5, 0.08, 2.40]] },
};

export function design({ lengthM, aspect, rot, stepM, waves }) {
  const M = 4000;
  const raw = [];
  for (let i = 0; i < M; i++) {
    const th = (i / M) * Math.PI * 2;
    let r = 1;
    for (const [k, a, ph] of waves) r += a * Math.cos(k * th + ph);
    if (r <= 0.05) throw new Error('radius went non-positive: lower the wave amplitudes');
    const x = r * Math.cos(th) * aspect, z = r * Math.sin(th);
    raw.push([x * Math.cos(rot) - z * Math.sin(rot), x * Math.sin(rot) + z * Math.cos(rot)]);
  }
  const perim = (pts) => pts.reduce((s, p, i) => s + Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1]), 0);
  const k = lengthM / perim(raw);
  const dense = raw.map(([x, z]) => [x * k, z * k]);
  // tightest radius from three-point curvature over ~12 m
  let minR = Infinity;
  const span = Math.max(1, Math.round(12 / (lengthM / M)));
  for (let i = 0; i < M; i++) {
    const a = dense[(i - span + M) % M], b = dense[i], c = dense[(i + span) % M];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (area2 > 1e-9) minR = Math.min(minR, (ab * bc * ca) / (2 * area2));
  }
  // resample every ~stepM along the lap
  const out = [];
  let acc = 0;
  out.push(dense[0]);
  for (let i = 1; i < M; i++) {
    acc += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    if (acc >= stepM) { out.push(dense[i]); acc = 0; }
  }
  return { points: out.map(([x, z]) => [+x.toFixed(1), +z.toFixed(1)]), minRadius: Math.round(minR), lengthM: Math.round(perim(out)) };
}

/** A block-grid circuit: straights joined by filleted right-angle corners. */
export function designGrid({ grid, unit, fillet, rot = 0, stepM, lengthM }) {
  const P = grid.map(([x, z]) => [x * unit, z * unit]);
  const n = P.length;
  const dense = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
    const d1 = [b[0] - a[0], b[1] - a[1]], d2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    const u1 = [d1[0] / l1, d1[1] / l1], u2 = [d2[0] / l2, d2[1] / l2];
    const r = Math.min(fillet, l1 / 2.2, l2 / 2.2);
    const p0 = [b[0] - u1[0] * r, b[1] - u1[1] * r], p1 = [b[0] + u2[0] * r, b[1] + u2[1] * r];
    // quarter arc through the corner (quadratic Bézier is close enough, and smooth)
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      dense.push([(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * b[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * b[1] + t * t * p1[1]]);
    }
    // the straight to the next corner's arc
    const next = P[(i + 2) % n];
    const d3 = [next[0] - c[0], next[1] - c[1]];
    const rNext = Math.min(fillet, l2 / 2.2, Math.hypot(...d3) / 2.2);
    const q = [c[0] - u2[0] * rNext, c[1] - u2[1] * rNext];
    const len = Math.hypot(q[0] - p1[0], q[1] - p1[1]);
    for (let m = 1; m < Math.floor(len / 5); m++) dense.push([p1[0] + (q[0] - p1[0]) * (m * 5 / len), p1[1] + (q[1] - p1[1]) * (m * 5 / len)]);
  }
  // centre, rotate, scale to the wanted lap length, resample
  const cx = dense.reduce((s, p) => s + p[0], 0) / dense.length, cz = dense.reduce((s, p) => s + p[1], 0) / dense.length;
  let pts = dense.map(([x, z]) => [x - cx, z - cz]).map(([x, z]) => [x * Math.cos(rot) - z * Math.sin(rot), x * Math.sin(rot) + z * Math.cos(rot)]);
  const perim = (q) => q.reduce((s, p, i) => s + Math.hypot(q[(i + 1) % q.length][0] - p[0], q[(i + 1) % q.length][1] - p[1]), 0);
  const k = lengthM / perim(pts);
  pts = pts.map(([x, z]) => [x * k, z * k]);
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc >= stepM) { out.push(pts[i]); acc = 0; }
  }
  return { points: out.map(([x, z]) => [+x.toFixed(1), +z.toFixed(1)]), minRadius: Math.round(fillet * k), lengthM: Math.round(perim(out)) };
}

/** Scale the wave amplitudes until the tightest corner reaches targetR. */
export function designToTarget(preset) {
  let best = design(preset);
  for (let f = 1.05; f < 4; f += 0.05) {
    let r;
    try { r = design({ ...preset, waves: preset.waves.map(([k, a, ph]) => [k, a * f, ph]) }); } catch { break; }
    best = r;
    if (r.minRadius <= preset.targetR) break;
  }
  return best;
}

/** Start the lap mid-way along the straightest stretch (grid and pit straight). */
export function startOnStraight(points, window = 8) {
  const n = points.length;
  const heading = (i) => Math.atan2(points[(i + 1) % n][1] - points[i][1], points[(i + 1) % n][0] - points[i][0]);
  let best = 0, bestTurn = Infinity;
  for (let i = 0; i < n; i++) {
    let turn = 0;
    for (let k = -window; k < window; k++) {
      let d = heading((i + k + 1 + n) % n) - heading((i + k + n) % n);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      turn += Math.abs(d);
    }
    if (turn < bestTurn) { bestTurn = turn; best = i; }
  }
  return [...points.slice(best), ...points.slice(0, best)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const name of process.argv.slice(2)) {
    const r = PRESETS[name].grid ? designGrid(PRESETS[name]) : designToTarget(PRESETS[name]);
    // the lap closes from the last point to the first: drop a last point that
    // would leave a sliver shorter than half a step there
    const [l, f] = [r.points[r.points.length - 1], r.points[0]];
    if (Math.hypot(l[0] - f[0], l[1] - f[1]) < PRESETS[name].stepM / 2) r.points.pop();
    r.points = startOnStraight(r.points);
    console.log(`// ${name}: ${r.points.length} points, lap ${r.lengthM} m, tightest radius ${r.minRadius} m`);
    console.log(JSON.stringify(r.points));
  }
}
