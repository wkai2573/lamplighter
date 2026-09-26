import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, noise1, noise2, lerp, clamp } from '../util/math.js';
import { getTex } from '../util/tex.js';
import { GLOBAL } from '../render/materials.js';
import { terrainHeight, groundAt, ceilingHeight } from './terrain.js';
import { rockGeometry, rockMaterial } from './flora.js';
import { PLATFORMS, SOLIDS, BRIDGE, CRYSTALS, BEACONS, LIGHTHOUSE, ceilingAt } from './level.js';

const mats = {};
function M(name) {
  if (mats[name]) return mats[name];
  let m;
  switch (name) {
    case 'wood': {
      const t = getTex('wood', 256);
      m = new THREE.MeshStandardMaterial({ color: 0x8a7866, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1 });
      break;
    }
    case 'woodDark': {
      const t = getTex('wood', 256);
      m = new THREE.MeshStandardMaterial({ color: 0x4a4038, map: t.map, normalMap: t.normalMap, roughness: 0.9 });
      break;
    }
    case 'roof': {
      const t = getTex('roof', 256);
      m = new THREE.MeshStandardMaterial({ color: 0x8c8f96, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1 });
      break;
    }
    case 'stone': {
      const t = getTex('rock', 256);
      m = new THREE.MeshStandardMaterial({ color: 0x8a867e, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1 });
      break;
    }
    case 'brick': {
      const t = getTex('brick', 256);
      m = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1 });
      break;
    }
    case 'rope':
      m = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 1 });
      break;
    case 'iron':
      m = new THREE.MeshStandardMaterial({ color: 0x2b2826, metalness: 0.7, roughness: 0.55 });
      break;
    case 'paint':
      m = new THREE.MeshStandardMaterial({ color: 0x6a2620, roughness: 0.85 });
      break;
    case 'void':
      m = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1 });
      break;
  }
  mats[name] = m;
  return m;
}

function mesh(geo, mat, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, typeof mat === 'string' ? M(mat) : mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

// Box whose UVs are scaled by its size so textures keep a constant density.
function box(w, h, d, texScale = 1.4) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const sx = ax > 0.5 ? d : w, sy = ay > 0.5 ? d : h;
    uv.setXY(i, uv.getX(i) * sx / texScale, uv.getY(i) * sy / texScale);
  }
  return g;
}

// ------------------------------------------------------------------ stone lantern (checkpoint)
export function stoneLantern() {
  const g = new THREE.Group();
  const stone = M('stone');
  const add = (geo, y) => g.add(mesh(geo, stone, 0, y, 0));
  add(new THREE.CylinderGeometry(0.42, 0.5, 0.18, 6), 0.09);
  add(new THREE.CylinderGeometry(0.13, 0.16, 0.8, 8), 0.58);
  add(new THREE.CylinderGeometry(0.36, 0.3, 0.12, 6), 1.03);
  // fire chamber: corner posts
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.36, 0.07), stone, Math.cos(a) * 0.23, 1.27, Math.sin(a) * 0.23));
  }
  // lintel & sill
  add(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 6), 1.47);
  // roof with flared eaves
  const prof = [[0.02, 0.36], [0.12, 0.32], [0.3, 0.18], [0.48, 0.06], [0.56, 0.0], [0.54, -0.04], [0.0, -0.02]].map((p) => new THREE.Vector2(p[0], p[1]));
  const roof = new THREE.LatheGeometry(prof, 6);
  add(roof, 1.52);
  add(new THREE.SphereGeometry(0.075, 8, 6), 1.92);
  // the flame inside (hidden until lit)
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.6, 0.9), transparent: true, opacity: 0 });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 8), flameMat);
  flame.position.y = 1.25;
  g.add(flame);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.8, 0.3), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glowMat);
  glow.position.y = 1.24;
  g.add(glow);
  g.userData = { flame, flameMat, glowMat, glow };
  return g;
}

