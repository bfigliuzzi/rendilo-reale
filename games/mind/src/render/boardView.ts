import { Sprite, Text } from 'pixi.js';
import { clamp } from '@shared/math';
import {
  DESIGN_H,
  DESIGN_W,
  LABEL_W,
  MARK_CX,
  MAX_PEGS,
  MAX_ROWS,
  PALETTE_Y,
  PEG_DROP_H,
  PEG_POP_TIME,
  POP_SCALE,
  REVEAL_POP_TIME,
  REVEAL_STAGGER,
  REVEAL_TIME,
  SECRET_Y,
  SEPARATOR_Y,
  SHOCKWAVE_TIME,
  STATUS_Y,
  TOP_BAR_Y,
  markOffset,
  paletteX,
  rowH,
  rowY,
  slotX,
} from '../config/balance';
import type { DifficultyDef } from '../config/rules';
import type { Board } from '../game/board';
import { symbolAt, symbolCount } from '../game/board';
import type { Layers } from './layers';
import { PALETTE, pegFrameIndex } from './textures';
import type { Atlas } from './textures';

/** Ce que le rendu a besoin de savoir en plus de l'état de jeu. */
export interface BoardViewInput {
  /** Symbole sélectionné dans la palette, ou `null`. */
  selected: number | null;
  /** Emplacement visé (focus clavier ou dernier tap), −1 si aucun. */
  focusSlot: number;
  /** Le code secret est-il découvert ? */
  revealed: boolean;
  /** Bandeau de statut, sous le plateau. */
  status: string;
  /** Voile de flash (piloté par Fx). */
  flashColor: number;
  flashAlpha: number;
  /** Vignette de tension : 0 = calme, 1 = dernier essai. */
  tension: number;
}

const SHOCK_CAP = 8;
/** Les textures sont en supersampling ×2. */
const SPRITE_SCALE = 0.5;

/**
 * Rendu du plateau. Tout ce qui bouge ici est du RENDU PUR : les rebonds, la
 * cascade de révélation des indices et les ondes de choc sont des fonctions
 * closes du temps écoulé, sans état de simulation. Le modèle (`Board`) ne sait
 * pas que cette classe existe — c'est ce qui garantit que le bot headless mesure
 * la logique et non l'animation.
 */
export class BoardView {
  /** `rowPegs[row * MAX_PEGS + slot]` — socle, pion, ou masqué. */
  private readonly rowPegs: Sprite[] = [];
  private readonly rowMarks: Sprite[] = [];
  private readonly secretPegs: Sprite[] = [];
  private readonly palettePegs: Sprite[] = [];
  private readonly rowLabels: Text[] = [];
  private readonly topText: Text;
  private readonly statusText: Text;

  // ── diff et minuteries de rendu
  /** Dernière valeur affichée par emplacement : −2 = vide, sinon la valeur. */
  private readonly shown = new Int8Array(MAX_ROWS * MAX_PEGS);
  /** Instant d'apparition du pion, pour le rebond. */
  private readonly popAt = new Float32Array(MAX_ROWS * MAX_PEGS);
  /** Instant de validation de la ligne, pour la cascade d'indices. */
  private readonly revealAt = new Float32Array(MAX_ROWS);
  private readonly hadFeedback = new Uint8Array(MAX_ROWS);
  private secretRevealAt = -1;
  private wasRevealed = false;

  // ── ondes de choc (pool circulaire, zéro alloc)
  private readonly shockX = new Float32Array(SHOCK_CAP);
  private readonly shockY = new Float32Array(SHOCK_CAP);
  private readonly shockAt = new Float32Array(SHOCK_CAP);
  private readonly shockColor = new Int32Array(SHOCK_CAP);
  private shockNext = 0;

  private def: DifficultyDef | null = null;
  private lastTop = '';
  private lastStatus = '';

