const rnd = (a, b) => a + Math.random() * (b - a);

// Continuous environmental beds (wind, rain, water, sea, cave air) plus
// scattered living details (crickets, owls, frogs, drips, fire crackle).
export class Ambience {
  constructor(core) {
    this.a = core;
    this.started = false;
    this.timers = { cricket: 1, owl: 12, frog: 3, drip: 1, crackle: 0, wave: 2, rumble: 5, creakB: 4 };
  }

  start() {
    if (this.started || !this.a.ready) return;
    this.started = true;
    const a = this.a, d = a.amb;
    this.windLow = a.loop(d, { kind: 'brown', type: 'lowpass', freq: 220, gain: 0 });
    this.windHi = a.loop(d, { kind: 'pink', type: 'bandpass', freq: 700, Q: 1.8, gain: 0, verb: 0.2 });
    this.whistle = a.loop(d, { kind: 'pink', type: 'bandpass', freq: 1300, Q: 12, gain: 0, verb: 0.3 });
    this.rainFar = a.loop(d, { kind: 'pink', type: 'lowpass', freq: 3500, gain: 0 });
    this.rainNear = a.loop(d, { kind: 'white', type: 'bandpass', freq: 5000, Q: 0.4, gain: 0 });
    this.water = a.loop(d, { kind: 'brown', type: 'lowpass', freq: 500, gain: 0 });
    this.sea = a.loop(d, { kind: 'brown', type: 'lowpass', freq: 700, gain: 0, verb: 0.2 });
    this.caveAir = a.loop(d, { kind: 'brown', type: 'bandpass', freq: 120, Q: 2, gain: 0, verb: 0.5 });
    this.fire = a.loop(d, { kind: 'brown', type: 'lowpass', freq: 350, gain: 0 });
    this.t = 0;
  }

  // env: {rain, wind, gust, forest, village, water, sea, cave, fireNear, calm}
  update(dt, env) {
    if (!this.started) return;
    this.t += dt;
    const a = this.a, t = this.t;
    const w = env.wind, g = env.gust;
    const sway = Math.sin(t * 0.21) * 0.5 + Math.sin(t * 0.07) * 0.5;
    this.windLow.set(0.12 + w * 0.3 + g * 0.35, 180 + w * 150 + g * 250, 0.6);
    this.windHi.set((0.015 + w * 0.05 + g * 0.2) * (1 - env.cave * 0.8), 500 + sway * 150 + g * 700 + w * 200, 0.5);
    this.whistle.set(g * 0.05 + w * 0.006, 1100 + g * 700 + sway * 200, 0.3);
    this.rainFar.set(env.rain * 0.22 * (1 - env.cave), 2800 + env.rain * 1500);
    this.rainNear.set(env.rain * 0.07 * (1 - env.cave) * (0.8 + Math.random() * 0.4), undefined, 0.05);
    this.water.set(env.water * 0.35, 380 + Math.sin(t * 0.6) * 100);
    const swell = 0.5 + 0.5 * Math.sin(t * 0.55) * Math.sin(t * 0.21 + 1);
    this.sea.set(env.sea * (0.25 + swell * 0.5), 350 + swell * 700, 0.8);
    this.caveAir.set(env.cave * 0.25, 90 + Math.sin(t * 0.13) * 30);
    this.fire.set(env.fireNear * 0.25, 300);

    const T = this.timers;
    const d = a.amb;
    // crickets in the forest when the rain is light
    T.cricket -= dt;
    if (T.cricket <= 0) {
      T.cricket = rnd(0.35, 1.2);
      const amt = env.forest * (1 - env.rain * 0.8) * (1 - env.cave);
      if (amt > 0.15) {
        const f = rnd(3800, 4700), pan = rnd(-0.9, 0.9), n = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) a.tone(d, { freq: f, dur: 0.018, attack: 0.003, gain: 0.012 * amt, pan, when: i * 0.042 });
      }
    }
    T.owl -= dt;
    if (T.owl <= 0) {
      T.owl = rnd(18, 34);
      if (env.forest > 0.5 && env.rain < 0.6) {
        const pan = rnd(-0.8, 0.8);
        for (const [when, f] of [[0, 390], [0.45, 370], [0.72, 372]])
          a.tone(d, { freq: f, freq1: f * 0.93, dur: when === 0 ? 0.45 : 0.25, attack: 0.05, gain: 0.03, pan, verb: 0.8, when });
      }
    }
    T.frog -= dt;
    if (T.frog <= 0) {
      T.frog = rnd(0.8, 3);
      if (env.village > 0.4) {
        const pan = rnd(-0.9, 0.9), f = rnd(110, 160);
        for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++)
          a.tone(d, { type: 'sawtooth', freq: f, freq1: f * 0.8, dur: 0.07, gain: 0.012, pan, when: i * 0.13, verb: 0.3 });
      }
    }
    T.drip -= dt;
    if (T.drip <= 0) {
      T.drip = rnd(0.4, 2.2);
      if (env.cave > 0.3) {
        const f = rnd(900, 1700);
        a.tone(d, { freq: f, freq1: f * 1.9, dur: 0.07, gain: 0.05 * env.cave, pan: rnd(-0.8, 0.8), verb: 1.0, glide: 0.04 });
      }
    }
    T.crackle -= dt;
    if (T.crackle <= 0) {
      T.crackle = rnd(0.03, 0.2);
      if (env.fireNear > 0.05) a.burst(d, { kind: 'white', type: 'bandpass', freq: rnd(1500, 5000), Q: 2.5, dur: rnd(0.005, 0.02), gain: rnd(0.03, 0.12) * env.fireNear });
    }
    T.wave -= dt;
    if (T.wave <= 0) {
      T.wave = rnd(4, 8);
      if (env.sea > 0.2)
        a.burst(d, { kind: 'pink', type: 'lowpass', freq: 400, freq1: 2200, dur: 2.2, attack: 1.2, gain: 0.3 * env.sea, pan: rnd(-0.5, 0.5), verb: 0.3, curve: 'lin' });
    }
    T.rumble -= dt;
    if (T.rumble <= 0) {
      T.rumble = rnd(12, 25);
      if (env.cave > 0.5) a.burst(d, { kind: 'brown', type: 'lowpass', freq: 90, dur: 3, attack: 1, gain: 0.3, verb: 0.8, curve: 'lin' });
    }
    T.creakB -= dt;
    if (T.creakB <= 0) {
      T.creakB = rnd(3, 9);
      if (env.village > 0.4 || env.bridge > 0.4) env.creak?.(rnd(-0.7, 0.7), 0.4);
    }
  }
}
