import * as THREE from 'three';
import { NOISE } from './glsl.js';

// Sky dome: gradient, stars, moon with halo, drifting storm clouds lit by the moon
// and by lightning, and a dawn state for the finale.
export class Sky {
  constructor(scene) {
    this.uniforms = {
      time: { value: 0 },
      moonDir: { value: new THREE.Vector3(-0.24, 0.1, -0.97).normalize() },
      sunDir: { value: new THREE.Vector3(0.42, 0.035, -0.9).normalize() },
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      cloudCol: { value: new THREE.Color() },
      storm: { value: 0.5 },
      flash: { value: 0 },
      flashDir: { value: new THREE.Vector3(0.2, 0.3, -1).normalize() },
      dawn: { value: 0 },
      moonAmt: { value: 1 },
      wind: { value: 0.02 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform float time, storm, flash, dawn, moonAmt, wind;
        uniform vec3 moonDir, sunDir, flashDir;
        uniform vec3 zenith, horizon, cloudCol;
        varying vec3 vDir;
        ${NOISE}
        void main(){
          vec3 d = normalize(vDir);
          float up = clamp(d.y, -0.2, 1.0);
          vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.55, up));

          // dawn gradient
          vec3 dawnHor = vec3(0.78, 0.42, 0.27);
          vec3 dawnMid = vec3(0.34, 0.28, 0.4);
          vec3 dawnTop = vec3(0.09, 0.15, 0.3);
          vec3 dc = mix(dawnHor, dawnMid, smoothstep(0.0, 0.18, up));
          dc = mix(dc, dawnTop, smoothstep(0.15, 0.7, up));
          float sunMu = max(dot(d, sunDir), 0.0);
          dc += vec3(1.6, 0.8, 0.35) * (pow(sunMu, 14.0) * 0.4 + pow(sunMu, 200.0) * 0.8) + vec3(4.0, 2.4, 1.2) * smoothstep(0.9993, 0.9997, sunMu);
          col = mix(col, dc, dawn);

          // stars
          vec3 sd = d * 300.0;
          vec3 id = floor(sd);
          float h = hash13(id);
          vec3 f = fract(sd) - 0.5;
          float tw = 0.6 + 0.4 * sin(time * (1.0 + h * 3.0) + h * 40.0);
          float star = step(0.9965, h) * smoothstep(0.35, 0.0, length(f)) * tw * smoothstep(0.02, 0.25, up);
          star *= (1.0 - storm * 0.85) * (1.0 - dawn);

          // moon
          float mu = dot(d, moonDir);
          float disc = smoothstep(0.99955, 0.99968, mu);
          float crater = vnoise(d.xy * 900.0) * 0.25 + vnoise(d.xy * 300.0) * 0.2;
          vec3 moon = vec3(1.0, 0.97, 0.9) * disc * (1.6 - crater) * 0.75;
          vec3 halo = vec3(0.55, 0.65, 0.85) * (pow(max(mu, 0.0), 900.0) * 0.6 + pow(max(mu, 0.0), 60.0) * 0.06 + pow(max(mu, 0.0), 8.0) * 0.02);

          // clouds
          vec2 cuv = d.xz / (d.y + 0.18) * 1.2;
          cuv.x += time * wind;
          float c1 = fbm(cuv * 1.3 + vec2(0.0, time * wind * 0.3));
          float c2 = fbm(cuv * 3.1 - vec2(time * wind * 1.7, 0.0));
          float cov = mix(0.62, 0.34, storm);
          float cl = smoothstep(cov, cov + 0.28, c1 * 0.75 + c2 * 0.35);
          cl *= smoothstep(-0.12, 0.12, d.y);
          float edge = smoothstep(cov, cov + 0.1, c1 * 0.75 + c2 * 0.35) - cl;
          vec3 cc = cloudCol * (0.55 + 0.45 * c2);
          cc += vec3(0.7, 0.78, 0.95) * pow(max(mu, 0.0), 12.0) * (0.4 + edge * 2.0) * moonAmt * (1.0 - dawn);
          // lightning lights up the cloud deck from inside
          float fm = max(dot(d, flashDir), 0.0);
          cc += vec3(0.8, 0.85, 1.0) * flash * (0.35 + 1.6 * pow(fm, 5.0)) * (0.4 + c2);
          vec3 dawnCloud = mix(vec3(0.5, 0.32, 0.3), vec3(1.0, 0.62, 0.4), pow(sunMu, 6.0)) * (0.5 + 0.5 * c2);
          cc = mix(cc, dawnCloud, dawn);

          col += (star + moon * moonAmt * (1.0 - dawn)) * (1.0 - cl) + halo * moonAmt * (1.0 - cl * 0.7) * (1.0 - dawn);
          col = mix(col, cc, cl * mix(0.92, 0.75, dawn));
          col += vec3(0.6, 0.65, 0.8) * flash * 0.25 * smoothstep(0.4, 0.0, up);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }

  update(time, camera, atm) {
    const u = this.uniforms;
    this.mesh.position.copy(camera.position);
    u.time.value = time;
    u.zenith.value.copy(atm.zenith);
    u.horizon.value.copy(atm.horizon);
    u.cloudCol.value.copy(atm.cloud);
    u.storm.value = atm.storm;
    u.flash.value = atm.flash;
    u.dawn.value = atm.dawn;
    u.moonAmt.value = atm.moonVis;
    u.wind.value = 0.004 + atm.wind * 0.012;
  }
}

// Distant mountain ridges: huge vertical cards whose ridge line is generated in the shader.
// Real depth gives natural parallax; each layer blends toward the horizon colour.
export class Mountains {
  constructor(scene) {
    this.layers = [];
    const defs = [
      { z: -900, amp: 95, base: -4, freq: 0.0042, haze: 0.84, seed: 3.1, top: 100 },
      { z: -520, amp: 48, base: -10, freq: 0.0075, haze: 0.7, seed: 7.7, top: 50 },
      { z: -260, amp: 24, base: -10, freq: 0.013, haze: 0.56, seed: 13.3, top: 26 },
      { z: -150, amp: 13, base: -8, freq: 0.022, haze: 0.44, seed: 21.9, top: 14 },
    ];
    for (const d of defs) {
      const u = {
        time: { value: 0 },
        amp: { value: d.amp },
        base: { value: d.base },
        freq: { value: d.freq },
        haze: { value: d.haze },
        seed: { value: d.seed },
        horizon: { value: new THREE.Color() },
        fogc: { value: new THREE.Color() },
        dark: { value: new THREE.Color() },
        rim: { value: new THREE.Color() },
        flash: { value: 0 },
        dawn: { value: 0 },
        seaFrom: { value: 700 },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */ `
          varying vec3 vW;
          void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform float amp, base, freq, haze, seed, flash, dawn, seaFrom;
          uniform vec3 horizon, dark, rim, fogc;
          varying vec3 vW;
          ${NOISE}
          float ridge(float x){
            float n = 0.0, a = 0.55, f = freq;
            for (int i = 0; i < 6; i++){ n += (1.0 - abs(vnoise(vec2(x * f, seed)) * 2.0 - 1.0)) * a; a *= 0.48; f *= 2.1; }
            // the land falls away toward the sea at the far end of the journey
            float sea = smoothstep(seaFrom, seaFrom + 380.0, x);
            return base + n * amp * (1.0 - sea * 0.85) - sea * amp * 0.35;
          }
          void main(){
            float h = ridge(vW.x);
            float dy = h - vW.y;
            if (dy < 0.0) discard;
            float a = smoothstep(0.0, 0.8, dy);
            // gentle vertical fog: bases of mountains sink into mist
            float mist = smoothstep(h - amp * 0.9, h, vW.y);
            vec3 c = mix(horizon, dark, (1.0 - haze) * (0.35 + 0.65 * mist));
            c = mix(mix(fogc, horizon, 0.35), c, 0.25 + 0.75 * mist);
            c += rim * smoothstep(3.0, 0.0, dy) * (1.0 - haze) * 0.35;
            c += vec3(0.5, 0.55, 0.7) * flash * (1.0 - haze) * 0.35;
            c = mix(c, mix(c, horizon * vec3(1.1, 0.95, 1.05), 0.4), dawn);
            gl_FragColor = vec4(c, a);
          }`,
      });
      const geo = new THREE.PlaneGeometry(9000, d.top + 400, 1, 1);
      geo.translate(0, (d.top + 400) / 2 - 300, 0);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(450, 0, d.z);
      m.renderOrder = -9;
      m.frustumCulled = false;
      scene.add(m);
      this.layers.push({ m, u, d });
    }
  }

  update(time, atm) {
    for (const L of this.layers) {
      L.u.horizon.value.copy(atm.horizon);
      L.u.fogc.value.copy(atm.fog);
      L.u.dark.value.copy(atm.ridge);
      L.u.rim.value.copy(atm.rim);
      L.u.flash.value = atm.flash;
      L.u.dawn.value = atm.dawn;
      L.m.visible = atm.cave < 0.98;
    }
  }
}
