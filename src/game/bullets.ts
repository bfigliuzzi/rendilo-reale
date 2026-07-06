import { Particle, type ParticleContainer, type Texture } from 'pixi.js';
import * as B from '../config/balance';
import { lerp } from '../core/math';
import type { Squad } from './squad';

const PARK = -9999; // les particules mortes sont garées hors écran (le PC rend tout ce qu'il contient)

/**
 * Pool struct-of-arrays : données chaudes en Float32Array, swap-remove, zéro allocation
 * au runtime. Les particules Pixi sont créées une fois et index-verrouillées aux données.
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
  private readonly particles: Particle[] = [];
  private fireAcc = 0;
  private readonly muzzle = { x: 0, y: 0 };

  constructor(
    readonly cap: number,
    private readonly container: ParticleContainer,
    texture: Texture,
  ) {
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.prevX = new Float32Array(cap);
    this.prevY = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.dmg = new Float32Array(cap);
    for (let i = 0; i < cap; i++) {
      const p = new Particle({ texture, x: PARK, y: PARK, anchorX: 0.5, anchorY: 0.5 });
      this.particles.push(p);
      container.addParticle(p);
    }
  }

  spawn(x: number, y: number, vx: number, vy: number, dmg: number): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.dmg[i] = dmg;
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
    }
    const p = this.particles[last];
    p.x = PARK;
    p.y = PARK;
  }

  /**
   * Modèle de tir : DPS = effectif × SOLDIER_DPS × bonus méta (scale linéaire sans
   * limite), cadence visuelle plafonnée, dégâts par balle = DPS / cadence réelle.
   * Retourne le nombre de balles tirées ce tick (pour le son, throttlé en aval).
   */
  autoFire(dt: number, squad: Squad, dist: number, dpsMul: number): number {
    if (squad.logical <= 0) return 0;
    const rate = Math.min(squad.logical, B.FIRE_SOLDIER_CAP) * B.FIRE_RATE_PER_SOLDIER;
    const dmg = (squad.logical * B.SOLDIER_DPS * dpsMul) / rate;
    let fired = 0;
    this.fireAcc += rate * dt;
    while (this.fireAcc >= 1) {
      this.fireAcc -= 1;
      fired++;
      squad.nextMuzzle(dist, this.muzzle);
      this.spawn(
        this.muzzle.x,
        this.muzzle.y,
        (Math.random() - 0.5) * B.BULLET_X_JITTER,
        -B.BULLET_SPEED,
        dmg,
      );
    }
    return fired;
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
    this.fireAcc = 0;
  }
}
