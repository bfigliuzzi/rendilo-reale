import { Container, Graphics, Text } from 'pixi.js';
import { PASS_W, SUSPECTS_QUESTIONS, SUSPECT_PORTRAIT_PX } from '../../config/balance';
import { PALETTE } from '../../render/textures';
import { TRAITS, type Suspect, type SuspectsModel, type SuspectsState } from './model';

/**
 * Vue de `suspects`. Deux règles non négociables (pattern du dépôt) :
 *   ① elle ne MUTE jamais le modèle : elle le lit, point ;
 *   ② toute animation est une fonction CLOSE du temps écoulé (pattern de
 *      `mind/render/boardView.ts`) — ici la seule « animation » est une
 *      respiration très légère du bandeau d'indication, aucun état d'anim à
 *      faire avancer par ailleurs (les portraits, l'élimination et la
 *      révélation sont des fonctions PURES de l'état modèle courant).
 *
 * Le canvas est purement décoratif (`aria-hidden`, cf. `index.ts` qui pose les
 * vrais `<button>`) : tout ce qui est dessiné ici est un RENFORT visuel de ce
 * que les boutons DOM garantissent déjà (légalité, focus), jamais la seule
 * source de vérité.
 *
 * RÈGLE DE SECRET, propre à ce jeu : le coupable n'est dessiné en évidence QUE
 * pendant `revealing` (après l'accusation, une fois la manche déjà résolue et
 * sûre pour les deux regards) — jamais pendant `'guess'`, sous peine de
 * trahir le secret de A à l'écran que B regarde.
 */

/** Portraits ≥ 120 px logiques (§3.8 : « lisibles au premier coup d'œil »). */
export const PORTRAIT_SIZE = SUSPECT_PORTRAIT_PX;
export const GRID_COLS = 2;
export const GRID_ROWS = 3;
export const CELL_W = 240;
export const CELL_H = 176;
export const GRID_X = (PASS_W - GRID_COLS * CELL_W) / 2;
export const GRID_Y = 186;

export function suspectCenter(id: number): { x: number; y: number } {
  const col = id % GRID_COLS;
  const row = Math.floor(id / GRID_COLS);
  return { x: GRID_X + col * CELL_W + CELL_W / 2, y: GRID_Y + row * CELL_H + CELL_H / 2 };
}

export const QUESTION_COUNT = TRAITS.length;
export const QBTN_W = 118;
export const QBTN_H = 78;
export const QBTN_Y = 758;
const QBTN_GAP = 12;

export function questionCenter(i: number): { x: number; y: number } {
  const totalW = QUESTION_COUNT * QBTN_W + (QUESTION_COUNT - 1) * QBTN_GAP;
  const startX = (PASS_W - totalW) / 2 + QBTN_W / 2;
  return { x: startX + i * (QBTN_W + QBTN_GAP), y: QBTN_Y };
}

function bigText(text: string, size: number, fill: number, weight: '700' | '800' | '900' = '800'): Text {
  const t = new Text({
    text,
    style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fontWeight: weight, fill, align: 'center' },
  });
  t.anchor.set(0.5, 0);
  return t;
}

/**
 * Dessine UN portrait, centré sur (0,0) dans un repère local de côté `size` —
 * jamais `arc()` sans `moveTo` (piège vécu ailleurs dans le dépôt) : toutes
 * les rondeurs passent par `circle()`/`roundRect()`, des formes COMPLÈTES.
 * Les 4 traits sont des surcouches indépendantes, chacune double-codée
 * (forme ET couleur) : le sprite `suspect` de `render/sprites.ts` sert de
 * silhouette de RÉFÉRENCE pour la charte (buste neutre), mais chaque suspect
 * étant une combinaison différente des 4 traits, on le peint ici en formes
 * franches plutôt qu'en 16×16 figé — la combinatoire (16 profils) rendrait
 * une grille de sprites par profil inutilement lourde pour un gain nul.
 */
