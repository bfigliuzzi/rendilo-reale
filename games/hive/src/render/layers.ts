import { Container, Graphics, ParticleContainer, TilingSprite } from 'pixi.js';
import { DESIGN_H, DESIGN_W } from '../config/balance';
import type { Atlas } from './textures';

/**
 * Hiérarchie d'affichage. Pas de caméra : tout vit en coordonnées écran 540×960.
 * Orbites, unités et fx sont des ParticleContainer : un draw call chacun
 * (les frames d'unités viennent de la même source canvas).
 */
export class Layers {
  readonly bg: TilingSprite;
  readonly nodes = new Container();
  readonly orbit: ParticleContainer;
  readonly units: ParticleContainer;
  readonly fx: ParticleContainer;
  readonly arcs = new Graphics(); // arcs de progression d'upgrade (≤ 16, clear+redraw)
  readonly labels = new Container();
  readonly overlay = new Graphics(); // flèche de drag, au-dessus de tout

  constructor(
    readonly stage: Container,
    atlas: Atlas,
  ) {
    this.bg = new TilingSprite({ texture: atlas.honeyTile, width: DESIGN_W, height: DESIGN_H });
    this.bg.tileScale.set(0.5); // sources canvas en supersampling ×2
    // uv dynamique : la frame d'un slot change quand il est réutilisé par l'autre faction ;
    // rotation dynamique : les insectes orbitent « tête la première »
    this.orbit = new ParticleContainer({ dynamicProperties: { position: true, uv: true, rotation: true } });
    this.units = new ParticleContainer({ dynamicProperties: { position: true, uv: true } });
    // fx : échelle, teinte et alpha varient pendant la vie des particules
    this.fx = new ParticleContainer({ dynamicProperties: { position: true, vertex: true, color: true } });

    stage.addChild(this.bg, this.orbit, this.nodes, this.units, this.fx, this.arcs, this.labels, this.overlay);
  }
}
