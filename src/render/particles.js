import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { glowTexture } from '../util/tex.js';

export const LIGHT_SLOTS = 4;
const lightUniforms = () => ({
  lPos: { value: Array.from({ length: LIGHT_SLOTS }, () => new THREE.Vector3(0, -999, 0)) },
  lCol: { value: Array.from({ length: LIGHT_SLOTS }, () => new THREE.Vector3()) },
});
const LIGHT_GLSL = /* glsl */ `
  uniform vec3 lPos[${LIGHT_SLOTS}]; uniform vec3 lCol[${LIGHT_SLOTS}];
  vec3 lightAt(vec3 p){
    vec3 s = vec3(0.0);
    for (int i = 0; i < ${LIGHT_SLOTS}; i++){ vec3 d = lPos[i] - p; s += lCol[i] / (1.0 + dot(d, d) * 0.9); }
    return s;
  }`;

export function setLightUniforms(u, lights) {
  for (let i = 0; i < LIGHT_SLOTS; i++) {
    const L = lights[i];
    if (L) {
      u.lPos.value[i].copy(L.pos);
      u.lCol.value[i].copy(L.color);
    } else u.lPos.value[i].set(0, -999, 0);
  }
}

// ------------------------------------------------------------------ CPU particles
// Soft round points; `additive` for embers/sparks, normal blending for smoke/splashes/ash.
export class Particles {
  constructor(scene, max = 3000, additive = true) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.a = new Float32Array(max);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.turb = new Float32Array(max);
    this.floor = new Float32Array(max).fill(-1e9);
    this.i = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.uniforms = {
      map: { value: glowTexture(64, additive ? 0.08 : 0.0) },
      uScale: { value: 500 },
      fogColor: { value: new THREE.Color() },
      fogDensity: { value: 0.03 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute float alpha; attribute float size; attribute vec3 color;
        uniform float uScale;
        varying vec3 vCol; varying float vA; varying float vDist;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(-mv.z, 0.1);
          vCol = color; vA = alpha; vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 fogColor; uniform float fogDensity;
        varying vec3 vCol; varying float vA; varying float vDist;
        void main(){
          float m = texture2D(map, gl_PointCoord).a;
          float f = exp(-fogDensity * fogDensity * vDist * vDist);
          ${additive ? 'gl_FragColor = vec4(vCol * m * vA * f, 1.0);' : 'gl_FragColor = vec4(mix(fogColor, vCol, f), m * vA);'}
          if (gl_FragColor.a < 0.003) discard;
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 15;
    scene.add(this.points);
    this.a.fill(0);
    this.age.fill(1);
    this.life.fill(0);
    this.alive = 0;
  }

  spawn(o) {
    const i = this.i;
    this.i = (this.i + 1) % this.max;
    const k3 = i * 3;
    this.pos[k3] = o.x; this.pos[k3 + 1] = o.y; this.pos[k3 + 2] = o.z ?? 0;
    this.vel[k3] = o.vx ?? 0; this.vel[k3 + 1] = o.vy ?? 0; this.vel[k3 + 2] = o.vz ?? 0;
    const c = o.color ?? [1, 1, 1];
    this.col[k3] = c[0]; this.col[k3 + 1] = c[1]; this.col[k3 + 2] = c[2];
    this.life[i] = o.life ?? 1;
    this.age[i] = 0;
    this.s0[i] = o.size ?? 0.1;
    this.s1[i] = o.size1 ?? this.s0[i];
    this.a0[i] = o.alpha ?? 1;
    this.grav[i] = o.grav ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.turb[i] = o.turb ?? 0;
    this.floor[i] = o.floor ?? -1e9;
    this.size[i] = this.s0[i];
    this.a[i] = this.a0[i];
  }

  update(dt, time) {
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) {
        if (this.a[i] !== 0) this.a[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      const k3 = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k3] *= dr; this.vel[k3 + 1] = this.vel[k3 + 1] * dr - this.grav[i] * dt; this.vel[k3 + 2] *= dr;
      if (this.turb[i]) {
        const tb = this.turb[i];
        this.vel[k3] += Math.sin(time * 3.1 + i * 1.7) * tb * dt;
        this.vel[k3 + 1] += Math.cos(time * 2.3 + i * 2.9) * tb * dt;
      }
      this.pos[k3] += this.vel[k3] * dt;
      this.pos[k3 + 1] += this.vel[k3 + 1] * dt;
      this.pos[k3 + 2] += this.vel[k3 + 2] * dt;
      if (this.pos[k3 + 1] < this.floor[i]) {
        this.pos[k3 + 1] = this.floor[i];
        this.vel[k3 + 1] *= -0.3;
        this.vel[k3] *= 0.6;
      }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      // fade in fast, out slow
      this.a[i] = this.a0[i] * Math.min(1, t * 12) * (1 - t) * (1 - t * 0.3);
    }
    const g = this.geo.attributes;
    g.position.needsUpdate = g.color.needsUpdate = g.alpha.needsUpdate = g.size.needsUpdate = true;
  }

  setFog(color, density, scale) {
    this.uniforms.fogColor.value.copy(color);
    this.uniforms.fogDensity.value = density;
    this.uniforms.uScale.value = scale;
  }
}

// ------------------------------------------------------------------ GPU rain
// Streaks computed entirely in the vertex shader, wrapped in a box around the camera.
// Each drop is brightened by nearby lights, so the lantern glitters through the rain.
export class Rain {
  constructor(scene, count = 9000) {
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    quad.setIndex([0, 1, 2, 2, 1, 3]);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    quad.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4));
    quad.instanceCount = count;
    this.count = count;
    this.geo = quad;
    this.uniforms = {
      time: { value: 0 },
      center: { value: new THREE.Vector3() },
      wind: { value: 0 },
      amount: { value: 1 },
      flash: { value: 0 },
      fogColor: { value: new THREE.Color() },
      fogDensity: { value: 0.03 },
      ambient: { value: new THREE.Color(0.02, 0.025, 0.035) },
      ...lightUniforms(),
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float time, wind, amount;
        uniform vec3 center;
        varying float vA; varying vec3 vLit; varying float vDist; varying float vU;
        ${LIGHT_GLSL}
        void main(){
          vec3 box = vec3(56.0, 26.0, 34.0);
          float speed = 16.0 + seed.w * 6.0;
          vec3 vel = vec3(wind * 7.0, -speed, 0.0);
          vec3 p = seed.xyz * box + vel * time;
          vec3 lo = center - box * 0.5;
          p = lo + mod(p - lo, box);
          float len = 0.45 + seed.w * 0.35;
          vec3 dir = normalize(vel);
          vec3 viewDir = normalize(cameraPosition - p);
          vec3 side = normalize(cross(dir, viewDir));
          float w = 0.0065 + seed.w * 0.004;
          vec3 wp = p - dir * len * position.y + side * w * position.x;
          vLit = lightAt(p);
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          vDist = -mv.z;
          vA = step(seed.x * 0.999, amount) * smoothstep(1.5, 5.0, vDist);
          vU = position.x;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 ambient; uniform float flash; uniform vec3 fogColor; uniform float fogDensity;
        varying float vA; varying vec3 vLit; varying float vDist; varying float vU;
        void main(){
          if (vA <= 0.0) discard;
          float edge = 1.0 - abs(vU);
          vec3 c = (ambient + vLit * 0.5 + vec3(0.5, 0.55, 0.65) * flash * 0.25) * edge;
          float f = exp(-fogDensity * fogDensity * vDist * vDist * 0.6);
          gl_FragColor = vec4(c * vA * f, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(quad, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
    scene.add(this.mesh);
  }

  update(time, camera, atm, lights, focus) {
    const u = this.uniforms;
    u.time.value = time;
    u.center.value.set(focus.x, focus.y + 6, -5);
    u.wind.value = atm.windSigned ?? atm.windNow * 0.6;
    u.amount.value = atm.rain;
    u.flash.value = atm.flash;
    u.fogColor.value.copy(atm.fog);
    u.fogDensity.value = atm.fogDensity;
    setLightUniforms(u, lights);
    this.mesh.visible = atm.rain > 0.01;
  }
}

// ------------------------------------------------------------------ floating motes
// Dust / pollen drifting in the air, only visible where a light touches them.
export class Motes {
  constructor(scene, count = 1400) {
    const g = new THREE.BufferGeometry();
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    this.uniforms = {
      time: { value: 0 }, center: { value: new THREE.Vector3() }, uScale: { value: 500 }, wind: { value: 0 },
      map: { value: glowTexture(32, 0.2) }, base: { value: 0.0 },
      ...lightUniforms(),
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float time, uScale, wind; uniform vec3 center;
        varying vec3 vLit; varying float vA;
        ${LIGHT_GLSL}
        void main(){
          vec3 box = vec3(40.0, 12.0, 16.0);
          vec3 p = seed.xyz * box;
          p += vec3(sin(time * 0.3 + seed.w * 40.0) * 0.8 + time * (0.15 + wind * 1.5), sin(time * 0.23 + seed.x * 30.0) * 0.6 - time * 0.05, cos(time * 0.2 + seed.y * 20.0) * 0.6);
          vec3 lo = center - box * 0.5;
          p = lo + mod(p - lo, box);
          vLit = lightAt(p);
          vA = 0.5 + 0.5 * sin(time * (1.0 + seed.w * 2.0) + seed.z * 50.0);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.025 + seed.w * 0.03) * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform float base;
        varying vec3 vLit; varying float vA;
        void main(){
          float m = texture2D(map, gl_PointCoord).a;
          vec3 c = (vLit * 1.6 + base) * m * vA;
          if (max(c.r, max(c.g, c.b)) < 0.002) discard;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 21;
    scene.add(this.points);
  }

  update(time, atm, lights, focus, scale) {
    const u = this.uniforms;
    u.time.value = time;
    u.center.value.set(focus.x, focus.y + 3, -3);
    u.uScale.value = scale;
    u.wind.value = atm.windNow * 0.3;
    setLightUniforms(u, lights);
  }
}

// ------------------------------------------------------------------ ground mist
// Large soft noise billboards hugging the ground, drifting with the wind.
export class Mist {
  constructor(scene, count = 70) {
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
    quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    quad.setIndex([0, 1, 2, 2, 1, 3]);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    quad.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4));
    quad.instanceCount = count;
    this.uniforms = {
      time: { value: 0 }, center: { value: new THREE.Vector3() }, wind: { value: 0 },
      color: { value: new THREE.Color() }, amount: { value: 1 }, ground: { value: 0 },
      ...lightUniforms(),
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float time, wind, ground; uniform vec3 center;
        varying vec2 vUv; varying vec4 vSeed; varying vec3 vLit; varying float vFade;
        ${LIGHT_GLSL}
        void main(){
          vec3 box = vec3(70.0, 1.0, 26.0);
          vec3 p = vec3(seed.x * box.x + time * (0.35 + wind * 2.5), 0.0, seed.z * box.z);
          vec3 lo = vec3(center.x - box.x * 0.5, 0.0, center.z - box.z * 0.5);
          p.xz = lo.xz + mod(p.xz - lo.xz, box.xz);
          p.y = ground + 0.3 + seed.y * 1.6;
          float s = 5.0 + seed.w * 7.0;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(0.0, 1.0, 0.0);
          vec3 wp = p + right * position.x * s + up * position.y * s * 0.45;
          vLit = lightAt(p);
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          // fade near the edges of the box and near the camera
          float ex = abs(p.x - center.x) / (box.x * 0.5);
          vFade = (1.0 - smoothstep(0.7, 1.0, ex)) * smoothstep(3.0, 9.0, -mv.z);
          vUv = uv; vSeed = seed;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float time, amount; uniform vec3 color;
        varying vec2 vUv; varying vec4 vSeed; varying vec3 vLit; varying float vFade;
        ${NOISE}
        void main(){
          vec2 q = vUv - 0.5;
          float r = length(q * vec2(1.0, 1.8));
          float n = fbm(vUv * vec2(2.0, 1.2) + vSeed.xy * 10.0 + vec2(time * 0.03, 0.0));
          float a = smoothstep(0.5, 0.1, r) * smoothstep(0.25, 0.75, n) * vFade * amount * 0.22;
          vec3 c = color + vLit * 0.35;
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.mesh = new THREE.Mesh(quad, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    scene.add(this.mesh);
  }

  update(time, atm, lights, focus, groundY) {
    const u = this.uniforms;
    u.time.value = time;
    u.center.value.set(focus.x, 0, -6);
    u.ground.value = groundY;
    u.wind.value = atm.windNow * 0.4;
    u.color.value.copy(atm.fog).multiplyScalar(1.6);
    u.amount.value = atm.mist;
    setLightUniforms(u, lights);
  }
}
