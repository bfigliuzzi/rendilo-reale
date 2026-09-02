import { Container, Graphics, type Application } from 'pixi.js';
import { DEMO_LOOP_PAUSE_SEC, DEMO_REDUCED_MUL, DEMO_STEP_SEC } from '../config/balance';
import { PALETTE } from '../render/textures';
import type { Demo, DemoMove, MiniGame, MiniGameCtx, MiniGameDef } from './minigame';

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  LE CONTRAT DU REJOUEUR DE DÉMONSTRATION (§2.4)                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Les huit micro-jeux ont écrit leur `def.demo` et leur `applyDemo()` AVANT que
 * ce fichier n'existe : chacun a donc dû DEVINER ce que le rejoueur ferait d'un
 * verbe inconnu, d'un `hold` absent, d'une liste qui se termine sur
 * `state.over`. Les huit règles ci-dessous sont là pour que plus personne n'ait
 * à deviner. Elles sont MESURÉES par le bot (§7), pas seulement affirmées.
 *
 * ① LE REJOUEUR RECRÉE LE MICRO-JEU À CHAQUE TOUR DE BOUCLE, avec le MÊME
 *    seed. C'est la seule façon de boucler à l'infini : `tiles` et `suspects`
 *    sortent de `applyDemo` dès `state.over`, et aucun modèle n'expose de
 *    `restart()` commun. Corollaire, et c'est LA propriété qui fait qu'une
 *    vignette enseigne toujours la même chose : DEUX BOUCLES CONSÉCUTIVES SONT
 *    IDENTIQUES, à la frame près (même seed, même liste, même cadence, pas fixe
 *    de 60 Hz). Le verbe `reset` que `plank` a placé en tête de sa liste devient
 *    donc redondant — il reste exact (il remet une manche déjà neuve à neuf) et
 *    on ne le retire pas : un jeu ne doit pas avoir à connaître le rejoueur.
 *
 * ② UN VERBE INCONNU EST TRANSMIS TEL QUEL. Le rejoueur ne connaît AUCUN verbe
 *    et n'en juge aucun : il passe le `DemoMove` à `applyDemo`, à charge du
 *    micro-jeu de l'ignorer (les huit le font déjà, par un `default:` ou un test
 *    d'égalité). Un rejoueur qui filtrerait les verbes serait un second endroit
 *    où la règle vit — exactement ce que le §2.4 interdit.
 *
 * ③ `hold` ABSENT ⇒ `DEMO_STEP_SEC` ; `hold` PRÉSENT ⇒ EXACTEMENT cette durée,
 *    zéro compris. La distinction absent/zéro est significative : `plank` écrit
 *    `{ move: 'reset', hold: 0 }` pour enchaîner dans la même frame, alors qu'un
 *    jeu au tour par tour n'écrit rien et obtient la cadence lente. Un `hold`
 *    négatif ou non fini est ramené à 0.
 *
 * ④ `update(dt)` N'EST JAMAIS APPELÉ AVANT LE PREMIER `applyDemo`. Le premier
 *    coup part à la frame de montage, avant qu'une seule seconde de modèle ne
 *    s'écoule. C'est la garde que `suspects` attendait : son drapeau `demoMode`
 *    n'est posé qu'au premier `applyDemo`, donc un tick antérieur aurait armé
 *    son minuteur d'écran de passage — une vignette de menu aurait demandé au
 *    joueur de se passer le téléphone.
 *
 * ⑤ LES RAPPELS DU CONTEXTE SONT INERTES. `onTurn`, `onOver`, `onAnnounce` et
 *    `onBoard` ne font rien : une vignette ne doit ni ouvrir l'écran de passage,
 *    ni terminer une manche, ni bavarder par-dessus le menu dans les régions
 *    live. `stars` vaut `[2, 2]` — les DEUX au même niveau, donc AUCUN handicap
 *    (cf. la convention ⭐ de `minigame.ts`) : la démo enseigne LA RÈGLE, pas le
 *    réglage de la table. `seed` est FIXE par jeu (`DEMO_SEEDS`).
 *
 * ⑥ L'OVERLAY EST DÉTACHÉ DU DOCUMENT. Les boutons que le micro-jeu y pose
 *    existent (il en a besoin pour vivre) mais ne sont ni focusables ni
 *    tappables : huit vignettes animées n'ajoutent pas huit jeux de boutons à
 *    l'ordre de tabulation du menu.
 *
 * ⑦ LES ÉCOUTEURS GLOBAUX DU MICRO-JEU SONT NEUTRALISÉS pendant `create()`.
 *    Trois jeux (`plank`, `ant`, `mirror`) écoutent `window` pour leur clavier,
 *    et `plank` fait `preventDefault()` sur les flèches SANS garde de focus :
 *    une vignette de `plank` au menu volerait donc les flèches à un joueur au
 *    clavier qui fait défiler la grille. Une démonstration est un REJEU, pas une
 *    session interactive — elle n'a aucune raison d'entendre un clavier.
 *    MESURÉ en désarmant la règle : au menu, ↑ ↓ → ← et Z Q S D repartaient
 *    tous avec `defaultPrevented === true` ; avec elle, aucun.
 *
 * ⑧ SANS `applyDemo` OU AVEC UNE LISTE VIDE, LE REJOUEUR N'INVENTE RIEN : il
 *    monte le jeu (son plateau initial enseigne déjà quelque chose) et le laisse
 *    tourner, mais ne boucle pas. Il n'écrit JAMAIS d'animation parallèle.
 *
 * MOUVEMENT RÉDUIT (§5) : c'est la cadence de LECTURE qui ralentit (×
 * `DEMO_REDUCED_MUL`), donc les `hold` ABSENTS et la pause entre deux boucles.
 * Un `hold` EXPLICITE est une durée de MODÈLE (« tiens à droite 0,5 s ») : le
 * ralentir ferait courir le coyote de `mirror` au-delà de sa porte et la démo
 * cesserait d'être vraie. La démo ralentit, elle ne s'arrête jamais, et aucun
 * flash n'est introduit — tout ce qui clignote appartient au micro-jeu.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BANDE MESURÉE (conteneur, rendu logiciel, `vite preview`) — durée d'un tour
 * de boucle en PAS de simulation (60 Hz), pause inter-boucles comprise, et
 * elle ne varie JAMAIS d'un tour à l'autre (c'est l'assertion exacte de la
 * règle ①, préférable à une comparaison de pixels qui, elle, est statistique) :
 *     plank 174 · mirror 179 · tree 234 · tiles 288 · ant 331 ·
 *     suspects 342 · cake 396 · beast 450
 * soit 2,9 s pour la plus courte et 7,5 s pour la plus longue. En mouvement
 * réduit : ×2 pile pour les cinq jeux au tour par tour (aucun `hold` explicite)
 * et + 72 pas pour les trois temps réel (seule la pause de lecture double).
 *
 * ÉCART ASSUMÉ AU « ~3 secondes » DU §1.1, et il est GÉOMÉTRIQUE : `ant` doit
 * traverser 784 px à 190 px/s, soit 4,13 s incompressibles, et `beast` doit
 * montrer les trois paliers du thermomètre 🔥 / 🌤 / ❄ plus une validation,
 * soit sept coups. On préfère une boucle plus longue à une boucle qui ampute
 * son enseignement : la fourmi doit ATTEINDRE la fleur (critère 3 du §1.1) et
 * le thermomètre doit montrer son éventail entier. Les cinq autres sont dans
 * la bande, et les deux plus courtes (`plank`, `mirror`) y sont pile.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Le seed de chaque démonstration. C'est le REJOUEUR qui le choisit, et pas le
 * micro-jeu : un `def.demo` décrit un GESTE, le seed décide du plateau sur
 * lequel ce geste se joue.
 *
 * `tree` est le seul dont le choix a demandé une mesure : 12 % des graphes (14 %
 * re-mesurés ici sur 6 000 tirages) ne laissent tomber AUCUNE brindille en plus
 * des trois coupées —
 * or la cascade EST la récompense du jeu, une vignette sans cascade enseigne
 * une règle amputée. Le seed retenu ci-dessous a été cherché en page, sur le
 * modèle réel, en maximisant les arêtes tombées par les trois coupes
 * canoniques. Les sept autres n'ont aucune contrainte de ce genre (leur démo
 * est stable quel que soit le tirage) : leurs seeds sont pris au hasard une
 * fois pour toutes et FIGÉS, parce qu'une vignette qui changerait de plateau à
 * chaque ouverture du menu ne serait plus un tutoriel mais un teaser.
 */
