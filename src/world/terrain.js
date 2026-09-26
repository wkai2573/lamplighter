import * as THREE from 'three';
import { GROUND, CEILING, WATER, ceilingAt } from './level.js';
import { clamp, lerp, smoothstep, noise1, noise2, fbm2, polyline } from '../util/math.js';
import { getTex } from '../util/tex.js';

export const X_MIN = -80, X_MAX = 960;
const STEP = 0.05;
const COUNT = Math.ceil((X_MAX - X_MIN) / STEP) + 1;

// ------------------------------------------------------------------ exact ground heights
// One fine sample table shared by collision and rendering, so what you see is what you stand on.
const H = new Float32Array(COUNT).fill(NaN);
const SURF = new Uint8Array(COUNT);
const SURFACES = ['none', 'grass', 'mud', 'stone', 'cave', 'wood'];
for (const run of GROUND) {
  const p = run.pts;
  const x0 = p[0][0], x1 = p[p.length - 1][0];
  const s = SURFACES.indexOf(run.surface);
  for (let i = Math.ceil((x0 - X_MIN) / STEP); i <= Math.floor((x1 - X_MIN) / STEP); i++) {
    const x = X_MIN + i * STEP;
    // natural bumps, faded out at the very ends of runs
    const edge = smoothstep(0, 1.5, Math.min(x - x0, x1 - x));
    const bump = (noise1(x * 0.42 + 3.3) * 0.7 + noise1(x * 1.37) * 0.3) * run.rough * edge;
    H[i] = polyline(p, x) + bump;
    SURF[i] = s;
  }
}

export function groundAt(x) {
  const f = (x - X_MIN) / STEP;
  const i = Math.floor(f);
  if (i < 0 || i >= COUNT - 1) return null;
  const a = H[i], b = H[i + 1];
  if (a !== a || b !== b) {
    if (a === a && f - i < 0.5) return a;
    if (b === b && f - i >= 0.5) return b;
    return null;
  }
  return a + (b - a) * (f - i);
}

export function surfaceAt(x) {
  const i = Math.round((x - X_MIN) / STEP);
  return SURFACES[SURF[i] || 0];
}

// Height of the highest ground within [x0, x1] (for feet that straddle bumps).
export function groundMax(x0, x1) {
  let best = null;
  const i0 = Math.max(0, Math.floor((x0 - X_MIN) / STEP)), i1 = Math.min(COUNT - 1, Math.ceil((x1 - X_MIN) / STEP));
  for (let i = i0; i <= i1; i++) {
    const h = H[i];
    if (h === h && (best === null || h > best)) best = h;
  }
  return best;
}

// ------------------------------------------------------------------ visual height field
function pitDepth(x) {
  if (x > 398 && x < 502) return -52;          // the gorge
  if (x > 560 && x < 600) return -16;          // cave chasm
  for (const w of WATER) if (x > w.x0 && x < w.x1 && w.kind === 'flood') return -4.2;
  return -9;
}

// Smooth "lane height" even across pits, used to shape the land behind/in front.
function laneBase(x) {
  const g = groundAt(x);
  return g === null ? pitDepth(x) : g;
}

const inRange = (x, a, b, soft = 8) => smoothstep(a - soft, a, x) * (1 - smoothstep(b, b + soft, x));

export function terrainHeight(x, z) {
  const base = laneBase(x);
  const d = Math.max(0, -z - 2.0); // distance behind the lane
  const f = Math.max(0, z - 1.9);  // distance in front of the lane
  const n = fbm2(x * 0.08, z * 0.08, 4);
  const n2 = noise2(x * 0.35 + 7, z * 0.35);

  // weights for the different kinds of land
  const cave = inRange(x, 530, 720, 6);
  const cliff = inRange(x, 738, 960, 16);
  const lake = inRange(x, 212, 340, 10);
  const gorge = inRange(x, 400, 500, 1.5);

  // behind the lane: a gentle wooded slope, then rolling hills
  let back = d * 0.07 + Math.max(0, d - 16) * 0.1 + n * Math.min(d, 24) * 0.32 + n2 * Math.min(d, 3) * 0.12;
  // flooded valley: land slides under the water, far shore rises again
  const lakeBack = lerp(base, -4.2, smoothstep(2.5, 8, d)) - base + Math.max(0, d - 34) * 0.6 + n * Math.min(d, 40) * 0.15;
  back = lerp(back, lakeBack, lake);
  // mountain wall inside the cave (capped under the mountain's top surface)
  back = lerp(back, Math.min(Math.pow(d, 1.5) * 1.4 + n * d * 0.6, MOUNTAIN_TOP(x) - base - 1), cave);
  // sea cliffs: land falls to the sea behind the path (but holds up under the lighthouse)
  const hold = inRange(x, 884, 910, 6);
  const drop = -Math.min(Math.max(0, d - 2.5 - hold * 6) * 1.9, 60) + n * 2;
  back = lerp(back, drop, cliff);
  // gorge walls continue back into the distance
  back = lerp(back, n * 6, gorge * 0.8);

  // in front of the lane the ground falls away, showing a raw lip
  let front = -f * 0.22 - Math.max(0, f - 3) * 0.25 + n2 * Math.min(f, 2) * 0.2 + n * f * 0.35;
  front = lerp(front, -Math.pow(f, 1.4) * 3.2, cliff);
  front = lerp(front, -Math.pow(f, 1.2) * 0.4 - f * 0.2, lake * 0.7);

  let h = base + back + front;
  // tiny lane noise only near the edges so the walkway stays true
  h += noise2(x * 0.9, z * 0.9) * 0.12 * smoothstep(1.2, 2.2, Math.abs(z + 0.1));
  return h;
}

