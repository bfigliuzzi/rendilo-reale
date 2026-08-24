import { Container, Graphics, Sprite } from 'pixi.js';
import { lerp } from '@shared/math';
import * as B from '../config/balance';
import { PALETTE, type Atlas } from '../render/textures';
import type { Terrain } from './terrain';

/** Sortie de `suck()`, préallouée : zéro allocation dans le tick. */
export interface Pull {
  x: number;
  y: number;
  grip: number;
}

/** Phases du Robot ménager. `approach` est aussi l'état des deux autres boss. */
type BossPhase = 'approach' | 'telegraph' | 'dash' | 'recover';

/**
 * LES BOSS. Trois archétypes, trois contre-jeux — voir `BOSS_KINDS` pour le
 * pourquoi. Ils partagent tout le socle (PV, barre de HUD, arrivée hors champ par
 * une voie, rage, rendu, prime) et ne divergent que dans `update`.
 *
 * L'ASPIRATEUR (comportement historique). Deux mécaniques, et toutes les deux se
 * contrent au déplacement seul — c'est la contrainte que le boss devait respecter :
 *
 *  1. son cône d'aspiration TIRE le bébé vers lui et l'englue ;
 *  2. il GOBE les projectiles qui entrent dans le cône — il est donc invulnérable
 *     de face, il faut le contourner.
 *
 * L'embout ne pointe pas bêtement vers sa cible : il PIVOTE vers le bébé à
 * `BOSS_TURN` rad/s. Comme un char. Tourner autour de lui de près bat sa rotation,
 * tourner de loin non — la contre-attaque est donc « rentre dans la zone et
 * strafe », ce qui met le joueur exactement là où les mamies font mal.
 *
 * Le corps, lui, avance imperturbablement vers le berceau : le laisser tranquille
 * n'est jamais une option.
 *
 * LE ROBOT MÉNAGER charge : télégraphe court avec sa ligne dessinée au sol, dash
 * rapide, puis une récupération immobile qui EST la fenêtre de dégâts. Il n'a ni
 * cône ni gobage — sa défense, c'est de te faire reculer.
 *
 * LA MACHINE À LAVER se gare sur le berceau et pulse des anneaux de mousse
 * complets. On ne les esquive pas, on passe ENTRE deux mousses ; et comme rien ne
 * la fait taire, il faut du DPS soutenu, donc des tours.
 */
export class Boss {
  active = false;
  x = 0;
  y = 0;
  prevX = 0;
  prevY = 0;
  hp = 0;
  maxHp = 0;
  /** Index dans `BOSS_KINDS`. */
  kind = 0;
  radius = B.BOSS_RADIUS;
  /** Direction de l'embout, en radians (0 = vers +X). */
  angle = -Math.PI / 2;
  private prevAngle = -Math.PI / 2;
  private dustT = 0;
  private phase: BossPhase = 'approach';
  private phaseT = 0;
  /** Direction de charge, figée à la fin du télégraphe. */
  private dashX = 0;
  private dashY = 0;
  /** Compte à rebours du prochain anneau de mousse (Machine à laver). */
  private pulseT = 0;
  /** `true` la frame où un anneau part : World le lit pour tirer la mousse. */
  pulsed = false;
  /** Voie remontée, -1 si aucune (il marche alors droit au berceau). */
  private lane = -1;
  private node = 0;
  /** Compte à rebours du flash d'impact (rendu uniquement). */
  private hitT = 0;

  private readonly sprite: Sprite;
  private readonly shadow: Sprite;

  constructor(
    private readonly atlas: Atlas,
    parent: Container,
  ) {
    this.shadow = new Sprite({ texture: atlas.shadow, anchor: { x: 0.5, y: 0.5 }, alpha: 0.4 });
    this.shadow.scale.set(2.2, 1.1);
    this.sprite = new Sprite({ texture: atlas.bosses[0][0], anchor: { x: 0.5, y: 0.5 } });
    this.sprite.visible = false;
    this.shadow.visible = false;
    parent.addChild(this.shadow, this.sprite);
  }

  get rage(): boolean {
    return this.hp > 0 && this.hp / this.maxHp <= B.BOSS_RAGE_HP;
  }

