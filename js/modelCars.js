// Detailed GLB bodies for road and race cars.
//
// js/roadCar.js builds every roster car procedurally. This module swaps the
// procedural hull, glass and wheels for a hand-modelled GLB when one is
// registered for that car and the file is present. The handle keeps the exact
// shape race.js expects ({ group, body, wheels:{fl,fr,rl,rr}, wheelRadius, ... });
// only the meshes under `body` and each wheel group change, and the wheel
// groups move to the model's real hub positions.
//
// Loading is lazy and never blocks a race: the first car built kicks off the
// fetch and gets the procedural body; every car built (or still on track) when
// the template lands is upgraded in place. A missing file (404) or a node
// harness (no GLTFLoader host) simply leaves the procedural cars alone.
//
// Downloaded models come in every convention: Z-up or Y-up, facing any way,
// in centimetres or metres, with showroom floors and motion-blur rim shells,
// and with wheels as one mesh, four meshes or hundreds of pieces. The template
// pass normalises all of that from a small per-model spec:
//   1. apply `rotate`, bake every node transform, remove `drop` parts and any
//      large flat plane (floors, baked shadows)
//   2. scale to `lengthM`, centre on x/z and stand the `tyre` parts on y = 0
//   3. find one hub per corner from the tyre parts
//   4. move every triangle inside a tyre's cylinder (rim, spokes, disc, nuts)
//      into that corner's wheel group, so it steers (.y) and spins (.x);
//      brake calipers stay on the body
import * as THREE from 'three';

// `file` names assets/cars/local-only/<file>.glb, the raw download. The game
// prefers the copies tools/optimize-car-models.mjs writes to opt/: <file>.glb
// (lighter, same look) and <file>.far.glb (the distant-car LOD). Without them
// it falls back to the raw file and keeps full detail at every distance.
//
// assets/cars/local-only/ is git-ignored and stripped from the public build:
// models there are licensed for in-house use only.
const LOCAL = 'assets/cars/local-only/';

// Which cars wear which models. When several models match a car, it gets one
// by a stable hash of its id, so a grid mixes them and a car keeps the same
// model between sessions.
const isRaceCar = (car) => car?.vehicleClass === 'gt3' || car?.body === 'trackcar';
const roadBody = (...bodies) => (car) => bodies.includes(car?.body) && !isRaceCar(car);

