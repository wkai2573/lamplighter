import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, noise2, noise1, clamp, smoothstep, lerp } from '../util/math.js';
import { getTex } from '../util/tex.js';
import { windify } from '../render/materials.js';
import { terrainHeight, groundAt, surfaceAt } from './terrain.js';
import { WATER, BEACONS } from './level.js';

// ------------------------------------------------------------------ geometry helpers
// Tube along a polyline with per-point radius. Returns non-indexed-friendly indexed geometry.
function tube(points, radii, radial = 7, uvLen = 1) {
  const pos = [], nrm = [], uv = [], idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3();
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], c = points[Math.min(points.length - 1, i + 1)];
    t.subVectors(c, a).normalize();
    n.copy(Math.abs(t.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).cross(t).normalize();
    b.crossVectors(t, n).normalize();
    if (i > 0) acc += points[i].distanceTo(points[i - 1]);
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      const cx = Math.cos(ang), sy = Math.sin(ang);
      p.copy(n).multiplyScalar(cx).addScaledVector(b, sy);
      nrm.push(p.x, p.y, p.z);
      pos.push(points[i].x + p.x * radii[i], points[i].y + p.y * radii[i], points[i].z + p.z * radii[i]);
      uv.push(j / radial, acc * uvLen);
    }
  }
  for (let i = 0; i < points.length - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b2 = a + radial + 1;
      idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// A bent limb from `start` along `dir`.
function limb(r, start, dir, len, r0, r1, segs, wobble = 0.15, droop = 0) {
  const pts = [], rad = [];
  const d = dir.clone().normalize();
  const p = start.clone();
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    pts.push(p.clone());
    rad.push(lerp(r0, r1, Math.pow(k, 0.8)));
    d.x += (r() - 0.5) * wobble;
    d.z += (r() - 0.5) * wobble;
    d.y -= droop * k * 0.5;
    d.normalize();
    p.addScaledVector(d, len / segs);
  }
  return { geo: tube(pts, rad, Math.max(4, Math.round(7 * r0 / 0.2)), 0.35), end: p.clone(), dir: d.clone() };
}

function noisyCone(r, radius, height, y, seed) {
  const g = new THREE.ConeGeometry(radius, height, 10, 3, false);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), yy = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = (height / 2 - yy) / height; // 0 at tip, 1 at base
    const jag = 1 + (noise2(a * 3 + seed, yy * 2) * 0.35 + (r() - 0.5) * 0.25) * k;
    const droop = -k * k * height * 0.18;
    p.setXYZ(i, x * jag, yy + droop + (r() - 0.5) * 0.12 * k, z * jag);
  }
  g.translate(0, y, 0);
  g.rotateY(r() * Math.PI);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ tree species
function makePine(seed, lod = 0) {
  const r = rng(seed);
  const H = 9 + r() * 7;
  const lean = new THREE.Vector3((r() - 0.5) * 0.12, 1, (r() - 0.5) * 0.08);
  const trunk = limb(r, new THREE.Vector3(0, -0.6, 0), lean, H + 0.6, 0.26 + r() * 0.1, 0.04, lod ? 4 : 8, 0.04);
  const bark = [trunk.geo];
  const leaves = [];
  const tiers = lod ? 6 : 10 + Math.floor(r() * 3);
  const base = 0.3 + r() * 0.12;
  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1);
    const y = H * (base + (1 - base) * k * 0.94);
    const rad = (1.55 + r() * 0.45) * Math.pow(1 - k, 0.9) + 0.25;
    const ht = 1.7 + (1 - k) * 1.3;
    const cone = noisyCone(r, rad, ht, y + ht * 0.3, seed * 0.1 + i);
    cone.translate(lean.x * y, 0, lean.z * y);
    leaves.push(cone);
  }
  // a few dead lower branches poking out
  if (!lod)
    for (let i = 0; i < 5; i++) {
      const y = H * (0.15 + r() * 0.25);
      const a = r() * Math.PI * 2;
      const l = limb(r, new THREE.Vector3(lean.x * y, y, lean.z * y), new THREE.Vector3(Math.cos(a), -0.1 + r() * 0.3, Math.sin(a)), 0.8 + r() * 1.2, 0.05, 0.01, 3, 0.4, 0.3);
      bark.push(l.geo);
    }
  return { bark: mergeGeometries(bark), leaves: mergeGeometries(leaves) };
}

