import { sfx } from '../../audio/sfx';
import { MIRROR_COURSES, SIDE_H, SIDE_W, SIDE_ZONE_W } from '../../config/balance';
import type { Demo, DemoMove, MiniGame, MiniGameCtx, MiniGameDef } from '../../core/minigame';
import { MirrorModel } from './model';
import { MirrorView } from './view';

/**
 * Câblage de `mirror` (§3.5 — Miroir cassé · side · coop · temps réel).
 *
 * `index.ts` est le SEUL des trois fichiers à connaître à la fois le modèle,
 * la vue, le DOM et Pixi. Il pose les contrôles dans `ctx.overlay` : ici, à
 * la différence des jeux à cases (Cerveau, Trois Portes), ce sont des
 * boutons VISIBLES (`.bigbtn`, gros, pictogrammes en emoji) et non des
 * cibles transparentes posées sur un dessin — le §3.5 les décrit comme tels
 * (« deux gros boutons ◀ ▶… un bouton SAUT plein tiers, immense ») : la
 * lisibilité de la commande EST le dessin, pour un public de 5 ans.
 *
 * ÉCART ASSUMÉ sur le clavier (§3.5 dit littéralement « P0 : KeyA/KeyD,
 * P1 : ArrowUp ou Space ») : les touches sont liées au VERBE (déplacer /
 * sauter), pas au siège. Un lien par siège serait sous-spécifié dès qu'un
 * siège devient sauteur — il n'a alors plus de touche « gauche/droite » —
 * alors qu'un lien par verbe reste jouable en continu par UNE seule paire de
 * mains sur un clavier, quel que soit le siège auquel le rôle appartient ce
 * parcours-ci ; c'est aussi ce que le bot `keyboard` doit pouvoir piloter
 * sans avoir à recalculer un mapping à chaque échange de rôle.
 */

const totalCourses = MIRROR_COURSES;

class MirrorGame implements MiniGame {
  private readonly model: MirrorModel;
  private readonly view: MirrorView;

  private readonly btnLeft: HTMLButtonElement;
  private readonly btnRight: HTMLButtonElement;
  private readonly btnJump: HTMLButtonElement;

  private time = 0;
  private paused = false;

  private leftHeld = false;
  private rightHeld = false;
  private keyLeftHeld = false;
  private keyRightHeld = false;
  /** `pointerId` du doigt qui tient ◀ / ▶, ou -1. Le relâchement est écouté
   *  sur la FENÊTRE : un doigt levé hors du bouton doit rendre la direction. */
  private leftPointer = -1;
  private rightPointer = -1;

  constructor(private readonly ctx: MiniGameCtx) {
    this.model = new MirrorModel(ctx.seed, ctx.stars);
    this.view = new MirrorView(ctx.stage, this.model, ctx.reducedMotion);

    this.btnLeft = makeButton('◀', 'aller à gauche');
    this.btnRight = makeButton('▶', 'aller à droite');
    this.btnJump = makeButton('⬆️', 'sauter');
    ctx.overlay.append(this.btnLeft, this.btnRight, this.btnJump);

    // ◀ ▶ : l'appui vit sur le BOUTON, le relâchement sur la FENÊTRE.
    // Un `pointerleave` sur le bouton (première version) relâchait dès que le
    // doigt glissait d'un pixel hors de la cible et ne se réarmait plus sans
    // un nouvel appui : chez un enfant de 5 ans qui tient le bouton en
    // bougeant, le personnage s'arrêtait sans raison visible. Et les boutons
    // se DÉPLACENT d'un tiers d'écran à l'autre à chaque parcours (rôles
    // échangés) — un relâchement lié à la géométrie du bouton serait de toute
    // façon faux. Écouter `pointerup`/`pointercancel` sur `window` en filtrant
    // sur le `pointerId` est le seul montage qui ne peut pas rester coincé.
    this.btnLeft.addEventListener('pointerdown', this.onLeftDown);
    this.btnRight.addEventListener('pointerdown', this.onRightDown);
    // ⬆ : le saut part de l'APPUI, jamais du relâchement. `click` ne se
    // déclenche qu'au `pointerup`, donc un enfant qui garde le pouce posé ne
    // sautait qu'en levant le doigt — sur un jeu de plateforme où la fenêtre
    // de coyote fait 0,1 s, cette latence est la mécanique elle-même.
    // `click` reste branché pour le CLAVIER seul (Entrée/Espace produisent un
    // click de `detail === 0`, sans pointeur) : on garde ainsi le bouton natif
    // et son accessibilité sans sauter deux fois au doigt.
    this.btnJump.addEventListener('pointerdown', this.onJumpDown);
    this.btnJump.addEventListener('click', this.onJumpClick);

    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    this.layoutControls();
    this.refresh();
    this.announceRoles();
  }