function drawPortrait(g: Graphics, size: number, s: Suspect): void {
  const half = size / 2;
  const headR = size * 0.28;
  const headCy = -half * 0.28;

  // Torse : la couleur du pull, PLUS un badge de forme (§5, jamais la couleur
  // seule) — losange pour le rouge, disque pour le bleu.
  //
  // CONTRASTES CALCULÉS, jamais jugés à l'œil (§5) : `berry` fait 3,82:1 et
  // `sky` 6,06:1 sur le `panel` de la plaque, donc le torse se détache. Le
  // badge, LUI, est posé SUR le pull : crème sur berry ne fait que 2,51:1 et
  // crème sur sky 1,58:1 — sous le 3:1 du WCAG 1.4.11 pour un élément qui
  // porte de l'information. Il reçoit donc le liseré sombre du dépôt (6,04:1
  // sur berry, 9,58:1 sur sky), qui délimite la FORME quel que soit le pull.
  const pullColor = s.redPull ? PALETTE.berry : PALETTE.sky;
  g.roundRect(-half * 0.62, half * 0.06, half * 1.24, half * 0.86, 18)
    .fill(pullColor)
    .stroke({ width: 3, color: PALETTE.outline });
  const badgeCy = half * 0.46;
  if (s.redPull) {
    const r = size * 0.09;
    g.poly([0, badgeCy - r, r, badgeCy, 0, badgeCy + r, -r, badgeCy])
      .fill(PALETTE.cream)
      .stroke({ width: 2, color: PALETTE.outline });
  } else {
    g.circle(0, badgeCy, size * 0.08).fill(PALETTE.cream).stroke({ width: 2, color: PALETTE.outline });
  }

  // Écharpe : bande neutre (jamais rouge/bleu — ne doit pas se confondre avec
  // le trait du pull), posée à cheval sur le cou.
  if (s.scarf) {
    g.roundRect(-half * 0.5, half * 0.02, half, size * 0.14, 8)
      .fill(PALETTE.leaf)
      .stroke({ width: 2, color: PALETTE.outline });
  }

  // Tête.
  g.circle(0, headCy, headR).fill(PALETTE.cream).stroke({ width: 3, color: PALETTE.outline });

  // Yeux (toujours visibles — les lunettes se posent PAR-DESSUS).
  const eyeY = headCy - headR * 0.05;
  const eyeDx = headR * 0.42;
  g.circle(-eyeDx, eyeY, headR * 0.11).fill(PALETTE.outline);
  g.circle(eyeDx, eyeY, headR * 0.11).fill(PALETTE.outline);

  // Chapeau : cylindre + bord, posé sur le haut du crâne.
  //
  // SEUL trait dont le corps déborde sur le FOND SOMBRE de la plaque : `plum`
  // y tombe à 2,49:1 (< 3:1, WCAG 1.4.11) et le liseré sombre habituel n'aide
  // pas (1,58:1 sur `panel`). Il est donc cerné de `panelEdge` (4,17:1 sur la
  // plaque) : côté crâne c'est le violet lui-même qui porte (3,86:1 sur
  // `cream`), côté plaque c'est le liseré clair. Même doctrine que les
  // marqueurs de danger de horde — la teinte porte sur les fonds clairs, le
  // liseré sur les fonds sombres.
  if (s.hat) {
    const brimY = headCy - headR * 0.72;
    g.roundRect(-headR * 0.95, brimY - 4, headR * 1.9, 8, 4)
      .fill(PALETTE.plum)
      .stroke({ width: 2, color: PALETTE.panelEdge });
    g.roundRect(-headR * 0.55, brimY - headR * 0.75, headR * 1.1, headR * 0.75, 4)
      .fill(PALETTE.plum)
      .stroke({ width: 3, color: PALETTE.panelEdge });
  }

  // Lunettes : deux disques + un pont — jamais un anneau (code réservé aux
  // dangers ailleurs dans le dépôt) : ce sont des disques PLEINS, sombres.
  if (s.glasses) {
    const gy = eyeY;
    g.circle(-eyeDx, gy, headR * 0.24).fill({ color: PALETTE.outline, alpha: 0.82 });
    g.circle(eyeDx, gy, headR * 0.24).fill({ color: PALETTE.outline, alpha: 0.82 });
    g.moveTo(-eyeDx + headR * 0.24, gy).lineTo(eyeDx - headR * 0.24, gy).stroke({ width: 3, color: PALETTE.outline });
  }
}

