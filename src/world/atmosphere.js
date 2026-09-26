import * as THREE from 'three';
import { ZONES } from './level.js';
import { clamp, damp } from '../util/math.js';

const C = (h) => new THREE.Color(h);

// Look presets. Colours are authored in sRGB and converted to linear by THREE.Color.
export const PRESETS = {
  forest: {
    zenith: C('#04070e'), horizon: C('#2a3547'), cloud: C('#1d2535'), fog: C('#1c2635'), fogDensity: 0.03,
    ridge: C('#090d14'), rim: C('#2c3a52'), moon: 0.9, moonCol: C('#8ea6d0'), hemi: 0.55, hemiSky: C('#34435e'),
    hemiGround: C('#0c0e11'), rain: 0.22, storm: 0.3, wind: 0.22, lightning: 0, vol: 0.9, exposure: 1.15, cave: 0,
    moonVis: 1, dawn: 0, mist: 0.6,
  },
  forestDeep: {
    zenith: C('#03060c'), horizon: C('#263143'), cloud: C('#1b2231'), fog: C('#19222f'), fogDensity: 0.036,
    ridge: C('#080b11'), rim: C('#28354b'), moon: 0.8, moonCol: C('#8aa2cc'), hemi: 0.45, hemiSky: C('#2f3d56'),
    hemiGround: C('#0b0c0f'), rain: 0.5, storm: 0.55, wind: 0.3, lightning: 0.15, vol: 1.0, exposure: 1.15, cave: 0,
    moonVis: 0.75, dawn: 0, mist: 0.8,
  },
  village: {
    zenith: C('#04060b'), horizon: C('#27303e'), cloud: C('#20262f'), fog: C('#1a212c'), fogDensity: 0.03,
    ridge: C('#0a0d13'), rim: C('#253247'), moon: 0.45, moonCol: C('#8aa0c8'), hemi: 0.5, hemiSky: C('#2e3a50'),
    hemiGround: C('#0a0c0f'), rain: 1, storm: 0.9, wind: 0.45, lightning: 0.8, vol: 1.15, exposure: 1.2, cave: 0,
    moonVis: 0.35, dawn: 0, mist: 1,
  },
  gorge: {
    zenith: C('#03060b'), horizon: C('#212b3a'), cloud: C('#1c2430'), fog: C('#161e2b'), fogDensity: 0.024,
    ridge: C('#080b11'), rim: C('#2a3850'), moon: 0.6, moonCol: C('#8ea5cf'), hemi: 0.42, hemiSky: C('#2e3c54'),
    hemiGround: C('#0b0d10'), rain: 0.6, storm: 0.65, wind: 0.95, lightning: 0.35, vol: 1.0, exposure: 1.05, cave: 0,
    moonVis: 0.7, dawn: 0, mist: 1,
  },
  cave: {
    zenith: C('#020304'), horizon: C('#07090c'), cloud: C('#07090c'), fog: C('#06080a'), fogDensity: 0.032,
    ridge: C('#050608'), rim: C('#0b0e12'), moon: 0.0, moonCol: C('#8ea6d0'), hemi: 0.16, hemiSky: C('#1b2432'),
    hemiGround: C('#0a0908'), rain: 0, storm: 0.2, wind: 0.08, lightning: 0, vol: 1.35, exposure: 1.3, cave: 1,
    moonVis: 0, dawn: 0, mist: 0.5,
  },
  cliff: {
    zenith: C('#04060b'), horizon: C('#252e3d'), cloud: C('#20262f'), fog: C('#171e29'), fogDensity: 0.015,
    ridge: C('#090c12'), rim: C('#28354c'), moon: 0.4, moonCol: C('#8ca2cc'), hemi: 0.5, hemiSky: C('#2f3b52'),
    hemiGround: C('#0a0c0f'), rain: 1, storm: 1, wind: 0.8, lightning: 1, vol: 1.1, exposure: 1.2, cave: 0,
    moonVis: 0.3, dawn: 0, mist: 0.9,
  },
  dawn: {
    zenith: C('#294571'), horizon: C('#d09474'), cloud: C('#a97f7e'), fog: C('#6a6574'), fogDensity: 0.009,
    ridge: C('#343850'), rim: C('#ffd0a0'), moon: 2.4, moonCol: C('#ffc98f'), hemi: 1.0, hemiSky: C('#95a8c8'),
    hemiGround: C('#4a3b35'), rain: 0, storm: 0.15, wind: 0.2, lightning: 0, vol: 0.3, exposure: 0.85, cave: 0,
    moonVis: 0.1, dawn: 1, mist: 0.4,
  },
};

const COLOR_KEYS = ['zenith', 'horizon', 'cloud', 'fog', 'ridge', 'rim', 'moonCol', 'hemiSky', 'hemiGround'];
const NUM_KEYS = ['fogDensity', 'moon', 'hemi', 'rain', 'storm', 'wind', 'lightning', 'vol', 'exposure', 'cave', 'moonVis', 'dawn', 'mist'];
const BLEND = 14; // metres of cross-fade at zone boundaries

export class Atmosphere {
  constructor() {
    const p = PRESETS.forest;
    for (const k of COLOR_KEYS) this[k] = p[k].clone();
    for (const k of NUM_KEYS) this[k] = p[k];
    this.flash = 0;       // lightning
    this.gust = 0;        // current gust strength (added to wind)
    this.windNow = 0;     // wind actually felt (base + gust)
    this.override = null; // e.g. 'dawn' for the ending
    this.overrideK = 0;
    this._target = {};
    for (const k of COLOR_KEYS) this._target[k] = new THREE.Color();
  }

  // Blend the presets of the zones around x into _target.
  computeTarget(x) {
    const t = this._target;
    let zi = ZONES.findIndex((z) => x >= z.x0 && x < z.x1);
    if (zi < 0) zi = ZONES.length - 1;
    const z = ZONES[zi];
    let a = PRESETS[z.preset], b = a, k = 0;
    if (x - z.x0 < BLEND && zi > 0) {
      b = PRESETS[ZONES[zi - 1].preset];
      k = 0.5 - (x - z.x0) / BLEND * 0.5;
    } else if (z.x1 - x < BLEND && zi < ZONES.length - 1) {
      b = PRESETS[ZONES[zi + 1].preset];
      k = 0.5 - (z.x1 - x) / BLEND * 0.5;
    }
    for (const key of COLOR_KEYS) t[key].copy(a[key]).lerp(b[key], k);
    for (const key of NUM_KEYS) t[key] = a[key] + (b[key] - a[key]) * k;
    if (this.override) {
      const o = PRESETS[this.override], ok = this.overrideK;
      for (const key of COLOR_KEYS) t[key].lerp(o[key], ok);
      for (const key of NUM_KEYS) t[key] = t[key] + (o[key] - t[key]) * ok;
    }
    return t;
  }

  update(dt, x, snap = false) {
    const t = this.computeTarget(x);
    const rate = snap ? 1e3 : 1.2;
    const f = 1 - Math.exp(-rate * dt);
    for (const k of COLOR_KEYS) this[k].lerp(t[k], f);
    for (const k of NUM_KEYS) this[k] = damp(this[k], t[k], rate, dt);
    this.windNow = clamp(this.wind + this.gust, 0, 2);
  }
}
