// Définition data-driven d'un niveau : liste d'événements triés par distance `at`
// (en px logiques le long de la voie). Le spawner les consomme quand la caméra approche.

export type EnemyKind = 'grunt' | 'runner' | 'brute';

export interface GateModifier {
  op: 'add' | 'mul';
  value: number;
}

export type HordePattern = 'grid' | 'blob' | 'stream';

export type LevelEvent =
  | { at: number; type: 'horde'; kind: EnemyKind; count: number; pattern: HordePattern; width?: number }
  | { at: number; type: 'gates'; left: GateModifier; right: GateModifier }
  | { at: number; type: 'crate'; hp: number; xNorm: number } // xNorm ∈ [0,1] en travers de la voie
  | { at: number; type: 'finish' };

export interface LevelDef {
  scrollSpeed: number;
  startSquad?: number; // défaut : balance.START_SQUAD
  events: LevelEvent[];
}

const add = (value: number): GateModifier => ({ op: 'add', value });
const mul = (value: number): GateModifier => ({ op: 'mul', value });

/** Niveau principal : ~70 s, difficulté croissante, mur final façon « Last War ». */
export const MAIN_LEVEL: LevelDef = {
  scrollSpeed: 130,
  events: [
    { at: 250, type: 'gates', left: add(8), right: mul(2) },
    { at: 550, type: 'horde', kind: 'grunt', count: 10, pattern: 'grid' },
    { at: 950, type: 'horde', kind: 'grunt', count: 16, pattern: 'blob' },
    { at: 1150, type: 'crate', hp: 120, xNorm: 0.5 },
    { at: 1300, type: 'gates', left: add(10), right: add(-5) },
    { at: 1350, type: 'horde', kind: 'runner', count: 10, pattern: 'stream' },
    { at: 1650, type: 'horde', kind: 'grunt', count: 24, pattern: 'grid' },
    { at: 1900, type: 'gates', left: mul(2), right: add(5) },
    { at: 2150, type: 'horde', kind: 'grunt', count: 30, pattern: 'blob' },
    { at: 2150, type: 'horde', kind: 'runner', count: 8, pattern: 'stream' },
    { at: 2450, type: 'crate', hp: 250, xNorm: 0.28 },
    { at: 2450, type: 'crate', hp: 250, xNorm: 0.72 },
    { at: 2700, type: 'horde', kind: 'grunt', count: 40, pattern: 'stream' },
    { at: 3000, type: 'gates', left: add(-10), right: mul(2) },
    { at: 3300, type: 'horde', kind: 'brute', count: 6, pattern: 'grid', width: 320 },
    { at: 3600, type: 'horde', kind: 'grunt', count: 40, pattern: 'blob' },
    { at: 3900, type: 'gates', left: add(20), right: mul(2) },
    { at: 4200, type: 'horde', kind: 'runner', count: 20, pattern: 'stream' },
    { at: 4500, type: 'horde', kind: 'grunt', count: 50, pattern: 'grid', width: 400 },
    { at: 4800, type: 'crate', hp: 400, xNorm: 0.5 },
    { at: 5100, type: 'horde', kind: 'brute', count: 8, pattern: 'blob' },
    { at: 5100, type: 'horde', kind: 'grunt', count: 30, pattern: 'grid' },
    { at: 5500, type: 'gates', left: mul(3), right: add(30) },
    { at: 5900, type: 'horde', kind: 'grunt', count: 80, pattern: 'stream' },
    { at: 6300, type: 'horde', kind: 'runner', count: 30, pattern: 'grid', width: 400 },
    { at: 6700, type: 'horde', kind: 'grunt', count: 60, pattern: 'blob' },
    { at: 6700, type: 'horde', kind: 'brute', count: 10, pattern: 'grid', width: 360 },
    { at: 7100, type: 'gates', left: add(-20), right: mul(2) },
    { at: 7500, type: 'horde', kind: 'grunt', count: 100, pattern: 'stream' },
    { at: 8000, type: 'horde', kind: 'brute', count: 12, pattern: 'grid', width: 400 },
    { at: 8000, type: 'horde', kind: 'runner', count: 20, pattern: 'blob' },
    { at: 8500, type: 'horde', kind: 'grunt', count: 120, pattern: 'blob' },
    { at: 9100, type: 'finish' },
  ],
};

/** Niveau de stress (`?stress`) : hordes massives en continu pour le test de fluidité. */
export function makeStressLevel(): LevelDef {
  const events: LevelEvent[] = [{ at: 200, type: 'gates', left: mul(2), right: mul(2) }];
  for (let at = 600; at < 20000; at += 400) {
    events.push({ at, type: 'horde', kind: 'grunt', count: 70, pattern: 'blob' });
    events.push({ at: at + 150, type: 'horde', kind: 'runner', count: 25, pattern: 'stream' });
    if (at % 1200 === 600) {
      events.push({ at: at + 200, type: 'horde', kind: 'brute', count: 10, pattern: 'grid', width: 400 });
    }
    if (at % 2000 === 600) {
      events.push({ at: at + 300, type: 'gates', left: mul(2), right: add(50) });
    }
  }
  events.push({ at: 20500, type: 'finish' });
  // grosse escouade de départ : cadence de tir au plafond dès le début, c'est le but du test
  return { scrollSpeed: 130, startSquad: 500, events };
}
