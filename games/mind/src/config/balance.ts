// TOUT le tuning de « Cerveau » vit ici — jamais de constante de gameplay ou de
// layout ailleurs (invariant du repo). Les couleurs et formes des pions sont la
// seule exception, elles ont leur table dédiée : config/pegs.ts.

import type { Difficulty, DifficultyDef } from './rules';

// ─────────────────────────────────────────────────────────── écran
// Même résolution logique qu'Essaim : le bot headless réutilise le viewport
// 540×960 et le letterbox se comporte à l'identique sur mobile.
export const DESIGN_W = 540;
export const DESIGN_H = 960;

// ─────────────────────────────────────────────────────────── règles
/**
 * Les trois difficultés. « Normal » EST la règle officielle du Mastermind
 * (4 pions, 6 couleurs, 10 essais, doublons autorisés) — c'est le point d'ancrage,
 * les deux autres s'en écartent d'un cran chacune.
 */
export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  // Sans doublon : l'espace tombe à 5×4×3×2 = 120 codes, et surtout le joueur
  // peut RAISONNER par élimination dès le premier indice. C'est ce qui en fait
  // le mode d'apprentissage, plus que le nombre d'essais.
  easy: { id: 'easy', name: 'Facile', pegs: 4, colors: 5, tries: 12, duplicates: false, allowEmpty: false },
  normal: { id: 'normal', name: 'Normal', pegs: 4, colors: 6, tries: 10, duplicates: true, allowEmpty: false },
  // 8 couleurs + le pion VIDE jouable = 9 symboles sur 5 emplacements : 59 049
  // codes (45× l'espace du normal) pour le même nombre d'essais.
  hard: { id: 'hard', name: 'Difficile', pegs: 5, colors: 8, tries: 10, duplicates: true, allowEmpty: true },
};

/** Bornes du modèle — dimensionnent les tampons préalloués. */
export const MAX_PEGS = 5;
export const MAX_COLORS = 8;
/** Symboles indexables : 8 couleurs + le pion vide (décalage de +1 pour loger −1). */
export const MAX_SYMBOLS = MAX_COLORS + 1;
/** Le plus grand `tries` de la table — dimensionne les pools de sprites. */
export const MAX_ROWS = 12;

// ─────────────────────────────────────────────────────────── layout du plateau
// Le plateau est DÉRIVÉ de la difficulté (voir rowH/rowY) : la bande verticale
// est fixe, les lignes s'y répartissent. Pire cas vérifié au calcul — 12 lignes
// et 5 pions tiennent dans [BOARD_TOP, BOARD_BOTTOM] sans chevaucher le statut.
export const TOP_BAR_Y = 30;
export const SECRET_Y = 78;
export const SEPARATOR_Y = 108;
/** Bande verticale réservée aux essais — les lignes s'y répartissent. */
export const BOARD_TOP = 118;
export const BOARD_BOTTOM = 656;
/**
 * Hauteur de ligne MAXIMALE. Les difficultés n'ont pas le même nombre d'essais
 * (12 en facile, 10 ailleurs) : les lignes s'étirent pour remplir la bande, ce qui
 * évite un grand vide en bas ET agrandit les zones tactiles quand c'est possible.
 */
export const ROW_H_MAX = 52;
export const PEG_R = 21;
export const SLOT_GAP = 64;
/** Zone du numéro d'essai, à gauche des emplacements. */
export const LABEL_W = 46;
/** Centre du bloc de marqueurs d'indice, à droite des emplacements. */
export const MARK_CX = 466;
export const MARK_R = 6;
export const MARK_GAP = 15;
export const STATUS_Y = 690;
export const PALETTE_Y = 770;
export const PALETTE_GAP = 54;
/** Bandeau des actions (✓ Valider / ↩ Annuler), en coordonnées logiques. */
export const ACTIONS_TOP = 828;
export const ACTIONS_H = 62;

/**
 * Abscisse du centre de l'emplacement `i` d'une ligne de `pegs` pions. Les
 * emplacements sont centrés dans l'espace laissé entre la zone du numéro d'essai
 * et celle des marqueurs, pour que les codes à 4 et 5 pions restent tous deux
 * visuellement équilibrés.
 */
export function slotX(i: number, pegs: number): number {
  const mid = (LABEL_W + (MARK_CX - MARK_GAP)) / 2;
  return mid - ((pegs - 1) * SLOT_GAP) / 2 + i * SLOT_GAP;
}

/** Hauteur d'une ligne pour une difficulté de `tries` essais. */
export function rowH(tries: number): number {
  return Math.min(ROW_H_MAX, (BOARD_BOTTOM - BOARD_TOP) / tries);
}

