// Armes équipables : chacune modifie la cadence visuelle et le DPS, le canon
// lourd ajoute des dégâts de zone. Une seule équipée à la fois, niveaux à l'or.

export type WeaponId = 'rifle' | 'gatling' | 'cannon';

export interface WeaponDef {
  id: WeaponId;
  icon: string;
  name: string;
  desc: string;
  unlockCost: number; // 0 = possédée d'office
  rateMul: number; // multiplicateur de cadence visuelle
  dpsBonus: number; // multiplicateur de DPS de base de l'arme
  splash: number; // rayon de dégâts de zone (0 = aucun)
  maxLevel: number;
  levelCost: (level: number) => number; // coût pour passer de level à level+1
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'rifle',
    icon: '🔫',
    name: 'Fusil',
    desc: 'Équilibré, fidèle.',
    unlockCost: 0,
    rateMul: 1,
    dpsBonus: 1,
    splash: 0,
    maxLevel: 10,
    levelCost: (l) => Math.round(120 * Math.pow(1.5, l - 1)),
  },
  {
    id: 'gatling',
    icon: '🌀',
    name: 'Gatling',
    desc: 'Déluge de balles, dégâts unitaires réduits.',
    unlockCost: 400,
    rateMul: 1.7,
    dpsBonus: 1.15,
    splash: 0,
    maxLevel: 10,
    levelCost: (l) => Math.round(150 * Math.pow(1.5, l - 1)),
  },
  {
    id: 'cannon',
    icon: '💣',
    name: 'Canon lourd',
    desc: 'Tir lent, chaque impact souffle les ennemis voisins.',
    unlockCost: 900,
    rateMul: 0.55,
    dpsBonus: 1.25,
    splash: 55,
    maxLevel: 10,
    levelCost: (l) => Math.round(190 * Math.pow(1.5, l - 1)),
  },
];

export interface WeaponStats {
  rateMul: number;
  dpsMul: number;
  splash: number;
}

/** Stats effectives d'une arme à un niveau donné (+8 % de DPS par niveau au-delà de 1). */
export function weaponStats(id: string, level: number): WeaponStats {
  const def = WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
  return {
    rateMul: def.rateMul,
    dpsMul: def.dpsBonus * (1 + 0.08 * (Math.max(1, level) - 1)),
    splash: def.splash,
  };
}
