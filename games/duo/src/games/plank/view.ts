import { Container, Graphics, Text } from 'pixi.js';
import { PLANK_BALL_R, PLANK_COURSES, SIDE_H, SIDE_W } from '../../config/balance';
import { PALETTE } from '../../render/textures';
import { COURT_H, COURT_W } from './courses';
import type { PlankModel } from './model';

/**
 * Vue de `plank` — LECTURE SEULE du modèle, jamais de mutation (contrat de
 * `core/minigame.ts`). Elle ne lit QUE les accesseurs nus du modèle
 * (`ballX`, `tiltX`, `done`…), jamais son `get state()` : celui-ci construit
 * un objet à chaque appel, et `render` tourne à la fréquence de l'écran (§6,
 * « zéro allocation »).
 *
 * Ce qui bouge est interpolé `prevX/prevY → x/y` par l'alpha du shell ; le
 * petit fx de replacement est une fonction CLOSE de `elapsed - flashAt`
 * (pattern de `mind/render/boardView.ts`) — aucun minuteur propre à la vue.
 *
 * Formes primitives en `Graphics` (rects/cercles) plutôt qu'avec l'atlas de
 * sprites 16×16 : la bille, les murs, les trous et la sortie ne sont pas des
 * personnages, l'atlas n'a rien à leur apporter — `mind/render/boardView.ts`
 * fait le même choix pour son plateau.
 *
 * GÉOMÉTRIE STATIQUE DESSINÉE UNE FOIS : le plateau et les deux pistes
 * d'inclinaison ne sont re-tracés qu'au changement de parcours ; la bille et
 * les deux curseurs sont des `Graphics` construits UNE seule fois et
 * simplement DÉPLACÉS (`position.set`) à chaque frame. Re-tracer un chemin
 * Pixi par frame allouerait, ce que le §6 interdit aux trois jeux temps réel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MISE EN PAGE, et elle n'est pas cosmétique : le bandeau de table
 * (`.hudbar`) vit en ESPACE ÉCRAN et couvre la soixantaine de pixels du HAUT.
 * Tout ce qui compte — le compteur de parcours, la piste de P0 — est donc
 * placé SOUS le plateau, jamais au-dessus : posé en y ≈ 10-40, le compteur
 * disparaissait purement et simplement derrière le bandeau.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Teinte du joueur qui possède l'axe X (P0, siège gauche) — doublée par la
 *  FORME de son curseur (losange) et par l'ORIENTATION de sa piste. */
const P0_COLOR = PALETTE.sky;
/** Teinte du joueur qui possède l'axe Y (P1, siège droit) — curseur en disque,
 *  piste verticale, posée de SON côté du plateau. */
const P1_COLOR = PALETTE.berry;
/**
 * Trou noir : corps sombre + ANNEAU ember. C'est l'anneau qui porte
 * l'information (4,70:1 sur le plateau, calculé) : le plateau est lui-même
 * sombre, et AUCUN remplissage sombre ne peut y atteindre 3:1 — le noir pur
 * plafonne à 2,00:1. WCAG 1.4.11 demande que la LIMITE du composant soit
 * discernable, et c'est exactement ce que l'anneau assure ; le corps sombre
 * reste ce qui dit « c'est un trou », pas ce qui dit « il y en a un ».
 */
const HOLE_RING = 0xff8f6b;
const HOLE_FILL = 0x1c1210;

