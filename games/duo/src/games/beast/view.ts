import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { BEAST_TURNS, PASS_W } from '../../config/balance';
import { getAtlas, PALETTE } from '../../render/textures';
import { rowColOf, tierBars, tierEmoji, type BeastModel, type BeastState, type RevealedCell } from './model';

/**
 * Vue de `beast`. Deux règles non négociables (pattern du dépôt) :
 *   ① elle ne MUTE jamais le modèle : elle le lit, point ;
 *   ② toute animation est une fonction CLOSE du temps écoulé (pattern de
 *      `mind/render/boardView.ts`) — un instant mémorisé posé UNE fois à
 *      l'apparition d'un changement, tout le reste s'en déduit.
 *
 * RÈGLE DE SECRET, propre à ce jeu : la position de la bête n'est dessinée
 * QUE quand `state.phase === 'beast'` (son propre tour). La dessiner pendant
 * le tour du chasseur trahirait la cachette à l'écran que ce dernier regarde
 * — la vue est la SEULE ligne de défense de ce secret, le modèle expose bien
 * `beastIdx` en permanence (il en a besoin pour calculer les thermomètres).
 *
 * Le canvas est purement décoratif (`aria-hidden`, cf. `index.ts` qui pose les
 * vrais `<button>`) : tout ce qui est dessiné ici est un RENFORT visuel de ce
 * que les boutons DOM garantissent déjà (légalité, focus), jamais la seule
 * source de vérité.
 */

export const CELL = 76;
export const BOARD_Y = 176;

const STAR_TINT = PALETTE.gold;
/** Couleurs locales du thermomètre — le codage complet est couleur ET
 *  pictogramme (`tierEmoji`) ET barres (`tierBars`), jamais la couleur seule. */
const TIER_COLOR = { hot: PALETTE.berry, mild: PALETTE.gold, cold: PALETTE.sky } as const;

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

export function boardX(cols: number): number {
  return (PASS_W - cols * CELL) / 2;
}

export function cellCenter(idx: number, cols: number): { x: number; y: number } {
  const [r, c] = rowColOf(idx, cols);
  return { x: boardX(cols) + c * CELL + CELL / 2, y: BOARD_Y + r * CELL + CELL / 2 };
}

export class BeastView {
  readonly root = new Container();
  private readonly staticLayer = new Graphics(); // panneau + cases + bande d'arrivée : peints une fois
  private readonly revealLayer = new Graphics(); // mémoire du chasseur : redessinée à chaque frame
  private readonly revealGlyphs = new Container(); // pictogrammes du thermomètre — deuxième codage
  private readonly selectLayer = new Graphics(); // cases armées : redessinée à chaque frame
  private readonly beastSprite: Sprite;
  private readonly hint: Text;
  private readonly barBack = new Graphics();
  private readonly barFill = new Graphics();
  private readonly barLabel: Text;
  private readonly barStar: Text;
  /** §1.3 — LE handicap est un OBJET VISIBLE : autant de lampes que le chasseur
   *  a de cases à éclairer, la quatrième marquée ⭐. Un enfant compte des
   *  lampes ; il ne lit pas « le chasseur éclaire une case de plus ». */
  private readonly lampLayer = new Graphics();
  private readonly lampStar: Text;
  private readonly seatLabels: [Text, Text];
  /** Moitié dont les instants d'apparition ci-dessous sont datés : au
   *  changement de moitié les tours repartent à 0 et une case ré-éclairée au
   *  même numéro de tour ne rejouerait jamais son « pop ». */
  private shownHalf: 0 | 1 = 0;

  /** Instants d'apparition d'une lecture (fonction close du temps, jamais un
   *  compteur qui avance) : `time - poppedAt[idx]` donne la progression du
   *  petit « pop » sans aucun état à faire avancer. */
  private readonly poppedAt = new Map<number, number>();
  private readonly knownTurn = new Map<number, number>();
  /** Pool paresseux de pictogrammes par case (créés une fois, jamais recréés
   *  ni détruits en cours de manche) : le DEUXIÈME codage du thermomètre,
   *  jamais la couleur seule (§5). */
  private readonly glyphByIdx = new Map<number, Text>();

