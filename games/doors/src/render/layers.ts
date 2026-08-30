import { Container, Graphics, ParticleContainer, TilingSprite } from 'pixi.js';
import { DESIGN_H, DESIGN_W } from '../config/balance';
import type { Atlas } from './textures';

/**
 * Hiérarchie d'affichage. Pas de caméra : tout vit en coordonnées écran
 * 540×960, LES MÊMES que celles de l'overlay de boutons du HUD — c'est ce qui
 * permet de superposer un `<button>` transparent pile sur l'unité dessinée.
 *
 * Les motes dorées passent SOUS le gameplay, comme la météo d'Essaim : au-dessus,
 * le « chatoyant » de la charte dégraderait la lecture des silhouettes, qui est
 * justement ce qui rend le jeu jouable sans distinguer les teintes.
 */
export class Layers {
  readonly bg: TilingSprite;
  /** Motes dorées à la dérive — décor pur, jamais informatif. */
  readonly motes: ParticleContainer;
  /** Socles, cartouches, séparateur des camps (clear + redraw, ≤ 60 tracés). */
  readonly scene = new Graphics();
  /** Auréole de l'unité active et surbrillance des cibles légales. */
  readonly aura = new Container();
  /** Portes du nœud courant. */
  readonly doors = new Container();
  /** Sprites d'unités. Une seule source de texture → tout se batche. */
  readonly units = new Container();
  /** Jauges de PV, anneaux de sélection, marqueurs de ligne. */
  readonly bars = new Graphics();
  /** Noms, chiffres, ordre de tour. */
  readonly labels = new Container();
  readonly fx: ParticleContainer;
  /** Nombres flottants (dégâts, soins) — au-dessus de tout. */
  readonly floaters = new Container();

  constructor(stage: Container, atlas: Atlas) {
    this.bg = new TilingSprite({ texture: atlas.ground, width: DESIGN_W, height: DESIGN_H });
    this.bg.tileScale.set(0.5); // source dessinée en supersampling ×2
    this.motes = new ParticleContainer({ dynamicProperties: { position: true, color: true } });
    this.fx = new ParticleContainer({
      dynamicProperties: { position: true, vertex: true, color: true, rotation: true },
    });

    stage.addChild(
      this.bg,
      this.motes,
      this.scene,
      this.aura,
      this.doors,
      this.units,
      this.bars,
      this.labels,
      this.fx,
      this.floaters,
    );
  }
}
