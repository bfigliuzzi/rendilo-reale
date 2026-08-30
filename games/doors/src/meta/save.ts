import type { MetaId } from './tree';

/**
 * Sauvegarde de « Trois Portes ». La CLÉ ne change jamais, la version vit DANS
 * le JSON, et chaque champ est adopté sous garde de type — un save corrompu ou
 * venu d'un futur build ne doit pas pouvoir injecter n'importe quoi.
 *
 * Ce qui n'y est PAS est aussi une décision : ni or, ni objets, ni escouade.
 * L'absence de méta-progression matérielle est un choix de design, et le schéma
 * de save est l'endroit où on le fait respecter.
 */
const KEY = 'rendilo-reale:doors:save:v1';

export interface Counters {
  runs: number;
  wins: number;
  nodes: number;
  kills: number;
  gold: number;
  revives: number;
  swaps: number;
  dismissals: number;
  veiled: number;
  items: number;
  playSec: number;
}

export interface SaveData {
  version: 1;
  /** Éclats — la monnaie de méta. Gagnés même en cas de wipe. */
  shards: number;
  /** Éclats dépensés à vie : sert à afficher le total gagné. */
  spent: number;
  unlocked: Partial<Record<MetaId, true>>;
  /** Meilleur nombre de nœuds franchis en une run. */
  bestNodes: number;
  /** Durée de la meilleure run VICTORIEUSE, en secondes. `0` = jamais gagné. */
  bestWinSec: number;
  /** Héros choisi au dernier départ. */
  lastHero: string;
  muted: boolean;
  reducedMotion: boolean;
  counters: Counters;
  /** Présence de la clé = haut fait débloqué. */
  feats: Record<string, true>;
}

const COUNTER_KEYS = [
  'runs', 'wins', 'nodes', 'kills', 'gold', 'revives', 'swaps', 'dismissals', 'veiled', 'items', 'playSec',
] as const;

const META_IDS: readonly MetaId[] = ['tightRanks', 'purse', 'keenEye', 'sister', 'respite'];

const DEFAULTS: SaveData = {
  version: 1,
  shards: 0,
  spent: 0,
  unlocked: {},
  bestNodes: 0,
  bestWinSec: 0,
  lastHero: 'wanderer',
  muted: false,
  reducedMotion: false,
  counters: {
    runs: 0, wins: 0, nodes: 0, kills: 0, gold: 0, revives: 0,
    swaps: 0, dismissals: 0, veiled: 0, items: 0, playSec: 0,
  },
  feats: {},
};

/** Remet le save à ses défauts EN PLACE : l'objet est partagé par référence. */
export function resetSave(save: SaveData): void {
  Object.assign(save, structuredClone(DEFAULTS));
}

export function loadSave(): SaveData {
  const save = structuredClone(DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return save;
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : null;

    const shards = num(parsed.shards);
    if (shards !== null) save.shards = Math.floor(shards);
    const spent = num(parsed.spent);
    if (spent !== null) save.spent = Math.floor(spent);
    const nodes = num(parsed.bestNodes);
    if (nodes !== null) save.bestNodes = Math.floor(nodes);
    const best = num(parsed.bestWinSec);
    if (best !== null) save.bestWinSec = best;
    if (typeof parsed.muted === 'boolean') save.muted = parsed.muted;
    if (typeof parsed.reducedMotion === 'boolean') save.reducedMotion = parsed.reducedMotion;
    if (parsed.lastHero === 'wanderer' || parsed.lastHero === 'sister') save.lastHero = parsed.lastHero;

    const unlocked = parsed.unlocked;
    if (unlocked && typeof unlocked === 'object') {
      for (const id of META_IDS) {
        if ((unlocked as Record<string, unknown>)[id] === true) save.unlocked[id] = true;
      }
    }

    const counters = parsed.counters;
    if (counters && typeof counters === 'object') {
      for (const k of COUNTER_KEYS) {
        const v = num((counters as Record<string, unknown>)[k]);
        if (v !== null) save.counters[k] = v;
      }
    }

    const feats = parsed.feats;
    if (feats && typeof feats === 'object') {
      for (const [id, v] of Object.entries(feats)) if (v === true) save.feats[id] = true;
    }
  } catch {
    // navigation privée, quota, JSON corrompu : on repart des défauts plutôt
    // que de casser le boot.
  }
  return save;
}

export function persist(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // ignoré : perdre un éclat vaut mieux que perdre la run en cours
  }
}
