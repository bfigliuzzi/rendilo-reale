import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { CAKE_ANGLE_STEPS, CAKE_HANDLE_R, CAKE_RADIUS } from '../../config/balance';
import { getAtlas, PALETTE } from '../../render/textures';
import {
  countOf,
  fruitEmoji,
  handlePoint,
  preferredKind,
  sideOfCut,
  type CakeState,
  type Fruit,
} from './model';
import type { CakeModel } from './model';

/**
 * Vue de `cake`. Deux règles non négociables (pattern du dépôt) :
 *   ① elle ne MUTE jamais le modèle : elle le lit, point ;
 *   ② toute animation est une fonction CLOSE du temps écoulé — un instant
 *      mémorisé (`splitAt`) posé UNE fois à la détection d'une transition, et
 *      tout le reste s'en déduit. Rien à faire avancer, rien qui puisse rester
 *      bloqué en cours d'anim.
 *
 * ÉCART ASSUMÉ AU TEXTE DE LA SPEC (« il fait glisser une droite matérialisée
 * par deux grosses poignées ») : les deux poignées avancent par CRANS au tap,
 * pas par un drag continu de pointeur. `MiniGameCtx` ne donne à un micro-jeu
 * ni le facteur d'échelle du letterbox ni la position du canvas à l'écran —
 * seul le shell les connaît (`core/shell.ts`) — donc reconstruire un drag
 * fidèle depuis `pointermove` re-détaillerait cette traduction dans huit
 * jeux différents. Le cran-au-tap est un VRAI `<button>` : Entrée/Espace le
 * déclenche comme un clic, donc `cake` reste l'un des cinq jeux `pass`
 * intégralement jouables au clavier seul (§5) sans code clavier dédié. Les
 * deux poignées restent bien visibles ET ≥ 60 px (elles sont peintes ici,
 * les boutons qui les font avancer sont posés par `index.ts`).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE BUT EST UN OBJET VISIBLE EN PERMANENCE (§1.1 critère 3)
 *
 * Deux paniers en haut, un par siège : le fruit que ce joueur AIME, et le
 * nombre qu'il en a déjà ramassé depuis le début de la manche. Ils se
 * remplissent coupe après coupe — c'est ça, le score, pas une condition
 * abstraite. Le panier du joueur qui doit jouer porte en plus le geste attendu
 * (✂️ couper / 👉 choisir) et un liseré épais : jamais la couleur seule.
 *
 * Et les DEUX PASTILLES DE COMPTE sont posées SUR leur part, au barycentre
 * exact du segment de disque (`segmentCentroidDist`), pas à gauche et à droite
 * de l'écran. C'est le défaut qui rendait le critère faux dans la version
 * précédente : les parts sont « à gauche/à droite de la corde ORIENTÉE », ce
 * qui n'a aucun rapport avec la gauche et la droite de l'écran — un enfant
 * lisait donc régulièrement le compte de l'autre part. Chaque pastille porte
 * la FORME de sa part (▲ / ■), reprise à l'identique sur les deux boutons de
 * choix : c'est ce qui permet d'apparier la part et le bouton sans lire.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Marques des deux parts. Une FORME, jamais une couleur : elles se lisent en
 *  niveaux de gris et sont reprises telles quelles sur les boutons DOM. */
export const PIECE_MARK = ['▲', '■'] as const;
/** Les mêmes, en toutes lettres pour les `aria-label` et les régions live. */
export const PIECE_NAME = ['triangle', 'carré'] as const;

const FRUIT_PX = 30;
/** Écart visuel entre les deux parts une fois la coupe validée (px). */
const SPLIT_GAP = 18;
/** Durée du « pop » de séparation — pure vue, aucune règle n'en dépend. */
const POP_TIME = 0.35;

const CX = 270;
/**
 * Le gâteau est descendu à 378 (et non centré à 350) pour UNE raison mesurée à
 * la capture d'écran : le bandeau de table (`.hudbar`) vit en ESPACE ÉCRAN,
 * collé en haut, et vient donc recouvrir les premiers pixels LOGIQUES du jeu —
 * il mangeait le compteur de coupes et l'étoile du panier aidé. Tout ce qui
 * porte de l'information reste sous y = 70, et les boutons de `index.ts`
 * descendent d'autant (leurs coordonnées sont commentées là-bas).
 */
const CY = 378;

/** Les pastilles restent à cette distance max du centre : au ras du bord, un
 *  barycentre de segment très fin sortirait du gâteau. */
const CHIP_MAX_R = CAKE_RADIUS - 44;

function ease(p: number): number {
  return 1 - (1 - p) * (1 - p);
}