export const DEMO_SEEDS: Readonly<Record<string, number>> = {
  plank: 0x51a2b3,
  mirror: 0x7c1d09,
  cake: 0x2f6e41,
  // MESURÉ sur le modèle réel, 6 000 tirages : 14 % ne font tomber AUCUNE
  // brindille de plus que les trois coupées, et 3790 est le tirage le mieux
  // ÉTALÉ des 1 554 qui cascadent aux TROIS coups — 5 + 6 + 4 arêtes et
  // 6 + 7 + 6 pommes, donc chacun des trois coups de la vignette montre à la
  // fois la coupe, la chute et le gain. Un tirage à cascade unique (17 arêtes
  // d'un coup) vidait l'arbre au premier coup et les deux suivants ne
  // racontaient plus rien.
  tree: 3790,
  tiles: 0x0b74d2,
  beast: 0x39c8a1,
  suspects: 0x64e0f7,
  ant: 0x18a3c5,
};

/** Seed par défaut d'un jeu absent de la table — jamais aléatoire. */
const FALLBACK_SEED = 0x5eed01;

function seedOf(id: string): number {
  return DEMO_SEEDS[id] ?? FALLBACK_SEED;
}

// ───────────────────────── Montage silencieux ─────────────────────────

/**
 * Règle ⑦ : on monte le micro-jeu en rendant `window.addEventListener` inerte
 * le temps de sa construction. C'est un remplacement SYNCHRONE et strictement
 * borné (aucun `await` dans un `create`), restauré dans un `finally`.
 *
 * L'alternative — laisser les huit instances écouter le clavier de la page —
 * a été mesurée : les flèches du menu partaient dans la vignette de `plank`,
 * qui les avalait par `preventDefault()`. L'autre alternative — demander aux
 * micro-jeux une garde de plus — aurait fait remonter le rejoueur dans leur
 * code, à rebours du §2.3.
 *
 * Le `destroy()` du micro-jeu appellera `removeEventListener` pour de vrai :
 * retirer un écouteur jamais posé est un no-op, rien à défaire.
 */
