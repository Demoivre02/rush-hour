// Adaptive rendering quality. Keeps the visual stack coherent while scaling the
// expensive parts (pixel ratio, AO, bloom and shadows) as one preset.

export const QUALITY_ORDER = ['low', 'medium', 'high'];

// Medium renders at the display's own pixel density and high supersamples it
// (1.25x, capped at 2), both with 4x MSAA and FXAA off: FXAA smears texture
// detail, while multisampling smooths edges and keeps it. On a Retina screen
// both land on 2. Only low trades sharpness for speed (FXAA, no MSAA).
export const QUALITY_PRESETS = {
  low: {
    pixelRatio: 1.25,
    maxPixels: 1_400_000,
    fxaa: true,
    msaa: 0,
    gtao: false,
    gtaoScale: 0.5,
    bloom: false,
    shadows: false,
    shadowMap: 512,
  },
  medium: {
    pixelRatio: 2,
    supersample: 1,
    maxPixels: 3_000_000,
    fxaa: false,
    msaa: 4,
    gtao: true,
    gtaoScale: 0.5,
    bloom: true,
    shadows: true,
    shadowMap: 2048,
  },
  high: {
    pixelRatio: 2,
    supersample: 1.25,   // with 4x MSAA on top (was 1.5x alone)
    maxPixels: 3_800_000,
    fxaa: false,
    msaa: 4,
    gtao: true,
    gtaoScale: 0.5,
    bloom: true,
    shadows: true,
    shadowMap: 4096,
  },
};

function safeDeviceMemory() {
  const n = typeof navigator !== 'undefined' ? Number(navigator.deviceMemory) : 0;
  return Number.isFinite(n) ? n : 0;
}

function lowEndDevice() {
  const mobile = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
  const memory = safeDeviceMemory();
  return mobile || (memory > 0 && memory <= 4);
}

function initialAutoTier() {
  return lowEndDevice() ? 'low' : 'high';
}

export class QualityController {
  constructor(renderer, onTierChange = null) {
    this.renderer = renderer;
    this.onTierChange = onTierChange;
    this.mode = 'auto';
    this.autoTier = initialAutoTier();
    // Automatic mode never drops a desktop below medium, so the picture stays
    // at full sharpness; it sheds shadow resolution instead.
    this.minAutoTier = lowEndDevice() ? 'low' : 'medium';
    this.appliedTier = null;
    this.width = typeof innerWidth === 'number' ? innerWidth : 1280;
    this.height = typeof innerHeight === 'number' ? innerHeight : 720;
    this.composer = null;
    this.gtao = null;
    this.bloom = null;
    this.fxaa = null;
    this.sun = null;
    this._sampleTime = 0;
    this._sampleFrames = 0;
    this._slowWindows = 0;
    this._fastWindows = 0;
    this._cooldown = 0;
    this._composerSynced = null;
    this._appliedPixelRatio = null;
    this._appliedWidth = null;
    this._appliedHeight = null;
    // Dynamic resolution: a 0.75-1 factor on the render resolution, steered by
    // measured frame time in every mode, so a big window (a 3440x1440
    // ultrawide is 5 megapixels) stays smooth instead of lagging.
    this.renderScale = 1;
    this._drsTime = 0;
    this._drsFrames = 0;
    this._drsSlow = 0;
    this._drsFast = 0;
    this._drsHold = 0;
    this._drsProbe = null;
  }

  get tier() { return this.mode === 'auto' ? this.autoTier : this.mode; }

  bind({ composer = null, gtao = null, bloom = null, fxaa = null, sun = null, grade = null } = {}) {
    this.composer = composer;
    this.grade = grade;
    this.gtao = gtao;
    this.bloom = bloom;
    this.fxaa = fxaa;
    this.sun = sun;
    this._composerSynced = null;
    this.apply(true);
  }

