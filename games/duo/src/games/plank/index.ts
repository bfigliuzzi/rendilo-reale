import { sfx } from '../../audio/sfx';
import { PLANK_COURSES, SIDE_H, SIDE_W, SIDE_ZONE_W } from '../../config/balance';
import type { Demo, DemoMove, MiniGame, MiniGameCtx, MiniGameDef } from '../../core/minigame';
import { COURT_H, COURT_W } from './courses';
import { PlankModel } from './model';
import { PlankView } from './view';

/**
 * `plank` (§3.1) — câblage DOM + Pixi. Seul fichier du dossier qui connaît à
 * la fois le modèle et la vue, le DOM et Pixi (règle du contrat, cf.
 * `core/minigame.ts`).
 *
 * Le plateau (repère local `courses.ts`, 420×420) est centré dans le TIERS DU
 * MILIEU du repère `side` (960×540) : `SIDE_ZONE_W` de chaque côté appartient
 * à un joueur, le reste est le jeu — exactement le découpage du §1.4.
 */
const BOARD_X = SIDE_ZONE_W + (SIDE_W - 2 * SIDE_ZONE_W - COURT_W) / 2;
const BOARD_Y = (SIDE_H - COURT_H) / 2;

/** P0 (siège gauche) : curseur HORIZONTAL au bas de son tiers — il possède
 *  l'inclinaison en X. Largeur/hauteur très au-delà du plancher 60 px (§1.1). */
const P0_PAD_W = 200;
const P0_PAD_H = 70;
const P0_PAD_X = (SIDE_ZONE_W - P0_PAD_W) / 2;
const P0_PAD_Y = SIDE_H - P0_PAD_H - 20;

/** P1 (siège droit) : curseur VERTICAL au centre de son tiers — il possède
 *  l'inclinaison en Y. */
const P1_PAD_W = 70;
const P1_PAD_H = 260;
const P1_PAD_X = SIDE_W - SIDE_ZONE_W + (SIDE_ZONE_W - P1_PAD_W) / 2;
const P1_PAD_Y = (SIDE_H - P1_PAD_H) / 2;

/**
 * Teintes des deux curseurs, en CSS : elles doivent être exactement celles que
 * `view.ts` peint sur les pistes du plateau, sinon un joueur ne relierait pas
 * son pouce à sa flèche. Le double codage tient sans elles (les deux zones
 * diffèrent déjà par leur FORME — large et couchée pour P0, haute et étroite
 * pour P1 — et par leur côté d'écran), la couleur ne fait que confirmer.
 */
const P0_CSS = '#87cfe8'; // PALETTE.sky
const P1_CSS = '#f2748a'; // PALETTE.berry

class PlankGame implements MiniGame {
  private readonly model: PlankModel;
  private readonly view: PlankView;
  private readonly cleanups: Array<() => void> = [];
  private readonly pads: HTMLDivElement[] = [];

  private paused = false;
  private reportedOver = false;
  private lastResetFlashAt = -Infinity;
  private lastCoursesDone = 0;

  private readonly p0Keys = { left: false, right: false };
  private readonly p1Keys = { up: false, down: false };

  constructor(private readonly ctx: MiniGameCtx) {
    this.model = new PlankModel(ctx.seed, ctx.stars);
    this.view = new PlankView(ctx.stage, this.model, BOARD_X, BOARD_Y, ctx.reducedMotion);

    const p0Pad = this.makePad(
      P0_PAD_X,
      P0_PAD_Y,
      P0_PAD_W,
      P0_PAD_H,
      'horizontal',
      P0_CSS,
      'Joueur 1 : incliner le plateau à gauche ou à droite (touches A et D)',
    );
    const p1Pad = this.makePad(
      P1_PAD_X,
      P1_PAD_Y,
      P1_PAD_W,
      P1_PAD_H,
      'vertical',
      P1_CSS,
      'Joueur 2 : incliner le plateau en haut ou en bas (flèches haut et bas)',
    );
    ctx.overlay.appendChild(p0Pad);
    ctx.overlay.appendChild(p1Pad);
    this.bindPointer(p0Pad, 0, 'h');
    this.bindPointer(p1Pad, 1, 'v');

    // Clavier — MAPPING OBLIGATOIRE du §3.1/§5 : c'est par lui que le bot
    // pilote `plank`, et ce qui rend le jeu jouable à deux sur un portable
    // sans écran tactile. Fusionné avec le pointeur (jamais additionné) :
    // le DERNIER appel à `setTilt` gagne, quelle que soit son origine — même
    // principe que le joystick/clavier de Berceau (`input/steer.ts`).
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    // Leçon de Berceau : `blur` RELÂCHE TOUT. Sans lui, une touche encore
    // enfoncée quand la fenêtre perd le focus ne reçoit jamais son `keyup` et
    // le plateau reste incliné à fond, pour toujours.
    window.addEventListener('blur', this.onBlur);
    this.cleanups.push(() => window.removeEventListener('keydown', this.onKeyDown));
    this.cleanups.push(() => window.removeEventListener('keyup', this.onKeyUp));
    this.cleanups.push(() => window.removeEventListener('blur', this.onBlur));

    // L'aide ⭐ est un OBJET VISIBLE (pictogramme posé par la vue) ; on la dit
    // aussi une fois en région live, pour qui ne voit pas le plateau.
    if (this.model.assisted) {
      ctx.onAnnounce('Aide ⭐ : trous plus petits, sortie plus grande');
    }
  }