function createSilenced(def: MiniGameDef, ctx: MiniGameCtx): MiniGame {
  const target = window as unknown as Record<string, unknown>;
  const realAdd = target.addEventListener;
  const realRemove = target.removeEventListener;
  const inert = (): void => {};
  target.addEventListener = inert;
  target.removeEventListener = inert;
  try {
    return def.create(ctx);
  } finally {
    target.addEventListener = realAdd;
    target.removeEventListener = realRemove;
  }
}

// ───────────────────────── Le rejoueur ─────────────────────────

export interface DemoRunnerOptions {
  /** Conteneur Pixi où monter le micro-jeu (déjà mis à l'échelle par l'appelant). */
  stage: Container;
  /** Mouvement réduit : ralentit la cadence de LECTURE, jamais la physique. */
  reducedMotion: boolean;
  /** Recouvrement du bandeau — 0 pour une vignette, la vraie valeur en plein cadre. */
  safeTop: () => number;
}

/**
 * UNE démonstration en boucle : un micro-jeu monté en sourdine, ses coups
 * canoniques rejoués à travers le MODÈLE RÉEL, recréé à chaque tour.
 *
 * ZÉRO ALLOCATION PAR FRAME : le contexte, l'overlay détaché et les compteurs
 * vivent aussi longtemps que le rejoueur ; seul le tour de boucle alloue (une
 * fois toutes les quatre à sept secondes selon la liste).
 */