/** Ordonnée du centre de la ligne `row` (0 = première tentative, en haut). */
export function rowY(row: number, tries: number): number {
  const h = rowH(tries);
  const band = BOARD_BOTTOM - BOARD_TOP;
  return BOARD_TOP + (band - h * tries) / 2 + h * (row + 0.5);
}

/** Abscisse du centre du pion `i` de la palette (`count` entrées). */
export function paletteX(i: number, count: number): number {
  return DESIGN_W / 2 - ((count - 1) * PALETTE_GAP) / 2 + i * PALETTE_GAP;
}

/**
 * Décalage du marqueur `k` dans son bloc, en colonnes de 2 (la disposition
 * classique du Mastermind). Le bloc est centré verticalement sur la ligne.
 */
export function markOffset(k: number, pegs: number): { dx: number; dy: number } {
  const rows = Math.ceil(pegs / 2);
  const col = k % 2;
  const row = Math.floor(k / 2);
  return {
    dx: (col - 0.5) * MARK_GAP,
    dy: (row - (rows - 1) / 2) * MARK_GAP,
  };
}

// ─────────────────────────────────────────────────────────── juice
// Ces durées sont du RENDU pur : les changer n'affecte ni la logique ni le bot.
/**
 * Rebond de pose d'un pion. La courbe est CLOSE (une sinusoïde amortie évaluée
 * en fonction du temps écoulé), pas une intégration : le rendu peut donc être
 * reconstruit à n'importe quelle frame sans état à faire avancer, et un saut de
 * frame ne désynchronise rien.
 */
export const PEG_POP_TIME = 0.34;
/** Hauteur de chute du pion, en px. */
export const PEG_DROP_H = 34;
/** Amplitude du squash-and-stretch à l'impact. */
export const POP_SCALE = 0.5;
/** Durée d'une onde de choc annulaire. */
export const SHOCKWAVE_TIME = 0.4;
/** Décalage entre deux marqueurs qui se révèlent — la cascade de validation. */
export const REVEAL_STAGGER = 0.09;
export const REVEAL_POP_TIME = 0.26;
/** Amplitude du shake à la validation, et son bonus par « bien placé ». */
export const SHAKE_SUBMIT = 5;
export const SHAKE_PER_EXACT = 2.5;
/** Essais restants à partir desquels la vignette de tension bat. */
export const TENSION_FROM_TRIES = 2;
/** Confettis de victoire (avant réduction éventuelle du mouvement). */
export const WIN_CONFETTI = 220;
/** Durée de la révélation du code (volet), en secondes. */
export const REVEAL_TIME = 0.7;
/**
 * Délai entre la fin de partie et l'écran de résultat. Sans lui, le panneau
 * s'ouvre AVANT que le code se dévoile et que les confettis partent : le joueur ne
 * voit jamais la récompense qu'on vient de lui fabriquer.
 */
export const WIN_RESULT_DELAY = 2.4;
export const LOSE_RESULT_DELAY = 1.8;

// ─────────────────────────────────────────────────────────── mouvement réduit
// prefers-reduced-motion (ou l'option du joueur) : on n'AMPUTE jamais
// l'information, seulement le mouvement. Les indices restent lisibles sans
// aucune animation — c'est ce qui rend le jeu conforme WCAG 2.3.3 / RGAA.
export const RM_PARTICLE_MUL = 0.12;
export const RM_SHAKE_MUL = 0;

// ─────────────────────────────────────────────────────────── le chat
export const CAT_SPEED = 62;
/** Pause entre deux déplacements (bornes, en secondes). */
export const CAT_PAUSE_MIN = 1.4;
export const CAT_PAUSE_MAX = 5;
/** Délai minimum entre deux méfaits — le chat doit rester une surprise. */
export const CAT_MISCHIEF_COOLDOWN = 22;
/** Probabilité qu'un chat disponible passe à l'acte à une décision. */
export const CAT_MISCHIEF_CHANCE = 0.45;
/** Intervalle entre deux décisions du chat, en secondes. */
export const CAT_DECISION_INTERVAL = 3;
/** Pions posés requis pour un échange (le vol n'en demande qu'un). */
export const CAT_MIN_PEGS_TO_SWAP = 2;
/**
 * Le chat ne sabote JAMAIS le dernier essai : un vol au tout dernier tour n'est
 * plus une farce, c'est une défaite volée au joueur. La farce doit toujours
 * laisser une sortie.
 */
export const CAT_SPARE_LAST_TRY = true;
/** Durée d'une frame d'animation du chat, en secondes. */
export const CAT_FRAME_TIME = 0.16;
/** Durée du coup de patte, du réveil et de la fuite. */
export const CAT_PAW_TIME = 0.75;
export const CAT_FLEE_TIME = 1.1;
/** Combien de temps le bandeau d'annonce du méfait reste affiché. */
export const CAT_BANNER_TIME = 6;