/**
 * Distance du CENTRE du disque au barycentre du segment circulaire
 * `{ P·n ≥ h }`, pour un disque de rayon `CAKE_RADIUS`. Formule exacte du
 * barycentre d'un segment : `(2/3)·(R²−h²)^{3/2} / aire`. C'est elle qui pose
 * la pastille de compte AU MILIEU de la part qu'elle décrit, quelle que soit
 * la corde — y compris quand une part est un mince croissant collé au bord.
 */
function segmentCentroidDist(h: number): number {
  const R = CAKE_RADIUS;
  const hc = Math.max(-R, Math.min(R, h));
  const s = Math.sqrt(Math.max(0, R * R - hc * hc));
  const area = R * R * Math.acos(hc / R) - hc * s;
  if (area <= 1e-6) return R;
  return ((2 / 3) * s * s * s) / area;
}

export class CakeView {
  readonly root = new Container();
  private readonly disk = new Graphics();
  private readonly ticks = new Graphics();
  private readonly line = new Graphics();
  private readonly handleA = new Container();
  private readonly handleB = new Container();
  private readonly progress: Text;
  private readonly hint: Text;
  private readonly baskets: readonly BasketView[];
  private readonly chips: readonly ChipView[];
  private readonly fruitLayer = new Container();
  private fruitSprites: Sprite[] = [];
  private shownFruits: readonly Fruit[] | null = null;

  private lastCutIndex = -1;
  private lastPhase: CakeState['phase'] | null = null;
  private splitAt: number | null = null;

  constructor(
    parent: Container,
    private readonly model: CakeModel,
    private readonly reducedMotion: boolean,
  ) {
    this.disk
      .circle(0, 0, CAKE_RADIUS)
      .fill(PALETTE.panel)
      .stroke({ width: 4, color: PALETTE.panelEdge });
    this.disk.position.set(CX, CY);

    for (let i = 0; i < CAKE_ANGLE_STEPS; i++) {
      const angle = (i * Math.PI * 2) / CAKE_ANGLE_STEPS;
      const p1 = handlePoint(angle);
      // Petit trait vers le bord, à 93 % du rayon : montre les crans où une
      // poignée peut se poser, sans dessiner un vrai marqueur par cran.
      this.ticks
        .moveTo(p1.x * 0.93, p1.y * 0.93)
        .lineTo(p1.x, p1.y)
        .stroke({ width: 3, color: PALETTE.panelEdge, alpha: 0.5 });
    }
    this.ticks.position.set(CX, CY);

    // CONTRASTES CALCULÉS, pas jugés à l'œil (§5) : sur le gâteau (`panel`),
    // `plum` ne donnait que 2,49:1 — sous le 3:1 exigé d'un élément porteur
    // d'information. `sky` (6,06:1) et `berry` (3,82:1) passent, et leurs
    // lettres en `outline` donnent 9,58:1 et 6,04:1. La FORME (disque /
    // losange) et la lettre restent de toute façon les codes primaires.
    this.handleA.addChild(makeHandle('disc', PALETTE.sky, 'A'));
    this.handleB.addChild(makeHandle('diamond', PALETTE.berry, 'B'));

    // Sous le bandeau de table, et dans la bande LIBRE entre les deux paniers
    // (x 180-360) : ni l'un ni l'autre ne peut recouvrir un compte.
    this.progress = bigText('', 20, PALETTE.cream);
    this.progress.position.set(270, 74);
    this.hint = bigText('', 15, PALETTE.dim);
    this.hint.position.set(270, 104);

    this.baskets = [new BasketView(0, 14), new BasketView(1, 362)];
    this.chips = [new ChipView(0), new ChipView(1)];

    this.root.addChild(
      this.disk,
      this.ticks,
      this.fruitLayer,
      this.line,
      this.chips[0].root,
      this.chips[1].root,
      this.handleA,
      this.handleB,
      this.progress,
      this.hint,
      this.baskets[0].root,
      this.baskets[1].root,
    );
    parent.addChild(this.root);
  }

