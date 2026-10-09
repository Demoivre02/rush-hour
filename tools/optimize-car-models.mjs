#!/usr/bin/env node
// Build game-ready copies of the downloaded car models.
//
//   node tools/optimize-car-models.mjs            # every .glb in assets/cars/local-only/
//   node tools/optimize-car-models.mjs eb110      # just one
//
// For each source assets/cars/local-only/<name>.glb this writes
//   assets/cars/local-only/opt/<name>.glb      near copy: meshes joined per
//       material (fewer draw calls), welded, simplified to NEAR_TRIS, textures
//       resized to 2048 and re-encoded as WebP
//   assets/cars/local-only/opt/<name>.far.glb  far copy for the distant-car LOD
//       (55 m and beyond): cockpit parts and anything smaller than SMALL_PART of
//       the car's length removed, simplified to FAR_TRIS, textures at 512
//
// Material names are preserved, so the drop / paint / wheel lists in
// js/modelCars.js apply unchanged to both copies. js/modelCars.js prefers the
// opt/ copies and falls back to the raw download when they are missing.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, flatten, metalRough, join, prune, simplify, textureCompress, weld,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const NEAR_TRIS = 100_000;
const FAR_TRIS = 12_000;
const SMALL_PART = 0.05;
// Material names that mark cabin parts in the models we have seen so far.
const INTERIOR = /(^|[^a-z])(int|interior|cockpit|cpit|seat|steer|belt|dash|rollcage|net|pedal|gauge|lcd|motec)/i;
// Never strip anything that looks like a wheel: js/modelCars.js needs the tyres
// to place the hubs.
const KEEP = /tyre|tire|tread|sidewall|wheel|rim|opona|tie$/i;
const SRC_DIR = path.resolve('assets/cars/local-only');
const OUT_DIR = path.join(SRC_DIR, 'opt');

function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return Math.round(n);
}

// World-space bounding-box diagonal of a primitive drawn by a node.
function worldSize(prim, m) {
  const pos = prim.getAttribute('POSITION');
  const lo = pos.getMinNormalized([]);
  const hi = pos.getMaxNormalized([]);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const p = [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]];
    for (let r = 0; r < 3; r++) {
      const v = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
      min[r] = Math.min(min[r], v);
      max[r] = Math.max(max[r], v);
    }
  }
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

// Remove cabin parts and small details. Sizes are measured in world space
// without moving any geometry, so meshes shared between nodes stay intact.
function stripForDistance(doc, keep) {
  const boxes = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) boxes.push({ mesh, prim, size: worldSize(prim, m) });
  }
  const length = Math.max(...boxes.map((b) => b.size));
  const removed = new Set();
  for (const { mesh, prim, size } of boxes) {
    if (removed.has(prim)) continue;
    const name = prim.getMaterial()?.getName() || '';
    if (keep.test(name)) continue;
    if (INTERIOR.test(name) || size < length * SMALL_PART) {
      mesh.removePrimitive(prim);
      removed.add(prim);
    }
  }
  for (const prim of removed) prim.dispose();
}

async function build(io, src, out, { tris, texSize, error, far = false }) {
  const doc = await io.read(src);
  const before = triangles(doc);
  // metalRough(): some downloads use the retired spec/gloss material model,
  // which three.js no longer reads
  const specGloss = doc.getRoot().listExtensionsUsed()
    .some((e) => e.extensionName === 'KHR_materials_pbrSpecularGlossiness');
  if (specGloss) await doc.transform(metalRough());
  // Materials are NOT deduplicated: js/modelCars.js finds tyres, paint and
  // parts to drop by material name, and dedup() would merge identically-
  // configured materials (a tyre's tread and sidewall, say) under one name.
  await doc.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
    flatten(),
  );
  if (far) stripForDistance(doc, KEEP);
  await doc.transform(
    join({ keepNamed: false }),
    weld(),
  );
  const ratio = Math.min(1, tris / Math.max(1, triangles(doc)));
  if (ratio < 1) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error }));
  }
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize] }),
    prune(),
  );
  await io.write(out, doc);
  return { before, after: triangles(doc), mb: fs.statSync(out).size / 1e6 };
}

async function main() {
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const only = process.argv.slice(2);
  const names = fs.readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.glb'))
    .map((f) => f.slice(0, -4))
    .filter((n) => !only.length || only.includes(n));
  if (!names.length) {
    console.log(`no .glb models found in ${SRC_DIR}`);
    return;
  }
  for (const name of names) {
    const src = path.join(SRC_DIR, `${name}.glb`);
    const srcMb = fs.statSync(src).size / 1e6;
    const near = await build(io, src, path.join(OUT_DIR, `${name}.glb`),
      { tris: NEAR_TRIS, texSize: 2048, error: 0.004 });
    const far = await build(io, src, path.join(OUT_DIR, `${name}.far.glb`),
      { tris: FAR_TRIS, texSize: 512, error: 0.05, far: true });
    console.log(`${name.padEnd(20)} source ${near.before.toLocaleString().padStart(8)} tris ${srcMb.toFixed(1).padStart(5)} MB`
      + ` | near ${near.after.toLocaleString().padStart(8)} tris ${near.mb.toFixed(1).padStart(5)} MB`
      + ` | far ${far.after.toLocaleString().padStart(7)} tris ${far.mb.toFixed(1).padStart(5)} MB`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
