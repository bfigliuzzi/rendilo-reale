import { Sprite } from 'pixi.js';
import { clamp, lerp } from '@shared/math';
import { mulberry32 } from '@shared/rng';
import { SpatialGrid } from '@shared/spatialGrid';
import type { Sfx } from '../audio/sfx';
import * as B from '../config/balance';
import type { Fx } from '../render/fx';
import type { Layers } from '../render/layers';
import { bakeMap } from '../render/mapBake';
import { MARKER_RING_MARGIN, PALETTE, type Atlas } from '../render/textures';
import type { Steer } from '../input/steer';
import { Boss, type Pull } from './boss';
import { Bullets } from './bullets';
import { resetLoadout } from './loadout';
import { Crib } from './crib';
import { Economy } from './economy';
import { EnemyPool } from './enemies';
import { Hero } from './hero';
import type { Level } from './level';
import { Peas } from './peas';
import { Pickups } from './pickups';
import { Puddles } from './puddles';
import { Spawner, type SpawnSink } from './spawner';
import { assertLevelSane } from '../config/levels';

export type Phase = 'day' | 'night';

/**
 * Ce qu'il faut sauvegarder au lancement d'une nuit pour pouvoir la REJOUER après
 * une défaite. Struct plat, recopié par valeur : le panneau de défaite propose
 * « Rejouer la nuit », et perdre huit minutes de construction sur une erreur de
 * placement serait la punition la plus décourageante possible dans un jeu sans
 * méta-progression, où recommencer n'apporte rien.
 */
export interface NightCheckpoint {
  cribHp: number;
  cribMaxHp: number;
  /** Rembobiné aussi : sans ça, rejouer une nuit gonflerait le temps du record. */
  nightSecTotal: number;
}

/** Instantané pour le HUD et le bot de vérification. */
export interface Stats {
  phase: Phase;
  /** 1-based. */
  night: number;
  nights: number;
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
  gold: number;
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
  /**
   * Secondes depuis le début de LA NUIT en cours — plus depuis le début du niveau.
   * C'est ce qui pilote le spawner, et c'est le seul changement de sémantique
   * qu'a demandé la boucle jour/nuit.
   */
  t = 0;
  /**
   * Cumul des secondes de nuit du niveau : c'est LUI le temps du record. Le jour
   * n'est pas chronométré — le chronométrer récompenserait le joueur qui n'ouvre
   * jamais le panneau d'achat.
   */
  nightSecTotal = 0;

  /** Jour : aucun ennemi, on se déplace et on construit. Nuit : on défend. */
  phase: Phase = 'day';
  /** Index 0-based de la nuit en cours (ou de la prochaine, pendant le jour). */
  nightIndex = 0;
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
  /** La bourse du niveau. Remise à zéro par `loadLevel` seul — jamais par une nuit. */
  readonly economy = new Economy();

  readonly run: RunStats = { kills: 0, picked: 0, pins: 0, maxGrip: 0 };

  /** La nuit est tenue : plus rien n'arrive, l'arène est vide, le boss est tombé. */
  onNightCleared: ((nightIndex: number, nightSec: number) => void) | null = null;
  /** Le berceau est tombé. Flow seul décide de ce qu'est une victoire de niveau. */
  onCribFallen: ((nightIndex: number, nightSecTotal: number) => void) | null = null;

  camX = 0;
  camY = 0;
  private prevCamX = 0;
  private prevCamY = 0;

  /** Le niveau en cours sous sa forme runtime. `null` hors partie. */
  level: Level | null = null;

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

  /** Textures de sol cuites, une par carte : le ↻ ne repaie jamais le bake. */
  private readonly grounds = new Map<string, import('pixi.js').Texture>();

