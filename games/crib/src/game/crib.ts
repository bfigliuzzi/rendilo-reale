import { Container, Sprite } from 'pixi.js';
import * as B from '../config/balance';
import type { Atlas } from '../render/textures';

/**
 * Le berceau : la SEULE condition de défaite du jeu. Le bébé n'a pas de PV, tout
 * se joue ici.
 *
 * Son usure se lit sur le sprite (3 états : barreaux qui cassent, couverture qui
 * glisse) autant que sur la barre du HUD — il faut pouvoir juger l'urgence d'un
 * coup d'œil au berceau lui-même, sans lever les yeux vers le HUD au moment le
 * moins opportun.
 */
export class Crib {
  hp = B.CRIB_HP;
  maxHp = B.CRIB_HP;
  readonly x = B.CRIB_X;
  readonly y = B.CRIB_Y;

  /** Compte à rebours du tressaillement d'impact (rendu uniquement). */
  private hitT = 0;
  /** Cumul de dégâts depuis la dernière lecture — sert au liseré d'alerte hors champ. */
  recentDamage = 0;

  private readonly sprite: Sprite;

  constructor(
    private readonly atlas: Atlas,
    parent: Container,
  ) {
    this.sprite = new Sprite({ texture: atlas.crib[0], anchor: { x: 0.5, y: 0.62 } });
    this.sprite.position.set(this.x, this.y);
    parent.addChild(this.sprite);
  }

  reset(maxHp: number): void {
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.hitT = 0;
    this.recentDamage = 0;
  }

  get frac(): number {
    return Math.max(0, this.hp / this.maxHp);
  }

  /** 0 neuf, 1 entamé, 2 au bord de la rupture. */
  get wear(): number {
    const f = this.frac;
    if (f > B.CRIB_WEAR[0]) return 0;
    if (f > B.CRIB_WEAR[1]) return 1;
    return 2;
  }

  get fallen(): boolean {
    return this.hp <= 0;
  }

  damage(n: number): void {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - n);
    this.hitT = 0.22;
    this.recentDamage += n;
  }

  heal(n: number): void {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  /** Consomme le cumul de dégâts : appelé une fois par frame par l'overlay. */
  takeRecentDamage(): number {
    const d = this.recentDamage;
    this.recentDamage = 0;
    return d;
  }

  update(dt: number): void {
    if (this.hitT > 0) this.hitT -= dt;
  }

  renderSync(clock: number): void {
    this.sprite.texture = this.atlas.crib[this.wear];
    // tressaillement d'impact + respiration lente : un berceau immobile au pixel
    // près a l'air d'un décor, pas d'un objectif vivant
    const shake = this.hitT > 0 ? this.hitT * 14 : 0;
    this.sprite.position.set(
      this.x + Math.sin(clock * 61) * shake,
      this.y + Math.sin(clock * 1.3) * 0.8 + Math.cos(clock * 47) * shake * 0.5,
    );
    // il s'affaisse en s'abîmant : l'usure se lit aussi dans la posture
    const sag = 1 - (1 - this.frac) * 0.06;
    this.sprite.scale.set(1, sag);
  }
}
