// Closed-loop circuit generator. Emits js/tracks.js-compatible control points.
//
// Two builders:
//   oval(...)     two straights joined by constant-radius turns — exact by
//                 construction, used for the superspeedway.
//   harmonic(...) a truncated Fourier loop. Closure is guaranteed analytically
//                 (every term is periodic in theta), which is what makes a long
//                 complex circuit safe to generate: it can never fail to meet
//                 itself at the start/finish line.
// Both are checked here for the same three things validate-tracks.mjs asserts:
// length, minimum point spacing, and absence of self-intersection.

const TAU = Math.PI * 2;

export function oval({ straight, radius, points = 96 }) {
  const pts = [];
  const push = (x, z) => pts.push([Number(x.toFixed(1)), Number(z.toFixed(1))]);
  const straightPts = Math.max(2, Math.round(points * 0.22));
  const turnPts = Math.max(6, Math.round(points * 0.28));
  for (let i = 0; i < straightPts; i++) push(-straight / 2 + straight * (i / straightPts), -radius);
  for (let i = 0; i < turnPts; i++) {
    const a = -Math.PI / 2 + Math.PI * (i / turnPts);
    push(straight / 2 + Math.cos(a) * radius, Math.sin(a) * radius);
  }
  for (let i = 0; i < straightPts; i++) push(straight / 2 - straight * (i / straightPts), radius);
  for (let i = 0; i < turnPts; i++) {
    const a = Math.PI / 2 + Math.PI * (i / turnPts);
    push(-straight / 2 + Math.cos(a) * radius, Math.sin(a) * radius);
  }
  return pts;
}

// mulberry32 — the same tiny deterministic PRNG style the project already uses.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function harmonic({ seed, points, scaleX, scaleZ, harmonics, detail }) {
  const rand = rng(seed);
  const terms = [];
  for (let k = 2; k <= harmonics; k++) {
    const amp = detail / Math.pow(k, 1.55);
    terms.push({
      k,
      ax: (rand() * 2 - 1) * amp, bx: (rand() * 2 - 1) * amp,
      az: (rand() * 2 - 1) * amp, bz: (rand() * 2 - 1) * amp,
    });
  }
  const pts = [];
  for (let i = 0; i < points; i++) {
    const th = (i / points) * TAU;
    let x = Math.cos(th) * scaleX;
    let z = Math.sin(th) * scaleZ;
    for (const t of terms) {
      x += t.ax * Math.cos(t.k * th) * scaleX + t.bx * Math.sin(t.k * th) * scaleX;
      z += t.az * Math.cos(t.k * th) * scaleZ + t.bz * Math.sin(t.k * th) * scaleZ;
    }
    pts.push([Number(x.toFixed(1)), Number(z.toFixed(1))]);
  }
  return pts;
}

// ---- the same checks validate-tracks.mjs runs -----------------------------
export function closedLength(pts) {
  let L = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}
export function minSpacing(pts) {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    m = Math.min(m, Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return m;
}
function segIntersect(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}
export function selfIntersects(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return [i, j];
    }
  }
  return null;
}
export function report(name, pts, targetKm) {
  const L = closedLength(pts);
  const err = Math.abs(L - targetKm * 1000) / (targetKm * 1000);
  const x = selfIntersects(pts);
  console.log(`${name.padEnd(14)} pts ${String(pts.length).padStart(3)}  ` +
    `len ${(L / 1000).toFixed(3)}km (target ${targetKm}, err ${(err * 100).toFixed(1)}%)  ` +
    `minGap ${minSpacing(pts).toFixed(1)}m  ` +
    `${x ? `SELF-INTERSECTS at ${x}` : 'no self-intersection'}`);
  return !x && err < 0.15 && minSpacing(pts) >= 10;
}
export function emit(pts, perLine = 6) {
  const rows = [];
  for (let i = 0; i < pts.length; i += perLine) {
    rows.push('      ' + pts.slice(i, i + perLine).map(([x, z]) => `[${x},${z}]`).join(','));
  }
  return rows.join(',\n') + ',';
}

