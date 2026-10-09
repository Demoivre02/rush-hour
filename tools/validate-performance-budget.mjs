#!/usr/bin/env node
// Deterministic raw-byte budget for the current boot and selected-session paths.
// This is a regression guard, not a network benchmark: CDN compression and runtime
// timing are intentionally outside its scope.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = 'index.html';

const SESSION_PHOTOS = [
  'textures/asphalt.png',
  'textures/grass.png',
  'textures/gravel.png',
  'textures/crowd.png',
  'textures/facade-day.png',
  'textures/facade-night.png',
  'textures/tree-broadleaf.png',
  'textures/tree-pine.png',
  'textures/tree-palm.png',
  'textures/scrub.png',
  // scanned CC0 ground materials (main.js PBR_SURFACES x PBR_MAPS)
  ...['asphalt', 'grass', 'gravel'].flatMap((kind) =>
    ['color', 'normal', 'rough'].map((m) => `textures/pbr/${kind}_${m}.webp`)),
];

const HDR_BY_THEME = {
  day: 'textures/hdri/day.hdr',
  dusk: 'textures/hdri/dusk.hdr',
  night: 'textures/hdri/night.hdr',
};

const SESSION_MODELS = ['assets/f1car-2026.glb'];

const SELECTED_GAMEPLAY_MODULES = [
  './race.js',
  './trackBuilder.js',
  './textures.js',
  './car.js',
];

// events.js: the arcade event table, read by the circuit menu and the race.
const ALLOWED_MENU_GAMEPLAY_ROOTS = ['three', './data.js', './format.js', './events.js'];

// These ceilings retain practical byte headroom over the July 2026 baseline
// while enforcing the runtime stages separately. The selected-session request
// ceiling includes the three deliberately separate simulation-state modules
// (track/weather, strategy/damage, and race control); keeping the count exact
// means any future request still fails this gate. The all-theme total is
// inventory-only: a selected session must still request exactly one HDR theme.
const BUDGETS = {
  htmlBytes: 2_000,
  // +4 KB for the full-width digital instrument cluster (css/style.css).
  // +3 KB for the garage screen (css/menus.css).
  // +3 KB for the arcade main menu.
  // +2 KB for the event picker, event status badge and results banner.
  // +4 KB for the career screens (tabs, wallet, dealership, reward banner).
  cssBytes: 98_000,
  menuJavaScriptBytes: 2_200_000,
  deferredJavaScriptBytes: 1_200_000,
  // October 2026: +20 KB for js/modelCars.js (25-model registry plus the
  // template pass that fits downloaded car models into the game).
  // +20 KB for the garage: js/garage.js (upgrades, paint, saved setups) and
  // js/garageView.js (the 3D showroom turntable).
  // +10 KB: car choice and garage for GT and Stock, race-car figures, handling
  // and camera fixes.
  // +10 KB: per-car AI corner speeds, photographic sky, shadow/texture
  // pre-warm and pacing changes.
  // +10 KB: 3D near trees, night driving lights, redesigned track map.
  // +20 KB / +1 module / +1 request: js/cityDressing.js (street-circuit
  // buildings, parked cars and people; its CC0 kit models load per venue).
  // +15 KB / +2 modules / +2 requests: js/events.js (Elimination, Takedown
  // Rush, Drift Challenge) and js/traffic.js (city-venue civilian traffic),
  // plus the slow-motion takedown camera.
  // +10 KB: photo-textured city pack support in js/cityDressing.js (multi-
  // material models, shopfront blocks; the pack itself is in-house only).
  // +10 KB: street furniture and night lamp pools, distance culling.
  // +20 KB / +1 module / +1 request: js/career.js and the career screens
  // (events, stars, credits, dealership, paid garage).
  // +5 KB: per-tier pixel budgets and dynamic resolution (js/quality.js).
  allJavaScriptBytes: 2_960_000,
  // October 2026: +5.4 MB / +9 requests for the scanned CC0 ground materials
  // (textures/pbr/, asphalt 2K + grass and gravel 1K, colour/normal/roughness).
  sessionPhotoBytes: 18_000_000,
  allThemeHdrBytes: 25_000_000,
  hdrOneThemeBytes: 9_300_000,
  sessionModelBytes: 700_000,
  menuBootBytes: 2_300_000,
  selectedSessionCumulativeBytes: 29_000_000,
  allThemeInventoryBytes: 44_000_000,
  // September 2026: raised by 5 modules / 6 requests for the multi-discipline
  // work. Net new subsystems are vehicleClasses.js, disciplines.js,
  // carRoster.js (the 100-car database), roadCar.js (closed-wheel car meshes),
  // gauges.js and mirrors.js; against
  // that, cameraModes.js was folded into cameraFraming.js and gamepadMap.js
  // into controls.js. Every BYTE ceiling above was left untouched and still
  // passes with headroom — this is a request-count adjustment for genuinely
  // new features, not relief for bloat. Keep the counts exact.
  // disciplines.js and carRoster.js are DEFERRED: ui.js reaches them through a
  // dynamic import when the player opens the disciplines screen, so they stay
  // out of the menu boot graph (see ALLOWED_MENU_GAMEPLAY_ROOTS above) and the
  // menu boot count is unchanged at 42.
  // October 2026: +1 module / +1 request for modelCars.js, which swaps a
  // registered GLB body onto matching road cars. The GLB itself is fetched
  // lazily, only for sessions that field a matching car, and lives in the
  // git-ignored assets/cars/local-only/, so it is not in these byte budgets.
  // +1 module / +1 request for colorGrade.js, the final contrast, vibrance
  // and sharpening pass.
  // +2 modules / +2 requests for garage.js and garageView.js.
  // +1 module / +1 request: js/speedBlur.js (radial speed blur pass).
  moduleFiles: 69,
  menuBootRequests: 65,
  selectedSessionRequests: 93,
  allThemeInventoryRequests: 95,
};