/** Demi-longueur des pistes d'inclinaison, en px logiques. */
const TRACK_HALF = 70;
const RESET_FX_SEC = 0.45;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class PlankView {
  readonly root = new Container();

  /** Fond + murs + trous + sortie : re-tracé au changement de parcours SEUL. */
  private readonly board = new Graphics();
  /** Les deux pistes (traits fixes) : tracées une fois, jamais re-tracées. */
  private readonly tracks = new Graphics();
  /** Curseurs et bille : construits UNE fois, seulement déplacés ensuite. */
  private readonly cursor0 = new Graphics();
  private readonly cursor1 = new Graphics();
  private readonly ball = new Graphics();
  private readonly fx = new Graphics();
  private readonly hud: Text;
  /** Pictogramme de l'aide ⭐ (§1.3) — présent SEULEMENT si elle est active. */
  private readonly starMark: Text | null;

  private lastCourseIndex = -1;
  private lastHudCourse = -1;
  private lastHudSec = -1;
  private lastFxAge = -1;

  private readonly trackCx: number;
  private readonly trackY: number;
  private readonly trackX: number;
  private readonly trackCy: number;

  constructor(
    parent: Container,
    private readonly model: PlankModel,
    private readonly originX: number,
    private readonly originY: number,
    private readonly reducedMotion: boolean,
  ) {
    // Piste de P0 : horizontale, SOUS le plateau (le haut appartient au
    // bandeau de table). Piste de P1 : verticale, à DROITE du plateau, du côté
    // de son siège — « le joueur voit littéralement ce qu'il possède » (§3.1).
    this.trackCx = originX + COURT_W / 2;
    this.trackY = originY + COURT_H + 16;
    this.trackX = originX + COURT_W + 22;
    this.trackCy = originY + COURT_H / 2;

    this.tracks
      .moveTo(this.trackCx - TRACK_HALF, this.trackY)
      .lineTo(this.trackCx + TRACK_HALF, this.trackY)
      .stroke({ width: 4, color: P0_COLOR })
      .moveTo(this.trackX, this.trackCy - TRACK_HALF)
      .lineTo(this.trackX, this.trackCy + TRACK_HALF)
      .stroke({ width: 4, color: P1_COLOR });

    // Curseur de P0 : LOSANGE. Curseur de P1 : DISQUE. Deux formes franchement
    // différentes — en niveaux de gris, on doit encore savoir qui est qui.
    this.cursor0.poly([0, -9, 9, 0, 0, 9, -9, 0]).fill(P0_COLOR);
    this.cursor1.circle(0, 0, 9).fill(P1_COLOR);

    // Bille : dessinée AUTOUR DE L'ORIGINE, déplacée par `position.set`.
    this.ball
      .circle(0, 0, PLANK_BALL_R)
      .fill(PALETTE.gold)
      .stroke({ width: 2, color: PALETTE.outline });
    this.ball.circle(-4, -3, 2).fill(PALETTE.outline);
    this.ball.circle(4, -3, 2).fill(PALETTE.outline); // deux yeux : rien qui fasse peur (§6)

    this.hud = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 20,
        fontWeight: '900',
        fill: PALETTE.cream,
      },
    });
    this.hud.anchor.set(0.5, 1);
    this.hud.position.set(SIDE_W / 2, SIDE_H - 6);

    // §1.3 : « le handicap est un OBJET VISIBLE, jamais un chiffre caché ».
    // Le pictogramme n'existe que quand l'aide est active, et il est posé
    // contre le plateau — pas dans un coin d'écran où personne ne le lirait.
    this.starMark = model.assisted ? star(originX - 22, originY + COURT_H - 6) : null;

    this.root.addChild(this.tracks, this.board, this.fx, this.cursor0, this.cursor1, this.ball);
    this.root.addChild(this.hud);
    if (this.starMark) this.root.addChild(this.starMark);
    parent.addChild(this.root);
  }

  render(alpha: number): void {
    this.drawBoardIfNeeded();
    this.moveBall(alpha);
    this.moveCursors();
    this.drawResetFx();
    this.drawHud();
  }

  private drawBoardIfNeeded(): void {
    if (this.model.index === this.lastCourseIndex) return;
    this.lastCourseIndex = this.model.index;

    const g = this.board;
    g.clear();
    // Plateau : une plaque un peu plus claire que le fond de page, lue comme UNE
    // surface de jeu sans emprunter les codes réservés au danger (pas de
    // hachures, pas d'anneau de décor, pas d'aplat blanc).
    g.roundRect(this.originX, this.originY, COURT_W, COURT_H, 18)
      .fill(PALETTE.panel)
      .stroke({ width: 3, color: PALETTE.panelEdge });

    for (const w of this.model.walls) {
      g.rect(this.originX + w.x, this.originY + w.y, w.w, w.h)
        .fill(PALETTE.panelEdge)
        .stroke({ width: 2, color: PALETTE.outline });
    }

    // Trou noir : corps sombre + ANNEAU. Jamais la couleur seule — le corps
    // creux et l'anneau se lisent aussi en niveaux de gris.
    for (const h of this.model.holes) {
      g.circle(this.originX + h.x, this.originY + h.y, h.r)
        .fill(HOLE_FILL)
        .stroke({ width: 4, color: HOLE_RING });
    }

    // Sortie : TOUJOURS verte (§3.1). Elle est l'EXACTE INVERSION du trou noir —
    // corps CLAIR à liseré SOMBRE contre corps sombre à liseré clair — plus un
    // fanion. Trois signaux, dont deux qui survivent aux niveaux de gris.
    // Le liseré était crème : 1,48:1 sur le vert, donc invisible (calculé, pas
    // jugé à l'œil). Le contour brun du dépôt y tient 10,2:1.
    const goal = this.model.goal;
    const gx = this.originX + goal.x;
    const gy = this.originY + goal.y;
    g.circle(gx, gy, goal.r).fill(PALETTE.leaf).stroke({ width: 4, color: PALETTE.outline });
    g.moveTo(gx, gy - goal.r * 0.7)
      .lineTo(gx, gy + goal.r * 0.5)
      .stroke({ width: 3, color: PALETTE.outline });
    g.poly([gx, gy - goal.r * 0.7, gx + goal.r * 0.55, gy - goal.r * 0.45, gx, gy - goal.r * 0.2]).fill(
      PALETTE.outline,
    );
  }

  private moveBall(alpha: number): void {
    this.ball.position.set(
      this.originX + lerp(this.model.ballPrevX, this.model.ballX, alpha),
      this.originY + lerp(this.model.ballPrevY, this.model.ballY, alpha),
    );
  }

  /** Les deux curseurs (§3.1) : « le joueur voit littéralement ce qu'il
   *  possède ». Ils GLISSENT sur leur piste, ils ne sont jamais re-tracés. */
  private moveCursors(): void {
    this.cursor0.position.set(this.trackCx + this.model.tiltX * TRACK_HALF, this.trackY);
    this.cursor1.position.set(this.trackX, this.trackCy + this.model.tiltY * TRACK_HALF);
  }

  /** Fx de replacement : fonction CLOSE de `elapsed - flashAt`, aucun état
   *  propre à la vue. Coupé en mouvement réduit — la bille a DÉJÀ sauté au
   *  point de contrôle, aucune information n'est amputée (§6). */
  private drawResetFx(): void {
    if (this.reducedMotion) return;
    const age = this.model.elapsedTime - this.model.flashAt;
    const visible = age >= 0 && age <= RESET_FX_SEC;
    // On ne re-trace QUE si quelque chose change : hors fenêtre, un seul
    // `clear()` suffit et il ne se répète pas.
    if (!visible) {
      if (this.lastFxAge !== -1) {
        this.lastFxAge = -1;
        this.fx.clear();
      }
      return;
    }
    this.lastFxAge = age;
    const p = age / RESET_FX_SEC;
    const start = this.model.startPoint;
    this.fx.clear();
    this.fx
      .circle(this.originX + start.x, this.originY + start.y, 10 + p * 26)
      .stroke({ width: 3, color: PALETTE.gold, alpha: 1 - p });
  }

  /** Le compteur (§1.1 critère 3 : le but et l'avancement sont à l'écran en
   *  permanence). On compare les DEUX NOMBRES avant de fabriquer la chaîne :
   *  construire le libellé pour le jeter aussitôt serait une allocation par
   *  frame, et réécrire un `Text` ré-uploade sa texture. */
  private drawHud(): void {
    const course = Math.min(this.model.done + 1, PLANK_COURSES);
    const sec = Math.ceil(this.model.timeLeft);
    if (course === this.lastHudCourse && sec === this.lastHudSec) return;
    this.lastHudCourse = course;
    this.lastHudSec = sec;
    this.hud.text = `Parcours ${course} sur ${PLANK_COURSES} · ${sec} s`;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/** Le pictogramme de l'aide ⭐, posé contre le plateau. Un emoji plutôt qu'un
 *  dessin : c'est EXACTEMENT le symbole de l'accueil, où le réglage se choisit. */
function star(x: number, y: number): Text {
  const t = new Text({
    text: '⭐',
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 26 },
  });
  t.anchor.set(0.5);
  t.position.set(x, y);
  return t;
}
