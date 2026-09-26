import { groundAt, groundMax, surfaceAt } from '../world/terrain.js';
import { SOLIDS, PLATFORMS, ceilingAt, waterAt } from '../world/level.js';

// All walkable/solid things the player can touch.
// Platforms are one-way and may be dynamic (bridge planks, light crystals): they expose
// `enabled` and an optional `onStand(dt)` callback.
export class Collision {
  constructor() {
    this.platforms = PLATFORMS.map((p) => ({ ...p, enabled: true, surface: p.kind === 'roof' ? 'roof' : 'wood' }));
    this.solids = SOLIDS.map((s) => ({ ...s, enabled: true }));
  }

  addPlatform(p) {
    const q = { enabled: true, surface: 'wood', ...p };
    this.platforms.push(q);
    return q;
  }

  // Highest supporting surface for feet spanning [x0, x1], crossed while moving from yPrev down to yNew.
  floor(x0, x1, yPrev, yNew, dropThrough) {
    let best = -Infinity, info = null;
    const g = groundMax(x0, x1);
    if (g !== null && g >= yNew - 0.001) {
      // terrain is solid below its surface, so it always supports
      best = g;
      info = { kind: 'ground', surface: surfaceAt((x0 + x1) / 2), ref: null };
    }
    if (!dropThrough) {
      for (const p of this.platforms) {
        if (!p.enabled || p.x1 < x0 || p.x0 > x1) continue;
        if (p.y <= yPrev + 0.02 && p.y >= yNew - 0.001 && p.y > best) {
          best = p.y;
          info = { kind: 'platform', surface: p.surface, ref: p };
        }
      }
    }
    for (const s of this.solids) {
      if (!s.enabled || s.x1 < x0 || s.x0 > x1) continue;
      if (s.y1 <= yPrev + 0.02 && s.y1 >= yNew - 0.001 && s.y1 > best) {
        best = s.y1;
        info = { kind: 'solid', surface: s.kind === 'log' ? 'wood' : 'stone', ref: s };
      }
    }
    return info ? { y: best, ...info } : null;
  }

  // Height to step up to while walking (boardwalk edges, low lips of solids), or null.
  stepUp(x0, x1, y, maxStep) {
    let best = null;
    for (const p of this.platforms) {
      if (!p.enabled || p.x1 < x0 || p.x0 > x1) continue;
      if (p.y > y + 0.001 && p.y <= y + maxStep && (best === null || p.y > best)) best = p.y;
    }
    for (const s of this.solids) {
      if (!s.enabled || s.x1 < x0 || s.x0 > x1) continue;
      if (s.y1 > y + 0.001 && s.y1 <= y + maxStep && (best === null || s.y1 > best)) best = s.y1;
    }
    return best;
  }

  ceiling(x0, x1, yHead) {
    let c = Math.min(ceilingAt(x0), ceilingAt(x1));
    for (const s of this.solids) {
      if (!s.enabled || s.x1 < x0 || s.x0 > x1) continue;
      if (s.y0 >= yHead - 0.6 && s.y0 < c) c = s.y0;
    }
    return c;
  }

  // Horizontal blocking: returns clamped x.
  blockX(x, nx, y, hw, h, stepH) {
    const dir = Math.sign(nx - x);
    if (!dir) return nx;
    const lead = nx + dir * hw;
    // terrain wall
    const g = groundAt(lead);
    if (g !== null && g > y + stepH) {
      // walk back to the last free position
      let tx = nx;
      for (let i = 0; i < 12; i++) {
        tx -= dir * 0.02;
        const gg = groundAt(tx + dir * hw);
        if (gg === null || gg <= y + stepH) break;
      }
      return dir > 0 ? Math.min(tx, x) : Math.max(tx, x);
    }
    // cave ceiling pinch
    const c = ceilingAt(lead);
    if (c < y + h) return x;
    for (const s of this.solids) {
      if (!s.enabled) continue;
      if (y + h <= s.y0 + 0.01 || y >= s.y1 - 0.001) continue;
      if (y >= s.y1 - stepH && y < s.y1) continue; // small lip: will be stepped up
      if (dir > 0 && x + hw <= s.x0 + 0.001 && nx + hw > s.x0) return s.x0 - hw;
      if (dir < 0 && x - hw >= s.x1 - 0.001 && nx - hw < s.x1) return s.x1 + hw;
    }
    return nx;
  }

  water(x) {
    return waterAt(x);
  }
}