  render(time: number): void {
    const s = this.model.state;

    // Les transitions se lisent AVANT tout le reste, et `splitAt` n'est remis
    // à zéro qu'au retour en phase 'cut' : le remettre à zéro sur le simple
    // changement de `cutIndex` refermait le gâteau à la dernière coupe, pile
    // pendant le délai où la CAUSE de la victoire doit rester visible (§1.1
    // critère 4, et le RESULT_DELAY_SEC du shell).
    if (s.phase !== this.lastPhase) {
      if (s.phase === 'choose') this.splitAt = time;
      else if (s.phase === 'cut') this.splitAt = null;
      this.lastPhase = s.phase;
    }
    if (s.cutIndex !== this.lastCutIndex) {
      this.lastCutIndex = s.cutIndex;
      this.rebuildFruits(s.fruits);
    }

    const progressText = `Coupe ${Math.min(s.cutIndex + 1, s.totalCuts)} sur ${s.totalCuts}`;
    if (this.progress.text !== progressText) this.progress.text = progressText;

    const hintText = s.phase === 'cut' ? '✂️ coupe la corde' : s.phase === 'choose' ? '👉 prends une part' : '';
    if (this.hint.text !== hintText) this.hint.text = hintText;

    // Le BUT, en permanence : deux paniers qui se remplissent (§1.1 critère 3).
    const active = s.phase === 'cut' ? s.cutter : s.phase === 'choose' ? s.chooser : null;
    this.baskets[0].sync(s, active);
    this.baskets[1].sync(s, active);

    // Poignées + corde : toujours visibles, même en phase 'choose' — la
    // coupe validée reste affichée pendant que le choisisseur décide.
    const a = handlePoint(s.angleA);
    const b = handlePoint(s.angleB);
    this.handleA.position.set(CX + a.x, CY + a.y);
    this.handleB.position.set(CX + b.x, CY + b.y);
    this.line.clear();
    this.line
      .moveTo(CX + a.x, CY + a.y)
      .lineTo(CX + b.x, CY + b.y)
      .stroke({ width: 5, color: PALETTE.cream });

    // Séparation des parts : fonction close de (time − splitAt), jamais un
    // état qu'on ferait avancer — sauter 3 s en avant donnerait directement
    // l'écart final.
    let p = 0;
    if (this.splitAt !== null) {
      p = this.reducedMotion ? 1 : clamp((time - this.splitAt) / POP_TIME, 0, 1);
    }
    const offset = SPLIT_GAP * ease(p);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // `n` pointe vers la part 0 : `sideOfCut` renvoie 0 exactement pour
    // { P·n ≥ h }, avec h la distance signée du centre à la corde (démontré
    // en fuzz contre une réimplémentation indépendante).
    const nx = -dy / len;
    const ny = dx / len;
    const h = a.x * nx + a.y * ny;

    for (let i = 0; i < s.fruits.length; i++) {
      const f = s.fruits[i];
      const sprite = this.fruitSprites[i];
      if (!sprite) continue;
      const side = sideOfCut(s.angleA, s.angleB, f.x, f.y);
      const sign = side === 0 ? 1 : -1;
      sprite.position.set(CX + f.x + nx * offset * sign, CY + f.y + ny * offset * sign);
    }

    // Chaque pastille au barycentre de SA part, décalée du même « pop ».
    const parts = liveSides(s);
    for (const side of [0, 1] as const) {
      const sign = side === 0 ? 1 : -1;
      const d = Math.min(CHIP_MAX_R, segmentCentroidDist(sign * h)) + offset;
      this.chips[side].sync(parts[side], CX + nx * sign * d, CY + ny * sign * d);
    }
  }

  private rebuildFruits(fruits: readonly Fruit[]): void {
    if (this.shownFruits === fruits) return;
    this.shownFruits = fruits;
    for (const sp of this.fruitSprites) sp.destroy();
    this.fruitSprites = [];
    const atlas = getAtlas();
    for (const f of fruits) {
      const tex = f.kind === 'strawberry' ? atlas.units.strawberry : atlas.units.blueberry;
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.width = FRUIT_PX;
      sprite.height = FRUIT_PX;
      this.fruitLayer.addChild(sprite);
      this.fruitSprites.push(sprite);
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/**
 * Un panier par siège : le fruit que ce joueur aime, le nombre qu'il en a
 * ramassé, son ⭐ s'il est aidé, et le GESTE attendu quand c'est à lui.
 * Trois codes redondants pour « c'est à toi » : le liseré épais doré, le
 * pictogramme du geste, et l'opacité du panier inactif.
 */
class BasketView {
  readonly root = new Container();
  private readonly plate = new Graphics();
  private readonly score: Text;
  private readonly star: Text;
  private readonly turn: Text;
  private lastActive: boolean | null = null;

  constructor(
    private readonly seat: 0 | 1,
    x: number,
  ) {
    const atlas = getAtlas();
    this.root.position.set(x, 70);

    const basket = new Sprite(atlas.units.basket);
    basket.anchor.set(0.5);
    basket.width = 46;
    basket.height = 46;
    basket.position.set(38, 54);

    const kind = preferredKind(seat);
    const fruit = new Sprite(
      kind === 'strawberry' ? atlas.units.strawberry : atlas.units.blueberry,
    );
    fruit.anchor.set(0.5);
    fruit.width = 26;
    fruit.height = 26;
    fruit.position.set(38, 24);

    // `cream` sur `bgDeep` = 14,6:1 : le seul chiffre que l'enfant compare.
    this.score = new Text({
      text: '0',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 36, fontWeight: '900', fill: PALETTE.cream },
    });
    this.score.anchor.set(0.5);
    this.score.position.set(96, 42);

    this.star = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 18, fontWeight: '900', fill: PALETTE.gold },
    });
    this.star.anchor.set(1, 0);
    this.star.position.set(156, 4);

