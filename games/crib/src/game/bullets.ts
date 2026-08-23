import { Particle, type ParticleContainer } from 'pixi.js';
import { lerp } from '@shared/math';
import * as B from '../config/balance';
import type { Atlas } from '../render/textures';
import type { EnemyPool } from './enemies';

const PARK = -9999;

/** Ce dont l'aim-assist a besoin d'un boss, sans importer la classe (pas de cycle). */
export interface AimTarget {
  active: boolean;
  x: number;
  y: number;
  radius: number;
  hp: number;
}

/**
 * Ce dont `Bullets` a besoin d'un TIREUR — le bébé, ou une tour.
 *
 * `fireAcc` vit sur le tireur et pas sur le pool, et ce n'est pas un détail : avec
 * un accumulateur unique partagé, le bébé et quatre tours tireraient en salve
 * parfaitement synchrone à cadence divisée par cinq. C'est la seule modification
 * structurelle qu'a demandée la généralisation.
 */
export interface Shooter {
  x: number;
  y: number;
  /** balles/s */
  rate: number;
  /** dégâts/s ; les dégâts PAR BALLE en sont dérivés (`dps / rate`). */
  dps: number;
  range: number;
  fireAcc: number;
}

/**
 * Cubes-hochets lancés par le bébé et par les tours. Pool SoA, mêmes invariants que
 * les autres.
 *
 * DEUX points de conception importants :
 *
 * 1. Le tir ne consulte JAMAIS le grip. C'est le premier garde-fou de la mécanique
 *    d'engluement : cloué au sol, le bébé continue de tirer à pleine portée, donc il
 *    se libère lui-même. Toute future condition de tir doit préserver ça.
 *
 * 2. L'aim-assist est à 360° (contrairement au cône frontal de horde : ici il n'y a
 *    pas d'« avant »). Il vise la menace VIVANTE la plus proche — ennemis ET boss.
 *    Toute nouvelle entité tirable doit être ajoutée à `aim()`, sinon elle devient
 *    quasi intouchable dès qu'un ennemi est à l'écran.
 */
export class Bullets {
  count = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly dmg: Float32Array;
  readonly life: Float32Array;
  private readonly particles: Particle[] = [];
  /** Sortie de `aim()`, préallouée : zéro allocation dans le tick. */
  private readonly target = { x: 0, y: 0, found: false };

  constructor(
    readonly cap: number,
    private readonly container: ParticleContainer,
    atlas: Atlas,
  ) {
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.prevX = new Float32Array(cap);
    this.prevY = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.dmg = new Float32Array(cap);
    this.life = new Float32Array(cap);
    for (let i = 0; i < cap; i++) {
      const p = new Particle({ texture: atlas.toy, x: PARK, y: PARK, anchorX: 0.5, anchorY: 0.5 });
      this.particles.push(p);
      container.addParticle(p);
    }
  }

  private spawn(x: number, y: number, vx: number, vy: number, dmg: number, range: number): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.dmg[i] = dmg;
    // durée de vie dérivée de la portée DU TIREUR : une tour à 220 verrait sinon
    // ses balles s'évaporer en vol, calées sur la portée du bébé
    this.life[i] = (range + B.BULLET_REACH_MARGIN) / B.BULLET_SPEED;
  }

  kill(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.prevX[i] = this.prevX[last];
      this.prevY[i] = this.prevY[last];
      this.vx[i] = this.vx[last];
      this.vy[i] = this.vy[last];
      this.dmg[i] = this.dmg[last];
      this.life[i] = this.life[last];
    }
    const p = this.particles[last];
    p.x = PARK;
    p.y = PARK;
  }

  /**
   * Tir automatique dès qu'une cible entre dans `HERO_RANGE`. Les dégâts par balle
   * sont DÉRIVÉS (`DPS / cadence`) : le biberon double la cadence sans toucher au
   * DPS, il améliore donc la répartition des dégâts (moins de surplus gâché sur les
   * couches à 12 PV), jamais la puissance brute.
   *
   * Retourne le nombre de balles tirées ce tick, pour le son (throttlé en aval).
   */
  autoFire(dt: number, s: Shooter, enemies: EnemyPool, boss: AimTarget): number {
    const rate = s.rate;
    s.fireAcc += rate * dt;
    if (s.fireAcc < 1) return 0;
    this.aim(s.x, s.y, s.range, enemies, boss);
    if (!this.target.found) {
      // pas de cible : on garde au plus un tir « en réserve » pour que la première
      // balle sorte immédiatement à l'entrée en portée, sans rafale de rattrapage
      s.fireAcc = Math.min(s.fireAcc, 1);
      return 0;
    }
    const dmg = s.dps / rate;
    let fired = 0;
    while (s.fireAcc >= 1) {
      s.fireAcc -= 1;
      const dx = this.target.x - s.x;
      const dy = this.target.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      this.spawn(s.x, s.y - 4, (dx / d) * B.BULLET_SPEED, (dy / d) * B.BULLET_SPEED, dmg, s.range);
      fired++;
    }
    return fired;
  }

  /** Menace vivante la plus proche dans `range`, ennemis ET boss. */
  private aim(hx: number, hy: number, range: number, enemies: EnemyPool, boss: AimTarget): void {
    let bestD2 = range * range;
    this.target.found = false;
    for (let i = 0; i < enemies.count; i++) {
      if (enemies.hp[i] <= 0) continue;
      const dx = enemies.x[i] - hx;
      const dy = enemies.y[i] - hy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        this.target.x = enemies.x[i];
        this.target.y = enemies.y[i];
        this.target.found = true;
      }
    }
    if (boss.active && boss.hp > 0) {
      const dx = boss.x - hx;
      const dy = boss.y - hy;
      // portée mesurée depuis la SURFACE du boss : il est énorme, exiger que son
      // centre soit à portée obligerait à se coller dedans pour le toucher
      const d = Math.max(0, Math.hypot(dx, dy) - boss.radius);
      const d2 = d * d;
      if (d2 < bestD2) {
        this.target.x = boss.x;
        this.target.y = boss.y;
        this.target.found = true;
      }
    }
  }

  update(dt: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.life[i] -= dt;
      if (this.life[i] <= 0) this.kill(i);
    }
  }

  syncRender(alpha: number, clock: number): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      p.x = lerp(this.prevX[i], this.x[i], alpha);
      p.y = lerp(this.prevY[i], this.y[i], alpha);
      // le cube tourne en vol : la rotation est dérivée de l'index pour que deux
      // balles simultanées ne soient pas parfaitement superposables
      p.rotation = clock * 9 + i;
    }
    this.container.update();
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) {
      this.particles[i].x = PARK;
      this.particles[i].y = PARK;
    }
    this.count = 0;
  }
}
