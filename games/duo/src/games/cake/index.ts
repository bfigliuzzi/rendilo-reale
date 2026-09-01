import { PASS_H, PASS_W } from '../../config/balance';
import { sfx } from '../../audio/sfx';
import type { Demo, DemoMove, MiniGame, MiniGameCtx, MiniGameDef } from '../../core/minigame';
import {
  CakeModel,
  countOf,
  fruitEmoji,
  fruitWord,
  preferredKind,
  splitFruits,
  type CakeState,
  type Fruit,
} from './model';
import { CakeView, PIECE_MARK, PIECE_NAME } from './view';

/**
 * `index.ts` câble le modèle PUR et la vue qui ne le mute jamais. C'est le
 * SEUL des trois fichiers autorisé à connaître à la fois le modèle, la vue,
 * le DOM et Pixi.
 *
 * Le canvas est `aria-hidden` : toute l'interaction est posée en vrais
 * `<button>` TRANSPARENTS dans `ctx.overlay`, au repère logique 540×960 —
 * exactement la transformation de letterbox que subit `#stage`.
 *
 * DEUX PHASES PAR COUPE, UN SEUL PASSAGE D'ÉCRAN : couper (le coupeur ajuste
 * la corde puis valide) → choisir (l'autre prend une part). Comme les rôles
 * alternent STRICTEMENT à chaque coupe, celui qui vient de CHOISIR devient
 * mécaniquement le coupeur de la coupe suivante (`cutterOf(i+1) ===
 * chooserOf(i)`, propriété du modèle) : le téléphone ne repasse donc qu'UNE
 * fois par coupe, au moment de la validation — jamais après un choix, qui
 * enchaîne sur la coupe suivante SANS écran de passage. Le focus doit donc
 * sauter nous-mêmes sur la première cible légale à cet instant précis (le
 * shell ne le fait qu'après un `onTurn`, ici il n'y en a pas).
 *
 * PAS DE `ctx.onTurn` AU MONTAGE, et ce n'est pas un oubli : `Flow.startRound`
 * appelle `shell.startGame` (donc notre constructeur) AVANT son propre
 * `enter('game')`. Un écran de passage demandé depuis le constructeur serait
 * refermé dans la foulée par cette transition. Le premier coupeur est donc
 * désigné À L'ÉCRAN, par le panier en relief et le pictogramme ✂️ de la vue.
 */
class CakeGame implements MiniGame {
  private readonly model: CakeModel;
  private readonly view: CakeView;
  private time = 0;
  private paused = false;

  private readonly btnAMinus: HTMLButtonElement;
  private readonly btnAPlus: HTMLButtonElement;
  private readonly btnBMinus: HTMLButtonElement;
  private readonly btnBPlus: HTMLButtonElement;
  private readonly btnConfirm: HTMLButtonElement;
  private readonly btnPiece0: HTMLButtonElement;
  private readonly btnPiece1: HTMLButtonElement;

