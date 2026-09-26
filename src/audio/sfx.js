import { mtof } from './core.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const PENTA = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84, 86, 89];

// One-shot sound design. Every sound is synthesized: noise, oscillators and plucked strings.
export class Sfx {
  constructor(core) {
    this.a = core;
    this.fireflyCombo = 0;
    this.fireflyT = 0;
  }
  get ok() {
    return this.a.ready;
  }
  get d() {
    return this.a.sfx;
  }

  step(surface, { pan = 0, wade = 0, speed = 4, cave = 0 } = {}) {
    if (!this.ok) return;
    const a = this.a, d = this.d;
    const v = 0.5 + Math.min(1, speed / 4.7) * 0.5;
    const verb = 0.05 + cave * 0.25;
    if (wade > 0.15) {
      a.burst(d, { kind: 'white', type: 'bandpass', freq: rnd(900, 1500), freq1: rnd(400, 600), Q: 0.9, dur: 0.22, gain: 0.22 * v, pan, verb });
      a.burst(d, { kind: 'pink', type: 'lowpass', freq: 700, dur: 0.12, gain: 0.18 * v, pan, when: 0.03 });
      for (let i = 0; i < 3; i++) a.tone(d, { freq: rnd(500, 900), freq1: rnd(1200, 1900), dur: 0.05, gain: 0.02, pan, when: 0.05 + i * 0.03 });
      return;
    }
    switch (surface) {
      case 'wood':
      case 'bridge':
      case 'roof': {
        const f = surface === 'roof' ? rnd(220, 260) : rnd(150, 190);
        a.tone(d, { type: 'triangle', freq: f, freq1: f * 0.7, dur: 0.09, gain: 0.16 * v, pan, verb });
        a.tone(d, { type: 'sine', freq: f * 2.3, dur: 0.05, gain: 0.05 * v, pan });
        a.burst(d, { kind: 'white', type: 'highpass', freq: 2500, dur: 0.02, gain: 0.06 * v, pan });
        if (surface === 'bridge' && Math.random() < 0.3) this.creak(pan, 0.5);
        break;
      }
      case 'stone':
      case 'cave':
        a.burst(d, { kind: 'white', type: 'bandpass', freq: rnd(2200, 3200), Q: 1.4, dur: 0.035, gain: 0.12 * v, pan, verb: verb + (surface === 'cave' ? 0.2 : 0) });
        a.burst(d, { kind: 'brown', type: 'lowpass', freq: 400, dur: 0.06, gain: 0.25 * v, pan });
        a.burst(d, { kind: 'pink', type: 'bandpass', freq: rnd(900, 1300), Q: 2, dur: 0.05, gain: 0.05 * v, pan, when: 0.015 });
        break;
      case 'mud':
        a.burst(d, { kind: 'pink', type: 'bandpass', freq: rnd(350, 500), freq1: rnd(800, 1100), Q: 2.2, dur: 0.11, gain: 0.2 * v, pan, verb });
        a.burst(d, { kind: 'brown', type: 'lowpass', freq: 300, dur: 0.07, gain: 0.25 * v, pan });
        break;
      case 'crystal':
        a.bell(d, { freq: mtof(PENTA[Math.floor(Math.random() * 5) + 5]), gain: 0.05, dur: 1.2, pan, verb: 0.6 });
        a.burst(d, { kind: 'white', type: 'highpass', freq: 5000, dur: 0.03, gain: 0.05, pan });
        break;
      default: // grass
        a.burst(d, { kind: 'pink', type: 'bandpass', freq: rnd(1400, 2400), Q: 0.6, dur: 0.09, gain: 0.16 * v, pan, verb });
        a.burst(d, { kind: 'white', type: 'highpass', freq: 3500, dur: 0.12, attack: 0.02, gain: 0.04 * v, pan, curve: 'lin' });
        a.burst(d, { kind: 'brown', type: 'lowpass', freq: 260, dur: 0.06, gain: 0.22 * v, pan });
    }
  }

  jump(surface, wade) {
    if (!this.ok) return;
    const a = this.a;
    a.burst(this.d, { kind: 'pink', type: 'bandpass', freq: 500, freq1: 1600, Q: 1.2, dur: 0.2, attack: 0.03, gain: 0.12, curve: 'lin' });
    if (wade > 0.1) this.splash(0, 0.4);
  }

