import { clamp } from '../core/rng';

export interface FlightSound {
  alive: boolean;
  throttle: number;
  boost: number;
  speed: number;
  cockpit: boolean;
  flyby: number;
  doppler: number;
  shipProximity: number;
  lock: 'none' | 'seeking' | 'locked';
  pullUp: boolean;
  pitch: number;
  roar: number;
  // How close a wall is on each side, 0 (none within range) to 1 (brushing it).
  wallLeft: number;
  wallRight: number;
}

interface ShotOptions {
  out?: AudioNode;
  delay?: number;
}

// Fire: a low roar with sparse pops.
function crackleBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let pop = 0;
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    if (Math.random() < 0.0009) pop = 0.4 + Math.random() * 0.6;
    pop *= 0.992;
    const w = Math.random() * 2 - 1;
    last = (last + 0.03 * w) / 1.03;
    d[i] = w * pop * 0.8 + last * 2.2;
  }
  return buf;
}

function noiseBuffer(ctx: AudioContext, seconds: number, brown = false): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

const CHORDS = [
  [50, 57, 62, 65],
  [46, 53, 58, 62],
  [41, 48, 57, 60],
  [43, 50, 55, 62],
];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private reverb!: ConvolverNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private ambient!: GainNode;
  private ambientFilter!: BiquadFilterNode;
  private crackleGain: GainNode | null = null;
  private wallBefore = [0, 0];
  private whooshCooldown = [0, 0];
  private engine: {
    whine: OscillatorNode;
    whineGain: GainNode;
    whineFilter: BiquadFilterNode;
    roarFilter: BiquadFilterNode;
    roarGain: GainNode;
    rumbleGain: GainNode;
    windGain: GainNode;
    windFilter: BiquadFilterNode;
    echoGain: GainNode;
  } | null = null;
  private drone: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private music: { gain: GainNode; filter: BiquadFilterNode; voices: OscillatorNode[] } | null = null;
  private beep: { osc: OscillatorNode; gain: GainNode } | null = null;
  private rainGain: GainNode | null = null;
  private chord = 0;
  private chordTimer = 0;
  private sirenTimer = 12;
  enabled = true;
  scene: 'title' | 'hangar' | 'flight' = 'title';

  get started() {
    return this.ctx !== null;
  }

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 3.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);
    // Sounds from outside: muffled when heard from inside the hangar.
    this.ambientFilter = ctx.createBiquadFilter();
    this.ambientFilter.type = 'lowpass';
    this.ambientFilter.frequency.value = 18000;
    this.ambient = ctx.createGain();
    this.ambient.connect(this.ambientFilter).connect(this.master);
    this.white = noiseBuffer(ctx, 2);
    this.brown = noiseBuffer(ctx, 4, true);
    this.buildEngine();
    this.buildDrone();
    this.buildMusic();
    this.buildBeep();
    this.buildRain();
    this.buildCrackle();
  }

  private buildCrackle() {
    const ctx = this.ctx!;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    this.loop(crackleBuffer(ctx, 3)).connect(hp).connect(this.crackleGain).connect(this.ambient);
  }

  setFire(nearness: number) {
    if (this.ctx && this.crackleGain) this.crackleGain.gain.setTargetAtTime(nearness * 0.3, this.ctx.currentTime, 0.3);
  }

  private buildRain() {
    const ctx = this.ctx!;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.loop(this.white).connect(hp).connect(lp).connect(this.rainGain).connect(this.ambient);
    const body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 420;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.9;
    this.loop(this.brown).connect(body).connect(bodyGain).connect(this.rainGain);
  }

  setRain(amount: number) {
    if (this.ctx && this.rainGain) this.rainGain.gain.setTargetAtTime(amount * 0.16, this.ctx.currentTime, 0.5);
  }

  thunder(strength: number) {
    this.shot(this.brown, 'lowpass', 500, 0.6, 1.1 * strength, 4.5, 50, 0.8, { out: this.ambient });
    this.shot(this.white, 'lowpass', 1800, 0.5, 0.25 * strength, 1.2, 120, 0.6, { out: this.ambient });
  }

  // One round from a rooftop gun, heard after the time sound takes to arrive.
  aaThump(distance: number) {
    const k = clamp(1 - distance / 4500, 0, 1);
    if (k <= 0) return;
    const delay = distance / 343;
    this.shot(this.brown, 'lowpass', 420, 0.8, 0.5 * k, 0.45, 70, 0.35, { out: this.ambient, delay });
    if (distance < 900) this.shot(this.white, 'bandpass', 1300, 1.2, 0.14 * k * k, 0.06, undefined, 0.2, { out: this.ambient, delay });
  }

  // A blast far beyond the horizon. Returns the delay before it is heard, in seconds.
  distantBoom(distance: number, strength: number): number {
    const delay = 1.5 + distance / 4000;
    const k = strength * clamp(1.2 - distance / 25000, 0.2, 1);
    this.shot(this.brown, 'lowpass', 220, 0.7, 0.4 * k, 3.8, 40, 0.9, { out: this.ambient, delay });
    return delay;
  }

  // Squelch at the start and end of a radio message.
  radio(open: boolean) {
    this.shot(this.white, 'bandpass', 1900, 2.5, open ? 0.08 : 0.05, open ? 0.14 : 0.09);
    this.tone('square', open ? 2400 : 1500, open ? 1800 : 1100, 0.015, 0.03);
  }

  private whoosh(side: number, strength: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(350, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.12);
    f.frequency.exponentialRampToValueAtTime(420, t + 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.24 * strength, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.55);
    const pan = ctx.createStereoPanner();
    pan.pan.value = side * 0.75;
    src.connect(f).connect(g).connect(pan).connect(this.sfx);
    src.start(t, Math.random() * 1.2, 0.6);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.1);
  }

  private loop(buffer: AudioBuffer): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.start();
    return s;
  }

  private buildEngine() {
    const ctx = this.ctx!;
    const whine = ctx.createOscillator();
    whine.type = 'sawtooth';
    const whineFilter = ctx.createBiquadFilter();
    whineFilter.type = 'bandpass';
    whineFilter.Q.value = 5;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineFilter).connect(whineGain).connect(this.sfx);
    whine.start();
    const roarFilter = ctx.createBiquadFilter();
    roarFilter.type = 'lowpass';
    const roarGain = ctx.createGain();
    roarGain.gain.value = 0;
    this.loop(this.white).connect(roarFilter).connect(roarGain).connect(this.sfx);
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 160;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    this.loop(this.brown).connect(rumbleFilter).connect(rumbleGain).connect(this.sfx);
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    this.loop(this.white).connect(windFilter).connect(windGain).connect(this.sfx);
    // Between tall buildings the engine roar comes back off the walls.
    const echoGain = ctx.createGain();
    echoGain.gain.value = 0;
    roarGain.connect(echoGain).connect(this.reverb);
    whineGain.connect(echoGain);
    this.engine = { whine, whineGain, whineFilter, roarFilter, roarGain, rumbleGain, windGain, windFilter, echoGain };
  }

  private buildDrone() {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 160;
    filter.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    for (const f of [36.7, 37.2, 55.1, 73.6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 70;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    filter.connect(gain);
    gain.connect(this.master);
    gain.connect(this.reverb);
    this.drone = { gain, filter };
  }

  private buildMusic() {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const voices: OscillatorNode[] = [];
    for (let i = 0; i < 8; i++) {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sawtooth' : 'triangle';
      o.detune.value = (i % 2 ? 1 : -1) * (4 + i);
      o.frequency.value = midi(CHORDS[0][i % 4]);
      const g = ctx.createGain();
      g.gain.value = i < 2 ? 0.08 : 0.05;
      o.connect(g).connect(filter);
      o.start();
      voices.push(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    filter.connect(gain);
    gain.connect(this.master);
    gain.connect(this.reverb);
    this.music = { gain, filter, voices };
  }

  private buildBeep() {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    osc.connect(f).connect(gain).connect(this.sfx);
    osc.start();
    this.beep = { osc, gain };
  }

  update(dt: number, time: number, flight: FlightSound | null) {
    const ctx = this.ctx;
    if (!ctx || !this.engine || !this.drone || !this.music || !this.beep) return;
    const t = ctx.currentTime;
    const e = this.engine;
    const inFlight = this.scene === 'flight' && flight !== null;
    const inHangar = this.scene === 'hangar';
    this.ambientFilter.frequency.setTargetAtTime(inHangar ? 650 : 18000, t, 0.4);
    this.ambient.gain.setTargetAtTime(inHangar ? 0.85 : 1, t, 0.4);

    this.sirenTimer -= dt;
    if (this.sirenTimer <= 0) {
      this.sirenTimer = 20 + Math.random() * 30;
      this.siren();
    }

    const flightMusic = 0.1 + 0.22 * (flight?.shipProximity ?? 0);
    this.music.gain.gain.setTargetAtTime(inFlight ? flightMusic : inHangar ? 0.5 : 0.62, t, 1.5);
    this.music.filter.frequency.setTargetAtTime(inFlight ? 380 : 700, t, 2);
    this.chordTimer -= dt;
    if (this.chordTimer <= 0) {
      this.chordTimer = 9;
      this.chord = (this.chord + 1) % CHORDS.length;
      this.music.voices.forEach((o, i) => o.frequency.setTargetAtTime(midi(CHORDS[this.chord][i % 4] + (i >= 4 ? 12 : 0)), t, 1.2));
    }

    if (!inFlight || !flight.alive) {
      for (const g of [e.whineGain, e.roarGain, e.rumbleGain, e.windGain, e.echoGain, this.beep.gain]) g.gain.setTargetAtTime(0, t, 0.15);
      this.drone.gain.gain.setTargetAtTime(inFlight ? 0.12 : this.scene === 'title' ? 0.1 : 0, t, 0.8);
      return;
    }
    const f = flight;
    const inside = f.cockpit ? 0.45 : 1;
    const dist = f.flyby > 0 ? clamp(1 - f.flyby / 700, 0.04, 1) : 1;
    const pitchMul = f.pitch * f.doppler;
    e.whine.frequency.setTargetAtTime((320 + 520 * f.throttle + 180 * f.boost) * pitchMul, t, 0.08);
    e.whineFilter.frequency.setTargetAtTime((900 + 1400 * f.throttle) * pitchMul, t, 0.08);
    e.whineGain.gain.setTargetAtTime((0.02 + 0.035 * f.throttle) * inside * dist, t, 0.1);
    e.roarFilter.frequency.setTargetAtTime((380 + 1600 * f.throttle + 2600 * f.boost) * f.doppler, t, 0.1);
    e.roarGain.gain.setTargetAtTime((0.05 + 0.1 * f.throttle + 0.22 * f.boost) * f.roar * inside * dist, t, 0.1);
    e.rumbleGain.gain.setTargetAtTime((0.15 + 0.6 * f.boost) * f.roar * dist, t, 0.12);
    e.windFilter.frequency.setTargetAtTime(500 + f.speed * 4, t, 0.2);
    e.windGain.gain.setTargetAtTime(clamp((f.speed - 60) / 400, 0, 0.3) * (f.cockpit ? 1.4 : 0.8) * dist, t, 0.2);
    this.drone.gain.gain.setTargetAtTime(0.1 + 0.55 * f.shipProximity, t, 0.5);

    e.echoGain.gain.setTargetAtTime(Math.max(f.wallLeft, f.wallRight) * 0.4 * inside * dist, t, 0.15);
    [f.wallLeft, f.wallRight].forEach((w, i) => {
      this.whooshCooldown[i] -= dt;
      if (w > 0.35 && this.wallBefore[i] <= 0.35 && this.whooshCooldown[i] <= 0 && f.speed > 70 && f.flyby === 0) {
        this.whoosh(i === 0 ? -1 : 1, Math.min(1, (w * f.speed) / 220) * inside);
        this.whooshCooldown[i] = 0.35;
      }
      this.wallBefore[i] = w;
    });

    let beepOn = 0;
    if (f.pullUp) {
      this.beep.osc.frequency.setTargetAtTime(760, t, 0.01);
      beepOn = Math.sin(time * 18) > 0 ? 0.05 : 0;
    } else if (f.lock === 'locked') {
      this.beep.osc.frequency.setTargetAtTime(1320, t, 0.01);
      beepOn = 0.035;
    } else if (f.lock === 'seeking') {
      this.beep.osc.frequency.setTargetAtTime(1050, t, 0.01);
      beepOn = Math.sin(time * 40) > 0.3 ? 0.025 : 0;
    }
    this.beep.gain.gain.setTargetAtTime(beepOn, t, 0.008);
  }

  private shot(buffer: AudioBuffer, filterType: BiquadFilterType, freq: number, q: number, gain: number, dur: number, sweepTo?: number, send = 0, opts: ShotOptions = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(opts.out ?? this.sfx);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.reverb);
    }
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private tone(type: OscillatorType, from: number, to: number, gain: number, dur: number, send = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.sfx);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.reverb);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  gun(kind: 'cannon' | 'rotary' | 'plasma') {
    if (kind === 'plasma') {
      this.tone('sawtooth', 1100, 220, 0.07, 0.14, 0.25);
      this.tone('sine', 300, 90, 0.08, 0.1);
    } else if (kind === 'rotary') {
      this.shot(this.white, 'bandpass', 1100, 1.4, 0.12, 0.045);
      this.tone('sine', 120, 55, 0.08, 0.04);
    } else {
      this.shot(this.white, 'bandpass', 1400, 1.2, 0.18, 0.07);
      this.tone('sine', 140, 60, 0.12, 0.05);
    }
  }

  launch(kind: 'missile' | 'volley' | 'rail' | 'flak' | 'orb') {
    if (kind === 'missile' || kind === 'volley') {
      const n = kind === 'volley' ? 4 : 1;
      for (let i = 0; i < n; i++) window.setTimeout(() => this.shot(this.white, 'bandpass', 500, 1.5, 0.3, 1.0, 2400, 0.3), i * 70);
      this.tone('sine', 90, 40, 0.3, 0.2);
    } else if (kind === 'rail') {
      this.shot(this.white, 'highpass', 2500, 0.8, 0.5, 0.25, 800, 0.5);
      this.tone('square', 1800, 90, 0.18, 0.5, 0.6);
      this.tone('sine', 60, 30, 0.5, 0.6);
    } else if (kind === 'flak') {
      this.tone('sine', 110, 45, 0.45, 0.25);
      this.shot(this.brown, 'lowpass', 900, 0.8, 0.5, 0.3, 200, 0.3);
    } else {
      this.tone('sawtooth', 180, 60, 0.18, 1.1, 0.7);
      this.tone('sine', 520, 140, 0.12, 0.9, 0.6);
    }
  }

  charge() {
    this.tone('sawtooth', 200, 2400, 0.06, 0.45, 0.3);
  }

  explosion(distance: number) {
    const k = clamp(1 - distance / 3500, 0.03, 1);
    this.shot(this.brown, 'lowpass', 2600, 0.7, 0.9 * k, 2.2, 90, 0.6);
    this.shot(this.white, 'lowpass', 4000, 0.5, 0.35 * k, 0.9, 300, 0.4);
    this.tone('sine', 70, 28, 0.6 * k, 0.9);
  }

  alienZap(distance: number) {
    const k = clamp(1 - distance / 1400, 0, 1);
    if (k <= 0) return;
    this.tone('sawtooth', 1500, 260, 0.06 * k, 0.16, 0.4);
  }

  hit() {
    this.shot(this.white, 'bandpass', 3200, 3, 0.25, 0.12);
    this.tone('triangle', 600, 420, 0.1, 0.2);
  }

  uiMove() {
    this.tone('triangle', 900, 700, 0.05, 0.06);
  }

  uiConfirm() {
    this.tone('triangle', 520, 1040, 0.07, 0.25, 0.4);
  }

  jetSwap() {
    this.shot(this.white, 'bandpass', 300, 1, 0.2, 0.45, 1200, 0.3);
    this.tone('sine', 110, 55, 0.25, 0.35, 0.3);
  }

  private siren() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.02, t + 1.5);
    g.gain.linearRampToValueAtTime(0, t + 9);
    for (let i = 0; i < 6; i++) {
      o.frequency.setValueAtTime(680, t + i * 1.5);
      o.frequency.linearRampToValueAtTime(980, t + i * 1.5 + 0.75);
    }
    o.frequency.linearRampToValueAtTime(680, t + 9);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    o.connect(g).connect(pan);
    pan.connect(this.reverb);
    pan.connect(this.ambient);
    o.start(t);
    o.stop(t + 9.2);
  }
}