  constructor(private readonly ctx: MiniGameCtx) {
    this.model = new CakeModel(ctx.seed, ctx.stars);
    this.view = new CakeView(ctx.stage, this.model, ctx.reducedMotion);

    // Phase « couper » : quatre crans + une validation, chacun ≥ 60 px logiques.
    // Les ordonnées commencent à 620 : le gâteau descend à CY = 378 (le bandeau
    // de table mange le haut de l'écran, voir `view.ts`), et une poignée posée
    // tout en bas du disque tombe à y = 612 — un bouton plus haut la cacherait.
    this.btnAMinus = this.makeBtn(20, 620, 240, 70);
    this.btnAPlus = this.makeBtn(280, 620, 240, 70);
    this.btnBMinus = this.makeBtn(20, 700, 240, 70);
    this.btnBPlus = this.makeBtn(280, 700, 240, 70);
    this.btnConfirm = this.makeBtn(20, 792, 500, 92);
    this.btnConfirm.style.fontSize = '26px';
    // Phase « choisir » : deux grandes parts, mêmes coordonnées que les crans
    // (jamais affichées en même temps — voir `refresh`).
    this.btnPiece0 = this.makeBtn(20, 620, 240, 280);
    this.btnPiece1 = this.makeBtn(280, 620, 240, 280);
    this.btnPiece0.style.fontSize = '22px';
    this.btnPiece1.style.fontSize = '22px';

    this.btnAMinus.textContent = '◀ A';
    this.btnAPlus.textContent = 'A ▶';
    this.btnBMinus.textContent = '◀ B';
    this.btnBPlus.textContent = 'B ▶';
    this.btnConfirm.textContent = '✂️ couper';

    this.btnAMinus.addEventListener('click', () => this.onNudge('a', -1));
    this.btnAPlus.addEventListener('click', () => this.onNudge('a', 1));
    this.btnBMinus.addEventListener('click', () => this.onNudge('b', -1));
    this.btnBPlus.addEventListener('click', () => this.onNudge('b', 1));
    this.btnConfirm.addEventListener('click', () => this.onConfirm());
    this.btnPiece0.addEventListener('click', () => this.onChoose(0));
    this.btnPiece1.addEventListener('click', () => this.onChoose(1));

    this.refresh();
  }

