import type { Result } from '../../core/minigame';
import {
  MIRROR_COYOTE,
  MIRROR_COURSES,
  MIRROR_GRAVITY,
  MIRROR_HALF_H,
  MIRROR_HALF_W,
  MIRROR_JUMP_VY,
  MIRROR_MOVE_SPEED,
  MIRROR_TIME_LIMIT,
  SIDE_H,
} from '../../config/balance';
import type { StarLevel } from '../../meta/save';
import { COURSES, GAME_LEFT, GAME_RIGHT, type MirrorCourse } from './courses';

/** Rôle courant d'un siège pour le parcours en cours (§3.5 : un verbe chacun). */
export type MirrorRole = 'move' | 'jump';

/** Sous ce Y, le personnage est tombé dans le trou : réapparition immédiate
 *  au dernier point de contrôle (§3.5), sans écran. Marge de quelques
 *  hauteurs de personnage sous le bas de l'écran pour que la chute se VOIE
 *  une poignée de frames avant la reprise, sans jamais devenir un vrai temps
 *  d'attente. */
const FALL_Y = SIDE_H + MIRROR_HALF_H * 3;

/** Tuples figés (zéro allocation à la lecture) : `roleOf` ne fait que choisir
 *  entre les deux, jamais n'en construit un nouveau. */
const ROLES_EVEN: readonly [MirrorRole, MirrorRole] = ['move', 'jump'];
const ROLES_ODD: readonly [MirrorRole, MirrorRole] = ['jump', 'move'];

/**
 * Modèle PUR de « Miroir cassé » (§2.3) : ni horloge, ni `Math.random`, ni
 * DOM, ni Pixi, ni import de `view.ts`. `seed`/`stars` sont acceptés pour
 * respecter la signature commune aux huit modèles (§7,
 * `window.__game.models`) mais ne pilotent rien ici : ce jeu n'a ni contenu
 * tiré au sort (6 parcours écrits à la main, comme `plank`), ni barème ⭐
 * propre — le §3.5 n'en définit aucun, et pour cause : coopératif, les
 * rôles s'échangent déjà à parts égales (chacun saute 3 fois), l'écart d'âge
 * n'a ici rien de spécifique à corriger.
 *
 * PHYSIQUE (le point dur du jeu, §3.5) :
 *   - gravité + AABB, résolution **X PUIS Y séparément** (comme le bébé de
 *     Berceau) : c'est ce découpage qui donne le glissement le long d'un
 *     mur — une résolution combinée collerait le personnage au coin au lieu
 *     de le laisser filer/tomber le long de la face qui le bloque ;
 *   - **pas de saut mural** : `jumpArmed` ne se réarme QU'au sol, jamais au
 *     contact d'un mur latéral ;
 *   - **coyote time** (`MIRROR_COYOTE`) : un saut demandé dans les
 *     `MIRROR_COYOTE` secondes qui suivent la perte du sol reste accepté —
 *     c'est le paramètre qui rend le jeu jouable À DEUX (le sauteur voit
 *     l'autre courir, il ne peut pas viser le pixel exact du bord).
 */
export class MirrorModel {
  private _courseIndex = 0;
  private _coursesCleared = 0;
  private _elapsed = 0;
  private _over = false;
  private _fallCount = 0;
  private _goalPulseCount = 0;

  private _x = 0;
  private _y = 0;
  private _prevX = 0;
  private _prevY = 0;
  private _vx = 0;
  private _vy = 0;
  private _grounded = false;
  private _facing: 1 | -1 = 1;

  private moveDir: -1 | 0 | 1 = 0;
  private airTime = 0;
  private jumpArmed = true;
  private _checkpointX = 0;
  private _checkpointY = 0;

  constructor(
    readonly seed: number,
    readonly stars: readonly [StarLevel, StarLevel],
  ) {
    this.loadCourse(0);
  }

  // ───────── lecture — uniquement des scalaires ou une référence figée,
  // pour que la vue puisse lire à 60 Hz sans jamais allouer. ─────────
  get courseIndex(): number {
    return this._courseIndex;
  }
  get coursesCleared(): number {
    return this._coursesCleared;
  }
  get elapsed(): number {
    return this._elapsed;
  }
  get over(): boolean {
    return this._over;
  }
  get fallCount(): number {
    return this._fallCount;
  }
  get goalPulseCount(): number {
    return this._goalPulseCount;
  }
  get x(): number {
    return this._x;
  }
  get y(): number {
    return this._y;
  }
  get prevX(): number {
    return this._prevX;
  }
  get prevY(): number {
    return this._prevY;
  }
  get vx(): number {
    return this._vx;
  }
  get vy(): number {
    return this._vy;
  }
  get grounded(): boolean {
    return this._grounded;
  }
  get facing(): 1 | -1 {
    return this._facing;
  }
  get checkpointX(): number {
    return this._checkpointX;
  }
  get checkpointY(): number {
    return this._checkpointY;
  }
  /** Table FIGÉE (`COURSES`) : une simple référence, jamais une copie. */
  get course(): MirrorCourse {
    return COURSES[this._courseIndex];
  }

