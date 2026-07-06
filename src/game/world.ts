import { Container, Sprite, Text } from 'pixi.js';
import type { Sfx } from '../audio/sfx';
import * as B from '../config/balance';
import type { LevelDef } from '../config/levels';
import { lerp } from '../core/math';
import type { PointerInput } from '../input/pointer';
import type { PlayerStats } from '../meta/upgrades';
import type { Fx } from '../render/fx';
import type { Layers } from '../render/layers';
import type { Atlas } from '../render/textures';
import { Bosses } from './boss';
import { BulletPool } from './bullets';
import { Collisions } from './collisions';
import { Crates } from './crates';
import { EnemyPool } from './enemies';
import { Gates } from './gates';
import { Spawner } from './spawner';
import { Squad } from './squad';

export type GameState = 'idle' | 'playing' | 'defeat' | 'victory';

export interface WorldStats {
  squad: number;
  kills: number;
  dist: number; // en « mètres » affichés
  gold: number;
  bullets: number;
  enemies: number;
}

export interface RunResult {
  victory: boolean;
  kills: number;
  dist: number; // en mètres
  gold: number; // or gagné pendant la run (hors bonus de fin)
  squad: number;
}

const DEFAULT_STATS: PlayerStats = { startSquad: B.START_SQUAD, dpsMul: 1, lootMul: 1, contactShield: 0 };

export class World {
  state: GameState = 'idle';
  dist = 0;
  prevDist = 0;
  kills = 0;
  onGameOver: (result: RunResult) => void = () => {};

  readonly squad: Squad;
  readonly bullets: BulletPool;
  readonly enemies: EnemyPool;
  readonly bosses: Bosses;
  private readonly gates: Gates;
  private readonly crates: Crates;
  private readonly collisions = new Collisions();
  private spawner: Spawner | null = null;
  private level: LevelDef | null = null;
  private playerStats: PlayerStats = DEFAULT_STATS;
  private goldF = 0;
  private finishLine = Infinity;
  private finalBossDown = false;
  private finishBanner: Container | null = null;
  private readonly statsObj: WorldStats = { squad: 0, kills: 0, dist: 0, gold: 0, bullets: 0, enemies: 0 };

  constructor(
    private readonly layers: Layers,
    private readonly atlas: Atlas,
    private readonly input: PointerInput,
    private readonly fx: Fx,
    private readonly sfx: Sfx,
  ) {
    this.squad = new Squad(layers.squad, layers.labels, atlas);
    this.bullets = new BulletPool(B.MAX_BULLETS, layers.bullets, atlas.bullet);
    this.enemies = new EnemyPool(B.MAX_ENEMIES, layers.enemies, atlas);
    this.gates = new Gates(layers.gates, atlas);
    this.crates = new Crates(layers.crates, layers.labels, atlas);
    this.bosses = new Bosses(layers.crates, atlas);

    // câblage du juice : chaque système remonte ses événements, le monde les traduit en fx/sfx
    this.squad.onLost = (n) => {
      this.fx.burst(this.squad.x, -this.dist + 10, { count: Math.min(3 * n, 12), color: 0x60a5fa, speed: 120 });
      this.sfx.soldierLost();
    };
    this.crates.onHit = () => this.sfx.crateHit();
    this.crates.onBreak = (x, y, byBullet) => {
      this.fx.burst(x, y, { count: 18, color: 0xb98a4a, speed: 220, life: 0.5, size: 1.3 });
      this.fx.shake(byBullet ? 4 : 7);
      this.sfx.crateBreak();
      if (byBullet) this.goldF += B.GOLD_PER_CRATE * this.playerStats.lootMul;
    };
    this.collisions.onBossHit = () => this.sfx.bossHit();
    this.bosses.onDeath = (boss, x, y) => {
      this.fx.burst(x, y, { count: 46, color: 0xef4444, speed: 340, life: 0.7, size: 1.7 });
      this.fx.shake(12);
      this.sfx.bossDie();
      this.goldF += B.GOLD_PER_BOSS * this.playerStats.lootMul;
      this.kills++;
      if (boss.final) this.finalBossDown = true;
    };
    this.bosses.onContact = (kills) => {
      const losses = Math.max(2, kills - 2 * this.playerStats.contactShield);
      this.squad.loseSoldiers(losses);
      this.fx.shake(9);
      this.sfx.bossContact();
    };
  }

