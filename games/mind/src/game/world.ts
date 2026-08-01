import { Sprite } from 'pixi.js';
import { clamp } from '@shared/math';
import {
  DESIGN_H,
  DESIGN_W,
  MARK_CX,
  PALETTE_Y,
  SECRET_Y,
  LOSE_RESULT_DELAY,
  SHAKE_PER_EXACT,
  SHAKE_SUBMIT,
  TENSION_FROM_TRIES,
  WIN_CONFETTI,
  WIN_RESULT_DELAY,
  markOffset,
  paletteX,
  rowY,
  slotX,
} from '../config/balance';
import { pegName } from '../config/pegs';
import type { DifficultyDef, Feedback } from '../config/rules';
import type { Sfx } from '../audio/sfx';
import type { Ambience } from '../render/ambience';
import { BoardView } from '../render/boardView';
import type { BoardViewInput } from '../render/boardView';
import { CatView } from '../render/catView';
import type { Fx } from '../render/fx';
import type { Layers } from '../render/layers';
import { PALETTE, pegColor, pegFrameIndex } from '../render/textures';
import type { Atlas } from '../render/textures';
import { Board, symbolAt, symbolCount } from './board';
import { Cat } from './cat';
import type { MischiefEvent } from './cat';

/** Statistiques d'une partie, lues une seule fois par Flow à la fin. */
export interface RunStats {
  guesses: number;
  exactPegs: number;
  mischiefs: number;
  undos: number;
}

const RAY_COUNT = 14;

// Objet d'entrée du rendu réutilisé d'une frame à l'autre : `render` tourne à la
// fréquence de l'écran, y allouer un littéral ferait travailler le GC pour rien.
const VIEW_INPUT: BoardViewInput = {
  selected: null,
  focusSlot: 0,
  revealed: false,
  status: '',
  flashColor: 0xffffff,
  flashAlpha: 0,
  tension: 0,
};

/**
 * Racine de la simulation. Elle orchestre le modèle pur (`Board`), le chat et les
 * couches de rendu, et traduit les événements de jeu en effets (pattern du repo :
 * les systèmes remontent des callbacks, la racine les convertit en fx/sfx).
 *
 * World ne connaît ni les modes, ni la sauvegarde, ni les écrans — c'est
 * `game/flow.ts` qui s'en charge.
 */
export class World {
  board: Board | null = null;
  readonly cat: Cat;
  playing = false;
  /** Le code secret est-il découvert ? (fin de partie) */
  revealed = false;
  /** Symbole choisi dans la palette, en index de palette. */
  selected: number | null = null;
  /** Emplacement visé, poussé par le HUD (le focus DOM est la source de vérité). */
  focusSlot = 0;
  /** Horloge de la partie — pilote toutes les animations de rendu. */
  time = 0;
  elapsed = 0;
  readonly run: RunStats = { guesses: 0, exactPegs: 0, mischiefs: 0, undos: 0 };

  onRowValidated: (row: number, fb: Feedback) => void = () => {};
  onRowComplete: () => void = () => {};
  /** Le plateau a changé (pose, retrait, échange, annulation, validation). */
  onBoardChanged: () => void = () => {};
  onMischief: (e: MischiefEvent) => void = () => {};
  onGameOver: (victory: boolean, timeSec: number, tries: number) => void = () => {};

  private readonly boardView: BoardView;
  private readonly catView: CatView;
  private readonly rays: Sprite[] = [];
  private readonly dragSprite: Sprite;
  private raysLife = 0;
  private status = '';
  private sinceTrail = 0;
  /** Fin de partie en attente : l'écran de résultat est DIFFÉRÉ (voir finish). */
  private pendingResult: { victory: boolean; timeSec: number; tries: number } | null = null;
  private resultDelay = 0;

