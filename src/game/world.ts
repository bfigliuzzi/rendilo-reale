import { Container, Sprite, Text } from 'pixi.js';
import * as B from '../config/balance';
import type { LevelDef } from '../config/levels';
import { lerp } from '../core/math';
import type { PointerInput } from '../input/pointer';
import type { Layers } from '../render/layers';
import type { Atlas } from '../render/textures';
import { BulletPool } from './bullets';
import { Collisions } from './collisions';
import { Crates } from './crates';
import { EnemyPool } from './enemies';
import { Gates } from './gates';
import { Spawner } from './spawner';
import { Squad } from './squad';

export type GameState = 'playing' | 'defeat' | 'victory';

export interface WorldStats {
  squad: number;
  kills: number;
  dist: number;
  bullets: number;
  enemies: number;
}

export class World {
  state: GameState = 'playing';
  dist = 0;
  prevDist = 0;
  kills = 0;
  onGameOver: (state: GameState, stats: WorldStats) => void = () => {};

  readonly squad: Squad;
  readonly bullets: BulletPool;
  readonly enemies: EnemyPool;
  private readonly gates: Gates;
  private readonly crates: Crates;
  private readonly spawner: Spawner;
  private readonly collisions = new Collisions();
  private finishLine = Infinity;
  private finishBanner: Container | null = null;
  private readonly statsObj: WorldStats = { squad: 0, kills: 0, dist: 0, bullets: 0, enemies: 0 };

  constructor(
    private readonly layers: Layers,
    private readonly atlas: Atlas,
    private readonly level: LevelDef,
    private readonly input: PointerInput,
  ) {
    this.squad = new Squad(layers.squad, layers.labels, atlas, level.startSquad);
    this.bullets = new BulletPool(B.MAX_BULLETS, layers.bullets, atlas.bullet);
    this.enemies = new EnemyPool(B.MAX_ENEMIES, layers.enemies, atlas);
    this.gates = new Gates(layers.gates, atlas);
    this.crates = new Crates(layers.crates, layers.labels, atlas);
    this.spawner = new Spawner(level, {
      enemies: this.enemies,
      spawnGates: (ev) => this.gates.spawn(ev.at, ev.left, ev.right),
      spawnCrate: (ev) => this.crates.spawn(ev.at, ev.hp, ev.xNorm),
      onFinishLine: (at) => this.placeFinishLine(at),
    });
  }

  update(dt: number): void {
    if (this.state !== 'playing') {
      this.input.consumeDX(); // ne pas accumuler de drag pendant l'overlay
      return;
    }
    this.prevDist = this.dist;
    this.dist += this.level.scrollSpeed * dt;

    this.squad.update(dt, this.input.consumeDX());
    this.spawner.update(this.dist);
    this.bullets.autoFire(dt, this.squad, this.dist);
    this.bullets.update(dt, -this.dist - B.CULL_AHEAD, -this.dist + B.CULL_BEHIND);
    this.enemies.update(dt, this.squad.x, -this.dist + B.CULL_BEHIND);
    this.collisions.run(this.dist, this.bullets, this.enemies, this.squad, this.crates);
    this.enemies.sweepDead(() => this.kills++);
    this.gates.update(dt, this.squad, this.dist);
    this.crates.update(this.squad, this.dist);

    if (this.squad.logical <= 0) this.end('defeat');
    else if (this.dist >= this.finishLine) this.end('victory');
  }

  render(alpha: number): void {
    const di = lerp(this.prevDist, this.dist, alpha);
    const offset = di + B.SQUAD_SCREEN_Y;
    this.layers.world.y = offset;
    this.layers.ground.tilePosition.y = offset;
    this.squad.renderSync(alpha, di);
    this.bullets.syncRender(alpha);
    this.enemies.syncRender(alpha);
  }

  stats(): WorldStats {
    const s = this.statsObj;
    s.squad = this.squad.logical;
    s.kills = this.kills;
    s.dist = Math.round(this.dist / 10); // « mètres » affichés
    s.bullets = this.bullets.count;
    s.enemies = this.enemies.count;
    return s;
  }

  reset(): void {
    this.dist = 0;
    this.prevDist = 0;
    this.kills = 0;
    this.finishLine = Infinity;
    this.finishBanner?.destroy({ children: true });
    this.finishBanner = null;
    this.squad.reset();
    this.bullets.clear();
    this.enemies.clear();
    this.gates.reset();
    this.crates.reset();
    this.spawner.reset();
    this.state = 'playing';
  }

  private end(state: GameState): void {
    this.state = state;
    this.onGameOver(state, this.stats());
  }

  private placeFinishLine(at: number): void {
    this.finishLine = at;
    const banner = new Container();
    const stripe = new Sprite(this.atlas.white);
    stripe.anchor.set(0.5);
    stripe.width = B.LANE_MAX_X - B.LANE_MIN_X + 40;
    stripe.height = 14;
    stripe.tint = 0xffffff;
    const label = new Text({
      text: 'ARRIVÉE',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 28,
        fontWeight: '900',
        fill: 0xffffff,
        stroke: { color: 0x0b1016, width: 5 },
      },
    });
    label.anchor.set(0.5, 1);
    label.y = -12;
    banner.addChild(stripe, label);
    banner.position.set(B.LANE_CENTER, -at);
    this.layers.labels.addChild(banner);
    this.finishBanner = banner;
  }
}
