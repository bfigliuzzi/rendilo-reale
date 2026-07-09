// Armes équipables : chacune modifie la cadence visuelle et le DPS, le canon
// lourd ajoute des dégâts de zone. Une seule équipée à la fois, niveaux à l'or.
//
// ÉQUILIBRAGE PAR BUDGET DE PUISSANCE — le multiplicateur de dégâts d'une arme
// est DÉRIVÉ, jamais réglé à la main. La cadence et le splash ont une valeur
// d'usage réelle (moins de surplus gâché sur les petits ennemis, dégâts
// multi-cibles) qu'on facture au budget :
//   utilité(arme)        = (1 + RATE_VALUE·log2(rateMul)) · (1 + SPLASH_VALUE·splash)
//   puissanceCible(coût) = 1 + UNLOCK_VALUE·log2(1 + coût/UNLOCK_REF)
//   dpsBonus             = puissanceCible / utilité
// Une arme rapide paie donc sa cadence en dégâts bruts (plus faible contre les
// gros PV), une arme lente est compensée : les identités restent (gatling
// anti-nuées, canon anti-boss), la domination stricte disparaît. Le coût des
// niveaux suit aussi la puissance cible — l'or achète la même chose partout.

export type WeaponId = 'rifle' | 'gatling' | 'cannon';

const RATE_VALUE = 0.18; // valeur d'un doublement de cadence (surplus gâché en moins)
const SPLASH_VALUE = 0.005; // valeur d'un px de rayon de zone
const UNLOCK_VALUE = 0.1; // premium de puissance par doublement du coût de déblocage
const UNLOCK_REF = 400; // coût de référence (gatling)
const LEVEL_COST_BASE = 120;
const LEVEL_COST_GROWTH = 1.5;
const LEVEL_DPS_STEP = 0.08; // +8 % de DPS par niveau au-delà de 1

const utility = (rateMul: number, splash: number): number =>
  (1 + RATE_VALUE * Math.log2(rateMul)) * (1 + SPLASH_VALUE * splash);
const targetPower = (unlockCost: number): number =>
  1 + UNLOCK_VALUE * Math.log2(1 + unlockCost / UNLOCK_REF);

interface WeaponSpec {
  id: WeaponId;
  icon: string;
  name: string;
  desc: string;
  unlockCost: number; // 0 = possédée d'office
  rateMul: number; // multiplicateur de cadence visuelle
  splash: number; // rayon de dégâts de zone (0 = aucun)
  maxLevel: number;
}

export interface WeaponDef extends WeaponSpec {
  dpsBonus: number; // dérivé du budget de puissance — voir en-tête
  levelCost: (level: number) => number; // coût pour passer de level à level+1
}

const SPECS: readonly WeaponSpec[] = [
  {
    id: 'rifle',
    icon: '🔫',
    name: 'Fusil',
    desc: 'Équilibré, fidèle.',
    unlockCost: 0,
    rateMul: 1,
    splash: 0,
    maxLevel: 10,
  },
  {
    id: 'gatling',
    icon: '🌀',
    name: 'Gatling',
    desc: 'Déluge de balles : les nuées fondent, mais chaque balle frappe moins fort les gros.',
    unlockCost: 400,
    rateMul: 1.7,
    splash: 0,
    maxLevel: 10,
  },
  {
    id: 'cannon',
    icon: '💣',
    name: 'Canon lourd',
    desc: 'Tir lent et puissant, chaque impact souffle les ennemis voisins.',
    unlockCost: 900,
    rateMul: 0.55,
    splash: 55,
    maxLevel: 10,
  },
];

export const WEAPONS: readonly WeaponDef[] = SPECS.map((spec) => {
  const power = targetPower(spec.unlockCost);
  return {
    ...spec,
    dpsBonus: Math.round((power / utility(spec.rateMul, spec.splash)) * 100) / 100,
    levelCost: (l) => Math.round(LEVEL_COST_BASE * power * Math.pow(LEVEL_COST_GROWTH, l - 1)),
  };
});

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
    dpsMul: def.dpsBonus * (1 + LEVEL_DPS_STEP * (Math.max(1, level) - 1)),
    splash: def.splash,
  };
}
