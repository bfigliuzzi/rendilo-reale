import { PASS_W, PASS_H } from '../../config/balance';
import { sfx } from '../../audio/sfx';
import type { Demo, MiniGame, MiniGameCtx, MiniGameDef } from '../../core/minigame';
import { BeastModel } from './model';
import { BeastView } from './view';

/**
 * PLACEHOLDER (§8 étape 1) — câblage de `beast`.
 *
 * `index.ts` est le SEUL des trois fichiers autorisé à connaître à la fois le
 * modèle et la vue, le DOM et Pixi. Il pose les boutons TRANSPARENTS dans
 * `ctx.overlay` (le canvas est `aria-hidden` : toute l'interaction est du DOM
 * natif, on récupère gratuitement tabulation, Entrée/Espace, noms accessibles
 * et un anneau de focus visible AU-DESSUS du canvas).
 */
class BeastGame implements MiniGame {
  private readonly model: BeastModel;
  private readonly view: BeastView;
  private readonly button: HTMLButtonElement;
  private time = 0;
  private paused = false;

  constructor(private readonly ctx: MiniGameCtx) {
    this.model = new BeastModel(ctx.seed, ctx.stars);
    this.view = new BeastView(ctx.stage, this.model, PASS_W, PASS_H);

    this.button = document.createElement('button');
    this.button.className = 'bigbtn';
    // ≥ 60 px logiques : plancher de cible tactile du §1.1.
    this.button.style.left = `${PASS_W / 2 - 150}px`;
    this.button.style.top = `${PASS_H / 2 + 20}px`;
    this.button.style.width = '300px';
    this.button.style.height = '120px';
    this.button.textContent = '🐾';
    this.button.addEventListener('click', this.onTap);
    ctx.overlay.appendChild(this.button);

    this.refresh();
  }

  /** Synchrone à chaque changement d'état : on ne donne pas le focus à un
   *  bouton encore `disabled`, et attendre la frame de rendu le raterait. */
  private refresh(): void {
    const s = this.model.state;
    this.button.disabled = s.over || this.paused;
    this.button.setAttribute(
      'aria-label',
      s.over ? 'manche terminée' : `taper — encore ${s.left}`,
    );
  }

  private readonly onTap = (): void => {
    if (this.paused) return;
    const player = this.model.state.turn;
    if (!this.model.tap(player)) return;
    sfx.tap();
    this.ctx.onAnnounce(`joueur ${player + 1} a tapé`);
    this.refresh();

    const s = this.model.state;
    if (s.over) {
      this.ctx.onOver({
        winner: this.model.winner,
        scores: this.model.scores,
        reason: this.model.reason,
      });
      return;
    }
    // Posture 'pass' : le tap sur l'écran de passage EST le contrat — il n'y a
    // pas de vol de tour. C'est le shell qui masque totalement le plateau.
    this.ctx.onTurn(s.turn);
  };

  update(dt: number): void {
    if (this.paused) return;
    // Horloge de la VUE (les animations en sont des fonctions closes), jamais
    // du modèle : le modèle reste pur et rejouable hors de la page.
    this.time += dt;
  }

  render(_alpha: number): void {
    this.view.render(this.time);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.refresh();
  }

  /** §2.4 — la démo rejoue le MODÈLE RÉEL, jamais une animation séparée. */
  applyDemo(): void {
    this.model.tap(this.model.state.turn);
    this.refresh();
  }

  destroy(): void {
    this.button.removeEventListener('click', this.onTap);
    this.button.remove();
    this.view.destroy();
  }
}

/** Coups canoniques rejoués en boucle par `core/demo.ts` (§2.4). */
const DEMO: Demo = [{ move: 'tap' }, { move: 'tap' }, { move: 'tap' }];

export const def: MiniGameDef = {
  id: 'beast',
  title: 'La bête sous le tapis',
  emoji: '🐾',
  posture: 'pass',
  mode: 'asym',
  logical: { w: PASS_W, h: PASS_H },
  demo: DEMO,
  create: (ctx) => new BeastGame(ctx),
};

/** Modèle PUR exposé au bot via `window.__game.models` (§7). */
export { BeastModel as Model };
