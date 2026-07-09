// Sauvegarde locale versionnée. Toute évolution de schéma : nouvelle clé + migration ici.

import { ACHIEVEMENTS, targetOf } from './achievements';

const KEY = 'rendilo-reale:save:v1';

export interface SaveCounters {
  kills: number;
  bossKills: number;
  bonusCrates: number;
  wins: number;
  goldEarned: number; // or gagné en jeu (cumulé) — succès « Trésorier »
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
  claimed: string[]; // LEGACY (succès à palier unique) — migré vers claimedTiers au chargement
  claimedTiers: Record<string, number>; // famille de succès → nb de paliers déjà réclamés
  campaignLevel: number; // prochain niveau de campagne à battre (1-based)
  endlessBest: number; // meilleure distance endless, en mètres affichés
  muted: boolean;
}

const DEFAULT_COUNTERS: SaveCounters = {
  kills: 0,
  bossKills: 0,
  bonusCrates: 0,
  wins: 0,
  goldEarned: 0,
};

const DEFAULTS: SaveData = {
  gold: 0,
  upgrades: {},
  weapons: { rifle: 1 },
  equipped: 'rifle',
  composition: { rifle: 100, sniper: 0, art: 0 },
  stars: {},
  counters: DEFAULT_COUNTERS,
  claimed: [],
  claimedTiers: {},
  campaignLevel: 1,
  endlessBest: 0,
  muted: false,
};

// Anciens succès à palier unique → (famille, seuil déjà payé). La migration
// marque réclamés tous les paliers dont la cible ≤ seuil : l'or déjà versé ne
// l'est jamais deux fois, la progression au-delà redevient réclamable.
const LEGACY_CLAIMS: Record<string, { family: string; threshold: number }> = {
  kills1: { family: 'kills', threshold: 1000 },
  kills2: { family: 'kills', threshold: 10000 },
  boss: { family: 'boss', threshold: 10 },
  bonus: { family: 'bonus', threshold: 25 },
  wins: { family: 'wins', threshold: 5 },
  endless: { family: 'endless', threshold: 800 },
};

function migrateLegacyClaims(claimed: readonly string[]): Record<string, number> {
  const tiers: Record<string, number> = {};
  for (const oldId of claimed) {
    const legacy = LEGACY_CLAIMS[oldId];
    const def = legacy && ACHIEVEMENTS.find((a) => a.id === legacy.family);
    if (!legacy || !def) continue;
    let t = 0;
    while (targetOf(def, t) <= legacy.threshold) t++;
    tiers[legacy.family] = Math.max(tiers[legacy.family] ?? 0, t);
  }
  return tiers;
}

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
      claimedTiers: parsed.claimedTiers
        ? { ...parsed.claimedTiers }
        : migrateLegacyClaims(parsed.claimed ?? []),
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