function makeBare(seed, lod = 0) {
  const r = rng(seed);
  const parts = [];
  const H = 5 + r() * 4;
  const grow = (start, dir, len, rad, depth) => {
    const l = limb(r, start, dir, len, rad, rad * 0.62, depth > 2 ? 5 : 3, 0.35, depth < 2 ? 0.25 : 0.05);
    parts.push(l.geo);
    if (depth <= 0 || rad < 0.025) return;
    const kids = depth > 2 ? 2 + Math.floor(r() * 2) : 2;
    for (let i = 0; i < kids; i++) {
      const a = r() * Math.PI * 2;
      const spread = 0.55 + r() * 0.5;
      const nd = l.dir.clone().multiplyScalar(1.1).add(new THREE.Vector3(Math.cos(a) * spread, 0.15 + r() * 0.2, Math.sin(a) * spread * 0.6)).normalize();
      grow(l.end.clone().addScaledVector(l.dir, -len * 0.1 * r()), nd, len * (0.55 + r() * 0.2), rad * 0.62, depth - 1);
    }
  };
  grow(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3((r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.2), H * 0.45, 0.24 + r() * 0.08, lod ? 3 : 4);
  return { bark: mergeGeometries(parts), leaves: null };
}

// Windswept cliff pine: leaning, sparse flattened canopy.
function makeCliffPine(seed) {
  const r = rng(seed);
  const parts = [], leaves = [];
  const H = 5 + r() * 2.5;
  // trunk bent by years of sea wind
  const trunk = limb(r, new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(-0.35, 1, 0.05), H, 0.24, 0.06, 8, 0.18);
  parts.push(trunk.geo);
  const pad = (c, size) => {
    // a foliage pad: several lumpy blobs pressed flat
    for (let k = 0; k < 5; k++) {
      const g = new THREE.IcosahedronGeometry(size * (0.45 + r() * 0.35), 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
        v.multiplyScalar(1 + noise2(v.x * 3 + seed + k, v.z * 3 + v.y) * 0.35);
        p.setXYZ(i, v.x * 1.35, v.y * 0.5, v.z);
      }
      g.computeVertexNormals();
      g.translate(c.x + (r() - 0.3) * size * 1.2, c.y + (r() - 0.5) * size * 0.25, c.z + (r() - 0.5) * size);
      leaves.push(g);
    }
  };
  pad(trunk.end, 1.1);
  // branches reaching downwind, each ending in a pad
  for (let i = 0; i < 4; i++) {
    const k = 0.45 + i * 0.13 + r() * 0.05;
    const start = new THREE.Vector3(-0.35 * H * k * 0.9, H * k - 0.4, 0);
    const dir = new THREE.Vector3(0.6 + r() * 0.5, 0.15 + r() * 0.35, (r() - 0.5) * 0.8);
    const b = limb(r, start, dir, 1.2 + r() * 1.3, 0.09, 0.03, 4, 0.3);
    parts.push(b.geo);
    pad(b.end, 0.7 + r() * 0.4);
  }
  return { bark: mergeGeometries(parts), leaves: mergeGeometries(leaves) };
}

// ------------------------------------------------------------------ placement
function waterLevel(x) {
  for (const w of WATER) if (x >= w.x0 - 1 && x <= w.x1 + 1) return w.y;
  return -Infinity;
}

function treeDensity(x) {
  const forest = smoothstep(-70, -50, x) * (1 - smoothstep(185, 205, x));
  const village = smoothstep(185, 205, x) * (1 - smoothstep(380, 400, x)) * 0.35;
  const gorgeEdge = (smoothstep(370, 385, x) * (1 - smoothstep(398, 402, x)) + smoothstep(500, 503, x) * (1 - smoothstep(515, 528, x))) * 0.8;
  const cliff = smoothstep(730, 745, x) * 0.28;
  return clamp(forest + village + gorgeEdge + cliff);
}

export function buildFlora(scene) {
  const barkTex = getTex('bark', 256);
  const barkMat = windify(new THREE.MeshStandardMaterial({
    color: 0x6b5f55, map: barkTex.map, normalMap: barkTex.normalMap, roughness: 0.95,
  }));
  const needleMat = windify(new THREE.MeshStandardMaterial({ color: 0x1f2b20, roughness: 0.92, metalness: 0 }), { amp: 1.3 });
  const cliffLeafMat = windify(new THREE.MeshStandardMaterial({ color: 0x27301f, roughness: 0.9 }), { amp: 1.6 });

  // species variants
  const variants = [];
  for (let i = 0; i < 5; i++) variants.push({ kind: 'pine', ...makePine(101 + i * 17) });
  for (let i = 0; i < 2; i++) variants.push({ kind: 'pineLod', ...makePine(301 + i * 13, 1) });
  for (let i = 0; i < 4; i++) variants.push({ kind: 'bare', ...makeBare(501 + i * 29) });
  for (let i = 0; i < 2; i++) variants.push({ kind: 'cliff', ...makeCliffPine(701 + i * 7) });
  const byKind = (k) => variants.map((v, i) => (v.kind === k ? i : -1)).filter((i) => i >= 0);

  // collect placements per variant per chunk
  const CH = 60;
  const buckets = new Map(); // key -> {vi, near, mats[]}
  const put = (vi, x, y, z, s, rot, near) => {
    const key = `${vi}|${Math.floor(x / CH)}|${near ? 1 : 0}`;
    if (!buckets.has(key)) buckets.set(key, { vi, near, mats: [] });
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.06, rot, (Math.random() - 0.5) * 0.06)),
      new THREE.Vector3(s, s * (0.9 + Math.random() * 0.2), s)
    );
    buckets.get(key).mats.push(m);
  };

  const r = rng(4242);
  const beaconClear = (x, z) => BEACONS.some((b) => Math.abs(b.x - x) < 4 && z > -5);
  for (let x = -75; x < 950; x += 0.9) {
    const dens = treeDensity(x);
    if (dens <= 0.01) continue;
    // bands of depth: just behind the lane, mid, far
    const bands = [[-3.4, -8, 0.1], [-8, -20, 0.28], [-20, -45, 0.4], [-45, -70, 0.35]];
    for (const [z0, z1, p] of bands) {
      if (r() > p * dens) continue;
      const z = lerp(z0, z1, r());
      const xx = x + (r() - 0.5) * 0.9;
      if (beaconClear(xx, z)) continue;
      const y = terrainHeight(xx, z);
      const wl = waterLevel(xx);
      const inFlood = xx > 204 && xx < 347;
      let kind;
      if (xx > 725) kind = 'cliff';
      else if (inFlood) {
        if (y < wl - 3.5) continue;
        kind = 'bare';
      } else if (y < wl - 0.2) continue;
      else kind = r() < (xx > 180 ? 0.6 : 0.2) ? 'bare' : z1 < -20 ? (r() < 0.6 ? 'pineLod' : 'pine') : 'pine';
      if (y < -8) continue;
      const list = byKind(kind);
      const vi = list[Math.floor(r() * list.length)];
      const near = z0 > -9;
      put(vi, xx, y - 0.1, z, 0.8 + r() * 0.5, r() * Math.PI * 2, near);
    }
  }

  const group = new THREE.Group();
  for (const b of buckets.values()) {
    const v = variants[b.vi];
    const mk = (geo, mat) => {
      const im = new THREE.InstancedMesh(geo, mat, b.mats.length);
      b.mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = b.near;
      im.receiveShadow = true;
      group.add(im);
      return im;
    };
    mk(v.bark, barkMat);
    if (v.leaves) mk(v.leaves, v.kind === 'cliff' ? cliffLeafMat : needleMat);
  }
  scene.add(group);

  buildGrass(scene);
  buildRocks(scene);
  return group;
}

