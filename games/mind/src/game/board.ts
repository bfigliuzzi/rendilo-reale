import { mulberry32 } from '@shared/rng';
import { MAX_SYMBOLS } from '../config/balance';
import { EMPTY_PEG } from '../config/rules';
import type { DifficultyDef, Feedback, PegValue, Row, Slot } from '../config/rules';

// Histogrammes des NON-appariés, préalloués au module : `computeFeedback` est
// appelée des centaines de milliers de fois par le solveur du bot, et le repo
// interdit toute allocation dans les chemins chauds.
const SECRET_COUNT = new Int8Array(MAX_SYMBOLS);
const GUESS_COUNT = new Int8Array(MAX_SYMBOLS);

/**
 * Indice d'un essai. C'est LE seul endroit du jeu où une implémentation naïve est
 * silencieusement fausse : compter les « mal placés » sans retirer d'abord les
 * paires exactes compte les doublons deux fois (secret AABB contre essai ABAB
 * rendrait 4 mal placés au lieu de 2 exacts + 2 mal placés).
 *
 * On compte donc les exacts d'abord, puis on n'histogramme QUE les emplacements
 * non appariés : la somme des minimums par symbole donne les couleurs communes
 * mais mal placées. Le scénario `feedback` de tools/verify-mind.mjs fuzze cette
 * fonction contre une réimplémentation indépendante — c'est le garde-fou.
 */
export function computeFeedback(secret: readonly PegValue[], guess: readonly PegValue[]): Feedback {
  SECRET_COUNT.fill(0);
  GUESS_COUNT.fill(0);
  let exact = 0;
  for (let i = 0; i < secret.length; i++) {
    const s = secret[i];
    const g = guess[i];
    if (s === g) {
      exact++;
    } else {
      // décalage de +1 : loge EMPTY_PEG (−1) à l'index 0
      SECRET_COUNT[s + 1]++;
      GUESS_COUNT[g + 1]++;
    }
  }
  let misplaced = 0;
  for (let v = 0; v < MAX_SYMBOLS; v++) misplaced += Math.min(SECRET_COUNT[v], GUESS_COUNT[v]);
  return { exact, misplaced };
}

/** Nombre de symboles jouables : les couleurs, plus le pion vide en difficile. */
export function symbolCount(def: DifficultyDef): number {
  return def.colors + (def.allowEmpty ? 1 : 0);
}

/** Valeur du symbole d'index `i` dans la palette — le pion vide vient en dernier. */
export function symbolAt(def: DifficultyDef, i: number): PegValue {
  return def.allowEmpty && i === def.colors ? EMPTY_PEG : i;
}

function drawSecret(def: DifficultyDef, rand: () => number): PegValue[] {
  const symbols = symbolCount(def);
  if (def.duplicates) {
    return Array.from({ length: def.pegs }, () => symbolAt(def, Math.floor(rand() * symbols)));
  }
  // Sans doublon : mélange partiel de Fisher-Yates sur les symboles disponibles.
  // Un tirage-rejet naïf boucherait dès que `pegs` approche `symbols`.
  const pool = Array.from({ length: symbols }, (_, i) => symbolAt(def, i));
  for (let i = 0; i < def.pegs; i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
  }
  return pool.slice(0, def.pegs);
}

/**
 * L'état du jeu — PUR et synchrone : aucune horloge, aucun `Math.random` (le code
 * secret est tiré par `mulberry32(seed)`), aucune dépendance au rendu ni au DOM.
 *
 * C'est cet isolement qui rend le bot de vérification fiable et qui autorise le
 * chat à muter la ligne en cours sans risque : il passe par la MÊME API que le
 * joueur (`setPeg`, `swapPegs`), après un `markUndoPoint()`.
 */
export class Board {
  readonly secret: readonly PegValue[];
  readonly rows: Row[];
  /** Lignes validées — la source de vérité de l'avancement. */
  played = 0;
  solved = false;
  over = false;
  /** Copie de la ligne d'avant le dernier méfait du chat, ou `null`. */
  private undoRow: Slot[] | null = null;

  constructor(
    readonly def: DifficultyDef,
    readonly seed: number,
  ) {
    this.secret = drawSecret(def, mulberry32(seed));
    this.rows = Array.from({ length: def.tries }, () => ({
      pegs: new Array<Slot>(def.pegs).fill(null),
      feedback: null,
    }));
  }

  /** Ligne en cours de composition — la dernière ligne quand la partie est finie. */
  get activeRow(): number {
    return Math.min(this.played, this.def.tries - 1);
  }

  get active(): Row {
    return this.rows[this.activeRow];
  }

  get triesLeft(): number {
    return this.def.tries - this.played;
  }

  /** Dernière tentative en cours ? (le chat s'en abstient, cf. `CAT_SPARE_LAST_TRY`) */
  get lastTry(): boolean {
    return this.triesLeft <= 1;
  }

  /** Pions effectivement posés dans la ligne en cours. */
  placed(): number {
    let n = 0;
    for (const p of this.active.pegs) if (p !== null) n++;
    return n;
  }

  complete(): boolean {
    return !this.over && this.placed() === this.def.pegs;
  }

  setPeg(slot: number, value: Slot): boolean {
    if (this.over || slot < 0 || slot >= this.def.pegs) return false;
    this.active.pegs[slot] = value;
    return true;
  }

  swapPegs(a: number, b: number): boolean {
    if (this.over || a === b) return false;
    if (a < 0 || b < 0 || a >= this.def.pegs || b >= this.def.pegs) return false;
    const pegs = this.active.pegs;
    const t = pegs[a];
    pegs[a] = pegs[b];
    pegs[b] = t;
    return true;
  }

  clearRow(): void {
    if (this.over) return;
    this.active.pegs.fill(null);
  }

  /**
   * Valide la ligne en cours. Renvoie `null` si elle est incomplète ou la partie
   * finie — l'appelant ne doit RIEN animer dans ce cas.
   */
  submit(): Feedback | null {
    if (!this.complete()) return null;
    const row = this.active;
    const fb = computeFeedback(this.secret, row.pegs as PegValue[]);
    row.feedback = fb;
    this.played++;
    // Un méfait devient irréversible dès que la ligne est jouée : annuler après
    // coup reviendrait à rejouer un essai déjà consommé.
    this.clearUndo();
    if (fb.exact === this.def.pegs) {
      this.solved = true;
      this.over = true;
    } else if (this.played >= this.def.tries) {
      this.over = true;
    }
    return fb;
  }

  /** Meilleur nombre de « bien placés » obtenu — pilote le fond chaud/froid. */
  bestExact(): number {
    let best = 0;
    for (const row of this.rows) {
      if (row.feedback && row.feedback.exact > best) best = row.feedback.exact;
    }
    return best;
  }

  /** À appeler AVANT toute mutation du chat : arme le bouton ↩. */
  markUndoPoint(): void {
    if (this.over) return;
    this.undoRow = this.active.pegs.slice();
  }

  get canUndo(): boolean {
    return this.undoRow !== null;
  }

  /** Restaure la ligne telle qu'elle était avant le méfait. */
  undo(): boolean {
    if (!this.undoRow || this.over) return false;
    const pegs = this.active.pegs;
    for (let i = 0; i < pegs.length; i++) pegs[i] = this.undoRow[i];
    this.undoRow = null;
    return true;
  }

  clearUndo(): void {
    this.undoRow = null;
  }
}
