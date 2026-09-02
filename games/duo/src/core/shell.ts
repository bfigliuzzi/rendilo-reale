import { Application, Container } from 'pixi.js';
import { sfx } from '../audio/sfx';
import { PASS_H, PASS_W } from '../config/balance';
import { Ambience } from '../render/ambience';
import { Fx } from '../render/fx';
import { Layers } from '../render/layers';
import { PALETTE, getAtlas, type Atlas } from '../render/textures';
import { Hud } from '../ui/hud';
import { DemoBoard, DemoRunner } from './demo';
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
  /**
   * Hauteur ÉCRAN réellement occupée par le bandeau de table, MESURÉE sur
   * l'élément (elle bouge avec `env(safe-area-inset-top)` et avec la police du
   * système). Mise en cache : le bandeau est `display:none` pendant l'écran de
   * passage et la pause, où `offsetHeight` vaut 0 — réserver 0 px à ce
   * moment-là ferait sauter le letterbox d'un écran à l'autre.
   */
  private barPx = 0;
  /** Recouvrement RÉSIDUEL du bandeau, en px logiques (cf. `safeTop`). */
  private safeTopPx = 0;

  current: MiniGame | null = null;
  def: MiniGameDef | null = null;
  paused = false;

  /**
   * LES DEUX EMPLOIS DE LA DÉMONSTRATION (§2.4), et ils partagent le même
   * rejoueur (`core/demo.ts`) — c'est tout l'intérêt : une seule cadence, un
   * seul contrat, aucune animation parallèle nulle part.
   *   • `menuBoard` : les huit vignettes de la grille du menu, peintes sur la
   *     planche `layers.demo` puis recopiées dans les `<canvas>` du DOM.
   *   • `intro` : le PREMIER écran d'un jeu jamais lancé (`save.seen`), en
   *     plein cadre. Elle tourne, un tap la coupe.
   */
  menuBoard!: DemoBoard;
  private intro: DemoRunner | null = null;
  private introBtn: HTMLButtonElement | null = null;
  /** L'invite « tape pour jouer » de l'écran de démonstration — retirée après
   *  un tour de boucle pour rendre le bas du plateau au jeu (cf. `startIntro`). */
  private introTip: HTMLElement | null = null;

  /**
   * Points d'accroche du Flow. Le shell ne décide de rien : il transmet.
   * Par défaut inertes, ce qui laisse le shell testable seul (un micro-jeu
   * monté à la main joue jusqu'au bout sans une ligne d'interface).
   */
  onTurn: (player: 0 | 1) => void = () => {};
  onOver: (result: Result) => void = () => {};
  /** Le tap qui coupe l'écran de démonstration d'un jeu jamais lancé. */
  onIntroSkip: () => void = () => {};

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
    // Le mouvement réduit est relu à chaque montage de vignette, pas figé ici :
    // la case de l'accueil peut changer entre deux passages au menu.
    this.menuBoard = new DemoBoard(this.app, this.layers.demo, () => this.session.reducedMotion);

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

  /**
   * LE BANDEAU DE TABLE EST RÉSERVÉ HORS DU LETTERBOX, et c'est une correction
   * de fond, pas un ajustement d'esthétique.
   *
   * Le bandeau vit en espace ÉCRAN (§4.1.3 : ⏸ ne doit pas valser d'un jeu
   * `pass` à un jeu `side`) tandis que le plateau est letterboxé et centré sur
   * la fenêtre entière : les deux se recouvraient donc, d'une hauteur qui n'est
   * même pas constante — MESURÉ de 0 à 114 px LOGIQUES selon la fenêtre et la
   * posture (114 pour un jeu 540×960 dans une fenêtre 960×540). Cinq des huit
   * jeux avaient contourné le trou chacun de son côté, avec cinq constantes
   * empiriques différentes ; le sixième format de fenêtre les prenait toutes en
   * défaut.
   *
   * On centre donc le plateau dans la bande LIBRE, sous le bandeau : la
   * hauteur disponible perd `barPx`, et le centre descend d'une demi-hauteur de
   * bandeau. Corollaire mesurable : `safeTop()` retombe à 0 pour les huit jeux,
   * dans les deux postures — plus aucun micro-jeu ne peut peindre sous le
   * bandeau, quelle que soit la fenêtre.
   *
   * La bande reste réservée même quand le bandeau est masqué (passage, pause) :
   * la libérer ferait sauter le plateau d'un écran à l'autre, ce qui se lit
   * comme un bug de rendu.
   */
  private readonly resize = (): void => {
    const measured = this.hud.element.offsetHeight;
    if (measured > 0) this.barPx = measured;
    const free = Math.max(1, window.innerHeight - this.barPx);
    const scale = Math.min(window.innerWidth / this.lw, free / this.lh);
    this.scale = scale;
    // `translateY` AVANT `scale` : il s'applique donc en pixels ÉCRAN (les
    // transforms se composent de droite à gauche), ce qui est bien ce qu'on
    // veut — la bande à réserver est une hauteur d'écran, pas de plateau.
    const t = `translate(-50%, -50%) translateY(${this.barPx / 2}px) scale(${scale})`;
    this.stageEl.style.transform = t;
    // MÊME transform que #stage, sans exception : c'est le contrat qui aligne
    // les boutons transparents sur le dessin.
    this.overlayEl.style.transform = t;
    // Recouvrement RÉSIDUEL, recalculé et non pas affirmé : si quelqu'un
    // retouche le CSS du bandeau, `safeTop()` dira la vérité au lieu de mentir.
    const top = window.innerHeight / 2 - (this.lh * scale) / 2 + this.barPx / 2;
    this.safeTopPx = Math.max(0, (this.barPx - top) / scale);
  };

  /**
   * Hauteur, en px LOGIQUES du repère courant, que le bandeau recouvre encore.
   * 0 dans tous les formats mesurés depuis la réservation ci-dessus ; un
   * micro-jeu qui veut border son bord haut lit CE nombre, jamais une
   * constante (cf. `MiniGameCtx.safeTop`).
   */
  get safeTop(): number {
    return this.safeTopPx;
  }

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
      onBoard: (text) => this.setBoardText(text),
      onOver: (result) => {
        this.session.recordResult(result);
        this.announce(result.reason);
        if (result.winner === null) sfx.goal();
        else sfx.win();
        this.onOver(result);
      },
      reducedMotion: this.session.reducedMotion,
      // Fonction et non valeur : la fenêtre peut tourner en pleine manche.
      safeTop: () => this.safeTopPx,
    };

    this.current = def.create(ctx);
    this.paused = false;
    this.overlayEl.hidden = false;
  }

  // ───────────────────────── Démonstration en plein cadre ─────────────────────────

  /**
   * §2.4, second emploi : le premier écran d'un jeu jamais lancé. On monte le
   * MÊME rejoueur que les vignettes, à la taille logique réelle du jeu, et on
   * pose par-dessus un bouton plein cadre transparent : « elle tourne, un tap
   * la coupe ».
   *
   * MESURÉ, et pas affirmé : à cet écran la page compte DEUX focalisables, ce
   * bouton et le 🔇 du bandeau (⏸ y est `disabled` — il n'y a pas de manche à
   * mettre en pause). Le second est voulu : le §1.2 exige que le son se coupe
   * de partout. Rien d'autre n'est atteignable, ni au doigt ni au clavier.
   */
  startIntro(def: MiniGameDef): void {
    this.stopIntro();
    this.setLogical(def.logical.w, def.logical.h);
    const root = new Container();
    this.layers.game.addChild(root);
    this.intro = new DemoRunner(def, {
      stage: root,
      reducedMotion: this.session.reducedMotion,
      // Ici le bandeau est bien là : on lui rend sa vraie valeur, contrairement
      // à une vignette, qui n'est sous rien.
      safeTop: () => this.safeTopPx,
    });
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'demoskip';
    btn.dataset.key = 'demo-skip';
    btn.setAttribute(
      'aria-label',
      `${def.title} : la règle en images, elle tourne en boucle. Taper pour commencer la partie.`,
    );
    // L'INVITE S'EFFACE AU BOUT D'UNE BOUCLE DE DÉMONSTRATION, et ce n'est pas
    // un détail de goût : elle est posée au bas du repère LOGIQUE, or c'est
    // exactement la bande où cinq des huit jeux peignent leur objet-but — les
    // paniers de `tree` et leur compte, le bas des piles de `tiles`, les
    // compteurs 🔍 de `suspects`, la légende des sièges de `beast`, le trou de
    // sortie du deuxième parcours de `plank`. Constaté à la capture d'écran,
    // jamais au raisonnement : dans `tree`, la RÉCOMPENSE de la démonstration
    // (les pommes qui roulent dans le panier) était intégralement masquée par
    // l'invite, donc la boucle enseignait une règle amputée (§1.1 critère 1).
    //
    // On ne la déplace pas : aucune bande du cadre n'est libre dans les huit
    // jeux à la fois (le haut porte la cime de `mirror`, le nuage du géant de
    // `ant`, le titre de `tiles`). On la laisse dire ce qu'elle a à dire — un
    // tap démarre la partie — le temps d'un tour de boucle, puis on rend le
    // plateau à la démonstration. Rien n'est perdu : le bouton COUVRE tout
    // l'écran et son `aria-label` porte la même phrase en permanence.
    const tip = document.createElement('span');
    tip.className = 'demotip';
    tip.textContent = '👀 la règle en images — tape pour jouer';
    btn.appendChild(tip);
    this.introTip = tip;
    btn.addEventListener('click', this.onIntroClick);
    this.overlayEl.appendChild(btn);
    this.introBtn = btn;
    this.overlayEl.hidden = false;
  }

  stopIntro(): void {
    if (this.introBtn) {
      this.introBtn.removeEventListener('click', this.onIntroClick);
      this.introBtn.remove();
      this.introBtn = null;
    }
    this.introTip = null;
    if (this.intro) {
      this.intro.destroy();
      this.intro = null;
      this.layers.game.removeChildren();
    }
  }

  private readonly onIntroClick = (): void => {
    this.onIntroSkip();
  };

  get introRunning(): boolean {
    return this.intro !== null;
  }

  stopGame(): void {
    this.stopIntro();
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
    this.overlayEl.hidden = !on || (this.current === null && this.intro === null);
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
    // Un jeu en posture 'side' n'a NI bouton NI input : ses commandes sont des
    // zones `role="slider"` / `role="application"` rendues focalisables par un
    // `tabindex`. Le sélecteur d'origine ne voyait qu'un plateau vide et
    // renvoyait `false`, donc le focus repartait sur le bandeau au lancement de
    // chaque manche de `plank` — mesuré. On exclut `tabindex="-1"` : c'est
    // l'ancre de repli que posent `suspects` et `tree`, atteignable seulement
    // par programme, jamais « la première cible légale ».
    const el = this.overlayEl.querySelector<HTMLElement>(
      'button:not([disabled]):not([hidden]), input:not([disabled]), [tabindex]:not([tabindex="-1"]):not([hidden])',
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
    this.menuBoard.update(dt);
    this.intro?.update(dt);
    // Une BOUCLE de démonstration, pas une horloge murale : la durée d'un tour
    // va de 2,9 s (`plank`) à 7,5 s (`beast`), et c'est bien « tu as vu la
    // règle une fois » qui décide, pas un minuteur arbitraire. `loop` est
    // incrémenté par le rejoueur lui-même (`core/demo.ts`, règle ①).
    if (this.introTip && this.intro && this.intro.loop >= 1) {
      this.introTip.remove();
      this.introTip = null;
    }
    this.current?.update(dt);
  }

  /**
   * L'ORDRE COMPTE, et c'est la seule subtilité du rendu des vignettes : la
   * planche des huit démos doit être PEINTE par la passe du renderer, puis
   * recopiée APRÈS elle. Le tampon de dessin WebGL reste lisible dans la même
   * tâche (il n'est vidé qu'à la composition), donc `blit()` n'a besoin ni de
   * `preserveDrawingBuffer` ni d'une extraction de pixels.
   */
  render(alpha: number): void {
    this.menuBoard.render();
    this.intro?.render(alpha);
    this.current?.render(alpha);
    this.app.renderer.render(this.app.stage);
    this.menuBoard.blit();
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[duo] élément #${id} absent de index.html`);
  return el;
}
