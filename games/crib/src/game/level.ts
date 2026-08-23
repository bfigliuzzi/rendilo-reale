import type { LevelDef } from '../config/levels';

/**
 * Le niveau EN COURS, sous sa forme runtime : la définition de données plus tout ce
 * qui en est dérivé au chargement.
 *
 * Il existe pour une raison précise : jusqu'ici, `ARENA_W/H` et `CRIB_X/Y` étaient
 * des constantes de module lues un peu partout. Avec trois cartes de tailles et de
 * géométries différentes, une seule de ces lectures oubliée est un bug qui
 * n'apparaît QUE sur la carte 2 — d'où la règle : plus aucune lecture de `B.ARENA_*`
 * ni de `B.CRIB_*` hors de `config/`, on lit ce niveau-ci ou on reçoit la valeur en
 * paramètre.
 */
export interface Level {
  readonly def: LevelDef;
  readonly w: number;
  readonly h: number;
  readonly cribX: number;
  readonly cribY: number;
}

export function makeLevel(def: LevelDef): Level {
  return { def, w: def.arenaW, h: def.arenaH, cribX: def.cribX, cribY: def.cribY };
}
