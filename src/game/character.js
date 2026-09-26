import * as THREE from 'three';
import { clamp, damp, lerp, noise1 } from '../util/math.js';
import { getTex } from '../util/tex.js';
import { GLOBAL } from '../render/materials.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Cloth material with trailing/flutter deformation and a cool moon rim so the figure reads in the dark.
function clothMaterial(color, uniforms, { sway = true } = {}) {
  const tex = getTex('cloth', 128);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.96, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.4, 0.4) });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.uniforms.uTime = GLOBAL.uTime;
    sh.vertexShader = 'uniform float uFwd, uVy, uTime, uWindC, uFlap;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      sway
        ? /* glsl */ `#include <begin_vertex>
        float k = clamp((0.62 - position.y) / 0.95, 0.0, 1.0);
        float k2 = k * k;
        transformed.x -= (uFwd * 0.05 + uWindC * 0.06) * k2;
        transformed.x += sin(uTime * 9.0 + position.y * 12.0 + position.z * 6.0) * 0.012 * (abs(uFwd) * 0.3 + uWindC + uFlap) * k2;
        float fall = clamp(-uVy * 0.05, 0.0, 0.5);
        transformed.xz *= 1.0 + fall * 0.5 * k2;
        transformed.y += fall * 0.18 * k2;`
        : '#include <begin_vertex>'
    );
    sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
      float fr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
      totalEmissiveRadiance += uRim * pow(fr, 3.0);`
    ).replace(
      '#include <opaque_fragment>',
      /* glsl */ `// the lantern hangs centimetres away: roll off the near-field hotspot
      outgoingLight *= 1.0 / (1.0 + dot(outgoingLight, vec3(0.3333)) * 2.2);
      #include <opaque_fragment>`
    );
  };
  m.customProgramCacheKey = () => 'cloth' + sway;
  return m;
}

function capsule(r, len, mat) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 8);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

