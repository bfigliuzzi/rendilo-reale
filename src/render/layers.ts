import { Container, ParticleContainer, TilingSprite } from 'pixi.js';
import { DESIGN_H, DESIGN_W } from '../config/balance';
import type { Atlas } from './textures';

/**
 * Hiérarchie d'affichage. `world` est décalé de la caméra à chaque frame ;
 * tout ce qu'il contient vit en coordonnées monde (avancer = worldY négatif).
 * Balles et ennemis sont des ParticleContainer : un draw call chacun.
 */
export class Layers {
  readonly ground: TilingSprite;
  readonly world = new Container();
  readonly gates = new Container();
  readonly crates = new Container();
  readonly enemies: ParticleContainer;
  readonly squad = new Container();
  readonly bullets: ParticleContainer;
  readonly labels = new Container();

  constructor(stage: Container, atlas: Atlas) {
    this.ground = new TilingSprite({ texture: atlas.ground, width: DESIGN_W, height: DESIGN_H });
    // uv dynamique pour les ennemis : la frame change quand un slot du pool est réutilisé par un autre type
    this.enemies = new ParticleContainer({ dynamicProperties: { position: true, uv: true } });
    this.bullets = new ParticleContainer({ dynamicProperties: { position: true } });

    stage.addChild(this.ground, this.world);
    this.world.addChild(this.gates, this.crates, this.enemies, this.squad, this.bullets, this.labels);
  }
}
