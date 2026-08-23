import { Container, Graphics, Sprite } from 'pixi.js';
import { lerp } from '@shared/math';
import * as B from '../config/balance';
import { PALETTE, type Atlas } from '../render/textures';

/** Sortie de `suck()`, préallouée : zéro allocation dans le tick. */
export interface Pull {
  x: number;
  y: number;
  grip: number;
}

/**
 * L'Aspirateur géant. Deux mécaniques, et TOUTES LES DEUX se contrent au
 * déplacement seul — c'est la contrainte que le boss devait respecter :
 *
 *  1. son cône d'aspiration TIRE le bébé vers lui et l'englue ;
 *  2. il GOBE les projectiles qui entrent dans le cône — il est donc invulnérable
 *     de face, il faut le contourner.
 *
 * L'embout ne pointe pas bêtement vers sa cible : il PIVOTE vers le bébé à
 * `BOSS_TURN` rad/s. Comme un char. Tourner autour de lui de près bat sa rotation,
 * tourner de loin non — la contre-attaque est donc « rentre dans la zone et
 * strafe », ce qui met le joueur exactement là où les mamies font mal.
 *
 * Le corps, lui, avance imperturbablement vers le berceau : le laisser tranquille
 * n'est jamais une option.
 */
export class Boss {
  active = false;
  x = 0;
  y = 0;
  prevX = 0;
  prevY = 0;
  hp = 0;
  maxHp = B.BOSS_HP;
  readonly radius = B.BOSS_RADIUS;
  /** Direction de l'embout, en radians (0 = vers +X). */
  angle = -Math.PI / 2;
  private prevAngle = -Math.PI / 2;
  private dustT = 0;
  /** Compte à rebours du flash d'impact (rendu uniquement). */
  private hitT = 0;

  private readonly sprite: Sprite;
  private readonly shadow: Sprite;

  constructor(
    private readonly atlas: Atlas,
    parent: Container,
  ) {
    this.shadow = new Sprite({ texture: atlas.shadow, anchor: { x: 0.5, y: 0.5 }, alpha: 0.4 });
    this.shadow.scale.set(2.2, 1.1);
    this.sprite = new Sprite({ texture: atlas.boss, anchor: { x: 0.5, y: 0.5 } });
    this.sprite.visible = false;
    this.shadow.visible = false;
    parent.addChild(this.shadow, this.sprite);
  }

  get rage(): boolean {
    return this.hp > 0 && this.hp / this.maxHp <= B.BOSS_RAGE_HP;
  }

  private get halfAngle(): number {
    return this.rage ? B.BOSS_RAGE_HALF_ANGLE : B.BOSS_SUCK_HALF_ANGLE;
  }

  spawn(x: number, y: number, hp: number): void {
    this.active = true;
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.hp = this.maxHp = hp;
    this.angle = this.prevAngle = Math.atan2(B.CRIB_Y - y, B.CRIB_X - x);
    this.dustT = B.BOSS_DUST_INTERVAL;
    this.hitT = 0;
    this.sprite.visible = true;
    this.shadow.visible = true;
  }

  damage(n: number): void {
    if (!this.active || this.hp <= 0) return;
    this.hp -= n;
    this.hitT = 0.12;
    if (this.hp <= 0) this.retire();
  }

  retire(): void {
    this.active = false;
    this.hp = 0;
    this.sprite.visible = false;
    this.shadow.visible = false;
  }

  update(
    dt: number,
    heroX: number,
    heroY: number,
    cribX: number,
    cribY: number,
    onDust: (x: number, y: number) => void,
  ): void {
    if (!this.active) return;
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevAngle = this.angle;
    if (this.hitT > 0) this.hitT -= dt;

    // le corps va au berceau, quoi qu'il arrive
    const dx = cribX - this.x;
    const dy = cribY - this.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > B.CRIB_BITE_RADIUS + this.radius) {
      this.x += (dx / d) * B.BOSS_SPEED * dt;
      this.y += (dy / d) * B.BOSS_SPEED * dt;
    }

