import { Sprite, Text } from 'pixi.js';
import {
  CELL_H,
  CELL_W,
  DESIGN_W,
  MID_Y,
  QUEUE_CELL,
  QUEUE_Y,
  lineY,
  rowOf,
  slotX,
} from '../config/balance';
import { ITEMS } from '../config/balance';
import type { Combat, CUnit } from '../game/combat';
import type { Layers } from './layers';
import { PALETTE, UNIT_PX } from './textures';
import type { Atlas } from './textures';

/**
 * Taille d'affichage d'une unité. La case fait 128 de haut et doit loger, sans
 * un pixel de recouvrement : le nom (−58), le sprite (−52 à +14), la jauge
 * (+18), les PV chiffrés (+41) et la ligne de stats (+55). Grossir le sprite
 * revient donc à rogner l'un des quatre, tous nécessaires.
 */
const UNIT_DRAW = 66;
/** Largeur de la jauge de PV. */
const BAR_W = 104;
const BAR_H = 11;

interface UnitView {
  sprite: Sprite;
  name: Text;
  hp: Text;
  stats: Text;
  item: Sprite;
}

/**
 * Le champ de bataille. Il ne DÉCIDE de rien : il lit `Combat` et le dessine.
 * Toute l'interaction passe par les `<button>` transparents du HUD, posés dans
 * le même repère 540×960 — le canvas est `aria-hidden`.
 *
 * ACCESSIBILITÉ : le camp d'une unité se lit à sa LIGNE (les deux camps
 * occupent des bandes distinctes, séparées par un trait), à son socle (plein
 * côté joueur, hachuré côté ennemi) et au libellé de la bande — jamais à la
 * seule teinte. Les chiffres sont écrits en clair sous chaque unité, et le HUD
 * en tient un miroir texte pour les lecteurs d'écran.
 */
export class BattleView {
  /** Uid de l'unité mise en avant par l'UI (survol / focus d'un bouton). */
  highlight = 0;
  /** Uids actuellement ciblables — surbrillance pointillée. */
  targets: readonly number[] = [];
  /** Emplacements proposés à la permutation : `${line}:${slot}`. */
  swapSlots: readonly string[] = [];
  /** Unités qui tressaillent (impact) : uid → temps restant. */
  private readonly shake = new Map<number, number>();
  private t = 0;

  private readonly views: UnitView[] = [];
  private readonly queueSprites: Sprite[] = [];
  private readonly queueLabels: Text[] = [];
  private readonly bandLabels: Text[] = [];
  private readonly auraSprites: Sprite[] = [];

  constructor(
    private readonly layers: Layers,
    private readonly atlas: Atlas,
  ) {
    // 10 vues suffisent : 4 unités joueur (5 avec Rang serré) + 4 ennemis + marge
    for (let i = 0; i < 10; i++) this.views.push(this.makeUnitView());
    for (let i = 0; i < 8; i++) {
      const s = new Sprite({ texture: atlas.units.wanderer, anchor: 0.5 });
      s.visible = false;
      layers.units.addChild(s);
      this.queueSprites.push(s);
      const t = this.makeText(11, PALETTE.dim);
      layers.labels.addChild(t);
      this.queueLabels.push(t);
    }
    for (let i = 0; i < 2; i++) {
      const t = this.makeText(13, PALETTE.dim);
      t.anchor.set(0, 0.5);
      layers.labels.addChild(t);
      this.bandLabels.push(t);
    }
    for (let i = 0; i < 2; i++) {
      const s = new Sprite({ texture: atlas.glow, anchor: 0.5 });
      s.visible = false;
      s.alpha = 0.5;
      layers.aura.addChild(s);
      this.auraSprites.push(s);
    }
  }

