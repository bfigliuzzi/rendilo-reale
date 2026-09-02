import type { Container } from 'pixi.js';

/**
 * LE contrat des huit micro-jeux (§2.3 de la spec). Un seul, sinon le shell
 * devient un `switch` géant et chaque nouveau jeu rouvre le menu, la pause,
 * l'écran de passage et le letterbox.
 *
 * Découpage imposé par jeu, à ne pas casser — c'est lui qui rend le bot capable
 * de rejouer une manche entière HORS de la page (comme `combat.ts` de Trois
 * Portes) :
 *   `model.ts` est PUR : ni horloge, ni `Math.random`, ni DOM, ni Pixi, ni
 *   import de `view.ts`. `view.ts` ne mute JAMAIS le modèle. `index.ts` câble
 *   les deux et expose le `MiniGameDef`.
 */

/**
 * ═══════════ CONVENTION ⭐ DE LA COLLECTION — NE PAS LA RE-INVERSER ═══════════
 * `stars[siège]` vaut 1 ou 2, et la POLARITÉ n'est pas devinable : c'est
 * `stars === 1` qui désigne le joueur AIDÉ.
 *
 * Elle est fixée par le libellé de l'accueil (`ui/screens.ts`) : ⭐ se lit
 * « un coup de plus » (le petit, qu'on aide) et ⭐⭐ « sans coup de plus » (le
 * grand, à qui l'on ne donne rien). Le réglage décrit donc le NIVEAU du joueur
 * à l'envers de l'intuition « plus d'étoiles = plus fort » — d'où cette note.
 *
 * Le patron canonique, à recopier tel quel dans un neuvième jeu :
 *     helped = stars[0] !== stars[1] ? (stars[0] === 1 ? 0 : 1) : null;
 * (`null` = les deux au même niveau, donc AUCUN handicap : un handicap donné
 * aux deux n'en est plus un.)
 *
 * Deux jeux sur huit avaient lu `stars === 2` comme l'aidé : l'aide partait au
 * mauvais enfant, ce qui est exactement la panne que décrit le §1.3 — « le
 * grand crie à la triche, le petit ne comprend pas sa victoire ». Corrigé, et
 * écrit ici parce que c'est le seul fichier que les huit jeux lisent tous.
 * ═════════════════════════════════════════════════════════════════════════════
 */

/** §1.4 — deux ergonomies, jamais mélangées. */
export type Posture = 'pass' | 'side';
export type Mode = 'coop' | 'duel' | 'asym';

export interface MiniGameDef {
  id: string;
  /** Libellé DOM (accessibilité) — jamais requis pour jouer (§1.2). */
  title: string;
  emoji: string;
  posture: Posture;
  mode: Mode;
  /** 540×960 (pass) ou 960×540 (side). Le letterbox le prend en paramètre. */
  logical: { w: number; h: number };
  create(ctx: MiniGameCtx): MiniGame;
  /** Coups canoniques rejoués par `core/demo.ts` — voir `Demo` plus bas. */
  demo: Demo;
}