  private makeBtn(x: number, y: number, w: number, h: number): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bigbtn';
    b.style.left = `${x}px`;
    b.style.top = `${y}px`;
    b.style.width = `${w}px`;
    b.style.height = `${h}px`;
    this.ctx.overlay.appendChild(b);
    return b;
  }

  /** Synchrone à chaque changement d'état (§5) : on ne donne jamais le focus
   *  à un bouton encore `disabled`, et attendre la frame de rendu le raterait. */
  private refresh(): void {
    const s = this.model.state;
    const cutting = s.phase === 'cut';
    const choosing = s.phase === 'choose';
    const locked = this.paused || s.over;

    for (const b of [this.btnAMinus, this.btnAPlus, this.btnBMinus, this.btnBPlus, this.btnConfirm]) {
      b.hidden = !cutting;
    }
    this.btnPiece0.hidden = !choosing;
    this.btnPiece1.hidden = !choosing;

    this.btnAMinus.disabled = locked || !s.canNudgeAMinus;
    this.btnAPlus.disabled = locked || !s.canNudgeAPlus;
    this.btnBMinus.disabled = locked || !s.canNudgeBMinus;
    this.btnBPlus.disabled = locked || !s.canNudgeBPlus;
    this.btnConfirm.disabled = locked;
    this.btnPiece0.disabled = locked;
    this.btnPiece1.disabled = locked;

    this.btnAMinus.setAttribute('aria-label', 'reculer la poignée A sur le bord du gâteau');
    this.btnAPlus.setAttribute('aria-label', 'avancer la poignée A sur le bord du gâteau');
    this.btnBMinus.setAttribute('aria-label', 'reculer la poignée B sur le bord du gâteau');
    this.btnBPlus.setAttribute('aria-label', 'avancer la poignée B sur le bord du gâteau');

    const parts = this.parts(s);
    this.btnConfirm.setAttribute(
      'aria-label',
      `couper ici : part ${PIECE_NAME[0]} ${words(parts[0])}, part ${PIECE_NAME[1]} ${words(parts[1])}`,
    );

    if (choosing) {
      for (const side of [0, 1] as const) {
        const btn = side === 0 ? this.btnPiece0 : this.btnPiece1;
        // La MARQUE de la part est reprise à l'identique sur le canvas : c'est
        // ce qui laisse apparier le bouton et la part sans savoir lire.
        btn.textContent = `${PIECE_MARK[side]}  ${emoji(parts[side])}`;
        btn.setAttribute(
          'aria-label',
          `prendre la part ${PIECE_NAME[side]} : ${words(parts[side])}`,
        );
      }
    }

    this.updateBoard(s, parts);
  }

  /** Les deux parts telles qu'elles s'affichent MAINTENANT : figées dès la
   *  coupe validée, recalculées en direct tant que la corde bouge. */
  private parts(s: CakeState): readonly [readonly Fruit[], readonly Fruit[]] {
    if (s.pieces) return s.pieces;
    return splitFruits(s.fruits, s.angleA, s.angleB);
  }

  /** `#sr-board` (via le shell — `ctx` n'expose pas ce résumé, §8.2) : les
   *  comptes de fruits changent sans « événement » discret pendant l'ajustement
   *  de la corde, exactement le cas d'usage d'un résumé d'état. */
  private updateBoard(s: CakeState, parts: readonly [readonly Fruit[], readonly Fruit[]]): void {
    const g = (window as unknown as { __game?: { game?: { setBoardText?: (t: string) => void } } })
      .__game?.game;
    if (!g?.setBoardText) return;
    const paniers = `Panier de ${fruitWord(preferredKind(0), s.scores[0])} contre panier de ${fruitWord(preferredKind(1), s.scores[1])}.`;
    const deux = `Part ${PIECE_NAME[0]} : ${words(parts[0])}. Part ${PIECE_NAME[1]} : ${words(parts[1])}.`;
    const text =
      s.phase === 'over'
        ? `Manche terminée. ${paniers}`
        : `Coupe ${s.cutIndex + 1} sur ${s.totalCuts}. Au joueur ${s.phase === 'cut' ? s.cutter + 1 : s.chooser + 1} de ${s.phase === 'cut' ? 'couper' : 'choisir'}. ${deux} ${paniers}`;
    g.setBoardText(text);
  }

  private onNudge(handle: 'a' | 'b', dir: 1 | -1): void {
    if (this.paused) return;
    if (!this.model.nudge(handle, dir)) return;
    sfx.tap();
    this.refresh();
    // L'ANNONCE PORTE LES COMPTES, pas seulement « la poignée a bougé » :
    // `Hud.log` n'écrit que sur changement RÉEL, donc une phrase constante
    // serait avalée dès le deuxième cran et un joueur au clavier n'aurait
    // aucun retour sur ce que sa coupe est en train de faire.
    const parts = this.parts(this.model.state);
    this.ctx.onAnnounce(
      `poignée ${handle.toUpperCase()} déplacée. Part ${PIECE_NAME[0]} ${words(parts[0])}, part ${PIECE_NAME[1]} ${words(parts[1])}.`,
    );
  }

  private onConfirm(): void {
    if (this.paused) return;
    if (!this.model.confirmCut()) return;
    sfx.cut();
    const s = this.model.state;
    const parts = this.parts(s);
    this.refresh();
    this.ctx.onAnnounce(
      `coupe faite : part ${PIECE_NAME[0]} ${words(parts[0])}, part ${PIECE_NAME[1]} ${words(parts[1])}. À toi de choisir.`,
    );
    // Changement de joueur : le shell ouvre l'écran de passage et rendra lui
    // même le focus à la première cible légale au retour (§8.2 du digest).
    this.ctx.onTurn(s.chooser);
  }

  private onChoose(which: 0 | 1): void {
    if (this.paused) return;
    // `restoreFocus` PRUDENT (§5) : on ne replace le focus que s'il était déjà
    // chez nous. Le voler à quelqu'un qui joue au doigt est pire que de le
    // perdre — et un clic de souris peut très bien laisser le focus ailleurs.
    const wasOurs = this.ctx.overlay.contains(document.activeElement);
    if (!this.model.choosePiece(which)) return;
    sfx.pick();
    this.refresh();

    const s = this.model.state;
    if (s.over) {
      this.ctx.onAnnounce('dernière part prise, la manche est finie');
      this.ctx.onOver(this.model.result);
      return;
    }
    this.ctx.onAnnounce(
      `part ${PIECE_NAME[which]} prise. Coupe ${s.cutIndex + 1} sur ${s.totalCuts}, à toi de couper.`,
    );
    // MÊME joueur : pas de passage d'écran, mais le focus doit quand même
    // sauter sur la première cible légale de la coupe qui commence (§5).
    if (!wasOurs) return;
    if (!this.btnAMinus.disabled) this.btnAMinus.focus();
    else if (!this.btnAPlus.disabled) this.btnAPlus.focus();
    else this.btnConfirm.focus();
  }

  /**
   * Jeu au TOUR PAR TOUR : aucune simulation à faire avancer ici. La seule
   * chose qui bouge est une HORLOGE DE VUE — le « pop » de séparation des
   * parts est une fonction close de `time`, pas un état qu'on intègre. Elle
   * vit ici plutôt que dans le modèle (qui doit rester rejouable hors de la
   * page) et se fige toute seule quand le shell cesse d'appeler `update` :
   * pendant l'écran de passage, la séparation attend donc le destinataire au
   * lieu de se jouer devant un écran caché.
   */
  update(dt: number): void {
    if (this.paused) return;
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
  applyDemo(move: DemoMove): void {
    switch (move.move) {
      case 'nudge': {
        const [handleIdx = 0, dirRaw = 1] = move.args ?? [];
        this.model.nudge(handleIdx === 0 ? 'a' : 'b', dirRaw < 0 ? -1 : 1);
        break;
      }
      case 'cut':
        this.model.confirmCut();
        break;
      case 'choose':
        this.model.choosePiece((move.args?.[0] ?? 0) === 1 ? 1 : 0);
        break;
      default:
        break;
    }
    this.refresh();
  }

  destroy(): void {
    for (const b of [
      this.btnAMinus,
      this.btnAPlus,
      this.btnBMinus,
      this.btnBPlus,
      this.btnConfirm,
      this.btnPiece0,
      this.btnPiece1,
    ]) {
      b.remove();
    }
    this.view.destroy();
  }
}