  constructor(
    private readonly layers: Layers,
    private readonly atlas: Atlas,
    private readonly fx: Fx,
    private readonly ambience: Ambience,
    private readonly sfx: Sfx,
  ) {
    this.boardView = new BoardView(layers, atlas);
    this.catView = new CatView(layers.cat, atlas);
    this.cat = new Cat(1);
    this.cat.onMischief = (e): void => this.handleMischief(e);
    this.cat.onMeow = (): void => this.sfx.meow();
    this.cat.onPaw = (): void => this.sfx.paw();

    for (let i = 0; i < RAY_COUNT; i++) {
      const ray = new Sprite(atlas.ray);
      ray.anchor.set(0.5, 1);
      ray.rotation = (i / RAY_COUNT) * Math.PI * 2;
      ray.scale.set(0.5);
      ray.visible = false;
      ray.tint = i % 2 === 0 ? PALETTE.accent : PALETTE.cool;
      this.rays.push(ray);
      layers.rays.addChild(ray);
    }
    layers.rays.position.set(DESIGN_W / 2, DESIGN_H * 0.34);

    this.dragSprite = new Sprite(atlas.pegFrames[0]);
    this.dragSprite.anchor.set(0.5);
    this.dragSprite.scale.set(0.62); // légèrement plus gros : il est « en main »
    this.dragSprite.visible = false;
    layers.drag.addChild(this.dragSprite);
  }

  /**
   * Pion porté au doigt. `index` en index de palette, ou `null` pour lâcher.
   * Purement visuel : le modèle ne bouge qu'au dépôt.
   */
  setDrag(index: number | null, x: number, y: number): void {
    const board = this.board;
    this.dragSprite.visible = index !== null;
    if (index === null || !board) return;
    this.dragSprite.texture = this.atlas.pegFrames[pegFrameIndex(symbolAt(board.def, index))];
    this.dragSprite.position.set(x, y);
    // traînée de comète, throttlée pour ne pas noyer le pool
    this.sinceTrail += 1;
    if (this.sinceTrail >= 3) {
      this.sinceTrail = 0;
      this.fx.burst(x, y, {
        count: 2,
        color: pegColor(symbolAt(board.def, index)),
        speed: 40,
        life: 0.3,
        size: 0.24,
      });
    }
  }

  /** Échange deux emplacements — geste de glisser-déposer d'un pion posé. */
  swapSlots(a: number, b: number): void {
    const board = this.board;
    if (!board || !board.swapPegs(a, b)) return;
    this.sfx.place();
    for (const s of [a, b]) {
      const v = board.active.pegs[s];
      if (v !== null) this.pegLanded(s, v);
    }
    this.afterEdit(board);
  }

  /** Démarre une partie. `seed` rend le code secret reproductible. */
  loadGame(def: DifficultyDef, seed: number, catEnabled: boolean, mischief: boolean): void {
    this.board = new Board(def, seed);
    this.playing = true;
    this.revealed = false;
    this.selected = null;
    this.time = 0;
    this.elapsed = 0;
    this.run.guesses = 0;
    this.run.exactPegs = 0;
    this.run.mischiefs = 0;
    this.run.undos = 0;
    this.raysLife = 0;
    this.pendingResult = null;
    this.resultDelay = 0;

    this.fx.clear();
    this.ambience.clear();
    this.ambience.spawn();
    this.ambience.setProgress(0, def.pegs);
    this.boardView.setup(def);
    // le chat est semé à part : sa graine ne doit pas dépendre du code secret,
    // sinon rejouer le même tirage rejouerait exactement les mêmes farces
    this.cat.setEnabled(catEnabled);
    this.cat.setMischief(mischief);
    this.cat.reset((seed ^ 0x9e3779b9) >>> 0);
    for (const ray of this.rays) ray.visible = false;
    this.layers.pegs.alpha = 1;
    this.updateStatus();
  }

