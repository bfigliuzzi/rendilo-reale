import { PASS_H, PASS_W, SUSPECTS_QUESTIONS } from '../../config/balance';
import { sfx } from '../../audio/sfx';
import type { Demo, DemoMove, MiniGame, MiniGameCtx, MiniGameDef } from '../../core/minigame';
import { SuspectsModel, TRAITS, type SuspectsState, type TraitKey } from './model';
import { PORTRAIT_SIZE, QBTN_H, QBTN_W, QUESTION_COUNT, SuspectsView, questionCenter, suspectCenter } from './view';

/** Durée d'affichage de « trouvé ! / raté !, c'était … » avant de rendre la
 *  main (§1.1 critère 4 : la CAUSE doit se voir avant que la manche suivante
 *  n'efface l'écran). Purement local à ce jeu — pas de constante partagée
 *  dans `config/balance.ts` pour un délai qu'aucun autre micro-jeu ne partage. */
const REVEAL_SEC = 1.5;

/**
 * `index.ts` câble le modèle PUR et la vue qui ne le mute jamais. C'est le
 * SEUL des trois fichiers autorisé à connaître à la fois le modèle, la vue,
 * le DOM et Pixi.
 *
 * Le canvas est `aria-hidden` : toute l'interaction est posée en vrais
 * `<button>` TRANSPARENTS dans `ctx.overlay`, au repère logique 540×960.
 *
 * **Boutons couvrant des CASES, pas des objets** (§5) : les 6 emplacements de
 * suspects sont FIXES pour toute la partie (un bouton par emplacement, jamais
 * recréé), leur RÔLE change selon la phase — choisir le coupable en secret
 * (`'pick'`) ou accuser (`'guess'`) — mais leur POSITION ne bouge jamais. Les
 * 4 boutons de question suivent le même principe : posés une fois, `hidden`
 * hors du tour de B.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX MÉCANISMES PROPRES À CE JEU, absents des autres micro-jeux `pass` :
 *
 * ① LA RÉVÉLATION DIFFÉRÉE. `accuse()` avance le modèle à la manche SUIVANTE
 *    dans le même appel (comme `tiles.place`) — mais contrairement à `tiles`,
 *    la manche qui vient de se jouer avait un SECRET (qui était le coupable),
 *    et il faut le montrer un court instant avant d'effacer l'écran pour la
 *    manche suivante. Cette classe garde donc un petit minuteur LOCAL
 *    (`revealUntil`, en secondes de la propre horloge `this.time` de la vue —
 *    jamais dans le modèle, qui reste pur et sans horloge) : pendant la
 *    fenêtre de révélation, TOUS les boutons sont verrouillés (peu importe ce
 *    que dit `model.state.phase`, déjà celui de la manche suivante) et
 *    `SuspectsView` affiche `model.state.lastRound`, qui survit exactement
 *    pour ça. `ctx.onTurn`/`ctx.onOver` n'est appelé qu'À LA FIN de cette
 *    fenêtre (voir `update`).
 *
 * ② LE PASSAGE INITIAL DIFFÉRÉ AU PREMIER `update()`. La toute première
 *    action de la partie (le choix du coupable par A) doit être secrète dès
 *    le début — mais `Flow.startRound` appelle `create(ctx)` PUIS
 *    `enter('game')` de façon SYNCHRONE (voir `core/flow.ts`) : un
 *    `ctx.onTurn()` posé dans le constructeur serait immédiatement écrasé par
 *    ce `enter('game')` qui suit. On diffère donc l'appel au premier
 *    `update(dt)` (qui, lui, ne s'exécute qu'à la frame suivante, une fois la
 *    manche réellement entrée) — un seul drapeau, jamais répété.
 * ─────────────────────────────────────────────────────────────────────────
 */