  setMode(mode) {
    this.mode = mode === 'auto' || QUALITY_PRESETS[mode] ? mode : 'auto';
    this._steppedDown = false;
    if (this.mode === 'auto' && !QUALITY_PRESETS[this.autoTier]) this.autoTier = initialAutoTier();
    this._slowWindows = 0;
    this._fastWindows = 0;
    this.apply(true);
  }

  resize(width, height) {
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    this.apply(true);
  }

  /**
   * Dynamic resolution, once a second: below ~55 fps the render scale steps
   * down 6% (never under 75%); after six comfortable seconds (above ~70 fps), and not within
   * 20 s of a step down, it creeps back up 4%.
   */
  _dynamicResolution(rawDt) {
    if (!Number.isFinite(rawDt) || rawDt <= 0 || rawDt > 0.25) return;
    if (this._drsHold > 0) { this._drsHold -= rawDt; return; }
    this._drsTime += rawDt;
    this._drsFrames++;
    if (this._drsTime < 1) return;
    const frameMs = this._drsTime / this._drsFrames * 1000;
    this._drsTime = 0;
    this._drsFrames = 0;
    // Did the last step down help? If the frame time did not improve, the
    // slowdown is not the pixel count (CPU, another tab): put the resolution
    // back and leave it alone for a while rather than blur the picture for
    // nothing.
    if (this._drsProbe) {
      const { from, before } = this._drsProbe;
      this._drsProbe = null;
      if (frameMs > before * 0.95) {
        this.renderScale = from;
        this._drsHold = 30;
        this._drsSlow = 0;
        this._drsFast = 0;
        this.apply(true);
        return;
      }
    }
    this._drsSlow = frameMs > 18.2 ? this._drsSlow + 1 : 0;
    this._drsFast = frameMs < 14.2 ? this._drsFast + 1 : 0;
    // Every change reallocates the render targets (a one-frame hitch), so the
    // scale settles: no step up within 20 s of a step down, and a step up
    // needs six comfortable seconds in a row.
    if (this._drsUpBlock > 0) this._drsUpBlock -= 1;
    let next = this.renderScale;
    if (this._drsSlow >= 1) next = Math.max(0.75, this.renderScale - 0.06);
    else if (this._drsFast >= 6 && !(this._drsUpBlock > 0)) next = Math.min(1, this.renderScale + 0.04);
    if (Math.abs(next - this.renderScale) > 0.001) {
      if (next < this.renderScale) {
        this._drsProbe = { from: this.renderScale, before: frameMs };
        this._drsUpBlock = 20;                      // seconds (one tick per window)
      }
      this.renderScale = next;
      this._drsSlow = 0;
      this._drsFast = 0;
      // the frame after a resize is slow; skip it when measuring
      this._drsHold = 0.3;
      this.apply(true);
    }
  }

  update(rawDt) {
    this._dynamicResolution(rawDt);
    if (this.mode !== 'auto' || !Number.isFinite(rawDt) || rawDt <= 0) return;
    if (this._cooldown > 0) this._cooldown = Math.max(0, this._cooldown - rawDt);
    // Ignore background-tab gaps; blur/visibility handling pauses the game.
    if (rawDt > 0.25) return;
    this._sampleTime += rawDt;
    this._sampleFrames++;
    if (this._sampleTime < 2) return;

    const frameMs = this._sampleTime / Math.max(1, this._sampleFrames) * 1000;
    this._sampleTime = 0;
    this._sampleFrames = 0;
    this._slowWindows = frameMs > 20.5 ? this._slowWindows + 1 : 0;
    this._fastWindows = frameMs < 16.9 ? this._fastWindows + 1 : 0;
    if (this._cooldown > 0) return;

    const i = QUALITY_ORDER.indexOf(this.autoTier);
    if (this._slowWindows >= 2 && i > QUALITY_ORDER.indexOf(this.minAutoTier)) {
      // Once automatic mode has had to step down it stays down: every tier
      // change resizes the whole render pipeline, and stepping back up and down
      // again read as the game freezing at speed.
      this._steppedDown = true;
      this.autoTier = QUALITY_ORDER[i - 1];
      this._slowWindows = 0;
      this._fastWindows = 0;
      this._cooldown = 6;
      this.apply();
    } else if (this._fastWindows >= 4 && i < QUALITY_ORDER.length - 1 && !this._steppedDown) {
      this.autoTier = QUALITY_ORDER[i + 1];
      this._slowWindows = 0;
      this._fastWindows = 0;
      this._cooldown = 10;
      this.apply();
    }
  }