  private makeText(size: number, fill: number, weight: '400' | '700' | '900' = '700'): Text {
    const t = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fontWeight: weight, fill },
    });
    t.anchor.set(0.5);
    t.visible = false;
    return t;
  }

  private makeUnitView(): UnitView {
    const sprite = new Sprite({ texture: this.atlas.units.wanderer, anchor: 0.5 });
    sprite.width = UNIT_DRAW;
    sprite.height = UNIT_DRAW;
    sprite.visible = false;
    this.layers.units.addChild(sprite);
    const item = new Sprite({ texture: this.atlas.units.itemShield, anchor: 0.5 });
    item.width = 26;
    item.height = 26;
    item.visible = false;
    this.layers.units.addChild(item);
    const name = this.makeText(12, PALETTE.cream);
    const hp = this.makeText(13, PALETTE.cream, '900');
    const stats = this.makeText(11, PALETTE.dim, '400');
    for (const t of [name, hp, stats]) this.layers.labels.addChild(t);
    return { sprite, name, hp, stats, item };
  }

  /** Signale un impact : l'unité tressaille, sans jamais bouger sa case. */
  hit(uid: number): void {
    this.shake.set(uid, 0.22);
  }

  reset(): void {
    this.shake.clear();
    this.highlight = 0;
    this.targets = [];
    this.swapSlots = [];
    for (const v of this.views) {
      v.sprite.visible = false;
      v.item.visible = false;
      v.name.visible = false;
      v.hp.visible = false;
      v.stats.visible = false;
    }
    for (const s of this.queueSprites) s.visible = false;
    for (const t of this.queueLabels) t.visible = false;
    for (const t of this.bandLabels) t.visible = false;
    for (const s of this.auraSprites) s.visible = false;
    this.layers.scene.clear();
    this.layers.bars.clear();
  }

  update(dt: number): void {
    this.t += dt;
    for (const [uid, left] of this.shake) {
      const v = left - dt;
      if (v <= 0) this.shake.delete(uid);
      else this.shake.set(uid, v);
    }
  }

  /** Centre écran de l'emplacement d'une unité — le HUD y pose son bouton. */
  static cellOf(side: number, line: 0 | 1, slot: number, count: number): { x: number; y: number } {
    return { x: slotX(slot, Math.max(1, count)), y: lineY(rowOf(side, line)) };
  }

  draw(combat: Combat, frontCap: number): void {
    const g = this.layers.scene;
    const bars = this.layers.bars;
    g.clear();
    bars.clear();

    // ── bandes de ligne : c'est la LECTURE de la règle de ligne, pas un décor
    for (let row = 0; row < 4; row++) {
      const side = row < 2 ? 1 : 0;
      const line: 0 | 1 = row === 0 || row === 3 ? 1 : 0;
      const y = lineY(row);
      const isFront = combat.frontLine(side as 0 | 1) === line;
      const cap = side === 0 && line === 0 ? frontCap : 2;
      const span = cap * CELL_W + (cap - 1) * 14;
      g.roundRect(DESIGN_W / 2 - span / 2 - 8, y - CELL_H / 2, span + 16, CELL_H, 14);
      g.fill({ color: PALETTE.plinth, alpha: side === 1 ? 0.55 : 0.72 });
      // La ligne AVANT EFFECTIVE porte un liseré plein ; l'arrière, un pointillé.
      // Deux codes distincts (épaisseur + continuité), jamais deux teintes.
      g.roundRect(DESIGN_W / 2 - span / 2 - 8, y - CELL_H / 2, span + 16, CELL_H, 14);
      g.stroke({ color: isFront ? PALETTE.gold : PALETTE.plinthEdge, width: isFront ? 3 : 2, alpha: isFront ? 0.9 : 0.55 });

      // socles individuels
      for (let s = 0; s < cap; s++) {
        const x = slotX(s, cap);
        g.roundRect(x - CELL_W / 2 + 6, y + 26, CELL_W - 12, 10, 5);
        g.fill({ color: PALETTE.bgDeep, alpha: 0.5 });
      }
    }

    // ── séparateur des camps : le « ‖ » du design, en travers de l'écran
    g.rect(24, MID_Y - 2, DESIGN_W - 48, 4);
    g.fill({ color: PALETTE.panelEdge, alpha: 0.85 });
    for (let x = 34; x < DESIGN_W - 34; x += 26) {
      g.rect(x, MID_Y - 7, 8, 14);
      g.fill({ color: PALETTE.gold, alpha: 0.32 });
    }

    this.bandLabels[0].text = 'ENNEMI';
    this.bandLabels[0].x = 18;
    this.bandLabels[0].y = MID_Y - 26;
    this.bandLabels[0].visible = true;
    this.bandLabels[1].text = 'TOI';
    this.bandLabels[1].x = 18;
    this.bandLabels[1].y = MID_Y + 26;
    this.bandLabels[1].visible = true;

    // ── unités
    const active = combat.current();
    const targetSet = new Set(this.targets);
    const swapSet = new Set(this.swapSlots);
    let vi = 0;
    for (const u of combat.alive()) {
      if (vi >= this.views.length) break;
      const v = this.views[vi++];
      const cap = combat.capOf(u.side, u.line);
      const x = slotX(u.slot, cap);
      const y = lineY(rowOf(u.side, u.line));
      this.drawUnit(v, u, x, y, combat, active?.uid === u.uid, targetSet.has(u.uid));
    }
    for (let i = vi; i < this.views.length; i++) {
      const v = this.views[i];
      v.sprite.visible = false;
      v.item.visible = false;
      v.name.visible = false;
      v.hp.visible = false;
      v.stats.visible = false;
    }

    // ── emplacements de permutation proposés : un cadre en pointillé, pas une
    // teinte — le même code que la ligne arrière, donc déjà appris.
    if (swapSet.size) {
      for (const key of swapSet) {
        const [lineStr, slotStr] = key.split(':');
        const line = Number(lineStr) as 0 | 1;
        const slot = Number(slotStr);
        const cap = combat.capOf(0, line);
        const x = slotX(slot, cap);
        const y = lineY(rowOf(0, line));
        this.dashedBox(x, y, CELL_W - 16, CELL_H - 12, PALETTE.cool);
      }
    }

    // ── auréole de l'unité active : un halo doux + un anneau plein
    this.auraSprites[0].visible = false;
    if (active) {
      const cap = combat.capOf(active.side, active.line);
      const x = slotX(active.slot, cap);
      const y = lineY(rowOf(active.side, active.line));
      const aura = this.auraSprites[0];
      aura.visible = true;
      aura.x = x;
      aura.y = y - 6;
      const pulse = 1 + Math.sin(this.t * 3.2) * 0.06;
      aura.width = 150 * pulse;
      aura.height = 150 * pulse;
      aura.tint = active.side === 0 ? PALETTE.gold : PALETTE.ember;
      bars.roundRect(x - CELL_W / 2 + 4, y - CELL_H / 2 + 4, CELL_W - 8, CELL_H - 8, 12);
      bars.stroke({ color: active.side === 0 ? PALETTE.gold : PALETTE.ember, width: 3 });
    }

    this.drawQueue(combat);
  }

  private drawUnit(v: UnitView, u: CUnit, x: number, y: number, combat: Combat, isActive: boolean, isTarget: boolean): void {
    const bars = this.layers.bars;
    const shake = this.shake.get(u.uid) ?? 0;
    const jitter = shake > 0 ? Math.sin(shake * 90) * 5 : 0;
    // respiration douce : la vie sans jamais déplacer la case cliquable
    const bob = Math.sin(this.t * 2 + u.uid) * 2;

    v.sprite.texture = this.atlas.units[u.sprite] ?? this.atlas.units.wanderer;
    v.sprite.visible = true;
    v.sprite.x = x + jitter;
    v.sprite.y = y - 19 + bob;
    v.sprite.width = UNIT_DRAW;
    v.sprite.height = UNIT_DRAW;
    // Les ennemis sont MIROITÉS : les deux camps se regardent, la lecture du
    // « qui frappe qui » devient immédiate.
    v.sprite.scale.x = u.side === 1 ? -Math.abs(v.sprite.scale.x) : Math.abs(v.sprite.scale.x);
    v.sprite.tint = shake > 0 ? PALETTE.ember : 0xffffff;

    v.name.text = u.name;
    v.name.x = x;
    v.name.y = y - 58;
    v.name.visible = true;
    v.name.style.fill = u.side === 0 ? PALETTE.cream : PALETTE.dim;

    // jauge de PV : une FORME qui se vide, doublée du chiffre exact
    const ratio = Math.max(0, u.hp / u.maxHp);
    const bx = x - BAR_W / 2;
    const by = y + 18;
    bars.roundRect(bx - 2, by - 2, BAR_W + 4, BAR_H + 4, 5);
    bars.fill({ color: PALETTE.outline, alpha: 0.85 });
    bars.roundRect(bx, by, BAR_W, BAR_H, 3);
    bars.fill({ color: PALETTE.bgDeep });
    if (ratio > 0) {
      bars.roundRect(bx, by, Math.max(3, BAR_W * ratio), BAR_H, 3);
      bars.fill({ color: ratio > 0.5 ? PALETTE.leaf : ratio > 0.25 ? PALETTE.gold : PALETTE.ember });
    }
    // crans tous les 10 PV : on COMPTE son létal, la jauge doit se lire au grain
    for (let hp = 10; hp < u.maxHp; hp += 10) {
      const cx = bx + (BAR_W * hp) / u.maxHp;
      bars.rect(cx, by, 1, BAR_H);
      bars.fill({ color: PALETTE.outline, alpha: 0.55 });
    }

    v.hp.text = `${u.hp}/${u.maxHp}`;
    v.hp.x = x;
    v.hp.y = by + BAR_H + 12;
    v.hp.visible = true;

    // En toutes lettres, jamais en pictogrammes : le canvas retombe sur la
    // police système, et les dingbats (⚔ ⚡ 🛡) y sortent en tofu ou en glyphe
    // de substitution selon la machine. Trois abréviations tiennent la ligne.
    const parts = [`${combat.atkOf(u)} atq`, `${combat.initOf(u)} ini`];
    if (u.armor > 0) parts.push(`${u.armor} arm`);
    parts.push(u.reach === 'melee' ? 'contact' : 'distance');
    v.stats.text = parts.join(' · ');
    v.stats.x = x;
    v.stats.y = by + BAR_H + 26;
    v.stats.visible = true;

    if (u.item) {
      v.item.texture = this.atlas.units[ITEMS[u.item].sprite];
      v.item.x = x + CELL_W / 2 - 20;
      v.item.y = y - 42;
      v.item.visible = true;
    } else {
      v.item.visible = false;
    }

    // état DÉFEND : un bouclier dessiné, pas seulement une teinte
    if (u.defending) {
      bars.moveTo(x - CELL_W / 2 + 16, y - 46);
      bars.lineTo(x - CELL_W / 2 + 30, y - 52);
      bars.lineTo(x - CELL_W / 2 + 30, y - 38);
      bars.lineTo(x - CELL_W / 2 + 16, y - 32);
      bars.closePath();
      bars.fill({ color: PALETTE.cool, alpha: 0.9 });
    }

    if (isTarget && !isActive) this.dashedBox(x, y, CELL_W - 12, CELL_H - 8, PALETTE.ember);
    if (this.highlight === u.uid) {
      bars.roundRect(x - CELL_W / 2 + 2, y - CELL_H / 2 + 2, CELL_W - 4, CELL_H - 4, 12);
      bars.stroke({ color: PALETTE.cream, width: 2, alpha: 0.85 });
    }
  }

  /** Cadre en pointillé — une FORME distincte du liseré plein, pas une teinte. */
  private dashedBox(cx: number, cy: number, w: number, h: number, color: number): void {
    const bars = this.layers.bars;
    const x0 = cx - w / 2;
    const y0 = cy - h / 2;
    const step = 12;
    for (let x = x0; x < x0 + w; x += step) {
      const len = Math.min(7, x0 + w - x);
      bars.rect(x, y0, len, 3);
      bars.rect(x, y0 + h - 3, len, 3);
    }
    for (let y = y0; y < y0 + h; y += step) {
      const len = Math.min(7, y0 + h - y);
      bars.rect(x0, y, 3, len);
      bars.rect(x0 + w - 3, y, 3, len);
    }
    bars.fill({ color });
  }

  /**
   * L'ordre de tour, AFFICHÉ : c'est une promesse du design (§3.3). Sans lui,
   * l'INIT redeviendrait une décoration et la permutation, un pari.
   */
  private drawQueue(combat: Combat): void {
    const g = this.layers.scene;
    const list = combat.queue(8);
    const span = list.length * (QUEUE_CELL + 8);
    const x0 = DESIGN_W / 2 - span / 2 + QUEUE_CELL / 2;

    g.roundRect(20, QUEUE_Y - 34, DESIGN_W - 40, 66, 14);
    g.fill({ color: PALETTE.panel, alpha: 0.8 });
    g.roundRect(20, QUEUE_Y - 34, DESIGN_W - 40, 66, 14);
    g.stroke({ color: PALETTE.panelEdge, width: 2 });

    for (let i = 0; i < this.queueSprites.length; i++) {
      const s = this.queueSprites[i];
      const t = this.queueLabels[i];
      const u = list[i];
      if (!u) {
        s.visible = false;
        t.visible = false;
        continue;
      }
      const x = x0 + i * (QUEUE_CELL + 8);
      s.texture = this.atlas.units[u.sprite] ?? this.atlas.units.wanderer;
      s.visible = true;
      s.x = x;
      s.y = QUEUE_Y - 6;
      const size = i === 0 ? QUEUE_CELL + 8 : QUEUE_CELL - 6;
      s.width = size;
      s.height = size;
      s.scale.x = u.side === 1 ? -Math.abs(s.scale.x) : Math.abs(s.scale.x);
      s.alpha = i === 0 ? 1 : 0.72;
      // Le camp se lit au socle sous la vignette — plein pour toi, creux pour
      // l'ennemi : une forme, pas une couleur.
      g.roundRect(x - 18, QUEUE_Y + 16, 36, 6, 3);
      if (u.side === 0) g.fill({ color: PALETTE.gold });
      else g.stroke({ color: PALETTE.ember, width: 2 });
      t.text = `${combat.initOf(u)}`;
      t.x = x;
      t.y = QUEUE_Y - 30;
      t.visible = true;
      t.style.fill = i === 0 ? PALETTE.gold : PALETTE.dim;
    }
  }
}

/** Décalage vertical du sprite dans sa case — partagé avec le HUD. */
export const UNIT_SPRITE_DY = -18;
export const UNIT_SCALE = UNIT_DRAW / UNIT_PX;
