import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { TREE_FALL_SEC } from '../../config/balance';
import { getAtlas, PALETTE } from '../../render/textures';
import type { TreeEdgeData, TreeModel, TreeNodeData, TreeState } from './model';

/**
 * Vue de `tree`. Deux règles non négociables (pattern du dépôt) :
 *   ① elle ne MUTE jamais le modèle : elle le lit, point ;
 *   ② toute animation est une fonction CLOSE du temps écoulé (pattern de
 *      `mind/render/boardView.ts`) — un instant mémorisé (`fallAt[i]`), posé
 *      UNE fois à la détection d'une transition `alive → tombée`, et tout le
 *      reste s'en déduit. Rien à faire avancer, rien qui puisse rester bloqué
 *      en cours d'anim : sauter `time` de 3 s en avant donne directement
 *      l'arbre dans son état final.
 *
 * GÉOMÉTRIE : le modèle ne connaît que des positions ABSTRAITES (`depth`,
 * `slot` ∈ [0,1]) — c'est `layoutNodes` ci-dessous qui les convertit en pixels
 * logiques, et c'est la SEULE fonction qui le fait. `index.ts` l'appelle aussi
 * pour poser ses boutons transparents exactement sur les branches dessinées
 * ici : une seule formule, jamais deux qui pourraient dériver l'une de l'autre.
 */

const MARGIN_X = 56;
/** Le sol — toujours en bas, quelle que soit la profondeur de l'arbre. */
export const GROUND_Y = 740;
/** Sommet de la zone de branches (profondeur maximale). Laisse la place, au
 *  dessus, au bandeau DOM fixe du shell (`.hudbar`, ~68 px, z-index 20 — il se
 *  peint PAR-DESSUS le canvas) et à la ligne d'indice : ce qui serait dessiné
 *  plus haut disparaîtrait derrière lui, invisible à tout test qui ne regarde
 *  pas un vrai écran. */
const TOP_Y = 200;
const NODE_R = 6;
const APPLE_PX = 26;
const BASKET_PX = 80;
/**
 * LES PANIERS SONT POSÉS SUR LE SOL, pas en haut de l'écran. Trois raisons, et
 * la première suffit : une pomme TOMBE. Un panier au-dessus de l'arbre obligeait
 * les pommes à remonter l'écran — le contraire de ce que le jeu enseigne sans un
 * mot (§1.1 critère 1), et le contraire de ce qu'un enfant de 5 ans attend d'un
 * fruit coupé. Ensuite, la bande de sol était 220 px de brun vide alors que
 * l'arbre s'écrasait dans les deux tiers du haut. Enfin, l'objet-but reste
 * visible EN PERMANENCE (critère 3) sans jamais approcher du bandeau du shell.
 */
const BASKET_Y = 820;
const BASKET_MARGIN = 70;
/** Ligne d'indice, sous le bandeau du shell et au-dessus de la cime. */
const HINT_Y = 96;

export function layoutNodes(nodes: readonly TreeNodeData[], w: number): readonly { x: number; y: number }[] {
  const maxDepth = Math.max(1, ...nodes.map((n) => n.depth));
  return nodes.map((n) => ({
    x: MARGIN_X + n.slot * (w - 2 * MARGIN_X),
    y: n.depth === 0 ? GROUND_Y : GROUND_Y - (n.depth / maxDepth) * (GROUND_Y - TOP_Y),
  }));
}

function basketX(player: 0 | 1, w: number): number {
  return player === 0 ? BASKET_MARGIN : w - BASKET_MARGIN;
}

/**
 * CONTRASTES CALCULÉS, jamais jugés à l'œil (§5, WCAG 1.4.11 : ≥ 3:1 pour un
 * élément porteur d'information) — sur le fond `bg` du canvas :
 *   bleu `sky` 7,9:1 · violet `plum` 3,2:1 · marron `panelEdge` 5,4:1.
 * Le marron était `goldDark` (2,35:1) : il ÉCHOUAIT, et sa luminance (0,13)
 * était en plus voisine de celle du violet (0,20), donc les deux branches se
 * confondaient en niveaux de gris. `panelEdge` (0,37) les sépare aussi là.
 * La couleur n'est de toute façon jamais seule : chaque branche porte un
 * marqueur de FORME (disque / losange / carré, voir `renderEdge`).
 */
