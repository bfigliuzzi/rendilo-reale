import { sfx } from '../audio/sfx';
import { RESULT_DELAY_SEC } from '../config/balance';
import { GAMES, gameById } from '../config/games';
import { MASCOTS } from '../config/mascots';
import { PassScreen } from '../ui/pass';
import { Screens, type PlayerView } from '../ui/screens';
import type { MiniGameDef, Result } from './minigame';
import type { Shell } from './shell';

/**
 * LA MACHINE À ÉTATS de la collection : accueil → menu → jeu → (passage) →
 * résultat → menu. C'est le seul module qui décide de ce qui est affiché, et
 * le seul qui appelle `Session` en écriture (laquelle est, elle, le seul module
 * qui touche au `localStorage`). Même discipline que `game/flow.ts` dans les
 * cinq autres jeux du hub.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TROIS RÈGLES D'ÉTAT QUI NE SE DEVINENT PAS
 *
 * ① CHAQUE TRANSITION PASSE PAR `enter()`. Un écran ne s'ouvre jamais sans
 *    que la visibilité du plateau, du bandeau, des boutons du jeu et du focus
 *    soit RE-DÉCIDÉE d'un bloc. Sans ce point unique, on finit avec un état où
 *    le plateau est masqué et le panneau fermé — écran noir, zéro erreur
 *    console, panne introuvable.
 * ② LE RÉSULTAT EST DIFFÉRÉ de `RESULT_DELAY_SEC` (leçon de Cerveau) : sans le
 *    délai, le panneau s'ouvre AVANT la dernière animation du jeu et le joueur
 *    ne voit jamais pourquoi il a gagné — ce qui casse le critère 4 du test des
 *    5 ans. Le compte à rebours vit dans `update()`, pas dans un `setTimeout` :
 *    il suit la boucle, donc il ne coule pas pendant une pause.
 * ③ « LE PERDANT CHOISIT » est porté par `Session.chooser` (mis à jour à chaque
 *    fin de manche) et se lit à TROIS endroits : sa mascotte agrandie dans le
 *    bandeau, un halo de sa teinte sur la grille, une phrase en région live.
 *    Jamais la couleur seule.
 * ─────────────────────────────────────────────────────────────────────────
 */
export type FlowState = 'home' | 'menu' | 'game' | 'pass' | 'result' | 'pause';

export class Flow {
  readonly screens: Screens;
  readonly pass: PassScreen;

  private state: FlowState = 'home';
  /** Le jeu de la manche courante — « encore » le relance avec un autre seed. */
  private currentDef: MiniGameDef | null = null;
  private lastResult: Result | null = null;
  /** Compte à rebours de l'écran de résultat (§ règle ② ci-dessus). */
  private resultIn = 0;
  /** Reset en deux temps : un tap arme, le suivant efface. */
  private resetArmed = false;

  constructor(private readonly shell: Shell) {
    this.screens = new Screens(shell.ui);
    this.pass = new PassScreen(shell.passRoot);
    this.pass.onTap = () => this.endPass();

    this.shell.hud.onMute = () => this.toggleMute();
    this.shell.hud.onPause = () => this.togglePause();

    this.shell.onTurn = (player) => this.requestPass(player);
    this.shell.onOver = (result) => this.onOver(result);

    this.screens.onPlay = () => this.showMenu();
    this.screens.onHome = () => this.showHome();
    this.screens.onMascot = (p, id) => {
      this.shell.session.setMascot(p, id);
      sfx.pick();
      this.showHome();
    };
    this.screens.onStars = (p, s) => {
      this.shell.session.setStars(p, s);
      sfx.pick();
      this.showHome();
    };
    this.screens.onPick = (id) => {
      const def = gameById(id);
      if (def) this.startRound(def);
    };
    this.screens.onAgain = () => {
      // « Encore » = MÊME jeu, NOUVEAU tirage (§4.3) : rejouer le même seed
      // rejouerait la même partie, ce qui n'est pas ce que demande un enfant
      // qui vient de perdre.
      if (this.currentDef) this.startRound(this.currentDef);
    };
    this.screens.onOther = () => this.showMenu();
    this.screens.onResume = () => this.togglePause();
    this.screens.onQuit = () => {
      this.shell.stopGame();
      this.currentDef = null;
      this.showMenu();
    };
    this.screens.onMute = (on) => {
      this.shell.session.setMuted(on);
      this.shell.applyMotionAndSound();
      this.refresh();
      this.reshowCurrentPanel();
    };
    this.screens.onMotion = (on) => {
      this.shell.session.setReducedMotion(on);
      this.shell.applyMotionAndSound();
      this.reshowCurrentPanel();
    };
    this.screens.onReset = () => {
      if (!this.resetArmed) {
        this.resetArmed = true;
        this.showHome();
        return;
      }
      this.resetArmed = false;
      this.shell.session.reset();
      this.shell.applyMotionAndSound();
      this.showHome();
    };
  }

