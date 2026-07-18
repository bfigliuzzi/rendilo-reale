// Succès d'Essaim — deux registres data-driven, l'écran s'en dérive :
// - familles à PALIERS SANS FIN (pattern horde targetOf/reachedTiers) : hive
//   n'a AUCUNE monnaie → pas de claim ni de reward, affichage pur ;
// - FEATS one-shot (save.feats), dont trois « ★ légende » quasi impossibles.
// Tout ici est en LECTURE SEULE du save : le flush des compteurs et
// l'écriture des feats restent dans game/flow.ts (seul écrivain).

import { NODE_LEVELS } from '../config/balance';
import { CAMPAIGN_BY_SPECIES, CAMPAIGNS } from '../config/campaigns';
import { SPECIES_IDS, type LevelDef, type SpeciesId } from '../config/levels';
import type { RunStats } from '../game/world';
import type { SaveData } from './save';

// ---- Familles à paliers ----

export interface AchievementDef {
  id: string;
  icon: string;
  name: string;
  desc: string; // libellé de la stat suivie (le palier courant s'affiche à côté)
  base: number; // cible du palier 0
  growth: number; // multiplicateur de cible par palier (≥ ×2.5 : l'effort explose)
  value: (save: SaveData) => number;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'conquest',
    icon: '🏰',
    name: 'Conquérant',
    desc: 'Nids capturés (cumulés)',
    base: 10,
    growth: 3,
    value: (s) => s.counters.captures,
  },
  {
    id: 'swarm',
    icon: '🐝',
    name: 'Maître de l’essaim',
    desc: 'Unités envoyées (cumulées)',
    base: 500,
    growth: 4,
    value: (s) => s.counters.unitsSent,
  },
  {
    id: 'architect',
    icon: '▲',
    name: 'Architecte',
    desc: 'Nids agrandis (cumulés)',
    base: 5,
    growth: 3,
    value: (s) => s.counters.upgrades,
  },
  {
    id: 'winner',
    icon: '🏆',
    name: 'Vainqueur',
    desc: 'Niveaux gagnés (cumulés)',
    base: 3,
    growth: 2.5,
    value: (s) => s.counters.wins,
  },
  {
    id: 'grinder',
    icon: '⚔️',
    name: 'Broyeur',
    desc: 'Unités ennemies broyées en vol (cumulées)',
    base: 300,
    growth: 4,
    value: (s) => s.counters.annihilations,
  },
  {
    id: 'veteran',
    icon: '⏳',
    name: 'Vétéran',
    desc: 'Minutes de jeu (cumulées)',
    base: 15,
    growth: 3,
    value: (s) => Math.floor(s.counters.playSec / 60),
  },
];

/** Cible du palier t (0-based), arrondie à 2 chiffres significatifs. */
export function targetOf(def: AchievementDef, tier: number): number {
  const raw = def.base * def.growth ** tier;
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / mag) * mag;
}

/** Nombre de paliers atteints (le palier t est atteint quand value ≥ sa cible). */
export function reachedTiers(def: AchievementDef, save: SaveData): number {
  const v = def.value(save);
  let t = 0;
  while (v >= targetOf(def, t)) t++;
  return t;
}

// ---- Feats one-shot ----

/** Contexte d'évaluation : le save est DÉJÀ flushé (compteurs, bestTimes,
 *  progression) quand Flow appelle evalFeats — les checks peuvent lire les
 *  deux niveaux (partie via run/victory, carrière via save). */
export interface FeatContext {
  save: SaveData;
  victory: boolean;
  timeSec: number;
  campaign: SpeciesId;
  levelIdx: number; // 0-based dans la campagne courante
  def: LevelDef;
  run: RunStats;
  unitsSent: number; // unités joueur émises cette partie
  neutralLeft: number; // nids neutres restants à la fin
}

export interface FeatDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  hard?: boolean; // « ★ légende » : liseré ambre à l'écran
  check: (ctx: FeatContext) => boolean;
}

/** Indice de difficulté d du niveau joué — même convention que mapgen :
 *  fly/roach n'ont pas de tutoriel, leur niveau 1 vaut d=2. */
function difficultyOf(campaign: SpeciesId, levelIdx: number): number {
  return campaign === 'bee' ? levelIdx + 1 : levelIdx + 2;
}

/** Campagne terminée = les 30 ids de ses niveaux tous dans bestTimes. */
function campaignDone(save: SaveData, species: SpeciesId): boolean {
  return CAMPAIGN_BY_SPECIES[species].levels.every((lvl) => save.bestTimes[lvl.id] !== undefined);
}