  /** Rôle du siège demandé pour le parcours EN COURS. */
  roleOf(seat: 0 | 1): MirrorRole {
    return (this._courseIndex % 2 === 0 ? ROLES_EVEN : ROLES_ODD)[seat];
  }

  // ───────── écriture ─────────

  /** Bouton ◀ ▶ tenu, ou touche `KeyA`/`KeyD` — un seul verbe, quel que soit
   *  le siège qui le porte ce parcours-ci (§5 : « un verbe chacun »). */
  setMoveDir(dir: -1 | 0 | 1): void {
    this.moveDir = dir;
  }

  /**
   * Tentative de saut : acceptée au sol OU dans la fenêtre de coyote time
   * après l'avoir quitté — jamais au-delà, jamais deux fois de suite en
   * l'air (pas de double-saut, pas de saut mural : `jumpArmed` ne se
   * réarme qu'au contact du SOL, jamais d'un mur latéral).
   *
   * Silencieuse si refusée, à dessein : c'est la transposition au temps réel
   * du critère « coup illégal impossible » (§1.1.2) — ici, l'impossibilité
   * est un état PHYSIQUE (on est en l'air depuis trop longtemps), pas une
   * case à griser, et il n'y a rien à annoncer, exactement comme dans la
   * vraie vie on ne redécolle pas en l'air.
   */
  jump(): boolean {
    if (this._over) return false;
    if (!this.jumpArmed) return false;
    if (!(this._grounded || this.airTime <= MIRROR_COYOTE)) return false;
    this._vy = -MIRROR_JUMP_VY;
    this._grounded = false;
    this.jumpArmed = false;
    return true;
  }

  /** Avance la simulation d'un pas fixe. Le SHELL décide quand (pause). */
  tick(dt: number): void {
    if (this._over) return;
    this._prevX = this._x;
    this._prevY = this._y;
    this._elapsed += dt;
    this.stepPhysics(dt);
    this.checkFall();
    this.checkCheckpoints();
    this.checkGoal();
    if (this._coursesCleared >= MIRROR_COURSES || this._elapsed >= MIRROR_TIME_LIMIT) {
      this._over = true;
    }
  }

  /** La CAUSE, en une phrase courte (§1.1 critère 4) : combien de portes,
   *  jamais « tu as perdu » — ce jeu est coopératif, personne ne perd. */
  get result(): Result {
    const done = this._coursesCleared >= MIRROR_COURSES;
    // « parcours » est invariable, pas « réussi » : 0/1 parcours réussi,
    // 6 parcours réussis. La phrase est lue à voix haute par un adulte à un
    // enfant de 5 ans — une faute d'accord s'entend.
    const n = this._coursesCleared;
    const reason = done
      ? `${MIRROR_COURSES} parcours réussis en ${Math.round(this._elapsed)} s`
      : `${n} parcours ${n > 1 ? 'réussis' : 'réussi'} avant la fin du temps`;
    return { winner: null, scores: [this._coursesCleared, this._coursesCleared], reason };
  }

  // ───────── interne ─────────

  private loadCourse(idx: number): void {
    const c = COURSES[idx];
    this._courseIndex = idx;
    this._x = c.spawn.x;
    this._y = c.spawn.y;
    this._prevX = c.spawn.x;
    this._prevY = c.spawn.y;
    this._checkpointX = c.spawn.x;
    this._checkpointY = c.spawn.y;
    this._vx = 0;
    this._vy = 0;
    this._grounded = false;
    this.airTime = 0;
    this.jumpArmed = true;
    // Un nouveau parcours n'hérite jamais d'une direction en cours : c'est à
    // l'appelant (le wrapper `MiniGame`, ou la démo) de RÉ-APPLIQUER l'état
    // réellement tenu (bouton encore au doigt, touche encore enfoncée) juste
    // après avoir observé un changement de `courseIndex` — sinon un joueur
    // qui garde le bouton appuyé pendant la traversée de la porte se
    // retrouve immobile sur le parcours suivant jusqu'au prochain relâcher.
    this.moveDir = 0;
  }

