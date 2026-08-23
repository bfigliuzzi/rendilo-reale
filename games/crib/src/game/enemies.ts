import { Particle, type ParticleContainer } from 'pixi.js';
import { lerp } from '@shared/math';
import * as B from '../config/balance';
import type { Atlas } from '../render/textures';

const PARK = -9999;

/**
 * Pool SoA des ennemis des bébés.
 *
 * Convention de mort en DEUX TEMPS, comme dans horde : les collisions marquent
 * `hp <= 0` (les index restent stables pendant toute la phase, la grille spatiale
 * n'est jamais périmée), puis `sweepDead()` fait les swap-remove après coup.
 *
 * Chaque slot possède DEUX particules index-verrouillées : le corps et son ombre
 * portée. Elles vivent dans deux `ParticleContainer` distincts pour que toutes les
 * ombres passent sous toutes les entités, quel que soit l'ordre du pool.
 */
export class EnemyPool {
  count = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly hp: Float32Array;
  readonly radius: Float32Array;
  readonly kind: Uint8Array;
  /** Sens du regard, -1 ou 1. Figé quand l'ennemi s'arrête (il ne pivote pas sur place). */
  private readonly face: Int8Array;
  /** Brocoli : compte à rebours avant la prochaine salve de pois. */
  private readonly fireT: Float32Array;
  private readonly bodies: Particle[] = [];
  private readonly shades: Particle[] = [];

  constructor(
    readonly cap: number,
    private readonly container: ParticleContainer,
    private readonly shadowContainer: ParticleContainer,
    private readonly atlas: Atlas,
  ) {
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.prevX = new Float32Array(cap);
    this.prevY = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.hp = new Float32Array(cap);
    this.radius = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.face = new Int8Array(cap);
    this.fireT = new Float32Array(cap);
    for (let i = 0; i < cap; i++) {
      const body = new Particle({ texture: atlas.enemyByKind[0], x: PARK, y: PARK, anchorX: 0.5, anchorY: 0.62 });
      const shade = new Particle({ texture: atlas.shadow, x: PARK, y: PARK, anchorX: 0.5, anchorY: 0.5, alpha: 0.35 });
      this.bodies.push(body);
      this.shades.push(shade);
      container.addParticle(body);
      shadowContainer.addParticle(shade);
    }
  }

