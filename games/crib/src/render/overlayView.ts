import { Container, Graphics, Sprite } from 'pixi.js';
import { clamp } from '@shared/math';
import * as B from '../config/balance';
import type { Steer } from '../input/steer';
import type { World } from '../game/world';
import { PALETTE, type Atlas } from './textures';

/** Chevrons de menace affichés au plus : au-delà, le bord d'écran devient du bruit. */
const MAX_CHEVRONS = 8;

/**
 * Tout ce qui se dessine en ESPACE ÉCRAN, par-dessus le monde : joystick, vignette
 * d'engluement, et les repères de hors-champ.
 *
 * Les repères de hors-champ ne sont pas un confort. La caméra suit le bébé, donc le
 * berceau peut se faire mordre en dehors du champ : sans retour, on perd sans jamais
 * comprendre pourquoi. Trois signaux couvrent ce trou —
 *   ① des chevrons au bord pour les menaces invisibles, priorisées par leur
 *      proximité au BERCEAU (pas au bébé : c'est l'urgence réelle) ;
 *   ② une flèche vers le berceau dès qu'il approche du bord ou sort du cadre ;
 *   ③ un liseré rouge pulsé du côté concerné quand il prend des dégâts hors champ.
 */
export class OverlayView {
  private readonly g = new Graphics();
  private readonly stick = new Graphics();
  private readonly compass: Sprite;
  /** Reste du liseré d'alerte, en secondes : un impact se voit même s'il est bref. */
  private alertT = 0;

  /** Tampons de tri des chevrons, préalloués : zéro allocation par frame. */
  private readonly chevD = new Float32Array(MAX_CHEVRONS);
  private readonly chevX = new Float32Array(MAX_CHEVRONS);
  private readonly chevY = new Float32Array(MAX_CHEVRONS);
  private chevCount = 0;

  constructor(parent: Container, atlas: Atlas) {
    this.compass = new Sprite({ texture: atlas.compass, anchor: { x: 0.5, y: 0.5 }, visible: false });
    parent.addChild(this.g, this.compass, this.stick);
  }

  render(world: World, steer: Steer, dtFrame: number): void {
    const g = this.g;
    g.clear();
    const clock = world.clock;
    const camX = world.camX;
    const camY = world.camY;

    if (this.alertT > 0) this.alertT -= dtFrame;
    if (world.crib.takeRecentDamage() > 0) this.alertT = 0.6;

    this.drawVignette(g, world.hero.grip, world.hero.pinned, clock);
    this.drawChevrons(g, world, camX, camY);
    this.drawCribMarker(g, world, camX, camY, clock);
    this.drawStick(steer, world.hero.grip);
  }

  /**
   * Vignette d'engluement : trois cadres emboîtés d'alpha croissant simulent un
   * dégradé pour trois primitives, là où un vrai radial coûterait une texture
   * plein écran. Elle ne PORTE pas l'information (l'anneau autour du bébé le fait) :
   * elle la double dans la vision périphérique, là où l'œil est déjà occupé.
   */
  private drawVignette(g: Graphics, grip: number, pinned: boolean, clock: number): void {
    if (grip <= B.GRIP_VIGNETTE_FROM) return;
    const t = (grip - B.GRIP_VIGNETTE_FROM) / (1 - B.GRIP_VIGNETTE_FROM);
    // battement seulement à l'immobilisation : sinon l'écran pulse en permanence
    const pulse = pinned ? 0.75 + 0.25 * Math.sin(clock * 12) : 1;
    const color = pinned ? PALETTE.bossTrim : PALETTE.warn;
    for (let k = 0; k < 3; k++) {
      const inset = 10 + k * 26;
      g.rect(inset, inset, B.DESIGN_W - inset * 2, B.DESIGN_H - inset * 2);
      g.stroke({ color, width: 26, alpha: t * pulse * (0.16 - k * 0.045) });
    }
  }

