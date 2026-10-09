#!/usr/bin/env node
// Download the CC0 scanned surface materials used for circuit ground and
// re-encode them as WebP into textures/pbr/<surface>_{color,normal,rough}.webp.
//
//   node tools/fetch-pbr-textures.mjs
//
// Sources (all CC0 — no attribution required; recorded in ASSET_PROVENANCE.md):
//   asphalt  Poly Haven  asphalt_track    https://polyhaven.com/a/asphalt_track
//   gravel   Poly Haven  gravel_floor_02  https://polyhaven.com/a/gravel_floor_02
//   grass    ambientCG   Grass005         https://ambientcg.com/view?id=Grass005
//
// js/trackBuilder.js uses these maps when present and falls back to the
// procedural surfaces when they are not.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const OUT = path.resolve('textures/pbr');
const SIZE = { asphalt: 2048, gravel: 1024, grass: 1024 };

const POLYHAVEN = { asphalt: 'asphalt_track', gravel: 'gravel_floor_02' };
const AMBIENTCG = { grass: 'Grass005' };

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Colour adjustments per surface, applied to the colour map only. The lawn
// scan is a showroom-bright green; circuit verges read darker and less
// saturated, especially once js/colorGrade.js adds its vibrance.
const GRADE = { grass: { brightness: 0.82, saturation: 0.78 } };

async function write(surface, map, input) {
  const file = path.join(OUT, `${surface}_${map}.webp`);
  let img = sharp(input).resize(SIZE[surface], SIZE[surface]);
  if (map === 'color' && GRADE[surface]) img = img.modulate(GRADE[surface]);
  // Normal maps keep more quality: lossy artefacts there read as bumps.
  await img
    .webp({ quality: map === 'normal' ? 92 : 84 })
    .toFile(file);
  console.log(`${path.relative(process.cwd(), file).padEnd(36)} ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

fs.mkdirSync(OUT, { recursive: true });

for (const [surface, id] of Object.entries(POLYHAVEN)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const pick = (k) => files[k]['2k'].jpg.url;
  await write(surface, 'color', await download(pick('Diffuse')));
  await write(surface, 'normal', await download(pick('nor_gl')));
  await write(surface, 'rough', await download(pick('Rough')));
}

for (const [surface, id] of Object.entries(AMBIENTCG)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acg-'));
  const zip = path.join(tmp, `${id}.zip`);
  fs.writeFileSync(zip, await download(`https://ambientcg.com/get?file=${id}_2K-JPG.zip`));
  execFileSync('unzip', ['-q', '-o', zip, '-d', tmp]);
  const find = (suffix) => path.join(tmp, fs.readdirSync(tmp).find((f) => f.endsWith(suffix)));
  await write(surface, 'color', find('_Color.jpg'));
  await write(surface, 'normal', find('_NormalGL.jpg'));
  await write(surface, 'rough', find('_Roughness.jpg'));
  fs.rmSync(tmp, { recursive: true, force: true });
}
