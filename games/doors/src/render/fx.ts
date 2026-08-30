import { Container, Particle, Text } from 'pixi.js';
import type { ParticleContainer, Texture } from 'pixi.js';
import { PALETTE } from './textures';

/**
 * Effets : gerbes de particules et nombres flottants. Pool SoA à swap-remove,
 * particules Pixi index-verrouillées, garées hors écran quand mortes — ZÉRO
 * allocation dans le tick (invariant du repo).
 *
 * Les nombres flottants sont le SEUL canal qui chiffre un coup à l'écran ; le
 * miroir texte du HUD les répète pour les lecteurs d'écran, donc les couper en
 * mouvement réduit ne retire aucune information.
 */
const MAX_PARTICLES = 240;
const MAX_FLOATERS = 12;

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
  private floaterCount = 0;

  constructor(
    layer: ParticleContainer,
    private readonly floaterLayer: Container,
    texture: Texture,
  ) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = new Particle({ texture, x: -9999, y: -9999, anchorX: 0.5, anchorY: 0.5 });
      this.parts.push(p);
      layer.addParticle(p);
    }
    for (let i = 0; i < MAX_FLOATERS; i++) {
      const t = new Text({
        text: '',
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 26, fontWeight: '900', fill: 0xffffff },
      });
      t.anchor.set(0.5);
      t.visible = false;
      this.floaterLayer.addChild(t);
      this.floaters.push({ text: t, vy: 0, life: 0 });
    }
  }

  /** Gerbe d'impact. `power` module le nombre de grains, jamais leur vitesse. */
  burst(x: number, y: number, color: number, power = 1): void {
    const n = Math.round(10 * power * this.particleMul);
    for (let i = 0; i < n; i++) {
      if (this.count >= MAX_PARTICLES) return;
      const i0 = this.count++;
      // angles répartis en éventail : déterministe, donc rejouable au bot
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      const sp = 60 + (i % 5) * 26;
      this.px[i0] = x;
      this.py[i0] = y;
      this.vx[i0] = Math.cos(a) * sp;
      this.vy[i0] = Math.sin(a) * sp - 40;
      this.life[i0] = 0.45 + (i % 3) * 0.12;
      this.maxLife[i0] = this.life[i0];
      const p = this.parts[i0];
      p.tint = color;
      p.scaleX = p.scaleY = 0.5;
    }
  }

  /** Nombre flottant : dégâts en corail, soins en vert. */
  float(x: number, y: number, label: string, color: number): void {
    const slot = this.floaters[this.floaterCount % MAX_FLOATERS];
    this.floaterCount++;
    slot.text.text = label;
    slot.text.style.fill = color;
    slot.text.x = x;
    slot.text.y = y;
    slot.text.alpha = 1;
    slot.text.scale.set(1);
    slot.text.visible = true;
    slot.vy = -46;
    slot.life = 1;
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
        const tmp = this.parts[i].tint;
        this.parts[i].tint = this.parts[last].tint;
        this.parts[last].tint = tmp;
        this.parts[last].x = -9999;
        this.parts[last].y = -9999;
        continue;
      }
      this.vy[i] += 460 * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      const p = this.parts[i];
      p.x = this.px[i];
      p.y = this.py[i];
      const k = this.life[i] / this.maxLife[i];
      p.alpha = k;
      p.scaleX = p.scaleY = 0.2 + k * 0.4;
    }

    for (const f of this.floaters) {
      if (f.life <= 0) continue;
      f.life -= dt * 1.15;
      f.text.y += f.vy * dt;
      f.vy += 62 * dt;
      f.text.alpha = Math.min(1, f.life * 1.6);
      if (f.life <= 0) f.text.visible = false;
    }
  }

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

/** Teintes des nombres flottants — jamais la couleur seule : le signe suffit. */
export const FLOAT_DAMAGE = PALETTE.ember;
export const FLOAT_HEAL = PALETTE.leaf;