// ------------------------------------------------------------------ grass
function tuftGeometry() {
  const r = rng(77);
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const h = 0.16 + r() * 0.26, w = 0.022 + r() * 0.014;
    const g = new THREE.PlaneGeometry(w, h, 1, 3);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + h / 2;
      const t = y / h;
      p.setX(k, p.getX(k) * (1 - t * 0.9));
      p.setY(k, y);
      p.setZ(k, t * t * 0.12);
    }
    g.rotateY(r() * Math.PI);
    g.translate((r() - 0.5) * 0.18, 0, (r() - 0.5) * 0.18);
    // normals point up: soft, even lighting like real grass
    const n = g.attributes.normal;
    for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

function buildGrass(scene) {
  const geo = tuftGeometry();
  const mat = windify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide }), { kind: 'grass' });
  const r = rng(99);
  const mats = [], cols = [];
  const c = new THREE.Color();
  const dark = new THREE.Color('#2f3a24'), dry = new THREE.Color('#5a553a');
  for (let x = -70; x < 910; x += 0.07) {
    const s = surfaceAt(x);
    if (s !== 'grass' && s !== 'mud') continue;
    if (x > 725 && r() < 0.5) continue;
    for (let k = 0; k < 3; k++) {
      const z = k === 0 ? -2.6 + r() * 4.4 : k === 1 ? -3 - r() * 10 : 2 + r() * 3.5;
      if (k === 1 && r() < 0.6) continue;
      if (k === 2 && r() < 0.45) continue;
      const xx = x + (r() - 0.5) * 0.3;
      const g = groundAt(xx);
      if (g === null) continue;
      const y = Math.abs(z) < 1.9 ? g : terrainHeight(xx, z);
      if (y < waterLevel(xx) + 0.05) continue;
      if (noise1(xx * 0.3) < -0.55 && r() < 0.8) continue; // bare patches
      const sc = 0.6 + r() * 0.6 + (k === 1 ? 0.3 : 0);
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(xx, y - 0.03, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 6.28, 0)), new THREE.Vector3(sc, sc * (0.8 + r() * 0.5), sc)));
      c.copy(dark).lerp(dry, r() * 0.7 + (s === 'mud' ? 0.3 : 0));
      cols.push(c.r, c.g, c.b);
    }
  }
  const CH = 40;
  const chunks = new Map();
  mats.forEach((m, i) => {
    const x = m.elements[12];
    const k = Math.floor(x / CH);
    if (!chunks.has(k)) chunks.set(k, []);
    chunks.get(k).push(i);
  });
  for (const list of chunks.values()) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mi, i) => {
      im.setMatrixAt(i, mats[mi]);
      im.setColorAt(i, c.setRGB(cols[mi * 3], cols[mi * 3 + 1], cols[mi * 3 + 2]));
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.receiveShadow = true;
    scene.add(im);
  }
}