export interface MiniGameCtx {
  /** Racine Pixi du micro-jeu (vidée par le shell à la sortie). */
  stage: Container;
  /** Conteneur DOM des boutons transparents (même letterbox que le canvas). */
  overlay: HTMLElement;
  /** Tiré par le shell, rejouable : zéro `Math.random` dans le contenu. */
  seed: number;
  /** Niveau ⭐ de chaque joueur, dans l'ordre des sièges. */
  stars: [1 | 2, 1 | 2];
  /** Demande au shell l'écran de passage (posture 'pass'). */
  onTurn(player: 0 | 1): void;
  /** Ligne de région live (#sr-log). */
  onAnnounce(text: string): void;
  /**
   * Le PLATEAU EN TEXTE (#sr-board) — ce qui rend une manche jouable sans voir
   * l'écran (§5). Comme `onAnnounce`, le shell n'écrit que sur changement
   * RÉEL : appeler à chaque frame ne fera pas répéter la phrase au lecteur
   * d'écran.
   *
   * Avant cette entrée, les jeux au tour par tour atteignaient le shell par
   * `window.__game.game.setBoardText` en accès défensif — une dépendance
   * implicite d'un micro-jeu vers le shell, que le §2.3 lui interdit
   * justement. Un jeu TEMPS RÉEL peut légitimement ne jamais l'appeler : une
   * bille qui roule ne se décrit pas en une phrase par frame.
   */
  onBoard(text: string): void;
  /** Fin de manche. */
  onOver(result: Result): void;
  /**
   * AJOUT au contrat de la spec (la seule addition à `MiniGameCtx`, assumée) :
   * `prefers-reduced-motion` lu UNE fois au boot, en OU avec l'option joueur.
   * Sans lui, chaque micro-jeu devrait aller lire la préférence lui-même —
   * donc toucher au save, ce que le §2.3 lui interdit. Particules coupées,
   * secousses à 0, cadences ralenties ; l'INFORMATION n'est jamais amputée.
   */
  reducedMotion: boolean;
  /**
   * Hauteur, EN PIXELS LOGIQUES du repère courant, que le bandeau de table du
   * shell recouvre encore en haut du plateau. C'est un CALCUL, pas une
   * constante : le bandeau vit en espace écran (68 px CSS au plus) tandis que
   * le plateau est letterboxé, donc la conversion dépend du scale — mesurée
   * entre 0 et 114 px logiques selon la fenêtre et la posture.
   *
   * Depuis que `Shell` RÉSERVE la bande du bandeau hors du letterbox, elle vaut
   * 0 dans tous les cas mesurés ; elle reste exposée (et calculée) pour qu'un
   * micro-jeu qui tient à border son bord haut le fasse sur la valeur RÉELLE
   * plutôt que sur une constante empirique — cinq jeux en avaient chacun
   * inventé une, toutes différentes et toutes fausses dans au moins un format.
   */
  safeTop(): number;
}

export interface Result {
  /** `null` = coop (ou égalité impossible : voir §3). */
  winner: 0 | 1 | null;
  scores: [number, number];
  /** Phrase courte affichée ET annoncée : « 7 pommes contre 5 » (§1.1 critère 4). */
  reason: string;
}

export interface MiniGame {
  /** 60 Hz fixe ; no-op pour les jeux au tour par tour. */
  update(dt: number): void;
  /** Interpolation prev/cur pour tout ce qui bouge. */
  render(alpha: number): void;
  setPaused(p: boolean): void;
  destroy(): void;
  /**
   * Applique UN coup de démonstration au MODÈLE RÉEL (§2.4). Optionnel tant
   * qu'un jeu n'a pas encore sa liste de coups : `core/demo.ts` saute alors le
   * jeu au lieu d'inventer une animation.
   */
  applyDemo?(move: DemoMove): void;
}

/**
 * §2.4 — la démonstration EST un rejeu du modèle réel. Un coup de démo est un
 * VERBE du jeu (`'cut'`, `'place'`, `'tilt'`…) plus jusqu'à trois nombres :
 * assez pour décrire une pose, un tap de case ou une inclinaison, et assez
 * pauvre pour qu'on ne puisse pas y glisser une animation parallèle.
 *
 * INTERDIT d'écrire une animation de démonstration séparée : elle divergerait
 * de la règle au premier ajustement, et c'est justement le tutoriel qui doit
 * rester vrai. Un jeu au tour par tour laisse `hold` vide (un coup par pas de
 * démo) ; un jeu temps réel s'en sert pour tenir une entrée quelques dixièmes
 * de seconde.
 */
export interface DemoMove {
  /** Verbe propre au jeu, interprété par son `applyDemo`. */
  readonly move: string;
  /** Arguments numériques du verbe (case, indice, axe, valeur…). */
  readonly args?: readonly number[];
  /** Temps réel : durée pendant laquelle l'entrée reste tenue (s). */
  readonly hold?: number;
}

export type Demo = readonly DemoMove[];
