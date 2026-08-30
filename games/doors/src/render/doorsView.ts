import { Sprite, Text } from 'pixi.js';
import { DESIGN_W, NODE_COUNT } from '../config/balance';
import type { Door, DoorKind } from '../config/rules';
import type { Layers } from './layers';
import { DOOR_H, DOOR_PLAQUE, DOOR_W, PALETTE } from './textures';
import type { Atlas } from './textures';

/** Une unité de l'escouade telle que le bandeau la montre. */
export interface SquadRow {
  sprite: string;
  hp: number;
  maxHp: number;
  dead: boolean;
}

/** Abscisse du centre de la porte `i` sur trois. */
export const DOOR_X = [118, 270, 422] as const;
/**
 * Ordonnée du haut des portes. Les portes montent HAUT et l'escouade descend
 * sous elles : on regarde d'abord ce qu'on choisit, on relit ensuite avec quoi
 * on le choisit. L'inverse laissait 160 px de vide en bas d'écran et reléguait
 * la décision au milieu de nulle part.
 */
export const DOOR_TOP = 244;

/** Le TELL, et rien d'autre : une icône par catégorie (design §7.1). */
export const TELL_SPRITE: Readonly<Record<DoorKind, string>> = {
  fight: 'doorFight',
  fightHard: 'doorFightHard',
  recruit: 'doorRecruit',
  treasure: 'doorTreasure',
  shop: 'doorShop',
  veiled: 'doorVeiled',
};

export const TELL_NAME: Readonly<Record<DoorKind, string>> = {
  fight: 'Combat',
  fightHard: 'Combat dangereux',
  recruit: 'Recrue',
  treasure: 'Trésor',
  shop: 'Marchand',
  veiled: 'Porte voilée',
};

/**
 * Le nœud : trois portes, leur tell, et la piste des 9 nœuds + boss.
 *
 * Sans le tell, le joueur ne décide pas, il tire au sort. Avec lui, la vraie
 * question devient « je prends le double-crâne qui rapporte, ou la recrue
 * sûre ? » — c'est tout le sel de la boucle, donc l'icône est GROSSE, posée sur
 * un cartouche sombre, et DOUBLÉE d'un libellé en toutes lettres dessous : une
 * icône seule serait une information graphique non textuelle (RGAA 1.1).
 */
export class DoorsView {
  private readonly doorSprites: Sprite[] = [];
  private readonly tellSprites: Sprite[] = [];
  private readonly tellLabels: Text[] = [];
  private readonly hintLabels: Text[] = [];
  private readonly title: Text;
  private readonly squadTitle: Text;
  private readonly squadSprites: Sprite[] = [];
  private readonly squadLabels: Text[] = [];
  private t = 0;

  /** Index de la porte survolée/focalisée par le HUD, ou -1. */
  highlight = -1;

  constructor(
    private readonly layers: Layers,
    private readonly atlas: Atlas,
  ) {
    for (let i = 0; i < 3; i++) {
      const d = new Sprite({ texture: atlas.door, anchor: 0.5 });
      d.width = DOOR_W;
      d.height = DOOR_H;
      d.visible = false;
      layers.doors.addChild(d);
      this.doorSprites.push(d);

      const tell = new Sprite({ texture: atlas.units.doorFight, anchor: 0.5 });
      tell.width = DOOR_PLAQUE.size;
      tell.height = DOOR_PLAQUE.size;
      tell.visible = false;
      layers.doors.addChild(tell);
      this.tellSprites.push(tell);

      const label = this.makeText(15, PALETTE.cream, '900');
      layers.labels.addChild(label);
      this.tellLabels.push(label);

      const hint = this.makeText(12, PALETTE.dim, '400');
      layers.labels.addChild(hint);
      this.hintLabels.push(hint);
    }
    this.title = this.makeText(17, PALETTE.gold, '900');
    layers.labels.addChild(this.title);
    this.squadTitle = this.makeText(13, PALETTE.dim, '700');
    layers.labels.addChild(this.squadTitle);
    // 5 vignettes : le cap d'escouade est 4, plus une marge pour l'invocation
    for (let i = 0; i < 5; i++) {
      const s = new Sprite({ texture: atlas.units.wanderer, anchor: 0.5 });
      s.visible = false;
      layers.units.addChild(s);
      this.squadSprites.push(s);
      const t = this.makeText(11, PALETTE.dim, '700');
      layers.labels.addChild(t);
      this.squadLabels.push(t);
    }
  }

