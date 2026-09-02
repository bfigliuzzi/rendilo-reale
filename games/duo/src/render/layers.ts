import { Container, ParticleContainer, TilingSprite } from 'pixi.js';
import type { Atlas } from './textures';

/**
 * Hiérarchie d'affichage du SHELL. Aucune caméra : tout vit en coordonnées
 * LOGIQUES, exactement celles de l'overlay de boutons — c'est ce qui permet de
 * poser un `<button>` transparent pile sur la case, la part de gâteau ou la
 * tuile dessinée dessous.
 *
 * La taille logique est un PARAMÈTRE, pas une constante : 540×960 en posture
 * 'pass', 960×540 en posture 'side'. `resize(w, h)` est appelée par le shell à
 * chaque changement de micro-jeu.
 *
 * DÉCOUPAGE ASSUMÉ : le shell ne possède que le DÉCOR (sol, motes) et les
 * EFFETS (particules, nombres flottants), qui sont les seules choses partagées
 * par les huit jeux. Tout le reste vit dans `game`, le conteneur remis à chaque
 * micro-jeu comme `MiniGameCtx.stage` : c'est LUI qui organise ses propres
 * sous-couches, parce qu'un plateau de dominos et une arène de fourmi n'ont
 * aucune raison de partager un empilement.
 *
 * L'ORDRE d'`addChild` EST l'ordre de peinture (bas → haut) et il porte du
 * sens : les motes passent SOUS le jeu (comme la météo d'Essaim) — au-dessus,
 * le « chatoyant » dégraderait la lecture des silhouettes, qui est justement ce
 * qui rend la collection jouable sans distinguer les teintes.
 */
export class Layers {
  /** Sol raccordable — un seul draw call. */
  readonly bg: TilingSprite;
  /** Motes à la dérive : décor pur, jamais informatif. */
  readonly motes: ParticleContainer;
  /** Racine du micro-jeu courant. Vidée par le shell à la sortie. */
  readonly game = new Container();
  /** Particules d'effet — au-dessus du jeu. */
  readonly fx: ParticleContainer;
  /** Nombres flottants — au-dessus de tout. */
  readonly floaters = new Container();
  /**
   * PLANCHE DE RENDU DES VIGNETTES DU MENU (§2.4 / §4.1.2), et rien d'autre.
   * Les huit démonstrations y sont peintes côte à côte, puis chaque cellule est
   * recopiée dans le `<canvas>` de sa vignette DOM (`core/demo.ts`). Elle vit
   * au-dessus de tout parce qu'elle n'est JAMAIS regardée en place : au menu, le
   * panneau opaque `#ui` la recouvre entièrement — c'est une planche, pas un
   * plan de la scène. Vide (et `visible = false`) partout ailleurs.
   */
  readonly demo = new Container();

  constructor(
    stage: Container,
    atlas: Atlas,
    private w: number,
    private h: number,
  ) {
    this.bg = new TilingSprite({ texture: atlas.ground, width: w, height: h });
    this.bg.tileScale.set(0.5); // source dessinée en supersampling ×2
    this.motes = new ParticleContainer({ dynamicProperties: { position: true, color: true } });
    this.fx = new ParticleContainer({
      dynamicProperties: { position: true, vertex: true, color: true, rotation: true },
    });

    stage.addChild(this.bg, this.motes, this.game, this.fx, this.floaters, this.demo);
  }

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  /** Changement de posture : le sol suit la nouvelle taille logique. */
  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.bg.width = w;
    this.bg.height = h;
  }
}
