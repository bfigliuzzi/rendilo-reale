import { Particle, type ParticleContainer, type Texture } from 'pixi.js';
import { lerp, rand } from '@shared/math';

const PARK = -9999;
const CAP = 512;

export interface BurstOpts {
  count: number;
  color: number;
  speed?: number; // vitesse max des particules
  life?: number; // durée de vie en s
  size?: number; // échelle max
}

/**
 * Pool SoA de particules d'effets (captures, annihilations) + screen shake.
 * Copie locale du pattern horde (contrats susceptibles de diverger par jeu —
 * candidate à shared/ si elle reste identique au 3e consommateur).
 * Zéro allocation au runtime, swap-remove.
 */
export class Fx {
  private count = 0;
  private readonly x = new Float32Array(CAP);
  private readonly y = new Float32Array(CAP);
  private readonly prevX = new Float32Array(CAP);
  private readonly prevY = new Float32Array(CAP);
  private readonly vx = new Float32Array(CAP);
  private readonly vy = new Float32Array(CAP);
  private readonly life = new Float32Array(CAP);
  private readonly maxLife = new Float32Array(CAP);
  private readonly size = new Float32Array(CAP);
  private readonly particles: Particle[] = [];
  private shakeMag = 0;
  readonly shakeX = { value: 0 };
  readonly shakeY = { value: 0 };

  constructor(
    private readonly container: ParticleContainer,
    texture: Texture,
  ) {
    for (let i = 0; i < CAP; i++) {
      const p = new Particle({ texture, x: PARK, y: PARK, anchorX: 0.5, anchorY: 0.5 });
      this.particles.push(p);
      container.addParticle(p);
    }
  }

  burst(x: number, y: number, opts: BurstOpts): void {
    const speed = opts.speed ?? 160;
    const life = opts.life ?? 0.35;
    const size = opts.size ?? 1;
    for (let k = 0; k < opts.count; k++) {
      if (this.count >= CAP) return;
      const i = this.count++;
      const a = rand(0, Math.PI * 2);
      const v = rand(0.25, 1) * speed;
      this.x[i] = this.prevX[i] = x;
      this.y[i] = this.prevY[i] = y;
      this.vx[i] = Math.cos(a) * v;
      this.vy[i] = Math.sin(a) * v;
      this.life[i] = this.maxLife[i] = life * rand(0.7, 1.3);
      this.size[i] = size * rand(0.7, 1.3);
      this.particles[i].tint = opts.color;
    }
  }

  shake(magnitude: number): void {
    this.shakeMag = Math.max(this.shakeMag, magnitude);
  }

  update(dt: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.vx[i] *= 0.92;
      this.vy[i] *= 0.92;
      this.life[i] -= dt;
      if (this.life[i] <= 0) this.kill(i);
    }
    this.shakeMag = Math.max(0, this.shakeMag - 40 * dt);
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.prevX[i] = this.prevX[last];
      this.prevY[i] = this.prevY[last];
      this.vx[i] = this.vx[last];
      this.vy[i] = this.vy[last];
      this.life[i] = this.life[last];
      this.maxLife[i] = this.maxLife[last];
      this.size[i] = this.size[last];
      this.particles[i].tint = this.particles[last].tint;
    }
    const p = this.particles[last];
    p.x = PARK;
    p.y = PARK;
    p.alpha = 1;
  }

  syncRender(alpha: number): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      const t = this.life[i] / this.maxLife[i];
      p.x = lerp(this.prevX[i], this.x[i], alpha);
      p.y = lerp(this.prevY[i], this.y[i], alpha);
      p.alpha = t;
      const s = this.size[i] * (0.4 + 0.6 * t);
      p.scaleX = s;
      p.scaleY = s;
    }
    this.container.update();
    // jitter de shake recalculé à chaque frame de rendu (pas de la sim)
    this.shakeX.value = this.shakeMag > 0 ? rand(-this.shakeMag, this.shakeMag) : 0;
    this.shakeY.value = this.shakeMag > 0 ? rand(-this.shakeMag, this.shakeMag) : 0;
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      p.x = PARK;
      p.y = PARK;
    }
    this.count = 0;
    this.shakeMag = 0;
  }
}
