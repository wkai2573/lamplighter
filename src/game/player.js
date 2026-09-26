import { clamp, damp, lerp } from '../util/math.js';
import { groundAt } from '../world/terrain.js';

const RUN = 4.7;
const ACC = 34, DEC = 42, AIR_ACC = 22;
const GRAV = 29, FALL_MUL = 1.45, JUMP_V = 11.2, JUMP_CUT = 0.5, MAX_FALL = 19;
const COYOTE = 0.11, BUFFER = 0.13;
const HW = 0.24, HEIGHT = 1.55, STEP = 0.32;

export const OIL = {
  drain: 1 / 120,     // per second while the lantern is held low
  raiseMul: 3.2,
  flareCost: 0.16,
  firefly: 0.07,
};

export class Player {
  constructor(col) {
    this.col = col;
    this.events = [];
    this.reset(0, 0);
  }

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.face = 1;
    this.onGround = true;
    this.ground = null;
    this.coyote = 0;
    this.buffer = 0;
    this.jumping = false;
    this.jumpT = 1;
    this.dropT = 0;
    this.airT = 0;
    this.fallFrom = y;
    this.landK = 0;
    this.stepPhase = 0;
    this.lastStep = 0;
    this.raised = 0;          // 0..1 smoothed
    this.oil = 1;
    this.flareT = -1;         // time since flare
    this.flareCD = 0;
    this.hurtT = 0;           // invulnerability
    this.knockT = 0;
    this.dead = false;
    this.deathT = 0;
    this.deathKind = null;
    this.wade = 0;
    this.inWater = null;
    this.ctrl = true;         // false during cinematics
    this.speedMul = 1;
    this.moveIntent = 0;
    this.timeInAir = 0;
    this.lanternOut = false;
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  get lightRadius() {
    const base = lerp(3.2, 7.2, Math.sqrt(clamp(this.oil)));
    return this.lanternOut ? 0 : base * (1 + this.raised * 0.6);
  }

  hurt(dir, amount) {
    if (this.hurtT > 0 || this.dead) return false;
    this.oil = Math.max(0, this.oil - amount);
    this.hurtT = 1.3;
    this.knockT = 0.3;
    this.vx = dir * 6.5;
    this.vy = Math.max(this.vy, 5);
    this.onGround = false;
    this.emit('hurt', { dir });
    return true;
  }

  kill(kind) {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.deathKind = kind;
    this.emit('death', { kind });
  }