// Spec fields: lamps (part names whose rear triangles are the brake lamps, for
// models where the name-based guess misses them), make/model/year/engine (shown on the car-select card), file, lengthM
// (real length, m), match(car), race (GT Racing grid only; never offered on a
// roster's car-select screen), tyre (part names),
// optional rotate ([x,y,z] degrees, applied first), drop (part names), paint
// (part names repainted in the car's roster colour; without it the model keeps
// its own livery), solidExcept (RegExp: for exports that flag every material
// as see-through, all other materials are drawn solid, with alpha cut-outs). Part names are material names; each entry is an exact
// string or a RegExp.
export const MODEL_CARS = Object.freeze({
  // ---- race cars: GT Racing grid and track-day cars ----
  mclaren720gt3: { make: 'McLaren', model: '720S GT3', year: 2020, engine: 'Twin-Turbo V8',
    perf: { hp: 550, kg: 1300, top: 290, accel: 3.4, drive: 'RWD', gears: 6 }, widthM: 2.04,
    file: 'mclaren-720s-gt3', lengthM: 4.55, match: isRaceCar, race: true,
    tyre: ['Tyre'], drop: ['Rim_Blurred', 'Rim_0', 'damage_glass', 'WorldGridMaterial'], paint: [/^EXT_Carpaint_Inst/] },
  brzgt300: { make: 'Subaru', model: 'BRZ GT300', year: 2012, engine: 'Flat-4',
    perf: { hp: 300, kg: 1150, top: 262, accel: 4.6, drive: 'RWD', gears: 6 }, widthM: 1.94,
    file: 'subaru-brz-gt300', lengthM: 4.48, match: isRaceCar, race: true,
    tyre: ['Tire_DUNLOP.007'], drop: [/^Wheel_Blur/], paint: ['Car_Body_WR_Blue.007'] },
  porsche996gt300: { make: 'Porsche', model: '996 GT300', year: 2003, engine: 'Flat-6',
    perf: { hp: 450, kg: 1150, top: 282, accel: 3.8, drive: 'RWD', gears: 6 }, widthM: 1.91,
    file: 'porsche-996-gt300', lengthM: 4.43, match: isRaceCar, race: true,
    tyre: ['YKPOR300_WHEEL_STYLE3_TY.001', 'TREAD.001'],
    drop: ['RIM_BLUR.001', /_A8(_WPS)?\.001$/], lamps: ['HGLOB.001'], paint: [/^WC_TEAM_BODY1_(PA|FL)\.001$/] },
  porsche992gt3r: { make: 'Porsche', model: '911 GT3 R (992)', year: 2024, engine: 'Flat-6',
    perf: { hp: 565, kg: 1250, top: 295, accel: 3.3, drive: 'RWD', gears: 6 }, widthM: 2.05,
    file: 'porsche-992-gt3r', lengthM: 4.62, match: isRaceCar, race: true,
    tyre: [/^MI_Tyre_Flex_Dry/], drop: [/^EXT_RIM_BLUR/, 'WorldGridMaterial', /damage/i], paint: ['EXT_Carpaint_Inst'] },
  ferrari296gt3: { make: 'Ferrari', model: '296 GT3', year: 2023, engine: 'Twin-Turbo V6',
    perf: { hp: 600, kg: 1270, top: 295, accel: 3.2, drive: 'RWD', gears: 6 }, widthM: 2.05,
    file: 'ferrari-296-gt3', lengthM: 4.69, match: isRaceCar, race: true,
    tyre: [/^MI_Tyre_Flex_Dry/], drop: [/blur/i, 'WorldGridMaterial', /damage/i], paint: ['EXT_Carpaint_Inst'] },
  audia4dtm: { make: 'Audi', model: 'A4 DTM', year: 2008, engine: 'V8',
    perf: { hp: 480, kg: 1050, top: 280, accel: 3.6, drive: 'RWD', gears: 6 }, widthM: 1.95,
    file: 'audi-a4-dtm', lengthM: 4.80, match: isRaceCar, race: true,
    tyre: [/^GENERIC_(TREAD|TYRE)_TYRES/], drop: [/ALPHA_WHEELS/], paint: ['audi_a4_dtm_paint.007'] },
  mercedesccoupedtm: { make: 'Mercedes-AMG', model: 'C 63 DTM', year: 2018, engine: 'V8',
    perf: { hp: 500, kg: 1120, top: 290, accel: 3.5, drive: 'RWD', gears: 6 }, widthM: 1.95,
    file: 'mercedes-c-coupe-dtm', lengthM: 4.95, match: isRaceCar, race: true,
    tyre: [/^EXT_Tire/], drop: [/Rim_Blur/], paint: ['EXT_CarPaint.007'] },
  mercedesclkdtm: { make: 'Mercedes-Benz', model: 'CLK DTM', year: 2002, engine: 'V8',
    perf: { hp: 470, kg: 1050, top: 282, accel: 3.7, drive: 'RWD', gears: 6 }, widthM: 1.95,
    file: 'mercedes-clk-dtm', lengthM: 4.70, match: isRaceCar, race: true,
    tyre: [/^tire\./], paint: ['body.007'] },
  // every material in this export is flagged see-through, body panels included
  opelcalibradtm: { make: 'Opel', model: 'Calibra V6 ITC', year: 1996, engine: 'V6',
    perf: { hp: 500, kg: 1040, top: 290, accel: 3.5, drive: 'AWD', gears: 6 }, widthM: 1.75,
    file: 'opel-calibra-dtm', lengthM: 4.49, match: isRaceCar, race: true,
    tyre: [/^Oponalp/], solidExcept: /glass|lampy|light|szyb/i, rotate: [0, 180, 0], paint: [/^Dtmbody/] },

  // ---- road cars ----
  eb110: { make: 'Bugatti', model: 'EB110 Super Sport', year: 1992, engine: 'Quad-Turbo V12',
    perf: { hp: 603, kg: 1418, top: 351, accel: 3.3, drive: 'AWD', gears: 6 }, widthM: 1.94,
    file: 'eb110', lengthM: 4.40, match: roadBody('supercar'),
    tyre: ['tire', 'tire_side'],
    drop: ['floor', 'red_carpet', 'carshadow', '110EBsupersport_BUGATTI', 'ALs_CARS', 'needforspeed'],
    paint: ['Bugatti_EB110SS_By_Alex_Ka'], repaint: true },
  acuransx: { make: 'Acura', model: 'NSX', year: 2005, engine: 'V6',
    perf: { hp: 290, kg: 1365, top: 270, accel: 5.0, drive: 'RWD', gears: 6 }, widthM: 1.81,
    file: 'acura-nsx', lengthM: 4.43, match: roadBody('supercar'),
    tyre: ['tread', 'sidewall'], paint: ['body'] },
  jesko: { make: 'Koenigsegg', model: 'Jesko Attack', year: 2023, engine: 'Twin-Turbo V8',
    perf: { hp: 1600, kg: 1420, top: 400, accel: 2.6, drive: 'RWD', gears: 9 }, widthM: 2.03,
    file: 'koenigsegg-jesko', lengthM: 4.61, match: roadBody('hypercar'),
    tyre: ['AttackMI_ChangeA_Tyre1'], paint: ['AttackMI_1361040001_002'] },
  sf90xx: { make: 'Ferrari', model: 'SF90 XX Stradale', year: 2024, engine: 'Hybrid Twin-Turbo V8',
    perf: { hp: 1030, kg: 1660, top: 320, accel: 2.3, drive: 'AWD', gears: 8 }, widthM: 2.01,
    file: 'ferrari-sf90-xx', lengthM: 4.85, match: roadBody('hypercar'),
    tyre: [/^tire_tex/], rotate: [0, 180, 0], paint: ['vehicle_generic_smallspecmap_PRIMARY.002'] },
  db11: { make: 'Aston Martin', model: 'DB11', year: 2017, engine: 'Twin-Turbo V12',
    perf: { hp: 600, kg: 1875, top: 322, accel: 3.9, drive: 'RWD', gears: 8 }, widthM: 1.95,
    file: 'aston-db11', lengthM: 4.74, match: roadBody('gt'),
    tyre: [/Wheel2A_3D_3DWheel1/], paint: [/2017Paint_Material1$/] },
  slsamg: { make: 'Mercedes-Benz', model: 'SLS AMG', year: 2010, engine: 'V8',
    perf: { hp: 563, kg: 1620, top: 317, accel: 3.8, drive: 'RWD', gears: 7 }, widthM: 1.94,
    file: 'mercedes-sls-amg', lengthM: 4.64, match: roadBody('gt'),
    tyre: ['Tyre.007'], drop: [/^Rim_Blurred/], paint: ['Carpaint.007'] },
  supramk4: { make: 'Toyota', model: 'Supra Mk IV', year: 1993, engine: 'Twin-Turbo Inline-6',
    perf: { hp: 550, kg: 1570, top: 290, accel: 4.2, drive: 'RWD', gears: 6 }, widthM: 1.81,
    file: 'toyota-supra-mk4', lengthM: 4.52, match: roadBody('coupe'),
    tyre: [/_Wheel1A_3D_3DWheel1A_Material1$/], paint: [/1994Paint_Material1$/] },
  grsupraveilside: { make: 'Toyota', model: 'GR Supra VeilSide', year: 2021, engine: 'Turbo Inline-6',
    perf: { hp: 450, kg: 1540, top: 280, accel: 4.0, drive: 'RWD', gears: 8 }, widthM: 2.0,
    file: 'toyota-gr-supra-veilside', lengthM: 4.48, match: roadBody('coupe'),
    tyre: ['Tire1A'], rotate: [-90, 0, 0], paint: ['Paint'] },
  r34: { make: 'Nissan', model: 'Skyline GT-R R34', year: 1999, engine: 'Twin-Turbo Inline-6',
    perf: { hp: 500, kg: 1560, top: 300, accel: 4.2, drive: 'AWD', gears: 6 }, widthM: 1.79,
    file: 'nissan-r34', lengthM: 4.60, match: roadBody('coupe'),
    tyre: [/_Wheel1A_3D_3DWheel1A_Material1\.003$/], paint: [/1999Paint_Material1$/] },
  fairladyz: { make: 'Nissan', model: 'Fairlady Z Devil Z', year: 1973, engine: 'Twin-Turbo Inline-6',
    perf: { hp: 600, kg: 1150, top: 300, accel: 3.9, drive: 'RWD', gears: 5 }, widthM: 1.8,
    file: 'nissan-fairlady-z', lengthM: 4.31, match: roadBody('coupe'),
    tyre: ['Tyre'], paint: ['Paint'] },
  integra: { make: 'Acura', model: 'Integra Type R', year: 2001, engine: 'Inline-4',
    perf: { hp: 195, kg: 1140, top: 233, accel: 6.6, drive: 'FWD', gears: 5 }, widthM: 1.7,
    file: 'acura-integra-r', lengthM: 4.38, match: roadBody('coupe', 'hatch'),
    tyre: ['Material_21'], paint: ['body'] },
  rsx: { make: 'Acura', model: 'RSX Type-S', year: 2002, engine: 'Inline-4',
    perf: { hp: 200, kg: 1240, top: 235, accel: 6.8, drive: 'FWD', gears: 6 }, widthM: 1.72,
    file: 'acura-rsx', lengthM: 4.37, match: roadBody('hatch'),
    tyre: ['tread', 'sidewall'], paint: ['body'] },
  giulietta: { make: 'Alfa Romeo', model: 'Giulietta QV', year: 2011, engine: 'Turbo Inline-4',
    perf: { hp: 240, kg: 1395, top: 244, accel: 6.0, drive: 'FWD', gears: 6 }, widthM: 1.8,
    file: 'alfa-giulietta-qv', lengthM: 4.35, match: roadBody('hatch'),
    tyre: ['tread', 'sidewall'], paint: ['body'], lamps: ['reverse_light_lod0'] },
  charger: { make: 'Dodge', model: 'Charger R/T', year: 1970, engine: 'Supercharged V8',
    perf: { hp: 900, kg: 1700, top: 280, accel: 3.6, drive: 'RWD', gears: 4 }, widthM: 1.95,
    file: 'dodge-charger-rt', lengthM: 5.28, match: roadBody('muscle', 'pony'),
    tyre: ['Wheel1A'], rotate: [-90, 0, 0], paint: ['Paint'] },
  cuda: { make: 'Plymouth', model: 'Hemi \'Cuda', year: 1971, engine: 'Hemi V8',
    perf: { hp: 425, kg: 1700, top: 240, accel: 5.8, drive: 'RWD', gears: 4 }, widthM: 1.9,
    file: 'plymouth-hemi-cuda', lengthM: 4.74, match: roadBody('muscle', 'pony'),
    tyre: ['tie'], paint: ['CarPaint'] },
  crv: { make: 'Honda', model: 'CR-V', year: 2026, engine: 'Turbo Inline-4',
    perf: { hp: 204, kg: 1650, top: 200, accel: 8.4, drive: 'AWD', gears: 6 }, widthM: 1.86,
    file: 'honda-crv', lengthM: 4.70, match: roadBody('suv'),
    tyre: [/^TIRE_TREAD_SYMMETRY/], rotate: [0, -90, 0], paint: [/SlateGrayPearl|BODY_PAINT/] },
});