class SuspectsGame implements MiniGame {
  private readonly model: SuspectsModel;
  private readonly view: SuspectsView;
  private readonly suspectButtons: HTMLButtonElement[] = [];
  private readonly questionButtons: HTMLButtonElement[] = [];
  /** Ancre de repli (§ brief accessibilité, pattern de Trois Portes) : rien à
   *  focaliser dans notre overlay pendant la fenêtre de révélation (TOUT est
   *  verrouillé), mais on ne veut pas que le focus retombe sur `<body>` pour
   *  autant (le test clavier du bot l'interdit explicitement APRÈS une
   *  validation). `tabIndex=-1` : jamais atteinte en tabulant, seulement par
   *  `.focus()` explicite. */
  private readonly anchor: HTMLDivElement;
  private time = 0;
  private paused = false;
  /** Cf. mécanisme ① de l'en-tête : `null` hors fenêtre de révélation. */
  private revealUntil: number | null = null;
  /** Cf. mécanisme ② de l'en-tête. */
  private introFired = false;
  /**
   * Vrai dès que `core/demo.ts` a rejoué un coup à travers nous. Deux effets :
   *   • la révélation de la démo n'a pas de minuteur (voir `applyDemo`) — elle
   *     tient jusqu'au coup suivant, qui vient de toute façon à cadence fixe ;
   *   • le passage initial (mécanisme ②) ne part JAMAIS depuis une vignette de
   *     menu : `ctx.onTurn` y ouvrirait un écran « passe le téléphone » en
   *     plein milieu de la grille de sélection.
   */
  private demoMode = false;
  private demoRevealing = false;

  constructor(private readonly ctx: MiniGameCtx) {
    this.model = new SuspectsModel(ctx.seed, ctx.stars);
    this.view = new SuspectsView(ctx.stage, this.model, ctx.reducedMotion);

    // ORDRE DU DOM = ORDRE DU TOUR, pas ordre visuel de haut en bas. Le shell
    // rend le focus au PREMIER bouton actif de l'overlay après chaque écran de
    // passage (`Shell.focusPlayable`, qui lit l'ordre du DOM) : les suspects
    // posés en premier, le tour d'enquête s'ouvrait donc sur un bouton
    // « accuser » — une Entrée de trop et la manche était jouée sur un coup que
    // personne n'avait voulu. Les questions d'abord, l'accusation ensuite :
    // c'est l'ordre dans lequel le tour se joue, et le geste destructeur n'est
    // plus jamais la cible par défaut. En phase de choix, les questions sont
    // `hidden` — le focus tombe donc naturellement sur le premier suspect.
    for (let i = 0; i < QUESTION_COUNT; i++) {
      const { x, y } = questionCenter(i);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.dataset.question = TRAITS[i].key;
      b.style.left = `${x - QBTN_W / 2}px`;
      b.style.top = `${y - QBTN_H / 2}px`;
      b.style.width = `${QBTN_W}px`;
      b.style.height = `${QBTN_H}px`; // 78 px ≥ 60 px logiques (§1.1)
      b.addEventListener('click', () => this.onQuestion(TRAITS[i].key));
      ctx.overlay.appendChild(b);
      this.questionButtons.push(b);
    }

    for (const suspect of this.model.suspects) {
      const { x, y } = suspectCenter(suspect.id);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.dataset.suspect = `${suspect.id}`;
      const size = PORTRAIT_SIZE + 12; // ≥ 60 px logiques (§1.1), confortable au doigt
      b.style.left = `${x - size / 2}px`;
      b.style.top = `${y - size / 2}px`;
      b.style.width = `${size}px`;
      b.style.height = `${size}px`;
      b.addEventListener('click', () => this.onSuspect(suspect.id));
      ctx.overlay.appendChild(b);
      this.suspectButtons.push(b);
    }

    this.anchor = document.createElement('div');
    this.anchor.tabIndex = -1;
    this.anchor.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
    ctx.overlay.appendChild(this.anchor);

    this.refresh();
  }

  private get locked(): boolean {
    return this.paused || this.revealUntil !== null || this.model.state.over;
  }

  /** Synchrone à chaque changement d'état (§5) : on ne donne jamais le focus
   *  à un bouton encore `disabled`, et attendre la frame de rendu le raterait. */
  private refresh(): void {
    const s = this.model.state;
    const locked = this.locked;

    for (const suspect of s.suspects) {
      const b = this.suspectButtons[suspect.id];
      // Le libellé DÉCRIT toujours les traits, quels que soient la phase et la
      // légalité : six boutons nommés « suspect » (ou six fois « choisir ce
      // suspect ») rendaient le jeu injouable au lecteur d'écran — on ne peut
      // pas choisir un coupable, ni décider qui accuser, si les six cibles
      // portent le même nom. Seul le VERBE change avec la phase.
      const legal =
        !locked &&
        (s.phase === 'pick'
          ? this.model.canPick(s.picker, suspect.id)
          : this.model.canAccuse(s.guesser, suspect.id));
      b.disabled = !legal;
      b.setAttribute('aria-label', this.suspectLabel(suspect.id, s));
    }

    for (let i = 0; i < QUESTION_COUNT; i++) {
      const trait = TRAITS[i];
      const b = this.questionButtons[i];
      b.hidden = s.phase !== 'guess';
      if (b.hidden) continue;
      const asked = s.asked.find((a) => a.trait === trait.key);
      const legal = !locked && this.model.canAsk(s.guesser, trait.key);
      b.disabled = !legal;
      b.setAttribute(
        'aria-label',
        asked ? `${trait.question} réponse : ${asked.answer ? 'oui' : 'non'}` : trait.question,
      );
    }

    this.updateBoard(s);
  }

