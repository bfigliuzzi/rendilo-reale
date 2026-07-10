import { MAX_NODES, NODE_LEVELS, TAP_RADIUS_MIN, TAP_RADIUS_PAD } from '../config/balance';
import type { Faction, LevelDef } from '../config/levels';

/**
 * Pool SoA des nœuds (≤ MAX_NODES, immobiles — pas d'interpolation nécessaire).
 * Production, arrivées (+1 allié / −1 adverse / capture) et sélection joueur.
 * prod/cap/radius sont DÉRIVÉS de NODE_LEVELS via `level` (upgrade futur câblé).
 */
export class Nodes {
  count = 0;
  readonly x = new Float32Array(MAX_NODES);
  readonly y = new Float32Array(MAX_NODES);
  readonly stock = new Float32Array(MAX_NODES); // flottant (production continue), affiché floor()
  readonly flash = new Float32Array(MAX_NODES); // timer visuel de capture (décroît dans update)
  readonly faction = new Uint8Array(MAX_NODES);
  readonly level = new Uint8Array(MAX_NODES);
  readonly selected = new Uint8Array(MAX_NODES);
  readonly byFaction = new Int16Array(3);
  /** Câblé une fois par World (fx + sfx futurs) — jamais réassigné au tick. */
  onCapture: (i: number, to: Faction) => void = () => {};

  load(def: LevelDef): void {
    this.count = def.nodes.length;
    this.byFaction.fill(0);
    this.selected.fill(0);
    this.flash.fill(0);
    for (let i = 0; i < this.count; i++) {
      const n = def.nodes[i];
      this.x[i] = n.x;
      this.y[i] = n.y;
      this.stock[i] = n.stock;
      this.faction[i] = n.faction;
      this.level[i] = n.level ?? 0;
      this.byFaction[n.faction]++;
    }
  }

  radius(i: number): number {
    return NODE_LEVELS[this.level[i]].radius;
  }

  cap(i: number): number {
    return NODE_LEVELS[this.level[i]].cap;
  }

  prod(i: number): number {
    return NODE_LEVELS[this.level[i]].prodPerSec;
  }

  /** Production continue des nœuds possédés (les neutres ne produisent pas). */
  grow(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.faction[i] === 0) continue;
      const cap = this.cap(i);
      const s = this.stock[i] + this.prod(i) * dt;
      this.stock[i] = s > cap ? cap : s;
      if (this.flash[i] > 0) this.flash[i] = Math.max(0, this.flash[i] - dt * 2);
    }
  }

  /**
   * Effet d'une unité qui touche le nœud, résolu contre la faction COURANTE :
   * renfort si alliée (surplus au-delà du cap perdu), −1 sinon, capture sous 0.
   */
  arrive(i: number, f: Faction): void {
    if (this.faction[i] === f) {
      const cap = this.cap(i);
      if (this.stock[i] < cap) this.stock[i] = Math.min(cap, this.stock[i] + 1);
      return;
    }
    this.stock[i] -= 1;
    if (this.stock[i] < 0) this.capture(i, f);
  }

  private capture(i: number, to: Faction): void {
    this.byFaction[this.faction[i]]--;
    this.byFaction[to]++;
    this.faction[i] = to;
    this.stock[i] = 0; // l'unité qui capture est consommée par la prise
    this.selected[i] = 0;
    this.flash[i] = 1;
    this.onCapture(i, to);
  }

  /** Hit-test tactile : zone de tap élargie (min 34 px de rayon). */
  nodeAt(px: number, py: number): number {
    for (let i = 0; i < this.count; i++) {
      const r = Math.max(this.radius(i) + TAP_RADIUS_PAD, TAP_RADIUS_MIN);
      const dx = px - this.x[i];
      const dy = py - this.y[i];
      if (dx * dx + dy * dy <= r * r) return i;
    }
    return -1;
  }

  clearSelection(): void {
    this.selected.fill(0);
  }
}
