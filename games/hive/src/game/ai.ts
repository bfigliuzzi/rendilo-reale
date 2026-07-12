import { AI_DEFAULTS, MAX_NODES, UNIT_SPEED } from '../config/balance';
import { NEUTRAL, type AiParams, type Faction } from '../config/levels';
import type { Emitter } from './emitter';
import type { Nodes } from './nodes';
import type { Units } from './units';

/**
 * Contrôleur IA GÉNÉRIQUE sur la faction (chaque camp IA a son instance ; le
 * camp abeilles dans le scénario miroir de tools/verify-hive.mjs — même code,
 * zéro dérive). TOUT nœud non-mien est un ennemi potentiel : en mêlée à trois,
 * les unités d'une faction tierce en route vers une cible gonflent sa défense
 * estimée — surestimation assumée (« laisse-les s'entretuer » émergent).
 * Une décision toutes `decisionInterval` s, UNE action par décision (rythme
 * lisible). Défense d'abord, sinon attaque GROUPÉE depuis les `waveNodes` nids
 * les plus proches de la cible (le combat récompense la masse, mais mobiliser
 * toute l'économie écraserait le joueur), sinon accumulation.
 * Anti-sur-extension structurel : `reserveFrac` reste à la maison et on
 * n'attaque qu'en supériorité. TOUTES les estimations (menaces, coûts, forces)
 * sont en MONNAIE DE PUISSANCE (`factionPower`) : les unités des clans n'ont
 * pas la même valeur — compter des têtes ferait sous-défendre face à un clan
 * costaud et sur-attaquer avec un clan fragile.
 * Passe par la MÊME API (Emitter.send) que le joueur : aucune triche possible.
 * Scratch buffers préalloués — zéro alloc.
 */
export class Ai {
  active = false;
  private timer = 0;
  private params: AiParams = AI_DEFAULTS;
  // renforts en vol par nœud, EN PUISSANCE : ceux des adversaires, les miens
  private readonly incomingFoe = new Float32Array(MAX_NODES);
  private readonly incomingMine = new Float32Array(MAX_NODES);
  private readonly wave = new Int16Array(MAX_NODES); // contributeurs de la vague en cours

  constructor(
    private readonly nodes: Nodes,
    private readonly units: Units,
    private readonly emitter: Emitter,
    private readonly me: Faction = 2,
    private readonly factionPower: Float32Array | null = null,
    private readonly factionSpeed: Float32Array | null = null,
  ) {}

  /** Puissance d'une unité de la faction f (1 sans table fournie). */
  private pw(f: number): number {
    return this.factionPower ? this.factionPower[f] : 1;
  }

  /** reset() sans paramètres = faction absente de la carte : IA inerte. */
  reset(params?: AiParams): void {
    this.active = params !== undefined;
    if (!params) return;
    this.params = params;
    // grâce initiale : le temps que l'adversaire s'oriente (surtout multi-nids)
    this.timer = Math.max(params.decisionInterval, params.grace ?? 0);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.params.decisionInterval;
    this.decide();
  }

