// Web Audio core: buses, generated reverbs, noise sources and synthesis helpers.

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function noiseBuffer(ctx, secs, kind) {
  const n = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else if (kind === 'brown') {
        br = (br + 0.02 * w) / 1.02;
        d[i] = br * 3.5;
      } else d[i] = w;
    }
    // make the loop seamless
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[n - fade + i] = d[n - fade + i] * (1 - k) + d[i] * k;
    }
  }
  return buf;
}

// Algorithmic reverb impulse: decaying noise that darkens over time.
function impulse(ctx, secs, decay, dark = 0.6) {
  const n = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const a = 0.08 + t * dark; // one-pole coefficient: brighter early, darker late
      lp += ((Math.random() * 2 - 1) - lp) * (1 - a * 0.95);
      const early = i < ctx.sampleRate * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 2 : 0;
      d[i] = (lp + early) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

export class AudioCore {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.vol = { master: 0.85, music: 0.7, sfx: 0.9, amb: 0.9 };
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = this.vol.master;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.5;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 3.5;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.3;
    this.master.connect(this.muffle).connect(this.comp).connect(ctx.destination);

    this.music = ctx.createGain();
    this.music.gain.value = this.vol.music;
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.vol.sfx;
    this.amb = ctx.createGain();
    this.amb.gain.value = this.vol.amb;
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.amb.connect(this.master);

    // two reverbs (open air & cave) crossfaded by environment
    this.noise = { white: noiseBuffer(ctx, 3, 'white'), pink: noiseBuffer(ctx, 4, 'pink'), brown: noiseBuffer(ctx, 5, 'brown') };
    this.verbIn = ctx.createGain();
    const mk = (secs, decay, dark) => {
      const c = ctx.createConvolver();
      c.buffer = impulse(ctx, secs, decay, dark);
      const g = ctx.createGain();
      this.verbIn.connect(c).connect(g).connect(this.master);
      return g;
    };
    this.verbOpen = mk(3.2, 2.6, 0.7);
    this.verbCave = mk(6.5, 1.8, 0.45);
    this.verbCave.gain.value = 0;
    this.verbOpen.gain.value = 0.9;
    this.pluckCache = new Map();
    this.ready = true;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    if (!this.ready) return;
    const t = this.now;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.music.gain.setTargetAtTime(this.vol.music, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(this.vol.amb, t, 0.05);
  }

  setCave(k) {
    if (!this.ready) return;
    const t = this.now;
    this.verbOpen.gain.setTargetAtTime(0.9 * (1 - k) + 0.1, t, 0.8);
    this.verbCave.gain.setTargetAtTime(1.3 * k, t, 0.8);
  }

  setMuffle(freq, time = 0.3) {
    if (!this.ready) return;
    this.muffle.frequency.setTargetAtTime(freq, this.now, time);
  }

  // ---------------------------------------------------------------- building blocks
  // A routed voice: returns {in, out}. out -> dest (+ optional reverb send and pan)
  voice(dest, { pan = 0, verb = 0, gain = 1 } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    let out = g;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      out = p;
    }
    out.connect(dest);
    if (verb > 0) {
      const s = ctx.createGain();
      s.gain.value = verb;
      out.connect(s).connect(this.verbIn);
    }
    return g;
  }

  noiseSrc(kind = 'white', loop = false, offset = Math.random()) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise[kind];
    s.loop = loop;
    s._off = offset * (s.buffer.duration - 0.5);
    return s;
  }

  filter(type, freq, Q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    return f;
  }

  // short enveloped noise burst through a filter
  burst(dest, { kind = 'white', type = 'bandpass', freq = 1000, freq1 = null, Q = 1, attack = 0.002, dur = 0.1, gain = 0.3, pan = 0, verb = 0, when = 0, curve = 'exp' } = {}) {
    if (!this.ready) return;
    const t = this.now + when;
    const src = this.noiseSrc(kind);
    const f = this.filter(type, freq, Q);
    if (freq1 !== null) f.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), t + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    if (curve === 'exp') env.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    else env.gain.linearRampToValueAtTime(0, t + attack + dur);
    src.connect(f).connect(env).connect(this.voice(dest, { pan, verb }));
    src.start(t, src._off);
    src.stop(t + attack + dur + 0.05);
  }

  // enveloped oscillator with optional pitch glide
  tone(dest, { type = 'sine', freq = 440, freq1 = null, attack = 0.005, dur = 0.3, gain = 0.2, pan = 0, verb = 0, when = 0, detune = 0, glide = null } = {}) {
    if (!this.ready) return;
    const t = this.now + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    if (freq1 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(10, freq1), t + (glide ?? dur));
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    o.connect(env).connect(this.voice(dest, { pan, verb }));
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  // Karplus–Strong plucked string (koto-like), cached per pitch.
  pluckBuffer(freq, dur = 3.2, bright = 0.55) {
    const key = Math.round(freq * 4) + '|' + bright;
    if (this.pluckCache.has(key)) return this.pluckCache.get(key);
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const period = sr / freq;
    const P = Math.floor(period), frac = period - P;
    let prev = 0;
    for (let i = 0; i < P + 2; i++) {
      prev += ((Math.random() * 2 - 1) - prev) * (0.25 + bright * 0.7);
      d[i] = prev;
    }
    // pluck position comb for a woody tone
    const pos = Math.max(1, Math.floor(P * 0.18));
    for (let i = P + 1; i >= pos; i--) d[i] -= d[i - pos] * 0.6;
    const loss = Math.pow(0.001, 1 / (freq * dur * 0.85));
    for (let i = P + 2; i < n; i++) {
      const a = (1 - frac) * d[i - P] + frac * d[i - P - 1];
      const b = (1 - frac) * d[i - P - 1] + frac * d[i - P - 2];
      d[i] = loss * 0.5 * (a + b);
    }
    let mx = 0;
    for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(d[i]));
    const g = 0.9 / (mx || 1);
    const fo = Math.floor(sr * 0.08);
    for (let i = 0; i < n; i++) d[i] *= g * (i > n - fo ? (n - i) / fo : 1);
    if (this.pluckCache.size > 160) this.pluckCache.delete(this.pluckCache.keys().next().value);
    this.pluckCache.set(key, buf);
    return buf;
  }

  pluck(dest, { freq, gain = 0.3, pan = 0, verb = 0.5, when = 0, bright = 0.55, dur = 3.2, rate = 1 } = {}) {
    if (!this.ready) return;
    const t = this.now + when;
    const s = this.ctx.createBufferSource();
    s.buffer = this.pluckBuffer(freq, dur, bright);
    s.playbackRate.value = rate;
    const lp = this.filter('lowpass', Math.min(12000, freq * 7), 0.5);
    s.connect(lp).connect(this.voice(dest, { pan, verb, gain }));
    s.start(t);
  }

  // Soft bell / chime: inharmonic partials with long decay.
  bell(dest, { freq, gain = 0.15, pan = 0, verb = 0.6, when = 0, dur = 2.5, partials = [[1, 1], [2.01, 0.35], [3.02, 0.12], [4.17, 0.06]] } = {}) {
    if (!this.ready) return;
    for (const [r, a] of partials) this.tone(dest, { type: 'sine', freq: freq * r, attack: 0.004, dur: dur / Math.sqrt(r), gain: gain * a, pan, verb, when });
  }

  // Continuous looped layer with controllable gain / filter: returns handle
  loop(dest, { kind = 'pink', type = 'lowpass', freq = 800, Q = 0.7, gain = 0, pan = 0, verb = 0 } = {}) {
    const ctx = this.ctx;
    const src = this.noiseSrc(kind, true);
    const f = this.filter(type, freq, Q);
    const g = ctx.createGain();
    g.gain.value = gain;
    const out = this.voice(dest, { pan, verb });
    src.connect(f).connect(g).connect(out);
    src.start(this.now, src._off);
    return {
      src, f, g, out,
      set: (gv, fv, tc = 0.4) => {
        const t = this.now;
        if (gv !== undefined) g.gain.setTargetAtTime(gv, t, tc);
        if (fv !== undefined) f.frequency.setTargetAtTime(fv, t, tc);
      },
    };
  }
}
