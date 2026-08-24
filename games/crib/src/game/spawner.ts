import * as B from '../config/balance';
import type { NightDef } from '../config/levels';

/** Ce que le spawner sait faire faire au monde. Évite un cycle d'imports avec `World`. */
export interface SpawnSink {
  /** `lane` est l'identifiant déclaré dans la carte ; c'est World qui le résout. */
  spawnWave(kind: number, count: number, lane: string, spread: number): void;
  spawnPickup(kind: number, x: number, y: number): void;
  spawnBoss(kind: number, lane: string): void;
}

/**
 * Consomme les événements d'UNE NUIT dans l'ordre, avec un simple curseur. Il ne
 * re-trie rien : `assertLevelSane` vérifie l'invariant au chargement plutôt que de
 * payer un tri, et un événement mal placé casse fort au lieu d'être ignoré en silence.
 *
 * Le dernier événement (`clear`) ne spawne rien : il ARME la condition « nuit
 * tenue ». Tant qu'il n'est pas atteint, une arène vide ne suffit pas — sinon un
 * creux de deux secondes entre deux vagues terminerait la nuit.
 *
 * Rechargé À CHAQUE NUIT, et déchargé pendant le jour : c'est la seule chose qui
 * distingue les deux phases côté simulation.
 */
export class Spawner {
  /** `true` dès que l'événement `clear` est passé : plus rien n'arrivera. */
  cleared = false;

  private night: NightDef | null = null;
  private cursor = 0;

  load(night: NightDef): void {
    this.night = night;
    this.cursor = 0;
    this.cleared = false;
  }

  /** Le jour : plus aucun événement ne peut sortir, et rien n'est « tenu ». */
  unload(): void {
    this.night = null;
    this.cursor = 0;
    this.cleared = false;
  }

  /** Événements encore à venir — le HUD s'en sert pour annoncer « dernière vague ». */
  get pending(): number {
    return this.night ? this.night.events.length - this.cursor : 0;
  }

  update(t: number, sink: SpawnSink): void {
    const night = this.night;
    if (!night) return;
    while (this.cursor < night.events.length && night.events[this.cursor].at <= t) {
      const ev = night.events[this.cursor];
      this.cursor++;
      switch (ev.type) {
        case 'wave':
          sink.spawnWave(B.kindIndex(ev.kind), ev.count, ev.lane, ev.spread ?? 0.7);
          break;
        case 'pickup':
          sink.spawnPickup(B.pickupIndex(ev.variant), ev.x, ev.y);
          break;
        case 'boss':
          sink.spawnBoss(B.bossIndex(ev.kind), ev.lane);
          break;
        case 'clear':
          this.cleared = true;
          break;
      }
    }
  }

  reset(): void {
    this.cursor = 0;
    this.cleared = false;
  }
}