function fail(message) {
  throw new Error(message);
}

function relativeFile(input, from = ROOT) {
  const absolute = path.resolve(from, input);
  const relative = path.relative(ROOT, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`path escapes repository: ${input}`);
  }
  if (!fs.statSync(absolute, { throwIfNoEntry: false })?.isFile()) {
    fail(`required file is missing: ${relative}`);
  }
  return relative.split(path.sep).join('/');
}

function bytesOf(files) {
  return files.reduce((sum, file) => sum + fs.statSync(path.join(ROOT, file)).size, 0);
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ?? null;
}

function parseDocument(html) {
  const importMapTag = html.match(/<script\b[^>]*\btype\s*=\s*(["'])importmap\1[^>]*>([\s\S]*?)<\/script>/i);
  const imports = importMapTag ? JSON.parse(importMapTag[2]).imports ?? {} : {};

  const styles = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (attribute(tag, 'rel')?.toLowerCase() !== 'stylesheet') continue;
    const href = attribute(tag, 'href');
    if (href && !/^(?:[a-z]+:|\/\/)/i.test(href)) styles.push(relativeFile(href));
  }

  const entries = [];
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    if (attribute(tag, 'type')?.toLowerCase() !== 'module') continue;
    const src = attribute(tag, 'src');
    if (src && !/^(?:[a-z]+:|\/\/)/i.test(src)) entries.push(relativeFile(src));
  }
  if (!entries.length) fail('index.html has no local module entrypoint');

  return { imports, styles: [...new Set(styles)].sort(), entries: [...new Set(entries)].sort() };
}

function moduleSpecifiers(source) {
  const staticImports = new Set();
  const staticPatterns = [
    /\bimport\s+(?:[^'"()]*?\s+from\s*)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  ];
  for (const pattern of staticPatterns) {
    for (const match of source.matchAll(pattern)) staticImports.add(match[1]);
  }
  const dynamicImports = new Set();
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    dynamicImports.add(match[1]);
  }
  return { static: [...staticImports], dynamic: [...dynamicImports] };
}

function resolveModule(specifier, importer, importMap) {
  let target = specifier;
  let base = path.dirname(path.join(ROOT, importer));
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    target = importMap[specifier];
    if (!target) fail(`unmapped bare import '${specifier}' from ${importer}`);
    base = ROOT;
  }
  if (/^(?:[a-z]+:|\/\/)/i.test(target)) fail(`remote module is outside the source budget: ${target}`);
  return relativeFile(target, base);
}

function moduleGraph(entries, importMap, { includeDynamic = false } = {}) {
  const pending = [...entries];
  const visited = new Set();
  while (pending.length) {
    const module = pending.pop();
    if (visited.has(module)) continue;
    visited.add(module);
    const source = fs.readFileSync(path.join(ROOT, module), 'utf8');
    const specifiers = moduleSpecifiers(source);
    const dependencies = includeDynamic
      ? [...specifiers.static, ...specifiers.dynamic]
      : specifiers.static;
    for (const specifier of dependencies) {
      const dependency = resolveModule(specifier, module, importMap);
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }
  return [...visited].sort();
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString('en-US')} B (${(bytes / 1024 / 1024).toFixed(2)} MiB)`;
}

function pad(value, width) {
  return String(value).padEnd(width);
}

function sourceSection(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) fail(`cannot isolate ${label} in js/main.js`);
  return source.slice(start, end);
}

function main() {
  const html = fs.readFileSync(path.join(ROOT, INDEX), 'utf8');
  const document = parseDocument(html);
  const menuModules = moduleGraph(document.entries, document.imports);
  const photos = SESSION_PHOTOS.map(file => relativeFile(file));
  const models = SESSION_MODELS.map(file => relativeFile(file));
  const hdr = Object.fromEntries(Object.entries(HDR_BY_THEME)
    .map(([theme, file]) => [theme, { file: relativeFile(file), bytes: bytesOf([file]) }]));

  // Keep the explicit selected-session inventory and its loading boundary honest.
  const mainSource = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
  const photoManifest = mainSource.match(/const\s+photoManifest\s*=\s*\{([\s\S]*?)\n\s*\};/);
  if (!photoManifest) fail('cannot locate the selected-session photo manifest in js/main.js');
  const manifestPhotos = [...photoManifest[1].matchAll(/['"](textures\/[^'"]+\.(?:png|webp))['"]/g)]
    .map(match => match[1]).sort();
  if (JSON.stringify(manifestPhotos) !== JSON.stringify([...photos].sort())) {
    fail('SESSION_PHOTOS does not match the selected-session photo manifest in js/main.js');
  }
  // 10 photos + 9 scanned ground maps (3 surfaces x color/normal/rough)
  if (photos.length !== 19) fail(`selected-session photo manifest must contain exactly 19 files; found ${photos.length}`);

  const coreLoaderSource = sourceSection(
    mainSource,
    '\nfunction loadCoreAssets()',
    '\nfunction environmentKeyForTrack(',
    'loadCoreAssets()',
  );
  if (!/if\s*\(\s*coreAssetPromise\s*\)\s*return\s+coreAssetPromise/.test(coreLoaderSource)
      || !/Promise\.allSettled\s*\(\s*Object\.entries\(photoManifest\)/.test(coreLoaderSource)
      || !/Object\.entries\(photoManifest\)/.test(coreLoaderSource)
      || !/Promise\.all\s*\(\s*\[/.test(coreLoaderSource)
      || !/TEX\.registerPhoto\(result\.value\.key,\s*result\.value\.img\)/.test(coreLoaderSource)) {
    fail('loadCoreAssets() must cache one promise and register every photoManifest entry');
  }
  const mainSpecifiers = moduleSpecifiers(mainSource);
  const coreSpecifiers = moduleSpecifiers(coreLoaderSource);
  const sortedExpectedGameplay = [...SELECTED_GAMEPLAY_MODULES].sort();
  const sortedCoreDynamic = [...coreSpecifiers.dynamic].sort();
  if (JSON.stringify(sortedCoreDynamic) !== JSON.stringify(sortedExpectedGameplay)) {
    fail(`loadCoreAssets() must dynamically import exactly: ${sortedExpectedGameplay.join(', ')}`);
  }
  const parallelStart = coreLoaderSource.indexOf('Promise.all([');
  const parallelEnd = coreLoaderSource.indexOf(']).then(', parallelStart);
  const parallelMembers = coreLoaderSource.slice(parallelStart, parallelEnd);
  if (parallelStart < 0 || parallelEnd < 0
      || !SELECTED_GAMEPLAY_MODULES.every(specifier => parallelMembers.includes(`import('${specifier}')`))
      || !/(?:^|\n)\s*photos,?\s*$/.test(parallelMembers)) {
    fail('loadCoreAssets() must fetch gameplay modules and photos in the same Promise.all stage');
  }
  const staticGameplay = SELECTED_GAMEPLAY_MODULES.filter(specifier => mainSpecifiers.static.includes(specifier));
  if (staticGameplay.length) {
    fail(`gameplay modules must not be statically imported by js/main.js: ${staticGameplay.join(', ')}`);
  }
  if (!/RaceSession\s*=\s*raceModule\.RaceSession/.test(coreLoaderSource)
      || !/buildCircuit\s*=\s*circuitModule\.buildCircuit/.test(coreLoaderSource)
      || !/TEX\s*=\s*textureModule/.test(coreLoaderSource)
      || !/return\s+carModule\.preloadCarModel\(\)/.test(coreLoaderSource)) {
    fail('loadCoreAssets() must bind deferred gameplay modules and preload the selected-session GLB');
  }
  if ((mainSource.match(/\bloadCoreAssets\s*\(/g) || []).length !== 2
      || (mainSource.match(/\bpreloadCarModel\s*\(/g) || []).length !== 1) {
    fail('core assets must have one loader definition, one selected-session call, and one deferred model preload');
  }

  const selectedModuleRoots = SELECTED_GAMEPLAY_MODULES
    .map(specifier => resolveModule(specifier, 'js/main.js', document.imports));
  const selectedModuleClosure = moduleGraph(
    selectedModuleRoots,
    document.imports,
    { includeDynamic: true },
  );
  const menuModuleSet = new Set(menuModules);
  const leakedGameplayRoots = selectedModuleRoots.filter(module => menuModuleSet.has(module));
  if (leakedGameplayRoots.length) {
    fail(`gameplay modules leaked into the transitive menu graph: ${leakedGameplayRoots.join(', ')}`);
  }
  const allowedOverlapRoots = ALLOWED_MENU_GAMEPLAY_ROOTS
    .map(specifier => resolveModule(specifier, 'js/main.js', document.imports));
  const allowedMenuGameplayOverlap = new Set(moduleGraph(allowedOverlapRoots, document.imports));
  const unexpectedMenuOverlap = selectedModuleClosure
    .filter(module => menuModuleSet.has(module) && !allowedMenuGameplayOverlap.has(module));
  if (unexpectedMenuOverlap.length) {
    fail(`deferred gameplay dependencies leaked into the menu graph: ${unexpectedMenuOverlap.join(', ')}`);
  }
  const deferredModules = selectedModuleClosure.filter(module => !menuModuleSet.has(module));
  const allModules = [...new Set([...menuModules, ...deferredModules])].sort();
  const completeEntryGraph = moduleGraph(
    document.entries,
    document.imports,
    { includeDynamic: true },
  );
  if (JSON.stringify(allModules) !== JSON.stringify(completeEntryGraph)) {
    fail('dynamic JavaScript exists outside the selected-session gameplay-module boundary');
  }

  if (/\bloadHDRIs\b/.test(mainSource)) {
    fail('legacy all-theme HDR loader is present in js/main.js');
  }
  const hdrLoaderDefinitions = [...mainSource.matchAll(/\bfunction\s+loadHDRI\s*\(\s*key\s*\)/g)];
  const hdrLoaderReferences = [...mainSource.matchAll(/\bloadHDRI\s*\(/g)];
  if (hdrLoaderDefinitions.length !== 1 || hdrLoaderReferences.length !== 3) {
    fail('expected one keyed loadHDRI definition, one selected-track prefetch, and one cached environment application');
  }
  if (!mainSource.includes('`textures/hdri/${key}.hdr`')) {
    fail('loadHDRI must resolve a single keyed HDR path');
  }
  const hdrLoaderSource = sourceSection(
    mainSource,
    '\nfunction loadHDRI(key)',
    "\nimport { HUD }",
    'loadHDRI()',
  );
  if (!/if\s*\(\s*!HDRI\.promises\[key\]\s*\)/.test(hdrLoaderSource)
      || !/return\s+HDRI\.promises\[key\]/.test(hdrLoaderSource)) {
    fail('loadHDRI() must deduplicate the prefetch/application calls with a keyed promise cache');
  }

  const bootSource = sourceSection(
    mainSource,
    'async boot()',
    '// ---------- UI events',
    'Game.boot()',
  );
  if (/\b(?:loadCoreAssets|loadHDRI|preloadCarModel)\s*\(/.test(bootSource)
      || /\bphotoManifest\b/.test(bootSource)
      || /textures\/[^'"`]+\.(?:png|hdr)/.test(bootSource)
      || /assets\/[^'"`]+\.glb/.test(bootSource)) {
    fail('menu boot must not request photos, the GLB, or an HDR asset');
  }
  const optionalAudioGuard = bootSource.match(
    /if\s*\(\s*sampleAudio\s*&&\s*this\.audio\.loadSamplePack\s*\)\s*\{([\s\S]*?)\n\s*\}/,
  );
  if (!/new URLSearchParams\(location\.search\)\.get\(['"]sampleAudio['"]\)\s*===\s*['"]1['"]/.test(bootSource)
      || !optionalAudioGuard
      || !/this\.audio\.loadSamplePack\(['"]sounds\/['"]\)/.test(optionalAudioGuard[1])) {
    fail('optional sample audio must remain excluded unless ?sampleAudio=1 is present');
  }
  if (/\bloadSamplePack\s*\(/.test(bootSource.replace(optionalAudioGuard[0], ''))) {
    fail('menu boot contains an unguarded optional sample-audio load');
  }

  const startSessionSource = sourceSection(
    mainSource,
    '\n  startSession(cfg)',
    '\n  updateTouchControls()',
    'startSession()',
  );
  const environmentKeyDerivation = 'const environmentKey = environmentKeyForTrack(cfg.race.trackId)';
  const environmentKeyIndex = startSessionSource.indexOf(environmentKeyDerivation);
  const selectedHdrCall = 'loadHDRI(environmentKey)';
  const hdrPrefetchIndex = startSessionSource.indexOf(selectedHdrCall);
  const buildTimerIndex = startSessionSource.indexOf('setTimeout(async () =>');
  const coreAssetsIndex = startSessionSource.indexOf('await loadCoreAssets()');
  const environmentSetupIndex = startSessionSource.indexOf('this.setupEnvironment(effectsRandom, environmentKey)');
  if (environmentKeyIndex < 0 || hdrPrefetchIndex < 0 || buildTimerIndex < 0
      || coreAssetsIndex < 0 || environmentSetupIndex < 0
      || !(environmentKeyIndex < hdrPrefetchIndex
        && hdrPrefetchIndex < buildTimerIndex
        && buildTimerIndex < coreAssetsIndex
        && coreAssetsIndex < environmentSetupIndex)) {
    fail('startSession() must derive one track environment key, prefetch it in parallel, and pass it through setupEnvironment()');
  }
  if ((startSessionSource.match(/\bloadHDRI\s*\(/g) || []).length !== 1
      || (startSessionSource.match(/\bloadCoreAssets\s*\(/g) || []).length !== 1) {
    fail('startSession() must issue one HDR prefetch and one cached core-asset load');
  }

  const environmentSource = sourceSection(
    mainSource,
    '\n  setupEnvironment(',
    '// ---------- input ----------',
    'setupEnvironment()',
  );
  if (!environmentSource.includes('setupEnvironment(effectsRandom = () => Math.random(), environmentKey)')
      || (environmentSource.match(/\bloadHDRI\s*\(/g) || []).length !== 1
      || !/\bloadHDRI\s*\(\s*environmentKey\s*\)/.test(environmentSource)) {
    fail('setupEnvironment() must apply only the environmentKey passed from startSession() through the cached loader');
  }
  if ((mainSource.match(/\benvironmentKeyForTrack\s*\(/g) || []).length !== 2) {
    fail('the selected track environment key must be derived exactly once per session');
  }

  const carSource = fs.readFileSync(path.join(ROOT, 'js/car.js'), 'utf8');
  for (const file of models) {
    if (!carSource.includes(file)) fail(`selected-session model inventory is stale; ${file} is not referenced by js/car.js`);
  }

  const actual = {
    htmlBytes: bytesOf([INDEX]),
    cssBytes: bytesOf(document.styles),
    menuJavaScriptBytes: bytesOf(menuModules),
    deferredJavaScriptBytes: bytesOf(deferredModules),
    allJavaScriptBytes: bytesOf(allModules),
    sessionPhotoBytes: bytesOf(photos),
    allThemeHdrBytes: Object.values(hdr).reduce((sum, item) => sum + item.bytes, 0),
    oneThemeHdrBytes: Math.max(...Object.values(hdr).map(item => item.bytes)),
    sessionModelBytes: bytesOf(models),
    menuModuleFiles: menuModules.length,
    deferredModuleFiles: deferredModules.length,
    moduleFiles: allModules.length,
  };
  actual.menuBootPhotoBytes = 0;
  actual.menuBootModelBytes = 0;
  actual.menuBootHdrBytes = 0;
  actual.menuBootOptionalAudioBytes = 0;
  actual.menuBootBytes = actual.htmlBytes + actual.cssBytes + actual.menuJavaScriptBytes;
  actual.menuBootRequests = 1 + document.styles.length + actual.menuModuleFiles;
  actual.selectedSessionCumulativeBytes = actual.menuBootBytes
    + actual.deferredJavaScriptBytes + actual.sessionPhotoBytes
    + actual.sessionModelBytes + actual.oneThemeHdrBytes;
  actual.selectedSessionRequests = actual.menuBootRequests
    + actual.deferredModuleFiles + photos.length + models.length + 1;
  actual.allThemeInventoryBytes = actual.menuBootBytes
    + actual.deferredJavaScriptBytes + actual.sessionPhotoBytes
    + actual.sessionModelBytes + actual.allThemeHdrBytes;
  actual.allThemeInventoryRequests = actual.menuBootRequests
    + actual.deferredModuleFiles + photos.length + models.length + Object.keys(hdr).length;
  actual.deferredUntilSelectionBytes = actual.selectedSessionCumulativeBytes - actual.menuBootBytes;
  actual.avoidedAfterSelectionBytes = actual.allThemeHdrBytes - actual.oneThemeHdrBytes;

  console.log('RUSH HOUR PERFORMANCE / ASSET BUDGET');
  console.log('Raw source bytes; deterministic and independent of CDN compression.\n');
  console.log('COMPONENT INVENTORY');
  console.log(`${pad('Type', 28)} ${pad('Files/req', 9)} ${pad('Actual', 25)} Ceiling`);
  console.log(`${pad('Menu HTML', 28)} ${pad(1, 9)} ${pad(formatBytes(actual.htmlBytes), 25)} ${formatBytes(BUDGETS.htmlBytes)}`);
  console.log(`${pad('Menu CSS', 28)} ${pad(document.styles.length, 9)} ${pad(formatBytes(actual.cssBytes), 25)} ${formatBytes(BUDGETS.cssBytes)}`);
  console.log(`${pad('Menu JavaScript modules', 28)} ${pad(actual.menuModuleFiles, 9)} ${pad(formatBytes(actual.menuJavaScriptBytes), 25)} ${formatBytes(BUDGETS.menuJavaScriptBytes)}`);
  console.log(`${pad('Deferred gameplay modules', 28)} ${pad(actual.deferredModuleFiles, 9)} ${pad(formatBytes(actual.deferredJavaScriptBytes), 25)} ${formatBytes(BUDGETS.deferredJavaScriptBytes)}`);
  console.log(`${pad('All JavaScript inventory', 28)} ${pad(actual.moduleFiles, 9)} ${pad(formatBytes(actual.allJavaScriptBytes), 25)} ${formatBytes(BUDGETS.allJavaScriptBytes)}`);
  console.log(`${pad('Selected-session PNGs', 28)} ${pad(photos.length, 9)} ${pad(formatBytes(actual.sessionPhotoBytes), 25)} ${formatBytes(BUDGETS.sessionPhotoBytes)}`);
  console.log(`${pad('Selected-session car GLB', 28)} ${pad(models.length, 9)} ${pad(formatBytes(actual.sessionModelBytes), 25)} ${formatBytes(BUDGETS.sessionModelBytes)}`);
  console.log(`${pad('Largest one-theme HDR', 28)} ${pad(1, 9)} ${pad(formatBytes(actual.oneThemeHdrBytes), 25)} ${formatBytes(BUDGETS.hdrOneThemeBytes)}`);
  console.log(`${pad('All-theme HDR inventory', 28)} ${pad(Object.keys(hdr).length, 9)} ${pad(formatBytes(actual.allThemeHdrBytes), 25)} ${formatBytes(BUDGETS.allThemeHdrBytes)}`);

  console.log('\nSTAGED TOTALS');
  console.log(`${pad('Stage', 28)} ${pad('Files/req', 9)} ${pad('Actual', 25)} Ceiling`);
  console.log(`${pad('Menu boot', 28)} ${pad(actual.menuBootRequests, 9)} ${pad(formatBytes(actual.menuBootBytes), 25)} ${formatBytes(BUDGETS.menuBootBytes)}`);
  console.log(`${pad('Selected-session cumulative', 28)} ${pad(actual.selectedSessionRequests, 9)} ${pad(formatBytes(actual.selectedSessionCumulativeBytes), 25)} ${formatBytes(BUDGETS.selectedSessionCumulativeBytes)}`);
  console.log(`${pad('All-theme inventory reference', 28)} ${pad(actual.allThemeInventoryRequests, 9)} ${pad(formatBytes(actual.allThemeInventoryBytes), 25)} ${formatBytes(BUDGETS.allThemeInventoryBytes)}`);
  console.log('  menu boot excludes photos, GLB, HDR, and optional sample audio');
  console.log(`  selected-session adds ${actual.deferredModuleFiles} gameplay modules, ${photos.length} photos, ${models.length} GLB, and exactly 1 max-size HDR`);

  console.log('\nHDR COMPARISON');
  for (const [theme, item] of Object.entries(hdr)) {
    console.log(`  ${pad(theme, 7)} ${pad(formatBytes(item.bytes), 25)} ${item.file}`);
  }
  console.log(`  all     ${formatBytes(actual.allThemeHdrBytes)} (inventory reference only)`);
  console.log(`  menu    ${formatBytes(actual.menuBootHdrBytes)} (0 requests)`);
  console.log(`  one max ${formatBytes(actual.oneThemeHdrBytes)} (selected-session request)`);
  console.log(`  deferred until selection ${formatBytes(actual.deferredUntilSelectionBytes)}`);
  console.log(`  avoided after selection ${formatBytes(actual.avoidedAfterSelectionBytes)}`);

  const checks = [
    ['HTML bytes', actual.htmlBytes, BUDGETS.htmlBytes],
    ['CSS bytes', actual.cssBytes, BUDGETS.cssBytes],
    ['Menu JavaScript bytes', actual.menuJavaScriptBytes, BUDGETS.menuJavaScriptBytes],
    ['Deferred JavaScript bytes', actual.deferredJavaScriptBytes, BUDGETS.deferredJavaScriptBytes],
    ['All JavaScript bytes', actual.allJavaScriptBytes, BUDGETS.allJavaScriptBytes],
    ['Selected-session photo bytes', actual.sessionPhotoBytes, BUDGETS.sessionPhotoBytes],
    ['All-theme HDR bytes', actual.allThemeHdrBytes, BUDGETS.allThemeHdrBytes],
    ['Largest one-theme HDR bytes', actual.oneThemeHdrBytes, BUDGETS.hdrOneThemeBytes],
    ['Selected-session model bytes', actual.sessionModelBytes, BUDGETS.sessionModelBytes],
    ['Menu boot photo bytes', actual.menuBootPhotoBytes, 0],
    ['Menu boot model bytes', actual.menuBootModelBytes, 0],
    ['Menu boot HDR bytes', actual.menuBootHdrBytes, 0],
    ['Menu boot optional audio bytes', actual.menuBootOptionalAudioBytes, 0],
    ['Menu boot total bytes', actual.menuBootBytes, BUDGETS.menuBootBytes],
    ['Selected-session cumulative bytes', actual.selectedSessionCumulativeBytes, BUDGETS.selectedSessionCumulativeBytes],
    ['All-theme inventory bytes', actual.allThemeInventoryBytes, BUDGETS.allThemeInventoryBytes],
    ['Module file count', actual.moduleFiles, BUDGETS.moduleFiles],
    ['Menu boot request count', actual.menuBootRequests, BUDGETS.menuBootRequests],
    ['Selected-session request count', actual.selectedSessionRequests, BUDGETS.selectedSessionRequests],
    ['All-theme inventory request count', actual.allThemeInventoryRequests, BUDGETS.allThemeInventoryRequests],
  ];
  const failures = checks.filter(([, value, ceiling]) => value > ceiling);

  console.log('\nBUDGET CHECKS');
  for (const [label, value, ceiling] of checks) {
    const unit = label.includes('count') ? '' : ' B';
    console.log(`  ${value <= ceiling ? 'PASS' : 'FAIL'} ${label}: ${value.toLocaleString('en-US')}${unit} <= ${ceiling.toLocaleString('en-US')}${unit}`);
  }
  if (failures.length) {
    console.error(`\nPERFORMANCE BUDGET: FAIL (${failures.length} regression${failures.length === 1 ? '' : 's'})`);
    process.exitCode = 1;
  } else {
    console.log('\nPERFORMANCE BUDGET: PASS');
  }
}

try {
  main();
} catch (error) {
  console.error(`PERFORMANCE BUDGET: ERROR: ${error.message}`);
  process.exitCode = 1;
}
