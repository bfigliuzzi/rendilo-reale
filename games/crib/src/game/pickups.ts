import { Particle, type ParticleContainer } from 'pixi.js';
import * as B from '../config/balance';
import type { Atlas } from '../render/textures';

const PARK = -9999;

/**
 * Ramassables au sol. Ils se prennent EN MARCHANT DESSUS : c'est la seule
 * progression du jeu, et la seule cohérente avec « bouger est la seule action ».
 *
 * Leur vraie fonction de design n'est pas le bonus mais le DÉTOUR : un doudou posé
 * à 200 px du berceau force un arbitrage — y aller, c'est laisser la porte ouverte
 * quelques secondes. Le rayon de ramassage est volontairement plus large que le
 * sprite (`HERO_PICK_RADIUS`) : rater un objet qu'on a visiblement touché est la
 * frustration la plus gratuite qui soit.
 */
export class Pickups {
  count = 0;
  readonly x = new Float32Array(B.MAX_PICKUPS);
  readonly y = new Float32Array(B.MAX_PICKUPS);
  readonly kind = new Uint8Array(B.MAX_PICKUPS);
  private readonly life = new Float32Array(B.MAX_PICKUPS);
  private readonly particles: Particle[] = [];

  constructor(
    private readonly container: ParticleContainer,
    private readonly atlas: Atlas,
  ) {
    for (let i = 0; i < B.MAX_PICKUPS; i++) {
      const p = new Particle({ texture: atlas.pickups[0], x: PARK, y: PARK, anchorX: 0.5, anchorY: 0.5 });
      this.particles.push(p);
      container.addParticle(p);
    }
  }

  spawn(kind: number, x: number, y: number): void {
    if (this.count >= B.MAX_PICKUPS) return;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.kind[i] = kind;
    this.life[i] = B.PICKUP_LIFE;
    this.particles[i].texture = this.atlas.pickups[kind];
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.kind[i] = this.kind[last];
      this.life[i] = this.life[last];
      this.particles[i].texture = this.atlas.pickups[this.kind[last]];
    }
    const p = this.particles[last];
    p.x = PARK;
    p.y = PARK;
    p.alpha = 1;
  }

  update(dt: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) this.kill(i);
    }
  }

  /** Ramasse tout ce que le bébé touche ce tick, du plus proche au plus lointain. */
  collect(hx: number, hy: number, onPick: (kind: number, x: number, y: number) => void): void {
    const r = B.HERO_PICK_RADIUS + B.PICKUP_RADIUS;
    for (let i = this.count - 1; i >= 0; i--) {
      const dx = this.x[i] - hx;
      const dy = this.y[i] - hy;
      if (dx * dx + dy * dy > r * r) continue;
      const kind = this.kind[i];
      const x = this.x[i];
      const y = this.y[i];
      this.kill(i);
      onPick(kind, x, y);
    }
  }

  renderSync(clock: number): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      // flottement + pulsation : ce qui les fait remarquer au milieu du gazon
      p.x = this.x[i];
      p.y = this.y[i] + Math.sin(clock * 3 + i) * 2.5;
      const pulse = 1 + Math.sin(clock * 4 + i * 1.7) * 0.08;
      p.scaleX = pulse;
      p.scaleY = pulse;
      // fin de vie : clignotement franc. Un objet qui disparaît sans prévenir donne
      // le sentiment d'avoir été volé.
      const t = this.life[i];
      p.alpha = t < B.PICKUP_BLINK ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(clock * 16)) : 1;
    }
    this.container.update();
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      p.x = PARK;
      p.y = PARK;
      p.alpha = 1;
    }
    this.count = 0;
  }
}
