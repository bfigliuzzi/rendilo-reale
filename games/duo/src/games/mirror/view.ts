import { Container, Graphics } from 'pixi.js';
import { MIRROR_COURSES, MIRROR_HALF_H, MIRROR_HALF_W, SIDE_H } from '../../config/balance';
import { PALETTE } from '../../render/textures';
import { GAME_LEFT, GAME_RIGHT } from './courses';
import type { MirrorModel } from './model';

/**
 * Vue de « Miroir cassé ». Trois règles reprises de tout le dépôt (pattern
 * `mind/render/boardView.ts`, rappelé au §6) :
 *   ① elle ne MUTE jamais le modèle : elle le lit, point ;
 *   ② toute animation est une FONCTION CLOSE du temps écoulé — un instant
 *      mémorisé (`landedAt`, `respawnPoofAt`, `doorPulseAt`) puis une
 *      progression `p = clamp((time - instant) / durée, 0, 1)`. Rien ne peut
 *      « rester bloqué en cours d'anim », et sauter le temps de trois
 *      secondes redonne directement l'état final cohérent ;
 *   ③ ZÉRO ALLOCATION PAR FRAME. Chaque `Graphics` est PEINT UNE FOIS (au
 *      chargement d'un parcours, ou au changement de l'état qu'il montre) et
 *      seule sa TRANSFORMATION bouge ensuite. Réenregistrer un chemin Pixi à
 *      60 Hz (`clear()` puis `rect/poly/circle`) alloue des instructions de
 *      chemin à chaque frame — c'était le cas de la première version pour la
 *      porte, les fanions et le personnage.
 *
 * Les CONTRÔLES (◀ ▶ ⬆) sont de vrais `<button>` DOM posés par `index.ts` —
 * ce canvas ne dessine QUE le plateau : plateformes, trous, porte, points de
 * contrôle, personnage, et la rangée des 6 portes déjà franchies. Aucune
 * information de jeu n'est requise pour le lire (§1.2) : la porte est
 * toujours visible, le trou toujours sombre.
 */

/**
 * Rangée de progression (§1.1 critère 3 : « un objet qui se remplit »).
 *
 * `PIP_Y` n'est PAS collé en haut du repère logique : le bandeau de table
 * (`.hudbar`) vit en espace ÉCRAN, au-dessus du canvas, et son fond est
 * translucide (`rgba(…, .9)`) — une rangée posée à y=18 se retrouvait peinte
 * SOUS lui et sortait à 10 % d'opacité (mesuré au pixel : le vert `leaf`
 * arrivait en (57,50,34) au lieu de (169,217,127)). 130 px la met sous le
 * bandeau quelle que soit l'échelle du letterbox, et bien au-dessus de tout
 * ce que dessinent les 6 parcours (plateforme la plus haute : y=370, fanion
 * le plus haut : y=316, porte la plus haute : y=300).
 */
const PIP_W = 22;
const PIP_H = 28;
const PIP_GAP = 12;
const PIP_Y = 130;

export class MirrorView {
  readonly root = new Container();
  private readonly voidG = new Graphics();
  private readonly platformsG = new Graphics();
  private readonly checkpointsG = new Graphics();
  private readonly progressG = new Graphics();
  private readonly goalG = new Graphics();
  private readonly poofG = new Graphics();
  private readonly charG = new Graphics();

  private lastCourseIndex = -1;
  private lastFallCount = 0;
  private lastCleared = -1;
  private lastCheckpointX = Number.NaN;
  private lastCheckpointY = Number.NaN;
  private wasGrounded = true;

  private landedAt = -10;
  private respawnPoofAt = -10;
  private doorPulseAt = -10;

  constructor(
    parent: Container,
    private readonly model: MirrorModel,
    private readonly reducedMotion: boolean,
  ) {
    this.root.addChild(
      this.voidG,
      this.platformsG,
      this.checkpointsG,
      this.progressG,
      this.goalG,
      this.poofG,
      this.charG,
    );
    parent.addChild(this.root);

    // Le fond du couloir de jeu : un creux commun à toute la bande centrale.
    // Une plateforme peinte PAR-DESSUS masque son morceau ; ce qui reste
    // sombre EST le trou — aucun calcul de trou à part, aucune allocation
    // par frame pour ça.
    this.voidG.rect(GAME_LEFT, 0, GAME_RIGHT - GAME_LEFT, SIDE_H).fill(PALETTE.bgDeep);

    this.paintCharacter();
    this.paintPoof();
  }

