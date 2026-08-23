import { Sprite } from 'pixi.js';
import { clamp, lerp } from '@shared/math';
import { mulberry32 } from '@shared/rng';
import { SpatialGrid } from '@shared/spatialGrid';
import type { Sfx } from '../audio/sfx';
import * as B from '../config/balance';
import type { LevelDef } from '../config/levels';
import type { Fx } from '../render/fx';
import type { Layers } from '../render/layers';
import { MARKER_RING_MARGIN, PALETTE, type Atlas } from '../render/textures';
import type { Steer } from '../input/steer';
import { Boss, type Pull } from './boss';
import { Bullets } from './bullets';
import { Crib } from './crib';
import { EnemyPool } from './enemies';
import { Hero } from './hero';
import { Peas } from './peas';
import { Pickups } from './pickups';
import { Puddles } from './puddles';
import { Spawner, type SpawnSink } from './spawner';

/** Instantané pour le HUD et le bot de vérification. */
export interface Stats {
  time: number;
  cribHp: number;
  cribMax: number;
  grip: number;
  pinned: boolean;
  enemies: number;
  bossHp: number;
  bossMax: number;
  bottleT: number;
  immuneT: number;
  cleared: boolean;
}

/** Cumuls d'une partie, lus par l'écran de résultat. */
export interface RunStats {
  kills: number;
  picked: number;
  pins: number;
  maxGrip: number;
}

/**
 * La simulation. Elle ne connaît ni les modes, ni la sauvegarde, ni les écrans :
 * elle remonte `onGameOver` et Flow traduit.
 *
 * Ordre du tick, et il compte :
 *   spawner → ennemis → boss → CONTACTS (grip) → bébé → tirs → collisions →
 *   ramassages → balayage des morts → caméra → conditions de fin.
 *
 * Les contacts sont résolus AVANT `hero.update` : la charge de grip du tick est
 * calculée sur les positions courantes des ennemis et la position du bébé au tick
 * précédent. Un décalage d'une frame, invisible à 60 Hz, contre un ordre bien plus
 * simple à raisonner.
 */
export class World {
  playing = false;
  /** Temps de jeu écoulé, en secondes. Pilote le spawner. */
  t = 0;
  /** Horloge de rendu, pour les animations décoratives. */
  clock = 0;

  readonly hero: Hero;
  readonly crib: Crib;
  readonly enemies: EnemyPool;
  readonly bullets: Bullets;
  readonly peas: Peas;
  readonly pickups: Pickups;
  readonly puddles: Puddles;
  readonly boss: Boss;
  readonly spawner = new Spawner();

  readonly run: RunStats = { kills: 0, picked: 0, pins: 0, maxGrip: 0 };

  onGameOver: ((victory: boolean, timeSec: number) => void) | null = null;

  camX = B.CRIB_X;
  camY = B.CRIB_Y;
  private prevCamX = B.CRIB_X;
  private prevCamY = B.CRIB_Y;

  private def: LevelDef | null = null;
  private rand: () => number = mulberry32(1);
  private readonly grid = new SpatialGrid(B.GRID_COLS, B.GRID_ROWS, B.GRID_CELL, B.GRID_MAX_PER_CELL);
  private readonly pull: Pull = { x: 0, y: 0, grip: 0 };
  private readonly rangeRing: Sprite;
  private readonly rangeScale: number;
  private wasPinned = false;

  /**
   * Contacts retenus pour le grip : les `GRIP_CONTACT_CAP` PLUS PROCHES. Ce choix
   * n'est pas cosmétique — l'aim-assist tire aussi au plus proche, donc les ennemis
   * comptés sont exactement ceux que le bébé est en train d'abattre. C'est ce qui
   * rend vrai le garde-fou « tuer les trois plus proches suffit toujours ».
   */
  private readonly clingD2 = new Float32Array(B.GRIP_CONTACT_CAP);
  private readonly clingLoad = new Float32Array(B.GRIP_CONTACT_CAP);
  private readonly clingX = new Float32Array(B.GRIP_CONTACT_CAP);
  private readonly clingY = new Float32Array(B.GRIP_CONTACT_CAP);
  private clingCount = 0;

