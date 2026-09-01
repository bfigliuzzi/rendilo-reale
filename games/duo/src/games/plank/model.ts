// §3.1 — `plank` : Le plateau à bille (side · coop · temps réel).
//
// Modèle PUR (contrat de `core/minigame.ts`) : ni horloge, ni `Math.random`,
// ni DOM, ni Pixi, ni import de `view.ts`. Il ne connaît que des nombres et
// n'avance que quand on l'appelle — c'est ce qui permet au bot de rejouer
// 5 000 pas hors de la page et d'exiger un résultat identique au bit près à
// entrées égales (§7, scénario `physics`).
//
// POINT DUR DU JEU : la bille ne doit JAMAIS traverser un mur, à AUCUNE
// vitesse. On avance par SOUS-PAS (`stepBall`), chacun borné à
// `PLANK_SUBSTEP_PX` (un demi-rayon), et chaque sous-pas résout X PUIS Y
// séparément contre tous les murs + le bord du plateau (même technique que
// le bébé de Berceau) — c'est cette séparation qui donne le glissement le
// long d'un mur plutôt qu'un blocage net dès qu'on approche en diagonale.

import type { StarLevel } from '../../meta/save';
import {
  PLANK_ACCEL,
  PLANK_BALL_R,
  PLANK_COURSES,
  PLANK_FRICTION,
  PLANK_STAR_GOAL_MUL,
  PLANK_STAR_HOLE_MUL,
  PLANK_SUBSTEP_PX,
  PLANK_TILT_RETURN,
  PLANK_TIME_LIMIT,
  PLANK_VMAX,
} from '../../config/balance';
import { COURT_H, COURT_W, PLANK_COURSE_DATA, type Disc, type Rect } from './courses';

/** Un parcours prêt à jouer : trous/sortie déjà mis à l'échelle par ⭐ (§1.3). */
interface RuntimeCourse {
  readonly start: { readonly x: number; readonly y: number };
  readonly walls: readonly Rect[];
  readonly holes: readonly Disc[];
  readonly goal: Disc;
}

export interface PlankState {
  /** Position RENDUE (la vue interpole `prevX/prevY` → `x/y` par l'alpha). */
  readonly x: number;
  readonly y: number;
  readonly prevX: number;
  readonly prevY: number;
  /** Inclinaison COURANTE de chaque axe, dans `[-1, 1]` — P0 = X, P1 = Y. */
  readonly tiltX: number;
  readonly tiltY: number;
  /** Index du parcours en cours (0..5). */
  readonly courseIndex: number;
  /** Parcours déjà terminés — c'est le score commun affiché (§3.1). */
  readonly coursesDone: number;
  readonly timeLeft: number;
  /** Horloge qui ne recule JAMAIS : la vue en dérive ses animations (fx de
   *  replacement) sans tenir le moindre minuteur elle-même. */
  readonly elapsed: number;
  /** Instant du dernier replacement au point de contrôle, ou `-Infinity` si
   *  aucun n'a encore eu lieu. Sert UNIQUEMENT au petit fx (§3.1) — la vue en
   *  dérive `elapsed - resetFlashAt` en fonction close du temps. */
  readonly resetFlashAt: number;
  readonly over: boolean;
  /** Géométrie du parcours COURANT, déjà mise à l'échelle par ⭐. */
  readonly walls: readonly Rect[];
  readonly holes: readonly Disc[];
  readonly goal: Disc;
  readonly start: { readonly x: number; readonly y: number };
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Distance circle/rectangle AABB au carré : le classique « point le plus
 *  proche du rectangle », comparé au rayon. Aucune racine carrée nécessaire. */
function circleRectOverlap(cx: number, cy: number, r: number, rect: Rect): boolean {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  return dist2(cx, cy, closestX, closestY) < r * r;
}

export class PlankModel {
  /** L'aide ⭐ est-elle active ? Publié pour que la vue en pose le pictogramme
   *  — un handicap qu'on ne voit pas est un multiplicateur caché (§1.3). */
  readonly assisted: boolean;

  private readonly courses: readonly RuntimeCourse[];

  private x: number;
  private y: number;
  private prevX: number;
  private prevY: number;
  private vx = 0;
  private vy = 0;

  /** Inclinaison APPLIQUÉE (ce que « voit » la physique). */
  private readonly tilt: [number, number] = [0, 0];
  /** Le curseur est-il actuellement tenu (§3.1) ? Sinon il retourne au centre
   *  à `PLANK_TILT_RETURN` par seconde — géré ici, pas côté DOM, pour que le
   *  bot puisse reproduire le geste à seed et suite d'entrées égales. */
  private readonly held: [boolean, boolean] = [false, false];
  /** Cible tenue par le pouce/la touche, dans `[-1, 1]`. */
  private readonly target: [number, number] = [0, 0];

