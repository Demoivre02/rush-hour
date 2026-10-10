// Menu system: main, team/driver select, track select, settings, loading,
// quali results, race results, championship standings, pause.
import { EVENTS, eventSpec } from './events.js';
import { TEAMS, DRIVERS, CALENDAR, SEASON } from './data.js';
import { TRACKS } from './tracks.js';
// js/disciplines.js pulls in the 100-car database, so it is imported lazily —
// the menu must not carry gameplay data on its boot path.
const FORMULA_SPEC = Object.freeze({
  id: 'formula', label: 'Formula', carSource: 'teams', vehicleClass: 'formula',
  tracks: Object.freeze([]),
  format: Object.freeze({ qualifying: true, pitStops: true, timeAttack: false }),
});
import { fmtTime } from './format.js';

const FLAGS = {
  melbourne: '🇦🇺', shanghai: '🇨🇳', suzuka: '🇯🇵', bahrain: '🇧🇭', jeddah: '🇸🇦',
  miami: '🇺🇸', montreal: '🇨🇦', monaco: '🇲🇨', barcelona: '🇪🇸', spielberg: '🇦🇹',
  silverstone: '🇬🇧', spa: '🇧🇪', hungaroring: '🇭🇺', zandvoort: '🇳🇱', monza: '🇮🇹',
  madrid: '🇪🇸', baku: '🇦🇿', singapore: '🇸🇬', austin: '🇺🇸', mexico: '🇲🇽',
  interlagos: '🇧🇷', lasvegas: '🇺🇸', lusail: '🇶🇦', yasmarina: '🇦🇪',
};
const TIPS = [
  '2026 regs: X-mode slashes drag on the straights — it engages automatically when you hold full throttle with the wheel straight.',
  'MANUAL OVERRIDE (hold SPACE) deploys 350kW of electric power — the 2026 replacement for DRS. Watch your battery.',
  'Harvest energy under braking. Your MGU-K recovers up to twice the energy of the old regulations.',
  'Soft tyres are ~1s per lap faster but degrade quickly. Plan your pit window with P (BOX THIS LAP).',
  'Slipstream gives you reduced drag down the straights — get within a second of the car ahead.',
  'The 2026 cars are 30kg lighter and nimbler than the previous generation.',
  'Kerbs are part of the track — but grass and gravel are not. Track limits cost you lap time.',
  'Following closely through corners costs downforce (dirty air). Time your attack for the next straight.',
];
const DEFAULT_SETTINGS = {
  difficulty: 1, distance: 0, quali: true, tc: true, abs: true, autoGear: true,
  nametags: true, volume: 1, musicVolume: 0.8, graphicsQuality: 'auto', cameraProfile: 'broadcast',
  autoPause: true, touchControls: true, steeringResponse: 'balanced',
  cockpitFov: 'natural', cockpitSeat: 'standard', headMotion: true,
};
const PILOT_DRIVER_ID = 'hacker';
const PILOT_TRACK_ID = 'spa';
const teamById = Object.fromEntries(TEAMS.map(t => [t.id, t]));

// Power-unit marque glyphs (decorative text badges — no image assets).
// Derived from the ACTIVE roster's engine list so no marque names live in the
// source; anything unmapped falls back to '⬣'.
const ENGINE_GLYPH = (() => {
  const glyphs = ['◈', '✦', '▲', '◆', '▬', '●', '■'];
  const marques = [...new Set(TEAMS.map(t => t.engine))].sort();
  return Object.fromEntries(marques.map((m, i) => [m, glyphs[i % glyphs.length]]));
})();


// Venue label: each APEX calendar round carries an invented `circuitName`.
function circuitLabel(race, track) {
  return (race && race.circuitName) || (track && track.name) || '';
}

// ---- venue classification -------------------------------------------------
// These two tables MIRROR js/trackBuilder.js (STREET + TRACK_THEME) so the menu
// badges match the circuit you actually get dropped into. Kept as local copies
// on purpose: trackBuilder imports three.js and must not be pulled into the
// menu module graph.
const STREET_TRACKS = new Set([
  'monaco', 'baku', 'singapore', 'jeddah', 'lasvegas', 'miami', 'montreal', 'madrid',
]);
const TRACK_THEME = {
  bahrain: 'dusk', jeddah: 'night', lusail: 'night', singapore: 'night', lasvegas: 'night',
  yasmarina: 'dusk', qatar: 'night', mexico: 'classic', miami: 'city', baku: 'city',
  monaco: 'city', madrid: 'city', montreal: 'classic', melbourne: 'classic', shanghai: 'classic',
  suzuka: 'classic', barcelona: 'classic', spielberg: 'classic', silverstone: 'classic',
  spa: 'classic', hungaroring: 'classic', zandvoort: 'classic', monza: 'classic',
  austin: 'classic', interlagos: 'classic',
};

export class UI {
  constructor(cb) {
    this.cb = cb;   // (action, payload) => {}
    this.settings = this._loadSettings();
    this.lastSelection = this._loadLastSelection();
    this.sel = {
      driverId: this.lastSelection?.driverId || PILOT_DRIVER_ID,
      trackId: this.lastSelection?.trackId || PILOT_TRACK_ID,
      mode: 'quick',
      // 'formula' is the original championship game; the other disciplines
      // swap the vehicle class, the venues and (for road cars) the field.
      discipline: 'formula',
      carId: null,
    };
    this.screens = {};
    for (const id of ['main', 'career', 'discipline', 'car', 'garage', 'team', 'track', 'settings', 'standings', 'loading', 'results', 'pause', 'boot']) {
      this.screens[id] = document.getElementById('screen-' + id);
    }
    this._factTimer = null;
    this._installMenuKeys();
  }

  // Arrow-key / Enter navigation across every menu screen (spatial: nearest
  // element in the pressed direction). Uses e.key so it works even where
  // e.code is missing. Home/End jump to the ends of the list; Escape or
  // Backspace triggers the screen's own back / main-menu button.
  _installMenuKeys() {
    window.addEventListener('keydown', (e) => {
      const key = e.key === ' ' ? 'Space' : e.key;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Home', 'End', 'Escape', 'Backspace'].includes(key)) return;
      const screen = document.querySelector('#ui-root .screen.active');
      if (!screen || screen.id === 'screen-boot' ||
          (screen.id === 'screen-loading' && !screen.classList.contains('load-error-screen'))) return;
      const items = [...screen.querySelectorAll('.nav-item, .drv, .track-card, .f1-btn:not(:disabled), .seg button, .tyre-btn, [data-navitem]')]
        .filter(el => el.offsetParent !== null);
      if (key === 'Escape' || key === 'Backspace') {
        // graceful "go back" on every menu screen that offers one
        const back = screen.querySelector('#btn-back') || screen.querySelector('#btn-menu');
        if (!back) return;                              // e.g. pause: let main.js handle ESC
        e.preventDefault();
        back.click();
        return;
      }
      if (!items.length) return;
      e.preventDefault();
      let cur = screen._navFocus && items.includes(screen._navFocus) ? screen._navFocus : null;
      if (key === 'Enter') {
        (cur || items[0]).click();
        return;
      }
      if (key === 'Home') { this._setNavFocus(screen, items[0]); return; }
      if (key === 'End') { this._setNavFocus(screen, items[items.length - 1]); return; }
      if (!cur) {
        this._setNavFocus(screen, items[0]);
        return;
      }
      const cr = cur.getBoundingClientRect();
      const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
      const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[key];
      let best = null, bestScore = Infinity;
      for (const el of items) {
        if (el === cur) continue;
        const r = el.getBoundingClientRect();
        const dx = (r.left + r.width / 2) - cx, dy = (r.top + r.height / 2) - cy;
        const along = dx * dir[0] + dy * dir[1];
        if (along < 4) continue;                       // must lie in that direction
        const ortho = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
        const score = along + ortho * 2.2;
        if (score < bestScore) { bestScore = score; best = el; }
      }
      if (best) this._setNavFocus(screen, best);
    });
  }

  _setNavFocus(screen, el) {
    if (screen._navFocus) screen._navFocus.classList.remove('kb-focus');
    screen._navFocus = el;
    el.classList.add('kb-focus');
    // Keep the DOM focus ring and assistive-technology cursor aligned with the
    // spatial navigation highlight instead of maintaining a visual-only focus.
    el.focus?.({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    this.cb('uiclick');
  }

  _loadSettings() {
    try {
      return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem('apexf1_settings') || '{}'));
    } catch { return { ...DEFAULT_SETTINGS }; }
  }
  saveSettings() {
    try { localStorage.setItem('apexf1_settings', JSON.stringify(this.settings)); } catch {}
  }
  _loadLastSelection() {
    try {
      const saved = JSON.parse(localStorage.getItem('apexf1_last_race') || 'null');
      if (!saved || !DRIVERS.some(d => d.id === saved.driverId) || !TRACKS[saved.trackId]) return null;
      return { driverId: saved.driverId, trackId: saved.trackId };
    } catch { return null; }
  }
  _saveLastSelection() {
    if (!this.sel.driverId || !this.sel.trackId) return;
    this.lastSelection = { driverId: this.sel.driverId, trackId: this.sel.trackId };
    try { localStorage.setItem('apexf1_last_race', JSON.stringify(this.lastSelection)); } catch {}
  }

  showOnly(id) {
    if (id !== 'loading') this._stopFacts();
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('active', k === id);
  }
  hideAll() {
    this._stopFacts();
    // the garage owns a WebGL context; free it whenever another screen opens
    if (this._garageView) { this._garageView.dispose(); this._garageView = null; }
    for (const el of Object.values(this.screens)) el.classList.remove('active');
  }

  raceLapsFor(trackId) {
    const cal = CALENDAR.find(r => r.trackId === trackId);
    const full = cal ? cal.laps : 50;
    return [5, Math.max(3, Math.round(full * 0.25)), Math.max(5, Math.round(full * 0.5)), full][this.settings.distance];
  }

  // ---- presentation helpers ----------------------------------------------
  // Restart the screen-enter animation. Setting className already dropped
  // `screen-in`; a forced reflow guarantees the keyframes replay even when the
  // same screen is shown twice in a row.
  _enter(el) {
    if (!el || !el.classList) return;
    el.classList.remove('screen-in');
    void el.offsetWidth;
    el.classList.add('screen-in');
  }