  leave(): void {
    this.playing = false;
    this.board = null;
    this.pendingResult = null;
    this.resultDelay = 0;
    this.dragSprite.visible = false;
    this.fx.clear();
    this.ambience.clear();
    this.catView.hide();
    for (const ray of this.rays) ray.visible = false;
  }

  // ───────────────────────────────────────────────────────── commandes joueur

  pick(index: number): void {
    const board = this.board;
    if (!board || board.over) return;
    if (index < 0 || index >= symbolCount(board.def)) return;
    if (this.selected === index) return;
    this.selected = index;
    this.sfx.select();
    // gerbe d'étincelles sur la pastille choisie
    const x = paletteX(index, symbolCount(board.def));
    this.fx.burst(x, PALETTE_Y - 7, {
      count: 10,
      color: pegColor(symbolAt(board.def, index)),
      speed: 120,
      life: 0.3,
      size: 0.3,
    });
    this.updateStatus();
  }

  /** Pose la couleur sélectionnée sur un emplacement (tap ou Entrée). */
  place(slot: number): void {
    if (this.selected === null) {
      this.updateStatus();
      return;
    }
    this.setSlot(slot, this.selected);
  }

  /** Pose un symbole donné (clavier 1-8/0, glisser-déposer). */
  setSlot(slot: number, index: number): void {
    const board = this.board;
    if (!board || board.over) return;
    const value = symbolAt(board.def, index);
    if (!board.setPeg(slot, value)) return;
    this.selected = index;
    this.sfx.place();
    this.pegLanded(slot, value);
    this.afterEdit(board);
  }

  clearSlot(slot: number): void {
    const board = this.board;
    if (!board || board.over) return;
    if (board.active.pegs[slot] === null) return;
    board.setPeg(slot, null);
    this.sfx.remove();
    this.fx.burst(slotX(slot, board.def.pegs), rowY(board.activeRow, board.def.tries), {
      count: 6,
      color: PALETTE.textDim,
      speed: 90,
      life: 0.24,
      size: 0.25,
    });
    this.updateStatus();
    this.onBoardChanged();
  }

  submit(): Feedback | null {
    const board = this.board;
    if (!board) return null;
    const row = board.activeRow;
    const fb = board.submit();
    if (!fb) return null;

    this.run.guesses++;
    this.run.exactPegs += fb.exact;

    // le slam : shake proportionnel au nombre de bien placés
    this.fx.shake(SHAKE_SUBMIT + fb.exact * SHAKE_PER_EXACT);
    this.sfx.submit();

    // gerbes sur chaque marqueur, dans l'ordre de la cascade
    const def = board.def;
    for (let k = 0; k < fb.exact + fb.misplaced; k++) {
      const exact = k < fb.exact;
      const off = markOffset(k, def.pegs);
      this.fx.burst(MARK_CX + off.dx, rowY(row, def.tries) + off.dy, {
        count: exact ? 14 : 8,
        color: exact ? PALETTE.accent : PALETTE.cool,
        speed: exact ? 190 : 120,
        life: 0.42,
        size: exact ? 0.34 : 0.26,
      });
      this.sfx.mark(exact, k);
    }

    this.ambience.setProgress(board.bestExact(), def.pegs);
    this.onRowValidated(row, fb);

    if (!board.over && fb.exact === def.pegs - 1) {
      // presque : le plateau pulse en or, un frisson monte
      this.fx.flash(PALETTE.accent, 0.3);
      this.sfx.nearMiss();
    }

    if (board.over) this.finish(board);
    else this.updateStatus();
    this.onBoardChanged();
    return fb;
  }

  undo(): boolean {
    const board = this.board;
    if (!board || !board.undo()) return false;
    this.run.undos++;
    this.sfx.undo();
    this.fx.burst(slotX(0, board.def.pegs), rowY(board.activeRow, board.def.tries), {
      count: 12,
      color: PALETTE.cool,
      speed: 150,
      life: 0.3,
      size: 0.28,
    });
    this.updateStatus();
    this.onBoardChanged();
    return true;
  }

