/**
 * Grille uniforme rebâtie à chaque tick, zéro allocation au runtime.
 * Les buckets sont des tranches fixes de `items` ; un insert hors bande est ignoré
 * (les entités hors de la zone de jeu ne participent pas aux collisions).
 */
export class SpatialGrid {
  readonly counts: Int16Array;
  readonly items: Int16Array;
  originX = 0;
  originY = 0;

  constructor(
    readonly cols: number,
    readonly rows: number,
    readonly cellSize: number,
    readonly maxPerCell: number,
  ) {
    this.counts = new Int16Array(cols * rows);
    this.items = new Int16Array(cols * rows * maxPerCell);
  }

  setOrigin(x: number, y: number): void {
    this.originX = x;
    this.originY = y;
  }

  clear(): void {
    this.counts.fill(0);
  }

  cellX(x: number): number {
    return Math.floor((x - this.originX) / this.cellSize);
  }

  cellY(y: number): number {
    return Math.floor((y - this.originY) / this.cellSize);
  }

  insert(index: number, x: number, y: number): void {
    const cx = this.cellX(x);
    const cy = this.cellY(y);
    if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) return;
    const cell = cy * this.cols + cx;
    const n = this.counts[cell];
    if (n >= this.maxPerCell) return;
    this.items[cell * this.maxPerCell + n] = index;
    this.counts[cell] = n + 1;
  }
}
