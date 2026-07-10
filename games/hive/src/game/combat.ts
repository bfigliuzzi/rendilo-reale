import { SpatialGrid } from '@shared/spatialGrid';
import type { Sfx } from '../audio/sfx';
import { COLLIDE_R, GRID_CELL, GRID_COLS, GRID_MAX_PER_CELL, GRID_ROWS } from '../config/balance';
import { ENEMY, PLAYER } from '../config/levels';
import type { Fx } from '../render/fx';
import { PALETTE } from '../render/textures';
import type { Units } from './units';

const R2 = COLLIDE_R * COLLIDE_R;
const MAX_BURSTS_PER_TICK = 6; // au-delà, les impacts restent sans particules (throttle fx)

/**
 * Annihilation 1:1 : deux nuées opposées se mangent au contact — LE cœur d'Auralux.
 * Grille rebâtie à chaque tick, pattern asymétrique (cafards insérés, abeilles
 * interrogent un voisinage 3×3). Les morts sont MARQUÉES (dead=1), jamais
 * retirées ici : les index de la grille restent valides toute la phase ;
 * Units.sweepDead() compacte après.
 */
export class Combat {
  private readonly grid = new SpatialGrid(GRID_COLS, GRID_ROWS, GRID_CELL, GRID_MAX_PER_CELL);

  update(units: Units, fx: Fx, sfx: Sfx): void {
    if (units.byFaction[PLAYER] === 0 || units.byFaction[ENEMY] === 0) return;
    const grid = this.grid;
    grid.clear();
    for (let i = 0; i < units.count; i++) {
      if (units.faction[i] === ENEMY && !units.dead[i]) grid.insert(i, units.x[i], units.y[i]);
    }
    let bursts = 0;
    for (let i = 0; i < units.count; i++) {
      if (units.faction[i] !== PLAYER || units.dead[i]) continue;
      const cx = grid.cellX(units.x[i]);
      const cy = grid.cellY(units.y[i]);
      let killed = false;
      for (let gy = cy - 1; gy <= cy + 1 && !killed; gy++) {
        if (gy < 0 || gy >= GRID_ROWS) continue;
        for (let gx = cx - 1; gx <= cx + 1 && !killed; gx++) {
          if (gx < 0 || gx >= GRID_COLS) continue;
          const cell = gy * GRID_COLS + gx;
          const n = grid.counts[cell];
          for (let k = 0; k < n; k++) {
            const j = grid.items[cell * GRID_MAX_PER_CELL + k];
            if (units.dead[j]) continue;
            const dx = units.x[j] - units.x[i];
            const dy = units.y[j] - units.y[i];
            if (dx * dx + dy * dy > R2) continue;
            units.markDead(i);
            units.markDead(j);
            sfx.annihilate(); // throttlé en interne
            if (bursts < MAX_BURSTS_PER_TICK) {
              bursts++;
              fx.burst((units.x[i] + units.x[j]) / 2, (units.y[i] + units.y[j]) / 2, {
                count: 4,
                color: PALETTE.select,
                speed: 90,
                life: 0.25,
                size: 0.7,
              });
            }
            killed = true;
            break;
          }
        }
      }
    }
  }
}
