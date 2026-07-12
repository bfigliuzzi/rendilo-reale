import { PLAYER, type TutorialStep } from '../config/levels';
import type { World } from './world';

/**
 * Tutoriel déclaratif (LevelDef.tutorial) : pur OBSERVATEUR de l'état du monde
 * — aucun hook dans la sim. Appelé depuis la boucle de rendu (throttlé en
 * interne), avance l'étape quand la condition de son `goal` devient vraie et
 * affiche le texte dans le bandeau DOM #hud-tuto. L'étape `win` reste affichée
 * jusqu'à la fin de partie (Flow appelle stop()).
 */
export class Tutorial {
  private steps: readonly TutorialStep[] = [];
  private idx = 0;
  private baseNodes = 0; // nids joueur au départ (pour le goal `capture`)
  private sinceCheck = 0;
  private active = false;
  private readonly el: HTMLElement;

  constructor() {
    this.el = document.getElementById('hud-tuto')!;
  }

  start(steps: readonly TutorialStep[], world: World): void {
    this.steps = steps;
    this.idx = 0;
    this.baseNodes = world.nodes.byFaction[PLAYER];
    this.sinceCheck = 0;
    this.active = true;
    this.show();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.el.classList.remove('visible');
  }

  onFrame(frameMs: number, world: World): void {
    if (!this.active) return;
    this.sinceCheck += frameMs;
    if (this.sinceCheck < 250) return;
    this.sinceCheck = 0;
    if (!this.done(this.steps[this.idx], world)) return;
    this.idx++;
    if (this.idx >= this.steps.length) this.stop();
    else this.show();
  }

  private show(): void {
    this.el.textContent = this.steps[this.idx].text;
    this.el.classList.add('visible');
  }

  private done(step: TutorialStep, world: World): boolean {
    const { nodes, units, emitter } = world;
    switch (step.goal) {
      case 'select': {
        for (let i = 0; i < nodes.count; i++) if (nodes.selected[i]) return true;
        return false;
      }
      case 'send':
        return units.byFaction[PLAYER] > 0 || emitter.byFaction[PLAYER] > 0;
      case 'capture':
        return nodes.byFaction[PLAYER] > this.baseNodes;
      case 'upgrade': {
        for (let i = 0; i < nodes.count; i++) {
          if (nodes.faction[i] === PLAYER && nodes.level[i] >= 1) return true;
        }
        return false;
      }
      case 'win':
        return false; // reste affiché jusqu'au game over (Flow coupe)
    }
  }
}
