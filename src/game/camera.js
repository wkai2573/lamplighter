import * as THREE from 'three';
import { cameraKeyAt } from '../world/level.js';
import { clamp, damp, lerp, noise1 } from '../util/math.js';

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.x = 0;
    this.y = 0;
    this.dist = 16.5;
    this.h = 2.3;
    this.ahead = 0;
    this.trauma = 0;
    this.t = 0;
    this.cine = null;    // {pos: Vector3, look: Vector3, k: 0..1}
    this.cineK = 0;
    this.shakeScale = 1;
    this.focus = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    camera.userData.focus = this.focus;
    this.groundY = 0;
  }

  snap(p) {
    // a teleport/respawn must not blend from a stale cinematic framing
    this.cine = null;
    this.lastCine = null;
    this.cineK = 0;
    this.x = p.x + p.face * 2.5;
    this.y = p.y;
    this.groundY = p.y;
    this.safeY = p.y;
    const k = cameraKeyAt(p.x);
    this.dist = k[1];
    this.h = k[2];
    this.ahead = p.face * k[3];
  }

  addTrauma(v) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  update(dt, p, extra = {}) {
    this.t += dt;
    const k = cameraKeyAt(p.x);
    this.dist = damp(this.dist, k[1] + (extra.zoom || 0), 1.2, dt);
    this.h = damp(this.h, k[2], 1.2, dt);
    // look-ahead follows intent, eases slowly when turning
    const lead = (p.face * k[3] + clamp(p.vx * 0.25, -1.2, 1.2)) * (extra.aheadMul ?? 1) + (extra.shift ?? 0);
    this.ahead = damp(this.ahead, lead, 1.6, dt);
    this.x = damp(this.x, p.x + this.ahead, 4.5, dt);
    // vertical: follow the ground level, not every jump; never chase a fall into a pit or the water
    if (p.onGround) this.safeY = p.y;
    if (!p.dead) {
      if (p.onGround || p.y < this.groundY - 0.8) this.groundY = Math.max(p.y, (this.safeY ?? p.y) - 2.5);
      if (p.y > this.groundY + 3.5) this.groundY = p.y - 3.5;
    }
    this.y = damp(this.y, this.groundY, p.y < this.y - 1 ? 5 : 2.4, dt);

    const cam = this.cam;
    let px = this.x, py = this.y + this.h + 1.1, pz = this.dist;
    let lx = this.x, ly = this.y + 1.55, lz = 0;
    // cinematic blend
    this.cineK = damp(this.cineK, this.cine ? 1 : 0, this.cine?.rate ?? 1.2, dt);
    if (this.cineK > 0.001 && (this.cine || this.lastCine)) {
      const c = this.cine || this.lastCine;
      if (this.cine) this.lastCine = this.cine;
      const e = this.cineK * this.cineK * (3 - 2 * this.cineK);
      px = lerp(px, c.pos.x, e); py = lerp(py, c.pos.y, e); pz = lerp(pz, c.pos.z, e);
      lx = lerp(lx, c.look.x, e); ly = lerp(ly, c.look.y, e); lz = lerp(lz, c.look.z, e);
    }
    // handheld drift + trauma shake
    this.trauma = Math.max(0, this.trauma - dt * 0.9);
    const s = this.trauma * this.trauma * this.shakeScale;
    const t = this.t;
    px += noise1(t * 0.31) * 0.08 + noise1(t * 23 + 1) * s * 0.45;
    py += noise1(t * 0.27 + 5) * 0.06 + noise1(t * 21 + 7) * s * 0.35;
    lx += noise1(t * 19 + 11) * s * 0.2;
    ly += noise1(t * 17 + 13) * s * 0.2;
    cam.position.set(px, py, pz);
    this.lookAt.set(lx, ly, lz);
    cam.lookAt(this.lookAt);
    cam.rotation.z += noise1(t * 15 + 3) * s * 0.02;
    cam.updateMatrixWorld();
    this.focus.set(lx, ly - 1, 0);
  }
}