// Performance index: power-to-weight and top speed on one 100-999 scale,
// used for the car-select card and for matchmaking the grid.
export function performanceIndex(hp, kg, topKmh) {
  const pw = (hp / Math.max(1, kg)) * 1000;
  return Math.round(Math.min(999, Math.max(100, Math.sqrt(pw) * 28 + topKmh * 1.1 - 300)));
}

// Asphalt-style class letter for a performance index.
export function performanceClass(pi) {
  return pi >= 800 ? 'S' : pi >= 650 ? 'A' : pi >= 500 ? 'B' : pi >= 350 ? 'C' : 'D';
}

function modelPerformance(perf, base = {}) {
  const pi = performanceIndex(perf.hp, perf.kg, perf.top);
  return {
    ...base,
    power_hp: perf.hp,
    weight_kg: perf.kg,
    top_speed_kmh: perf.top,
    accel_0_100_kmh_s: perf.accel,
    drivetrain: perf.drive,
    performance_index: pi,
    performance_class: performanceClass(pi),
  };
}

/**
 * The selectable cars for a discipline: one per road model (or, with
 * `{ race: true }`, one per GT/touring race model) that matches a car in
 * `rosterCars`. Each borrows a roster car of that body for its
 * handling, sound and performance figures and takes the model's name. Ids are
 * `model-<id>`, the same in every discipline, so a saved pick survives.
 */
