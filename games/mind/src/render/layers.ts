import { Container, Graphics, ParticleContainer, TilingSprite } from 'pixi.js';
import { DESIGN_H, DESIGN_W } from '../config/balance';
import type { Atlas } from './textures';

/**
 * Hiérarchie d'affichage. Pas de caméra : tout vit en coordonnées écran 540×960,
 * les mêmes que celles de l'overlay de boutons du HUD — c'est ce qui permet de
 * superposer un `<button>` transparent pile sur le pion dessiné.
 *
 * L'AMBIANCE (motes à la dérive) passe SOUS le plateau, comme la météo d'Essaim :
 * au-dessus, elle dégraderait la lecture des formes et des glyphes des pions,
 * qui est justement ce qui rend le jeu accessible aux daltoniens.
 */
export class Layers {
  readonly bg: TilingSprite;
  /** Halos d'ambiance : chaud/froid selon l'avancement, vignette de tension. */
  readonly glow = new Container();
  /** Motes violettes à la dérive — décor pur, sous le gameplay. */
  readonly ambient: ParticleContainer;
  /** Cadres du plateau, séparateurs, arcs (clear + redraw, ≤ 40 tracés). */
  readonly board = new Graphics();
  /** Pions : socles, code secret, lignes jouées, palette. Une seule source → batché. */
  readonly pegs = new Container();
  /** Marqueurs d'indice. */
  readonly marks = new Container();
  /** Numéros d'essai, compteurs, statut. */
  readonly labels = new Container();
  /** Rayons de victoire (Sprites, ~14 au plus). */
  readonly rays = new Container();
  /** Le chat — au-dessus du plateau, sous les effets. */
  readonly cat = new Container();
  readonly fx: ParticleContainer;
  /** Anneaux de sélection, vignette de tension, flash — au-dessus de tout. */
  readonly overlay = new Graphics();
  /** Pion porté au doigt pendant un glisser-déposer. */
  readonly drag = new Container();

  constructor(
    readonly stage: Container,
    atlas: Atlas,
  ) {
    this.bg = new TilingSprite({ texture: atlas.ground, width: DESIGN_W, height: DESIGN_H });
    this.bg.tileScale.set(0.5); // sources canvas en supersampling ×2
    // uv dynamique : le pool alterne étincelle et confetti sur la même source
    this.ambient = new ParticleContainer({ dynamicProperties: { position: true, color: true } });
    this.fx = new ParticleContainer({
      dynamicProperties: { position: true, vertex: true, color: true, rotation: true, uv: true },
    });

    stage.addChild(
      this.bg,
      this.glow,
      this.ambient,
      this.board,
      this.pegs,
      this.marks,
      this.labels,
      this.rays,
      this.cat,
      this.fx,
      this.overlay,
      this.drag,
    );
  }
}
