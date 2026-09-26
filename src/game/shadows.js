import * as THREE from 'three';
import { NOISE } from '../render/glsl.js';
import { SHADOWS, CHASE } from '../world/level.js';
import { groundAt } from '../world/terrain.js';
import { clamp, damp, lerp, rng } from '../util/math.js';

// Smoky ink creature drawn on a billboard. Burns at the edges when light touches it.
function shadowMaterial(eyes = 2) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      time: { value: 0 }, seed: { value: 0 }, burn: { value: 0 }, dissolve: { value: 0 }, eyeGlow: { value: 1 },
      alpha: { value: 0 }, face: { value: 1 }, stretch: { value: 0 }, giant: { value: eyes > 2 ? 1 : 0 },
      lightDir: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float time, seed, burn, dissolve, eyeGlow, alpha, face, stretch, giant;
      uniform vec2 lightDir;
      varying vec2 vUv;
      ${NOISE}
      float eye(vec2 p, vec2 c, float s){ vec2 d = (p - c) * vec2(1.0, 2.2) / s; return exp(-dot(d, d) * 2.5); }
      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        p.x -= face * stretch * 0.25 * (1.0 - vUv.y);
        float t = time * 0.9 + seed * 13.0;
        float n = fbm(p * 2.3 + vec2(seed, -t * 0.7));
        float n2 = fbm(p * 5.1 + vec2(t * 0.4, -t * 1.3));
        // signed "distance" to the silhouette: > 0 inside
        float sd;
        if (giant > 0.5) {
          // a wall of darkness with a ragged, grasping leading edge
          float edge = 0.35 + (n - 0.5) * 0.7 + sin(p.y * 7.0 + t * 2.0) * 0.06 + (fbm(vec2(p.y * 6.0, t)) - 0.5) * 0.4;
          sd = (edge - p.x) * 1.6;
          sd = min(sd, (0.92 - abs(p.y) - (n2 - 0.5) * 0.3) * 2.0);
        } else {
          // warped blob: head on top, body dissolving into smoky tendrils below
          vec2 q = p + (vec2(fbm(p * 1.8 + t * 0.35), fbm(p * 1.8 - t * 0.3 + 4.0)) - 0.5) * 0.55;
          float r = length(q * vec2(1.15, 0.9) - vec2(0.0, 0.12));
          sd = 0.5 - r + (n - 0.5) * 0.35;
          float tendril = (fbm(vec2(q.x * 7.0 + seed, q.y * 1.1 + t * 1.6)) - 0.55) * 1.4 - abs(q.x) * 0.9 + 0.15;
          sd = max(sd, min(tendril, -q.y * 0.6 + 0.1));
        }
        float a = smoothstep(-0.03, 0.08, sd);
        // a faint aura of dimness around the body
        a = max(a, smoothstep(-0.3, 0.0, sd) * 0.3);
        a *= smoothstep(dissolve, dissolve + 0.12, n2 * 0.9 + 0.08);
        vec3 col = vec3(0.004, 0.003, 0.007) * (0.6 + n2);
        // slow violet smoke churning inside the body
        float swirl = smoothstep(0.45, 0.85, fbm(p * 3.0 + vec2(t * 0.5, -t * 0.8) + n));
        col += vec3(0.05, 0.022, 0.085) * swirl * smoothstep(0.05, 0.3, sd);
        // thin burning rim, only on the side the light comes from, broken into flickers
        float rim = smoothstep(-0.03, 0.04, sd) * (1.0 - smoothstep(0.04, 0.14, sd));
        float facing = clamp(dot(normalize(p + 1e-4), lightDir) * 0.8 + 0.35, 0.0, 1.0);
        float flick = smoothstep(0.35, 0.75, vnoise(p * 9.0 + vec2(t * 3.0, 0.0)));
        col += vec3(0.06, 0.025, 0.1) * rim * 0.8;
        col += vec3(1.8, 0.55, 0.14) * rim * burn * facing * (0.25 + flick * 1.4);
        col += vec3(1.5, 0.5, 0.15) * burn * dissolve * a;
        // eyes
        float e = 0.0;
        if (giant > 0.5) {
          for (int i = 0; i < 7; i++) {
            float fi = float(i);
            vec2 c = vec2(0.05 + fract(sin(fi * 12.9) * 43.7) * 0.45, -0.6 + fi * 0.2 + sin(t + fi) * 0.03);
            float bl = step(0.12, fract(t * 0.2 + fi * 0.37));
            e += (eye(p, c, 0.018) + eye(p, c + vec2(0.05, 0.0), 0.018)) * bl * 1.4;
          }
        } else {
          float bl = step(0.06, fract(t * 0.23 + seed));
          vec2 c = vec2(face * 0.12, 0.2);
          e = (eye(p, c - vec2(0.1, 0.0), 0.055) + eye(p, c + vec2(0.1, 0.0), 0.055)) * bl;
        }
        col += (giant > 0.5 ? vec3(2.6, 0.7, 0.45) : vec3(2.4, 1.6, 1.3)) * e * eyeGlow * (1.0 - dissolve);
        a = max(a, clamp(e * eyeGlow, 0.0, 1.0) * (1.0 - dissolve));
        gl_FragColor = vec4(col, a * alpha);
      }`,
  });
}

export class Shadows {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    const r = rng(666);
    for (const [x, count, yOff] of SHADOWS) {
      for (let i = 0; i < count; i++) {
        const mat = shadowMaterial();
        mat.uniforms.seed.value = r() * 10;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), mat);
        mesh.renderOrder = 18;
        mesh.visible = false;
        scene.add(mesh);
        const sx = x + i * 3.2 - (count - 1) * 1.6;
        const gy = groundAt(sx);
        const home = { x: sx, y: (gy ?? 0) + yOff };
        this.list.push({ home, mesh, mat, seed: r(), state: 'dormant', x: home.x, y: home.y - 2.5, vx: 0, vy: 0, t: 0, hp: 1, edgeT: 0, face: -1, lungeT: 0, burn: 0, alpha: 0, dissolve: 0 });
      }
    }
    this.events = [];
    this.nearest = Infinity;
    this.threat = 0;

    // the great shadow for the final chase
    const gm = shadowMaterial(7);
    this.giant = { mesh: new THREE.Mesh(new THREE.PlaneGeometry(34, 26), gm), mat: gm, x: CHASE.start - 30, active: false, k: 0, speed: 0 };
    this.giant.mesh.renderOrder = 19;
    this.giant.mesh.visible = false;
    scene.add(this.giant.mesh);
  }

  reset(fromX) {
    // creatures ahead of the checkpoint come back
    for (const s of this.list) {
      if (s.home.x > fromX - 6) {
        s.state = 'dormant';
        s.x = s.home.x;
        s.y = s.home.y - 2.5;
        s.alpha = 0;
        s.dissolve = 0;
        s.hp = 1;
        s.mesh.visible = false;
      }
    }
    this.giant.active = false;
    this.giant.k = 0;
    this.giant.mesh.visible = false;
  }

  kill(s) {
    s.state = 'dying';
    s.t = 0;
    this.events.push({ type: 'shadowDie', x: s.x, y: s.y });
  }

  // lights: [{x, y, r}] safe zones (lit beacons)
  update(dt, time, player, lantern, safe, ash) {
    const L = player.lightRadius;
    const lx = lantern.x, ly = lantern.y;
    const raised = player.raised;
    let nearest = Infinity;
    for (const s of this.list) {
      const u = s.mat.uniforms;
      u.time.value = time;
      const dxp = player.x - s.x, dyp = player.y + 1.0 - s.y;
      const dp = Math.hypot(dxp, dyp);
      if (s.state === 'dormant') {
        if (Math.abs(player.x - s.home.x) < 20 && !player.dead) {
          s.state = 'rise';
          s.t = 0;
          s.mesh.visible = true;
          this.events.push({ type: 'shadowRise', x: s.x, y: s.home.y });
        } else continue;
      }
      if (s.state === 'dead') continue;
      s.t += dt;
      const dl = Math.hypot(lx - s.x, ly - s.y);
      // how deep inside the light it is
      const inLight = L > 0 ? clamp(1 - (dl - L * 0.55) / (L * 0.45)) : 0;

      if (s.state === 'rise') {
        s.alpha = clamp(s.t / 1.4);
        s.y = damp(s.y, s.home.y, 2, dt);
        if (s.t > 1.4) s.state = 'hunt';
      } else if (s.state === 'hunt' || s.state === 'windup' || s.state === 'lunge' || s.state === 'recoil') {
        if (s.state !== 'lunge' && s.state !== 'windup') s.face = Math.sign(dxp) || s.face;
        const edge = L * 0.92 + 0.6;
        let ax = 0, ay = 0;
        if (s.state === 'hunt') {
          // approach to the edge of the light, then circle
          const want = player.dead ? 1.0 : Math.max(edge, 1.0);
          const dir = dp > want ? 1 : -0.6;
          ax = (dxp / (dp || 1)) * dir * 9;
          ay = (dyp / (dp || 1)) * dir * 9 + Math.sin(time * 2 + s.seed * 9) * 3;
          if (dp < want + 1.2 && !player.dead) s.edgeT += dt;
          if (s.edgeT > 1.6 + s.seed * 1.4 && raised < 0.5 && !player.lanternOut) {
            s.state = 'windup';
            s.t = 0;
            s.edgeT = 0;
            this.events.push({ type: 'shadowWindup', x: s.x, y: s.y });
          }
          if (player.lanternOut && dp < 1.1) {
            // no light left: they simply engulf you
            s.state = 'lunge';
            s.t = 0;
          }
          s.vx = damp(s.vx, s.vx + ax * dt, 1, 1);
          s.vy = damp(s.vy, s.vy + ay * dt, 1, 1);
          const sp = Math.hypot(s.vx, s.vy), max = 2.4;
          if (sp > max) { s.vx *= max / sp; s.vy *= max / sp; }
        } else if (s.state === 'windup') {
          s.vx = damp(s.vx, -Math.sign(dxp) * 0.8, 6, dt);
          s.vy = damp(s.vy, 0.5, 6, dt);
          if (raised > 0.6) {
            s.state = 'recoil';
            s.t = 0;
          } else if (s.t > 0.55) {
            s.state = 'lunge';
            s.t = 0;
            s.ldx = dxp / (dp || 1);
            s.ldy = dyp / (dp || 1);
            this.events.push({ type: 'shadowLunge', x: s.x, y: s.y });
          }
        } else if (s.state === 'lunge') {
          s.vx = s.ldx * 8.5;
          s.vy = s.ldy * 8.5;
          if (s.t > 0.55) { s.state = 'recoil'; s.t = 0; }
          if (dp < 0.9 && !player.dead) {
            if (player.hurt(Math.sign(dxp) || 1, 0.13)) this.events.push({ type: 'shadowHit', x: s.x, y: s.y });
            s.state = 'recoil';
            s.t = 0;
          }
        } else if (s.state === 'recoil') {
          s.vx = damp(s.vx, -Math.sign(dxp) * 4, 5, dt);
          s.vy = damp(s.vy, 1.5, 5, dt);
          if (s.t > 0.9) s.state = 'hunt';
        }
        // raised lantern pushes them back and slowly burns them
        if (inLight > 0 && s.state !== 'lunge') {
          const push = (raised * 7 + 1.5) * inLight;
          s.vx -= (dxp / (dp || 1)) * push * dt * 3;
          s.vy -= (dyp / (dp || 1)) * push * dt * 2;
        }
        s.burn = damp(s.burn, inLight * (0.35 + raised * 0.9) + (s.state === 'lunge' ? 0.4 : 0), 8, dt);
        if (raised > 0.5 && inLight > 0.3) {
          s.hp -= dt * 0.28 * inLight;
          if (s.hp <= 0) this.kill(s);
        }
        // lit beacons are sanctuaries
        for (const z of safe) {
          const d = Math.hypot(z.x - s.x, z.y - s.y);
          if (d < z.r) {
            s.vx += ((s.x - z.x) / (d || 1)) * 14 * dt;
            s.burn = Math.max(s.burn, 0.6);
          }
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const gy = groundAt(s.x);
        if (gy !== null && s.y < gy + 0.7) { s.y = gy + 0.7; s.vy = Math.abs(s.vy) * 0.3; }
        // don't drift too far from home unless hunting close
        if (Math.abs(s.x - s.home.x) > 26) s.vx -= Math.sign(s.x - s.home.x) * 6 * dt;
        nearest = Math.min(nearest, dp);
        // shed wisps
        if (ash && Math.random() < dt * 14) ash.spawn({ x: s.x + (Math.random() - 0.5) * 0.8, y: s.y - 0.3 + (Math.random() - 0.5) * 0.6, z: 0.3, vx: -s.vx * 0.2 + (Math.random() - 0.5) * 0.3, vy: 0.3 + Math.random() * 0.4, life: 1 + Math.random(), size: 0.18, size1: 0.45, color: [0.01, 0.008, 0.014], alpha: 0.55, turb: 0.8 });
      } else if (s.state === 'dying') {
        s.dissolve = clamp(s.t / 0.9);
        s.burn = 1;
        if (ash && s.t < 0.5)
          for (let k = 0; k < 4; k++)
            ash.spawn({ x: s.x + (Math.random() - 0.5) * 1.2, y: s.y + (Math.random() - 0.5) * 1.2, z: 0.4, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2.5, life: 1.2 + Math.random(), size: 0.07, size1: 0.02, color: [0.02, 0.015, 0.02], alpha: 0.9, grav: -0.5, turb: 1.5 });
        if (s.t > 0.9) {
          s.state = 'dead';
          s.mesh.visible = false;
        }
      }
      u.burn.value = s.burn;
      u.lightDir.value.set(lx - s.x, ly - s.y).normalize();
      u.dissolve.value = s.dissolve;
      u.alpha.value = s.alpha;
      u.face.value = s.face;
      u.stretch.value = s.state === 'lunge' ? 1 : s.state === 'windup' ? -0.4 : 0;
      u.eyeGlow.value = s.state === 'windup' ? 2.2 : 1;
      s.mesh.position.set(s.x, s.y, 0.35);
      const sc = s.state === 'windup' ? 1 + Math.sin(s.t * 40) * 0.04 + s.t * 0.2 : 1;
      s.mesh.scale.set(sc * (s.state === 'lunge' ? 1.25 : 1), sc, 1);
    }
    this.nearest = nearest;
    this.threat = damp(this.threat, clamp(1 - (nearest - 3) / 9), 3, dt);
  }

  // A flare sears everything within its radius.
  flare(x, y, radius) {
    let n = 0;
    for (const s of this.list) {
      if (s.state === 'dormant' || s.state === 'dying' || s.state === 'dead' || s.state === 'rise') continue;
      if (Math.hypot(s.x - x, s.y - y) < radius) {
        this.kill(s);
        n++;
      }
    }
    return n;
  }

  // Great shadow: returns true when it catches the player.
  updateGiant(dt, time, player, active) {
    const g = this.giant;
    g.mat.uniforms.time.value = time;
    if (active && !g.active) {
      g.active = true;
      g.x = player.x - 23;
      g.speed = 0;
      g.mesh.visible = true;
      this.events.push({ type: 'giantWake' });
    }
    if (!g.active) return false;
    g.k = damp(g.k, active ? 1 : 0, 1.5, dt);
    // rubber-band: always close enough to breathe down your neck
    const gap = player.x - (g.x + 13);
    const target = gap > 14 ? 6.5 : gap > 8 ? 5.0 : gap > 4 ? 4.2 : 3.6;
    g.speed = damp(g.speed, active ? target : -2, 1.5, dt);
    g.x += g.speed * dt;
    g.mat.uniforms.alpha.value = g.k;
    g.mat.uniforms.face.value = 1;
    g.mat.uniforms.burn.value = 0.1;
    g.mesh.position.set(g.x, (groundAt(g.x + 13) ?? player.y) + 6, 1.2);
    g.edge = g.x + 13;
    if (g.k < 0.01 && !active) {
      g.active = false;
      g.mesh.visible = false;
    }
    return active && !player.dead && player.x < g.x + 13.3;
  }
}