export function modelRoster(rosterCars, { race = false } = {}) {
  const used = new Set();
  const out = [];
  for (const [id, spec] of Object.entries(MODEL_CARS)) {
    if (!!spec.race !== race) continue;
    const candidates = rosterCars.filter((car) => spec.match(car));
    if (!candidates.length) continue;
    const base = candidates.find((car) => !used.has(car.id)) || candidates[0];
    used.add(base.id);
    out.push({
      ...base,
      id: `model-${id}`,
      make: spec.make,
      model: spec.model,
      year: spec.year,
      engine: spec.engine || base.engine,
      name: `${spec.make} ${spec.model}`,
      modelId: id,
      thumb: `${LOCAL}thumbs/${id}.png`,
      lengthM: spec.lengthM,
      widthM: spec.widthM || null,
      paint: null,            // null = the model's own colours
      performance: spec.perf ? modelPerformance(spec.perf, base.performance) : base.performance,
      drivetrain_detail: spec.perf ? { ...base.drivetrain_detail, gears: spec.perf.gears } : base.drivetrain_detail,
    });
  }
  return out;
}

// Lamp, lens and light parts. Their triangles in the rear fifth of the car
// become brake lamps (no model names its tail lights the same way).
const LAMP_PART = /tail|rear.?l|brake.?l|stop|light|lamp|lens|red_?glass|glas_r|lampy|blight|rr_brake/i;
const NOT_TAIL = /head|front|hlight|interior|^int|window|windo|reverse|indicator|turn|amber|orange|yellow|reflector|detail/i;

// Parts that sit inside the wheel but must not spin with it.
const FIXED_IN_WHEEL = /calip|cariper|callip|brake_?duct|upright|susp/i;

const WHEEL_KEYS = ['fl', 'fr', 'rl', 'rr'];
const templates = new Map();      // id -> template | null (failed)
const loading = new Map();        // id -> Promise
const pending = new Set();        // handles waiting for their template

function isHeadless() {
  return typeof window === 'undefined' || typeof document === 'undefined';
}

function nameMatches(list, name) {
  return !!list?.some((p) => (p instanceof RegExp ? p.test(name) : p === name));
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function modelIdForCar(car) {
  if (!car) return null;
  if (car.modelId && MODEL_CARS[car.modelId]) return car.modelId;
  const ids = Object.keys(MODEL_CARS).filter((id) => MODEL_CARS[id].match(car));
  if (!ids.length) return null;
  return ids[hash(String(car.id || car.model || '')) % ids.length];
}

// First URL that loads wins; resolves null when none do.
async function loadScene(...urls) {
  let GLTFLoader;
  try { ({ GLTFLoader } = await import('../lib/loaders/GLTFLoader.js')); } catch { return null; }
  for (const url of urls) {
    const scene = await new Promise((resolve) => {
      new GLTFLoader().load(url, (g) => resolve(g.scene), undefined, () => resolve(null));
    });
    if (scene) return scene;
  }
  return null;
}

function markShared(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.userData.shared = true;
    for (const m of [].concat(o.material)) {
      m.userData.shared = true;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap',
        'aoMap', 'alphaMap', 'clearcoatMap', 'clearcoatNormalMap', 'specularColorMap',
        'specularIntensityMap']) {
        if (!m[k]) continue;
        m[k].userData.shared = true;
        // three.js clamps this to what the GPU supports (16 on most)
        m[k].anisotropy = 16;
      }
    }
  });
}

/**
 * Sort a geometry's triangles into buckets. `classify(centroid, firstVertex,
 * geometry)` returns a bucket key; the result maps each non-empty key to a new
 * non-indexed geometry.
 */
