// Headless traversal test: a simple bot runs the real physics through the whole level
// and reports where it gets stuck or dies.  Usage: node scripts/bot.mjs [startX] [endX]
import * as THREE from 'three';
import { Collision } from '../src/game/collision.js';
import { Player } from '../src/game/player.js';
import { groundAt } from '../src/world/terrain.js';
import { buildBridge, buildCrystals } from '../src/world/structures.js';
import { BEACONS } from '../src/world/level.js';

const start = +(process.argv[2] ?? -1), end = +(process.argv[3] ?? 900);
const scene = new THREE.Scene();
const col = new Collision();
const bridge = buildBridge(scene, col);
const crystals = buildCrystals(scene, col);
for (const c of crystals) c.plat.enabled = true; // assume the lantern is raised

const input = {
  held: { right: 1, left: 0, jump: 0, down: 0, raise: 0 },
  pressed: {},
  get axis() { return (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0); },
  consume(n) { const p = !!this.pressed[n]; this.pressed[n] = false; return p; },
};
const p = new Player(col);
const f0 = col.floor(start - 0.2, start + 0.2, 60, -60, false);
p.reset(start, f0 ? f0.y : groundAt(start) ?? 0);
const dt = 1 / 60;
let t = 0, holdJ = 0, lastX = p.x, stuckT = 0, jumps = 0;
const issues = [];
let ret = 0;
while (p.x < end && t < 900) {
  t += dt;
  // bot brain
  if (p.onGround && holdJ <= 0) {
    const ahead = col.floor(p.x + 0.25, p.x + 0.55, p.y + 0.2, p.y - 1.2, false);
    const wall = (groundAt(p.x + 0.45) ?? -99) > p.y + 0.3 || col.solids.some((s) => s.enabled && s.x0 < p.x + 0.8 && s.x1 > p.x && s.y1 > p.y + 0.3 && s.y0 < p.y + 1.5);
    const plat = col.platforms.some((q) => q.enabled && q.x0 < p.x + 1.2 && q.x1 > p.x + 0.3 && q.y > p.y + 0.3 && q.y < p.y + 2.1);
    const bs = (x) => col.platforms.some((q) => q.enabled && q.x0 <= x && q.x1 >= x);
    if (!ahead || wall || (plat && !bs(p.x + 0.3))) {
      input.pressed.jump = true;
      holdJ = 0.35;
      jumps++;
    }
  }
  holdJ -= dt;
  input.held.jump = holdJ > 0 ? 1 : 0;
  p.update(dt, input, { windForce: 0 });
  bridge.update(dt, t, 0, p.x, p.onGround && p.ground?.surface === 'bridge');
  p.events.length = 0;
  if (p.oil < 0.5) p.oil = 1;
  if (p.dead) {
    issues.push(`DIED (${p.deathKind}) at x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} t=${t.toFixed(1)}`);
    // respawn a little ahead and continue so we see every problem in one run
    const nx = p.x + 3;
    const f = col.floor(nx - 0.2, nx + 0.2, 60, -60, false);
    p.reset(nx, f ? f.y : 0);
    if (++ret > 25) break;
    continue;
  }
  if (p.x > lastX + 0.5) { lastX = p.x; stuckT = 0; }
  else if ((stuckT += dt) > 3) {
    issues.push(`STUCK at x=${p.x.toFixed(2)} y=${p.y.toFixed(2)}`);
    p.x += 1.5;
    p.y += 2;
    stuckT = 0;
    lastX = p.x;
    if (++ret > 25) break;
  }
}
console.log(`reached x=${p.x.toFixed(1)} in ${t.toFixed(1)}s with ${jumps} jumps`);
console.log(issues.length ? issues.join('\n') : 'no issues');
console.log('beacons at', BEACONS.map((b) => b.x).join(', '));
