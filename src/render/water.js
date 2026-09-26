import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { NOISE } from './glsl.js';

const WaterShader = {
  name: 'LampWater',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    time: { value: 0 },
    rain: { value: 0 },
    waveAmp: { value: 0.05 },
    waveScale: { value: 1 },
    deep: { value: new THREE.Color('#05080b') },
    fogColor: { value: new THREE.Color() },
    fogDensity: { value: 0.03 },
    camPos: { value: new THREE.Vector3() },
    lPos: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    lCol: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    flash: { value: 0 },
    reflStrength: { value: 0.7 },
    moonDir: { value: new THREE.Vector3(-0.24, 0.1, -0.97) },
    moonCol: { value: new THREE.Vector3() },
    glint: { value: 0.12 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    uniform float time, waveAmp, waveScale;
    varying vec4 vUv4;
    varying vec3 vWorld;
    void main(){
      vec3 p = position;
      vUv4 = textureMatrix * vec4(p, 1.0);
      vec4 w = modelMatrix * vec4(p, 1.0);
      // slow swell for the open sea
      w.y += (sin(w.x * 0.08 * waveScale + time * 0.9) * 0.6 + sin(w.z * 0.11 * waveScale - time * 0.7) * 0.4) * waveAmp * 10.0;
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, rain, fogDensity, flash, waveAmp, waveScale, reflStrength, glint;
    uniform vec3 deep, fogColor, camPos, moonDir, moonCol;
    uniform vec3 lPos[4]; uniform vec3 lCol[4];
    varying vec4 vUv4;
    varying vec3 vWorld;
    ${NOISE}
    // expanding rain rings
    vec2 rings(vec2 p, float t){
      vec2 g = vec2(0.0);
      for (int l = 0; l < 3; l++){
        float sc = 1.6 + float(l) * 0.9;
        vec2 q = p * sc + float(l) * 17.3;
        vec2 id = floor(q);
        vec2 f = fract(q) - 0.5;
        vec2 h = hash22(id + float(l) * 3.1);
        float ph = fract(t * (0.9 + h.x * 0.6) + h.y);
        vec2 o = (h - 0.5) * 0.6;
        vec2 d = f - o;
        float r = length(d);
        float R = ph * 0.45;
        float w = sin((r - R) * 55.0) * exp(-abs(r - R) * 22.0) * (1.0 - ph) * (1.0 - ph);
        g += normalize(d + 1e-4) * w;
      }
      return g * 0.08;
    }
    void main(){
      vec2 p = vWorld.xz;
      float t = time;
      // gentle wind waves from noise gradients
      float e = 0.15;
      float n0 = fbm(p * 0.35 * waveScale + vec2(t * 0.12, t * 0.05));
      float nx = fbm((p + vec2(e, 0.0)) * 0.35 * waveScale + vec2(t * 0.12, t * 0.05));
      float nz = fbm((p + vec2(0.0, e)) * 0.35 * waveScale + vec2(t * 0.12, t * 0.05));
      vec2 grad = vec2(nx - n0, nz - n0) / e * (waveAmp * 6.0 + 0.04);
      grad += rings(p, t) * rain;
      vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
      vec3 V = normalize(camPos - vWorld);
      float cosv = clamp(dot(N, V), 0.0, 1.0);
      float fres = 0.03 + 0.97 * pow(1.0 - cosv, 4.0);
      vec4 uv = vUv4;
      uv.xy += grad * 1.4 * uv.w;
      vec3 refl = texture2DProj(tDiffuse, uv).rgb * reflStrength;
      vec3 col = mix(deep, refl, clamp(fres * 1.15 + 0.25, 0.0, 1.0));
      // glints from nearby lights
      for (int i = 0; i < 4; i++){
        vec3 L = lPos[i] - vWorld;
        float d2 = dot(L, L);
        L = normalize(L);
        vec3 H = normalize(L + V);
        float s = pow(max(dot(N, H), 0.0), 160.0) * 3.0 + pow(max(dot(N, H), 0.0), 18.0) * 0.08;
        col += lCol[i] * s / (1.0 + d2 * 0.15);
      }
      col += vec3(0.6, 0.65, 0.8) * flash * 0.2 * fres;
      float d = length(camPos - vWorld);
      float f = 1.0 - exp(-fogDensity * fogDensity * d * d);
      // moon path: glitter on the wave facets, survives the haze a little longer
      vec3 Hm = normalize(normalize(moonDir) + V);
      float mh = max(dot(N, Hm), 0.0);
      vec3 glit = moonCol * (pow(mh, 260.0) * 9.0 + pow(mh, 40.0) * 0.12) * glint;
      col = mix(col, fogColor, f);
      col += glit * (1.0 - f * 0.75);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export class Water {
  constructor(scene, { x0, x1, z0, z1, y, res = 0.5, waveAmp = 0.0, waveScale = 1, deep = '#05080b', segments = 1, glint = 0.12 }) {
    const w = x1 - x0, d = z1 - z0;
    const geo = new THREE.PlaneGeometry(w, d, segments, segments);
    const scale = res;
    this.mesh = new Reflector(geo, {
      textureWidth: Math.floor(innerWidth * scale),
      textureHeight: Math.floor(innerHeight * scale),
      clipBias: 0.003,
      shader: WaterShader,
      multisample: 0,
    });
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    this.mesh.renderOrder = 1;
    this.u = this.mesh.material.uniforms;
    this.u.waveAmp.value = waveAmp;
    this.u.waveScale.value = waveScale;
    this.u.glint.value = glint;
    this.u.deep.value = new THREE.Color(deep);
    this.u.fogColor.value = new THREE.Color();
    this.u.camPos.value = new THREE.Vector3();
    this.u.lPos.value = [0, 1, 2, 3].map(() => new THREE.Vector3(0, -999, 0));
    this.u.lCol.value = [0, 1, 2, 3].map(() => new THREE.Vector3());
    this.scale = scale;
    this.x0 = x0;
    this.x1 = x1;
    this.y = y;
    scene.add(this.mesh);
  }

  resize(w, h, scale = this.scale) {
    this.scale = scale;
    this.mesh.getRenderTarget().setSize(Math.floor(w * scale), Math.floor(h * scale));
  }

  update(time, camera, atm, lights) {
    const u = this.u;
    u.time.value = time;
    u.rain.value = atm.rain;
    u.fogColor.value.copy(atm.fog);
    u.fogDensity.value = atm.fogDensity;
    u.camPos.value.copy(camera.position);
    u.flash.value = atm.flash;
    const mk = atm.moonVis * (1 - atm.cave) * (1 - atm.dawn * 0.6) + atm.dawn * 2.5;
    u.moonCol.value.set(atm.moonCol.r, atm.moonCol.g, atm.moonCol.b).multiplyScalar(mk);
    if (atm.dawn > 0.01) u.moonDir.value.set(-0.24, 0.1, -0.97).lerp(new THREE.Vector3(0.42, 0.06, -0.9), atm.dawn);
    for (let i = 0; i < 4; i++) {
      const L = lights[i];
      if (L) {
        u.lPos.value[i].copy(L.pos);
        u.lCol.value[i].copy(L.color);
      } else u.lPos.value[i].set(0, -999, 0);
    }
  }
}
