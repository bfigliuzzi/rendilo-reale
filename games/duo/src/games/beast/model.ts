// §3.7 — `beast` : La bête sous le tapis · pass · asym · tour par tour.
//
// L'un se cache et avance, l'autre éclaire. Modèle PUR (contrat de
// `core/minigame.ts`) : ni horloge, ni `Math.random` (mulberry32 seedé), ni
// DOM, ni Pixi, ni import de `view.ts` — rejouable hors de la page à seed
// égal, ce qui permet au bot de vérifier une manche entière sans cliquer un
// seul bouton.
//
// STRUCTURE EN DEUX MOITIÉS (comme `ant`) : une « manche » de `beast` est en
// fait DEUX mini-parties jouées à la suite sur la même grille — la première
// avec un siège bête et l'autre chasseur, la seconde avec les rôles échangés.
// Chaque moitié se résout indépendamment (la bête atteint le haut, le
// chasseur la touche, ou l'horloge de tours expire) ; le vainqueur de la
// MANCHE compare ensuite les deux résolutions.
//
// ─────────────────────────────────────────────────────────────────────────
// LE DÉPARTAGE INTER-RÔLES (exigé par le §3.7, écrit ici noir sur blanc) :
//
// « Réussir son rôle le plus vite » se mesure par le nombre de TOURS DE BÊTE
// écoulés quand la moitié se résout — que la résolution soit une victoire de
// la bête (elle atteint le haut au tour T) ou du chasseur (il la touche au
// tour T, ou l'horloge expire à `turnLimit`). C'est un chiffre unique,
// comparable directement entre les deux moitiés, quel que soit QUI a gagné :
//
//   1. Moins de tours gagne : la moitié résolue en moins de tours l'emporte,
//      et son vainqueur remporte la manche.
//   2. Égalité de tours, rôles différents : le rôle BÊTE l'emporte sur le
//      rôle CHASSEUR — atteindre le but visible (§1.1 critère 3) prime sur
//      l'avoir empêché, à vitesse égale.
//   3. Égalité totale (même nombre de tours ET même rôle vainqueur dans les
//      deux moitiés — une vraie symétrie de performance) : un troisième
//      tirage du seed, fixé à la construction, décide. Déterministe (même
//      seed ⇒ même verdict), jamais un nouveau hasard à la résolution.
//
// Voir `decide` plus bas, et `tools/verify-duo.mjs` (scénario `rules`) qui
// doit couvrir les trois cas. `decide` rend la MOITIÉ décisive et pas seulement
// le siège vainqueur : c'est elle que la phrase de cause doit raconter.
// ─────────────────────────────────────────────────────────────────────────

import { mulberry32 } from '@shared/rng';
import {
  BEAST_COLS,
  BEAST_LIGHTS,
  BEAST_LIGHTS_STAR,
  BEAST_MILD_MAX,
  BEAST_ROWS,
  BEAST_TURNS,
  BEAST_TURNS_STAR,
  BEAST_WARM_MAX,
} from '../../config/balance';
import type { Result } from '../../core/minigame';
import type { StarLevel } from '../../meta/save';

export type Role = 'beast' | 'hunter';
export type Dir = 'up' | 'down' | 'left' | 'right';
export type Tier = 'hot' | 'mild' | 'cold';

const DIR_DELTA: Readonly<Record<Dir, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export function dirWord(dir: Dir): string {
  return dir === 'up' ? 'vers le haut' : dir === 'down' ? 'vers le bas' : dir === 'left' ? 'vers la gauche' : 'vers la droite';
}

/** Case cible d'un déplacement depuis `idx`, ou `null` hors grille. Fonction
 *  PURE partagée par le modèle (interne) et `index.ts` (pour savoir quelle
 *  case du plateau représente quelle direction, sans dupliquer `DIR_DELTA`). */
export function stepIdx(idx: number, dir: Dir, cols: number, rows: number): number | null {
  const [r, c] = rowColOf(idx, cols);
  const [dc, dr] = DIR_DELTA[dir];
  const nc = c + dc;
  const nr = r + dr;
  if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) return null;
  return idxOf(nc, nr, cols);
}

