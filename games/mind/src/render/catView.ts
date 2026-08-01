import { Sprite } from 'pixi.js';
import type { Container } from 'pixi.js';
import { lerp } from '@shared/math';
import type { Cat } from '../game/cat';
import type { Atlas } from './textures';

/** Les sources canvas sont en supersampling ×2. */
const SPRITE_SCALE = 0.5;

/**
 * Rendu du chat : un seul Sprite dont on change la frame. Le retournement
 * horizontal est gratuit (`scaleX` négatif), donc l'atlas ne contient qu'un sens
 * de marche.
 */
export class CatView {
  private readonly sprite: Sprite;

  constructor(
    layer: Container,
    private readonly atlas: Atlas,
  ) {
    this.sprite = new Sprite(atlas.catFrames[0][0]);
    // ancre au bas du sprite : le chat est posé au sol, pas centré dessus
    this.sprite.anchor.set(0.5, 0.92);
    this.sprite.scale.set(SPRITE_SCALE);
    this.sprite.visible = false;
    layer.addChild(this.sprite);
  }

  sync(cat: Cat, alpha: number): void {
    this.sprite.visible = cat.enabled;
    if (!cat.enabled) return;
    const frames = this.atlas.catFrames[cat.animGroup];
    this.sprite.texture = frames[Math.min(cat.animFrame, frames.length - 1)];
    this.sprite.position.set(lerp(cat.prevX, cat.x, alpha), lerp(cat.prevY, cat.y, alpha));
    this.sprite.scale.set(SPRITE_SCALE * cat.facing, SPRITE_SCALE);
  }

  hide(): void {
    this.sprite.visible = false;
  }
}