  constructor(
    parent: Container,
    private readonly model: BeastModel,
    private readonly reducedMotion: boolean,
  ) {
    const s = model.state;

    // EN-TÊTE : tout commence à y ≥ 70. Le bandeau de table (`.hudbar`) est
    // en espace ÉCRAN, collé en haut de la fenêtre, et sur un téléphone en
    // portrait le letterbox met le repère logique plein cadre : il recouvre
    // donc les ~64 premiers pixels logiques. Le titre du jeu et le badge ⭐
    // textuels vivaient dessous, illisibles — mesuré à la capture d'écran, pas
    // au raisonnement. Le titre a été RETIRÉ (il est déjà sur l'écran de
    // passage et sur celui de résultat) et le badge ⭐ remplacé par des OBJETS
    // (la lampe étoilée, le repère de la barre, l'étoile du siège) — ce que le
    // §1.3 demandait de toute façon.
    this.hint = bigText('', 16, PALETTE.dim, '700');
    this.hint.position.set(PASS_W / 2, 70);

    this.barLabel = bigText('', 15, PALETTE.dim, '700');
    this.barLabel.position.set(PASS_W / 2, 92);
    // ⭐ posée au BOUT de la barre : les tours en plus de la bête aidée se
    // voient comme un morceau de barre en plus, pas comme une phrase.
    this.barStar = bigText('', 15, PALETTE.gold, '900');
    this.barStar.position.set(boardX(s.cols) + s.cols * CELL + 4, 108);
    this.barStar.anchor.set(0, 0);
    this.lampStar = bigText('⭐', 14, PALETTE.gold, '900');
    this.lampStar.anchor.set(0.5, 0.5);
    // Cachée tant que `drawLamps` ne l'a pas placée : sinon elle apparaît une
    // frame dans le coin (0,0), comme le sprite de la bête.
    this.lampStar.visible = false;

    const atlas = getAtlas();
    this.beastSprite = new Sprite(atlas.units.beast);
    this.beastSprite.anchor.set(0.5);
    this.beastSprite.width = CELL - 18;
    this.beastSprite.height = CELL - 18;
    // Garée hors écran dès la construction (voir `syncBeast`) : sans ça, un
    // sprite resté à sa position par défaut (0,0) clignoterait un instant
    // dans le coin du plateau avant le tout premier `render()`.
    this.beastSprite.position.set(-9999, -9999);

    this.seatLabels = [
      bigText('● siège 1', 15, PALETTE.sky, '800'),
      bigText('■ siège 2', 15, PALETTE.berry, '800'),
    ];
    this.seatLabels[0].position.set(boardX(s.cols) + 10, BOARD_Y + s.rows * CELL + 22);
    this.seatLabels[0].anchor.set(0, 0);
    this.seatLabels[1].position.set(boardX(s.cols) + s.cols * CELL - 10, BOARD_Y + s.rows * CELL + 22);
    this.seatLabels[1].anchor.set(1, 0);

    this.paintStatic(s);

    this.root.addChild(
      this.staticLayer,
      this.revealLayer,
      this.revealGlyphs,
      this.selectLayer,
      this.beastSprite,
      this.hint,
      this.barBack,
      this.barFill,
      this.barLabel,
      this.barStar,
      this.lampLayer,
      this.lampStar,
      this.seatLabels[0],
      this.seatLabels[1],
    );
    parent.addChild(this.root);
  }

