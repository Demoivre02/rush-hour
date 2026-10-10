#!/usr/bin/env node
// Read the author, licence and source link embedded in each in-house car model
// (Sketchfab writes them into the GLB's asset.extras) and write
// assets/cars/credits.json. The public build (tools/make-public-build.sh)
// publishes only the cars whose licence allows it (Creative Commons BY,
// including NC/SA variants: the game is free and credits every author), and
// the in-game Credits screen lists them.
//
//   node tools/car-credits.mjs
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'assets/cars/local-only';
const OUT = 'assets/cars/credits.json';

const credits = {};
for (const f of fs.readdirSync(SRC).filter((n) => n.endsWith('.glb')).sort()) {
  const b = fs.readFileSync(path.join(SRC, f));
  const json = JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString());
  const x = json.asset?.extras || {};
  const license = String(x.license || '').trim();
  const code = (license.match(/^CC-[A-Z-]+-\d\.\d/) || [''])[0];
  credits[f.replace(/\.glb$/, '')] = {
    title: x.title || '',
    author: String(x.author || '').replace(/\s*\(https?:[^)]*\)\s*$/, ''),
    authorUrl: (String(x.author || '').match(/\((https?:[^)]*)\)/) || [])[1] || '',
    license: code,
    licenseUrl: (license.match(/\((https?:[^)]*)\)/) || [])[1] || '',
    source: x.source || '',
    // CC BY (any variant) may be published with credit; no licence = in-house only
    publish: /^CC-BY/.test(code),
  };
}
fs.writeFileSync(OUT, JSON.stringify(credits, null, 1) + '\n');
const pub = Object.values(credits).filter((c) => c.publish).length;
console.log(`${OUT}: ${Object.keys(credits).length} cars, ${pub} publishable`);
