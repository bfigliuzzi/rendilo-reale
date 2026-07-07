import * as B from '../config/balance';
import type { EnemyKind, LevelDef, LevelEvent } from '../config/levels';
import { clamp, rand } from '../core/math';
import type { EnemyPool } from './enemies';

const KIND_INDEX: Record<EnemyKind, number> = {
  grunt: 0,
  runner: 1,
  brute: 2,
  kamikaze: 3,
  sniper: 4,
  elite: 5,
};

export interface SpawnTargets {
  enemies: EnemyPool;
  spawnGates: (ev: Extract<LevelEvent, { type: 'gates' }>) => void;
  spawnCrate: (ev: Extract<LevelEvent, { type: 'crate' }>) => void;
  spawnBoss: (ev: Extract<LevelEvent, { type: 'boss' }>) => void;
  spawnMine: (ev: Extract<LevelEvent, { type: 'mine' }>) => void;
  spawnSpikes: (ev: Extract<LevelEvent, { type: 'spikes' }>, hpMul: number) => void;
  onFinishLine: (at: number) => void;
  pressureHpMul: () => number; // riposte adaptative : ×PV appliqué au moment du spawn
}

/**
 * Curseur sur la liste (triée par `at`) des événements du niveau : un événement
 * est déclenché quand la caméra arrive à SPAWN_AHEAD de sa distance.
 */
export class Spawner {
  private idx = 0;

  constructor(
    private readonly level: LevelDef,
    private readonly targets: SpawnTargets,
  ) {}

  reset(): void {
    this.idx = 0;
  }

  update(dist: number): void {
    const events = this.level.events;
    // endless : générer le tronçon suivant avant d'épuiser la liste
    if (this.level.extend && this.idx > events.length - 8) this.level.extend(events, dist);
    while (this.idx < events.length && events[this.idx].at <= dist + B.SPAWN_AHEAD) {
      this.dispatch(events[this.idx]);
      this.idx++;
    }
  }

  private dispatch(ev: LevelEvent): void {
    switch (ev.type) {
      case 'horde':
        this.spawnHorde(ev);
        break;
      case 'gates':
        this.targets.spawnGates(ev);
        break;
      case 'crate':
        this.targets.spawnCrate(ev);
        break;
      case 'boss':
        this.targets.spawnBoss(ev);
        break;
      case 'mine':
        this.targets.spawnMine(ev);
        break;
      case 'spikes':
        // les dégâts des pics suivent l'escalade des PV ennemis, PAS la riposte
        // (les pics aident surtout le joueur — les gonfler sous pression serait un cadeau)
        this.targets.spawnSpikes(ev, ev.hpMul ?? this.level.hpMul ?? 1);
        break;
      case 'finish':
        this.targets.onFinishLine(ev.at);
        break;
    }
  }

  private spawnHorde(ev: Extract<LevelEvent, { type: 'horde' }>): void {
    const kind = KIND_INDEX[ev.kind];
    const hpMul = (ev.hpMul ?? this.level.hpMul ?? 1) * this.targets.pressureHpMul();
    const spacing = kind === 2 || kind === 5 ? 44 : 34;
    const width = ev.width ?? 300;
    const baseY = -ev.at;
    const cx = B.LANE_CENTER;
    const px = (x: number): number => clamp(x, B.LANE_MIN_X, B.LANE_MAX_X);

    switch (ev.pattern) {
      case 'grid': {
        const colCount = Math.max(1, Math.round(width / spacing));
        for (let i = 0; i < ev.count; i++) {
          const col = i % colCount;
          const row = Math.floor(i / colCount);
          this.targets.enemies.spawn(
            kind,
            px(cx - ((colCount - 1) * spacing) / 2 + col * spacing + rand(-4, 4)),
            baseY - row * spacing,
            hpMul,
          );
        }
        break;
      }
      case 'blob': {
        const rx = Math.min(width / 2, 170);
        for (let i = 0; i < ev.count; i++) {
          const a = rand(0, Math.PI * 2);
          const r = Math.sqrt(Math.random());
          this.targets.enemies.spawn(
            kind,
            px(cx + Math.cos(a) * rx * r),
            baseY - 100 + Math.sin(a) * 110 * r,
            hpMul,
          );
        }
        break;
      }
      case 'stream': {
        // colonne sinueuse étalée en profondeur : arrivées échelonnées dans le temps
        for (let i = 0; i < ev.count; i++) {
          this.targets.enemies.spawn(
            kind,
            px(cx + Math.sin(i * 0.9) * 130 + rand(-20, 20)),
            baseY - i * 55,
            hpMul,
          );
        }
        break;
      }
    }
  }
}
