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
import { Mines } from './mines';
import { Missiles } from './missiles';
import { ProjectilePool } from './projectiles';
import { Spawner } from './spawner';
import { Spikes } from './spikes';
import { Squad } from './squad';

export type GameState = 'idle' | 'playing' | 'defeat' | 'victory';

export interface WorldStats {
  squad: number;
  kills: number;
  dist: number; // en « mètres » affichés
  gold: number;
  bullets: number;
  enemies: number;
  dmgBuff: number; // secondes de buff restantes (0 si inactif)
  shieldBuff: number;
  droneBuff: number;
  goldBuff: number;
  threat: number; // multiplicateur de riposte adaptative (1 = escouade sous la masse critique)
}

export interface RunResult {
  victory: boolean;
  kills: number;
  dist: number; // en mètres
  gold: number; // or gagné pendant la run (hors bonus de fin)
  squad: number;
  bossKills: number;
  bonusCrates: number; // caisses bonus effectivement récupérées (buff déclenché)
}

const DEFAULT_STATS: PlayerStats = {
  startSquad: B.START_SQUAD,
  dpsMul: 1,
  lootMul: 1,
  contactShield: 0,
  rateMul: 1,
  splash: 0,
  composition: { rifle: 1, sniper: 0, art: 0 },
  soldierHp: 1,
};
const FIREWORK_COLORS = [0xfbbf24, 0x4ade80, 0x60a5fa, 0xf87171, 0xffffff, 0xf472b6];

export class World {
  state: GameState = 'idle';
  dist = 0;
  prevDist = 0;
  kills = 0;
  bossKillsRun = 0;
  bonusCratesRun = 0;
  onGameOver: (result: RunResult) => void = () => {};

  readonly squad: Squad;
  readonly bullets: BulletPool;
  readonly enemies: EnemyPool;
  readonly bosses: Bosses;
  readonly bolts: ProjectilePool; // bolts des snipers (public : bot de test)
  private readonly gates: Gates;
  private readonly crates: Crates;
  private readonly missiles: Missiles;
  readonly mines: Mines; // public : bot de test
  readonly spikes: Spikes; // public : bot de test
  private readonly droneSprite: Sprite;
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
  private droneUntil = 0;
  private goldUntil = 0;
  private droneFireAcc = 0;
  private gateMissileT = 0;
  private ambientMissileT = 0;
  private nukeT = 0;
  private ultraStrikeT = 0;
  private ultraSummonT = 0;
  private ultraStrikeAlt = false;
  private ultraLanceMul = 1; // ×ULTRA_DMG_MUL tant qu'un boss ultra est en vie
  private spikeHurtT = 0; // throttle du feedback de contact pics (les pertes, elles, sont continues)
  private gigaBanner: Container | null = null;
  private endTimer = 0;
  private fireworkT = 0;
  private pendingResult: RunResult | null = null;
  private pressure = 0; // doublements d'effectif au-delà de PRESSURE_SQUAD_REF (0 = aucun)
  private readonly statsObj: WorldStats = {
    squad: 0, kills: 0, dist: 0, gold: 0, bullets: 0, enemies: 0,
    dmgBuff: 0, shieldBuff: 0, droneBuff: 0, goldBuff: 0, threat: 1,
  };

