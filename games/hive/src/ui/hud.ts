import type { World } from '../game/world';

/**
 * HUD DOM : perfs (fps) à gauche, comptes de nids par camp à droite.
 * Mise à jour throttlée — le DOM n'est touché que ~4 fois par seconde.
 */
export class Hud {
  private readonly perfEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly rootEl: HTMLElement;
  private acc = 0;
  private frames = 0;
  private sinceUpdate = 0;
  private lastStats = '';

  constructor() {
    this.rootEl = document.getElementById('hud')!;
    this.perfEl = document.getElementById('hud-perf')!;
    this.statsEl = document.getElementById('hud-stats')!;
  }

  setInGame(on: boolean): void {
    this.rootEl.classList.toggle('in-game', on);
  }

  onFrame(frameMs: number, world: World): void {
    this.acc += frameMs;
    this.frames++;
    this.sinceUpdate += frameMs;
    if (this.sinceUpdate < 250) return;
    this.sinceUpdate = 0;
    const fps = Math.round(1000 / (this.acc / this.frames));
    this.acc = 0;
    this.frames = 0;
    this.perfEl.textContent = `${fps} fps · ${world.units.count} 🐜`;
    const s = world.stats();
    const line = `🐝 ${s.player} · 🪳 ${s.enemy} · ⬡ ${s.neutral}`;
    if (line !== this.lastStats) {
      this.lastStats = line;
      this.statsEl.textContent = line;
    }
  }
}
