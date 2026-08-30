import type { RunStats } from '../game/run';
import type { SaveData } from './save';

// TOUT ici est en LECTURE SEULE du save : seul game/flow.ts écrit. L'écran 🏅
// se dérive intégralement de ces deux tables.
//
// Les paliers sont un AFFICHAGE, SANS récompense : les éclats se gagnent en
// jouant, jamais en cochant une case. Un succès qui verserait de la monnaie de
// méta ferait de la complétion un raccourci vers l'arbre, et l'arbre est
// justement ce qu'on veut mériter.

export interface AchievementDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  base: number;
  /** Croissance géométrique (≥ 2,5) : les paliers doivent s'espacer vite. */
  growth: number;
  value: (save: SaveData) => number;
  unit?: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'runs',
    icon: '🚪',
    name: 'Habitué du seuil',
    desc: 'Runs lancées, gagnées ou perdues.',
    base: 5,
    growth: 3,
    value: (s) => s.counters.runs,
  },
  {
    id: 'nodes',
    icon: '🗺️',
    name: 'Arpenteur',
    desc: 'Nœuds franchis, toutes runs confondues.',
    base: 20,
    growth: 3,
    value: (s) => s.counters.nodes,
  },
  {
    id: 'kills',
    icon: '⚔️',
    name: 'Nettoyeur',
    desc: 'Ennemis mis à terre.',
    base: 30,
    growth: 3,
    value: (s) => s.counters.kills,
  },
  {
    id: 'gold',
    icon: '🪙',
    name: 'Bourse pleine',
    desc: 'Or ramassé au fil des salles.',
    base: 200,
    growth: 3,
    value: (s) => s.counters.gold,
  },
  {
    id: 'revives',
    icon: '🕯️',
    name: 'Second souffle',
    desc: 'Compagnons ramenés d’entre les morts.',
    base: 5,
    growth: 2.6,
    value: (s) => s.counters.revives,
  },
  {
    id: 'swaps',
    icon: '🔄',
    name: 'Danse des lignes',
    desc: 'Permutations jouées en combat.',
    base: 15,
    growth: 2.8,
    value: (s) => s.counters.swaps,
  },
];

/** Cible d'un palier, arrondie pour rester lisible. */
export function targetOf(def: AchievementDef, tier: number): number {
  const raw = def.base * def.growth ** tier;
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / mag) * mag;
}

/** Nombre de paliers atteints — sans plafond, par construction. */
export function reachedTiers(def: AchievementDef, save: SaveData): number {
  const v = def.value(save);
  let t = 0;
  while (v >= targetOf(def, t)) t++;
  return t;
}

// ─────────────────────────────────────────────────────── hauts faits one-shot

export interface FeatContext {
  /** Save DÉJÀ mis à jour par Flow : les compteurs cumulés sont à jour. */
  save: SaveData;
  victory: boolean;
  stats: RunStats;
  /** Nœuds atteints dans CETTE run. */
  node: number;
  /** Or en poche à la fin. */
  gold: number;
  /** Effectif encore debout à la fin. */
  survivors: number;
  /** Unités mortes au moins une fois pendant la run. */
  deaths: number;
  timeSec: number;
}

export interface FeatDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  /** « ★ légende » : quasi hors d'atteinte, signalé au libellé ET au liseré. */
  hard?: boolean;
  check: (ctx: FeatContext) => boolean;
}

export const FEATS: readonly FeatDef[] = [
  { id: 'first-fight', icon: '🩸', name: 'Baptême', desc: 'Gagner un premier combat.', check: (c) => c.stats.fightsWon >= 1 },
  { id: 'full-squad', icon: '👥', name: 'Au complet', desc: 'Atteindre 4 unités dans une même run.', check: (c) => c.survivors + c.deaths >= 4 },
  { id: 'boss', icon: '🗝️', name: 'Le Geôlier tombe', desc: 'Vaincre le boss.', check: (c) => c.stats.bossDefeated },
  { id: 'deep', icon: '🧭', name: 'Jusqu’au fond', desc: 'Franchir les 9 nœuds.', check: (c) => c.node > 9 },
  { id: 'rich', icon: '💰', name: 'Cousu d’or', desc: 'Terminer une run avec 80 or ou plus en poche.', check: (c) => c.gold >= 80 },
  { id: 'swapper', icon: '🔀', name: 'Chassé-croisé', desc: 'Jouer 10 permutations dans une seule run.', check: (c) => c.stats.swaps >= 10 },
  { id: 'gambler', icon: '❓', name: 'Joueur', desc: 'Franchir 4 portes voilées dans une seule run.', check: (c) => c.stats.veiledTaken >= 4 },
  { id: 'outfitted', icon: '🎒', name: 'Bien équipé', desc: 'Acheter 3 objets dans une seule run.', check: (c) => c.stats.itemsBought >= 3 },
  { id: 'undertaker', icon: '⚰️', name: 'Croque-mort', desc: 'Ressusciter 3 compagnons dans une seule run.', check: (c) => c.stats.revives >= 3 },
  {
    id: 'flawless',
    icon: '✨',
    name: 'Sans une égratignure',
    desc: 'Vaincre le Geôlier sans perdre une seule unité de la run.',
    hard: true,
    check: (c) => c.stats.bossDefeated && c.deaths === 0,
  },
  {
    id: 'solo',
    icon: '🥀',
    name: 'Solitaire',
    desc: 'Vaincre le Geôlier avec une seule unité debout.',
    hard: true,
    check: (c) => c.stats.bossDefeated && c.survivors === 1,
  },
  {
    id: 'thrifty',
    icon: '🔒',
    name: 'Avare',
    desc: 'Vaincre le Geôlier sans dépenser un seul or.',
    hard: true,
    check: (c) => c.stats.bossDefeated && c.stats.goldSpent === 0,
  },
];

/**
 * Ids des hauts faits NOUVELLEMENT débloqués. N'écrit rien : Flow pose les clés
 * et fait l'unique `persist()` de la fin de run.
 */
export function evalFeats(ctx: FeatContext): string[] {
  const fresh: string[] = [];
  for (const feat of FEATS) {
    if (ctx.save.feats[feat.id]) continue;
    if (feat.check(ctx)) fresh.push(feat.id);
  }
  return fresh;
}
