// City dressing for the street circuits: buildings, houses, parked cars and
// people along the roads, added after the circuit is built (browser only).
//
// It lives outside trackBuilder.js on purpose: the circuit's own scenery is
// placed from a seeded random sequence the validators pin, and this layer must
// not disturb it. It draws from its own generator, keeps clear of the road, the
// walls and every structure and tree the circuit already placed, and adds
// everything to circuit.group so the session teardown disposes it.
//
// Assets (CC0, assets/city/*/License.txt): Kenney City Kit (Commercial), City
// Kit (Suburban) and Mini Characters. Parked cars reuse the detailed car models'
// distant-LOD copies (js/modelCars.js).
import * as THREE from 'three';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';
import { MODEL_CARS, loadModelTemplate, loadedModelIds } from './modelCars.js';

const DIR = 'assets/city/';
// Photo-textured buildings and shopfronts exported from a licensed Blender pack
// by tools/blender/export_city_pack.py. In-house only (git-ignored): when the
// folder is absent the Kenney kits below are used instead.
const REAL_DIR = 'assets/city-real/';
const REAL_FRONTS = [2, 5, 6, 7, 9].map((n) => `real:buildings/building_${n}`);
const REAL_HEAVY = [1, 3, 8].map((n) => `real:buildings/building_${n}`);   // 30-70k triangles: back row only
const REAL_SHOPS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `real:shops/shop_${n}`);

async function realPackAvailable() {
  try {
    const r = await fetch(`${REAL_DIR}manifest.json`, { cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}
const COMMERCIAL = 'abcdefghijklmn'.split('').map((c) => `commercial/building-${c}`);
const SKYSCRAPERS = 'abcde'.split('').map((c) => `commercial/building-skyscraper-${c}`);
const HOUSES = 'abcdefghijklmnopqrstu'.split('').map((c) => `suburban/building-type-${c}`);
const TREES = ['suburban/tree-large', 'suburban/tree-small'];
const PEOPLE = ['female', 'male'].flatMap((g) => 'abcdef'.split('').map((c) => `people/character-${g}-${c}`));

// Which look each street venue gets. Venues not listed are left alone.
const CITY_STYLE = Object.freeze({
  monaco: 'downtown', singapore: 'downtown', baku: 'downtown', jeddah: 'downtown',
  lasvegas: 'downtown', madrid: 'downtown', montreal: 'mixed', miami: 'mixed',
  melbourne: 'suburban',
});

export function cityStyleFor(trackId) {
  return CITY_STYLE[trackId] || null;
}

// Real-world size of each kit, in metres per model unit.
const SCALE = { commercial: 15, suburban: 8.5, people: 2.6, tree: 8 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let GLTFLoaderClass = null;
async function loadGLB(path) {
  if (!GLTFLoaderClass) ({ GLTFLoader: GLTFLoaderClass } = await import('../lib/loaders/GLTFLoader.js'));
  return new Promise((resolve) => {
    const url = path.startsWith('real:') ? `${REAL_DIR}${path.slice(5)}.glb` : `${DIR}${path}.glb`;
    new GLTFLoaderClass().load(url, resolve, undefined, () => resolve(null));
  });
}

/**
 * One model as merged geometry, one part per material (the Kenney kits have a
 * single colour-map material; the photo-textured pack has several), with its
 * footprint. Skinned characters are frozen in their idle pose.
 */
function bakeModel(gltf, scale) {
  const root = gltf.scene;
  if (gltf.animations?.length) {
    const clip = gltf.animations.find((a) => a.name === 'idle') || gltf.animations[0];
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    mixer.update(0.35);
  }
  root.updateMatrixWorld(true);
  const byMat = new Map();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    let g = o.geometry.clone();
    if (o.isSkinnedMesh) {
      o.skeleton.update();
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        o.applyBoneTransform(i, v);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      g.deleteAttribute('skinIndex');
      g.deleteAttribute('skinWeight');
      g.applyMatrix4(o.matrixWorld);   // bind-pose transforms already applied per vertex
      g.computeVertexNormals();
    } else {
      g.applyMatrix4(o.matrixWorld);
    }
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    // split a multi-material mesh into its groups
    const groups = g.groups.length && mats.length > 1 ? g.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    const flat = g.index ? g.toNonIndexed() : g;
    for (const grp of groups) {
      const mat = mats[grp.materialIndex] || mats[0];
      let part = flat;
      if (groups.length > 1) {
        const n = Math.min(grp.count, flat.attributes.position.count - grp.start);
        part = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(flat.attributes)) {
          part.setAttribute(name, new THREE.BufferAttribute(
            attr.array.slice(grp.start * attr.itemSize, (grp.start + n) * attr.itemSize), attr.itemSize));
        }
      }
      part.clearGroups();
      let list = byMat.get(mat);
      if (!list) byMat.set(mat, (list = []));
      list.push(part);
    }
  });
  if (!byMat.size) return null;
  const parts = [];
  const box = new THREE.Box3();
  for (const [material, geos] of byMat) {
    // all parts of one material need the same attribute set to merge
    const keep = ['position', 'normal', 'uv'].filter((n) => geos.every((g) => g.attributes[n]));
    for (const g of geos) for (const n of Object.keys(g.attributes)) if (!keep.includes(n)) g.deleteAttribute(n);
    const geometry = mergeGeometries(geos);
    if (!geometry) continue;
    geometry.scale(scale, scale, scale);
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
    parts.push({ geometry, material });
  }
  if (!parts.length) return null;
  // stand it on the ground, centred on its footprint
  const cx = -(box.min.x + box.max.x) / 2, cy = -box.min.y, cz = -(box.min.z + box.max.z) / 2;
  for (const p of parts) {
    p.geometry.translate(cx, cy, cz);
    p.geometry.computeBoundingBox();
    p.geometry.computeBoundingSphere();
  }
  const size = box.getSize(new THREE.Vector3());
  return { parts, w: size.x, d: size.z, h: size.y };
}

/** Distance from (x, z) to the nearest track centreline sample, via a grid. */
function trackDistanceField(circuit) {
  const CELL = 24;
  const grid = new Map();
  const key = (ix, iz) => `${ix},${iz}`;
  for (let i = 0; i < circuit.N; i++) {
    const p = circuit.samples[i].p;
    const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  }
  return (x, z, reach = 4) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = Infinity, bestI = 0;
    for (let ix = cx - reach; ix <= cx + reach; ix++) {
      for (let iz = cz - reach; iz <= cz + reach; iz++) {
        const list = grid.get(key(ix, iz));
        if (!list) continue;
        for (const i of list) {
          const p = circuit.samples[i].p;
          const d = Math.hypot(p.x - x, p.z - z);
          if (d < best) { best = d; bestI = i; }
        }
      }
    }
    return { d: best, i: bestI };
  };
}