  private courseIndex = 0;
  private coursesDone = 0;
  private clock = PLANK_TIME_LIMIT;
  private elapsed = 0;
  private resetFlashAt = -Infinity;

  /**
   * @param seed  Tiré par le shell (§2.3), rejouable — `plank` n'en a
   *              structurellement aucun usage : les 6 parcours sont écrits à
   *              la main, aucun contenu n'en dérive. Conservé quand même
   *              (propriété de paramètre : le compilateur ne le compte pas
   *              comme un paramètre inutilisé) pour que le constructeur
   *              respecte exactement la même forme que les sept autres jeux.
   * @param stars Niveaux ⭐ des deux sièges (§1.3). ⭐ = le joueur AIDÉ (c'est
   *              le libellé de l'accueil : « un coup de plus »), ⭐⭐ = le
   *              joueur sans aide. `plank` n'a qu'UN seul plateau partagé :
   *              dès que L'UN des deux sièges est ⭐, les trous rétrécissent et
   *              la sortie grandit pour TOUT LE MONDE (`PLANK_STAR_HOLE_MUL` /
   *              `PLANK_STAR_GOAL_MUL`) — la bille est commune, l'aide ne peut
   *              pas être partagée autrement. Et parce qu'elle est invisible
   *              tant qu'on ne la montre pas, `assisted` est publié : la vue en
   *              dessine le pictogramme ⭐ à côté du plateau (§1.3 interdit un
   *              multiplicateur caché).
   */
  constructor(
    readonly seed: number,
    readonly stars: readonly [StarLevel, StarLevel],
  ) {
    const assist = stars[0] === 1 || stars[1] === 1;
    this.assisted = assist;
    const holeMul = assist ? PLANK_STAR_HOLE_MUL : 1;
    const goalMul = assist ? PLANK_STAR_GOAL_MUL : 1;
    this.courses = PLANK_COURSE_DATA.map((c) => ({
      start: c.start,
      walls: c.walls,
      holes: c.holes.map((h) => ({ x: h.x, y: h.y, r: h.r * holeMul })),
      goal: { x: c.goal.x, y: c.goal.y, r: c.goal.r * goalMul },
    }));
    const first = this.courses[0];
    this.x = first.start.x;
    this.y = first.start.y;
    this.prevX = this.x;
    this.prevY = this.y;
  }

  private get course(): RuntimeCourse {
    return this.courses[this.courseIndex];
  }

  /** Les 6 parcours sont finis, OU l'horloge de 90 s est écoulée (§3.1). Une
   *  seule définition, réutilisée par `state.over` ET la garde d'`update` —
   *  les deux ne doivent jamais pouvoir diverger. */
  private isOver(): boolean {
    return this.coursesDone >= PLANK_COURSES || this.clock <= 0;
  }

  // ───────── Lecture ZÉRO ALLOCATION (le chemin chaud : `index.ts`, `view.ts`)
  //
  // `get state()` plus bas construit un OBJET à chaque appel : parfait pour un
  // bot qui inspecte une frame, interdit à 60 Hz (§6, « zéro allocation dans
  // les update() des trois jeux temps réel »). D'où ces accesseurs nus, qui ne
  // renvoient que des primitives ou des références déjà allouées au
  // constructeur.

  get ballX(): number {
    return this.x;
  }
  get ballY(): number {
    return this.y;
  }
  get ballPrevX(): number {
    return this.prevX;
  }
  get ballPrevY(): number {
    return this.prevY;
  }
  get tiltX(): number {
    return this.tilt[0];
  }
  get tiltY(): number {
    return this.tilt[1];
  }
  /** Index du parcours en cours (0..5). */
  get index(): number {
    return this.courseIndex;
  }
  /** Parcours terminés — le score commun affiché (§3.1). */
  get done(): number {
    return this.coursesDone;
  }
  get timeLeft(): number {
    return this.clock;
  }
  /** Horloge qui ne recule jamais : la vue en dérive ses fonctions closes. */
  get elapsedTime(): number {
    return this.elapsed;
  }
  /** Instant du dernier replacement, `-Infinity` si aucun (fx seulement). */
  get flashAt(): number {
    return this.resetFlashAt;
  }
  get over(): boolean {
    return this.isOver();
  }
  get walls(): readonly Rect[] {
    return this.course.walls;
  }
  get holes(): readonly Disc[] {
    return this.course.holes;
  }
  get goal(): Disc {
    return this.course.goal;
  }
  get startPoint(): { readonly x: number; readonly y: number } {
    return this.course.start;
  }

