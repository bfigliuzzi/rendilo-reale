import type { WorldStats } from '../game/world';

const RING = 120;

/**
 * HUD en DOM par-dessus le canvas : hors du batch de rendu WebGL, et mis à jour
 * à 4 Hz seulement (l'écriture DOM par frame coûterait plus que le jeu lui-même).
 */
export class Hud {
  private readonly perfEl = document.getElementById('hud-perf')!;
  private readonly statsEl = document.getElementById('hud-stats')!;
  private readonly overlayEl = document.getElementById('overlay')!;
  private readonly overlayTitle = document.getElementById('overlay-title')!;
  private readonly overlaySub = document.getElementById('overlay-sub')!;
  private readonly frameTimes = new Float32Array(RING);
  private readonly sorted = new Float32Array(RING);
  private idx = 0;
  private filled = 0;
  private accMs = 0;

  onFrame(frameMs: number): void {
    this.frameTimes[this.idx] = frameMs;
    this.idx = (this.idx + 1) % RING;
    if (this.filled < RING) this.filled++;
  }

  maybeUpdate(frameMs: number, stats: WorldStats): void {
    this.accMs += frameMs;
    if (this.accMs < 250) return;
    this.accMs = 0;

    const n = this.filled;
    if (n > 0) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += this.frameTimes[i];
        this.sorted[i] = this.frameTimes[i];
      }
      this.sorted.subarray(0, n).sort();
      const fps = 1000 / (sum / n);
      const p95 = this.sorted[Math.min(n - 1, Math.floor(n * 0.95))];
      this.perfEl.textContent = `${fps.toFixed(0)} fps · p95 ${p95.toFixed(1)} ms\nballes ${stats.bullets} · ennemis ${stats.enemies}`;
    }
    this.statsEl.innerHTML = `<span class="big">⚔ ${stats.squad}</span><br>☠ ${stats.kills} · ${stats.dist} m`;
  }

  showOverlay(title: string, sub: string, color: string): void {
    this.overlayTitle.textContent = title;
    this.overlayTitle.style.color = color;
    this.overlaySub.textContent = sub;
    this.overlayEl.hidden = false;
  }

  hideOverlay(): void {
    this.overlayEl.hidden = true;
  }

  onRestart(cb: () => void): void {
    this.overlayEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      cb();
      this.hideOverlay();
    });
  }
}