  private stepPhysics(dt: number): void {
    const platforms = this.course.platforms;

    this._vx = this.moveDir * MIRROR_MOVE_SPEED;
    if (this.moveDir !== 0) this._facing = this.moveDir;

    // ───── X d'abord : un mur arrête net, jamais de glissement à travers. ─────
    let nx = this._x + this._vx * dt;
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (this._y + MIRROR_HALF_H <= p.y || this._y - MIRROR_HALF_H >= p.y + p.h) continue;
      if (nx + MIRROR_HALF_W > p.x && nx - MIRROR_HALF_W < p.x + p.w) {
        if (this._vx > 0) nx = p.x - MIRROR_HALF_W;
        else if (this._vx < 0) nx = p.x + p.w + MIRROR_HALF_W;
        this._vx = 0; // le mur arrête net : que le getter `vx` dise la vérité
      }
    }
    // Bords de la BANDE DE JEU : deux murs invisibles. Les tiers latéraux
    // appartiennent aux boutons DOM des deux sièges (§1.4) et le canvas n'y
    // dessine rien — sans cette borne, le personnage sortait par la droite du
    // dernier parcours, passait SOUS le bouton ⬆ (l'overlay est au-dessus du
    // canvas) puis tombait : une chute qu'on ne voit pas est une punition
    // qu'on ne comprend pas. Bornes de POSITION, jamais d'état : elles ne
    // touchent ni au sol, ni à `jumpArmed` (pas de saut mural).
    if (nx < GAME_LEFT + MIRROR_HALF_W) {
      nx = GAME_LEFT + MIRROR_HALF_W;
      this._vx = 0;
    } else if (nx > GAME_RIGHT - MIRROR_HALF_W) {
      nx = GAME_RIGHT - MIRROR_HALF_W;
      this._vx = 0;
    }
    this._x = nx;

    // ───── Y ensuite, séparément : c'est CE découpage qui donne le
    // glissement le long d'un mur (une résolution combinée collerait le
    // personnage au coin au lieu de le laisser tomber le long de la face
    // qui le bloque à l'horizontale). ─────
    this._vy += MIRROR_GRAVITY * dt;
    let ny = this._y + this._vy * dt;
    let grounded = false;
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (this._x + MIRROR_HALF_W <= p.x || this._x - MIRROR_HALF_W >= p.x + p.w) continue;
      if (ny + MIRROR_HALF_H > p.y && ny - MIRROR_HALF_H < p.y + p.h) {
        if (this._vy > 0) {
          ny = p.y - MIRROR_HALF_H;
          this._vy = 0;
          grounded = true;
        } else if (this._vy < 0) {
          ny = p.y + p.h + MIRROR_HALF_H;
          this._vy = 0;
        }
      }
    }
    this._y = ny;
    this._grounded = grounded;
    if (grounded) {
      this.airTime = 0;
      this.jumpArmed = true;
    } else {
      this.airTime += dt;
    }
  }

  private checkFall(): void {
    if (this._y - MIRROR_HALF_H <= FALL_Y) return;
    this._x = this._checkpointX;
    this._y = this._checkpointY;
    this._prevX = this._checkpointX;
    this._prevY = this._checkpointY;
    this._vx = 0;
    this._vy = 0;
    this._grounded = false;
    this.airTime = MIRROR_COYOTE + 1; // pas de coyote « gratuit » juste après une reprise
    this.jumpArmed = true;
    this._fallCount++;
  }

  private checkCheckpoints(): void {
    const cps = this.course.checkpoints;
    for (let i = 0; i < cps.length; i++) {
      const t = cps[i].trigger;
      if (
        this._x + MIRROR_HALF_W > t.x &&
        this._x - MIRROR_HALF_W < t.x + t.w &&
        this._y + MIRROR_HALF_H > t.y &&
        this._y - MIRROR_HALF_H < t.y + t.h
      ) {
        this._checkpointX = cps[i].respawnX;
        this._checkpointY = cps[i].respawnY;
      }
    }
  }

  private checkGoal(): void {
    const g = this.course.goal;
    if (
      this._x + MIRROR_HALF_W > g.x &&
      this._x - MIRROR_HALF_W < g.x + g.w &&
      this._y + MIRROR_HALF_H > g.y &&
      this._y - MIRROR_HALF_H < g.y + g.h
    ) {
      this._coursesCleared++;
      this._goalPulseCount++;
      if (this._coursesCleared < MIRROR_COURSES) this.loadCourse(this._coursesCleared);
    }
  }
}
