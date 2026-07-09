import { type Container, Sprite } from 'pixi.js';
import * as B from '../config/balance';
import { MARKER_RING_MARGIN, type Atlas } from '../render/textures';

/**
 * Frappes de missiles : un marqueur d'alerte pulse au sol pendant le télégraphe
 * du calibre, puis l'impact détone (résolu par World.explode). Chaque calibre
 * (`MISSILE_KINDS`) se lit à QUATRE signaux redondants — taille de l'anneau
 * (zone réelle), couleur, densité du cœur, glyphe blanc pour les plus punitifs —
 * jamais à la couleur seule (daltonisme). Le liseré noir des textures garantit
 * le contraste sur tous les biomes, et le strobe final signale l'imminence par
 * le mouvement : il faut bouger, tout de suite.
 */
class Strike {
  t: number;
  done = false;
  readonly radius: number; // lu aussi par le bot de test pour calibrer l'esquive
  private readonly warning: number;
  private readonly fillAlpha: number;
  private readonly zone: Sprite; // anneau : la limite RÉELLE du souffle
  private readonly fill: Sprite; // cœur qui grossit jusqu'à la zone = compte à rebours
  private readonly glyph: Sprite | null; // signature de forme du calibre

  constructor(
    readonly x: number,
    readonly y: number,
    readonly kind: B.MissileKind,
    parent: Container,
    atlas: Atlas,
  ) {
    const def: B.MissileKindDef = B.MISSILE_KINDS[kind];
    this.t = def.warning;
    this.warning = def.warning;
    this.radius = def.radius;
    this.fillAlpha = def.fillAlpha;
    // anneau pré-rendu à la taille du calibre (net, aucun étirement) : la marge
    // du canvas fait que l'anneau tombe exactement sur le rayon réel du souffle
    this.zone = new Sprite(atlas.missileRing[kind]);
    this.zone.anchor.set(0.5);
    this.zone.tint = def.color;
    this.zone.alpha = 0.8;
    this.zone.width = this.zone.height = def.radius * 2 * MARKER_RING_MARGIN;
    this.zone.position.set(x, y);
    this.fill = new Sprite(atlas.glow);
    this.fill.anchor.set(0.5);
    this.fill.tint = def.color;
    this.fill.alpha = def.fillAlpha;
    this.fill.position.set(x, y);
    parent.addChild(this.zone, this.fill);
    if (def.glyph) {
      // glyphe laissé BLANC : lisible sur tout biome et toute vision des couleurs
      this.glyph = new Sprite(def.glyph === 'cross' ? atlas.cross : atlas.trefoil);
      this.glyph.anchor.set(0.5);
      this.glyph.width = this.glyph.height = Math.min(72, def.radius * 0.7);
      this.glyph.position.set(x, y);
      parent.addChild(this.glyph);
    } else {
      this.glyph = null;
    }
  }

  update(dt: number): boolean {
    this.t -= dt;
    const progress = 1 - this.t / this.warning;
    // le cœur grossit vers la zone réelle, l'anneau pulse de plus en plus vite
    this.fill.width = this.fill.height = Math.max(8, this.radius * 2 * progress);
    if (this.t < B.MISSILE_STROBE_TIME) {
      // strobe final : alternance franche — un signal de mouvement, pas de couleur
      const on = Math.sin(this.t * 44) > 0;
      this.zone.alpha = on ? 1 : 0.3;
      this.fill.alpha = this.fillAlpha + (on ? 0.22 : 0);
      if (this.glyph) this.glyph.alpha = on ? 1 : 0.45;
    } else {
      this.zone.alpha = 0.65 + 0.2 * Math.sin(progress * 30);
      this.fill.alpha = this.fillAlpha + 0.1 * Math.sin(progress * progress * 40);
      if (this.glyph) this.glyph.alpha = 0.9;
    }
    return this.t <= 0;
  }

  destroySelf(): void {
    if (this.done) return;
    this.done = true;
    this.zone.destroy();
    this.fill.destroy();
    this.glyph?.destroy();
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
