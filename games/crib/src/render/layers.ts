import { Container, Graphics, ParticleContainer, Sprite } from 'pixi.js';

/**
 * Hiérarchie d'affichage.
 *
 * Trois espaces bien distincts, et il ne faut jamais les mélanger :
 *  - `weather` est en espace ÉCRAN ;
 *  - `world` est décalé par la caméra à chaque frame ; tout ce qu'il contient vit
 *    en coordonnées ARÈNE absolues. Le SOL en fait partie : c'est une texture cuite
 *    aux dimensions de la carte (`render/mapBake.ts`), et plus une tuile défilante
 *    en espace écran — avec trois cartes de géométries différentes, un motif
 *    infini ne pourrait plus rien dire des voies ni du terrain ;
 *  - `overlay` est en espace écran et ne bouge jamais : joystick, boussole du
 *    berceau, vignette d'engluement.
 *
 * `dynamicProperties` est déclaré au STRICT minimum : dans Pixi v8, tout canal non
 * déclaré est uploadé une seule fois, donc en ajouter un coûte de la bande passante
 * GPU à chaque frame pour rien.
 */
export class Layers {
  readonly world = new Container();

  /** Le sol baké de la carte courante. Posé par `setMap`, un seul draw call. */
  readonly ground = new Sprite();

  readonly decor = new Container(); // props non interactifs, sous tout le gameplay
  readonly puddles = new Container(); // flaques engluantes, marqueurs au sol
  readonly cone = new Graphics(); // cône d'aspiration du boss, sous les entités
  readonly ranges = new Container(); // anneau de portée du bébé, sous les entités
  readonly shadows: ParticleContainer; // ombres portées : ce qui vend le top-down
  readonly pickups: ParticleContainer;
  /** Bâtiments : au-dessus du sol, sous les entités mobiles. */
  readonly buildings = new Container();
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

  constructor(stage: Container) {
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

    stage.addChild(this.world, this.weather, this.overlay);
    this.world.addChild(
      this.ground,
      this.decor,
      this.puddles,
      this.cone,
      this.ranges,
      this.shadows,
      this.pickups,
      this.buildings,
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
