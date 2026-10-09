// Analogue instrument cluster: a sweeping tachometer and speedometer drawn as
// inline SVG. The dials are built once and only two transforms plus two text
// nodes change per frame, so this costs nothing measurable in the render loop.
//
// Both dials are class-aware: redline, gear count and the speed scale come from
// the car's vehicle profile, so a stock car reads to 340 km/h in four gears and
// a hot hatch reads to 250 in six.

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = (v, f = 0) => (Number.isFinite(v) ? v : f);

// Angles are degrees clockwise from 12 o'clock, matching the needle's own
// rotate() transform. The dial sweeps 270 degrees from 7-o'clock (225) round
// through the top to 5-o'clock (495 = 135), leaving the conventional gap at
// the bottom for the digital readout.
const SWEEP_START = 225;
const SWEEP_DEG = 270;
const NS = 'http://www.w3.org/2000/svg';

export function gaugeAngle(fraction) {
  return SWEEP_START + clamp(finite(fraction), 0, 1) * SWEEP_DEG;
}

function polar(cx, cy, r, deg) {
  const a = deg * Math.PI / 180;
  // SVG y grows downward, so north is -cos.
  return [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
}

function el(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function arcPath(cx, cy, r, fromDeg, toDeg) {
  const [x0, y0] = polar(cx, cy, r, fromDeg);
  const [x1, y1] = polar(cx, cy, r, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * One dial. `major` ticks are labelled, `minor` sit between them.
 * `dangerFrom` (0..1) paints the redline arc.
 */
export class Dial {
  constructor({ size = 132, label = '', unit = '', max = 100, step = 10,
    minor = 2, dangerFrom = null, decimals = 0 } = {}) {
    this.size = size;
    this.max = max;
    this.decimals = decimals;
    const c = size / 2;
    const r = c - 11;
    const svg = el('svg', {
      class: 'gauge', viewBox: `0 0 ${size} ${size}`, width: size, height: size,
      role: 'img', 'aria-label': label,
    });
    svg.appendChild(el('circle', { class: 'gauge-face', cx: c, cy: c, r: r + 7 }));
    svg.appendChild(el('path', {
      class: 'gauge-track', d: arcPath(c, c, r, SWEEP_START, SWEEP_START + SWEEP_DEG),
    }));
    if (dangerFrom != null && dangerFrom < 1) {
      svg.appendChild(el('path', {
        class: 'gauge-danger',
        d: arcPath(c, c, r, gaugeAngle(dangerFrom), gaugeAngle(1)),
      }));
    }
    // value arc grows with the reading, which reads faster than the needle alone
    this.valueArc = el('path', { class: 'gauge-value', d: '' });
    svg.appendChild(this.valueArc);
    this._c = c; this._r = r;

    const ticks = el('g', { class: 'gauge-ticks' });
    const steps = Math.max(1, Math.round(max / step));
    for (let i = 0; i <= steps; i++) {
      const frac = i / steps;
      const deg = gaugeAngle(frac);
      const [ax, ay] = polar(c, c, r - 2, deg);
      const [bx, by] = polar(c, c, r - 9, deg);
      ticks.appendChild(el('line', {
        class: 'major', x1: ax.toFixed(2), y1: ay.toFixed(2), x2: bx.toFixed(2), y2: by.toFixed(2),
      }));
      const [tx, ty] = polar(c, c, r - 16, deg);
      const t = el('text', { class: 'gauge-num', x: tx.toFixed(2), y: (ty + 3.2).toFixed(2) });
      t.textContent = String(Math.round(max * frac));
      ticks.appendChild(t);
      if (i < steps) {
        for (let m = 1; m <= minor; m++) {
          const md = gaugeAngle(frac + (m / (minor + 1)) / steps);
          const [mx, my] = polar(c, c, r - 2, md);
          const [nx, ny] = polar(c, c, r - 6, md);
          ticks.appendChild(el('line', {
            class: 'minor', x1: mx.toFixed(2), y1: my.toFixed(2), x2: nx.toFixed(2), y2: ny.toFixed(2),
          }));
        }
      }
    }
    svg.appendChild(ticks);

    this.needle = el('g', { class: 'gauge-needle' });
    this.needle.appendChild(el('path', {
      d: `M ${c - 2.6} ${c} L ${c} ${c - r + 9} L ${c + 2.6} ${c} Z`,
    }));
    svg.appendChild(this.needle);
    svg.appendChild(el('circle', { class: 'gauge-hub', cx: c, cy: c, r: 6 }));

    // Readout sits just under the hub, clear of the rim labels at either end
    // of the sweep.
    this.readout = el('text', { class: 'gauge-readout', x: c, y: c + r * 0.34 });
    svg.appendChild(this.readout);
    const unitNode = el('text', { class: 'gauge-unit', x: c, y: c + r * 0.72 });
    unitNode.textContent = unit;
    svg.appendChild(unitNode);

    this.el = svg;
    this._lastDeg = null;
    this._lastText = null;
    this.set(0);
  }

  /** @param {number} value in the dial's own units */
  set(value) {
    const v = clamp(finite(value), 0, this.max);
    const frac = this.max > 0 ? v / this.max : 0;
    const deg = gaugeAngle(frac);
    if (deg !== this._lastDeg) {
      this.needle.setAttribute('transform',
        `rotate(${deg.toFixed(2)} ${this._c} ${this._c})`);
      this.valueArc.setAttribute('d',
        frac <= 0.001 ? '' : arcPath(this._c, this._c, this._r, SWEEP_START, deg));
      this._lastDeg = deg;
    }
    const text = v.toFixed(this.decimals);
    if (text !== this._lastText) {
      this.readout.textContent = text;
      this._lastText = text;
    }
  }

  setMax(max) {
    if (max === this.max || !Number.isFinite(max) || max <= 0) return false;
    this.max = max;
    return true;   // caller rebuilds if the scale legend must change
  }
}

/**
 * The two-dial cluster. `profile` is a vehicle-class profile; passing a new one
 * rescales the dials for that car.
 */
export class GaugeCluster {
  constructor(root) {
    this.root = root;
    this.root.classList.add('gauge-cluster');
    this._profileId = null;
    this._build({ redlineRpm: 12000, topSpeedKmh: 360 });
  }

  _build({ redlineRpm, topSpeedKmh }) {
    this.root.innerHTML = '';
    // Tachometer in thousands of rpm, with the last 12% painted as redline.
    const revMax = Math.max(4, Math.ceil(redlineRpm / 1000));
    this.tacho = new Dial({
      size: 128, label: 'Engine revolutions per minute', unit: 'x1000 RPM',
      max: revMax, step: revMax > 12 ? 3 : 2, minor: 3, dangerFrom: 0.88, decimals: 1,
    });
    const speedMax = Math.ceil(topSpeedKmh / 40) * 40;
    this.speedo = new Dial({
      size: 128, label: 'Road speed', unit: 'KM/H',
      max: speedMax, step: speedMax > 300 ? 80 : 40, minor: 3,
    });
    this.root.appendChild(this.tacho.el);
    this.root.appendChild(this.speedo.el);
    this._revMax = revMax;
    this._speedMax = speedMax;
  }

  /** Rescale for a different car. No-op when the scale is already right. */
  setProfile(profile) {
    if (!profile) return;
    const id = profile.id || profile.classId || 'default';
    if (id === this._profileId) return;
    this._profileId = id;
    const gearTop = profile.gearTop || [];
    const topSpeedKmh = (gearTop[profile.gears] || gearTop[gearTop.length - 1] || 100) * 3.6;
    this._build({ redlineRpm: profile.redlineRpm || 12000, topSpeedKmh });
  }

  /**
   * @param {number} rpmFrac 0..1.04 fraction of redline (the sim's native unit)
   * @param {number} kmh road speed
   */
  update(rpmFrac, kmh) {
    this.tacho.set(clamp(finite(rpmFrac), 0, 1.08) * this._revMax);
    this.speedo.set(finite(kmh));
  }
}
