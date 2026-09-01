import { PASS_H, PASS_W, TILES_COLS, TILES_ROWS } from '../../config/balance';
import { sfx } from '../../audio/sfx';
import type { Demo, DemoMove, MiniGame, MiniGameCtx, MiniGameDef } from '../../core/minigame';
import { orientationWord, rowColOf, TilesModel, type TilesState } from './model';
import { BOARD_Y, CELL, TilesView } from './view';

/**
 * `index.ts` câble le modèle PUR et la vue qui ne le mute jamais. C'est le
 * SEUL des trois fichiers autorisé à connaître à la fois le modèle, la vue,
 * le DOM et Pixi.
 *
 * Le canvas est `aria-hidden` : toute l'interaction est posée en vrais
 * `<button>` TRANSPARENTS dans `ctx.overlay`, au repère logique 540×960 —
 * exactement la transformation de letterbox que subit `#stage`.
 *
 * **Les boutons couvrent des CASES, pas des dominos** (§5) : un bouton par
 * case de la grille (36), positionné une fois, jamais recréé. Une case
 * définitivement morte — bloquée ou déjà occupée, ce qui est irréversible en
 * Domineering — est `hidden`. Une case libre reste TOUJOURS visible même
 * quand elle est illégale pour le joueur courant (sa légalité dépend du tour
 * et rechange à chaque pose adverse) : elle est alors seulement `disabled`,
 * jamais retirée, pour que le résumé de plateau reste lisible dans son
 * ensemble (§1.1 critère 2 : le coup illégal est rendu impossible, pas caché).
 */
class TilesGame implements MiniGame {
  private readonly model: TilesModel;
  private readonly view: TilesView;
  private readonly cells: HTMLButtonElement[] = [];
  private time = 0;
  private paused = false;

  constructor(private readonly ctx: MiniGameCtx) {
    this.model = new TilesModel(ctx.seed, ctx.stars);
    this.view = new TilesView(ctx.stage, this.model, ctx.reducedMotion);

    const s = this.model.state;
    const boardW = s.cols * CELL;
    const boardX = (PASS_W - boardW) / 2;
    for (let r = 0; r < TILES_ROWS; r++) {
      for (let c = 0; c < TILES_COLS; c++) {
        const idx = r * TILES_COLS + c;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cell';
        b.dataset.cell = `${r}:${c}`;
        const size = CELL - 6;
        b.style.left = `${boardX + c * CELL + (CELL - size) / 2}px`;
        b.style.top = `${BOARD_Y + r * CELL + (CELL - size) / 2}px`;
        b.style.width = `${size}px`;
        b.style.height = `${size}px`;
        b.addEventListener('click', () => this.onCell(idx));
        ctx.overlay.appendChild(b);
        this.cells.push(b);
      }
    }

    this.refresh();
  }

  /** Synchrone à chaque changement d'état (§5) : on ne donne jamais le focus
   *  à un bouton encore `disabled`, et attendre la frame de rendu le raterait. */
  private refresh(): void {
    // Capturé AVANT toute mutation de `disabled`/`hidden` : après, l'élément
    // qui portait le focus peut déjà être mort et `document.activeElement`
    // être retombé sur `<body>` (§5).
    const prev = document.activeElement as HTMLElement | null;
    const wasOurs = !!prev && this.cells.includes(prev as HTMLButtonElement);

    const s = this.model.state;
    const locked = this.paused || s.over;
    for (let idx = 0; idx < this.cells.length; idx++) {
      const b = this.cells[idx];
      // Une case bloquée ou déjà couverte est morte DÉFINITIVEMENT (rien ne se
      // libère en Domineering) : elle quitte l'ordre de tabulation. `disabled`
      // est posé AUSSI, et pas seulement `hidden` : les deux doivent rester
      // cohérents pour tout code qui cherche « le premier bouton jouable ».
      const dead = s.blocked[idx] || s.owner[idx] !== null;
      b.hidden = dead;
      b.disabled = dead || locked || !s.legal[idx];
      if (dead) continue;
      const [r, c] = rowColOf(idx, s.cols);
      b.setAttribute(
        'aria-label',
        s.legal[idx]
          ? `poser un domino ${orientationWord(s.turn)}, rangée ${r + 1} colonne ${c + 1}`
          : `rangée ${r + 1} colonne ${c + 1}, indisponible pour l'instant`,
      );
    }
    this.updateBoard(s);
    this.restoreFocus(prev, wasOurs);
  }

  /**
   * On ne rend le focus QUE s'il était à nous, et QUE s'il vient de mourir :
   * le voler à quelqu'un qui joue au doigt (ou au bandeau du HUD) serait pire
   * que de le perdre (§5). Rien à faire quand la manche est finie ou en pause :
   * le shell masque alors l'overlay et ouvre son propre panneau, qui prend le
   * focus lui-même — lui en reprendre un ici le ramènerait sur le plateau.
   */
  private restoreFocus(prev: HTMLElement | null, wasOurs: boolean): void {
    if (!wasOurs || !prev) return;
    const b = prev as HTMLButtonElement;
    if (!b.disabled && !b.hidden && b.isConnected) return;
    if (this.paused || this.model.state.over) return;
    this.focusFirstLegal();
  }