  /** Démarre une run : remet tout à zéro puis charge le niveau. */
  loadLevel(def: LevelDef, playerStats: PlayerStats = DEFAULT_STATS): void {
    this.resetEntities();
    this.level = def;
    this.playerStats = playerStats;
    this.dist = 0;
    this.prevDist = 0;
    this.kills = 0;
    this.goldF = 0;
    this.finishLine = Infinity;
    this.finalBossDown = false;
    this.crates.contactKills = Math.max(1, B.CRATE_CONTACT_KILLS - playerStats.contactShield);
    this.squad.reset(def.startSquad ?? playerStats.startSquad);
    this.spawner = new Spawner(def, {
      enemies: this.enemies,
      spawnGates: (ev) => this.gates.spawn(ev.at, ev.left, ev.right),
      spawnCrate: (ev) => this.crates.spawn(ev.at, ev.hp, ev.xNorm),
      spawnBoss: (ev) => this.bosses.spawn(ev.at, ev.hp, ev.final ?? false),
      onFinishLine: (at) => this.placeFinishLine(at),
    });
    this.state = 'playing';
  }

  /** Retour au menu : fige et vide la scène. */
  toIdle(): void {
    this.resetEntities();
    this.state = 'idle';
  }

  get gold(): number {
    return Math.floor(this.goldF);
  }

  update(dt: number): void {
    if (this.state !== 'playing') {
      this.input.consumeDX(); // ne pas accumuler de drag hors jeu
      if (this.state === 'idle') {
        // le décor défile doucement derrière le menu
        this.prevDist = this.dist;
        this.dist += 30 * dt;
      }
      this.fx.update(dt);
      return;
    }
    const level = this.level;
    const spawner = this.spawner;
    if (!level || !spawner) return;

    this.prevDist = this.dist;
    this.dist += level.scrollSpeed * dt;

    this.squad.update(dt, this.input.consumeDX());
    spawner.update(this.dist);
    if (this.bullets.autoFire(dt, this.squad, this.dist, this.playerStats.dpsMul) > 0) {
      this.sfx.shoot();
    }
    this.bullets.update(dt, -this.dist - B.CULL_AHEAD, -this.dist + B.CULL_BEHIND);
    this.enemies.update(dt, this.squad.x, -this.dist + B.CULL_BEHIND);
    this.collisions.run(this.dist, this.bullets, this.enemies, this.squad, this.crates, this.bosses);
    this.enemies.sweepDead((x, y) => {
      this.kills++;
      this.goldF += B.GOLD_PER_KILL * this.playerStats.lootMul;
      this.fx.burst(x, y, { count: 5, color: 0xf87171, speed: 150, life: 0.3 });
      this.sfx.enemyDie();
    });
    const gateMod = this.gates.update(dt, this.squad, this.dist);
    if (gateMod) {
      const positive = gateMod.op === 'mul' ? gateMod.value >= 1 : gateMod.value >= 0;
      this.fx.burst(this.squad.x, -this.dist - 20, {
        count: positive ? 22 : 10,
        color: positive ? 0x4ade80 : 0xf87171,
        speed: 200,
        life: 0.5,
      });
      if (positive) this.sfx.gateGood();
      else this.sfx.gateBad();
    }
    this.crates.update(this.squad, this.dist);
    this.bosses.update(dt, this.squad, this.dist);
    this.fx.update(dt);

    if (this.squad.logical <= 0) this.end(false);
    else if (this.finalBossDown || this.dist >= this.finishLine) this.end(true);
  }

  render(alpha: number): void {
    const di = lerp(this.prevDist, this.dist, alpha);
    this.fx.syncRender(alpha);
    const sx = this.fx.shakeX.value;
    const sy = this.fx.shakeY.value;
    const offset = di + B.SQUAD_SCREEN_Y;
    this.layers.world.position.set(sx, offset + sy);
    this.layers.ground.position.set(sx, sy);
    this.layers.ground.tilePosition.y = offset;
    this.squad.renderSync(alpha, di);
    this.bullets.syncRender(alpha);
    this.enemies.syncRender(alpha);
    this.bosses.renderSync(alpha);
  }

  stats(): WorldStats {
    const s = this.statsObj;
    s.squad = this.squad.logical;
    s.kills = this.kills;
    s.dist = Math.round(this.dist / 10);
    s.gold = this.gold;
    s.bullets = this.bullets.count;
    s.enemies = this.enemies.count;
    return s;
  }

  private resetEntities(): void {
    this.finishBanner?.destroy({ children: true });
    this.finishBanner = null;
    this.bullets.clear();
    this.enemies.clear();
    this.gates.reset();
    this.crates.reset();
    this.bosses.reset();
    this.fx.clear();
    this.spawner = null;
  }

  private end(victory: boolean): void {
    this.state = victory ? 'victory' : 'defeat';
    this.onGameOver({
      victory,
      kills: this.kills,
      dist: Math.round(this.dist / 10),
      gold: this.gold,
      squad: this.squad.logical,
    });
  }

  private placeFinishLine(at: number): void {
    this.finishLine = at;
    const banner = new Container();
    const stripe = new Sprite(this.atlas.white);
    stripe.anchor.set(0.5);
    stripe.width = B.LANE_MAX_X - B.LANE_MIN_X + 40;
    stripe.height = 14;
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
