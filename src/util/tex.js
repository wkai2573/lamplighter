import * as THREE from 'three';
import { rng } from './math.js';

// Tileable value noise so every generated texture repeats seamlessly.
function makeNoise(seed) {
  const r = rng(seed);
  const N = 256;
  const tab = new Float32Array(N * N);
  for (let i = 0; i < tab.length; i++) tab[i] = r();
  const h = (x, y, p) => tab[(((y % p) + p) % p & 255) * N + ((((x % p) + p) % p) & 255)];
  const n = (x, y, p) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = h(ix, iy, p), b = h(ix + 1, iy, p), c = h(ix, iy + 1, p), d = h(ix + 1, iy + 1, p);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  // u,v in [0,1); base = lattice cells across the tile
  const fbm = (u, v, base, oct = 5, gain = 0.5) => {
    let s = 0, a = 0.5, f = base, t = 0;
    for (let o = 0; o < oct; o++) {
      s += n(u * f + o * 31, v * f + o * 17, f) * a;
      t += a;
      a *= gain;
      f *= 2;
    }
    return s / t;
  };
  // Worley-ish cellular distance (tileable) for pebbles / cracks
  const pts = [];
  const cell = (u, v, cells) => {
    const x = u * cells, y = v * cells;
    const ix = Math.floor(x), iy = Math.floor(y);
    let d1 = 9, d2 = 9;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i, cy = iy + j;
        const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
        const px = cx + h(wx * 7, wy * 13, 256), py = cy + h(wx * 11 + 3, wy * 5 + 9, 256);
        const d = Math.hypot(px - x, py - y);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
    return [d1, d2];
  };
  return { n, fbm, cell, pts };
}

function toTexture(data, size, srgb, repeat) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}

// fn(u, v, N) -> [height 0..1, r, g, b (0..1), roughness 0..1]
function generate(size, fn, seed, normalStrength = 2) {
  const N = makeNoise(seed);
  const H = new Float32Array(size * size);
  const alb = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const out = [0, 0, 0, 0, 0];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      fn(x / size, y / size, N, out);
      H[i] = out[0];
      alb[i * 4] = Math.max(0, Math.min(255, out[1] * 255));
      alb[i * 4 + 1] = Math.max(0, Math.min(255, out[2] * 255));
      alb[i * 4 + 2] = Math.max(0, Math.min(255, out[3] * 255));
      alb[i * 4 + 3] = 255;
      const rv = Math.max(0, Math.min(255, out[4] * 255));
      rough[i * 4] = rv; rough[i * 4 + 1] = rv; rough[i * 4 + 2] = rv; rough[i * 4 + 3] = 255;
    }
  const nrm = new Uint8Array(size * size * 4);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * normalStrength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * normalStrength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      nrm[i] = (-dx / l * 0.5 + 0.5) * 255;
      nrm[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      nrm[i + 3] = 255;
    }
  return {
    map: toTexture(alb, size, true),
    normalMap: toTexture(nrm, size, false),
    roughnessMap: toTexture(rough, size, false),
  };
}

const cache = new Map();
const mix = (a, b, t) => a + (b - a) * t;