  /** Décrit un suspect par ses traits VISIBLES (publics, jamais le secret de
   *  qui est le coupable) — utile au clavier/lecteur d'écran pour choisir qui
   *  accuser sans dépendre de la seule position à l'écran. */
  private suspectDescription(id: number): string {
    const suspect = this.model.suspects[id];
    const parts = [
      suspect.hat ? 'chapeau' : 'sans chapeau',
      suspect.glasses ? 'lunettes' : 'sans lunettes',
      suspect.scarf ? 'écharpe' : 'sans écharpe',
      suspect.redPull ? 'pull rouge' : 'pull bleu',
    ];
    return parts.join(', ');
  }

  /** Nom accessible d'un bouton de suspect : le VERBE de la phase courante,
   *  puis les quatre traits, puis l'aide ⭐ si elle a écarté ce suspect. */
  private suspectLabel(id: number, s: SuspectsState): string {
    const verb = s.phase === 'pick' ? 'choisir comme coupable' : 'accuser';
    const hint = s.phase === 'guess' && s.showHint && s.eliminated[id] ? ', déjà écarté par les réponses' : '';
    return `${verb} : ${this.suspectDescription(id)}${hint}`;
  }

  /** `#sr-board` (via le shell — `ctx` n'expose pas ce résumé, cf. digest
   *  §8.2). RÈGLE DE SECRET reprise de la vue : jamais un mot sur QUI est le
   *  coupable pendant `'guess'` — seul le nombre de questions posées compte. */
  private updateBoard(s: SuspectsState): void {
    // Rejoué en vignette de menu, le modèle n'est PAS le plateau que le joueur
    // a sous les yeux : écrire le résumé écraserait celui de l'écran courant.
    if (this.demoMode) return;
    const g = (window as unknown as { __game?: { game?: { setBoardText?: (t: string) => void } } }).__game?.game;
    if (!g?.setBoardText) return;
    // La CAUSE d'abord : tant que la dernière manche est à l'écran (fenêtre de
    // révélation, ou partie finie pendant le délai du shell), c'est ELLE que
    // décrit le résumé — un « manche terminée » sec n'expliquerait rien au
    // lecteur d'écran, qui ne voit pas l'étoile posée sur le coupable.
    const r = s.lastRound;
    if (r && (this.revealUntil !== null || s.over)) {
      const who = `Le coupable était le suspect ${this.suspectDescription(r.culprit)}.`;
      const point = r.correct
        ? `Trouvé ! Point pour le siège ${r.guesser + 1}.`
        : r.decisive
          ? `Raté. Coupable resté caché : point pour le siège ${r.picker + 1}.`
          : 'Raté, personne ne marque.';
      const tail = s.over ? ` Partie terminée, ${this.model.result.reason}.` : '';
      g.setBoardText(`${point} ${who} Score ${s.scores[0]} à ${s.scores[1]}.${tail}`);
      return;
    }
    if (s.over) {
      g.setBoardText(`Partie terminée : ${this.model.result.reason}.`);
      return;
    }
    const decisive = s.decisive ? ' Manche de départage : si le coupable n’est pas trouvé, le point va à celui qui l’a caché.' : '';
    const head = `Manche ${s.round + 1} sur ${s.totalRounds}. Score ${s.scores[0]} à ${s.scores[1]}.${decisive}`;
    const text =
      s.phase === 'pick'
        ? `${head} Siège ${s.picker + 1} choisit un coupable en secret.`
        : `${head} Siège ${s.guesser + 1} enquête : ${s.asked.length} question(s) posée(s) sur 3, peut accuser à tout moment.`;
    g.setBoardText(text);
  }

  /** Reflet du pattern `restoreFocus` du brief accessibilité : ne rendre le
   *  focus que s'il était à NOUS (jamais le voler à quelqu'un qui joue au
   *  doigt), et seulement s'il vient de mourir (`disabled`/retiré). Sinon on
   *  retombe sur la première cible encore légale, ou sur l'ancre si aucune —
   *  jamais sur `<body>`. */
  private restoreFocus(prev: HTMLElement | null, wasOurs: boolean): void {
    if (!wasOurs || !prev) return;
    const dead = (prev as HTMLButtonElement).disabled || prev.hidden || !prev.isConnected;
    if (!dead) return;
    (this.firstLegal() ?? this.anchor).focus();
  }

