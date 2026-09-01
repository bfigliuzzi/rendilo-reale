import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { PASS_W, TILES_STACK } from '../../config/balance';
import { getAtlas, PALETTE } from '../../render/textures';
import { orientationWord, rowColOf, type Domino, type TilesModel, type TilesState } from './model';

/**
 * Vue de `tiles`. Deux règles non négociables (pattern du dépôt) :
 *   ① elle ne MUTE jamais le modèle : elle le lit, point ;
 *   ② toute animation est une fonction CLOSE du temps écoulé (pattern de
 *      `mind/render/boardView.ts`) — un instant mémorisé (`placedAt[i]`) posé
 *      UNE fois à l'apparition d'un domino, tout le reste s'en déduit. Rien à
 *      faire avancer, rien qui puisse rester bloqué en cours d'anim.
 *
 * Le canvas est purement décoratif (`aria-hidden`, cf. `index.ts` qui pose les
 * vrais `<button>`) : tout ce qui est dessiné ici est un RENFORT visuel de ce
 * que les boutons DOM garantissent déjà (légalité, focus), jamais la seule
 * source de vérité.
 */

/** Côté d'une case, en px logiques. ≥ 60 : c'est aussi la taille de la cible
 *  tactile posée par `index.ts` (§1.1), qui IMPORTE ces deux constantes plutôt
 *  que d'en garder une copie — deux valeurs à garder synchrones à la main, et
 *  les boutons transparents dérivent silencieusement du dessin. */
export const CELL = 68;
export const BOARD_Y = 150;
/** Bandeau sous le plateau : consigne, badge ⭐, libellés des deux piles. */
const HINT_Y = 576;
const STAR_Y = 602;
const LABEL_Y = 636;
/** Haut du halo de la pile active — juste sous les libellés. */
const PILE_HALO_Y = 626;
/** Couleur locale, propre à `tiles` : un galet posé sur une case bloquée —
 *  jamais dans `PALETTE` partagée, ce jeu est le seul à en avoir besoin.
 *
 *  CONTRASTES CALCULÉS, pas jugés à l'œil : le galet est le SEUL signal qui dit
 *  « on ne peut pas poser ici » (le creux `bgDeep` d'une case bloquée n'est qu'à
 *  1,17:1 de la case vide `bg` — invisible). C'est donc un élément d'interface
 *  porteur d'information, soumis au 3:1 de WCAG 1.4.11. Les valeurs initiales
 *  (0x6b5847 / 0x4d3d30) tombaient à 2,36:1 et 1,54:1 sur `bgDeep` : remontées
 *  à 4,6:1 et 3,6:1 (et 3,9:1 / 3,1:1 sur `bg`, l'autre fond possible). */
const STONE = 0x9b8672;
const STONE_DARK = 0x8a7360;
/** Durée du petit « pop » d'apparition d'un domino — pure vue, sans effet sur
 *  la règle : sauter 3 s en avant donne directement l'état final posé. */
const POP_TIME = 0.3;
/** Combien de tuiles d'une pile sont effectivement dessinées empilées : au
 *  delà, la pile reste lisible (elle ne grandirait plus indéfiniment à
 *  l'écran) — le CHIFFRE affiché à côté, lui, reste toujours exact. */
const PILE_DRAW_CAP = TILES_STACK;

function ease(p: number): number {
  return 1 - (1 - p) * (1 - p);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function bigText(text: string, size: number, fill: number, weight: '700' | '800' | '900' = '800'): Text {
  const t = new Text({
    text,
    style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fontWeight: weight, fill },
  });
  t.anchor.set(0.5, 0);
  return t;
}

/** Centre LOCAL (repère du plateau, avant décalage `boardX/boardY`) du milieu
 *  d'un domino — le point entre ses deux cases, jamais le seul point ancre :
 *  c'est ce qui centre le sprite pile sur la pièce qu'il représente. */
function dominoCenter(d: Domino, cols: number): { x: number; y: number } {
  const [r, c] = rowColOf(d.anchor, cols);
  const r2 = d.owner === 0 ? r + 1 : r;
  const c2 = d.owner === 0 ? c : c + 1;
  return { x: ((c + c2) / 2 + 0.5) * CELL, y: ((r + r2) / 2 + 0.5) * CELL };
}