  /**
   * Une zone de curseur. C'est un vrai `role="slider"` FOCALISABLE : un rôle
   * ARIA de commande qu'on ne peut pas atteindre au clavier est un mensonge,
   * et les flèches/A-D qui le pilotent sont écoutées sur `window`, donc elles
   * marchent aussi bien avec le focus dessus qu'ailleurs.
   */
  private makePad(
    x: number,
    y: number,
    w: number,
    h: number,
    orientation: 'horizontal' | 'vertical',
    tint: string,
    label: string,
  ): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'pad';
    // Liseré à la TEINTE du joueur, opaque : un liseré crème à 35 % tombait
    // sous 3:1 sur le fond de page (WCAG 1.4.11), donc ne comptait pas comme
    // un contour informatif.
    el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:16px;background:rgba(255,243,226,0.08);box-shadow:inset 0 0 0 3px ${tint};`;
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-orientation', orientation);
    el.setAttribute('aria-valuemin', '-100');
    el.setAttribute('aria-valuemax', '100');
    el.setAttribute('aria-valuenow', '0');
    el.setAttribute('aria-label', label);
    this.pads.push(el);
    return el;
  }

  /** `aria-valuenow` est écrit sur ÉVÉNEMENT (pose du doigt, touche, relâche),
   *  jamais à la frame : le retour élastique change la valeur soixante fois par
   *  seconde et un lecteur d'écran n'a que faire de soixante annonces — c'est
   *  la règle « n'écrire que sur changement réel » poussée à sa conséquence. */
  private setPadValue(player: 0 | 1, value: number): void {
    const pad = this.pads[player];
    if (!pad) return;
    const v = Math.round(value * 100);
    if (pad.getAttribute('aria-valuenow') === `${v}`) return;
    pad.setAttribute('aria-valuenow', `${v}`);
  }

  /** Piège du §5 : `getBoundingClientRect()` d'un élément transformé par le
   *  letterbox renvoie déjà sa taille RENDUE — la fraction `(clientX-left)/
   *  width` est donc invariante à l'échelle, aucun calcul de zoom à refaire. */
  private bindPointer(pad: HTMLDivElement, player: 0 | 1, axis: 'h' | 'v'): void {
    let activeId: number | null = null;
    const raw = (e: PointerEvent): number => {
      const rect = pad.getBoundingClientRect();
      const frac = axis === 'h' ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
      return Math.max(-1, Math.min(1, frac * 2 - 1));
    };
    const onDown = (e: PointerEvent): void => {
      if (this.paused) return;
      activeId = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      const v = raw(e);
      this.model.setTilt(player, true, v);
      this.setPadValue(player, v);
    };
    const onMove = (e: PointerEvent): void => {
      if (this.paused || e.pointerId !== activeId) return;
      const v = raw(e);
      this.model.setTilt(player, true, v);
      this.setPadValue(player, v);
    };
    const onRelease = (e: PointerEvent): void => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      this.model.setTilt(player, false, 0);
      this.setPadValue(player, 0);
    };
    pad.addEventListener('pointerdown', onDown);
    pad.addEventListener('pointermove', onMove);
    pad.addEventListener('pointerup', onRelease);
    pad.addEventListener('pointercancel', onRelease);
    this.cleanups.push(() => {
      pad.removeEventListener('pointerdown', onDown);
      pad.removeEventListener('pointermove', onMove);
      pad.removeEventListener('pointerup', onRelease);
      pad.removeEventListener('pointercancel', onRelease);
    });
  }

  /**
   * §3.1 impose `KeyA`/`KeyD` à P0 et `ArrowUp`/`ArrowDown` à P1. On accepte en
   * plus `ArrowLeft`/`ArrowRight` pour P0 : ce sont de simples ALIAS (les
   * touches de la spec continuent de marcher à l'identique), et sans eux le
   * curseur de P0, désormais focalisable, resterait muet sous les flèches —
   * exactement ce qu'un `role="slider"` promet de faire.
   */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.paused || this.reportedOver) return;
    if (!this.setKey(e.code, true)) return;
    e.preventDefault();
    this.applyKeys();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (!this.setKey(e.code, false)) return;
    e.preventDefault();
    this.applyKeys();
  };

  private readonly onBlur = (): void => {
    this.p0Keys.left = false;
    this.p0Keys.right = false;
    this.p1Keys.up = false;
    this.p1Keys.down = false;
    this.applyKeys();
  };

  /** @returns `true` si le code appartient au jeu (donc s'il faut l'avaler). */
  private setKey(code: string, down: boolean): boolean {
    if (code === 'KeyA' || code === 'ArrowLeft') this.p0Keys.left = down;
    else if (code === 'KeyD' || code === 'ArrowRight') this.p0Keys.right = down;
    else if (code === 'ArrowUp') this.p1Keys.up = down;
    else if (code === 'ArrowDown') this.p1Keys.down = down;
    else return false;
    return true;
  }

  private applyKeys(): void {
    const rawX = (this.p0Keys.right ? 1 : 0) + (this.p0Keys.left ? -1 : 0);
    const heldX = this.p0Keys.left || this.p0Keys.right;
    this.model.setTilt(0, heldX, rawX);
    this.setPadValue(0, heldX ? rawX : 0);
    const rawY = (this.p1Keys.down ? 1 : 0) + (this.p1Keys.up ? -1 : 0);
    const heldY = this.p1Keys.up || this.p1Keys.down;
    this.model.setTilt(1, heldY, rawY);
    this.setPadValue(1, heldY ? rawY : 0);
  }

  /**
   * ZÉRO ALLOCATION (§6) : on lit les accesseurs nus du modèle, jamais son
   * `get state()` qui construit un objet à chaque appel. Les seules chaînes
   * fabriquées ici le sont sur un ÉVÉNEMENT réel (une chute, un parcours
   * terminé), pas à la frame.
   */
  update(dt: number): void {
    if (this.paused) return;
    this.model.update(dt);

    if (this.model.flashAt !== this.lastResetFlashAt) {
      this.lastResetFlashAt = this.model.flashAt;
      sfx.bump();
      this.ctx.onAnnounce('Retour au départ');
    }
    if (this.model.done !== this.lastCoursesDone) {
      this.lastCoursesDone = this.model.done;
      sfx.goal();
      this.ctx.onAnnounce(`Parcours ${this.model.done} sur ${PLANK_COURSES} terminé`);
    }
    if (this.model.over && !this.reportedOver) {
      this.reportedOver = true;
      this.model.freezePrev();
      this.ctx.onOver(this.model.result);
    }
  }

  render(alpha: number): void {
    this.view.render(alpha);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    // Le shell cesse d'appeler `update` mais continue `render(alpha)` avec un
    // alpha qui varie : sans ce figeage, la bille oscillerait entre sa position
    // précédente et la courante pendant toute la pause.
    if (p) this.model.freezePrev();
  }

  /**
   * §2.4 — rejoue le MODÈLE RÉEL, jamais une animation séparée. Deux verbes :
   *   • `reset` remet la manche au premier parcours. Il OUVRE la liste parce
   *     que la démo tourne EN BOUCLE : sans lui, la deuxième boucle repartirait
   *     du parcours atteint par la première et la démo cesserait d'enseigner le
   *     geste qu'elle prétend montrer.
   *   • `tilt` pose les deux axes d'un coup : la démo enseigne « incliner fait
   *     rouler la bille », pas « qui possède quel axe » (ça, ce sont les deux
   *     pistes de couleur qui le montrent pendant la vraie partie).
   * `args=[0,0]` relâche les deux curseurs (retour élastique), toute autre
   * valeur les tient immédiatement — cohérent avec `setTilt`.
   */
  applyDemo(move: DemoMove): void {
    if (move.move === 'reset') {
      this.model.restart();
      this.lastResetFlashAt = this.model.flashAt;
      this.lastCoursesDone = 0;
      this.reportedOver = false;
      return;
    }
    if (move.move !== 'tilt') return;
    const [x = 0, y = 0] = move.args ?? [];
    this.model.setTilt(0, x !== 0, x);
    this.model.setTilt(1, y !== 0, y);
  }

  destroy(): void {
    for (const cleanup of this.cleanups) cleanup();
    for (const pad of this.pads) pad.remove();
    this.view.destroy();
  }
}

/**
 * Coups canoniques (§2.4), MESURÉS sur le modèle réel : la bille franchit la
 * sortie du premier parcours à 1,08 s, la boucle la laisse voir une demi-
 * seconde puis relâche — 1,7 s de geste, soit ≈ 3 s de cycle avec la pause
 * inter-boucles du shell (`DEMO_LOOP_PAUSE_SEC`). Pas un mot, un seul geste :
 * on pousse, la bille roule, elle tombe dans le trou vert.
 */
const DEMO: Demo = [
  { move: 'reset', hold: 0 },
  { move: 'tilt', args: [1, 0], hold: 0.5 },
  { move: 'tilt', args: [1, 0.15], hold: 0.7 },
  { move: 'tilt', args: [0, 0], hold: 0.5 },
];

export const def: MiniGameDef = {
  id: 'plank',
  title: 'Le plateau à bille',
  emoji: '🎱',
  posture: 'side',
  mode: 'coop',
  logical: { w: SIDE_W, h: SIDE_H },
  demo: DEMO,
  create: (ctx) => new PlankGame(ctx),
};

/** Modèle PUR exposé au bot via `window.__game.models` (§7). */
export { PlankModel as Model };