  constructor(
    private readonly layers: Layers,
    atlas: Atlas,
    private readonly steer: Steer,
    private readonly fx: Fx,
    private readonly sfx: Sfx,
  ) {
    this.hero = new Hero(atlas, layers.hero);
    this.crib = new Crib(atlas, layers.crib);
    this.enemies = new EnemyPool(B.MAX_ENEMIES, layers.enemies, layers.shadows, atlas);
    this.bullets = new Bullets(B.MAX_BULLETS, layers.bullets, atlas);
    this.peas = new Peas(B.MAX_PEAS, layers.peas, atlas);
    this.pickups = new Pickups(layers.pickups, atlas);
    this.puddles = new Puddles(atlas, layers.puddles);
    this.boss = new Boss(atlas, layers.boss);

    this.grid.setOrigin(0, 0);
    this.rangeRing = new Sprite({ texture: atlas.rangeRing, anchor: { x: 0.5, y: 0.5 }, alpha: 0.16 });
    this.rangeScale = (B.HERO_RANGE * 2 * MARKER_RING_MARGIN) / atlas.rangeRing.width;
    this.rangeRing.scale.set(this.rangeScale);
    layers.ranges.addChild(this.rangeRing);
  }

  // ------------------------------------------------------------------ cycle

  loadLevel(def: LevelDef): void {
    this.def = def;
    this.t = 0;
    // seed dérivé de celui du niveau : les drops sont reproductibles au même seed,
    // et indépendants des angles de spawn (rejouer un tirage rejoue tout à
    // l'identique, mais changer une vague ne rebat pas les drops)
    this.rand = mulberry32(def.seed ^ 0x5bf03d1b);
    this.enemies.clear();
    this.bullets.clear();
    this.peas.clear();
    this.pickups.clear();
    this.puddles.clear();
    this.fx.clear();
    this.boss.retire();
    this.crib.reset(def.cribHp);
    this.hero.reset(B.CRIB_X, B.CRIB_Y + 90);
    this.spawner.load(def);
    this.camX = this.prevCamX = clamp(this.hero.x, B.DESIGN_W / 2, def.arenaW - B.DESIGN_W / 2);
    this.camY = this.prevCamY = clamp(this.hero.y, B.DESIGN_H / 2, def.arenaH - B.DESIGN_H / 2);
    this.run.kills = 0;
    this.run.picked = 0;
    this.run.pins = 0;
    this.run.maxGrip = 0;
    this.wasPinned = false;
    this.clingCount = 0;
    this.playing = true;
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.playing || !this.def) return;
    const def = this.def;
    this.t += dt;

    this.spawner.update(this.t, this.sink);

    this.enemies.update(dt, this.hero.x, this.hero.y, this.crib.x, this.crib.y, this.onEnemyShoot);
    this.boss.update(dt, this.hero.x, this.hero.y, this.crib.x, this.crib.y, this.onDust);

    // --- engluement : la mécanique centrale
    this.resolveContacts();
    this.boss.suck(this.hero.x, this.hero.y, this.pull);
    const gripLoad = this.gripLoadTotal() + this.puddles.gripAt(this.hero.x, this.hero.y) + this.pull.grip;
    this.hero.update(dt, this.steer.dirX, this.steer.dirY, gripLoad, this.pull.x, this.pull.y, def.arenaW, def.arenaH);
    this.run.maxGrip = Math.max(this.run.maxGrip, this.hero.grip);
    if (this.hero.pinned && !this.wasPinned) {
      this.run.pins++;
      this.sfx.pinned();
    }
    this.wasPinned = this.hero.pinned;

    this.biteCrib(dt);

    // --- tir : ne consulte JAMAIS le grip (premier garde-fou)
    if (this.bullets.autoFire(dt, this.hero, this.enemies, this.boss) > 0) this.sfx.throwToy();
    this.bullets.update(dt);
    this.peas.update(dt);
    this.buildGrid();
    this.collideBullets();
    this.collidePeas();

    this.pickups.update(dt);
    this.pickups.collect(this.hero.x, this.hero.y, this.onPick);
    this.puddles.update(dt);
    this.crib.update(dt);
    this.fx.update(dt);

    this.enemies.sweepDead(this.onEnemyDeath);

