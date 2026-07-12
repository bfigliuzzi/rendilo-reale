// Sauvegarde locale d'Essaim. Schéma VERSIONNÉ : toute évolution = migration ici
// (pattern horde). Seul game/flow.ts a le droit d'écrire dedans.

import { SEND_FRAC_DEFAULT, SEND_FRAC_MIN, SEND_FRAC_STEP } from '../config/balance';
import { MAPS } from '../config/maps';

const KEY = 'rendilo-reale:hive:save:v1'; // clé historique — ne pas renommer

export interface SaveData {
  version: 2;
  /** Nombre de niveaux de campagne déverrouillés (1 = seul le premier). */
  unlocked: number;
  /** Meilleur temps de victoire par id de carte, en secondes. */
  bestTimes: Record<string, number>;
  muted: boolean;
  /** Fraction du stock envoyée par ordre joueur (stepper HUD), crans de 10 %. */
  sendFrac: number;
}

const DEFAULTS: SaveData = {
  version: 2,
  unlocked: 1,
  bestTimes: {},
  muted: false,
  sendFrac: SEND_FRAC_DEFAULT,
};

/** Arrondit au cran de 10 % dans [SEND_FRAC_MIN, 1] (re-quantifié à 2
 *  décimales : 7 × 0.1 = 0.7000…01 en flottant, qui polluerait le save). */
export function clampSendFrac(v: number): number {
  const snapped = Math.round(Math.round(v / SEND_FRAC_STEP) * SEND_FRAC_STEP * 100) / 100;
  return Math.min(1, Math.max(SEND_FRAC_MIN, snapped));
}

/**
 * Migration v1 → v2 : `unlocked` est POSITIONNEL et la campagne a changé
 * d'ordre (tutoriel inséré en 0, nouvelles cartes intercalées). Le `+1` couvre
 * l'insertion du tutoriel pour les débutants ; la dérivation depuis les cartes
 * déjà GAGNÉES (bestTimes, ids conservés) restaure la progression des vétérans.
 * Légèrement généreuse dans les cas limites : assumé.
 */
function migrateUnlocked(oldUnlocked: number, bestTimes: Record<string, number>): number {
  let unlocked = Math.min(oldUnlocked + 1, MAPS.length);
  for (let i = 0; i < MAPS.length; i++) {
    if (bestTimes[MAPS[i].id] !== undefined) unlocked = Math.max(unlocked, Math.min(i + 2, MAPS.length));
  }
  return Math.max(1, unlocked);
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<SaveData> & { version?: number };
    // merge sur les défauts : les champs ajoutés par les futures versions
    // reçoivent leur valeur par défaut, les inconnus sont ignorés
    const save = structuredClone(DEFAULTS);
    if (parsed.bestTimes && typeof parsed.bestTimes === 'object') save.bestTimes = { ...parsed.bestTimes };
    if (typeof parsed.unlocked === 'number') {
      const old = Math.max(1, Math.floor(parsed.unlocked));
      save.unlocked = (parsed.version ?? 1) < 2 ? migrateUnlocked(old, save.bestTimes) : Math.min(old, MAPS.length);
    }
    if (typeof parsed.muted === 'boolean') save.muted = parsed.muted;
    if (typeof parsed.sendFrac === 'number' && Number.isFinite(parsed.sendFrac)) save.sendFrac = clampSendFrac(parsed.sendFrac);
    return save;
  } catch {
    return structuredClone(DEFAULTS); // navigation privée / quota / JSON corrompu
  }
}

export function persist(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // silencieux : la partie reste jouable sans persistance
  }
}