interface Portrait {
  readonly gfx: Graphics;
  readonly cross: Text;
}

/** Pictogramme de siège : une FORME, jamais la seule teinte (§5) — même
 *  convention que `beast` (● siège 1 / ■ siège 2), pour qu'un enfant retrouve
 *  son camp d'un jeu à l'autre. */
const SEAT_GLYPH: readonly [string, string] = ['●', '■'];
const SEAT_COLOR: readonly [number, number] = [PALETTE.sky, PALETTE.berry];

export class SuspectsView {
  readonly root = new Container();
  private readonly roundText: Text;
  /** Un libellé par siège : forme + teinte + ⭐ éventuelle + score. */
  private readonly seatTexts: Text[] = [];
  private readonly hint: Text;
  /** Plaques + liseré de révélation. Redessinées SEULEMENT quand leur
   *  signature change : rien ici ne dépend du temps, et `clear()` + tracé à
   *  60 Hz reconstruirait la géométrie pour un dessin identique. */
  private readonly frames = new Graphics();
  private lastFrames = '';
  private readonly portraits: Portrait[] = [];
  private readonly qBg = new Graphics();
  private lastQBg = '';
  private readonly qGlyphs: Text[] = [];
  private readonly qAnswers: Text[] = [];
  private readonly qHint: Text;

  constructor(
    parent: Container,
    private readonly model: SuspectsModel,
    private readonly reducedMotion: boolean,
  ) {
    // AUCUN TITRE PEINT SUR LE CANVAS, et la ligne d'état est repoussée EN BAS
    // (voir les Y ci-dessous) : le bandeau de table du shell vit en espace
    // ÉCRAN, au-dessus du plateau, et mange les ~40 à 90 premiers pixels
    // LOGIQUES selon l'échelle du letterbox — un titre posé à y = 22 s'y
    // trouvait coupé en deux (mesuré à la capture). Le nom du jeu est déjà
    // porté par la vignette du menu et par `def.title` ; le peindre ici ne
    // servait qu'à le faire disparaître à moitié.
    this.roundText = bigText('', 16, PALETTE.dim, '700');
    this.roundText.position.set(PASS_W / 2, 886);
    // Le BUT visible en permanence (§1.1 critère 3) : deux compteurs de loupes,
    // un par siège, jamais un total anonyme. Le siège se lit à sa FORME et à sa
    // teinte, et son éventuelle aide ⭐ est écrite là, sur le plateau, pendant
    // toute la manche (§1.3 : « un pictogramme, jamais un multiplicateur »).
    for (let seat = 0; seat < 2; seat++) {
      const t = bigText('', 20, SEAT_COLOR[seat], '900');
      t.position.set(seat === 0 ? PASS_W * 0.27 : PASS_W * 0.73, 840);
      this.seatTexts.push(t);
    }
    this.hint = bigText('', 16, PALETTE.cream, '800');
    this.hint.position.set(PASS_W / 2, 138);
    // Le bandeau le plus long du jeu (phase d'enquête) peut dépasser 540 px à
    // cette taille : sans retour à la ligne, le texte sortirait de l'écran au
    // lieu de simplement s'empiler — l'info reste lue de toute façon par
    // `#sr-log`/`aria-label`, mais un texte tronqué à l'écran reste moche et
    // partiellement illisible pour qui regarde le canvas.
    this.hint.style.wordWrap = true;
    this.hint.style.wordWrapWidth = PASS_W - 24;
    // SOUS les tuiles de question, pas au-dessus : au-dessus il tombait dans la
    // dernière rangée de plaques de suspects.
    this.qHint = bigText('', 14, PALETTE.dim, '700');
    this.qHint.position.set(PASS_W / 2, QBTN_Y + QBTN_H / 2 + 8);

    const s = model.state;
    for (const suspect of s.suspects) {
      const { x, y } = suspectCenter(suspect.id);
      const gfx = new Graphics();
      gfx.position.set(x, y);
      drawPortrait(gfx, PORTRAIT_SIZE, suspect);
      // Marqueur SOUS le portrait, jamais dessus : posé au-dessus il tombait
      // pile sur le chapeau, le trait le plus haut des quatre.
      const cross = bigText('', 26, PALETTE.cream, '900');
      cross.position.set(x, y + PORTRAIT_SIZE / 2 + 2);
      this.portraits.push({ gfx, cross });
    }

    for (let i = 0; i < QUESTION_COUNT; i++) {
      const { x, y } = questionCenter(i);
      const glyph = bigText(TRAITS[i].emoji, 26, PALETTE.cream, '900');
      glyph.position.set(x, y - 20);
      this.qGlyphs.push(glyph);
      const ans = bigText('', 16, PALETTE.gold, '900');
      ans.position.set(x, y + 6);
      this.qAnswers.push(ans);
    }

    this.root.addChild(this.frames, this.qBg);
    for (const p of this.portraits) this.root.addChild(p.gfx, p.cross);
    for (let i = 0; i < QUESTION_COUNT; i++) this.root.addChild(this.qGlyphs[i], this.qAnswers[i]);
    this.root.addChild(this.roundText, this.hint, this.qHint, ...this.seatTexts);
    parent.addChild(this.root);
  }