  private get halfAngle(): number {
    return this.rage ? B.BOSS_RAGE_HALF_ANGLE : B.BOSS_SUCK_HALF_ANGLE;
  }

  get def(): B.BossDef {
    return B.BOSS_KINDS[this.kind];
  }

  /** `true` pendant la charge : le contact englue lourdement. */
  get charging(): boolean {
    return this.phase === 'dash';
  }

  /** Fenêtre de dégâts du Robot : il est immobile et sans défense. */
  get telegraphing(): boolean {
    return this.phase === 'telegraph';
  }

  spawn(
    kind: number,
    x: number,
    y: number,
    hp: number,
    cribX: number,
    cribY: number,
    lane: number,
    node: number,
  ): void {
    this.active = true;
    this.kind = kind;
    this.radius = B.BOSS_KINDS[kind].radius;
    this.phase = 'approach';
    this.phaseT = B.BLENDER_CHARGE_INTERVAL;
    this.pulseT = B.WASHER_PULSE_INTERVAL;
    this.pulsed = false;
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.hp = this.maxHp = hp;
    this.lane = lane;
    this.node = node;
    this.angle = this.prevAngle = Math.atan2(cribY - y, cribX - x);
    this.dustT = B.BOSS_DUST_INTERVAL;
    this.hitT = 0;
    this.sprite.visible = true;
    this.shadow.visible = true;
  }

  damage(n: number): void {
    if (!this.active || this.hp <= 0) return;
    this.hp -= n;
    this.hitT = 0.12;
    if (this.hp <= 0) this.retire();
  }

  retire(): void {
    this.active = false;
    this.hp = 0;
    this.lane = -1;
    this.sprite.visible = false;
    this.shadow.visible = false;
  }