// ------------------------------------------------------------------ houses
function gableRoof(w, d, rise, overhang = 0.35) {
  // ridge along x, slopes toward +z and -z
  const hw = w / 2 + overhang, hd = d / 2 + overhang;
  const slope = Math.hypot(hd, rise);
  const mk = (side) => {
    const g = new THREE.PlaneGeometry(hw * 2, slope, 6, 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * hw * 2 / 3, uv.getY(i) * slope / 3);
    g.rotateX(-Math.PI / 2 + side * Math.atan2(rise, hd));
    g.translate(0, rise / 2, side * hd / 2);
    return g;
  };
  const a = mk(1), b = mk(-1);
  b.rotateY(0);
  const geo = mergeGeometries([a, b]);
  geo.computeVertexNormals();
  return geo;
}

// A stilt house. `ridgeZ` puts the roof ridge on the play lane when it is walkable.
export function stiltHouse({ x, z, floorY, w = 6, d = 4, wallH = 1.9, rise = 1.3, broken = 0, seed = 1, waterY = -0.2 }) {
  const r = rng(seed);
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  // stilts
  for (let i = 0; i <= Math.round(w / 1.6); i++)
    for (const sz of [-d / 2 + 0.15, d / 2 - 0.15]) {
      const px = -w / 2 + 0.15 + i * ((w - 0.3) / Math.round(w / 1.6));
      const len = floorY - (waterY - 3);
      const post = mesh(new THREE.CylinderGeometry(0.09, 0.11, len, 6), 'woodDark', px, floorY - len / 2, sz);
      post.rotation.z = (r() - 0.5) * 0.08;
      g.add(post);
    }
  // floor
  g.add(mesh(box(w + 0.3, 0.14, d + 0.3), 'wood', 0, floorY - 0.07, 0));
  // walls with a dark doorway and a window facing the camera
  const wallMat = M('wood');
  const back = mesh(box(w, wallH, 0.12), wallMat, 0, floorY + wallH / 2, -d / 2 + 0.06);
  g.add(back);
  for (const sx of [-1, 1]) g.add(mesh(box(0.12, wallH, d), wallMat, sx * (w / 2 - 0.06), floorY + wallH / 2, 0));
  // front wall in pieces around the openings
  const doorW = 0.9, doorX = -w * 0.2;
  const fz = d / 2 - 0.06;
  const leftW = doorX - doorW / 2 + w / 2;
  g.add(mesh(box(leftW, wallH, 0.12), wallMat, -w / 2 + leftW / 2, floorY + wallH / 2, fz));
  const rightW = w / 2 - (doorX + doorW / 2);
  const win = mesh(box(rightW, wallH, 0.12), wallMat, doorX + doorW / 2 + rightW / 2, floorY + wallH / 2, fz);
  g.add(win);
  g.add(mesh(box(doorW, wallH * 0.2, 0.12), wallMat, doorX, floorY + wallH * 0.9, fz));
  g.add(mesh(new THREE.PlaneGeometry(doorW, wallH * 0.8), 'void', doorX, floorY + wallH * 0.4, fz - 0.05, false));
  // window hole (dark) on the right part
  g.add(mesh(new THREE.PlaneGeometry(0.7, 0.55), 'void', doorX + doorW / 2 + rightW / 2, floorY + wallH * 0.6, fz + 0.065, false));
  // beams
  g.add(mesh(box(w + 0.4, 0.14, 0.16), 'woodDark', 0, floorY + wallH, fz + 0.05));
  // roof
  const roof = mesh(gableRoof(w, d, rise), 'roof', 0, floorY + wallH, 0);
  roof.material = M('roof');
  roof.material.side = THREE.DoubleSide;
  if (broken) {
    roof.rotation.z = (r() - 0.5) * 0.12 * broken;
    roof.rotation.x = (r() - 0.5) * 0.1 * broken;
  }
  g.add(roof);
  // gable triangles
  const tri = new THREE.Shape();
  tri.moveTo(-d / 2, 0); tri.lineTo(d / 2, 0); tri.lineTo(0, rise); tri.lineTo(-d / 2, 0);
  const tg = new THREE.ShapeGeometry(tri);
  tg.rotateY(Math.PI / 2);
  for (const sx of [-1, 1]) g.add(mesh(tg, 'wood', sx * (w / 2 - 0.02), floorY + wallH, 0));
  return g;
}

