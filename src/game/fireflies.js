import * as THREE from 'three';
import { FIREFLIES } from '../world/level.js';
import { groundAt, terrainHeight } from '../world/terrain.js';
import { rng, noise1, clamp } from '../util/math.js';
import { glowTexture } from '../util/tex.js';

// Collectable fireflies near the path + many decorative ones deeper in the scene.
export class Fireflies {
  constructor(scene) {
    const r = rng(1234);
    this.list = [];
    for (const [x0, x1, n, y0, y1] of FIREFLIES) {
      for (let i = 0; i < n; i++) {
        const x = x0 + (x1 - x0) * r();
        const g = groundAt(x);
        if (g === null) continue;
        this.list.push({
          hx: x, hy: g + y0 + (y1 - y0) * r(), hz: -0.2 + r() * 0.6,
          x, y: 0, z: 0, seed: r() * 100, state: 'free', t: 0, collect: true,
        });
      }
    }
    // decorative swarm (never collected)
    const deco = [[-40, 190, 160], [72, 90, 40], [240, 300, 50], [600, 640, 90], [640, 700, 30], [720, 760, 25]];
    for (const [x0, x1, n] of deco) {
      for (let i = 0; i < n; i++) {
        const x = x0 + (x1 - x0) * r();
        const z = -2.5 - r() * 16;
        const cave = x > 528 && x < 720;
        const zz = cave ? -1.5 - r() * 4 : z;
        const base = terrainHeight(x, zz);
        this.list.push({ hx: x, hy: base + 0.5 + r() * (cave ? 3.5 : 3), hz: zz, x, y: 0, z: 0, seed: r() * 100, state: 'free', t: 0, collect: false });
      }
    }
    const n = this.list.length;
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.size = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.uniforms = { map: { value: glowTexture(64, 0.12) }, uScale: { value: 500 }, color: { value: new THREE.Color(1.6, 1.35, 0.45) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float alpha; attribute float size; uniform float uScale; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / max(-mv.z, 0.1); vA = alpha; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 color; varying float vA;
        void main(){ float m = texture2D(map, gl_PointCoord).a; float core = smoothstep(0.55, 1.0, m); gl_FragColor = vec4((color * m + vec3(1.0) * core * 0.8) * vA, 1.0); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 22;
    scene.add(this.points);
    this.collected = 0;
    this.events = [];
  }

  // returns number collected this frame
  update(dt, time, player, lanternPos, sparks) {
    let got = 0;
    const px = player.x, py = player.y + 1.0;
    for (let i = 0; i < this.n; i++) {
      const f = this.list[i];
      const s = f.seed;
      const i3 = i * 3;
      if (f.state === 'gone') {
        this.alpha[i] = 0;
        continue;
      }
      // lazy wandering
      const wx = f.hx + noise1(time * 0.25 + s) * 1.4;
      const wy = f.hy + noise1(time * 0.31 + s * 1.7) * 0.6;
      const wz = f.hz + noise1(time * 0.2 + s * 2.3) * 0.5;
      if (f.state === 'free') {
        f.x = wx; f.y = wy; f.z = wz;
        if (f.collect && !player.dead && Math.abs(f.x - px) < 1.7 && Math.abs(f.y - py) < 1.9) {
          f.state = 'drawn';
          f.t = 0;
          f.sx = f.x; f.sy = f.y; f.sz = f.z;
        }
      } else if (f.state === 'drawn') {
        f.t += dt * 2.4;
        const k = Math.min(1, f.t);
        const e = k * k * (3 - 2 * k);
        // spiral into the lantern
        const sw = Math.sin(k * Math.PI) * 0.5;
        f.x = f.sx + (lanternPos.x - f.sx) * e + Math.cos(k * 9 + s) * sw;
        f.y = f.sy + (lanternPos.y - f.sy) * e + sw * 0.6;
        f.z = f.sz + (lanternPos.z - f.sz) * e + Math.sin(k * 9 + s) * sw;
        if (k >= 1) {
          f.state = 'gone';
          got++;
          this.collected++;
          this.events.push({ type: 'firefly', x: f.x, y: f.y });
          if (sparks)
            for (let j = 0; j < 10; j++)
              sparks.spawn({ x: f.x, y: f.y, z: f.z, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 1.5, vz: (Math.random() - 0.5) * 2, life: 0.5 + Math.random() * 0.4, size: 0.06, size1: 0.01, color: [1.6, 1.3, 0.5], drag: 2 });
        }
      }
      this.pos[i3] = f.x; this.pos[i3 + 1] = f.y; this.pos[i3 + 2] = f.z;
      // blink: long glow, slow fade
      const b = Math.max(0, Math.sin(time * (0.9 + (s % 1) * 0.8) + s * 7));
      const blink = 0.12 + Math.pow(b, 3) * 0.95;
      this.alpha[i] = (f.collect ? 0.35 + blink * 0.75 : blink * 0.7) * (f.state === 'drawn' ? 1.3 : 1);
      this.size[i] = f.collect ? 0.34 : 0.22;
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.alpha.needsUpdate = a.size.needsUpdate = true;
    return got;
  }

  // nearest collectable within range (for particle lights)
  brightNear(x, range = 12) {
    const out = [];
    for (const f of this.list) if (f.collect && f.state !== 'gone' && Math.abs(f.x - x) < range) out.push(f);
    return out;
  }
}
