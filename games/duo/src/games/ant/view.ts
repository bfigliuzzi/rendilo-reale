import { Container, Graphics, Sprite, Text } from 'pixi.js';
import {
  ANT_BLOCK_COOLDOWN,
  ANT_BLOCK_LIFE,
  ANT_BLOCK_MAX,
  ANT_BLOCK_MIN_DIST,
  ANT_BLOCK_SIZE,
  ANT_RADIUS,
} from '../../config/balance';
import { getAtlas, PALETTE } from '../../render/textures';
import {
  ANT_ARENA_H,
  ANT_ARENA_W,
  ANT_FLOWER_X,
  ANT_START_X,
  ANT_TOP_MARGIN,
  ANT_Y_MAX,
  ANT_Y_MIN,
} from './model';
import type { AntModel, AntState } from './model';

/**
 * Vue de `ant` — LECTURE SEULE du modèle (contrat de `core/minigame.ts`).
 * Toute animation est une fonction CLOSE du temps écoulé du modèle
 * (`state.elapsed`, qui ne recule jamais) : le pop-in et le clignotement de
 * fin de vie d'un bloc se dérivent de `elapsed - bornAt`, jamais d'un état
 * propre à la vue (pattern de `mind/render/boardView.ts`).
 *
 * P0 = teinte `sky`, P1 = teinte `berry` — les mêmes couleurs que `plank`
 * pour rester cohérent dans toute la collection. La fourmi COURANTE porte la
 * teinte de son siège ; le nuage (le géant, cf. `render/sprites.ts`) porte
 * celle du siège adverse. Jamais la couleur seule : la fourmi est ronde à
 * antennes, le géant est un nuage à deux yeux, le bloc est un cube — trois
 * silhouettes distinctes.
 */

const SEAT_COLOR: readonly [number, number] = [PALETTE.sky, PALETTE.berry];
const BLOCK_POP_SEC = 0.22;
const BLOCK_FADE_SEC = 1.1; // dernière seconde de vie : le bloc s'annonce avant de disparaître
const CLOUD_PX = 64;
const CAP_DOT_R = 7;
const CAP_DOT_GAP = 20;
/**
 * Retrait horizontal du panneau du géant depuis son bord. Ni 56 (le nuage
 * mangeait la fleur du haut, donc une partie du BUT — mesuré à la capture) ni
 * collé au centre : à 190 il tient dans le tiers du siège du géant, laisse la
 * colonne de fleurs (x ≥ 872) et la plaque de départ (x ≤ 108) intactes.
 */