function partitionTriangles(geo, classify) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.attributes.position;
  const buckets = new Map();
  const c = new THREE.Vector3();
  for (let t = 0; t < pos.count; t += 3) {
    c.set(
      (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3,
      (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3,
      (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3,
    );
    const key = classify(c, t, src);
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(t);
  }
  const out = new Map();
  for (const [key, tris] of buckets) {
    if (buckets.size === 1 && src === geo) { out.set(key, geo); break; }
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) {
      const n = attr.itemSize;
      const arr = new attr.array.constructor(tris.length * 3 * n);
      let o = 0;
      for (const t of tris) {
        for (let v = 0; v < 3; v++) {
          for (let k = 0; k < n; k++) arr[o++] = attr.array[(t + v) * n + k];
        }
      }
      g.setAttribute(name, new THREE.BufferAttribute(arr, n, attr.normalized));
    }
    out.set(key, g);
  }
  if (src !== geo) src.dispose();
  return out;
}

// Read a material's colour texture back as pixels (browser only), so lamp
// triangles can be found by what they look like.
const texelCache = new WeakMap();
function texelReader(tex) {
  if (!tex?.image || typeof document === 'undefined') return null;
  if (texelCache.has(tex)) return texelCache.get(tex);
  let reader = null;
  try {
    const img = tex.image;
    const w = Math.min(1024, img.width || 0), h = Math.min(1024, img.height || 0);
    if (w && h) {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      const data = g.getImageData(0, 0, w, h).data;
      const frac = (v) => v - Math.floor(v);
      // glTF textures are not flipped: v = 0 is the top row of the image
      reader = (u, v) => {
        const x = Math.min(w - 1, Math.floor(frac(u) * w));
        const y = Math.min(h - 1, Math.floor(frac(v) * h));
        const i = (y * w + x) * 4;
        return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
      };
    }
  } catch { reader = null; }
  texelCache.set(tex, reader);
  return reader;
}

// Is this triangle a red tail lamp in its texture? Samples the centroid and
// the three corners of its UVs; most must read clearly red.
function redTexelTriangle(read, tint, uv, t) {
  let red = 0;
  const samples = [[0, 1, 2], [0], [1], [2]];
  for (const verts of samples) {
    let u = 0, v = 0;
    for (const k of verts) { u += uv.getX(t + k); v += uv.getY(t + k); }
    const [r, g, b] = read(u / verts.length, v / verts.length);
    const R = r * tint.r, G = g * tint.g, B = b * tint.b;
    if (R > 0.2 && R > G * 1.6 && R > B * 1.6) red++;
  }
  return red >= 3;
}

const quadrantOf = (c) => (c.z > 0 ? 'f' : 'r') + (c.x < 0 ? 'l' : 'r');

// `fit` reuses the near copy's placement for the far copy, whose bounds shrink
// once mirrors and other small parts are stripped.
function prepareTemplate(scene, spec, fitIn = null) {
  let fit = fitIn;
  const holder = new THREE.Group();
  if (spec.rotate) {
    const d = THREE.MathUtils.DEG2RAD;
    holder.rotation.set(spec.rotate[0] * d, spec.rotate[1] * d, spec.rotate[2] * d);
  }
  holder.add(scene);
  holder.updateMatrixWorld(true);

  // 1. bake world transforms into standalone parts, dropping props
  let parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material?.name || o.name;
    if (nameMatches(spec.drop, name)) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    geo.computeBoundingBox();
    parts.push({ geo, material: o.material, name, tyre: nameMatches(spec.tyre, name) });
  });
  if (!parts.length) return null;
  const boundsOf = (list) => list.reduce((b, p) => b.union(p.geo.boundingBox), new THREE.Box3());
  // large flat planes: showroom floors and baked shadow quads
  const all = boundsOf(parts);
  const allSize = all.getSize(new THREE.Vector3());
  const span = Math.max(allSize.x, allSize.y, allSize.z);
  parts = parts.filter((p) => {
    const s = p.geo.boundingBox.getSize(new THREE.Vector3());
    const flat = s.y < span * 0.01 && s.x * s.z > allSize.x * allSize.z * 0.2;
    if (flat && !p.tyre) p.geo.dispose();
    return !flat || p.tyre;
  });
  const tyres = parts.filter((p) => p.tyre);
  if (!tyres.length) return null;
  if (spec.solidExcept) {
    for (const p of parts) {
      const m = p.material;
      if (!m?.transparent || spec.solidExcept.test(m.name)) continue;
      m.transparent = false;
      m.depthWrite = true;
      m.alphaTest = 0.5;
      m.needsUpdate = true;
    }
  }

  // 2. scale to real length, centre on x/z, tyres on the ground
  if (!fit) {
    const box = boundsOf(parts);
    const size = box.getSize(new THREE.Vector3());
    const s = spec.lengthM / size.z;
    const centre = box.getCenter(new THREE.Vector3());
    const ground = boundsOf(tyres).min.y;
    fit = new THREE.Matrix4().makeScale(s, s, s)
      .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -ground, -centre.z));
  }
  for (const p of parts) { p.geo.applyMatrix4(fit); p.geo.computeBoundingBox(); }

  // 3. one hub per corner from the tyre triangles: centre, radius, half-width
  const corner = Object.fromEntries(WHEEL_KEYS.map((k) => [k, new THREE.Box3()]));
  for (const p of tyres) {
    for (const [k, g] of partitionTriangles(p.geo, quadrantOf)) {
      g.computeBoundingBox();
      corner[k].union(g.boundingBox);
      if (g !== p.geo) g.dispose();
    }
  }
  const hubs = {};
  const cyl = {};
  for (const k of WHEEL_KEYS) {
    if (corner[k].isEmpty()) return null;
    const size = corner[k].getSize(new THREE.Vector3());
    hubs[k] = corner[k].getCenter(new THREE.Vector3());
    cyl[k] = { r2: (Math.max(size.y, size.z) * 0.51) ** 2, hw: size.x * 0.55 };
  }

  // 4. everything inside a tyre's cylinder belongs to that wheel
  const inWheel = (c) => {
    for (const k of WHEEL_KEYS) {
      const h = hubs[k];
      if (Math.abs(c.x - h.x) <= cyl[k].hw && (c.y - h.y) ** 2 + (c.z - h.z) ** 2 <= cyl[k].r2) return k;
    }
    return 'body';
  };
  // Tail lamps by name where the model names them; only a model with no named
  // lamp part at the rear falls back to finding them by texture colour (which
  // would otherwise also catch red livery).
  const isLampPart = (name) => (spec.lamps ? nameMatches(spec.lamps, name)
    : LAMP_PART.test(name) && !NOT_TAIL.test(name));
  const findLampsByColour = !parts.some((p) => isLampPart(p.name)
    && p.geo.boundingBox.min.z < -spec.lengthM * 0.3);
  const body = new THREE.Group();
  body.name = 'model_body';
  const wheels = Object.fromEntries(WHEEL_KEYS.map((k) => {
    const g = new THREE.Group();
    g.name = `model_wheel_${k}`;
    return [k, g];
  }));
  for (const p of parts) {
    const pieces = FIXED_IN_WHEEL.test(p.name)
      ? new Map([['body', p.geo]])
      : partitionTriangles(p.geo, inWheel);
    // split rear lamp triangles out of light parts as brake lamps
    const lampPart = isLampPart(p.name);
    if (pieces.has('body') && lampPart) {
      const rearZ = -spec.lengthM * 0.3;
      const lamp = partitionTriangles(pieces.get('body'), (c) => (c.z < rearZ ? 'tail' : 'body'));
      if (lamp.has('tail')) {
        if (pieces.get('body') !== p.geo && ![...lamp.values()].includes(pieces.get('body'))) {
          pieces.get('body').dispose();
        }
        pieces.delete('body');
        if (lamp.has('body')) pieces.set('body', lamp.get('body'));
        pieces.set('tail', lamp.get('tail'));
      }
    }
    // ...and, for models that paint their tail lamps into a shared texture,
    // the rear triangles whose texture is lamp red
    if (findLampsByColour && pieces.has('body') && p.material?.map
        && !p.material.transparent && !NOT_TAIL.test(p.name) && !nameMatches(spec.paint, p.name)) {
      const read = texelReader(p.material.map);
      const tint = p.material.color || new THREE.Color(1, 1, 1);
      const rearZ = -spec.lengthM * 0.3;
      if (read) {
        const lamp = partitionTriangles(pieces.get('body'), (c, t, src) => (
          c.z < rearZ && src.attributes.uv && redTexelTriangle(read, tint, src.attributes.uv, t)
            ? 'tail' : 'body'));
        if (lamp.has('tail')) {
          const old = pieces.get('body');
          if (old !== p.geo && ![...lamp.values()].includes(old)) old.dispose();
          pieces.delete('body');
          if (lamp.has('body')) pieces.set('body', lamp.get('body'));
          pieces.set('tail', lamp.get('tail'));
        }
      }
    }
    for (const [k, g] of pieces) {
      if (k !== 'body' && k !== 'tail') g.translate(-hubs[k].x, -hubs[k].y, -hubs[k].z);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, p.material);
      m.name = k === 'body' ? p.name : `${p.name}_${k}`;
      m.castShadow = (k !== 'body' && k !== 'tail') || !p.material?.transparent;
      m.receiveShadow = false;
      if (k === 'body' && nameMatches(spec.paint, p.name)) m.userData.paint = true;
      if (k === 'tail') m.userData.brakeLamp = true;
      (k === 'body' || k === 'tail' ? body : wheels[k]).add(m);
    }
    if (![...pieces.values()].includes(p.geo)) p.geo.dispose();
  }
  // Models whose tail lights are painted into a shared texture have no lamp
  // part to light. Give them two glow cards at the rear lamp positions: clear
  // until the brakes go on.
  let hasLamp = false;
  body.traverse((o) => { if (o.userData.brakeLamp) hasLamp = true; });
  if (!hasLamp) {
    const box = new THREE.Box3().setFromObject(body);
    const size = box.getSize(new THREE.Vector3());
    // Lamp height: 47-53% of the car's height, 18-44% of its width out from the
    // centreline. The card sits on the rearmost body surface in that narrow
    // strip, so it lies on the tail panel (a wider band picks up the bumper lip,
    // which stands proud of the lamps and makes the card drift with view angle).
    const yLo = box.min.y + size.y * 0.47, yHi = box.min.y + size.y * 0.53;
    const xLo = size.x * 0.18, xHi = size.x * 0.44;
    let rearZ = Infinity;
    const v = new THREE.Vector3();
    body.traverse((o) => {
      if (!o.isMesh || o.material?.transparent) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const ax = Math.abs(v.x);
        if (v.y >= yLo && v.y <= yHi && ax >= xLo && ax <= xHi && v.z < rearZ) rearZ = v.z;
      }
    });
    if (!Number.isFinite(rearZ)) rearZ = box.min.z;
    const card = new THREE.MeshBasicMaterial({
      name: 'brakeGlowCard', color: 0xff2010, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const geo = new THREE.PlaneGeometry(size.x * 0.22, size.y * 0.06);
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(geo, card);
      m.position.set(side * size.x * 0.31, (yLo + yHi) / 2, rearZ - 0.02);
      m.userData.brakeLamp = true;
      m.name = 'brakeGlowCard';
      body.add(m);
    }
  }

  // Shadows only from parts big enough to show in one: body shells, wheels,
  // big panels. Badges, bolts and cabin trim casting shadows doubled the draw
  // calls for no visible gain. Far copies (`fit` given) cast none at all.
  {
    const tris = (o) => (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    let total = 0;
    for (const root of [body, ...Object.values(wheels)]) root.traverse((o) => { if (o.isMesh) total += tris(o); });
    const minTris = Math.max(150, total * 0.012);
    const isFar = !!fitIn;
    for (const root of [body, ...Object.values(wheels)]) {
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = !isFar && !o.material?.transparent && tris(o) >= minTris;
      });
    }
  }

  // Downloaded models are authored for studio renders: mirror-like clearcoat
  // and full-strength reflections read as chrome on a race track. Damp them;
  // glass (transparent) keeps its gloss.
  const damped = new Set();
  for (const root of [body, ...Object.values(wheels)]) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (!m || damped.has(m) || !m.isMeshStandardMaterial) continue;
        damped.add(m);
        m.envMapIntensity = 0.6;
        if (!m.transparent) m.roughness = Math.max(m.roughness, 0.3);
        if (m.isMeshPhysicalMaterial && m.clearcoat) {
          m.clearcoat *= 0.5;
          m.clearcoatRoughness = Math.max(m.clearcoatRoughness, 0.15);
        }
      }
    });
  }
  markShared(body);
  for (const w of Object.values(wheels)) markShared(w);

  return { body, wheels, hubs, fit, wheelRadius: (hubs.fl.y + hubs.fr.y + hubs.rl.y + hubs.rr.y) / 4 };
}

