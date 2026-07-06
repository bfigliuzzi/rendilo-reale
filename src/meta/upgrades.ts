import { START_SQUAD } from '../config/balance';

// Améliorations permanentes, data-driven : la boutique et le calcul des stats
// se dérivent entièrement de ces définitions.

export type UpgradeId = 'start' | 'dps' | 'loot' | 'armor';

export interface UpgradeDef {
  id: UpgradeId;
  icon: string;
  name: string;
  maxLevel: number;
  cost: (level: number) => number; // coût pour passer de `level` à `level + 1`
  effectLabel: (level: number) => string;
}

export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'start',
    icon: '👥',
    name: 'Effectif de départ',
    maxLevel: 15,
    cost: (l) => Math.round(80 * Math.pow(1.7, l)),
    effectLabel: (l) => `${START_SQUAD + 2 * l} soldats`,
  },
  {
    id: 'dps',
    icon: '🔥',
    name: 'Puissance de feu',
    maxLevel: 25,
    cost: (l) => Math.round(60 * Math.pow(1.6, l)),
    effectLabel: (l) => `+${l * 10} % de dégâts`,
  },
  {
    id: 'loot',
    icon: '💰',
    name: 'Butin',
    maxLevel: 10,
    cost: (l) => Math.round(90 * Math.pow(1.75, l)),
    effectLabel: (l) => `+${l * 15} % d'or`,
  },
  {
    id: 'armor',
    icon: '🛡️',
    name: 'Blindage',
    maxLevel: 6,
    cost: (l) => Math.round(120 * Math.pow(1.8, l)),
    effectLabel: (l) => `−${l * 2} perte(s) par impact caisse/boss`,
  },
];

/** Stats effectives du joueur pour une run, dérivées des niveaux d'amélioration. */
export interface PlayerStats {
  startSquad: number;
  dpsMul: number;
  lootMul: number;
  contactShield: number; // réduit les pertes de contact caisse/boss
}

export function computeStats(upgrades: Record<string, number>): PlayerStats {
  return {
    startSquad: START_SQUAD + 2 * (upgrades.start ?? 0),
    dpsMul: 1 + 0.1 * (upgrades.dps ?? 0),
    lootMul: 1 + 0.15 * (upgrades.loot ?? 0),
    contactShield: 2 * (upgrades.armor ?? 0), // pertes évitées par impact caisse/boss
  };
}