  // ───────── contrôles ─────────

  private updateMoveDir(): void {
    const left = this.leftHeld || this.keyLeftHeld;
    const right = this.rightHeld || this.keyRightHeld;
    const dir: -1 | 0 | 1 = left && !right ? -1 : right && !left ? 1 : 0;
    this.model.setMoveDir(dir);
  }

  private readonly onLeftDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.paused || this.model.over) return;
    this.leftPointer = e.pointerId;
    this.leftHeld = true;
    this.updateMoveDir();
  };
  private readonly onRightDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.paused || this.model.over) return;
    this.rightPointer = e.pointerId;
    this.rightHeld = true;
    this.updateMoveDir();
  };
  /** Relâchement global : un doigt levé N'IMPORTE OÙ rend sa direction. */
  private readonly onPointerUp = (e: PointerEvent): void => {
    let changed = false;
    if (this.leftHeld && e.pointerId === this.leftPointer) {
      this.leftHeld = false;
      this.leftPointer = -1;
      changed = true;
    }
    if (this.rightHeld && e.pointerId === this.rightPointer) {
      this.rightHeld = false;
      this.rightPointer = -1;
      changed = true;
    }
    if (changed) this.updateMoveDir();
  };
  private readonly onJumpDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.tryJump();
  };
  private readonly onJumpClick = (e: MouseEvent): void => {
    // `detail === 0` = activation CLAVIER (Entrée/Espace) ou programmatique :
    // au doigt/souris, `onJumpDown` a déjà sauté sur l'appui.
    if (e.detail !== 0) return;
    this.tryJump();
  };

  private tryJump(): void {
    if (this.paused || this.model.over) return;
    if (this.model.jump()) sfx.tap();
  }

  /**
   * Le clavier n'appartient au jeu QUE si le focus est sur le plateau ou sur
   * l'un de nos trois boutons. Sans cette garde, `preventDefault()` sur Espace
   * avalait l'activation du ⏸ et du 🔊 du bandeau : la pause devenait
   * injouable au clavier et une pression sur Espace faisait sauter au lieu de
   * mettre en pause. C'est exactement le trou de `steer.setKeyboardBlocker`
   * de Berceau, invisible à tout test au doigt.
   */
  private ownsKeyboard(): boolean {
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return true;
    return a === this.btnLeft || a === this.btnRight || a === this.btnJump;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.paused || this.model.over) return;
    if (!this.ownsKeyboard()) return;
    if (e.code === 'KeyA') {
      this.keyLeftHeld = true;
      this.updateMoveDir();
      e.preventDefault();
    } else if (e.code === 'KeyD') {
      this.keyRightHeld = true;
      this.updateMoveDir();
      e.preventDefault();
    } else if (e.code === 'ArrowUp') {
      this.tryJump();
      e.preventDefault();
    } else if (e.code === 'Space') {
      // Le bouton ⬆ focalisé répond déjà nativement à Espace (Entrée/Espace
      // gratuits sur un vrai <button>, §5) : on le laisse faire ENTIÈREMENT,
      // sans `preventDefault()`. Le relayer doublerait le saut ; le
      // `preventDefault()` seul, lui, ANNULAIT l'activation native et le
      // bouton ne sautait plus du tout au clavier — la panne exacte qu'on
      // croyait éviter, à l'envers.
      if (document.activeElement === this.btnJump) return;
      this.tryJump();
      e.preventDefault();
    }
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'KeyA') {
      this.keyLeftHeld = false;
      this.updateMoveDir();
    } else if (e.code === 'KeyD') {
      this.keyRightHeld = false;
      this.updateMoveDir();
    }
  };
  private readonly onBlur = (): void => {
    this.leftHeld = this.rightHeld = this.keyLeftHeld = this.keyRightHeld = false;
    this.leftPointer = this.rightPointer = -1;
    this.model.setMoveDir(0);
  };

  /**
   * Replace les trois boutons dans le tiers du siège qui porte leur rôle
   * CE parcours-ci (§1.4 : P0 = siège gauche, fixe ; seuls les RÔLES
   * s'échangent). Appelée à la construction et à chaque nouveau parcours —
   * jamais par frame, la disposition ne change qu'à ces deux moments.
   */
  private layoutControls(): void {
    const leftIsMover = this.model.roleOf(0) === 'move';
    const moveZoneX = leftIsMover ? 0 : SIDE_W - SIDE_ZONE_W;
    const jumpZoneX = leftIsMover ? SIDE_W - SIDE_ZONE_W : 0;

    const pad = 18;
    const btnW = (SIDE_ZONE_W - pad * 3) / 2;
    const btnH = 200;
    const midY = (SIDE_H - btnH) / 2;
    place(this.btnLeft, moveZoneX + pad, midY, btnW, btnH);
    place(this.btnRight, moveZoneX + pad * 2 + btnW, midY, btnW, btnH);
    place(this.btnJump, jumpZoneX + pad, pad, SIDE_ZONE_W - pad * 2, SIDE_H - pad * 2);
  }

  /**
   * Synchrone à chaque changement d'état (§5) : jamais de focus donné à un
   * bouton encore `disabled`.
   *
   * POURQUOI ⬆ N'EST PAS `disabled` EN L'AIR, alors que le §1.1.2 exige
   * qu'un coup illégal soit inerte : parce que le seul moment où le saut est
   * refusé mais où l'appuyer est le geste JUSTE, c'est la fenêtre de coyote —
   * on vient de quitter le sol et on a 0,1 s pour sauter quand même. Griser
   * le bouton dès `!grounded` supprimerait exactement le paramètre qui rend
   * le jeu jouable à deux, et le rallumer 6 frames plus tard serait un
   * clignotement (§1.2 : aucun stroboscope). L'impossibilité reste PHYSIQUE
   * et silencieuse (`jump()` renvoie `false`, rien ne s'affiche) — le jeu ne
   * dit jamais « coup interdit ». Les trois boutons redeviennent en revanche
   * réellement inertes dès la pause ou la fin de manche.
   */
  private refresh(): void {
    const dead = this.paused || this.model.over;
    this.btnLeft.disabled = dead;
    this.btnRight.disabled = dead;
    this.btnJump.disabled = dead;
  }

  private announceRoles(): void {
    const leftMoves = this.model.roleOf(0) === 'move';
    const text = leftMoves
      ? `parcours ${this.model.courseIndex + 1} sur ${totalCourses} : à gauche de courir, à droite de sauter`
      : `parcours ${this.model.courseIndex + 1} sur ${totalCourses} : à gauche de sauter, à droite de courir`;
    this.ctx.onAnnounce(text);
  }

  // ───────── contrat MiniGame ─────────

  update(dt: number): void {
    if (this.paused) return;
    const beforeCourse = this.model.courseIndex;
    const beforeFall = this.model.fallCount;
    const beforeGoal = this.model.goalPulseCount;
    const wasOver = this.model.over;

    this.model.tick(dt);
    this.time += dt;

    if (this.model.fallCount !== beforeFall) {
      sfx.bump();
      this.ctx.onAnnounce('retour au dernier point de contrôle');
    }
    if (this.model.goalPulseCount !== beforeGoal) {
      sfx.goal();
      this.ctx.onAnnounce(`porte franchie : ${this.model.coursesCleared} parcours sur ${totalCourses}`);
    }
    if (this.model.courseIndex !== beforeCourse) {
      // `loadCourse` remet `moveDir` à 0 CÔTÉ MODÈLE (le nouveau parcours ne
      // doit rien hériter implicitement) : si le pouce est resté posé sur le
      // bouton ◀/▶ (ou la touche KeyA/KeyD encore enfoncée) pendant la
      // traversée de la porte, on RÉ-APPLIQUE l'état réellement tenu tout de
      // suite — sinon le personnage reste immobile au nouveau parcours tant
      // que le joueur ne relâche pas puis ne réappuie pas (bug constaté au
      // test : sans cette ligne, `x`/`y` restent figés indéfiniment dès le
      // second parcours).
      this.updateMoveDir();
      this.layoutControls();
      this.refresh();
      this.announceRoles();
    }
    if (!wasOver && this.model.over) {
      this.refresh();
      this.ctx.onOver(this.model.result);
    }
  }

  render(alpha: number): void {
    this.view.render(this.time, alpha);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (p) {
      this.leftHeld = this.rightHeld = this.keyLeftHeld = this.keyRightHeld = false;
      this.leftPointer = this.rightPointer = -1;
      this.model.setMoveDir(0);
    }
    this.refresh();
  }

  /** §2.4 — la démo rejoue le MODÈLE RÉEL : `core/demo.ts` tient chaque
   *  entrée `hold` secondes (en appelant `update(dt)`) avant le coup suivant. */
  applyDemo(move: DemoMove): void {
    if (move.move === 'move') {
      const dir = (move.args?.[0] ?? 0) as -1 | 0 | 1;
      this.model.setMoveDir(dir);
    } else if (move.move === 'jump') {
      this.model.jump();
    }
  }

  destroy(): void {
    this.btnLeft.removeEventListener('pointerdown', this.onLeftDown);
    this.btnRight.removeEventListener('pointerdown', this.onRightDown);
    this.btnJump.removeEventListener('pointerdown', this.onJumpDown);
    this.btnJump.removeEventListener('click', this.onJumpClick);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.btnLeft.remove();
    this.btnRight.remove();
    this.btnJump.remove();
    this.view.destroy();
  }
}