    this.turn = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '900', fill: PALETTE.gold },
    });
    this.turn.anchor.set(1, 1);
    this.turn.position.set(156, 78);

    this.root.addChild(this.plate, basket, fruit, this.score, this.star, this.turn);
  }

  sync(s: CakeState, active: 0 | 1 | null): void {
    const isActive = active === this.seat;
    if (isActive !== this.lastActive) {
      this.lastActive = isActive;
      this.plate.clear();
      this.plate
        .roundRect(0, 0, 164, 84, 14)
        .fill({ color: PALETTE.bgDeep, alpha: isActive ? 1 : 0.82 })
        .stroke({ width: isActive ? 5 : 2, color: isActive ? PALETTE.gold : PALETTE.panelEdge });
    }
    const n = `${s.scores[this.seat]}`;
    if (this.score.text !== n) this.score.text = n;
    const star = s.helped === this.seat ? '⭐' : '';
    if (this.star.text !== star) this.star.text = star;
    const turn = !isActive ? '' : s.phase === 'cut' ? '✂️' : s.phase === 'choose' ? '👉' : '';
    if (this.turn.text !== turn) this.turn.text = turn;
  }
}

/** La pastille de compte d'UNE part, posée sur la part elle-même. */
class ChipView {
  readonly root = new Container();
  private readonly text: Text;

  constructor(side: 0 | 1) {
    const plate = new Graphics();
    // 154 px de large : mesuré à la capture, « 🍓3 🫐3 » débordait d'une
    // plaque de 132 — un compte à moitié posé sur le gâteau est illisible.
    plate
      .roundRect(-77, -20, 154, 40, 12)
      .fill({ color: PALETTE.bgDeep, alpha: 0.94 })
      .stroke({ width: 2, color: PALETTE.panelEdge });
    // La FORME de la part, dessinée et non colorée : reprise à l'identique sur
    // le bouton de choix correspondant.
    const mark = new Graphics();
    if (side === 0) mark.poly([-64, 9, -52, -11, -40, 9]).fill(PALETTE.cream);
    else mark.rect(-63, -10, 21, 21).fill(PALETTE.cream);

    this.text = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 20, fontWeight: '900', fill: PALETTE.cream },
    });
    this.text.anchor.set(0, 0.5);
    this.text.position.set(-32, 0);

    this.root.addChild(plate, mark, this.text);
  }

  sync(fruits: readonly Fruit[], x: number, y: number): void {
    this.root.position.set(x, y);
    const t = countLabel(fruits);
    if (this.text.text !== t) this.text.text = t;
  }
}

function liveSides(s: CakeState): [readonly Fruit[], readonly Fruit[]] {
  if (s.pieces) return [s.pieces[0], s.pieces[1]];
  const side0: Fruit[] = [];
  const side1: Fruit[] = [];
  for (const f of s.fruits) {
    (sideOfCut(s.angleA, s.angleB, f.x, f.y) === 0 ? side0 : side1).push(f);
  }
  return [side0, side1];
}

function countLabel(fruits: readonly Fruit[]): string {
  return `${fruitEmoji('strawberry')}${countOf(fruits, 'strawberry')} ${fruitEmoji('blueberry')}${countOf(fruits, 'blueberry')}`;
}

function makeHandle(shape: 'disc' | 'diamond', color: number, letter: string): Container {
  const c = new Container();
  const g = new Graphics();
  const r = CAKE_HANDLE_R;
  if (shape === 'disc') {
    g.circle(0, 0, r).fill(color).stroke({ width: 3, color: PALETTE.outline });
  } else {
    g.poly([0, -r, r, 0, 0, r, -r, 0])
      .fill(color)
      .stroke({ width: 3, color: PALETTE.outline });
  }
  const t = new Text({
    text: letter,
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '900', fill: PALETTE.outline },
  });
  t.anchor.set(0.5);
  c.addChild(g, t);
  return c;
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
