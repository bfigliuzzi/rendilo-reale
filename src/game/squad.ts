import { type Container, Sprite, Text } from 'pixi.js';
import * as B from '../config/balance';
import type { GateModifier } from '../config/levels';
import { clamp, lerp } from '../core/math';
import type { Atlas } from '../render/textures';

interface Slot {
  dx: number;
  dy: number;
}

const slotCache = new Map<number, Slot[]>();

/**
 * Formation en rangs concentriques derrière un leader : rangs de 1, 3, 5, 7…
 * remplis du centre vers l'extérieur (un rang partiel reste centré).
 */
export function formationSlots(n: number): Slot[] {
  let slots = slotCache.get(n);
  if (slots) return slots;
  slots = [];
  let row = 0;
  while (slots.length < n) {
    const take = Math.min(2 * row + 1, n - slots.length);
    for (let i = 0; i < take; i++) {
      const col = i === 0 ? 0 : i % 2 === 1 ? (i + 1) >> 1 : -(i >> 1);
      slots.push({ dx: col * B.SQUAD_SPACING_X, dy: row * B.SQUAD_SPACING_Y });
    }
    row++;
  }
  slotCache.set(n, slots);
  return slots;
}

/**
 * `logical` est l'effectif réel (pilote la puissance de feu, sans plafond visuel) ;
 * seuls `rendered = min(logical, RENDER_CAP)` soldats sont affichés. Au-delà du cap,
 * le label d'effectif et un léger scale-up traduisent la croissance.
 */
export class Squad {
  logical = B.START_SQUAD;
  x = B.LANE_CENTER;
  prevX = B.LANE_CENTER;
  rendered = 0;
  visualScale = 1;
  private readonly sprites: Sprite[] = [];
  private readonly curX = new Float32Array(B.SQUAD_RENDER_CAP);
  private readonly curY = new Float32Array(B.SQUAD_RENDER_CAP);
  private readonly tgtX = new Float32Array(B.SQUAD_RENDER_CAP);
  private readonly tgtY = new Float32Array(B.SQUAD_RENDER_CAP);
  private readonly label: Text;
  private muzzleIdx = 0;

  constructor(
    container: Container,
    labels: Container,
    atlas: Atlas,
    private readonly startCount = B.START_SQUAD,
  ) {
    for (let i = 0; i < B.SQUAD_RENDER_CAP; i++) {
      const s = new Sprite(atlas.soldier);
      s.anchor.set(0.5);
      s.visible = false;
      this.sprites.push(s);
      container.addChild(s);
    }
    this.label = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 26,
        fontWeight: '900',
        fill: 0xffffff,
        stroke: { color: 0x0b1016, width: 5 },
      },
    });
    this.label.anchor.set(0.5, 1);
    labels.addChild(this.label);
    this.reset();
  }

  reset(): void {
    this.logical = this.startCount;
    this.x = this.prevX = B.LANE_CENTER;
    this.muzzleIdx = 0;
    this.rendered = 0;
    this.syncFormation(true);
  }

  update(dt: number, dragDX: number): void {
    this.prevX = this.x;
    this.x = clamp(this.x + dragDX * B.DRAG_SENSITIVITY, B.LANE_MIN_X, B.LANE_MAX_X);
    const t = Math.min(1, dt * 8);
    for (let i = 0; i < this.rendered; i++) {
      this.curX[i] += (this.tgtX[i] - this.curX[i]) * t;
      this.curY[i] += (this.tgtY[i] - this.curY[i]) * t;
    }
  }

  applyModifier(mod: GateModifier): void {
    this.setLogical(mod.op === 'mul' ? this.logical * mod.value : this.logical + mod.value);
  }

  loseSoldiers(n: number): void {
    this.setLogical(this.logical - n);
  }

  private setLogical(n: number): void {
    this.logical = clamp(Math.round(n), 0, B.SQUAD_HARD_CAP);
    this.syncFormation(false);
  }

  private syncFormation(snap: boolean): void {
    const r = Math.min(this.logical, B.SQUAD_RENDER_CAP);
    const slots = formationSlots(Math.max(r, 1));
    for (let i = 0; i < r; i++) {
      this.tgtX[i] = slots[i].dx;
      this.tgtY[i] = slots[i].dy;
      if (snap || i >= this.rendered) {
        // nouvel arrivant : apparaît au centre-arrière et lerpe vers son slot
        this.curX[i] = snap ? slots[i].dx : 0;
        this.curY[i] = snap ? slots[i].dy : 50;
      }
      this.sprites[i].visible = true;
    }
    for (let i = r; i < B.SQUAD_RENDER_CAP; i++) this.sprites[i].visible = false;
    this.rendered = r;
    this.visualScale =
      this.logical > B.SQUAD_RENDER_CAP
        ? 1 + 0.15 * Math.log10(this.logical / B.SQUAD_RENDER_CAP)
        : 1;
    this.label.text = String(this.logical);
  }

  worldY(dist: number): number {
    return -dist;
  }

  soldierWorldX(i: number): number {
    return this.x + this.curX[i] * this.visualScale;
  }

  soldierWorldY(i: number, dist: number): number {
    return -dist + this.curY[i] * this.visualScale;
  }

  /** Point de tir suivant, en round-robin sur les soldats affichés. */
  nextMuzzle(dist: number, out: { x: number; y: number }): void {
    if (this.rendered === 0) {
      out.x = this.x;
      out.y = -dist;
      return;
    }
    this.muzzleIdx = (this.muzzleIdx + 1) % this.rendered;
    out.x = this.soldierWorldX(this.muzzleIdx);
    out.y = this.soldierWorldY(this.muzzleIdx, dist) - 12;
  }

  renderSync(alpha: number, distI: number): void {
    const cx = lerp(this.prevX, this.x, alpha);
    for (let i = 0; i < this.rendered; i++) {
      const s = this.sprites[i];
      s.position.set(cx + this.curX[i] * this.visualScale, -distI + this.curY[i] * this.visualScale);
      s.scale.set(this.visualScale);
    }
    this.label.position.set(cx, -distI - 22);
    this.label.visible = this.logical > 0;
  }
}
