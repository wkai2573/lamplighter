import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { rng } from '../util/math.js';
import { terrainHeight, ceilingHeight } from '../world/terrain.js';

// Moonbeams: long soft billboards spun around their own axis to face the camera.
// Forest canopy gaps, the open gorge, and cracks in the cave roof.
export class Shafts {
  constructor(scene) {
    const r = rng(515);
    const defs = [];
    const dir = new THREE.Vector3(0.28, -1, 0.14).normalize();
    // forest
    for (let x = -30; x < 180; x += 14 + r() * 14) {
      const z = -3.5 - r() * 10;
      const ground = terrainHeight(x, z);
      defs.push({ x, y: ground + 13, z, len: 16, w: 1.2 + r() * 1.8, k: 0.6 + r() * 0.5, cave: 0, seed: r() * 10 });
    }
    // gorge: broad beams slanting into the abyss
    for (let x = 410; x < 495; x += 16 + r() * 10) {
      const z = -14 - r() * 16;
      defs.push({ x, y: 22, z, len: 60, w: 5 + r() * 5, k: 0.45 + r() * 0.3, cave: 0, seed: r() * 10 });
    }
    // cave roof cracks
    for (const x of [548, 613, 621, 632, 676]) {
      const z = -1.8 - r() * 1.5;
      const top = ceilingHeight(x, z);
      const ground = terrainHeight(x, z);
      defs.push({ x, y: top + 0.5, z, len: top - ground + 1.5, w: 0.7 + r() * 0.6, k: 0.7, cave: 1, seed: r() * 10 });
    }
    const n = defs.length;
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    quad.setIndex([0, 1, 2, 2, 1, 3]);
    const top = new Float32Array(n * 3), shape = new Float32Array(n * 4);
    defs.forEach((d, i) => {
      top.set([d.x, d.y, d.z], i * 3);
      shape.set([d.len, d.w, d.k, d.cave + d.seed * 0.01], i * 4);
    });
    quad.setAttribute('top', new THREE.InstancedBufferAttribute(top, 3));
    quad.setAttribute('shape', new THREE.InstancedBufferAttribute(shape, 4));
    quad.instanceCount = n;
    this.uniforms = {
      time: { value: 0 },
      dir: { value: dir },
      moonCol: { value: new THREE.Color() },
      outside: { value: 1 },
      inside: { value: 0 },
      fogColor: { value: new THREE.Color() },
      fogDensity: { value: 0.03 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 top; attribute vec4 shape;
        uniform vec3 dir;
        varying vec2 vUv; varying float vK; varying float vCave; varying float vSeed; varying float vDist;
        void main(){
          float len = shape.x, w = shape.y;
          vCave = step(0.5, shape.w);
          vSeed = fract(shape.w) * 100.0;
          vec3 axis = vCave > 0.5 ? vec3(0.05, -1.0, 0.02) : dir;
          vec3 mid = top + axis * len * 0.5;
          vec3 view = normalize(cameraPosition - mid);
          vec3 side = normalize(cross(axis, view));
          // widen a little toward the ground, like light spreading through mist
          float spread = mix(0.7, 1.3, position.y);
          vec3 p = top + axis * len * position.y + side * position.x * w * 0.5 * spread;
          vUv = vec2(position.x, position.y);
          vK = shape.z;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float time, outside, inside, fogDensity;
        uniform vec3 moonCol;
        varying vec2 vUv; varying float vK; varying float vCave; varying float vSeed; varying float vDist;
        ${NOISE}
        void main(){
          float across = clamp(1.0 - abs(vUv.x), 0.0, 1.0);
          float a = pow(across, 1.6);
          a *= smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
          // streaks and drifting dust density
          float streak = 0.55 + 0.45 * vnoise(vec2(vUv.x * 5.0 + vSeed, vUv.y * 1.2 - time * 0.05));
          float cloud = 0.6 + 0.4 * vnoise(vec2(time * 0.12 + vSeed, vSeed));
          a *= streak * cloud * vK;
          float env = mix(outside, inside, vCave);
          vec3 c = mix(moonCol, vec3(0.45, 0.62, 0.85), vCave) * a * env * mix(0.24, 0.14, vCave);
          // near shafts shouldn't wash over the lens
          c *= smoothstep(4.0, 10.0, vDist) * exp(-fogDensity * fogDensity * vDist * vDist * 0.35);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(quad, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    scene.add(this.mesh);
  }

  update(time, atm) {
    const u = this.uniforms;
    u.time.value = time;
    u.moonCol.value.copy(atm.moonCol);
    u.outside.value = atm.moonVis * (1 - atm.storm * 0.55) * (1 - atm.dawn) + atm.flash * 0.6;
    u.inside.value = 0.8;
    u.fogColor.value.copy(atm.fog);
    u.fogDensity.value = atm.fogDensity;
  }
}