// ------------------------------------------------------------------ colours
const COL = {
  grass: new THREE.Color('#3b4630'), grassDry: new THREE.Color('#4c4a36'), mud: new THREE.Color('#3f3529'),
  stone: new THREE.Color('#55555a'), rock: new THREE.Color('#4a4a4e'), cave: new THREE.Color('#3a342e'),
  underwater: new THREE.Color('#1e1c18'), cliff: new THREE.Color('#4f5157'),
};

function colorAt(x, y, z, slope, out) {
  const cave = inRange(x, 530, 720, 4);
  const cliff = inRange(x, 738, 960, 10);
  const lake = inRange(x, 206, 344, 4);
  const n = fbm2(x * 0.15, z * 0.15, 3) * 0.5 + 0.5;
  out.copy(COL.grass).lerp(COL.grassDry, n);
  out.lerp(COL.mud, clamp(lake * 0.8 + (y < 0.2 ? 0.3 : 0)));
  out.lerp(COL.cliff, cliff * 0.55);
  out.lerp(COL.cave, cave);
  out.lerp(COL.rock, clamp((slope - 0.55) * 2.5) * (1 - cave * 0.5));
  if (y < -0.4) out.lerp(COL.underwater, clamp((-0.4 - y) * 0.5));
  // deep pits fade to black-ish so they read as depth
  if (y < -6) out.multiplyScalar(clamp(1 + (y + 6) * 0.06, 0.25, 1));
  return out;
}

// ------------------------------------------------------------------ mesh
const Z_ROWS = [14, 11, 8.6, 6.5, 5.4, 4.4, 3.6, 3.0, 2.5, 2.1, 1.7, 1.2, 0.6, 0, -0.6, -1.2, -1.8, -2.4, -3.1, -4, -5.1, -6.5, -8.3, -10.5, -13.5, -17, -22, -28, -36, -46, -60, -78];

function xSamples(x0, x1) {
  const xs = new Set();
  for (let x = x0; x <= x1 + 1e-6; x += 0.5) xs.add(+x.toFixed(3));
  // include exact run ends so pit walls are crisp
  for (const run of GROUND) {
    const a = run.pts[0][0], b = run.pts[run.pts.length - 1][0];
    for (const e of [a - 0.06, a + 0.02, b - 0.02, b + 0.06]) if (e > x0 && e < x1) xs.add(+e.toFixed(3));
    for (const p of run.pts) if (p[0] > x0 && p[0] < x1) xs.add(+p[0].toFixed(3));
  }
  return [...xs].sort((a, b) => a - b);
}

function gridMesh(xs, zs, heightFn, colorFn, uvScale = 1 / 5.5) {
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const hs = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) hs[j * nx + i] = heightFn(xs[i], zs[j]);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = xs[i], z = zs[j], y = hs[k];
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      const hl = hs[j * nx + Math.max(0, i - 1)], hr = hs[j * nx + Math.min(nx - 1, i + 1)];
      const dx = xs[Math.min(nx - 1, i + 1)] - xs[Math.max(0, i - 1)] || 1;
      const hb = hs[Math.max(0, j - 1) * nx + i], hf = hs[Math.min(nz - 1, j + 1) * nx + i];
      const dz = Math.abs(zs[Math.min(nz - 1, j + 1)] - zs[Math.max(0, j - 1)]) || 1;
      const slope = Math.hypot((hr - hl) / dx, (hf - hb) / dz);
      colorFn(x, y, z, slope, c);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      uv[k * 2] = x * uvScale;
      uv[k * 2 + 1] = (z - y * 0.85) * uvScale;
    }
  const idx = [];
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      // rows run front→back (z decreasing), so this winding faces up
      const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildTerrain(scene) {
  const tex = getTex('ground', 512);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: tex.map,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: tex.roughnessMap,
    roughness: 1,
    metalness: 0,
  });
  const group = new THREE.Group();
  const CH = 40;
  for (let x0 = X_MIN; x0 < X_MAX; x0 += CH) {
    const xs = xSamples(x0, Math.min(X_MAX, x0 + CH));
    const g = gridMesh(xs, Z_ROWS, terrainHeight, colorAt);
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = true;
    group.add(m);
  }
  group.add(buildCave(mat));
  scene.add(group);
  return { group, mat };
}