  land(surface, v, { pan = 0, wade = 0 } = {}) {
    if (!this.ok) return;
    const a = this.a, d = this.d;
    const k = Math.min(1, v / 16);
    if (wade > 0.1) return this.splash(pan, 0.3 + k * 0.5);
    a.tone(d, { freq: 90, freq1: 38, dur: 0.14 + k * 0.1, gain: 0.25 + k * 0.35, pan });
    a.burst(d, { kind: 'brown', type: 'lowpass', freq: 500 + k * 400, dur: 0.1 + k * 0.1, gain: 0.25 + k * 0.3, pan, verb: 0.08 });
    this.step(surface, { pan, speed: 3 + k * 3 });
    // cloth settles
    a.burst(d, { kind: 'pink', type: 'bandpass', freq: 1200, freq1: 600, Q: 0.8, dur: 0.18, attack: 0.02, gain: 0.05 + k * 0.05, when: 0.04, pan });
  }

  splash(pan = 0, size = 1) {
    if (!this.ok) return;
    const a = this.a, d = this.d;
    a.burst(d, { kind: 'white', type: 'bandpass', freq: 1400, freq1: 500, Q: 0.7, dur: 0.35 * size + 0.1, gain: 0.35 * size, pan, verb: 0.2 });
    a.burst(d, { kind: 'brown', type: 'lowpass', freq: 500, dur: 0.3 * size, gain: 0.4 * size, pan });
    for (let i = 0; i < 6 * size; i++) a.tone(d, { freq: rnd(400, 800), freq1: rnd(1100, 2200), dur: 0.04, gain: 0.03 * size, pan: pan + rnd(-0.2, 0.2), when: 0.08 + Math.random() * 0.35 });
  }

