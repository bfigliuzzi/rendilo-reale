// §3.6 — `ant` : Le géant et la fourmi (side · asym · temps réel).
//
// Modèle PUR (contrat de `core/minigame.ts`) : ni horloge, ni `Math.random`,
// ni DOM, ni Pixi, ni import de `view.ts` — seul `mulberry32` (seedé par
// `ctx.seed`) décide qui commence fourmi. Tout le reste avance uniquement
// quand `update(dt)` est appelé, ce qui permet au bot de rejouer une manche
// entière hors de la page et d'exiger un résultat identique à entrées égales
// (§7, « déterminisme du modèle »).
//
// POINT DUR DU JEU : `ANT_BLOCK_MIN_DIST`. Un bloc ne peut JAMAIS être posé à
// moins de cette distance du CENTRE de la fourmi (`tryDropBlock`) — sans cette
// garde le géant gagne en écrasant, et ce n'est plus un jeu. L'assertion
// `ANT_BLOCK_MIN_DIST > ANT_RADIUS` de `config/balance.ts` garantit qu'une
// pose à distance légale laisse toujours un espace réel entre les deux corps,
// pas seulement entre les deux centres.

import { mulberry32 } from '@shared/rng';
import type { StarLevel } from '../../meta/save';
import {
  ANT_BLOCK_COOLDOWN,
  ANT_BLOCK_LIFE,
  ANT_BLOCK_MAX,
  ANT_BLOCK_MAX_STAR,
  ANT_BLOCK_MIN_DIST,
  ANT_BLOCK_SIZE,
  ANT_RADIUS,
  ANT_ROUND_TIME,
  ANT_SPEED,
  ANT_STAR_SPEED_MUL,
  ANT_SUDDEN_DEATH,
  SIDE_H,
  SIDE_W,
} from '../../config/balance';

/** L'arène EST le repère logique entier (§3.6 : « arène 960×540 »). */
export const ANT_ARENA_W = SIDE_W;
export const ANT_ARENA_H = SIDE_H;

/**
 * Marges verticales : la fourmi (son CENTRE) et tout bloc restent dans
 * `[ANT_Y_MIN, ANT_Y_MAX]`.
 *
 * LA MARGE HAUTE EST LA BANDE DU PANNEAU DU GÉANT (nuage, jauge de recharge,
 * jetons de blocs restants) — et rien d'autre n'y entre : un bloc posé sous le
 * nuage serait un mur qu'on ne voit pas, exactement l'interdit que `?debug`
 * traque dans Berceau.
 *
 * CE N'EST PLUS UNE DEVINETTE SUR LE BANDEAU DU SHELL. La valeur 96 avait été
 * calée à la capture d'écran pour échapper au bandeau de table, qui recouvrait
 * jusqu'à ~114 px logiques du haut du plateau ; `core/shell.ts` RÉSERVE
 * désormais cette bande hors du letterbox (`ctx.safeTop()` le mesure, et vaut
 * 0), donc plus rien n'oblige `ant` à deviner quoi que ce soit. Le nombre est
 * conservé parce qu'il décrit maintenant une vraie contrainte de MISE EN PAGE
 * — le nuage fait 64 px et vit là — et parce que le changer déplacerait les
 * bornes de jeu (`ANT_Y_MIN`, `ANT_DROP_Y_MIN`), donc l'équilibrage mesuré.
 */
export const ANT_TOP_MARGIN = 96;
const BOTTOM_MARGIN = 18;
export const ANT_Y_MIN = ANT_TOP_MARGIN + ANT_RADIUS;
export const ANT_Y_MAX = ANT_ARENA_H - BOTTOM_MARGIN - ANT_RADIUS;
export const ANT_MID_Y = (ANT_Y_MIN + ANT_Y_MAX) / 2;

/** Départ à gauche, fleur à droite (§3.6) — deux LIGNES verticales, pas deux
 *  points : la fourmi peut traverser à n'importe quelle hauteur, sinon le
 *  géant n'aurait qu'un seul point à garder et le duel serait injouable. */
export const ANT_START_X = 88;
export const ANT_FLOWER_X = ANT_ARENA_W - 88;

const ANT_BLOCK_HALF = ANT_BLOCK_SIZE / 2;
/**
 * Bornes du CENTRE d'un bloc : il reste toujours entièrement dans l'arène
 * visible. EXPORTÉES parce que le réticule de visée du clavier doit s'y
 * limiter : `tryDropBlock` clampe le point reçu, donc un réticule qui peut
 * pointer au-delà promet une pose là où le bloc ne tombera pas.
 */
