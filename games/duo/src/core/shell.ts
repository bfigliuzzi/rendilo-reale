import { Application, Container } from 'pixi.js';
import { sfx } from '../audio/sfx';
import { PASS_H, PASS_W } from '../config/balance';
import { Ambience } from '../render/ambience';
import { Fx } from '../render/fx';
import { Layers } from '../render/layers';
import { PALETTE, getAtlas, type Atlas } from '../render/textures';
import { Hud } from '../ui/hud';
import type { MiniGame, MiniGameCtx, MiniGameDef, Result } from './minigame';
import { Session } from './session';

/**
 * Le SHELL de la collection : boot Pixi, letterbox, boucle, pause, régions
 * live, montage et démontage d'un micro-jeu. Il possède tout ce que les huit
 * jeux n'ont pas à repayer — et un micro-jeu ne touche JAMAIS au
 * `localStorage` (seule `core/session.ts` le fait).
 *
 * Il ne connaît AUCUN écran : la machine à états (accueil → menu → jeu →
 * passage → résultat) vit dans `core/flow.ts`, qui branche `onTurn` et
 * `onOver`. Le shell reste la couche « moteur », le flow la couche « produit » ;
 * les mélanger, c'est se retrouver avec un `switch` d'écrans au milieu du
 * letterbox.
 *
 * LETTERBOX À TAILLE LOGIQUE VARIABLE — c'est LA particularité de Duo par
 * rapport aux cinq autres jeux du hub, et le piège à ne pas rouvrir : la taille
 * logique n'est PAS une constante. Elle vaut 540×960 en posture 'pass' et
 * 960×540 en posture 'side', et elle change entre deux micro-jeux. Trois choses
 * doivent bouger ENSEMBLE (`setLogical`) :
 *   ① `app.renderer.resize(w, h)` — la résolution logique du canvas ;
 *   ② `#stage.style.width/height` — le cadre CSS mis à l'échelle ;
 *   ③ `#overlay.style.width/height` ET sa transform, IDENTIQUE à celle de
 *      `#stage`. C'est ce troisième point qui fait tomber chaque bouton
 *      transparent pile sur l'objet dessiné par Pixi ; l'oublier donne une
 *      interface qui a l'air juste et qui rate toutes ses cibles.
 */
export class Shell {
  readonly session = new Session();
  readonly app = new Application();
  readonly atlas: Atlas;
  readonly hud: Hud;

  private readonly stageEl: HTMLElement;
  private readonly overlayEl: HTMLElement;
  private readonly hudEl: HTMLElement;
  private readonly uiEl: HTMLElement;
  private readonly passEl: HTMLElement;

  private layers!: Layers;
  private ambience!: Ambience;
  private fx!: Fx;

  /** Taille logique COURANTE. Jamais une constante — cf. l'en-tête. */
  private lw = PASS_W;
  private lh = PASS_H;
  /** Facteur du letterbox, utile aux écrans qui doivent connaître l'échelle. */
  scale = 1;

  current: MiniGame | null = null;
  def: MiniGameDef | null = null;
  paused = false;

  /**
   * Points d'accroche du Flow. Le shell ne décide de rien : il transmet.
   * Par défaut inertes, ce qui laisse le shell testable seul (un micro-jeu
   * monté à la main joue jusqu'au bout sans une ligne d'interface).
   */
  onTurn: (player: 0 | 1) => void = () => {};
  onOver: (result: Result) => void = () => {};

  constructor(atlas: Atlas = getAtlas()) {
    this.atlas = atlas;
    this.stageEl = must('stage');
    this.overlayEl = must('overlay');
    this.hudEl = must('hud');
    this.uiEl = must('ui');
    this.passEl = must('pass');
    // Le Hud possède le bandeau ET les deux régions live : une seule
    // implémentation de la garde « n'écrire que sur changement réel ».
    this.hud = new Hud(this.hudEl, must('sr-log'), must('sr-board'));
  }

  async init(): Promise<void> {
    await this.app.init({
      width: this.lw,
      height: this.lh,
      backgroundColor: PALETTE.bg,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      antialias: false, // pixel art : pas de lissage des arêtes
    });
    this.app.ticker.stop(); // seule `startLoop` pilote le rendu, à pas fixe

    this.stageEl.appendChild(this.app.canvas);

    this.layers = new Layers(this.app.stage, this.atlas, this.lw, this.lh);
    this.ambience = new Ambience(this.layers.motes, this.atlas.spark, this.lw, this.lh);
    this.fx = new Fx(this.layers.fx, this.layers.floaters, this.atlas.spark);

    this.applyMotionAndSound();
    this.setLogical(this.lw, this.lh);

    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
  }

  /**
   * Mouvement réduit : `prefers-reduced-motion` lu UNE fois au boot, en OU avec
   * l'option joueur (jamais en ET — on ne contredit pas une préférence
   * système ; la case est alors cochée ET verrouillée côté accueil).
   * Particules coupées, motes garées, animations DOM coupées par la classe
   * `rm` — le média CSS, lui, ne voit que la préférence système.
   * L'INFORMATION n'est jamais amputée : tout se lit à l'arrêt.
   */
  applyMotionAndSound(): void {
    const rm = this.session.reducedMotion;
    this.fx.particleMul = rm ? 0 : 1;
    this.ambience.setEnabled(!rm);
    document.body.classList.toggle('rm', rm);
    sfx.muted = this.session.muted;
  }

  // ───────────────────────── Letterbox ─────────────────────────

