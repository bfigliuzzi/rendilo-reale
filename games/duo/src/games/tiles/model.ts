// §3.4 — `tiles` : Dominos croisés (Domineering) · pass · duel · tour par tour.
//
// P0 pose des dominos VERTICAUX (« debout »), P1 des HORIZONTAUX (« couché »)
// sur une grille 6×6 percée de 2 à 4 cases bloquées (tirées au seed : elles
// cassent l'avantage connu du premier joueur en Domineering classique — sans
// elles, sur une grille vide et symétrique, l'un des deux camps gagne toujours
// avec un jeu parfait). Chacun a une pile visible de 12 tuiles à son bord du
// plateau ; poser en retire une — LA pile qui se vide EST l'objet visible de
// la manche (§1.1 critère 3 : c'est l'exemple même cité par la spec). On joue
// jusqu'à ce que plus personne ne puisse poser : un joueur sans coup légal
// passe automatiquement, l'autre continue ; si les DEUX sont bloqués, la
// manche s'arrête là. Le plus de tuiles posées gagne ; en cas d'égalité
// EXACTE, le dernier à avoir posé l'emporte (règle classique de Domineering,
// qui se lit en clair : « c'est moi qui ai posé la dernière »).
//
// MODÈLE PUR (contrat de `core/minigame.ts`) : ni horloge, ni `Math.random`
// (mulberry32 seedé), ni DOM, ni Pixi, ni import de `view.ts` — rejouable hors
// de la page à seed égal, ce qui permet au bot de vérifier une manche entière
// sans cliquer un seul bouton.
//
// ─────────────────────────────────────────────────────────────────────────
// LE POINT DUR DE CE JEU : LA LÉGALITÉ STRICTE.
//
// Une pose est légale UNIQUEMENT si les DEUX cases qu'elle couvre existent
// dans la grille, et ne sont NI bloquées NI déjà occupées. `isLegalAnchor` est
// la SEULE fonction qui décide de ça — `legalAnchors`, `canPlace` et la
// génération s'appuient tous dessus, jamais une réimplémentation parallèle
// qui pourrait diverger et laisser passer un recouvrement ou une sortie de
// grille. Le départage « dernier posé » ne s'applique QUE si les deux comptes
// sont rigoureusement égaux — jamais en dehors de ce cas (voir `get result`).
// Un joueur dont la pile est vide est traité EXACTEMENT comme un joueur sans
// coup légal (`hasLegalMove`) : passer une pile à zéro sans coup restant ne
// doit pas planter la manche, juste la faire continuer sans lui.
// ─────────────────────────────────────────────────────────────────────────

import { mulberry32 } from '@shared/rng';
import {
  TILES_BLOCKED,
  TILES_COLS,
  TILES_MIN_PLACEMENTS,
  TILES_ROWS,
  TILES_STACK,
  TILES_STAR_PREPLACED,
} from '../../config/balance';
import type { Result } from '../../core/minigame';
import type { StarLevel } from '../../meta/save';

export type Owner = 0 | 1;

export interface Domino {
  /** Case ANCRE : haut pour un domino vertical, gauche pour un horizontal. */
  readonly anchor: number;
  readonly owner: Owner;
  /** ⭐ : posé au départ par la génération, jamais par un joueur — c'est
   *  l'OBJET VISIBLE du handicap (§1.3), jamais un multiplicateur caché. */
  readonly starred: boolean;
}

export interface TilesState {
  readonly cols: number;
  readonly rows: number;
  /** Cases indisponibles (flat, index = `r*cols+c`), tirées au seed. */
  readonly blocked: readonly boolean[];
  /** Qui occupe chaque case, ou `null` si elle est libre. */
  readonly owner: readonly (Owner | null)[];
  /** Dominos posés dans l'ordre, pour le rendu — un domino = un rectangle de
   *  deux cases, jamais deux entités séparées à recoller visuellement. */
  readonly dominoes: readonly Domino[];
  /** À qui de jouer. */
  readonly turn: Owner;
  /** Poses légales pour le joueur COURANT uniquement (flat, sur l'ancre). */
  readonly legal: readonly boolean[];
  /** Tuiles restantes dans la pile de chaque siège. */
  readonly stacks: readonly [number, number];
  /** Tuiles POSÉES par chaque siège, ⭐ de départ incluses. */
  readonly placed: readonly [number, number];
  /** Le joueur qui vient d'être sauté automatiquement faute de coup, ou
   *  `null` — reflète UNIQUEMENT le dernier changement de tour (transitoire,
   *  ne s'accumule pas), pour que la vue puisse l'annoncer une seule fois. */
  readonly skipped: Owner | null;
  readonly over: boolean;
  /** Joueur ⭐ (aidé), `null` si les deux sont au même niveau. */
  readonly helped: Owner | null;
}

