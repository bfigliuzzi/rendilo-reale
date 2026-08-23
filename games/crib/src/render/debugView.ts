import { Graphics, type Container } from 'pixi.js';
import * as B from '../config/balance';
import type { Level } from '../game/level';
import { T_ENEMY, T_HERO, T_LANE, T_SLOW } from '../game/terrain';

/**
 * Overlay `?debug` : le masque de terrain, les nœuds de voie et les emplacements,
 * dessinés tels que la SIMULATION les voit — pas tels que le rendu les suggère.
 *
 * Ce n'est pas un confort. Un bug de bake (une voie qui ne creuse pas, une bande
 * plus fine que prévu, un emplacement dans un massif) est parfaitement invisible en
 * jeu : on constate juste que « les ennemis font n'importe quoi ». C'est le seul
 * outil qui montre la cause. Rendu UNE fois au chargement, jamais au tick.
 */
export class DebugView {
  private readonly g = new Graphics();

  constructor(parent: Container) {
    this.g.visible = false;
    parent.addChild(this.g);
  }

  setup(level: Level): void {
    const t = level.terrain;
    const tile = B.TERRAIN_TILE;
    const g = this.g;
    g.visible = true;
    g.clear();

    for (let cy = 0; cy < t.rows; cy++) {
      for (let cx = 0; cx < t.cols; cx++) {
        const f = t.mask[cy * t.cols + cx];
        if (f === 0) continue;
        // haie = vert (bloque la horde seule), mur/eau = rouge, voie = ocre
        const color = (f & T_HERO) !== 0 ? 0xd94f4f : (f & T_SLOW) !== 0 ? 0x4fd97a : (f & T_ENEMY) !== 0 ? 0xd9a94f : 0xe0c060;
        const alpha = (f & T_LANE) !== 0 ? 0.18 : 0.4;
        g.rect(cx * tile, cy * tile, tile - 1, tile - 1).fill({ color, alpha });
      }
    }

    for (let l = 0; l < t.laneCount.length; l++) {
      const s = t.laneStart[l];
      const n = t.laneCount[l];
      g.moveTo(t.nodeX[s], t.nodeY[s]);
      for (let i = 1; i < n; i++) g.lineTo(t.nodeX[s + i], t.nodeY[s + i]);
      g.stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
      for (let i = 0; i < n; i++) {
        g.rect(t.nodeX[s + i] - 4, t.nodeY[s + i] - 4, 8, 8).fill({ color: 0xffffff, alpha: 0.9 });
      }
    }

    for (const slot of level.def.map.slots) {
      g.rect(slot.x - 14, slot.y - 14, 28, 28).stroke({
        color: slot.accepts === 'barricade' ? 0x8fd0ff : 0xffd166,
        width: 3,
      });
    }
  }
}
