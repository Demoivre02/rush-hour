// engineWorklet.js: a physically modelled engine, run on the audio thread.
//
// Loaded with audioContext.audioWorklet.addModule() by js/gameAudio.js; one
// node per audible engine (the player's car and the nearest rival).
//
// The model, per sample:
//   1. The crank turns at `rpm`. Each cylinder fires once per 720° of crank
//      at its own angle from the engine's real firing order, so a crossplane
//      V8 lumps unevenly into each exhaust bank, a flat-plane V8 or a flat-six
//      fires evenly and rasps, a V12 overlaps into a smooth scream.
//   2. A firing sends a pressure pulse (a short decaying burst of noise plus
//      a low thump) into the exhaust bank its cylinder belongs to. Its size
//      follows load (throttle); off throttle the cylinders only pump.
//   3. Each bank is an exhaust pipe: a delay line with damped feedback, a
//      waveguide whose length sets the pipe's resonance.
//   4. The banks meet in the muffler (a low-pass that opens with load),
//      then intake roar, supercharger whine, turbo whistle, a soft clip.
//   Rev limiter (ignition cut), lift-off pops and a lumpy cam idle come from
//   the same firing logic.
//
// Car character lives in the config js/gameAudio.js sends (ENGINE_SPECS).

const TWO_PI = Math.PI * 2;