function makeButton(text: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'bigbtn';
  b.textContent = text;
  b.setAttribute('aria-label', label);
  return b;
}

function place(el: HTMLElement, x: number, y: number, w: number, h: number): void {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
}

/**
 * Coups canoniques (§2.4) : une petite histoire de ~1,8 s sur le tout
 * premier parcours (un trou simple) — courir, sauter par-dessus le trou,
 * continuer jusqu'à la porte. Rejouée par `core/demo.ts` À TRAVERS ce
 * modèle : aucune animation séparée, donc aucun risque de divergence si la
 * physique change un jour. Durées retrouvées par simulation directe du
 * modèle (le saut est très tolérant ici : n'importe quel départ entre 0,3 s
 * et 0,65 s de course franchit le trou, cf. notes de calibration) puis
 * margées confortablement.
 */
const DEMO: Demo = [
  { move: 'move', args: [1], hold: 0.5 },
  { move: 'jump', hold: 0.08 },
  { move: 'move', args: [1], hold: 1.2 },
];

export const def: MiniGameDef = {
  id: 'mirror',
  title: 'Miroir cassé',
  emoji: '🪞',
  posture: 'side',
  mode: 'coop',
  logical: { w: SIDE_W, h: SIDE_H },
  demo: DEMO,
  create: (ctx) => new MirrorGame(ctx),
};

/** Modèle PUR exposé au bot via `window.__game.models` (§7). */
export { MirrorModel as Model };
