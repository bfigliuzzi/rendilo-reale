import { type Container, Sprite } from 'pixi.js';
import * as B from '../config/balance';
import type { Atlas } from '../render/textures';
import type { Squad } from './squad';

interface Mine {
  x: number;
  y: number;
  dead: boolean;
  sprite: Sprite;
}

/**
 * Mines : pièges au sol. Volontairement NON tirables (hors aim-assist et
 * collisions balles) — c'est un danger de lecture du terrain, le témoin rouge
 * clignote, à toi de passer à côté. Déclenchée = souffle (World.explode).
 */
export class Mines {
  list: Mine[] = [];
  onTrigger: (x: number, y: number) => void = () => {};
  private blinkT = 0;

  constructor(
    private readonly parent: Container,
    private readonly atlas: Atlas,
  ) {}

  spawn(at: number, xNorm: number): void {
    const sprite = new Sprite(this.atlas.mine);
    sprite.anchor.set(0.5);
    const x = B.LANE_MIN_X + xNorm * (B.LANE_MAX_X - B.LANE_MIN_X);
    sprite.position.set(x, -at);
    this.parent.addChild(sprite);
    this.list.push({ x, y: -at, dead: false, sprite });
  }

  update(dt: number, squad: Squad, dist: number): void {
    this.blinkT += dt;
    const blink = 0.72 + 0.28 * Math.sin(this.blinkT * 9);
    const frontY = squad.worldY(dist);
    const triggerX = B.MINE_TRIGGER_R + squad.halfWidth * squad.visualScale * 0.8;
    let anyDead = false;
    for (const mine of this.list) {
      if (mine.dead) {
        anyDead = true;
        continue;
      }
      mine.sprite.alpha = blink;
      // déclenchement quand la masse passe dessus
      if (Math.abs(mine.y - frontY) < 34 && Math.abs(mine.x - squad.x) < triggerX) {
        mine.dead = true;
        mine.sprite.destroy();
        this.onTrigger(mine.x, mine.y);
        anyDead = true;
      } else if (mine.y > -dist + B.CULL_BEHIND) {
        mine.dead = true;
        mine.sprite.destroy();
        anyDead = true;
      }
    }
    if (anyDead) this.list = this.list.filter((m) => !m.dead);
  }

  reset(): void {
    for (const mine of this.list) if (!mine.dead) mine.sprite.destroy();
    this.list = [];
  }
}