  /**
   * La « première cible légale » (§5) DÉPEND de ce qu'on vient de faire. Après
   * une question, l'ordre du DOM (les 6 suspects d'abord, en haut de l'écran)
   * poussait le focus sur un bouton d'ACCUSATION : une Entrée de trop et la
   * manche était perdue sur un coup qu'on n'avait pas voulu jouer. Tant qu'il
   * reste des questions à poser, la cible naturelle est donc une question ; on
   * ne retombe sur les suspects que quand il n'y a plus rien à demander.
   */
  private firstLegal(): HTMLButtonElement | null {
    const s = this.model.state;
    const alive = (b: HTMLButtonElement): boolean => !b.hidden && !b.disabled;
    if (s.phase === 'guess') {
      const q = this.questionButtons.find(alive);
      if (q) return q;
    }
    return this.suspectButtons.find(alive) ?? this.questionButtons.find(alive) ?? null;
  }

  private onSuspect(id: number): void {
    if (this.locked) return;
    const s = this.model.state;
    const prev = document.activeElement as HTMLElement | null;
    const wasOurs = !!prev && this.ctx.overlay.contains(prev);
    if (s.phase === 'pick') {
      if (!this.model.pick(s.picker, id)) return;
      sfx.tap();
      // Rien n'est annoncé publiquement ici (secret) — seul le siège qui vient
      // d'agir sait ce qu'il a fait ; `#sr-log` resterait lisible par l'autre.
      this.refresh();
      // Le coupable vient d'être choisi EN SECRET : c'est maintenant à B de
      // jouer, et il ne doit rien avoir vu du choix de A — passage OBLIGATOIRE.
      // Le shell prend le focus en charge de bout en bout pendant l'écran de
      // passage (un seul élément focalisable garanti), donc aucun appel à
      // `restoreFocus` ici : il n'y aurait rien de valide à lui proposer.
      this.ctx.onTurn(this.model.state.guesser);
    } else {
      if (!this.model.accuse(s.guesser, id)) return;
      const log = this.model.state.lastRound;
      if (log) {
        sfx.thunk();
        // Le n° de manche est DANS la phrase : `#sr-log` n'écrit que sur
        // changement réel (règle du dépôt), et deux « trouvé ! » consécutifs
        // seraient donc muets au second — or c'est l'événement le plus
        // important du jeu.
        const point = log.correct
          ? `point pour le siège ${log.guesser + 1}`
          : log.decisive
            ? `coupable resté caché, point pour le siège ${log.picker + 1}`
            : 'personne ne marque';
        this.ctx.onAnnounce(
          `manche ${log.round + 1} : ${log.correct ? 'trouvé !' : 'raté, ce n’était pas lui'}, ${point}`,
        );
      }
      this.revealUntil = this.time + REVEAL_SEC;
      this.refresh();
      // Fenêtre de révélation : TOUT est verrouillé (voir `locked`), donc le
      // bouton qu'on vient de taper meurt sous le doigt — l'ancre évite un
      // focus perdu sur `<body>` pendant que la cause s'affiche à l'écran.
      this.restoreFocus(prev, wasOurs);
    }
  }

  private onQuestion(trait: TraitKey): void {
    if (this.locked) return;
    const s = this.model.state;
    if (!this.model.ask(s.guesser, trait)) return;
    sfx.pick();
    const after = this.model.state.asked;
    const asked = after[after.length - 1];
    // Idem : la réponse est l'information centrale du jeu et `#sr-log` ne
    // réécrit que sur changement réel — le rang de la question et le n° de
    // manche rendent chaque phrase unique, donc toujours annoncée.
    this.ctx.onAnnounce(
      `manche ${s.round + 1}, question ${after.length} sur ${SUSPECTS_QUESTIONS} : ` +
        `${TRAITS.find((t) => t.key === trait)?.question} ${asked.answer ? 'oui' : 'non'}`,
    );
    const prev = document.activeElement as HTMLElement | null;
    const wasOurs = !!prev && this.ctx.overlay.contains(prev);
    this.refresh();
    // Le bouton de question qu'on vient d'utiliser passe `disabled` (on ne
    // repose jamais la même question) : sans ce recours, le focus retomberait
    // sur `<body>` — les 6 suspects restent toujours une cible légale de
    // repli en phase d'enquête.
    this.restoreFocus(prev, wasOurs);
  }

