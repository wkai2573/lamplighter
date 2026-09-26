// Can a straightforward runner survive the final chase?
import * as THREE from 'three';
import { Collision } from '../src/game/collision.js';
import { Player } from '../src/game/player.js';
import { Shadows } from '../src/game/shadows.js';
import { groundAt } from '../src/world/terrain.js';
import { CHASE } from '../src/world/level.js';

for (const hesitate of [0, 0.8, 1.6]) {
  const col = new Collision();
  const sh = new Shadows(new THREE.Scene());
  const input = { held: { right: 1, jump: 0, down: 0, raise: 0 }, pressed: {}, get axis() { return this.held.right ? 1 : 0; }, consume(n) { const p = !!this.pressed[n]; this.pressed[n] = false; return p; } };
  const p = new Player(col);
  p.reset(760, groundAt(760));
  let t = 0, holdJ = 0, active = false, minGap = 99, paused = false;
  while (t < 60 && p.x < CHASE.end + 2 && !p.dead) {
    const dt = 1 / 60; t += dt;
    if (p.x > CHASE.trigger) active = true;
    // optional hesitation right after the first obstacle
    input.held.right = hesitate && p.x > 783 && !paused ? 0 : 1;
    if (hesitate && p.x > 783 && !paused) { if ((p.hes = (p.hes || 0) + dt) > hesitate) paused = true; }
    if (p.onGround && holdJ <= 0) {
      const ahead = col.floor(p.x + 0.25, p.x + 0.55, p.y + 0.2, p.y - 1.2, false);
      const wall = (groundAt(p.x + 0.45) ?? -99) > p.y + 0.3 || col.solids.some((s) => s.x0 < p.x + 0.8 && s.x1 > p.x && s.y1 > p.y + 0.3 && s.y0 < p.y + 1.5);
      if (!ahead || wall) { input.pressed.jump = true; holdJ = 0.35; }
    }
    holdJ -= dt; input.held.jump = holdJ > 0 ? 1 : 0;
    p.update(dt, input, {});
    p.events.length = 0;
    const caught = sh.updateGiant(dt, t, p, active);
    if (active) minGap = Math.min(minGap, p.x - sh.giant.edge);
    if (caught) { p.kill('caught'); }
  }
  console.log(`hesitate ${hesitate}s: ${p.dead ? 'CAUGHT at x=' + p.x.toFixed(1) : 'escaped'} (closest gap ${minGap.toFixed(1)} m, t=${t.toFixed(1)}s)`);
}