  apply(force = false) {
    const tier = this.tier;
    const p = QUALITY_PRESETS[tier] || QUALITY_PRESETS.medium;
    const changed = tier !== this.appliedTier;
    if (!changed && !force) return;

    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    // the tier's ratio, capped by its pixel budget for this window size, then
    // the dynamic-resolution factor
    const budgetRatio = p.maxPixels ? Math.sqrt(p.maxPixels / Math.max(1, this.width * this.height)) : Infinity;
    const pixelRatio = Math.max(0.35, Math.min(dpr * (p.supersample || 1), p.pixelRatio, budgetRatio) * this.renderScale);
    const pixelRatioChanged = pixelRatio !== this._appliedPixelRatio;
    const sizeChanged = this.width !== this._appliedWidth || this.height !== this._appliedHeight;
    // The canvas always runs at the display's native resolution; only the 3D
    // render (the composer's targets) uses `pixelRatio`. The last pass then
    // upscales with sharpening at native resolution, instead of the browser
    // stretching a small canvas (which blurred big screens). Low keeps the
    // old path: a smaller canvas is cheaper on weak devices.
    // (capped at 4K, 8.3 MP: a Retina-scaled ultrawide would otherwise be an
    // 18 MP canvas whose extra pixels cost memory and cannot be seen)
    const outputRatio = tier === 'low' ? pixelRatio
      : Math.max(pixelRatio, Math.min(dpr, 2, Math.sqrt(8_300_000 / Math.max(1, this.width * this.height))));
    this.renderer.setPixelRatio(outputRatio);
    this.renderer.shadowMap.enabled = p.shadows;
    this.renderer.setSize(this.width, this.height);
    if (this.gtao?.setResolutionScale) this.gtao.setResolutionScale(p.gtaoScale);
    if (this.composer) {
      const composerChanged = this.composer !== this._composerSynced;
      // Ratio and size together: setPixelRatio() alone reuses the composer's
      // last size, which left a stale (small) buffer after a window resize.
      if (composerChanged || pixelRatioChanged) this.composer.setPixelRatio(pixelRatio);
      if (composerChanged || pixelRatioChanged || sizeChanged || force) this.composer.setSize(this.width, this.height);
      this._composerSynced = this.composer;
    }
    // a little more sharpening the further the render is upscaled
    if (this.grade?.uniforms?.upscale) this.grade.uniforms.upscale.value = Math.max(0, Math.min(1, 1 - pixelRatio / outputRatio));
    if (this.gtao) this.gtao.enabled = p.gtao;
    if (this.bloom) this.bloom.enabled = p.bloom;
    if (this.fxaa) this.fxaa.enabled = p.fxaa;
    // MSAA lives on the composer's scene targets; a sample-count change needs
    // the targets reallocated
    if (this.composer?.renderTarget1) {
      const samples = p.msaa || 0;
      for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        if (t && t.samples !== samples) { t.samples = samples; t.dispose(); }
      }
    }
    if (this.sun) {
      const sizeChanged = this.sun.shadow.mapSize.x !== p.shadowMap;
      this.sun.castShadow = p.shadows;
      this.sun.shadow.mapSize.set(p.shadowMap, p.shadowMap);
      if (sizeChanged && this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }

    this.appliedTier = tier;
    this._appliedPixelRatio = pixelRatio;
    this._appliedWidth = this.width;
    this._appliedHeight = this.height;
    if (changed && typeof this.onTierChange === 'function') {
      this.onTierChange(tier, this.mode === 'auto');
    }
  }
}