// ------------------------------------------------------------------ boardwalks
function boardwalk(p, r, waterY) {
  const g = new THREE.Group();
  const len = p.x1 - p.x0;
  const n = Math.max(1, Math.round(len / 0.26));
  const planks = [];
  for (let i = 0; i < n; i++) {
    const cx = p.x0 + (i + 0.5) * (len / n);
    if (r() < 0.035 && i > 1 && i < n - 2) continue; // a missing plank here and there (visual only)
    const pg = box(len / n - 0.03, 0.06, 1.35 + r() * 0.15, 1.2);
    pg.rotateY((r() - 0.5) * 0.06);
    pg.rotateZ((r() - 0.5) * 0.03);
    pg.translate(cx, p.y - 0.03 + (r() - 0.5) * 0.015, (r() - 0.5) * 0.08);
    planks.push(pg);
  }
  const pm = mesh(mergeGeometries(planks), 'wood');
  g.add(pm);
  // stringers & posts
  for (const sz of [-0.6, 0.6]) g.add(mesh(box(len, 0.1, 0.1), 'woodDark', (p.x0 + p.x1) / 2, p.y - 0.11, sz));
  for (let x = p.x0 + 0.2; x <= p.x1 - 0.1; x += 1.8 + r() * 0.6) {
    for (const sz of [-0.62, 0.62]) {
      const bottom = waterY - 3;
      const top = p.y - 0.05 + (sz > 0 && r() < 0.3 ? 0.8 : 0);
      const post = mesh(new THREE.CylinderGeometry(0.07, 0.085, top - bottom, 6), 'woodDark', x, (top + bottom) / 2, sz);
      post.rotation.z = (r() - 0.5) * 0.07;
      g.add(post);
    }
  }
  return g;
}

// ------------------------------------------------------------------ rope bridge
function catenary(x0, y0, x1, y1, sag, t) {
  return [lerp(x0, x1, t), lerp(y0, y1, t) - sag * 4 * t * (1 - t)];
}

function ropeGeo(points, r = 0.03) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, points.length * 3, r, 5, false);
}