/** La direction qui mène de `fromIdx` à `toIdx`, ou `null` si les deux cases
 *  ne sont pas orthogonalement adjacentes. */
export function dirBetween(fromIdx: number, toIdx: number, cols: number, rows: number): Dir | null {
  for (const dir of DIRS) {
    if (stepIdx(fromIdx, dir, cols, rows) === toIdx) return dir;
  }
  return null;
}

export function idxOf(col: number, row: number, cols: number): number {
  return row * cols + col;
}

/** [rangée, colonne] — même convention que `tiles/model.ts`. */
export function rowColOf(idx: number, cols: number): [number, number] {
  return [Math.floor(idx / cols), idx % cols];
}

export function manhattan(idxA: number, idxB: number, cols: number): number {
  const [ra, ca] = rowColOf(idxA, cols);
  const [rb, cb] = rowColOf(idxB, cols);
  return Math.abs(ra - rb) + Math.abs(ca - cb);
}

/**
 * LE POINT DUR DE CE JEU : le thermomètre est un TRIPLE codage (§5 : jamais
 * la couleur seule). Cette fonction est la SEULE source de vérité pour la
 * distance de Manhattan → palier ; la vue en dérive la couleur, le
 * pictogramme ET le nombre de barres à partir du MÊME `Tier`, jamais trois
 * calculs séparés qui pourraient diverger.
 */
export function tierOf(dist: number): Tier {
  if (dist <= BEAST_WARM_MAX) return 'hot';
  if (dist <= BEAST_MILD_MAX) return 'mild';
  return 'cold';
}

/** Pictogramme du palier — le DEUXIÈME codage (avec la couleur ET les barres). */
export function tierEmoji(tier: Tier): string {
  return tier === 'hot' ? '🔥' : tier === 'mild' ? '🌤' : '❄';
}

/** Nombre de barres pleines sur 2 — le TROISIÈME codage. */
export function tierBars(tier: Tier): 0 | 1 | 2 {
  return tier === 'hot' ? 2 : tier === 'mild' ? 1 : 0;
}

export interface RevealedCell {
  readonly idx: number;
  /** Tour de bête auquel cette case a été éclairée — sert à l'atténuation
   *  des lectures anciennes côté vue (la mémoire du chasseur, §3.7). */
  readonly turn: number;
  readonly dist: number;
  readonly tier: Tier;
}

/** Résolution d'une moitié — tout ce qu'il faut pour le départage (voir
 *  l'en-tête du fichier) et pour la phrase de cause (§1.1 critère 4). */
export interface HalfSummary {
  readonly beastSeat: 0 | 1;
  readonly hunterSeat: 0 | 1;
  readonly winner: 0 | 1;
  readonly winnerRole: Role;
  readonly turnsUsed: number;
  readonly turnLimit: number;
  /** `true` si le chasseur a gagné en la touchant, `false` si c'est l'horloge
   *  de tours qui a tranché — seule la PHRASE en dépend (voir `halfReason`). */
  readonly captured: boolean;
}

/**
 * Instantané de lecture du modèle.
 *
 * ⚠ PIÈGE, et il a déjà mordu : `revealed`, `selected` et `halves` sont les
 * tableaux INTERNES rendus par référence — `readonly` n'est qu'un contrat
 * TypeScript, il ne copie rien. Deux appels successifs à `state`, encadrant un
 * coup, rendent donc le MÊME tableau : comparer `avant.halves.length` à
 * `après.halves.length` renvoie toujours `false`. Pour détecter un changement,
 * mémoriser un NOMBRE (`const n = state.halves.length`) avant le coup, jamais
 * un objet d'état. On garde l'aliasing (zéro allocation par frame de rendu,
 * `state` est lu à chaque `render`) et on le documente.
 */