  constructor(
    private readonly layers: Layers,
    private readonly atlas: Atlas,
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

    // origine négative : voir GRID_MARGIN_CELLS — les amorces de voies posent des
    // ennemis hors arène, et un insert hors bornes est ignoré EN SILENCE
    this.grid.setOrigin(-B.GRID_MARGIN_CELLS * B.GRID_CELL, -B.GRID_MARGIN_CELLS * B.GRID_CELL);
    this.rangeRing = new Sprite({ texture: atlas.rangeRing, anchor: { x: 0.5, y: 0.5 }, alpha: 0.16 });
    // facteur par PIXEL de portée : la portée est désormais une stat du bébé
    // (améliorable en cours de niveau), l'échelle se recalcule donc par frame —
    // figée au constructeur, l'anneau afficherait un mensonge après un achat
    this.rangeScale = (2 * MARKER_RING_MARGIN) / atlas.rangeRing.width;
    layers.ranges.addChild(this.rangeRing);
  }

  // ------------------------------------------------------------------ cycle

  /**
   * Charge un niveau et le remet ENTIÈREMENT à zéro : phase, nuits, berceau,
   * améliorations, et — dès qu'ils existeront — or et bâtiments.
   *
   * INVARIANT, et le refactor tentant le casse en silence : `startNight` et
   * `endNight` ne touchent JAMAIS à ce qui se cumule sur un niveau. Seul
   * `loadLevel` le remet à zéro. C'est par cette asymétrie — et pas par un flag —
   * que les bâtiments persisteront d'une nuit à l'autre et disparaîtront d'un
   * niveau à l'autre.
   */
  loadLevel(level: Level): void {
    this.level = level;
    const def = level.def;
    if (import.meta.env.DEV) assertLevelSane(def);
    this.t = 0;
    this.nightSecTotal = 0;
    this.phase = 'day';
    this.nightIndex = 0;
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
    let ground = this.grounds.get(level.def.map.id);
    if (!ground) {
      ground = bakeMap(level.terrain, this.atlas);
      this.grounds.set(level.def.map.id, ground);
    }
    this.layers.ground.texture = ground;

    this.crib.reset(def.cribHp, level.cribX, level.cribY);
    this.economy.reset(def.startGold);
    resetLoadout(this.hero.loadout);
    this.hero.reset(level.cribX, level.cribY + 90);
    this.spawner.unload();
    this.camX = this.prevCamX = clamp(this.hero.x, B.DESIGN_W / 2, level.w - B.DESIGN_W / 2);
    this.camY = this.prevCamY = clamp(this.hero.y, B.DESIGN_H / 2, level.h - B.DESIGN_H / 2);
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
    if (!this.playing || !this.level) return;
    const level = this.level;
    // Le tick est STRICTEMENT IDENTIQUE de jour et de nuit — contacts, engluement,
    // tir auto, collisions, ramassages, caméra. Trois seules différences : le
    // spawner n'est alimenté qu'en nuit, la construction n'est ouverte qu'au jour,
    // et la condition « nuit tenue » ne se teste qu'en nuit. C'est cette identité
    // qui laisse le scénario `grip` du bot fonctionner sans une ligne de changement.
    if (this.phase === 'night') {
      this.t += dt;
      this.nightSecTotal += dt;
      this.spawner.update(this.t, this.sink);
    }

    this.enemies.update(dt, this.hero.x, this.hero.y, this.crib.x, this.crib.y, level.terrain, this.onEnemyShoot);
    this.boss.update(dt, this.hero.x, this.hero.y, this.crib.x, this.crib.y, level.terrain, this.onDust);

    // --- engluement : la mécanique centrale
    this.resolveContacts();
    this.boss.suck(this.hero.x, this.hero.y, this.pull);
    const gripLoad = this.gripLoadTotal() + this.puddles.gripAt(this.hero.x, this.hero.y) + this.pull.grip;
    this.hero.update(
      dt, this.steer.dirX, this.steer.dirY, gripLoad,
      this.pull.x, this.pull.y, level.w, level.h, level.terrain,
    );
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

    this.updateCamera(dt, level);
    this.checkEnd();
  }