  /** Panneau + cases + liseré doré de la rangée 0 : LE but visible en
   *  permanence (§1.1 critère 3), qu'importe la phase ou qui regarde
   *  l'écran — ça ne trahit rien, c'est la même case pour tout le monde.
   *
   *  Le fond de la case-but reste le fond NEUTRE (comme toute autre case) :
   *  seul le CONTOUR est doré. Un aplat dans le fond se mélangerait à la
   *  teinte d'un thermomètre posé dessus plus tard (bleu froid + or ⇒ un
   *  gris boueux qui affaiblit le premier des trois codages) — un liseré ne
   *  se mélange à rien, il reste lisible quoi qu'on peigne par-dessus. */
  private paintStatic(s: BeastState): void {
    const bx = boardX(s.cols);
    const boardW = s.cols * CELL;
    const boardH = s.rows * CELL;
    const g = this.staticLayer;

    // LA SORTIE — l'objet du but (§1.1 critère 3), posé au-dessus du plateau et
    // visible en PERMANENCE, dans les deux phases et pour les deux joueurs (il
    // ne trahit rien : c'est le même terrier pour tout le monde). Le liseré
    // doré de la rangée 0 dit « c'est cette rangée-là » ; ce bandeau et ses
    // chevrons disent « et on va PAR LÀ ». Tracé en Graphics, sans un
    // caractère : un enfant qui ne lit pas voit où il faut aller.
    g.roundRect(bx, 132, boardW, 26, 9)
      .fill({ color: PALETTE.gold, alpha: 0.16 })
      .stroke({ width: 2, color: PALETTE.gold });
    for (let i = 0; i < 5; i++) {
      const cx = bx + (boardW * (i + 0.5)) / 5;
      g.moveTo(cx - 10, 151).lineTo(cx, 139).lineTo(cx + 10, 151);
    }
    g.stroke({ width: 3, color: PALETTE.gold });

    g.roundRect(bx - 10, BOARD_Y - 10, boardW + 20, boardH + 20, 20)
      .fill(PALETTE.panel)
      .stroke({ width: 4, color: PALETTE.panelEdge });

    for (let idx = 0; idx < s.cols * s.rows; idx++) {
      const { x, y } = cellCenter(idx, s.cols);
      const [r] = rowColOf(idx, s.cols);
      const isGoal = r === 0;
      g.roundRect(x - CELL / 2 + 4, y - CELL / 2 + 4, CELL - 8, CELL - 8, 10)
        .fill(PALETTE.bg)
        .stroke({ width: isGoal ? 3 : 1, color: isGoal ? PALETTE.gold : PALETTE.panelEdge, alpha: isGoal ? 0.9 : 0.35 });
    }
  }

  render(time: number): void {
    const s = this.model.state;

    const hintText = s.over
      ? ''
      : s.phase === 'beast'
        ? `à toi, siège ${s.active + 1} : avance d'une case (la bête doit bouger)`
        : `à toi, siège ${s.active + 1} : éclaire ${s.lightsCount} cases puis valide`;
    if (this.hint.text !== hintText) this.hint.text = hintText;

    const barText = `tour ${Math.min(s.turnsUsed, s.turnLimit)} / ${s.turnLimit}`;
    if (this.barLabel.text !== barText) this.barLabel.text = barText;
    const barStarText = s.helpedBeast ? '⭐' : '';
    if (this.barStar.text !== barStarText) this.barStar.text = barStarText;
    this.drawBar(s);
    this.drawLamps(s);

    // Rôle courant sur chaque libellé de siège : ajoute un pictogramme SANS
    // dépendre de la couleur pour dire qui joue quoi (le glyphe ●/■ dit QUI,
    // le pictogramme dit QUEL rôle).
    const roleGlyph = (seat: 0 | 1): string => (seat === s.beastSeat ? '🐾' : '🔦');
    // ⭐ collée au SIÈGE, pas au rôle : elle ne bouge pas quand les rôles
    // s'échangent, donc l'enfant aidé voit son étoile toute la manche.
    // CONVENTION ⭐ (core/minigame.ts) : ⭐ = le joueur AIDÉ, donc `stars === 1`.
    // Le pictogramme portait l'étoile sur `=== 2` : il DÉSIGNAIT le mauvais
    // enfant, exactement comme le modèle qui lui donnait l'aide.
    const starGlyph = (seat: 0 | 1): string =>
      this.model.stars[0] !== this.model.stars[1] && this.model.stars[seat] === 1 ? ' ⭐' : '';
    const t0 = `● siège 1 ${roleGlyph(0)}${starGlyph(0)}`;
    const t1 = `■ siège 2 ${roleGlyph(1)}${starGlyph(1)}`;
    if (this.seatLabels[0].text !== t0) this.seatLabels[0].text = t0;
    if (this.seatLabels[1].text !== t1) this.seatLabels[1].text = t1;

    // Respiration douce (fonction périodique du temps, aucun état mémorisé)
    // sur le libellé du siège actif — coupée en mouvement réduit.
    const breathe = this.reducedMotion || s.over ? 1 : 1 + Math.sin(time * 3) * 0.06;
    this.seatLabels[0].scale.set(s.active === 0 && !s.over ? breathe : 1);
    this.seatLabels[1].scale.set(s.active === 1 && !s.over ? breathe : 1);

    if (s.half !== this.shownHalf) {
      this.shownHalf = s.half;
      this.poppedAt.clear();
      this.knownTurn.clear();
    }
    this.drawReveal(s, time);
    this.drawSelected(s);
    this.syncBeast(s);
  }

