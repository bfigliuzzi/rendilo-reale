import * as B from './balance';
import type { EnemyKindId, PickupKindId } from './balance';
import { GARDEN, type MapDef } from './maps';

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
      /** Voie d'arrivée (`LaneDef.id`). C'est ELLE qui remplace l'ancien angle de
       *  spawn : une vague entre par un chemin, plus par un secteur du cercle. */
      lane: string;
      /** Fraction de la largeur de voie occupée par le front, 0..1. Défaut 0,7. */
      spread?: number;
    }
  | { at: number; type: 'pickup'; variant: PickupKindId; x: number; y: number }
  | { at: number; type: 'boss'; lane: string }
  /** Dernier événement : la victoire attend que l'arène soit vide. */
  | { at: number; type: 'clear' };

export interface LevelDef {
  id: string;
  name: string;
  seed: number;
  /** La GÉOMÉTRIE : arène, berceau, voies, terrain, emplacements. */
  map: MapDef;
  cribHp: number;
  /** Multiplicateur global de PV ennemis — le levier de difficulté le plus direct. */
  hpMul: number;
  events: LevelEvent[];
}

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
    name: GARDEN.name,
    seed,
    map: GARDEN,
    cribHp: B.CRIB_HP,
    hpMul: 1,
    events: [
      // — Acte I : la couche sale, par le portail SEUL. Objectif : comprendre
      // qu'il faut intercepter, et qu'une voie a un début et une fin.
      { at: 2, type: 'wave', kind: 'nappy', count: 3, lane: 'portail', spread: 0.4 },
      { at: 10, type: 'wave', kind: 'nappy', count: 4, lane: 'portail', spread: 0.6 },

      // — Acte II : les mûres s'ouvrent. Premier arbitrage : on ne peut plus tout
      // tenir depuis un seul point.
      { at: 18, type: 'wave', kind: 'granny', count: 2, lane: 'mures', spread: 0.5 },
      { at: 24, type: 'pickup', variant: 'bottle', x: GARDEN.cribX + 190, y: GARDEN.cribY - 150 },
      { at: 27, type: 'wave', kind: 'nappy', count: 5, lane: 'portail', spread: 0.7 },
      { at: 32, type: 'wave', kind: 'granny', count: 1, lane: 'mures', spread: 0.2 },

      // — Acte III : le brocoli. On ne peut plus rester immobile.
      { at: 40, type: 'wave', kind: 'broccoli', count: 2, lane: 'mures', spread: 0.5 },
      { at: 48, type: 'wave', kind: 'nappy', count: 6, lane: 'portail', spread: 0.8 },
      { at: 54, type: 'pickup', variant: 'blanket', x: GARDEN.cribX - 210, y: GARDEN.cribY + 170 },
      { at: 57, type: 'wave', kind: 'granny', count: 2, lane: 'portail', spread: 0.7 },
      { at: 60, type: 'wave', kind: 'broccoli', count: 2, lane: 'mures', spread: 0.6 },

      // — Acte IV : la mêlée. Les trois rôles ensemble, ET les deux voies à la fois.
      { at: 70, type: 'wave', kind: 'nappy', count: 7, lane: 'mures', spread: 0.85 },
      { at: 72, type: 'wave', kind: 'nappy', count: 4, lane: 'portail', spread: 0.7 },
      { at: 74, type: 'wave', kind: 'granny', count: 3, lane: 'portail', spread: 0.85 },
      { at: 78, type: 'pickup', variant: 'pacifier', x: GARDEN.cribX + 60, y: GARDEN.cribY + 260 },
      { at: 82, type: 'wave', kind: 'broccoli', count: 3, lane: 'mures', spread: 0.7 },
      { at: 88, type: 'wave', kind: 'nappy', count: 8, lane: 'portail', spread: 0.85 },
      { at: 94, type: 'wave', kind: 'granny', count: 2, lane: 'mures', spread: 0.5 },

      // — Respiration avant le boss : de quoi se refaire, pas de quoi souffler.
      { at: 102, type: 'pickup', variant: 'bottle', x: GARDEN.cribX - 120, y: GARDEN.cribY - 250 },
      { at: 104, type: 'pickup', variant: 'pacifier', x: GARDEN.cribX + 240, y: GARDEN.cribY + 90 },
      { at: 108, type: 'wave', kind: 'nappy', count: 5, lane: 'mures', spread: 0.7 },

      // — Acte V : l'Aspirateur, escorté juste assez pour empêcher le duel propre.
      // L'escorte compte double ici : le tir auto vise le PLUS PROCHE, donc chaque
      // couche vivante est du DPS volé au boss. Il remonte l'allée du portail — la
      // voie la plus longue : c'est ce qui laisse le temps de nettoyer avant lui.
      { at: 116, type: 'boss', lane: 'portail' },
      { at: 124, type: 'wave', kind: 'nappy', count: 4, lane: 'mures', spread: 0.6 },
      { at: 132, type: 'wave', kind: 'granny', count: 2, lane: 'mures', spread: 0.7 },
      { at: 140, type: 'wave', kind: 'broccoli', count: 2, lane: 'portail', spread: 0.6 },
      { at: 148, type: 'wave', kind: 'nappy', count: 6, lane: 'mures', spread: 0.85 },

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
