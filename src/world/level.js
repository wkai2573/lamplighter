// The whole journey, laid out along the x axis (metres). y is up, z is depth (0 = play lane).
import { polyline } from '../util/math.js';

// Walkable ground runs. Gaps between runs are pits (or deep water where a water region covers them).
// `rough` adds small natural bumps between key points; `surface` drives footsteps & materials.
export const GROUND = [
  {
    surface: 'grass', rough: 0.12, pts: [
      [-60, 0.4], [-20, 0.1], [-5, 0], [8, 0], [18, 0.2], [26, 0.1], [34, 0.9], [44, 2.0], [50, 2.1], [62, 2.1],
      [70, 0.8], [74, -0.5], [86, -0.5], [92, 0.3], [101.5, 0.8],
    ],
  },
  {
    surface: 'grass', rough: 0.12, pts: [
      [104.1, 0.8], [112, 0.9], [117, 1.0], [121, 1.1], [121.06, 2.3], [135, 2.4], [150, 2.8], [160, 2.6],
      [176, 2.6], [186, 1.3], [196, 0.35], [206, 0.5],
    ],
  },
  { surface: 'mud', rough: 0.05, pts: [[238.6, -1.6], [240.6, 0.42], [250, 0.45], [251.6, -1.6]] },
  { surface: 'stone', rough: 0.03, pts: [[283.4, -1.6], [285, 0.52], [300, 0.55], [301.6, -1.6]] },
  {
    surface: 'mud', rough: 0.1, pts: [
      [342.5, -1.6], [344.6, 0.62], [356, 1.0], [366, 1.2], [378, 1.6], [392, 1.6], [400, 1.5],
    ],
  },
  {
    surface: 'stone', rough: 0.1, pts: [
      [500, 2.0], [508, 2.2], [520, 2.4], [530, 2.3], [538, 1.2], [548, -0.5], [560, -1.0], [564, -1.0],
    ],
  },
  {
    surface: 'cave', rough: 0.12, pts: [
      [598, -0.6], [604, -0.8], [607, -1.0], [610, -1.6], [624, -1.6], [628, -1.0], [632, -0.6], [640, -0.2],
      [650, 0.3], [660, 0.2], [672, 0.8], [684, 1.8], [694, 3.2], [704, 4.8], [714, 6.2], [722, 7.6], [730, 8.0],
      [745, 8.2], [752, 8.3], [760, 8.2], [770, 8.0], [778, 8.7], [792, 9.4],
    ],
  },
  { surface: 'stone', rough: 0.08, pts: [[794.6, 9.4], [806, 9.5], [815, 9.6], [815.06, 10.8], [824, 10.9], [824.06, 12.0], [840, 12.1]] },
  { surface: 'grass', rough: 0.06, pts: [[842.6, 12.2], [856, 12.8], [870, 13.8], [880, 14.0], [906, 14.0], [912, 13.2]] },
];

// Cave ceiling (x range with a roof).
export const CEILING = {
  x0: 526, x1: 724,
  pts: [
    [526, 13], [530, 7.8], [536, 6.2], [545, 5.3], [556, 5.4], [562, 7.5], [566, 9.5], [596, 9.5], [602, 6.2],
    [612, 5.4], [622, 6.6], [632, 5.6], [644, 5.4], [656, 5.6], [668, 5.9], [680, 7.0], [692, 8.6], [704, 10.4],
    [714, 12.2], [720, 14.5], [724, 18],
  ],
};

// One-way platforms (boardwalks, rooftops). kind: 'wood' | 'roof'
export const PLATFORMS = [
  { x0: 206, x1: 221, y: 0.5, kind: 'wood' },
  { x0: 223.6, x1: 240.6, y: 0.5, kind: 'wood' },
  { x0: 251.2, x1: 257.2, y: 1.45, kind: 'wood' },
  { x0: 256.6, x1: 264.2, y: 3.25, kind: 'roof' },
  { x0: 265.5, x1: 272, y: 0.5, kind: 'wood' },
  { x0: 274.6, x1: 285.2, y: 0.5, kind: 'wood' },
  { x0: 301.2, x1: 309, y: 0.5, kind: 'wood' },
  { x0: 311.6, x1: 318, y: 1.3, kind: 'wood' },
  { x0: 320.6, x1: 327.2, y: 2.1, kind: 'wood' },
  { x0: 329.2, x1: 337.4, y: 3.05, kind: 'roof' },
  { x0: 338.8, x1: 344.8, y: 0.62, kind: 'wood' },
];