  private drawBar(s: BeastState): void {
    const bx = boardX(s.cols);
    const w = s.cols * CELL;
    const y = 112;
    this.barBack.clear().roundRect(bx, y, w, 10, 5).fill(PALETTE.bgDeep);
    const frac = clamp(s.turnsUsed / s.turnLimit, 0, 1);
    this.barFill.clear();
    if (frac > 0) {
      this.barFill.roundRect(bx, y, Math.max(10, w * frac), 10, 5).fill(PALETTE.gold);
    }
    // Le trait marque où la barre s'arrêterait SANS ⭐ : ce qui dépasse à
    // droite est exactement le cadeau, visible comme une longueur.
    if (s.helpedBeast && s.turnLimit > BEAST_TURNS) {
      const cut = bx + (w * BEAST_TURNS) / s.turnLimit;
      this.barFill.rect(cut - 1.5, y - 3, 3, 16).fill(PALETTE.cream);
    }
  }

  /** Les lampes du chasseur — une par case qu'il a le droit d'éclairer, pleine
   *  dès qu'elle est armée. C'est LE but visible de son tour (il éclaire
   *  jusqu'à ce que toutes soient allumées) ET le support du handicap ⭐. */
  private drawLamps(s: BeastState): void {
    const g = this.lampLayer;
    g.clear();
    if (s.phase !== 'hunter' || s.over) {
      this.lampStar.visible = false;
      return;
    }
    const gap = 30;
    const y = BOARD_Y + s.rows * CELL + 30;
    const x0 = PASS_W / 2 - ((s.lightsCount - 1) * gap) / 2;
    for (let i = 0; i < s.lightsCount; i++) {
      const x = x0 + i * gap;
      if (i < s.selected.length) g.circle(x, y, 9).fill(PALETTE.gold);
      else g.circle(x, y, 9).stroke({ width: 2.5, color: PALETTE.dim });
    }
    // La lampe en trop de l'aide ⭐ porte l'étoile : l'objet EST le handicap.
    this.lampStar.visible = s.helpedHunter;
    if (s.helpedHunter) this.lampStar.position.set(x0 + (s.lightsCount - 1) * gap, y - 18);
  }

  /** Mémoire du chasseur : chaque case déjà éclairée garde son dernier
   *  thermomètre, ATTÉNUÉE si elle n'est pas de ce tour-ci — c'est ce qui
   *  rend visible qu'une vieille lecture peut être périmée (la bête a bougé
   *  depuis), sans jamais l'effacer (§3.7 : « c'est la mémoire du chasseur »). */
  private drawReveal(s: BeastState, time: number): void {
    const g = this.revealLayer;
    g.clear();
    // Tout pictogramme en cache est caché par défaut ; seules les cases
    // ENCORE dans `s.revealed` (le modèle vide cette liste au changement de
    // moitié) sont replacées ci-dessous — sans ça, la mémoire d'une moitié
    // précédente resterait affichée après l'échange des rôles.
    for (const t of this.glyphByIdx.values()) t.visible = false;
    for (const cell of s.revealed) {
      if (!this.poppedAt.has(cell.idx) || this.knownTurn.get(cell.idx) !== cell.turn) {
        this.poppedAt.set(cell.idx, time);
        this.knownTurn.set(cell.idx, cell.turn);
      }
      const p = this.reducedMotion ? 1 : clamp((time - (this.poppedAt.get(cell.idx) ?? time)) / 0.35, 0, 1);
      const fresh = cell.turn === s.turnsUsed;
      // ATTÉNUATION D'UNE VIEILLE LECTURE — par la TAILLE, pas par l'alpha.
      // À 0,4 d'opacité, les trois teintes tombaient à 1,96 / 2,72 / 2,47:1 sur
      // le fond : sous le 3:1 du WCAG 1.4.11, alors que cette mémoire est
      // justement l'information que le §3.7 demande d'afficher (« un enfant de
      // 5 ans ne peut pas la tenir de tête »). À 0,7 les trois passent
      // (3,20 / 5,20 / 4,62:1) et la fraîcheur se lit à la taille du marqueur,
      // qui est une FORME et survit au niveau de gris.
      const alpha = (fresh ? 1 : 0.7) * ease(p);
      const scale = (fresh ? 1 : 0.78) * (0.6 + 0.4 * ease(p));
      this.paintTier(g, cell, s.cols, scale, alpha);

      // Pictogramme — DEUXIÈME codage du thermomètre (avec la couleur des
      // barres/du fond ET le nombre de barres) : jamais la couleur seule.
      let glyph = this.glyphByIdx.get(cell.idx);
      if (!glyph) {
        glyph = bigText('', 22, PALETTE.cream, '900');
        this.glyphByIdx.set(cell.idx, glyph);
        this.revealGlyphs.addChild(glyph);
      }
      const { x, y } = cellCenter(cell.idx, s.cols);
      // Règle du dépôt : n'écrire un `Text` que si la valeur AFFICHÉE change —
      // une affectation réécrit la texture du glyphe.
      const emoji = tierEmoji(cell.tier);
      if (glyph.text !== emoji) glyph.text = emoji;
      glyph.position.set(x, y - 14);
      glyph.scale.set(scale);
      glyph.alpha = alpha;
      glyph.visible = true;
    }
  }