  /** @param revealing vrai pendant la fenêtre d'affichage du résultat de la
   *  DERNIÈRE manche (gérée par `index.ts`, hors du modèle — voir son
   *  commentaire) : c'est le SEUL moment où `state.lastRound` peut se dessiner
   *  sans rien trahir, la manche qu'il décrit est déjà résolue pour les deux. */
  render(time: number, revealing: boolean): void {
    const s = this.model.state;
    // La partie finie, on CONTINUE de montrer la dernière manche : le shell
    // laisse `RESULT_DELAY_SEC` pour que la cause se voie avant l'écran de
    // résultat (§1.1 critère 4), et un plateau redevenu neutre pendant ce
    // délai n'expliquerait plus rien.
    const showLast = (revealing || s.over) && s.lastRound !== null;

    const roundNo = Math.min(s.round, s.totalRounds - 1) + 1;
    const isDecisive = s.decisive || (showLast && s.lastRound?.decisive === true);
    this.roundText.text = isDecisive
      ? `manche ${roundNo} / ${s.totalRounds} · départage`
      : `manche ${roundNo} / ${s.totalRounds}`;

    const active = s.phase === 'pick' ? s.picker : s.guesser;
    for (let seat = 0; seat < 2; seat++) {
      const star = this.model.stars[seat] === 1 ? ' ⭐' : '';
      const turn = !s.over && !showLast && seat === active ? ' 👈' : '';
      this.seatTexts[seat].text = `${SEAT_GLYPH[seat]} 🔍 ${s.scores[seat]}${star}${turn}`;
    }

    const breathe = this.reducedMotion || s.over ? 1 : 1 + Math.sin(time * 2.4) * 0.03;
    this.hint.scale.set(breathe);
    this.hint.text = this.hintText(s, showLast);

    this.drawFrames(s, showLast);
    this.drawPortraits(s, showLast);
    this.drawQuestions(s);
  }