export interface BeastState {
  readonly cols: number;
  readonly rows: number;
  /** 0 = première moitié, 1 = seconde (rôles échangés). */
  readonly half: 0 | 1;
  /** Rôle actif — à qui de jouer LOGIQUEMENT. */
  readonly phase: Role;
  readonly beastSeat: 0 | 1;
  readonly hunterSeat: 0 | 1;
  /** Siège qui doit agir MAINTENANT — dérivé de `phase`, exposé tel quel pour
   *  que la vue n'ait jamais à refaire ce calcul. */
  readonly active: 0 | 1;
  /** Position de la bête. La VUE ne doit la dessiner QUE quand `phase ===
   *  'beast'` — sans quoi l'écran trahirait la cachette au chasseur. */
  readonly beastIdx: number;
  readonly turnsUsed: number;
  readonly turnLimit: number;
  readonly lightsCount: number;
  /** Mémoire du chasseur : toutes les cases déjà éclairées, dernière lecture
   *  connue. Ne s'efface qu'au changement de moitié. */
  readonly revealed: readonly RevealedCell[];
  /** Cases armées ce tour-ci, pas encore validées. */
  readonly selected: readonly number[];
  /** ⭐ du siège bête / chasseur COURANT — objet visible, jamais un
   *  multiplicateur caché (§1.3). */
  readonly helpedBeast: boolean;
  readonly helpedHunter: boolean;
  readonly halves: readonly HalfSummary[];
  readonly over: boolean;
}

function otherOf(p: 0 | 1): 0 | 1 {
  return p === 0 ? 1 : 0;
}

export class BeastModel {
  private readonly cols = BEAST_COLS;
  private readonly rows = BEAST_ROWS;

  private half: 0 | 1 = 0;
  private beastSeat: 0 | 1;
  private beastCol: number;
  private beastRow: number;
  private readonly half1Col: number;
  private readonly tieCoin: 0 | 1;

  private turnsUsed = 0;
  private phase: Role = 'beast';
  private revealedArr: RevealedCell[] = [];
  private selectedArr: number[] = [];
  private readonly halvesArr: HalfSummary[] = [];
  private isOver = false;

  /**
   * @param seed  tirage de la manche — qui commence bête, la colonne de
   *              départ de chaque moitié, et le tirage de départage
   *              d'exception (voir l'en-tête). Trois tirages fixés une fois
   *              pour toutes à la construction : aucun `Math.random`, et le
   *              résultat entier de la manche est déterminé par `seed` seul.
   * @param stars niveaux ⭐ des deux sièges (§1.3) : modifient uniquement des
   *              CHIFFRES (tours de la bête, cases du chasseur), jamais les
   *              règles — et suivent le siège, pas la moitié : un joueur ⭐
   *              reste aidé qu'il joue bête ou chasseur.
   */
  constructor(
    readonly seed: number,
    readonly stars: readonly [StarLevel, StarLevel],
  ) {
    const rand = mulberry32(seed);
    this.beastSeat = rand() < 0.5 ? 0 : 1;
    this.beastCol = Math.floor(rand() * this.cols);
    this.half1Col = Math.floor(rand() * this.cols);
    this.tieCoin = rand() < 0.5 ? 0 : 1;
    this.beastRow = this.rows - 1;
  }

  private get hunterSeat(): 0 | 1 {
    return otherOf(this.beastSeat);
  }

  private get helpedBeast(): boolean {
    return this.stars[this.beastSeat] === 2;
  }

  private get helpedHunter(): boolean {
    return this.stars[this.hunterSeat] === 2;
  }

  private get turnLimit(): number {
    return this.helpedBeast ? BEAST_TURNS_STAR : BEAST_TURNS;
  }

  private get lightsCount(): number {
    return this.helpedHunter ? BEAST_LIGHTS_STAR : BEAST_LIGHTS;
  }

  private get beastIdx(): number {
    return idxOf(this.beastCol, this.beastRow, this.cols);
  }

  get state(): BeastState {
    return {
      cols: this.cols,
      rows: this.rows,
      half: this.half,
      phase: this.phase,
      beastSeat: this.beastSeat,
      hunterSeat: this.hunterSeat,
      active: this.phase === 'beast' ? this.beastSeat : this.hunterSeat,
      beastIdx: this.beastIdx,
      turnsUsed: this.turnsUsed,
      turnLimit: this.turnLimit,
      lightsCount: this.lightsCount,
      revealed: this.revealedArr,
      selected: this.selectedArr,
      helpedBeast: this.helpedBeast,
      helpedHunter: this.helpedHunter,
      halves: this.halvesArr,
      over: this.isOver,
    };
  }