  render(alpha: number): void {
    // en premier : c'est lui qui calcule le jitter de shake de CETTE frame
    this.fx.syncRender(alpha);
    const cx = lerp(this.prevCamX, this.camX, alpha) + this.fx.shakeX.value;
    const cy = lerp(this.prevCamY, this.camY, alpha) + this.fx.shakeY.value;
    // la caméra déplace le CONTENEUR, jamais les entités — et sa position est
    // ARRONDIE au pixel logique entier. Ce n'est pas un confort : sous une texture
    // de sol pixel échantillonnée au plus proche voisin, un décalage fractionnaire
    // duplique des lignes et des colonnes entières, qui rampent sur tout l'écran
    // au moindre panoramique. L'arrondi stabilise aussi tous les sprites au passage.
    this.layers.world.position.set(
      Math.round(-cx + B.DESIGN_W / 2),
      Math.round(-cy + B.DESIGN_H / 2),
    );

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
      phase: this.phase,
      night: this.nightIndex + 1,
      nights: this.level?.def.nights.length ?? 0,
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
      gold: this.economy.gold,
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
    // l'or tombe DIRECTEMENT au compteur : pas de pièce à ramasser. Une pièce
    // perdue hors champ serait une punition invisible, et le détour est déjà porté
    // par les ramassables (biberon, doudou, tétine) dont c'est tout le rôle.
    this.economy.credit(def.gold);
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
    spawnWave: (kind, count, laneId, spread) => {
      const lv = this.level;
      if (!lv) return;
      const t = lv.terrain;
      const lane = t.laneIndex(laneId);
      const start = t.laneStart[lane];
      const half = t.laneHalf[lane];
      const sp = Math.min(spread, B.LANE_SPREAD_MAX);
      for (let k = 0; k < count; k++) {
        // front régulier en travers de la voie : une vague se lit comme un mur qui
        // descend le chemin, pas comme un nuage — le joueur doit pouvoir décider
        // d'un flanc. C'est l'ancien éventail d'angles, transposé à la largeur.
        const off = count === 1 ? 0 : (k / (count - 1) - 0.5) * 2 * sp;
        // étagement longitudinal : les rangs arrière n'entrent pas tous ensemble
        const back = (k % 3) * B.SPAWN_STAGGER;
        const x = t.nodeX[start] - t.segX[start] * back + t.perpX[start] * off * half;
        const y = t.nodeY[start] - t.segY[start] * back + t.perpY[start] * off * half;
        this.enemies.spawn(kind, x, y, lv.def.hpMul, k / Math.max(1, count), lane, start + 1, off);
      }
      this.sfx.wave();
    },
    spawnPickup: (kind, x, y) => this.pickups.spawn(kind, x, y),
    spawnBoss: (laneId) => {
      const lv = this.level;
      if (!lv) return;
      const t = lv.terrain;
      const lane = t.laneIndex(laneId);
      // il remonte SA voie, mais entre au premier nœud situé à `SPAWN_RING` du
      // berceau : hors champ (la demi-diagonale de l'écran vaut ≈ 551) et à la
      // distance sur laquelle son budget de PV est calé. Le faire partir du bout de
      // la voie lui donnait quarante secondes d'approche contre vingt.
      const n = t.nodeWithin(lane, lv.cribX, lv.cribY, B.SPAWN_RING);
      this.boss.spawn(t.nodeX[n], t.nodeY[n], B.BOSS_HP, lv.cribX, lv.cribY, lane, Math.min(n + 1, t.laneStart[lane] + t.laneCount[lane] - 1));
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
    this.economy.credit(B.BOSS_GOLD);
    this.fx.burst(this.boss.x, this.boss.y, { count: 60, color: PALETTE.bossBody, speed: 260, life: 0.8, size: 1.6 });
    this.fx.shake(16);
    this.sfx.bossDie();
  }

  // ----------------------------------------------------------------- caméra

  private updateCamera(dt: number, level: Level): void {
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
    this.camX = clamp(this.camX + (tx - this.camX) * k, B.DESIGN_W / 2, level.w - B.DESIGN_W / 2);
    this.camY = clamp(this.camY + (ty - this.camY) * k, B.DESIGN_H / 2, level.h - B.DESIGN_H / 2);
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
    this.rangeRing.scale.set(this.hero.range * this.rangeScale);
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
      this.onCribFallen?.(this.nightIndex, this.nightSecTotal);
      return;
    }
    if (this.phase !== 'night') return;
    // nuit tenue : le boss est tombé, plus rien n'arrivera, et l'arène est vide.
    // Les trois conditions ensemble — une arène momentanément vide entre deux
    // vagues ne doit jamais terminer la nuit.
    if (this.spawner.cleared && !this.boss.active && this.enemies.count === 0) {
      const sec = this.t;
      this.endNight();
      this.onNightCleared?.(this.nightIndex, sec);
    }
  }

