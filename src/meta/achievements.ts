import type { SaveData } from './save';

// Succès : data-driven, récompense en or à réclamer dans l'écran dédié.

export interface AchievementDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  target: number;
  reward: number;
  value: (save: SaveData) => number;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'kills1',
    icon: '☠️',
    name: 'Exterminateur',
    desc: 'Abattre 1 000 ennemis (cumulés)',
    target: 1000,
    reward: 150,
    value: (s) => s.counters.kills,
  },
  {
    id: 'kills2',
    icon: '💀',
    name: 'Fléau',
    desc: 'Abattre 10 000 ennemis (cumulés)',
    target: 10000,
    reward: 600,
    value: (s) => s.counters.kills,
  },
  {
    id: 'boss',
    icon: '👹',
    name: 'Chasseur de têtes',
    desc: 'Tuer 10 boss',
    target: 10,
    reward: 300,
    value: (s) => s.counters.bossKills,
  },
  {
    id: 'bonus',
    icon: '🎁',
    name: 'Opportuniste',
    desc: 'Récupérer 25 caisses bonus',
    target: 25,
    reward: 250,
    value: (s) => s.counters.bonusCrates,
  },
  {
    id: 'wins',
    icon: '🏆',
    name: 'Conquérant',
    desc: 'Gagner 5 niveaux de campagne',
    target: 5,
    reward: 400,
    value: (s) => s.counters.wins,
  },
  {
    id: 'endless',
    icon: '∞',
    name: 'Marathonien',
    desc: 'Atteindre 800 m en Sans fin',
    target: 800,
    reward: 350,
    value: (s) => s.endlessBest,
  },
];

export function isClaimable(def: AchievementDef, save: SaveData): boolean {
  return !save.claimed.includes(def.id) && def.value(save) >= def.target;
}