function ensureLoaded(id) {
  if (templates.has(id) || loading.has(id) || isHeadless()) return loading.get(id);
  const spec = MODEL_CARS[id];
  const p = (async () => {
    const scene = await loadScene(`${LOCAL}opt/${spec.file}.glb`, `${LOCAL}${spec.file}.glb`);
    const tpl = scene ? prepareTemplate(scene, spec) : null;
    if (tpl) {
      const farScene = await loadScene(`${LOCAL}opt/${spec.file}.far.glb`);
      tpl.far = farScene ? prepareTemplate(farScene, spec, tpl.fit) : null;
    }
    templates.set(id, tpl);
    loading.delete(id);
    for (const h of [...pending]) {
      if (h.modelId !== id) continue;
      pending.delete(h);
      if (h.disposed) continue;
      if (tpl) applyTemplate(h, tpl);
      else setProceduralVisible(h, true);   // no model after all: show the fallback
    }
    return tpl;
  })();
  loading.set(id, p);
  return p;
}

// Clone a template body for one car. Paint meshes are repainted when the car
// has a chosen `paint` colour (otherwise the model keeps its own colours, or for
// a model listed with `repaint: true`, takes the roster colour), and brake lamps
// get a per-car material that setBrakeLamps() lights. Per-car materials are
// handed to the handle so releaseRoadCarMesh() frees them.
function cloneBody(handle, tplBody) {
  const car = handle.car;
  const body = tplBody.clone(true);
  const spec = MODEL_CARS[handle.modelId] || {};
  const chosen = car?.paint || (spec.repaint ? car?.colour : null);
  const paintCol = chosen ? new THREE.Color(chosen) : null;
  const paintMats = new Map();
  const lampMats = new Map();
  handle.brakeLamps = handle.brakeLamps || [];
  body.traverse((o) => {
    if (!o.isMesh || !o.userData.brakeLamp) return;
    let c = lampMats.get(o.material);
    if (!c) {
      c = o.material.clone();
      c.userData = {};
      if (!c.isMeshBasicMaterial) {
        // A textured lamp glows through its own artwork (lens pattern and all);
        // a plain one glows solid red.
        c.emissive = c.map ? new THREE.Color(1, 0.35, 0.3) : new THREE.Color(0xff1a10);
        c.emissiveMap = c.map || null;
        c.emissiveIntensity = 0.25;
        c.toneMapped = false;
      }
      lampMats.set(o.material, c);
      handle.ownedMaterials.push(c);
      handle.brakeLamps.push(c);
    }
    o.material = c;
  });
  body.traverse((o) => {
    if (!paintCol || !o.isMesh || !o.userData.paint) return;
    let c = paintMats.get(o.material);
    if (!c) {
      const src = o.material;
      c = src.isMeshPhysicalMaterial ? src.clone() : new THREE.MeshPhysicalMaterial().copy(src);
      c.name = `modelPaint:${car?.id || 'road'}`;
      c.userData = {};
      c.color.copy(paintCol);
      c.map = null;             // a chosen colour replaces any printed livery
      c.metalness = 0.3;
      c.roughness = 0.38;
      c.clearcoat = 0.5;
      c.clearcoatRoughness = 0.15;
      c.envMapIntensity = 0.6;
      paintMats.set(src, c);
      handle.ownedMaterials.push(c);
    }
    o.material = c;
  });
  return body;
}