  private makeText(size: number, fill: number, weight: '400' | '700' | '900'): Text {
    const t = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: size,
        fontWeight: weight,
        fill,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 150,
      },
    });
    t.anchor.set(0.5);
    t.visible = false;
    return t;
  }

  update(dt: number): void {
    this.t += dt;
  }

  reset(): void {
    for (const s of this.doorSprites) s.visible = false;
    for (const s of this.tellSprites) s.visible = false;
    for (const t of this.tellLabels) t.visible = false;
    for (const t of this.hintLabels) t.visible = false;
    this.title.visible = false;
    this.squadTitle.visible = false;
    for (const s of this.squadSprites) s.visible = false;
    for (const t of this.squadLabels) t.visible = false;
    this.layers.scene.clear();
  }

  draw(doors: readonly Door[], node: number): void {
    const g = this.layers.scene;
    g.clear();

    this.title.text = node > NODE_COUNT ? 'LA DERNIÈRE PORTE' : `NŒUD ${node} / ${NODE_COUNT}`;
    this.title.x = DESIGN_W / 2;
    this.title.y = 108;
    this.title.visible = true;

    this.drawTrack(node);

    const xs = doors.length === 1 ? [DESIGN_W / 2] : DOOR_X;
    for (let i = 0; i < 3; i++) {
      const door = doors[i];
      const sprite = this.doorSprites[i];
      const tell = this.tellSprites[i];
      const label = this.tellLabels[i];
      const hint = this.hintLabels[i];
      if (!door) {
        sprite.visible = false;
        tell.visible = false;
        label.visible = false;
        hint.visible = false;
        continue;
      }
      const solo = doors.length === 1;
      const x = xs[i];
      const scale = solo ? 1.3 : 1;
      const y = DOOR_TOP + (DOOR_H * scale) / 2;

      // La porte survolée respire : un MOUVEMENT, lisible sans la couleur.
      const lift = this.highlight === i ? Math.sin(this.t * 5) * 3 - 4 : 0;
      sprite.visible = true;
      sprite.x = x;
      sprite.y = y + lift;
      sprite.width = DOOR_W * scale;
      sprite.height = DOOR_H * scale;

      const shown: DoorKind = door.tell === 'veiled' && door.revealed ? door.real : door.tell;
      tell.visible = true;
      tell.texture = this.atlas.units[TELL_SPRITE[shown]];
      tell.x = x;
      tell.y = y + lift - DOOR_H * scale * 0.5 + DOOR_PLAQUE.y * scale;
      tell.width = DOOR_PLAQUE.size * scale;
      tell.height = DOOR_PLAQUE.size * scale;

      const bottom = y + (DOOR_H * scale) / 2;
      label.text = door.tell === 'veiled' && !door.revealed ? TELL_NAME.veiled : TELL_NAME[shown];
      label.x = x;
      label.y = bottom + 22;
      label.visible = true;

      hint.text =
        door.tell === 'veiled' && !door.revealed
          ? 'Inconnu · +50 % de butin'
          : door.revealed && door.tell === 'veiled'
            ? 'Révélée · +50 % de butin'
            : '';
      hint.x = x;
      hint.y = bottom + 46;
      hint.visible = hint.text.length > 0;

      if (this.highlight === i) {
        g.roundRect(x - (DOOR_W * scale) / 2 - 8, DOOR_TOP - 10, DOOR_W * scale + 16, DOOR_H * scale + 20, 16);
        g.stroke({ color: PALETTE.gold, width: 3 });
      }
    }
  }

  /**
   * L'escouade, en bandeau : on choisit sa porte en VOYANT ses PV. Sans ce
   * rappel, la question « je prends le combat ou le marchand ? » se poserait
   * de mémoire, ce qui est exactement le contraire d'une décision informée.
   */
  drawSquad(rows: readonly SquadRow[]): void {
    const g = this.layers.scene;
    this.squadTitle.text = 'TON ESCOUADE';
    this.squadTitle.x = DESIGN_W / 2;
    this.squadTitle.y = 604;
    this.squadTitle.visible = true;
    const span = rows.length * 96;
    const x0 = DESIGN_W / 2 - span / 2 + 48;
    for (let i = 0; i < this.squadSprites.length; i++) {
      const s = this.squadSprites[i];
      const t = this.squadLabels[i];
      const row = rows[i];
      if (!row) {
        s.visible = false;
        t.visible = false;
        continue;
      }
      const x = x0 + i * 96;
      s.texture = this.atlas.units[row.sprite] ?? this.atlas.units.wanderer;
      s.visible = true;
      s.x = x;
      s.y = 654;
      s.width = 54;
      s.height = 54;
      // Une unité à terre est GRISÉE **et** barrée : deux codes, pas une teinte.
      s.alpha = row.dead ? 0.35 : 1;
      if (row.dead) {
        g.rect(x - 24, 652, 48, 4);
        g.fill({ color: PALETTE.ember });
      }
      const ratio = Math.max(0, row.hp / row.maxHp);
      g.roundRect(x - 30, 686, 60, 8, 4);
      g.fill({ color: PALETTE.bgDeep });
      if (ratio > 0) {
        g.roundRect(x - 30, 686, Math.max(3, 60 * ratio), 8, 4);
        g.fill({ color: ratio > 0.5 ? PALETTE.leaf : ratio > 0.25 ? PALETTE.gold : PALETTE.ember });
      }
      t.text = row.dead ? 'à terre' : `${row.hp}/${row.maxHp}`;
      t.x = x;
      t.y = 706;
      t.visible = true;
      t.style.fill = row.dead ? PALETTE.ember : PALETTE.dim;
    }
  }

  /** La piste : 9 nœuds puis le boss. Franchi = plein, à venir = creux. */
  private drawTrack(node: number): void {
    const g = this.layers.scene;
    const total = NODE_COUNT + 1;
    const step = (DESIGN_W - 96) / (total - 1);
    const y = 162;
    g.rect(48, y - 2, DESIGN_W - 96, 4);
    g.fill({ color: PALETTE.panelEdge, alpha: 0.6 });
    for (let i = 0; i < total; i++) {
      const x = 48 + i * step;
      const done = i + 1 < node;
      const here = i + 1 === node;
      const boss = i === total - 1;
      const r = boss ? 11 : here ? 10 : 7;
      g.circle(x, y, r);
      if (done) g.fill({ color: PALETTE.gold });
      else if (here) {
        g.fill({ color: PALETTE.cream });
        g.circle(x, y, r + 5);
        g.stroke({ color: PALETTE.gold, width: 2 });
      } else {
        g.fill({ color: PALETTE.bgDeep });
        g.circle(x, y, r);
        g.stroke({ color: PALETTE.panelEdge, width: 2 });
      }
      // Le boss porte une COURONNE de pointes : une forme, pas une teinte.
      if (boss) {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 - Math.PI / 2;
          g.rect(x + Math.cos(a) * 14 - 2, y + Math.sin(a) * 14 - 2, 4, 4);
        }
        g.fill({ color: node > NODE_COUNT ? PALETTE.gold : PALETTE.panelEdge });
      }
    }
  }
}
