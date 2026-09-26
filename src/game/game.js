import * as THREE from 'three';
import { Atmosphere } from '../world/atmosphere.js';
import { buildTerrain, groundAt, caveCurtain } from '../world/terrain.js';
import { buildFlora } from '../world/flora.js';
import { buildStructures, buildBridge, buildCrystals, buildCaveDecor, buildLighthouse } from '../world/structures.js';
import { NARRATION, HINTS, CHAPTERS, WATER, BEACONS, CHASE, LIGHTHOUSE, zoneAt } from '../world/level.js';
import { GLOBAL } from '../render/materials.js';
import { Particles, Rain, Motes, Mist } from '../render/particles.js';
import { Water } from '../render/water.js';
import { Shafts } from '../render/shafts.js';
import { Input } from './input.js';
import { Collision } from './collision.js';
import { Player, OIL } from './player.js';
import { Character } from './character.js';
import { CameraRig } from './camera.js';
import { Weather } from './weather.js';
import { Fireflies } from './fireflies.js';
import { Shadows } from './shadows.js';
import { keyLabel } from '../ui/ui.js';
import { clamp, damp, lerp, smoothstep } from '../util/math.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const LANTERN_COL = V3(1, 0.62, 0.3);
const FIRE_COL = new THREE.Color(1, 0.55, 0.22);

export class Game {
  constructor(engine, ui, audio, params) {
    this.engine = engine;
    this.ui = ui;
    this.audio = audio;
    this.params = params;
    this.scene = engine.scene;
    this.state = 'loading';
    this.time = 0;
    this.stats = { time: 0, deaths: 0, fireflies: 0 };
    this.debug = params.has('debug');
  }

  async build(progress) {
    const scene = this.scene;
    const step = async (k, msg) => {
      progress(k, msg);
      await new Promise((r) => setTimeout(r, 16));
    };
    this.atm = new Atmosphere();
    await step(0.1, '整理山路……');
    buildTerrain(scene);
    await step(0.3, '種下松林……');
    buildFlora(scene);
    await step(0.5, '搭起木橋……');
    this.input = new Input();
    this.col = new Collision();
    const st = buildStructures(scene, this.col);
    this.beacons = st.beacons;
    this.bridge = buildBridge(scene, this.col);
    this.crystals = buildCrystals(scene, this.col);
    buildCaveDecor(scene);
    this.lighthouse = buildLighthouse(scene);
    await step(0.65, '引來潮水……');
    const q = this.engine.q;
    this.waters = WATER.map((w) => new Water(scene, {
      x0: w.x0 - 1, x1: w.x1 + 1, z0: w.kind === 'pool' ? -7 : -70, z1: 16, y: w.y, res: q.reflections,
      deep: w.kind === 'pool' ? '#03070a' : '#05080b',
    }));
    this.sea = new Water(scene, { x0: 640, x1: 1500, z0: -1100, z1: 60, y: -18, res: q.reflections, waveAmp: 0.12, waveScale: 0.25, deep: '#04080c', segments: 120, glint: 1 });
    this.waters.push(this.sea);
    this.engine.onResize = (w, h) => this.waters.forEach((wt) => wt.resize(w, h));
    this.engine.onQuality = (qq) => this.waters.forEach((wt) => wt.resize(innerWidth, innerHeight, qq.reflections));

    await step(0.75, '喚醒螢火……');
    this.player = new Player(this.col);
    this.hero = new Character(scene);
    this.rig = new CameraRig(this.engine.camera);
    this.weather = new Weather();
    this.fireflies = new Fireflies(scene);
    this.shadows = new Shadows(scene);
    this.sparks = new Particles(scene, 2500, true);
    this.smoke = new Particles(scene, 1500, false);
    this.rain = new Rain(scene, 9000);
    this.motes = new Motes(scene, 1400);
    this.mist = new Mist(scene, 70);
    this.shafts = new Shafts(scene);

    // lights: the lantern (the only shadow caster besides the moon), a pool for fires, the flare
    const L = (this.lantern = new THREE.PointLight(0xffb46b, 0, 16, 1.35));
    L.castShadow = true;
    L.shadow.mapSize.set(q.lanternShadow, q.lanternShadow);
    L.shadow.bias = -0.003;
    L.shadow.normalBias = 0.03;
    L.shadow.radius = 5;
    L.shadow.camera.near = 0.06;
    scene.add(L);
    this.pool = [];
    for (let i = 0; i < 4; i++) {
      const p = new THREE.PointLight(FIRE_COL, 0, 18, 1.5);
      scene.add(p);
      this.pool.push(p);
    }
    this.flareLight = new THREE.PointLight(0xffd9a0, 0, 16, 1.2);
    scene.add(this.flareLight);
    this.flareK = 0;

    await step(0.9, '點燃燈芯……');
    this.resetProgress();
    this.placePlayer(this.params.has('x') ? parseFloat(this.params.get('x')) : -1.2);
    // warm up every shader & render target so the journey never hitches:
    // compile, then render one frame in each distinct place (water, cave, sea, crystals...)
    this.update(0.016);
    try {
      await this.engine.renderer.compileAsync(scene, this.engine.camera);
    } catch {}
    const spots = [80, 230, 262, 430, 575, 620, 700, 760, 891];
    for (const [i, x] of spots.entries()) {
      this.placePlayer(x);
      this.update(0.016);
      this.render();
      await step(0.9 + (i / spots.length) * 0.1, '準備旅程……');
    }
    this.resetProgress();
    this.placePlayer(-1.2);
    this.update(0.016);
    this.fireflies.events.length = 0;
    await step(1, '');
  }

