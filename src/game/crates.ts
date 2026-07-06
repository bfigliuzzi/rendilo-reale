import { type Container, Sprite, Text } from 'pixi.js';
import * as B from '../config/balance';
import type { CrateVariant } from '../config/levels';
import type { Atlas } from '../render/textures';
import type { Squad } from './squad';

const STROKE_BY_VARIANT: Record<CrateVariant, number> = {
  hp: 0x3d2c12,
  explosive: 0x450a0a,
  damage: 0x92400e,
  shield: 0x92400e,
};

function textureFor(variant: CrateVariant, atlas: Atlas): Sprite {
  const tex =
    variant === 'explosive'
      ? atlas.crateExplosive
      : variant === 'hp'
        ? atlas.crate
        : atlas.crateBonus;
  return new Sprite(tex);
}

export class Crate {
  dead = false;
  hp: number;
  onHit: () => void = () => {};
  onBreak: (crate: Crate, byBullet: boolean) => void = () => {};
  private shownHp: number;
  private readonly sprite: Sprite;
  private readonly label: Text;

  constructor(
    readonly cx: number,
    readonly cy: number,
    hp: number,
    readonly variant: CrateVariant,
    spriteParent: Container,
    labelParent: Container,
    atlas: Atlas,
  ) {
    this.hp = hp;
    this.shownHp = Math.ceil(hp);
    this.sprite = textureFor(variant, atlas);
    this.sprite.anchor.set(0.5);
    this.sprite.width = B.CRATE_HALF_W * 2;
    this.sprite.height = B.CRATE_HALF_H * 2;
    this.sprite.position.set(cx, cy);
    spriteParent.addChild(this.sprite);
    // les bonus affichent leur récompense, les autres leurs PV
    const bonusTag = variant === 'damage' ? '×2 🔥' : variant === 'shield' ? '🛡' : '';
    this.label = new Text({
      text: bonusTag ? `${this.shownHp} ${bonusTag}` : String(this.shownHp),
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 28,
        fontWeight: '900',
        fill: 0xffffff,
        stroke: { color: STROKE_BY_VARIANT[variant], width: 6 },
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
      this.onBreak(this, true);
      this.destroySelf();
      return;
    }
    this.onHit();
    const shown = Math.ceil(this.hp);
    if (shown !== this.shownHp) {
      // le re-layout d'un Text coûte cher : uniquement quand l'entier affiché change
      this.shownHp = shown;
      const bonusTag = this.variant === 'damage' ? '×2 🔥' : this.variant === 'shield' ? '🛡' : '';
      this.label.text = bonusTag ? `${shown} ${bonusTag}` : String(shown);
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
  onHit: () => void = () => {};
  onBreak: (crate: Crate, byBullet: boolean) => void = () => {};
  contactKills = B.CRATE_CONTACT_KILLS;

  constructor(
    private readonly spriteParent: Container,
    private readonly labelParent: Container,
    private readonly atlas: Atlas,
  ) {}

  spawn(at: number, hp: number, xNorm: number, variant: CrateVariant = 'hp'): void {
    const cx = B.LANE_MIN_X + xNorm * (B.LANE_MAX_X - B.LANE_MIN_X);
    const crate = new Crate(cx, -at, hp, variant, this.spriteParent, this.labelParent, this.atlas);
    crate.onHit = this.onHit;
    crate.onBreak = this.onBreak;
    this.list.push(crate);
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
        // contact : les caisses PV blessent, les bonus se perdent, l'explosive détone (géré par onBreak)
        if (crate.variant === 'hp') squad.loseSoldiers(this.contactKills);
        crate.onBreak(crate, false);
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