export class DemoRunner {
  /** Numéro du tour de boucle, à partir de 0 — lu par le bot (§7). */
  loop = 0;
  /**
   * Pas de simulation écoulés DEPUIS LE DÉBUT DE LA BOUCLE COURANTE. La boucle
   * de la page est à pas fixe (`@shared/loop`, 1/60 s), donc l'état du modèle
   * au tick N de la boucle k est EXACTEMENT celui du tick N de la boucle k+1 :
   * c'est ce compteur que le bot compare pour prouver la règle ①.
   */
  tick = 0;
  /**
   * Nombre de pas qu'a duré la boucle PRÉCÉDENTE (0 tant qu'aucune n'est
   * bouclée). Le bot (§7) vérifie qu'il ne change jamais d'un tour à l'autre :
   * c'est la preuve EXACTE — et non statistique — de la règle ①. Deux boucles
   * qui durent le même nombre de pas, sur un modèle sans horloge ni
   * `Math.random` et rejoué au même seed, sont la même boucle.
   */
  lastLoopTicks = 0;

  private game: MiniGame | null = null;
  private readonly moves: Demo;
  private readonly overlay = document.createElement('div');
  private readonly ctx: MiniGameCtx;
  /** Index du prochain coup à jouer. */
  private step = 0;
  /** Temps restant avant le prochain coup, en secondes. */
  private wait = 0;
  /** Vrai pendant la pause qui suit le dernier coup (on laisse voir la fin). */
  private tail = false;
  private readonly mul: number;

  constructor(
    private readonly def: MiniGameDef,
    opts: DemoRunnerOptions,
  ) {
    // Règle ⑧ : pas de liste ⇒ pas de boucle. On monte quand même.
    this.moves = def.demo;
    this.mul = opts.reducedMotion ? DEMO_REDUCED_MUL : 1;
    // Règles ⑤ et ⑥ : rappels inertes, overlay HORS du document.
    this.ctx = {
      stage: opts.stage,
      overlay: this.overlay,
      seed: seedOf(def.id),
      stars: [2, 2],
      onTurn: () => {},
      onAnnounce: () => {},
      onBoard: () => {},
      onOver: () => {},
      reducedMotion: opts.reducedMotion,
      safeTop: opts.safeTop,
    };
    this.mount();
  }

  /** Règle ④ : le premier coup PART AVANT le premier tick. */
  private mount(): void {
    this.game = createSilenced(this.def, this.ctx);
    this.step = 0;
    this.tick = 0;
    this.tail = false;
    this.wait = 0;
    this.advance();
  }

  private unmount(): void {
    this.game?.destroy();
    this.game = null;
    // Le micro-jeu détruit SON root ; on remet le conteneur à neuf au cas où un
    // futur jeu y laisserait quelque chose (même discipline que `stopGame`).
    this.ctx.stage.removeChildren();
    this.overlay.replaceChildren();
  }

  /** Durée d'un coup — règle ③, et le ralenti ne touche PAS un `hold` explicite. */
  private holdOf(mv: DemoMove): number {
    if (mv.hold === undefined) return DEMO_STEP_SEC * this.mul;
    return Number.isFinite(mv.hold) && mv.hold > 0 ? mv.hold : 0;
  }

