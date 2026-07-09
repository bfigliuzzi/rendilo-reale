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
  readonly decor = new Container(); // props non interactifs, sous tout le gameplay
  readonly weather = new Container(); // météo ambiante, espace écran, au-dessus du monde
  readonly gates = new Container();
  readonly crates = new Container();
  readonly enemies: ParticleContainer;
  readonly squad = new Container();
  readonly bullets: ParticleContainer;
  readonly fx: ParticleContainer;
  readonly labels = new Container();

  constructor(stage: Container, atlas: Atlas) {
    this.ground = new TilingSprite({ texture: atlas.grounds[0], width: DESIGN_W, height: DESIGN_H });
    // uv dynamique pour les ennemis : la frame change quand un slot du pool est réutilisé par un autre type
    this.enemies = new ParticleContainer({ dynamicProperties: { position: true, uv: true } });
    // uv dynamique : la frame d'une balle change quand le slot est réutilisé par une autre classe
    this.bullets = new ParticleContainer({ dynamicProperties: { position: true, uv: true } });
    // particules d'effets : échelle et teinte/alpha varient pendant la vie
    this.fx = new ParticleContainer({ dynamicProperties: { position: true, vertex: true, color: true } });

    stage.addChild(this.ground, this.world, this.weather);
    this.world.addChild(
      this.decor,
      this.gates,
      this.crates,
      this.enemies,
      this.squad,
      this.bullets,
      this.fx,
      this.labels,
    );
  }
}
