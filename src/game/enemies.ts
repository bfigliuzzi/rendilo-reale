import { Particle, type ParticleContainer } from 'pixi.js';
import * as B from '../config/balance';
import { clamp, lerp } from '../core/math';
import type { Atlas } from '../render/textures';

const PARK = -9999;

/**
 * Pool SoA des ennemis. Convention de mort en deux temps : les collisions marquent
 * `hp <= 0` (les index restent stables pendant la phase, la grille n'est jamais périmée),
 * puis `sweepDead()` fait les swap-remove après coup.
 */
export class EnemyPool {
  count = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly vx: Float32Array;
  readonly hp: Float32Array;
  readonly radius: Float32Array;
  readonly kind: Uint8Array;
  private readonly particles: Particle[] = [];

  constructor(
    readonly cap: number,
    private readonly container: ParticleContainer,
    private readonly atlas: Atlas,
  ) {
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.prevX = new Float32Array(cap);
    this.prevY = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.hp = new Float32Array(cap);
    this.radius = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    for (let i = 0; i < cap; i++) {
      const p = new Particle({ texture: atlas.enemyByKind[0], x: PARK, y: PARK, anchorX: 0.5, anchorY: 0.5 });
      this.particles.push(p);
      container.addParticle(p);
    }
  }

  spawn(kind: number, x: number, y: number, hpMul = 1): void {
    if (this.count >= this.cap) return;
    const def = B.ENEMY_KINDS[kind];
    const i = this.count++;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.vx[i] = 0;
    this.hp[i] = def.hp * hpMul;
    this.radius[i] = def.radius;
    this.kind[i] = kind;
    this.particles[i].texture = this.atlas.enemyByKind[kind as 0 | 1 | 2];
  }

  kill(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.prevX[i] = this.prevX[last];
      this.prevY[i] = this.prevY[last];
      this.vx[i] = this.vx[last];
      this.hp[i] = this.hp[last];
      this.radius[i] = this.radius[last];
      this.kind[i] = this.kind[last];
      this.particles[i].texture = this.atlas.enemyByKind[this.kind[last] as 0 | 1 | 2];
    }
    const p = this.particles[last];
    p.x = PARK;
    p.y = PARK;
  }

  update(dt: number, squadX: number, bottomY: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      const def = B.ENEMY_KINDS[this.kind[i]];
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      // léger pilotage horizontal vers l'escouade : « ils viennent te chercher »
      const desired = clamp((squadX - this.x[i]) * 1.5, -def.steer, def.steer);
      this.vx[i] += (desired - this.vx[i]) * Math.min(1, dt * 3);
      this.x[i] = clamp(this.x[i] + this.vx[i] * dt, B.LANE_MIN_X - 10, B.LANE_MAX_X + 10);
      this.y[i] += def.speed * dt;
      if (this.y[i] > bottomY) this.kill(i); // passé derrière : cull silencieux
    }
  }

  /** Swap-remove différé des ennemis marqués morts pendant les collisions. */
  sweepDead(onKill: (x: number, y: number) => void): void {
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.hp[i] <= 0) {
        const x = this.x[i];
        const y = this.y[i];
        this.kill(i);
        onKill(x, y);
      }
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
  }
}
