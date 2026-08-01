import { DIFFICULTIES } from '../config/balance';
import { DIFFICULTY_IDS } from '../config/rules';
import type { Difficulty } from '../config/rules';

/**
 * Sauvegarde de Cerveau. La CLÉ ne change jamais : la version du schéma vit DANS
 * le JSON, et les migrations s'enchaînent au chargement (v1 → v2 → …). Renommer
 * la clé effacerait la progression des joueurs déjà installés.
 *
 * Pour vérifier une future migration, forger un vieux save à la console :
 *   localStorage.setItem('rendilo-reale:mind:save:v1',
 *     JSON.stringify({ version: 1, wins: { normal: 3 } }))
 * puis recharger : les champs absents doivent reprendre leurs défauts, les champs
 * présents être conservés et clampés.
 */
const KEY = 'rendilo-reale:mind:save:v1';

export interface BestScore {
  /** Essais consommés — le critère principal d'un record. */
  tries: number;
  /** Durée, en secondes — le tie-break à nombre d'essais égal. */
  timeSec: number;
}

export interface Counters {
  games: number;
  wins: number;
  losses: number;
  guesses: number;
  exactPegs: number;
  catMischiefs: number;
  undos: number;
  playSec: number;
}

export interface SaveData {
  version: 1;
  /** Meilleur score par difficulté, `null` si jamais gagnée. */
  best: Record<Difficulty, BestScore | null>;
  wins: Record<Difficulty, number>;
  streak: number;
  bestStreak: number;
  lastDifficulty: Difficulty;
  muted: boolean;
  /** Le chat farceur peut-il déplacer des pions ? (il se balade dans tous les cas) */
  catMischief: boolean;
  /** Option joueur, appliquée en OU avec `prefers-reduced-motion` — jamais en ET. */
  reducedMotion: boolean;
  counters: Counters;
  /** Présence de la clé = haut fait débloqué. */
  feats: Record<string, true>;
}

const COUNTER_KEYS = [
  'games',
  'wins',
  'losses',
  'guesses',
  'exactPegs',
  'catMischiefs',
  'undos',
  'playSec',
] as const;

const DEFAULT_COUNTERS: Counters = {
  games: 0,
  wins: 0,
  losses: 0,
  guesses: 0,
  exactPegs: 0,
  catMischiefs: 0,
  undos: 0,
  playSec: 0,
};

const DEFAULTS: SaveData = {
  version: 1,
  best: { easy: null, normal: null, hard: null },
  wins: { easy: 0, normal: 0, hard: 0 },
  streak: 0,
  bestStreak: 0,
  lastDifficulty: 'normal',
  muted: false,
  catMischief: true,
  reducedMotion: false,
  counters: { ...DEFAULT_COUNTERS },
  feats: {},
};

function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === 'string' && (DIFFICULTY_IDS as readonly string[]).includes(v);
}

/** Ramène une difficulté inconnue (save bricolé, ancien build) sur « normal ». */
export function clampDifficulty(v: unknown): Difficulty {
  return isDifficulty(v) ? v : 'normal';
}

/** Un record est meilleur s'il coûte moins d'essais, puis moins de temps. */
export function isBetter(candidate: BestScore, current: BestScore | null): boolean {
  if (!current) return true;
  if (candidate.tries !== current.tries) return candidate.tries < current.tries;
  return candidate.timeSec < current.timeSec;
}

/**
 * Remet le save à ses défauts EN PLACE : l'objet est partagé par référence avec
 * Flow, les écrans et `window.__game` — le remplacer laisserait des lecteurs sur
 * l'ancienne instance.
 */
export function resetSave(save: SaveData): void {
  Object.assign(save, structuredClone(DEFAULTS));
}

export function loadSave(): SaveData {
  const save = structuredClone(DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return save;
    // Typé `unknown` volontairement : ce JSON vient du disque du joueur, il n'a
    // aucune garantie de forme. Chaque champ est vérifié avant d'être adopté.
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Fusion champ par champ avec garde de type — jamais Object.assign(parsed) :
    // un save corrompu ou issu d'un futur build ne doit pas pouvoir injecter
    // n'importe quoi dans le modèle.
    if (typeof parsed.muted === 'boolean') save.muted = parsed.muted;
    if (typeof parsed.catMischief === 'boolean') save.catMischief = parsed.catMischief;
    if (typeof parsed.reducedMotion === 'boolean') save.reducedMotion = parsed.reducedMotion;
    if (parsed.lastDifficulty !== undefined) save.lastDifficulty = clampDifficulty(parsed.lastDifficulty);

    if (typeof parsed.streak === 'number' && Number.isFinite(parsed.streak)) {
      save.streak = Math.max(0, Math.floor(parsed.streak));
    }
    if (typeof parsed.bestStreak === 'number' && Number.isFinite(parsed.bestStreak)) {
      save.bestStreak = Math.max(0, Math.floor(parsed.bestStreak));
    }

    const best = parsed.best;
    if (best && typeof best === 'object') {
      for (const id of DIFFICULTY_IDS) {
        const entry = (best as Record<string, unknown>)[id];
        if (!entry || typeof entry !== 'object') continue;
        const { tries, timeSec } = entry as Partial<BestScore>;
        if (typeof tries !== 'number' || !Number.isFinite(tries)) continue;
        if (typeof timeSec !== 'number' || !Number.isFinite(timeSec)) continue;
        save.best[id] = {
          tries: Math.min(DIFFICULTIES[id].tries, Math.max(1, Math.floor(tries))),
          timeSec: Math.max(0, timeSec),
        };
      }
    }

    const wins = parsed.wins;
    if (wins && typeof wins === 'object') {
      for (const id of DIFFICULTY_IDS) {
        const v = (wins as Record<string, unknown>)[id];
        if (typeof v === 'number' && Number.isFinite(v)) save.wins[id] = Math.max(0, Math.floor(v));
      }
    }

    const counters = parsed.counters;
    if (counters && typeof counters === 'object') {
      for (const k of COUNTER_KEYS) {
        const v = (counters as Record<string, unknown>)[k];
        if (typeof v === 'number' && Number.isFinite(v)) save.counters[k] = Math.max(0, v);
      }
    }

    const feats = parsed.feats;
    if (feats && typeof feats === 'object') {
      for (const [id, v] of Object.entries(feats)) {
        if (v === true) save.feats[id] = true;
      }
    }
  } catch {
    // navigation privée, quota dépassé, JSON corrompu : on repart des défauts
    // plutôt que de casser le boot.
  }
  return save;
}

export function persist(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // ignoré : perdre un record vaut mieux que perdre la partie en cours
  }
}