  /** Applique tous les coups dont l'heure est venue (`hold: 0` enchaîne). */
  private advance(): void {
    const g = this.game;
    if (!g) return;
    if (this.moves.length === 0 || !g.applyDemo) return; // règle ⑧
    // Garde anti-boucle-infinie : une liste entièrement à `hold: 0` ne doit pas
    // figer la frame. Au pire on joue la liste une fois, puis on attend.
    let guard = this.moves.length + 2;
    while (this.wait <= 0 && guard-- > 0) {
      if (this.step >= this.moves.length) {
        if (!this.tail) {
          this.tail = true;
          this.wait += DEMO_LOOP_PAUSE_SEC * this.mul;
          break;
        }
        this.restart();
        return;
      }
      const mv = this.moves[this.step];
      this.step++;
      // Règle ② : on transmet, on ne juge pas.
      g.applyDemo(mv);
      this.wait += this.holdOf(mv);
    }
  }

  /** Règle ① : un tour de boucle = une instance NEUVE, au même seed. */
  private restart(): void {
    this.lastLoopTicks = this.tick;
    this.unmount();
    this.loop++;
    this.mount();
  }

  update(dt: number): void {
    const g = this.game;
    if (!g) return;
    g.update(dt);
    // UNE PEINTURE PAR PAS, ET PAS PAR FRAME. Cinq des huit vues VERROUILLENT
    // l'instant de départ d'une animation dans leur `render` (le « pop » d'un
    // domino, l'atterrissage du coyote, la chute d'une brindille) : si ce
    // verrou tombe à la frame qui peint, il dépend de la cadence d'affichage,
    // et la même démonstration rejouée deux fois ne donne pas la même image au
    // même pas — mesuré. En peignant à chaque PAS, la vignette redevient une
    // fonction du seul numéro de pas. Et cela ne coûte rien : peindre huit
    // vignettes une fois par pas ou une fois par frame donnait le MÊME fps au
    // menu (mesuré), parce que la dépense est la rastérisation, pas la
    // reconstruction des scènes — cf. `PAINT_PER_FRAME`.
    g.render(1);
    this.tick++;
    this.wait -= dt;
    if (this.wait <= 0) this.advance();
  }

  /**
   * Rendu INTERPOLÉ — réservé à l'écran de démonstration plein cadre, qui est
   * grand et doit être fluide. Les vignettes du menu ne l'appellent pas : elles
   * se peignent à alpha = 1 depuis `update`, pour rester une fonction du seul
   * numéro de pas (voir le commentaire ci-dessus).
   */
  render(alpha: number): void {
    this.game?.render(alpha);
  }

  destroy(): void {
    this.unmount();
  }
}

// ───────────────────────── Les huit vignettes du menu ─────────────────────────

/**
 * Côté d'une vignette, en pixels LOGIQUES du repère courant — et c'est AUSSI sa
 * taille d'affichage en px CSS (`.thumb` dans `index.html`). Les deux sont
 * égales exprès : la recopie est alors 1 pour 1 en pixels device, donc le
 * `image-rendering: pixelated` de la charte dit la vérité au lieu de créneler
 * une réduction fractionnaire.
 *
 * Les huit tiennent dans un carré de 3 × 3 cellules (360 px), qui rentre dans
 * les DEUX postures (540×960 comme 960×540) : le rejeu du menu n'a donc jamais
 * besoin de toucher à la taille logique laissée par la manche précédente.
 */
const CELL = 120;
const COLS = 3;

