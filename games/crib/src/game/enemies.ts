import { Particle, type ParticleContainer } from 'pixi.js';
import { lerp } from '@shared/math';
import * as B from '../config/balance';
import type { Atlas } from '../render/textures';
import type { SlowField } from './buildings';
import type { Terrain } from './terrain';

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

  // --- suivi de voie -------------------------------------------------------
  //
  // ⚠️ CHACUN de ces tableaux DOIT être recopié dans le swap-remove de `kill()`.
  // C'est le bug silencieux le plus probable de tout le système de voies : un
  // ennemi qui hérite du `node` de l'occupant précédent se téléporte d'intention
  // en pleine voie, et ça se lit comme « le pathfinding est cassé ».

  /** Voie d'origine, -1 si aucune (spawn de test, recrachat de boss). */
  readonly lane: Int8Array;
  /** Index ABSOLU dans `terrain.nodeX` du prochain waypoint visé. */
  readonly node: Int16Array;
  /** Écartement latéral normalisé [-1..1], multiplié par la demi-largeur de voie. */
  private readonly slotOff: Float32Array;
  /** Vitesse propre (vitesse d'archétype ± jitter), figée à l'apparition. */
  private readonly spd: Float32Array;
  /** Chasse en cours : la cible est le bébé, la voie est momentanément abandonnée. */
  private readonly chase: Uint8Array;
  /** Meilleure distance au bébé depuis le début de la chasse, et temps sans progrès. */
  private readonly lostD: Float32Array;
  private readonly lostT: Float32Array;
  /** Dernière position sur tuile libre : la porte de sortie de toute poussée. */
  private readonly freeX: Float32Array;
  private readonly freeY: Float32Array;
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
    this.lane = new Int8Array(cap);
    this.node = new Int16Array(cap);
    this.slotOff = new Float32Array(cap);
    this.spd = new Float32Array(cap);
    this.chase = new Uint8Array(cap);
    this.lostD = new Float32Array(cap);
    this.lostT = new Float32Array(cap);
    this.freeX = new Float32Array(cap);
    this.freeY = new Float32Array(cap);
    for (let i = 0; i < cap; i++) {
      const body = new Particle({ texture: atlas.enemyByKind[0], x: PARK, y: PARK, anchorX: 0.5, anchorY: 0.62 });
      const shade = new Particle({ texture: atlas.shadow, x: PARK, y: PARK, anchorX: 0.5, anchorY: 0.5, alpha: 0.35 });
      this.bodies.push(body);
      this.shades.push(shade);
      container.addParticle(body);
      shadowContainer.addParticle(shade);
    }
  }

  /**
   * @param lane Voie suivie, ou -1 pour une poursuite libre (recrachat de boss,
   *   `postSpawn` du bot, mode `?stress`).
   * @param node Index ABSOLU du premier waypoint visé (ignoré si `lane < 0`).
   * @param slotOff Écartement latéral normalisé dans la voie.
   */
  spawn(
    kind: number,
    x: number,
    y: number,
    hpMul: number,
    phase: number,
    lane = -1,
    node = 0,
    slotOff = 0,
  ): void {
    if (this.count >= this.cap) return;
    const def = B.ENEMY_KINDS[kind];
    const i = this.count++;
    this.x[i] = this.prevX[i] = this.freeX[i] = x;
    this.y[i] = this.prevY[i] = this.freeY[i] = y;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.hp[i] = def.hp * hpMul;
    this.radius[i] = def.radius;
    this.kind[i] = kind;
    this.face[i] = 1;
    this.lane[i] = lane;
    this.node[i] = node;
    this.slotOff[i] = slotOff;
    this.chase[i] = 0;
    this.lostD[i] = Infinity;
    this.lostT[i] = 0;
    // jitter de vitesse DÉTERMINISTE, dérivé de la phase d'apparition : deux
    // ennemis d'un même rang ne se superposent jamais exactement
    this.spd[i] = def.speed * (1 + (phase * 2 - 1) * B.ENEMY_SPEED_JITTER);
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
      this.lane[i] = this.lane[last];
      this.node[i] = this.node[last];
      this.slotOff[i] = this.slotOff[last];
      this.spd[i] = this.spd[last];
      this.chase[i] = this.chase[last];
      this.lostD[i] = this.lostD[last];
      this.lostT[i] = this.lostT[last];
      this.freeX[i] = this.freeX[last];
      this.freeY[i] = this.freeY[last];
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
   * `target: 'crib'` file au berceau et ne t'englue qu'au passage. Depuis les
   * cartes à voies, une SECONDE couche s'ajoute par-dessus : le trajet.
   *
   * Le point de conception : on n'a PAS réécrit le moteur de déplacement, on a
   * seulement remplacé une cible fixe par une cible MOBILE (le waypoint courant).
   * Le lissage `ENEMY_TURN`, les distances d'arrêt, le flip du regard et le timer de
   * tir du brocoli sont exactement ceux d'avant.
   *
   * Deux subtilités qui ne se devinent pas :
   *
   * ① Le passage au nœud suivant est un PRODUIT SCALAIRE avec la direction sortante,
   *    pas un test de rayon. Un ennemi décalé latéralement tournerait indéfiniment
   *    autour d'un nœud qu'il ne peut pas atteindre.
   * ② La distance d'ARRÊT se mesure sur l'OBJECTIF (le bébé, le berceau, la
   *    barricade), jamais sur le waypoint : un brocoli doit se poster dès qu'il est
   *    à `shootRange` du berceau, où qu'il en soit sur sa voie.
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
    terrain: Terrain,
    slow: SlowField,
    onShoot: (x: number, y: number, tx: number, ty: number) => void,
  ): void {
    for (let i = 0; i < this.count; i++) {
      const def = B.ENEMY_KINDS[this.kind[i]];
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];

      const x = this.x[i];
      const y = this.y[i];
      const heroD = Math.hypot(heroX - x, heroY - y);
      const cribD = Math.hypot(cribX - x, cribY - y);
      const ln = this.lane[i];

      // --- ① la chasse : une mamie quitte sa voie pour venir clouer le bébé.
      // C'est LE levier du joueur — il attire les agrippeuses hors du chemin
      // pendant que ses tours travaillent.
      if (def.target === 'hero') {
        if (this.chase[i] === 0 && heroD <= B.ENEMY_AGGRO_RANGE) {
          this.chase[i] = 1;
          this.lostD[i] = heroD;
          this.lostT[i] = 0;
        } else if (this.chase[i] === 1) {
          if (heroD < this.lostD[i] - 1) {
            this.lostD[i] = heroD;
            this.lostT[i] = 0;
          } else {
            this.lostT[i] += dt;
          }
          // GARDE-FOU : sans ce décrochage, un bébé posté derrière une haie possède
          // une zone sûre PERMANENTE — la horde s'entasse contre le buisson et le
          // jeu est mort comme design.
          if (this.lostT[i] > B.ENEMY_LOST_TIME || heroD > B.ENEMY_AGGRO_DROP) {
            this.chase[i] = 0;
            this.lostD[i] = Infinity;
            this.lostT[i] = 0;
            if (ln >= 0) this.node[i] = terrain.nearestNode(ln, x, y);
          }
        }
      }

      const chasing = this.chase[i] === 1 || (ln < 0 && def.target === 'hero');
      const onLane = ln >= 0 && !chasing;

      // --- ② barricade : résolue PAR LA VOIE, en deux comparaisons. Pas une ligne
      // de géométrie, et une barricade ne peut physiquement pas être contournée sur
      // sa voie — tout l'intérêt des emplacements pré-placés. Les chasseuses
      // l'ignorent : c'est un filtre pour les fonceurs de berceau, règle lisible.
      let blockN = -1;
      if (onLane && def.target === 'crib') {
        const bn = terrain.laneBlockNode[ln];
        if (bn >= 0 && this.node[i] >= bn) blockN = bn;
      }

      // --- ③ cible de PILOTAGE
      let tx: number;
      let ty: number;
      if (blockN >= 0) {
        tx = terrain.laneBlockX[ln];
        ty = terrain.laneBlockY[ln];
      } else if (chasing) {
        tx = heroX;
        ty = heroY;
      } else if (onLane) {
        const n = this.node[i];
        const half = terrain.laneHalf[ln];
        tx = terrain.nodeX[n] + terrain.perpX[n] * this.slotOff[i] * half;
        ty = terrain.nodeY[n] + terrain.perpY[n] * this.slotOff[i] * half;
        const last = terrain.laneStart[ln] + terrain.laneCount[ln] - 1;
        if (n < last) {
          // mesuré depuis SA cible, pas depuis le nœud brut : un ennemi écarté
          // latéralement se pose en amont du plan du nœud et s'y fige à jamais.
          const rx = x - tx;
          const ry = y - ty;
          if (
            rx * terrain.segX[n] + ry * terrain.segY[n] > 0 ||
            rx * rx + ry * ry < B.LANE_NODE_REACH * B.LANE_NODE_REACH
          ) {
            this.node[i] = n + 1;
          }
        }
      } else {
        tx = cribX;
        ty = cribY;
      }

      // --- ④ distance d'ARRÊT, mesurée sur l'objectif
      let go = 1;
      if (blockN >= 0) {
        const bd = Math.hypot(terrain.laneBlockX[ln] - x, terrain.laneBlockY[ln] - y);
        if (bd <= B.BARRICADE_STOP + this.radius[i] + B.BARRICADE_RADIUS) go = 0;
      } else if (def.target === 'hero') {
        if (def.cling && heroD <= this.radius[i] + B.HERO_RADIUS + B.CLING_SLACK) go = 0;
      } else if (def.shootRange > 0) {
        if (cribD <= def.shootRange) go = 0;
      } else if (cribD <= B.CRIB_BITE_RADIUS + this.radius[i]) {
        go = 0;
      }

      const ddx = tx - x;
      const ddy = ty - y;
      const d = Math.hypot(ddx, ddy) || 1;
      // mobiles musicaux : le MEILLEUR ralentissement s'applique, ils ne se
      // multiplient pas — deux mobiles superposés fixeraient la horde sur place et
      // videraient la carte de son enjeu.
      let mul = 1;
      for (let k2 = 0; k2 < slow.slowCount; k2++) {
        const sdx = slow.slowX[k2] - x;
        const sdy = slow.slowY[k2] - y;
        if (sdx * sdx + sdy * sdy <= slow.slowR2[k2]) mul = Math.min(mul, slow.slowMul[k2]);
      }
      const speed = this.spd[i] * mul;

      const k = Math.min(1, dt * B.ENEMY_TURN);
      this.vx[i] += ((ddx / d) * speed * go - this.vx[i]) * k;
      this.vy[i] += ((ddy / d) * speed * go - this.vy[i]) * k;

      let nx = x + this.vx[i] * dt;
      let ny = y + this.vy[i] * dt;
      // hors voie, la poursuite GLISSE le long des obstacles, exactement comme le
      // bébé. Pas d'A*, pas de navmesh : les voies sont larges, les obstacles sont
      // des bandes fines, et une chasseuse qui longe une haie se lit très bien
      // comme « elle contourne ».
      if (!onLane) {
        if (terrain.blockedEnemy(nx, y)) {
          nx = x;
          this.vx[i] *= 0.4;
        }
        if (terrain.blockedEnemy(nx, ny)) {
          ny = y;
          this.vy[i] *= 0.4;
        }
      }
      // filet de sécurité universel : toute poussée (l'aspiration du boss
      // aujourd'hui, n'importe quel souffle demain) est sûre par construction.
      if (terrain.blockedEnemy(nx, ny)) {
        nx = this.freeX[i];
        ny = this.freeY[i];
        this.vx[i] = 0;
        this.vy[i] = 0;
      } else {
        this.freeX[i] = nx;
        this.freeY[i] = ny;
      }
      this.x[i] = nx;
      this.y[i] = ny;

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
          if (heroD <= B.PEA_AIM_RANGE) onShoot(this.x[i], this.y[i], heroX, heroY);
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