  constructor(
    private readonly layers: Layers,
    private readonly atlas: Atlas,
  ) {
    const label = {
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: 15,
      fontWeight: '700' as const,
      fill: PALETTE.textDim,
    };

    for (let r = 0; r < MAX_ROWS; r++) {
      for (let s = 0; s < MAX_PEGS; s++) {
        const peg = new Sprite(atlas.socket);
        peg.anchor.set(0.5);
        peg.scale.set(SPRITE_SCALE);
        peg.visible = false;
        this.rowPegs.push(peg);
        this.layers.pegs.addChild(peg);

        const mark = new Sprite(atlas.markBlank);
        mark.anchor.set(0.5);
        mark.scale.set(SPRITE_SCALE);
        mark.visible = false;
        this.rowMarks.push(mark);
        this.layers.marks.addChild(mark);
      }
      const t = new Text({ text: `${r + 1}`, style: label });
      t.anchor.set(1, 0.5);
      t.visible = false;
      this.rowLabels.push(t);
      this.layers.labels.addChild(t);
    }

    for (let s = 0; s < MAX_PEGS; s++) {
      const peg = new Sprite(atlas.masked);
      peg.anchor.set(0.5);
      peg.scale.set(SPRITE_SCALE);
      peg.visible = false;
      this.secretPegs.push(peg);
      this.layers.pegs.addChild(peg);
    }

    for (let i = 0; i < MAX_PEGS + 4; i++) {
      const peg = new Sprite(atlas.pegFrames[0]);
      peg.anchor.set(0.5);
      peg.scale.set(SPRITE_SCALE);
      peg.visible = false;
      this.palettePegs.push(peg);
      this.layers.pegs.addChild(peg);
    }

    this.topText = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 18,
        fontWeight: '900',
        fill: PALETTE.text,
      },
    });
    this.topText.anchor.set(0.5);
    this.topText.position.set(DESIGN_W / 2, TOP_BAR_Y);
    this.layers.labels.addChild(this.topText);

    this.statusText = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 15,
        fontWeight: '700',
        fill: PALETTE.textDim,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 460,
      },
    });
    this.statusText.anchor.set(0.5);
    this.statusText.position.set(DESIGN_W / 2, STATUS_Y);
    this.layers.labels.addChild(this.statusText);
  }

  /** (Re)pose la géométrie pour une difficulté. Appelé à chaque début de partie. */
  setup(def: DifficultyDef): void {
    this.def = def;
    this.shown.fill(-2);
    this.popAt.fill(-99);
    this.revealAt.fill(-99);
    this.hadFeedback.fill(0);
    this.shockAt.fill(-99);
    this.secretRevealAt = -1;
    this.wasRevealed = false;
    this.lastTop = '';
    this.lastStatus = '';

    for (let r = 0; r < MAX_ROWS; r++) {
      const active = r < def.tries;
      this.rowLabels[r].visible = active;
      if (active) this.rowLabels[r].position.set(LABEL_W - 10, rowY(r, def.tries));
      for (let s = 0; s < MAX_PEGS; s++) {
        const i = r * MAX_PEGS + s;
        const on = active && s < def.pegs;
        this.rowPegs[i].visible = on;
        this.rowMarks[i].visible = on;
        if (!on) continue;
        this.rowPegs[i].position.set(slotX(s, def.pegs), rowY(r, def.tries));
        this.rowPegs[i].texture = this.atlas.socket;
        const off = markOffset(s, def.pegs);
        this.rowMarks[i].position.set(MARK_CX + off.dx, rowY(r, def.tries) + off.dy);
        this.rowMarks[i].texture = this.atlas.markBlank;
      }
    }

    for (let s = 0; s < MAX_PEGS; s++) {
      const on = s < def.pegs;
      this.secretPegs[s].visible = on;
      if (on) {
        this.secretPegs[s].position.set(slotX(s, def.pegs), SECRET_Y);
        this.secretPegs[s].texture = this.atlas.masked;
        this.secretPegs[s].scale.set(SPRITE_SCALE);
      }
    }

    const symbols = symbolCount(def);
    for (let i = 0; i < this.palettePegs.length; i++) {
      const on = i < symbols;
      this.palettePegs[i].visible = on;
      if (on) {
        this.palettePegs[i].position.set(paletteX(i, symbols), PALETTE_Y);
        this.palettePegs[i].texture = this.atlas.pegFrames[pegFrameIndex(symbolAt(def, i))];
      }
    }
  }

  /** Déclenche une onde de choc à la pose d'un pion. */
  shockwave(x: number, y: number, color: number, time: number): void {
    const i = this.shockNext++ % SHOCK_CAP;
    this.shockX[i] = x;
    this.shockY[i] = y;
    this.shockAt[i] = time;
    this.shockColor[i] = color;
  }

  /**
   * Reconstruit l'affichage. `time` est l'horloge de la partie (avancée à pas
   * fixe par World) : toutes les animations en sont des fonctions closes.
   */
  sync(board: Board, input: BoardViewInput, time: number): void {
    const def = this.def;
    if (!def) return;

    this.syncRows(board, def, time);
    this.syncSecret(board, def, input, time);
    this.syncPalette(def, input, time);
    this.drawBoard(board, def, input);
    this.drawOverlay(board, def, input, time);
    this.syncLabels(board, def, input);
  }

  // ───────────────────────────────────────────── lignes jouées et ligne en cours

  private syncRows(board: Board, def: DifficultyDef, time: number): void {
    for (let r = 0; r < def.tries; r++) {
      const row = board.rows[r];

      // la cascade d'indices démarre à la validation de la ligne
      if (row.feedback && !this.hadFeedback[r]) {
        this.hadFeedback[r] = 1;
        this.revealAt[r] = time;
      }

      for (let s = 0; s < def.pegs; s++) {
        const i = r * MAX_PEGS + s;
        const value = row.pegs[s];
        const code = value === null ? -2 : value;
        if (code !== this.shown[i]) {
          // un pion qui APPARAÎT rebondit ; un pion retiré disparaît sec
          if (code !== -2) this.popAt[i] = time;
          this.shown[i] = code;
          this.rowPegs[i].texture = code === -2 ? this.atlas.socket : this.atlas.pegFrames[pegFrameIndex(code)];
        }

        const sprite = this.rowPegs[i];
        const baseY = rowY(r, def.tries);
        if (code === -2) {
          sprite.position.set(slotX(s, def.pegs), baseY);
          sprite.scale.set(SPRITE_SCALE);
          // le socle de la ligne en cours respire doucement
          const breathe = r === board.activeRow && !board.over ? 1 + Math.sin(time * 3 + s) * 0.03 : 1;
          sprite.scale.set(SPRITE_SCALE * breathe);
          sprite.alpha = 1;
        } else {
          const p = clamp((time - this.popAt[i]) / PEG_POP_TIME, 0, 1);
          // chute puis squash-and-stretch : sinusoïde amortie, forme close
          const drop = PEG_DROP_H * (1 - p) * (1 - p);
          const wobble = p < 1 ? Math.sin(p * Math.PI * 2.4) * Math.exp(-p * 4) * POP_SCALE : 0;
          sprite.position.set(slotX(s, def.pegs), baseY - drop);
          sprite.scale.set(SPRITE_SCALE * (1 - wobble * 0.5), SPRITE_SCALE * (1 + wobble));
          sprite.alpha = 1;
        }

        // marqueur d'indice — pop en cascade, décalé de REVEAL_STAGGER
        const mark = this.rowMarks[i];
        const fb = row.feedback;
        if (!fb) {
          mark.texture = this.atlas.markBlank;
          mark.scale.set(SPRITE_SCALE);
          mark.alpha = 0.55;
          continue;
        }
        mark.texture =
          s < fb.exact
            ? this.atlas.markExact
            : s < fb.exact + fb.misplaced
              ? this.atlas.markMisplaced
              : this.atlas.markBlank;
        const mp = clamp((time - this.revealAt[r] - s * REVEAL_STAGGER) / REVEAL_POP_TIME, 0, 1);
        const overshoot = mp < 1 ? 1 + Math.sin(mp * Math.PI) * 0.75 : 1;
        mark.scale.set(SPRITE_SCALE * overshoot * (mp > 0 ? 1 : 0));
        mark.alpha = s < fb.exact + fb.misplaced ? mp : mp * 0.55;
      }
    }
  }

  // ───────────────────────────────────────────── code secret

  private syncSecret(board: Board, def: DifficultyDef, input: BoardViewInput, time: number): void {
    if (input.revealed && !this.wasRevealed) {
      this.wasRevealed = true;
      this.secretRevealAt = time;
    }
    for (let s = 0; s < def.pegs; s++) {
      const sprite = this.secretPegs[s];
      if (!input.revealed) {
        sprite.texture = this.atlas.masked;
        // le couvercle frémit : le code est là, tout près
        sprite.scale.set(SPRITE_SCALE, SPRITE_SCALE * (1 + Math.sin(time * 2.2 + s * 0.7) * 0.03));
        continue;
      }
      // volet : chaque case se déroule, décalée — la révélation se LIT
      const p = clamp((time - this.secretRevealAt - s * (REVEAL_TIME / def.pegs)) / (REVEAL_TIME / 2), 0, 1);
      sprite.texture = p > 0.5 ? this.atlas.pegFrames[pegFrameIndex(board.secret[s])] : this.atlas.masked;
      const flip = Math.abs(Math.cos(p * Math.PI));
      sprite.scale.set(SPRITE_SCALE, SPRITE_SCALE * Math.max(0.06, flip));
    }
  }

  // ───────────────────────────────────────────── palette

  private syncPalette(def: DifficultyDef, input: BoardViewInput, time: number): void {
    const symbols = symbolCount(def);
    for (let i = 0; i < symbols; i++) {
      const sprite = this.palettePegs[i];
      const picked = input.selected === i;
      // flottement au repos, surélévation quand sélectionné
      const bob = Math.sin(time * 2 + i * 0.8) * 2.2;
      sprite.position.set(paletteX(i, symbols), PALETTE_Y + bob - (picked ? 7 : 0));
      sprite.scale.set(SPRITE_SCALE * (picked ? 1.16 : 1));
      sprite.alpha = 1;
    }
  }

  // ───────────────────────────────────────────── cadres

  private drawBoard(board: Board, def: DifficultyDef, input: BoardViewInput): void {
    const g = this.layers.board;
    g.clear();

    // panneau du code secret
    g.roundRect(LABEL_W - 12, SECRET_Y - 30, MARK_CX - LABEL_W + 24, 60, 12)
      .fill({ color: PALETTE.boardBg, alpha: 0.92 })
      .stroke({ color: PALETTE.boardEdge, width: 2 });

    // séparateur
    g.moveTo(24, SEPARATOR_Y).lineTo(DESIGN_W - 24, SEPARATOR_Y).stroke({ color: PALETTE.boardEdge, width: 2, alpha: 0.7 });

    // panneau des essais
    const h = rowH(def.tries);
    const top = rowY(0, def.tries) - h / 2;
    const bottom = rowY(def.tries - 1, def.tries) + h / 2;
    g.roundRect(14, top, DESIGN_W - 28, bottom - top, 14)
      .fill({ color: PALETTE.boardBg, alpha: 0.72 })
      .stroke({ color: PALETTE.boardEdge, width: 2, alpha: 0.8 });

    // cadre de la ligne en cours : jaune + épais, il ne dépend pas que de la teinte
    if (!board.over) {
      const y = rowY(board.activeRow, def.tries);
      g.roundRect(18, y - h / 2 + 2, DESIGN_W - 36, h - 4, 10).stroke({
        color: PALETTE.accent,
        width: 3,
        alpha: 0.95,
      });
    }

    // socle de la palette
    g.roundRect(18, PALETTE_Y - 32, DESIGN_W - 36, 64, 14)
      .fill({ color: PALETTE.boardBg, alpha: 0.88 })
      .stroke({ color: PALETTE.boardEdge, width: 2 });

    // vignette de tension : un liseré qui bat sur tout le pourtour
    if (input.tension > 0) {
      g.roundRect(3, 3, DESIGN_W - 6, bottom, 16).stroke({
        color: PALETTE.lose,
        width: 5,
        alpha: 0.16 + input.tension * 0.4,
      });
    }
  }

  // ───────────────────────────────────────────── anneaux, ondes, flash

  private drawOverlay(board: Board, def: DifficultyDef, input: BoardViewInput, time: number): void {
    const g = this.layers.overlay;
    g.clear();

    // anneau de la couleur sélectionnée + caret ▲ : la sélection se lit à la
    // FORME (anneau et flèche), pas seulement à la position surélevée
    if (input.selected !== null) {
      const symbols = symbolCount(def);
      const x = paletteX(input.selected, symbols);
      const y = PALETTE_Y - 7;
      g.circle(x, y, 26).stroke({ color: PALETTE.accent, width: 3 });
      g.moveTo(x - 7, y + 34).lineTo(x + 7, y + 34).lineTo(x, y + 25).closePath().fill(PALETTE.accent);
    }

    // Anneau tournant sur l'emplacement visé. `moveTo` avant chaque `arc` est
    // OBLIGATOIRE : sans lui, Pixi relie les segments au tracé précédent et l'on
    // se retrouve avec une ligne qui barre le plateau.
    if (!board.over && input.focusSlot >= 0 && input.focusSlot < def.pegs) {
      const x = slotX(input.focusSlot, def.pegs);
      const y = rowY(board.activeRow, def.tries);
      const spin = time * 1.6;
      for (let k = 0; k < 4; k++) {
        const a = spin + (k / 4) * Math.PI * 2;
        g.moveTo(x + Math.cos(a) * 27, y + Math.sin(a) * 27)
          .arc(x, y, 27, a, a + 0.72)
          .stroke({ color: PALETTE.cool, width: 3 });
      }
    }

    // ondes de choc
    for (let i = 0; i < SHOCK_CAP; i++) {
      const p = (time - this.shockAt[i]) / SHOCKWAVE_TIME;
      if (p < 0 || p > 1) continue;
      g.circle(this.shockX[i], this.shockY[i], 14 + p * 40).stroke({
        color: this.shockColor[i],
        width: 3 * (1 - p),
        alpha: 1 - p,
      });
    }

    // voile de flash — alpha plafonné par Fx, jamais stroboscopique
    if (input.flashAlpha > 0) {
      g.rect(0, 0, DESIGN_W, DESIGN_H).fill({
        color: input.flashColor,
        alpha: input.flashAlpha,
      });
    }
  }

  // ───────────────────────────────────────────── textes

  private syncLabels(board: Board, def: DifficultyDef, input: BoardViewInput): void {
    const left = board.triesLeft;
    const top = board.over
      ? `${def.name} — ${board.solved ? 'code trouvé' : 'code manqué'}`
      : `${def.name} · ${left} essai${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''}`;
    if (top !== this.lastTop) {
      this.lastTop = top;
      this.topText.text = top;
      this.topText.style.fill = board.over ? (board.solved ? PALETTE.win : PALETTE.lose) : PALETTE.text;
    }
    if (input.status !== this.lastStatus) {
      this.lastStatus = input.status;
      this.statusText.text = input.status;
    }
    // les essais restants passent au rouge dès qu'ils se comptent sur une main
    for (let r = 0; r < def.tries; r++) {
      const played = board.rows[r].feedback !== null;
      this.rowLabels[r].alpha = played ? 0.5 : r === board.activeRow && !board.over ? 1 : 0.75;
    }
  }
}