  /** `#sr-board` (via le shell — `ctx` n'expose pas ce résumé, cf. digest
   *  §8.2) : donne le plateau ENTIER en texte, y compris ce qui ne change pas
   *  d'un événement discret (les cases bloquées) — jouable sans voir l'écran. */
  private updateBoard(s: TilesState): void {
    const g = (window as unknown as { __game?: { game?: { setBoardText?: (t: string) => void } } }).__game?.game;
    if (!g?.setBoardText) return;
    const legalCount = s.legal.reduce((n, v) => n + (v ? 1 : 0), 0);
    const blockedCount = s.blocked.reduce((n, v) => n + (v ? 1 : 0), 0);
    const text = s.over
      ? 'Manche terminée.'
      : `À qui pose ${orientationWord(s.turn)} de jouer. ` +
        `Debout : ${s.stacks[0]} tuiles restantes, ${s.placed[0]} posées. ` +
        `Couché : ${s.stacks[1]} tuiles restantes, ${s.placed[1]} posées. ` +
        `${legalCount} cases jouables sur ${s.cols * s.rows - blockedCount} disponibles.`;
    g.setBoardText(text);
  }

  private focusFirstLegal(): void {
    const first = this.cells.find((b) => !b.hidden && !b.disabled);
    first?.focus();
  }

  private onCell(idx: number): void {
    if (this.paused) return;
    const mover = this.model.state.turn;
    if (!this.model.place(mover, idx)) return;
    sfx.thunk();
    const [r, c] = rowColOf(idx, this.model.state.cols);

    const s = this.model.state;
    // UNE SEULE annonce, même quand deux choses se produisent : `#sr-log` est
    // une région live unique, deux écritures synchrones se recouvrent et le
    // lecteur d'écran n'énonce que la dernière — le « il passe » aurait mangé
    // la pose qui vient d'avoir lieu.
    const skip = s.skipped === null ? '' : `, ${orientationWord(s.skipped)} n'a plus de coup possible et passe`;
    this.ctx.onAnnounce(`domino ${orientationWord(mover)} posé, rangée ${r + 1} colonne ${c + 1}${skip}`);
    this.refresh();

    if (s.over) {
      this.ctx.onOver(this.model.result);
      return;
    }
    if (s.turn !== mover) {
      // Le tour a changé de MAIN : le shell ouvre l'écran de passage et
      // rendra lui-même le focus à la première cible légale au retour.
      this.ctx.onTurn(s.turn);
    } else {
      // Même joueur (l'adversaire vient d'être sauté faute de coup) : pas de
      // passage d'écran, mais le focus doit quand même sauter sur la
      // première cible légale de ce nouveau tour (§5).
      this.focusFirstLegal();
    }
  }

  update(dt: number): void {
    if (this.paused) return;
    // Horloge de la VUE (les animations en sont des fonctions closes), jamais
    // du modèle : le modèle reste pur et rejouable hors de la page — c'est un
    // jeu au tour par tour, cette horloge ne pilote QUE le petit « pop » de
    // pose d'un domino.
    this.time += dt;
  }

  render(_alpha: number): void {
    this.view.render(this.time);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.refresh();
  }

  /**
   * §2.4 — la démo rejoue le MODÈLE RÉEL : elle pose toujours pour le joueur
   * dont c'est actuellement le tour, sur sa PREMIÈRE case légale. Écrire des
   * coordonnées fixes serait fragile — le plateau varie avec le seed (cases
   * bloquées, dominos ⭐) — alors que « la première case légale » reste
   * toujours un coup valide, quel que soit le tirage.
   */
  applyDemo(move: DemoMove): void {
    if (move.move !== 'place') return;
    const s = this.model.state;
    const idx = s.legal.findIndex(Boolean);
    if (idx < 0) return;
    this.model.place(s.turn, idx);
    this.refresh();
  }

  destroy(): void {
    for (const b of this.cells) b.remove();
    this.cells.length = 0;
    this.view.destroy();
  }
}

/** Coups canoniques rejoués en boucle par `core/demo.ts` (§2.4) : quatre
 *  poses qui alternent naturellement d'orientation — la boucle complète du
 *  jeu (poser debout, poser couché…), sans un mot. */
const DEMO: Demo = [{ move: 'place' }, { move: 'place' }, { move: 'place' }, { move: 'place' }];

export const def: MiniGameDef = {
  id: 'tiles',
  title: 'Dominos croisés',
  emoji: '🧩',
  posture: 'pass',
  mode: 'duel',
  logical: { w: PASS_W, h: PASS_H },
  demo: DEMO,
  create: (ctx) => new TilesGame(ctx),
};

/** Modèle PUR exposé au bot via `window.__game.models` (§7). */
export { TilesModel as Model };