  private hintText(s: SuspectsState, showLast: boolean): string {
    const last = s.lastRound;
    if (showLast && last) {
      if (last.correct) return `🎉 trouvé ! le point va au ${SEAT_GLYPH[last.guesser]} siège ${last.guesser + 1}`;
      // Manche de départage : un raté rapporte au cachottier (cf. `accuse`).
      // La cause DOIT se lire à l'écran, sinon le point paraît sorti de nulle
      // part — c'est exactement ce que le critère 4 du §1.1 exige.
      return last.decisive
        ? `😮 raté ! coupable resté caché : le point va au ${SEAT_GLYPH[last.picker]} siège ${last.picker + 1}`
        : '😮 raté ! ce n’était pas lui';
    }
    if (s.over) return '';
    const decisive = s.decisive ? '⚖️ départage — ' : '';
    if (s.phase === 'pick') {
      return `${decisive}🤫 ${SEAT_GLYPH[s.picker]} siège ${s.picker + 1} : choisis le coupable en secret`;
    }
    const left = SUSPECTS_QUESTIONS - s.asked.length;
    const quota = left > 0 ? `${left} question${left > 1 ? 's' : ''} possible${left > 1 ? 's' : ''}, ` : '';
    return `${decisive}🔎 ${SEAT_GLYPH[s.guesser]} siège ${s.guesser + 1} : ${quota}accuse en tapant un suspect`;
  }

  private drawFrames(s: SuspectsState, showLast: boolean): void {
    const culprit = showLast && s.lastRound ? s.lastRound.culprit : -1;
    const sig = `${culprit}`;
    if (sig === this.lastFrames) return;
    this.lastFrames = sig;
    const g = this.frames;
    g.clear();
    for (const suspect of s.suspects) {
      const { x, y } = suspectCenter(suspect.id);
      // Liseré à alpha PLEIN : à 0,6 il retombait à 2,48:1 sur la plaque
      // (calculé, pas jugé à l'œil) alors qu'il délimite la carte — 4,17:1 sur
      // la plaque et 5,4:1 sur le fond une fois opaque.
      g.roundRect(x - PORTRAIT_SIZE / 2 - 14, y - PORTRAIT_SIZE / 2 - 14, PORTRAIT_SIZE + 28, PORTRAIT_SIZE + 46, 20)
        .fill(PALETTE.panel)
        .stroke({ width: 3, color: PALETTE.panelEdge });
    }
    if (culprit >= 0) {
      const { x, y } = suspectCenter(culprit);
      // EXACTEMENT les bornes de la plaque : centré sur le portrait, le cadre
      // tombait en travers du buste et n'entourait plus rien.
      drawDashedRect(g, x - PORTRAIT_SIZE / 2 - 14, y - PORTRAIT_SIZE / 2 - 14, PORTRAIT_SIZE + 28, PORTRAIT_SIZE + 46, PALETTE.gold);
    }
  }

  private drawPortraits(s: SuspectsState, showLast: boolean): void {
    for (const suspect of s.suspects) {
      const p = this.portraits[suspect.id];
      const eliminated = s.phase === 'guess' && s.showHint && s.eliminated[suspect.id];
      // Grisé À MOITIÉ, pas effacé : à 0,35 le portrait tombait à 1,65:1 sur la
      // plaque et ses traits devenaient illisibles — or l'aide ⭐ ÉCARTE un
      // suspect, elle ne le retire pas du plateau. Le ✗ sous le portrait porte
      // l'information (7:1), le grisé n'est qu'un renfort.
      p.gfx.alpha = eliminated ? 0.5 : 1;
      p.gfx.tint = eliminated ? 0x9c9c9c : 0xffffff;

      if (showLast && s.lastRound) {
        const isCulprit = suspect.id === s.lastRound.culprit;
        const isAccused = suspect.id === s.lastRound.accused;
        p.gfx.alpha = 1;
        p.gfx.tint = 0xffffff;
        p.cross.text = isCulprit ? '⭐' : isAccused ? '✗' : '';
        p.cross.style.fill = isCulprit ? PALETTE.gold : PALETTE.berry;
      } else {
        p.cross.text = eliminated ? '✗' : '';
        p.cross.style.fill = PALETTE.dim;
      }
    }
  }