  constructor(
    private readonly layers: Layers,
    private readonly atlas: Atlas,
    private readonly input: PointerInput,
    private readonly fx: Fx,
    private readonly sfx: Sfx,
  ) {
    this.squad = new Squad(layers.squad, layers.labels, atlas);
    this.bullets = new BulletPool(B.MAX_BULLETS, layers.bullets, atlas);
    this.enemies = new EnemyPool(B.MAX_ENEMIES, layers.enemies, atlas);
    this.gates = new Gates(layers.gates, atlas);
    this.crates = new Crates(layers.crates, layers.labels, atlas);
    this.bosses = new Bosses(layers.crates, atlas);
    this.bolts = new ProjectilePool(B.MAX_BOLTS, layers.crates, atlas.bolt, B.BOLT_SPEED);
    this.missiles = new Missiles(layers.crates, atlas);
    this.mines = new Mines(layers.gates, atlas); // sous les ennemis : elles sont au sol
    this.spikes = new Spikes(layers.gates, atlas); // au sol aussi : la horde marche dessus
    this.droneSprite = new Sprite(atlas.drone);
    this.droneSprite.anchor.set(0.5);
    this.droneSprite.visible = false;
    layers.squad.addChild(this.droneSprite);

    // câblage du juice : chaque système remonte ses événements, le monde les traduit en fx/sfx
    this.squad.onLost = (n) => {
      this.fx.burst(this.squad.x, -this.dist + 10, { count: Math.min(3 * n, 12), color: 0x60a5fa, speed: 120 });
      this.sfx.soldierLost();
    };
    this.crates.onHit = () => this.sfx.crateHit();
    this.crates.onBreak = (crate, byBullet) => this.handleCrateBreak(crate, byBullet);
    this.collisions.onBossHit = () => this.sfx.bossHit();
    this.collisions.onKamikaze = (x, y) => {
      const kills = Math.min(
        this.heavyCap(B.KAMIKAZE_KILLS_MAX),
        Math.max(2, Math.ceil(this.squad.logical * B.KAMIKAZE_KILLS_RATIO)),
      );
      this.explode(x, y, B.KAMIKAZE_RADIUS, kills);
    };
    this.bosses.onDeath = (boss, x, y) => {
      this.fx.burst(x, y, { count: 46, color: 0xef4444, speed: 340, life: 0.7, size: 1.7 });
      this.fx.shake(12);
      this.sfx.bossDie();
      this.addGold(B.GOLD_PER_BOSS);
      this.kills++;
      this.bossKillsRun++;
      if (boss.final) this.finalBossDown = true;
    };
    this.bosses.onContact = (kills) => {
      const losses = Math.max(2, this.heavyCap(kills) - this.playerStats.contactShield);
      this.squad.loseSoldiers(losses, true);
      this.fx.shake(9);
      this.sfx.bossContact();
    };
    this.bosses.onLanceFire = () => this.sfx.lanceFire();
    this.bosses.onLanceHit = (x, y) => {
      // ultra boss : ses lances frappent plus fort (ULTRA_DMG_MUL) — c'est SA menace,
      // le contact étant impossible par construction (épinglé hors de portée)
      const losses = Math.max(
        2,
        Math.min(
          this.heavyCap(B.LANCE_KILLS_MAX * this.ultraLanceMul),
          Math.ceil(this.squad.logical * B.LANCE_KILLS_RATIO * this.ultraLanceMul),
        ) - this.playerStats.contactShield,
      );
      this.squad.loseSoldiers(losses, true);
      this.fx.burst(x, y, { count: 16, color: 0xef4444, speed: 220, life: 0.4, size: 1.3 });
      this.fx.shake(6);
      this.sfx.lanceHit();
    };
    this.spikes.onSquadContact = (x, y, dt) => {
      // attrition continue, proportionnelle avec plancher/plafond (canal heavy) :
      // traverser un mur coûte un pourcentage, pas un forfait ni une annihilation
      const rate = Math.min(
        this.heavyCap(B.SPIKE_SQUAD_MAX),
        Math.max(B.SPIKE_SQUAD_MIN, this.squad.logical * B.SPIKE_SQUAD_RATIO),
      );
      this.squad.loseSoldiers(rate * dt, true);
      this.spikeHurtT -= dt;
      if (this.spikeHurtT <= 0) {
        this.spikeHurtT = 0.15;
        this.fx.burst(x, y, { count: 6, color: 0xcbd5e1, speed: 170, life: 0.3 });
        this.fx.shake(3);
        this.sfx.crateHit();
      }
    };
    this.mines.onTrigger = (x, y) => {
      const kills = Math.min(
        this.heavyCap(B.MINE_KILLS_MAX),
        Math.max(2, Math.ceil(this.squad.logical * B.MINE_KILLS_RATIO)),
      );
      this.explode(x, y, B.MINE_RADIUS, kills);
    };
    this.missiles.onWarn = () => this.sfx.missileWarn();
    this.missiles.onImpact = (x, y, kind) => {
      // pertes proportionnelles au calibre : une frappe ampute sans annihiler
      const def = B.MISSILE_KINDS[kind];
      const kills = Math.min(
        this.heavyCap(def.killsCap),
        Math.max(2, Math.ceil(this.squad.logical * def.killsRatio)),
      );
      this.explode(x, y, def.radius, kills);
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
    this.bossKillsRun = 0;
    this.bonusCratesRun = 0;
    this.goldF = 0;
    this.finishLine = Infinity;
    this.finalBossDown = false;
    this.time = 0;
    this.dmgBuffUntil = 0;
    this.shieldUntil = 0;
    this.droneUntil = 0;
    this.goldUntil = 0;
    this.droneFireAcc = 0;
    this.gateMissileT = 0.4;
    this.ambientMissileT = rand(...B.MISSILE_AMBIENT_INTERVAL);
    this.nukeT = rand(...B.NUKE_INTERVAL);
    this.ultraStrikeT = rand(...B.ULTRA_STRIKE_INTERVAL);
    this.ultraSummonT = rand(...B.ULTRA_SUMMON_INTERVAL);
    this.ultraLanceMul = 1;
    this.spikeHurtT = 0;
    this.endTimer = 0;
    this.pendingResult = null;
    this.pressure = 0;
    this.layers.ground.texture = this.atlas.grounds[def.biome ?? 0];
    this.crates.contactKills = Math.max(1, B.CRATE_CONTACT_KILLS - playerStats.contactShield);
    this.squad.reset(
      def.startSquad ?? playerStats.startSquad,
      playerStats.composition,
      playerStats.soldierHp,
    );
    this.spawner = new Spawner(def, {
      enemies: this.enemies,
      spawnGates: (ev) => this.gates.spawn(ev.at, ev.left, ev.right),
      // la riposte adaptative gonfle aussi les PV des caisses et des boss au spawn
      spawnCrate: (ev) => this.crates.spawn(ev.at, ev.hp * this.pressureHpMul, ev.xNorm, ev.variant),
      spawnBoss: (ev) => {
        this.bosses.spawn(ev.at, ev.hp * this.pressureHpMul, ev.final ?? false, ev.ultra ?? false);
        // GIGA HORDE : escorte du boss final, seulement sous riposte adaptative
        if (ev.final && (this.level?.gigaHorde ?? false) && this.pressure > 0) {
          this.spawnGigaHorde(ev.at);
        }
      },
      spawnMine: (ev) => this.mines.spawn(ev.at, ev.xNorm),
      spawnSpikes: (ev, hpMul) => this.spikes.spawn(ev.at, ev.xNorm, ev.widthFrac, hpMul),
      onFinishLine: (at) => this.placeFinishLine(at),
      pressureHpMul: () => this.pressureHpMul,
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
    const droneActive = this.time < this.droneUntil;
    const goldActive = this.time < this.goldUntil;
    this.squad.setShielded(this.time < this.shieldUntil);
    this.squad.setBadge(
      `${dmgActive ? '🔥' : ''}${this.squad.shielded ? '🛡' : ''}${droneActive ? '✈' : ''}${goldActive ? '💰' : ''}`,
    );

    this.squad.update(dt, this.input.consumeDX());
    // riposte adaptative : mesurée AVANT le spawn — les hordes naissent calibrées
    // sur la masse actuelle ; le contact caisse suit aussi l'effectif
    this.pressure =
      this.squad.logical > B.PRESSURE_SQUAD_REF
        ? Math.log2(this.squad.logical / B.PRESSURE_SQUAD_REF)
        : 0;
    this.crates.contactKills = Math.max(
      1,
      this.heavyCap(B.CRATE_CONTACT_KILLS) - this.playerStats.contactShield,
    );
    spawner.update(this.dist);
    const dpsMul = this.playerStats.dpsMul * (dmgActive ? B.BUFF_DMG_MUL : 1);
    if (
      this.bullets.autoFire(
        dt,
        this.squad,
        this.dist,
        dpsMul,
        this.playerStats.rateMul,
        this.playerStats.composition,
        this.playerStats.splash,
        this.enemies,
        this.bosses,
        this.crates,
      ) > 0
    ) {
      this.sfx.shoot();
    }
    this.updateDrone(dt, droneActive, dpsMul);
    this.bullets.update(dt, -this.dist - B.CULL_AHEAD, -this.dist + B.CULL_BEHIND);
    this.enemies.update(dt, this.squad.x, -this.dist, -this.dist + B.CULL_BEHIND, (x, y, angle) => {
      this.bolts.fire(x, y, angle);
      this.sfx.boltFire();
    });
    this.bolts.update(dt, this.squad, this.dist, (x, y) => {
      const losses = Math.max(
        1,
        Math.min(this.heavyCap(B.BOLT_KILLS_MAX), Math.ceil(this.squad.logical * B.BOLT_KILLS_RATIO)) -
          this.playerStats.contactShield,
      );
      this.squad.loseSoldiers(losses, true);
      this.fx.burst(x, y, { count: 10, color: 0xa855f7, speed: 180, life: 0.35 });
      this.sfx.lanceHit();
    });
    this.collisions.run(this.dist, this.bullets, this.enemies, this.squad, this.crates, this.bosses);
    // après les collisions (indices de grille encore valides), avant sweepDead :
    // les morts par pics sont ramassées — et payées — dans la même passe
    this.spikes.update(dt, this.enemies, this.squad, this.dist);
    this.updateMissiles(dt);
    this.updateUltra(dt);
    this.enemies.sweepDead((x, y) => {
      this.kills++;
      this.addGold(B.GOLD_PER_KILL);
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
    this.mines.update(dt, this.squad, this.dist);
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
    this.bolts.syncRender(alpha);
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
    s.droneBuff = Math.max(0, this.droneUntil - this.time);
    s.goldBuff = Math.max(0, this.goldUntil - this.time);
    s.threat = this.pressureHpMul;
    return s;
  }

  /** Multiplicateur de PV de la riposte adaptative (1 sous la masse critique, plafonné). */
  private get pressureHpMul(): number {
    return Math.min(B.PRESSURE_HP_MAX, 1 + B.PRESSURE_HP_PER_DOUBLING * this.pressure);
  }

  /**
   * Plafond de pertes lourdes suivant la masse : fixe sous PRESSURE_SQUAD_REF
   * (invariant plancher/plafond intact pour les petites escouades), proportionnel
   * au-delà — une mine doit rester une amputation en %, pas un forfait cosmétique.
   */
  private heavyCap(base: number): number {
    return Math.ceil(base * Math.max(1, this.squad.logical / B.PRESSURE_SQUAD_REF));
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
      this.squad.loseSoldiers(Math.max(2, squadKills - this.playerStats.contactShield), true);
    }
  }

  private handleCrateBreak(crate: Crate, byBullet: boolean): void {
    switch (crate.variant) {
      case 'explosive': {
        // pertes proportionnelles : le souffle ampute, il n'annihile pas une petite escouade
        const kills = Math.min(
          this.heavyCap(B.CRATE_EXPLOSIVE_KILLS),
          Math.max(2, Math.ceil(this.squad.logical * 0.3)),
        );
        this.explode(crate.cx, crate.cy, B.EXPLOSION_RADIUS, kills);
        break;
      }
      case 'damage':
        if (byBullet) {
          this.bonusCratesRun++;
          this.dmgBuffUntil = this.time + B.BUFF_DMG_DURATION;
          this.fx.burst(crate.cx, crate.cy, { count: 24, color: 0xfb923c, speed: 240, life: 0.5, size: 1.4 });
          this.sfx.powerup();
        }
        break;
      case 'shield':
        if (byBullet) {
          this.bonusCratesRun++;
          this.shieldUntil = this.time + B.BUFF_SHIELD_DURATION;
          this.fx.burst(crate.cx, crate.cy, { count: 24, color: 0x7dd3fc, speed: 240, life: 0.5, size: 1.4 });
          this.sfx.powerup();
        }
        break;
      case 'drone':
        if (byBullet) {
          this.bonusCratesRun++;
          this.droneUntil = this.time + B.BUFF_DRONE_DURATION;
          this.fx.burst(crate.cx, crate.cy, { count: 24, color: 0x38bdf8, speed: 240, life: 0.5, size: 1.4 });
          this.sfx.powerup();
        }
        break;
      case 'gold':
        if (byBullet) {
          this.bonusCratesRun++;
          this.goldUntil = this.time + B.BUFF_GOLD_DURATION;
          this.fx.burst(crate.cx, crate.cy, { count: 24, color: 0xfbbf24, speed: 240, life: 0.5, size: 1.4 });
          this.sfx.powerup();
        }
        break;
      default:
        this.fx.burst(crate.cx, crate.cy, { count: 18, color: 0xb98a4a, speed: 220, life: 0.5, size: 1.3 });
        this.fx.shake(byBullet ? 4 : 7);
        this.sfx.crateBreak();
        if (byBullet) this.addGold(B.GOLD_PER_CRATE);
    }
  }

  /** Tout l'or passe par ici : bonus Butin de la méta + buff or ×2 éventuel. */
  private addGold(amount: number): void {
    const goldMul = this.time < this.goldUntil ? B.BUFF_GOLD_MUL : 1;
    this.goldF += amount * this.playerStats.lootMul * goldMul;
  }

  /** Drone allié : plane au-dessus de l'escouade et ajoute son propre tir visé. */
  private updateDrone(dt: number, active: boolean, dpsMul: number): void {
    this.droneSprite.visible = active;
    if (!active) return;
    const x = this.squad.x + Math.sin(this.time * 2.4) * 46;
    const y = -this.dist - 64;
    this.droneSprite.position.set(x, y);
    const droneDps = this.squad.logical * B.SOLDIER_DPS * dpsMul * B.BUFF_DRONE_DPS_RATIO;
    this.droneFireAcc += B.BUFF_DRONE_FIRE_RATE * dt;
    while (this.droneFireAcc >= 1) {
      this.droneFireAcc -= 1;
      this.bullets.fireAimed(
        x,
        y - 10,
        droneDps / B.BUFF_DRONE_FIRE_RATE,
        this.enemies,
        this.bosses,
        this.crates,
      );
    }
  }

  /** Barrage à l'approche des portes + frappes ambiantes : bouger ou mourir. */
  private updateMissiles(dt: number): void {
    if (this.dist < (this.level?.missileMinDist ?? B.MISSILE_MIN_DIST)) {
      this.missiles.update(dt);
      return;
    }
    // la riposte accélère les frappes quand l'escouade dépasse la masse critique
    const haste = 1 + B.PRESSURE_MISSILE_RATE * this.pressure;
    const gateAhead = this.gates.nextGateDistance(this.dist);
    if (gateAhead !== null && gateAhead < B.MISSILE_GATE_RANGE) {
      this.gateMissileT -= dt;
      if (this.gateMissileT <= 0) {
        this.gateMissileT =
          (rand(...B.MISSILE_GATE_INTERVAL) * (this.level?.missileIntervalMul ?? 1)) / haste;
        // champ de mines devant la porte : positions fixes sur la voie, à traverser
        this.missiles.spawn(
          rand(B.LANE_MIN_X + 20, B.LANE_MAX_X - 20),
          -this.dist - rand(120, Math.max(200, gateAhead - 60)),
          this.pickMissileKind(),
        );
      }
    } else {
      this.gateMissileT = Math.min(this.gateMissileT, 0.4);
    }
    // sous pression, les frappes ambiantes commencent aussi plus tôt dans le niveau
    if (this.dist > B.MISSILE_AMBIENT_FROM / haste) {
      this.ambientMissileT -= dt;
      if (this.ambientMissileT <= 0) {
        this.ambientMissileT = rand(...B.MISSILE_AMBIENT_INTERVAL) / haste;
        // frappe ambiante : celle-là vise le joueur — rare, mais elle réveille
        const x = clamp(this.squad.x + rand(-90, 90), B.LANE_MIN_X, B.LANE_MAX_X);
        this.missiles.spawn(x, -this.dist - rand(60, 200), this.pickMissileKind());
      }
    }
    // l'atomique : réservé à la riposte adaptative — rare, vise le joueur,
    // long télégraphe : il se fuit, mais il faut décoller tout de suite
    if (this.pressure >= B.NUKE_MIN_PRESSURE) {
      this.nukeT -= dt;
      if (this.nukeT <= 0) {
        this.nukeT = rand(...B.NUKE_INTERVAL);
        const x = clamp(this.squad.x + rand(-70, 70), B.LANE_MIN_X, B.LANE_MAX_X);
        this.missiles.spawn(x, -this.dist - rand(80, 240), 'nuke');
      }
    }
    this.missiles.update(dt);
  }

  /**
   * GIGA HORDE : nuée massive escortant le boss final (niveaux ≥ GIGA_FROM_LEVEL),
   * déclenchée UNIQUEMENT sous riposte adaptative — c'est la réponse du monde à la
   * masse critique, jamais un mur pour les petites escouades. Placement déterministe
   * (pas de Math.random : seule la pression — état de jeu — module la taille),
   * counts bornés (invariant : le pool sature, les PV portent l'escalade).
   */
  private spawnGigaHorde(at: number): void {
    const hpMul = (this.level?.hpMul ?? 1) * this.pressureHpMul;
    const count = Math.min(
      B.GIGA_COUNT_CAP,
      Math.round(B.GIGA_BASE_COUNT * (1 + 0.6 * this.pressure)),
    );
    const brutes = Math.min(B.GIGA_BRUTE_CAP, Math.round(count * 0.06));
    const runners = Math.round(count * 0.22);
    const grunts = count - brutes - runners;
    const lane = B.LANE_MAX_X - B.LANE_MIN_X;
    // masse étagée ENTRE le boss et l'escouade : elle fait écran (l'aim-assist
    // tire au plus proche) — il faut mâcher la muraille pendant que le boss
    // canonne derrière, au lieu de sniper le boss avant l'arrivée de la nuée
    for (let i = 0; i < grunts; i++) {
      const row = Math.floor(i / 14);
      const x = B.LANE_MIN_X + (((i % 14) + 0.5 + (row % 2) * 0.5) / 15) * lane;
      this.enemies.spawn(0, x, -at + 500 - row * 34, hpMul);
    }
    for (let i = 0; i < runners; i++) {
      const x = B.LANE_CENTER + Math.sin(i * 1.7) * (lane / 2 - 30);
      this.enemies.spawn(1, x, -at + 420 - i * 26, hpMul);
    }
    for (let i = 0; i < brutes; i++) {
      const x = B.LANE_CENTER + Math.sin(i * 2.4) * 150;
      this.enemies.spawn(2, x, -at + 300 - i * 110, hpMul);
    }
    // annonce : on voit et on entend arriver la muraille
    this.gigaBanner?.destroy({ children: true });
    const banner = new Container();
    const label = new Text({
      text: '☠ GIGA HORDE ☠',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 30,
        fontWeight: '900',
        fill: 0xffffff,
        stroke: { color: 0x7f1d1d, width: 6 },
      },
    });
    label.anchor.set(0.5);
    banner.addChild(label);
    banner.position.set(B.LANE_CENTER, -at + 300);
    this.layers.labels.addChild(banner);
    this.gigaBanner = banner;
    this.fx.shake(10);
    this.sfx.missileWarn();
  }

  /**
   * Pilote du boss ultra (niveau boss) : épinglé hors de portée, il attaque à
   * distance — frappes de missiles appelées sur le joueur (rouge/orange en
   * alternance) et invocations d'ennemis qui détournent l'aim-assist : percer
   * le boss ou nettoyer les adds, il faut choisir. Ses lances frappent plus
   * fort tant qu'il est en vie (ultraLanceMul).
   */
  private updateUltra(dt: number): void {
    this.ultraLanceMul = 1;
    for (const boss of this.bosses.list) {
      if (!boss.ultra || !boss.alive) continue;
      this.ultraLanceMul = B.ULTRA_DMG_MUL;
      this.ultraStrikeT -= dt;
      if (this.ultraStrikeT <= 0) {
        this.ultraStrikeT = rand(...B.ULTRA_STRIKE_INTERVAL);
        this.ultraStrikeAlt = !this.ultraStrikeAlt;
        const x = clamp(this.squad.x + rand(-80, 80), B.LANE_MIN_X, B.LANE_MAX_X);
        this.missiles.spawn(x, -this.dist - rand(60, 220), this.ultraStrikeAlt ? 'red' : 'orange');
      }
      this.ultraSummonT -= dt;
      if (this.ultraSummonT <= 0) {
        this.ultraSummonT = rand(...B.ULTRA_SUMMON_INTERVAL);
        const hpMul = (this.level?.hpMul ?? 1) * this.pressureHpMul;
        for (let i = 0; i < B.ULTRA_SUMMON_GRUNTS; i++) {
          const x = clamp(
            boss.x + (i - (B.ULTRA_SUMMON_GRUNTS - 1) / 2) * 36,
            B.LANE_MIN_X,
            B.LANE_MAX_X,
          );
          this.enemies.spawn(0, x, boss.y + 40 + (i % 3) * 30, hpMul);
        }
        for (let i = 0; i < B.ULTRA_SUMMON_RUNNERS; i++) {
          const x = clamp(boss.x + Math.sin(i * 2.1) * 160, B.LANE_MIN_X, B.LANE_MAX_X);
          this.enemies.spawn(1, x, boss.y + 70 + i * 40, hpMul);
        }
        this.fx.burst(boss.x, boss.y + 40, { count: 18, color: 0xd8b4fe, speed: 240, life: 0.45 });
        this.sfx.bossContact();
      }
      break; // un seul ultra à la fois par construction
    }
  }

  /** Tirage pondéré du calibre des frappes ordinaires (l'atomique est à part). */
  private pickMissileKind(): B.MissileKind {
    let r = Math.random();
    for (const [kind, w] of B.MISSILE_KIND_WEIGHTS) {
      r -= w;
      if (r <= 0) return kind;
    }
    return 'orange';
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
      bossKills: this.bossKillsRun,
      bonusCrates: this.bonusCratesRun,
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
    this.gigaBanner?.destroy({ children: true });
    this.gigaBanner = null;
    this.spikes.reset();
    this.bullets.clear();
    this.enemies.clear();
    this.gates.reset();
    this.crates.reset();
    this.bosses.reset();
    this.bolts.clear();
    this.missiles.reset();
    this.mines.reset();
    this.fx.clear();
    this.squad.setShielded(false);
    this.squad.setBadge('');
    this.droneSprite.visible = false;
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
