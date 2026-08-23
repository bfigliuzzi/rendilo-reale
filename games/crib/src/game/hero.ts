import { Sprite } from 'pixi.js';
import { clamp, lerp } from '@shared/math';
import * as B from '../config/balance';
import type { Atlas } from '../render/textures';

/**
 * Le bébé. C'est ici que vit la mécanique signature du jeu : il n'a PAS de PV, il
 * a du GRIP.
 *
 *   cible = charge de contact / GRIP_LOAD_FOR_PIN     (bornée à 1)
 *   grip  → cible, vite à la montée, lentement à la descente
 *   vitesse = HERO_SPEED × (1 - grip)
 *
 * Le grip CONVERGE, il ne s'accumule pas : il faut plusieurs agrippeurs pour
 * immobiliser, et un seul ne fait que ralentir. Voir `GRIP_LOAD_FOR_PIN` pour
 * pourquoi l'intégration simple était un mauvais modèle.
 *
 * À grip = 1 il est immobile, mais il TIRE TOUJOURS (le tir vit dans `Bullets`, qui
 * n'interroge jamais le grip) : c'est le premier des trois garde-fous, sans lui
 * l'immobilisation serait un game-over déguisé au lieu d'une punition temporaire.
 * Les deux autres sont dans `balance.ts` (GRIP_CONTACT_CAP, GRIP_DECAY) et le
 * troisième est le doudou (`immuneT`).
 *
 * L'animation est indexée sur la DISTANCE parcourue, pas sur le temps : la cadence
 * de rampe ralentit donc d'elle-même avec le grip et se figeage à l'arrêt.
 */
export class Hero {
  x = 0;
  y = 0;
  prevX = 0;
  prevY = 0;
  vx = 0;
  vy = 0;

  /** Jauge d'engluement, 0 = libre, 1 = cloué au sol. */
  grip = 0;
  /** Doudou : tant que > 0, le grip est nul et le contact ne prend pas. */
  immuneT = 0;
  /** Biberon : tant que > 0, la cadence de tir est multipliée. */
  bottleT = 0;

  /** 0 bas, 1 gauche, 2 droite, 3 haut. Dérivée de l'INTENTION, pas de la vitesse. */
  dir = 0;
  /** Distance cumulée : pilote la frame de rampe. */
  private walk = 0;
  /** Nombre d'ennemis effectivement comptés dans le grip ce tick (rendu des filets). */
  clung = 0;

  private readonly sprite: Sprite;
  private readonly shadow: Sprite;

  constructor(
    private readonly atlas: Atlas,
    parent: import('pixi.js').Container,
  ) {
    this.shadow = new Sprite({ texture: atlas.shadow, anchor: { x: 0.5, y: 0.5 }, alpha: 0.4 });
    this.sprite = new Sprite({ texture: atlas.hero[0][1], anchor: { x: 0.5, y: 0.62 } });
    parent.addChild(this.shadow, this.sprite);
  }

  /** Cadence de tir courante, en balles/s. Le grip n'entre PAS dans ce calcul. */
  get rate(): number {
    return B.HERO_RATE * (this.bottleT > 0 ? B.BOTTLE_RATE_MUL : 1);
  }

  get pinned(): boolean {
    return this.grip >= B.GRIP_PIN - 1e-3;
  }

  /** Vitesse effective, en px/s — exposée pour le HUD et les assertions du bot. */
  get speed(): number {
    return B.HERO_SPEED * (1 - this.grip);
  }

  reset(x: number, y: number): void {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.vx = 0;
    this.vy = 0;
    this.grip = 0;
    this.immuneT = 0;
    this.bottleT = 0;
    this.dir = 0;
    this.walk = 0;
    this.clung = 0;
  }

  /** Grip ponctuel (impact de pois). Sans effet sous doudou. */
  addGrip(amount: number): void {
    if (this.immuneT > 0) return;
    this.grip = Math.min(B.GRIP_PIN, this.grip + amount);
  }