  /** Coup légal ? Le jeu n'affiche jamais « coup interdit » : le bouton
   *  correspondant est `disabled` (§1.1 critère 2). La bête DOIT bouger : il
   *  n'existe aucun verbe « passer » pour son tour. */
  canMove(seat: 0 | 1, dir: Dir): boolean {
    if (this.isOver || this.phase !== 'beast' || seat !== this.beastSeat) return false;
    return stepIdx(this.beastIdx, dir, this.cols, this.rows) !== null;
  }

  /** @returns `true` si le déplacement a eu lieu (donc si l'état a changé). */
  move(seat: 0 | 1, dir: Dir): boolean {
    if (!this.canMove(seat, dir)) return false;
    const target = stepIdx(this.beastIdx, dir, this.cols, this.rows);
    // `canMove` vient de garantir que `target` n'est pas `null`.
    const [nr, nc] = rowColOf(target as number, this.cols);
    this.beastCol = nc;
    this.beastRow = nr;
    this.turnsUsed += 1;
    if (this.beastRow === 0) {
      this.finishHalf('beast', false);
      return true;
    }
    this.phase = 'hunter';
    this.selectedArr = [];
    return true;
  }

  /** Armer/désarmer une case pour le tour du chasseur en cours. Retirer une
   *  case déjà armée est TOUJOURS permis (corriger un tap accidentel) ; en
   *  ajouter une nouvelle exige de ne pas avoir déjà atteint `lightsCount`. */
  canToggleLight(seat: 0 | 1, idx: number): boolean {
    if (this.isOver || this.phase !== 'hunter' || seat !== this.hunterSeat) return false;
    if (idx < 0 || idx >= this.cols * this.rows) return false;
    if (this.selectedArr.includes(idx)) return true;
    return this.selectedArr.length < this.lightsCount;
  }

  toggleLight(seat: 0 | 1, idx: number): boolean {
    if (!this.canToggleLight(seat, idx)) return false;
    const at = this.selectedArr.indexOf(idx);
    if (at >= 0) this.selectedArr.splice(at, 1);
    else this.selectedArr.push(idx);
    return true;
  }

  canValidate(seat: 0 | 1): boolean {
    return (
      !this.isOver && this.phase === 'hunter' && seat === this.hunterSeat && this.selectedArr.length === this.lightsCount
    );
  }

  /**
   * Résout les `lightsCount` cases armées : capture immédiate si la bête est
   * sur l'une d'elles (§3.7, « il gagne immédiatement » — les autres cases ne
   * sont même pas calculées, une capture ne s'explique pas par un
   * thermomètre), sinon un thermomètre par case, mémorisé pour la vue.
   *
   * @returns `true` si la validation a eu lieu (donc si l'état a changé).
   */
  validate(seat: 0 | 1): boolean {
    if (!this.canValidate(seat)) return false;
    const beastIdx = this.beastIdx;
    let captured = false;
    for (const idx of this.selectedArr) {
      if (idx === beastIdx) {
        captured = true;
        continue;
      }
      const dist = manhattan(idx, beastIdx, this.cols);
      this.setRevealed(idx, dist, tierOf(dist));
    }
    this.selectedArr = [];
    if (captured) {
      this.finishHalf('hunter', true);
      return true;
    }
    if (this.turnsUsed >= this.turnLimit) {
      this.finishHalf('hunter', false);
      return true;
    }
    this.phase = 'beast';
    return true;
  }

  private setRevealed(idx: number, dist: number, tier: Tier): void {
    const entry: RevealedCell = { idx, turn: this.turnsUsed, dist, tier };
    const at = this.revealedArr.findIndex((r) => r.idx === idx);
    if (at >= 0) this.revealedArr[at] = entry;
    else this.revealedArr.push(entry);
  }

