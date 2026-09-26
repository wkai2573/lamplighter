import * as THREE from 'three';
import { Post } from './post.js';
import { Sky, Mountains } from './backdrop.js';

export const QUALITY = {
  high: { scale: 1.0, maxDpr: 1.5, msaa: true, shadow: 2048, lanternShadow: 1024, bloom: true, reflections: 0.5 },
  medium: { scale: 0.85, maxDpr: 1.25, msaa: false, shadow: 1024, lanternShadow: 512, bloom: true, reflections: 0.35 },
  low: { scale: 0.7, maxDpr: 1.0, msaa: false, shadow: 1024, lanternShadow: 256, bloom: false, reflections: 0.25 },
};

export class Engine {
  constructor(container, quality = 'high') {
    this.qualityName = quality;
    this.q = QUALITY[quality];
    const r = (this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    }));
    r.setPixelRatio(Math.min(devicePixelRatio, this.q.maxDpr) * this.q.scale);
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    container.appendChild(r.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.FogExp2(0x0f151e, 0.03);

    const cam = (this.camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 3200));
    cam.position.set(0, 3, 17);

    // Moonlight (becomes the sun at dawn). Its shadow frustum follows the camera.
    const moon = (this.moon = new THREE.DirectionalLight(0x8ea6d0, 0.9));
    moon.castShadow = true;
    moon.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    Object.assign(moon.shadow.camera, { left: -26, right: 26, top: 16, bottom: -12, near: 1, far: 120 });
    moon.shadow.bias = -0.0008;
    moon.shadow.normalBias = 0.03;
    moon.shadow.radius = 3;
    moon.shadow.camera.updateProjectionMatrix();
    scene.add(moon, moon.target);
    // Directions *toward* the light. The moon sits behind the scene so everything is rim-lit
    // and shadows stretch toward the viewer.
    this.moonDir = new THREE.Vector3(-0.3, 0.5, -0.81).normalize();
    this.sunDir = new THREE.Vector3(0.62, 0.32, -0.72).normalize();

    this.hemi = new THREE.HemisphereLight(0x34435e, 0x0c0e11, 0.55);
    scene.add(this.hemi);

    this.sky = new Sky(scene);
    this.mountains = new Mountains(scene);
    this.post = new Post(r, scene, cam, this.q);
    this.post.bloom.enabled = this.q.bloom;

    this.shake = { trauma: 0, t: 0 };
    this._v = new THREE.Vector3();
    this._resize = () => this.resize();
    addEventListener('resize', this._resize);
    this.resize();
  }

  setQuality(name) {
    this.qualityName = name;
    this.q = QUALITY[name];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.q.maxDpr) * this.q.scale);
    this.moon.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    this.moon.shadow.map?.dispose();
    this.moon.shadow.map = null;
    this.post.rt.samples = this.q.msaa ? 4 : 0;
    this.post.bloom.enabled = this.q.bloom;
    this.onQuality?.(this.q);
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
    this.onResize?.(w, h);
  }

  // Apply the current atmosphere to lights, fog, sky and grading.
  applyAtmosphere(atm, time) {
    const s = this.scene;
    s.fog.color.copy(atm.fog);
    s.fog.density = atm.fogDensity;
    const dawn = atm.dawn;
    const dir = this._v.copy(this.moonDir).lerp(this.sunDir, dawn).normalize();
    const focus = this.camera.userData.focus || this.camera.position;
    this.moon.position.copy(focus).addScaledVector(dir, 60);
    this.moon.target.position.copy(focus);
    this.moon.color.copy(atm.moonCol);
    this.moon.intensity = atm.moon * (1 + atm.flash * 5.5);
    this.moon.castShadow = atm.moon > 0.02 || atm.flash > 0.01;
    this.hemi.intensity = atm.hemi * (1 + atm.flash * 2.5);
    this.hemi.color.copy(atm.hemiSky);
    this.hemi.groundColor.copy(atm.hemiGround);
    this.renderer.toneMappingExposure = atm.exposure;
    this.sky.update(time, this.camera, atm);
    this.mountains.update(time, atm);
    const v = this.post.v;
    v.density.value = atm.vol;
    v.moonDir.value.copy(this.sky.uniforms.moonDir.value).transformDirection(this.camera.matrixWorldInverse);
    v.moonCol.value.set(atm.moonCol.r, atm.moonCol.g, atm.moonCol.b).multiplyScalar(0.005 * atm.moonVis * (1 - atm.cave) + 0.012 * dawn);
    const g = this.post.u;
    g.flash.value = atm.flash * 0.08;
  }

  addTrauma(t) {
    this.shake.trauma = Math.min(1, this.shake.trauma + t);
  }

  render(time) {
    this.post.render(time);
  }
}