  private decide(): void {
    const { nodes, units, me } = this;
    const p = this.params;
    const myPw = this.pw(me);
    this.incomingFoe.fill(0, 0, nodes.count);
    this.incomingMine.fill(0, 0, nodes.count);
    for (let i = 0; i < units.count; i++) {
      if (units.dead[i]) continue;
      if (units.faction[i] === me) this.incomingMine[units.target[i]] += myPw;
      else this.incomingFoe[units.target[i]] += this.pw(units.faction[i]);
    }

    // 1. DÉFENSE : renforcer mon nœud le plus menacé (menace EN PUISSANCE = ce
    //    qui arrive moins ce qui tient déjà), pondérée par defendBias.
    let defendNode = -1;
    let worstThreat = 0;
    for (let i = 0; i < nodes.count; i++) {
      if (nodes.faction[i] !== me) continue;
      const threat = this.incomingFoe[i] - (nodes.stock[i] * myPw + this.incomingMine[i]);
      if (threat > worstThreat) {
        worstThreat = threat;
        defendNode = i;
      }
    }
    if (defendNode >= 0 && worstThreat * p.defendBias >= 1) {
      this.reinforce(defendNode, Math.ceil((worstThreat * 1.2) / myPw));
      return;
    }

    // 2. ATTAQUE : meilleure cible au ratio valeur/coût, pénalisée par la distance.
    let neutralsLeft = false;
    for (let i = 0; i < nodes.count; i++) if (nodes.faction[i] === NEUTRAL) neutralsLeft = true;
    let best = -1;
    let bestScore = -Infinity;
    let bestCost = 0;
    const mySpeed = UNIT_SPEED * (this.factionSpeed ? this.factionSpeed[me] : 1);
    for (let c = 0; c < nodes.count; c++) {
      const f = nodes.faction[c];
      if (f === me) continue;
      const dist = this.avgDistFrom(c);
      const flight = dist / mySpeed;
      // tout nœud possédé par un adversaire se défend avec sa prod + ses
      // renforts (le tout EN PUISSANCE)
      const defense = f !== NEUTRAL ? this.incomingFoe[c] + nodes.prod(c) * flight * this.pw(f) : 0;
      // mes unités déjà en route vers c réduisent ce qu'il reste à payer
      const cost = nodes.stock[c] * this.pw(f) + defense - this.incomingMine[c];
      const value = f === NEUTRAL ? (neutralsLeft ? 2 : 1) : 1 + p.aggression;
      const score = value / (Math.max(0, cost) + 1) - (p.distWeight * dist) / 300;
      if (score > bestScore) {
        bestScore = score;
        best = c;
        bestCost = Math.max(0, cost);
      }
    }
    if (best < 0) {
      this.invest();
      return;
    }

    // contributeurs = mes `waveNodes` nœuds les PLUS PROCHES de la cible.
    // MOBILISATION de fin de partie : plus aucun neutre à prendre ⇒ vague
    // élargie (+2) — sans quoi une IA à petits nids (cap en puissance) peut
    // tourner en rond en upgrades sans jamais réunir la force d'attaque
    // (mesuré : idle qui timeout au lieu de punir l'inaction).
    const waveMax = neutralsLeft ? p.waveNodes : p.waveNodes + 2;
    let force = 0;
    let picked = 0;
    for (let k = 0; k < waveMax; k++) {
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
      force += Math.floor(nodes.stock[bestI] * (1 - p.reserveFrac)) * myPw;
    }
    // coût et force sont tous deux en puissance : comparaison directe
    const needed = bestCost * (1.4 - 0.5 * p.aggression) + 1;
    if (force < needed) {
      this.invest(); // pas de supériorité : on fait fructifier l'accumulation
      return;
    }

    // vague groupée : les contributeurs retenus envoient EN MÊME TEMPS
    for (let s = 0; s < picked; s++) {
      const i = this.wave[s];
      this.emitter.send(i, best, me, Math.floor(nodes.stock[i] * (1 - p.reserveFrac)));
    }
  }

  /**
   * Temps calme : nourrir un nid au cap pour le monter de niveau — le donneur
   * est le nœud allié le plus riche (hors receveur), s'il a un vrai surplus.
   */
  private invest(): void {
    const { nodes } = this;
    let capped = -1;
    for (let i = 0; i < nodes.count; i++) {
      if (nodes.faction[i] !== this.me || nodes.upgradeCost(i) === 0) continue;
      if (nodes.stock[i] >= nodes.cap(i) - 1) {
        capped = i;
        break;
      }
    }
    if (capped < 0) return;
    let donor = -1;
    let best = 0;
    for (let i = 0; i < nodes.count; i++) {
      if (nodes.faction[i] !== this.me || i === capped) continue;
      const surplus = Math.floor(nodes.stock[i] * (1 - this.params.reserveFrac));
      if (surplus > best) {
        best = surplus;
        donor = i;
      }
    }
    if (donor >= 0 && best >= 6) this.emitter.send(donor, capped, this.me, best);
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
