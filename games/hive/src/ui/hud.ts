import type { World } from '../game/world';
import { FACTION_COLORS } from '../render/textures';

// Emoji par espèce (index SPECIES_IDS : bee, fly, roach) — redondant avec la
// teinte de faction portée par le span (couleur + emoji + ordre fixe, WCAG).
const SPECIES_EMOJI = ['🐝', '🪰', '🪳'] as const;

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * HUD DOM : perfs (fps) à gauche, comptes de nids par camp à droite (construits
 * dynamiquement selon les factions de la carte), slider de % d'envoi à droite.
 * Mise à jour throttlée — le DOM n'est touché que ~4 fois par seconde.
 * Le slider est la SEULE zone interactive du HUD (pointer-events ciblé).
 */
export class Hud {
  /** Câblé par Flow (seul écrivain du save) : reçoit la fraction déjà validée. */
  onSendFracChange: (v: number) => void = () => {};
  /** Câblé par Flow : redémarre le niveau en cours (bouton ↻, visible en jeu). */
  onRestart: () => void = () => {};

  private readonly perfEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly rootEl: HTMLElement;
  private readonly sendValueEl: HTMLElement;
  private readonly sendRangeEl: HTMLInputElement;
  private acc = 0;
  private frames = 0;
  private sinceUpdate = 0;
  private lastStats = '';

  constructor() {
    this.rootEl = document.getElementById('hud')!;
    this.perfEl = document.getElementById('hud-perf')!;
    this.statsEl = document.getElementById('hud-stats')!;
    this.sendValueEl = document.getElementById('send-value')!;
    this.sendRangeEl = document.getElementById('send-range') as HTMLInputElement;
    this.sendRangeEl.addEventListener('input', (e) => {
      const value = (e.target as HTMLInputElement).value;
      this.onSendFracChange(Number(value) / 100);
    });
    document.getElementById('hud-restart')!.addEventListener('click', () => this.onRestart());
  }

  setInGame(on: boolean): void {
    this.rootEl.classList.toggle('in-game', on);
  }

  /** Reflète la fraction d'envoi courante (déjà clampée par Flow). */
  setSendFrac(v: number): void {
    const percent = Math.round(v * 100);
    this.sendValueEl.textContent = `${percent} %`;
    const rangeValue = String(percent);
    if (this.sendRangeEl.value !== rangeValue) {
      this.sendRangeEl.value = rangeValue;
    }
    this.sendRangeEl.setAttribute('aria-valuetext', `${percent} %`);
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
    // une entrée par faction PRÉSENTE (joueur d'abord), teintée couleur de camp
    let line = '';
    for (let f = 1; f < world.speciesByFaction.length; f++) {
      const sp = world.speciesByFaction[f];
      if (sp === 255) continue;
      line += `<span style="color:${cssColor(FACTION_COLORS[f])}">${SPECIES_EMOJI[sp]} ${world.nodes.byFaction[f]}</span> · `;
    }
    line += `⬡ ${world.nodes.byFaction[0]}`;
    if (line !== this.lastStats) {
      this.lastStats = line;
      this.statsEl.innerHTML = line;
    }
  }
}