  // ───────────────────────── Écrans ─────────────────────────

  showHome(): void {
    // Le compte à rebours du résultat est DÉSARMÉ à chaque sortie : sans ça,
    // quitter pendant le délai rouvrait l'écran de résultat par-dessus le menu
    // une seconde plus tard.
    this.resultIn = 0;
    this.shell.stopGame();
    // Le fond de la page continue de vivre derrière les panneaux : la pause
    // héritée de la fin de manche gèlerait les motes jusqu'au prochain lancement.
    this.shell.setPaused(false);
    this.currentDef = null;
    this.enter('home');
    const s = this.shell.session;
    this.screens.showHome({
      players: this.players(),
      mascots: MASCOTS,
      muted: s.muted,
      reducedMotion: s.reducedMotion,
      // Préférence système : la case est cochée ET verrouillée — on n'offre
      // pas de contredire le réglage du téléphone.
      motionLocked: s.systemReducedMotion,
      resetArmed: this.resetArmed,
    });
    this.shell.setBoardText('accueil : choisissez vos mascottes, puis jouez.');
  }

  showMenu(): void {
    this.resetArmed = false;
    this.resultIn = 0; // cf. `showHome` : on désarme le résultat différé
    // On quitte la manche pour de bon : le micro-jeu est démonté ICI et pas au
    // prochain lancement, sinon ses boutons dorment dans l'overlay pendant tout
    // le temps passé au menu — invisibles, mais bien là.
    this.shell.stopGame();
    this.shell.setPaused(false);
    this.enter('menu');
    const s = this.shell.session;
    const chooser = s.chooser === null ? null : s.mascot(s.chooser);
    this.screens.showMenu({ games: GAMES, chooser });
    if (chooser) this.shell.announce(`au tour de ${chooser.name} de choisir`);
    this.shell.setBoardText(
      `menu : ${GAMES.length} jeux.${chooser ? ` ${chooser.name} choisit.` : ''}`,
    );
  }

  /** Lance une manche : nouveau tirage sauf si le bot en impose un. */
  startRound(def: MiniGameDef, seed?: number): void {
    this.resetArmed = false;
    this.currentDef = def;
    this.lastResult = null;
    this.resultIn = 0;
    // Le panneau se ferme AVANT le montage : le micro-jeu pose ses boutons
    // dans un overlay déjà propre, et le focus saute ensuite sur SA première
    // cible légale, jamais sur un bouton de menu détruit entre-temps.
    this.screens.hide();
    this.shell.startGame(def, seed);
    this.enter('game');
    if (!this.shell.focusPlayable()) this.shell.hud.focusFirst();
    this.shell.setBoardText(`${def.title} : la manche commence.`);
  }

  // ───────────────────────── Passage (§4.2) ─────────────────────────

  /**
   * `ctx.onTurn(p)` du micro-jeu. L'écran de passage n'existe que pour la
   * posture 'pass' : en posture 'side' les deux joueurs regardent le même
   * écran EN MÊME TEMPS, un plein écran « passe le téléphone » y serait un
   * mensonge. On garde l'annonce dans les deux cas.
   */
  requestPass(player: 0 | 1): void {
    const mascot = this.shell.session.mascot(player);
    if (!this.shell.def || this.shell.def.posture !== 'pass') {
      this.shell.announce(`à ${mascot.name} de jouer`);
      return;
    }
    // Le monde se fige pendant le passage : un jeu temps réel n'avancerait pas
    // pendant qu'on se passe le téléphone, et un jeu au tour par tour n'a rien
    // à y perdre.
    this.shell.setPaused(true);
    this.enter('pass');
    this.pass.show(mascot);
    sfx.pass();
    this.shell.announce(`passe le téléphone à ${mascot.name}`);
  }

  private endPass(): void {
    this.pass.hide();
    this.enter('game');
    this.shell.setPaused(false);
    if (!this.shell.focusPlayable()) this.shell.hud.focusFirst();
  }

  // ───────────────────────── Fin de manche (§4.3) ─────────────────────────

