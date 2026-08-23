import * as B from '../config/balance';
import { assertSorted, spawnAngles, type LevelDef } from '../config/levels';

/** Ce que le spawner sait faire faire au monde. Évite un cycle d'imports avec `World`. */
export interface SpawnSink {
  spawnWave(kind: number, count: number, angle: number, arc: number): void;
  spawnPickup(kind: number, x: number, y: number): void;
  spawnBoss(): void;
}

/**
 * Consomme `LevelDef.events` dans l'ordre, avec un simple curseur. Il ne re-trie
 * rien : `assertSorted` vérifie l'invariant au chargement plutôt que de payer un
 * tri, et un événement mal placé casse fort au lieu d'être silencieusement ignoré.
 *
 * Le dernier événement (`clear`) ne spawne rien : il ARME la condition de victoire.
 * Tant qu'il n'est pas atteint, une arène vide ne suffit pas à gagner — sinon un
 * creux de deux secondes entre deux vagues terminerait la partie.
 */
export class Spawner {
  /** `true` dès que l'événement `clear` est passé : plus rien n'arrivera. */
  cleared = false;

  private def: LevelDef | null = null;
  private angles = new Float32Array(0);
  private cursor = 0;

  load(def: LevelDef): void {
    if (import.meta.env.DEV) assertSorted(def);
    this.def = def;
    this.angles = spawnAngles(def);
    this.cursor = 0;
    this.cleared = false;
  }

  /** Événements encore à venir — le HUD s'en sert pour annoncer « dernière vague ». */
  get pending(): number {
    return this.def ? this.def.events.length - this.cursor : 0;
  }

  update(t: number, sink: SpawnSink): void {
    const def = this.def;
    if (!def) return;
    while (this.cursor < def.events.length && def.events[this.cursor].at <= t) {
      const ev = def.events[this.cursor];
      const angle = this.angles[this.cursor];
      this.cursor++;
      switch (ev.type) {
        case 'wave':
          sink.spawnWave(B.kindIndex(ev.kind), ev.count, angle, ev.arc);
          break;
        case 'pickup':
          sink.spawnPickup(B.pickupIndex(ev.variant), ev.x, ev.y);
          break;
        case 'boss':
          sink.spawnBoss();
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