  update(dt, input, ctx) {
    if (this.dead) {
      this.deathT += dt;
      this.vx = damp(this.vx, 0, 4, dt);
      if (this.deathKind === 'drown') {
        this.vy = damp(this.vy, -0.8, 3, dt);
        this.y += this.vy * dt;
      } else if (this.deathKind === 'fall') {
        this.vy = Math.max(this.vy - GRAV * dt, -MAX_FALL);
        this.y += this.vy * dt;
      }
      this.x += this.vx * dt;
      return;
    }
    const ctrl = this.ctrl && input;
    const axis = ctrl ? input.axis : 0;
    this.moveIntent = axis;
    const raising = ctrl && input.held.raise && this.oil > 0.001 && !this.lanternOut;
    this.raised = damp(this.raised, raising ? 1 : 0, 10, dt);

    // lantern oil
    if (!this.lanternOut && !ctx.noDrain) {
      this.oil -= OIL.drain * (1 + this.raised * (OIL.raiseMul - 1)) * dt;
      if (this.oil <= 0) {
        this.oil = 0;
        this.lanternOut = true;
        this.emit('lanternOut');
      }
    }

    // flare
    this.flareCD -= dt;
    if (this.flareT >= 0) this.flareT += dt;
    if (this.flareT > 1.2) this.flareT = -1;
    if (ctrl && input.consume('flare')) {
      if (this.flareCD <= 0 && this.oil > OIL.flareCost * 0.6 && !this.lanternOut) {
        this.oil = Math.max(0.01, this.oil - OIL.flareCost);
        this.flareT = 0;
        this.flareCD = 1.1;
        this.emit('flare');
      } else this.emit('flareFail');
    }

    // horizontal
    this.hurtT -= dt;
    this.knockT -= dt;
    const water = this.col.water(this.x);
    this.inWater = water && this.y < water.y ? water : null;
    this.wade = this.inWater ? clamp((water.y - this.y) / 0.6) : 0;
    const max = RUN * this.speedMul * (1 - this.raised * 0.28) * (1 - this.wade * 0.35);
    if (this.knockT <= 0) {
      if (axis) {
        this.face = axis;
        const a = this.onGround ? ACC : AIR_ACC;
        const turning = Math.sign(this.vx) !== axis && Math.abs(this.vx) > 0.3;
        this.vx += axis * a * (turning ? 1.6 : 1) * dt;
        if (Math.abs(this.vx) > max) this.vx = Math.sign(this.vx) === axis ? axis * max : this.vx;
      } else {
        const d = (this.onGround ? DEC : AIR_ACC * 0.35) * dt;
        this.vx = Math.abs(this.vx) <= d ? 0 : this.vx - Math.sign(this.vx) * d;
      }
    }
    // wind pushes harder in the air
    if (ctx.windForce) this.vx += ctx.windForce * (this.onGround ? 0.45 : 1) * dt;

    // jump input
    if (ctrl && input.consume('jump')) this.buffer = BUFFER;
    else this.buffer -= dt;
    this.coyote = this.onGround ? COYOTE : this.coyote - dt;
    this.dropT -= dt;
    if (this.buffer > 0 && this.coyote > 0) {
      if (ctrl && input.held.down && this.ground && this.ground.kind === 'platform') {
        this.dropT = 0.28;
        this.onGround = false;
        this.y -= 0.02;
        this.buffer = 0;
      } else {
        this.vy = JUMP_V * (1 - this.wade * 0.25);
        this.onGround = false;
        this.jumping = true;
        this.coyote = 0;
        this.buffer = 0;
        this.fallFrom = this.y;
        this.jumpT = 0;
        this.emit('jump', { surface: this.ground?.surface, wade: this.wade });
      }
    }
    this.jumpT = (this.jumpT ?? 0) + dt;
    // variable height, but a quick tap still clears a fallen log
    if (this.jumping && this.vy > 0 && this.jumpT > 0.085 && !(ctrl && input.held.jump)) {
      this.vy *= JUMP_CUT;
      this.jumping = false;
    }

    // integrate in substeps
    const steps = 3;
    const h = dt / steps;
    const wasGround = this.onGround;
    let landedV = 0;
    for (let s = 0; s < steps; s++) landedV = Math.min(landedV, this.substep(h));
    if (!wasGround && this.onGround) {
      const fall = this.fallFrom - this.y;
      this.landK = clamp(-landedV / 16);
      this.emit('land', { v: -landedV, fall, surface: this.ground?.surface, wade: this.wade });
    }
    if (this.onGround) {
      this.fallFrom = this.y;
      this.timeInAir = 0;
      if (this.ground?.ref?.onStand) this.ground.ref.onStand(dt, this);
    } else {
      this.timeInAir += dt;
      if (this.vy > 0) this.fallFrom = Math.max(this.fallFrom, this.y);
    }
    this.landK = damp(this.landK, 0, 7, dt);

    // footsteps
    if (this.onGround && Math.abs(this.vx) > 0.4) {
      this.stepPhase += Math.abs(this.vx) * dt * 1.25;
      if (this.stepPhase - this.lastStep >= 1) {
        this.lastStep = Math.floor(this.stepPhase);
        this.emit('step', { surface: this.ground?.surface, wade: this.wade, speed: Math.abs(this.vx) });
      }
    }

    // water & falling deaths
    if (water) {
      const deep = groundAt(this.x) === null || groundAt(this.x) < water.y - 0.95;
      if (this.y < water.y && this.prevY >= water.y) this.emit('splash', { v: this.vy, deep });
      if (deep && this.y < water.y - 0.55 && !this.onGround) this.kill('drown');
    }
    if (this.y < -9 && !this.onGround) this.kill('fall');
    this.prevY = this.y;
  }

  substep(h) {
    const col = this.col;
    let landedV = 0;
    // horizontal
    let nx = this.x + this.vx * h;
    const bx = col.blockX(this.x, nx, this.y, HW, HEIGHT, this.onGround ? STEP : 0.12);
    if (bx !== nx) this.vx = 0;
    nx = bx;
    // step onto boardwalks
    if (this.onGround && this.dropT <= 0) {
      const up = col.stepUp(nx - HW, nx + HW, this.y, STEP);
      if (up !== null) this.y = up;
    }
    this.x = nx;

    // vertical
    const g = this.vy > 0 ? GRAV : GRAV * FALL_MUL;
    this.vy = Math.max(this.vy - g * h, -MAX_FALL);
    if (this.inWater) this.vy = Math.max(this.vy, -MAX_FALL * (1 - this.wade * 0.6));
    const ny = this.y + this.vy * h;
    if (this.vy <= 0) {
      const f = col.floor(this.x - HW * 0.75, this.x + HW * 0.75, this.y, ny - (this.onGround ? 0.28 : 0), this.dropT > 0);
      if (f && ny <= f.y + (this.onGround ? 0.28 : 0)) {
        if (!this.onGround) landedV = this.vy;
        this.y = f.y;
        this.vy = 0;
        this.onGround = true;
        this.ground = f;
        this.jumping = false;
      } else {
        this.y = ny;
        this.onGround = false;
        this.ground = null;
      }
    } else {
      const c = col.ceiling(this.x - HW, this.x + HW, this.y + HEIGHT);
      if (ny + HEIGHT > c) {
        this.y = c - HEIGHT;
        this.vy = 0;
        this.emit('bump');
      } else this.y = ny;
      this.onGround = false;
      this.ground = null;
    }
    return landedV;
  }
}
