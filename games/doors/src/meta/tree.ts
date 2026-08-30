import { FRONT_CAP_TIGHT, LINE_CAP } from '../config/balance';
import type { MetaEffects } from '../game/run';
import type { SaveData } from './save';

/**
 * L'arbre de méta du POC : CINQ nœuds, et pas un seul bonus chiffré. Chacun
 * OUVRE une option ou modifie une règle — c'est le correctif à la faiblesse
 * habituelle des stats permanentes, qui rendent les premières runs
 * artificiellement dures et les tardives triviales.
 */
export type MetaId = 'tightRanks' | 'purse' | 'keenEye' | 'sister' | 'respite';

export interface MetaNode {
  id: MetaId;
  name: string;
  icon: string;
  cost: number;
  effect: string;
  /** Pourquoi ce nœud existe — affiché en clair, c'est aussi le tutoriel. */
  why: string;
}

export const META_NODES: readonly MetaNode[] = [
  {
    id: 'tightRanks',
    name: 'Rang serré',
    icon: '🛡️',
    cost: 60,
    effect: 'Ligne avant à 3 places (l’escouade reste plafonnée à 4).',
    why: 'Le seul nœud qui change une run entière : il autorise une composition défensive qui n’existait pas.',
  },
  {
    id: 'purse',
    name: 'Bourse renforcée',
    icon: '👛',
    cost: 25,
    effect: 'Commencer chaque run avec 15 or.',
    why: 'De quoi ressusciter une fois avant le premier marchand — la run cesse de mourir au nœud 2.',
  },
  {
    id: 'keenEye',
    name: 'Œil averti',
    icon: '👁️',
    cost: 40,
    effect: 'Une porte voilée révélée par run, au moment de ton choix.',
    why: 'Le pari devient une décision : tu choisis QUAND tu refuses de parier.',
  },
  {
    id: 'sister',
    name: 'Sœur d’armes',
    icon: '⚔️',
    cost: 50,
    effect: 'Second héros jouable — 28 PV · 4 ATQ · 4 INIT, avec l’Écu bosselé.',
    why: 'Une ouverture de front, là où le Vagabond ouvre en polyvalence.',
  },
  {
    id: 'respite',
    name: 'Répit',
    icon: '🕯️',
    cost: 70,
    effect: 'Une résurrection gratuite par run.',
    why: 'Une mort pardonnée, pas deux : l’or reste la vraie contrainte.',
  },
];

export function metaNode(id: MetaId): MetaNode {
  return META_NODES.find((n) => n.id === id) ?? META_NODES[0];
}

export function isUnlocked(save: SaveData, id: MetaId): boolean {
  return save.unlocked[id] === true;
}

/** Les effets de méta, DÉRIVÉS du save — jamais stockés en double. */
export function metaEffects(save: SaveData): MetaEffects {
  return {
    frontCap: isUnlocked(save, 'tightRanks') ? FRONT_CAP_TIGHT : LINE_CAP,
    startGold: isUnlocked(save, 'purse') ? 15 : 0,
    veiledReveals: isUnlocked(save, 'keenEye') ? 1 : 0,
    heroes: isUnlocked(save, 'sister') ? ['wanderer', 'sister'] : ['wanderer'],
    freeRevives: isUnlocked(save, 'respite') ? 1 : 0,
  };
}

/** Achat d'un nœud. Écrit le save UNIQUEMENT via Flow (invariant du repo). */
export function canAfford(save: SaveData, id: MetaId): boolean {
  return !isUnlocked(save, id) && save.shards >= metaNode(id).cost;
}