class Bank {
  constructor(sr, pipeMs, fb, damp) {
    this.size = 4096;
    this.buf = new Float32Array(this.size);
    this.w = 0;
    this.set(sr, pipeMs, fb, damp);
    this.lp = 0;
    this.env = 0;
    this.ph = 0;          // phase of the combustion thump
  }
  set(sr, pipeMs, fb, damp) {
    this.delay = Math.max(8, Math.min(this.size - 2, Math.round(pipeMs * sr / 1000)));
    this.fb = fb;
    this.damp = damp;
  }
  step(x) {
    let r = this.w - this.delay;
    if (r < 0) r += this.size;
    const back = this.buf[r];
    this.lp += (back - this.lp) * this.damp;      // pipe losses: highs die first
    const y = x + this.fb * this.lp;
    this.buf[this.w] = y;
    this.w = (this.w + 1) % this.size;
    return y;
  }
}

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 900, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'boost', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    this.sr = sampleRate;
    this.crank = 0;
    this.seed = 22222;
    this.mufLp = 0;
    this.mufLp2 = 0;
    this.dc = 0;
    this.dcPrev = 0;
    this.intakeLp = 0;
    this.pulseNoise = 0;
    this.intakeBp = 0;
    this.whinePhase = 0;
    this.turboPhase = 0;
    this.spool = 0;
    this.cutT = 0;
    this.fireT = 0;
    this.popEnv = 0;
    this.configure(options?.processorOptions?.spec || {});
    this.port.onmessage = (e) => {
      if (e.data?.spec) this.configure(e.data.spec);
    };
  }

  configure(spec) {
    const s = {
      // firing angles in crank degrees over the 720° cycle, and the exhaust
      // bank each cylinder feeds
      firing: [0, 180, 360, 540], banks: [0, 0, 0, 0],
      pipeMs: [3.2, 3.2], fb: 0.55, damp: 0.35,
      pulseMs: 2.2, noise: 0.55, thumpHz: 70,
      muffler: 1800, mufflerOpen: 5200, intake: 0.25, whine: 0, whineRatio: 3.2,
      turbo: 0, turboHz: 3200, rough: 0.15, pops: 0.3, redline: 7000, idle: 850,
      vtecRpm: 0, drive: 1.6, level: 0.5,
      ...spec,
    };
    this.s = s;
    const nb = Math.max(1, Math.max(...s.banks) + 1);
    this.bankList = [];
    for (let b = 0; b < nb; b++) {
      const ms = s.pipeMs[b] ?? s.pipeMs[0];
      this.bankList[b] = this.bankList[b] || new Bank(this.sr, ms, s.fb, s.damp);
      this.bankList[b].set(this.sr, ms, s.fb, s.damp);
    }
    this.bankList.length = nb;
    // firing angles sorted with their bank, for a cheap crossing test
    this.fires = s.firing.map((deg, i) => ({ deg, bank: s.banks[i] ?? 0 })).sort((a, b) => a.deg - b.deg);
  }

  rand() {
    // xorshift: deterministic, allocation-free noise
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0;
    return (this.seed / 4294967296) * 2 - 1;
  }

  fire(f, rpm, load) {
    const s = this.s;
    const bank = this.bankList[f.bank];
    // rev limiter: ignition cut in short bursts at the redline
    // (revs dip during a cut, so a short burst of firings follows each one:
    // the bounce, about 12 times a second)
    if (this.cutT > 0) return;
    if (rpm >= s.redline * 0.995 && this.fireT <= 0) { this.cutT = 0.045; return; }
    const idleness = Math.max(0, 1 - (rpm - s.idle) / (s.idle * 2.5));
    const lump = 1 + s.rough * idleness * this.rand() * 1.6;     // cam lope at idle
    // Off throttle the engine still fires at idle (it has to, to keep running)
    // but only pumps when the car's momentum spins it faster: engine braking.
    const offAmp = 0.42 * idleness + 0.13 * (1 - idleness);
    let amp = load > 0.04 ? (0.42 + 0.58 * load) * lump : offAmp * lump;
    // lift-off pops: unburnt fuel lighting in the hot exhaust
    if (load < 0.05 && rpm > s.redline * 0.45 && Math.random() < s.pops * 0.06) {
      this.popEnv = 0.9 + Math.random() * 0.6;
      amp *= 2.2;
    }
    bank.env = Math.max(bank.env, amp);
    bank.ph = 0;                       // each firing starts its thump afresh
  }

  process(inputs, outputs, parameters) {
    const out = outputs[0];
    const L = out[0];
    if (!L) return true;
    const s = this.s;
    const rpm = Math.max(0, parameters.rpm[0]);
    const load = Math.max(0, Math.min(1, parameters.load[0]));
    const boost = Math.max(0, Math.min(1, parameters.boost[0]));
    const sr = this.sr;
    const degPerSample = 6 * rpm / sr;
    const revs = Math.min(1, rpm / s.redline);
    // pulse length shortens at high rpm (less time between firings)
    const pulseDecay = Math.exp(-1 / (sr * (s.pulseMs / 1000) * (1.25 - 0.55 * revs)));
    const thumpW = TWO_PI * s.thumpHz / sr;
    const vtec = s.vtecRpm && rpm > s.vtecRpm ? 1 : 0;
    // muffler opens with load and revs (and VTEC's second cam)
    const cut = Math.min(5200, s.muffler + (s.mufflerOpen - s.muffler) * Math.min(1, load * 0.7 + revs * 0.5 + vtec * 0.3));
    const mufA = 1 - Math.exp(-TWO_PI * cut / sr);
    const intakeAmt = s.intake * load * (0.3 + 0.7 * revs) * (1 + vtec * 1.2);
    // turbo spools with boost demand and revs; whistle rises with spool
    this.spool += ((s.turbo ? boost * (0.25 + 0.75 * revs) : 0) - this.spool) * 0.004;
    const turboW = TWO_PI * s.turboHz * (0.35 + 0.65 * this.spool) / sr;
    const whineW = TWO_PI * (rpm / 60) * s.whineRatio * 8 / sr;
    const wasCut = this.cutT > 0;
    this.cutT = Math.max(0, this.cutT - 128 / sr);
    this.fireT = Math.max(0, (this.fireT || 0) - 128 / sr);
    if (wasCut && this.cutT === 0) this.fireT = 0.035;
    // during a limiter cut the whole note drops, intake and blower included
    const cutGain = this.cutT > 0 ? 0.25 : 1;
    const level = s.level;
    for (let i = 0; i < L.length; i++) {
      // crank and firings
      const prev = this.crank;
      this.crank += degPerSample;
      if (this.crank >= 720) this.crank -= 720;
      const wrapped = this.crank < prev;
      for (const f of this.fires) {
        if (wrapped ? (f.deg > prev || f.deg <= this.crank) : (f.deg > prev && f.deg <= this.crank)) {
          this.fire(f, rpm, load);
        }
      }
      // exhaust banks
      let ex = 0;
      // texture noise for the pulses, low-passed (a pressure wave, not hiss)
      this.pulseNoise += (this.rand() - this.pulseNoise) * 0.18;
      for (const bank of this.bankList) {
        // a pressure bump (the decaying envelope itself), a little textured
        // noise, and the low combustion thump
        const pulse = bank.env * (0.75 + s.noise * 0.6 * this.pulseNoise) + bank.env * 0.35 * Math.sin(bank.ph);
        bank.ph += thumpW;
        bank.env *= pulseDecay;
        ex += bank.step(pulse);
      }
      if (this.popEnv > 0.001) {
        ex += this.popEnv * this.rand() * 1.4;
        this.popEnv *= 0.9965;
      }
      // muffler (two poles) and DC block
      this.mufLp += (ex - this.mufLp) * mufA;
      this.mufLp2 += (this.mufLp - this.mufLp2) * mufA;
      let y = this.mufLp2;
      const hp = y - this.dcPrev + 0.995 * this.dc;
      this.dcPrev = y;
      this.dc = hp;
      y = hp;
      // intake roar: band-limited noise
      if (intakeAmt > 0) {
        const n = this.rand();
        this.intakeLp += (n - this.intakeLp) * 0.25;
        this.intakeBp += (this.intakeLp - this.intakeBp) * 0.05;
        y += (this.intakeLp - this.intakeBp) * intakeAmt * cutGain;
      }
      // supercharger whine and turbo whistle
      if (s.whine) {
        this.whinePhase += whineW;
        if (this.whinePhase > TWO_PI) this.whinePhase -= TWO_PI;
        y += Math.sin(this.whinePhase) * s.whine * revs * (0.4 + 0.6 * load) * 0.12 * cutGain;
      }
      if (s.turbo && this.spool > 0.02) {
        this.turboPhase += turboW;
        if (this.turboPhase > TWO_PI) this.turboPhase -= TWO_PI;
        y += Math.sin(this.turboPhase) * s.turbo * this.spool * 0.05;
      }
      // soft clip: the exhaust's growl at full load
      L[i] = Math.tanh(y * s.drive) * level;
    }
    for (let c = 1; c < out.length; c++) out[c].set(L);
    return true;
  }
}

registerProcessor('rush-engine', EngineProcessor);