/**
 * Nombre de vignettes REPEINTES par frame — le budget d'image du menu, et le
 * seul levier de performance qui ait vraiment compté.
 *
 * MESURÉ (conteneur, rendu logiciel) : l'accueil tourne à 44 fps ; avec les
 * huit vignettes peintes à chaque frame, le menu tombe à 14. La dépense n'est
 * ni le rejeu des huit modèles ni la recopie vers les `<canvas>` — les deux
 * mesurés à ~1 fps près en les coupant tour à tour — mais la RASTÉRISATION des
 * huit scènes : les rendre invisibles rend 36 fps d'un coup.
 *
 * On repeint donc `PAINT_PER_FRAME` vignettes par frame, en tourniquet. Le coût
 * par frame devient BORNÉ et indépendant du nombre de vignettes : une neuvième
 * ne coûterait rien de plus, elle rafraîchirait seulement un peu moins souvent.
 * Chaque vignette se rafraîchit à `fps × PAINT_PER_FRAME / vignettes visibles`,
 * soit ~8 Hz ici — largement assez pour une boucle de trois secondes qui
 * enseigne un geste, et le MODÈLE, lui, continue d'avancer à 60 Hz : c'est la
 * peinture qu'on espace, jamais le temps.
 */
const PAINT_PER_FRAME = 2;

/**
 * LES HUIT VIGNETTES ANIMÉES DU MENU (§4.1.2), et voici pourquoi cette
 * architecture-là tient à 60 fps :
 *
 * ① UN SEUL RENDU, PAS HUIT. Les huit micro-jeux sont montés dans huit
 *    conteneurs Pixi d'UNE MÊME scène — celle du shell —, disposés côte à côte
 *    en 3 × 3 sur une zone de 360 × 360 px logiques du canvas, à l'échelle
 *    `min(cell/w, cell/h)`. Le renderer du shell les peint donc TOUS dans la
 *    passe qu'il fait déjà pour le fond du menu : huit vignettes coûtent des
 *    draw calls, pas huit contextes WebGL ni huit boucles de rendu.
 * ② CETTE ZONE EST INVISIBLE : au menu, `#ui` est un panneau OPAQUE posé
 *    par-dessus le canvas. On s'en sert donc comme d'une planche de rendu, puis
 *    chaque cellule est recopiée par UN `drawImage` dans le petit `<canvas>` de
 *    sa vignette — une copie de surface à surface, sans extraction de pixels,
 *    sans `toDataURL`, sans allocation. C'est ce qui permet de garder la grille
 *    du menu en DOM (donc son ordre de tabulation, ses `aria-label` et son
 *    focus) tout en y affichant du Pixi.
 * ③ SEULE UNE VIGNETTE VISIBLE VIT. Un `IntersectionObserver` coupe à la fois
 *    le tick du modèle, le rendu de la cellule (`visible = false`) et la
 *    recopie : sur un téléphone étroit où la grille défile, la moitié des
 *    vignettes ne coûte rien du tout.
 * ④ LA PEINTURE EST EN TOURNIQUET, la simulation NON : `PAINT_PER_FRAME`
 *    vignettes repeintes et recopiées par frame, les huit modèles avancés à
 *    60 Hz. Voir `PAINT_PER_FRAME` pour les mesures qui ont désigné la
 *    rastérisation — et elle seule — comme la dépense.
 *
 * Ce qui a été écarté : huit `Application` Pixi (huit contextes WebGL, le
 * navigateur en plafonne le nombre) ; une extraction `renderer.extract` par
 * frame (elle alloue un canvas par appel) ; et une grille de menu dessinée en
 * Pixi avec des boutons transparents par-dessus (c'était la solution la plus
 * « maison », mais elle refaisait tout le focus, le halo et le défilement du
 * menu — beaucoup de risque pour zéro gain d'image).
 */