  _reducedMotion() {
    try {
      return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch { return false; }
  }

  // Points count-up for the player's results row.
  _countUp(el, to, dur = 750) {
    if (!el) return;
    const target = Number(to) || 0;
    if (target <= 0 || typeof requestAnimationFrame !== 'function' || this._reducedMotion()) {
      el.textContent = target ? String(target) : '';
      return;
    }
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const step = () => {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const k = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(target * eased));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  _stopFacts() {
    if (this._factTimer !== null) {
      clearInterval(this._factTimer);
      this._factTimer = null;
    }
  }

  // ============ MAIN ============
  showMain(champ) {
    this.hideAll();
    const el = this.screens.main;
    el.className = 'screen active menu-screen main-screen arcade-main';
    const champSub = champ && champ.active
      ? `Continue round ${champ.roundIndex + 1} of 24 · ${champ.nextRace.gp}`
      : champ && champ.finished ? `Season complete · view the final ${SEASON} standings`
        : `The ${SEASON} open-wheel season · 24 rounds · points battle`;
    const champAction = champ && champ.finished ? 'standings' : 'champ';
    const last = this.settings.lastCar;
    el.innerHTML = `
      <canvas class="main-showroom" id="main-showroom" aria-hidden="true"></canvas>
      <div class="main-shade" aria-hidden="true"></div>
      <div class="main-brand">
        <h1>RUSH<em>HOUR</em></h1>
        <p>Street · GT · Hypercar · Stock · Formula</p>
      </div>
      <div class="main-car" id="main-car"></div>
      <nav class="main-tiles" aria-label="Main menu">
        <button type="button" class="nav-item tile tile-play race-now" data-a="raceNow">
          <span><h3>PLAY NOW</h3><p>START YOUR ENGINE · ${last ? 'your car' : 'Skyline GT-R R34'} · Miami street circuit</p></span>
        </button>
        <button type="button" class="nav-item tile tile-career" data-a="career">
          <span><h3>CAREER</h3><p>Win events, earn credits, buy and upgrade cars · classes D to S</p></span>
        </button>
        <button type="button" class="nav-item tile tile-modes" data-a="disciplines">
          <span><h3>RACE MODES</h3><p>Free play: any car, free upgrades, any venue</p></span>
        </button>
        <div class="tile-row">
          <button type="button" class="nav-item tile tile-small tile-formula" data-a="${champAction}"><span><h3>FORMULA CUP</h3><p>${champSub}</p></span></button>
          <button type="button" class="nav-item tile tile-small" data-a="trial"><span><h3>TIME TRIAL</h3><p>Chase the perfect lap</p></span></button>
          <button type="button" class="nav-item tile tile-small" data-a="pilot"><span><h3>RACE WEEKEND</h3><p>Practice · qualifying · race</p></span></button>
          ${champ && champ.active ? '<button type="button" class="nav-item tile tile-small" data-a="standings"><span><h3>STANDINGS</h3><p>Formula Cup tables</p></span></button>' : ''}
          ${champ && champ.finished ? '<button type="button" class="nav-item tile tile-small" data-a="champNew"><span><h3>NEW SEASON</h3><p>Fresh Formula Cup</p></span></button>' : ''}
          <button type="button" class="nav-item tile tile-small" data-a="settings"><span><h3>SETTINGS</h3><p>Controls · graphics · assists</p></span></button>
        </div>
      </nav>
      <div class="menu-footer main-footer">
        <span class="key-hint"><b>↑ ↓ ← →</b> drive</span>
        <span class="key-hint"><b>SPACE</b> nitro</span>
        <span class="key-hint"><b>C</b> camera</span>
        <span class="key-hint"><b>ESC</b> pause</span>
        <span class="key-hint pad-hint"><b>PAD</b> stick/D-pad navigate · A/Cross confirm</span>
      </div>`;
    el.querySelectorAll('.nav-item').forEach(n =>
      n.addEventListener('click', () => {
        const a = n.dataset.a;
        if (a === 'champNew') this.cb('champNew');
        else this.cb('menu', a);
      }));
    this._enter(el);
    this._mainShowroom(el, last);
  }

  // The main menu stands the player's last car (painted and tuned as they left
  // it) on a turning platform behind the tiles.
  async _mainShowroom(el, last) {
    try {
      const [{ carsForDiscipline }, G] = await Promise.all([this.loadDisciplines(), import('./garage.js')]);
      if (!el.classList.contains('active')) return;
      const discipline = last?.discipline && last.discipline !== 'formula' ? last.discipline : 'street';
      const stock = carsForDiscipline(discipline).find((c) => c.id === last?.carId)
        || carsForDiscipline('street').find((c) => c.id === 'model-r34');
      if (!stock) return;
      const car = G.tunedCar(stock);
      const canvas = el.querySelector('#main-showroom');
      if (!canvas) return;
      const view = new G.GarageView(canvas);
      this._garageView = view;            // hideAll() disposes it with the screen
      view.camera.position.set(-6.8, 1.6, 6.6);
      view.camera.lookAt(0.9, 0.6, 0);
      const label = el.querySelector('#main-car');
      if (label) {
        const p = car.performance;
        label.innerHTML = `<span class="g-class c-${p.performance_class}">${p.performance_class}</span>
          <div><b>${car.make} ${car.model}</b><small>${p.power_hp} HP · PI ${p.performance_index}</small></div>`;
      }
      await view.setCar(car);
    } catch (e) { /* the menu works without the showroom */ }
  }

  // ============ TEAM SELECT ============
  showTeamSelect(mode) {
    this.hideAll();
    this.sel.mode = mode;
    const el = this.screens.team;
    el.className = 'screen active menu-screen';
    el.innerHTML = `
      ${header('CHOOSE YOUR <small>DRIVER</small>')}
      <div class="menu-body"><div class="card-grid" id="team-grid"></div>
        <div class="btn-row">
          <button class="f1-btn ghost" id="btn-back"><span>← BACK</span></button>
          <button class="f1-btn" id="btn-next" disabled><span>CONTINUE →</span></button>
        </div>
      </div>
      <div class="menu-footer"><span>${SEASON} grid — ${TEAMS.length} teams · ${DRIVERS.length} drivers · original line-ups</span>
        <span style="margin-left:auto">Hover or focus a driver for pace / consistency / racecraft</span></div>`;
    const grid = el.querySelector('#team-grid');
    for (const team of TEAMS) {
      const drs = DRIVERS.filter(d => d.team === team.id);
      const card = document.createElement('div');
      card.className = 'select-card';
      const col = hex(team.color);
      const acc = hex(team.accent);
      const ink = readable(team.color);   // legible tint for text-sized elements
      card.innerHTML = `
        <div class="stripe" style="background:linear-gradient(90deg, ${col}, ${acc})"></div>
        <div class="card-body">
          <h4>${team.name}</h4>
          <div class="sub">${team.engine} power unit</div>
          <div class="badge-row">
            <span class="engine-badge" title="${team.engine} power unit"><i class="engine-glyph" style="color:${ink}">${ENGINE_GLYPH[team.engine] || '⬣'}</i>${team.engine}</span>
            <span class="livery-chips" title="Car livery">${liveryChips(team)}</span>
          </div>
          <div class="drivers">
            ${drs.map(d => `<div class="drv" data-d="${d.id}" role="radio" tabindex="0" aria-checked="false" aria-label="${d.firstName} ${d.lastName}, number ${d.num}">
              <div class="drv-top">
                <span class="num" style="color:${ink}">${d.num}</span>
                <span class="drv-name">${d.firstName} ${d.lastName}</span><span class="code">${d.code}</span>
              </div>
              <div class="drv-stats">
                ${statBar('PAC', d.pace)}${statBar('CON', d.consistency)}${statBar('RCF', d.racecraft)}
              </div>
            </div>`).join('')}
          </div>
          <div class="perf-row"><span class="perf-lbl">CAR</span>
            <div class="perfbar"><div style="width:${(team.perf - 0.88) / 0.12 * 100}%;background:linear-gradient(90deg,${col},${acc})"></div></div>
            <span class="perf-val">${Math.round((team.perf - 0.88) / 0.12 * 100)}</span></div>
        </div>`;
      grid.appendChild(card);
    }
    grid.addEventListener('click', ev => {
      const drv = ev.target.closest('.drv');
      if (!drv) return;
      grid.querySelectorAll('.drv.selected, .select-card.selected').forEach(x => x.classList.remove('selected'));
      grid.querySelectorAll('.drv[aria-checked="true"]').forEach(x => x.setAttribute('aria-checked', 'false'));
      drv.classList.add('selected');
      drv.setAttribute('aria-checked', 'true');
      drv.closest('.select-card').classList.add('selected');
      this.sel.driverId = drv.dataset.d;
      el.querySelector('#btn-next').disabled = false;
      this.cb('uiclick');
    });
    grid.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const drv = ev.target.closest('.drv');
      if (!drv) return;
      ev.preventDefault();
      drv.click();
    });
    el.querySelector('#btn-back').addEventListener('click', () => this.cb('back', 'main'));
    el.querySelector('#btn-next').addEventListener('click', () => {
      if (!this.sel.driverId) return;
      this.cb('teamChosen', { driverId: this.sel.driverId, mode: this.sel.mode });
    });
    // restore a previous selection (e.g. after backing out of circuit select)
    if (this.sel.driverId) {
      const prev = grid.querySelector(`.drv[data-d="${this.sel.driverId}"]`);
      if (prev) {
        prev.classList.add('selected');
        prev.setAttribute('aria-checked', 'true');
        prev.closest('.select-card').classList.add('selected');
        el.querySelector('#btn-next').disabled = false;
      }
    }
    this._enter(el);
  }

  // ============ TRACK SELECT ============
  // `champ` is optional: when a career is running its next round gets a badge.
  // ============ DISCIPLINES ============
  /** Lazily load the discipline/roster module; cached after the first open. */
  async loadDisciplines() {
    if (!this._discMod) this._discMod = await import('./disciplines.js');
    return this._discMod;
  }

  /** Synchronous view of a discipline, safe before the module has loaded. */
  disciplineSpec(id = this.sel.discipline) {
    if (!id || id === 'formula' || !this._discMod) return FORMULA_SPEC;
    return this._discMod.discipline(id);
  }

