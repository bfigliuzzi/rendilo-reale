import { Container, Sprite, Text } from 'pixi.js';
import * as B from '../config/balance';
import type { GateModifier } from '../config/levels';
import type { Atlas } from '../render/textures';
import type { Squad } from './squad';

const GATE_W = 216;
const GATE_H = 66;

function isPositive(mod: GateModifier): boolean {
  return mod.op === 'mul' ? mod.value >= 1 : mod.value >= 0;
}

function labelOf(mod: GateModifier): string {
  if (mod.op === 'mul') return `x${mod.value}`;
  return mod.value >= 0 ? `+${mod.value}` : `${mod.value}`;
}

function buildGate(mod: GateModifier, centerX: number, atlas: Atlas): Container {
  const c = new Container();
  const bg = new Sprite(atlas.white);
  bg.anchor.set(0.5);
  bg.width = GATE_W;
  bg.height = GATE_H;
  bg.tint = isPositive(mod) ? 0x22c55e : 0xef4444;
  bg.alpha = 0.78;
  const label = new Text({
    text: labelOf(mod),
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 34,
      fontWeight: '900',
      fill: 0xffffff,
      stroke: { color: 0x0b1016, width: 5 },
    },
  });
  label.anchor.set(0.5);
  c.addChild(bg, label);
  c.x = centerX;
  return c;
}

class GatePair {
  done = false;
  private consumed = false;
  private readonly root = new Container();

  constructor(
    private readonly y: number,
    private readonly left: GateModifier,
    private readonly right: GateModifier,
    parent: Container,
  ) {
    this.root.y = y;
    parent.addChild(this.root);
  }

  build(atlas: Atlas): void {
    this.root.addChild(
      buildGate(this.left, (B.LANE_MIN_X + B.LANE_CENTER) / 2 - 6, atlas),
      buildGate(this.right, (B.LANE_CENTER + B.LANE_MAX_X) / 2 + 6, atlas),
    );
  }

  /** Retourne le modificateur choisi au moment où l'escouade franchit la ligne. */
  update(dt: number, squad: Squad, dist: number): GateModifier | null {
    if (this.consumed) {
      this.root.alpha -= dt * 2.5;
      if (this.root.alpha <= 0) {
        this.done = true;
        this.root.destroy({ children: true });
      }
      return null;
    }
    if (squad.worldY(dist) <= this.y) {
      this.consumed = true;
      return squad.x < B.LANE_CENTER ? this.left : this.right;
    }
    return null;
  }
}

export class Gates {
  private pairs: GatePair[] = [];

  constructor(
    private readonly parent: Container,
    private readonly atlas: Atlas,
  ) {}

  spawn(at: number, left: GateModifier, right: GateModifier): void {
    const pair = new GatePair(-at, left, right, this.parent);
    pair.build(this.atlas);
    this.pairs.push(pair);
  }

  update(dt: number, squad: Squad, dist: number): void {
    let anyDone = false;
    for (const pair of this.pairs) {
      const mod = pair.update(dt, squad, dist);
      if (mod) squad.applyModifier(mod);
      anyDone ||= pair.done;
    }
    if (anyDone) this.pairs = this.pairs.filter((p) => !p.done);
  }

  reset(): void {
    this.parent.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.pairs = [];
  }
}