export const ANT_DROP_X_MIN = ANT_BLOCK_HALF;
export const ANT_DROP_X_MAX = ANT_ARENA_W - ANT_BLOCK_HALF;
export const ANT_DROP_Y_MIN = ANT_TOP_MARGIN + ANT_BLOCK_HALF;
export const ANT_DROP_Y_MAX = ANT_ARENA_H - BOTTOM_MARGIN - ANT_BLOCK_HALF;
const BLOCK_X_MIN = ANT_DROP_X_MIN;
const BLOCK_X_MAX = ANT_DROP_X_MAX;
const BLOCK_Y_MIN = ANT_DROP_Y_MIN;
const BLOCK_Y_MAX = ANT_DROP_Y_MAX;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Distance d'un point au rectangle (AABB) le plus proche — 0 si le point est
 *  DANS le rectangle. Aucune racine carrée superflue : un seul `Math.hypot`. */
function distPointToRect(px: number, py: number, rx: number, ry: number, half: number): number {
  const cx = clamp(px, rx - half, rx + half);
  const cy = clamp(py, ry - half, ry + half);
  return Math.hypot(px - cx, py - cy);
}

export interface AntBlock {
  readonly x: number;
  readonly y: number;
  /** Instant de pose (horloge `elapsed`, ne recule jamais) — la vue en dérive
   *  le pop-in ET le clignotement de fin de vie, fonctions closes du temps. */
  readonly bornAt: number;
}

export type AntPhase = 'round' | 'suddenDeath' | 'over';

export interface AntState {
  readonly phase: AntPhase;
  /** 0 = première mi-temps, 1 = seconde (rôles échangés). Sans objet en mort
   *  subite (`phase === 'suddenDeath'`), où les rôles restent ceux de la
   *  seconde mi-temps. */
  readonly half: 0 | 1;
  /** Siège qui contrôle actuellement la fourmi. `1 - antSeat` = le géant. */
  readonly antSeat: 0 | 1;
  /** ⭐⭐ du siège fourmi COURANT — pictogramme visible, jamais un multiplicateur cascché. */
  readonly boosted: boolean;
  /** Plafond de blocs vivants du géant courant (§1.3 : réduit si `boosted`). */
  readonly blockMax: number;
  readonly clock: number;
  readonly elapsed: number;
  readonly ant: { readonly x: number; readonly y: number; readonly prevX: number; readonly prevY: number };
  /** Direction courante appliquée par la fourmi, dans `[-1,1]` — pur affichage
   *  (flèche/orientation), la vue ne fait qu'en dériver un dessin. */
  readonly antInputX: number;
  readonly antInputY: number;
  readonly blocks: readonly AntBlock[];
  readonly cooldownLeft: number;
  /** Score total « traversées en tant que fourmi » de chaque SIÈGE, cumulé
   *  sur tout le match (§3.6 : « le score le plus élevé en tant que fourmi »). */
  readonly scores: readonly [number, number];
  /** Instant de la dernière traversée, `-Infinity` si aucune — fx de la vue. */
  readonly crossFlashAt: number;
  readonly over: boolean;
}

export class AntModel {
  private phase: AntPhase = 'round';
  private half: 0 | 1 = 0;
  private curAntSeat: 0 | 1;
  private clock = ANT_ROUND_TIME;
  private elapsed = 0;

  private ax: number;
  private ay: number;
  private aPrevX: number;
  private aPrevY: number;
  private inputX = 0;
  private inputY = 0;

  private readonly blocks: AntBlock[] = [];
  private cooldown = 0;

  private readonly scores: [number, number] = [0, 0];
  private crossFlashAt = -Infinity;

  /** Vrai si la mort subite s'est terminée par l'horloge (le géant a tenu),
   *  faux si c'est une traversée qui a tranché — seule la PHRASE de `result`
   *  en dépend, jamais le vainqueur (déjà déterminé par `scores`). */
  private suddenDeathHoldout = false;
  private hadSuddenDeath = false;

