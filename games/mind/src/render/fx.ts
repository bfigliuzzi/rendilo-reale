import { Particle, type ParticleContainer, type Texture } from 'pixi.js';
import { lerp, rand } from '@shared/math';
import { RM_PARTICLE_MUL, RM_SHAKE_MUL } from '../config/balance';

const PARK = -9999;
const CAP = 768;
/** Les sources canvas sont en supersampling ×2 : tout s'affiche à la moitié. */
const SPRITE_SCALE = 0.5;

export interface BurstOpts {
  count: number;
  color: number;
  /** Vitesse maximale, en px/s. */
  speed?: number;
  life?: number;
  /** Échelle d'affichage (1 = taille naturelle de la frame). */
  size?: number;
  /** Accélération verticale, en px/s². */
  gravity?: number;
  /** Vitesse de rotation maximale, en rad/s. */
  spin?: number;
  /** Utiliser la frame « confetti » plutôt que l'étincelle. */
  confetti?: boolean;
  /** Direction centrale du cône d'émission (rad). Omis = tout autour. */
  dir?: number;
  /** Demi-ouverture du cône (rad). */
  spread?: number;
  /** Frein appliqué à chaque tick (1 = aucun). */
  drag?: number;
}

/**
 * Pool SoA de particules + screen shake + flash plein écran. Copie locale du
 * pattern d'Essaim (le repo veut deux consommateurs à contrat IDENTIQUE avant de
 * migrer dans `shared/`) étendue de trois choses dont Cerveau a besoin : la
 * GRAVITÉ, la ROTATION et une seconde frame (confetti) prise sur la même source
 * canvas — l'unique draw call est préservé.
 *
 * Zéro allocation au runtime, swap-remove, morts garées à (-9999, -9999).
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
  private readonly rot = new Float32Array(CAP);
  private readonly prevRot = new Float32Array(CAP);
  private readonly spin = new Float32Array(CAP);
  private readonly grav = new Float32Array(CAP);
  private readonly drag = new Float32Array(CAP);
  private readonly particles: Particle[] = [];
  private shakeMag = 0;

  /** Lu par World pour dessiner le voile de flash dans `layers.overlay`. */
  flashColor = 0xffffff;
  private flashLife = 0;
  private flashMax = 1;

  /**
   * Mouvement réduit : on divise le nombre de particules, on coupe le shake et on
   * supprime TOUT flash (WCAG 2.3.1 — risque photosensible). L'information de jeu
   * ne passe jamais par ces effets, elle reste donc intacte.
   */
  reducedMotion = false;

  readonly shakeX = { value: 0 };
  readonly shakeY = { value: 0 };

  constructor(
    private readonly container: ParticleContainer,
    private readonly sparkTex: Texture,
    private readonly confettiTex: Texture,
  ) {
    for (let i = 0; i < CAP; i++) {
      const p = new Particle({ texture: sparkTex, x: PARK, y: PARK, anchorX: 0.5, anchorY: 0.5 });
      this.particles.push(p);
      container.addParticle(p);
    }
  }

  burst(x: number, y: number, opts: BurstOpts): void {
    const speed = opts.speed ?? 160;
    const life = opts.life ?? 0.35;
    const size = opts.size ?? 0.35;
    const gravity = opts.gravity ?? 0;
    const spin = opts.spin ?? 0;
    const dragK = opts.drag ?? (gravity === 0 ? 0.92 : 0.995);
    const spread = opts.spread ?? Math.PI;
    const dir = opts.dir ?? 0;
    const tex = opts.confetti ? this.confettiTex : this.sparkTex;
    const wanted = this.reducedMotion ? Math.ceil(opts.count * RM_PARTICLE_MUL) : opts.count;

    for (let k = 0; k < wanted; k++) {
      if (this.count >= CAP) return;
      const i = this.count++;
      const a = opts.dir === undefined ? rand(0, Math.PI * 2) : dir + rand(-spread, spread);
      const v = rand(0.25, 1) * speed;
      this.x[i] = this.prevX[i] = x;
      this.y[i] = this.prevY[i] = y;
      this.vx[i] = Math.cos(a) * v;
      this.vy[i] = Math.sin(a) * v;
      this.life[i] = this.maxLife[i] = life * rand(0.7, 1.3);
      this.size[i] = size * rand(0.7, 1.3);
      this.rot[i] = this.prevRot[i] = rand(0, Math.PI * 2);
      this.spin[i] = spin === 0 ? 0 : rand(-spin, spin);
      this.grav[i] = gravity;
      this.drag[i] = dragK;
      const p = this.particles[i];
      p.texture = tex;
      p.tint = opts.color;
    }
  }

  shake(magnitude: number): void {
    const m = this.reducedMotion ? magnitude * RM_SHAKE_MUL : magnitude;
    this.shakeMag = Math.max(this.shakeMag, m);
  }

  /**
   * Voile coloré plein écran. L'alpha est PLAFONNÉ et la durée courte : jamais
   * plus d'un éclair par action du joueur, jamais de stroboscope (WCAG 2.3.1).
   */
  flash(color: number, duration = 0.22): void {
    if (this.reducedMotion) return;
    this.flashColor = color;
    this.flashLife = duration;
    this.flashMax = duration;
  }

  /** Alpha courant du voile de flash, plafonné à 0.45. */
  get flashAlpha(): number {
    return this.flashLife <= 0 ? 0 : (this.flashLife / this.flashMax) * 0.45;
  }

  update(dt: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      this.prevRot[i] = this.rot[i];
      this.vy[i] += this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      const d = this.drag[i];
      this.vx[i] *= d;
      this.vy[i] *= d;
      this.rot[i] += this.spin[i] * dt;
      this.life[i] -= dt;
      if (this.life[i] <= 0) this.kill(i);
    }
    this.shakeMag = Math.max(0, this.shakeMag - 42 * dt);
    if (this.flashLife > 0) this.flashLife = Math.max(0, this.flashLife - dt);
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
      this.rot[i] = this.rot[last];
      this.prevRot[i] = this.prevRot[last];
      this.spin[i] = this.spin[last];
      this.grav[i] = this.grav[last];
      this.drag[i] = this.drag[last];
      this.particles[i].tint = this.particles[last].tint;
      this.particles[i].texture = this.particles[last].texture;
    }
    const p = this.particles[last];
    p.x = PARK;
    p.y = PARK;
    p.alpha = 1;
    p.rotation = 0;
  }

  syncRender(alpha: number): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      const t = this.life[i] / this.maxLife[i];
      p.x = lerp(this.prevX[i], this.x[i], alpha);
      p.y = lerp(this.prevY[i], this.y[i], alpha);
      p.rotation = lerp(this.prevRot[i], this.rot[i], alpha);
      // les confettis gardent leur taille et ne s'effacent qu'à la toute fin ;
      // les étincelles rétrécissent — deux lectures distinctes du même pool
      p.alpha = Math.min(1, t * 2.2);
      const s = SPRITE_SCALE * this.size[i] * (this.grav[i] === 0 ? 0.4 + 0.6 * t : 1);
      p.scaleX = s;
      p.scaleY = s;
    }
    this.container.update();
    // jitter recalculé au rendu, jamais dans la sim (le bot doit rester stable)
    this.shakeX.value = this.shakeMag > 0 ? rand(-this.shakeMag, this.shakeMag) : 0;
    this.shakeY.value = this.shakeMag > 0 ? rand(-this.shakeMag, this.shakeMag) : 0;
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      p.x = PARK;
      p.y = PARK;
      p.rotation = 0;
    }
    this.count = 0;
    this.shakeMag = 0;
    this.flashLife = 0;
    this.shakeX.value = 0;
    this.shakeY.value = 0;
  }
}