export class DemoBoard {
  private readonly root = new Container();
  /** Publics : le bot lit `loop` et `lastLoopTicks` de chaque rejoueur (§7). */
  readonly runners: DemoRunner[] = [];
  private readonly cells: Container[] = [];
  private readonly canvases: (HTMLCanvasElement | null)[] = [];
  private readonly contexts: (CanvasRenderingContext2D | null)[] = [];
  /**
   * Vignette réellement à l'écran — lu par le bot (§7) pour ne mesurer que ce
   * qui vit. `true` par défaut jusqu'au premier rapport de l'observateur, qui
   * arrive une frame plus tard : une vignette est donc peinte au moins une fois
   * avant d'être éventuellement mise en sommeil.
   */
  readonly shown: boolean[] = [];
  /** Tick de la boucle au moment de la DERNIÈRE recopie — lu par le bot (§7). */
  readonly blitTick: number[] = [];
  readonly blitLoop: number[] = [];
  private observer: IntersectionObserver | null = null;
  /** Tourniquet de peinture : index de la prochaine vignette à repeindre. */
  private cursor = 0;
  /** Les vignettes peintes dans la passe en cours, à recopier juste après. */
  private readonly painting: number[] = [];
  private live = false;

  constructor(
    private readonly app: Application,
    parent: Container,
    /** Relu à CHAQUE montage : la case de l'accueil peut changer entre deux
     *  passages au menu, et une vignette figée sur l'ancien réglage mentirait. */
    private readonly reducedMotion: () => boolean,
  ) {
    this.root.visible = false;
    parent.addChild(this.root);
  }

  get attached(): boolean {
    return this.live;
  }

  /**
   * Monte les huit rejoueurs et les raccorde aux `<canvas>` que le menu vient
   * de poser dans le DOM (`[data-thumb="<id>"]`). Appelée APRÈS le rendu du
   * panneau, jamais avant : les canvas n'existent pas encore.
   */
  attach(games: readonly MiniGameDef[], ui: HTMLElement): void {
    this.detach();
    this.observer = new IntersectionObserver(this.onIntersect, { threshold: 0 });
    const rm = this.reducedMotion();
    for (let i = 0; i < games.length; i++) {
      const def = games[i];
      const cell = new Container();
      cell.x = (i % COLS) * CELL;
      cell.y = Math.floor(i / COLS) * CELL;
      // Fond propre à la cellule : sans lui, le sol raccordable du shell passe
      // derrière la vignette et deux jeux voisins se mélangent au bord.
      const back = new Graphics().rect(0, 0, CELL, CELL).fill(PALETTE.bg);
      // Masque rectangulaire : un micro-jeu a le droit de peindre hors de son
      // repère logique (une particule, une ombre) et cela déborderait sur la
      // cellule d'à côté, qui est recopiée telle quelle.
      const mask = new Graphics().rect(0, 0, CELL, CELL).fill(0xffffff);
      const inner = new Container();
      const fit = Math.min(CELL / def.logical.w, CELL / def.logical.h);
      inner.scale.set(fit);
      inner.x = (CELL - def.logical.w * fit) / 2;
      inner.y = (CELL - def.logical.h * fit) / 2;
      cell.addChild(back, mask, inner);
      cell.mask = mask;
      this.root.addChild(cell);

      const canvas = ui.querySelector<HTMLCanvasElement>(`canvas[data-thumb="${def.id}"]`);
      const res = this.app.renderer.resolution;
      if (canvas) {
        canvas.width = Math.round(CELL * res);
        canvas.height = Math.round(CELL * res);
        this.observer.observe(canvas);
      }
      this.cells.push(cell);
      this.canvases.push(canvas);
      this.contexts.push(canvas ? canvas.getContext('2d', { alpha: false }) : null);
      this.shown.push(true);
      this.blitTick.push(-1);
      this.blitLoop.push(-1);
      this.runners.push(
        new DemoRunner(def, {
          stage: inner,
          reducedMotion: rm,
          // Une vignette n'est pas sous le bandeau de table : rien à réserver.
          safeTop: () => 0,
        }),
      );
    }
    this.root.visible = true;
    this.cursor = 0;
    this.live = true;
  }