  update(dt: number): void {
    if (this.paused) return;
    this.time += dt;

    // Mécanisme ② de l'en-tête : le tout premier passage doit être différé
    // jusqu'ici (jamais dans le constructeur — voir pourquoi en tête de fichier).
    if (!this.introFired) {
      this.introFired = true;
      if (!this.demoMode) this.ctx.onTurn(this.model.state.picker);
      return;
    }

    // Mécanisme ① de l'en-tête : la fenêtre de révélation s'écoule ici, et
    // c'est SEULEMENT à son terme qu'on prévient le shell (passage ou fin).
    if (this.revealUntil !== null && this.time >= this.revealUntil) {
      this.revealUntil = null;
      const s = this.model.state;
      this.refresh();
      if (s.over) {
        this.ctx.onOver(this.model.result);
      } else {
        this.ctx.onTurn(s.picker);
      }
    }
  }

  render(): void {
    this.view.render(this.time, this.revealUntil !== null || this.demoRevealing);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.refresh();
  }

  /**
   * §2.4 — la démo rejoue le MODÈLE RÉEL : elle choisit TOUJOURS le suspect 0
   * comme coupable puis l'accuse en dernier — une petite histoire qui se
   * termine TOUJOURS juste (choisir un suspect en secret, poser des
   * questions, accuser LE MÊME suspect, gagner), quel que soit le tirage des
   * 6 profils. Écrire une réponse figée aux questions serait fragile (elle
   * dépend des vrais traits du suspect 0, qui varient avec le seed) — les
   * moves `ask` ne font qu'ENREGISTRER la vraie réponse du modèle, jamais en
   * inventer une.
   *
   * DÉLIBÉRÉMENT SANS `revealUntil` ici (à la différence de `onSuspect`) :
   * `core/demo.ts` avance ses coups à cadence FIXE (`DEMO_STEP_SEC`,
   * indépendante de notre horloge de vue) — mélanger les deux minuteurs
   * ferait démarrer la manche suivante EN PLEIN milieu de notre fenêtre de
   * révélation, et le minuteur appellerait `ctx.onTurn`/`ctx.onOver` depuis
   * une vignette de menu. La révélation de la démo n'est donc pas un
   * minuteur mais un ÉTAT : posée par l'accusation, effacée par le coup
   * suivant. Sans elle, la démo montrait le geste (taper, questionner,
   * accuser) mais JAMAIS sa récompense — la boucle de 3 secondes se terminait
   * sur un plateau muet, ce qui est exactement ce que le §1.1 critère 1
   * demande d'enseigner.
   */
  applyDemo(move: DemoMove): void {
    this.demoMode = true;
    this.demoRevealing = false;
    const s = this.model.state;
    if (s.over) return;
    const arg0 = move.args?.[0] ?? 0;
    if (move.move === 'pick' && s.phase === 'pick') {
      this.model.pick(s.picker, arg0);
    } else if (move.move === 'ask' && s.phase === 'guess') {
      const trait = TRAITS[arg0]?.key;
      if (trait) this.model.ask(s.guesser, trait);
    } else if (move.move === 'accuse' && s.phase === 'guess') {
      this.demoRevealing = this.model.accuse(s.guesser, arg0);
    }
    this.refresh();
  }

  destroy(): void {
    for (const b of this.suspectButtons) b.remove();
    for (const b of this.questionButtons) b.remove();
    this.anchor.remove();
    this.suspectButtons.length = 0;
    this.questionButtons.length = 0;
    this.view.destroy();
  }
}

/** Coups canoniques rejoués en boucle par `core/demo.ts` (§2.4) : choisir le
 *  suspect 0 (secret), poser les 3 questions dans l'ordre, puis l'accuser —
 *  la boucle complète du geste, sans un mot, toujours gagnante. */
const DEMO: Demo = [
  { move: 'pick', args: [0] },
  { move: 'ask', args: [0] },
  { move: 'ask', args: [1] },
  { move: 'ask', args: [2] },
  { move: 'accuse', args: [0] },
];

export const def: MiniGameDef = {
  id: 'suspects',
  title: 'Six suspects',
  emoji: '🕵️',
  posture: 'pass',
  mode: 'asym',
  logical: { w: PASS_W, h: PASS_H },
  demo: DEMO,
  create: (ctx) => new SuspectsGame(ctx),
};

/** Modèle PUR exposé au bot via `window.__game.models` (§7). */
export { SuspectsModel as Model };