const GIANT_INSET = 190;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function clampRange(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface AntReticle {
  readonly x: number;
  readonly y: number;
}

export class AntView {
  readonly root = new Container();
  private readonly bg = new Graphics();
  private readonly zones = new Graphics(); // départ + fleurs : géométrie statique, dessinée une fois
  private readonly forbid = new Graphics();
  private readonly blockLayer = new Container();
  private readonly blockSprites: Sprite[] = [];
  private readonly antG = new Graphics();
  private readonly antStar: Text;
  private readonly cloud: Sprite;
  private readonly cloudStar: Text;
  private readonly cooldownGauge = new Graphics();
  private readonly capDots = new Graphics();
  private readonly reticleG = new Graphics();
  private readonly hud: Text;
  private lastHud = '';
  private readonly flowerSprites: Sprite[] = [];

  constructor(
    parent: Container,
    private readonly model: AntModel,
    private readonly reducedMotion: boolean,
    /**
     * Recouvrement RÉEL du bandeau de table, en px logiques (`ctx.safeTop`).
     * Une FONCTION et non un nombre : la fenêtre peut tourner en pleine
     * manche. Elle remplace une constante empirique de 96 px que ce fichier
     * portait — fausse dans les deux sens (0 px de recouvrement sur un
     * téléphone portrait, 114 px sur une fenêtre 960×540).
     */
    private readonly safeTop: () => number = () => 0,
  ) {
    const atlas = getAtlas();

    this.bg.roundRect(0, 0, ANT_ARENA_W, ANT_ARENA_H, 22).fill(PALETTE.panel);
    this.root.addChild(this.bg);

    // Départ : une plaque discrète au sol, toute la hauteur jouable. L'APLAT
    // reste très doux (c'est un fond, pas un marqueur) mais il porte un LISERÉ
    // opaque : c'est le point de réapparition de la fourmi, donc une
    // information — l'aplat seul plafonnait à 1,16:1 (WCAG 1.4.11 exige 3:1),
    // le liseré `panelEdge` la met à 4,17:1.
    this.zones
      .roundRect(ANT_START_X - 20, ANT_Y_MIN - ANT_RADIUS - 4, 40, ANT_Y_MAX - ANT_Y_MIN + ANT_RADIUS * 2 + 8, 12)
      .fill({ color: PALETTE.goldDark, alpha: 0.25 })
      .stroke({ width: 2, color: PALETTE.panelEdge });
    this.root.addChild(this.zones);

    // Fleurs : LE but, visible en permanence (§1.1 critère 3) — une rangée le
    // long de toute la ligne d'arrivée, pas un point unique, pour que la
    // traversée reste possible à n'importe quelle hauteur.
    const flowerCount: number = 4;
    for (let i = 0; i < flowerCount; i++) {
      const s = new Sprite(atlas.units.flower);
      s.anchor.set(0.5);
      s.width = 40;
      s.height = 40;
      const t = flowerCount === 1 ? 0.5 : i / (flowerCount - 1);
      // Centrée dans la bande entre la ligne d'arrivée et le bord droit, et
      // gardée hors du recouvrement RÉEL du bandeau de table (`ctx.safeTop()`,
      // 0 depuis que le shell réserve sa bande) au lieu d'une constante
      // empirique : la fleur du haut, posée à `ANT_Y_MIN`, était masquée — or
      // c'est LE but visible en permanence (§1.1 critère 3).
      s.position.set(
        ANT_FLOWER_X + (ANT_ARENA_W - ANT_FLOWER_X) / 2,
        lerp(Math.max(ANT_Y_MIN, this.safeTop() + 24), ANT_Y_MAX - 20, t),
      );
      this.root.addChild(s);
      this.flowerSprites.push(s);
    }

    this.root.addChild(this.forbid);

    for (let i = 0; i < ANT_BLOCK_MAX; i++) {
      const s = new Sprite(atlas.units.block);
      s.anchor.set(0.5);
      s.visible = false;
      this.blockLayer.addChild(s);
      this.blockSprites.push(s);
    }
    this.root.addChild(this.blockLayer);

    this.root.addChild(this.antG);
    this.antStar = bigText('⭐', 20, PALETTE.gold);
    this.root.addChild(this.antStar);

    this.cloud = new Sprite(atlas.units.cloud);
    this.cloud.anchor.set(0.5);
    this.cloud.width = CLOUD_PX;
    this.cloud.height = CLOUD_PX;
    this.root.addChild(this.cloud);
    this.cloudStar = bigText('⭐', 16, PALETTE.gold);
    this.root.addChild(this.cloudStar);

    this.root.addChild(this.cooldownGauge, this.capDots, this.reticleG);

    // Horloge + manche + score EN BAS de l'arène : en haut, ils tombaient
    // pile derrière le bandeau de table du shell (peint par-dessus le
    // plateau) et n'ont jamais été lisibles. Le bas est libre — les deux
    // joysticks occupent les COINS, pas le centre.
    this.hud = bigText('', 20, PALETTE.cream);
    this.hud.position.set(ANT_ARENA_W / 2, ANT_ARENA_H - 16);
    this.root.addChild(this.hud);

    parent.addChild(this.root);
  }

  render(alpha: number, reticle: AntReticle | null): void {
    const s = this.model.state;
    // La position INTERPOLÉE est calculée une fois et partagée : dessiner
    // l'anneau à la position de simulation pendant que la fourmi est dessinée
    // interpolée le décollait d'elle d'un pas entier (~3,6 px) à chaque frame,
    // et c'est justement l'anneau qui enseigne la règle.
    const ax = lerp(s.ant.prevX, s.ant.x, alpha);
    const ay = lerp(s.ant.prevY, s.ant.y, alpha);
    this.drawForbiddenZone(s, ax, ay);
    this.drawBlocks(s);
    this.drawAnt(s, ax, ay);
    this.drawGiant(s);
    this.drawReticle(s, reticle);
    this.drawHud(s);
  }

  /** Zone où le géant NE PEUT PAS poser (§3.6) — rendue VISIBLE plutôt que
   *  simplement refusée en silence : un enfant de 5 ans voit où c'est permis
   *  sans avoir à essayer. Teinte calme (`leaf`), jamais un code de danger
   *  (anneau + rouge/ambre), réservé ailleurs dans tout le dépôt.
   *  OPACITÉ PLEINE, trouvée au calcul et pas à l'œil : à alpha 0,4 l'anneau
   *  tombait à 2,31:1 sur le fond du plateau, sous le 3:1 du WCAG 1.4.11 —
   *  invisible comme défaut, fatal comme information. Opaque : 6,46:1. */
  private drawForbiddenZone(s: AntState, ax: number, ay: number): void {
    this.forbid.clear();
    if (s.over) return;
    this.forbid.circle(ax, ay, ANT_BLOCK_MIN_DIST).stroke({ width: 2, color: PALETTE.leaf });
  }

  private drawBlocks(s: AntState): void {
    for (let i = 0; i < this.blockSprites.length; i++) {
      const spr = this.blockSprites[i];
      const b = s.blocks[i];
      if (!b) {
        spr.visible = false;
        continue;
      }
      spr.visible = true;
      const age = s.elapsed - b.bornAt;
      const popT = this.reducedMotion ? 1 : clamp01(age / BLOCK_POP_SEC);
      const scale = 0.35 + 0.65 * popT;
      const remain = ANT_BLOCK_LIFE - age;
      spr.alpha = remain < BLOCK_FADE_SEC ? Math.max(0.25, clamp01(remain / BLOCK_FADE_SEC)) : 1;
      spr.width = ANT_BLOCK_SIZE * scale;
      spr.height = ANT_BLOCK_SIZE * scale;
      spr.position.set(b.x, b.y);
    }
  }

  /** Fourmi : silhouette ronde à antennes, jamais un insecte inquiétant (§6).
   *  Teinte = siège courant, seul code de couleur du duel (la FORME — ronde à
   *  antennes contre nuage — porte le reste de la distinction). */
  private drawAnt(s: AntState, x: number, y: number): void {
    const tint = SEAT_COLOR[s.antSeat];
    const g = this.antG;
    g.clear();
    // Antennes d'abord (sous le corps).
    g.moveTo(x - 5, y - ANT_RADIUS).lineTo(x - 10, y - ANT_RADIUS - 10).stroke({ width: 2, color: PALETTE.outline });
    g.moveTo(x + 5, y - ANT_RADIUS).lineTo(x + 10, y - ANT_RADIUS - 10).stroke({ width: 2, color: PALETTE.outline });
    g.circle(x - 10, y - ANT_RADIUS - 10, 2.5).fill(PALETTE.outline);
    g.circle(x + 10, y - ANT_RADIUS - 10, 2.5).fill(PALETTE.outline);
    // Corps.
    g.circle(x, y, ANT_RADIUS).fill(tint).stroke({ width: 2, color: PALETTE.outline });
    // Grands yeux — rien qui fasse peur.
    g.circle(x - 5, y - 2, 3.6).fill(PALETTE.cream);
    g.circle(x + 5, y - 2, 3.6).fill(PALETTE.cream);
    g.circle(x - 5, y - 2, 1.7).fill(PALETTE.outline);
    g.circle(x + 5, y - 2, 1.7).fill(PALETTE.outline);

    // Le ⭐ est un OBJET du plateau (§1.3) : on le garde hors du recouvrement
    // RÉEL du bandeau (`ctx.safeTop()`) plutôt que de le laisser disparaître
    // quand la fourmi longe le haut.
    this.antStar.visible = s.boosted;
    this.antStar.position.set(x, Math.max(this.safeTop() + 12, y - ANT_RADIUS - 22));
  }

  /** Le géant : un nuage joufflu (jamais une main écrasante, §6), la jauge de
   *  recharge et les jetons de blocs restants — l'OBJET visible qui remplace
   *  un cooldown/plafond invisibles. Posé du CÔTÉ où siège le géant courant. */
  private drawGiant(s: AntState): void {
    const giantSeat = s.antSeat === 0 ? 1 : 0;
    const cx = giantSeat === 0 ? GIANT_INSET : ANT_ARENA_W - GIANT_INSET;
    // Le nuage occupe la bande haute que le MODÈLE lui réserve
    // (`ANT_TOP_MARGIN`) et se cale sur SON BAS : il ne mord donc jamais sur la
    // zone jouable, et c'est le même nombre qui borne les poses de blocs —
    // plateau et simulation lisent la même valeur, comme le sol de Berceau est
    // peint DEPUIS le masque. Son ⭐ (posé à côté) reste visible : un handicap
    // qu'on ne voit pas est le « multiplicateur caché » que le §1.3 interdit.
    const cy = ANT_TOP_MARGIN - CLOUD_PX / 2 - 6;
    // Le nuage garde sa palette propre (peinte dans `render/sprites.ts`,
    // pas un masque neutre) : on ne le teinte pas, la POSITION (côté du
    // siège) suffit à dire qui contrôle le géant à l'instant.
    this.cloud.position.set(cx, cy);
    // ⭐ posé À CÔTÉ du nuage, vers le centre de l'arène : au-dessus il sortait
    // de la bande du géant, et du côté du bord il tombait hors de l'arène.
    this.cloudStar.visible = s.boosted; // le plafond RÉDUIT du géant d'en face
    this.cloudStar.position.set(cx + (giantSeat === 0 ? 1 : -1) * (CLOUD_PX / 2 + 20), cy);

    // Jauge de recharge : un arc qui se remplit — la RÈGLE se voit, elle ne
    // se lit pas. Doré du vide au plein, jamais vert (réservé à la zone
    // interdite autour de la fourmi : deux informations, deux teintes).
    const g = this.cooldownGauge;
    g.clear();
    const ready = s.cooldownLeft <= 0 && s.blocks.length < s.blockMax;
    const frac = clamp01(1 - s.cooldownLeft / ANT_BLOCK_COOLDOWN);
    const gaugeR = CLOUD_PX / 2 + 8;
    // Piste de la jauge : OPAQUE. À alpha 0,5 elle tombait à 2,17:1 sur le
    // plateau (WCAG 1.4.11 exige 3:1) ; c'est elle qui montre « ce qu'il reste
    // à remplir », donc une information, pas un décor. Opaque : 4,17:1.
    g.circle(cx, cy, gaugeR).stroke({ width: 3, color: PALETTE.panelEdge });
    if (ready) {
      g.circle(cx, cy, gaugeR).stroke({ width: 3, color: PALETTE.gold });
    } else if (s.blocks.length < s.blockMax && frac > 0) {
      // PIÈGE Pixi v8 (cf. `render/textures.ts`) : `arc()` sans `moveTo`
      // préalable se relie au point courant du chemin, resté à l'origine
      // après `clear()`, et trace une balafre en travers de l'écran. On pose
      // TOUJOURS le point de départ de l'arc à la main.
      const start = -Math.PI / 2;
      const end = start + frac * Math.PI * 2;
      g.moveTo(cx + gaugeR * Math.cos(start), cy + gaugeR * Math.sin(start));
      g.arc(cx, cy, gaugeR, start, end).stroke({ width: 3, color: PALETTE.gold });
    }

    // Jetons de blocs restants : autant de ronds que `blockMax` en autorise —
    // c'est ICI que ⭐ se voit comme un objet (une rangée plus courte), pas
    // comme un nombre caché.
    const dots = this.capDots;
    dots.clear();
    const total = s.blockMax;
    // Rangée CLAMPÉE dans l'arène : centrée sur le nuage, elle débordait du
    // bord droit et le dernier jeton était coupé — donc un plafond de blocs
    // faux à la lecture.
    const half = ((total - 1) * CAP_DOT_GAP) / 2;
    const startX = clampRange(cx, half + CAP_DOT_R + 6, ANT_ARENA_W - half - CAP_DOT_R - 6) - half;
    const dy = cy + CLOUD_PX / 2 + 16;
    for (let i = 0; i < total; i++) {
      const used = i < s.blocks.length;
      const dx = startX + i * CAP_DOT_GAP;
      // Jeton CONSOMMÉ : anneau CREUX (une forme, pas seulement une teinte —
      // §5 « jamais la couleur seule ») et opaque, 4,17:1 sur le plateau.
      // Jeton DISPONIBLE : disque PLEIN doré. Creux/plein se lit en niveaux de
      // gris, ce que deux alphas de la même couleur ne faisaient pas.
      if (used) dots.circle(dx, dy, CAP_DOT_R).stroke({ width: 2, color: PALETTE.panelEdge });
      else dots.circle(dx, dy, CAP_DOT_R).fill(PALETTE.gold).stroke({ width: 1.5, color: PALETTE.outline });
    }
  }

  private drawReticle(s: AntState, reticle: AntReticle | null): void {
    const g = this.reticleG;
    g.clear();
    if (!reticle || s.over) return;
    // Traits OPAQUES : le cercle à alpha 0,5 tombait à 2,67:1 sur le plateau
    // (WCAG 1.4.11). Le réticule dit OÙ le bloc va tomber : c'est une
    // information de jeu, pas un ornement.
    const r = 14;
    const c = PALETTE.sky;
    g.moveTo(reticle.x - r, reticle.y).lineTo(reticle.x + r, reticle.y).stroke({ width: 2, color: c });
    g.moveTo(reticle.x, reticle.y - r).lineTo(reticle.x, reticle.y + r).stroke({ width: 2, color: c });
    g.circle(reticle.x, reticle.y, r).stroke({ width: 2, color: c });
  }

  private drawHud(s: AntState): void {
    const clockTxt = `${Math.ceil(s.clock)} s`;
    const phaseTxt = s.phase === 'suddenDeath' ? 'Mort subite' : `Manche ${s.half + 1} sur 2`;
    const text = `${phaseTxt} · ${clockTxt}   🐜 ${s.scores[0]} – ${s.scores[1]}`;
    if (text === this.lastHud) return;
    this.lastHud = text;
    this.hud.text = text;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

function bigText(text: string, size: number, fill: number): Text {
  const t = new Text({ text, style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fontWeight: '900', fill } });
  t.anchor.set(0.5);
  return t;
}
