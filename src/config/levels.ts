// Définition data-driven d'un niveau : liste d'événements triés par distance `at`
// (en px logiques le long de la voie). Le spawner les consomme quand la caméra approche.
// La campagne et l'endless sont générés dans campaign.ts ; ici : types + niveau stress.

export type EnemyKind = 'grunt' | 'runner' | 'brute' | 'kamikaze' | 'sniper' | 'elite';

export interface GateModifier {
  op: 'add' | 'mul';
  value: number;
}

export type HordePattern = 'grid' | 'blob' | 'stream';

/** hp : bloque et blesse · explosive : souffle au sol (ennemis ET escouade) ·
 *  damage/shield/drone/gold : bonus temporaire si détruite au tir (perdu au contact). */
export type CrateVariant = 'hp' | 'explosive' | 'damage' | 'shield' | 'drone' | 'gold';

export type LevelEvent =
  | {
      at: number;
      type: 'horde';
      kind: EnemyKind;
      count: number;
      pattern: HordePattern;
      width?: number;
      hpMul?: number; // défaut : LevelDef.hpMul
    }
  | { at: number; type: 'gates'; left: GateModifier; right: GateModifier }
  | { at: number; type: 'crate'; hp: number; xNorm: number; variant?: CrateVariant } // xNorm ∈ [0,1]
  | { at: number; type: 'boss'; hp: number; final?: boolean } // final : sa mort = victoire
  | { at: number; type: 'finish' };

export interface LevelDef {
  scrollSpeed: number;
  startSquad?: number; // défaut : effectif de départ du joueur (méta)
  hpMul?: number; // multiplicateur de PV ennemis (défaut 1)
  biome?: number; // index dans atlas.grounds (défaut 0)
  missileMinDist?: number; // distance sans aucune frappe (défaut balance.MISSILE_MIN_DIST)
  missileIntervalMul?: number; // étire l'intervalle du barrage de porte (défaut 1)
  events: LevelEvent[];
  /** Endless : appelé quand le spawner approche de la fin de `events` pour générer la suite. */
  extend?: (events: LevelEvent[], dist: number) => void;
}

export const gateAdd = (value: number): GateModifier => ({ op: 'add', value });
export const gateMul = (value: number): GateModifier => ({ op: 'mul', value });

/** Niveau de stress (`?stress`) : hordes massives en continu pour le test de fluidité. */
export function makeStressLevel(): LevelDef {
  const events: LevelEvent[] = [{ at: 200, type: 'gates', left: gateMul(2), right: gateMul(2) }];
  for (let at = 600; at < 20000; at += 400) {
    events.push({ at, type: 'horde', kind: 'grunt', count: 70, pattern: 'blob' });
    events.push({ at: at + 150, type: 'horde', kind: 'runner', count: 25, pattern: 'stream' });
    if (at % 1200 === 600) {
      events.push({ at: at + 200, type: 'horde', kind: 'brute', count: 10, pattern: 'grid', width: 400 });
    }
    if (at % 2000 === 600) {
      events.push({ at: at + 300, type: 'gates', left: gateMul(2), right: gateAdd(50) });
    }
  }
  events.push({ at: 20500, type: 'finish' });
  // grosse escouade de départ : cadence de tir au plafond dès le début, c'est le but du test
  return { scrollSpeed: 130, startSquad: 500, events };
}