/** « debout » (vertical, P0) ou « couché » (horizontal, P1) — le VERBE de la
 *  règle, réutilisé tel quel par la vue et les annonces pour ne jamais avoir
 *  à réécrire ce mapping ailleurs. */
export function orientationWord(player: Owner): 'debout' | 'couché' {
  return player === 0 ? 'debout' : 'couché';
}

export function rowColOf(idx: number, cols: number): [number, number] {
  return [Math.floor(idx / cols), idx % cols];
}

function otherOf(p: Owner): Owner {
  return p === 0 ? 1 : 0;
}

/** La case complémentaire d'une ancre pour l'orientation de `player`. Ne
 *  vérifie PAS les bornes : appeler seulement après un `isLegalAnchor` vrai,
 *  ou en connaissance de cause dans la génération. */
function secondCellOf(player: Owner, idx: number, cols: number): number {
  return player === 0 ? idx + cols : idx + 1;
}

/**
 * LA seule fonction qui décide de la légalité d'une pose — voir l'en-tête du
 * fichier. Une ancre est légale ssi les DEUX cases qu'elle couvrirait existent
 * dans la grille et sont toutes deux libres et non bloquées.
 */
function isLegalAnchor(
  player: Owner,
  idx: number,
  owner: readonly (Owner | null)[],
  blocked: readonly boolean[],
  cols: number,
  rows: number,
): boolean {
  const [r, c] = rowColOf(idx, cols);
  if (player === 0) {
    if (r + 1 >= rows) return false;
  } else if (c + 1 >= cols) {
    return false;
  }
  const second = secondCellOf(player, idx, cols);
  return !blocked[idx] && !blocked[second] && owner[idx] === null && owner[second] === null;
}

function legalAnchors(
  player: Owner,
  owner: readonly (Owner | null)[],
  blocked: readonly boolean[],
  cols: number,
  rows: number,
): number[] {
  const out: number[] = [];
  for (let idx = 0; idx < cols * rows; idx++) {
    if (isLegalAnchor(player, idx, owner, blocked, cols, rows)) out.push(idx);
  }
  return out;
}

