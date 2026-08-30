import { Particle } from 'pixi.js';
import type { ParticleContainer, Texture } from 'pixi.js';
import { DESIGN_H, DESIGN_W } from '../config/balance';
import { PALETTE } from './textures';

/**
 * Motes dorées à la dérive : c'est tout le « chatoyant » de la charte, et il
 * vit SOUS le gameplay. Le pool est fixe et recyclé en place — zéro allocation
 * au tick. En mouvement réduit, `setEnabled(false)` les gare hors écran : elles
 * ne portent aucune information, les couper n'ampute rien.
 */
const COUNT = 34;

export class Ambience {
  private readonly x = new Float32Array(COUNT);
  private readonly y = new Float32Array(COUNT);
  private readonly vy = new Float32Array(COUNT);
  private readonly phase = new Float32Array(COUNT);
  private readonly parts: Particle[] = [];
  private t = 0;
  private enabled = true;

  constructor(layer: ParticleContainer, texture: Texture) {
    for (let i = 0; i < COUNT; i++) {
      // semis déterministe : deux ouvertures du jeu montrent le même ciel
      this.x[i] = ((i * 97) % 100) / 100 * DESIGN_W;
      this.y[i] = ((i * 61) % 100) / 100 * DESIGN_H;
      this.vy[i] = -8 - (i % 5) * 4;
      this.phase[i] = (i % 7) * 0.9;
      const p = new Particle({ texture, x: this.x[i], y: this.y[i], anchorX: 0.5, anchorY: 0.5 });
      p.tint = i % 3 === 0 ? PALETTE.ember : PALETTE.gold;
      p.alpha = 0.16 + (i % 4) * 0.05;
      p.scaleX = p.scaleY = 0.1 + (i % 3) * 0.05;
      this.parts.push(p);
      layer.addParticle(p);
    }
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
      if (this.y[i] < -10) this.y[i] = DESIGN_H + 10;
      const p = this.parts[i];
      p.x = this.x[i] + Math.sin(this.t * 0.6 + this.phase[i]) * 9;
      p.y = this.y[i];
    }
  }
}