  async showDisciplineSelect() {
    const { DISCIPLINES, DISCIPLINE_ORDER, discipline, carsForDiscipline } = await this.loadDisciplines();
    this.hideAll();
    const el = this.screens.discipline;
    el.className = 'screen active menu-screen';
    const cards = DISCIPLINE_ORDER.map((id) => {
      const d = DISCIPLINES[id];
      const cars = carsForDiscipline(id);
      const fleet = cars.length ? `${cars.length} cars` : 'Spec field';
      return `<div class="select-card disc-card" role="button" tabindex="0" data-d="${id}">
        <div class="card-body">
          <h4>${d.label}</h4>
          <div class="sub">${d.tagline}</div>
          <p class="disc-blurb">${d.blurb}</p>
          <div class="tstats">
            <span class="tstat"><b>${d.tracks.length}</b><i>VENUE${d.tracks.length === 1 ? '' : 'S'}</i></span>
            <span class="tstat"><b>${d.gridSize}</b><i>GRID</i></span>
            <span class="tstat"><b>${fleet.split(' ')[0]}</b><i>${cars.length ? 'CARS' : 'FIELD'}</i></span>
          </div>
        </div></div>`;
    }).join('');
    el.innerHTML = `
      ${header('RACING <small>DISCIPLINES</small>')}
      <div class="menu-body"><div class="card-grid disc-grid">${cards}</div>
        <div class="btn-row"><button class="f1-btn ghost" id="btn-back"><span>← BACK</span></button></div>
      </div>
      <div class="menu-footer"><span>Each discipline runs its own vehicle physics — downforce, mass, tyres and gearing all change</span></div>`;
    el.querySelectorAll('.disc-card').forEach((card) => {
      const go = () => {
        this.sel.discipline = card.dataset.d;
        this.sel.carId = null;
        const d = discipline(this.sel.discipline);
        if (!d.tracks.includes(this.sel.trackId)) this.sel.trackId = d.tracks[0];
        this.cb('disciplineChosen', { ...this.sel });
      };
      card.addEventListener('click', go);
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
      });
    });
    el.querySelector('#btn-back').addEventListener('click', () => this.cb('back', 'main'));
    this._enter(el);
  }

  // ============ CAR SELECT (roster disciplines) ============
  async showCarSelect() {
    const { discipline, carsForDiscipline } = await this.loadDisciplines();
    this.hideAll();
    const el = this.screens.car;
    el.className = 'screen active menu-screen';
    const d = discipline(this.sel.discipline);
    const cars = carsForDiscipline(this.sel.discipline)
      .sort((a, b) => a.performance.performance_index - b.performance.performance_index);
    const cards = cars.map((c) => `
      <div class="select-card car-card" role="button" tabindex="0" data-c="${c.id}"
           aria-label="${c.name}, ${c.performance.power_hp} horsepower">
        <div class="car-thumb"><img src="${carThumb(c)}" alt="" loading="lazy"></div>
        <div class="car-swatch" style="background:${c.colour};border-color:${c.accent}"></div>
        <div class="card-body">
          <h4>${c.model}</h4>
          <div class="sub">${c.make} · ${c.year} · ${c.engine}</div>
          <div class="tstats">
            <span class="tstat"><b>${c.performance.power_hp}</b><i>HP</i></span>
            <span class="tstat"><b>${c.performance.weight_kg}</b><i>KG</i></span>
            <span class="tstat"><b>${c.performance.accel_0_100_kmh_s}</b><i>0-100</i></span>
            <span class="tstat"><b>${c.performance.performance_index}</b><i>PI</i></span>
          </div>
          <div class="meta"><span>${c.performance.drivetrain}</span><span>${c.performance.top_speed_kmh} km/h</span></div>
        </div></div>`).join('');
    el.innerHTML = `
      ${header(`${d.label.toUpperCase()} <small>SELECT CAR</small>`)}
      <div class="menu-body"><div class="card-grid car-grid">${cards}</div>
        <div class="btn-row"><button class="f1-btn ghost" id="btn-back"><span>← BACK</span></button></div>
      </div>
      <div class="menu-footer"><span>${cars.length} cars · the grid is matchmade to the car you pick</span></div>`;
    el.querySelectorAll('.car-card').forEach((card) => {
      const go = () => {
        this.sel.carId = card.dataset.c;
        this.cb('carChosen', { ...this.sel });
      };
      card.addEventListener('click', go);
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
      });
    });
    el.querySelector('#btn-back').addEventListener('click', () => this.cb('back', 'discipline'));
    this._enter(el);
  }

  // ============ CAREER ============
  async loadCareerModules() {
    const [C, D] = await Promise.all([import('./career.js'), this.loadDisciplines()]);
    // every car the career can use: the street roster (D-A) and hypercars (S)
    const cars = [...D.carsForDiscipline('street'), ...D.carsForDiscipline('hypercar')]
      .filter((c, i, all) => c.performance && all.findIndex((x) => x.id === c.id) === i);
    return { C, D, cars };
  }

  /** Discipline a career car races in (hypercars have their own field). */
  careerDisciplineFor(D, carId) {
    return D.carsForDiscipline('street').some((c) => c.id === carId) ? 'street' : 'hypercar';
  }

  async showCareer(tab = this._careerTab) {
    const { C, cars } = await this.loadCareerModules();
    const state = C.ensureStarted(C.loadCareer(), cars);
    const stars = C.totalStars(state);
    const tier = tab || C.TIERS.filter((t) => C.tierUnlocked(state, t.id)).at(-1).id;
    this._careerTab = tier;
    this.hideAll();
    const el = this.screens.career;
    el.className = 'screen active menu-screen career-screen';
    const tabs = C.TIERS.map((t) => {
      const open = C.tierUnlocked(state, t.id);
      return `<button type="button" class="career-tab c-${t.id}${t.id === tier ? ' on' : ''}${open ? '' : ' locked'}"
        data-t="${t.id}" ${open ? '' : 'disabled'} aria-pressed="${t.id === tier}">
        <b>${t.id}</b><span>${t.label}</span><i>${open ? '' : `★ ${t.stars}`}</i></button>`;
    }).join('');
    const typeLabel = { race: 'RACE', sprint: 'SPRINT', elimination: 'ELIMINATION', takedown: 'TAKEDOWN RUSH', drift: 'DRIFT' };
    const events = C.CAREER_EVENTS.filter((e) => e.tier === tier).map((e) => {
      const got = state.stars[e.id] || 0;
      const t = TRACKS[e.trackId];
      const starRow = [1, 2, 3].map((n) => `<i class="${n <= got ? 'on' : ''}">★</i>`).join('');
      return `<div class="select-card career-event" role="button" tabindex="0" data-e="${e.id}"
          aria-label="${e.title}, ${typeLabel[e.event]}, ${t?.name || e.trackId}">
        <div class="map-wrap"><canvas width="230" height="110"></canvas></div>
        <div class="card-body">
          <span class="ce-type">${typeLabel[e.event]}${e.event === 'race' ? ` · ${e.laps} LAPS` : ''}</span>
          <h4>${e.title}</h4>
          <div class="sub">${FLAGS[e.trackId] || ''} ${t?.name || e.trackId}</div>
          <div class="ce-foot"><span class="ce-stars">${starRow}</span><b>${e.reward.toLocaleString()} CR</b></div>
        </div></div>`;
    }).join('');
    const daily = C.todaysChallenge(state);
    const dailyDone = state.dailyDone === daily.dateKey;
    const dailyCard = `<button type="button" class="career-daily${dailyDone ? ' done' : ''}" id="btn-daily"
        aria-label="Daily challenge: ${daily.title}, ${TRACKS[daily.trackId]?.name || daily.trackId}">
      <span class="cd-tag">DAILY CHALLENGE · CLASS ${daily.tier}</span>
      <b>${daily.title}</b>
      <span class="cd-where">${FLAGS[daily.trackId] || ''} ${TRACKS[daily.trackId]?.name || daily.trackId} · ${typeLabel[daily.event]}</span>
      <span class="cd-reward">${dailyDone ? 'DONE TODAY ✓' : `${daily.reward.toLocaleString()} CR · top 3 to win`}</span>
    </button>`;
    el.innerHTML = `
      ${header('CAREER <small>WORLD TOUR</small>')}
      <div class="menu-body">
        <div class="career-wallet">
          <span class="cw-credits"><i>CREDITS</i><b>${state.credits.toLocaleString()}</b></span>
          <span class="cw-stars"><i>STARS</i><b>★ ${stars}</b></span>
          <span class="cw-cars"><i>GARAGE</i><b>${state.owned.length} cars</b></span>
          <button class="f1-btn ghost" id="btn-dealer"><span>DEALERSHIP</span></button>
        </div>
        ${dailyCard}
        <div class="career-tabs" role="group" aria-label="Class">${tabs}</div>
        <div class="card-grid career-grid">${events}</div>
        <div class="btn-row"><button class="f1-btn ghost" id="btn-back"><span>← BACK</span></button></div>
      </div>
      <div class="menu-footer"><span>1st = ★★★ · podium = ★★ · top 6 = ★ · timed events: success = ★★★ · stars open the next class</span></div>`;
    el.querySelectorAll('.career-event').forEach((card) => {
      const e = C.eventById(card.dataset.e);
      const t = TRACKS[e.trackId];
      if (t) drawTrackPreview(card.querySelector('canvas'), t.points);
      const go = () => this.cb('careerEvent', e.id);
      card.addEventListener('click', go);
      card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    });
    el.querySelectorAll('.career-tab').forEach((b) => b.addEventListener('click', () => this.showCareer(b.dataset.t)));
    el.querySelector('#btn-dealer').addEventListener('click', () => this.showDealership());
    el.querySelector('#btn-daily').addEventListener('click', () => this.cb('careerEvent', daily.id));
    el.querySelector('#btn-back').addEventListener('click', () => this.cb('back', 'main'));
    this._enter(el);
  }

  /** Card for one car in the career screens. */
  _careerCarCard(C, c, state, extra = '') {
    const cls = c.performance.performance_class;
    return `<div class="select-card car-card career-car" role="button" tabindex="0" data-c="${c.id}"
        aria-label="${c.name}, class ${cls}">
      <div class="car-thumb"><img src="${carThumb(c)}" alt="" loading="lazy"><span class="g-class c-${cls}">${cls}</span></div>
      <div class="card-body">
        <h4>${c.model}</h4>
        <div class="sub">${c.make} · ${c.year}</div>
        <div class="tstats">
          <span class="tstat"><b>${c.performance.power_hp}</b><i>HP</i></span>
          <span class="tstat"><b>${c.performance.top_speed_kmh}</b><i>KM/H</i></span>
          <span class="tstat"><b>${c.performance.performance_index}</b><i>PI</i></span>
        </div>
        ${extra}
      </div></div>`;
  }

  /** Pick one of your cars that is eligible for the event. */
  async showCareerCars(eventId) {
    const { C, D, cars } = await this.loadCareerModules();
    const state = C.loadCareer();
    const event = C.eventById(eventId);
    if (!event) { this.showCareer(); return; }
    const mine = cars.filter((c) => state.owned.includes(c.id))
      .sort((a, b) => b.performance.performance_index - a.performance.performance_index);
    const ok = mine.filter((c) => C.carEligible(c, event));
    const tooFast = mine.filter((c) => !C.carEligible(c, event));
    this.hideAll();
    const el = this.screens.career;
    el.className = 'screen active menu-screen career-screen';
    el.innerHTML = `
      ${header(`${event.title.toUpperCase()} <small>CHOOSE YOUR CAR</small>`)}
      <div class="menu-body">
        <p class="career-note">Class ${event.tier} event: cars of class ${event.tier} or lower may enter.</p>
        ${ok.length ? `<div class="card-grid car-grid">${ok.map((c) => this._careerCarCard(C, c, state)).join('')}</div>`
          : `<p class="career-empty">None of your cars can enter. Buy a class ${event.tier} car (or lower) at the dealership.</p>`}
        ${tooFast.length ? `<p class="career-note dim">Too fast for this class: ${tooFast.map((c) => c.model).join(', ')}</p>` : ''}
        <div class="btn-row">
          <button class="f1-btn ghost" id="btn-back"><span>← EVENTS</span></button>
          <button class="f1-btn ghost" id="btn-dealer"><span>DEALERSHIP</span></button>
        </div>
      </div>`;
    el.querySelectorAll('.career-car').forEach((card) => {
      const go = () => this.cb('careerCar', {
        eventId, carId: card.dataset.c, discipline: this.careerDisciplineFor(D, card.dataset.c),
      });
      card.addEventListener('click', go);
      card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    });
    el.querySelector('#btn-back').addEventListener('click', () => this.showCareer());
    el.querySelector('#btn-dealer').addEventListener('click', () => this.showDealership(eventId));
    this._enter(el);
  }

  /** Buy cars with career credits. */
  async showDealership(returnEvent = null) {
    const { C, cars } = await this.loadCareerModules();
    const state = C.loadCareer();
    const list = [...cars].sort((a, b) => a.performance.performance_index - b.performance.performance_index);
    this.hideAll();
    const el = this.screens.career;
    el.className = 'screen active menu-screen career-screen';
    const cards = list.map((c) => {
      const owned = state.owned.includes(c.id);
      const price = C.CAR_PRICE[c.performance.performance_class] ?? C.CAR_PRICE.S;
      const afford = state.credits >= price;
      return this._careerCarCard(C, c, state, owned
        ? '<div class="dealer-row owned"><span>OWNED</span></div>'
        : `<div class="dealer-row"><b>${price.toLocaleString()} CR</b>
            <button class="f1-btn${afford ? '' : ' ghost'} buy" data-buy="${c.id}" ${afford ? '' : 'disabled'}><span>${afford ? 'BUY' : 'NEED CR'}</span></button></div>`);
    }).join('');
    el.innerHTML = `
      ${header('DEALERSHIP <small>CAREER</small>')}
      <div class="menu-body">
        <div class="career-wallet"><span class="cw-credits"><i>CREDITS</i><b>${state.credits.toLocaleString()}</b></span></div>
        <div class="card-grid car-grid">${cards}</div>
        <div class="btn-row"><button class="f1-btn ghost" id="btn-back"><span>← BACK</span></button></div>
      </div>`;
    el.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const car = list.find((c) => c.id === b.dataset.buy);
      const r = C.buyCar(C.loadCareer(), car);
      if (r.ok) this.showDealership(returnEvent);
    }));
    el.querySelector('#btn-back').addEventListener('click', () =>
      (returnEvent ? this.showCareerCars(returnEvent) : this.showCareer()));
    this._enter(el);
  }

  /** Garage id of the F1 car a driver races (their team's car). */
  formulaCarIdFor(driverId) {
    const team = DRIVERS.find((d) => d.id === driverId)?.team;
    return team ? `formula-${team}` : null;
  }

  // ============ GARAGE (paint + free upgrades) ============
  async showGarage() {
    const [{ carsForDiscipline }, G] = await Promise.all([
      this.loadDisciplines(), import('./garage.js'),
    ]);
    const { GarageView } = G;
    const formulaTeam = this.sel.carId?.startsWith(G.FORMULA_CAR_PREFIX)
      ? TEAMS.find((t) => `${G.FORMULA_CAR_PREFIX}${t.id}` === this.sel.carId) : null;
    const stock = formulaTeam ? G.formulaCar(formulaTeam)
      : carsForDiscipline(this.sel.discipline).find((c) => c.id === this.sel.carId);
    if (!stock) { this.cb('garageDone', { ...this.sel }); return; }
    // Career: a separate saved setup per car, and upgrades cost credits.
    const career = this.sel.career ? await import('./career.js') : null;
    const key = career ? career.careerSetupKey(stock.id) : stock.id;
    this.hideAll();
    const el = this.screens.garage;
    el.className = 'screen active menu-screen garage-screen';
    const stockTuned = G.tunedCar(stock, { paint: null, levels: {} });
    const stockBars = G.statBars(stockTuned);
    el.innerHTML = `
      ${header(`GARAGE <small>${stock.make.toUpperCase()}</small>`)}
      <div class="garage">
        <div class="garage-stage">
          <canvas id="garage-canvas"></canvas>
          <div class="garage-loading" id="g-loading">LOADING CAR…</div>
          <div class="garage-title">
            <span class="g-class" id="g-class">-</span>
            <div><h2>${stock.model}</h2><small>${stock.year} · ${stock.engine} · ${stock.performance.drivetrain}</small></div>
            <div class="g-pi"><i>PI</i><b id="g-pi">-</b></div>
          </div>
          <div class="g-specs" id="g-specs"></div>
        </div>
        <aside class="garage-panel">
          <section class="g-stats" id="g-stats"></section>
          <section>
            <h5>UPGRADES <em id="g-upnote">${career ? '' : 'FREE'}</em></h5>
            <div class="g-parts" id="g-parts"></div>
            <div class="g-actions" ${career ? 'hidden' : ''}>
              <button class="f1-btn ghost" id="g-max"><span>MAX ALL</span></button>
              <button class="f1-btn ghost" id="g-reset"><span>STOCK</span></button>
            </div>
          </section>
          <section>
            <h5>PAINT <em id="g-paintname">Factory</em></h5>
            <div class="g-paint" id="g-paint"></div>
          </section>
          <div class="btn-row">
            <button class="f1-btn ghost" id="btn-back"><span>← CARS</span></button>
            <button class="f1-btn" id="g-go"><span>${career ? 'START EVENT ›' : 'RACE ›'}</span></button>
          </div>
        </aside>
      </div>`;

    const view = new GarageView(el.querySelector('#garage-canvas'));
    this._garageView = view;
    const loading = el.querySelector('#g-loading');
    let shownPaint;
    const render = () => {
      const setup = G.garageFor(key);
      const wallet = career ? career.loadCareer() : null;
      if (wallet) el.querySelector('#g-upnote').textContent = `${wallet.credits.toLocaleString()} CR`;
      const car = G.tunedCar(stock, setup);
      const p = car.performance;
      const bars = G.statBars(car);
      el.querySelector('#g-class').textContent = p.performance_class;
      el.querySelector('#g-class').className = `g-class c-${p.performance_class}`;
      el.querySelector('#g-pi').textContent = p.performance_index;
      el.querySelector('#g-specs').innerHTML = [
        [p.power_hp, 'HP'], [p.weight_kg, 'KG'], [p.top_speed_kmh, 'KM/H'], [p.accel_0_100_kmh_s, '0-100 S'],
      ].map(([v, u]) => `<span><b>${v}</b><i>${u}</i></span>`).join('');
      el.querySelector('#g-stats').innerHTML = [
        ['TOP SPEED', 'topSpeed'], ['ACCELERATION', 'acceleration'], ['HANDLING', 'handling'], ['NITRO', 'nitro'],
      ].map(([label, k]) => `
        <div class="g-stat"><span>${label}</span>
          <div class="g-bar"><i class="up" style="width:${bars[k]}%"></i><i class="base" style="width:${Math.min(bars[k], stockBars[k])}%"></i></div>
          <b>${bars[k]}</b></div>`).join('');
      el.querySelector('#g-parts').innerHTML = G.UPGRADES.map((u) => {
        const n = setup.levels[u.id];
        const pips = Array.from({ length: G.MAX_LEVEL }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
        return `<div class="g-part">
          <div class="g-part-name"><b>${u.label}</b><small>${u.blurb}</small></div>
          <div class="g-pips">${pips}</div>
          ${career ? '' : `<button class="g-step" data-part="${u.id}" data-d="-1" ${n <= 0 ? 'disabled' : ''} aria-label="Downgrade ${u.label}">−</button>`}
          ${career ? (() => {
            const cost = career.upgradeCost(stock, u.id);
            const afford = cost != null && wallet.credits >= cost;
            return `<button class="g-step up g-buy" data-part="${u.id}" data-d="1" ${afford ? '' : 'disabled'}
              aria-label="Upgrade ${u.label}${cost != null ? ` for ${cost} credits` : ''}">${cost == null ? 'MAX' : `+ ${cost.toLocaleString()}`}</button>`;
          })() : `<button class="g-step up" data-part="${u.id}" data-d="1" ${n >= G.MAX_LEVEL ? 'disabled' : ''} aria-label="Upgrade ${u.label}">+</button>`}
        </div>`;
      }).join('');
      el.querySelector('#g-paint').innerHTML = G.PAINTS.map((c) => `
        <button class="g-swatch ${c.hex === setup.paint ? 'on' : ''} ${c.hex ? '' : 'factory'}"
          data-hex="${c.hex || ''}" title="${c.label}" aria-label="Paint ${c.label}"
          style="${c.hex ? `background:${c.hex}` : ''}"></button>`).join('');
      el.querySelector('#g-paintname').textContent =
        (G.PAINTS.find((c) => c.hex === setup.paint) || G.PAINTS[0]).label;
      el.querySelectorAll('.g-step').forEach((b) => b.addEventListener('click', () => {
        const part = b.dataset.part;
        if (career) career.buyUpgrade(career.loadCareer(), stock, part);
        else G.setLevel(key, part, G.garageFor(key).levels[part] + Number(b.dataset.d));
        render();
      }));
      el.querySelectorAll('.g-swatch').forEach((b) => b.addEventListener('click', () => {
        G.setPaint(key, b.dataset.hex || null);
        render();
      }));
      if (setup.paint !== shownPaint) {
        shownPaint = setup.paint;
        loading.hidden = false;
        view.setCar(car).then(() => { loading.hidden = true; });
      }
    };
    render();
    el.querySelector('#g-max').addEventListener('click', () => {
      for (const u of G.UPGRADES) G.setLevel(key, u.id, G.MAX_LEVEL);
      render();
    });
    el.querySelector('#g-reset').addEventListener('click', () => {
      const paint = G.garageFor(key).paint;
      G.resetCar(key);
      G.setPaint(key, paint);
      render();
    });
    el.querySelector('#g-go').addEventListener('click', () => this.cb('garageDone', { ...this.sel }));
    el.querySelector('#btn-back').addEventListener('click', () => {
      if (career) { this.showCareerCars(this.sel.career); return; }
      this.cb('back', formulaTeam ? 'team' : 'car');
    });
    if (formulaTeam) el.querySelector('#btn-back span').textContent = '← TEAMS';
    this._enter(el);
  }

  // ============ CREDITS ============
  // Attribution the asset licences ask for: every car model's author, licence
  // and source (assets/cars/credits.json, from tools/car-credits.mjs), the
  // music, and the other third-party assets.
  async showCredits(returnTo = 'main') {
    let cars = {};
    try { cars = await (await fetch('assets/cars/credits.json')).json(); } catch { /* none */ }
    // only the models this build actually races (the public build has fewer)
    const D = await this.loadDisciplines();
    const shown = new Set(['street', 'gt', 'hypercar'].flatMap((d) => D.carsForDiscipline(d)).map((c) => c.modelFile).filter(Boolean));
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const link = (url, text) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));
    const carRows = Object.entries(cars).filter(([f, c]) => c.publish && shown.has(f)).map(([, c]) =>
      `<li>${link(c.source, c.title || 'Car model')} by ${link(c.authorUrl, c.author || 'unknown')} · ${link(c.licenseUrl, c.license)}</li>`).join('');
    const other = [
      ['Music: "Synth Wave"', 'Pro Sensory (Alex McCulloch)', 'https://opengameart.org/content/synth-wave', 'CC0'],
      ['Music: "Diamond Race"', 'iamoneabe', 'https://opengameart.org/node/150386', 'CC0'],
      ['Music: "Drum and bass"', 'bertsz', 'https://opengameart.org/content/drum-and-bass', 'CC0'],
      ['Music: "synthwave_type"', 'G_P', 'https://opengameart.org/content/synthwavetype', 'CC0'],
      ['City Kit (Commercial, Suburban), Mini Characters', 'Kenney', 'https://kenney.nl', 'CC0'],
      ['Road, gravel and grass scans', 'Poly Haven, ambientCG', 'https://polyhaven.com', 'CC0'],
      ['three.js', 'the three.js authors', 'https://threejs.org', 'MIT'],
      ['Based on APEX FORMULA 2026', 'Avi Hacker', 'https://github.com/ahacker-1/apex-formula-2026', 'Apache-2.0'],
    ].map(([what, who, url, lic]) => `<li>${link(url, what)} by ${esc(who)} · ${esc(lic)}</li>`).join('');
    this.hideAll();
    const el = this.screens.settings;
    el.className = 'screen active menu-screen';
    el.innerHTML = `
      ${header('CREDITS')}
      <div class="menu-body credits">
        <h3>Car models</h3>
        <p class="credits-note">Creative Commons licensed models from Sketchfab, optimised for the game
          (the NC/SA models: free, non-commercial use; adaptations shared under the same licence).
          Car names and brands belong to their owners; this is an unofficial fan project.</p>
        <ul>${carRows || '<li>None in this build.</li>'}</ul>
        <h3>Music and assets</h3>
        <ul>${other}</ul>
        <div class="btn-row"><button class="f1-btn ghost" id="btn-back"><span>← BACK</span></button></div>
      </div>`;
    el.querySelector('#btn-back').addEventListener('click', () => this.showSettings(returnTo));
    this._enter(el);
  }

  // ---- personal records: best lap per venue, saved in the browser ----
  _records() {
    try { return JSON.parse(localStorage.getItem('rushhour_records_v1') || '{}') || {}; } catch { return {}; }
  }

  /** After a race: keep the player's best lap at this venue if it is a record. */
  recordBestLap(trackId, player) {
    const lap = player?.bestLap;
    if (!trackId || !(lap > 0)) return false;
    const all = this._records();
    const prev = all[trackId]?.lap;
    if (prev && prev <= lap) return false;
    const car = player.rosterCar?.name || player.rosterCar?.model || player.team?.name || '';
    all[trackId] = { lap, car, at: Date.now() };
    try { localStorage.setItem('rushhour_records_v1', JSON.stringify(all)); } catch { /* private mode */ }
    this.newRecord = { trackId, lap, prev: prev || null };
    return true;
  }

  showTrackSelect(champ = null) {
    this.hideAll();
    const el = this.screens.track;
    el.className = 'screen active menu-screen';
    const nextId = champ && champ.active && champ.nextRace ? champ.nextRace.trackId : null;
    const focusId = nextId || this.sel.trackId || PILOT_TRACK_ID;
    // Outside the championship the venue list comes from the discipline, which
    // can include circuits that are not on the 24-round calendar.
    const activeDiscipline = this.disciplineSpec();
    const rounds = this.sel.discipline === 'formula' ? CALENDAR
      : activeDiscipline.tracks.filter((id) => TRACKS[id]).map((id, i) => ({
        trackId: id, round: i + 1, gp: TRACKS[id].name,
        date: '', country: TRACKS[id].country,
      }));
    // Arcade disciplines pick an event type here; Formula and time trials race.
    const arcadeEvents = this.sel.discipline !== 'formula' && this.sel.mode !== 'trial'
      && !activeDiscipline.format?.timeAttack;
    if (!arcadeEvents) this.sel.event = 'race';
    const curEvent = eventSpec(this.sel.event).id;
    const eventPicker = arcadeEvents ? `<div class="event-picker" role="group" aria-label="Event type">${EVENTS.map((ev) =>
      `<button type="button" class="event-opt${ev.id === curEvent ? ' on' : ''}" data-ev="${ev.id}" aria-pressed="${ev.id === curEvent}">
        <b>${ev.label}</b><i>${ev.blurb}</i></button>`).join('')}</div>` : '';
    el.innerHTML = `
      ${header('SELECT <small>CIRCUIT</small>')}
      <div class="menu-body">${eventPicker}<div class="card-grid" id="track-grid"></div>
        <div class="btn-row"><button class="f1-btn ghost" id="btn-back"><span>← BACK</span></button></div>
      </div>
      <div class="menu-footer"><span>${this.sel.discipline === 'formula'
        ? `${SEASON} calendar — 24 rounds` : `${activeDiscipline.label} — ${activeDiscipline.tracks.length} venue${activeDiscipline.tracks.length === 1 ? '' : 's'}`}${this.sel.mode === 'trial' ? ' · TIME TRIAL' : ''}</span>
        <span style="margin-left:auto">Corner counts estimated from circuit geometry</span></div>`;
    for (const b of el.querySelectorAll('.event-opt')) {
      b.addEventListener('click', () => {
        this.sel.event = b.dataset.ev;
        for (const o of el.querySelectorAll('.event-opt')) {
          const on = o === b;
          o.classList.toggle('on', on);
          o.setAttribute('aria-pressed', String(on));
        }
        this._saveLastSelection();
      });
    }
    const grid = el.querySelector('#track-grid');
    const records = this._records();
    let nextCard = null;
    for (const race of rounds) {
      const t = TRACKS[race.trackId];
      if (!t) continue;
      const card = document.createElement('div');
      card.className = 'select-card track-card' + (race.trackId === nextId ? ' next-round' : '');
      card.dataset.t = race.trackId;
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.setAttribute('aria-label', `${race.gp}, ${circuitLabel(race, t)}, ${t.lengthKm.toFixed(3)} kilometres`);
      card.innerHTML = `
        <div class="round-badge">R${race.round}</div>
        ${race.trackId === nextId ? '<div class="next-badge">NEXT ROUND</div>' : ''}
        <div class="map-wrap"><canvas width="230" height="126"></canvas></div>
        <div class="card-body">
          <h4>${FLAGS[race.trackId] || ''} ${race.gp}</h4>
          <div class="sub">${circuitLabel(race, t)}</div>
          <div class="tstats">
            <span class="tstat"><b>${t.lengthKm.toFixed(3)}</b><i>KM</i></span>
            <span class="tstat"><b>${this.sel.mode === 'trial' ? '1' : this.raceLapsFor(race.trackId)}</b><i>${this.sel.mode === 'trial' ? 'HOTLAP' : 'LAPS'}</i></span>
            <span class="tstat"><b>${cornerCount(t.points)}</b><i>CORNERS</i></span>
          </div>
          <div class="meta"><span>${race.date ? race.date.slice(5).replace('-', '/') : (TRACKS[race.trackId]?.location || '')}</span><span class="track-badges">${trackBadges(race.trackId)}</span></div>
          ${records[race.trackId] ? `<div class="track-record" title="Your best lap here">★ BEST LAP <b>${fmtTime(records[race.trackId].lap)}</b>${records[race.trackId].car ? ` · ${records[race.trackId].car}` : ''}</div>` : ''}
        </div>`;
      grid.appendChild(card);
      drawTrackPreview(card.querySelector('canvas'), t.points);
      card.addEventListener('click', () => {
        this.sel.trackId = race.trackId;
        this._saveLastSelection();
        this.cb('trackChosen', { ...this.sel });
      });
      card.addEventListener('keydown', ev => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        card.click();
      });
      if (race.trackId === focusId) nextCard = card;
    }
    el.querySelector('#btn-back').addEventListener('click', () =>
      this.cb('back', this.sel.discipline === 'formula' ? 'team'
        : (this.sel.carId ? 'garage' : 'discipline')));
    if (nextCard && typeof nextCard.scrollIntoView === 'function') {
      nextCard.scrollIntoView({ block: 'nearest' });
    }
    this._enter(el);
  }

  // ============ SETTINGS ============
  showSettings(returnTo = 'main') {
    this.hideAll();
    const el = this.screens.settings;
    el.className = 'screen active menu-screen';
    const s = this.settings;
    const settingLabels = {
      difficulty: 'AI difficulty', distance: 'Race distance', quali: 'Qualifying',
      tc: 'Traction control', abs: 'Anti-lock brakes', autoGear: 'Gearbox',
      nametags: 'Driver nametags', graphicsQuality: 'Graphics quality',
      cameraProfile: 'Camera style', autoPause: 'Auto pause',
      touchControls: 'Touch controls', autoAccel: 'Touch auto-accelerate', rumble: 'Controller rumble', volume: 'Master volume', musicVolume: 'Music volume',
      steeringResponse: 'Keyboard steering response', cockpitFov: 'Cockpit field of view',
      cockpitSeat: 'Cockpit seat position', headMotion: 'Cockpit head motion',
    };
    const seg = (key, opts, cur) => `<div class="seg" data-k="${key}" role="group" aria-label="${settingLabels[key] || key}">${opts.map((o, i) =>
      `<button type="button" class="${i === cur ? 'on' : ''}" data-v="${i}" aria-pressed="${i === cur}">${o}</button>`).join('')}</div>`;
    const row = (title, desc, ctrl) =>
      `<div class="setting-row"><div class="label"><h4>${title}</h4><p>${desc}</p></div>${ctrl}</div>`;
    const group = (name, note, rows) =>
      `<section class="set-group"><header class="set-group-head"><h3>${name}</h3><span>${note}</span></header>${rows}</section>`;
    el.innerHTML = `
      ${header('SETTINGS')}
      <div class="menu-body"><div class="settings-list">
        ${group('RACE', 'Race weekend format', `
          ${row('AI Difficulty', 'How fast the field races', seg('difficulty', ['ROOKIE', 'PRO', 'ELITE'], s.difficulty))}
          ${row('Race Distance', 'Laps per race', seg('distance', ['5 LAPS', '25%', '50%', '100%'], s.distance))}
          ${row('Qualifying', 'One-lap shootout sets your grid slot', seg('quali', ['OFF', 'ON'], s.quali ? 1 : 0))}`)}
        ${group('ASSISTS', 'Driving aids', `
          ${row('Traction Control', 'Tames wheelspin out of corners', seg('tc', ['OFF', 'ON'], s.tc ? 1 : 0))}
          ${row('ABS', 'Prevents brake lockups', seg('abs', ['OFF', 'ON'], s.abs ? 1 : 0))}
          ${row('Gearbox', 'Automatic or manual (Q/E to shift)', seg('autoGear', ['MANUAL', 'AUTO'], s.autoGear ? 1 : 0))}
          ${row('Arrow-key Steering', 'Progressive input filtering and steering return', seg('steeringResponse', ['CALM', 'BALANCED', 'DIRECT'], ['calm', 'balanced', 'direct'].indexOf(s.steeringResponse)))}`)}
        ${group('DISPLAY', 'On-track information', `
          ${row('Driver Nametags', 'Show 3-letter codes above AI cars', seg('nametags', ['OFF', 'ON'], s.nametags ? 1 : 0))}
          ${row('Graphics Quality', 'Auto adjusts resolution and effects to hold frame rate', seg('graphicsQuality', ['AUTO', 'LOW', 'MED', 'HIGH'], ['auto', 'low', 'medium', 'high'].indexOf(s.graphicsQuality)))}
          ${row('Camera Style', 'Chase-camera distance, motion and field of view', seg('cameraProfile', ['TIGHT', 'BROADCAST', 'CINEMATIC'], ['tight', 'broadcast', 'cinematic'].indexOf(s.cameraProfile)))}
          ${row('Cockpit FOV', 'Driver-eye field-of-view framing', seg('cockpitFov', ['FOCUSED', 'NATURAL', 'WIDE'], ['focused', 'natural', 'wide'].indexOf(s.cockpitFov)))}
          ${row('Cockpit Seat', 'Driver eye height inside the halo', seg('cockpitSeat', ['LOW', 'STANDARD', 'HIGH'], ['low', 'standard', 'high'].indexOf(s.cockpitSeat)))}
          ${row('Head Motion', 'Restrained acceleration and kerb response', seg('headMotion', ['OFF', 'ON'], s.headMotion !== false ? 1 : 0))}`)}
        ${group('BEHAVIOUR', 'Device and focus handling', `
          ${row('Auto Pause', 'Pause when the game loses focus', seg('autoPause', ['OFF', 'ON'], s.autoPause !== false ? 1 : 0))}
          ${row('Touch Controls', 'Show steering and pedal controls on touch devices', seg('touchControls', ['OFF', 'ON'], s.touchControls !== false ? 1 : 0))}
          ${row('Touch Auto-Accelerate', 'On touch screens the car accelerates by itself in arcade races', seg('autoAccel', ['OFF', 'ON'], s.autoAccel !== false ? 1 : 0))}
          ${row('Controller Rumble', 'Vibrate the gamepad on hits, takedowns and nitro', seg('rumble', ['OFF', 'ON'], s.rumble !== false ? 1 : 0))}`)}
        ${group('AUDIO', 'Mix', `
          ${row('Master Volume', 'Everything: music, engine and effects', seg('volume', ['MUTE', '50%', '100%'], s.volume === 0 ? 0 : s.volume < 0.9 ? 1 : 2))}
          ${row('Music', 'Menu and race soundtrack', seg('musicVolume', ['OFF', '50%', '100%'], (s.musicVolume ?? 0.8) === 0 ? 0 : (s.musicVolume ?? 0.8) < 0.7 ? 1 : 2))}`)}
      </div>
      <div class="btn-row">
        <button class="f1-btn ghost" id="btn-back"><span>← BACK</span></button>
        <button class="f1-btn ghost" id="btn-credits"><span>CREDITS</span></button>
        <button class="f1-btn ghost danger" id="btn-reset"><span>RESET TO DEFAULTS</span></button>
      </div>
      </div>
      <div class="menu-footer"><span>Settings save automatically</span></div>`;
    el.querySelectorAll('.seg').forEach(segEl => {
      segEl.addEventListener('click', ev => {
        const b = ev.target.closest('button');
        if (!b) return;
        const k = segEl.dataset.k, v = +b.dataset.v;
        segEl.querySelectorAll('button').forEach(x => {
          x.classList.remove('on');
          x.setAttribute('aria-pressed', 'false');
        });
        b.classList.add('on');
        b.setAttribute('aria-pressed', 'true');
        if (k === 'difficulty' || k === 'distance') this.settings[k] = v;
        else if (k === 'graphicsQuality') this.settings[k] = ['auto', 'low', 'medium', 'high'][v] || 'auto';
        else if (k === 'cameraProfile') this.settings[k] = ['tight', 'broadcast', 'cinematic'][v] || 'broadcast';
        else if (k === 'steeringResponse') this.settings[k] = ['calm', 'balanced', 'direct'][v] || 'balanced';
        else if (k === 'cockpitFov') this.settings[k] = ['focused', 'natural', 'wide'][v] || 'natural';
        else if (k === 'cockpitSeat') this.settings[k] = ['low', 'standard', 'high'][v] || 'standard';
        else if (k === 'volume') this.settings.volume = [0, 0.5, 1][v];
        else if (k === 'musicVolume') this.settings.musicVolume = [0, 0.45, 0.8][v];
        else this.settings[k] = v === 1;
        this.saveSettings();
        this.cb('settingsChanged', this.settings);
      });
    });
    el.querySelector('#btn-back').addEventListener('click', () => this.cb('back', returnTo));
    el.querySelector('#btn-credits').addEventListener('click', () => this.showCredits(returnTo));
    el.querySelector('#btn-reset').addEventListener('click', () => {
      this.settings = { ...DEFAULT_SETTINGS };
      this.saveSettings();
      this.showSettings(returnTo);          // repaint every segment from defaults
      this.cb('settingsChanged', this.settings);
    });
    this._enter(el);
  }

  // ============ LOADING ============
  showLoading(race, track) {
    this.hideAll();
    const el = this.screens.loading;
    el.className = 'screen active load-screen';
    const corners = cornerCount(track.points);
    const venue = circuitLabel(race, track);
    const laps = this.sel.mode === 'trial' ? null : this.raceLapsFor(race.trackId);
    el.innerHTML = `
      <div class="load-wrap">
        <div class="load-panel">
          <div class="load-left">
            <div class="load-flag">${FLAGS[race.trackId] || '🏁'}</div>
            <div class="load-track-name">${race.gp}</div>
            <div class="load-track-sub">${venue} — ${track.location}</div>
            <div class="track-badges load-badges">${trackBadges(race.trackId)}</div>
            <div class="load-spinner"></div>
          </div>
          <div class="load-map"><canvas width="360" height="240"></canvas></div>
        </div>
        <div class="load-tip load-fact" id="load-fact"></div>
      </div>`;
    drawTrackPreview(el.querySelector('.load-map canvas'), track.points, 'rgba(255,255,255,0.9)');
    // rotating fact line built from the active calendar / circuit data
    const facts = [
      `ROUND ${race.round} OF ${CALENDAR.length} · ${race.date}`,
      `${venue} — ${track.lengthKm.toFixed(3)} km, ${corners} corners (estimated from the layout)`,
      laps ? `Race distance: ${laps} laps · ${(laps * track.lengthKm).toFixed(1)} km` : 'Time trial: one flying lap, empty circuit',
      `Track width ${track.width} m · ${STREET_TRACKS.has(race.trackId) ? 'street circuit, walls close' : 'permanent circuit with run-off'}`,
      TIPS[(Math.random() * TIPS.length) | 0],
      TIPS[(Math.random() * TIPS.length) | 0],
    ];
    let fi = (Math.random() * facts.length) | 0;
    const paint = () => {
      const node = el.querySelector('#load-fact');
      if (!node) { this._stopFacts(); return; }
      node.textContent = facts[fi % facts.length];
      if (node.classList) {
        node.classList.remove('fact-in');
        void node.offsetWidth;
        node.classList.add('fact-in');
      }
      fi++;
    };
    paint();
    this._stopFacts();
    this._factTimer = setInterval(paint, 3200);
    this._enter(el);
  }

  showLoadError(race, track) {
    this.hideAll();
    const el = this.screens.loading;
    const venue = circuitLabel(race, track);
    el.className = 'screen active load-screen load-error-screen';
    el.innerHTML = `
      <div class="load-wrap" role="alert" aria-labelledby="load-error-title">
        <div class="load-panel">
          <div class="load-left">
            <div class="load-flag">${FLAGS[race.trackId] || '🏁'}</div>
            <div class="load-track-name" id="load-error-title">RACE LOAD INTERRUPTED</div>
            <div class="load-track-sub">${race.gp} · ${venue}</div>
            <p class="load-tip">A required race asset could not be loaded. Check your connection, then retry without losing your selection.</p>
            <div class="btn-row">
              <button type="button" class="f1-btn primary" id="btn-retry">RETRY</button>
              <button type="button" class="f1-btn" id="btn-menu">MAIN MENU</button>
            </div>
          </div>
        </div>
      </div>`;
    el.querySelector('#btn-retry').addEventListener('click', () => this.cb('retryLoad'));
    el.querySelector('#btn-menu').addEventListener('click', () => this.cb('back', 'main'));
    this._enter(el);
    this._setNavFocus(el, el.querySelector('#btn-retry'));
  }

  // ============ QUALI RESULTS ============
  showQualiResults(rows, playerId, race, options = {}) {
    this.hideAll();
    const el = this.screens.results;
    el.className = 'screen active menu-screen';
    const pole = rows[0];
    const spread = Math.max(0.001, rows[rows.length - 1].time - pole.time);
    const title = options.title || 'QUALIFYING <small>CLASSIFICATION</small>';
    const leaderLabel = options.leaderLabel || 'POLE';
    const primaryLabel = options.primaryLabel || 'START RACE →';
    const primaryAction = options.primaryAction || 'startRaceAfterQuali';
    const restartButton = options.allowRestart === false ? '' :
      '<button class="f1-btn ghost" id="btn-requali"><span>RE-RUN QUALIFYING</span></button>';
    const footer = options.footer || `${race.gp} — grid set by qualifying`;
    el.innerHTML = `
      ${header(title)}
      <div class="menu-body">
        <table class="results-table">
          <tr><th>POS</th><th>DRIVER</th><th>TEAM</th><th>TIME</th><th>GAP</th></tr>
          ${rows.map((r, i) => {
            const d = DRIVERS.find(x => x.id === r.driverId);
            const t = teamById[d.team];
            const gap = r.time - pole.time;
            return `<tr class="${r.driverId === playerId ? 'player-row' : ''}${i === 0 ? ' pole-row' : ''}">
              <td class="pos-cell">${i + 1}</td>
              <td><span class="teambar" style="background:${hex(t.color)}"></span>${d.firstName} ${d.lastName}</td>
              <td style="color:var(--text-dim)">${t.name}</td>
              <td class="ftime">${fmtTime(r.time)}</td>
              <td class="ftime gap-cell">${i === 0 ? `<b class="pole-tag">${leaderLabel}</b>` : '+' + gap.toFixed(3)}
                ${i === 0 ? '' : `<span class="gap-bar"><i style="width:${Math.min(100, gap / spread * 100).toFixed(1)}%;background:${hex(t.color)}"></i></span>`}</td></tr>`;
          }).join('')}
        </table>
        <div class="btn-row">
          <button class="f1-btn" id="btn-race"><span>${primaryLabel}</span></button>
          ${restartButton}
          <button class="f1-btn ghost" id="btn-menu"><span>MAIN MENU</span></button>
        </div>
      </div>
      <div class="menu-footer"><span>${footer}</span></div>`;
    el.querySelector('#btn-race').addEventListener('click', () => this.cb(primaryAction));
    el.querySelector('#btn-requali')?.addEventListener('click', () => this.cb('restartRace'));
    el.querySelector('#btn-menu').addEventListener('click', () => this.cb('back', 'main'));
    this._enter(el);
  }

  // ============ RACE RESULTS ============
  showResults(results, fastestLap, race, mode, champActive) {
    this.hideAll();
    const el = this.screens.results;
    el.className = 'screen active menu-screen';
    if (mode === 'trial') {
      const p = results[0];
      el.innerHTML = `
        ${header('TIME TRIAL <small>COMPLETE</small>')}
        <div class="menu-body" style="text-align:center">
          <div style="font-size:20px;color:var(--text-dim);margin-top:4vh">BEST LAP</div>
          <div class="trial-time">${p.bestLap ? fmtTime(p.bestLap) : '—'}</div>
          <div class="btn-row" style="justify-content:center">
            <button class="f1-btn" id="btn-again"><span>RUN IT AGAIN</span></button>
            <button class="f1-btn ghost" id="btn-menu"><span>MAIN MENU</span></button>
          </div>
        </div><div class="menu-footer"><span>${race.gp}</span></div>`;
      el.querySelector('#btn-again').addEventListener('click', () => this.cb('restartRace'));
      el.querySelector('#btn-menu').addEventListener('click', () => this.cb('back', 'main'));
      this._enter(el);
      return;
    }
    const podium = results.slice(0, 3);
    // grid slots are not part of the results rows today; render the
    // positions-gained column only when a build does supply them.
    const showGain = results.some(r => gridOf(r) !== null);
    const player = results.find(r => r.isPlayer);
    // set by main.js for arcade events (Elimination, Takedown Rush, Drift)
    const outcome = this.eventOutcome;
    this.eventOutcome = null;
    const reward = this.careerReward;          // set by main.js for career events
    this.careerReward = null;
    const record = this.newRecord?.trackId === race?.trackId ? this.newRecord : null;
    this.newRecord = null;
    el.innerHTML = `
      ${header('RACE <small>CLASSIFICATION</small>')}
      <div class="menu-body">
        ${outcome ? `<div class="event-outcome ${outcome.success ? 'win' : 'lose'}">
          <b>${outcome.label}</b><span>${outcome.success ? 'SUCCESS' : 'FAILED'}</span><i>${outcome.detail}</i></div>` : ''}
        ${record ? `<div class="record-banner">★ NEW BEST LAP <b>${fmtTime(record.lap)}</b>${record.prev ? ` <i>−${(record.prev - record.lap).toFixed(3)}s</i>` : ''}</div>` : ''}
        ${reward ? `<div class="career-reward">
          <b>${reward.title}</b>
          <span class="cr-stars">${[1, 2, 3].map((n) => `<i class="${n <= reward.stars ? 'on' : ''}">★</i>`).join('')}</span>
          <span class="cr-credits">+${reward.credits.toLocaleString()} CR</span>
          ${reward.rivalBonus ? `<span class="cr-rival">RIVAL BEATEN +${reward.rivalBonus.toLocaleString()}</span>` : ''}
          <i>${reward.newBest ? 'New best · ' : ''}${reward.balance.toLocaleString()} CR · ★ ${reward.totalStars}</i></div>` : ''}
        <div class="podium-strip">
          ${podium.map((r, i) => `
            <div class="podium-card shine p${i + 1}" style="border-top-color:${hex(r.team.color)};--shine-delay:${i * 260}ms">
              <div class="p">P${i + 1}</div>
              <h3>${r.driver.firstName} ${r.driver.lastName}</h3>
              <p>${r.team.name} · ${r.gapText}</p>
              ${r.points ? `<div class="podium-pts">${r.points} PTS</div>` : ''}
            </div>`).join('')}
        </div>
        <table class="results-table">
          <tr><th>POS</th>${showGain ? '<th>+/−</th>' : ''}<th>DRIVER</th><th>TEAM</th><th>TIME</th><th>STOPS</th><th>BEST LAP</th><th>PTS</th></tr>
          ${results.map(r => `<tr class="${r.isPlayer ? 'player-row' : ''}">
            <td class="pos-cell">${r.dnf ? 'NC' : r.pos}</td>
            ${showGain ? `<td>${gainChip(r)}</td>` : ''}
            <td><span class="teambar" style="background:${hex(r.team.color)}"></span>${r.driver.firstName} ${r.driver.lastName}</td>
            <td style="color:var(--text-dim)">${r.team.name}</td>
            <td class="ftime">${r.gapText}</td>
            <td class="ftime">${r.pits}</td>
            <td class="ftime ${r.fastestLap ? 'fl' : ''}">${r.bestLap ? fmtTime(r.bestLap) : '—'}${r.fastestLap ? ' ●' : ''}</td>
            <td class="pts${r.isPlayer ? ' pts-count' : ''}">${r.isPlayer ? '' : (r.points || '')}</td></tr>`).join('')}
        </table>
        <div class="btn-row">
          <button class="f1-btn" id="btn-continue"><span>${champActive ? 'CONTINUE →' : reward ? 'CAREER →' : 'MAIN MENU'}</span></button>
          ${champActive ? '' : '<button class="f1-btn ghost" id="btn-restart"><span>RESTART RACE</span></button>'}
        </div>
      </div>
      <div class="menu-footer"><span>${race.gp}${fastestLap ? ` · FASTEST LAP: ${fastestLap.name} ${fmtTime(fastestLap.time)}` : ''}</span></div>`;
    el.querySelector('#btn-continue').addEventListener('click', () =>
      this.cb(champActive ? 'afterRaceChamp' : 'back', reward ? 'career' : 'main'));
    const restartBtn = el.querySelector('#btn-restart');
    if (restartBtn) restartBtn.addEventListener('click', () => this.cb('restartRace'));
    if (player) this._countUp(el.querySelector('.pts-count'), player.points || 0);
    this._enter(el);
  }

  // ============ STANDINGS ============
  showStandings(champ, showNext) {
    this.hideAll();
    const el = this.screens.standings;
    el.className = 'screen active menu-screen';
    const ds = champ.driverStandings();
    const ts = champ.teamStandings();
    const log = typeof champ.resultsLog === 'function' ? champ.resultsLog() : [];
    el.innerHTML = `
      ${header('CHAMPIONSHIP <small>STANDINGS</small>')}
      <div class="menu-body">
        <div class="season-panels">
          ${roundStrip(log, champ.playerDriverId)}
          ${pointsBars(ds, champ.playerDriverId)}
        </div>
        <div class="stand-cols">
          <div class="stand-col wide">
            <h3 class="f1-heading stand-head">DRIVERS</h3>
            <table class="results-table">
              <tr><th>POS</th><th>DRIVER</th><th>TEAM</th><th>WINS</th><th>PTS</th></tr>
              ${ds.map(r => `<tr class="${r.driver.id === champ.playerDriverId ? 'player-row' : ''}">
                <td class="pos-cell">${r.pos}</td>
                <td><span class="teambar" style="background:${hex(teamById[r.driver.team].color)}"></span>${r.driver.firstName} ${r.driver.lastName}</td>
                <td style="color:var(--text-dim)">${teamById[r.driver.team].name}</td>
                <td class="ftime">${r.wins}</td><td class="pts">${r.points}</td></tr>`).join('')}
            </table>
          </div>
          <div class="stand-col">
            <h3 class="f1-heading stand-head">CONSTRUCTORS</h3>
            <table class="results-table">
              <tr><th>POS</th><th>TEAM</th><th>PTS</th></tr>
              ${ts.map(r => `<tr><td class="pos-cell">${r.pos}</td>
                <td><span class="teambar" style="background:${hex(r.team.color)}"></span>${r.team.name}</td>
                <td class="pts">${r.points}</td></tr>`).join('')}
            </table>
          </div>
        </div>
        <div class="btn-row">
          ${showNext && champ.active ? `<button class="f1-btn" id="btn-nextrace"><span>NEXT: ${champ.nextRace.gp} →</span></button>` : ''}
          ${champ.finished ? `<div class="podium-card champ-card shine" style="max-width:none"><h3>🏆 ${champName(ds)} IS THE ${SEASON} WORLD CHAMPION</h3></div>` : ''}
          <button class="f1-btn ghost" id="btn-menu"><span>MAIN MENU</span></button>
          <button class="f1-btn ghost danger" id="btn-abandon"><span>ABANDON SEASON</span></button>
        </div>
      </div>
      <div class="menu-footer"><span>Round ${Math.min(champ.roundIndex, 24)} of 24 complete</span></div>`;
    const nx = el.querySelector('#btn-nextrace');
    if (nx) nx.addEventListener('click', () => this.cb('champNextRace'));
    el.querySelector('#btn-menu').addEventListener('click', () => this.cb('back', 'main'));
    el.querySelector('#btn-abandon').addEventListener('click', () => this.cb('abandonSeason'));
    this._enter(el);
  }

  // ============ PAUSE ============
  showPause() {
    const el = this.screens.pause;
    el.className = 'screen active';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'pause-title');
    el.innerHTML = `
      <div class="main-nav pause-nav" style="width:420px">
        <div class="pause-title" id="pause-title">PAUSED</div>
        <button type="button" class="nav-item" data-a="resume"><span><h3>RESUME</h3></span></button>
        <button type="button" class="nav-item" data-a="restart"><span><h3>RESTART</h3></span></button>
        <button type="button" class="nav-item" data-a="quit"><span><h3>QUIT TO MENU</h3></span></button>
      </div>`;
    el.querySelectorAll('.nav-item').forEach(n =>
      n.addEventListener('click', () => this.cb('pause', n.dataset.a)));
    this._enter(el);
  }
  hidePause() { this.screens.pause.classList.remove('active'); }
}

