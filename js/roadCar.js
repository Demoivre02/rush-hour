// Closed-wheel road-car meshes for the non-Formula disciplines.
//
// The open-wheel car in js/car.js is a sculpted GLB with a primitive fallback.
// The road-car roster has no model of its own, so these are built procedurally
// from each car's body type and colours: a lofted hull, a separate greenhouse,
// four wheels and lights. That keeps 100 cars in the game without 100 GLBs, and
// every car still reads as its own shape at chase-camera distance.
//
// The handle returned here is deliberately the SAME shape js/car.js returns
// ({ group, wheels:{fl,fr,rl,rr}, wheelRadius, body, tyreBands, ... }) so
// race.js, the LOD pass, nametags and tyre-compound colouring all work on a
// road car without knowing the difference.
//
// Conventions inherited from js/car.js:
//   +Z forward, +Y up. No vertex may dip below y = 0 (cars are parked at y=0).
//   Wheel groups use rotation.order 'YXZ': .y steers, .x spins.
import * as THREE from 'three';
import { attachModelBody, forgetModelBody } from './modelCars.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// length, width, height (m); belt = beltline as a fraction of height;
// cabin = [start, end] of the greenhouse along the body; roof = roof width as a
// fraction of body half-width; wheels = [radius, width, frontT, rearT].
export const ROAD_BODIES = Object.freeze({
  city:     { L: 3.62, W: 1.68, H: 1.50, belt: 0.60, cabin: [0.24, 0.86], roof: 0.72, clr: 0.13, wheels: [0.30, 0.19, 0.20, 0.82], rear: 'hatch' },
  hatch:    { L: 4.06, W: 1.79, H: 1.45, belt: 0.58, cabin: [0.26, 0.82], roof: 0.72, clr: 0.13, wheels: [0.32, 0.21, 0.21, 0.81], rear: 'hatch' },
  sedan:    { L: 4.66, W: 1.83, H: 1.44, belt: 0.57, cabin: [0.30, 0.74], roof: 0.70, clr: 0.13, wheels: [0.33, 0.22, 0.21, 0.80], rear: 'notch' },
  wagon:    { L: 4.78, W: 1.86, H: 1.49, belt: 0.57, cabin: [0.30, 0.88], roof: 0.72, clr: 0.13, wheels: [0.33, 0.22, 0.21, 0.81], rear: 'hatch' },
  coupe:    { L: 4.46, W: 1.81, H: 1.34, belt: 0.56, cabin: [0.32, 0.72], roof: 0.66, clr: 0.12, wheels: [0.33, 0.23, 0.22, 0.80], rear: 'fastback' },
  roadster: { L: 3.98, W: 1.73, H: 1.24, belt: 0.66, cabin: [0.40, 0.66], roof: 0.60, clr: 0.11, wheels: [0.31, 0.21, 0.22, 0.80], rear: 'notch', open: true },
  muscle:   { L: 4.88, W: 1.93, H: 1.38, belt: 0.58, cabin: [0.36, 0.76], roof: 0.66, clr: 0.13, wheels: [0.35, 0.27, 0.20, 0.81], rear: 'notch' },
  pony:     { L: 4.79, W: 1.91, H: 1.37, belt: 0.58, cabin: [0.35, 0.75], roof: 0.66, clr: 0.13, wheels: [0.35, 0.27, 0.20, 0.81], rear: 'fastback' },
  suv:      { L: 4.96, W: 1.96, H: 1.80, belt: 0.52, cabin: [0.26, 0.84], roof: 0.76, clr: 0.21, wheels: [0.38, 0.26, 0.19, 0.83], rear: 'hatch' },
  pickup:   { L: 5.58, W: 2.03, H: 1.86, belt: 0.50, cabin: [0.26, 0.56], roof: 0.76, clr: 0.23, wheels: [0.40, 0.28, 0.17, 0.85], rear: 'bed' },
  rally:    { L: 4.44, W: 1.84, H: 1.46, belt: 0.57, cabin: [0.27, 0.82], roof: 0.72, clr: 0.16, wheels: [0.33, 0.23, 0.20, 0.82], rear: 'hatch' },
  gt:       { L: 4.72, W: 1.95, H: 1.27, belt: 0.56, cabin: [0.31, 0.66], roof: 0.58, clr: 0.11, wheels: [0.34, 0.26, 0.21, 0.81], rear: 'fastback' },
  supercar: { L: 4.55, W: 1.99, H: 1.17, belt: 0.58, cabin: [0.24, 0.53], roof: 0.52, clr: 0.10, wheels: [0.34, 0.29, 0.20, 0.82], rear: 'fastback', mid: true },
  hypercar: { L: 4.66, W: 2.06, H: 1.13, belt: 0.58, cabin: [0.22, 0.51], roof: 0.50, clr: 0.09, wheels: [0.35, 0.31, 0.19, 0.83], rear: 'fastback', mid: true },
  trackcar: { L: 4.18, W: 1.90, H: 1.12, belt: 0.60, cabin: [0.23, 0.52], roof: 0.50, clr: 0.09, wheels: [0.34, 0.30, 0.21, 0.81], rear: 'fastback', mid: true },
});

