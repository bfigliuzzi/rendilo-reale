// Sauvegarde locale versionnée. Toute évolution de schéma : nouvelle clé + migration ici.

const KEY = 'rendilo-reale:save:v1';

export interface SaveCounters {
  kills: number;
  bossKills: number;
  bonusCrates: number;
  wins: number;
}

export interface Composition {
  rifle: number; // pourcentages, somme = 100
  sniper: number;
  art: number;
}

export interface SaveData {
  gold: number;
  upgrades: Record<string, number>; // id d'amélioration → niveau acheté
  weapons: Record<string, number>; // id d'arme → niveau (absent = non possédée)
  equipped: string; // arme équipée
  composition: Composition; // répartition des classes de soldats
  stars: Record<string, number>; // niveau de campagne → étoiles (1-3)
  counters: SaveCounters; // compteurs cumulés (succès)
  claimed: string[]; // succès déjà réclamés
  campaignLevel: number; // prochain niveau de campagne à battre (1-based)
  endlessBest: number; // meilleure distance endless, en mètres affichés
  muted: boolean;
}

const DEFAULT_COUNTERS: SaveCounters = { kills: 0, bossKills: 0, bonusCrates: 0, wins: 0 };

const DEFAULTS: SaveData = {
  gold: 0,
  upgrades: {},
  weapons: { rifle: 1 },
  equipped: 'rifle',
  composition: { rifle: 100, sniper: 0, art: 0 },
  stars: {},
  counters: DEFAULT_COUNTERS,
  claimed: [],
  campaignLevel: 1,
  endlessBest: 0,
  muted: false,
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      upgrades: { ...(parsed.upgrades ?? {}) },
      weapons: { rifle: 1, ...(parsed.weapons ?? {}) },
      composition: { rifle: 100, sniper: 0, art: 0, ...(parsed.composition ?? {}) },
      stars: { ...(parsed.stars ?? {}) },
      counters: { ...DEFAULT_COUNTERS, ...(parsed.counters ?? {}) },
      claimed: [...(parsed.claimed ?? [])],
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function persist(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // stockage indisponible (navigation privée…) : le jeu reste jouable sans persistance
  }
}
