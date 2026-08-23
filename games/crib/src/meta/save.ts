/**
 * Sauvegarde de Berceau. La CLÉ ne change JAMAIS : la version du schéma vit DANS le
 * JSON, et les migrations s'enchaînent au chargement. Renommer la clé effacerait la
 * progression des joueurs déjà installés.
 *
 * Périmètre volontairement minimal : ce premier jet est un NIVEAU DE TEST, il n'y a
 * ni campagne, ni monnaie, ni succès. Les champs présents sont ceux qu'un joueur
 * serait fâché de perdre — son meilleur temps et sa préférence de son.
 *
 * Pour vérifier une future migration, forger un vieux save à la console :
 *   localStorage.setItem('rendilo-reale:crib:save:v1',
 *     JSON.stringify({ version: 1, wins: 3 }))
 * puis recharger : les champs absents reprennent leurs défauts, les présents sont
 * conservés et clampés.
 */
const KEY = 'rendilo-reale:crib:save:v1';

export interface SaveData {
  version: 1;
  muted: boolean;
  /** Meilleur temps de victoire, en secondes. `null` si jamais gagné. */
  bestTimeSec: number | null;
  /** PV de berceau restants lors de la meilleure victoire — le vrai score d'adresse. */
  bestCribHp: number;
  wins: number;
  runs: number;
}

const DEFAULTS: SaveData = {
  version: 1,
  muted: false,
  bestTimeSec: null,
  bestCribHp: 0,
  wins: 0,
  runs: 0,
};

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
    // aucune garantie de forme. Chaque champ est vérifié avant d'être adopté —
    // jamais `Object.assign(save, parsed)`.
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.muted === 'boolean') save.muted = parsed.muted;
    if (typeof parsed.bestTimeSec === 'number' && Number.isFinite(parsed.bestTimeSec)) {
      save.bestTimeSec = Math.max(0, parsed.bestTimeSec);
    }
    if (typeof parsed.bestCribHp === 'number' && Number.isFinite(parsed.bestCribHp)) {
      save.bestCribHp = Math.max(0, parsed.bestCribHp);
    }
    if (typeof parsed.wins === 'number' && Number.isFinite(parsed.wins)) {
      save.wins = Math.max(0, Math.floor(parsed.wins));
    }
    if (typeof parsed.runs === 'number' && Number.isFinite(parsed.runs)) {
      save.runs = Math.max(0, Math.floor(parsed.runs));
    }
  } catch {
    // navigation privée, quota dépassé, JSON corrompu : on repart des défauts
    // plutôt que de casser le boot
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