/** Footprints of what the circuit already placed near the road. */
function existingObstacles(circuit) {
  const boxes = [];
  const circles = [];
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  circuit.group.updateMatrixWorld(true);
  circuit.group.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry) return;
    if (o.isInstancedMesh) {
      if (!/tree|vegetation|shrub|grandstand|stand|marshal|light|pole|tower/i.test(o.name)) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const r = Math.max(2, o.geometry.boundingBox.getSize(p).length() * 0.25);
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, m);
        p.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld);
        circles.push({ x: p.x, z: p.z, r: Math.min(r, 8) });
      }
      return;
    }
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    const s = box.getSize(p);
    if (s.x > 400 || s.z > 400 || s.y < 1.5) return;   // ground, road ribbons, decals
    boxes.push(box.clone().expandByScalar(2));
  });
  return { boxes, circles };
}

// A parked car never moves, so its distant-LOD copy (body + four wheels, 14-66
// materials) is flattened once per model into two meshes: opaque parts with
// each material's colour baked into the vertices, and the glass. 12 parked
// cars were otherwise ~1,800 draw calls a frame.
const PARKED = new Map();
const TEX_COLOUR = new WeakMap();
const PARKED_GLASS = new THREE.MeshStandardMaterial({
  color: 0x0b0f14, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.85,
});
let parkedPaint = null;

/** A texture's average colour (sRGB-decoded), so a textured part keeps its tone. */
function textureColour(tex) {
  if (TEX_COLOUR.has(tex)) return TEX_COLOUR.get(tex);
  let c = null;
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 4;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(tex.image, 0, 0, 4, 4);
    const d = ctx.getImageData(0, 0, 4, 4).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    c = new THREE.Color().setRGB(r / 4080, g / 4080, b / 4080, THREE.SRGBColorSpace);
  } catch { /* image not drawable: keep the material colour */ }
  TEX_COLOUR.set(tex, c);
  return c;
}