export class TilesView {
  readonly root = new Container();
  private readonly boardX: number;
  private readonly staticLayer = new Graphics(); // panneau + cases + galets : dessinés une fois
  private readonly highlight = new Graphics(); // poses légales : redessiné à chaque frame
  private readonly pilesLayer = new Graphics(); // les deux piles : redessinées à chaque frame
  private readonly dominoLayer = new Container();
  private readonly title: Text;
  private readonly hint: Text;
  private readonly starBadge: Text;
  private readonly labelP0: Text;
  private readonly labelP1: Text;
  private readonly countP0: Text;
  private readonly countP1: Text;

  private readonly dominoSprites: Sprite[] = [];
  private readonly dominoStars: Text[] = [];
  private readonly placedAt: number[] = [];
  /** Échelles de REPOS du sprite, mémorisées à la pose. PIÈGE VÉCU : dans Pixi
   *  v8, `sprite.width`/`sprite.height` ne font qu'ÉCRIRE `scale` (valeur ÷
   *  taille de texture). Le « pop » qui faisait ensuite `scale.set(p)` écrasait
   *  donc le format 1×2 du domino : chaque pièce retombait carrée sur une seule
   *  case, et la règle « debout / couché » — qui se lit uniquement à la FORME —
   *  disparaissait de l'écran. Le pop multiplie l'échelle de repos, il ne la
   *  remplace pas. */
  private readonly baseScaleX: number[] = [];
  private readonly baseScaleY: number[] = [];
  private lastDominoCount = 0;
  /** Signature entière de l'état DISCRET déjà tracé (dominos posés, tour,
   *  fin de manche) : tant qu'elle ne change pas, il n'y a rien à redessiner. */
  private lastDrawKey = -1;

  constructor(
    parent: Container,
    private readonly model: TilesModel,
    private readonly reducedMotion: boolean,
  ) {
    const s = model.state;
    const boardW = s.cols * CELL;
    this.boardX = (PASS_W - boardW) / 2;

    // MESURÉ, pas supposé : le bandeau de table (`#hudbar`) est peint AU-DESSUS
    // du plateau, en pixels ÉCRAN (68 px) et non logiques. Sur un téléphone au
    // ratio exact 540:960 il n'y a aucun letterbox vertical, donc il recouvre
    // jusqu'à ~100 px LOGIQUES du haut du canvas. Le titre est décoratif et
    // peut vivre là (comme chez ses quatre frères en posture `pass`) ; les deux
    // lignes INFORMATIVES, elles, descendent sous le plateau — d'ailleurs leur
    // vraie place, juste au-dessus des piles dont elles parlent.
    this.title = bigText('🧩 Dominos croisés', 26, PALETTE.cream, '900');
    this.title.position.set(PASS_W / 2, 30);
    this.hint = bigText('', 17, PALETTE.dim, '700');
    this.hint.position.set(PASS_W / 2, HINT_Y);
    this.starBadge = bigText('', 20, PALETTE.gold, '900');
    this.starBadge.position.set(PASS_W / 2, STAR_Y);

    this.labelP0 = bigText('▮ debout', 16, PALETTE.sky, '800');
    this.labelP0.position.set(150, LABEL_Y);
    this.labelP1 = bigText('▬ couché', 16, PALETTE.berry, '800');
    this.labelP1.position.set(390, LABEL_Y);
    this.countP0 = bigText('', 15, PALETTE.dim, '700');
    this.countP0.position.set(150, 900);
    this.countP1 = bigText('', 15, PALETTE.dim, '700');
    this.countP1.position.set(390, 900);

    this.paintStatic(s);

    this.root.addChild(
      this.staticLayer,
      this.highlight,
      this.dominoLayer,
      this.pilesLayer,
      this.title,
      this.hint,
      this.starBadge,
      this.labelP0,
      this.labelP1,
      this.countP0,
      this.countP1,
    );
    parent.addChild(this.root);
  }

  private cellCenter(idx: number, cols: number): { x: number; y: number } {
    const [r, c] = rowColOf(idx, cols);
    return { x: this.boardX + c * CELL + CELL / 2, y: BOARD_Y + r * CELL + CELL / 2 };
  }

