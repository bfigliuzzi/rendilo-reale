import { Particle } from 'pixi.js';
import type { ParticleContainer, Texture } from 'pixi.js';
import { PALETTE } from './textures';

/**
 * Motes chaudes à la dérive : tout le « chatoyant » de la charte, et il vit
 * SOUS le gameplay. Semis DÉTERMINISTE (aucun `Math.random`) : deux ouvertures
 * de la même vignette montrent le même ciel, et le bot n'a rien à neutraliser.
 *
 * `setEnabled(false)` gare les motes hors écran (mouvement réduit) sans rien
 * détruire : elles ne portent aucune information, les couper n'ampute rien.
 */
const COUNT = 28;

export class Ambience {
  private readonly x = new Float32Array(COUNT);
  private readonly y = new Float32Array(COUNT);
  private readonly vy = new Float32Array(COUNT);
  private readonly phase = new Float32Array(COUNT);
  private readonly parts: Particle[] = [];
  private t = 0;
  private enabled = true;

  constructor(
    layer: ParticleContainer,
    texture: Texture,
    private w: number,
    private h: number,
  ) {
    for (let i = 0; i < COUNT; i++) {
      this.x[i] = (((i * 97) % 100) / 100) * w;
      this.y[i] = (((i * 61) % 100) / 100) * h;
      this.vy[i] = -7 - (i % 5) * 3;
      this.phase[i] = (i % 7) * 0.9;
      const p = new Particle({ texture, x: this.x[i], y: this.y[i], anchorX: 0.5, anchorY: 0.5 });
      p.tint = i % 3 === 0 ? PALETTE.berry : PALETTE.gold;
      p.alpha = 0.14 + (i % 4) * 0.04;
      p.scaleX = 0.1 + (i % 3) * 0.04;
      p.scaleY = p.scaleX;
      this.parts.push(p);
      layer.addParticle(p);
    }
  }

  /** Changement de posture : le semis se réétale sur le nouveau cadre. */
  resize(w: number, h: number): void {
    for (let i = 0; i < COUNT; i++) {
      this.x[i] = (this.x[i] / this.w) * w;
      this.y[i] = (this.y[i] / this.h) * h;
    }
    this.w = w;
    this.h = h;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) for (const p of this.parts) p.x = -9999;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.t += dt;
    for (let i = 0; i < COUNT; i++) {
      this.y[i] += this.vy[i] * dt;
      if (this.y[i] < -10) this.y[i] = this.h + 10;
      const p = this.parts[i];
      p.x = this.x[i] + Math.sin(this.t * 0.55 + this.phase[i]) * 8;
      p.y = this.y[i];
    }
  }
}