export function buildBridge(scene, col) {
  const g = new THREE.Group();
  const planks = [];
  const pg = box(0.82, 0.07, 1.25, 1.2);
  const plankMat = M('wood');
  const pw = BRIDGE.plank;
  const all = [];
  for (const [si, s] of BRIDGE.spans.entries()) {
    const n = Math.floor((s.x1 - s.x0) / pw);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const [cx, cy] = catenary(s.x0, s.y0, s.x1, s.y1, s.sag, t);
      if (s.missing.includes(i)) continue;
      const rotten = s.rotten.includes(i);
      const t0 = i / n, t1 = (i + 1) / n;
      const ya = catenary(s.x0, s.y0, s.x1, s.y1, s.sag, t0)[1], yb = catenary(s.x0, s.y0, s.x1, s.y1, s.sag, t1)[1];
      const plank = {
        x: cx, y: cy, rot: Math.atan2(yb - ya, (s.x1 - s.x0) / n), rotten, span: si,
        state: 'ok', standT: 0, fallV: 0, dy: 0, spin: 0, shake: 0,
      };
      plank.platform = col.addPlatform({
        x0: cx - pw / 2 - 0.01, x1: cx + pw / 2 + 0.01, y: cy + 0.035, kind: 'bridge', surface: 'bridge',
        onStand: (dt) => {
          if (!plank.rotten || plank.state !== 'ok') return;
          plank.standT += dt;
          plank.shake = plank.standT;
          if (plank.standT > 0.42) {
            plank.state = 'falling';
            plank.platform.enabled = false;
            bridgeEvents.push({ type: 'plankBreak', x: plank.x, y: plank.y });
          }
        },
      });
      all.push(plank);
    }
    // hand ropes & anchors
    const ropes = [];
    for (const z of [-0.72, 0.72]) {
      const pts = [];
      for (let k = 0; k <= 24; k++) {
        const [x, y] = catenary(s.x0, s.y0 + 1.0, s.x1, s.y1 + 1.0, s.sag * 0.85, k / 24);
        pts.push(new THREE.Vector3(x, y, z));
      }
      ropes.push(ropeGeo(pts, 0.028));
      const lower = [];
      for (let k = 0; k <= 24; k++) {
        const [x, y] = catenary(s.x0, s.y0 - 0.05, s.x1, s.y1 - 0.05, s.sag, k / 24);
        lower.push(new THREE.Vector3(x, y, z * 0.9));
      }
      ropes.push(ropeGeo(lower, 0.025));
      // suspenders
      for (let k = 1; k < 16; k++) {
        const t = k / 16;
        const [x, yl] = catenary(s.x0, s.y0 - 0.05, s.x1, s.y1 - 0.05, s.sag, t);
        const yu = catenary(s.x0, s.y0 + 1.0, s.x1, s.y1 + 1.0, s.sag * 0.85, t)[1];
        ropes.push(ropeGeo([new THREE.Vector3(x, yl, z * 0.9), new THREE.Vector3(x + 0.02, (yl + yu) / 2, z * 0.95), new THREE.Vector3(x, yu, z)], 0.012));
      }
    }
    g.add(mesh(mergeGeometries(ropes), 'rope'));
    // anchor posts at both ends
    for (const [ax, ay] of [[s.x0, s.y0], [s.x1, s.y1]]) {
      for (const z of [-0.8, 0.8]) g.add(mesh(new THREE.CylinderGeometry(0.1, 0.13, 2.4, 7), 'woodDark', ax, ay + 0.2, z));
    }
  }
  const im = new THREE.InstancedMesh(pg, plankMat, all.length);
  im.castShadow = im.receiveShadow = true;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  g.add(im);
  scene.add(g);

  const tmpM = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3();
  const bridgeEvents = [];
  const bridge = {
    planks: all, events: bridgeEvents,
    update(dt, time, wind, playerX, onBridge) {
      for (let i = 0; i < all.length; i++) {
        const p = all[i];
        let sway = Math.sin(time * 1.3 + p.x * 0.2) * 0.03 * (0.3 + Math.abs(wind));
        if (onBridge) sway += Math.exp(-Math.abs(p.x - playerX) * 0.5) * -0.06;
        if (p.state === 'falling') {
          p.fallV -= 18 * dt;
          p.dy += p.fallV * dt;
          p.spin += dt * 2.5;
          if (p.dy < -60) p.state = 'gone';
        }
        const shake = p.state === 'ok' && p.shake > 0 ? Math.sin(time * 70) * 0.02 * Math.min(1, p.shake * 3) : 0;
        e.set(p.spin * 0.7, 0, p.rot + shake + p.spin);
        q.setFromEuler(e);
        v.set(p.x, p.y + sway + p.dy, 0);
        tmpM.compose(v, q, p.state === 'gone' ? zero : s1);
        im.setMatrixAt(i, tmpM);
        p.platform.y = p.y + 0.035 + sway;
      }
      im.instanceMatrix.needsUpdate = true;
    },
    reset() {
      for (const p of all) {
        p.state = 'ok'; p.standT = 0; p.fallV = 0; p.dy = 0; p.spin = 0; p.shake = 0;
        p.platform.enabled = true;
      }
    },
  };
  return bridge;
}

// ------------------------------------------------------------------ light crystals
function crystalCluster(r, w, h = 0.5) {
  const parts = [];
  const n = Math.round(w / 0.3);
  for (let i = 0; i < n; i++) {
    const hh = h * (0.6 + r() * 0.8);
    const c = new THREE.CylinderGeometry(0.06 + r() * 0.08, 0.1 + r() * 0.08, hh, 6);
    const tip = new THREE.ConeGeometry(0.1, 0.18, 6);
    tip.translate(0, hh / 2 + 0.09, 0);
    const m = mergeGeometries([c, tip]);
    m.rotateZ(Math.PI + (r() - 0.5) * 0.5);
    m.rotateX((r() - 0.5) * 0.5);
    m.translate(-w / 2 + (i + 0.5) * (w / n) + (r() - 0.5) * 0.1, -hh / 2, (r() - 0.5) * 0.9);
    parts.push(m);
  }
  // flat top slab
  const top = new THREE.CylinderGeometry(w / 2, w / 2 * 0.92, 0.12, 6, 1);
  top.scale(1, 1, 0.55);
  top.translate(0, -0.06, 0);
  parts.push(top);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

export function buildCrystals(scene, col) {
  const r = rng(321);
  const list = [];
  for (const c of CRYSTALS) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9fe8ff, emissive: 0x3fb8ff, emissiveIntensity: 0, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.06, depthWrite: false,
    });
    const m = new THREE.Mesh(crystalCluster(r, c.w), mat);
    m.position.set(c.x, c.y, 0);
    m.renderOrder = 6;
    scene.add(m);
    const plat = col.addPlatform({ x0: c.x - c.w / 2, x1: c.x + c.w / 2, y: c.y, kind: 'crystal', surface: 'crystal', enabled: false });
    list.push({ ...c, mesh: m, mat, plat, k: 0 });
  }
  return list;
}

