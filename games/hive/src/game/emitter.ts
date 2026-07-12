import { rand } from '@shared/math';
import { EMIT_INTERVAL, MAX_FACTIONS, MAX_STREAMS } from '../config/balance';
import type { Faction } from '../config/levels';
import type { Nodes } from './nodes';
import type { Units } from './units';

/**
 * Flux d'émission : un envoi = une rafale étalée dans le temps (jamais un bloc),
 * c'est le look Auralux. `remaining` est FIGÉ à l'ordre : la production continue
 * pendant l'émission mais ne prolonge pas le flux. Le flux s'annule si la source
 * change de faction ou tombe à sec (comportement prévisible, rien d'implicite).
 * La cadence est en PUISSANCE constante (intervalle × power de l'espèce) : le
 * tuyau transporte le même débit de puissance pour tous les clans — les mouches
 * sortent en nuée dense, les cafards au compte-goutte (parité d'usure, sinon le
 * clan costaud renforce/attaque plus vite à travers le même tuyau).
 * Ring buffer fixe, zéro allocation.
 */
export class Emitter {
  readonly srcNode = new Int16Array(MAX_STREAMS);
  readonly dstNode = new Int16Array(MAX_STREAMS);
  readonly remaining = new Int16Array(MAX_STREAMS);
  readonly faction = new Uint8Array(MAX_STREAMS);
  readonly active = new Uint8Array(MAX_STREAMS);
  readonly timer = new Float32Array(MAX_STREAMS);
  readonly byFaction = new Int16Array(MAX_FACTIONS);

  /** `factionPower` : référence possédée par World, remplie à loadLevel. */
  constructor(
    private readonly nodes: Nodes,
    private readonly units: Units,
    private readonly factionPower: Float32Array,
  ) {}

  /**
   * Ouvre un flux src → dst. `count` est plafonné au stock entier courant.
   * Retourne false si rien à envoyer ou plus de slot libre.
   */
  send(src: number, dst: number, f: Faction, count: number): boolean {
    if (src === dst || this.nodes.faction[src] !== f) return false;
    const avail = Math.floor(this.nodes.stock[src]);
    const n = Math.min(count, avail);
    if (n < 1) return false;
    for (let s = 0; s < MAX_STREAMS; s++) {
      if (this.active[s]) continue;
      this.active[s] = 1;
      this.srcNode[s] = src;
      this.dstNode[s] = dst;
      this.remaining[s] = n;
      this.faction[s] = f;
      this.timer[s] = 0;
      this.byFaction[f]++;
      return true;
    }
    return false; // plus de slot : l'ordre est ignoré (32 flux simultanés suffisent)
  }

  update(dt: number): void {
    for (let s = 0; s < MAX_STREAMS; s++) {
      if (!this.active[s]) continue;
      const src = this.srcNode[s];
      const f = this.faction[s] as Faction;
      // source perdue ou à sec : reliquat annulé
      if (this.nodes.faction[src] !== f || this.nodes.stock[src] < 1) {
        this.stop(s);
        continue;
      }
      this.timer[s] -= dt;
      while (this.timer[s] <= 0 && this.remaining[s] > 0) {
        if (this.units.full()) {
          this.timer[s] = 0; // pool plein : on retente au tick suivant, rien perdu
          break;
        }
        if (this.nodes.stock[src] < 1) break;
        const dst = this.dstNode[s];
        // départ au bord du nœud, orienté vers la cible avec un peu de dispersion
        const a = Math.atan2(this.nodes.y[dst] - this.nodes.y[src], this.nodes.x[dst] - this.nodes.x[src]) + rand(-0.55, 0.55);
        const r = this.nodes.radius(src);
        this.units.spawn(this.nodes.x[src] + Math.cos(a) * r, this.nodes.y[src] + Math.sin(a) * r, f, dst);
        this.nodes.stock[src] -= 1;
        this.remaining[s] -= 1;
        this.timer[s] += EMIT_INTERVAL * this.factionPower[f];
      }
      if (this.remaining[s] <= 0) this.stop(s);
    }
  }

  private stop(s: number): void {
    this.active[s] = 0;
    this.byFaction[this.faction[s]]--;
  }

  clear(): void {
    this.active.fill(0);
    this.byFaction.fill(0);
  }
}