const GEN = {
  // Neutral earth detail, tinted by vertex colour. Low-roughness puddles catch the lantern.
  ground: (u, v, N, o) => {
    const big = N.fbm(u, v, 4, 4);
    const fine = N.fbm(u, v, 32, 3);
    const [c1] = N.cell(u, v, 14);
    const peb = Math.max(0, 0.35 - c1) * 2.2;
    const h = big * 0.4 + fine * 0.35 + peb * 0.4;
    const puddle = Math.max(0, Math.min(1, (0.3 - N.fbm(u + 0.37, v + 0.11, 2, 4)) * 7));
    const g = 0.42 + fine * 0.35 + peb * 0.25 - puddle * 0.18;
    o[0] = h * (1 - puddle * 0.9) + puddle * 0.25;
    o[1] = g; o[2] = g * 0.96; o[3] = g * 0.9;
    o[4] = mix(0.92 - fine * 0.2, 0.08, puddle);
  },
  rock: (u, v, N, o) => {
    const [c1, c2] = N.cell(u, v, 6);
    const crack = Math.min(1, (c2 - c1) * 7);
    const f = N.fbm(u, v, 8, 5);
    const r = 1 - Math.abs(N.fbm(u, v, 5, 4) * 2 - 1);
    const h = f * 0.5 + r * 0.35 + crack * 0.25;
    const g = 0.36 + f * 0.3 + r * 0.12 - (1 - crack) * 0.12;
    o[0] = h; o[1] = g; o[2] = g * 0.98; o[3] = g * 0.95;
    o[4] = 0.78 + f * 0.18 - (1 - crack) * 0.2;
  },
  bark: (u, v, N, o) => {
    const s = N.fbm(u * 1, v * 0.12 + u * 0.02, 16, 4);
    const fiss = Math.pow(1 - Math.abs(N.n(u * 22 + N.fbm(u, v, 4, 3) * 5, v * 3, 22) * 2 - 1), 3);
    const h = s * 0.5 + (1 - fiss) * 0.5;
    const g = 0.28 + s * 0.35 - fiss * 0.2;
    o[0] = h; o[1] = g * 1.05; o[2] = g * 0.92; o[3] = g * 0.8;
    o[4] = 0.9;
  },
  wood: (u, v, N, o) => {
    const plank = Math.floor(v * 4);
    const pv = v * 4 - plank;
    const edge = Math.min(pv, 1 - pv) < 0.04 ? 1 : 0;
    const grain = Math.sin((u * 30 + N.fbm(u, v * 4 + plank * 0.3, 4, 4) * 9) * 3.1416) * 0.5 + 0.5;
    const wear = N.fbm(u, v, 12, 4);
    const g = (0.32 + grain * 0.12 + wear * 0.25) * (edge ? 0.35 : 1) * (0.85 + (plank % 2) * 0.12);
    o[0] = (edge ? 0 : 0.6) + grain * 0.15 + wear * 0.25;
    o[1] = g * 1.08; o[2] = g * 0.9; o[3] = g * 0.72;
    o[4] = 0.82 - wear * 0.25;
  },
  roof: (u, v, N, o) => {
    const rows = 10, row = Math.floor(v * rows);
    const off = (row % 2) * 0.5 / 8;
    const cu = ((u + off) * 8) % 1;
    const cv = v * rows - row;
    const gap = cu < 0.05 || cu > 0.95 ? 1 : 0;
    const lip = Math.pow(cv, 2);
    const f = N.fbm(u, v, 16, 4);
    const moss = Math.max(0, N.fbm(u + 0.5, v, 4, 4) - 0.55) * 3;
    const g = (0.22 + f * 0.2) * (gap ? 0.4 : 1) * (0.7 + lip * 0.4);
    o[0] = gap ? 0 : lip * 0.6 + f * 0.3;
    o[1] = mix(g, g * 0.9, moss); o[2] = mix(g * 1.02, g * 1.25, moss); o[3] = mix(g * 1.08, g * 0.8, moss);
    o[4] = 0.55 + f * 0.3;
  },
  brick: (u, v, N, o) => {
    const rows = 8, row = Math.floor(v * rows);
    const off = (row % 2) * 0.5 / 4;
    const cu = ((u + off) * 4) % 1, cv = v * rows - row;
    const mortar = cu < 0.035 || cu > 0.965 || cv < 0.06 || cv > 0.94;
    const f = N.fbm(u, v, 16, 4);
    const tone = N.n(Math.floor((u + off) * 4) * 3.7, row * 5.3, 256);
    const g = mortar ? 0.2 + f * 0.1 : 0.34 + tone * 0.14 + f * 0.2;
    o[0] = mortar ? 0.1 : 0.6 + f * 0.3;
    o[1] = g; o[2] = g * 0.97; o[3] = g * 0.92;
    o[4] = mortar ? 0.95 : 0.7 + f * 0.2;
  },
  cloth: (u, v, N, o) => {
    const w = (Math.sin(u * 256 * 3.1416) * Math.sin(v * 256 * 3.1416)) * 0.5 + 0.5;
    const f = N.fbm(u, v, 8, 4);
    const g = 0.55 + f * 0.35 + w * 0.08;
    o[0] = w * 0.3 + f * 0.5; o[1] = g; o[2] = g; o[3] = g;
    o[4] = 0.95;
  },
};

export function getTex(name, size = 256) {
  const key = name + size;
  if (!cache.has(key)) {
    const strength = { ground: 3, rock: 4, bark: 5, wood: 2.5, roof: 3, brick: 3, cloth: 1 }[name] ?? 2;
    cache.set(key, generate(size, GEN[name], name.length * 97 + 13, strength));
  }
  return cache.get(key);
}

// Soft radial sprite for glows/particles.
export function glowTexture(size = 64, hard = 0.0) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(Math.max(0.05, hard), 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
