#!/usr/bin/env node
// Render the car-select thumbnail for every model in js/modelCars.js into
// assets/cars/local-only/thumbs/<id>.png, using tools/model-lab.html?thumb=1
// in headless Chromium.
//
//   python3 tools/devserver.py 8341 .      # in another terminal
//   node tools/render-car-thumbs.mjs [http://localhost:8341]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { MODEL_CARS } from '../js/modelCars.js';

const base = (process.argv[2] || 'http://localhost:8341').replace(/\/$/, '');
const outDir = path.resolve('assets/cars/local-only/thumbs');
fs.mkdirSync(outDir, { recursive: true });

// The installed Google Chrome, headless: no Playwright browser download needed.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
let failed = 0;
for (const id of Object.keys(MODEL_CARS)) {
  await page.goto(`${base}/tools/model-lab.html?thumb=1&ids=${id}`);
  await page.waitForFunction(() => window.__labReady, null, { timeout: 120_000 });
  const data = await page.evaluate(() => window.__thumbData || null);
  if (!data) { console.log(`${id.padEnd(18)} FAILED`); failed++; continue; }
  const file = path.join(outDir, `${id}.png`);
  fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`${id.padEnd(18)} ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
await browser.close();
process.exit(failed ? 1 : 0);