  /**
   * @param seed  Tiré par le shell, rejouable : décide seulement qui commence
   *              fourmi (§3.6 ne fixe pas l'ordre). Aucun `Math.random`.
   * @param stars Niveaux ⭐ des deux sièges (§1.3). Seul celui du siège FOURMI
   *              compte à un instant donné : il accélère la fourmi ET réduit
   *              le plafond de blocs du géant d'en face (les deux effets
   *              annoncés par un pictogramme, jamais un nombre caché).
   */
  constructor(
    readonly seed: number,
    readonly stars: readonly [StarLevel, StarLevel],
  ) {
    const rand = mulberry32(seed);
    this.curAntSeat = rand() < 0.5 ? 0 : 1;
    this.ax = ANT_START_X;
    this.ay = ANT_MID_Y;
    this.aPrevX = this.ax;
    this.aPrevY = this.ay;
  }

  get antSeat(): 0 | 1 {
    return this.curAntSeat;
  }

  get giantSeat(): 0 | 1 {
    return this.curAntSeat === 0 ? 1 : 0;
  }

  /*
   * CONVENTION ⭐ DE LA COLLECTION (posée en tête de `core/minigame.ts`) : c'est
   * `stars === 1` qui désigne le joueur AIDÉ — ⭐ se lit « un coup de plus » sur
   * l'accueil, ⭐⭐ « sans coup de plus ». Ce jeu lisait `=== 2`, donc l'aide
   * partait au mauvais enfant : exactement la panne du §1.3 (« le grand crie à
   * la triche, le petit ne comprend pas sa victoire »).
   * Et le handicap ne s'applique QUE si les deux réglages diffèrent : une aide
   * donnée aux deux n'en est plus une.
   */
  private get boosted(): boolean {
    return this.stars[0] !== this.stars[1] && this.stars[this.curAntSeat] === 1;
  }

  private get blockMax(): number {
    return this.boosted ? ANT_BLOCK_MAX_STAR : ANT_BLOCK_MAX;
  }

  private get antSpeed(): number {
    return ANT_SPEED * (this.boosted ? ANT_STAR_SPEED_MUL : 1);
  }

  /**
   * Instantané RÉUTILISÉ d'une frame à l'autre. `state` est lu à 60 Hz par
   * `update()` ET par la vue : renvoyer un littéral neuf allouait deux objets
   * par appel, ce que le §6 interdit aux trois jeux temps réel (« zéro
   * allocation dans les `update()` »). Personne ne conserve la référence
   * au-delà de la frame courante — `index.ts` et `view.ts` n'en lisent que des
   * scalaires — et `blocks`/`scores` étaient DÉJÀ les tableaux vivants : cet
   * objet n'a jamais été un instantané figé, il est seulement devenu franc.
   */
  private readonly snapAnt = { x: 0, y: 0, prevX: 0, prevY: 0 };
  private readonly snap = {
    phase: 'round' as AntPhase,
    half: 0 as 0 | 1,
    antSeat: 0 as 0 | 1,
    boosted: false,
    blockMax: 0,
    clock: 0,
    elapsed: 0,
    ant: this.snapAnt,
    antInputX: 0,
    antInputY: 0,
    blocks: this.blocks as readonly AntBlock[],
    cooldownLeft: 0,
    scores: this.scores as readonly [number, number],
    crossFlashAt: 0,
    over: false,
  };

  get state(): AntState {
    const s = this.snap;
    s.phase = this.phase;
    s.half = this.half;
    s.antSeat = this.curAntSeat;
    s.boosted = this.boosted;
    s.blockMax = this.blockMax;
    s.clock = this.clock;
    s.elapsed = this.elapsed;
    this.snapAnt.x = this.ax;
    this.snapAnt.y = this.ay;
    this.snapAnt.prevX = this.aPrevX;
    this.snapAnt.prevY = this.aPrevY;
    s.antInputX = this.inputX;
    s.antInputY = this.inputY;
    s.cooldownLeft = this.cooldown > 0 ? this.cooldown : 0;
    s.crossFlashAt = this.crossFlashAt;
    s.over = this.phase === 'over';
    return s;
  }

  /**
   * Pose l'entrée courante de la fourmi (joystick tenu ou touches enfoncées),
   * normalisée à une longueur ≤ 1 pour qu'une diagonale au clavier n'aille pas
   * plus vite qu'un cardinal. Le SEUL verbe de la fourmi (§3.6).
   */
  setAntInput(x: number, y: number): void {
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.inputX = x;
    this.inputY = y;
  }

  /** Reflet exact de la garde appliquée par `tryDropBlock` — c'est CE
   *  booléen qui doit désactiver le bouton DOM du géant (§1.1 critère 2). */
  canDrop(): boolean {
    return this.phase !== 'over' && this.cooldown <= 0 && this.blocks.length < this.blockMax;
  }