  /**
   * @param gripLoad Somme des `gripMul` des sources en contact, DÉJÀ plafonnée par
   *   l'appelant à `GRIP_CONTACT_CAP` contacts (voir `World.resolveContacts`).
   * @param pullX,pullY Aspiration du boss, en px/s. S'ajoute APRÈS le lissage de
   *   vitesse : ce n'est pas une intention du joueur, elle ne doit ni accélérer ni
   *   être freinée par l'inertie du bébé.
   */
  update(
    dt: number,
    dirX: number,
    dirY: number,
    gripLoad: number,
    pullX: number,
    pullY: number,
    arenaW: number,
    arenaH: number,
  ): void {
    this.prevX = this.x;
    this.prevY = this.y;

    if (this.immuneT > 0) {
      this.immuneT = Math.max(0, this.immuneT - dt);
      this.grip = 0;
    } else {
      // le grip CONVERGE vers une cible dérivée de la charge — il ne s'intègre pas
      // sans borne, sinon n'importe quel contact finirait par clouer le bébé et
      // l'engluement serait binaire au lieu d'être un gradient
      const target = Math.min(B.GRIP_PIN, gripLoad / B.GRIP_LOAD_FOR_PIN);
      if (target > this.grip) {
        this.grip = Math.min(target, this.grip + B.GRIP_RISE * dt);
      } else {
        // décroissance dès la frame où la charge retombe : aucune latence
        this.grip = Math.max(target, this.grip - B.GRIP_DECAY * dt);
      }
    }
    // clampés à 0 : un timer qui plonge en négatif s'affiche « -0 s » au HUD
    if (this.bottleT > 0) this.bottleT = Math.max(0, this.bottleT - dt);

    // direction affichée : l'INTENTION, pas la vitesse réelle — cloué, le bébé
    // continue de se tourner vers là où on le pousse, ce qui se lit comme un effort
    if (dirX !== 0 || dirY !== 0) {
      this.dir = Math.abs(dirX) > Math.abs(dirY) ? (dirX < 0 ? 1 : 2) : dirY < 0 ? 3 : 0;
    }

    const speed = this.speed;
    const k = Math.min(1, dt * B.HERO_ACCEL);
    this.vx += (dirX * speed - this.vx) * k;
    this.vy += (dirY * speed - this.vy) * k;

    const m = B.HERO_RADIUS;
    const nx = clamp(this.x + (this.vx + pullX) * dt, m, arenaW - m);
    const ny = clamp(this.y + (this.vy + pullY) * dt, m, arenaH - m);
    // la phase d'animation avance du déplacement RÉELLEMENT effectué (butées de
    // l'arène et engluement inclus) : elle ne peut pas mentir sur la vitesse
    this.walk += Math.hypot(nx - this.x, ny - this.y);
    this.x = nx;
    this.y = ny;
  }

  renderSync(alpha: number, clock: number): void {
    const px = lerp(this.prevX, this.x, alpha);
    const py = lerp(this.prevY, this.y, alpha);

    // cycle de rampe en ping-pong 0-1-2-1 : un aller-retour, pas une boucle qui
    // « saute » de la dernière frame à la première
    const step = Math.floor(this.walk / B.HERO_STRIDE) % 4;
    this.sprite.texture = this.atlas.hero[this.dir][step === 3 ? 1 : step];

    // squash/stretch : on s'étire dans le sens de la marche, on s'écrase à l'arrêt
    const v = Math.min(1, Math.hypot(this.vx, this.vy) / B.HERO_SPEED);
    const sq = 1 + B.HERO_SQUASH * v;
    const flat = 1 - B.HERO_SQUASH * v * 0.6;
    const horiz = this.dir === 1 || this.dir === 2;
    this.sprite.scale.set(horiz ? sq : flat, horiz ? flat : sq);

    // tortillement d'effort : purement visuel, il ne déplace jamais les collisions
    const struggle = Math.max(0, this.grip - B.HERO_STRUGGLE_FROM) / (1 - B.HERO_STRUGGLE_FROM);
    this.sprite.rotation = struggle > 0 ? Math.sin(clock * 22) * 0.16 * struggle : 0;
    this.sprite.position.set(px, py + Math.sin(clock * 9) * 0.6);

    this.shadow.position.set(px, py + 8);
    this.shadow.scale.set(0.62 - 0.06 * v, 0.5);
  }
}