  update(
    dt: number,
    heroX: number,
    heroY: number,
    cribX: number,
    cribY: number,
    terrain: Terrain,
    onDust: (x: number, y: number) => void,
  ): void {
    if (!this.active) return;
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevAngle = this.angle;
    if (this.hitT > 0) this.hitT -= dt;

    // le corps va au berceau, quoi qu'il arrive — mais désormais PAR SA VOIE. Il ne
    // traverse plus les massifs en diagonale, et son approche est donc plus longue
    // que la ligne droite d'avant : c'est ce qui a obligé à re-mesurer son budget.
    let tx = cribX;
    let ty = cribY;
    if (this.lane >= 0) {
      const n = this.node;
      tx = terrain.nodeX[n];
      ty = terrain.nodeY[n];
      const last = terrain.laneStart[this.lane] + terrain.laneCount[this.lane] - 1;
      const rx = this.x - tx;
      const ry = this.y - ty;
      if (
        n < last &&
        (rx * terrain.segX[n] + ry * terrain.segY[n] > 0 ||
          rx * rx + ry * ry < B.LANE_NODE_REACH * B.LANE_NODE_REACH)
      ) {
        this.node = n + 1;
      }
    }
    const cribD = Math.hypot(cribX - this.x, cribY - this.y) || 1;
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const def = this.def;
    this.pulsed = false;

    // — Robot ménager : approche → télégraphe → charge → récupération.
    if (def.id === 'blender') {
      this.updateBlender(dt, heroX, heroY, cribD, dx, dy, d, terrain);
      return;
    }

    if (cribD > B.CRIB_BITE_RADIUS + this.radius) {
      this.x += (dx / d) * def.speed * dt;
      this.y += (dy / d) * def.speed * dt;
    }

    // — Machine à laver : une fois garée, elle pulse des anneaux complets. Elle
    // pivote quand même vers le bébé, purement pour le rendu (le hublot le suit).
    if (def.id === 'washer') {
      this.pulseT -= dt;
      if (this.pulseT <= 0) {
        this.pulseT = B.WASHER_PULSE_INTERVAL * (this.rage ? 0.7 : 1);
        this.pulsed = true;
      }
    }

    // l'embout pivote vers le bébé, à vitesse angulaire BORNÉE
    const want = Math.atan2(heroY - this.y, heroX - this.x);
    let diff = want - this.angle;
    // normalisation dans [-π, π] : sans elle, le boss fait un tour complet du
    // mauvais côté chaque fois que le bébé traverse la discontinuité de atan2
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = B.BOSS_TURN * dt;
    this.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));

    if (def.id === 'vacuum' && this.rage) {
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = B.BOSS_DUST_INTERVAL;
        for (let k = 0; k < B.BOSS_DUST_COUNT; k++) {
          // recrachés en éventail depuis l'embout, placement DÉTERMINISTE
          const a = this.angle + (k - (B.BOSS_DUST_COUNT - 1) / 2) * 0.4;
          onDust(this.x + Math.cos(a) * (this.radius + 14), this.y + Math.sin(a) * (this.radius + 14));
        }
      }
    }
  }

  /**
   * Le Robot ménager. Le cycle EST le contre-jeu, et l'ordre des phases compte :
   * le télégraphe montre la ligne AVANT que la charge parte, et la récupération
   * laisse une fenêtre franche. Sans elle, il n'y aurait rien à faire de bien.
   *
   * Une charge qui percute un mur s'arrête net et enchaîne la récupération : ça se
   * lit tout seul (« il s'est encastré dans le plan de travail ») et ça évite qu'il
   * finisse à l'intérieur du décor.
   */
  private updateBlender(
    dt: number,
    heroX: number,
    heroY: number,
    cribD: number,
    dx: number,
    dy: number,
    d: number,
    terrain: Terrain,
  ): void {
    const def = this.def;
    this.phaseT -= dt;
    if (this.phase === 'approach') {
      if (cribD > B.CRIB_BITE_RADIUS + this.radius) {
        this.x += (dx / d) * def.speed * dt;
        this.y += (dy / d) * def.speed * dt;
      }
      // il pivote vers le bébé pour VISER : c'est ce pivot qui télégraphie la
      // direction bien avant le marqueur au sol
      this.turnTowards(heroX, heroY, dt, B.BOSS_TURN);
      // Il ne CHARGE qu'une fois arrivé au berceau, ou si le bébé vient le
      // chercher en route. Mesuré : sans cette porte, il passait toute la nuit à
      // faire des allers-retours loin de l'objectif et ne le rongeait JAMAIS — la
      // cuisine se finissait à 298 PV sur 300. Un boss doit menacer ce qu'on
      // défend, pas seulement celui qui défend.
      const heroD = Math.hypot(heroX - this.x, heroY - this.y);
      const arrived = cribD <= B.CRIB_BITE_RADIUS + this.radius + 60;
      if (this.phaseT <= 0 && (arrived || heroD < B.BLENDER_LUNGE_RANGE)) {
        this.phase = 'telegraph';
        this.phaseT = B.BLENDER_TELEGRAPH;
      }
      return;
    }
    if (this.phase === 'telegraph') {
      // il continue de suivre le bébé pendant le télégraphe, mais deux fois moins
      // vite : on peut le semer, à condition de commencer tout de suite
      this.turnTowards(heroX, heroY, dt, B.BOSS_TURN * 0.5);
      if (this.phaseT <= 0) {
        this.dashX = Math.cos(this.angle);
        this.dashY = Math.sin(this.angle);
        this.phase = 'dash';
        this.phaseT = B.BLENDER_DASH_TIME;
        this.dashHit = false;
      }
      return;
    }
    if (this.phase === 'dash') {
      const nx = this.x + this.dashX * B.BLENDER_DASH_SPEED * dt;
      const ny = this.y + this.dashY * B.BLENDER_DASH_SPEED * dt;
      if (terrain.blockedEnemy(nx, ny)) {
        this.phase = 'recover';
        this.phaseT = B.BLENDER_RECOVER;
        return;
      }
      this.x = nx;
      this.y = ny;
      if (this.phaseT <= 0) {
        this.phase = 'recover';
        this.phaseT = B.BLENDER_RECOVER;
      }
      return;
    }
    // récupération : immobile, embout baissé. LA fenêtre.
    if (this.phaseT <= 0) {
      this.phase = 'approach';
      this.phaseT = B.BLENDER_CHARGE_INTERVAL * (this.rage ? 0.65 : 1);
    }
  }

  private turnTowards(tx: number, ty: number, dt: number, rate: number): void {
    const want = Math.atan2(ty - this.y, tx - this.x);
    let diff = want - this.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = rate * dt;
    this.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
  }

  /** Verrou : une charge n'englue qu'UNE fois par passage. */
  private dashHit = false;

  /**
   * `true` la première fois que le bébé est touché par la charge en cours.
   * Consomme le verrou : les appels suivants du même dash renvoient `false`.
   */
  takeDashHit(x: number, y: number): boolean {
    if (this.dashHit || !this.inDashLine(x, y)) return false;
    this.dashHit = true;
    return true;
  }

  /** `true` si (x, y) est sur la ligne de charge en cours. */
  inDashLine(x: number, y: number): boolean {
    if (!this.active || this.phase !== 'dash') return false;
    const dx = x - this.x;
    const dy = y - this.y;
    // projection sur la normale de la direction de charge
    return Math.abs(dx * -this.dashY + dy * this.dashX) <= B.BLENDER_DASH_HALF + B.HERO_RADIUS &&
      dx * this.dashX + dy * this.dashY > -this.radius;
  }

  /** `true` si (bx, by) est dans le cône — donc aspiré, gobé ou englué. */
  inCone(bx: number, by: number): boolean {
    // le gobage et l'aspiration sont la signature de l'ASPIRATEUR : les deux autres
    // boss n'ont pas de cône, et rien ne doit se comporter comme s'ils en avaient un
    if (!this.active || this.def.id !== 'vacuum') return false;
    const dx = bx - this.x;
    const dy = by - this.y;
    const d = Math.hypot(dx, dy);
    if (d > B.BOSS_SUCK_RANGE || d < 1) return false;
    let diff = Math.atan2(dy, dx) - this.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff) <= this.halfAngle;
  }

  /**
   * Aspiration subie par le bébé. Écrit dans `out` (préalloué) : force en px/s vers
   * l'embout, décroissante avec la distance, plus la charge de grip du souffle.
   */
  suck(heroX: number, heroY: number, out: Pull): void {
    out.x = 0;
    out.y = 0;
    out.grip = 0;
    if (!this.inCone(heroX, heroY)) return;
    const dx = this.x - heroX;
    const dy = this.y - heroY;
    const d = Math.hypot(dx, dy) || 1;
    // plus on est près de l'embout, plus ça tire : la zone a un gradient, donc on
    // peut encore s'en sortir depuis le bord
    const force = B.BOSS_SUCK_PULL * (1 - Math.min(1, d / B.BOSS_SUCK_RANGE));
    out.x = (dx / d) * force;
    out.y = (dy / d) * force;
    out.grip = B.BOSS_SUCK_GRIP;
  }

  renderSync(alpha: number, clock: number): void {
    if (!this.active) return;
    const px = lerp(this.prevX, this.x, alpha);
    const py = lerp(this.prevY, this.y, alpha);
    this.sprite.texture = this.atlas.bosses[this.kind][this.rage ? 1 : 0];
    // le sprite est dessiné embout vers le HAUT (= angle -π/2) : on compense pour
    // que l'embout coïncide EXACTEMENT avec l'axe du cône. La Machine à laver, elle,
    // ne pivote PAS : c'est un caisson, et un gros carré incliné se lit comme un bug.
    this.sprite.rotation =
      this.def.id === 'washer' ? 0 : lerp(this.prevAngle, this.angle, alpha) + Math.PI / 2;
    // respiration + roulis, accélérés par la rage : il a l'air d'aspirer
    const rate = this.rage ? 11 : 6;
    const breathe = 1 + Math.sin(clock * rate) * (this.rage ? 0.05 : 0.03);
    this.sprite.scale.set(breathe, 2 - breathe);
    this.sprite.position.set(px, py);
    // flash d'impact : on doit sentir que les cubes portent
    this.sprite.tint = this.hitT > 0 ? 0xffffff : 0xd8d8d8;
    this.shadow.position.set(px, py + 22);
  }

  /**
   * Dessine le cône. Triple codage, comme toute zone de danger du hub : la teinte,
   * un liseré net à la limite exacte, et des arcs qui CONVERGENT vers l'embout —
   * ce dernier signal est du mouvement, donc lisible sans aucune perception des
   * couleurs (WCAG 1.4.1).
   */
  drawCone(g: Graphics, clock: number): void {
    g.clear();
    if (!this.active) return;
    if (this.def.id === 'blender') return this.drawDashLine(g, clock);
    if (this.def.id === 'washer') return this.drawFoamTell(g);
    const half = this.halfAngle;
    const r = B.BOSS_SUCK_RANGE;
    const a0 = this.angle - half;
    const a1 = this.angle + half;

    g.moveTo(this.x, this.y).arc(this.x, this.y, r, a0, a1).lineTo(this.x, this.y);
    g.fill({ color: this.rage ? PALETTE.bossTrim : PALETTE.bossDark, alpha: this.rage ? 0.2 : 0.15 });
    g.stroke({ color: PALETTE.warn, width: 2, alpha: 0.85 });

    // trois arcs qui se rapprochent de l'embout, décalés dans le temps : le sens de
    // l'aspiration se lit sans texte et sans couleur
    for (let k = 0; k < 3; k++) {
      const t = ((clock * 0.55 + k / 3) % 1);
      const rr = r * (1 - t);
      if (rr < 12) continue;
      // même précaution que pour la jauge de grip : un `arc` sans `moveTo` se relie
      // au point courant du chemin et trace une balafre en travers de l'arène
      g.moveTo(this.x + Math.cos(a0) * rr, this.y + Math.sin(a0) * rr);
      g.arc(this.x, this.y, rr, a0, a1);
      g.stroke({ color: PALETTE.hud, width: 2, alpha: 0.1 + 0.3 * t });
    }
  }

  /**
   * Marqueur de la ligne de CHARGE du Robot ménager. Double codage, comme toute
   * zone de danger du hub : une FORME (le couloir à sa largeur exacte de contact)
   * et un MOUVEMENT (le strobe de fin de télégraphe). Jamais la couleur seule.
   */
  private drawDashLine(g: Graphics, clock: number): void {
    if (this.phase !== 'telegraph' && this.phase !== 'dash') return;
    const dirX = this.phase === 'dash' ? this.dashX : Math.cos(this.angle);
    const dirY = this.phase === 'dash' ? this.dashY : Math.sin(this.angle);
    const len = B.BLENDER_DASH_SPEED * B.BLENDER_DASH_TIME;
    const h = B.BLENDER_DASH_HALF;
    const nx = -dirY * h;
    const ny = dirX * h;
    const ex = this.x + dirX * len;
    const ey = this.y + dirY * len;
    // fin de télégraphe : strobe. C'est un signal de MOUVEMENT, lisible sans
    // aucune perception des couleurs (WCAG 1.4.1) — même code que les missiles.
    const imminent = this.phase === 'telegraph' && this.phaseT < B.BLENDER_STROBE_TIME;
    const on = !imminent || Math.floor(clock * 14) % 2 === 0;
    g.moveTo(this.x + nx, this.y + ny)
      .lineTo(ex + nx, ey + ny)
      .lineTo(ex - nx, ey - ny)
      .lineTo(this.x - nx, this.y - ny)
      .closePath()
      .fill({ color: PALETTE.bossTrim, alpha: this.phase === 'dash' ? 0.3 : on ? 0.22 : 0.07 });
    g.moveTo(this.x + nx, this.y + ny).lineTo(ex + nx, ey + ny);
    g.moveTo(this.x - nx, this.y - ny).lineTo(ex - nx, ey - ny);
    g.stroke({ color: PALETTE.ink, width: 2, alpha: 0.55 });
  }

  /**
   * Télégraphe de l'anneau de mousse : un cercle qui se REMPLIT en s'approchant du
   * tir. Une forme qui grandit, pas une teinte qui change.
   */
  private drawFoamTell(g: Graphics): void {
    const t = 1 - Math.min(1, this.pulseT / B.WASHER_PULSE_INTERVAL);
    if (t < 0.55) return;
    const r = this.radius + 6 + (1 - t) * 40;
    g.moveTo(this.x + r, this.y);
    g.arc(this.x, this.y, r, 0, Math.PI * 2);
    g.stroke({ color: PALETTE.bossGlass, width: 3, alpha: 0.25 + t * 0.45 });
  }
}