    this.updateCamera(dt, def);
    this.checkEnd();
  }

  render(alpha: number): void {
    // en premier : c'est lui qui calcule le jitter de shake de CETTE frame
    this.fx.syncRender(alpha);
    const cx = lerp(this.prevCamX, this.camX, alpha) + this.fx.shakeX.value;
    const cy = lerp(this.prevCamY, this.camY, alpha) + this.fx.shakeY.value;
    // la caméra déplace le CONTENEUR, jamais les entités
    this.layers.world.position.set(-cx + B.DESIGN_W / 2, -cy + B.DESIGN_H / 2);
    this.layers.ground.tilePosition.set(-cx, -cy);

    this.hero.renderSync(alpha, this.clock);
    this.enemies.syncRender(alpha);
    this.bullets.syncRender(alpha, this.clock);
    this.peas.syncRender(alpha);
    this.pickups.renderSync(this.clock);
    this.puddles.renderSync(this.clock);
    this.crib.renderSync(this.clock);
    this.boss.renderSync(alpha, this.clock);
    this.boss.drawCone(this.layers.cone, this.clock);
    this.drawMarks(alpha);
  }

  stats(): Stats {
    return {
      time: this.t,
      cribHp: this.crib.hp,
      cribMax: this.crib.maxHp,
      grip: this.hero.grip,
      pinned: this.hero.pinned,
      enemies: this.enemies.count,
      bossHp: this.boss.active ? this.boss.hp : 0,
      bossMax: this.boss.maxHp,
      bottleT: this.hero.bottleT,
      immuneT: this.hero.immuneT,
      cleared: this.spawner.cleared,
    };
  }

  // ------------------------------------------------------------ engluement

  /** Retient les `GRIP_CONTACT_CAP` contacts les plus proches, par tri par insertion. */
  private resolveContacts(): void {
    this.clingCount = 0;
    for (let i = 0; i < this.enemies.count; i++) {
      if (this.enemies.hp[i] <= 0) continue;
      const def = B.ENEMY_KINDS[this.enemies.kind[i]];
      if (def.gripMul <= 0) continue;
      const dx = this.enemies.x[i] - this.hero.x;
      const dy = this.enemies.y[i] - this.hero.y;
      const d2 = dx * dx + dy * dy;
      const r = this.enemies.radius[i] + B.HERO_RADIUS;
      if (d2 > r * r) continue;
      this.insertCling(d2, def.gripMul, this.enemies.x[i], this.enemies.y[i]);
    }
    this.hero.clung = this.clingCount;
  }

  private insertCling(d2: number, load: number, x: number, y: number): void {
    // trouve la position d'insertion (tableau trié par distance croissante)
    let at = this.clingCount;
    while (at > 0 && this.clingD2[at - 1] > d2) at--;
    if (at >= B.GRIP_CONTACT_CAP) return; // plus loin que les trois déjà retenus
    // décale vers la droite, en jetant le plus lointain si le tableau est plein
    for (let k = Math.min(this.clingCount, B.GRIP_CONTACT_CAP - 1); k > at; k--) {
      this.clingD2[k] = this.clingD2[k - 1];
      this.clingLoad[k] = this.clingLoad[k - 1];
      this.clingX[k] = this.clingX[k - 1];
      this.clingY[k] = this.clingY[k - 1];
    }
    this.clingD2[at] = d2;
    this.clingLoad[at] = load;
    this.clingX[at] = x;
    this.clingY[at] = y;
    if (this.clingCount < B.GRIP_CONTACT_CAP) this.clingCount++;
  }

  private gripLoadTotal(): number {
    let total = 0;
    for (let i = 0; i < this.clingCount; i++) total += this.clingLoad[i];
    return total;
  }

  // ------------------------------------------------------------- collisions

  private buildGrid(): void {
    this.grid.clear();
    for (let i = 0; i < this.enemies.count; i++) {
      if (this.enemies.hp[i] <= 0) continue;
      this.grid.insert(i, this.enemies.x[i], this.enemies.y[i]);
    }
  }

  private collideBullets(): void {
    const cols = this.grid.cols;
    const rows = this.grid.rows;
    const per = this.grid.maxPerCell;
    for (let b = this.bullets.count - 1; b >= 0; b--) {
      const bx = this.bullets.x[b];
      const by = this.bullets.y[b];
      let hit = false;
      const cx = this.grid.cellX(bx);
      const cy = this.grid.cellY(by);
      for (let gy = cy - 1; gy <= cy + 1 && !hit; gy++) {
        if (gy < 0 || gy >= rows) continue;
        for (let gx = cx - 1; gx <= cx + 1 && !hit; gx++) {
          if (gx < 0 || gx >= cols) continue;
          const cell = gy * cols + gx;
          const n = this.grid.counts[cell];
          const base = cell * per;
          for (let k = 0; k < n; k++) {
            const e = this.grid.items[base + k];
            if (this.enemies.hp[e] <= 0) continue;
            const dx = this.enemies.x[e] - bx;
            const dy = this.enemies.y[e] - by;
            const r = this.enemies.radius[e] + B.BULLET_RADIUS;
            if (dx * dx + dy * dy > r * r) continue;
            this.enemies.hp[e] -= this.bullets.dmg[b];
            this.fx.burst(bx, by, { count: 3, color: PALETTE.toy, speed: 90, life: 0.2, size: 0.7 });
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        this.bullets.kill(b);
        continue;
      }
      // gobage : un cube qui entre dans le cône est avalé. C'est LA raison de
      // contourner le boss — il n'est pas invulnérable, il est invulnérable DE FACE.
      if (this.boss.inCone(bx, by)) {
        this.fx.burst(bx, by, { count: 2, color: PALETTE.bossGlass, speed: 60, life: 0.18, size: 0.6 });
        this.bullets.kill(b);
        continue;
      }
      if (this.boss.active) {
        const dx = this.boss.x - bx;
        const dy = this.boss.y - by;
        const r = this.boss.radius + B.BULLET_RADIUS;
        if (dx * dx + dy * dy <= r * r) {
          const wasRage = this.boss.rage;
          this.boss.damage(this.bullets.dmg[b]);
          this.fx.burst(bx, by, { count: 4, color: PALETTE.bossTrim, speed: 110, life: 0.22, size: 0.8 });
          this.sfx.bossHit();
          this.bullets.kill(b);
          if (!this.boss.active) this.onBossDown();
          else if (this.boss.rage && !wasRage) this.sfx.bossRage();
        }
      }
    }
  }

  private collidePeas(): void {
    for (let p = this.peas.count - 1; p >= 0; p--) {
      const px = this.peas.x[p];
      const py = this.peas.y[p];
      // un pois n'a pas de camp : il englue le bébé ET abîme le berceau
      const hdx = px - this.hero.x;
      const hdy = py - this.hero.y;
      const hr = B.HERO_RADIUS + B.PEA_RADIUS;
      if (hdx * hdx + hdy * hdy <= hr * hr) {
        this.hero.addGrip(B.PEA_GRIP);
        this.fx.burst(px, py, { count: 5, color: PALETTE.pea, speed: 100, life: 0.25, size: 0.8 });
        this.sfx.peaHit();
        this.peas.kill(p);
        continue;
      }
      const cdx = px - this.crib.x;
      const cdy = py - this.crib.y;
      const cr = B.CRIB_RADIUS + B.PEA_RADIUS;
      if (cdx * cdx + cdy * cdy <= cr * cr) {
        this.crib.damage(B.PEA_CRIB_DMG);
        this.fx.burst(px, py, { count: 6, color: PALETTE.pea, speed: 110, life: 0.28, size: 0.9 });
        this.sfx.cribHit();
        this.peas.kill(p);
      }
    }
  }

  /** Grignotage du berceau : ennemis à `cribDps` non nul, plus le boss. */
  private biteCrib(dt: number): void {
    for (let i = 0; i < this.enemies.count; i++) {
      const def = B.ENEMY_KINDS[this.enemies.kind[i]];
      if (def.cribDps <= 0 || this.enemies.hp[i] <= 0) continue;
      const dx = this.enemies.x[i] - this.crib.x;
      const dy = this.enemies.y[i] - this.crib.y;
      const r = B.CRIB_BITE_RADIUS + this.enemies.radius[i];
      if (dx * dx + dy * dy > r * r) continue;
      this.crib.damage(def.cribDps * dt);
      this.sfx.cribHit();
    }
    if (this.boss.active) {
      const dx = this.boss.x - this.crib.x;
      const dy = this.boss.y - this.crib.y;
      const r = B.CRIB_BITE_RADIUS + this.boss.radius;
      if (dx * dx + dy * dy <= r * r) {
        this.crib.damage(B.BOSS_CRIB_DPS * dt);
        this.sfx.cribHit();
      }
    }
  }

  // -------------------------------------------------------------- callbacks

  private readonly onEnemyShoot = (x: number, y: number, tx: number, ty: number): void => {
    this.peas.fire(x, y, tx, ty);
    this.sfx.peaFire();
  };

  private readonly onDust = (x: number, y: number): void => {
    this.enemies.spawn(B.KIND_DUST, x, y, 1, this.rand());
  };

  private readonly onEnemyDeath = (x: number, y: number, kind: number): void => {
    const def = B.ENEMY_KINDS[kind];
    this.run.kills++;
    this.fx.burst(x, y, { count: 9, color: def.color, speed: 140, life: 0.34, size: 1 });
    this.sfx.enemyDie();
    if (def.puddle > 0) this.puddles.spawn(x, y);
    if (def.dropChance > 0 && this.rand() < def.dropChance) {
      this.pickups.spawn(this.pickWeightedDrop(), x, y);
    }
  };

  private readonly onPick = (kind: number, x: number, y: number): void => {
    this.run.picked++;
    const def = B.PICKUP_KINDS[kind];
    this.fx.burst(x, y, { count: 12, color: def.color, speed: 130, life: 0.4, size: 1.1 });
    this.sfx.pickup();
    if (kind === B.PICK_BOTTLE) this.hero.bottleT = B.BOTTLE_TIME;
    else if (kind === B.PICK_BLANKET) this.hero.immuneT = B.GRIP_IMMUNE_TIME;
    else this.crib.heal(B.PACIFIER_HEAL);
  };

  private readonly sink: SpawnSink = {
    spawnWave: (kind, count, angle, arc) => {
      for (let k = 0; k < count; k++) {
        // éventail régulier centré sur `angle` : une vague se lit comme un front,
        // pas comme un nuage — le joueur doit pouvoir décider d'un flanc
        const a = angle + (count === 1 ? 0 : (k / (count - 1) - 0.5) * arc);
        // léger étagement radial : les rangs arrière n'entrent pas tous ensemble
        const r = B.SPAWN_RING + (k % 3) * 26;
        this.enemies.spawn(
          kind,
          clamp(B.CRIB_X + Math.cos(a) * r, 16, B.ARENA_W - 16),
          clamp(B.CRIB_Y + Math.sin(a) * r, 16, B.ARENA_H - 16),
          this.def?.hpMul ?? 1,
          k / Math.max(1, count),
        );
      }
      this.sfx.wave();
    },
    spawnPickup: (kind, x, y) => this.pickups.spawn(kind, x, y),
    spawnBoss: () => {
      // il entre par le bord le plus ÉLOIGNÉ du bébé : on doit le voir venir et
      // avoir le temps de nettoyer, pas le découvrir collé au berceau
      const a = Math.atan2(this.crib.y - this.hero.y, this.crib.x - this.hero.x);
      this.boss.spawn(
        clamp(B.CRIB_X + Math.cos(a) * B.SPAWN_RING, 60, B.ARENA_W - 60),
        clamp(B.CRIB_Y + Math.sin(a) * B.SPAWN_RING, 60, B.ARENA_H - 60),
        B.BOSS_HP,
      );
      this.fx.shake(9);
      this.sfx.bossArrive();
    },
  };

  private pickWeightedDrop(): number {
    const roll = this.rand();
    let acc = 0;
    for (let i = 0; i < B.PICKUP_KINDS.length; i++) {
      acc += B.PICKUP_KINDS[i].weight;
      if (roll < acc) return i;
    }
    return B.PICKUP_KINDS.length - 1;
  }

  private onBossDown(): void {
    this.fx.burst(this.boss.x, this.boss.y, { count: 60, color: PALETTE.bossBody, speed: 260, life: 0.8, size: 1.6 });
    this.fx.shake(16);
    this.sfx.bossDie();
  }

  // ----------------------------------------------------------------- caméra

  private updateCamera(dt: number, def: LevelDef): void {
    this.prevCamX = this.camX;
    this.prevCamY = this.camY;
    // deadzone : la caméra ne bouge que si le bébé sort du rectangle central. Sans
    // elle, chaque micro-correction de trajectoire fait nager tout l'écran.
    let tx = this.camX;
    let ty = this.camY;
    if (this.hero.x > this.camX + B.CAM_DEADZONE_X) tx = this.hero.x - B.CAM_DEADZONE_X;
    else if (this.hero.x < this.camX - B.CAM_DEADZONE_X) tx = this.hero.x + B.CAM_DEADZONE_X;
    if (this.hero.y > this.camY + B.CAM_DEADZONE_Y) ty = this.hero.y - B.CAM_DEADZONE_Y;
    else if (this.hero.y < this.camY - B.CAM_DEADZONE_Y) ty = this.hero.y + B.CAM_DEADZONE_Y;
    const k = Math.min(1, dt * B.CAM_LERP);
    this.camX = clamp(this.camX + (tx - this.camX) * k, B.DESIGN_W / 2, def.arenaW - B.DESIGN_W / 2);
    this.camY = clamp(this.camY + (ty - this.camY) * k, B.DESIGN_H / 2, def.arenaH - B.DESIGN_H / 2);
  }

  // ------------------------------------------------------------------ rendu

  /**
   * Anneau de grip et filets de bave. Ces deux signaux ne sont PAS décoratifs :
   * avec le ralentissement de l'animation de rampe et la vignette de l'overlay, ils
   * forment les quatre codes redondants de l'engluement — jamais la couleur seule.
   */
  private drawMarks(alpha: number): void {
    const g = this.layers.marks;
    g.clear();
    const hx = lerp(this.hero.prevX, this.hero.x, alpha);
    const hy = lerp(this.hero.prevY, this.hero.y, alpha);

    this.rangeRing.position.set(hx, hy);
    this.rangeRing.alpha = 0.1 + (this.hero.bottleT > 0 ? 0.12 : 0);

    // filets de bave vers chaque source comptée dans le grip : on voit QUI colle
    for (let i = 0; i < this.clingCount; i++) {
      const wob = Math.sin(this.clock * 13 + i * 2) * 3;
      g.moveTo(hx, hy)
        .quadraticCurveTo((hx + this.clingX[i]) / 2 + wob, (hy + this.clingY[i]) / 2 - wob, this.clingX[i], this.clingY[i])
        .stroke({ color: PALETTE.blanketDark, width: 2.5, alpha: 0.55 });
    }

    if (this.hero.immuneT > 0) {
      // doudou : anneau plein qui pulse, sémantique inverse de la jauge de grip
      const pulse = 0.6 + 0.4 * Math.sin(this.clock * 6);
      g.circle(hx, hy, B.HERO_RADIUS + 9).stroke({ color: PALETTE.doudou, width: 3, alpha: 0.35 + 0.3 * pulse });
      return;
    }
    if (this.hero.grip <= 0.01) return;

    // jauge circulaire : elle se REMPLIT dans le sens horaire depuis midi. Le
    // remplissage est une forme, pas une couleur — lisible en niveaux de gris.
    const r = B.HERO_RADIUS + 9;
    const start = -Math.PI / 2;
    g.circle(hx, hy, r).stroke({ color: PALETTE.ink, width: 4, alpha: 0.4 });
    // `moveTo` obligatoire avant `arc` : sans lui, l'arc se relie au point courant du
    // chemin — resté à l'ORIGINE DU MONDE — et trace une balafre en travers de
    // l'écran depuis le coin de l'arène. Bug vu à la première capture.
    g.moveTo(hx + Math.cos(start) * r, hy + Math.sin(start) * r);
    g.arc(hx, hy, r, start, start + Math.PI * 2 * this.hero.grip).stroke({
      color: this.hero.pinned ? PALETTE.bossTrim : PALETTE.warn,
      width: 4,
      alpha: 0.95,
    });
    if (this.hero.pinned) {
      // cloué : l'anneau bat. Le seul clignotement du jeu, réservé à cet état.
      const beat = 0.5 + 0.5 * Math.sin(this.clock * 12);
      g.circle(hx, hy, r + 4 + beat * 3).stroke({ color: PALETTE.bossTrim, width: 2, alpha: 0.3 + 0.4 * beat });
    }
  }

  // ------------------------------------------------------------ fin de partie

  private checkEnd(): void {
    if (!this.playing) return;
    if (this.crib.fallen) {
      this.playing = false;
      this.onGameOver?.(false, this.t);
      return;
    }
    // victoire : le boss est tombé, plus rien n'arrivera, et l'arène est vide.
    // Les trois conditions ensemble — une arène momentanément vide entre deux
    // vagues ne doit jamais terminer la partie.
    if (this.spawner.cleared && !this.boss.active && this.enemies.count === 0) {
      this.playing = false;
      this.onGameOver?.(true, this.t);
    }
  }

  // ------------------------------------------------------- hooks de test

  /** Spawn scripté, pour `tools/verify-crib.mjs`. Jamais appelé par le jeu. */
  postSpawn(kind: number, x: number, y: number): void {
    this.enemies.spawn(kind, x, y, 1, 0);
  }

  /** Mode `?stress` : mesure du budget de rendu, hors de toute condition de fin. */
  startStress(): void {
    for (let k = 0; k < B.STRESS_COUNT; k++) {
      const a = (k / B.STRESS_COUNT) * Math.PI * 2;
      const r = 120 + (k % 7) * 60;
      this.enemies.spawn(k % 3, B.CRIB_X + Math.cos(a) * r, B.CRIB_Y + Math.sin(a) * r, 40, k / B.STRESS_COUNT);
    }
  }
}