export function roadBody(type) {
  return ROAD_BODIES[type] || ROAD_BODIES.sedan;
}

// Plan-view half-width along the body (0 = nose, 1 = tail), as a fraction of
// the car's half-width. Deliberately the same silhouette language as the 2D
// sprite pack so a car reads the same from above in either.
function planWidth(t, spec) {
  const p = spec.mid
    ? [[0, 0.50], [0.08, 0.90], [0.19, 0.99], [0.34, 0.86], [0.50, 0.90], [0.68, 1.0], [0.86, 0.96], [1, 0.58]]
    : spec.rear === 'bed'
      ? [[0, 0.70], [0.10, 0.97], [0.24, 1.0], [0.40, 0.94], [0.55, 1.0], [0.92, 1.0], [1, 0.88]]
      : [[0, 0.56], [0.06, 0.80], [0.16, 0.96], [0.26, 1.0], [0.45, 0.95], [0.62, 0.94], [0.78, 1.0], [0.90, 0.94], [1, 0.62]];
  for (let i = 0; i < p.length - 1; i++) {
    if (t <= p[i + 1][0]) {
      const u = (t - p[i][0]) / Math.max(1e-6, p[i + 1][0] - p[i][0]);
      return p[i][1] + (p[i + 1][1] - p[i][1]) * u;
    }
  }
  return p[p.length - 1][1];
}

// Height of the lower body (below the glass) along the length: a bonnet that
// rises into the scuttle, a flat belt through the cabin, then the deck.
function beltHeight(t, spec) {
  const belt = spec.H * spec.belt;
  const nose = belt * (spec.mid ? 0.62 : 0.74);
  const deck = belt * (spec.rear === 'bed' ? 0.96 : spec.mid ? 0.72 : spec.rear === 'fastback' ? 0.78 : spec.rear === 'notch' ? 0.88 : 0.92);
  const [c0, c1] = spec.cabin;
  if (t < c0) return nose + (belt - nose) * Math.pow(clamp(t / Math.max(0.02, c0), 0, 1), 0.7);
  if (t <= c1) return belt;
  return belt + (deck - belt) * clamp((t - c1) / Math.max(0.02, 1 - c1), 0, 1);
}

/**
 * Loft a closed hull from cross-sections along +Z.
 * @param {(t:number)=>{hw:number, yBot:number, yTop:number, roof:number}} section
 */