  detach(): void {
    if (!this.live && this.runners.length === 0) return;
    this.observer?.disconnect();
    this.observer = null;
    for (const r of this.runners) r.destroy();
    for (const c of this.cells) c.destroy({ children: true });
    this.runners.length = 0;
    this.cells.length = 0;
    this.canvases.length = 0;
    this.contexts.length = 0;
    this.shown.length = 0;
    this.blitTick.length = 0;
    this.blitLoop.length = 0;
    this.root.removeChildren();
    this.root.visible = false;
    this.live = false;
    this.cursor = 0;
    this.painting.length = 0;
  }

  private readonly onIntersect = (entries: IntersectionObserverEntry[]): void => {
    for (const e of entries) {
      const i = this.canvases.indexOf(e.target as HTMLCanvasElement);
      if (i < 0) continue;
      this.shown[i] = e.isIntersecting;
      this.cells[i].visible = e.isIntersecting;
    }
  };

  update(dt: number): void {
    if (!this.live) return;
    for (let i = 0; i < this.runners.length; i++) {
      if (this.shown[i]) this.runners[i].update(dt);
    }
  }

  /**
   * Appelée AVANT `renderer.render` : elle CHOISIT les vignettes de la passe.
   *
   * C'est ici que vit le tourniquet — la seule optimisation qui ait compté (cf.
   * `PAINT_PER_FRAME`). Toutes les cellules sont rendues invisibles, on en
   * rallume `PAINT_PER_FRAME`, et le renderer ne rastérise que celles-là ;
   * `blit()` recopiera exactement les mêmes. Les modèles, eux, ont déjà avancé
   * à 60 Hz dans `update` : c'est la peinture qu'on espace, jamais le temps.
   *
   * Les vignettes sont peintes à ALPHA = 1 (dans `DemoRunner.update`), sur
   * l'ÉTAT DE SIMULATION lui-même et jamais sur une interpolation : sans cela
   * l'image dépend de l'instant où le navigateur peint, et deux boucles ne
   * montrent plus la même chose au même pas — mesuré, un tiers des
   * comparaisons pixel à pixel échouaient sur les trois jeux temps réel. À
   * 120 px de côté, l'interpolation ne rachète de toute façon rien de visible.
   * L'écran de démonstration plein cadre, lui, garde l'alpha réel : il est
   * grand, il doit être fluide, et personne ne le compare à lui-même.
   */
  render(): void {
    this.painting.length = 0;
    if (!this.live) return;
    const n = this.runners.length;
    for (let k = 0; k < n; k++) this.cells[k].visible = false;
    for (let k = 0; k < PAINT_PER_FRAME; k++) {
      // On avance dans le tourniquet jusqu'à trouver une vignette VISIBLE à
      // l'écran ; un tour complet sans en trouver aucune s'arrête (grille
      // entièrement défilée hors champ).
      let guard = n;
      while (guard-- > 0 && !this.shown[this.cursor]) this.cursor = (this.cursor + 1) % n;
      if (guard < 0 || !this.shown[this.cursor]) return;
      this.cells[this.cursor].visible = true;
      this.painting.push(this.cursor);
      this.cursor = (this.cursor + 1) % n;
    }
  }

  /**
   * Appelée APRÈS `renderer.render` : le tampon de dessin du canvas WebGL est
   * encore lisible dans la MÊME tâche (il n'est vidé qu'à la composition), donc
   * un `drawImage` direct suffit — pas de `preserveDrawingBuffer`, pas de
   * lecture de pixels côté CPU.
   */
  blit(): void {
    if (this.painting.length === 0) return;
    const src = this.app.canvas;
    const res = this.app.renderer.resolution;
    const side = CELL * res;
    for (const i of this.painting) {
      const ctx = this.contexts[i];
      if (!ctx) continue;
      const sx = (i % COLS) * side;
      const sy = Math.floor(i / COLS) * side;
      ctx.drawImage(src, sx, sy, side, side, 0, 0, side, side);
      this.blitTick[i] = this.runners[i].tick;
      this.blitLoop[i] = this.runners[i].loop;
    }
    this.painting.length = 0;
  }
}
