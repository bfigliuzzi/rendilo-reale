import { type Container, Sprite } from 'pixi.js';
import * as B from '../config/balance';
import type { Atlas } from '../render/textures';

/**
 * Frappes de missiles : un marqueur d'alerte pulse au sol pendant le télégraphe
 * du calibre, puis l'impact détone (résolu par World.explode). Quatre calibres
 * (`MISSILE_KINDS`) lisibles à la couleur et à la taille du marqueur — le
 * sentiment d'urgence vient de là : il faut bouger, tout de suite.
 */
class Strike {
  t: number;
  done = false;
  readonly radius: number; // lu aussi par le bot de test pour calibrer l'esquive
  private readonly warning: number;
  private readonly ring: Sprite;
  private readonly core: Sprite;

  constructor(
    readonly x: number,
    readonly y: number,
    readonly kind: B.MissileKind,
    parent: Container,
    atlas: Atlas,
  ) {
    const def = B.MISSILE_KINDS[kind];
    this.t = def.warning;
    this.warning = def.warning;
    this.radius = def.radius;
    this.ring = new Sprite(atlas.spark);
    this.ring.anchor.set(0.5);
    this.ring.tint = def.color;
    this.ring.alpha = 0.4;
    this.ring.width = this.ring.height = def.radius * 2;
    this.ring.position.set(x, y);
    this.core = new Sprite(atlas.spark);
    this.core.anchor.set(0.5);
    this.core.tint = def.color;
    this.core.position.set(x, y);
    parent.addChild(this.ring, this.core);
  }

  update(dt: number): boolean {
    this.t -= dt;
    const progress = 1 - this.t / this.warning;
    // le cœur grossit vers la zone réelle, l'anneau pulse de plus en plus vite
    const core = this.radius * 2 * progress;
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
  onImpact: (x: number, y: number, kind: B.MissileKind) => void = () => {};
  onWarn: () => void = () => {};
  private list: Strike[] = [];

  constructor(
    private readonly parent: Container,
    private readonly atlas: Atlas,
  ) {}

  spawn(x: number, y: number, kind: B.MissileKind = 'orange'): void {
    this.list.push(new Strike(x, y, kind, this.parent, this.atlas));
    this.onWarn();
  }

  update(dt: number): void {
    let anyDone = false;
    for (const strike of this.list) {
      if (strike.update(dt)) {
        strike.destroySelf();
        this.onImpact(strike.x, strike.y, strike.kind);
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
