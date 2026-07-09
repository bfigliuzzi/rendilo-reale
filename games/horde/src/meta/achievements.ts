import type { SaveData } from './save';

// Succès à PALIERS SANS FIN : chaque famille suit une progression géométrique.
// La cible du palier t vaut base·growth^t (arrondie à 2 chiffres significatifs),
// la récompense ne monte que de ×1.35/palier et plafonne : le ratio or/effort
// DÉCROÎT à chaque palier — c'est un bonus de fidélité, jamais une pompe à or
// (l'économie de la boutique reste portée par les runs).

export interface AchievementDef {
  id: string;
  icon: string;
  name: string;
  desc: string; // libellé de la stat suivie (le palier courant s'affiche à côté)
  base: number; // cible du palier 0
  growth: number; // multiplicateur de cible par palier (≥ ×1.6 : l'effort explose)
  rewardBase: number; // or du palier 0
  value: (save: SaveData) => number;
}

const REWARD_GROWTH = 1.35;
const REWARD_CAP = 400;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'kills',
    icon: '☠️',
    name: 'Exterminateur',
    desc: 'Ennemis abattus (cumulés)',
    base: 500,
    growth: 4,
    rewardBase: 40,
    value: (s) => s.counters.kills,
  },
  {
    id: 'boss',
    icon: '👹',
    name: 'Chasseur de têtes',
    desc: 'Boss tués (cumulés)',
    base: 5,
    growth: 3,
    rewardBase: 50,
    value: (s) => s.counters.bossKills,
  },
  {
    id: 'bonus',
    icon: '🎁',
    name: 'Opportuniste',
    desc: 'Caisses bonus récupérées (cumulées)',
    base: 15,
    growth: 3,
    rewardBase: 40,
    value: (s) => s.counters.bonusCrates,
  },
  {
    id: 'wins',
    icon: '🏆',
    name: 'Conquérant',
    desc: 'Niveaux de campagne gagnés (cumulés)',
    base: 3,
    growth: 2.5,
    rewardBase: 60,
    value: (s) => s.counters.wins,
  },
  {
    id: 'endless',
    icon: '∞',
    name: 'Marathonien',
    desc: 'Meilleure distance en Sans fin (m)',
    base: 500,
    growth: 1.6,
    rewardBase: 50,
    value: (s) => s.endlessBest,
  },
  {
    id: 'gold',
    icon: '💰',
    name: 'Trésorier',
    desc: 'Or gagné en jeu (cumulé)',
    base: 1000,
    growth: 4,
    rewardBase: 40,
    value: (s) => s.counters.goldEarned,
  },
];

/** Cible du palier t (0-based), arrondie à 2 chiffres significatifs. */
export function targetOf(def: AchievementDef, tier: number): number {
  const raw = def.base * def.growth ** tier;
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / mag) * mag;
}

/** Or versé pour le palier t (0-based) — croissance douce, plafonnée. */
export function rewardOf(def: AchievementDef, tier: number): number {
  return Math.min(REWARD_CAP, Math.round(def.rewardBase * REWARD_GROWTH ** tier));
}

/** Nombre de paliers atteints (le palier t est atteint quand value ≥ sa cible). */
export function reachedTiers(def: AchievementDef, save: SaveData): number {
  const v = def.value(save);
  let t = 0;
  while (v >= targetOf(def, t)) t++;
  return t;
}

/** Or réclamable : somme des récompenses des paliers atteints non réclamés. */
export function claimableGold(def: AchievementDef, save: SaveData): number {
  const reached = reachedTiers(def, save);
  let gold = 0;
  for (let t = save.claimedTiers[def.id] ?? 0; t < reached; t++) gold += rewardOf(def, t);
  return gold;
}

export function isClaimable(def: AchievementDef, save: SaveData): boolean {
  return reachedTiers(def, save) > (save.claimedTiers[def.id] ?? 0);
}