  render(time: number, alpha: number): void {
    const m = this.model;
    // Un seul calcul de « téléportation » (chute OU nouveau parcours) : dans
    // les deux cas, interpoler entre l'ancienne et la nouvelle position
    // dessinerait un trait fantôme en travers de l'écran pendant une frame.
    const teleported = m.courseIndex !== this.lastCourseIndex || m.fallCount !== this.lastFallCount;

    if (m.courseIndex !== this.lastCourseIndex) {
      this.lastCourseIndex = m.courseIndex;
      this.paintPlatforms();
      this.paintGoal();
      // Repeint AUSSI les fanions : deux parcours voisins peuvent avoir le
      // même point de départ (0 et 1 partagent x=290, y=442), et se fier au
      // seul changement de `checkpointX/Y` laisserait les fanions du parcours
      // précédent à l'écran.
      this.paintCheckpoints();
      this.lastCheckpointX = this.model.checkpointX;
      this.lastCheckpointY = this.model.checkpointY;
      this.doorPulseAt = time;
    }
    if (m.fallCount !== this.lastFallCount) {
      this.lastFallCount = m.fallCount;
      this.respawnPoofAt = time;
    }
    // Les fanions ne changent qu'au parcours ou à l'armement d'un point de
    // reprise : on ne repeint alors qu'à ces instants-là, jamais par frame.
    if (m.checkpointX !== this.lastCheckpointX || m.checkpointY !== this.lastCheckpointY) {
      this.lastCheckpointX = m.checkpointX;
      this.lastCheckpointY = m.checkpointY;
      this.paintCheckpoints();
    }
    if (m.coursesCleared !== this.lastCleared) {
      this.lastCleared = m.coursesCleared;
      this.paintProgress();
    }
    if (!this.wasGrounded && m.grounded) this.landedAt = time;
    this.wasGrounded = m.grounded;

    const drawX = teleported ? m.x : m.prevX + (m.x - m.prevX) * alpha;
    const drawY = teleported ? m.y : m.prevY + (m.y - m.prevY) * alpha;

    this.placeGoal(time);
    this.placeCharacter(time, drawX, drawY);
    this.placePoof(time, drawX, drawY);
  }

  // ───────── peintures (rares, jamais par frame) ─────────

