import { DESIGN_W } from '../config/balance';
import type { World } from '../game/world';

/** Distance au-delà de laquelle un appui devient un glissement, en px écran. */
const DRAG_THRESHOLD = 8;

/**
 * Glisser-déposer — le geste de CONFORT, jamais le seul chemin : tout se fait
 * aussi au tap (palette puis emplacement) et entièrement au clavier. On ne le
 * branche donc pas sur les boutons eux-mêmes mais sur l'overlay, et on laisse les
 * clics natifs passer : un appui sans glissement reste un clic ordinaire, avec
 * toute sa sémantique accessible.
 *
 * Deux glissements sont reconnus : palette → emplacement (poser), et
 * emplacement → emplacement (échanger deux pions déjà posés).
 */
export class Controls {
  private pointerId = -1;
  private startX = 0;
  private startY = 0;
  private dragging = false;
  /** Index de palette porté, ou −1. */
  private fromSymbol = -1;
  /** Emplacement d'origine d'un déplacement de pion, ou −1. */
  private fromSlot = -1;

  constructor(
    private readonly root: HTMLElement,
    private readonly world: World,
  ) {
    root.addEventListener('pointerdown', (e) => this.onDown(e));
    root.addEventListener('pointermove', (e) => this.onMove(e));
    root.addEventListener('pointerup', (e) => this.onUp(e));
    root.addEventListener('pointercancel', () => this.cancel());
  }

  /** Coordonnées logiques 540×960, déduites du rect de l'overlay (échelle incluse). */
  private toLogical(e: PointerEvent): { x: number; y: number } {
    const rect = this.root.getBoundingClientRect();
    const scale = rect.width / DESIGN_W;
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  }

  private onDown(e: PointerEvent): void {
    if (this.pointerId !== -1 || !e.isPrimary) return;
    const target = e.target as HTMLElement | null;
    const swatch = target?.closest<HTMLElement>('[data-symbol]');
    const slot = target?.closest<HTMLElement>('[data-slot]');

    if (swatch) this.fromSymbol = Number(swatch.dataset.symbol);
    else if (slot) this.fromSlot = Number(slot.dataset.slot);
    else return;

    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.dragging = false;
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    if (!this.dragging) {
      if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) < DRAG_THRESHOLD) return;
      this.dragging = true;
      // À partir d'ici le geste est un glissement : on capture le pointeur pour
      // continuer à le suivre même si le doigt quitte le bouton d'origine.
      this.root.setPointerCapture(e.pointerId);
      if (this.fromSlot >= 0) {
        const value = this.world.board?.active.pegs[this.fromSlot];
        // rien à traîner depuis un emplacement vide
        if (value === null || value === undefined) {
          this.cancel();
          return;
        }
      }
    }
    const p = this.toLogical(e);
    const index = this.dragSymbol();
    if (index >= 0) this.world.setDrag(index, p.x, p.y);
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    if (!this.dragging) {
      // simple tap : le clic natif du bouton s'en occupe
      this.cancel();
      return;
    }
    // On lâche le pion visuel AVANT le hit-test : elementFromPoint ne doit voir
    // que les boutons de l'overlay.
    this.world.setDrag(null, 0, 0);
    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const dropSlot = under?.closest<HTMLElement>('[data-slot]');
    if (dropSlot) {
      const to = Number(dropSlot.dataset.slot);
      if (this.fromSymbol >= 0) this.world.setSlot(to, this.fromSymbol);
      else if (this.fromSlot >= 0 && this.fromSlot !== to) this.world.swapSlots(this.fromSlot, to);
    }
    this.cancel();
  }

  /** Symbole actuellement porté (palette ou pion déjà posé). */
  private dragSymbol(): number {
    if (this.fromSymbol >= 0) return this.fromSymbol;
    const board = this.world.board;
    if (!board || this.fromSlot < 0) return -1;
    const value = board.active.pegs[this.fromSlot];
    if (value === null) return -1;
    // valeur → index de palette : le pion vide est la dernière pastille
    return value < 0 ? board.def.colors : value;
  }

  private cancel(): void {
    if (this.pointerId !== -1 && this.root.hasPointerCapture(this.pointerId)) {
      this.root.releasePointerCapture(this.pointerId);
    }
    this.pointerId = -1;
    this.dragging = false;
    this.fromSymbol = -1;
    this.fromSlot = -1;
    this.world.setDrag(null, 0, 0);
  }
}
