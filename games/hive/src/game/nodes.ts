import { MAX_FACTIONS, MAX_NODES, NODE_LEVELS, TAP_RADIUS_MIN, TAP_RADIUS_PAD, UPGRADE_COSTS } from '../config/balance';
import type { Faction, LevelDef } from '../config/levels';

/**
 * Pool SoA des nœuds (≤ MAX_NODES, immobiles — pas d'interpolation nécessaire).
 * Production (× croissance de l'espèce), arrivées (valeur EN UNITÉS LOCALES du
 * nœud : renfort/dégât/capture) et sélection joueur.
 * prod/cap/radius sont DÉRIVÉS de NODE_LEVELS via `level` ; cap et coût
 * d'upgrade sont DÉNOMINÉS EN PUISSANCE (divisés par la puissance de l'espèce
 * occupante) : un nid plein stocke la même puissance défensive et un niveau
 * coûte le même effort quel que soit le clan — sinon le clan costaud gagnait
 * toute guerre d'usure sur ses nids (mesuré au bot).
 */
export class Nodes {
  count = 0;
  readonly x = new Float32Array(MAX_NODES);
  readonly y = new Float32Array(MAX_NODES);
  readonly stock = new Float32Array(MAX_NODES); // flottant (production continue), affiché floor()
  readonly flash = new Float32Array(MAX_NODES); // timer visuel de capture (décroît dans update)
  readonly upgradeProgress = new Float32Array(MAX_NODES); // unités investies vers le niveau suivant
  readonly faction = new Uint8Array(MAX_NODES);
  readonly level = new Uint8Array(MAX_NODES);
  readonly selected = new Uint8Array(MAX_NODES);
  readonly byFaction = new Int16Array(MAX_FACTIONS);
  /** Câblés une fois par World (fx + sfx futurs) — jamais réassignés au tick. */
  onCapture: (i: number, to: Faction) => void = () => {};
  onUpgrade: (i: number) => void = () => {};

  /** Stats par faction (références possédées par World, remplies à loadLevel). */
  constructor(
    private readonly factionGrowth: Float32Array,
    private readonly factionPower: Float32Array,
  ) {}

  load(def: LevelDef): void {
    this.count = def.nodes.length;
    this.byFaction.fill(0);
    this.selected.fill(0);
    this.flash.fill(0);
    this.upgradeProgress.fill(0);
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
    return NODE_LEVELS[this.level[i]].cap / this.factionPower[this.faction[i]];
  }

  prod(i: number): number {
    return NODE_LEVELS[this.level[i]].prodPerSec * this.factionGrowth[this.faction[i]];
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

  /** Coût de montée au niveau suivant, ou 0 si le nœud est au niveau max. */
  upgradeCost(i: number): number {
    const base = UPGRADE_COSTS[this.level[i]] ?? 0;
    return base && base / this.factionPower[this.faction[i]];
  }

  /**
   * Effet d'une unité qui touche le nœud, résolu contre la faction COURANTE.
   * `value` est la valeur de l'unité EN UNITÉS LOCALES du nœud
   * (= hp restant / puissance du défenseur, calculée par Units.update) :
   * renfort si alliée — et si le nid est PLEIN, l'unité est investie dans la
   * montée de niveau (geste Auralux : nourrir un nid au cap l'améliore) ;
   * −value sinon, capture sous 0.
   */
  arrive(i: number, f: Faction, value: number): void {
    if (this.faction[i] === f) {
      const cap = this.cap(i);
      if (this.stock[i] < cap) {
        this.stock[i] = Math.min(cap, this.stock[i] + value);
        return;
      }
      const cost = this.upgradeCost(i);
      if (cost === 0) return; // niveau max : surplus perdu
      this.upgradeProgress[i] += value;
      if (this.upgradeProgress[i] >= cost) {
        this.level[i]++;
        this.upgradeProgress[i] = 0;
        this.flash[i] = 1;
        this.onUpgrade(i);
      }
      return;
    }
    this.stock[i] -= value;
    if (this.stock[i] < 0) this.capture(i, f);
  }

  private capture(i: number, to: Faction): void {
    this.byFaction[this.faction[i]]--;
    this.byFaction[to]++;
    this.faction[i] = to;
    this.stock[i] = 0; // l'unité qui capture est consommée par la prise
    this.upgradeProgress[i] = 0; // le niveau reste, l'investissement en cours est perdu
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