// The procedural body and wheels stay hidden while a car's model loads, so
// the old placeholder shapes never appear on track.
function setProceduralVisible(handle, visible) {
  for (const child of handle.body.children) child.visible = visible;
  for (const k of WHEEL_KEYS) {
    for (const child of handle.wheels[k].children) child.visible = visible;
  }
}

function applyTemplate(handle, tpl) {
  // body: hide the procedural meshes, add the model
  for (const child of [...handle.body.children]) child.visible = false;
  const body = cloneBody(handle, tpl.body);
  handle.body.add(body);

  // wheels: hide procedural tyre/rim (keep the compound band object for the
  // HUD code but out of sight), move each group to the model's hub
  const modelWheels = [];
  for (const k of WHEEL_KEYS) {
    const w = handle.wheels[k];
    for (const child of w.children) child.visible = false;
    const mw = tpl.wheels[k].clone(true);
    w.add(mw);
    modelWheels.push(mw);
    w.position.copy(tpl.hubs[k]);
  }
  handle.wheelRadius = tpl.wheelRadius;

  // Distant-car LOD: race.js hides `fullDetailRoots` beyond 55 m and shows
  // `farProxy.root`, spinning and steering `farProxy.wheels` itself.
  if (tpl.far) {
    const root = new THREE.Group();
    root.name = 'model_far';
    root.visible = handle.lodLevel === 'far';
    root.add(cloneBody(handle, tpl.far.body));
    const wheels = {};
    for (const k of WHEEL_KEYS) {
      const w = new THREE.Group();
      w.name = `model_far_wheel_${k}`;
      w.rotation.order = 'YXZ';
      w.position.copy(tpl.far.hubs[k]);
      w.add(tpl.far.wheels[k].clone(true));
      root.add(w);
      wheels[k] = w;
    }
    handle.group.add(root);
    handle.farProxy = { root, wheels, rainLight: null };
    handle.fullDetailRoots = [body, ...modelWheels];
    const full = handle.lodLevel !== 'far';
    for (const r of handle.fullDetailRoots) r.visible = full;
  }
  // `source` stays 'road-primitive': race.js keys teardown on it.
  handle.modelApplied = true;
}

