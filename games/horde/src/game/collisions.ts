import * as B from '../config/balance';
import { SpatialGrid } from '../core/spatialGrid';
import type { Bosses } from './boss';
import type { BulletPool } from './bullets';
import type { Crates } from './crates';
import type { EnemyPool } from './enemies';
import type { Squad } from './squad';

/**
 * Broadphase : seuls les ennemis (les seuls nombreux des deux côtés d'un test)
 * sont insérés dans la grille ; balles et soldats l'interrogent en 3×3 cellules.
 * Les morts d'ennemis sont différées (hp <= 0) pour garder les index de la grille
 * valides pendant toute la phase — le sweep a lieu ensuite dans World.
 */
export class Collisions {
  private readonly grid = new SpatialGrid(B.GRID_COLS, B.GRID_ROWS, B.GRID_CELL, B.GRID_MAX_PER_CELL);

  /** Canon lourd : dégâts de zone autour de l'ennemi touché (via la grille, déjà à jour). */
  private splashAround(enemies: EnemyPool, hitIndex: number, dmg: number, radius: number): void {
    const grid = this.grid;
    const cx = grid.cellX(enemies.x[hitIndex]);
    const cy = grid.cellY(enemies.y[hitIndex]);
    const reach = Math.ceil(radius / grid.cellSize);
    for (let gy = cy - reach; gy <= cy + reach; gy++) {
      if (gy < 0 || gy >= grid.rows) continue;
      for (let gx = cx - reach; gx <= cx + reach; gx++) {
        if (gx < 0 || gx >= grid.cols) continue;
        const cell = gy * grid.cols + gx;
        const n = grid.counts[cell];
        const base = cell * grid.maxPerCell;
        for (let k = 0; k < n; k++) {
          const e = grid.items[base + k];
          if (e === hitIndex || enemies.hp[e] <= 0) continue;
          const dx = enemies.x[e] - enemies.x[hitIndex];
          const dy = enemies.y[e] - enemies.y[hitIndex];
          if (dx * dx + dy * dy < radius * radius) enemies.hp[e] -= dmg;
        }
      }
    }
  }

  onBossHit: () => void = () => {};
  onKamikaze: (x: number, y: number) => void = () => {};

  run(
    dist: number,
    bullets: BulletPool,
    enemies: EnemyPool,
    squad: Squad,
    crates: Crates,
    bosses: Bosses,
  ): void {
    const grid = this.grid;
    grid.setOrigin(0, -dist - B.GRID_AHEAD);
    grid.clear();
    for (let e = 0; e < enemies.count; e++) grid.insert(e, enemies.x[e], enemies.y[e]);

    const cols = grid.cols;
    const rows = grid.rows;
    const maxPer = grid.maxPerCell;
    const counts = grid.counts;
    const items = grid.items;

    // balles → ennemis (via grille), puis caisses (brute force, ≤ 4 à l'écran)
    for (let b = bullets.count - 1; b >= 0; b--) {
      const bx = bullets.x[b];
      const by = bullets.y[b];
      const ccx = grid.cellX(bx);
      const ccy = grid.cellY(by);
      let hit = false;
      for (let gy = ccy - 1; gy <= ccy + 1 && !hit; gy++) {
        if (gy < 0 || gy >= rows) continue;
        for (let gx = ccx - 1; gx <= ccx + 1 && !hit; gx++) {
          if (gx < 0 || gx >= cols) continue;
          const cell = gy * cols + gx;
          const n = counts[cell];
          const base = cell * maxPer;
          for (let k = 0; k < n; k++) {
            const e = items[base + k];
            if (enemies.hp[e] <= 0) continue;
            const dx = enemies.x[e] - bx;
            const dy = enemies.y[e] - by;
            const r = enemies.radius[e] + B.BULLET_RADIUS;
            if (dx * dx + dy * dy < r * r) {
              enemies.hp[e] -= bullets.dmg[b];
              // dégâts de zone par balle (obus d'artilleur, canon lourd)
              if (bullets.splash[b] > 0) {
                this.splashAround(enemies, e, bullets.dmg[b] * 0.5, bullets.splash[b]);
              }
              hit = true;
              break;
            }
          }
        }
      }
      if (!hit) {
        for (const crate of crates.list) {
          if (!crate.dead && crate.hits(bx, by, B.BULLET_RADIUS)) {
            crate.damage(bullets.dmg[b]);
            hit = true;
            break;
          }
        }
      }
      if (!hit) {
        for (const boss of bosses.list) {
          if (!boss.alive || boss.hp <= 0) continue;
          const dx = boss.x - bx;
          const dy = boss.y - by;
          const r = B.BOSS_RADIUS + B.BULLET_RADIUS;
          if (dx * dx + dy * dy < r * r) {
            boss.damage(bullets.dmg[b]);
            this.onBossHit();
            hit = true;
            break;
          }
        }
      }
      if (hit) bullets.kill(b);
    }

    // soldats → ennemis : contact = mort des deux
    const soldierR = B.SOLDIER_RADIUS * squad.visualScale;
    for (let i = 0; i < squad.rendered; i++) {
      if (squad.logical <= 0) break;
      const sx = squad.soldierWorldX(i);
      const sy = squad.soldierWorldY(i, dist);
      const ccx = grid.cellX(sx);
      const ccy = grid.cellY(sy);
      let touched = false;
      for (let gy = ccy - 1; gy <= ccy + 1 && !touched; gy++) {
        if (gy < 0 || gy >= rows) continue;
        for (let gx = ccx - 1; gx <= ccx + 1 && !touched; gx++) {
          if (gx < 0 || gx >= cols) continue;
          const cell = gy * cols + gx;
          const n = counts[cell];
          const base = cell * maxPer;
          for (let k = 0; k < n; k++) {
            const e = items[base + k];
            if (enemies.hp[e] <= 0) continue;
            const dx = enemies.x[e] - sx;
            const dy = enemies.y[e] - sy;
            const r = enemies.radius[e] + soldierR;
            if (dx * dx + dy * dy < r * r) {
              enemies.hp[e] = 0;
              if (enemies.kind[e] === B.KIND_KAMIKAZE) {
                this.onKamikaze(enemies.x[e], enemies.y[e]); // le souffle gère les pertes
              } else {
                squad.loseSoldiers(1);
              }
              touched = true; // une seule perte par soldat et par tick
              break;
            }
          }
        }
      }
    }
  }
}