  setLogical(w: number, h: number): void {
    this.lw = w;
    this.lh = h;
    this.app.renderer.resize(w, h);
    this.layers.resize(w, h);
    this.ambience.resize(w, h);
    this.stageEl.style.width = `${w}px`;
    this.stageEl.style.height = `${h}px`;
    this.overlayEl.style.width = `${w}px`;
    this.overlayEl.style.height = `${h}px`;
    this.resize();
  }

  private readonly resize = (): void => {
    const scale = Math.min(window.innerWidth / this.lw, window.innerHeight / this.lh);
    this.scale = scale;
    const t = `translate(-50%, -50%) scale(${scale})`;
    this.stageEl.style.transform = t;
    // MÊME transform que #stage, sans exception : c'est le contrat qui aligne
    // les boutons transparents sur le dessin.
    this.overlayEl.style.transform = t;
  };

  // ───────────────────────── Régions live ─────────────────────────

  /** Une phrase par événement. N'écrit QUE sur changement réel (via le Hud). */
  announce(text: string): void {
    this.hud.log(text);
  }

  /** Le plateau EN TEXTE. N'écrit QUE sur changement réel. */
  setBoardText(text: string): void {
    this.hud.board(text);
  }

  // ───────────────────────── Montage d'un micro-jeu ─────────────────────────

  startGame(def: MiniGameDef, seed?: number): void {
    this.stopGame();
    if (seed !== undefined) this.session.setSeed(seed);
    else this.session.nextSeed();

    this.def = def;
    this.session.setLastGame(def.id);
    this.session.markSeen(def.id);
    this.setLogical(def.logical.w, def.logical.h);

    const root = new Container();
    this.layers.game.addChild(root);

    const ctx: MiniGameCtx = {
      stage: root,
      overlay: this.overlayEl,
      seed: this.session.seed,
      stars: this.session.stars,
      onTurn: (player) => this.onTurn(player),
      onAnnounce: (text) => this.announce(text),
      onOver: (result) => {
        this.session.recordResult(result);
        this.announce(result.reason);
        if (result.winner === null) sfx.goal();
        else sfx.win();
        this.onOver(result);
      },
      reducedMotion: this.session.reducedMotion,
    };

    this.current = def.create(ctx);
    this.paused = false;
    this.overlayEl.hidden = false;
  }

  stopGame(): void {
    if (this.current) {
      this.current.destroy();
      this.current = null;
    }
    this.def = null;
    this.layers.game.removeChildren();
    this.fx.clear();
    this.overlayEl.hidden = true;
    // Rien ne doit rester focusable derrière un panneau : sans ce nettoyage on
    // tabule sur des boutons invisibles (piège vécu sur Trois Portes). Un
    // micro-jeu qui oublierait de retirer ses boutons dans `destroy()` ne peut
    // donc pas empoisonner le suivant.
    this.overlayEl.replaceChildren();
  }

  /**
   * PAUSE INSTANTANÉE (§1.2). Le shell arrête d'appeler `update` — donc plus
   * une seconde de simulation ne passe — ET prévient le micro-jeu, qui fige son
   * propre accumulateur. Les deux sont nécessaires : le premier gèle le monde,
   * le second garantit qu'à la reprise le jeu ne rattrape pas le temps perdu.
   */
  setPaused(p: boolean): void {
    this.paused = p;
    this.current?.setPaused(p);
  }

  /** Le HUD (bandeau ET boutons du jeu) se masque AVANT un panneau (§5). */
  setHudVisible(on: boolean): void {
    this.hudEl.style.visibility = on ? 'visible' : 'hidden';
  }

  /**
   * Le bandeau seul. Il reste visible AU-DESSUS du menu et du résultat (§4.1.3
   * l'exige : mascottes, score, 🔊, ⏸), ce qui ne contredit pas la règle §5 —
   * celle-ci interdit de laisser des boutons INVISIBLES focalisables derrière
   * un panneau, et le bandeau est peint par-dessus. Il disparaît en revanche
   * pendant l'écran de passage et le panneau de pause.
   */
  setBarVisible(on: boolean): void {
    this.hud.setVisible(on);
  }

  /** Les boutons du micro-jeu, masqués dès qu'un panneau s'ouvre. */
  setOverlayVisible(on: boolean): void {
    this.overlayEl.hidden = !on || this.current === null;
  }

  /** L'écran de passage doit MASQUER le plateau, pas le voiler (§4.2). */
  setStageVisible(on: boolean): void {
    this.stageEl.style.visibility = on ? 'visible' : 'hidden';
  }

  /**
   * Rend le focus à la première cible LÉGALE du micro-jeu (§5). Renvoie
   * `false` s'il n'y en a aucune — l'appelant retombe alors sur le bandeau
   * plutôt que de laisser le focus sur `<body>`.
   */
  focusPlayable(): boolean {
    if (this.overlayEl.hidden) return false;
    const el = this.overlayEl.querySelector<HTMLElement>(
      'button:not([disabled]):not([hidden]), input:not([disabled])',
    );
    if (!el) return false;
    el.focus();
    return true;
  }

  get ui(): HTMLElement {
    return this.uiEl;
  }

  get overlay(): HTMLElement {
    return this.overlayEl;
  }

  get passRoot(): HTMLElement {
    return this.passEl;
  }

  update(dt: number): void {
    if (this.paused) return;
    this.ambience.update(dt);
    this.fx.update(dt);
    this.current?.update(dt);
  }

  render(alpha: number): void {
    this.current?.render(alpha);
    this.app.renderer.render(this.app.stage);
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[duo] élément #${id} absent de index.html`);
  return el;
}
