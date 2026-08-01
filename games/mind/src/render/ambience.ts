import { Particle, Sprite } from 'pixi.js';
import type { Container, ParticleContainer, Texture } from 'pixi.js';
import { clamp, lerp, rand } from '@shared/math';
import { DESIGN_H, DESIGN_W } from '../config/balance';
import { PALETTE } from './textures';

const MOTE_CAP = 26;
const PARK = -9999;

/** Mélange linéaire de deux couleurs 0xRRGGBB. */
function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}

/**
 * La couche « vivante » du décor, 100 % non interactive : des motes qui dérivent
 * SOUS le plateau, un halo qui vire du FROID au CHAUD à mesure que le joueur
 * approche du code, et une vignette qui bat aux derniers essais.
 *
 * Le halo chaud/froid rend AMBIANT le retour « tu chauffes » — mais il n'est
 * jamais la seule source de cette information (les marqueurs d'indice la portent
 * en clair), donc aucune dépendance à la perception des couleurs.
 */
export class Ambience {
  private count = 0;
  private readonly x = new Float32Array(MOTE_CAP);
  private readonly y = new Float32Array(MOTE_CAP);
  private readonly prevX = new Float32Array(MOTE_CAP);
  private readonly prevY = new Float32Array(MOTE_CAP);
  private readonly vx = new Float32Array(MOTE_CAP);
  private readonly vy = new Float32Array(MOTE_CAP);
  private readonly motes: Particle[] = [];

  private readonly warmGlow: Sprite;
  private readonly tensionGlow: Sprite;

  /** 0 = aucune piste, 1 = code presque trouvé. */
  private progress = 0;
  private shownProgress = 0;
  private tension = false;
  private pulse = 0;
  reducedMotion = false;

  constructor(glowLayer: Container, moteLayer: ParticleContainer, spark: Texture) {
    // Halo d'ambiance : une simple étincelle démesurément agrandie — un dégradé
    // radial gratuit, sans shader ni Graphics à redessiner.
    this.warmGlow = new Sprite(spark);
    this.warmGlow.anchor.set(0.5);
    this.warmGlow.position.set(DESIGN_W / 2, DESIGN_H * 0.42);
    this.warmGlow.scale.set(46);
    this.warmGlow.alpha = 0.1;
    this.warmGlow.tint = PALETTE.boardEdge;

    this.tensionGlow = new Sprite(spark);
    this.tensionGlow.anchor.set(0.5);
    this.tensionGlow.position.set(DESIGN_W / 2, DESIGN_H / 2);
    this.tensionGlow.scale.set(70);
    this.tensionGlow.alpha = 0;
    this.tensionGlow.tint = PALETTE.lose;

    glowLayer.addChild(this.warmGlow, this.tensionGlow);

    for (let i = 0; i < MOTE_CAP; i++) {
      const p = new Particle({ texture: spark, x: PARK, y: PARK, anchorX: 0.5, anchorY: 0.5 });
      p.scaleX = p.scaleY = rand(0.1, 0.28);
      p.tint = mixColor(PALETTE.boardEdge, PALETTE.cool, rand(0, 1));
      p.alpha = rand(0.25, 0.6);
      this.motes.push(p);
      moteLayer.addParticle(p);
    }
  }

  /** Peuple l'écran de motes. Appelé à chaque début de partie. */
  spawn(): void {
    this.count = this.reducedMotion ? 0 : MOTE_CAP;
    for (let i = 0; i < MOTE_CAP; i++) {
      if (i >= this.count) {
        this.motes[i].x = PARK;
        this.motes[i].y = PARK;
        continue;
      }
      this.x[i] = this.prevX[i] = rand(0, DESIGN_W);
      this.y[i] = this.prevY[i] = rand(0, DESIGN_H);
      this.vx[i] = rand(-9, 9);
      this.vy[i] = rand(-16, -5);
    }
  }

  /** `best` = meilleur nombre de bien placés, `pegs` = longueur du code. */
  setProgress(best: number, pegs: number): void {
    this.progress = pegs > 0 ? clamp(best / pegs, 0, 1) : 0;
  }

  setTension(on: boolean): void {
    this.tension = on && !this.reducedMotion;
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      // enroulement : on recale `prev` avec la position, sinon le rendu
      // interpolerait une traînée d'un bord à l'autre
      if (this.y[i] < -12) {
        this.y[i] = this.prevY[i] = DESIGN_H + 12;
        this.x[i] = this.prevX[i] = rand(0, DESIGN_W);
      }
      if (this.x[i] < -12) this.x[i] = this.prevX[i] = DESIGN_W + 12;
      else if (this.x[i] > DESIGN_W + 12) this.x[i] = this.prevX[i] = -12;
    }
    // le halo suit le progrès en douceur : un saut sec trahirait l'indice
    this.shownProgress = lerp(this.shownProgress, this.progress, Math.min(1, dt * 2.2));
    this.pulse += dt * (this.tension ? 4.4 : 1.2);
  }

  render(alpha: number): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.motes[i];
      p.x = lerp(this.prevX[i], this.x[i], alpha);
      p.y = lerp(this.prevY[i], this.y[i], alpha);
    }

    const t = this.shownProgress;
    this.warmGlow.tint = mixColor(PALETTE.boardEdge, PALETTE.accent, t);
    const breathe = this.reducedMotion ? 0 : Math.sin(this.pulse) * 0.018;
    this.warmGlow.alpha = 0.08 + t * 0.17 + breathe;

    this.tensionGlow.alpha = this.tension ? 0.06 + (Math.sin(this.pulse) * 0.5 + 0.5) * 0.13 : 0;
  }

  clear(): void {
    this.count = 0;
    for (const p of this.motes) {
      p.x = PARK;
      p.y = PARK;
    }
    this.progress = 0;
    this.shownProgress = 0;
    this.tension = false;
    this.tensionGlow.alpha = 0;
  }
}
