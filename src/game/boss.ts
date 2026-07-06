import { Container, Sprite, Text } from 'pixi.js';
import * as B from '../config/balance';
import { clamp, lerp, rand } from '../core/math';
import type { Atlas } from '../render/textures';
import type { Squad } from './squad';

const BAR_W = 110;
const AIM_LENGTH = 1100;

/**
 * Lances du boss : pool de projectiles en ligne droite. La trajectoire est
 * verrouillée au début du télégraphe (ligne de visée) — l'esquive est toujours
 * possible, jamais injuste.
 */
export class LancePool {
  count = 0;
  readonly x = new Float32Array(B.MAX_LANCES);
  readonly y = new Float32Array(B.MAX_LANCES);
  readonly prevX = new Float32Array(B.MAX_LANCES);
  readonly prevY = new Float32Array(B.MAX_LANCES);
  readonly vx = new Float32Array(B.MAX_LANCES);
  readonly vy = new Float32Array(B.MAX_LANCES);
  private readonly sprites: Sprite[] = [];

  constructor(parent: Container, atlas: Atlas) {
    for (let i = 0; i < B.MAX_LANCES; i++) {
      const s = new Sprite(atlas.lance);
      s.anchor.set(0.5);
      s.visible = false;
      this.sprites.push(s);
      parent.addChild(s);
    }
  }

  fire(x: number, y: number, angle: number): void {
    if (this.count >= B.MAX_LANCES) return;
    const i = this.count++;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.vx[i] = Math.cos(angle) * B.LANCE_SPEED;
    this.vy[i] = Math.sin(angle) * B.LANCE_SPEED;
    const s = this.sprites[i];
    s.visible = true;
    // la texture pointe vers le bas (+Y) : rotation relative à cette base
    s.rotation = angle - Math.PI / 2;
  }

  kill(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.prevX[i] = this.prevX[last];
      this.prevY[i] = this.prevY[last];
      this.vx[i] = this.vx[last];
      this.vy[i] = this.vy[last];
      this.sprites[i].rotation = this.sprites[last].rotation;
    }
    this.sprites[last].visible = false;
  }

  /** Avance les lances ; onHit est appelé pour chaque impact sur l'escouade. */
  update(dt: number, squad: Squad, dist: number, onHit: (x: number, y: number) => void): void {
    const sy = squad.worldY(dist);
    const hitR = B.LANCE_RADIUS + 42 * squad.visualScale;
    for (let i = this.count - 1; i >= 0; i--) {
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      const dx = this.x[i] - squad.x;
      const dy = this.y[i] - sy;
      if (dx * dx + dy * dy < hitR * hitR) {
        onHit(this.x[i], this.y[i]);
        this.kill(i);
        continue;
      }
      if (
        this.y[i] > -dist + 200 ||
        this.y[i] < -dist - 1100 ||
        this.x[i] < -60 ||
        this.x[i] > B.DESIGN_W + 60
      ) {
        this.kill(i);
      }
    }
  }

  syncRender(alpha: number): void {
    for (let i = 0; i < this.count; i++) {
      this.sprites[i].position.set(
        lerp(this.prevX[i], this.x[i], alpha),
        lerp(this.prevY[i], this.y[i], alpha),
      );
    }
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) this.sprites[i].visible = false;
    this.count = 0;
  }
}

export class Boss {
  alive = true;
  hp: number;
  x = B.LANE_CENTER;
  y: number;
  telegraph = 0; // > 0 : ligne de visée affichée, trajectoire verrouillée
  aimAngle = Math.PI / 2;
  private prevX = B.LANE_CENTER;
  private prevY: number;
  private vx = 0;
  private flash = 0;
  private lanceT = rand(...B.LANCE_INTERVAL);
  private readonly maxHp: number;
  private readonly root = new Container();
  private readonly body: Sprite;
  private readonly barFill: Sprite;
  private readonly label: Text;
  private readonly aimLine: Sprite;
  private shownHp: number;

  constructor(
    at: number,
    hp: number,
    readonly final: boolean,
    parent: Container,
    atlas: Atlas,
  ) {
    this.hp = this.maxHp = hp;
    this.shownHp = Math.ceil(hp);
    this.y = this.prevY = -at;

    // la ligne de visée part du centre du boss, sous le corps
    this.aimLine = new Sprite(atlas.white);
    this.aimLine.anchor.set(0, 0.5);
    this.aimLine.width = AIM_LENGTH;
    this.aimLine.height = 4;
    this.aimLine.tint = 0xef4444;
    this.aimLine.visible = false;

    this.body = new Sprite(atlas.enemyByKind[2]);
    this.body.anchor.set(0.5);
    this.body.width = this.body.height = B.BOSS_RADIUS * 2;

    const barBg = new Sprite(atlas.white);
    barBg.anchor.set(0.5);
    barBg.width = BAR_W;
    barBg.height = 9;
    barBg.tint = 0x1f2937;
    barBg.y = -B.BOSS_RADIUS - 18;
    this.barFill = new Sprite(atlas.white);
    this.barFill.anchor.set(0, 0.5);
    this.barFill.width = BAR_W - 2;
    this.barFill.height = 7;
    this.barFill.tint = 0x22c55e;
    this.barFill.position.set(-BAR_W / 2 + 1, -B.BOSS_RADIUS - 18);

    this.label = new Text({
      text: String(this.shownHp),
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 22,
        fontWeight: '900',
        fill: 0xffffff,
        stroke: { color: 0x450a0a, width: 5 },
      },
    });
    this.label.anchor.set(0.5, 1);
    this.label.y = -B.BOSS_RADIUS - 26;