function header(title) {
  return `<div class="menu-header"><div class="brand">RUSH<em>HOUR</em></div><div class="title">${title}</div></div>`;
}
function hex(n) { return '#' + n.toString(16).padStart(6, '0'); }
function carThumb(car) { return car.thumb || `assets/racing-pack/sprites/thumbs/${car.id}_thumb.png`; }
function champName(ds) {
  const d = ds[0].driver;
  return (d.firstName + ' ' + d.lastName).toUpperCase();
}

// ---- small view helpers ---------------------------------------------------

// Driver rating bar. Ratings live in data.js on a ~0.80-0.99 scale; stretch
// that window so the bars actually differentiate the field.
function statBar(key, v) {
  const val = Number(v) || 0;
  const pct = Math.max(4, Math.min(100, (val - 0.78) / 0.22 * 100));
  return `<div class="stat-row"><i class="stat-key">${key}</i>
    <span class="stat-bar"><b style="width:${pct.toFixed(0)}%"></b></span>
    <u class="stat-val">${Math.round(val * 100)}</u></div>`;
}

// Livery chip strip: primary, accent and two derived shades — a stand-in for a
// car render, built from the same colors the 3D car paint uses.
function liveryChips(team) {
  const c = team.color, a = team.accent;
  const cols = [shade(c, 1.25), hex(c), shade(c, 0.62), hex(a), shade(a, 1.2)];
  return cols.map(col => `<i style="background:${col}"></i>`).join('');
}
// Text tinted with a team colour has to stay legible on the dark panels. The
// near-black liveries (including TACN's blue-charcoal) and deep navies fail otherwise, on
// either roster. Blend toward white until the relative luminance clears a
// floor, which keeps the hue.
function readable(n, floor = 0.55) {
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum >= floor) return `rgb(${r},${g},${b})`;
  const t = (floor - lum) / (1 - lum);
  r = Math.round(r + (255 - r) * t);
  g = Math.round(g + (255 - g) * t);
  b = Math.round(b + (255 - b) * t);
  return `rgb(${r},${g},${b})`;
}
function shade(n, k) {
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `rgb(${r},${g},${b})`;
}

