// TODO §3.2 — `cake` : Je coupe, tu choisis (pass · duel).
// Un gâteau, une corde tirée à deux poignées, l'autre choisit sa part. Six coupes, les rôles alternent.
//
// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER de l'étape 1 du §8. Ce fichier sera ENTIÈREMENT réécrit à l'étape
// qui lui est dédiée ; il n'existe que pour que le shell (menu, écran de
// passage, écran de résultat, pause, letterbox) soit testable de bout en bout
// AVANT que le premier vrai jeu ne soit écrit. La seule chose à en conserver,
// c'est le CONTRAT : ce modèle est PUR — ni horloge, ni `Math.random`, ni DOM,
// ni Pixi, ni import de `view.ts` — et il est rejouable à seed égale.
// ─────────────────────────────────────────────────────────────────────────────

import { mulberry32 } from '@shared/rng';
import type { StarLevel } from '../../meta/save';

/** Nombre de tapes qui terminent la manche bidon. IMPAIR : pas d'égalité. */
export const CAKE_TAPS = 3;

export interface CakeState {
  /** Tapes portées par chaque siège. */
  readonly taps: readonly [number, number];
  /** À qui de jouer. */
  readonly turn: 0 | 1;
  /** Tapes restantes avant la fin de la manche. */
  readonly left: number;
  readonly over: boolean;
}

export class CakeModel {
  private readonly t: [number, number] = [0, 0];
  private cur: 0 | 1;
  private remaining = CAKE_TAPS;

  /**
   * @param seed  tirage de la manche — tout le contenu en dérive (ici : qui
   *              commence), aucun `Math.random`.
   * @param stars niveaux ⭐ des deux sièges. Le vrai jeu s'en servira pour
   *              modifier des CHIFFRES, jamais des règles (§1.3).
   */
  constructor(
    readonly seed: number,
    readonly stars: readonly [StarLevel, StarLevel],
  ) {
    const rand = mulberry32(seed);
    this.cur = rand() < 0.5 ? 0 : 1;
  }

  get state(): CakeState {
    return { taps: this.t, turn: this.cur, left: this.remaining, over: this.remaining <= 0 };
  }

  /** Coup légal ? Le shell n'affiche jamais « coup interdit » : il l'empêche. */
  canTap(player: 0 | 1): boolean {
    return this.remaining > 0 && player === this.cur;
  }

  tap(player: 0 | 1): boolean {
    if (!this.canTap(player)) return false;
    this.t[player] += 1;
    this.remaining -= 1;
    this.cur = player === 0 ? 1 : 0;
    return true;
  }

  get scores(): [number, number] {
    return [this.t[0], this.t[1]];
  }

  /** `null` = manche coopérative : personne ne perd, personne ne choisit. */
  get winner(): 0 | 1 | null {
    return this.t[0] === this.t[1] ? null : this.t[0] > this.t[1] ? 0 : 1;
  }

  /** La CAUSE, en une phrase courte (§1.1 critère 4). */
  get reason(): string {
    return `${Math.max(this.t[0], this.t[1])} tapes contre ${Math.min(this.t[0], this.t[1])}`;
  }
}
