import { type Container, Sprite, Text } from 'pixi.js';
import * as B from '../config/balance';
import type { Atlas } from '../render/textures';
import type { Squad } from './squad';

export class Crate {
  dead = false;
  hp: number;
  private shownHp: number;
  private readonly sprite: Sprite;
  private readonly label: Text;

  constructor(
    readonly cx: number,
    readonly cy: number,
    hp: number,
    spriteParent: Container,
    labelParent: Container,
    atlas: Atlas,
  ) {
    this.hp = hp;
    this.shownHp = Math.ceil(hp);
    this.sprite = new Sprite(atlas.crate);
    this.sprite.anchor.set(0.5);
    this.sprite.width = B.CRATE_HALF_W * 2;
    this.sprite.height = B.CRATE_HALF_H * 2;
    this.sprite.position.set(cx, cy);
    spriteParent.addChild(this.sprite);
    this.label = new Text({
      text: String(this.shownHp),
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 30,
        fontWeight: '900',
        fill: 0xffffff,
        stroke: { color: 0x3d2c12, width: 6 },
      },
    });
    this.label.anchor.set(0.5);
    this.label.position.set(cx, cy);
    labelParent.addChild(this.label);
  }

  hits(px: number, py: number, pr: number): boolean {
    return (
      Math.abs(px - this.cx) < B.CRATE_HALF_W + pr && Math.abs(py - this.cy) < B.CRATE_HALF_H + pr
    );
  }

  damage(d: number): void {
    this.hp -= d;
    if (this.hp <= 0) {
      this.destroySelf();
      return;
    }
    const shown = Math.ceil(this.hp);
    if (shown !== this.shownHp) {
      // le re-layout d'un Text coûte cher : uniquement quand l'entier affiché change
      this.shownHp = shown;
      this.label.text = String(shown);
    }
  }

  destroySelf(): void {
    if (this.dead) return;
    this.dead = true;
    this.sprite.destroy();
    this.label.destroy();
  }
}

export class Crates {
  list: Crate[] = [];

  constructor(
    private readonly spriteParent: Container,
    private readonly labelParent: Container,
    private readonly atlas: Atlas,
  ) {}

  spawn(at: number, hp: number, xNorm: number): void {
    const cx = B.LANE_MIN_X + xNorm * (B.LANE_MAX_X - B.LANE_MIN_X);
    this.list.push(new Crate(cx, -at, hp, this.spriteParent, this.labelParent, this.atlas));
  }

  update(squad: Squad, dist: number): void {
    const frontY = squad.worldY(dist) - 30;
    let anyDead = false;
    for (const crate of this.list) {
      if (crate.dead) {
        anyDead = true;
        continue;
      }
      const inBand = frontY <= crate.cy + B.CRATE_HALF_H && frontY >= crate.cy - B.CRATE_HALF_H;
      if (inBand && Math.abs(squad.x - crate.cx) < B.CRATE_HALF_W + 30) {
        squad.loseSoldiers(B.CRATE_CONTACT_KILLS);
        crate.destroySelf();
        anyDead = true;
      } else if (crate.cy - B.CRATE_HALF_H > -dist + B.CULL_BEHIND) {
        crate.destroySelf(); // passée derrière sans contact
        anyDead = true;
      }
    }
    if (anyDead) this.list = this.list.filter((c) => !c.dead);
  }

  reset(): void {
    for (const crate of this.list) crate.destroySelf();
    this.list = [];
  }
}