// ------------------------------------------------------------------ cave: ceiling, mountain mass & reveal curtain
const MOUNTAIN_TOP = (x) => {
  const t = smoothstep(510, 560, x) * (1 - smoothstep(700, 750, x));
  return lerp(8, 34 + fbm2(x * 0.03, 1.7, 3) * 10, t) + noise1(x * 0.2) * 1.5;
};

export function ceilingHeight(x, z) {
  const c = ceilingAt(x);
  const cc = c === Infinity ? MOUNTAIN_TOP(x) : c;
  const d = Math.max(0, -z - 2.5);
  // stalactites: sharp downward spikes
  const sp = Math.max(0, noise2(x * 0.9, z * 0.9) - 0.35) * 2.2 + Math.max(0, noise2(x * 2.3 + 5, z * 2.3) - 0.5) * 1.2;
  return cc - Math.pow(d, 1.35) * 0.9 - sp + fbm2(x * 0.1, z * 0.1, 3) * 0.8;
}

let curtain = null;
export function caveCurtain() { return curtain; }

function buildCave(terrainMat) {
  const group = new THREE.Group();
  const x0 = CEILING.x0, x1 = CEILING.x1;
  const xs = [];
  for (let x = x0; x <= x1; x += 0.5) xs.push(x);
  const rock = getTex('rock', 256);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x5a524a, map: rock.map, normalMap: rock.normalMap, roughnessMap: rock.roughnessMap, roughness: 1, side: THREE.DoubleSide,
  });

  // ceiling (faces down)
  const zs = [3.2, 2.6, 1.8, 1, 0, -1, -2, -3, -4.2, -5.6, -7.2, -9];
  const cg = gridMesh(xs, zs, ceilingHeight, (x, y, z, s, c) => c.set('#3d3731').multiplyScalar(0.8 + fbm2(x * 0.2, z, 2) * 0.3));
  // flip winding so the lit side faces down
  const ci = cg.getIndex().array;
  for (let i = 0; i < ci.length; i += 3) { const t = ci[i + 1]; ci[i + 1] = ci[i + 2]; ci[i + 2] = t; }
  cg.computeVertexNormals();
  const ceil = new THREE.Mesh(cg, terrainMat);
  ceil.receiveShadow = ceil.castShadow = true;
  group.add(ceil);

  // mountain mass above: front face + top
  const top = [], idx = [];
  const Z_FRONT = 3.2;
  const rows = [
    (x) => [x, ceilingHeight(x, Z_FRONT), Z_FRONT],
    (x) => [x, lerp(ceilingHeight(x, Z_FRONT), MOUNTAIN_TOP(x), 0.5) + noise1(x * 0.3) * 1.5, Z_FRONT + 0.6 + noise1(x * 0.2) * 0.8],
    (x) => [x, MOUNTAIN_TOP(x), Z_FRONT - 0.5],
    (x) => [x, MOUNTAIN_TOP(x) + 4, -8],
    (x) => [x, MOUNTAIN_TOP(x) + 10, -30],
  ];
  const mx = [];
  for (let x = 505; x <= 750; x += 1) mx.push(x);
  const pos = [], uv = [];
  for (const r of rows) for (const x of mx) {
    const p = r(x);
    if (x < x0 + 3 || x > x1 - 3) {
      // outside the ceiling span the mass sits on the ground
      const g = terrainHeight(x, p[2]);
      p[1] = Math.max(p[1], g);
    }
    pos.push(...p);
    uv.push(p[0] / 4, (p[1] + p[2]) / 4);
  }
  const n = mx.length;
  for (let j = 0; j < rows.length - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  mg.setIndex(idx);
  mg.computeVertexNormals();
  const mass = new THREE.Mesh(mg, rockMat);
  mass.castShadow = mass.receiveShadow = true;
  group.add(mass);

  // curtain: rock face covering the tunnel slice; fades out while the player is inside
  const cpos = [], cidx = [], cuv = [];
  const cx = [];
  for (let x = 527; x <= 723; x += 0.75) cx.push(x);
  for (const x of cx) {
    const floor = terrainHeight(x, Z_FRONT) - 1;
    const ceilY = ceilingHeight(x, Z_FRONT) + 0.5;
    const zz = Z_FRONT + 0.3 + noise1(x * 0.4) * 0.3;
    cpos.push(x, Math.min(floor, ceilY - 1), zz, x, ceilY, zz);
    cuv.push(x / 4, floor / 4, x / 4, ceilY / 4);
  }
  for (let i = 0; i < cx.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    cidx.push(a, c, b, b, c, d);
  }
  const cgeo = new THREE.BufferGeometry();
  cgeo.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
  cgeo.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2));
  cgeo.setIndex(cidx);
  cgeo.computeVertexNormals();
  const cmat = rockMat.clone();
  cmat.transparent = true;
  cmat.opacity = 1;
  cmat.side = THREE.DoubleSide;
  curtain = new THREE.Mesh(cgeo, cmat);
  curtain.renderOrder = 5;
  group.add(curtain);
  return group;
}