function parkedMeshes(id, far) {
  if (PARKED.has(id)) return PARKED.get(id);
  const src = new THREE.Group();
  src.add(far.body.clone(true));
  for (const k of ['fl', 'fr', 'rl', 'rr']) {
    const w = far.wheels[k].clone(true);
    w.position.copy(far.hubs[k]);
    src.add(w);
  }
  src.updateMatrixWorld(true);
  const opaque = [], glass = [];
  const col = new THREE.Color();
  src.traverse((o) => {
    if (!o.isMesh || !o.visible || Array.isArray(o.material)) return;
    const m = o.material;
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal'].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (m.transparent && m.opacity < 0.9) { glass.push(g); return; }
    col.copy(m.color || col.set(0x808080));
    const t = m.map && textureColour(m.map);
    if (t) col.multiply(t);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    opaque.push(g);
  });
  parkedPaint = parkedPaint || new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.4, metalness: 0.35, envMapIntensity: 0.6,
  });
  parkedPaint.userData.shared = true;
  PARKED_GLASS.userData.shared = true;
  const meshes = [];
  for (const [geos, material] of [[opaque, parkedPaint], [glass, PARKED_GLASS]]) {
    if (!geos.length) continue;
    const geometry = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    if (!geometry) continue;
    geometry.userData.shared = true;           // the circuit teardown keeps it
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  PARKED.set(id, meshes);
  return meshes;
}

/**
 * Dress a built circuit as a city. Resolves to the number of things placed (0
 * for venues without a city style, in node, or if the kit fails to load).
 */