  /** Le chat, déclenché à la demande — utilisé par le bot de vérification. */
  forceCatMischief(): boolean {
    return this.board ? this.cat.forceMischief(this.board) : false;
  }

  // ───────────────────────────────────────────────────────── interne

  private pegLanded(slot: number, value: number): void {
    const board = this.board;
    if (!board) return;
    const x = slotX(slot, board.def.pegs);
    const y = rowY(board.activeRow, board.def.tries);
    const color = pegColor(value);
    this.fx.burst(x, y + 14, { count: 9, color, speed: 130, life: 0.3, size: 0.3 });
    this.boardView.shockwave(x, y, color, this.time);
  }

  private afterEdit(board: Board): void {
    this.updateStatus();
    this.onBoardChanged();
    // la ligne vient de se compléter : on amène le focus sur ✓ Valider, pour que
    // Entrée valide sans avoir à tabuler (géré côté Hud, qui vérifie que le focus
    // était bien dans le plateau)
    if (board.complete()) this.onRowComplete();
  }

  private handleMischief(e: MischiefEvent): void {
    const board = this.board;
    if (!board) return;
    this.run.mischiefs++;
    const y = rowY(board.activeRow, board.def.tries);
    if (e.kind === 'swap') {
      for (const s of [e.a, e.b]) {
        this.fx.burst(slotX(s, board.def.pegs), y, {
          count: 12,
          color: PALETTE.textDim,
          speed: 160,
          life: 0.34,
          size: 0.3,
        });
      }
    } else {
      this.fx.burst(slotX(e.a, board.def.pegs), y, {
        count: 16,
        color: e.stolen === null ? PALETTE.textDim : pegColor(e.stolen),
        speed: 200,
        life: 0.4,
        size: 0.32,
        gravity: -220,
      });
    }
    this.fx.shake(4);
    this.onMischief(e);
    this.updateStatus();
    this.onBoardChanged();
  }

  private finish(board: Board): void {
    this.playing = false;
    this.revealed = true;
    this.ambience.setTension(false);

    if (board.solved) {
      this.sfx.victory();
      this.fx.flash(PALETTE.win, 0.3);
      this.fx.shake(9);
      this.raysLife = 3.4;
      for (const ray of this.rays) ray.visible = true;
      // fontaine de confettis : deux jets obliques, teintés par le code trouvé
      for (let k = 0; k < board.def.pegs; k++) {
        const color = pegColor(board.secret[k]);
        for (const side of [-1, 1]) {
          this.fx.burst(side < 0 ? 40 : DESIGN_W - 40, DESIGN_H * 0.78, {
            count: Math.round(WIN_CONFETTI / (board.def.pegs * 2)),
            color,
            speed: 620,
            life: 2.6,
            size: 0.8,
            gravity: 320,
            spin: 9,
            confetti: true,
            dir: side < 0 ? -Math.PI / 3 : -Math.PI + Math.PI / 3,
            spread: 0.42,
          });
        }
      }
      this.cat.celebrate();
    } else {
      this.sfx.defeat();
      this.fx.shake(7);
      // le plateau se délite : chaque pion joué tombe et rebondit hors du cadre
      for (let r = 0; r < board.def.tries; r++) {
        for (let s = 0; s < board.def.pegs; s++) {
          const v = board.rows[r].pegs[s];
          if (v === null) continue;
          this.fx.burst(slotX(s, board.def.pegs), rowY(r, board.def.tries), {
            count: 2,
            color: pegColor(v),
            speed: 60,
            life: 1.8,
            size: 0.7,
            gravity: 520,
            spin: 6,
            confetti: true,
          });
        }
      }
      this.layers.pegs.alpha = 0.72;
    }

    this.updateStatus();
    // L'écran de résultat attend que le code se dévoile et que les confettis
    // partent : ouvrir le panneau tout de suite masquerait toute la récompense.
    this.pendingResult = { victory: board.solved, timeSec: this.elapsed, tries: board.played };
    this.resultDelay = board.solved ? WIN_RESULT_DELAY : LOSE_RESULT_DELAY;
  }

