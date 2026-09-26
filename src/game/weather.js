import { clamp, rng, smoothstep } from '../util/math.js';

// Lightning, thunder timing and wind gusts. Writes into the atmosphere each frame.
export class Weather {
  constructor() {
    this.r = rng(77);
    this.nextStrike = 6;
    this.pulses = [];     // {t, amp}
    this.events = [];
    this.gust = { state: 'idle', t: 0, next: 5, k: 0 };
    this.time = 0;
    this.forceStrike = 0;
  }

  gustZone(x) {
    return (x > 402 && x < 498) || (x > 728 && x < 884);
  }

  strike(power = 1) {
    const r = this.r;
    const n = 2 + Math.floor(r() * 3);
    let t = 0;
    for (let i = 0; i < n; i++) {
      this.pulses.push({ t: this.time + t, amp: (i === 0 ? 1 : 0.4 + r() * 0.6) * power });
      t += 0.06 + r() * 0.14;
    }
    const dist = 0.3 + r() * 0.7;
    this.events.push({ type: 'lightning', power });
    this.events.push({ type: 'thunder', delay: 0.4 + dist * 2.4, power: power * (1.2 - dist * 0.6), dist });
    this.flashDir = [(r() - 0.5) * 1.6, 0.25 + r() * 0.3, -1];
  }

  update(dt, x, atm, calm = false) {
    this.time += dt;
    const r = this.r;
    // lightning
    if (atm.lightning > 0.05 && !calm) {
      this.nextStrike -= dt * atm.lightning;
      if (this.nextStrike <= 0) {
        this.strike(0.7 + r() * 0.5);
        this.nextStrike = 9 + r() * 14;
      }
    }
    let flash = 0;
    this.pulses = this.pulses.filter((p) => this.time - p.t < 1.5);
    for (const p of this.pulses) {
      const d = this.time - p.t;
      if (d >= 0) flash = Math.max(flash, p.amp * Math.exp(-d * 11));
    }
    atm.flash = flash;

    // gusts push against the traveller on exposed ground
    const g = this.gust;
    const zone = this.gustZone(x) && !calm;
    g.t += dt;
    switch (g.state) {
      case 'idle':
        g.k = Math.max(0, g.k - dt);
        if (zone && g.t > g.next) {
          g.state = 'rise';
          g.t = 0;
          this.events.push({ type: 'gustWarn' });
        }
        break;
      case 'rise':
        g.k = smoothstep(0, 1.1, g.t);
        if (g.t > 1.1) { g.state = 'hold'; g.t = 0; this.events.push({ type: 'gust' }); }
        break;
      case 'hold':
        g.k = 1 + Math.sin(this.time * 7) * 0.08;
        if (g.t > 1.6 + r() * 0.6) { g.state = 'fall'; g.t = 0; }
        break;
      case 'fall':
        g.k = 1 - smoothstep(0, 1.1, g.t);
        if (g.t > 1.1) { g.state = 'idle'; g.t = 0; g.next = 3.5 + r() * 4; }
        break;
    }
    if (!zone && g.state !== 'idle' && g.state !== 'fall') { g.state = 'fall'; g.t = 0; }
    atm.gust = g.k * 0.9;
    // signed wind: a steady drift to the right, gusts blow back from the sea (to the left)
    atm.windSigned = atm.wind * 0.55 - g.k * 1.4;
    atm.windNow = clamp(Math.abs(atm.windSigned), 0, 2);
    return { windForce: -g.k * 6.5 };
  }
}