// ------------------------------------------------------------------ rocks
export function rockGeometry(seed, detail = 3) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const r = rng(seed);
  const sx = 1 + r() * 0.6, sy = 0.55 + r() * 0.35, sz = 0.8 + r() * 0.4;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const n = noise2(v.x * 1.7 + seed, v.z * 1.7 + v.y) * 0.22 + noise2(v.x * 4 + seed, v.y * 4) * 0.07;
    v.multiplyScalar(1 + n);
    // flatten the base
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.2;
    p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
  }
  // seamless box-projected UVs (the icosahedron's own UVs have a seam)
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + p.getZ(i) * 0.7) * 0.6, (p.getY(i) + p.getZ(i) * 0.3) * 0.6);
  g.computeVertexNormals();
  return g;
}

let rockMatShared = null;
export function rockMaterial() {
  if (!rockMatShared) {
    const t = getTex('rock', 256);
    rockMatShared = new THREE.MeshStandardMaterial({ color: 0x77726c, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1 });
  }
  return rockMatShared;
}

function buildRocks(scene) {
  const mat = rockMaterial();
  const geos = [0, 1, 2, 3].map((i) => rockGeometry(900 + i * 11));
  const r = rng(555);
  const lists = geos.map(() => []);
  for (let x = -70; x < 915; x += 1.5) {
    if (r() > 0.35) continue;
    const z = r() < 0.5 ? -2.6 - r() * 8 : 2.1 + r() * 2.5;
    const y = terrainHeight(x, z);
    if (y < waterLevel(x) - 0.4 && r() < 0.7) continue;
    if (y < -8) continue;
    const s = 0.2 + Math.pow(r(), 2.2) * (z < -5 ? 1.5 : z > 2 ? 0.45 : 0.9);
    const i = Math.floor(r() * geos.length);
    lists[i].push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + s * 0.1, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 6.28, (r() - 0.5) * 0.3)), new THREE.Vector3(s, s, s)));
  }
  lists.forEach((list, i) => {
    const im = new THREE.InstancedMesh(geos[i], mat, list.length);
    list.forEach((m, k) => im.setMatrixAt(k, m));
    im.computeBoundingSphere();
    im.castShadow = im.receiveShadow = true;
    scene.add(im);
  });
}