  private drawQuestions(s: SuspectsState): void {
    const showQuestions = s.phase === 'guess';
    // L'aide ⭐ est ANNONCÉE sur le plateau tant qu'elle agit (§1.3) : sans
    // cette ligne, le grisé automatique ressemble à un bug pour l'un et à une
    // triche pour l'autre.
    this.qHint.text = showQuestions
      ? `${s.asked.length} / ${SUSPECTS_QUESTIONS} questions posées${s.showHint ? ' · ⭐ écartés grisés' : ''}`
      : '';
    for (let i = 0; i < QUESTION_COUNT; i++) {
      this.qGlyphs[i].visible = showQuestions;
      this.qAnswers[i].visible = showQuestions;
      const asked = s.asked.find((a) => a.trait === TRAITS[i].key);
      this.qAnswers[i].text = asked ? (asked.answer ? 'oui ✔' : 'non ✘') : '';
      // L'encre de la réponse redouble le mot par une COULEUR et le glyphe
      // ✔/✘ par une FORME : trois codes pour la même information. Les deux
      // encres sont mesurées SUR LA PLAQUE SOMBRE (6,46:1 et 7:1) — c'est la
      // raison pour laquelle la tuile posée ne s'éclaircit PAS (voir plus bas).
      this.qAnswers[i].style.fill = asked && !asked.answer ? PALETTE.dim : PALETTE.leaf;
    }

    const sig = showQuestions ? s.asked.map((a) => a.trait).join(',') : 'off';
    if (sig === this.lastQBg) return;
    this.lastQBg = sig;
    const g = this.qBg;
    g.clear();
    if (!showQuestions) return;
    for (let i = 0; i < QUESTION_COUNT; i++) {
      const { x, y } = questionCenter(i);
      const asked = s.asked.some((a) => a.trait === TRAITS[i].key);
      // Une question déjà posée garde le fond SOMBRE et prend un liseré DORÉ
      // épais. Éclaircir la tuile (l'ancien `fill(panelEdge)`) écrasait la
      // réponse elle-même : « oui »/« non » n'y faisait plus que 1,65:1,
      // c'est-à-dire l'information centrale du jeu devenue illisible.
      g.roundRect(x - QBTN_W / 2, y - QBTN_H / 2, QBTN_W, QBTN_H, 14)
        .fill(PALETTE.panel)
        .stroke({ width: asked ? 4 : 2, color: asked ? PALETTE.gold : PALETTE.panelEdge });
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}



/** Rectangle en pointillé (pattern repris de `tiles/view.ts`) — jamais `arc()`
 *  sans `moveTo` (piège vécu ailleurs dans le dépôt). Le POINTILLÉ est le
 *  second code du coupable révélé, l'étoile posée sous le portrait étant le
 *  premier : jamais la couleur seule (§5). */
function drawDashedRect(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  const dash = 10;
  const gap = 7;
  const sides: [number, number, number, number][] = [
    [x, y, x + w, y],
    [x + w, y, x + w, y + h],
    [x + w, y + h, x, y + h],
    [x, y + h, x, y],
  ];
  for (const [x1, y1, x2, y2] of sides) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    // Pas ajusté pour que le dernier tiret ferme le côté : sinon les quatre
    // coins restaient ouverts et le cadre ne se lisait plus comme un cadre.
    const steps = Math.max(1, Math.round((len + gap) / (dash + gap)));
    const step = steps > 1 ? (len - dash) / (steps - 1) : 0;
    for (let i = 0; i < steps; i++) {
      const sx = x1 + ux * i * step;
      const sy = y1 + uy * i * step;
      g.moveTo(sx, sy).lineTo(sx + ux * dash, sy + uy * dash);
    }
  }
  g.stroke({ width: 3, color });
}
