import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { NOISE } from './glsl.js';

export const MAX_VOL_LIGHTS = 8;

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Analytic single-scattering from point lights in a homogeneous medium:
// ∫ ds / (h² + (s - t0)²) along the view ray up to the scene depth.
// Gives every lamp a physically-shaped glow in the rain and mist, clipped by geometry.
const VolumetricShader = {
  uniforms: {
    tColor: { value: null },
    tDepth: { value: null },
    projInv: { value: new THREE.Matrix4() },
    camWorld: { value: new THREE.Matrix4() },
    lPos: { value: Array.from({ length: MAX_VOL_LIGHTS }, () => new THREE.Vector4()) },
    lCol: { value: Array.from({ length: MAX_VOL_LIGHTS }, () => new THREE.Vector3()) },
    lCount: { value: 0 },
    density: { value: 1 },
    windOff: { value: new THREE.Vector3() },
    moonDir: { value: new THREE.Vector3(0, 0, -1) },
    moonCol: { value: new THREE.Vector3(0, 0, 0) },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor; uniform sampler2D tDepth;
    uniform mat4 projInv; uniform mat4 camWorld;
    uniform vec4 lPos[${MAX_VOL_LIGHTS}]; uniform vec3 lCol[${MAX_VOL_LIGHTS}]; uniform int lCount;
    uniform float density; uniform vec3 windOff; uniform vec3 moonDir; uniform vec3 moonCol;
    varying vec2 vUv;
    ${NOISE}
    void main(){
      vec3 col = texture2D(tColor, vUv).rgb;
      float d = texture2D(tDepth, vUv).x;
      vec4 v = projInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      vec3 vp = v.xyz / v.w;
      float dist = length(vp);
      vec3 dir = vp / dist;
      dist = min(dist, 140.0);
      vec3 sc = vec3(0.0);
      for (int i = 0; i < ${MAX_VOL_LIGHTS}; i++) {
        if (i >= lCount) break;
        vec3 p = lPos[i].xyz;
        float t0 = dot(p, dir);
        float h = max(length(p - dir * t0), 0.06);
        float I = (atan((dist - t0) / h) - atan(-t0 / h)) / h;
        vec3 wp = (camWorld * vec4(dir * clamp(t0, 0.0, dist), 1.0)).xyz;
        float n = 0.45 + 1.1 * vnoise3(wp * 0.55 + windOff) * vnoise3(wp * 0.21 - windOff * 0.6 + 3.1);
        sc += lCol[i] * I * mix(1.0, n, lPos[i].w);
      }
      // faint moon forward-scatter in the mist
      float mu = max(dot(dir, moonDir), 0.0);
      sc += moonCol * pow(mu, 8.0) * (1.0 - exp(-dist * 0.02));
      col += sc * density;
      // safety net: one bad pixel must never let bloom smear NaN/Inf over the frame
      if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
      gl_FragColor = vec4(min(col, vec3(64.0)), 1.0);
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    aspect: { value: 1.77 },
    vignette: { value: 0.55 },
    grain: { value: 0.045 },
    ca: { value: 0.0009 },
    sat: { value: 0.92 },
    contrast: { value: 1.06 },
    lift: { value: new THREE.Vector3(0.012, 0.014, 0.022) },
    gain: { value: new THREE.Vector3(1, 1, 1) },
    flash: { value: 0 },
    flashCol: { value: new THREE.Vector3(0.85, 0.9, 1.0) },
    fade: { value: 0 },
    dark: { value: 0 },
    hurt: { value: 0 },
    bars: { value: 0 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, aspect, vignette, grain, ca, sat, contrast, flash, fade, dark, hurt, bars;
    uniform vec3 lift, gain, flashCol;
    varying vec2 vUv;
    ${NOISE}
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d * vec2(aspect, 1.0), d * vec2(aspect, 1.0));
      vec2 off = d * (ca + hurt * 0.006) * (1.0 + r2 * 3.0);
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, sat);
      c = (c - 0.45) * contrast + 0.45;
      c = c * gain + lift * (1.0 - c);
      c *= 1.0 - vignette * smoothstep(0.12, 1.25, r2 * 1.35);
      // the dark creeping in from the edges (low oil / touched by shadow)
      float wob = (vnoise(vUv * 5.0 + vec2(time * 0.21, -time * 0.17)) - 0.5) * 0.5;
      float edge = smoothstep(1.05 - dark * 0.95, 1.5 - dark * 0.9, r2 * 2.3 + wob * dark);
      c = mix(c, vec3(0.008, 0.006, 0.012), clamp(edge * dark * 1.2, 0.0, 1.0));
      c = mix(c, c * vec3(1.25, 0.55, 0.45), hurt * smoothstep(0.1, 0.7, r2));
      c += (hash12(vUv * 1000.0 + fract(time * 7.13) * 91.0) - 0.5) * grain;
      c = mix(c, flashCol, flash);
      c *= 1.0 - fade;
      if (abs(vUv.y - 0.5) > 0.5 - bars) c = vec3(0.0);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, settings) {
    this.r = renderer;
    this.scene = scene;
    this.camera = camera;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: settings.msaa ? 4 : 0,
    });
    this.rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.rt.depthTexture.type = THREE.UnsignedIntType;

    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType }));
    this.vol = new ShaderPass(VolumetricShader, 'tUnused');
    this.vol.uniforms.tColor.value = this.rt.texture;
    this.vol.uniforms.tDepth.value = this.rt.depthTexture;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.85, 0.72, 0.62);
    this.output = new OutputPass();
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.vol);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.grade);
    this.u = this.grade.uniforms;
    this.v = this.vol.uniforms;
    this._tmp = new THREE.Vector3();
  }

  setSize(w, h) {
    const pr = this.r.getPixelRatio();
    this.rt.setSize(Math.floor(w * pr), Math.floor(h * pr));
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.u.aspect.value = w / h;
  }

  // lights: [{pos: Vector3 (world), color: Vector3 (premultiplied strength), noise: 0..1}]
  setLights(lights) {
    const cam = this.camera;
    const n = Math.min(lights.length, MAX_VOL_LIGHTS);
    for (let i = 0; i < n; i++) {
      const L = lights[i];
      this._tmp.copy(L.pos).applyMatrix4(cam.matrixWorldInverse);
      this.v.lPos.value[i].set(this._tmp.x, this._tmp.y, this._tmp.z, L.noise ?? 1);
      this.v.lCol.value[i].copy(L.color);
    }
    this.v.lCount.value = n;
  }

  render(time) {
    const cam = this.camera;
    this.v.projInv.value.copy(cam.projectionMatrixInverse);
    this.v.camWorld.value.copy(cam.matrixWorld);
    this.u.time.value = time;
    this.r.setRenderTarget(this.rt);
    this.r.render(this.scene, cam);
    this.r.setRenderTarget(null);
    this.composer.render();
  }
}