    this.root.addChild(this.aimLine, this.body, barBg, this.barFill, this.label);
    parent.addChild(this.root);
  }

  damage(d: number): void {
    this.hp -= d;
    this.flash = 0.08;
    const shown = Math.max(0, Math.ceil(this.hp));
    if (shown !== this.shownHp) {
      this.shownHp = shown;
      this.label.text = String(shown);
      const ratio = Math.max(0, this.hp / this.maxHp);
      this.barFill.width = Math.max(1, (BAR_W - 2) * ratio);
      this.barFill.tint = ratio > 0.5 ? 0x22c55e : ratio > 0.25 ? 0xf59e0b : 0xef4444;
    }
  }

  /** Retourne le nombre de pertes infligées si le boss percute l'escouade ce tick. */
  update(dt: number, squad: Squad, dist: number, lances: LancePool, onFire: () => void): number {
    this.prevX = this.x;
    this.prevY = this.y;
    const desired = clamp((squad.x - this.x) * 1.2, -B.BOSS_STEER, B.BOSS_STEER);
    this.vx += (desired - this.vx) * Math.min(1, dt * 2.5);
    this.x = clamp(this.x + this.vx * dt, B.LANE_MIN_X, B.LANE_MAX_X);
    this.y += B.BOSS_SPEED * dt;
    this.flash = Math.max(0, this.flash - dt);
    this.body.tint = this.flash > 0 ? 0xffb0b0 : 0xffffff;

    // lances : télégraphe (trajectoire verrouillée) puis tir en ligne droite
    const onScreen = this.y > -dist - 820 && this.y < -dist + 40;
    if (this.telegraph > 0) {
      this.telegraph -= dt;
      this.aimLine.alpha = 0.25 + 0.45 * Math.abs(Math.sin(this.telegraph * 22));
      if (this.telegraph <= 0) {
        this.aimLine.visible = false;
        lances.fire(this.x, this.y + B.BOSS_RADIUS * 0.6, this.aimAngle);
        onFire();
      }
    } else if (onScreen) {
      this.lanceT -= dt;
      if (this.lanceT <= 0) {
        // blessé = enragé : cadence de tir accrue
        const enrage = 0.55 + 0.45 * Math.max(0, this.hp / this.maxHp);
        this.lanceT = rand(...B.LANCE_INTERVAL) * enrage;
        this.aimAngle = Math.atan2(squad.worldY(dist) - this.y, squad.x - this.x);
        this.telegraph = B.LANCE_TELEGRAPH;
        this.aimLine.rotation = this.aimAngle;
        this.aimLine.visible = true;
      }
    }

    const frontY = squad.worldY(dist) - 20;
    if (this.y + B.BOSS_RADIUS >= frontY && Math.abs(this.x - squad.x) < B.BOSS_RADIUS + 50) {
      this.y -= B.BOSS_KNOCKBACK; // recule après l'impact : boucle de pression, pas un one-shot
      this.prevY = this.y;
      return B.BOSS_CONTACT_KILLS;
    }
    return 0;
  }

  renderSync(alpha: number): void {
    this.root.position.set(lerp(this.prevX, this.x, alpha), lerp(this.prevY, this.y, alpha));
  }

  destroySelf(): void {
    if (!this.alive) return;
    this.alive = false;
    this.root.destroy({ children: true });
  }
}

export class Bosses {
  list: Boss[] = [];
  readonly lances: LancePool;
  onDeath: (boss: Boss, x: number, y: number) => void = () => {};
  onContact: (kills: number) => void = () => {};
  onLanceFire: () => void = () => {};
  onLanceHit: (x: number, y: number) => void = () => {};

  constructor(
    private readonly parent: Container,
    private readonly atlas: Atlas,
  ) {
    this.lances = new LancePool(parent, atlas);
  }

  spawn(at: number, hp: number, final: boolean): void {
    this.list.push(new Boss(at, hp, final, this.parent, this.atlas));
  }

  update(dt: number, squad: Squad, dist: number): void {
    let anyDead = false;
    for (const boss of this.list) {
      if (!boss.alive) {
        anyDead = true;
        continue;
      }
      if (boss.hp <= 0) {
        const { x, y } = boss;
        boss.destroySelf();
        this.onDeath(boss, x, y);
        anyDead = true;
        continue;
      }
      const kills = boss.update(dt, squad, dist, this.lances, this.onLanceFire);
      if (kills > 0) this.onContact(kills);
    }
    if (anyDead) this.list = this.list.filter((b) => b.alive);
    this.lances.update(dt, squad, dist, this.onLanceHit);
  }

  renderSync(alpha: number): void {
    for (const boss of this.list) boss.renderSync(alpha);
    this.lances.syncRender(alpha);
  }

  reset(): void {
    for (const boss of this.list) boss.destroySelf();
    this.list = [];
    this.lances.clear();
  }
}