  // ---------------------------------------------------------------- progress & save
  resetProgress() {
    this.checkpoint = -1;
    this.done = { narr: new Set(), hints: new Set(), chapters: new Set() };
    this.chase = { active: false, done: false };
    this.ending = null;
    this.lighting = null;
    this.deathT = -1;
    this.stats = { time: 0, deaths: 0, fireflies: 0 };
    for (const b of this.beacons) this.setBeaconLit(b, false, true);
    this.shadows.reset(-1e9);
    this.bridge.reset();
    for (const f of this.fireflies.list) if (f.collect) f.state = 'free';
    this.fireflies.collected = 0;
    this.atm.override = null;
    this.atm.overrideK = 0;
    this.lighthouseLit = 0;
    this.lighthouse.beamPivot.visible = false;
    this.lighthouse.lampMat.color.setRGB(0, 0, 0);
    this.lighthouse.glassMat.emissiveIntensity = 0;
    this.brazierLit = 0;
    this.shadows.giant.mat.uniforms.dissolve.value = 0;
  }

  save() {
    try {
      localStorage.setItem('lamplighter.save', JSON.stringify({ checkpoint: this.checkpoint, stats: this.stats, fireflies: this.fireflies.collected }));
    } catch {}
  }

  static loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem('lamplighter.save') || 'null');
      return s && s.checkpoint >= 0 ? s : null;
    } catch {
      return null;
    }
  }

  clearSave() {
    try {
      localStorage.removeItem('lamplighter.save');
    } catch {}
  }

  applySave(s) {
    this.checkpoint = s.checkpoint;
    this.stats = { ...this.stats, ...s.stats };
    for (let i = 0; i <= s.checkpoint; i++) this.setBeaconLit(this.beacons[i], true, true);
    const cx = this.beacons[s.checkpoint].x;
    for (const f of this.fireflies.list) if (f.collect && f.hx < cx) f.state = 'gone';
    this.fireflies.collected = s.fireflies || 0;
    for (const n of NARRATION) if (n.x < cx + 2) this.done.narr.add(n);
    for (const hh of HINTS) if (hh.x1 < cx) this.done.hints.add(hh);
    for (const c of CHAPTERS) if (c.x < cx) this.done.chapters.add(c);
    this.placePlayer(cx + 1.3);
  }

  placePlayer(x) {
    const p = this.player;
    const f = this.col.floor(x - 0.2, x + 0.2, 60, -60, false);
    p.reset(x, f ? f.y : groundAt(x) ?? 0);
    this.deathT = -1;
    this.fade = 0;
    this.ui.death(false);
    p.face = 1;
    this.hero.update(0.016, p, this.heroCtx(0));
    this.hero.snapScarf();
    this.rig.snap(p);
    this.atm.update(1, x, true);
  }

  setBeaconLit(b, lit, instant = false) {
    b.lit = lit;
    if (instant) b.k = lit ? 1 : 0;
  }

  // ---------------------------------------------------------------- flow
  startNew() {
    this.clearSave();
    this.resetProgress();
    this.placePlayer(-1.2);
    this.state = 'intro';
    this.introT = 0;
    this.player.lanternOut = true;
    this.player.ctrl = false;
    this.player.oil = 1;
    this.audio.music.setMood('silent');
  }

  continueFrom(save) {
    this.resetProgress();
    this.applySave(save);
    this.state = 'play';
    this.player.ctrl = true;
    this.player.lanternOut = false;
    this.ui.showHud(true);
    this.fade = 1;
  }

  toTitle() {
    this.resetProgress();
    this.placePlayer(-1.2);
    this.player.lanternOut = true;
    this.player.ctrl = false;
    this.state = 'title';
    this.ui.showHud(false);
    this.ui.hideEndingText();
    this.ui.clearNarration();
    this.audio.music.setMood('title');
    this.fade = 1;
  }

  // ---------------------------------------------------------------- per-frame
  heroCtx(t) {
    const p = this.player;
    let pose = null;
    if (this.state === 'title' || (this.state === 'intro' && this.introT < 2.4)) pose = 'sit';
    if (this.lighting || (this.ending && this.ending.t < 3)) pose = 'light';
    return {
      time: t, wind: (this.atm?.windSigned ?? 0) * 0.5, oil: p.oil, raised: p.raised, flareT: p.flareT,
      landK: p.landK, lanternOut: p.lanternOut, dead: p.dead, deathKind: p.deathKind, pose,
    };
  }

  update(dt) {
    const e = this.engine, p = this.player, atm = this.atm, input = this.input;
    this.time += dt;
    const t = this.time;
    input.pollGamepad();
    const playing = this.state === 'play';
    if (playing && !this.ending) this.stats.time += dt;

    // ---- intro: the traveller rises and lights the lantern
    if (this.state === 'intro') {
      this.introT += dt;
      if (this.introT > 1.6 && p.lanternOut) {
        p.lanternOut = false;
        this.audio.sfx.beacon();
        for (let i = 0; i < 20; i++) this.sparks.spawn({ x: this.hero.lanternPos.x, y: this.hero.lanternPos.y, z: this.hero.lanternPos.z, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2, vz: (Math.random() - 0.5), life: 0.8, size: 0.05, color: [2, 1.2, 0.5], drag: 2 });
      }
      if (this.introT > 3.2) {
        this.state = 'play';
        p.ctrl = true;
        this.ui.showHud(true);
        this.audio.music.setMood('forest');
      }
    }

    // ---- player
    const ctx = { windForce: 0, noDrain: this.state !== 'play' || !!this.lighting || !!this.ending || (this.debug && this.god) };
    const wres = this.weather.update(dt, p.x, atm, !!this.ending && this.ending.t > 4);
    ctx.windForce = wres.windForce;
    const ctrlInput = playing && !this.lighting && !this.ending ? input : null;
    p.update(dt, ctrlInput, ctx);
    if (!ctrlInput) {
      input.consume('jump');
      input.consume('flare');
    }
    this.handlePlayerEvents();

    // ---- atmosphere
    atm.update(dt, p.x);
    if (this.ending) atm.overrideK = clamp((this.ending.t - 4) / 14);
    atm.windNow = clamp(Math.abs(atm.windSigned ?? atm.wind * 0.55), 0, 2);

    // ---- beacons & lighthouse
    this.updateBeacons(dt, t);
    this.updateInteraction(dt);
    this.updateEnding(dt);

    // ---- world objects
    const onBridge = p.onGround && p.ground?.surface === 'bridge';
    this.bridge.update(dt, t, atm.windSigned ?? 0, p.x, onBridge);
    for (const ev of this.bridge.events.splice(0)) {
      this.audio.sfx.plankBreak(this.pan(ev.x));
      for (let i = 0; i < 12; i++) this.smoke.spawn({ x: ev.x + (Math.random() - 0.5) * 0.8, y: ev.y, z: (Math.random() - 0.5), vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2, life: 1.2, size: 0.05, color: [0.25, 0.2, 0.16], alpha: 0.9, grav: 9 });
    }
    this.updateCrystals(dt);

    // ---- hero visuals & lantern light
    this.hero.update(dt, p, this.heroCtx(t));
    const lp = this.hero.lanternPos;
    const oilK = Math.sqrt(clamp(p.oil));
    const flareBoost = p.flareT >= 0 ? Math.max(0, 1 - p.flareT * 1.6) : 0;
    const L = this.lantern;
    L.position.copy(lp);
    L.intensity = (4.5 + 11 * oilK) * (1 + p.raised * 0.9) * this.hero.flicker * this.hero.flame * (p.dead ? Math.max(0, 1 - p.deathT * 0.5) : 1);
    L.distance = p.lightRadius * 2.3 + 2.5;
    GLOBAL.uLantern.value.copy(lp);
    GLOBAL.uLanternR.value = p.lightRadius;
    GLOBAL.uTime.value = t;
    GLOBAL.uWind.value = atm.windNow;
    GLOBAL.uPlayer.value.set(p.x, p.y, 0);
    this.flareK = Math.max(flareBoost, damp(this.flareK, 0, 6, dt));
    this.flareLight.position.copy(lp).add(V3(0, 0.2, 0.4));
    this.flareLight.intensity = this.flareK * 40;
    this.flareLight.distance = 18;

    // ---- enemies
    const safe = this.beacons.filter((b) => b.lit).map((b) => ({ x: b.x, y: b.y + 1.2, r: 5.5 }));
    this.shadows.update(dt, t, p, lp, safe, this.smoke);
    this.updateChase(dt, t);
    for (const ev of this.shadows.events.splice(0)) this.onShadowEvent(ev);

    // ---- pickups
    const got = this.fireflies.update(dt, t, p, lp, this.sparks);
    if (got) {
      p.oil = Math.min(1, p.oil + OIL.firefly * got);
      this.stats.fireflies += got;
      this.hudPing = 3;
    }
    for (const ev of this.fireflies.events.splice(0)) this.audio.sfx.firefly(this.pan(ev.x));

    // ---- triggers
    if (playing) this.updateTriggers();

    // ---- death & respawn
    this.updateDeath(dt);

    // ---- camera
    const cine = this.cineTarget();
    this.rig.cine = cine;
    this.rig.shakeScale = this.ui.settings.shake ? 1 : 0.15;
    this.rig.update(dt, p, this.chase.active && !this.ending ? { zoom: 3.2, aheadMul: 0.15, shift: -1.5 } : {});

    // ---- lights: fires pool, particles & volumetrics
    this.updateLights(dt, t);

    // ---- effects
    this.spawnAmbientParticles(dt, t);
    this.sparks.update(dt, t);
    this.smoke.update(dt, t);
    const scale = e.renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(THREE.MathUtils.degToRad(e.camera.fov / 2)));
    this.sparks.setFog(atm.fog, atm.fogDensity, scale);
    this.smoke.setFog(atm.fog, atm.fogDensity, scale);
    this.fireflies.uniforms.uScale.value = scale;
    const focus = this.rig.lookAt;
    this.rain.update(t, e.camera, atm, this.partLights, focus);
    this.motes.update(t, atm, this.partLights, focus, scale);
    this.mist.update(t, atm, this.partLights, focus, groundAt(focus.x) ?? focus.y - 1.5);
    this.mist.mesh.visible = atm.cave < 0.9;
    this.shafts.update(t, atm);
    for (const w of this.waters) {
      const near = p.x > w.x0 - 45 && p.x < w.x1 + 45;
      w.mesh.visible = near || (w === this.sea && p.x > 690 && atm.cave < 0.6);
      if (w.mesh.visible) w.update(t, e.camera, atm, this.partLights);
    }
    const sky = e.sky.uniforms;
    if (this.weather.flashDir) sky.flashDir.value.set(...this.weather.flashDir).normalize();

    // cave curtain reveal
    const cur = caveCurtain();
    if (cur) {
      const inside = p.x > 529 && p.x < 721 ? 1 : 0;
      cur.material.opacity = damp(cur.material.opacity, 1 - inside, 3, dt);
      cur.visible = cur.material.opacity > 0.01;
      cur.material.depthWrite = cur.material.opacity > 0.99;
    }

    // ---- grading
    const u = e.post.u;
    const low = clamp((0.22 - p.oil) / 0.22);
    const dark = Math.max(low * 0.75 + this.shadows.threat * 0.25, (this.giantNear ?? 0) * 0.7, p.lanternOut && this.state === 'play' ? 1 : 0, p.dead ? clamp(p.deathT * 0.6) : 0);
    u.dark.value = damp(u.dark.value, dark, 3, dt);
    u.hurt.value = damp(u.hurt.value, p.hurtT > 0.9 ? 1 : 0, 6, dt);
    u.fade.value = damp(u.fade.value, this.fade ?? 0, 2.2, dt);
    u.bars.value = damp(u.bars.value, this.lighting || this.ending || this.state === 'intro' ? 0.085 : 0, 3, dt);
    u.vignette.value = 0.5 + atm.cave * 0.15;
    u.sat.value = lerp(0.9, 1.05, atm.dawn);
    e.post.bloom.strength = 0.8 + atm.cave * 0.15 + this.flareK * 0.6 - atm.dawn * 0.35;
    e.post.bloom.threshold = 0.62 + atm.dawn * 0.3;
    e.applyAtmosphere(atm, t);

    // ---- audio
    this.updateAudio(dt);

    // ---- HUD
    this.updateHud(dt, t);
    input.endFrame();
  }

  pan(x) {
    return clamp((x - this.rig.x) / 14, -0.9, 0.9);
  }

  handlePlayerEvents() {
    const p = this.player, s = this.audio.sfx;
    const cave = this.atm.cave;
    for (const ev of p.events.splice(0)) {
      switch (ev.type) {
        case 'step': {
          s.step(ev.surface, { wade: ev.wade, speed: ev.speed, cave });
          const dust = ev.surface === 'grass' || ev.surface === 'mud' || ev.surface === 'stone' || ev.surface === 'cave';
          if (ev.wade > 0.1) this.splashFx(p.x, p.y + ev.wade * 0.6, 0.4);
          else if (dust && Math.random() < 0.6)
            this.smoke.spawn({ x: p.x - p.face * 0.1, y: p.y + 0.05, z: 0.1, vx: -p.vx * 0.05, vy: 0.25, life: 0.9, size: 0.12, size1: 0.5, color: [0.16, 0.15, 0.14], alpha: 0.25 });
          break;
        }
        case 'jump':
          s.jump(ev.surface, ev.wade);
          break;
        case 'land':
          s.land(ev.surface, ev.v, { wade: ev.wade });
          if (ev.v > 11) this.rig.addTrauma(Math.min(0.35, (ev.v - 11) * 0.05));
          for (let i = 0; i < 6 + ev.v; i++)
            this.smoke.spawn({ x: p.x + (Math.random() - 0.5) * 0.6, y: p.y + 0.05, z: (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 0.5, life: 1, size: 0.15, size1: 0.6, color: [0.15, 0.14, 0.13], alpha: 0.22, drag: 2.5 });
          break;
        case 'splash':
          s.splash(0, ev.deep ? 1.2 : 0.6);
          this.splashFx(p.x, (this.col.water(p.x)?.y ?? p.y), ev.deep ? 1.6 : 0.8);
          break;
        case 'hurt':
          s.hurt();
          this.rig.addTrauma(0.5);
          this.hudPing = 3;
          break;
        case 'death':
          this.onDeath(ev.kind);
          break;
        case 'flare':
          s.flare();
          this.rig.addTrauma(0.22);
          this.hudPing = 3;
          this.doFlare();
          break;
        case 'flareFail':
          s.flareFail();
          break;
        case 'lanternOut':
          s.lanternOut();
          break;
        case 'bump':
          s.land('stone', 3);
          break;
      }
    }
  }

  splashFx(x, y, k) {
    for (let i = 0; i < 18 * k; i++)
      this.sparks.spawn({ x: x + (Math.random() - 0.5) * 0.5, y: y + 0.05, z: (Math.random() - 0.5) * 0.5, vx: (Math.random() - 0.5) * 2.5, vy: 1.5 + Math.random() * 3 * k, vz: (Math.random() - 0.5), life: 0.6, size: 0.04, color: [0.25, 0.28, 0.32], grav: 12, alpha: 1 });
  }

  doFlare() {
    const p = this.player, lp = this.hero.lanternPos;
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 7;
      this.sparks.spawn({ x: lp.x, y: lp.y, z: lp.z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (Math.random() - 0.5) * 3, life: 0.5 + Math.random() * 0.7, size: 0.07, size1: 0.01, color: [2.2, 1.3, 0.55], drag: 3.5 });
    }
    const n = this.shadows.flare(lp.x, lp.y, 6.8);
    if (n) this.rig.addTrauma(0.15);
  }

  onShadowEvent(ev) {
    const s = this.audio.sfx, pan = this.pan(ev.x ?? this.player.x);
    switch (ev.type) {
      case 'shadowRise': s.shadowRise(pan); break;
      case 'shadowWindup': s.shadowWindup(pan); break;
      case 'shadowLunge': s.shadowLunge(pan); break;
      case 'shadowDie':
        s.shadowDie(pan);
        for (let i = 0; i < 40; i++) this.sparks.spawn({ x: ev.x + (Math.random() - 0.5), y: ev.y + (Math.random() - 0.5), z: 0.4, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3, life: 0.8 + Math.random() * 0.8, size: 0.05, size1: 0.0, color: [2, 0.8, 0.25], drag: 1.5, grav: -0.4 });
        break;
      case 'giantWake':
        s.shadowRise(-0.8);
        s.thunder(1, 0.2);
        this.rig.addTrauma(0.6);
        break;
    }
  }

  // ---------------------------------------------------------------- beacons
  updateBeacons(dt, t) {
    for (const b of this.beacons) {
      b.k = damp(b.k, b.lit ? 1 : 0, b.lit ? 1.5 : 6, dt);
      const ud = b.group.userData;
      const fl = 0.85 + Math.sin(t * 11 + b.x) * 0.08 + Math.sin(t * 23 + b.x * 2) * 0.05;
      ud.flameMat.opacity = b.k;
      ud.glowMat.opacity = b.k * 0.6 * fl;
      ud.flame.scale.set(1, fl * (0.8 + b.k * 0.4), 1);
      b.flick = fl;
      if (b.k > 0.3 && Math.abs(b.x - this.player.x) < 30 && Math.random() < dt * 6)
        this.sparks.spawn({ x: b.x + (Math.random() - 0.5) * 0.15, y: b.y + 1.35, z: -1.25, vx: (Math.random() - 0.5) * 0.4, vy: 0.8 + Math.random() * 0.8, life: 1.5 + Math.random(), size: 0.035, size1: 0.01, color: [2.2, 1.0, 0.35], turb: 1.2 });
    }
    // resting at a lit beacon refills the lantern
    const p = this.player;
    for (const b of this.beacons) if (b.lit && Math.abs(b.x - p.x) < 2.5 && !p.dead && p.oil < 1) {
      p.oil = Math.min(1, p.oil + dt * 0.35);
      if (p.lanternOut && p.oil > 0.05) p.lanternOut = false;
      this.hudPing = 2;
    }
  }

  updateInteraction(dt) {
    const p = this.player, input = this.input, ui = this.ui;
    if (this.state !== 'play' || p.dead || this.ending) {
      ui.prompt(null);
      return;
    }
    // lighting animation in progress
    if (this.lighting) {
      const l = this.lighting;
      l.t += dt;
      const b = l.beacon;
      if (l.t > 0.5 && l.t < 1.25) {
        const k = (l.t - 0.5) / 0.75;
        const from = this.hero.lanternPos, to = V3(b.x, b.y + 1.25, -1.25);
        for (let i = 0; i < 3; i++) {
          const kk = Math.min(1, k + Math.random() * 0.15);
          this.sparks.spawn({ x: lerp(from.x, to.x, kk), y: lerp(from.y, to.y, kk) + Math.sin(kk * Math.PI) * 0.5, z: lerp(from.z, to.z, kk), vx: (Math.random() - 0.5) * 0.3, vy: Math.random() * 0.3, life: 0.4, size: 0.06, size1: 0.01, color: [2.2, 1.3, 0.5] });
        }
      }
      if (l.t > 1.2 && !b.lit) {
        this.setBeaconLit(b, true);
        this.audio.sfx.beacon();
        this.rig.addTrauma(0.1);
        const idx = this.beacons.indexOf(b);
        this.checkpoint = Math.max(this.checkpoint, idx);
        this.save();
        p.oil = 1;
        p.lanternOut = false;
        this.hudPing = 4;
        ui.toast(b.name, '已點亮　·　旅程已記錄');
        for (let i = 0; i < 50; i++) this.sparks.spawn({ x: b.x, y: b.y + 1.25, z: -1.25, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3.5, vz: (Math.random() - 0.5) * 2, life: 1 + Math.random(), size: 0.05, size1: 0.01, color: [2.2, 1.1, 0.4], drag: 1.2, grav: -0.3 });
      }
      if (l.t > 2.2) {
        this.lighting = null;
        p.ctrl = true;
      }
      ui.prompt(null);
      return;
    }
    // near an unlit beacon?
    let near = null;
    for (const b of this.beacons) if (!b.lit && Math.abs(b.x - p.x) < 1.9 && Math.abs(b.y - p.y) < 1.2) near = b;
    const bz = LIGHTHOUSE.brazierX;
    const atBrazier = this.chase.done === false && p.x > bz - 2.2 && p.x < bz + 2.2 && !this.ending;
    if (near || atBrazier) {
      const target = near ? V3(near.x, near.y + 2.3, -1.25) : V3(bz, (groundAt(bz) ?? 14) + 2.1, -0.6);
      const sp = target.project(this.engine.camera);
      const x = (sp.x * 0.5 + 0.5) * innerWidth, y = (-sp.y * 0.5 + 0.5) * innerHeight;
      if (near) {
        ui.prompt(`${keyLabel('interact', input.lastDevice)}　點亮石燈`, x, y);
        if (input.consume('interact') && p.onGround) {
          this.lighting = { beacon: near, t: 0 };
          p.ctrl = false;
          p.vx = 0;
          p.face = near.x > p.x ? 1 : -1;
        }
      } else {
        // hold to light the lighthouse brazier
        this.holdK = input.held.interact ? (this.holdK || 0) + dt / 1.6 : Math.max(0, (this.holdK || 0) - dt * 2);
        ui.prompt(`${keyLabel('interact', input.lastDevice)}　長按點亮燈塔`, x, y, this.holdK);
        if (this.holdK >= 1) this.beginEnding();
      }
    } else ui.prompt(null);
  }

  updateCrystals(dt) {
    const p = this.player, lp = this.hero.lanternPos;
    if (p.x < 540 || p.x > 620) return;
    const reach = p.lightRadius * 0.85;
    for (const c of this.crystals) {
      const d = Math.hypot(c.x - lp.x, c.y - lp.y);
      const want = !p.lanternOut && d < reach ? 1 : 0;
      const prev = c.k;
      c.k = damp(c.k, want, want ? 7 : 3.5, dt);
      if (prev < 0.5 && c.k >= 0.5) this.audio.sfx.crystal(this.pan(c.x));
      c.plat.enabled = c.k > 0.45;
      c.mat.opacity = 0.06 + c.k * 0.8;
      c.mat.emissiveIntensity = 0.12 + c.k * 2.4;
      c.mat.depthWrite = c.k > 0.6;
    }
  }

  // ---------------------------------------------------------------- chase & ending
  updateChase(dt, t) {
    const p = this.player, ch = this.chase;
    if (!ch.done && !ch.active && p.x > CHASE.trigger && this.state === 'play' && !p.dead) {
      ch.active = true;
      this.ui.narrate(['——跑。']);
      this.audio.music.setMood('chase');
    }
    const caught = this.shadows.updateGiant(dt, t, p, ch.active && !this.ending);
    if (caught) p.kill('caught');
    const g = this.shadows.giant;
    this.giantNear = g.active && !this.ending ? clamp(1 - (p.x - g.edge) / 11) * g.k : 0;
    if (g.active && !this.ending) {
      // black mist boiling off the leading edge, reaching for the traveller
      for (let i = 0; i < 3; i++) {
        const y = (groundAt(g.edge) ?? p.y) + Math.random() * 7;
        this.smoke.spawn({ x: g.edge - Math.random() * 2, y, z: (Math.random() - 0.3) * 5, vx: 2 + Math.random() * 3, vy: (Math.random() - 0.5), life: 1.4, size: 0.6, size1: 2.2, color: [0.005, 0.004, 0.008], alpha: 0.55, turb: 1 });
      }
      if (Math.random() < dt * 1.2) this.audio.sfx.whisper(-0.8, 0.8);
    }
    if (ch.active && p.x > CHASE.end) {
      // the great shadow halts short of the lighthouse
      this.shadows.giant.x = Math.min(this.shadows.giant.x, CHASE.end - 24);
    }
  }

  beginEnding() {
    const p = this.player;
    this.ending = { t: 0, stage: 0 };
    this.chase.done = true;
    p.ctrl = false;
    p.vx = 0;
    p.face = 1;
    this.holdK = 0;
    this.ui.prompt(null);
    this.ui.showHud(false);
    this.audio.sfx.beacon();
    this.stats.beaconsLit = this.beacons.filter((b) => b.lit).length;
    this.clearSave();
  }

  updateEnding(dt) {
    const E = this.ending;
    if (!E) return;
    E.t += dt;
    const lh = this.lighthouse, t = E.t;
    const bz = LIGHTHOUSE.brazierX, by = groundAt(bz) ?? 14;
    // fire climbs the tower
    this.brazierLit = damp(this.brazierLit, 1, 2, dt);
    if (t < 3.2) {
      const k = clamp((t - 0.6) / 2.4);
      const tx = lerp(bz, lh.lampPos.x, k), ty = lerp(by + 1.1, lh.lampPos.y, k * k), tz = lerp(-0.6, lh.lampPos.z, k);
      for (let i = 0; i < 6; i++) this.sparks.spawn({ x: tx + (Math.random() - 0.5) * 0.4, y: ty, z: tz + 0.5, vx: (Math.random() - 0.5), vy: Math.random(), life: 0.8, size: 0.09, size1: 0.02, color: [2.4, 1.3, 0.45] });
    }
    if (t > 3.2 && E.stage === 0) {
      E.stage = 1;
      this.audio.sfx.lighthouse();
      this.rig.addTrauma(0.4);
      lh.beamPivot.visible = true;
    }
    if (E.stage >= 1) {
      this.lighthouseLit = damp(this.lighthouseLit, 1, 1.2, dt);
      const k = this.lighthouseLit;
      lh.lampMat.color.setRGB(5 * k, 4 * k, 2.8 * k);
      lh.glassMat.emissiveIntensity = 4 * k;
      lh.beamMat.uniforms.k.value = k;
      lh.beamPivot.rotation.y += dt * 0.55;
      // the great shadow burns away
      const g = this.shadows.giant;
      g.mat.uniforms.dissolve.value = clamp((t - 3.5) / 3);
      g.mat.uniforms.burn.value = 1;
    }
    if (t > 4 && E.stage === 1) {
      E.stage = 2;
      this.atm.override = 'dawn';
      this.audio.music.setMood('ending');
      this.audio.music.sting('dawn');
    }
    if (t > 7 && E.stage === 2) {
      E.stage = 3;
      this.ui.endingText(['光越過海面，照向每一條回家的路。', '長夜，終於過去了。', '守燈人放下提燈，靜靜看著日出。'], 3.6);
    }
    if (t > 24 && E.stage === 3) {
      E.stage = 4;
      this.fade = 1;
    }
    if (t > 27 && E.stage === 4) {
      E.stage = 5;
      this.ui.hideEndingText();
      this.state = 'credits';
      const beaconTotal = this.beacons.length;
      this.ui.showCredits({ ...this.stats, beacons: this.stats.beaconsLit ?? beaconTotal, beaconTotal }, () => {
        this.ui.hideCredits();
        this.onCreditsDone?.();
      });
    }
  }

  cineTarget() {
    const p = this.player;
    if (this.state === 'title') return { pos: V3(p.x + 3.2, p.y + 2.2, 11.5), look: V3(p.x + 1.2, p.y + 1.1, 0), rate: 1.5 };
    if (this.state === 'intro') return this.introT < 2.8 ? { pos: V3(p.x + 3, p.y + 2.4, 12), look: V3(p.x + 1.2, p.y + 1.2, 0), rate: 0.8 } : null;
    if (this.lighting) {
      const b = this.lighting.beacon;
      return { pos: V3((b.x + p.x) / 2 + 0.5, b.y + 2.4, 10.5), look: V3((b.x + p.x) / 2, b.y + 1.2, -0.6), rate: 2 };
    }
    if (this.ending) {
      const lh = this.lighthouse.lampPos;
      if (this.ending.t < 3) return { pos: V3(p.x + 1, p.y + 2.6, 12), look: V3(p.x + 1.5, p.y + 1.8, -1), rate: 1.2 };
      return { pos: V3(lh.x - 14, lh.y - 9, 40), look: V3(lh.x + 14, lh.y - 8, -20), rate: 0.35 };
    }
    return null;
  }

  // ---------------------------------------------------------------- triggers
  updateTriggers() {
    const p = this.player, ui = this.ui, d = this.done;
    for (const c of CHAPTERS) {
      if (!d.chapters.has(c) && p.x > c.x) {
        d.chapters.add(c);
        ui.chapter(c);
        this.audio.music.sting('chapter');
        this.chapterT = this.time;
      }
    }
    // let a chapter card breathe before the narration speaks
    const cardBusy = this.time - (this.chapterT ?? -99) < 5.5;
    for (const n of NARRATION) {
      if (!d.narr.has(n) && p.x > n.x && !cardBusy) {
        d.narr.add(n);
        ui.narrate(n.lines);
        break;
      }
    }
    let hint = null;
    for (const hh of HINTS) {
      if (d.hints.has(hh)) continue;
      if (p.x > hh.x1) d.hints.add(hh);
      else if (p.x > hh.x0) hint = hh;
    }
    if (hint) {
      const dev = this.input.lastDevice;
      let keys;
      if (hint.keys[0] === 'A') keys = dev === 'pad' ? '<kbd>←</kbd><kbd>→</kbd>' : '<kbd>A</kbd><kbd>D</kbd>';
      else if (hint.keys[0] === '空白鍵') keys = keyLabel('jump', dev);
      else if (hint.keys[0] === 'Shift') keys = dev === 'pad' ? '<kbd>RT</kbd>' : '<kbd>Shift</kbd><span class="or">或</span><kbd>滑鼠右鍵</kbd>';
      else if (hint.keys[0] === 'F') keys = dev === 'pad' ? '<kbd>X</kbd>' : '<kbd>F</kbd><span class="or">或</span><kbd>滑鼠左鍵</kbd>';
      ui.hint(`${keys}<span>${hint.text}</span>`);
    } else ui.hint(null);
  }

  // ---------------------------------------------------------------- death
  onDeath(kind) {
    this.stats.deaths++;
    this.audio.sfx.death();
    this.audio.core.setMuffle(500, 0.6);
    this.deathT = 0;
    this.rig.addTrauma(kind === 'caught' ? 0.8 : 0.3);
    if (kind === 'drown') this.splashFx(this.player.x, this.player.y, 1.5);
  }

  updateDeath(dt) {
    const p = this.player;
    if (this.deathT < 0) return;
    this.deathT += dt;
    if (this.deathT > 1.3 && !this.fade) {
      this.fade = 1;
      this.ui.death(true);
    }
    if (this.deathT > 3.6) {
      this.ui.death(false);
      this.respawn();
    }
  }

  respawn() {
    const cp = this.checkpoint;
    const x = cp >= 0 ? this.beacons[cp].x + 1.3 : 2;
    this.shadows.reset(cp >= 0 ? this.beacons[cp].x : -1e9);
    this.bridge.reset();
    this.chase.active = false;
    this.lighting = null;
    this.placePlayer(x);
    this.player.ctrl = true;
    this.player.oil = 1;
    this.player.lanternOut = false;
    this.deathT = -1;
    this.fade = 0;
    this.audio.core.setMuffle(20000, 0.8);
    if (this.chase.done === false && x > 740) this.audio.music.setMood('cliff');
  }

  // ---------------------------------------------------------------- lights
  updateLights(dt, t) {
    const p = this.player;
    const cands = [];
    // the smouldering campfire where the journey begins
    const ember = 0.16 + Math.sin(t * 2.3) * 0.03 + Math.sin(t * 7.1) * 0.02;
    cands.push({ pos: V3(0.8, 0.35, -1.2), k: ember, r: 0.8, fire: true, ember: true });
    for (const b of this.beacons) if (b.k > 0.01) cands.push({ pos: V3(b.x, b.y + 1.3, -1.1), k: b.k * (b.flick ?? 1), r: 1, fire: true });
    if (this.brazierLit > 0.01) {
      const bz = LIGHTHOUSE.brazierX;
      cands.push({ pos: V3(bz, (groundAt(bz) ?? 14) + 1.5, -0.6), k: this.brazierLit * (0.9 + Math.sin(t * 13) * 0.1), r: 1.3, fire: true });
    }
    if (this.lighthouseLit > 0.01) cands.push({ pos: this.lighthouse.lampPos.clone().add(V3(0, 0, 2)), k: this.lighthouseLit * 2, r: 2.5, fire: false, lh: true });
    cands.sort((a, b) => Math.abs(a.pos.x - p.x) - Math.abs(b.pos.x - p.x));
    for (let i = 0; i < this.pool.length; i++) {
      const c = cands[i], L = this.pool[i];
      if (c) {
        L.position.copy(c.pos);
        L.intensity = c.k * 7 * c.r;
        L.distance = 14 * c.r;
        L.color.copy(c.fire ? FIRE_COL : new THREE.Color(1, 0.85, 0.6));
      } else L.intensity = 0;
    }
    // volumetric: the lantern, the flare and the nearest fires
    const lc = LANTERN_COL.clone().multiplyScalar(0.016 * this.lantern.intensity / 12 + this.flareK * 0.06);
    const vol = [{ pos: this.lantern.position, color: lc, noise: 1 }];
    for (let i = 0; i < Math.min(5, cands.length); i++) {
      const c = cands[i];
      vol.push({ pos: c.pos, color: V3(1, 0.55, 0.22).multiplyScalar((c.lh ? 0.006 : 0.014) * c.k * c.r), noise: 1 });
    }
    this.engine.post.setLights(vol);
    // particle / water lighting slots
    this.partLights = [{ pos: this.lantern.position, color: V3(1, 0.62, 0.3).multiplyScalar(0.12 * this.lantern.intensity / 12 + this.flareK * 0.5) }];
    for (let i = 0; i < Math.min(3, cands.length); i++) this.partLights.push({ pos: cands[i].pos, color: V3(1, 0.5, 0.2).multiplyScalar(0.12 * cands[i].k * cands[i].r) });
  }

  spawnAmbientParticles(dt, t) {
    const p = this.player, atm = this.atm;
    const lp = this.hero.lanternPos;
    // embers from the lantern
    if (!p.lanternOut && Math.random() < dt * (2 + p.raised * 6))
      this.sparks.spawn({ x: lp.x, y: lp.y + 0.12, z: lp.z, vx: (Math.random() - 0.5) * 0.3, vy: 0.4 + Math.random() * 0.5, life: 0.8 + Math.random() * 0.6, size: 0.022, size1: 0.005, color: [2, 1, 0.35], turb: 1 });
    // rain splashes on the ground around the traveller
    if (atm.rain > 0.05) {
      const n = Math.floor(atm.rain * 55 * dt * 10) / 10 + (Math.random() < (atm.rain * 55 * dt) % 1 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const x = p.x + (Math.random() - 0.35) * 22;
        const g = groundAt(x);
        const w = this.col.water(x);
        const y = w && (g === null || g < w.y) ? w.y : g;
        if (y === null) continue;
        const z = (Math.random() - 0.5) * 4;
        const lit = Math.max(0, 1 - Math.hypot(x - lp.x, y - lp.y) / 5);
        const c = 0.12 + lit * 0.9;
        for (let k = 0; k < 2; k++)
          this.sparks.spawn({ x, y: y + 0.02, z, vx: (Math.random() - 0.5) * 1.2, vy: 1 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.5, life: 0.22, size: 0.025, color: [c * 0.9, c * 0.85, c * 0.8], grav: 14, alpha: 0.9 });
      }
    }
    // cave drips
    if (atm.cave > 0.5 && Math.random() < dt * 3) {
      const x = p.x + (Math.random() - 0.5) * 16;
      const g = groundAt(x) ?? p.y;
      this.sparks.spawn({ x, y: g + 5, z: (Math.random() - 0.5) * 2, vy: -1, life: 0.6, size: 0.03, color: [0.3, 0.4, 0.5], grav: 9.8 });
    }
    // campfire embers & a thin thread of smoke
    if (Math.abs(p.x) < 30) {
      if (Math.random() < dt * 3)
        this.sparks.spawn({ x: 0.8 + (Math.random() - 0.5) * 0.4, y: 0.15, z: -1.2 + (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 0.2, vy: 0.3 + Math.random() * 0.5, life: 1.2 + Math.random(), size: 0.025, size1: 0.005, color: [2, 0.7, 0.2], turb: 1.2 });
      if (Math.random() < dt * 2.5)
        this.smoke.spawn({ x: 0.8, y: 0.3, z: -1.2, vx: 0.1 + (atm.windSigned ?? 0) * 0.3, vy: 0.35, life: 5, size: 0.2, size1: 1.4, color: [0.06, 0.06, 0.07], alpha: 0.2, turb: 0.3 });
    }
    // lit-beacon smoke
    for (const b of this.beacons) {
      if (b.k > 0.3 && Math.abs(b.x - p.x) < 25 && Math.random() < dt * 2)
        this.smoke.spawn({ x: b.x, y: b.y + 2.0, z: -1.25, vx: 0.2 + (atm.windSigned ?? 0) * 0.5, vy: 0.5, life: 4, size: 0.4, size1: 1.8, color: [0.05, 0.05, 0.06], alpha: 0.18, turb: 0.3 });
    }
    // brazier fire
    if (this.brazierLit > 0.1 && Math.random() < dt * 30) {
      const bz = LIGHTHOUSE.brazierX, by = (groundAt(bz) ?? 14) + 1.1;
      this.sparks.spawn({ x: bz + (Math.random() - 0.5) * 0.5, y: by, z: -0.6, vx: (Math.random() - 0.5) * 0.4, vy: 1 + Math.random() * 1.5, life: 0.6 + Math.random() * 0.5, size: 0.2, size1: 0.02, color: [2, 0.8, 0.25], turb: 2 });
    }
  }

  // ---------------------------------------------------------------- audio mix
  updateAudio(dt) {
    const a = this.audio, p = this.player, atm = this.atm;
    if (!a.core.ready) return;
    const x = p.x;
    const z = zoneAt(x).preset;
    const w = (a0, b0, s = 12) => smoothstep(a0 - s, a0, x) * (1 - smoothstep(b0, b0 + s, x));
    let fireNear = 0;
    for (const b of this.beacons) if (b.k > 0.1) fireNear = Math.max(fireNear, b.k * clamp(1 - Math.abs(b.x - x) / 12));
    let water = 0;
    for (const wt of WATER) water = Math.max(water, clamp(1 - Math.max(wt.x0 - x, x - wt.x1, 0) / 25) * (wt.kind === 'flood' ? 1 : 0.6));
    a.core.setCave(atm.cave);
    a.amb.update(dt, {
      rain: atm.rain, wind: atm.windNow * 0.6, gust: atm.gust, forest: w(-80, 190), village: w(190, 390), bridge: w(398, 500, 4),
      water: water * (1 - atm.cave), sea: x > 700 ? clamp((x - 700) / 40) * (1 - atm.cave) : 0, cave: atm.cave, fireNear: Math.max(fireNear, this.brazierLit),
      creak: (pan, g) => a.sfx.creak(pan, g),
    });
    if (this.state === 'play' && !this.chase.active && !this.ending) {
      const mood = { forest: 'forest', forestDeep: 'forest', village: 'village', gorge: 'bridge', cave: 'cave', cliff: 'cliff' }[z];
      a.music.setMood(mood);
    }
    a.music.update(dt, this.state === 'play' ? this.shadows.threat : 0);
    // low-oil heartbeat
    this.beatT = (this.beatT ?? 0) - dt;
    if (this.state === 'play' && !p.dead && (p.oil < 0.18 || p.lanternOut) && this.beatT <= 0) {
      a.sfx.heartbeat(0.6);
      this.beatT = p.lanternOut ? 0.7 : 1.0;
    }
    // weather sounds
    for (const ev of this.weather.events.splice(0)) {
      if (ev.type === 'thunder') setTimeout(() => {
        a.sfx.thunder(ev.power, ev.dist);
        if (ev.dist < 0.5) this.rig.addTrauma(0.15);
      }, ev.delay * 1000);
    }
  }

  updateHud(dt, t) {
    const p = this.player, ui = this.ui;
    ui.setOil(p.oil, t);
    this.hudPing = Math.max(0, (this.hudPing ?? 0) - dt);
    const want = p.oil < 0.35 || p.raised > 0.1 || this.hudPing > 0 || this.shadows.threat > 0.3 ? 1 : 0.18;
    this.hudVis = damp(this.hudVis ?? 1, want, 2.5, dt);
    ui.setHudVisibility(this.hudVis);
  }

  render() {
    this.engine.render(this.time);
  }
}