function edgeColorHex(color: 0 | 1 | 2): number {
  return color === 0 ? PALETTE.sky : color === 1 ? PALETTE.plum : PALETTE.panelEdge;
}

function easeIn(p: number): number {
  return p * p;
}

interface AppleSlot {
  edgeId: number;
  x: number;
  y: number;
  sprite: Sprite;
}

export class TreeView {
  readonly root = new Container();
  private readonly ground = new Graphics();
  private readonly branches = new Graphics();
  private readonly nodeDots = new Graphics();
  private readonly appleLayer = new Container();
  private readonly hint: Text;
  private readonly basketCount: [Text, Text];
  private readonly basketTokens: [Text, Text];
  private readonly basketSprites: [Sprite, Sprite];

  private readonly nodePx: readonly { x: number; y: number }[];
  private readonly apples: AppleSlot[] = [];

  /** Un instant de chute par arête, `null` = vivante ou déjà entièrement tombée. */
  private readonly fallAt: (number | null)[];
  /** Le panier qui reçoit la chute de cette arête (figé au moment de la chute). */
  private readonly fallTo: (0 | 1 | null)[];
  private readonly wasAlive: boolean[];
  private readonly lastBaskets: [number, number] = [0, 0];
  private lastHint = '';
  private popAt: [number, number] = [-Infinity, -Infinity]; // rebond du panier au gain

  constructor(
    parent: Container,
    private readonly model: TreeModel,
    private readonly w: number,
    private readonly h: number,
    private readonly reducedMotion: boolean,
  ) {
    const s = model.state;
    this.nodePx = layoutNodes(s.nodes, w);
    this.fallAt = s.edges.map(() => null);
    this.fallTo = s.edges.map(() => null);
    this.wasAlive = s.alive.slice();
    this.lastBaskets = [...s.baskets];

    const atlas = getAtlas();

    // Bandeau DOM fixe (~78 px) au-dessus : le titre/l'indice vivent SOUS lui.
    this.hint = bigText('', 19, PALETTE.dim);
    this.hint.position.set(w / 2, HINT_Y);

    this.basketSprites = [new Sprite(atlas.units.basket), new Sprite(atlas.units.basket)];
    this.basketCount = [bigText('0', 22, PALETTE.cream), bigText('0', 22, PALETTE.cream)];
    this.basketTokens = [bigText('', 20, PALETTE.gold), bigText('', 20, PALETTE.gold)];
    for (const p of [0, 1] as const) {
      const bx = basketX(p, w);
      const sprite = this.basketSprites[p];
      sprite.anchor.set(0.5);
      sprite.width = BASKET_PX;
      sprite.height = BASKET_PX;
      sprite.position.set(bx, BASKET_Y);
      // Empilé SOUS le panier : le compte d'abord, les jetons ✂ ensuite —
      // 820 + 40 + 4 = 864, puis 890, tout tient dans les 960 px logiques.
      this.basketCount[p].position.set(bx, BASKET_Y + BASKET_PX / 2 + 4);
      this.basketTokens[p].position.set(bx, BASKET_Y + BASKET_PX / 2 + 30);
    }

    // Un sprite de pomme PAR pomme déclarée à la génération : le compte est
    // FIXE pour toute la manche (les arêtes ne changent jamais, seule `alive`
    // bouge), donc on les crée une seule fois ici, jamais au tick.
    for (const e of s.edges) {
      const a = this.nodePx[e.a];
      const b = this.nodePx[e.b];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      for (let k = 0; k < e.apples; k++) {
        const t = e.apples === 1 ? 0.55 : k === 0 ? 0.4 : 0.68;
        const off = e.apples === 1 ? 0 : k === 0 ? -9 : 9;
        const sprite = new Sprite(atlas.units.apple);
        sprite.anchor.set(0.5);
        sprite.width = APPLE_PX;
        sprite.height = APPLE_PX;
        this.appleLayer.addChild(sprite);
        this.apples.push({ edgeId: e.id, x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off, sprite });
      }
    }

    this.root.addChild(
      this.ground,
      this.branches,
      this.nodeDots,
      this.appleLayer,
      this.hint,
      this.basketSprites[0],
      this.basketSprites[1],
      this.basketCount[0],
      this.basketCount[1],
      this.basketTokens[0],
      this.basketTokens[1],
    );
    parent.addChild(this.root);
  }