  private updateStatus(): void {
    const board = this.board;
    if (!board) {
      this.status = '';
      return;
    }
    if (board.over) {
      this.status = board.solved
        ? `Code trouvé en ${board.played} essai${board.played > 1 ? 's' : ''} !`
        : 'Essais épuisés — voici le code.';
      return;
    }
    if (board.canUndo) {
      this.status = 'Le chat est passé par là… ↩ pour revenir en arrière.';
      return;
    }
    if (board.complete()) {
      this.status = 'Ligne complète — valide pour connaître les indices.';
      return;
    }
    if (this.selected === null) {
      this.status = 'Choisis une couleur en bas, puis un emplacement.';
      return;
    }
    // formulation volontairement neutre en genre : « jaune » est féminin,
    // « pion vide » masculin — un seul gabarit doit convenir aux deux
    this.status = `« ${pegName(symbolAt(board.def, this.selected))} » en main — touche un emplacement.`;
  }

  // ───────────────────────────────────────────────────────── boucle

  update(dt: number): void {
    this.time += dt;
    const board = this.board;
    if (board && this.playing) {
      this.elapsed += dt;
      const tense = board.triesLeft <= TENSION_FROM_TRIES;
      this.ambience.setTension(tense);
      if (tense) this.sfx.heartbeat();
    }
    this.cat.update(dt, board, this.playing);
    this.fx.update(dt);
    this.ambience.update(dt);
    if (this.raysLife > 0) this.raysLife = Math.max(0, this.raysLife - dt);

    if (this.pendingResult) {
      this.resultDelay -= dt;
      if (this.resultDelay <= 0) {
        const r = this.pendingResult;
        this.pendingResult = null;
        this.onGameOver(r.victory, r.timeSec, r.tries);
      }
    }
  }

  render(alpha: number): void {
    const board = this.board;
    if (!board) return;

    const tension =
      this.playing && board.triesLeft <= TENSION_FROM_TRIES
        ? clamp(1 - (board.triesLeft - 1) / TENSION_FROM_TRIES, 0, 1)
        : 0;

    const input: BoardViewInput = VIEW_INPUT;
    input.selected = this.selected;
    input.focusSlot = this.focusSlot;
    input.revealed = this.revealed;
    input.status = this.status;
    input.flashColor = this.fx.flashColor;
    input.flashAlpha = this.fx.flashAlpha;
    input.tension = tension;

    this.boardView.sync(board, input, this.time);
    this.catView.sync(this.cat, alpha);
    this.fx.syncRender(alpha);
    this.ambience.render(alpha);

    // Rayons de victoire : fondu sur la fin, et rotation lente SAUF en mouvement
    // réduit — la gerbe reste alors une étoile fixe, présente mais immobile.
    if (this.raysLife > 0) {
      this.layers.rays.rotation = this.fx.reducedMotion ? 0 : this.time * 0.5;
      this.layers.rays.alpha = Math.min(1, this.raysLife) * (this.fx.reducedMotion ? 0.35 : 0.55);
    } else if (this.layers.rays.alpha !== 0) {
      this.layers.rays.alpha = 0;
      for (const ray of this.rays) ray.visible = false;
    }

    // secousse : on déplace la scène entière, jamais les entités
    this.layers.stage.position.set(this.fx.shakeX.value, this.fx.shakeY.value);
  }

  /** Position à l'écran d'un emplacement — utile aux gestes et au débogage. */
  slotPosition(slot: number): { x: number; y: number } {
    const board = this.board;
    if (!board) return { x: 0, y: SECRET_Y };
    return { x: slotX(slot, board.def.pegs), y: rowY(board.activeRow, board.def.tries) };
  }
}
