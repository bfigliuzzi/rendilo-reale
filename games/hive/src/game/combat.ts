import { SpatialGrid } from '@shared/spatialGrid';
import type { Sfx } from '../audio/sfx';
import { COLLIDE_R, GRID_CELL, GRID_COLS, GRID_MAX_PER_CELL, GRID_ROWS, MAX_FACTIONS, UNIT_CAP } from '../config/balance';
import type { Fx } from '../render/fx';
import { PALETTE } from '../render/textures';
import type { Units } from './units';

const R2 = COLLIDE_R * COLLIDE_R;
const MAX_BURSTS_PER_TICK = 6; // au-delà, les impacts restent sans particules (throttle fx)

/**
 * Combat à puissance entre N factions — LE cœur d'Auralux, généralisé :
 * TOUTES les unités vivantes sont insérées dans la grille (rebâtie à chaque
 * tick), puis chaque unité non engagée INITIE un contact contre la première
 * unité VIVANTE d'une AUTRE faction de son voisinage 3×3. Dégâts mutuels
 * d = min(hp_i, hp_j) : deux égaux s'annihilent (le 1:1 historique), un
 * costaud mange un faible et survit entamé. Le flag `engaged` limite chaque
 * unité à UNE initiation par tick (rythme borné, pas de double-compte), mais
 * une unité engagée reste CIBLABLE tant qu'elle vit : sans cela, le camp le
 * plus nombreux saturait tous les adversaires et son surplus traversait
 * l'écran sans combattre (mesuré au scénario `duel` : la nuée fine gagnait
 * ~90 % des matchups à vitesse égale), et le costaud ne pouvait encaisser
 * qu'un contact par tick (le ressenti « le cafard gagne tous les échanges »).
 * Chaque contact détruit la même puissance des deux côtés : l'usure agrégée
 * reste exactement 1:1, seule la monétisation du NOMBRE disparaît.
 * Les morts sont MARQUÉES (dead=1), jamais retirées ici : les index de la
 * grille restent valides toute la phase ; Units.sweepDead() compacte après.
 */
export class Combat {
  /** Morts en combat par faction depuis reset() (instrumentation succès,
   *  lecture seule — la sim n'y lit jamais). */
  readonly deaths = new Int32Array(MAX_FACTIONS);

  private readonly grid = new SpatialGrid(GRID_COLS, GRID_ROWS, GRID_CELL, GRID_MAX_PER_CELL);
  private readonly engaged = new Uint8Array(UNIT_CAP);

  /** Remise à zéro des compteurs (appelée par World.loadLevel). */
  reset(): void {
    this.deaths.fill(0);
  }

  update(units: Units, fx: Fx, sfx: Sfx): void {
    // early-out : combat impossible à moins de deux factions en vol
    let flying = 0;
    for (let f = 1; f < MAX_FACTIONS; f++) if (units.byFaction[f] > 0) flying++;
    if (flying < 2) return;

    const grid = this.grid;
    grid.clear();
    for (let i = 0; i < units.count; i++) {
      if (!units.dead[i]) grid.insert(i, units.x[i], units.y[i]);
    }
    this.engaged.fill(0, 0, units.count);
    let bursts = 0;
    for (let i = 0; i < units.count; i++) {
      if (units.dead[i] || this.engaged[i]) continue;
      const fi = units.faction[i];
      const cx = grid.cellX(units.x[i]);
      const cy = grid.cellY(units.y[i]);
      let done = false;
      for (let gy = cy - 1; gy <= cy + 1 && !done; gy++) {
        if (gy < 0 || gy >= GRID_ROWS) continue;
        for (let gx = cx - 1; gx <= cx + 1 && !done; gx++) {
          if (gx < 0 || gx >= GRID_COLS) continue;
          const cell = gy * GRID_COLS + gx;
          const n = grid.counts[cell];
          for (let k = 0; k < n; k++) {
            const j = grid.items[cell * GRID_MAX_PER_CELL + k];
            // une unité engagée reste ciblable (mais n'initiera plus ce tick)
            if (units.faction[j] === fi || units.dead[j]) continue;
            const dx = units.x[j] - units.x[i];
            const dy = units.y[j] - units.y[i];
            if (dx * dx + dy * dy > R2) continue;
            const d = Math.min(units.hp[i], units.hp[j]);
            units.hit(i, d);
            units.hit(j, d);
            this.engaged[i] = 1;
            this.engaged[j] = 1;
            // fx/sfx uniquement sur mort : un contact non létal (costaud
            // entamé) ne doit pas produire un grésillement permanent
            if (units.dead[i] || units.dead[j]) {
              // le contact n'engage que des vivants : chaque mort est comptée
              // exactement une fois, au contact qui la provoque
              if (units.dead[i]) this.deaths[fi]++;
              if (units.dead[j]) this.deaths[units.faction[j]]++;
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
            }
            done = true;
            break;
          }
        }
      }
    }
  }
}