// Decorative cave crystals and glowing mushrooms that brighten as the lantern nears.
function reactiveMaterial(color, emissive, base = 0.15, gain = 2.5) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 1, roughness: 0.3 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLantern = GLOBAL.uLantern;
    sh.uniforms.uLanternR = GLOBAL.uLanternR;
    sh.uniforms.uTime = GLOBAL.uTime;
    sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      #ifdef USE_INSTANCING
        vWp = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
    sh.fragmentShader = 'uniform vec3 uLantern; uniform float uLanternR; uniform float uTime; varying vec3 vWp;\n' + sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       float ld = length(vWp - uLantern);
       float near = 1.0 - smoothstep(uLanternR * 0.4, uLanternR * 1.3, ld);
       totalEmissiveRadiance *= ${base.toFixed(3)} + near * ${gain.toFixed(3)} * (0.85 + 0.15 * sin(uTime * 2.0 + vWp.x * 3.0));`
    );
  };
  m.customProgramCacheKey = () => 'reactive' + base + gain;
  return m;
}

export function buildCaveDecor(scene) {
  const r = rng(808);
  const crystalMat = reactiveMaterial(0x7fd8ff, 0x2aa6ff, 0.12, 2.2);
  const shroomMat = reactiveMaterial(0x9fffe0, 0x28e0a8, 0.35, 1.6);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0xb8c4b0, roughness: 0.8 });
  const cg = [];
  const spikes = (n, size) => {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const hh = size * (0.5 + r() * 1.0) * (i === 0 ? 1.4 : 1);
      const rad = size * (0.08 + r() * 0.07);
      const c = new THREE.CylinderGeometry(rad * 0.8, rad, hh, 6);
      c.translate(0, hh / 2, 0);
      const tip = new THREE.ConeGeometry(rad * 0.8, rad * 2.2, 6);
      tip.translate(0, hh + rad * 1.1, 0);
      const m = mergeGeometries([c.toNonIndexed(), tip.toNonIndexed()]);
      m.rotateZ((r() - 0.5) * (i === 0 ? 0.3 : 1.1));
      m.rotateX((r() - 0.5) * (i === 0 ? 0.3 : 1.0));
      m.translate((r() - 0.5) * size * 0.3, 0, (r() - 0.5) * size * 0.3);
      parts.push(m);
    }
    return mergeGeometries(parts);
  };
  for (let x = 534; x < 716; x += 1.2 + r() * 2.5) {
    if (x > 562 && x < 600) continue;
    const front = r() >= 0.75;
    const z = front ? 3.4 + r() * 1.4 : -2.4 - r() * 3;
    const y = terrainHeight(x, z);
    const cl = spikes(3 + Math.floor(r() * 4), (0.35 + r() * 0.5) * (front ? 0.55 : 1));
    cl.translate(x, y - 0.05, z);
    cg.push(cl);
  }
  // a few crystals hanging from the ceiling
  for (let x = 540; x < 712; x += 3 + r() * 6) {
    const z = -1.5 - r() * 3;
    const cl = spikes(2 + Math.floor(r() * 3), 0.3 + r() * 0.35);
    cl.rotateZ(Math.PI);
    cl.translate(x, ceilingHeight(x, z) + 0.15, z);
    cg.push(cl);
  }
  const cm = new THREE.Mesh(mergeGeometries(cg), crystalMat);
  scene.add(cm);
  // mushrooms
  const caps = [], stems = [];
  for (let x = 532; x < 718; x += 0.8 + r() * 3) {
    if (x > 563 && x < 599) continue;
    const z = -1.9 - r() * 1.5;
    const y = groundAt(x) ?? terrainHeight(x, z);
    for (let k = 0; k < 2 + Math.floor(r() * 4); k++) {
      const s = 0.05 + r() * 0.1;
      const px = x + (r() - 0.5) * 0.6, pz = z + (r() - 0.5) * 0.6;
      const py = terrainHeight(px, pz);
      const cap = new THREE.SphereGeometry(s, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.scale(1, 0.6, 1);
      cap.translate(px, py + s * 1.8, pz);
      caps.push(cap);
      const st = new THREE.CylinderGeometry(s * 0.2, s * 0.25, s * 1.8, 5);
      st.translate(px, py + s * 0.9, pz);
      stems.push(st);
    }
  }
  scene.add(new THREE.Mesh(mergeGeometries(caps), shroomMat));
  scene.add(new THREE.Mesh(mergeGeometries(stems), stemMat));
  // stalagmite obstacles
  for (const s of SOLIDS.filter((s) => s.kind === 'stalagmite')) {
    const h = s.y1 - (groundAt((s.x0 + s.x1) / 2) ?? 0) + 0.4;
    const geo = new THREE.ConeGeometry((s.x1 - s.x0) / 2 + 0.15, h + 0.6, 9, 4);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (1 + noise2(p.getY(i) * 3, i) * 0.12));
    geo.computeVertexNormals();
    const m = mesh(geo, 'stone', (s.x0 + s.x1) / 2, (groundAt((s.x0 + s.x1) / 2) ?? 0) + (h + 0.6) / 2 - 0.5, 0);
    scene.add(m);
  }
}

// ------------------------------------------------------------------ lighthouse
export function buildLighthouse(scene) {
  const g = new THREE.Group();
  const base = 14;
  g.position.set(LIGHTHOUSE.x, base, -4.2);
  const tower = new THREE.CylinderGeometry(2.0, 2.9, 20, 20, 8, true);
  const uv = tower.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 7);
  g.add(mesh(tower, 'brick', 0, 10, 0));
  // dark bands
  for (const y of [6, 13]) g.add(mesh(new THREE.CylinderGeometry(lerp(2.9, 2.0, y / 20) + 0.04, lerp(2.9, 2.0, (y - 1.2) / 20) + 0.04, 1.2, 20, 1, true), M('paint'), 0, y, 0));
  // plinth
  g.add(mesh(new THREE.CylinderGeometry(3.4, 3.7, 1.2, 20), 'stone', 0, 0.2, 0));
  // door
  g.add(mesh(new THREE.PlaneGeometry(1.1, 2.1), 'void', 0, 1.8, 2.86, false));
  g.add(mesh(box(1.5, 0.2, 0.3), 'stone', 0, 2.95, 2.8));
  // gallery
  g.add(mesh(new THREE.CylinderGeometry(2.9, 2.6, 0.35, 24), 'stone', 0, 20.1, 0));
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 4), 'iron', Math.cos(a) * 2.75, 20.7, Math.sin(a) * 2.75));
  }
  const rail = new THREE.TorusGeometry(2.75, 0.04, 5, 40);
  rail.rotateX(Math.PI / 2);
  g.add(mesh(rail, 'iron', 0, 21.15, 0));
  // lamp room
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2530, emissive: 0xffc070, emissiveIntensity: 0, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 });
  g.add(mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.3, 16, 1, true), glassMat, 0, 21.5, 0, false));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(mesh(new THREE.BoxGeometry(0.08, 2.3, 0.08), 'iron', Math.cos(a) * 1.52, 21.5, Math.sin(a) * 1.52));
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), lampMat);
  lamp.position.y = 21.4;
  g.add(lamp);
  // dome
  g.add(mesh(new THREE.SphereGeometry(1.7, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 'iron', 0, 22.65, 0));
  g.add(mesh(new THREE.ConeGeometry(0.12, 0.8, 8), 'iron', 0, 24.6, 0));
  // rotating beams (hidden until lit)
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { k: { value: 0 }, time: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying float vFacing;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float k, time; varying vec2 vUv; varying float vFacing;
      void main(){
        // uv.y = 1 at the apex (the lamp): brightest there, fading out to sea
        float along = clamp(1.0 - vUv.y, 0.0, 1.0);
        float a = pow(1.0 - along, 1.5) * pow(clamp(vFacing, 0.0, 1.0), 1.6) * k;
        gl_FragColor = vec4(vec3(1.0, 0.84, 0.58) * max(a, 0.0) * 1.1, 1.0);
      }`,
  });
  const beamPivot = new THREE.Group();
  beamPivot.position.y = 21.4;
  for (const s of [1, -1]) {
    const bg = new THREE.ConeGeometry(9, 140, 24, 1, true);
    bg.translate(0, -70, 0);
    bg.rotateZ(s * Math.PI / 2);
    const b = new THREE.Mesh(bg, beamMat);
    b.renderOrder = 30;
    beamPivot.add(b);
  }
  beamPivot.visible = false;
  g.add(beamPivot);
  scene.add(g);

  // brazier on the lane
  const bz = new THREE.Group();
  const bx = LIGHTHOUSE.brazierX;
  bz.position.set(bx, groundAt(bx) ?? 14, -0.6);
  const bowl = new THREE.SphereGeometry(0.42, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bz.add(mesh(bowl, 'iron', 0, 1.05, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.15, 5), 'iron', Math.cos(a) * 0.22, 0.52, Math.sin(a) * 0.22);
    leg.rotation.z = Math.cos(a) * 0.2;
    leg.rotation.x = -Math.sin(a) * 0.2;
    bz.add(leg);
  }
  scene.add(bz);

  return { group: g, glassMat, lampMat, beamPivot, beamMat, lampPos: new THREE.Vector3(LIGHTHOUSE.x, base + 21.4, -4.2), brazier: bz };
}