/** Au moins un niveau gagné où `species` figure parmi les camps IA. */
function speciesBeaten(save: SaveData, species: SpeciesId): boolean {
  for (const c of CAMPAIGNS) {
    for (const lvl of c.levels) {
      if (save.bestTimes[lvl.id] === undefined) continue;
      for (let k = 1; k < lvl.factions.length; k++) {
        if (lvl.factions[k].species === species) return true;
      }
    }
  }
  return false;
}

// Faisabilité de « Nomade » (maxNests ≤ 1), vérifiée en théorie sur une carte
// 1v1 à deux nids structurels (ex. bee-2 La Clairière) : le joueur envoie 100 %
// de sa ruche vers le nid IA et LAISSE l'IA capturer sa ruche vidée pendant que
// la nuée est en vol ; chaque capture joueur se fait alors en tenant 0 nid, et
// la danse se termine quand l'IA dépense ses dernières unités à reprendre le
// nid abandonné juste avant l'arrivée de la nuée finale. Quasi impossible en
// pratique (fenêtres de timing dépendantes de l'IA) — c'est le contrat « ★ ».
export const FEATS: readonly FeatDef[] = [
  {
    id: 'first-win',
    icon: '🌱',
    name: 'Première conquête',
    desc: 'Gagner un premier niveau',
    check: (c) => c.victory,
  },
  {
    id: 'apex',
    icon: '⬆️',
    name: 'Apogée',
    desc: 'Tenir un nid au niveau maximum',
    check: (c) => c.run.maxLevelReached >= NODE_LEVELS.length - 1,
  },
  {
    id: 'monopoly',
    icon: '🍯',
    name: 'Monopole',
    desc: 'Gagner sans laisser un seul nid neutre',
    check: (c) => c.victory && c.neutralLeft === 0,
  },
  {
    id: 'clan-hunter',
    icon: '🎯',
    name: 'Chasseur de clans',
    desc: 'Vaincre chaque espèce au moins une fois',
    check: (c) => c.victory && SPECIES_IDS.every((sp) => speciesBeaten(c.save, sp)),
  },
  {
    id: 'bee-crown',
    icon: '🐝',
    name: 'Reine des reines',
    desc: 'Terminer la campagne des Abeilles (30/30)',
    check: (c) => campaignDone(c.save, 'bee'),
  },
  {
    id: 'fly-crown',
    icon: '🪰',
    name: 'Seigneur des mouches',
    desc: 'Terminer la campagne des Mouches (30/30)',
    check: (c) => campaignDone(c.save, 'fly'),
  },
  {
    id: 'roach-crown',
    icon: '🪳',
    name: 'Roi des cafards',
    desc: 'Terminer la campagne des Cafards (30/30)',
    check: (c) => campaignDone(c.save, 'roach'),
  },
  {
    id: 'triple-crown',
    icon: '👑',
    name: 'Triple couronne',
    desc: 'Terminer les trois campagnes',
    hard: true,
    check: (c) => SPECIES_IDS.every((sp) => campaignDone(c.save, sp)),
  },
  {
    id: 'untouchable',
    icon: '🛡️',
    name: 'Intouchable',
    desc: 'Gagner un niveau de difficulté 5+ sans perdre un seul nid',
    check: (c) => c.victory && difficultyOf(c.campaign, c.levelIdx) >= 5 && c.run.nestsLost === 0,
  },
  {
    id: 'blitz',
    icon: '⚡',
    name: 'Blitz',
    desc: 'Gagner un niveau de difficulté 5+ en moins de 2 minutes',
    check: (c) => c.victory && difficultyOf(c.campaign, c.levelIdx) >= 5 && c.timeSec < 120,
  },
  {
    id: 'all-in',
    icon: '🎲',
    name: 'Va-tout',
    desc: 'Gagner un niveau de difficulté 6+ en n’envoyant qu’à 100 %',
    hard: true,
    check: (c) => c.victory && difficultyOf(c.campaign, c.levelIdx) >= 6 && c.run.orders > 0 && c.run.fullSendOnly,
  },
  {
    id: 'nomad',
    icon: '🌪️',
    name: 'Nomade',
    desc: 'Gagner sans jamais tenir deux nids à la fois',
    hard: true,
    check: (c) => c.victory && c.run.maxNests <= 1,
  },
];

/**
 * Ids des feats NOUVELLEMENT débloqués (absents de save.feats et validés par
 * leur check). Une allocation par fin de partie — assumé, jamais au tick.
 * N'écrit PAS le save : Flow pose les clés et persiste.
 */
export function evalFeats(ctx: FeatContext): string[] {
  const out: string[] = [];
  for (const f of FEATS) {
    if (ctx.save.feats[f.id]) continue;
    if (f.check(ctx)) out.push(f.id);
  }
  return out;
}