/** Light the brake lamps of a model car: dim running glow, bright on the brakes. */
export function setBrakeLamps(handle, brake) {
  const lamps = handle?.brakeLamps;
  if (!lamps?.length) return;
  const intensity = brake > 0.05 ? 3.2 : 0.25;
  if (handle._lampIntensity === intensity) return;
  handle._lampIntensity = intensity;
  for (const m of lamps) {
    if (m.isMeshBasicMaterial) m.opacity = brake > 0.05 ? 0.85 : 0;   // glow card
    else m.emissiveIntensity = intensity;
  }
}

/**
 * Upgrade a procedural road-car handle to its registered GLB model. Applies
 * immediately if the template is ready, otherwise starts the load and applies
 * when it lands. Returns the handle unchanged when no model is registered.
 */
export function attachModelBody(handle, car) {
  const id = modelIdForCar(car);
  if (!id || !handle?.body) return handle;
  handle.modelId = id;
  const tpl = templates.get(id);
  if (tpl) applyTemplate(handle, tpl);
  else if (!templates.has(id)) {
    pending.add(handle);
    if (!isHeadless()) setProceduralVisible(handle, false);
    ensureLoaded(id);
  }
  return handle;
}

export function forgetModelBody(handle) {
  pending.delete(handle);
}

/** Start fetching a model before the race builds its grid. */
export function preloadModelFor(car) {
  const id = modelIdForCar(car);
  if (!id) return Promise.resolve(null);
  return ensureLoaded(id) || Promise.resolve(templates.get(id));
}

/** Load one registered model's template directly (tools/model-lab.html). */
export function loadModelTemplate(id) {
  if (!MODEL_CARS[id]) return Promise.resolve(null);
  return ensureLoaded(id) || Promise.resolve(templates.get(id));
}

/**
 * A standalone display copy of a car's model (body plus wheels at their hubs),
 * painted as `car.paint` says. For the garage turntable; resolves null when the
 * car has no model or it fails to load. Call group.userData.dispose() when done.
 */
export async function buildModelPreview(car) {
  const id = modelIdForCar(car);
  if (!id) return null;
  const tpl = await loadModelTemplate(id);
  if (!tpl) return null;
  const handle = { car, modelId: id, ownedMaterials: [], brakeLamps: [] };
  const group = new THREE.Group();
  group.add(cloneBody(handle, tpl.body));
  for (const k of WHEEL_KEYS) {
    const w = tpl.wheels[k].clone(true);
    w.position.copy(tpl.hubs[k]);
    group.add(w);
  }
  group.userData.dispose = () => { for (const m of handle.ownedMaterials) m.dispose(); };
  return group;
}

/** Ids of the models whose templates are already loaded (no further download). */
export function loadedModelIds() {
  return [...templates.entries()].filter(([, tpl]) => tpl).map(([id]) => id);
}