  /**
   * Vue COMPLÈTE d'une frame — ALLOUE. Réservée au bot (§7) et aux tests : le
   * jeu lui-même passe par les accesseurs ci-dessus.
   */
  get state(): PlankState {
    const c = this.course;
    return {
      x: this.x,
      y: this.y,
      prevX: this.prevX,
      prevY: this.prevY,
      tiltX: this.tilt[0],
      tiltY: this.tilt[1],
      courseIndex: this.courseIndex,
      coursesDone: this.coursesDone,
      timeLeft: this.clock,
      elapsed: this.elapsed,
      resetFlashAt: this.resetFlashAt,
      over: this.isOver(),
      walls: c.walls,
      holes: c.holes,
      goal: c.goal,
      start: c.start,
    };
  }

  /**
   * Pose l'entrée courante d'un siège. `held=true` : le curseur suit
   * exactement `raw` (tiré au pouce ou touche enfoncée). `held=false` :
   * l'inclinaison retourne élastiquement à 0 au prochain `update` — c'est
   * `update` qui fait avancer ce retour, jamais cette méthode, pour que
   * l'appelant (DOM ou bot) n'ait qu'à décrire l'état du doigt/de la touche à
   * chaque frame, sans jamais toucher au temps lui-même.
   */
  setTilt(player: 0 | 1, held: boolean, raw = 0): void {
    this.held[player] = held;
    this.target[player] = Math.max(-1, Math.min(1, raw));
  }

  /** `dt` fixe (60 Hz, `@shared/loop`). Ne fait rien si la manche est finie —
   *  c'est cette garde, pas `setPaused`, qui protège le bot d'un appel après
   *  la fin (voir aussi le commentaire de `setPaused` côté `index.ts`). */
  update(dt: number): void {
    // La position PRÉCÉDENTE est posée AVANT toute garde de sortie : le shell
    // continue d'appeler `render(alpha)` avec un alpha qui varie quand la
    // manche est finie ou en pause, et un `prev` resté en arrière ferait
    // osciller la bille entre deux positions pendant tout l'écran de résultat.
    // (Même raison pour `freezePrev`, appelé à la mise en pause.)
    this.prevX = this.x;
    this.prevY = this.y;
    if (this.isOver()) return;
    this.elapsed += dt;
    this.clock = Math.max(0, this.clock - dt);
    if (this.clock <= 0) return; // la bille se fige exactement au dernier instant compté

    this.approach(0, dt);
    this.approach(1, dt);

    this.stepBall(dt);
  }

  /** Fige l'interpolation : `prev` rejoint la position courante. Appelé à la
   *  mise en pause — pendant une pause, `update` ne tourne plus mais
   *  `render(alpha)` si, avec un alpha qui continue de varier. */
  freezePrev(): void {
    this.prevX = this.x;
    this.prevY = this.y;
  }

  /**
   * Remet la manche à son premier parcours, sans rien réallouer (la géométrie
   * déjà mise à l'échelle par ⭐ est conservée). Utilisé par la démonstration
   * (§2.4), qui rejoue le MODÈLE RÉEL en boucle : sans ce retour au départ, la
   * deuxième boucle repartirait du parcours atteint par la première et la
   * démo cesserait d'enseigner le geste qu'elle prétend montrer.
   */
  restart(): void {
    this.courseIndex = 0;
    this.coursesDone = 0;
    this.clock = PLANK_TIME_LIMIT;
    this.elapsed = 0;
    this.resetFlashAt = -Infinity;
    this.tilt[0] = 0;
    this.tilt[1] = 0;
    this.held[0] = false;
    this.held[1] = false;
    this.target[0] = 0;
    this.target[1] = 0;
    // Replacement écrit à la main plutôt qu'un appel à `resetToCheckpoint` :
    // celui-ci arme le fx de chute, or un redémarrage n'est pas une chute.
    const start = this.course.start;
    this.x = start.x;
    this.y = start.y;
    this.prevX = this.x;
    this.prevY = this.y;
    this.vx = 0;
    this.vy = 0;
  }

  private approach(player: 0 | 1, dt: number): void {
    if (this.held[player]) {
      this.tilt[player] = this.target[player];
      return;
    }
    // Retour élastique au centre, fraction/s (`PLANK_TILT_RETURN`) : borné à 1
    // pour qu'un `dt` anormalement grand ne fasse jamais DÉPASSER zéro.
    const rate = Math.min(1, PLANK_TILT_RETURN * dt);
    this.tilt[player] += (0 - this.tilt[player]) * rate;
  }

  private blocked(x: number, y: number): boolean {
    if (x - PLANK_BALL_R < 0 || x + PLANK_BALL_R > COURT_W) return true;
    if (y - PLANK_BALL_R < 0 || y + PLANK_BALL_R > COURT_H) return true;
    const walls = this.course.walls;
    for (let i = 0; i < walls.length; i++) {
      if (circleRectOverlap(x, y, PLANK_BALL_R, walls[i])) return true;
    }
    return false;
  }