export async function dressCity(circuit, { night = false, carsReady = null } = {}) {
  const style = cityStyleFor(circuit?.id);
  if (!style || typeof document === 'undefined') return 0;
  const rnd = mulberry32(circuit.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 9) | 0);
  const pick = (list) => list[Math.floor(rnd() * list.length)];

  // the photo-textured pack replaces the Kenney buildings where it is installed
  // (downtown and mixed venues; the suburban venue keeps its houses)
  const real = style !== 'suburban' && await realPackAvailable();
  const want = real
    ? [...REAL_FRONTS, ...REAL_HEAVY, ...REAL_SHOPS, ...TREES, ...PEOPLE]
    : style === 'suburban'
    ? [...HOUSES, ...TREES, ...COMMERCIAL.slice(0, 6), ...PEOPLE]
    : style === 'mixed'
      ? [...COMMERCIAL, ...SKYSCRAPERS.slice(0, 3), ...HOUSES.slice(0, 10), ...TREES, ...PEOPLE]
      : [...COMMERCIAL, ...SKYSCRAPERS, ...PEOPLE];
  const loaded = await Promise.all(want.map(async (path) => {
    const gltf = await loadGLB(path);
    if (!gltf) return null;
    const kit = path.split('/')[0];
    const scale = path.startsWith('real:') ? 1 : path.includes('tree') ? SCALE.tree : SCALE[kit];
    const baked = bakeModel(gltf, scale);
    return baked && { path, ...baked };
  }));
  const models = new Map(loaded.filter(Boolean).map((m) => [m.path, m]));
  if (!models.size) return 0;
  const avail = (list) => list.filter((p) => models.has(p));

  const distField = trackDistanceField(circuit);
  const { boxes, circles } = existingObstacles(circuit);
  const placed = [];                         // our own footprints (circles)
  const wall = circuit.wallOff;
  const clear = (x, z, r, minTrack) => {
    if (distField(x, z).d < minTrack) return false;
    for (const c of circles) if (Math.hypot(c.x - x, c.z - z) < c.r + r) return false;
    for (const c of placed) if (Math.hypot(c.x - x, c.z - z) < c.r + r) return false;
    for (const b of boxes) {
      if (x + r > b.min.x && x - r < b.max.x && z + r > b.min.z && z - r < b.max.z) return false;
    }
    return true;
  };
  const groundAt = (x, z) => circuit.heightAt?.(distField(x, z).i) ?? 0;

  // Instances are bucketed by model AND by ~450 m stretch of the lap, so each
  // InstancedMesh bounds one neighbourhood and frustum culling skips the
  // stretches behind and beside the camera (one batch per model drew the whole
  // city every frame: ~1.3M triangles per pass at Miami).
  const CHUNK_M = 450;
  const instances = new Map();                // `${path}|${chunk}` -> [{x, z, y, yaw, s}]
  const add = (path, x, z, yaw, s = 1) => {
    const near = distField(x, z);
    const key = `${path}|${Math.floor((near.i * circuit.ds) / CHUNK_M)}`;
    let list = instances.get(key);
    if (!list) instances.set(key, (list = []));
    list.push({ x, z, y: circuit.heightAt?.(near.i) ?? 0, yaw, s });
  };

  // Walk the lap; at intervals, try a building on each side, facing the road.
  // A handful of designs per venue keeps the batch count down once chunked.
  const sample = (list, n) => {
    const pool = [...list];
    const out = [];
    while (pool.length && out.length < n) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    return out;
  };
  const fronts = real ? [...avail(REAL_FRONTS), ...sample(avail(REAL_SHOPS), 4)]
    : sample(style === 'suburban' ? avail(HOUSES) : avail(COMMERCIAL), 6);
  const backs = real ? [...avail(REAL_HEAVY), ...sample(avail(REAL_FRONTS), 2)]
    : sample(style === 'downtown' ? avail(SKYSCRAPERS)
      : style === 'mixed' ? [...avail(SKYSCRAPERS), ...avail(HOUSES)] : avail(HOUSES), 4);
  // A shopfront is a flat facade: it stands on a plain block (BLOCK_DEPTH deep)
  // so it reads as a one-storey shop from every angle.
  const BLOCK_DEPTH = 12;
  const blocks = [];                          // {x, z, y, yaw, w, h}
  const step = Math.max(1, Math.round(20 / circuit.ds));
  const sidewalks = [];                       // spots for people and parked cars
  for (let i = 0; i < circuit.N; i += step) {
    const s = circuit.samples[i];
    for (const side of [-1, 1]) {
      const nx = s.n.x * side, nz = s.n.z * side;
      const yaw = Math.atan2(-nx, -nz);       // model +Z faces the road
      const front = fronts.length && models.get(pick(fronts));
      if (front) {
        const shop = front.path.startsWith('real:shops/');
        const depth = shop ? BLOCK_DEPTH : front.d;
        const off = wall + 8 + depth / 2;
        const x = s.p.x + nx * off, z = s.p.z + nz * off;
        const r = Math.max(front.w, depth) * 0.55;
        if (rnd() < 0.85 && clear(x, z, r, wall + 6)) {
          if (shop) {
            // facade on the road side of its block
            const fo = off - BLOCK_DEPTH / 2 + front.d / 2;
            add(front.path, s.p.x + nx * fo, s.p.z + nz * fo, yaw);
            // the block sits just behind the facade (its front face 0.6 m back)
            const bo = off + 0.3;
            const bx = s.p.x + nx * bo, bz = s.p.z + nz * bo;
            blocks.push({ x: bx, z: bz, y: groundAt(bx, bz), yaw, w: front.w - 0.05, h: front.h - 0.1 });
          } else add(front.path, x, z, yaw);
          placed.push({ x, z, r });
          sidewalks.push({ i, side, x: s.p.x + nx * (wall + 4.2), z: s.p.z + nz * (wall + 4.2), yaw });
        }
      }
      const back = backs.length && rnd() < 0.3 && models.get(pick(backs));
      if (back) {
        const off = wall + 36 + back.d / 2 + rnd() * 20;
        const x = s.p.x + nx * off, z = s.p.z + nz * off;
        const r = Math.max(back.w, back.d) * 0.55;
        if (clear(x, z, r, wall + 20)) {
          add(back.path, x, z, yaw + (rnd() - 0.5) * 0.3);
          placed.push({ x, z, r });
        }
      }
      const trees = avail(TREES);
      if (trees.length && rnd() < 0.2) {
        const off = wall + 5.5;
        const x = s.p.x + nx * off + s.t.x * 5, z = s.p.z + nz * off + s.t.z * 5;
        if (clear(x, z, 2.5, wall + 4)) {
          add(pick(trees), x, z, rnd() * Math.PI * 2, 0.8 + rnd() * 0.4);
          placed.push({ x, z, r: 2.5 });
        }
      }
    }
  }

  // People: small groups on the pavement in front of the buildings.
  const people = avail(PEOPLE);
  let crowd = 0;
  for (const spot of sidewalks) {
    if (!people.length || crowd > 180 || rnd() < 0.4) continue;
    const n = 1 + Math.floor(rnd() * 5);
    const s = circuit.samples[spot.i];
    for (let k = 0; k < n; k++) {
      const along = (rnd() - 0.5) * 9, out = (rnd() - 0.5) * 1.6;
      const nx = s.n.x * spot.side, nz = s.n.z * spot.side;
      const x = spot.x + s.t.x * along + nx * out, z = spot.z + s.t.z * along + nz * out;
      if (distField(x, z).d < wall + 2.5) continue;
      add(pick(people), x, z, spot.yaw + (rnd() - 0.5) * 0.9, 0.92 + rnd() * 0.16);
      crowd++;
    }
  }

  // Instanced draw: one InstancedMesh per kit model.
  let count = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  for (const [key, list] of instances) {
    const path = key.split('|')[0];
    const model = models.get(path);
    model.cityMaterials = model.cityMaterials || model.parts.map((p) => p.material.clone());
    model.parts.forEach((part, pi) => {
      const mat = model.cityMaterials[pi];
      if (night && !mat.userData.nightLit && mat.map) {
        mat.userData.nightLit = true;
        // lit facades and figures so the city does not vanish after dark
        mat.emissive = new THREE.Color(0xffffff);
        mat.emissiveMap = mat.map;
        mat.emissiveIntensity = path.startsWith('people') ? 0.35 : 0.22;
      }
      const mesh = new THREE.InstancedMesh(part.geometry, mat, list.length);
      mesh.name = `city-${path.replace(/[:/]/g, '-')}`;
      mesh.castShadow = false;           // receive only: casting doubled the city's cost
      mesh.receiveShadow = true;
      list.forEach((it, k) => {
        q.setFromAxisAngle(UP, it.yaw);
        sc.setScalar(it.s);
        pv.set(it.x, it.y - 0.05, it.z);
        m4.compose(pv, q, sc);
        mesh.setMatrixAt(k, m4);
      });
      mesh.computeBoundingSphere();
      circuit.group.add(mesh);
    });
    count += list.length;
  }
  // the shopfronts' blocks: one instanced box, scaled per shop
  if (blocks.length) {
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d877d, roughness: 0.92 });
    if (night) { mat.emissive = new THREE.Color(0x2a2620); }
    const mesh = new THREE.InstancedMesh(geo, mat, blocks.length);
    mesh.name = 'city-shop-blocks';
    mesh.receiveShadow = true;
    blocks.forEach((b, k) => {
      q.setFromAxisAngle(UP, b.yaw);
      sc.set(b.w, b.h, BLOCK_DEPTH - 0.6);
      pv.set(b.x, b.y - 0.05, b.z);
      m4.compose(pv, q, sc);
      mesh.setMatrixAt(k, m4);
    });
    mesh.computeBoundingSphere();
    circuit.group.add(mesh);
  }

  // Parked cars along the kerb: the detailed models' distant-LOD copies.
  // wait for the race's own car models, then park only those (no download)
  if (carsReady) await carsReady().catch(() => {});
  const roadModels = loadedModelIds().filter((id) => !MODEL_CARS[id].race);
  let parked = 0;
  for (const spot of sidewalks) {
    if (!roadModels.length || parked >= 12 || rnd() < 0.7) continue;
    const id = pick(roadModels);
    const tpl = await loadModelTemplate(id);
    const far = tpl?.far || tpl;
    if (!far) continue;
    const s = circuit.samples[spot.i];
    const nx = s.n.x * spot.side, nz = s.n.z * spot.side;
    const x = spot.x - nx * 1.8, z = spot.z - nz * 1.8;
    if (!clear(x, z, 2.4, wall + 1.2)) continue;
    const car = new THREE.Group();
    car.name = 'city-parked-car';
    for (const mesh of parkedMeshes(id, far)) car.add(mesh.clone());
    car.position.set(x, groundAt(x, z), z);
    car.rotation.y = Math.atan2(s.t.x, s.t.z) + (rnd() < 0.5 ? Math.PI : 0);
    circuit.group.add(car);
    placed.push({ x, z, r: 2.4 });
    parked++;
  }
  return count + parked;
}

/**
 * Bodies for the traffic cars (js/traffic.js): the race's already-loaded road
 * models, flattened like the parked cars. Resolves to [] if none are loaded.
 */
export async function trafficBodies(count, seed = 1) {
  const rnd = mulberry32(seed);
  const ids = loadedModelIds().filter((id) => !MODEL_CARS[id].race);
  const out = [];
  for (let k = 0; ids.length && k < count; k++) {
    const id = ids[Math.floor(rnd() * ids.length)];
    const tpl = await loadModelTemplate(id);
    const far = tpl?.far || tpl;
    if (!far) continue;
    const body = new THREE.Group();
    body.name = 'traffic-car';
    for (const mesh of parkedMeshes(id, far)) body.add(mesh.clone());
    out.push(body);
  }
  return out;
}
