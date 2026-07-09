import { type Container, Sprite } from 'pixi.js';
import * as B from '../config/balance';
import { MARKER_RING_MARGIN, type Atlas } from '../render/textures';
import type { Squad } from './squad';

interface Mine {
  x: number;
  y: number;
  dead: boolean;
  sprite: Sprite;
  halo: Sprite; // périmètre pointillé à la taille RÉELLE du souffle
  light: Sprite; // témoin lumineux clignotant
}

/**
 * Mines : pièges au sol. Volontairement NON tirables (hors aim-assist et
 * collisions balles) — c'est un danger de lecture du terrain, à toi de passer
 * à côté. Déclenchée = souffle (World.explode). Lisibilité : le corps reste
 * opaque (jupe hachurée jaune/noir, code danger universel), c'est le halo —
 * pointillé rotatif à MINE_RADIUS, distinct des anneaux pleins des frappes —
 * et le témoin qui pulsent : la zone à éviter se lit, pas juste le point.
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
    const x = B.LANE_MIN_X + xNorm * (B.LANE_MAX_X - B.LANE_MIN_X);
    const halo = new Sprite(this.atlas.mineHalo);
    halo.anchor.set(0.5);
    halo.tint = 0xfacc15; // jaune sécurité — liseré noir intégré à la texture
    halo.alpha = 0.3;
    halo.width = halo.height = B.MINE_RADIUS * 2 * MARKER_RING_MARGIN;
    halo.position.set(x, -at);
    const sprite = new Sprite(this.atlas.mine);
    sprite.anchor.set(0.5);
    sprite.position.set(x, -at);
    const light = new Sprite(this.atlas.spark);
    light.anchor.set(0.5);
    light.tint = 0xef4444; // rouge sur le témoin BLANC de la texture : contraste garanti
    light.width = light.height = 15;
    light.position.set(x, -at);
    this.parent.addChild(halo, sprite, light);
    this.list.push({ x, y: -at, dead: false, sprite, halo, light });
  }

  private destroyMine(mine: Mine): void {
    mine.dead = true;
    mine.sprite.destroy();
    mine.halo.destroy();
    mine.light.destroy();
  }

  update(dt: number, squad: Squad, dist: number): void {
    this.blinkT += dt;
    const haloAlpha = 0.22 + 0.16 * Math.sin(this.blinkT * 3);
    const lightAlpha = 0.3 + 0.7 * Math.abs(Math.sin(this.blinkT * 4.5));
    const frontY = squad.worldY(dist);
    const triggerX = B.MINE_TRIGGER_R + squad.halfWidth * squad.visualScale * 0.8;
    let anyDead = false;
    for (const mine of this.list) {
      if (mine.dead) {
        anyDead = true;
        continue;
      }
      mine.halo.alpha = haloAlpha;
      mine.halo.rotation = this.blinkT * 0.5; // rotation lente : « danger actif »
      mine.light.alpha = lightAlpha;
      // déclenchement quand la masse passe dessus
      if (Math.abs(mine.y - frontY) < 34 && Math.abs(mine.x - squad.x) < triggerX) {
        this.destroyMine(mine);
        this.onTrigger(mine.x, mine.y);
        anyDead = true;
      } else if (mine.y > -dist + B.CULL_BEHIND) {
        this.destroyMine(mine);
        anyDead = true;
      }
    }
    if (anyDead) this.list = this.list.filter((m) => !m.dead);
  }

  reset(): void {
    for (const mine of this.list) {
      if (!mine.dead) {
        mine.sprite.destroy();
        mine.halo.destroy();
        mine.light.destroy();
      }
    }
    this.list = [];
  }
}