/** Fisher-Yates seedé — zéro `Math.random` dans le contenu (contrat §3). */
function shuffle<T>(rand: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

interface GenResult {
  blocked: boolean[];
  owner: (Owner | null)[];
  dominoes: Domino[];
  placed: [number, number];
}

/** 2 à 4 cases bloquées sur 36 laissent toujours largement plus de 6 poses de
 *  chaque côté : cette borne ne devrait jamais être atteinte en pratique.
 *  Si elle l'était, c'est que le tuning a changé sans revoir cette fonction —
 *  d'où l'échec bruyant plutôt qu'un plateau qui violerait l'invariant. */
const MAX_GEN_ATTEMPTS = 200;

/**
 * Tire un plateau valide : cases bloquées, puis (si un joueur est ⭐) ses deux
 * dominos de départ à des positions seedées et légales. Retente tant que
 * `TILES_MIN_PLACEMENTS` n'est pas respecté pour LES DEUX joueurs UNE FOIS le
 * plateau complet — c'est l'assertion DEV de génération du §3.4, tenue par
 * construction plutôt que vérifiée après coup.
 */
function genBoard(rand: () => number, helped: Owner | null): GenResult {
  const cols = TILES_COLS;
  const rows = TILES_ROWS;
  const cells = cols * rows;

  for (let attempt = 0; attempt < MAX_GEN_ATTEMPTS; attempt++) {
    const count = TILES_BLOCKED.min + Math.floor(rand() * (TILES_BLOCKED.max - TILES_BLOCKED.min + 1));
    const blocked = new Array<boolean>(cells).fill(false);
    let placedBlocks = 0;
    let guard = 0;
    while (placedBlocks < count && guard < 1000) {
      guard++;
      const idx = Math.floor(rand() * cells);
      if (!blocked[idx]) {
        blocked[idx] = true;
        placedBlocks++;
      }
    }

    const owner = new Array<Owner | null>(cells).fill(null);
    const dominoes: Domino[] = [];
    const placed: [number, number] = [0, 0];
    let genOk = true;

    if (helped !== null) {
      const candidates = shuffle(rand, legalAnchors(helped, owner, blocked, cols, rows));
      for (const idx of candidates) {
        if (placed[helped] >= TILES_STAR_PREPLACED) break;
        // Revalidé à chaque itération : un domino posé juste avant peut avoir
        // consommé une des deux cases d'un candidat suivant dans la liste.
        if (!isLegalAnchor(helped, idx, owner, blocked, cols, rows)) continue;
        const second = secondCellOf(helped, idx, cols);
        owner[idx] = helped;
        owner[second] = helped;
        dominoes.push({ anchor: idx, owner: helped, starred: true });
        placed[helped] += 1;
      }
      if (placed[helped] < TILES_STAR_PREPLACED) genOk = false;
    }

    if (genOk) {
      const legal0 = legalAnchors(0, owner, blocked, cols, rows);
      const legal1 = legalAnchors(1, owner, blocked, cols, rows);
      if (legal0.length >= TILES_MIN_PLACEMENTS && legal1.length >= TILES_MIN_PLACEMENTS) {
        return { blocked, owner, dominoes, placed };
      }
    }
  }
  throw new Error('[duo/tiles] génération de plateau impossible : invariant de poses minimales introuvable');
}

export class TilesModel {
  private readonly cols = TILES_COLS;
  private readonly rows = TILES_ROWS;
  private readonly blockedArr: readonly boolean[];
  private readonly ownerArr: (Owner | null)[];
  private readonly dominoesArr: Domino[];
  private readonly stackArr: [number, number];
  private readonly placedArr: [number, number];
  private readonly helpedPlayer: Owner | null;
  private cur: Owner = 0;
  private skippedPlayer: Owner | null = null;
  private isOver = false;
  private lastPlacer: Owner | null = null;

  /**
   * @param seed  tirage de la manche (cases bloquées + dominos ⭐ de départ) —
   *              aucun `Math.random`, tout en dérive.
   * @param stars niveaux ⭐ des deux sièges (§1.3) : modifient uniquement le
   *              CHIFFRE de départ (deux dominos déjà posés), jamais la règle.
   */
  constructor(
    readonly seed: number,
    readonly stars: readonly [StarLevel, StarLevel],
  ) {
    const rand = mulberry32(seed);
    // ⭐ = UN COUP DE PLUS, ⭐⭐ = sans coup de plus : c'est le sens que porte
    // l'accueil (`ui/screens.ts` : « un coup de plus (⭐) »), donc le joueur
    // AIDÉ est celui dont le niveau vaut 1. L'écrire à l'envers donnait
    // silencieusement les deux dominos d'avance au GRAND — le handicap
    // fonctionnait, mais dans le mauvais sens, et rien à l'écran ne le disait
    // (même convention que `tree` et `cake` : `stars[0] === 1 ? 0 : 1`).
    this.helpedPlayer = stars[0] !== stars[1] ? (stars[0] === 1 ? 0 : 1) : null;
    const gen = genBoard(rand, this.helpedPlayer);
    this.blockedArr = gen.blocked;
    this.ownerArr = gen.owner;
    this.dominoesArr = gen.dominoes;
    this.placedArr = gen.placed;
    this.stackArr = [TILES_STACK - gen.placed[0], TILES_STACK - gen.placed[1]];
    // Défensif : les invariants de génération garantissent qu'aucun joueur
    // n'est bloqué au départ, mais passer par la même route que `place()`
    // évite d'avoir une deuxième copie de la logique de passage automatique.
    this.settleTurn();
  }

  get state(): TilesState {
    return {
      cols: this.cols,
      rows: this.rows,
      blocked: this.blockedArr,
      owner: this.ownerArr,
      dominoes: this.dominoesArr,
      turn: this.cur,
      legal: this.legalMaskForCurrent(),
      stacks: this.stackArr,
      placed: this.placedArr,
      skipped: this.skippedPlayer,
      over: this.isOver,
      helped: this.helpedPlayer,
    };
  }

  private legalMaskForCurrent(): boolean[] {
    const out = new Array<boolean>(this.cols * this.rows).fill(false);
    if (this.isOver || this.stackArr[this.cur] <= 0) return out;
    for (let idx = 0; idx < out.length; idx++) {
      out[idx] = isLegalAnchor(this.cur, idx, this.ownerArr, this.blockedArr, this.cols, this.rows);
    }
    return out;
  }

  private hasLegalMove(player: Owner): boolean {
    if (this.stackArr[player] <= 0) return false;
    for (let idx = 0; idx < this.cols * this.rows; idx++) {
      if (isLegalAnchor(player, idx, this.ownerArr, this.blockedArr, this.cols, this.rows)) return true;
    }
    return false;
  }

  /** Coup légal ? Le jeu n'affiche jamais « coup interdit » : il l'empêche
   *  (le bouton correspondant est `disabled` — §1.1 critère 2). */
  canPlace(player: Owner, idx: number): boolean {
    if (this.isOver || player !== this.cur) return false;
    if (this.stackArr[player] <= 0) return false;
    return isLegalAnchor(player, idx, this.ownerArr, this.blockedArr, this.cols, this.rows);
  }

  /** @returns `true` si la pose a eu lieu (donc si l'état a changé). */
  place(player: Owner, idx: number): boolean {
    if (!this.canPlace(player, idx)) return false;
    const second = secondCellOf(player, idx, this.cols);
    this.ownerArr[idx] = player;
    this.ownerArr[second] = player;
    this.dominoesArr.push({ anchor: idx, owner: player, starred: false });
    this.placedArr[player] += 1;
    this.stackArr[player] -= 1;
    this.lastPlacer = player;
    this.cur = otherOf(player);
    this.settleTurn();
    return true;
  }

  /**
   * Appelée après TOUT changement du joueur courant (construction ou pose) :
   * si le joueur à qui c'est le tour n'a aucun coup légal, il passe
   * automatiquement — SAUF si l'autre est tout aussi bloqué, auquel cas la
   * manche s'arrête là (§3.4 : « un joueur bloqué passe, l'autre continue »).
   */
  private settleTurn(): void {
    if (this.hasLegalMove(this.cur)) {
      this.skippedPlayer = null;
      return;
    }
    const opp = otherOf(this.cur);
    if (!this.hasLegalMove(opp)) {
      this.isOver = true;
      this.skippedPlayer = null;
      return;
    }
    this.skippedPlayer = this.cur;
    this.cur = opp;
  }

  /**
   * §1.1 critère 4 — la CAUSE en une phrase, avec le départage exact quand il
   * s'applique. `winner` n'est JAMAIS `null` : c'est un duel, l'égalité de
   * comptage est toujours résolue par « dernier posé » (voir l'en-tête).
   */
  get result(): Result {
    const [a, b] = this.placedArr;
    if (a !== b) {
      const winner: Owner = a > b ? 0 : 1;
      return { winner, scores: [a, b], reason: `${Math.max(a, b)} tuiles posées contre ${Math.min(a, b)}` };
    }
    // Égalité EXACTE, et SEULEMENT là : le dernier à avoir posé l'emporte.
    // `lastPlacer` ne peut pas être `null` ici — la manche ne peut s'arrêter
    // (`isOver`) qu'après qu'au moins un vrai coup a été joué, puisque la
    // génération garantit ≥ `TILES_MIN_PLACEMENTS` coups légaux aux deux au
    // tout premier tour.
    const winner: Owner = this.lastPlacer ?? 0;
    return { winner, scores: [a, b], reason: `${a} tuiles chacun : la dernière posée l'emporte` };
  }
}