// Solid obstacles: [x0, x1, y0, y1]
export const SOLIDS = [
  { x0: 21.2, x1: 23.0, y0: -0.5, y1: 0.85, kind: 'log' },
  { x0: 95.5, x1: 97.2, y0: 0, y1: 1.05, kind: 'rock' },
  { x0: 447.6, x1: 452.4, y0: -60, y1: 0.35, kind: 'pillar' },
  { x0: 651.2, x1: 652.8, y0: -1, y1: 1.4, kind: 'stalagmite' },
  { x0: 667.4, x1: 668.8, y0: -1, y1: 1.6, kind: 'stalagmite' },
  { x0: 780.2, x1: 781.8, y0: 8, y1: 9.95, kind: 'rock' },
  { x0: 805.2, x1: 807.2, y0: 9, y1: 10.75, kind: 'rock' },
  { x0: 911.5, x1: 914, y0: 0, y1: 40, kind: 'wall' },
  { x0: -62, x1: -59, y0: -5, y1: 40, kind: 'wall' },
];

// Water surfaces. Where no ground run exists under them they are deep (drowning).
export const WATER = [
  { x0: 72.5, x1: 87.5, y: -0.12, kind: 'creek' },
  { x0: 204, x1: 347, y: -0.18, kind: 'flood' },
  { x0: 607.5, x1: 628.5, y: -1.18, kind: 'pool' },
];

// Rope bridge over the gorge, two catenary spans tied to a stone pillar.
export const BRIDGE = {
  spans: [
    { x0: 400.3, y0: 1.5, x1: 447.6, y1: 0.35, sag: 2.1, missing: [14, 15, 36, 37], rotten: [24, 25, 26, 27] },
    { x0: 452.4, y0: 0.35, x1: 499.8, y1: 2.0, sag: 2.1, missing: [18, 19, 40, 41], rotten: [6, 7, 8, 9, 29, 30, 31, 32] },
  ],
  plank: 0.95,
};

// Light-crystal platforms: solid only while bathed in lantern light.
export const CRYSTALS = [
  { x: 567.4, y: -0.6, w: 2.2 },
  { x: 571.9, y: 0.25, w: 2.0 },
  { x: 576.4, y: 1.15, w: 2.0 },
  { x: 580.9, y: 1.85, w: 2.0 },
  { x: 585.4, y: 1.2, w: 2.0 },
  { x: 589.9, y: 0.4, w: 2.0 },
  { x: 594.4, y: -0.25, w: 2.2 },
];

// Stone lanterns: checkpoints that refill the lantern and push back the dark.
export const BEACONS = [
  { x: 56, name: '林緣石燈' },
  { x: 170, name: '山脊石燈' },
  { x: 293, name: '水神祠' },
  { x: 388, name: '橋頭石燈' },
  { x: 512, name: '崖上石燈' },
  { x: 635, name: '螢窟石燈' },
  { x: 754, name: '海崖石燈' },
];

export const LIGHTHOUSE = { x: 897, brazierX: 891.5 };

// Collectable fireflies: [x0, x1, count, yMin, yMax] (y relative to ground)
export const FIREFLIES = [
  [6, 20, 6, 0.8, 2.6], [30, 48, 5, 1.0, 2.8], [72, 88, 12, 0.5, 2.4], [106, 132, 10, 0.8, 3.0], [138, 162, 7, 1.0, 3.0],
  [186, 200, 5, 1, 2.6], [241, 250, 5, 0.8, 2.4], [286, 300, 7, 0.8, 2.6], [346, 382, 9, 0.8, 2.8],
  [420, 440, 3, 0.8, 1.8], [502, 522, 6, 1, 2.6],
  [538, 562, 9, 0.8, 2.6], [608, 640, 22, 0.8, 3.2], [648, 690, 10, 0.8, 2.6], [700, 720, 5, 0.8, 2.4],
  [726, 752, 8, 0.8, 2.6], [846, 880, 5, 0.8, 2.4],
];

// Shadow spawns: [x, count, yOffset]
export const SHADOWS = [
  [247, 1, 1.4], [271, 1, 1.6], [318, 2, 2.0], [335, 1, 3.5], [362, 1, 2.0],
  [428, 2, -2.0], [474, 2, -2.0],
  [549, 1, 1.5], [648, 2, 2.0], [664, 2, 2.0], [684, 2, 2.4],
  [740, 1, 2.0],
];

export const CHASE = { trigger: 772, start: 750, end: 886 };