  creak(pan = 0, g = 1) {
    if (!this.ok) return;
    const a = this.a, ctx = a.ctx, t = a.now;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = rnd(90, 150);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * rnd(1.3, 1.8), t + 0.35);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rnd(25, 45);
    const lg = ctx.createGain();
    lg.gain.value = f0 * 0.15;
    lfo.connect(lg).connect(o.frequency);
    const bp = a.filter('bandpass', 900, 5);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.05 * g, t + 0.08);
    env.gain.linearRampToValueAtTime(0.0001, t + 0.45);
    o.connect(bp).connect(env).connect(a.voice(this.d, { pan, verb: 0.2 }));
    o.start(t); lfo.start(t);
    o.stop(t + 0.5); lfo.stop(t + 0.5);
  }

  flare() {
    if (!this.ok) return;
    const a = this.a, d = this.d;
    a.burst(d, { kind: 'pink', type: 'lowpass', freq: 250, freq1: 5000, Q: 0.8, dur: 0.55, attack: 0.04, gain: 0.5, verb: 0.3 });
    a.tone(d, { freq: 110, freq1: 38, dur: 0.7, gain: 0.45 });
    a.burst(d, { kind: 'white', type: 'highpass', freq: 3000, dur: 0.9, attack: 0.05, gain: 0.08, verb: 0.5, curve: 'lin' });
    for (const [i, m] of [74, 81, 86, 93].entries()) a.bell(d, { freq: mtof(m), gain: 0.07, dur: 2.2, verb: 0.8, when: 0.03 + i * 0.035 });
  }

  flareFail() {
    if (!this.ok) return;
    for (let i = 0; i < 3; i++) this.a.burst(this.d, { kind: 'white', type: 'bandpass', freq: 1800, Q: 2, dur: 0.03, gain: 0.08, when: i * 0.06 });
  }

  firefly(pan = 0) {
    if (!this.ok) return;
    const t = this.a.now;
    if (t - this.fireflyT > 2.2) this.fireflyCombo = 0;
    this.fireflyT = t;
    const m = PENTA[Math.min(PENTA.length - 1, 3 + this.fireflyCombo)];
    this.fireflyCombo = Math.min(this.fireflyCombo + 1, 8);
    this.a.bell(this.d, { freq: mtof(m), gain: 0.07, dur: 1.8, pan, verb: 0.7 });
    this.a.bell(this.d, { freq: mtof(m + 12), gain: 0.02, dur: 1.2, pan, verb: 0.7, when: 0.05 });
  }

  beacon() {
    if (!this.ok) return;
    const a = this.a, d = this.d;
    a.burst(d, { kind: 'pink', type: 'lowpass', freq: 150, freq1: 3500, dur: 1.2, attack: 0.3, gain: 0.45, verb: 0.3, curve: 'lin' });
    a.tone(d, { freq: 70, freq1: 45, dur: 1.5, gain: 0.35, attack: 0.25 });
    for (let i = 0; i < 18; i++) a.burst(d, { kind: 'white', type: 'bandpass', freq: rnd(1800, 5000), Q: 3, dur: 0.02, gain: rnd(0.03, 0.09), when: 0.3 + Math.random() * 1.3 });
    [62, 69, 74, 77, 81, 86].forEach((m, i) => a.pluck(d, { freq: mtof(m), gain: 0.22, when: 0.35 + i * 0.12, verb: 0.7 }));
  }

  shadowRise(pan = 0) {
    if (!this.ok) return;
    const a = this.a, d = this.d;
    a.burst(d, { kind: 'pink', type: 'bandpass', freq: 250, freq1: 700, Q: 3, dur: 1.4, attack: 0.9, gain: 0.25, pan, verb: 0.5, curve: 'lin' });
    a.tone(d, { type: 'sawtooth', freq: 48, freq1: 55, dur: 1.6, attack: 0.8, gain: 0.05, pan, verb: 0.4 });
    this.whisper(pan, 0.6);
  }

  whisper(pan = 0, g = 1) {
    if (!this.ok) return;
    const a = this.a;
    // formant-filtered noise, like breath through teeth
    for (const [f, q] of [[rnd(600, 900), 8], [rnd(1800, 2600), 10], [rnd(3000, 3800), 12]])
      a.burst(this.d, { kind: 'white', type: 'bandpass', freq: f, freq1: f * rnd(0.8, 1.2), Q: q, dur: rnd(0.4, 0.9), attack: 0.2, gain: 0.12 * g, pan, verb: 0.6, curve: 'lin' });
  }

  shadowWindup(pan = 0) {
    if (!this.ok) return;
    const a = this.a, d = this.d, ctx = a.ctx, t = a.now;
    a.burst(d, { kind: 'white', type: 'highpass', freq: 800, freq1: 6000, dur: 0.55, attack: 0.4, gain: 0.12, pan, curve: 'lin' });
    // shriek: sawtooth through vowel formants with wide vibrato
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(rnd(420, 520), t);
    o.frequency.exponentialRampToValueAtTime(rnd(900, 1200), t + 0.6);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    const lg = ctx.createGain();
    lg.gain.value = 40;
    lfo.connect(lg).connect(o.frequency);
    const out = a.voice(d, { pan, verb: 0.5 });
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.05, t + 0.45);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    for (const f of [800, 1150, 2400]) {
      const bp = a.filter('bandpass', f, 9);
      o.connect(bp).connect(env);
    }
    env.connect(out);
    o.start(t); lfo.start(t); o.stop(t + 0.85); lfo.stop(t + 0.85);
  }

  shadowLunge(pan = 0) {
    if (!this.ok) return;
    this.a.burst(this.d, { kind: 'pink', type: 'bandpass', freq: 300, freq1: 1500, Q: 1, dur: 0.4, attack: 0.05, gain: 0.25, pan });
  }

  hurt() {
    if (!this.ok) return;
    const a = this.a, d = this.d;
    a.tone(d, { freq: 80, freq1: 30, dur: 0.6, gain: 0.55 });
    a.burst(d, { kind: 'brown', type: 'lowpass', freq: 900, freq1: 200, dur: 0.5, gain: 0.5, verb: 0.3 });
    a.tone(d, { type: 'sawtooth', freq: 1200, freq1: 300, dur: 0.4, gain: 0.04, verb: 0.5 });
    this.heartbeat(0.5, 0.35);
  }

  heartbeat(g = 0.4, when = 0) {
    if (!this.ok) return;
    const a = this.a;
    a.tone(this.d, { freq: 58, freq1: 42, dur: 0.14, gain: 0.5 * g, when });
    a.tone(this.d, { freq: 52, freq1: 38, dur: 0.18, gain: 0.35 * g, when: when + 0.22 });
  }

  shadowDie(pan = 0) {
    if (!this.ok) return;
    const a = this.a, d = this.d;
    a.burst(d, { kind: 'white', type: 'highpass', freq: 2500, dur: 0.9, attack: 0.01, gain: 0.16, pan, verb: 0.3 });
    a.burst(d, { kind: 'pink', type: 'bandpass', freq: 1500, freq1: 200, Q: 4, dur: 0.9, gain: 0.18, pan, verb: 0.6 });
    a.tone(d, { type: 'triangle', freq: 600, freq1: 90, dur: 0.8, gain: 0.05, pan, verb: 0.6 });
  }

  plankBreak(pan = 0) {
    if (!this.ok) return;
    const a = this.a, d = this.d;
    a.burst(d, { kind: 'white', type: 'bandpass', freq: 1600, Q: 1.5, dur: 0.07, gain: 0.4, pan });
    a.tone(d, { type: 'triangle', freq: 320, freq1: 90, dur: 0.18, gain: 0.25, pan });
    a.burst(d, { kind: 'pink', type: 'bandpass', freq: 900, freq1: 250, Q: 1, dur: 1.4, attack: 0.1, gain: 0.08, pan, verb: 0.5, when: 0.1 });
    this.creak(pan, 1.2);
  }

  thunder(power = 1, dist = 0.5) {
    if (!this.ok) return;
    const a = this.a, d = this.d;
    const near = 1 - dist;
    if (near > 0.35) a.burst(d, { kind: 'white', type: 'lowpass', freq: 6000, freq1: 800, dur: 0.35, gain: 0.35 * power * near, verb: 0.4 });
    const dur = 3 + dist * 3;
    a.burst(d, { kind: 'brown', type: 'lowpass', freq: 260 + near * 300, freq1: 60, dur, attack: 0.05 + dist * 0.3, gain: 0.9 * power, verb: 0.5, curve: 'lin' });
    for (let i = 0; i < 4; i++) a.burst(d, { kind: 'brown', type: 'lowpass', freq: 180, dur: rnd(0.6, 1.4), attack: 0.1, gain: 0.45 * power, when: 0.2 + Math.random() * dur * 0.6, pan: rnd(-0.6, 0.6), verb: 0.4 });
  }

  crystal(pan = 0) {
    if (!this.ok) return;
    this.a.bell(this.d, { freq: mtof(PENTA[5 + Math.floor(Math.random() * 6)]), gain: 0.04, dur: 2.2, pan, verb: 0.9 });
  }

  lanternOut() {
    if (!this.ok) return;
    this.a.burst(this.d, { kind: 'pink', type: 'bandpass', freq: 900, freq1: 200, Q: 1, dur: 0.8, attack: 0.02, gain: 0.25, verb: 0.4 });
  }

  death() {
    if (!this.ok) return;
    const a = this.a, d = this.d;
    a.tone(d, { freq: 55, freq1: 27, dur: 3.5, attack: 0.1, gain: 0.5, verb: 0.6 });
    a.burst(d, { kind: 'pink', type: 'lowpass', freq: 1200, freq1: 80, dur: 3, attack: 0.05, gain: 0.3, verb: 0.8 });
    [74, 70, 67, 62].forEach((m, i) => a.pluck(d, { freq: mtof(m), gain: 0.18, when: 0.4 + i * 0.5, verb: 0.9, bright: 0.3 }));
  }

  ui(kind = 'move') {
    if (!this.ok) return;
    if (kind === 'move') this.a.tone(this.d, { freq: 1300, dur: 0.05, gain: 0.03 });
    else this.a.bell(this.d, { freq: mtof(81), gain: 0.06, dur: 1.2, verb: 0.5 });
  }

  lighthouse() {
    if (!this.ok) return;
    const a = this.a, d = this.d;
    a.burst(d, { kind: 'pink', type: 'lowpass', freq: 100, freq1: 6000, dur: 2.8, attack: 1.2, gain: 0.55, verb: 0.6, curve: 'lin' });
    a.tone(d, { freq: 55, freq1: 36, dur: 4, attack: 0.8, gain: 0.5, verb: 0.3 });
    [50, 57, 62, 66, 69, 74, 78, 81].forEach((m, i) => a.bell(d, { freq: mtof(m + 12), gain: 0.06, dur: 5, verb: 1, when: 1.2 + i * 0.09 }));
  }
}