  private finishHalf(winnerRole: Role, captured: boolean): void {
    const winner = winnerRole === 'beast' ? this.beastSeat : this.hunterSeat;
    this.halvesArr.push({
      beastSeat: this.beastSeat,
      hunterSeat: this.hunterSeat,
      winner,
      winnerRole,
      turnsUsed: this.turnsUsed,
      turnLimit: this.turnLimit,
      captured,
    });
    if (this.half === 0) {
      this.half = 1;
      this.beastSeat = this.hunterSeat; // les rôles s'échangent
      this.beastCol = this.half1Col;
      this.beastRow = this.rows - 1;
      this.turnsUsed = 0;
      this.phase = 'beast';
      this.revealedArr = [];
      this.selectedArr = [];
      return;
    }
    this.isOver = true;
  }

  /**
   * Le départage inter-rôles — voir l'en-tête du fichier. Isolé ici pour être
   * testable indépendamment au bot.
   *
   * Il renvoie la MOITIÉ qui a décidé, pas seulement le siège vainqueur : la
   * phrase de cause (§1.1 critère 4) doit raconter CETTE moitié-là. La version
   * précédente rendait un siège, puis `result` retrouvait « sa » moitié par
   * `h0.winner === winner` — faux dès qu'un même siège gagne les DEUX moitiés
   * (2-0), cas où elle attrapait toujours `h0` : l'écran annonçait alors « la
   * bête a filé en 9 tours (l'autre moitié : 6 tours) », c'est-à-dire une
   * phrase qui donne la victoire au plus LENT. Mesuré sur 4 % des manches
   * fuzzées, invisible en lisant le code.
   *
   * Le cas 3 (`tieCoin`) désigne bien toujours une moitié : à tours égaux ET
   * même rôle vainqueur, les deux moitiés ont forcément des vainqueurs
   * DIFFÉRENTS (les rôles s'échangent), donc exactement une des deux est
   * gagnée par le siège tiré.
   */
  private decide(h0: HalfSummary, h1: HalfSummary): { half: HalfSummary; other: HalfSummary; tied: boolean } {
    if (h0.turnsUsed !== h1.turnsUsed) {
      const fast = h0.turnsUsed < h1.turnsUsed ? h0 : h1;
      return { half: fast, other: fast === h0 ? h1 : h0, tied: false };
    }
    if (h0.winnerRole !== h1.winnerRole) {
      const beastHalf = h0.winnerRole === 'beast' ? h0 : h1;
      return { half: beastHalf, other: beastHalf === h0 ? h1 : h0, tied: false };
    }
    const coined = h0.winner === this.tieCoin ? h0 : h1;
    return { half: coined, other: coined === h0 ? h1 : h0, tied: true };
  }

  private halfReason(h: HalfSummary): string {
    if (h.winnerRole === 'beast') {
      return `la bête a filé jusqu'en haut en ${h.turnsUsed} tour${h.turnsUsed > 1 ? 's' : ''}`;
    }
    return h.captured
      ? `le chasseur a débusqué la bête au tour ${h.turnsUsed}`
      : `le chasseur a tenu ${h.turnsUsed} tours sans la laisser filer`;
  }

  /**
   * `winner` n'est jamais `null` (mode `asym`, deux moitiés jouées, un
   * vainqueur toujours départagé — voir l'en-tête). `scores` compte les
   * moitiés remportées par chaque siège (0, 1 ou 2) : simple, symétrique, et
   * ne dépend d'aucune conversion de tours en points qui favoriserait
   * arbitrairement une moitié ⭐ sur l'autre. La CAUSE réelle (§1.1
   * critère 4) vit dans `reason`, pas dans ce chiffre.
   */
  get result(): Result {
    const [h0, h1] = this.halvesArr;
    if (!h0 || !h1) throw new Error('beast : résultat demandé avant la fin des deux moitiés');
    const { half, other, tied } = this.decide(h0, h1);
    const scores: [number, number] = [0, 0];
    scores[h0.winner] += 1;
    scores[h1.winner] += 1;
    // Un départage au sort se DIT : sinon l'écran affirme une supériorité que
    // les deux chiffres identiques démentent, et l'enfant qui perd n'a aucune
    // cause à lire (§1.1 critère 4).
    const reason = tied
      ? `${this.halfReason(half)} — ${other.turnsUsed} tours des deux côtés, le sort a tranché`
      : `${this.halfReason(half)} (l'autre moitié : ${other.turnsUsed} tours)`;
    return { winner: half.winner, scores, reason };
  }
}
