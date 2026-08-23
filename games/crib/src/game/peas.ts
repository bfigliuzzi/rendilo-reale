import { Particle, type ParticleContainer } from 'pixi.js';
import { lerp } from '@shared/math';
import * as B from '../config/balance';
import type { Atlas } from '../render/textures';

const PARK = -9999;

/**
 * Petits pois du brocoli. Pool SoA, mêmes invariants que `Bullets`.
 *
 * Un pois part vers un POINT FIXE, jamais vers une cible poursuivie : il n'anticipe
 * pas le déplacement du bébé, donc bouger suffit toujours à l'éviter. C'est la
 * contrepartie de la seule action du jeu — si les pois guidaient, se déplacer ne
 * servirait plus à rien.
 *
 * Un pois n'a pas de camp : il englue le bébé ET abîme le berceau (`World` teste les
 * deux). Un tir visant le berceau qui croise le bébé le colle donc au passage —
 * émergent, et lisible sans explication.
 */
export class Peas {
  count = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  private readonly particles: Particle[] = [];

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
    this.life = new Float32Array(cap);
    for (let i = 0; i < cap; i++) {
      const p = new Particle({ texture: atlas.pea, x: PARK, y: PARK, anchorX: 0.5, anchorY: 0.5 });
      this.particles.push(p);
      container.addParticle(p);
    }
  }

  fire(x: number, y: number, tx: number, ty: number): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    const dx = tx - x;
    const dy = ty - y;
    const d = Math.hypot(dx, dy) || 1;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.vx[i] = (dx / d) * B.PEA_SPEED;
    this.vy[i] = (dy / d) * B.PEA_SPEED;
    this.life[i] = B.PEA_LIFE;
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
      this.life[i] = this.life[last];
    }
    const p = this.particles[last];
    p.x = PARK;
    p.y = PARK;
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
      this.particles[i].x = PARK;
      this.particles[i].y = PARK;
    }
    this.count = 0;
  }
}
