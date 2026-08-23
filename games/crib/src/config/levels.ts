import { mulberry32 } from '@shared/rng';
import * as B from './balance';
import type { EnemyKindId, PickupKindId } from './balance';

/**
 * Niveaux data-driven. Contrairement à horde (où `at` est une DISTANCE, le monde
 * défilant sous le joueur), l'arène de Berceau est fixe : `at` est un TEMPS en
 * secondes depuis le début de la partie.
 *
 * `events` DOIT être trié par `at` croissant — le spawner le consomme dans l'ordre
 * avec un simple curseur, il ne re-trie rien.
 */
export type LevelEvent =
  | {
      at: number;
      type: 'wave';
      kind: EnemyKindId;
      count: number;
      /** Ouverture de l'éventail de spawn, en radians. */
      arc: number;
      /** Direction du spawn ; omis ⇒ tiré au seed du niveau. */
      angle?: number;
    }
  | { at: number; type: 'pickup'; variant: PickupKindId; x: number; y: number }
  | { at: number; type: 'boss' }
  /** Dernier événement : la victoire attend que l'arène soit vide. */
  | { at: number; type: 'clear' };

export interface LevelDef {
  id: string;
  name: string;
  seed: number;
  arenaW: number;
  arenaH: number;
  /** Position du berceau. Elle n'est plus au centre par nature : chaque carte la pose. */
  cribX: number;
  cribY: number;
  cribHp: number;
  /** Multiplicateur global de PV ennemis — le levier de difficulté le plus direct. */
  hpMul: number;
  events: LevelEvent[];
}

const TAU = Math.PI * 2;

/**
 * Niveau de test : ~3 min, une courbe montante qui INTRODUIT les archétypes un par
 * un avant de les mêler. L'ordre pédagogique est délibéré — couche (« intercepte »)
 * → mamie (« on peut te clouer ») → brocoli (« bouge ») → mêlée → boss.
 *
 * Les respirations portent les ramassables : elles servent à la fois de récompense
 * et de temps de trajet volontaire loin du berceau.
 */
export function makeTestLevel(seed = 0xbebe): LevelDef {
  return {
    id: 'garden',
    name: 'Le jardin',
    seed,
    arenaW: B.ARENA_W,
    arenaH: B.ARENA_H,
    cribX: B.CRIB_X,
    cribY: B.CRIB_Y,
    cribHp: B.CRIB_HP,
    hpMul: 1,
    events: [
      // — Acte I : la couche sale. Objectif : comprendre qu'il faut intercepter.
      { at: 2, type: 'wave', kind: 'nappy', count: 3, arc: 0.5 },
      { at: 10, type: 'wave', kind: 'nappy', count: 4, arc: 0.7 },

      // — Acte II : la mamie. Premier engluement, sur une seule cible tuable.
      { at: 18, type: 'wave', kind: 'granny', count: 2, arc: 0.9 },
      { at: 24, type: 'pickup', variant: 'bottle', x: B.CRIB_X + 190, y: B.CRIB_Y - 150 },
      { at: 27, type: 'wave', kind: 'nappy', count: 5, arc: 1.1 },
      { at: 32, type: 'wave', kind: 'granny', count: 1, arc: 0.3 },

      // — Acte III : le brocoli. On ne peut plus rester immobile.
      { at: 40, type: 'wave', kind: 'broccoli', count: 2, arc: 0.8 },
      { at: 48, type: 'wave', kind: 'nappy', count: 6, arc: 1.4 },
      { at: 54, type: 'pickup', variant: 'blanket', x: B.CRIB_X - 210, y: B.CRIB_Y + 170 },
      { at: 57, type: 'wave', kind: 'granny', count: 2, arc: 1.2 },
      { at: 60, type: 'wave', kind: 'broccoli', count: 2, arc: 1 },

      // — Acte IV : la mêlée. Les trois rôles ensemble, sur deux flancs.
      { at: 70, type: 'wave', kind: 'nappy', count: 7, arc: 1.6 },
      { at: 74, type: 'wave', kind: 'granny', count: 3, arc: 2.2 },
      { at: 78, type: 'pickup', variant: 'pacifier', x: B.CRIB_X + 60, y: B.CRIB_Y + 260 },
      { at: 82, type: 'wave', kind: 'broccoli', count: 3, arc: 1.8 },
      { at: 88, type: 'wave', kind: 'nappy', count: 8, arc: 2.4 },
      { at: 94, type: 'wave', kind: 'granny', count: 2, arc: 0.8 },

      // — Respiration avant le boss : de quoi se refaire, pas de quoi souffler.
      { at: 102, type: 'pickup', variant: 'bottle', x: B.CRIB_X - 120, y: B.CRIB_Y - 250 },
      { at: 104, type: 'pickup', variant: 'pacifier', x: B.CRIB_X + 240, y: B.CRIB_Y + 90 },
      { at: 108, type: 'wave', kind: 'nappy', count: 5, arc: 1.2 },

      // — Acte V : l'Aspirateur, escorté juste assez pour empêcher le duel propre.
      // L'escorte compte double ici : le tir auto vise le PLUS PROCHE, donc chaque
      // couche vivante est du DPS volé au boss.
      { at: 116, type: 'boss' },
      { at: 124, type: 'wave', kind: 'nappy', count: 4, arc: 1 },
      { at: 132, type: 'wave', kind: 'granny', count: 2, arc: 1.4 },
      { at: 140, type: 'wave', kind: 'broccoli', count: 2, arc: 1.2 },
      { at: 148, type: 'wave', kind: 'nappy', count: 6, arc: 1.8 },

      // Après ce point, plus rien n'arrive : tuer le boss et nettoyer suffit.
      // Calé serré exprès — au premier tuning (clear à 190) le boss tombait vers
      // 140 s et il restait cinquante secondes de vagues sans aucun enjeu. Un joueur
      // lent sur le boss n'est pas puni par de nouvelles vagues : c'est le boss qui
      // ronge le berceau, et ce timer-là suffit.
      { at: 156, type: 'clear' },
    ],
  };
}

/**
 * Vérifie l'invariant du spawner en dev : `events` trié par `at`. Un événement mal
 * placé serait consommé trop tôt (ou jamais) sans le moindre message d'erreur.
 */
export function assertSorted(def: LevelDef): void {
  for (let i = 1; i < def.events.length; i++) {
    if (def.events[i].at < def.events[i - 1].at) {
      throw new Error(`${def.id} : events non trié à l'index ${i}`);
    }
  }
}

/**
 * Angles de spawn du niveau, pré-tirés au seed pour les vagues qui n'imposent pas
 * leur direction. Pré-calculé plutôt que tiré au vol : le spawner ne doit rien
 * allouer ni faire avancer d'état aléatoire pendant le tick.
 */
export function spawnAngles(def: LevelDef): Float32Array<ArrayBuffer> {
  const rand = mulberry32(def.seed);
  const out = new Float32Array(def.events.length);
  for (let i = 0; i < def.events.length; i++) {
    const ev = def.events[i];
    out[i] = ev.type === 'wave' && ev.angle !== undefined ? ev.angle : rand() * TAU;
  }
  return out;
}