function trackBadges(trackId) {
  const out = [];
  if (STREET_TRACKS.has(trackId)) out.push('<i class="tbadge street">STREET</i>');
  const theme = TRACK_THEME[trackId];
  if (theme === 'night') out.push('<i class="tbadge night">NIGHT</i>');
  else if (theme === 'dusk') out.push('<i class="tbadge dusk">TWILIGHT</i>');
  return out.join('');
}

// Positions gained: results rows do not currently carry a grid slot, so this is
// rendered only when one is present under any of the plausible field names.
function gridOf(r) {
  for (const k of ['gridPos', 'grid', 'startPos', 'gridPosition']) {
    if (typeof r[k] === 'number' && isFinite(r[k]) && r[k] > 0) return r[k];
  }
  return null;
}
function gainChip(r) {
  const g = gridOf(r);
  if (g === null || r.dnf) return '';
  const d = g - r.pos;
  if (d === 0) return '<span class="gain-chip same">=</span>';
  return `<span class="gain-chip ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>`;
}

// Main-menu season header: what the career is doing right now.
function seasonStrip(champ) {
  if (!champ) return '';
  if (champ.active && champ.nextRace) {
    const race = champ.nextRace;
    const t = TRACKS[race.trackId] || {};
    let standing = '';
    if (typeof champ.driverStandings === 'function' && champ.playerDriverId) {
      const ds = champ.driverStandings();
      const me = ds.find(r => r.driver.id === champ.playerDriverId);
      if (me) standing = `<div class="ss-pos"><i>YOU</i><b>P${me.pos}</b><span>${me.points} PTS</span></div>`;
    }
    return `<div class="season-strip">
      <div class="ss-round"><i>NEXT ROUND</i><b>${race.round}<em>/${CALENDAR.length}</em></b></div>
      <div class="ss-gp"><span class="ss-flag">${FLAGS[race.trackId] || '🏁'}</span>
        <b>${race.gp}</b><i>${circuitLabel(race, t)}${t.location ? ' · ' + t.location : ''}</i></div>
      <div class="ss-meta">${race.laps} LAPS${t.lengthKm ? ` · ${t.lengthKm.toFixed(3)} KM` : ''} · ${race.date}
        <span class="track-badges">${trackBadges(race.trackId)}</span></div>
      ${standing}
    </div>`;
  }
  if (champ.finished && typeof champ.driverStandings === 'function') {
    const ds = champ.driverStandings();
    return `<div class="season-strip done">
      <div class="ss-round"><i>SEASON</i><b>${SEASON}<em> COMPLETE</em></b></div>
      <div class="ss-gp"><span class="ss-flag">🏆</span><b>${champName(ds)}</b><i>World Champion — ${ds[0].points} points</i></div>
    </div>`;
  }
  return '';
}

