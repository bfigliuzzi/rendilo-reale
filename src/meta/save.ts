// Sauvegarde locale versionnée. Toute évolution de schéma : nouvelle clé + migration ici.

const KEY = 'rendilo-reale:save:v1';

export interface SaveData {
  gold: number;
  upgrades: Record<string, number>; // id d'amélioration → niveau acheté
  campaignLevel: number; // prochain niveau de campagne à battre (1-based)
  endlessBest: number; // meilleure distance endless, en mètres affichés
  muted: boolean;
}

const DEFAULTS: SaveData = {
  gold: 0,
  upgrades: {},
  campaignLevel: 1,
  endlessBest: 0,
  muted: false,
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, upgrades: {} };
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      ...DEFAULTS,
      ...parsed,
      upgrades: { ...(parsed.upgrades ?? {}) },
    };
  } catch {
    return { ...DEFAULTS, upgrades: {} };
  }
}

export function persist(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // stockage indisponible (navigation privée…) : le jeu reste jouable sans persistance
  }
}