  /** Panneau, cases vides et galets des cases bloquées : rien de ceci ne
   *  change durant la manche (le blocage est tiré une fois à la génération),
   *  donc c'est peint UNE fois plutôt que redessiné à 60 Hz pour rien. */
  private paintStatic(s: TilesState): void {
    const boardW = s.cols * CELL;
    const boardH = s.rows * CELL;
    const g = this.staticLayer;
    g.roundRect(this.boardX - 10, BOARD_Y - 10, boardW + 20, boardH + 20, 20)
      .fill(PALETTE.panel)
      .stroke({ width: 4, color: PALETTE.panelEdge });

    for (let idx = 0; idx < s.cols * s.rows; idx++) {
      const { x, y } = this.cellCenter(idx, s.cols);
      if (s.blocked[idx]) {
        // Un petit tas de galets, jamais une hachure ni un anneau (interdits
        // de charte réservés aux dangers) : « il y a quelque chose là », pas
        // « attention danger ».
        g.roundRect(x - CELL / 2 + 4, y - CELL / 2 + 4, CELL - 8, CELL - 8, 10).fill(PALETTE.bgDeep);
        g.circle(x - 10, y + 6, 9).fill(STONE);
        g.circle(x + 9, y + 8, 11).fill(STONE_DARK);
        g.circle(x + 2, y - 8, 8).fill(STONE);
      } else {
        g.roundRect(x - CELL / 2 + 4, y - CELL / 2 + 4, CELL - 8, CELL - 8, 10)
          .fill(PALETTE.bg)
          .stroke({ width: 1, color: PALETTE.panelEdge, alpha: 0.35 });
      }
    }
  }

  render(time: number): void {
    const s = this.model.state;

    const glyph = s.turn === 0 ? '▮' : '▬';
    const hintText = s.over ? '' : `à toi : pose ${glyph} ${orientationWord(s.turn)}`;
    if (this.hint.text !== hintText) this.hint.text = hintText;

    const starText = s.helped === null ? '' : `⭐ celui qui pose ${orientationWord(s.helped)} a 2 tuiles d'avance`;
    if (this.starBadge.text !== starText) this.starBadge.text = starText;

    this.syncDominoes(s, time);
    // Les deux tracés vectoriels (surlignage des poses légales, piles) ne
    // dépendent QUE de l'état discret du modèle : les reconstruire à 60 Hz
    // pour un plateau qui ne bouge pas est un coût pur (le §7 mesure un
    // scénario `stress` avec huit démos animées en même temps). Clé entière,
    // donc aucune allocation dans le chemin de rendu.
    const key = s.dominoes.length * 4 + s.turn * 2 + (s.over ? 1 : 0);
    if (key !== this.lastDrawKey) {
      this.lastDrawKey = key;
      this.drawHighlight(s);
      this.drawPiles(s);
    }
    this.animateLabels(s, time);
  }

  /** Respiration douce (fonction périodique du temps, aucun état mémorisé) sur
   *  le libellé du joueur actif — coupée en mouvement réduit puisqu'il ne
   *  s'agit que d'un ornement : « à qui le tour » vit déjà dans le halo de la
   *  pile, le glyphe ▮/▬ de la consigne et le liseré des boutons DOM. */
  private animateLabels(s: TilesState, time: number): void {
    const breathe = this.reducedMotion || s.over ? 1 : 1 + Math.sin(time * 3) * 0.05;
    this.labelP0.scale.set(s.turn === 0 && !s.over ? breathe : 1);
    this.labelP1.scale.set(s.turn === 1 && !s.over ? breathe : 1);
  }

  private drawHighlight(s: TilesState): void {
    this.highlight.clear();
    if (s.over) return;
    for (let idx = 0; idx < s.legal.length; idx++) {
      if (!s.legal[idx]) continue;
      const { x, y } = this.cellCenter(idx, s.cols);
      drawDashedSquare(this.highlight, x, y, CELL - 12, PALETTE.gold);
    }
  }