export class Character {
  constructor(scene) {
    this.scene = scene;
    this.u = {
      uFwd: { value: 0 }, uVy: { value: 0 }, uWindC: { value: 0 }, uFlap: { value: 0 },
      uRim: { value: new THREE.Color(0.05, 0.065, 0.09) },
    };
    const cloak = clothMaterial(0x252a31, this.u);
    const hoodMat = clothMaterial(0x252a31, this.u, { sway: false });
    const dark = new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.9 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x2a211b, roughness: 0.7 });
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x030304 });

    const root = (this.root = new THREE.Group());
    scene.add(root);
    const body = (this.body = new THREE.Group());
    root.add(body);

    // legs (hip pivots)
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0, 0.8, side * 0.09);
      const thigh = capsule(0.068, 0.34, dark);
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.38;
      hip.add(knee);
      knee.add(capsule(0.058, 0.33, dark));
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.11), leather);
      boot.geometry.translate(0.04, -0.41, 0);
      boot.castShadow = true;
      knee.add(boot);
      body.add(hip);
      this.legs.push({ hip, knee, side });
    }

    // torso
    const torso = (this.torso = new THREE.Group());
    torso.position.y = 0.8;
    body.add(torso);
    const prof = [
      [0.0, 0.7], [0.08, 0.69], [0.15, 0.65], [0.19, 0.57], [0.2, 0.44], [0.2, 0.28], [0.22, 0.1],
      [0.26, -0.08], [0.3, -0.22], [0.33, -0.33], [0.3, -0.35],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const cg = new THREE.LatheGeometry(prof, 22);
    const cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const y = cp.getY(i), x = cp.getX(i), z = cp.getZ(i);
      const a = Math.atan2(z, x);
      // tattered hem & slight front opening
      let dy = 0;
      if (y < -0.2) dy = (noise1(a * 5.3) * 0.5 + 0.5) * 0.06 + (Math.cos(a) > 0.8 ? 0.05 : 0);
      cp.setXYZ(i, x * 1.05, y + dy, z * 0.82);
    }
    cg.computeVertexNormals();
    const cloakMesh = new THREE.Mesh(cg, cloak);
    cloakMesh.castShadow = true;
    torso.add(cloakMesh);
    // mantle over shoulders
    const mantle = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hoodMat);
    mantle.scale.set(1.1, 0.75, 0.95);
    mantle.position.y = 0.56;
    mantle.castShadow = true;
    torso.add(mantle);

    // head & hood
    const head = (this.head = new THREE.Group());
    head.position.set(0.02, 0.76, 0);
    torso.add(head);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 14), hoodMat);
    hood.scale.set(1.05, 1.08, 0.95);
    hood.castShadow = true;
    head.add(hood);
    const peak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 10), hoodMat);
    peak.position.set(-0.1, 0.1, 0);
    peak.rotation.z = 1.1;
    peak.castShadow = true;
    head.add(peak);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), voidMat);
    face.scale.set(0.6, 1, 0.85);
    face.position.set(0.075, -0.015, 0);
    head.add(face);
    // two faint eyes catching the lantern
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.7, 0.45) });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 4), this.eyeMat);
      e.position.set(0.14, 0.0, s * 0.035);
      head.add(e);
    }

    // lantern arm (camera side) and back arm
    const mkArm = (z, mat) => {
      const sh = new THREE.Group();
      sh.position.set(0.02, 0.56, z);
      const upper = capsule(0.055, 0.25, mat);
      sh.add(upper);
      const el = new THREE.Group();
      el.position.y = -0.28;
      sh.add(el);
      el.add(capsule(0.048, 0.24, mat));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), leather);
      hand.position.y = -0.3;
      el.add(hand);
      torso.add(sh);
      return { sh, el, hand };
    };
    this.armF = mkArm(0.2, hoodMat);
    this.armB = mkArm(-0.2, hoodMat);

    this.buildLantern();
    this.buildScarf();

    // animation state
    this.turn = 0;
    this.phase = 0;
    this.air = 0;
    this.pend = { th: 0, w: 0, phi: 0, wp: 0 };
    this.prevHand = new THREE.Vector3();
    this.prevHandV = new THREE.Vector3();
    this.handWorld = new THREE.Vector3();
    this.lanternPos = new THREE.Vector3();
    this.flame = 1;
    this.poseLight = 0;
    this.deathK = 0;
    this.idleT = 0;
    this.lookT = 0;
    this.first = true;
  }

  buildLantern() {
    const g = (this.lantern = new THREE.Group());
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3028, metalness: 0.75, roughness: 0.42 });
    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0xffe2b0, emissive: 0xffa24a, emissiveIntensity: 3, roughness: 0.15, transparent: true, opacity: 0.9,
    });
    this.flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.2, 1.1) });
    const add = (geo, mat, y, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.castShadow = cast;
      g.add(m);
      return m;
    };
    // pivot at the top of the handle
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.007, 6, 14, Math.PI), metal);
    handle.position.y = -0.045;
    g.add(handle);
    add(new THREE.ConeGeometry(0.075, 0.07, 8), metal, -0.09);
    add(new THREE.CylinderGeometry(0.08, 0.08, 0.018, 10), metal, -0.13);
    this.glass = add(new THREE.CylinderGeometry(0.062, 0.062, 0.15, 12, 1, true), this.glassMat, -0.215, false);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const bar = add(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 4), metal, -0.215);
      bar.position.x = Math.cos(a) * 0.066;
      bar.position.z = Math.sin(a) * 0.066;
    }
    add(new THREE.CylinderGeometry(0.085, 0.07, 0.03, 10), metal, -0.3);
    this.flameMesh = add(new THREE.ConeGeometry(0.018, 0.06, 8), this.flameMat, -0.22, false);
    this.scene.add(g);
  }

  buildScarf() {
    this.scarfN = 10;
    this.scarfLen = 0.07;
    this.sp = [];
    this.spPrev = [];
    for (let i = 0; i < this.scarfN; i++) {
      this.sp.push(V(0, 1.3 - i * 0.07, 0));
      this.spPrev.push(V(0, 1.3 - i * 0.07, 0));
    }
    const n = this.scarfN;
    const pos = new Float32Array(n * 2 * 3);
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a2c24, roughness: 0.85, side: THREE.DoubleSide });
    this.scarf = new THREE.Mesh(geo, mat);
    this.scarf.castShadow = true;
    this.scarf.frustumCulled = false;
    this.scene.add(this.scarf);
    // collar wrap
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 16), mat);
    wrap.rotation.x = Math.PI / 2;
    wrap.position.y = 0.66;
    wrap.scale.set(1.1, 1, 1);
    this.torso.add(wrap);
  }

  // ctx: { time, wind, oil, raised, flareT, pose, lanternOut, dead, deathKind, deathT, landK, hurtT }
  update(dt, p, ctx) {
    const t = ctx.time;
    const speed = Math.abs(p.vx);
    const k = clamp(speed / 4.7);
    const root = this.root;
    root.position.set(p.x, p.y, 0);

    // turning: rotate through facing the camera
    const target = p.face > 0 ? 0 : -Math.PI;
    this.turn = damp(this.turn, target, 14, dt);
    root.rotation.y = this.turn;

    // gait
    this.phase += speed * dt * (Math.PI * 2 / 2.3);
    this.air = damp(this.air, p.onGround ? 0 : 1, p.onGround ? 18 : 10, dt);
    const ph = this.phase;
    const amp = 0.62 * k * (1 - this.air);
    const land = ctx.landK || 0;
    const rising = p.vy > 0 ? 1 : 0;

    // idle life
    if (speed < 0.2 && p.onGround) this.idleT += dt;
    else this.idleT = 0;

    const kneel = this.poseLight = damp(this.poseLight, ctx.pose === 'light' ? 1 : 0, 6, dt);
    const sit = this.poseSit = damp(this.poseSit ?? 1, ctx.pose === 'sit' ? 1 : 0, 2.6, dt);
    const dead = this.deathK = damp(this.deathK, ctx.dead ? 1 : 0, ctx.dead ? 3 : 20, dt);

    for (const L of this.legs) {
      const s = L.side > 0 ? 0 : Math.PI;
      let hipA = Math.sin(ph + s) * amp;
      let kneeA = (Math.max(0, -Math.sin(ph + s + 0.9)) * 1.1 + 0.08) * k * (1 - this.air);
      // air pose: tuck while rising, reach while falling
      hipA = lerp(hipA, rising ? (L.side > 0 ? 0.75 : 0.25) : (L.side > 0 ? 0.3 : -0.2), this.air);
      kneeA = lerp(kneeA, rising ? 1.1 : 0.35, this.air);
      // landing squat
      hipA += land * 0.5;
      kneeA += land * 1.0;
      // kneel to light a beacon
      hipA = lerp(hipA, L.side > 0 ? 1.45 : -0.1, kneel);
      kneeA = lerp(kneeA, L.side > 0 ? 1.5 : 1.9, kneel);
      // sitting by the fire, knees drawn up
      hipA = lerp(hipA, L.side > 0 ? 1.75 : 1.55, sit);
      kneeA = lerp(kneeA, L.side > 0 ? 2.2 : 1.9, sit);
      // death: crumple
      hipA = lerp(hipA, 1.3, dead);
      kneeA = lerp(kneeA, 2.2, dead);
      L.hip.rotation.z = hipA;
      L.knee.rotation.z = -kneeA;
    }
    const bob = -Math.abs(Math.cos(ph)) * 0.045 * k * (1 - this.air);
    const breathe = Math.sin(t * 1.7) * 0.006;
    this.body.position.y = bob - land * 0.16 - kneel * 0.38 - dead * 0.5 - sit * 0.62 + breathe;
    this.torso.rotation.z = -(0.07 * k + land * 0.25 + kneel * 0.2 + dead * 0.9 + sit * 0.32) + (rising ? 0.05 : -0.04) * this.air;
    this.torso.scale.y = 1 + breathe * 1.5;
    this.head.rotation.z = -0.1 * k + dead * 0.4 + kneel * 0.15;
    // idle glance toward the camera
    this.lookT = damp(this.lookT, this.idleT > 3 ? Math.sin(this.idleT * 0.35) * 0.55 : 0, 2, dt);
    this.head.rotation.y = -Math.max(0, this.lookT) * 0.9;

    // arms: lantern held forward, or raised high
    const raised = ctx.raised || 0;
    const flare = ctx.flareT >= 0 ? Math.max(0, 1 - ctx.flareT * 2.2) : 0;
    const lift = Math.max(raised, flare);
    this.armF.sh.rotation.z = lerp(0.72 + Math.sin(ph) * 0.05 * k, 2.55, lift) + kneel * 0.5 - dead * 0.4 + sit * 0.2;
    this.armF.el.rotation.z = lerp(0.55, 0.25, lift) + kneel * 0.2;
    this.armB.sh.rotation.z = Math.sin(ph + Math.PI) * 0.45 * k + this.air * -0.4 - 0.05 + dead * 0.3;
    this.armB.el.rotation.z = 0.3 + k * 0.3;

    // cloak uniforms
    const fwd = p.vx * (p.face > 0 ? 1 : -1);
    this.u.uFwd.value = damp(this.u.uFwd.value, fwd, 8, dt);
    this.u.uVy.value = damp(this.u.uVy.value, p.vy, 10, dt);
    this.u.uWindC.value = ctx.wind * (p.face > 0 ? -1 : 1) * 0.6;
    this.u.uFlap.value = ctx.wind * 0.5 + this.air * 0.6;

    root.updateMatrixWorld(true);
    this.armF.hand.getWorldPosition(this.handWorld);
    if (this.first) {
      this.prevHand.copy(this.handWorld);
      this.first = false;
    }

    // lantern pendulum hanging from the hand
    const hv = this.handWorld.clone().sub(this.prevHand).divideScalar(Math.max(dt, 1e-4));
    const ha = hv.clone().sub(this.prevHandV).divideScalar(Math.max(dt, 1e-4));
    ha.clampLength(0, 60);
    this.prevHand.copy(this.handWorld);
    this.prevHandV.copy(hv);
    const P = this.pend, Lr = 0.2, g = 9.8;
    const windT = ctx.wind * 2.2;
    const acc = -((g + ha.y) / Lr) * Math.sin(P.th) - (ha.x / Lr) * Math.cos(P.th) - 3.2 * P.w + windT;
    P.w += acc * dt;
    P.th = clamp(P.th + P.w * dt, -1.3, 1.3);
    // small depth wobble
    P.wp += (-(g / Lr) * Math.sin(P.phi) - 2.5 * P.wp + Math.sin(t * 1.3) * 0.6 * (k + ctx.wind)) * dt;
    P.phi = clamp(P.phi + P.wp * dt, -0.4, 0.4);
    if (dead > 0.5 && ctx.deathKind !== 'drown') {
      // the lantern slips and falls to the ground
      this.lantern.position.y = damp(this.lantern.position.y, p.y + 0.3, 6, dt);
    } else {
      this.lantern.position.copy(this.handWorld).add(V(0, 0.02, 0));
    }
    this.lantern.rotation.set(P.phi, 0, P.th);
    this.lantern.updateMatrixWorld(true);
    this.glass.getWorldPosition(this.lanternPos);

    // flame flicker
    const fl = ctx.lanternOut ? 0 : 1;
    this.flame = damp(this.flame, fl, fl ? 3 : 8, dt);
    const flick = 0.85 + noise1(t * 9) * 0.12 + noise1(t * 23 + 4) * 0.05;
    const oilK = 0.35 + 0.65 * Math.sqrt(clamp(ctx.oil));
    this.flameMesh.scale.set(1, (0.7 + flick * 0.5) * oilK, 1).multiplyScalar(Math.max(0.001, this.flame));
    this.flameMesh.rotation.z = -P.th * 0.8 + noise1(t * 7) * 0.1;
    this.glassMat.emissiveIntensity = (1.2 + 3.4 * oilK * flick) * this.flame * (1 + flare * 3 + raised * 0.5);
    this.eyeMat.color.setRGB(0.9, 0.7, 0.45).multiplyScalar(0.25 + 0.75 * this.flame * oilK);
    this.flicker = flick;

    this.updateScarf(dt, p, ctx);
  }

  updateScarf(dt, p, ctx) {
    const anchor = V(-0.06, 0.65, 0).applyMatrix4(this.torso.matrixWorld);
    const sp = this.sp, pp = this.spPrev, n = this.scarfN;
    sp[0].copy(anchor);
    const wind = V(ctx.wind * 5.5 + Math.sin(ctx.time * 3.1) * 0.8, Math.sin(ctx.time * 4.7) * 0.4, Math.sin(ctx.time * 2.3) * 0.6);
    const sub = 2, h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (let i = 1; i < n; i++) {
        const c = sp[i], o = pp[i];
        const vel = c.clone().sub(o).multiplyScalar(0.965);
        o.copy(c);
        // drag toward still air + wind, gravity
        const flutter = 1 + i * 0.15;
        c.add(vel).add(V(wind.x * flutter, -7.5 + wind.y, wind.z).multiplyScalar(h * h));
      }
      for (let it = 0; it < 4; it++) {
        sp[0].copy(anchor);
        for (let i = 1; i < n; i++) {
          const a = sp[i - 1], b = sp[i];
          const d = b.clone().sub(a);
          const l = d.length() || 1e-5;
          const diff = (l - this.scarfLen) / l;
          if (i === 1) b.addScaledVector(d, -diff);
          else {
            a.addScaledVector(d, diff * 0.5);
            b.addScaledVector(d, -diff * 0.5);
          }
        }
        // keep the scarf outside the body
        for (let i = 2; i < n; i++) {
          const c = sp[i];
          const dx = c.x - p.x, dz = c.z;
          const r = Math.hypot(dx, dz);
          if (c.y > p.y + 0.4 && r < 0.2) {
            c.x = p.x + (dx / (r || 1)) * 0.2;
            c.z = (dz / (r || 1)) * 0.2;
          }
        }
      }
    }
    const pos = this.scarf.geometry.attributes.position;
    const zAxis = V(0, 0, 1);
    for (let i = 0; i < n; i++) {
      const a = sp[Math.max(0, i - 1)], b = sp[Math.min(n - 1, i + 1)];
      const dir = b.clone().sub(a).normalize();
      const perp = dir.clone().cross(zAxis).normalize();
      const tw = Math.sin(ctx.time * 7 + i * 0.7) * 0.6;
      const w = perp.multiplyScalar(Math.cos(tw)).add(zAxis.clone().multiplyScalar(Math.sin(tw))).normalize();
      const width = 0.055 * (1 - i / n * 0.35);
      pos.setXYZ(i * 2, sp[i].x + w.x * width, sp[i].y + w.y * width, sp[i].z + w.z * width);
      pos.setXYZ(i * 2 + 1, sp[i].x - w.x * width, sp[i].y - w.y * width, sp[i].z - w.z * width);
    }
    pos.needsUpdate = true;
    this.scarf.geometry.computeVertexNormals();
    this.scarf.geometry.computeBoundingSphere();
  }

  setVisible(v) {
    this.root.visible = v;
    this.scarf.visible = v;
    this.lantern.visible = v;
  }

  snapScarf() {
    this.first = true;
    for (let i = 0; i < this.scarfN; i++) {
      this.sp[i].set(this.root.position.x - i * 0.05, this.root.position.y + 1.3 - i * 0.05, 0);
      this.spPrev[i].copy(this.sp[i]);
    }
  }
}