  private paintPlatforms(): void {
    const g = this.platformsG.clear();
    const platforms = this.model.course.platforms;
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      // CONTRASTE, calculé et non jugé à l'œil : le corps `panel` ne fait que
      // 1,56:1 sur le vide `bgDeep` — invisible, alors que « où est le sol,
      // où est le trou » EST l'information du jeu. C'est le LISERÉ
      // `panelEdge` (6,6:1 sur le vide, WCAG 1.4.11 demande 3:1) qui porte la
      // frontière : un trait épais sur la surface qu'on foule, et un contour
      // complet pour que les FLANCS d'un trou se lisent aussi.
      g.rect(p.x, p.y, p.w, p.h).fill(PALETTE.panel).stroke({ width: 3, color: PALETTE.panelEdge });
      g.rect(p.x, p.y, p.w, 7).fill(PALETTE.panelEdge);
    }
  }

  private paintCheckpoints(): void {
    const g = this.checkpointsG.clear();
    const cps = this.model.course.checkpoints;
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      const reached =
        Math.abs(cp.respawnX - this.model.checkpointX) < 1 &&
        Math.abs(cp.respawnY - this.model.checkpointY) < 1;
      const poleX = cp.trigger.x + cp.trigger.w / 2;
      const poleTop = cp.respawnY - 36;
      const poleBottom = cp.respawnY + MIRROR_HALF_H;
      g.moveTo(poleX, poleBottom).lineTo(poleX, poleTop).stroke({ width: 3, color: PALETTE.dim });
      // Un fanion PLEIN (atteint) contre un fanion en CONTOUR (pas encore) :
      // la forme/le remplissage porte l'info, jamais la seule couleur (§5).
      if (reached) {
        g.poly([poleX, poleTop, poleX + 20, poleTop + 7, poleX, poleTop + 14]).fill(PALETTE.sky);
      } else {
        g.poly([poleX, poleTop, poleX + 18, poleTop + 6, poleX, poleTop + 12]).stroke({
          width: 2,
          color: PALETTE.dim,
        });
      }
    }
  }

  /**
   * §1.1 critère 3 — « le but est un objet visible en permanence… l'écran
   * doit montrer un objet qui se remplit ». La porte de CE parcours dit où
   * aller ; cette rangée dit combien il en reste. Même FORME que la porte
   * (une arche), pleine quand elle est franchie, en contour sinon : la
   * différence se lit en niveaux de gris, jamais à la seule couleur.
   */
  private paintProgress(): void {
    const g = this.progressG.clear();
    const total = MIRROR_COURSES;
    const span = total * PIP_W + (total - 1) * PIP_GAP;
    const x0 = (GAME_LEFT + GAME_RIGHT - span) / 2;
    for (let i = 0; i < total; i++) {
      const x = x0 + i * (PIP_W + PIP_GAP);
      const done = i < this.model.coursesCleared;
      const r = this.progressArch(g, x, PIP_Y, PIP_W, PIP_H);
      if (done) r.fill(PALETTE.leaf).stroke({ width: 2, color: PALETTE.outline });
      else r.stroke({ width: 2, color: PALETTE.dim });
    }
  }

  private progressArch(g: Graphics, x: number, y: number, w: number, h: number): Graphics {
    return g.roundRect(x, y, w, h, w / 2);
  }

  /** La porte, peinte UNE fois par parcours autour d'un pivot au SOL : la
   *  respiration n'est ensuite qu'un `scale`, jamais un chemin réenregistré. */
  private paintGoal(): void {
    const d = this.model.course.goal;
    const g = this.goalG.clear();
    // Une arche (rectangle à coin arrondi = demi-disque en haut), jamais un
    // simple aplat coloré : la FORME distingue le but de tout autre marqueur.
    g.roundRect(-d.w / 2, -d.h, d.w, d.h, d.w / 2)
      .fill(PALETTE.leaf)
      .stroke({ width: 3, color: PALETTE.outline });
    this.goalG.position.set(d.x + d.w / 2, d.y + d.h);
  }

  private paintCharacter(): void {
    // Repère LOCAL : centre horizontal en 0, pieds en 0 (pivot au sol), tête
    // en -2·HALF_H. L'écrasement d'atterrissage devient un simple `scale`.
    const g = this.charG;
    const w = MIRROR_HALF_W * 2;
    const h = MIRROR_HALF_H * 2;
    g.roundRect(-MIRROR_HALF_W, -h, w, h, w * 0.4)
      .fill(PALETTE.gold)
      .stroke({ width: 2.5, color: PALETTE.outline });
    // Yeux dessinés tournés vers la DROITE ; le regard se retourne par un
    // `scale.x` négatif (le corps est symétrique, rien d'autre à repeindre).
    g.circle(0.5, -h * 0.58, 2.2).fill(PALETTE.outline);
    g.circle(8.5, -h * 0.58, 2.2).fill(PALETTE.outline);
  }

  private paintPoof(): void {
    // Anneau UNITAIRE (rayon 1) : la bouffée de réapparition n'est qu'un
    // `scale` + une `alpha` qui décroissent.
    this.poofG.circle(0, 0, 1).stroke({ width: 0.09, color: PALETTE.dim });
    this.poofG.visible = false;
  }

  // ───────── placements (par frame, mais SANS repeindre) ─────────

  private placeGoal(time: number): void {
    // Respiration continue (fonction PÉRIODIQUE du temps, rien à mémoriser),
    // plus un sursaut ponctuel à l'arrivée sur un nouveau parcours — coupés
    // en mouvement réduit, l'un et l'autre sont purement décoratifs, la
    // porte reste identifiable à sa FORME (une arche) sans eux.
    if (this.reducedMotion) {
      this.goalG.scale.set(1);
      return;
    }
    const breathe = Math.sin(time * 3) * 0.045;
    const burstP = Math.min(1, (time - this.doorPulseAt) / 0.5);
    const burst = (1 - burstP) * 0.16;
    this.goalG.scale.set(1 + breathe + burst);
  }

  private placeCharacter(time: number, cx: number, cyCenter: number): void {
    const landP = this.reducedMotion ? 1 : Math.min(1, (time - this.landedAt) / 0.16);
    const squash = landP < 1 ? Math.sin(landP * Math.PI) * 0.24 : 0;
    this.charG.position.set(cx, cyCenter + MIRROR_HALF_H); // les pieds restent posés
    this.charG.scale.set(this.model.facing * (1 + squash * 0.7), 1 - squash);
  }

  private placePoof(time: number, cx: number, cyCenter: number): void {
    if (this.reducedMotion) return;
    const p = (time - this.respawnPoofAt) / 0.4;
    if (p < 0 || p >= 1) {
      this.poofG.visible = false;
      return;
    }
    this.poofG.visible = true;
    this.poofG.position.set(cx, cyCenter + MIRROR_HALF_H);
    this.poofG.scale.set(6 + p * 20);
    this.poofG.alpha = 1 - p;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