// ------------------------------------------------------------------ everything else
export function buildStructures(scene, col) {
  const r = rng(2024);
  const beacons = BEACONS.map((b) => {
    const g = stoneLantern();
    const y = groundAt(b.x) ?? 0;
    g.position.set(b.x, y - 0.05, -1.25);
    g.rotation.y = (r() - 0.5) * 0.3;
    scene.add(g);
    return { ...b, y, group: g, lit: false, k: 0 };
  });

  // boardwalks
  for (const p of PLATFORMS) if (p.kind === 'wood') scene.add(boardwalk(p, r, -0.18));

  // houses: walkable ones sit on the lane with the ridge at z = 0
  const walkRoof = PLATFORMS.filter((p) => p.kind === 'roof');
  for (const [i, p] of walkRoof.entries()) {
    const w = p.x1 - p.x0 - 0.8, d = 3.6, rise = 1.15, wallH = 1.7;
    const floorY = p.y - rise - wallH;
    const h = stiltHouse({ x: (p.x0 + p.x1) / 2, z: 0, floorY, w, d, wallH, rise, seed: 50 + i });
    scene.add(h);
  }
  // background village houses
  const bg = [
    [212, -9, 1.2, 5.5, 0.0], [228, -16, 1.0, 7, 0.6], [246, -7.5, 1.3, 5, 0.2], [262, -13, 0.9, 6.5, 1.0],
    [279, -8, 1.1, 5, 0.3], [304, -11, 1.0, 6, 0.4], [318, -18, 0.8, 7, 0.9], [330, -8.5, 1.2, 5.5, 0.1],
    [236, -26, 0.6, 7, 0.5], [296, -24, 0.5, 8, 0.8], [200, -7, 1.6, 5, 0.0], [352, -9, 1.4, 6, 0.2],
  ];
  for (const [i, [x, z, fy, w, br]] of bg.entries()) {
    const h = stiltHouse({ x, z, floorY: fy, w, d: 3.6 + r(), wallH: 1.8, rise: 1.2, broken: br, seed: 90 + i });
    h.rotation.y = (r() - 0.5) * 0.35;
    if (br > 0.7) h.rotation.z = (r() - 0.5) * 0.1;
    scene.add(h);
  }
  // shrine gate (torii) on the shrine island
  const gate = new THREE.Group();
  gate.position.set(287.2, groundAt(287.2) ?? 0.5, -0.9);
  for (const s of [-1, 1]) {
    const post = mesh(new THREE.CylinderGeometry(0.13, 0.15, 3.4, 10), 'paint', 0, 1.7, s * 1.35);
    gate.add(post);
  }
  const kasagi = mesh(box(0.34, 0.24, 3.9), 'paint', 0, 3.4, 0);
  gate.add(kasagi);
  gate.add(mesh(box(0.3, 0.12, 4.3), 'woodDark', 0, 3.58, 0));
  gate.add(mesh(box(0.2, 0.18, 3.1), 'paint', 0, 2.85, 0));
  gate.rotation.y = 0.3;
  scene.add(gate);

  // fallen log across the path
  const logS = SOLIDS.find((s) => s.kind === 'log');
  {
    const lx = (logS.x0 + logS.x1) / 2;
    const rad = (logS.x1 - logS.x0) / 2 * 0.95;
    const lg = new THREE.CylinderGeometry(rad, rad * 1.1, 7, 12, 4);
    const uv = lg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 4);
    lg.rotateX(Math.PI / 2);
    const bt = getTex('bark', 256);
    const lm = new THREE.MeshStandardMaterial({ color: 0x5b5048, map: bt.map, normalMap: bt.normalMap, roughness: 0.95 });
    const log = new THREE.Mesh(lg, lm);
    log.position.set(lx, logS.y1 - rad, -1.2);
    log.rotation.y = 0.12;
    log.castShadow = log.receiveShadow = true;
    scene.add(log);
  }
  // obstacle rocks
  for (const s of SOLIDS.filter((s) => s.kind === 'rock')) {
    const w = s.x1 - s.x0, top = s.y1;
    const gy = groundAt((s.x0 + s.x1) / 2) ?? s.y0;
    const h = top - gy;
    const geo = rockGeometry(Math.floor(s.x0), 2);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const m = new THREE.Mesh(geo, rockMaterial());
    m.scale.set(w / (bb.max.x - bb.min.x) * 1.05, (h + 0.3) / (bb.max.y - bb.min.y), 1.6);
    m.position.set((s.x0 + s.x1) / 2, gy - 0.3 - bb.min.y * m.scale.y, -0.1);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  // the gorge pillar
  const pil = SOLIDS.find((s) => s.kind === 'pillar');
  {
    const geo = new THREE.CylinderGeometry(2.35, 3.6, 62, 12, 16);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + noise2(Math.atan2(z, x) * 2, y * 0.15) * 0.18;
      p.setXYZ(i, x * k, y, z * k);
    }
    geo.computeVertexNormals();
    const m = mesh(geo, 'stone', (pil.x0 + pil.x1) / 2, pil.y1 - 31, -0.3);
    scene.add(m);
    // cap of planks where the bridge is tied
    scene.add(mesh(box(4.8, 0.12, 1.6), 'wood', (pil.x0 + pil.x1) / 2, pil.y1 - 0.06, 0));
  }
  // campfire at the start
  const camp = new THREE.Group();
  camp.position.set(0.8, groundAt(0.8) ?? 0, -1.4);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const st = new THREE.Mesh(rockGeometry(40 + i, 1), rockMaterial());
    st.scale.setScalar(0.16 + r() * 0.05);
    st.position.set(Math.cos(a) * 0.45, 0.04, Math.sin(a) * 0.45);
    st.castShadow = true;
    camp.add(st);
  }
  for (let i = 0; i < 4; i++) {
    const l = mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 6), 'woodDark', 0, 0.08, 0);
    l.rotation.z = Math.PI / 2 - 0.3;
    l.rotation.y = (i / 4) * Math.PI * 2;
    camp.add(l);
  }
  scene.add(camp);

  // village: half-sunk boats and leaning posts in the water
  for (let i = 0; i < 9; i++) {
    const x = 210 + r() * 130, z = -3 - r() * 16;
    const hull = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    hull.scale(2.2, 0.55, 0.7);
    const b = mesh(hull, 'woodDark', x, -0.1 - r() * 0.3, z);
    b.rotation.set((r() - 0.5) * 0.3, r() * 3, (r() - 0.5) * 0.4);
    const mat = M('woodDark');
    b.material = mat;
    scene.add(b);
  }
  for (let i = 0; i < 40; i++) {
    const x = 205 + r() * 140, z = -2.5 - r() * 22;
    const h = 1 + r() * 2.2;
    const p = mesh(new THREE.CylinderGeometry(0.07, 0.09, h + 3, 5), 'woodDark', x, -3 + (h + 3) / 2 - 0.2, z);
    p.rotation.set((r() - 0.5) * 0.25, 0, (r() - 0.5) * 0.25);
    scene.add(p);
  }
  return { beacons };
}