  /** Menaces hors champ, priorisées par proximité au berceau. */
  private drawChevrons(g: Graphics, world: World, camX: number, camY: number): void {
    const e = world.enemies;
    const ox = camX - B.DESIGN_W / 2;
    const oy = camY - B.DESIGN_H / 2;
    this.chevCount = 0;
    for (let i = 0; i < e.count; i++) {
      if (e.hp[i] <= 0) continue;
      const sx = e.x[i] - ox;
      const sy = e.y[i] - oy;
      // marge de 12 px : un ennemi à moitié visible n'a pas besoin de chevron
      if (sx > -12 && sx < B.DESIGN_W + 12 && sy > -12 && sy < B.DESIGN_H + 12) continue;
      const dx = e.x[i] - world.crib.x;
      const dy = e.y[i] - world.crib.y;
      this.insertChevron(dx * dx + dy * dy, sx, sy);
    }
    if (world.boss.active) {
      const sx = world.boss.x - ox;
      const sy = world.boss.y - oy;
      if (sx < -12 || sx > B.DESIGN_W + 12 || sy < -12 || sy > B.DESIGN_H + 12) {
        // le boss passe devant tout le reste : distance forcée à 0
        this.insertChevron(-1, sx, sy);
      }
    }

    for (let i = 0; i < this.chevCount; i++) {
      const sx = clamp(this.chevX[i], B.COMPASS_MARGIN, B.DESIGN_W - B.COMPASS_MARGIN);
      const sy = clamp(this.chevY[i], B.COMPASS_MARGIN, B.DESIGN_H - B.COMPASS_MARGIN);
      const a = Math.atan2(this.chevY[i] - sy, this.chevX[i] - sx);
      // petit triangle plein pointant HORS de l'écran, plus il est proche du
      // berceau plus il est opaque : la hiérarchie se lit sans compter
      const w = 9;
      const h = 13;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      g.moveTo(sx + cos * h, sy + sin * h)
        .lineTo(sx - sin * w - cos * 3, sy + cos * w - sin * 3)
        .lineTo(sx + sin * w - cos * 3, sy - cos * w - sin * 3)
        .closePath()
        .fill({ color: PALETTE.hud, alpha: 0.35 + 0.5 * (1 - i / MAX_CHEVRONS) })
        .stroke({ color: PALETTE.ink, width: 1.5, alpha: 0.7 });
    }
  }

  private insertChevron(d2: number, sx: number, sy: number): void {
    let at = this.chevCount;
    while (at > 0 && this.chevD[at - 1] > d2) at--;
    if (at >= MAX_CHEVRONS) return;
    for (let k = Math.min(this.chevCount, MAX_CHEVRONS - 1); k > at; k--) {
      this.chevD[k] = this.chevD[k - 1];
      this.chevX[k] = this.chevX[k - 1];
      this.chevY[k] = this.chevY[k - 1];
    }
    this.chevD[at] = d2;
    this.chevX[at] = sx;
    this.chevY[at] = sy;
    if (this.chevCount < MAX_CHEVRONS) this.chevCount++;
  }

  /** Flèche vers le berceau + liseré d'alerte quand il souffre loin du regard. */
  private drawCribMarker(g: Graphics, world: World, camX: number, camY: number, clock: number): void {
    const sx = world.crib.x - (camX - B.DESIGN_W / 2);
    const sy = world.crib.y - (camY - B.DESIGN_H / 2);
    const m = B.COMPASS_MARGIN;
    const off = sx < m || sx > B.DESIGN_W - m || sy < m || sy > B.DESIGN_H - m;

    this.compass.visible = off;
    if (off) {
      const px = clamp(sx, m, B.DESIGN_W - m);
      const py = clamp(sy, m, B.DESIGN_H - m);
      this.compass.position.set(px, py);
      // le sprite pointe vers le HAUT : +π/2 pour l'aligner sur l'angle visé
      this.compass.rotation = Math.atan2(sy - py, sx - px) + Math.PI / 2;
      // il grossit quand le berceau souffre : on ne peut pas le manquer
      const urge = this.alertT > 0 ? 1.35 : 1;
      this.compass.scale.set(urge);
      this.compass.alpha = 0.55 + (world.crib.frac < 0.34 ? 0.45 : 0.2) * (0.5 + 0.5 * Math.sin(clock * 4));
    }

    if (this.alertT <= 0) return;
    // liseré d'alerte : plein cadre, car le berceau reste au centre de l'arène — un
    // liseré directionnel serait ambigu quand il est à peine hors cadre
    const beat = 0.5 + 0.5 * Math.sin(clock * 18);
    g.rect(3, 3, B.DESIGN_W - 6, B.DESIGN_H - 6);
    g.stroke({ color: PALETTE.bossTrim, width: 6, alpha: Math.min(1, this.alertT * 2) * (0.35 + 0.35 * beat) });
  }

  /**
   * Joystick. Il n'apparaît QUE quand le pouce est posé : un stick permanent
   * masquerait le gazon et mentirait aux joueurs au clavier.
   */
  private drawStick(steer: Steer, grip: number): void {
    const s = this.stick;
    s.clear();
    if (!steer.stickActive) return;
    const bx = steer.stickX;
    const by = steer.stickY;
    s.circle(bx, by, B.STICK_RADIUS).stroke({ color: PALETTE.hud, width: 3, alpha: 0.28 });
    s.circle(bx, by, B.STICK_RADIUS).fill({ color: PALETTE.ink, alpha: 0.14 });
    // le pommeau RÉTRÉCIT avec le grip : le stick devient « mou », quatrième code
    // redondant de l'engluement — on le sent dans le pouce avant de le lire
    const knob = 20 * (1 - grip * 0.55);
    s.circle(bx + steer.stickDX, by + steer.stickDY, knob).fill({ color: PALETTE.hud, alpha: 0.55 - grip * 0.2 });
    s.circle(bx + steer.stickDX, by + steer.stickDY, knob).stroke({ color: PALETTE.ink, width: 2, alpha: 0.5 });
  }
}
