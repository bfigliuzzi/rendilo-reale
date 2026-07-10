import { DESIGN_H, DESIGN_W, DRAG_THRESHOLD } from '../config/balance';
import { PLAYER } from '../config/levels';
import type { World } from '../game/world';

/**
 * Contrôles « sélection puis tap » (Auralux) + drag raccourci :
 * - tap sur un nœud allié : TOUJOURS sélection/cumul (re-tap = désélection) ;
 * - tap sur une cible ennemie/neutre avec sélection : envoi depuis tous les
 *   nœuds sélectionnés, puis sélection vidée ;
 * - tap dans le vide : tout désélectionner ;
 * - drag depuis un nœud allié vers un nœud quelconque : envoi depuis
 *   sélection ∪ {source} — c'est aussi LE geste de renfort d'un allié.
 * Les gestes ne mutent jamais la sim : ils postent des commandes (drainées en
 * tête de tick). La sélection, purement cosmétique, est immédiate.
 */
export class Gestures {
  private enabled = false;
  private pointerDown = false;
  private moved = false;
  private startX = 0;
  private startY = 0;
  private startNode = -1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: World,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.resetDrag();
  }

  /** Coordonnées logiques 540×960 depuis un événement pointeur (letterbox). */
  private toLogical(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * DESIGN_W,
      y: ((e.clientY - rect.top) / rect.height) * DESIGN_H,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    const { x, y } = this.toLogical(e);
    this.pointerDown = true;
    this.moved = false;
    this.startX = x;
    this.startY = y;
    this.startNode = this.world.nodes.nodeAt(x, y);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.enabled || !this.pointerDown) return;
    const { x, y } = this.toLogical(e);
    if (!this.moved) {
      const dx = x - this.startX;
      const dy = y - this.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      this.moved = true;
    }
    const drag = this.world.drag;
    // la flèche élastique n'existe que depuis un nœud allié
    if (this.startNode >= 0 && this.world.nodes.faction[this.startNode] === PLAYER) {
      drag.active = true;
      drag.srcId = this.startNode;
      drag.x = x;
      drag.y = y;
      drag.hoverId = this.world.nodes.nodeAt(x, y);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.enabled || !this.pointerDown) return;
    this.pointerDown = false;
    const { x, y } = this.toLogical(e);
    const hit = this.world.nodes.nodeAt(x, y);
    if (this.moved) {
      this.finishDrag(hit);
      return;
    }
    this.tap(hit);
  };

  private readonly onCancel = (): void => {
    this.pointerDown = false;
    this.resetDrag();
  };

  private tap(hit: number): void {
    const nodes = this.world.nodes;
    if (hit < 0) {
      nodes.clearSelection(); // tap dans le vide
      return;
    }
    if (nodes.faction[hit] === PLAYER) {
      nodes.selected[hit] = nodes.selected[hit] ? 0 : 1; // sélection/cumul, re-tap = retrait
      return;
    }
    // cible ennemie/neutre : envoi depuis toute la sélection
    let any = false;
    for (let i = 0; i < nodes.count; i++) {
      if (!nodes.selected[i]) continue;
      this.world.postSend(i, hit);
      any = true;
    }
    if (any) nodes.clearSelection();
  }

  private finishDrag(hit: number): void {
    const drag = this.world.drag;
    const src = drag.active ? drag.srcId : -1;
    this.resetDrag();
    if (src < 0 || hit < 0 || hit === src) return;
    const nodes = this.world.nodes;
    if (nodes.faction[src] !== PLAYER) return;
    // envoi depuis sélection ∪ {source} — couvre aussi le renfort d'un allié
    this.world.postSend(src, hit);
    for (let i = 0; i < nodes.count; i++) {
      if (nodes.selected[i] && i !== src && i !== hit) this.world.postSend(i, hit);
    }
    nodes.clearSelection();
  }

  private resetDrag(): void {
    const drag = this.world.drag;
    drag.active = false;
    drag.srcId = -1;
    drag.hoverId = -1;
  }
}
