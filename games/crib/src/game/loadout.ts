import * as B from '../config/balance';

/**
 * Améliorations du bébé, VALABLES POUR UN NIVEAU SEULEMENT.
 *
 * Divergence délibérée avec horde, qui pose ses améliorations dans `meta/` : ici il
 * n'y a AUCUNE méta-progression, donc rien à l'extérieur du niveau ne peut informer
 * le loadout. C'est `World.loadLevel` qui le construit lui-même, au lieu de le
 * recevoir de Flow comme le fait `computeStats(save)` chez horde.
 *
 * INVARIANT NON NÉGOCIABLE : `emptyLoadout()` est l'IDENTITÉ — tous les
 * multiplicateurs à 1, `gritDiv` à 1. C'est ce qui garantit qu'une partie fraîche se
 * comporte exactement comme le POC, et donc que le scénario `grip` du bot mesure
 * toujours les mêmes paliers (une mamie seule = 1.6 / 3.2 = 0,5 de charge).
 */
export interface Loadout {
  dpsMul: number;
  rateMul: number;
  rangeMul: number;
  speedMul: number;
  /** Résistance à l'engluement : DIVISE la charge de contact avant `Hero.update`. */
  gritDiv: number;
  levels: Record<B.BabyUpgradeId, number>;
}

export function emptyLoadout(): Loadout {
  return {
    dpsMul: 1,
    rateMul: 1,
    rangeMul: 1,
    speedMul: 1,
    gritDiv: 1,
    levels: { dps: 0, rate: 0, range: 0, speed: 0, grit: 0 },
  };
}

/** Remet un loadout existant à l'identité, EN PLACE (il est partagé par référence). */
export function resetLoadout(l: Loadout): void {
  l.dpsMul = 1;
  l.rateMul = 1;
  l.rangeMul = 1;
  l.speedMul = 1;
  l.gritDiv = 1;
  l.levels.dps = 0;
  l.levels.rate = 0;
  l.levels.range = 0;
  l.levels.speed = 0;
  l.levels.grit = 0;
}

/** Niveau ATTEINT après achat, ou `false` si le palier max est déjà pris. */
export function canUpgrade(l: Loadout, id: B.BabyUpgradeId): boolean {
  return l.levels[id] < B.babyUpgrade(id).maxLevel;
}

/** Coût du PROCHAIN palier de `id`. */
export function upgradeCost(l: Loadout, id: B.BabyUpgradeId): number {
  return B.babyUpgrade(id).cost(l.levels[id]);
}

/**
 * Applique un palier. Les effets sont MULTIPLICATIFS et recalculés depuis le
 * niveau, jamais accumulés en place : un cumul flottant dériverait au bout de
 * quelques achats et l'affichage du panneau mentirait.
 */
export function applyUpgrade(l: Loadout, id: B.BabyUpgradeId): void {
  if (!canUpgrade(l, id)) return;
  const n = ++l.levels[id];
  const def = B.babyUpgrade(id);
  const v = def.per * n;
  switch (id) {
    case 'dps':
      l.dpsMul = 1 + v;
      break;
    case 'rate':
      l.rateMul = 1 + v;
      break;
    case 'range':
      l.rangeMul = 1 + v;
      break;
    case 'speed':
      l.speedMul = 1 + v;
      break;
    case 'grit':
      l.gritDiv = 1 + v;
      break;
  }
}