  private paintTier(g: Graphics, cell: RevealedCell, cols: number, scale: number, alpha: number): void {
    // `cols` est passé en paramètre : relire `this.model.state` ici allouait un
    // objet d'état PAR CASE ET PAR FRAME, pour un seul entier constant.
    const { x, y } = cellCenter(cell.idx, cols);
    const color = TIER_COLOR[cell.tier];
    const size = (CELL - 14) * scale;
    // Lavis de fond : RENFORT décoratif de la teinte, pas le marqueur lui-même
    // — c'est la BARRE (peinte plein `alpha` ci-dessous) qui porte le canal
    // couleur au contraste exigé.
    g.roundRect(x - size / 2, y - size / 2, size, size, 10).fill({ color, alpha: alpha * 0.34 });

    // Barres — troisième codage, indépendant du pictogramme et de la couleur.
    const bars = tierBars(cell.tier);
    const barW = 14;
    const barH = 5;
    const gap = 4;
    const totalW = barW * 2 + gap;
    const by = y + CELL / 2 - 16;
    for (let i = 0; i < 2; i++) {
      const bx0 = x - totalW / 2 + i * (barW + gap);
      if (i < bars) {
        g.roundRect(bx0, by, barW, barH, 2).fill({ color, alpha });
      } else {
        // Un emplacement VIDE se dessine quand même : « 0 barre sur 2 » n'est
        // lisible que si les deux emplacements le sont. Même opacité que les
        // barres pleines — à 0,6 fois, le froid atténué retombait sous 3:1.
        g.roundRect(bx0, by, barW, barH, 2).stroke({ width: 1.5, color, alpha });
      }
    }
  }

  /** Cases armées ce tour-ci : liseré doré en POINTILLÉ + pastille de coin —
   *  un état encore réversible (on peut la retirer avant de valider).
   *
   *  La pastille est dans le COIN, pas au centre : au centre elle se posait
   *  pile sur le pictogramme du thermomètre (le glyphe est à `y - 14`) et
   *  masquait la lecture mémorisée d'une case ré-éclairée — vu à la capture
   *  d'écran, un ❄ entièrement recouvert par le point doré. Le deuxième des
   *  trois codages ne doit jamais pouvoir être caché par un marqueur d'état. */
  private drawSelected(s: BeastState): void {
    const g = this.selectLayer;
    g.clear();
    if (s.phase !== 'hunter') return;
    for (const idx of s.selected) {
      const { x, y } = cellCenter(idx, s.cols);
      drawDashedSquare(g, x, y, CELL - 10, STAR_TINT);
      g.circle(x - CELL / 2 + 15, y - CELL / 2 + 15, 6).fill(STAR_TINT);
    }
  }

  /** SECRET : dessinée UNIQUEMENT pendant le tour de la bête (voir l'en-tête
   *  du fichier). Garée hors écran le reste du temps, jamais simplement
   *  masquée en alpha (une lecture de position resterait dans la scène). */
  private syncBeast(s: BeastState): void {
    if (s.phase !== 'beast' || s.over) {
      this.beastSprite.position.set(-9999, -9999);
      return;
    }
    const { x, y } = cellCenter(s.beastIdx, s.cols);
    this.beastSprite.position.set(x, y);
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/**
 * Carré en pointillé — jamais un `arc()` sans `moveTo` (piège vécu ailleurs
 * dans le dépôt : dans Pixi v8, il se relie au point courant du chemin resté
 * à l'origine du monde et trace une balafre en travers de l'écran).
 */
function drawDashedSquare(g: Graphics, cx: number, cy: number, size: number, color: number): void {
  const half = size / 2;
  const dash = 9;
  const gap = 6;
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
