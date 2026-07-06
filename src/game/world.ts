import { Container, Sprite, Text } from 'pixi.js';
import type { Sfx } from '../audio/sfx';
import * as B from '../config/balance';
import type { LevelDef } from '../config/levels';
import { clamp, lerp, rand } from '../core/math';
import type { PointerInput } from '../input/pointer';
import type { PlayerStats } from '../meta/upgrades';
import type { Fx } from '../render/fx';
import type { Layers } from '../render/layers';
import type { Atlas } from '../render/textures';
import { Bosses } from './boss';
import { BulletPool } from './bullets';
import { Collisions } from './collisions';
import { type Crate, Crates } from './crates';
import { EnemyPool } from './enemies';
import { Gates } from './gates';
import { Missiles } from './missiles';
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
  dmgBuff: number; // secondes de buff dégâts restantes (0 si inactif)
  shieldBuff: number;
}

export interface RunResult {
  victory: boolean;
  kills: number;
  dist: number; // en mètres
  gold: number; // or gagné pendant la run (hors bonus de fin)
  squad: number;
}

const DEFAULT_STATS: PlayerStats = { startSquad: B.START_SQUAD, dpsMul: 1, lootMul: 1, contactShield: 0 };
const FIREWORK_COLORS = [0xfbbf24, 0x4ade80, 0x60a5fa, 0xf87171, 0xffffff, 0xf472b6];

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
  private readonly missiles: Missiles;
  private readonly collisions = new Collisions();
  private spawner: Spawner | null = null;
  private level: LevelDef | null = null;
  private playerStats: PlayerStats = DEFAULT_STATS;
  private goldF = 0;
  private finishLine = Infinity;
  private finalBossDown = false;
  private finishBanner: Container | null = null;
  private time = 0;
  private dmgBuffUntil = 0;
  private shieldUntil = 0;
  private gateMissileT = 0;
  private ambientMissileT = 0;
  private endTimer = 0;
  private fireworkT = 0;
  private pendingResult: RunResult | null = null;
  private readonly statsObj: WorldStats = {
    squad: 0, kills: 0, dist: 0, gold: 0, bullets: 0, enemies: 0, dmgBuff: 0, shieldBuff: 0,
  };

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
    this.missiles = new Missiles(layers.crates, atlas);

    // câblage du juice : chaque système remonte ses événements, le monde les traduit en fx/sfx
    this.squad.onLost = (n) => {
      this.fx.burst(this.squad.x, -this.dist + 10, { count: Math.min(3 * n, 12), color: 0x60a5fa, speed: 120 });
      this.sfx.soldierLost();
    };
    this.crates.onHit = () => this.sfx.crateHit();
    this.crates.onBreak = (crate, byBullet) => this.handleCrateBreak(crate, byBullet);
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
      const losses = Math.max(2, kills - this.playerStats.contactShield);
      this.squad.loseSoldiers(losses);
      this.fx.shake(9);
      this.sfx.bossContact();
    };
    this.missiles.onWarn = () => this.sfx.missileWarn();
    this.missiles.onImpact = (x, y) => {
      // pertes proportionnelles : une frappe ampute sans annihiler une petite escouade
      const kills = Math.min(B.MISSILE_KILLS, Math.max(2, Math.ceil(this.squad.logical * 0.25)));
      this.explode(x, y, B.MISSILE_RADIUS, kills);
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
    this.time = 0;
    this.dmgBuffUntil = 0;
    this.shieldUntil = 0;
    this.gateMissileT = 0.4;
    this.ambientMissileT = rand(...B.MISSILE_AMBIENT_INTERVAL);
    this.endTimer = 0;
    this.pendingResult = null;
    this.crates.contactKills = Math.max(1, B.CRATE_CONTACT_KILLS - playerStats.contactShield);
    this.squad.reset(def.startSquad ?? playerStats.startSquad);
    this.spawner = new Spawner(def, {
      enemies: this.enemies,
      spawnGates: (ev) => this.gates.spawn(ev.at, ev.left, ev.right),
      spawnCrate: (ev) => this.crates.spawn(ev.at, ev.hp, ev.xNorm, ev.variant),
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
    if (this.state === 'idle') {
      this.input.consumeDX();
      // le décor défile doucement derrière le menu
      this.prevDist = this.dist;
      this.dist += 30 * dt;
      this.fx.update(dt);
      return;
    }
    if (this.state !== 'playing') {
      this.input.consumeDX();
      this.fx.update(dt);
      this.tickCelebration(dt);
      return;
    }
    const level = this.level;
    const spawner = this.spawner;
    if (!level || !spawner) return;

    this.time += dt;
    this.prevDist = this.dist;
    this.dist += level.scrollSpeed * dt;

    // buffs temporaires
    const dmgActive = this.time < this.dmgBuffUntil;
    this.squad.setShielded(this.time < this.shieldUntil);
    this.squad.setBadge(`${dmgActive ? '🔥' : ''}${this.squad.shielded ? '🛡' : ''}`);

    this.squad.update(dt, this.input.consumeDX());
    spawner.update(this.dist);
    const dpsMul = this.playerStats.dpsMul * (dmgActive ? B.BUFF_DMG_MUL : 1);
    if (this.bullets.autoFire(dt, this.squad, this.dist, dpsMul, this.enemies) > 0) {
      this.sfx.shoot();
    }
    this.bullets.update(dt, -this.dist - B.CULL_AHEAD, -this.dist + B.CULL_BEHIND);
    this.enemies.update(dt, this.squad.x, -this.dist + B.CULL_BEHIND);
    this.collisions.run(this.dist, this.bullets, this.enemies, this.squad, this.crates, this.bosses);
    this.updateMissiles(dt);
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

    if (this.squad.logical <= 0) this.beginEnd(false);
    else if (this.finalBossDown || this.dist >= this.finishLine) this.beginEnd(true);
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
    s.dmgBuff = Math.max(0, this.dmgBuffUntil - this.time);
    s.shieldBuff = Math.max(0, this.shieldUntil - this.time);
    return s;
  }

  /** Souffle : tue les ennemis dans le rayon, blesse boss et escouade proches. */
  private explode(x: number, y: number, radius: number, squadKills: number): void {
    this.fx.burst(x, y, { count: 40, color: 0xf97316, speed: 380, life: 0.55, size: 1.9 });
    this.fx.burst(x, y, { count: 14, color: 0xfde68a, speed: 200, life: 0.4, size: 1.2 });
    this.fx.shake(10);
    this.sfx.explosion();
    for (let e = 0; e < this.enemies.count; e++) {
      const dx = this.enemies.x[e] - x;
      const dy = this.enemies.y[e] - y;
      const r = radius + this.enemies.radius[e];
      if (dx * dx + dy * dy < r * r) this.enemies.hp[e] = 0;
    }
    for (const boss of this.bosses.list) {
      const dx = boss.x - x;
      const dy = boss.y - y;
      const r = radius + B.BOSS_RADIUS;
      if (dx * dx + dy * dy < r * r) boss.damage(B.EXPLOSION_BOSS_DAMAGE);
    }
    const sdx = this.squad.x - x;
    const sdy = -this.dist - y;
    const sr = radius + 40 * this.squad.visualScale;
    if (sdx * sdx + sdy * sdy < sr * sr) {
      this.squad.loseSoldiers(Math.max(2, squadKills - this.playerStats.contactShield));
    }
  }

  private handleCrateBreak(crate: Crate, byBullet: boolean): void {
    switch (crate.variant) {
      case 'explosive':
        this.explode(crate.cx, crate.cy, B.EXPLOSION_RADIUS, B.CRATE_EXPLOSIVE_KILLS);
        break;
      case 'damage':
        if (byBullet) {
          this.dmgBuffUntil = this.time + B.BUFF_DMG_DURATION;
          this.fx.burst(crate.cx, crate.cy, { count: 24, color: 0xfb923c, speed: 240, life: 0.5, size: 1.4 });
          this.sfx.powerup();
        }
        break;
      case 'shield':
        if (byBullet) {
          this.shieldUntil = this.time + B.BUFF_SHIELD_DURATION;
          this.fx.burst(crate.cx, crate.cy, { count: 24, color: 0x7dd3fc, speed: 240, life: 0.5, size: 1.4 });
          this.sfx.powerup();
        }
        break;
      default:
        this.fx.burst(crate.cx, crate.cy, { count: 18, color: 0xb98a4a, speed: 220, life: 0.5, size: 1.3 });
        this.fx.shake(byBullet ? 4 : 7);
        this.sfx.crateBreak();
        if (byBullet) this.goldF += B.GOLD_PER_CRATE * this.playerStats.lootMul;
    }
  }

  /** Barrage à l'approche des portes + frappes ambiantes : bouger ou mourir. */
  private updateMissiles(dt: number): void {
    if (this.dist < B.MISSILE_MIN_DIST) {
      this.missiles.update(dt);
      return;
    }
    const gateAhead = this.gates.nextGateDistance(this.dist);
    if (gateAhead !== null && gateAhead < B.MISSILE_GATE_RANGE) {
      this.gateMissileT -= dt;
      if (this.gateMissileT <= 0) {
        this.gateMissileT = rand(...B.MISSILE_GATE_INTERVAL);
        // champ de mines devant la porte : positions fixes sur la voie, à traverser
        this.missiles.spawn(
          rand(B.LANE_MIN_X + 20, B.LANE_MAX_X - 20),
          -this.dist - rand(120, Math.max(200, gateAhead - 60)),
        );
      }
    } else {
      this.gateMissileT = Math.min(this.gateMissileT, 0.4);
    }
    if (this.dist > B.MISSILE_AMBIENT_FROM) {
      this.ambientMissileT -= dt;
      if (this.ambientMissileT <= 0) {
        this.ambientMissileT = rand(...B.MISSILE_AMBIENT_INTERVAL);
        // frappe ambiante : celle-là vise le joueur — rare, mais elle réveille
        const x = clamp(this.squad.x + rand(-90, 90), B.LANE_MIN_X, B.LANE_MAX_X);
        this.missiles.spawn(x, -this.dist - rand(60, 200));
      }
    }
    this.missiles.update(dt);
  }

  /** Fin de run : la défaite claque, la victoire se célèbre avant l'écran de résultat. */
  private beginEnd(victory: boolean): void {
    this.state = victory ? 'victory' : 'defeat';
    this.pendingResult = {
      victory,
      kills: this.kills,
      dist: Math.round(this.dist / 10),
      gold: this.gold,
      squad: this.squad.logical,
    };
    this.endTimer = victory ? 1.8 : 0.7;
    this.fireworkT = 0;
    if (!victory) {
      this.fx.burst(this.squad.x, -this.dist, { count: 40, color: 0xf87171, speed: 300, life: 0.6, size: 1.5 });
      this.fx.shake(12);
    }
  }

  private tickCelebration(dt: number): void {
    if (this.endTimer <= 0) return;
    this.endTimer -= dt;
    if (this.state === 'victory') {
      this.fireworkT -= dt;
      if (this.fireworkT <= 0) {
        this.fireworkT = 0.18;
        const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
        this.fx.burst(rand(80, 460), -this.dist - rand(80, 680), {
          count: 26,
          color,
          speed: 320,
          life: 0.8,
          size: 1.5,
        });
        this.sfx.firework();
      }
    }
    if (this.endTimer <= 0 && this.pendingResult) {
      const result = this.pendingResult;
      this.pendingResult = null;
      this.onGameOver(result);
    }
  }

  private resetEntities(): void {
    this.finishBanner?.destroy({ children: true });
    this.finishBanner = null;
    this.bullets.clear();
    this.enemies.clear();
    this.gates.reset();
    this.crates.reset();
    this.bosses.reset();
    this.missiles.reset();
    this.fx.clear();
    this.squad.setShielded(false);
    this.squad.setBadge('');
    this.spawner = null;
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