  /** Détecte les transitions `alive → tombée` et fige, pour chaque arête qui
   *  vient de tomber, l'INSTANT de la chute et le panier destinataire (déduit
   *  du panier qui vient de grossir — un seul joueur gagne par coup). Ne mute
   *  jamais le modèle, et il est IDEMPOTENT : deux appels de suite sur le même
   *  état ne latchent qu'une fois.
   *
   *  PUBLIC, et appelé aussi depuis `update()` : le verrou doit tomber au TICK
   *  de la coupe, pas à la frame qui peint. Sinon l'instant de départ de la
   *  chute dépend de la cadence d'affichage (une frame lente avale deux ou
   *  trois pas de simulation avant de rendre), et la MÊME démonstration rejouée
   *  deux fois ne donne pas la même image au même pas — mesuré sur les
   *  vignettes du menu (§8.8) : `tree` était le seul des huit à échouer, aux
   *  0,75 s de chute près. */
  detectFalls(s: TreeState, time: number): void {
    // Le panier destinataire est celui qui vient de GROSSIR — les deux tests,
    // pas seulement le premier : une coupe sans pomme ne fait grossir aucun
    // panier, et « sinon c'est 1 » faisait alors rebondir le panier de l'AUTRE
    // joueur, qui n'avait rien reçu. Pas de gain ⇒ pas de destinataire, donc
    // pas de rebond (et aucune pomme à router : elles sont ce qui fait grossir).
    const dest: 0 | 1 | null =
      s.baskets[0] > this.lastBaskets[0] ? 0 : s.baskets[1] > this.lastBaskets[1] ? 1 : null;
    let fell = false;
    for (const e of s.edges) {
      if (this.wasAlive[e.id] && !s.alive[e.id]) {
        fell = true;
        this.fallAt[e.id] = time;
        this.fallTo[e.id] = dest;
      }
    }
    if (fell && dest !== null) this.popAt[dest] = time; // le panier destinataire rebondit
    // Recopie EN PLACE : `detectFalls` tourne à chaque frame, et la règle du
    // dépôt est de ne rien allouer dans une boucle de 60 Hz.
    for (let i = 0; i < s.alive.length; i++) this.wasAlive[i] = s.alive[i];
    this.lastBaskets[0] = s.baskets[0];
    this.lastBaskets[1] = s.baskets[1];
  }

  render(time: number): void {
    const s = this.model.state;
    this.detectFalls(s, time);

    this.ground.clear();
    this.ground.rect(0, GROUND_Y, this.w, this.h - GROUND_Y).fill(PALETTE.panel);
    this.ground.rect(0, GROUND_Y - 5, this.w, 5).fill(PALETTE.panelEdge);

    const hintText = s.over ? '' : `${colorEmoji(s.turn)} à ${s.turn === 0 ? 'bleu' : 'violet'} de couper`;
    if (hintText !== this.lastHint) {
      this.lastHint = hintText;
      this.hint.text = hintText;
    }

    this.branches.clear();
    for (const e of s.edges) this.renderEdge(e, s, time);

    this.nodeDots.clear();
    for (let i = 1; i < this.nodePx.length; i++) {
      // Ne dessine que les nœuds encore reliés à au moins une arête vivante,
      // sinon un point orphelin flotterait sans branche (lisible comme un bug).
      const p = this.nodePx[i];
      if (s.edges.some((e) => (e.a === i || e.b === i) && s.alive[e.id])) {
        this.nodeDots.circle(p.x, p.y, NODE_R).fill(PALETTE.dim);
      }
    }

    for (const player of [0, 1] as const) {
      const bounce = this.reducedMotion ? 0 : Math.max(0, 1 - (time - this.popAt[player]) / 0.3);
      const scale = 1 + Math.max(0, bounce) * 0.22;
      this.basketSprites[player].scale.set(scale);
      const countText = `${s.baskets[player]} 🍎`;
      if (this.basketCount[player].text !== countText) this.basketCount[player].text = countText;
      const tokens = s.extraCuts[player];
      const tokenText = tokens > 0 ? '✂️'.repeat(tokens) : '';
      if (this.basketTokens[player].text !== tokenText) this.basketTokens[player].text = tokenText;
    }

    this.renderApples(s, time);
  }