function loft(section, stations) {
  const pos = [];
  const idx = [];
  const rings = [];
  for (let s = 0; s < stations; s++) {
    const t = s / (stations - 1);
    const { hw, yBot, yTop, roof, z, tuck = 0.86 } = section(t);
    const h = Math.max(0.001, yTop - yBot);
    // right-hand silhouette, bottom centre -> top centre. Extra shoulder
    // samples keep the procedural body from reading as a stack of boxes in a
    // close chase camera, while `tuck` leaves the tyres proud in their arches.
    const shoulder = roof + (1 - roof) * 0.38;
    const half = [
      [0, yBot],
      [hw * tuck * 0.55, yBot + h * 0.025],
      [hw * tuck, yBot + h * 0.10],
      [hw * 0.985, yBot + h * 0.28],
      [hw, yBot + h * 0.48],
      [hw * 0.965, yBot + h * 0.66],
      [hw * shoulder, yBot + h * 0.86],
      [hw * roof, yTop],
      [0, yTop],
    ];
    const ring = [];
    for (const [x, y] of half) ring.push([x, y]);
    for (let i = half.length - 2; i >= 1; i--) ring.push([-half[i][0], half[i][1]]);
    const base = pos.length / 3;
    for (const [x, y] of ring) pos.push(x, y, z);
    rings.push({ base, count: ring.length, z, yBot, yTop });
  }
  const n = rings[0].count;
  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s].base, b = rings[s + 1].base;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      idx.push(a + j, b + j, b + k);
      idx.push(a + j, b + k, a + k);
    }
  }
  // caps: fan to a centre vertex at each end
  for (const [ring, flip] of [[rings[0], true], [rings[rings.length - 1], false]]) {
    const c = pos.length / 3;
    pos.push(0, (ring.yBot + ring.yTop) * 0.5, ring.z);
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      if (flip) idx.push(c, ring.base + k, ring.base + j);
      else idx.push(c, ring.base + j, ring.base + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function hullGeometry(spec) {
  const halfL = spec.L / 2, halfW = spec.W / 2;
  const [, , frontT, rearT] = spec.wheels;
  return loft((t) => {
    // Tighten the sill around each axle so the arch opens up over the tyre.
    const nearAxle = Math.max(
      1 - Math.abs(t - frontT) / 0.16,
      1 - Math.abs(t - rearT) / 0.16,
    );
    const tuck = 0.86 - 0.30 * clamp(nearAxle, 0, 1);
    return {
      z: halfL - t * spec.L,
      hw: halfW * planWidth(t, spec),
      yBot: spec.clr,
      yTop: beltHeight(t, spec),
      roof: 0.90,
      tuck,
    };
  }, 42);
}

function greenhouseGeometry(spec) {
  const halfL = spec.L / 2, halfW = spec.W / 2;
  const [c0, c1] = spec.cabin;
  const span = c1 - c0;
  const roofTop = spec.H * (spec.open ? 0.80 : spec.mid || spec.rear === 'fastback' ? 0.92 : 0.98);
  return loft((t) => {
    const g = c0 + t * span;
    // pillars rake in at both ends: windscreen at the front, backlight at the rear
    // A real glasshouse rises fast at the A-pillar, runs FLAT across the roof,
    // then drops at the C-pillar. A half-sine gave a dome; this is a plateau.
    const rakeIn = spec.mid || spec.rear === 'fastback' ? 0.30 : 0.22;
    const rakeOut = spec.mid || spec.rear === 'fastback' ? 0.42 : 0.22;
    const rake = clamp(Math.min(t / rakeIn, (1 - t) / rakeOut, 1), 0, 1) ** 0.55;
    return {
      z: halfL - g * spec.L,
      hw: halfW * planWidth(g, spec) * (0.62 + 0.13 * rake),
      yBot: beltHeight(g, spec) - 0.03,
      yTop: beltHeight(g, spec) + (roofTop - beltHeight(g, spec)) * rake,
      roof: spec.roof * 0.86,
    };
  }, 22);
}

function roundedBoxGeometry(radius = 0.16) {
  const g = new THREE.BoxGeometry(1, 1, 1, 6, 4, 6);
  const pos = g.attributes.position;
  const r = clamp(radius, 0.02, 0.24);
  const inner = 0.5 - r;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const cx = clamp(x, -inner, inner);
    const cy = clamp(y, -inner, inner);
    const cz = clamp(z, -inner, inner);
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) pos.setXYZ(i, cx + dx / len * r, cy + dy / len * r, cz + dz / len * r);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// ---- shared geometry / material caches ------------------------------------
const _geo = new Map();
const G = (k, make) => { if (!_geo.has(k)) _geo.set(k, make()); return _geo.get(k); };
const _mat = new Map();
const M = (k, make) => { if (!_mat.has(k)) _mat.set(k, make()); return _mat.get(k); };
const _topTextures = new Map();

function topdownTexture(car) {
  if (!car?.id || typeof window === 'undefined' || typeof Image === 'undefined') return null;
  let tex = _topTextures.get(car.id);
  if (!tex) {
    tex = new THREE.TextureLoader().load(`assets/racing-pack/sprites/topdown/${car.id}.png`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.userData.shared = true;
    _topTextures.set(car.id, tex);
  }
  return tex;
}

const glassMat = () => M('road:glass', () => new THREE.MeshPhysicalMaterial({
  name: 'roadGlass', color: 0x080c13, metalness: 0.08, roughness: 0.18,
  transmission: 0, opacity: 1, transparent: false, depthWrite: true, clearcoat: 1,
}));
const tyreMat = () => M('road:tyre', () => new THREE.MeshStandardMaterial({
  name: 'roadTyre', color: 0x111216, metalness: 0.02, roughness: 0.92,
}));
const rimMat = () => M('road:rim', () => new THREE.MeshStandardMaterial({
  name: 'roadRim', color: 0xb9bfc7, metalness: 0.85, roughness: 0.28,
}));
const trimMat = () => M('road:trim', () => new THREE.MeshStandardMaterial({
  name: 'roadTrim', color: 0x1b1e23, metalness: 0.2, roughness: 0.6,
}));
const blackMat = () => M('road:black', () => new THREE.MeshStandardMaterial({
  name: 'roadBlack', color: 0x05070a, metalness: 0.12, roughness: 0.72,
}));
const plateMat = () => M('road:plate', () => new THREE.MeshStandardMaterial({
  name: 'roadPlate', color: 0xf2f0e7, metalness: 0.05, roughness: 0.46,
}));
const amberMat = () => M('road:amber', () => new THREE.MeshStandardMaterial({
  name: 'roadAmber', color: 0xff9e26, emissive: 0x5a2f04, roughness: 0.34,
}));
const headMat = () => M('road:head', () => new THREE.MeshStandardMaterial({
  name: 'roadHeadlight', color: 0xf2f0e2, emissive: 0x6a6650, roughness: 0.2,
}));
const tailMat = () => M('road:tail', () => new THREE.MeshStandardMaterial({
  name: 'roadTaillight', color: 0xd42a24, emissive: 0x4a0906, roughness: 0.35,
}));

const BOX = () => G('road:box', () => new THREE.BoxGeometry(1, 1, 1));
const SOFTBOX = () => G('road:softbox', () => roundedBoxGeometry(0.17));
const TOP_PLANE = () => G('road:topplane', () => new THREE.PlaneGeometry(1, 1));
const EXHAUST = () => G('road:exhaust', () => {
  const g = new THREE.CylinderGeometry(0.055, 0.055, 0.22, 16, 1);
  g.rotateX(Math.PI / 2);
  return g;
});
const WHEEL = (r, w) => G(`road:wheel:${r}:${w}`, () => {
  const g = new THREE.CylinderGeometry(r, r, w, 18, 1);
  g.rotateZ(Math.PI / 2);                       // axis along X so rotation.x rolls it
  return g;
});
const RIM = (r, w) => G(`road:rim:${r}:${w}`, () => {
  const g = new THREE.CylinderGeometry(r * 0.62, r * 0.62, w * 1.02, 14, 1);
  g.rotateZ(Math.PI / 2);
  return g;
});

/**
 * @param {object} car   a js/carRoster.js entry
 * @param {object} driver optional { num, code } for nametags
 * @returns handle compatible with js/car.js
 */
export function buildRoadCarMesh(car, driver) {
  const spec = roadBody(car?.body);
  const paint = new THREE.Color(car?.colour || '#c8ccd2');
  const accent = new THREE.Color(car?.accent || '#20242a');
  const key = car?.id || 'road';

  const group = new THREE.Group();
  group.name = `roadcar_${key}`;
  const body = new THREE.Group();
  body.name = 'body';
  group.add(body);

  const paintMat = new THREE.MeshPhysicalMaterial({
    name: `roadPaint:${key}`, color: paint, metalness: 0.35, roughness: 0.28,
    clearcoat: 0.85, clearcoatRoughness: 0.12,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    name: `roadAccent:${key}`, color: accent, metalness: 0.3, roughness: 0.45,
  });
  const ownedMaterials = [paintMat, accentMat];

  const hull = new THREE.Mesh(hullGeometry(spec), paintMat);
  hull.name = 'hull';
  hull.castShadow = true;
  body.add(hull);

  const roofColour = spec.open ? accentMat : paintMat;
  const glass = new THREE.Mesh(greenhouseGeometry(spec), spec.open ? roofColour : glassMat());
  glass.name = 'greenhouse';
  glass.castShadow = true;
  body.add(glass);
  // Painted roof panel. Without it the whole cabin is one dark volume and the
  // car reads as a canopy on wheels rather than a car.
  if (!spec.open) {
    const [rc0, rc1] = spec.cabin;
    const rMid = (rc0 + rc1) * 0.5;
    const roof = new THREE.Mesh(SOFTBOX(), paintMat);
    roof.name = 'roofpanel';
    roof.position.set(0, spec.H * 0.965,
      spec.L / 2 - rMid * spec.L);
    roof.scale.set(spec.W * 0.5 * spec.roof * 0.80,
      0.045, (rc1 - rc0) * spec.L * 0.62);
    roof.castShadow = true;
    body.add(roof);
  }
  const topTex = topdownTexture(car);
  if (topTex) {
    const topMat = new THREE.MeshStandardMaterial({
      name: `roadTopSkin:${key}`,
      map: topTex,
      transparent: false,
      opacity: 1,
      alphaTest: 0.12,
      depthWrite: true,
      side: THREE.DoubleSide,
      metalness: 0.18,
      roughness: 0.36,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const topSkin = new THREE.Mesh(TOP_PLANE(), topMat);
    topSkin.name = 'topSkin';
    topSkin.rotation.x = -Math.PI / 2;
    topSkin.position.set(0, spec.H + 0.012, 0);
    topSkin.scale.set(spec.W * 0.96, spec.L * 0.96, 1);
    topSkin.renderOrder = 3;
    body.add(topSkin);
    ownedMaterials.push(topMat);
  }

  const put = (geo, mat, x, y, z, sx, sy, sz, name, rot = null) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    if (name) m.name = name;
    body.add(m);
    return m;
  };

  const halfL = spec.L / 2, halfW = spec.W / 2;
  const beltFront = beltHeight(0.06, spec);
  const beltRear = beltHeight(0.96, spec);
  const sportClass = spec.mid || car?.tier === 'super' || car?.tier === 'hyper' || car?.tier === 'track';

  if (sportClass) {
    put(SOFTBOX(), paintMat, 0, beltRear + 0.055, -halfL + spec.L * 0.17,
      halfW * 0.58, 0.035, spec.L * 0.19, 'rear_deck');
    put(SOFTBOX(), glassMat(), 0, beltRear + 0.115, -halfL + spec.L * 0.28,
      halfW * 0.48, 0.026, spec.L * 0.15, 'rear_backlight');
    put(SOFTBOX(), blackMat(), 0, spec.clr + 0.055, halfL - 0.10,
      halfW * 1.18, 0.038, 0.16, 'front_splitter');
  }

  // lights
  for (const s of [-1, 1]) {
    put(SOFTBOX(), headMat(), s * halfW * 0.58, beltFront * 0.86, halfL - 0.13,
      halfW * 0.30, 0.085, 0.07, `head_${s < 0 ? 'l' : 'r'}`);
    if (sportClass) {
      put(SOFTBOX(), amberMat(), s * halfW * 0.83, beltFront * 0.56, halfL - 0.09,
        halfW * 0.10, 0.045, 0.045, `marker_front_${s < 0 ? 'l' : 'r'}`);
    }
    put(SOFTBOX(), tailMat(), s * halfW * 0.60, beltRear * 0.82, -halfL + 0.07,
      halfW * 0.44, 0.11, 0.07, `tail_${s < 0 ? 'l' : 'r'}`);
    if (sportClass) {
      put(SOFTBOX(), tailMat(), s * halfW * 0.78, beltRear * 0.70, -halfL + 0.045,
        halfW * 0.17, 0.055, 0.05, `tail_outer_${s < 0 ? 'l' : 'r'}`);
    }
  }
  // grille + rear valance
  put(SOFTBOX(), trimMat(), 0, beltFront * 0.45, halfL - 0.04, halfW * 1.05, 0.20, 0.08, 'grille');
  put(SOFTBOX(), blackMat(), 0, beltRear * 0.58, -halfL + 0.025,
    halfW * (sportClass ? 0.88 : 0.72), 0.18, 0.055, 'rear_mesh');
  put(SOFTBOX(), trimMat(), 0, beltRear * 0.30, -halfL + 0.035, halfW * 0.92, 0.14, 0.075, 'valance');
  put(SOFTBOX(), plateMat(), 0, beltRear * 0.52, -halfL - 0.012,
    halfW * 0.17, 0.055, 0.018, 'plate');
  if (sportClass) {
    put(SOFTBOX(), blackMat(), 0, spec.clr + 0.075, -halfL - 0.005,
      halfW * 1.02, 0.095, 0.11, 'diffusertray');
    for (const s of [-1, 1]) {
      put(EXHAUST(), rimMat(), s * halfW * 0.28, spec.clr + 0.08, -halfL - 0.035,
        1.0, 1.0, 1.0, `exhaust_${s < 0 ? 'l' : 'r'}`);
    }
    for (const s of [-1, 1]) {
      put(SOFTBOX(), blackMat(), s * halfW * 0.31, spec.clr + 0.13, -halfL + 0.11,
        0.035, 0.24, 0.25, `diffuser_${s < 0 ? 'l' : 'r'}`);
      put(SOFTBOX(), blackMat(), s * halfW * 0.58, spec.clr + 0.12, -halfL + 0.12,
        0.028, 0.20, 0.22, `diffuser_outer_${s < 0 ? 'l' : 'r'}`);
    }
  }
  // mirrors
  const mirrorT = spec.cabin[0] + 0.04;
  for (const s of [-1, 1]) {
    put(SOFTBOX(), accentMat, s * halfW * 1.02, beltHeight(mirrorT, spec) * 0.98,
      halfL - mirrorT * spec.L, 0.16, 0.07, 0.10, `mirror_${s < 0 ? 'l' : 'r'}`);
  }
  if (spec.open) {
    for (const s2 of [-1, 1]) {
      put(SOFTBOX(), trimMat(), s2 * halfW * 0.34, spec.H * 0.72,
        halfL - spec.cabin[1] * spec.L, 0.07, spec.H * 0.30, 0.09,
        `rollhoop_${s2 < 0 ? 'l' : 'r'}`);
    }
  }
  // pickup bed walls
  if (spec.rear === 'bed') {
    put(SOFTBOX(), paintMat, 0, beltHeight(0.8, spec) + 0.16, -halfL * 0.52,
      halfW * 1.86, 0.32, spec.L * 0.34, 'bedfloor').scale.set(halfW * 1.86, 0.06, spec.L * 0.34);
    for (const s of [-1, 1]) {
      put(SOFTBOX(), paintMat, s * halfW * 0.92, beltHeight(0.8, spec) + 0.16, -halfL * 0.52,
        0.09, 0.34, spec.L * 0.34, `bedside_${s < 0 ? 'l' : 'r'}`);
    }
  }
  // rear wing for the quick tiers
  const wing = car?.tier === 'super' || car?.tier === 'hyper' || car?.tier === 'tuned';
  if (wing) {
    const wy = beltRear + (car.tier === 'tuned' ? 0.10 : 0.16);
    put(SOFTBOX(), trimMat(), 0, wy, -halfL + 0.30, halfW * 1.52, 0.038, 0.24, 'wing');
    for (const s of [-1, 1]) {
      put(SOFTBOX(), trimMat(), s * halfW * 0.52, wy - 0.11, -halfL + 0.30, 0.05, 0.22, 0.10,
        `wingstay_${s < 0 ? 'l' : 'r'}`);
    }
  }

  // ---- wheels ----
  const [wr0, ww, frontT, rearT] = spec.wheels;
  const wr = wr0 * 1.07;
  for (const side of [-1, 1]) {
    put(SOFTBOX(), trimMat(), side * halfW * 0.98, spec.clr + 0.06, -spec.L * 0.02,
      0.06, 0.085, spec.L * 0.62, `rocker_${side < 0 ? 'l' : 'r'}`);
    if (sportClass) {
      put(SOFTBOX(), paintMat, side * halfW * 0.76, beltHeight(0.73, spec) * 0.96,
        -halfL + spec.L * 0.25, 0.20, 0.08, spec.L * 0.22, `rear_haunch_${side < 0 ? 'l' : 'r'}`);
      put(SOFTBOX(), trimMat(), side * halfW * 0.965, beltHeight(0.50, spec) * 0.62,
        halfL - spec.L * 0.49, 0.055, 0.22, spec.L * 0.17, `side_intake_${side < 0 ? 'l' : 'r'}`);
      put(SOFTBOX(), blackMat(), side * halfW * 0.985, beltHeight(0.42, spec) * 0.55,
        halfL - spec.L * 0.40, 0.040, 0.15, spec.L * 0.10, `side_intake_shadow_${side < 0 ? 'l' : 'r'}`);
    }
    for (const [label, t] of [['f', frontT], ['r', rearT]]) {
      put(SOFTBOX(), paintMat, side * halfW * 0.86, spec.clr + wr * 1.03,
        halfL - t * spec.L, sportClass ? 0.16 : 0.13, sportClass ? 0.13 : 0.11, wr * 1.70, `arch_${label}_${side < 0 ? 'l' : 'r'}`);
      if (sportClass) {
        put(SOFTBOX(), blackMat(), side * halfW * 0.995, spec.clr + wr * 0.94,
          halfL - t * spec.L, 0.048, 0.075, wr * 1.28, `arch_shadow_${label}_${side < 0 ? 'l' : 'r'}`);
      }
    }
  }
  const wheels = {};
  const tyreBands = [];
  const bandMat = new THREE.MeshStandardMaterial({
    name: `roadBand:${key}`, color: 0x2a2d33, metalness: 0.05, roughness: 0.8,
  });
  for (const [k, sx, t] of [['fl', -1, frontT], ['fr', 1, frontT], ['rl', -1, rearT], ['rr', 1, rearT]]) {
    const wheel = new THREE.Group();
    wheel.name = `wheel_${k}`;
    wheel.rotation.order = 'YXZ';
    // Outer face a touch proud of the widest bodywork, so the tyre reads as a
    // wheel in an arch from every angle - including directly behind.
    wheel.position.set(sx * (halfW * 1.0 - ww * 0.42), wr, halfL - t * spec.L);
    const tyre = new THREE.Mesh(WHEEL(wr, ww), tyreMat());
    tyre.name = `tyre_${k}`;
    tyre.castShadow = true;
    wheel.add(tyre);
    const rim = new THREE.Mesh(RIM(wr, ww), rimMat());
    rim.name = `rim_${k}`;
    wheel.add(rim);
    // thin coloured band: the tyre-compound indicator the HUD/race code drives
    const band = new THREE.Mesh(G(`road:band:${wr}:${ww}`, () => {
      const g = new THREE.CylinderGeometry(wr * 0.86, wr * 0.86, ww * 0.34, 16, 1, true);
      g.rotateZ(Math.PI / 2);
      return g;
    }), bandMat);
    band.name = `band_${k}`;
    wheel.add(band);
    tyreBands.push(band);
    group.add(wheel);
    wheels[k] = wheel;
  }

  const handle = {
    group, wheels, wheelRadius: wr,
    body,
    team: { id: car?.id || 'road', color: `#${paint.getHexString()}`, accent: `#${accent.getHexString()}` },
    driver: driver || { num: 0, code: (car?.model || '---').slice(0, 3).toUpperCase() },
    car: car || null,
    tyreBands,
    tyreBandMats: [bandMat],
    compound: 'M',
    brakeGlows: [],
    brakeGlowMaterial: null,
    rainLight: null,
    rainLightMaterial: null,
    monocoque: hull,
    // Nothing to hide at distance: race.js swaps these roots for a far proxy
    // beyond 55 m, and a procedural road car has none (js/modelCars.js adds
    // one when a GLB with a far copy is attached). Listing the body here made
    // distant road cars vanish.
    fullDetailRoots: [],
    haloFeet: [],
    frontWingMinY: spec.clr,
    source: 'road-primitive',
    ownedMaterials: [...ownedMaterials, bandMat],
  };
  group.userData.carVariant = car?.body || 'sedan';
  return attachModelBody(handle, car);
}

export function releaseRoadCarMesh(handle) {
  if (!handle || handle.disposed) return false;
  handle.disposed = true;
  forgetModelBody(handle);
  // Only per-car materials and lofted geometry are owned here; the shared
  // caches above are module-owned and outlive any single car.
  for (const m of handle.ownedMaterials || []) m.dispose?.();
  handle.monocoque?.geometry?.dispose?.();
  handle.body?.getObjectByName('greenhouse')?.geometry?.dispose?.();
  return true;
}
