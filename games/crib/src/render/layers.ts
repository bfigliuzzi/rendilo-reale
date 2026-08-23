import { Container, Graphics, ParticleContainer, TilingSprite } from 'pixi.js';
import { DESIGN_H, DESIGN_W } from '../config/balance';
import type { Atlas } from './textures';

/**
 * Hiérarchie d'affichage.
 *
 * Trois espaces bien distincts, et il ne faut jamais les mélanger :
 *  - `ground` et `weather` sont en espace ÉCRAN (le sol défile par `tilePosition`) ;
 *  - `world` est décalé par la caméra à chaque frame ; tout ce qu'il contient vit
 *    en coordonnées ARÈNE absolues, [0..ARENA_W] × [0..ARENA_H] ;
 *  - `overlay` est en espace écran et ne bouge jamais : joystick, boussole du
 *    berceau, vignette d'engluement.
 *
 * `dynamicProperties` est déclaré au STRICT minimum : dans Pixi v8, tout canal non
 * déclaré est uploadé une seule fois, donc en ajouter un coûte de la bande passante
 * GPU à chaque frame pour rien.
 */
export class Layers {
  readonly ground: TilingSprite;
  readonly world = new Container();

  readonly decor = new Container(); // props non interactifs, sous tout le gameplay
  readonly puddles = new Container(); // flaques engluantes, marqueurs au sol
  readonly cone = new Graphics(); // cône d'aspiration du boss, sous les entités
  readonly ranges = new Container(); // anneau de portée du bébé, sous les entités
  readonly shadows: ParticleContainer; // ombres portées : ce qui vend le top-down
  readonly pickups: ParticleContainer;
  readonly crib = new Container();
  readonly enemies: ParticleContainer;
  readonly boss = new Container();
  readonly hero = new Container();
  /** Anneau de grip et filets de bave : au-dessus du bébé, sinon il les masque. */
  readonly marks = new Graphics();
  readonly bullets: ParticleContainer;
  readonly peas: ParticleContainer;
  readonly fx: ParticleContainer;

  readonly weather = new Container();
  readonly overlay = new Container();

  constructor(stage: Container, atlas: Atlas) {
    this.ground = new TilingSprite({ texture: atlas.ground, width: DESIGN_W, height: DESIGN_H });

    // ombres : `vertex` obligatoire — un slot réutilisé par un autre archétype
    // change de taille, et une ombre de mamie sous un sac à poussière se voit
    this.shadows = new ParticleContainer({ dynamicProperties: { position: true, vertex: true } });
    // ramassables : `uv` pour la variante du slot, `color` pour le clignotement de fin de vie
    this.pickups = new ParticleContainer({ dynamicProperties: { position: true, uv: true, color: true } });
    // ennemis : `uv` pour le cycle de marche à 2 frames et la réutilisation de slot
    // par un autre archétype ; `vertex` pour le flip X selon le sens de déplacement
    this.enemies = new ParticleContainer({
      dynamicProperties: { position: true, uv: true, vertex: true },
    });
    // `rotation` : le cube-hochet tourne en vol, c'est ce qui le distingue d'un
    // point qui glisse — et le seul canal supplémentaire qu'il coûte
    this.bullets = new ParticleContainer({ dynamicProperties: { position: true, rotation: true } });
    this.peas = new ParticleContainer({ dynamicProperties: { position: true } });
    this.fx = new ParticleContainer({ dynamicProperties: { position: true, vertex: true, color: true } });

    stage.addChild(this.ground, this.world, this.weather, this.overlay);
    this.world.addChild(
      this.decor,
      this.puddles,
      this.cone,
      this.ranges,
      this.shadows,
      this.pickups,
      this.crib,
      this.enemies,
      this.boss,
      this.hero,
      this.marks,
      this.bullets,
      this.peas,
      this.fx,
    );
  }
}
