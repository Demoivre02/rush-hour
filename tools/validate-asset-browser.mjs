import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.CRW_BROWSER_PORT || 8452);
const providedUrl = process.env.CRW_URL;
const baseURL = providedUrl ? providedUrl.replace(/\/?$/, '/') : `http://127.0.0.1:${port}/`;
const desktopShot = process.env.CRW_DESKTOP_SHOT || '/private/tmp/coastline-rush-browser-desktop.png';
const mobileShot = process.env.CRW_MOBILE_SHOT || '/private/tmp/coastline-rush-browser-mobile.png';

if (!providedUrl && !existsSync(new URL('../dist/index.html', import.meta.url))) {
  throw new Error('dist/index.html is missing; run the public build first');
}

let server = null;
let browser = null;

async function waitForServer(url) {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready at ${url}`);
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch (error) {
    return chromium.launch({ headless: true });
  }
}

async function openStreetSelector(page) {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.nav-item[data-a="disciplines"]', { timeout: 30_000 });
  await page.click('.nav-item[data-a="disciplines"]');
  await page.waitForSelector('.disc-card[data-d="street"]', { timeout: 30_000 });
  await page.click('.disc-card[data-d="street"]');
  await page.waitForSelector('.car-card[data-c="ishara-kite"]', { timeout: 30_000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('.car-card .car-thumb img')]
      .some((img) => img.complete && img.naturalWidth > 0),
    null,
    { timeout: 15_000 },
  );
}

async function startDefaultCoastRun(page) {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.nav-item[data-a="raceNow"]', { timeout: 30_000 });
  const startCopy = await page.textContent('.nav-item[data-a="raceNow"]');
  assert.match(startCopy || '', /START YOUR ENGINE/);
  await page.click('.nav-item[data-a="raceNow"]');
  await page.waitForFunction(
    () => window.__game?.session && ['race', 'quali'].includes(window.__game.state),
    null,
    { timeout: 45_000 },
  );
  await page.evaluate(() => {
    if (window.__game.awaitingStart) window.__game.beginSessionFromGate();
  });
  await page.waitForTimeout(1200);
}

try {
  if (!providedUrl) {
    server = spawn(process.env.PYTHON || 'python3', ['-u', 'tools/devserver.py', String(port), 'dist'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  await waitForServer(baseURL);

  browser = await launchBrowser();

  const desktop = await browser.newPage({ viewport: { width: 1365, height: 768 }, deviceScaleFactor: 1 });
  const desktopErrors = [];
  desktop.on('pageerror', (error) => desktopErrors.push(String(error)));
  desktop.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource:')) {
      desktopErrors.push(msg.text());
    }
  });
  desktop.on('response', (res) => {
    if (res.status() >= 400) desktopErrors.push(`${res.status()} ${res.url()}`);
  });
  await desktop.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('apexf1_onboarding_v1', '1');
    localStorage.setItem('apexf1_settings', JSON.stringify({
      autoPause: false,
      graphicsQuality: 'low',
      mirrors: true,
      nametags: true,
      volume: 0,
    }));
  });
  await openStreetSelector(desktop);
  const selectorStats = await desktop.evaluate(() => ({
    activeScreen: document.querySelector('.screen.active')?.id || null,
    carCards: document.querySelectorAll('.car-card').length,
    thumbImgs: document.querySelectorAll('.car-card .car-thumb img').length,
    loadedThumbs: [...document.querySelectorAll('.car-card .car-thumb img')]
      .filter((img) => img.complete && img.naturalWidth > 0).length,
  }));
  assert.equal(selectorStats.activeScreen, 'screen-car');
  assert.equal(selectorStats.carCards, 60);
  assert.equal(selectorStats.thumbImgs, 60);
  assert.ok(selectorStats.loadedThumbs > 0, 'visible car thumbnails should load');

  await startDefaultCoastRun(desktop);
  const desktopInfo = await desktop.evaluate(async () => {
    const game = window.__game;
    const player = game.session.player;
    const phys = player.phys;
    const canvas = document.querySelector('#app canvas');
    const { CAMERA_FRAMING, CAMERA_MODES, cameraModeSpec } = await import('./js/cameraFraming.js');
    const bodyVariants = new Set();
    const colourVariants = new Set();
    for (const entry of game.session.entries) {
      if (entry.rosterCar?.body) bodyVariants.add(entry.rosterCar.body);
      if (entry.rosterCar?.colour) colourVariants.add(entry.rosterCar.colour);
    }
    const sample = game.circuit.samples[phys.sampleIdx];
    const trackHeading = Math.atan2(sample.t.x, sample.t.z);
    const old = {
      heading: phys.heading,
      v: phys.v,
      velocityLat: phys.velocityLat,
      sideslip: phys.sideslip,
      yawRate: phys.yawRate,
      impactKick: phys.impactKick,
      wallHit: phys.wallHit,
      wallContact: phys.wallContact,
      wallScrape: phys.wallScrape,
      carScrape: phys.carScrape,
      offTrack: phys.offTrack,
    };
    phys.heading = trackHeading + Math.PI / 2;
    phys.v = 22;
    phys.velocityLat = 0;
    phys.sideslip = 0.7;
    phys.yawRate = 2.2;
    phys.impactKick = 1;
    phys.wallHit = 1;
    phys.wallContact = true;
    phys.wallScrape = 1;
    phys.carScrape = 1;
    phys.offTrack = true;
    const recoveredHeading = game._chaseHeadingFor(phys, null);
    const yawRecoveryError = Math.abs(Math.atan2(
      Math.sin(recoveredHeading - trackHeading),
      Math.cos(recoveredHeading - trackHeading),
    ));
    phys.heading = old.heading;
    phys.v = old.v;
    phys.velocityLat = old.velocityLat;
    phys.sideslip = old.sideslip;
    phys.yawRate = old.yawRate;
    phys.impactKick = old.impactKick;
    phys.wallHit = old.wallHit;
    phys.wallContact = old.wallContact;
    phys.wallScrape = old.wallScrape;
    phys.carScrape = old.carScrape;
    phys.offTrack = old.offTrack;
    return {
      state: game.state,
      mode: game.session.mode,
      entries: game.session.entries.length,
      playerCar: player.rosterCar?.id || null,
      bodySource: player.carHandle?.source || null,
      topSkin: {
        player: !!player.carHandle?.body?.getObjectByName('topSkin'),
        loaded: player.carHandle?.body?.getObjectByName('topSkin')?.material?.map?.image?.complete === true ||
          !!player.carHandle?.body?.getObjectByName('topSkin')?.material?.map?.image?.width,
        opaque: player.carHandle?.body?.getObjectByName('topSkin')?.material?.transparent === false,
      },
      profileClass: player.phys.profile?.classId || player.phys.profile?.id || null,
      soundFamily: player.rosterCar?.soundFamily || player.phys.profile?.soundFamily || null,
      contactHalfLength: player.phys.contactHalfLength,
      contactHalfWidth: player.phys.contactHalfWidth,
      cameraMode: cameraModeSpec(game.camMode).id,
      cameraModes: CAMERA_MODES.map((mode) => mode.id),
      headingAimWeight: CAMERA_FRAMING.headingAimWeight,
      aheadAimWeight: CAMERA_FRAMING.aheadAimWeight,
      yawRecoveryError,
      bodyVariants: bodyVariants.size,
      colourVariants: colourVariants.size,
      gauges: document.querySelectorAll('#gaugecluster svg.gauge').length,
      mirrorsEnabled: game.mirrors?.enabled === true && game.hud?.mirrorsEnabled !== false,
      canvas: canvas ? {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
      } : null,
    };
  });
  assert.equal(desktopInfo.state, 'race');
  assert.equal(desktopInfo.entries, 12);
  assert.equal(desktopInfo.playerCar, 'alviero-tempesta');
  assert.equal(desktopInfo.bodySource, 'road-primitive');
  assert.equal(desktopInfo.topSkin.player, true);
  assert.equal(desktopInfo.topSkin.loaded, true);
  assert.equal(desktopInfo.topSkin.opaque, true);
  assert.equal(desktopInfo.profileClass, 'hyper');
  assert.equal(desktopInfo.soundFamily, 'v12');
  assert.ok(desktopInfo.contactHalfLength > 1.3 && desktopInfo.contactHalfWidth > 0.5);
  assert.equal(desktopInfo.cameraMode, 'chase');
  assert.ok(desktopInfo.headingAimWeight >= 0.9 && desktopInfo.aheadAimWeight <= 0.1);
  assert.ok(desktopInfo.yawRecoveryError < 0.12,
    `chase camera should stay aligned after a yawed wall hit (${desktopInfo.yawRecoveryError})`);
  assert.ok(desktopInfo.bodyVariants >= 4, 'default road grid should include every available hypercar body family');
  assert.ok(desktopInfo.colourVariants >= 6, 'default road grid should include varied paint colours');
  for (const id of ['chase-near', 'chase', 'chase-far', 'cockpit', 't-cam', 'nose']) {
    assert.ok(desktopInfo.cameraModes.includes(id), `missing camera mode ${id}`);
  }
  assert.equal(desktopInfo.gauges, 2);
  assert.equal(desktopInfo.mirrorsEnabled, true);
  assert.ok(desktopInfo.canvas?.width > 600 && desktopInfo.canvas?.height > 350);
  await desktop.screenshot({ path: desktopShot });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mobileErrors = [];
  mobile.on('pageerror', (error) => mobileErrors.push(String(error)));
  mobile.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource:')) {
      mobileErrors.push(msg.text());
    }
  });
  await mobile.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('apexf1_onboarding_v1', '1');
  });
  await openStreetSelector(mobile);
  await mobile.waitForTimeout(500);
  const mobileInfo = await mobile.evaluate(() => {
    const cards = [...document.querySelectorAll('.car-card')];
    const first = cards[0]?.getBoundingClientRect();
    const active = document.querySelector('.screen.active');
    const title = active?.querySelector('.menu-header .title');
    const titleRect = title?.getBoundingClientRect();
    return {
      viewport: [innerWidth, innerHeight],
      activeScreen: active?.id || null,
      carCards: cards.length,
      thumbImgs: document.querySelectorAll('.car-thumb img').length,
      loadedThumbs: [...document.querySelectorAll('.car-thumb img')]
        .filter((img) => img.complete && img.naturalWidth > 0).length,
      scrollWidth: document.scrollingElement.scrollWidth,
      firstCard: first ? {
        x: Math.round(first.x),
        y: Math.round(first.y),
        width: Math.round(first.width),
        height: Math.round(first.height),
        right: Math.round(first.right),
      } : null,
      title: titleRect ? {
        x: Math.round(titleRect.x),
        y: Math.round(titleRect.y),
        width: Math.round(titleRect.width),
        right: Math.round(titleRect.right),
        scrollWidth: title.scrollWidth,
        clientWidth: title.clientWidth,
      } : null,
    };
  });
  assert.deepEqual(mobileInfo.viewport, [390, 844]);
  assert.equal(mobileInfo.activeScreen, 'screen-car');
  assert.equal(mobileInfo.carCards, 60);
  assert.equal(mobileInfo.thumbImgs, 60);
  assert.ok(mobileInfo.loadedThumbs > 0, 'mobile visible thumbnails should load');
  assert.ok(mobileInfo.scrollWidth <= 392, `mobile layout overflows horizontally (${mobileInfo.scrollWidth}px)`);
  assert.ok(mobileInfo.firstCard?.x >= 0 && mobileInfo.firstCard?.right <= 390);
  assert.ok(mobileInfo.title?.x >= 0 && mobileInfo.title?.right <= 390);
  assert.ok(mobileInfo.title?.scrollWidth <= mobileInfo.title?.clientWidth + 2);
  await mobile.screenshot({ path: mobileShot });

  assert.deepEqual(desktopErrors, []);
  assert.deepEqual(mobileErrors, []);
  console.log('[asset-browser] PASS', JSON.stringify({
    selectorStats,
    desktopInfo,
    mobileInfo,
    screenshots: { desktop: desktopShot, mobile: mobileShot },
  }, null, 2));
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