  // ------------------------------------------------------------- jour / nuit

  /** Instantané de l'état de niveau, pris au lancement de chaque nuit. */
  checkpoint(): NightCheckpoint {
    return { cribHp: this.crib.hp, cribMaxHp: this.crib.maxHp, nightSecTotal: this.nightSecTotal };
  }

  /** Restaure un instantané : c'est le bouton « Rejouer la nuit ». */
  restore(cp: NightCheckpoint): void {
    this.crib.maxHp = cp.cribMaxHp;
    this.crib.hp = cp.cribHp;
    this.nightSecTotal = cp.nightSecTotal;
  }

  startNight(index: number): void {
    const level = this.level;
    if (!level) return;
    this.nightIndex = index;
    this.phase = 'night';
    this.t = 0;
    this.spawner.load(level.def.nights[index]);
    this.economy.beginNight();
    this.playing = true;
  }

  /** Rend la main au jour : on VIDE le champ de bataille, pas le niveau. */
  endNight(): void {
    this.phase = 'day';
    this.t = 0;
    this.spawner.unload();
    this.enemies.clear();
    this.bullets.clear();
    this.peas.clear();
    this.puddles.clear();
    this.boss.retire();
    this.hero.grip = 0;
  }

  // ------------------------------------------------------- hooks de test

  /** Spawn scripté, pour `tools/verify-crib.mjs`. Jamais appelé par le jeu. */
  postSpawn(kind: number, x: number, y: number): void {
    this.enemies.spawn(kind, x, y, 1, 0);
  }

  /**
   * Mode `?stress` : mesure du budget de rendu, hors de toute condition de fin.
   *
   * Les ennemis sont distribués LE LONG DES VOIES et non plus sur un anneau : sur un
   * anneau, la plupart tomberaient désormais dans un massif et vibreraient contre
   * l'éjection, ce qui mesurerait n'importe quoi. Au passage, on mesure aussi le
   * coût réel du suivi de voie, qui est précisément ce qu'on veut savoir.
   */
  startStress(): void {
    const lv = this.level;
    if (!lv) return;
    const t = lv.terrain;
    const lanes = t.laneCount.length;
    for (let k = 0; k < B.STRESS_COUNT; k++) {
      const lane = k % lanes;
      const start = t.laneStart[lane];
      const n = t.laneCount[lane];
      const node = start + 1 + ((k / lanes) | 0) % Math.max(1, n - 2);
      const off = (((k * 7) % 11) / 11 - 0.5) * 2 * B.LANE_SPREAD_MAX;
      const half = t.laneHalf[lane];
      this.enemies.spawn(
        k % 3,
        t.nodeX[node] + t.perpX[node] * off * half,
        t.nodeY[node] + t.perpY[node] * off * half,
        40,
        k / B.STRESS_COUNT,
        lane,
        node,
        off,
      );
    }
  }
}