// ---------------------------------------------------------------------------
// Segment-program builder: straights and constant-radius arcs, the way a real
// circuit is described. This is what gives a layout genuine STRAIGHTS, which
// the track builder needs in order to find braking zones, place boards and lay
// out a grid — a continuously-curving loop has none.
//
// Closure: the program's turn angles are authored to sum to exactly 360 deg, so
// the exit heading already matches the entry. That leaves a pure translation
// gap, which is removed by the least-norm adjustment to the straight lengths
// (solve  sum(d_i * u_i) = -gap  minimising sum(d_i^2)). Corner radii and
// angles are therefore preserved exactly; only straights stretch, slightly.
export function segmentsToPoints(program, { step = 12 } = {}) {
  const straights = [];
  let heading = 0, x = 0, z = 0;
  for (const seg of program) {
    if (seg.type === 'straight') {
      straights.push({ seg, ux: Math.sin(heading), uz: Math.cos(heading) });
      x += Math.sin(heading) * seg.length;
      z += Math.cos(heading) * seg.length;
    } else {
      const a = seg.angle * Math.PI / 180;
      const r = seg.radius;
      const cx = x + Math.cos(heading) * r * Math.sign(seg.angle);
      const cz = z - Math.sin(heading) * r * Math.sign(seg.angle);
      heading += a;
      x = cx - Math.cos(heading) * r * Math.sign(seg.angle);
      z = cz + Math.sin(heading) * r * Math.sign(seg.angle);
    }
  }
  // least-norm straight-length correction to close the loop
  const gx = -x, gz = -z;
  let sxx = 0, szz = 0, sxz = 0;
  for (const s of straights) { sxx += s.ux * s.ux; szz += s.uz * s.uz; sxz += s.ux * s.uz; }
  const det = sxx * szz - sxz * sxz;
  let lx = 0, lz = 0;
  if (Math.abs(det) > 1e-9) { lx = (szz * gx - sxz * gz) / det; lz = (sxx * gz - sxz * gx) / det; }
  for (const s of straights) {
    s.seg.length = Math.max(30, s.seg.length + s.ux * lx + s.uz * lz);
  }
  // re-integrate, emitting points
  const pts = [];
  const push = (px, pz) => pts.push([Number(px.toFixed(1)), Number(pz.toFixed(1))]);
  heading = 0; x = 0; z = 0;
  for (const seg of program) {
    if (seg.type === 'straight') {
      const n = Math.max(1, Math.round(seg.length / step));
      for (let i = 0; i < n; i++) {
        push(x + Math.sin(heading) * seg.length * (i / n),
          z + Math.cos(heading) * seg.length * (i / n));
      }
      x += Math.sin(heading) * seg.length;
      z += Math.cos(heading) * seg.length;
    } else {
      const a = seg.angle * Math.PI / 180;
      const r = seg.radius, sgn = Math.sign(seg.angle);
      const cx = x + Math.cos(heading) * r * sgn;
      const cz = z - Math.sin(heading) * r * sgn;
      const arcLen = Math.abs(a) * r;
      // Tight corners need denser control points or the Catmull-Rom spline
      // through them overshoots and folds the road surface back on itself.
      const arcStep = Math.min(step, Math.max(6, r * 0.22));
      const n = Math.max(3, Math.round(arcLen / arcStep));
      for (let i = 0; i < n; i++) {
        const h = heading + a * (i / n);
        push(cx - Math.cos(h) * r * sgn, cz + Math.sin(h) * r * sgn);
      }
      heading += a;
      x = cx - Math.cos(heading) * r * sgn;
      z = cz + Math.sin(heading) * r * sgn;
    }
  }
  return pts;
}

export function programLength(program) {
  return program.reduce((sum, s) => sum +
    (s.type === 'straight' ? s.length : Math.abs(s.angle) * Math.PI / 180 * s.radius), 0);
}
