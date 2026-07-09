import { Particle, type ParticleContainer, type Texture } from 'pixi.js';
import * as B from '../config/balance';
import { clamp, lerp } from '../core/math';
import type { Atlas } from '../render/textures';
import type { Bosses } from './boss';
import type { Crates } from './crates';
import type { EnemyPool } from './enemies';
import type { Squad } from './squad';

const PARK = -9999; // les particules mortes sont garées hors écran (le PC rend tout ce qu'il contient)

/**
 * Pool struct-of-arrays : données chaudes en Float32Array, swap-remove, zéro allocation
 * au runtime. Les particules Pixi sont créées une fois et index-verrouillées aux données.
 * Le tir est composé de trois flux indépendants (fusiliers/snipers/artilleurs) selon
 * la composition d'escouade — chaque flux garde le modèle « DPS découplé des balles ».
 */
export class BulletPool {
  count = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly dmg: Float32Array;
  readonly splash: Float32Array; // rayon de zone par balle (0 = aucun)
  private readonly particles: Particle[] = [];
  private readonly fireAcc = new Float32Array(B.SOLDIER_CLASSES.length);
  private readonly classTextures: Texture[];
  private readonly muzzle = { x: 0, y: 0 };

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
    this.splash = new Float32Array(cap);
    this.classTextures = [atlas.bullet, atlas.bulletSniper, atlas.bulletShell];
    for (let i = 0; i < cap; i++) {
      const p = new Particle({ texture: atlas.bullet, x: PARK, y: PARK, anchorX: 0.5, anchorY: 0.5 });
      this.particles.push(p);
      container.addParticle(p);
    }
  }

  spawn(x: number, y: number, vx: number, vy: number, dmg: number, splash: number, texture: Texture): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.dmg[i] = dmg;
    this.splash[i] = splash;
    this.particles[i].texture = texture;
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
      this.splash[i] = this.splash[last];
      this.particles[i].texture = this.particles[last].texture;
    }
    const p = this.particles[last];
    p.x = PARK;
    p.y = PARK;
  }

  /**
   * Trois flux de tir selon la composition : par classe, DPS = effectif de la
   * classe × SOLDIER_DPS × dpsMul de classe × bonus globaux ; cadence saturée
   * par classe ; dégâts par balle = DPS / cadence réelle. Retourne le nombre de
   * balles tirées ce tick (pour le son, throttlé en aval).
   */
  autoFire(
    dt: number,
    squad: Squad,
    dist: number,
    dpsMul: number,
    rateMul: number,
    comp: { rifle: number; sniper: number; art: number },
    weaponSplash: number,
    enemies: EnemyPool,
    bosses: Bosses,
    crates: Crates,
  ): number {
    if (squad.logical <= 0) return 0;
    let fired = 0;
    for (let ci = 0; ci < B.SOLDIER_CLASSES.length; ci++) {
      const def = B.SOLDIER_CLASSES[ci];
      const soldiers = squad.logical * comp[def.id];
      if (soldiers < 0.5) {
        this.fireAcc[ci] = 0;
        continue;
      }
      const rate = Math.min(soldiers, def.fireCap) * def.rate * rateMul;
      const dmg = (soldiers * B.SOLDIER_DPS * def.dpsMul * dpsMul) / rate;
      const splash = Math.max(def.splash, weaponSplash);
      this.fireAcc[ci] += rate * dt;
      while (this.fireAcc[ci] >= 1) {
        this.fireAcc[ci] -= 1;
        fired++;
        squad.nextMuzzle(dist, this.muzzle);
        this.spawn(
          this.muzzle.x,
          this.muzzle.y,
          this.aimVX(this.muzzle.x, this.muzzle.y, def.aimRange, def.bulletSpeed, enemies, bosses, crates),
          -def.bulletSpeed,
          dmg,
          splash,
          this.classTextures[ci],
        );
      }
    }
    return fired;
  }

  /** Tir unitaire avec aim-assist depuis un point arbitraire (drone allié…). */
  fireAimed(
    x: number,
    y: number,
    dmg: number,
    enemies: EnemyPool,
    bosses: Bosses,
    crates: Crates,
  ): void {
    this.spawn(
      x,
      y,
      this.aimVX(x, y, B.BULLET_AIM_RANGE_X, B.BULLET_SPEED, enemies, bosses, crates),
      -B.BULLET_SPEED,
      dmg,
      0,
      this.classTextures[0],
    );
  }

  /**
   * Aim-assist : vise la menace vivante la plus proche dans le cône frontal —
   * ennemis, boss ET caisses. Toute nouvelle entité tirable doit être ajoutée ici.
   */
  private aimVX(
    mx: number,
    my: number,
    aimRange: number,
    bulletSpeed: number,
    enemies: EnemyPool,
    bosses: Bosses,
    crates: Crates,
  ): number {
    let bestD2 = Infinity;
    let bestDX = 0;
    let bestDY = 0;
    // ne jamais viser au-delà de la portée réelle des balles (bord d'écran) :
    // sinon elles courbent vers des cibles qu'elles ne peuvent plus atteindre
    const reach = -(B.CULL_AHEAD - 25);
    for (let e = 0; e < enemies.count; e++) {
      if (enemies.hp[e] <= 0) continue;
      const dy = enemies.y[e] - my;
      if (dy >= -20 || dy < reach) continue; // uniquement devant, à portée
      const dx = enemies.x[e] - mx;
      if (dx > aimRange || dx < -aimRange) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestDX = dx;
        bestDY = dy;
      }
    }
    for (const boss of bosses.list) {
      if (!boss.alive || boss.hp <= 0) continue;
      const dy = boss.y - my;
      if (dy >= -20 || dy < reach) continue;
      const dx = boss.x - mx;
      const range = aimRange + B.BOSS_RADIUS; // grosse cible, grand cône
      if (dx > range || dx < -range) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestDX = dx;
        bestDY = dy;
      }
    }
    // caisses : ciblées comme le reste — la plus proche gagne, donc une caisse
    // devient prioritaire exactement quand elle est la menace immédiate
    for (const crate of crates.list) {
      if (crate.dead) continue;
      const dy = crate.cy - my;
      if (dy >= -20 || dy < reach) continue;
      // point visé : le bord de la caisse le plus proche du canon
      const tx = clamp(mx, crate.cx - B.CRATE_HALF_W + 8, crate.cx + B.CRATE_HALF_W - 8);
      const dx = tx - mx;
      if (dx > aimRange || dx < -aimRange) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestDX = dx;
        bestDY = dy;
      }
    }
    if (bestD2 === Infinity) return (Math.random() - 0.5) * B.BULLET_X_JITTER;
    const t = -bestDY / bulletSpeed; // temps de vol jusqu'à la cible
    return clamp(bestDX / Math.max(t, 0.05), -B.BULLET_AIM_MAX_VX, B.BULLET_AIM_MAX_VX);
  }

  update(dt: number, topY: number, bottomY: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      if (this.y[i] < topY || this.y[i] > bottomY) this.kill(i);
    }
  }

  syncRender(alpha: number): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      p.x = lerp(this.prevX[i], this.x[i], alpha);
      p.y = lerp(this.prevY[i], this.y[i], alpha);
    }
    this.container.update();
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      p.x = PARK;
      p.y = PARK;
    }
    this.count = 0;
    this.fireAcc.fill(0);
  }
}