  private renderEdge(e: TreeEdgeData, s: TreeState, time: number): void {
    const alive = s.alive[e.id];
    const fallAt = this.fallAt[e.id];
    if (!alive && fallAt === null) return; // déjà entièrement tombée : plus rien à dessiner

    let p = 0;
    if (!alive) {
      p = clamp((time - (fallAt ?? time)) / TREE_FALL_SEC, 0, 1);
      if (p >= 1) {
        this.fallAt[e.id] = null; // fin de chute : ne plus jamais la redessiner
        return;
      }
    }

    const a0 = this.nodePx[e.a];
    const b0 = this.nodePx[e.b];
    // Chute franche : le point proche du sol reste (presque) fixe, le point
    // loin du sol part vers le bas avec un léger balayage — ça se lit comme
    // une rotation sans qu'on ait à faire tourner un tracé.
    //
    // MOUVEMENT RÉDUIT (§5) : on retire le BALAYAGE latéral et on écourte la
    // course, on garde la chute et le fondu sur la MÊME durée. Escamoter la
    // branche d'une frame à l'autre (ce que faisait `p = 1` d'emblée)
    // AMPUTAIT l'information « ce que tu viens de couper tombe et part dans
    // ton panier » — précisément ce que le jeu enseigne sans un mot.
    const rm = this.reducedMotion;
    const drop = 190 * easeIn(p) * (rm ? 0.3 : 1);
    const ax = a0.x + (rm ? 0 : 8 * p);
    const ay = a0.y + drop * 0.2;
    const bx = b0.x + (rm ? 0 : 44 * p);
    const by = b0.y + drop;
    const alpha = 1 - p;

    const color = edgeColorHex(e.color);
    const width = e.color === 2 ? 8 : 6;
    this.branches.moveTo(ax, ay).lineTo(bx, by).stroke({ width, color, alpha });

    // Marqueur de forme au milieu de la branche — DEUXIÈME code, indépendant
    // de la teinte (§5 : jamais la couleur seule). Disque = joueur 0, losange
    // = joueur 1, carré = marron (coupable des deux).
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    if (e.color === 0) {
      this.branches.circle(mx, my, 9).fill({ color, alpha }).stroke({ width: 2, color: PALETTE.outline, alpha });
    } else if (e.color === 1) {
      this.branches
        .poly([mx, my - 10, mx + 10, my, mx, my + 10, mx - 10, my])
        .fill({ color, alpha })
        .stroke({ width: 2, color: PALETTE.outline, alpha });
    } else {
      this.branches
        .rect(mx - 8, my - 8, 16, 16)
        .fill({ color, alpha })
        .stroke({ width: 2, color: PALETTE.outline, alpha });
    }
  }

  private renderApples(s: TreeState, time: number): void {
    for (const slot of this.apples) {
      const alive = s.alive[slot.edgeId];
      const fallAt = this.fallAt[slot.edgeId];
      if (!alive && fallAt === null) {
        slot.sprite.visible = false;
        continue;
      }
      if (alive) {
        slot.sprite.visible = true;
        slot.sprite.position.set(slot.x, slot.y);
        slot.sprite.alpha = 1;
        continue;
      }
      // La pomme REBONDIT vers le panier destinataire — c'est la récompense
      // du jeu (§3.3), distincte de la simple chute de la branche. En mouvement
      // réduit on garde le TRAJET (c'est lui qui dit à qui va la pomme) et on
      // enlève l'arc : le geste est amorti, jamais supprimé (§5).
      const dest = this.fallTo[slot.edgeId];
      const p = clamp((time - (fallAt ?? time)) / TREE_FALL_SEC, 0, 1);
      if (p >= 1 || dest === null) {
        slot.sprite.visible = false;
        continue;
      }
      slot.sprite.visible = true;
      const tx = basketX(dest, this.w);
      const ty = BASKET_Y;
      const arc = this.reducedMotion ? 0 : Math.sin(p * Math.PI) * 46;
      slot.sprite.position.set(slot.x + (tx - slot.x) * easeIn(p), slot.y + (ty - slot.y) * easeIn(p) - arc);
      slot.sprite.alpha = 1 - p * 0.2;
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

function colorEmoji(player: 0 | 1): string {
  return player === 0 ? '🔵' : '🟣';
}

function bigText(text: string, size: number, fill: number): Text {
  const t = new Text({
    text,
    style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fontWeight: '800', fill },
  });
  t.anchor.set(0.5, 0);
  return t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