/** Comptes en pictogrammes — ce que l'enfant qui ne lit pas compare. */
function emoji(fruits: readonly Fruit[]): string {
  return `${countOf(fruits, 'strawberry')} ${fruitEmoji('strawberry')}   ${countOf(fruits, 'blueberry')} ${fruitEmoji('blueberry')}`;
}

/** Les mêmes comptes EN TOUTES LETTRES — `aria-label` et régions live. */
function words(fruits: readonly Fruit[]): string {
  return `${fruitWord('strawberry', countOf(fruits, 'strawberry'))} et ${fruitWord('blueberry', countOf(fruits, 'blueberry'))}`;
}

/**
 * Coups canoniques rejoués en boucle par `core/demo.ts` (§2.4) : la corde
 * s'incline cran par cran (UN cran par pas de démo — un pas qui en jouerait
 * trois d'un coup ferait sauter la poignée et n'enseignerait plus le geste),
 * la coupe se valide, le choisisseur prend une part. La boucle complète du
 * jeu, sans un mot : on incline, on coupe, les parts se détachent avec leur
 * compte, on en prend une.
 */
const DEMO: Demo = [
  { move: 'nudge', args: [1, 1] },
  { move: 'nudge', args: [1, 1] },
  { move: 'nudge', args: [0, -1] },
  { move: 'nudge', args: [0, -1] },
  { move: 'cut' },
  { move: 'choose', args: [0] },
];

export const def: MiniGameDef = {
  id: 'cake',
  title: 'Je coupe, tu choisis',
  emoji: '🍰',
  posture: 'pass',
  mode: 'duel',
  logical: { w: PASS_W, h: PASS_H },
  demo: DEMO,
  create: (ctx) => new CakeGame(ctx),
};

/** Modèle PUR exposé au bot via `window.__game.models` (§7). */
export { CakeModel as Model };
