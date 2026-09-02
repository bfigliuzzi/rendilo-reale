import { Container, Particle, Text } from 'pixi.js';
import type { ParticleContainer, Texture } from 'pixi.js';

/**
 * Effets : gerbes de particules et nombres flottants. Pool SoA à swap-remove,
 * particules Pixi index-verrouillées, garées hors écran quand mortes — ZÉRO
 * allocation dans le tick, invariant du dépôt et condition pour que les trois
 * jeux temps réel tiennent 60 Hz sur un téléphone d'attente.
 *
 * Les effets ne portent JAMAIS d'information : un panier qui se remplit, un
 * thermomètre, un compte de fruits se lisent tous à l'arrêt. C'est ce qui rend
 * `particleMul = 0` (mouvement réduit) sans conséquence, et c'est aussi la
 * raison pour laquelle aucun fx de cette collection ne clignote (WCAG 2.3.1 —
 * et il y a une table à côté).
 */
const MAX_PARTICLES = 200;
const MAX_FLOATERS = 10;

export class Fx {
  /** Multiplicateur de particules : 0 en mouvement réduit. */
  particleMul = 1;

  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly vx = new Float32Array(MAX_PARTICLES);
  private readonly vy = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly parts: Particle[] = [];
  private count = 0;

  private readonly floaters: { text: Text; vy: number; life: number }[] = [];
  private floaterNext = 0;

  constructor(layer: ParticleContainer, floaterLayer: Container, texture: Texture) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = new Particle({ texture, x: -9999, y: -9999, anchorX: 0.5, anchorY: 0.5 });
      this.parts.push(p);
      layer.addParticle(p);
    }
    for (let i = 0; i < MAX_FLOATERS; i++) {
      const t = new Text({
        text: '',
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: 30,
          fontWeight: '900',
          fill: 0xffffff,
        },
      });
      t.anchor.set(0.5);
      t.visible = false;
      floaterLayer.addChild(t);
      this.floaters.push({ text: t, vy: 0, life: 0 });
    }
  }

  /** Gerbe douce. `power` module le NOMBRE de grains, jamais leur vitesse. */
  burst(x: number, y: number, color: number, power = 1): void {
    const n = Math.round(9 * power * this.particleMul);
    for (let i = 0; i < n; i++) {
      if (this.count >= MAX_PARTICLES) return;
      const i0 = this.count++;
      // éventail déterministe (pas de Math.random) : la gerbe est rejouable
      const a = (i / (n || 1)) * Math.PI * 2;
      const sp = 55 + (i % 5) * 22;
      this.px[i0] = x;
      this.py[i0] = y;
      this.vx[i0] = Math.cos(a) * sp;
      this.vy[i0] = Math.sin(a) * sp - 35;
      this.life[i0] = 0.42 + (i % 3) * 0.1;
      this.maxLife[i0] = this.life[i0];
      const p = this.parts[i0];
      p.tint = color;
      p.scaleX = 0.45;
      p.scaleY = 0.45;
    }
  }

  /** Nombre flottant (pommes gagnées, points). Pool circulaire, jamais de `new`. */
  float(x: number, y: number, label: string, color: number): void {
    const slot = this.floaters[this.floaterNext % MAX_FLOATERS];
    this.floaterNext++;
    slot.text.text = label;
    slot.text.style.fill = color;
    slot.text.position.set(x, y);
    slot.text.alpha = 1;
    slot.text.visible = true;
    slot.vy = -62;
    slot.life = 0.9;
  }

  update(dt: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.count;
        this.px[i] = this.px[last];
        this.py[i] = this.py[last];
        this.vx[i] = this.vx[last];
        this.vy[i] = this.vy[last];
        this.life[i] = this.life[last];
        this.maxLife[i] = this.maxLife[last];
        const a = this.parts[i];
        const b = this.parts[last];
        a.tint = b.tint;
        a.scaleX = b.scaleX;
        a.scaleY = b.scaleY;
        b.x = -9999;
        b.y = -9999;
        continue;
      }
      this.vy[i] += 320 * dt; // gravité douce : la gerbe retombe, elle n'explose pas
      this.vx[i] -= this.vx[i] * 1.7 * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      const p = this.parts[i];
      p.x = this.px[i];
      p.y = this.py[i];
      p.alpha = this.life[i] / this.maxLife[i];
    }

    for (let i = 0; i < MAX_FLOATERS; i++) {
      const f = this.floaters[i];
      if (f.life <= 0) continue;
      f.life -= dt;
      f.text.y += f.vy * dt;
      f.text.alpha = Math.max(0, f.life / 0.9);
      if (f.life <= 0) f.text.visible = false;
    }
  }

  /** Vide tout : appelé à la sortie d'un micro-jeu. */
  clear(): void {
    for (let i = 0; i < this.count; i++) {
      this.parts[i].x = -9999;
      this.parts[i].y = -9999;
    }
    this.count = 0;
    for (const f of this.floaters) {
      f.life = 0;
      f.text.visible = false;
    }
  }
}