  private syncDominoes(s: TilesState, time: number): void {
    const atlas = getAtlas();
    for (let i = this.lastDominoCount; i < s.dominoes.length; i++) {
      const d = s.dominoes[i];
      const c = dominoCenter(d, s.cols);
      const sprite = new Sprite(atlas.units.tile);
      sprite.anchor.set(0.5);
      // La texture `tile` est un CARRÉ qui contient deux demi-cases : étirée à
      // 1 case de large sur 2 de haut, chaque moitié redevient carrée.
      sprite.width = CELL - 14;
      sprite.height = (CELL - 14) * 2;
      sprite.rotation = d.owner === 0 ? 0 : Math.PI / 2;
      sprite.tint = d.owner === 0 ? PALETTE.sky : PALETTE.berry;
      sprite.position.set(this.boardX + c.x, BOARD_Y + c.y);
      this.dominoLayer.addChild(sprite);
      this.dominoSprites.push(sprite);
      this.baseScaleX.push(sprite.scale.x);
      this.baseScaleY.push(sprite.scale.y);
      this.placedAt.push(time);

      const star = bigText(d.starred ? '⭐' : '', 22, PALETTE.gold, '900');
      star.position.set(this.boardX + c.x, BOARD_Y + c.y - 12);
      this.dominoLayer.addChild(star);
      this.dominoStars.push(star);
    }
    this.lastDominoCount = s.dominoes.length;

    for (let i = 0; i < this.dominoSprites.length; i++) {
      const p = this.reducedMotion ? 1 : clamp((time - this.placedAt[i]) / POP_TIME, 0, 1);
      const pop = 0.5 + 0.5 * ease(p);
      this.dominoSprites[i].scale.set(this.baseScaleX[i] * pop, this.baseScaleY[i] * pop);
      this.dominoStars[i].alpha = ease(p);
    }
  }

  private drawPiles(s: TilesState): void {
    this.pilesLayer.clear();
    // Halo statique (jamais clignotant, §1.2) derrière la pile du joueur dont
    // c'est le tour : c'est la même règle que le liseré doré des boutons DOM,
    // redite ici pour qu'un enfant qui ne lit pas comprenne qui joue.
    const activeX = s.turn === 0 ? 150 : 390;
    if (!s.over) {
      this.pilesLayer
        .roundRect(activeX - 46, PILE_HALO_Y, 92, 916 - PILE_HALO_Y, 24)
        .fill({ color: PALETTE.gold, alpha: 0.1 });
    }

    this.drawPile(this.pilesLayer, 150, 860, s.stacks[0], true, PALETTE.sky);
    this.drawPile(this.pilesLayer, 390, 860, s.stacks[1], false, PALETTE.berry);

    const countP0 = `${s.stacks[0]} restantes · ${s.placed[0]} posées`;
    const countP1 = `${s.stacks[1]} restantes · ${s.placed[1]} posées`;
    if (this.countP0.text !== countP0) this.countP0.text = countP0;
    if (this.countP1.text !== countP1) this.countP1.text = countP1;
  }

  private drawPile(g: Graphics, x: number, baseY: number, count: number, vertical: boolean, tint: number): void {
    const capped = Math.min(count, PILE_DRAW_CAP);
    const w = vertical ? 34 : 62;
    const h = vertical ? 62 : 34;
    const step = 6;
    for (let i = 0; i < capped; i++) {
      const y = baseY - i * step;
      g.roundRect(x - w / 2, y - h, w, h, 6)
        .fill({ color: tint, alpha: 0.94 })
        .stroke({ width: 2, color: PALETTE.outline });
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/**
 * Carré en pointillé — « toutes les poses légales sont surlignées en
 * permanence (léger, pointillé) » (§3.4). Uniquement des `moveTo`/`lineTo` :
 * jamais `arc()` sans `moveTo` (piège vécu ailleurs dans le dépôt : dans
 * Pixi v8, il se relie au point courant du chemin resté à l'origine du monde
 * et trace une balafre en travers de l'écran).
 */
function drawDashedSquare(g: Graphics, cx: number, cy: number, size: number, color: number): void {
  const half = size / 2;
  const dash = 10;
  const gap = 7;
  const sides: [number, number, number, number][] = [
    [cx - half, cy - half, cx + half, cy - half],
    [cx + half, cy - half, cx + half, cy + half],
    [cx + half, cy + half, cx - half, cy + half],
    [cx - half, cy + half, cx - half, cy - half],
  ];
  for (const [x1, y1, x2, y2] of sides) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const steps = Math.max(1, Math.floor(len / (dash + gap)));
    for (let i = 0; i < steps; i++) {
      const sx = x1 + ux * i * (dash + gap);
      const sy = y1 + uy * i * (dash + gap);
      const ex = sx + ux * dash;
      const ey = sy + uy * dash;
      g.moveTo(sx, sy).lineTo(ex, ey);
    }
  }
  g.stroke({ width: 3, color });
}