// Per-round finish strip for the player, coloured by result band.
function roundStrip(log, playerId) {
  if (!playerId) return '';
  const byRound = new Map();
  for (const r of log || []) byRound.set(r.round, r);
  const dots = CALENDAR.map(race => {
    const rec = byRound.get(race.round);
    if (!rec) return `<i class="rd pending" title="R${race.round} ${race.gp}">${race.round}</i>`;
    // NOTE: test `!p` first — a null / 0 playerPos would otherwise satisfy
    // `p <= 3` and be painted as a podium.
    const p = rec.playerPos;
    const band = !p ? 'b-dnf' : p === 1 ? 'b-win' : p <= 3 ? 'b-pod' : p <= 10 ? 'b-pts' : 'b-out';
    return `<i class="rd ${band}" title="R${race.round} ${race.gp} — ${p ? 'P' + p : 'NC'}">${p || '—'}</i>`;
  }).join('');
  const done = log ? log.length : 0;
  return `<section class="panel round-panel">
    <header class="panel-head"><h3>YOUR SEASON</h3><span>${done} of ${CALENDAR.length} rounds</span></header>
    <div class="round-strip">${dots}</div>
    <footer class="strip-key">
      <span><i class="rd b-win"></i>WIN</span><span><i class="rd b-pod"></i>PODIUM</span>
      <span><i class="rd b-pts"></i>POINTS</span><span><i class="rd b-out"></i>OUT OF POINTS</span>
      <span><i class="rd b-dnf"></i>NO RESULT</span>
    </footer>
  </section>`;
}

