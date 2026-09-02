import type { MiniGameDef } from '../core/minigame';
import * as ant from '../games/ant';
import * as beast from '../games/beast';
import * as cake from '../games/cake';
import * as mirror from '../games/mirror';
import * as plank from '../games/plank';
import * as suspects from '../games/suspects';
import * as tiles from '../games/tiles';
import * as tree from '../games/tree';

/**
 * Registre des huit micro-jeux. `games/duo/` est UNE entrée du hub, pas huit :
 * sinon le menu du hub explose et chaque micro-jeu repaie un boot Pixi. Ce
 * tableau EST le sous-menu interne.
 *
 * L'ORDRE est celui de la grille de sélection, et il n'est pas neutre : les
 * deux jeux coopératifs `side` ouvrent la liste (aucune règle, un but visible,
 * personne ne perd), les trois duels au tour par tour suivent, les trois jeux
 * asymétriques ferment. Un enfant qui découvre la collection tombe donc
 * d'abord sur le jeu le moins cher à comprendre.
 *
 * Chaque `games/<id>/index.ts` exporte exactement deux choses : `def`
 * (le `MiniGameDef`) et `Model` (le modèle PUR, réexporté sous ce nom pour que
 * `window.__game.models` soit uniforme, cf. §7). Les huit dossiers sont
 * strictement DISJOINTS : aucun n'importe un autre.
 */
export const GAMES: readonly MiniGameDef[] = [
  plank.def,
  mirror.def,
  cake.def,
  tree.def,
  tiles.def,
  beast.def,
  suspects.def,
  ant.def,
];

export function gameById(id: string): MiniGameDef | null {
  for (const g of GAMES) if (g.id === id) return g;
  return null;
}

/**
 * Les huit modèles PURS, exposés au bot par `window.__game.models` : c'est ce
 * qui lui permet de monter ses assertions `rules` et son fuzz `gen` HORS de
 * toute partie, sans cliquer un seul bouton (pattern de `Combat`/`Run` dans
 * Trois Portes). Typé `unknown` : chaque modèle a sa propre signature, et
 * mentir ici avec un type commun ne servirait qu'à contraindre les huit jeux.
 */
export const MODELS: Readonly<Record<string, unknown>> = {
  plank: plank.Model,
  mirror: mirror.Model,
  cake: cake.Model,
  tree: tree.Model,
  tiles: tiles.Model,
  beast: beast.Model,
  suspects: suspects.Model,
  ant: ant.Model,
};
