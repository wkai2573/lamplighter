import { mtof } from './core.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Voicings (MIDI). D aeolian night; D major for the dawn.
const PROG = {
  night: [[50, 57, 62, 64, 65], [46, 53, 57, 62, 65], [45, 53, 57, 60, 67], [43, 50, 57, 58, 65]],
  drowned: [[50, 57, 60, 65, 69], [48, 55, 62, 63, 67], [46, 53, 58, 62, 65], [45, 52, 57, 60, 64]],
  high: [[50, 57, 62, 64, 69], [48, 55, 62, 64, 67], [50, 57, 62, 64, 69], [46, 53, 60, 62, 65]],
  dawn: [[50, 57, 62, 64, 66, 69], [43, 55, 59, 62, 66, 71], [45, 57, 61, 64, 69, 73], [47, 54, 59, 62, 66, 71], [43, 55, 62, 64, 67, 71], [45, 57, 61, 64, 67, 69]],
};
const SCALE = {
  minor: [62, 65, 67, 69, 72, 74, 77, 79, 81, 84],
  major: [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86],
};

const MOODS = {
  silent: { pad: 0, koto: 0, bells: 0, drone: 0, drums: 0, prog: 'night', scale: 'minor', chord: 10 },
  title: { pad: 0.8, koto: 0.55, bells: 0, drone: 0.3, drums: 0, prog: 'night', scale: 'minor', chord: 10 },
  forest: { pad: 0.6, koto: 0.45, bells: 0, drone: 0.25, drums: 0, prog: 'night', scale: 'minor', chord: 11 },
  village: { pad: 0.75, koto: 0.3, bells: 0, drone: 0.35, drums: 0, prog: 'drowned', scale: 'minor', chord: 12 },
  bridge: { pad: 0.45, koto: 0.25, bells: 0.1, drone: 0.55, drums: 0, prog: 'high', scale: 'minor', chord: 9 },
  cave: { pad: 0.12, koto: 0.08, bells: 0.8, drone: 0.6, drums: 0, prog: 'night', scale: 'minor', chord: 14 },
  cliff: { pad: 0.55, koto: 0.25, bells: 0, drone: 0.5, drums: 0, prog: 'high', scale: 'minor', chord: 9 },
  chase: { pad: 0.45, koto: 0, bells: 0, drone: 0.5, drums: 1, prog: 'high', scale: 'minor', chord: 5.2 },
  ending: { pad: 1, koto: 0.7, bells: 0.2, drone: 0.2, drums: 0, prog: 'dawn', scale: 'major', chord: 7 },
};

export class Music {
  constructor(core) {
    this.a = core;
    this.mood = MOODS.silent;
    this.moodName = 'silent';
    this.started = false;
    this.chordI = 0;
    this.nextChord = 0;
    this.nextPhrase = 0;
    this.nextBell = 0;
    this.nextBeat = 0;
    this.beat = 0;
    this.voices = [];
    this.tension = 0;
  }