  private stepBall(dt: number): void {
    const ax = this.tilt[0] * PLANK_ACCEL;
    const ay = this.tilt[1] * PLANK_ACCEL;
    // Frottement visqueux exprimé en « fraction conservée PAR SECONDE » :
    // élevé à `dt` pour rester correct quel que soit le pas, à `dt` fixe ici
    // (`@shared/loop`) donc parfaitement déterministe d'un appel à l'autre.
    const damp = Math.pow(PLANK_FRICTION, dt);
    let vx = this.vx * damp + ax * dt;
    let vy = this.vy * damp + ay * dt;
    const speed = Math.hypot(vx, vy);
    if (speed > PLANK_VMAX) {
      const k = PLANK_VMAX / speed;
      vx *= k;
      vy *= k;
    }
    this.vx = vx;
    this.vy = vy;

    // SOUS-PAS : au moins `ceil(v*dt / (rayon/2))`, jamais moins d'un — c'est
    // la garde qui interdit tout franchissement de mur (§7 `physics`).
    const travel = Math.hypot(vx, vy) * dt;
    const steps = Math.max(1, Math.ceil(travel / PLANK_SUBSTEP_PX));
    const subDt = dt / steps;

    for (let s = 0; s < steps; s++) {
      // X puis Y séparément (pattern du bébé de Berceau) : c'est cette
      // séparation qui fait glisser la bille le long d'un mur au lieu de la
      // clouer net dès qu'elle l'aborde en diagonale.
      const nx = this.x + this.vx * subDt;
      if (this.blocked(nx, this.y)) this.vx = 0;
      else this.x = nx;

      const ny = this.y + this.vy * subDt;
      if (this.blocked(this.x, ny)) this.vy = 0;
      else this.y = ny;

      if (this.hitHole()) {
        this.resetToCheckpoint();
        return; // un seul événement par frame : le reste du sous-pas est perdu, sans conséquence
      }
      if (this.hitGoal()) {
        this.advanceCourse();
        return;
      }
    }
  }

  private hitHole(): boolean {
    const holes = this.course.holes;
    for (let i = 0; i < holes.length; i++) {
      const h = holes[i];
      if (dist2(this.x, this.y, h.x, h.y) < h.r * h.r) return true;
    }
    return false;
  }

  private hitGoal(): boolean {
    const g = this.course.goal;
    return dist2(this.x, this.y, g.x, g.y) < g.r * g.r;
  }

  /**
   * Replacement au point de contrôle (§3.1) : « sans écran, sans message,
   * avec un petit fx ». Ne touche QUE la position/vitesse de la bille (+ le
   * seul champ dérivé pour le fx, `resetFlashAt`) — l'inclinaison tenue,
   * l'horloge et le compte de parcours restent EXACTEMENT ce qu'ils étaient
   * (vérifié par le bot, §7). Le point de contrôle d'un parcours est
   * TOUJOURS son départ : ces manches durent 20 à 40 s, un second
   * point de contrôle en cours de route n'apporterait rien.
   */
  private resetToCheckpoint(): void {
    const start = this.course.start;
    this.x = start.x;
    this.y = start.y;
    this.prevX = this.x;
    this.prevY = this.y;
    this.vx = 0;
    this.vy = 0;
    this.resetFlashAt = this.elapsed;
  }

  private advanceCourse(): void {
    this.coursesDone++;
    this.courseIndex = Math.min(this.coursesDone, PLANK_COURSES - 1);
    const start = this.course.start;
    this.x = start.x;
    this.y = start.y;
    this.prevX = this.x;
    this.prevY = this.y;
    this.vx = 0;
    this.vy = 0;
  }

  /**
   * `winner: null` — coopératif, personne ne perd (§3.1), donc AUCUNE égalité
   * n'est possible : il n'y a qu'un score, commun aux deux sièges.
   *
   * `reason` porte le compte exigé par le §3.1 (« 4 parcours sur 6 ») ET la
   * CAUSE de l'arrêt (§1.1 critère 4) : sans elle, l'écran de résultat ne dit
   * pas si la manche s'est arrêtée parce que tout était fini ou parce que
   * l'horloge est tombée — les deux se lisent pourtant très différemment.
   */
  get result(): { winner: null; scores: [number, number]; reason: string } {
    const all = this.coursesDone >= PLANK_COURSES;
    return {
      winner: null,
      scores: [this.coursesDone, this.coursesDone],
      reason: all
        ? `${PLANK_COURSES} parcours sur ${PLANK_COURSES} : tout est fini !`
        : `${this.coursesDone} parcours sur ${PLANK_COURSES} : le temps est écoulé`,
    };
  }
}