// Atmosphere zones. Presets are defined in atmosphere.js
export const ZONES = [
  { x0: -80, x1: 90, preset: 'forest' },
  { x0: 90, x1: 188, preset: 'forestDeep' },
  { x0: 188, x1: 396, preset: 'village' },
  { x0: 396, x1: 527, preset: 'gorge' },
  { x0: 527, x1: 720, preset: 'cave' },
  { x0: 720, x1: 960, preset: 'cliff' },
];

// Camera framing per region: [x, distance, height, lookAhead]
export const CAMERA_KEYS = [
  [-80, 16.5, 2.3, 2.6], [60, 16.5, 2.3, 2.6], [200, 17.5, 2.5, 2.8], [400, 20.5, 2.9, 3.2], [500, 19.0, 2.6, 3.0],
  [535, 14.5, 1.8, 2.3], [700, 14.5, 1.9, 2.3], [730, 17.5, 2.4, 3.6], [880, 19, 3.2, 3.0], [960, 19, 3.2, 3.0],
];

export const CHAPTERS = [
  { x: -1, num: '第一章', name: '林　緣', sub: 'THE FOREST EDGE' },
  { x: 198, num: '第二章', name: '沉　村', sub: 'THE DROWNED VILLAGE' },
  { x: 394, num: '第三章', name: '斷　橋', sub: 'THE BROKEN BRIDGE' },
  { x: 529, num: '第四章', name: '螢　窟', sub: 'THE FIREFLY CAVE' },
  { x: 723, num: '終　章', name: '燈　塔', sub: 'THE LIGHTHOUSE' },
];

export const NARRATION = [
  { x: 3, lines: ['世界沉入長夜，已經很久了。', '燈塔熄滅的那一晚，暗影從海上來。'] },
  { x: 36, lines: ['我是最後一個守燈人。'] },
  { x: 128, lines: ['燈油會耗盡。', '螢火，是林間僅存的光。'] },
  { x: 199, lines: ['這裡曾經有人。', '他們點著燈，等船回來。'] },
  { x: 233, lines: ['暗影畏懼光。', '但光，也會引來牠們。'] },
  { x: 402, lines: ['燈塔就在群山的另一邊。'] },
  { x: 532, lines: ['山腹裡沒有月光。', '只有我手中這一點。'] },
  { x: 559, lines: ['有些路，只在光裡存在。'] },
  { x: 726, lines: ['海的聲音。', '燈塔，就在前方。'] },
  { x: 884, lines: ['點亮它。'] },
];

export const HINTS = [
  { x0: -4, x1: 14, keys: ['A', 'D'], text: '移動' },
  { x0: 15, x1: 24, keys: ['空白鍵'], text: '跳躍　長按跳得更高' },
  { x0: 104, x1: 118, keys: ['Shift'], text: '按住高舉提燈　照得更遠，燈油消耗更快' },
  { x0: 238, x1: 250, keys: ['F'], text: '光爆　消耗燈油，驅散暗影', alt: '滑鼠左鍵' },
  { x0: 558, x1: 566, keys: ['Shift'], text: '高舉提燈，讓晶石顯形' },
];

// ---------------------------------------------------------------- queries

export function groundRunAt(x) {
  for (const r of GROUND) {
    const p = r.pts;
    if (x >= p[0][0] && x <= p[p.length - 1][0]) return r;
  }
  return null;
}

// exact (un-roughened) key-point height; the builder adds roughness via `roughAt`
export function baseGroundAt(x) {
  const r = groundRunAt(x);
  return r ? polyline(r.pts, x) : null;
}

export function ceilingAt(x) {
  if (x < CEILING.x0 || x > CEILING.x1) return Infinity;
  return polyline(CEILING.pts, x);
}

export function waterAt(x) {
  for (const w of WATER) if (x >= w.x0 && x <= w.x1) return w;
  return null;
}

export function zoneAt(x) {
  for (const z of ZONES) if (x >= z.x0 && x < z.x1) return z;
  return ZONES[ZONES.length - 1];
}

export function cameraKeyAt(x) {
  const k = CAMERA_KEYS;
  if (x <= k[0][0]) return k[0];
  for (let i = 1; i < k.length; i++) {
    if (x <= k[i][0]) {
      const a = k[i - 1], b = k[i];
      const t = (x - a[0]) / (b[0] - a[0]);
      const s = t * t * (3 - 2 * t);
      return [x, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s];
    }
  }
  return k[k.length - 1];
}