  private onOver(result: Result): void {
    this.lastResult = result;
    // Le plateau se fige, mais reste À L'ÉCRAN le temps du délai : c'est là
    // que le joueur voit la cause (la dernière pomme qui tombe, la bille dans
    // le trou). Le panneau n'arrive qu'après.
    this.shell.setPaused(true);
    this.shell.setOverlayVisible(false);
    this.resultIn = RESULT_DELAY_SEC;
    this.refresh();
  }

  private showResult(): void {
    const r = this.lastResult;
    const def = this.currentDef;
    if (!r || !def) return;
    this.enter('result');
    this.screens.showResult({
      game: def,
      winner: r.winner,
      scores: r.scores,
      reason: r.reason,
      players: this.players(),
    });
    this.shell.setBoardText(`fin de manche : ${r.reason}`);
  }

  // ───────────────────────── Pause (§1.2) ─────────────────────────

  /**
   * ⏸ est atteignable à tout moment d'une manche, y compris pendant l'écran de
   * passage ? NON : pendant le passage, le seul geste possible est le tap du
   * destinataire (§4.2, « rien d'autre n'est focusable »), et le monde est
   * déjà figé — mettre en pause une pause n'a pas de sens.
   */
  togglePause(): void {
    if (this.state === 'pause') {
      const had = this.screens.hide();
      this.enter('game');
      this.shell.setPaused(false);
      if (had && !this.shell.focusPlayable()) this.shell.hud.focusFirst();
      return;
    }
    if (this.state !== 'game' || !this.shell.current) return;
    this.shell.setPaused(true);
    this.enter('pause');
    this.screens.showPause({ muted: this.shell.session.muted });
  }

  private toggleMute(): void {
    const s = this.shell.session;
    s.setMuted(!s.muted);
    this.shell.applyMotionAndSound();
    this.refresh();
    this.reshowCurrentPanel();
  }

  /** Re-rend le panneau ouvert quand une option change (case à cocher). */
  private reshowCurrentPanel(): void {
    if (this.state === 'home') this.showHome();
    else if (this.state === 'pause') this.screens.showPause({ muted: this.shell.session.muted });
  }

  // ───────────────────────── Mécanique commune ─────────────────────────

  /**
   * LE point unique de vérité sur ce qui est visible. Chaque état décide des
   * quatre plans d'un coup : plateau, bandeau, boutons du jeu, écran de
   * passage. Un état qui oublierait un plan laisserait des boutons invisibles
   * focalisables — la panne classique, et invisible à tout test au doigt.
   */
  private enter(state: FlowState): void {
    this.state = state;
    const passing = state === 'pass';
    // Pendant le passage, TOUT le HUD disparaît (bandeau ET boutons du jeu) :
    // il ne doit rester qu'un seul élément focalisable sur la page.
    this.shell.setHudVisible(!passing);
    this.shell.setStageVisible(!passing);
    // Le bandeau reste au-dessus du menu et du résultat (§4.1.3) ; il
    // disparaît pendant la pause, dont le panneau porte déjà « reprendre ».
    this.shell.setBarVisible(!passing && state !== 'pause');
    this.shell.setOverlayVisible(state === 'game');
    this.refresh();
  }

  /** Synchrone à chaque changement d'état — jamais à la frame suivante (§5). */
  private refresh(): void {
    const s = this.shell.session;
    this.shell.hud.refresh({
      mascots: [s.mascot(0), s.mascot(1)],
      stars: s.stars,
      score: s.score,
      chooser: s.chooser,
      muted: s.muted,
      paused: this.shell.paused,
      canPause: this.state === 'game' || this.state === 'pause',
    });
  }

  private players(): readonly [PlayerView, PlayerView] {
    const s = this.shell.session;
    return [
      { mascot: s.mascot(0), stars: s.stars[0] },
      { mascot: s.mascot(1), stars: s.stars[1] },
    ];
  }

  /**
   * Appelée par la boucle AVANT `shell.update` : le compte à rebours du
   * résultat doit couler même quand le shell est en pause (il l'est justement
   * pendant ce délai), et s'arrêter net si le joueur quitte entre-temps.
   */
  update(dt: number): void {
    if (this.resultIn <= 0) return;
    this.resultIn -= dt;
    if (this.resultIn <= 0) {
      this.resultIn = 0;
      this.showResult();
    }
  }

  /** Le bot et le boot : démarrer la collection sur l'accueil. */
  start(): void {
    this.showHome();
  }

  get current(): FlowState {
    return this.state;
  }
}
