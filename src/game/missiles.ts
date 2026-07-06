import { type Container, Sprite } from 'pixi.js';
import * as B from '../config/balance';
import type { Atlas } from '../render/textures';

/**
 * Frappes de missiles : un marqueur d'alerte pulse au sol pendant
 * MISSILE_WARNING secondes, puis l'impact détone (résolu par World.explode).
 * Le sentiment d'urgence vient de là : il faut bouger, tout de suite.
 */
class Strike {
  t = B.MISSILE_WARNING;
  done = false;
  private readonly ring: Sprite;
  private readonly core: Sprite;

  constructor(
    readonly x: number,
    readonly y: number,
    parent: Container,
    atlas: Atlas,
  ) {
    this.ring = new Sprite(atlas.spark);
    this.ring.anchor.set(0.5);
    this.ring.tint = 0xef4444;
    this.ring.alpha = 0.4;
    this.ring.width = this.ring.height = B.MISSILE_RADIUS * 2;
    this.ring.position.set(x, y);
    this.core = new Sprite(atlas.spark);
    this.core.anchor.set(0.5);
    this.core.tint = 0xfca5a5;
    this.core.position.set(x, y);
    parent.addChild(this.ring, this.core);
  }

  update(dt: number): boolean {
    this.t -= dt;
    const progress = 1 - this.t / B.MISSILE_WARNING;
    // le cœur grossit vers la zone réelle, l'anneau pulse de plus en plus vite
    const core = B.MISSILE_RADIUS * 2 * progress;
    this.core.width = this.core.height = Math.max(8, core);
    this.core.alpha = 0.35 + 0.3 * Math.sin(progress * progress * 40);
    this.ring.alpha = 0.25 + 0.2 * Math.sin(progress * 30);
    return this.t <= 0;
  }

  destroySelf(): void {
    if (this.done) return;
    this.done = true;
    this.ring.destroy();
    this.core.destroy();
  }
}

export class Missiles {
  onImpact: (x: number, y: number) => void = () => {};
  onWarn: () => void = () => {};
  private list: Strike[] = [];

  constructor(
    private readonly parent: Container,
    private readonly atlas: Atlas,
  ) {}

  spawn(x: number, y: number): void {
    this.list.push(new Strike(x, y, this.parent, this.atlas));
    this.onWarn();
  }

  update(dt: number): void {
    let anyDone = false;
    for (const strike of this.list) {
      if (strike.update(dt)) {
        strike.destroySelf();
        this.onImpact(strike.x, strike.y);
        anyDone = true;
      }
    }
    if (anyDone) this.list = this.list.filter((s) => !s.done);
  }

  reset(): void {
    for (const strike of this.list) strike.destroySelf();
    this.list = [];
  }
}
