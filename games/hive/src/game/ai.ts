import { AI_DEFAULTS, MAX_NODES, UNIT_SPEED } from '../config/balance';
import { ENEMY, NEUTRAL, type AiParams, type Faction } from '../config/levels';
import type { Emitter } from './emitter';
import type { Nodes } from './nodes';
import type { Units } from './units';

/**
 * Contrôleur IA GÉNÉRIQUE sur la faction (les cafards en jeu ; le camp abeilles
 * dans le scénario miroir de tools/verify-hive.mjs — même code, zéro dérive).
 * Une décision toutes `decisionInterval` s, UNE action par décision (rythme
 * lisible). Défense d'abord, sinon attaque GROUPÉE depuis les `waveNodes` nids
 * les plus proches de la cible (l'annihilation 1:1 récompense la masse, mais
 * mobiliser toute l'économie écraserait le joueur), sinon accumulation.
 * Anti-sur-extension structurel : `reserveFrac` reste à la maison et on
 * n'attaque qu'en supériorité. Passe par la MÊME API (Emitter.send) que le
 * joueur : aucune triche possible. Scratch buffers préalloués — zéro alloc.
 */
export class Ai {
  private timer = 0;
  private params: AiParams = AI_DEFAULTS;
  private readonly foe: Faction;
  // renforts en vol par nœud : ceux de l'adversaire, les miens
  private readonly incomingFoe = new Float32Array(MAX_NODES);
  private readonly incomingMine = new Float32Array(MAX_NODES);
  private readonly wave = new Int16Array(MAX_NODES); // contributeurs de la vague en cours

  constructor(
    private readonly nodes: Nodes,
    private readonly units: Units,
    private readonly emitter: Emitter,
    private readonly me: Faction = ENEMY,
  ) {
    this.foe = (3 - me) as Faction;
  }

  reset(params: AiParams): void {
    this.params = params;
    this.timer = params.decisionInterval; // laisse l'adversaire respirer au départ
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.params.decisionInterval;
    this.decide();
  }

  private decide(): void {
    const { nodes, units, me } = this;
    const p = this.params;
    this.incomingFoe.fill(0, 0, nodes.count);
    this.incomingMine.fill(0, 0, nodes.count);
    for (let i = 0; i < units.count; i++) {
      if (units.dead[i]) continue;
      if (units.faction[i] === me) this.incomingMine[units.target[i]]++;
      else this.incomingFoe[units.target[i]]++;
    }

    // 1. DÉFENSE : renforcer mon nœud le plus menacé (menace = ce qui arrive
    //    moins ce qui tient déjà), pondérée par defendBias face à l'attaque.
    let defendNode = -1;
    let worstThreat = 0;
    for (let i = 0; i < nodes.count; i++) {
      if (nodes.faction[i] !== me) continue;
      const threat = this.incomingFoe[i] - (nodes.stock[i] + this.incomingMine[i]);
      if (threat > worstThreat) {
        worstThreat = threat;
        defendNode = i;
      }
    }
    if (defendNode >= 0 && worstThreat * p.defendBias >= 1) {
      this.reinforce(defendNode, Math.ceil(worstThreat * 1.2));
      return;
    }

    // 2. ATTAQUE : meilleure cible au ratio valeur/coût, pénalisée par la distance.
    let neutralsLeft = false;
    for (let i = 0; i < nodes.count; i++) if (nodes.faction[i] === NEUTRAL) neutralsLeft = true;
    let best = -1;
    let bestScore = -Infinity;
    let bestCost = 0;
    for (let c = 0; c < nodes.count; c++) {
      const f = nodes.faction[c];
      if (f === me) continue;
      const dist = this.avgDistFrom(c);
      const flight = dist / UNIT_SPEED;
      const defense = f === this.foe ? this.incomingFoe[c] + nodes.prod(c) * flight : 0;
      // mes unités déjà en route vers c réduisent ce qu'il reste à payer
      const cost = nodes.stock[c] + defense - this.incomingMine[c];
      const value = f === NEUTRAL ? (neutralsLeft ? 2 : 1) : 1 + p.aggression;
      const score = value / (Math.max(0, cost) + 1) - (p.distWeight * dist) / 300;
      if (score > bestScore) {
        bestScore = score;
        best = c;
        bestCost = Math.max(0, cost);
      }
    }
    if (best < 0) return;

    // contributeurs = mes `waveNodes` nœuds les PLUS PROCHES de la cible
    let force = 0;
    let picked = 0;
    for (let k = 0; k < p.waveNodes; k++) {
      let bestI = -1;
      let bestD = Infinity;
      for (let i = 0; i < nodes.count; i++) {
        if (nodes.faction[i] !== me) continue;
        let taken = false;
        for (let s = 0; s < picked; s++) if (this.wave[s] === i) taken = true;
        if (taken) continue;
        if (Math.floor(nodes.stock[i] * (1 - p.reserveFrac)) < 1) continue;
        const dx = nodes.x[i] - nodes.x[best];
        const dy = nodes.y[i] - nodes.y[best];
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      if (bestI < 0) break;
      this.wave[picked++] = bestI;
      force += Math.floor(nodes.stock[bestI] * (1 - p.reserveFrac));
    }
    const needed = bestCost * (1.4 - 0.5 * p.aggression) + 1;
    if (force < needed) return; // pas de supériorité : on accumule

    // vague groupée : les contributeurs retenus envoient EN MÊME TEMPS
    for (let s = 0; s < picked; s++) {
      const i = this.wave[s];
      this.emitter.send(i, best, me, Math.floor(nodes.stock[i] * (1 - p.reserveFrac)));
    }
  }

  /** Distance moyenne de mes nœuds à la cible (pour le coût de trajet). */
  private avgDistFrom(target: number): number {
    const { nodes } = this;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < nodes.count; i++) {
      if (nodes.faction[i] !== this.me) continue;
      const dx = nodes.x[i] - nodes.x[target];
      const dy = nodes.y[i] - nodes.y[target];
      sum += Math.sqrt(dx * dx + dy * dy);
      n++;
    }
    return n > 0 ? sum / n : 0;
  }

  /**
   * Renfort : le contributeur le plus proche verse son surplus (une décision =
   * un envoi ; si la menace persiste, la décision suivante renverra du monde).
   */
  private reinforce(target: number, need: number): void {
    const { nodes } = this;
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < nodes.count; i++) {
      if (nodes.faction[i] !== this.me || i === target) continue;
      if (Math.floor(nodes.stock[i] * (1 - this.params.reserveFrac)) < 1) continue;
      const dx = nodes.x[i] - nodes.x[target];
      const dy = nodes.y[i] - nodes.y[target];
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI < 0) return;
    const surplus = Math.floor(nodes.stock[bestI] * (1 - this.params.reserveFrac));
    this.emitter.send(bestI, target, this.me, Math.min(surplus, need));
  }
}