  spawn(kind: number, x: number, y: number, hpMul: number, phase: number): void {
    if (this.count >= this.cap) return;
    const def = B.ENEMY_KINDS[kind];
    const i = this.count++;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.hp[i] = def.hp * hpMul;
    this.radius[i] = def.radius;
    this.kind[i] = kind;
    this.face[i] = 1;
    // `phase` désynchronise les tirs d'une même vague : sans lui, six brocolis
    // apparus ensemble tirent en salve parfaitement synchrone, ce qui est
    // in-esquivable ET moche. Déterministe (dérivé de l'index de spawn).
    this.fireT[i] = B.BROCCOLI_INTERVAL[0] + phase * (B.BROCCOLI_INTERVAL[1] - B.BROCCOLI_INTERVAL[0]);
    this.bodies[i].texture = this.atlas.enemyByKind[kind];
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
      this.hp[i] = this.hp[last];
      this.radius[i] = this.radius[last];
      this.kind[i] = this.kind[last];
      this.face[i] = this.face[last];
      this.fireT[i] = this.fireT[last];
      this.bodies[i].texture = this.atlas.enemyByKind[this.kind[last]];
    }
    const body = this.bodies[last];
    const shade = this.shades[last];
    body.x = PARK;
    body.y = PARK;
    shade.x = PARK;
    shade.y = PARK;
  }

  /**
   * Le ciblage est l'axe de design du bestiaire : `target: 'hero'` vient te clouer,
   * `target: 'crib'` file au berceau et ne t'englue qu'au passage.
   *
   * @param onShoot Salve de pois d'un brocoli — remontée en callback, le pool ne
   *   connaît pas la classe `Peas`.
   */
  update(
    dt: number,
    heroX: number,
    heroY: number,
    cribX: number,
    cribY: number,
    onShoot: (x: number, y: number, tx: number, ty: number) => void,
  ): void {
    for (let i = 0; i < this.count; i++) {
      const def = B.ENEMY_KINDS[this.kind[i]];
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];

      const toHero = def.target === 'hero';
      const tx = toHero ? heroX : cribX;
      const ty = toHero ? heroY : cribY;
      const dx = tx - this.x[i];
      const dy = ty - this.y[i];
      const d = Math.hypot(dx, dy) || 1;

      // distance d'arrêt : accroché au bébé, en train de mordre le berceau, ou
      // posté à distance de tir. Un ennemi arrêté garde sa cible dans le viseur.
      let stop: number;
      if (toHero) {
        stop = def.cling ? this.radius[i] + B.HERO_RADIUS + B.CLING_SLACK : 0;
      } else if (def.shootRange > 0) {
        stop = def.shootRange;
      } else {
        stop = B.CRIB_BITE_RADIUS + this.radius[i];
      }

      const go = d > stop ? 1 : 0;
      const k = Math.min(1, dt * B.ENEMY_TURN);
      this.vx[i] += ((dx / d) * def.speed * go - this.vx[i]) * k;
      this.vy[i] += ((dy / d) * def.speed * go - this.vy[i]) * k;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      // seuil de 6 px/s : sinon un ennemi arrêté fait clignoter son flip à l'infini
      if (this.vx[i] > 6) this.face[i] = 1;
      else if (this.vx[i] < -6) this.face[i] = -1;

      if (def.shootRange > 0) {
        this.fireT[i] -= dt;
        if (this.fireT[i] <= 0) {
          // désynchronisation entretenue : l'intervalle repart d'une valeur dérivée
          // de la position, jamais de Math.random (contenu reproductible)
          const jitter = (Math.abs(this.x[i] * 7 + this.y[i] * 13) % 100) / 100;
          this.fireT[i] = B.BROCCOLI_INTERVAL[0] + jitter * (B.BROCCOLI_INTERVAL[1] - B.BROCCOLI_INTERVAL[0]);
          // le bébé à portée ? on le vise. Sinon on bombarde le berceau — c'est ce
          // qui empêche de simplement ignorer un brocoli posté au loin.
          const hd = Math.hypot(heroX - this.x[i], heroY - this.y[i]);
          if (hd <= B.PEA_AIM_RANGE) onShoot(this.x[i], this.y[i], heroX, heroY);
          else onShoot(this.x[i], this.y[i], cribX, cribY);
        }
      }
    }
  }

  /** Swap-remove différé des ennemis marqués morts pendant les collisions. */
  sweepDead(onKill: (x: number, y: number, kind: number) => void): void {
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.hp[i] <= 0) {
        const x = this.x[i];
        const y = this.y[i];
        const kind = this.kind[i];
        this.kill(i);
        onKill(x, y, kind);
      }
    }
  }

  syncRender(alpha: number): void {
    const base = this.atlas.enemyByKind;
    const alt = this.atlas.enemyAlt;
    for (let i = 0; i < this.count; i++) {
      const body = this.bodies[i];
      const shade = this.shades[i];
      const px = lerp(this.prevX[i], this.x[i], alpha);
      const py = lerp(this.prevY[i], this.y[i], alpha);
      // cycle de marche à 2 frames, indexé sur la distance parcourue (donc la
      // cadence suit la vitesse réelle) et déphasé par index pour éviter l'effet
      // « troupe au pas » d'une vague entière
      const travel = Math.abs(this.x[i]) + Math.abs(this.y[i]);
      const k = this.kind[i];
      body.texture = (Math.floor(travel * 0.06) + i) % 2 === 0 ? base[k] : alt[k];
      body.x = px;
      body.y = py;
      // flip X : `scaleX` négatif. Deux frames + un flip valent quatre directions
      // dessinées, pour un coût de rendu nul.
      body.scaleX = this.face[i];
      // dandinement vertical : purement visuel, les collisions restent exactes
      body.scaleY = 1 + Math.sin(travel * 0.09 + i) * 0.05;
      shade.x = px;
      shade.y = py + this.radius[i] * 0.45;
      shade.scaleX = (this.radius[i] / 14) * 0.95;
      shade.scaleY = (this.radius[i] / 14) * 0.5;
    }
    this.container.update();
    this.shadowContainer.update();
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) {
      this.bodies[i].x = PARK;
      this.bodies[i].y = PARK;
      this.shades[i].x = PARK;
      this.shades[i].y = PARK;
    }
    this.count = 0;
  }
}
