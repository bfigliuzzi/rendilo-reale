// Sauvegarde locale d'Essaim. Schéma VERSIONNÉ : toute évolution = migration ici
// (pattern horde). Seul game/flow.ts a le droit d'écrire dedans.

const KEY = 'rendilo-reale:hive:save:v1';

export interface SaveData {
  version: 1;
  /** Nombre de niveaux de campagne déverrouillés (1 = seul le premier). */
  unlocked: number;
  /** Meilleur temps de victoire par id de carte, en secondes. */
  bestTimes: Record<string, number>;
  muted: boolean;
}

const DEFAULTS: SaveData = {
  version: 1,
  unlocked: 1,
  bestTimes: {},
  muted: false,
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    // merge sur les défauts : les champs ajoutés par les futures versions
    // reçoivent leur valeur par défaut, les inconnus sont ignorés
    const save = structuredClone(DEFAULTS);
    if (typeof parsed.unlocked === 'number') save.unlocked = Math.max(1, Math.floor(parsed.unlocked));
    if (parsed.bestTimes && typeof parsed.bestTimes === 'object') save.bestTimes = { ...parsed.bestTimes };
    if (typeof parsed.muted === 'boolean') save.muted = parsed.muted;
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
