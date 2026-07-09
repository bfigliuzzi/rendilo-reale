/**
 * Drag unifié tactile/souris via pointer events, en delta (pas en absolu) :
 * l'escouade suit le mouvement du doigt où qu'il soit posé — le standard du genre.
 * Le delta s'accumule entre deux ticks de simulation et est consommé par le tick.
 */
export class PointerInput {
  private dx = 0;
  private dragging = false;
  private lastX = 0;

  constructor(private readonly getScale: () => number) {
    window.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.dx += (e.clientX - this.lastX) / this.getScale();
      this.lastX = e.clientX;
    });
    const stop = (): void => {
      this.dragging = false;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  consumeDX(): number {
    const d = this.dx;
    this.dx = 0;
    return d;
  }
}