  start() {
    if (this.started || !this.a.ready) return;
    this.started = true;
    const a = this.a, ctx = a.ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(a.music);
    // drone: root and fifth, slowly breathing
    this.droneG = ctx.createGain();
    this.droneG.gain.value = 0;
    const dlp = a.filter('lowpass', 260, 0.7);
    this.droneG.connect(dlp).connect(a.voice(this.bus, { verb: 0.4 }));
    for (const [m, g] of [[38, 0.5], [45, 0.3], [50, 0.15]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = mtof(m);
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.droneG);
      o.start();
    }
    // tension: a trembling dissonant cluster that rises with danger
    this.tensG = ctx.createGain();
    this.tensG.gain.value = 0;
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6.5;
    const lg = ctx.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg).connect(trem.gain);
    lfo.start();
    const bp = a.filter('bandpass', 1400, 1.2);
    trem.connect(bp).connect(this.tensG).connect(a.voice(this.bus, { verb: 0.6 }));
    for (const m of [74, 75, 81, 62]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(m);
      o.detune.value = rnd(-8, 8);
      const og = ctx.createGain();
      og.gain.value = m === 62 ? 0.6 : 0.3;
      o.connect(og).connect(trem);
      o.start();
    }
    this.nextChord = a.now + 0.5;
    this.nextPhrase = a.now + 3;
    this.nextBell = a.now + 2;
  }

  setMood(name) {
    if (!MOODS[name] || name === this.moodName) return;
    const prev = this.moodName;
    this.moodName = name;
    this.mood = MOODS[name];
    if (!this.started) return;
    const now = this.a.now;
    // change harmony promptly on big shifts
    if (name === 'chase' || name === 'ending' || prev === 'chase' || name === 'silent') {
      this.release(name === 'silent' ? 2.5 : 1.5);
      this.nextChord = now + (name === 'ending' ? 0.8 : 0.3);
      this.chordI = 0;
    }
    if (name === 'chase') this.nextBeat = now + 0.3;
    this.nextPhrase = Math.max(this.nextPhrase, now + 1.5);
  }

  release(time = 4) {
    const t = this.a.now;
    for (const v of this.voices) {
      v.env.gain.cancelScheduledValues(t);
      v.env.gain.setValueAtTime(v.env.gain.value, t);
      v.env.gain.linearRampToValueAtTime(0.0001, t + time);
      v.oscs.forEach((o) => o.stop(t + time + 0.1));
    }
    this.voices = [];
  }

  playChord(when) {
    const a = this.a, ctx = a.ctx, m = this.mood;
    const prog = PROG[m.prog];
    const notes = prog[this.chordI % prog.length];
    this.chordI++;
    this.release(m.chord * 0.55);
    if (m.pad <= 0.01) return;
    const t = a.now + when;
    const dur = m.chord;
    for (const [i, n] of notes.entries()) {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      const g = (0.045 / Math.sqrt(notes.length)) * m.pad * (i === 0 ? 1.3 : 1);
      env.gain.linearRampToValueAtTime(g, t + dur * 0.35);
      env.gain.setTargetAtTime(g * 0.7, t + dur * 0.5, dur * 0.3);
      const lp = a.filter('lowpass', 500 + rnd(0, 300) + (m.prog === 'dawn' ? 900 : 0), 0.6);
      lp.frequency.setTargetAtTime(900 + (m.prog === 'dawn' ? 1400 : 0), t, dur * 0.4);
      const oscs = [];
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det + rnd(-2, 2);
        o.connect(lp);
        o.start(t);
        oscs.push(o);
      }
      const s = ctx.createOscillator();
      s.type = 'sine';
      s.frequency.value = mtof(n + 12);
      const sg = ctx.createGain();
      sg.gain.value = 0.35;
      s.connect(sg).connect(lp);
      s.start(t);
      oscs.push(s);
      lp.connect(env).connect(a.voice(this.bus, { verb: 0.75, pan: (i / notes.length - 0.5) * 0.8 }));
      this.voices.push({ env, oscs });
    }
    this.currentChord = notes;
  }

  phrase(when) {
    const a = this.a, m = this.mood;
    const scale = SCALE[m.scale];
    let idx = Math.floor(rnd(2, scale.length - 3));
    const n = 3 + Math.floor(Math.random() * 5);
    let t = when;
    const pan = rnd(-0.4, 0.4);
    for (let i = 0; i < n; i++) {
      idx = Math.max(0, Math.min(scale.length - 1, idx + pick([-2, -1, -1, 1, 1, 2, 0])));
      const note = scale[idx];
      const g = (0.12 + Math.random() * 0.08) * m.koto * (i === n - 1 ? 0.8 : 1);
      if (Math.random() < 0.18 && idx > 0) a.pluck(this.bus, { freq: mtof(scale[idx - 1]), gain: g * 0.5, pan, verb: 0.6, when: t - 0.09 });
      a.pluck(this.bus, { freq: mtof(note), gain: g, pan, verb: 0.65, when: t, bright: 0.45 + Math.random() * 0.2 });
      // occasional octave doubling for shimmer
      if (Math.random() < 0.15) a.pluck(this.bus, { freq: mtof(note - 12), gain: g * 0.5, pan: -pan, verb: 0.65, when: t });
      t += pick([0.36, 0.42, 0.55, 0.7, 0.9, 0.28]);
    }
    return t - when;
  }

  drums(when) {
    const a = this.a;
    const pat = [1, 0, 0, 0.6, 0, 0, 1, 0, 0.8, 0, 0.5, 0, 0, 0.7, 0.4, 0];
    const step = 60 / 92 / 2;
    const hit = pat[this.beat % 16];
    const bar = Math.floor(this.beat / 16);
    if (hit > 0) {
      a.tone(this.bus, { freq: 120, freq1: 44, dur: 0.45, attack: 0.002, gain: 0.35 * hit, when, verb: 0.35, glide: 0.12 });
      a.burst(this.bus, { kind: 'brown', type: 'lowpass', freq: 900, dur: 0.08, gain: 0.25 * hit, when });
    }
    if (this.beat % 4 === 2) a.burst(this.bus, { kind: 'white', type: 'bandpass', freq: 3000, Q: 2, dur: 0.03, gain: 0.04, when, pan: 0.3 });
    // ostinato
    const ost = [62, 62, 65, 62, 69, 67, 65, 64];
    if (this.beat % 2 === 0) {
      const nn = ost[(this.beat / 2) % 8] + (bar % 4 === 3 ? 5 : 0);
      a.pluck(this.bus, { freq: mtof(nn), gain: 0.16, when, verb: 0.3, bright: 0.7, dur: 1.2 });
    }
    this.beat++;
    return step;
  }

  update(dt, tension = 0) {
    if (!this.started) return;
    const a = this.a, now = a.now, m = this.mood;
    this.tension += (tension - this.tension) * Math.min(1, dt * 1.5);
    this.droneG.gain.setTargetAtTime(0.065 * m.drone, now, 1.5);
    this.tensG.gain.setTargetAtTime(0.012 * this.tension * (this.moodName === 'silent' ? 0 : 1), now, 0.4);
    const ahead = 0.15;
    if (now + ahead >= this.nextChord) {
      this.playChord(Math.max(0, this.nextChord - now));
      this.nextChord += m.chord;
      if (this.nextChord < now) this.nextChord = now + m.chord;
    }
    if (m.koto > 0.01 && now + ahead >= this.nextPhrase) {
      const len = this.phrase(Math.max(0, this.nextPhrase - now));
      this.nextPhrase = now + len + rnd(3, 9) / (0.5 + m.koto);
    } else if (m.koto <= 0.01 && now > this.nextPhrase) this.nextPhrase = now + 2;
    if (m.bells > 0.01 && now + ahead >= this.nextBell) {
      const sc = SCALE[m.scale];
      const note = sc[Math.floor(rnd(4, sc.length))] + 12;
      a.bell(this.bus, { freq: mtof(note), gain: 0.05 * m.bells, dur: 4.5, verb: 1, pan: rnd(-0.6, 0.6), when: Math.max(0, this.nextBell - now) });
      if (Math.random() < 0.4) a.bell(this.bus, { freq: mtof(note - 5), gain: 0.03 * m.bells, dur: 4, verb: 1, when: Math.max(0, this.nextBell - now) + 0.6 });
      this.nextBell = now + rnd(2.5, 6);
    }
    if (m.drums > 0.01) {
      while (this.nextBeat < now + ahead) {
        const st = this.drums(Math.max(0, this.nextBeat - now));
        this.nextBeat += st;
      }
    }
  }

  // A short koto phrase that marks a moment (chapter card, beacon).
  sting(kind) {
    if (!this.started) return;
    const a = this.a;
    if (kind === 'chapter') {
      [62, 69, 74, 72, 69].forEach((m, i) => a.pluck(this.bus, { freq: mtof(m), gain: 0.16, when: 0.2 + i * 0.45, verb: 0.8 }));
    } else if (kind === 'dawn') {
      [50, 57, 62, 66, 69, 74, 78, 81, 86].forEach((m, i) => a.pluck(this.bus, { freq: mtof(m), gain: 0.2, when: i * 0.16, verb: 0.9, dur: 4 }));
    }
  }
}
