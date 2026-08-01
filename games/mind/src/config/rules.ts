// Types du modèle de Cerveau. Aucune donnée ici : les 3 règles vivent dans
// config/balance.ts (invariant du repo : tout le tuning au même endroit).

export type Difficulty = 'easy' | 'normal' | 'hard';

/** Ordre canonique — écrans, save et bot s'y réfèrent. */
export const DIFFICULTY_IDS = ['easy', 'normal', 'hard'] as const;

/**
 * Pion VIDE volontairement posé (difficile uniquement). Il est une valeur JOUABLE
 * du code, à ne pas confondre avec `null` = emplacement pas encore rempli : sans
 * ces deux notions distinctes, impossible de savoir si une ligne est complète.
 */
export const EMPTY_PEG = -1;

/** Valeur d'un pion : 0..colors-1 pour une couleur, EMPTY_PEG pour le vide. */
export type PegValue = number;

/** Contenu d'un emplacement : un pion, ou rien de posé. */
export type Slot = PegValue | null;

export interface DifficultyDef {
  id: Difficulty;
  name: string;
  /** Longueur du code. */
  pegs: number;
  /** Nombre de couleurs disponibles (hors pion vide). */
  colors: number;
  /** Nombre d'essais accordés. */
  tries: number;
  /** Le code peut-il répéter une même valeur ? */
  duplicates: boolean;
  /** Le pion vide est-il une valeur jouable du code ? */
  allowEmpty: boolean;
}

/** Indice d'un essai : « bien placés » et « mal placés » (au sens Mastermind). */
export interface Feedback {
  exact: number;
  misplaced: number;
}

/** Une ligne du plateau. Seul `Board` mute ces objets. */
export interface Row {
  pegs: Slot[];
  /** `null` tant que la ligne n'a pas été validée. */
  feedback: Feedback | null;
}