  /**
   * Le géant tape n'importe où dans l'arène (§3.6). Refuse SILENCIEUSEMENT
   * (aucun message, aucun état d'erreur créé) si le cooldown n'est pas
   * écoulé, si le plafond est atteint, OU si le point tombe à moins de
   * `ANT_BLOCK_MIN_DIST` du centre de la fourmi — LA garde non négociable.
   *
   * @returns `true` si le bloc a réellement été posé.
   */
  tryDropBlock(x: number, y: number): boolean {
    if (!this.canDrop()) return false;
    const bx = clamp(x, BLOCK_X_MIN, BLOCK_X_MAX);
    const by = clamp(y, BLOCK_Y_MIN, BLOCK_Y_MAX);
    if (distPointToRect(this.ax, this.ay, bx, by, ANT_BLOCK_HALF) < ANT_BLOCK_MIN_DIST) return false;
    this.blocks.push({ x: bx, y: by, bornAt: this.elapsed });
    this.cooldown = ANT_BLOCK_COOLDOWN;
    return true;
  }

  /**
   * Un pas de la fourmi est-il refusé ? `fromX/fromY` est la position AVANT ce
   * pas (l'axe est résolu séparément, cf. `update`).
   *
   * FILET DE SÉCURITÉ, mesuré au fuzz : si la fourmi se retrouve DÉJÀ en
   * chevauchement avec un bloc, un refus sec la GÈLE sur place jusqu'à
   * l'expiration du bloc (8 s) — toutes les positions voisines sont elles aussi
   * en chevauchement. On autorise donc toujours un pas qui ÉLOIGNE d'un bloc
   * déjà pénétré : la fourmi s'en extrait, elle ne s'y noie pas. Le cas nominal
   * (pas d'entrée dans un bloc) est inchangé.
   */
  private blockedAt(x: number, y: number, fromX: number, fromY: number): boolean {
    if (x < ANT_RADIUS || x > ANT_ARENA_W - ANT_RADIUS) return true;
    if (y < ANT_Y_MIN || y > ANT_Y_MAX) return true;
    // Boucle INDEXÉE et non `for…of` : `blockedAt` est appelée deux fois par
    // frame depuis `update()`, et un `for…of` sur un tableau construit un
    // itérateur à chaque passage — l'allocation par tick que le §6 interdit
    // aux trois jeux temps réel. Les autres boucles chaudes du fichier
    // (expiration des blocs, nettoyage de `resetAnt`) étaient déjà indexées ;
    // celle-ci était la seule à ne pas l'être.
    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      const d = distPointToRect(x, y, b.x, b.y, ANT_BLOCK_HALF);
      if (d >= ANT_RADIUS) continue;
      const d0 = distPointToRect(fromX, fromY, b.x, b.y, ANT_BLOCK_HALF);
      if (d0 < ANT_RADIUS && d > d0) continue; // extraction : on s'éloigne
      return true;
    }
    return false;
  }

  /**
   * Réapparition au départ (traversée marquée, mi-temps, mort subite).
   *
   * LA GARDE `ANT_BLOCK_MIN_DIST` VAUT AUSSI POUR L'APPARITION : sans ce
   * nettoyage, le géant campait la ligne de départ et la fourmi réapparaissait
   * DANS un bloc, donc immobilisée jusqu'à son expiration — exactement l'« il
   * gagne en écrasant » que la garde existe pour interdire (trouvé au fuzz :
   * fourmi à 7 px du bloc après un but, gelée 8 s). Le bloc fautif s'évapore,
   * ce qui se lit à l'écran et reste la MÊME règle qu'au dépôt.
   */
  private resetAnt(): void {
    this.ax = ANT_START_X;
    this.ay = ANT_MID_Y;
    this.aPrevX = this.ax;
    this.aPrevY = this.ay;
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i];
      if (distPointToRect(this.ax, this.ay, b.x, b.y, ANT_BLOCK_HALF) >= ANT_BLOCK_MIN_DIST) continue;
      this.blocks[i] = this.blocks[this.blocks.length - 1];
      this.blocks.pop();
    }
  }

  /** Coupe l'entrée en cours — appelée au SEUL changement de rôle, jamais
   *  après un but : le joueur qui tient encore son joystick doit repartir sans
   *  avoir à le relâcher, alors qu'un nouveau siège fourmi ne doit pas hériter
   *  de la direction de l'ancien. */
  private resetInput(): void {
    this.inputX = 0;
    this.inputY = 0;
  }

  /** `dt` fixe (60 Hz, `@shared/loop`). No-op une fois la manche terminée. */
  update(dt: number): void {
    if (this.phase === 'over') return;
    this.elapsed += dt;
    this.clock = Math.max(0, this.clock - dt);
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);

    // Blocs expirés (§3.6, `ANT_BLOCK_LIFE`) : swap-remove, au plus 6 entrées.
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      if (this.elapsed - this.blocks[i].bornAt >= ANT_BLOCK_LIFE) {
        this.blocks[i] = this.blocks[this.blocks.length - 1];
        this.blocks.pop();
      }
    }

    this.aPrevX = this.ax;
    this.aPrevY = this.ay;
    // X puis Y séparément (pattern du bébé de Berceau / de la bille de
    // `plank`) : c'est cette séparation qui fait glisser la fourmi le long
    // d'un bloc au lieu de la clouer net dès qu'elle l'aborde en diagonale.
    const speed = this.antSpeed;
    const nx = this.ax + this.inputX * speed * dt;
    if (!this.blockedAt(nx, this.ay, this.ax, this.ay)) this.ax = nx;
    const ny = this.ay + this.inputY * speed * dt;
    if (!this.blockedAt(this.ax, ny, this.ax, this.ay)) this.ay = ny;

    if (this.ax >= ANT_FLOWER_X) {
      this.scores[this.curAntSeat] += 1;
      this.crossFlashAt = this.elapsed;
      this.resetAnt();
      if (this.phase === 'suddenDeath') {
        this.phase = 'over';
        return;
      }
    }

    if (this.clock <= 0) this.advancePhase();
  }

  private advancePhase(): void {
    if (this.phase === 'round') {
      if (this.half === 0) {
        this.half = 1;
        this.curAntSeat = this.curAntSeat === 0 ? 1 : 0;
        this.clock = ANT_ROUND_TIME;
        this.blocks.length = 0;
        this.cooldown = 0;
        this.resetAnt();
        this.resetInput(); // le nouveau siège fourmi n'hérite pas de la direction de l'ancien
        return;
      }
      // Fin de la seconde mi-temps : les deux sièges ont joué fourmi une fois.
      if (this.scores[0] !== this.scores[1]) {
        this.phase = 'over';
        return;
      }
      // Égalité : mort subite (§3.6, choisie plutôt qu'un départage calculé).
      // Les rôles restent ceux de la seconde mi-temps — aucun troisième échange.
      this.hadSuddenDeath = true;
      this.phase = 'suddenDeath';
      this.clock = ANT_SUDDEN_DEATH;
      this.blocks.length = 0;
      this.cooldown = 0;
      this.resetAnt();
      this.resetInput();
      return;
    }
    if (this.phase === 'suddenDeath') {
      // Aucune traversée n'a tranché avant l'horloge (sinon `update` serait
      // déjà sorti via le `return` du bloc de score) : le géant a tenu.
      this.suddenDeathHoldout = true;
      this.phase = 'over';
    }
  }

  /** `winner` n'est jamais `null` : la mort subite élimine structurellement
   *  l'égalité (§3.6, « choisis la mort subite »). */
  get result(): { winner: 0 | 1; scores: [number, number]; reason: string } {
    const a = this.scores[0];
    const b = this.scores[1];
    const hi = a > b ? a : b;
    const lo = a > b ? b : a;
    // La phrase doit rendre les DEUX barres de l'écran de résultat lisibles
    // (§1.1 critère 4). Dans le seul cas où elles sont ÉGALES — personne n'a
    // traversé en mort subite —, elle dit précisément pourquoi il y a quand
    // même un vainqueur ; sinon elle chiffre l'écart.
    if (this.suddenDeathHoldout) {
      return {
        winner: this.giantSeat,
        scores: [a, b],
        reason: `${a} partout : personne ne passe, le géant tient bon`,
      };
    }
    const mot = hi > 1 ? 'traversées' : 'traversée';
    const chiffres = `${hi} ${mot} contre ${lo}`;
    return {
      winner: a > b ? 0 : 1,
      scores: [a, b],
      reason: this.hadSuddenDeath ? `${chiffres}, en mort subite` : chiffres,
    };
  }
}