    // l'embout pivote vers le bébé, à vitesse angulaire BORNÉE
    const want = Math.atan2(heroY - this.y, heroX - this.x);
    let diff = want - this.angle;
    // normalisation dans [-π, π] : sans elle, le boss fait un tour complet du
    // mauvais côté chaque fois que le bébé traverse la discontinuité de atan2
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = B.BOSS_TURN * dt;
    this.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));

    if (this.rage) {
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = B.BOSS_DUST_INTERVAL;
        for (let k = 0; k < B.BOSS_DUST_COUNT; k++) {
          // recrachés en éventail depuis l'embout, placement DÉTERMINISTE
          const a = this.angle + (k - (B.BOSS_DUST_COUNT - 1) / 2) * 0.4;
          onDust(this.x + Math.cos(a) * (this.radius + 14), this.y + Math.sin(a) * (this.radius + 14));
        }
      }
    }
  }

  /** `true` si (bx, by) est dans le cône — donc aspiré, gobé ou englué. */
  inCone(bx: number, by: number): boolean {
    if (!this.active) return false;
    const dx = bx - this.x;
    const dy = by - this.y;
    const d = Math.hypot(dx, dy);
    if (d > B.BOSS_SUCK_RANGE || d < 1) return false;
    let diff = Math.atan2(dy, dx) - this.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff) <= this.halfAngle;
  }

  /**
   * Aspiration subie par le bébé. Écrit dans `out` (préalloué) : force en px/s vers
   * l'embout, décroissante avec la distance, plus la charge de grip du souffle.
   */
  suck(heroX: number, heroY: number, out: Pull): void {
    out.x = 0;
    out.y = 0;
    out.grip = 0;
    if (!this.inCone(heroX, heroY)) return;
    const dx = this.x - heroX;
    const dy = this.y - heroY;
    const d = Math.hypot(dx, dy) || 1;
    // plus on est près de l'embout, plus ça tire : la zone a un gradient, donc on
    // peut encore s'en sortir depuis le bord
    const force = B.BOSS_SUCK_PULL * (1 - Math.min(1, d / B.BOSS_SUCK_RANGE));
    out.x = (dx / d) * force;
    out.y = (dy / d) * force;
    out.grip = B.BOSS_SUCK_GRIP;
  }

  renderSync(alpha: number, clock: number): void {
    if (!this.active) return;
    const px = lerp(this.prevX, this.x, alpha);
    const py = lerp(this.prevY, this.y, alpha);
    this.sprite.texture = this.rage ? this.atlas.bossRage : this.atlas.boss;
    // le sprite est dessiné embout vers le HAUT (= angle -π/2) : on compense pour
    // que l'embout coïncide EXACTEMENT avec l'axe du cône
    this.sprite.rotation = lerp(this.prevAngle, this.angle, alpha) + Math.PI / 2;
    // respiration + roulis, accélérés par la rage : il a l'air d'aspirer
    const rate = this.rage ? 11 : 6;
    const breathe = 1 + Math.sin(clock * rate) * (this.rage ? 0.05 : 0.03);
    this.sprite.scale.set(breathe, 2 - breathe);
    this.sprite.position.set(px, py);
    // flash d'impact : on doit sentir que les cubes portent
    this.sprite.tint = this.hitT > 0 ? 0xffffff : 0xd8d8d8;
    this.shadow.position.set(px, py + 22);
  }

  /**
   * Dessine le cône. Triple codage, comme toute zone de danger du hub : la teinte,
   * un liseré net à la limite exacte, et des arcs qui CONVERGENT vers l'embout —
   * ce dernier signal est du mouvement, donc lisible sans aucune perception des
   * couleurs (WCAG 1.4.1).
   */
  drawCone(g: Graphics, clock: number): void {
    g.clear();
    if (!this.active) return;
    const half = this.halfAngle;
    const r = B.BOSS_SUCK_RANGE;
    const a0 = this.angle - half;
    const a1 = this.angle + half;

    g.moveTo(this.x, this.y).arc(this.x, this.y, r, a0, a1).lineTo(this.x, this.y);
    g.fill({ color: this.rage ? PALETTE.bossTrim : PALETTE.bossDark, alpha: this.rage ? 0.2 : 0.15 });
    g.stroke({ color: PALETTE.warn, width: 2, alpha: 0.85 });

    // trois arcs qui se rapprochent de l'embout, décalés dans le temps : le sens de
    // l'aspiration se lit sans texte et sans couleur
    for (let k = 0; k < 3; k++) {
      const t = ((clock * 0.55 + k / 3) % 1);
      const rr = r * (1 - t);
      if (rr < 12) continue;
      // même précaution que pour la jauge de grip : un `arc` sans `moveTo` se relie
      // au point courant du chemin et trace une balafre en travers de l'arène
      g.moveTo(this.x + Math.cos(a0) * rr, this.y + Math.sin(a0) * rr);
      g.arc(this.x, this.y, rr, a0, a1);
      g.stroke({ color: PALETTE.hud, width: 2, alpha: 0.1 + 0.3 * t });
    }
  }
}
