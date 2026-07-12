import { Particle, type ParticleContainer, type Texture } from 'pixi.js';
import { lerp, rand } from '@shared/math';
import {
  ARRIVE_FRAC,
  HP_EPSILON,
  MAX_FACTIONS,
  UNIT_CAP,
  UNIT_SPEED,
  UNIT_SPEED_JITTER,
  WOBBLE_FREQ,
  WOBBLE_VEL_MAX,
  WOBBLE_VEL_MIN,
} from '../config/balance';
import type { Faction } from '../config/levels';
import type { Nodes } from './nodes';

const PARK = -9999;

/**
 * Pool SoA des unités en vol (particules Pixi index-verrouillées, comme les
 * ennemis de horde). Vol : ligne droite vers le nœud cible + serpentin latéral,
 * vitesse × speedMul de l'espèce. Chaque unité porte `hp` = puissance de son
 * espèce : c'est à la fois ses PV en combat et sa valeur à l'arrivée.
 * Morts DIFFÉRÉES : `dead=1` pendant les phases arrivée/combat (les index de la
 * grille spatiale restent valides), compactage en une passe via sweepDead().
 */
export class Units {
  count = 0;
  readonly x = new Float32Array(UNIT_CAP);
  readonly y = new Float32Array(UNIT_CAP);
  readonly prevX = new Float32Array(UNIT_CAP);
  readonly prevY = new Float32Array(UNIT_CAP);
  readonly speed = new Float32Array(UNIT_CAP);
  readonly phase = new Float32Array(UNIT_CAP);
  readonly wobble = new Float32Array(UNIT_CAP); // vitesse latérale max du serpentin
  readonly hp = new Float32Array(UNIT_CAP); // PV restants = puissance d'espèce à la naissance
  readonly faction = new Uint8Array(UNIT_CAP);
  readonly dead = new Uint8Array(UNIT_CAP);
  readonly target = new Int16Array(UNIT_CAP);
  readonly byFaction = new Int16Array(MAX_FACTIONS);
  private readonly particles: Particle[] = [];

  /**
   * `texByFaction`/`factionSpeed`/`factionPower` : références possédées par
   * World, REMPLIES à loadLevel (jamais réassignées) — zéro alloc au tick.
   */
  constructor(
    container: ParticleContainer,
    private readonly texByFaction: readonly Texture[],
    private readonly factionSpeed: Float32Array,
    private readonly factionPower: Float32Array,
  ) {
    for (let i = 0; i < UNIT_CAP; i++) {
      const p = new Particle({
        texture: texByFaction[1],
        x: PARK,
        y: PARK,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: 0.5, // sources canvas en supersampling ×2
        scaleY: 0.5,
      });
      this.particles.push(p);
      container.addParticle(p);
    }
  }

  full(): boolean {
    return this.count >= UNIT_CAP;
  }

  spawn(x: number, y: number, f: Faction, targetNode: number): void {
    if (this.count >= UNIT_CAP) return;
    const i = this.count++;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.speed[i] = UNIT_SPEED * this.factionSpeed[f] * rand(1 - UNIT_SPEED_JITTER, 1 + UNIT_SPEED_JITTER);
    this.phase[i] = rand(0, Math.PI * 2);
    this.wobble[i] = rand(WOBBLE_VEL_MIN, WOBBLE_VEL_MAX);
    this.hp[i] = this.factionPower[f];
    this.faction[i] = f;
    this.dead[i] = 0;
    this.target[i] = targetNode;
    this.byFaction[f]++;
    this.particles[i].texture = this.texByFaction[f];
  }

  /** Marque une unité morte (combat ou arrivée) — compactée au sweep. */
  markDead(i: number): void {
    if (this.dead[i]) return;
    this.dead[i] = 1;
    this.byFaction[this.faction[i]]--;
  }

  /** Inflige `dmg` PV ; sous HP_EPSILON l'unité meurt (anti-zombie flottant). */
  hit(i: number, dmg: number): void {
    this.hp[i] -= dmg;
    if (this.hp[i] <= HP_EPSILON) this.markDead(i);
  }

  /**
   * Vol + arrivées. L'effet d'arrivée est résolu contre la faction COURANTE du
   * nœud (un nœud qui a basculé en route devient renfort/cible automatiquement),
   * à hauteur de hp restant / puissance du défenseur : une unité pleine vaut 1
   * chez un allié, une unité blessée vaut sa fraction restante (pas d'exploit
   * de soin en transit), et les puissances se convertissent entre espèces.
   */
  update(dt: number, time: number, nodes: Nodes): void {
    for (let i = 0; i < this.count; i++) {
      if (this.dead[i]) continue;
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      const t = this.target[i];
      let dx = nodes.x[t] - this.x[i];
      let dy = nodes.y[t] - this.y[i];
      const d2 = dx * dx + dy * dy;
      const arriveR = nodes.radius(t) * ARRIVE_FRAC;
      if (d2 <= arriveR * arriveR) {
        nodes.arrive(t, this.faction[i] as Faction, this.hp[i] / this.factionPower[nodes.faction[t]]);
        this.markDead(i);
        continue;
      }
      const inv = 1 / Math.sqrt(d2);
      dx *= inv;
      dy *= inv;
      const lat = Math.sin(time * WOBBLE_FREQ + this.phase[i]) * this.wobble[i];
      this.x[i] += (dx * this.speed[i] - dy * lat) * dt;
      this.y[i] += (dy * this.speed[i] + dx * lat) * dt;
    }
  }

  /** Compactage swap-remove des morts, APRÈS les phases qui utilisent les index. */
  sweepDead(): void {
    for (let i = this.count - 1; i >= 0; i--) {
      if (!this.dead[i]) continue;
      const last = --this.count;
      if (i !== last) {
        this.x[i] = this.x[last];
        this.y[i] = this.y[last];
        this.prevX[i] = this.prevX[last];
        this.prevY[i] = this.prevY[last];
        this.speed[i] = this.speed[last];
        this.phase[i] = this.phase[last];
        this.wobble[i] = this.wobble[last];
        this.hp[i] = this.hp[last];
        this.faction[i] = this.faction[last];
        this.dead[i] = this.dead[last];
        this.target[i] = this.target[last];
        this.particles[i].texture = this.particles[last].texture;
      }
      const p = this.particles[last];
      p.x = PARK;
      p.y = PARK;
    }
  }

  syncRender(alpha: number, container: ParticleContainer): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      p.x = lerp(this.prevX[i], this.x[i], alpha);
      p.y = lerp(this.prevY[i], this.y[i], alpha);
    }
    container.update();
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      p.x = PARK;
      p.y = PARK;
    }
    this.count = 0;
    this.byFaction.fill(0);
  }
}
