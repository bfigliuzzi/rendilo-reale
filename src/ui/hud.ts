import type { WorldStats } from '../game/world';

const RING = 120;

/**
 * HUD en DOM par-dessus le canvas : hors du batch de rendu WebGL, et mis à jour
 * à 4 Hz seulement (l'écriture DOM par frame coûterait plus que le jeu lui-même).
 */
export class Hud {
  private readonly rootEl = document.getElementById('hud')!;
  private readonly perfEl = document.getElementById('hud-perf')!;
  private readonly statsEl = document.getElementById('hud-stats')!;
  private readonly frameTimes = new Float32Array(RING);
  private readonly sorted = new Float32Array(RING);
  private idx = 0;
  private filled = 0;
  private accMs = 0;

  setInGame(inGame: boolean): void {
    this.rootEl.classList.toggle('in-game', inGame);
  }

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
    const buffs =
      (stats.dmgBuff > 0 ? ` 🔥×2 ${Math.ceil(stats.dmgBuff)}s` : '') +
      (stats.shieldBuff > 0 ? ` 🛡 ${Math.ceil(stats.shieldBuff)}s` : '') +
      (stats.droneBuff > 0 ? ` ✈ ${Math.ceil(stats.droneBuff)}s` : '') +
      (stats.goldBuff > 0 ? ` 💰×2 ${Math.ceil(stats.goldBuff)}s` : '') +
      // riposte adaptative : rendre visible que le monde durcit face à la masse
      (stats.threat > 1.05 ? ` ⚠️ riposte ×${stats.threat.toFixed(1)}` : '');
    this.statsEl.innerHTML = `<span class="big">⚔ ${stats.squad}</span><br>💰 ${stats.gold} · ☠ ${stats.kills}<br>${stats.dist} m${buffs ? `<br><span class="buffs">${buffs}</span>` : ''}`;
  }
}