// Points progress toward the championship leader — pure CSS bars.
function pointsBars(ds, playerId) {
  const top = ds.slice(0, 6);
  const lead = Math.max(1, top[0] ? top[0].points : 1);
  return `<section class="panel bars-panel">
    <header class="panel-head"><h3>POINTS PROGRESS</h3><span>top 6 vs leader</span></header>
    <div class="pts-bars">
      ${top.map(r => {
        const col = hex(teamById[r.driver.team].color);
        const w = Math.max(2, r.points / lead * 100);
        const gap = top[0].points - r.points;
        return `<div class="pb-row${r.driver.id === playerId ? ' me' : ''}">
          <span class="pb-name">${r.driver.code}</span>
          <span class="pb-track"><i style="width:${w.toFixed(1)}%;background:linear-gradient(90deg,${col},${shade(teamById[r.driver.team].color, 1.5)})"></i></span>
          <span class="pb-val">${r.points}</span>
          <span class="pb-gap">${gap ? '−' + gap : 'LEADER'}</span>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

// ---- circuit geometry ----------------------------------------------------
// Corner count estimated from the control-point polyline: curvature (rad/m)
// above a threshold opens a corner; a direction change or more than ~69° of
// accumulated rotation starts a new one. Cached per point array.
const _cornerCache = new WeakMap();
const CORNER_K = 0.003;      // rad per metre
const CORNER_SPLIT = 1.2;    // rad of accumulated turn before a run splits

export function cornerCount(points) {
  if (!points || points.length < 4) return 0;
  const hit = _cornerCache.get(points);
  if (hit !== undefined) return hit;
  const n = points.length, m = [];
  for (let i = 0; i < n; i++) {
    const p = points[(i - 1 + n) % n], c = points[i], q = points[(i + 1) % n];
    const a1 = Math.atan2(c[1] - p[1], c[0] - p[0]);
    const a2 = Math.atan2(q[1] - c[1], q[0] - c[0]);
    let d = a2 - a1;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const len = (Math.hypot(c[0] - p[0], c[1] - p[1]) + Math.hypot(q[0] - c[0], q[1] - c[1])) / 2;
    m.push({ d, k: Math.abs(d) / Math.max(1, len) });
  }
  // start on the straightest point so a corner is never split by the wrap
  let start = 0;
  for (let i = 1; i < n; i++) if (m[i].k < m[start].k) start = i;
  let corners = 0, run = 0, sign = 0, acc = 0;
  for (let i = 0; i < n; i++) {
    const { d, k } = m[(start + i) % n];
    const s = Math.sign(d);
    if (k >= CORNER_K) {
      if (run === 0 || s !== sign || acc >= CORNER_SPLIT) { corners++; acc = 0; }
      run++; sign = s; acc += Math.abs(d);
    } else { run = 0; sign = 0; acc = 0; }
  }
  _cornerCache.set(points, corners);
  return corners;
}

export function drawTrackPreview(canvas, points, color = '#ffffff') {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, pad = 12;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const [x, z] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const sc = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxZ - minZ || 1));
  const ox = (W - (maxX - minX) * sc) / 2 - minX * sc;
  const oz = (H - (maxZ - minZ) * sc) / 2 - minZ * sc;
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath();
  // smooth through midpoints (quadratic) for a clean preview from sparse control points
  const P = points.map(([x, z]) => [x * sc + ox, z * sc + oz]);
  const n = P.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let m0 = mid(P[n - 1], P[0]);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const p = P[i], m1 = mid(p, P[(i + 1) % n]);
    ctx.quadraticCurveTo(p[0], p[1], m1[0], m1[1]);
  }
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // start dot
  ctx.fillStyle = '#e10600';
  ctx.beginPath();
  ctx.arc(P[0][0], P[0][1], 3, 0, 7);
  ctx.fill();
}
