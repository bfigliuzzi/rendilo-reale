// §3.2 — `cake` : Je coupe, tu choisis (pass · duel · tour par tour).
//
// Un gâteau, une corde tirée à deux poignées, l'autre choisit sa part. Six
// coupes, les rôles alternent (3 chacune). MODÈLE PUR : ni horloge, ni
// `Math.random`, ni DOM, ni Pixi, ni import de `view.ts` — c'est ce qui permet
// au bot de rejouer une manche entière hors de la page.
//
// ─────────────────────────────────────────────────────────────────────────
// LE POINT DUR DE CE JEU (le « computeFeedback » de `cake`)
//
// Compter les fruits de chaque part pour une corde donnée doit se faire SANS
// qu'un fruit soit compté deux fois ni perdu, quelle que soit la corde. La
// corde est le segment [A, B] où A et B sont deux points du CERCLE du gâteau
// (rayon `CAKE_RADIUS`, centré sur l'origine locale du modèle — la vue ajoute
// le centre à l'écran, le modèle ne le connaît pas). Un fruit F appartient à
// la part 0 ou à la part 1 selon le SIGNE du produit vectoriel
// `(B − A) × (F − A)` :
//   > 0  → F est à GAUCHE de la droite orientée A→B (sens trigonométrique)
//   < 0  → F est à DROITE
//   = 0  → F est exactement SUR la droite (mesure nulle avec des flottants
//          indépendants, mais géré par défaut : assigné à la part 0, JAMAIS
//          ignoré et JAMAIS compté dans les deux parts)
// `splitFruits` ci-dessous applique ce test à CHAQUE fruit UNE fois : la
// somme des deux parts vaut donc toujours le nombre total de fruits du
// gâteau, par construction (une seule branche du `if`, un seul `push`).
// ─────────────────────────────────────────────────────────────────────────

import { mulberry32 } from '@shared/rng';
import {
  CAKE_ANGLE_STEPS,
  CAKE_CUTS,
  CAKE_MIN_GAP,
  CAKE_RADIUS,
  CAKE_STAR_BONUS_FRUIT,
} from '../../config/balance';
import type { Result } from '../../core/minigame';
import type { StarLevel } from '../../meta/save';

export type FruitKind = 'strawberry' | 'blueberry';

export interface Fruit {
  readonly kind: FruitKind;
  /** Coordonnées LOCALES, centre du gâteau = origine. */
  readonly x: number;
  readonly y: number;
}

export type CakePhase = 'cut' | 'choose' | 'over';

export interface CakeState {
  readonly phase: CakePhase;
  /** Coupe courante (ou dernière, une fois `over`), 0-based. */
  readonly cutIndex: number;
  readonly totalCuts: number;
  /** À qui de couper / de choisir la coupe COURANTE. */
  readonly cutter: 0 | 1;
  readonly chooser: 0 | 1;
  /** Gâteau de la coupe courante. */
  readonly fruits: readonly Fruit[];
  /** Angles des deux poignées, en radians (repère du cercle local). */
  readonly angleA: number;
  readonly angleB: number;
  /** Un cran illégal (collision des poignées) est signalé ICI : le bouton
   *  correspondant doit être `disabled`, jamais un clic qui échoue en silence. */
  readonly canNudgeAPlus: boolean;
  readonly canNudgeAMinus: boolean;
  readonly canNudgeBPlus: boolean;
  readonly canNudgeBMinus: boolean;
  /** Les deux parts, figées dès la coupe validée (`null` avant). */
  readonly pieces: readonly [readonly Fruit[], readonly Fruit[]] | null;
  /** Fruits PRÉFÉRÉS obtenus, cumulés depuis le début de la manche. */
  readonly scores: readonly [number, number];
  /** Fruits TOUTES CATÉGORIES obtenus — le premier départage. */
  readonly totals: readonly [number, number];
  /** Choisisseur de la DERNIÈRE coupe jouée — le second départage. */
  readonly lastChooser: 0 | 1 | null;
  readonly over: boolean;
  /** Joueur ⭐ (aidé), `null` si les deux sont au même niveau. Objet VISIBLE :
   *  la vue y accroche un pictogramme, jamais un multiplicateur caché. */
  readonly helped: 0 | 1 | null;
}

/** Le fruit préféré de chaque siège — toujours différents (§3.2). */
export function preferredKind(player: 0 | 1): FruitKind {
  return player === 0 ? 'strawberry' : 'blueberry';
}

export function fruitEmoji(kind: FruitKind): string {
  return kind === 'strawberry' ? '🍓' : '🫐';
}

/**
 * Le même fruit EN TOUTES LETTRES, pour les `aria-label` et les régions live.
 * Un lecteur d'écran annonce un emoji avec le nom que lui donne SA table (et
 * 🫐 est encore absent de plusieurs) : le pictogramme reste à l'écran pour
 * l'enfant qui ne lit pas, le mot part au clavier et à la synthèse vocale.
 */
export function fruitWord(kind: FruitKind, n: number): string {
  const one = kind === 'strawberry' ? 'fraise' : 'myrtille';
  return `${n} ${one}${n > 1 ? 's' : ''}`;
}

/** Un point du bord du gâteau, à cet angle (radians), rayon `CAKE_RADIUS`. */
export function handlePoint(angle: number): { x: number; y: number } {
  return { x: CAKE_RADIUS * Math.cos(angle), y: CAKE_RADIUS * Math.sin(angle) };
}

/**
 * LE test point/droite (voir l'en-tête du fichier). Séparé de `splitFruits`
 * pour que le bot puisse le fuzzer isolément contre sa propre réimplémentation
 * indépendante, corde par corde, fruit par fruit.
 */
export function sideOfCut(angleA: number, angleB: number, fx: number, fy: number): 0 | 1 {
  const a = handlePoint(angleA);
  const b = handlePoint(angleB);
  const cross = (b.x - a.x) * (fy - a.y) - (b.y - a.y) * (fx - a.x);
  return cross < 0 ? 1 : 0;
}

/**
 * Compte les fruits d'un type dans une part. UNE seule implémentation, partagée
 * par la vue (les pastilles peintes sur les parts) et par `index.ts` (les
 * `aria-label` et le résumé de plateau) : deux comptages parallèles finiraient
 * par diverger, et c'est précisément le chiffre que le joueur compare.
 */
export function countOf(fruits: readonly Fruit[], kind: FruitKind): number {
  let n = 0;
  for (const f of fruits) if (f.kind === kind) n++;
  return n;
}

/** Partitionne TOUS les fruits en exactement deux parts, sans perte ni doublon. */
export function splitFruits(
  fruits: readonly Fruit[],
  angleA: number,
  angleB: number,
): [Fruit[], Fruit[]] {
  const side0: Fruit[] = [];
  const side1: Fruit[] = [];
  for (const f of fruits) {
    (sideOfCut(angleA, angleB, f.x, f.y) === 0 ? side0 : side1).push(f);
  }
  return [side0, side1];
}

const STEP_ANGLE = (Math.PI * 2) / CAKE_ANGLE_STEPS;
const FRUIT_COUNTS = [7, 9, 11] as const;

/**
 * Rayon de l'anneau qui porte les fruits, pour `n` fruits : les positions sont
 * RÉGULIÈREMENT espacées (aucun rejet-échantillonnage, donc aucun risque
 * d'échec de génération). La corde entre deux fruits ADJACENTS est la plus
 * courte distance entre deux fruits quelconques du gâteau (propriété des
 * points régulièrement répartis sur un cercle) : il suffit donc de la
 * dimensionner au-dessus de `CAKE_MIN_GAP` pour garantir TOUS les écarts.
 * Marge ×1,25 : `2·r·sin(π/n) = CAKE_MIN_GAP` donne le rayon minimal, on prend
 * 25 % de plus. Le clamp protège aussi l'écart au BORD du disque.
 */
function ringRadius(n: number): number {
  const rMin = CAKE_MIN_GAP / (2 * Math.sin(Math.PI / n));
  const r = rMin * 1.25;
  const lo = CAKE_MIN_GAP + 12;
  const hi = CAKE_RADIUS - CAKE_MIN_GAP - 12;
  return Math.min(hi, Math.max(lo, r));
}

/** Fisher-Yates seedé — aucun `Math.random` (§3, zéro hasard non seedé). */
function shuffle<T>(rand: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Un gâteau frais : `n` fruits (7, 9 ou 11) répartis en deux types dont les
 * comptes NE PEUVENT PAS être égaux (leur somme `n` est impaire — propriété
 * arithmétique, pas un tirage à re-vérifier) : c'est l'asymétrie qui rend
 * l'égalité parfaite improbable en fin de manche, sans qu'on ait à la forcer.
 * `helpedKind` (⭐, peut être `null`) penche le partage d'un fruit en plus vers
 * ce type, jamais au point de faire descendre l'autre type sous 2.
 */
function genCake(rand: () => number, helpedKind: FruitKind | null): Fruit[] {
  const n = FRUIT_COUNTS[Math.floor(rand() * FRUIT_COUNTS.length)];
  const lo = 2;
  const hi = n - 2;
  const bonus =
    helpedKind === 'strawberry' ? CAKE_STAR_BONUS_FRUIT : helpedKind === 'blueberry' ? -CAKE_STAR_BONUS_FRUIT : 0;
  const raw = lo + Math.floor(rand() * (hi - lo + 1));
  // Le clamp garde les DEUX types ≥ 2 même si `CAKE_STAR_BONUS_FRUIT` grossit :
  // « un fruit de plus » ne doit jamais faire disparaître le type de l'autre.
  const countStraw = Math.min(hi, Math.max(lo, raw + bonus));
  const countBlue = n - countStraw;

  const kinds = shuffle(rand, [
    ...Array<FruitKind>(countStraw).fill('strawberry'),
    ...Array<FruitKind>(countBlue).fill('blueberry'),
  ]);

  const r = ringRadius(n);
  const rotation = rand() * Math.PI * 2;
  const fruits: Fruit[] = [];
  for (let i = 0; i < n; i++) {
    const angle = rotation + (i * Math.PI * 2) / n;
    fruits.push({ kind: kinds[i], x: r * Math.cos(angle), y: r * Math.sin(angle) });
  }
  return fruits;
}

export class CakeModel {
  /**
   * SURFACE DE TEST du scénario `rules` (§7). Le bot n'atteint que
   * `window.__game.models.cake`, c'est-à-dire cette classe : sans ces alias, il
   * ne pourrait fuzzer LE point dur du jeu — le test point/droite — qu'à
   * travers une partie complète. Ce sont les fonctions PURES du module, pas une
   * API de raccourci de jeu : elles ne peuvent muter aucun état.
   */
  static readonly sideOfCut = sideOfCut;
  static readonly splitFruits = splitFruits;
  static readonly countOf = countOf;
  static readonly handlePoint = handlePoint;
  static readonly preferredKind = preferredKind;
  static readonly ANGLE_STEPS = CAKE_ANGLE_STEPS;
  static readonly RADIUS = CAKE_RADIUS;

  private phase: CakePhase = 'cut';
  private cutIndex = 0;
  private stepA = 0;
  private stepB = Math.floor(CAKE_ANGLE_STEPS / 2);
  private fruits: Fruit[];
  private pieces: [Fruit[], Fruit[]] | null = null;
  private readonly scoreArr: [number, number] = [0, 0];
  private readonly totalArr: [number, number] = [0, 0];
  private lastChooserPlayer: 0 | 1 | null = null;
  /** Qui coupe en premier : le joueur AIDÉ s'il y en a un (couper est le rôle
   *  le plus facile — §3.2), sinon le siège 0 par convention (§2.4 notation). */
  private readonly firstCutter: 0 | 1;
  private readonly helped: 0 | 1 | null;
  private readonly rand: () => number;

  /**
   * @param seed  tirage de la manche — tout le contenu en dérive, aucun
   *              `Math.random`.
   * @param stars niveaux ⭐ des deux sièges (§1.3) : modifient des CHIFFRES
   *              (qui coupe en premier, un fruit de plus), jamais les règles.
   */
  constructor(
    readonly seed: number,
    readonly stars: readonly [StarLevel, StarLevel],
  ) {
    this.rand = mulberry32(seed);
    // POLARITÉ DU ⭐ — le sens est fixé par l'accueil, pas par l'intuition :
    // `ui/screens.ts` libelle ⭐ « un coup de plus » et ⭐⭐ « sans coup de
    // plus ». UNE étoile = le joueur AIDÉ (le petit), DEUX = celui qui joue
    // sans aide. L'inverser rendait le handicap actif à l'envers : mesuré au
    // fuzz, le siège ⭐ recevait 40,5 % de son fruit préféré au lieu de 59,3 %.
    // Aucun effet quand les deux sièges sont au même niveau.
    this.helped = stars[0] !== stars[1] ? (stars[0] === 1 ? 0 : 1) : null;
    this.firstCutter = this.helped ?? 0;
    this.fruits = genCake(this.rand, this.helped === null ? null : preferredKind(this.helped));
  }

  private cutterOf(i: number): 0 | 1 {
    // Borné : une fois la manche finie `cutIndex` vaut CAKE_CUTS, et l'écran de
    // résultat lit encore `state.cutter` — on renvoie le rôle de la DERNIÈRE
    // coupe jouée plutôt qu'un rôle d'une coupe qui n'existe pas.
    const k = Math.min(i, CAKE_CUTS - 1);
    const first = this.firstCutter;
    return k % 2 === 0 ? first : first === 0 ? 1 : 0;
  }

  private chooserOf(i: number): 0 | 1 {
    return this.cutterOf(i) === 0 ? 1 : 0;
  }

  get state(): CakeState {
    const angleA = this.stepA * STEP_ANGLE;
    const angleB = this.stepB * STEP_ANGLE;
    return {
      phase: this.phase,
      cutIndex: this.cutIndex,
      totalCuts: CAKE_CUTS,
      cutter: this.cutterOf(this.cutIndex),
      chooser: this.chooserOf(this.cutIndex),
      fruits: this.fruits,
      angleA,
      angleB,
      canNudgeAPlus: this.canNudge('a', 1),
      canNudgeAMinus: this.canNudge('a', -1),
      canNudgeBPlus: this.canNudge('b', 1),
      canNudgeBMinus: this.canNudge('b', -1),
      pieces: this.pieces,
      scores: this.scoreArr,
      totals: this.totalArr,
      lastChooser: this.lastChooserPlayer,
      over: this.phase === 'over',
      helped: this.helped,
    };
  }

  /** Coup légal ? Le jeu n'affiche jamais « coup interdit » : il l'empêche
   *  (le bouton correspondant est `disabled` — §1.1 critère 2). */
  canNudge(handle: 'a' | 'b', dir: 1 | -1): boolean {
    if (this.phase !== 'cut') return false;
    const cur = handle === 'a' ? this.stepA : this.stepB;
    const other = handle === 'a' ? this.stepB : this.stepA;
    const next = wrap(cur + dir, CAKE_ANGLE_STEPS);
    return next !== other; // les deux poignées ne peuvent jamais coïncider
  }

  /** @returns `true` si le cran a bougé. */
  nudge(handle: 'a' | 'b', dir: 1 | -1): boolean {
    if (!this.canNudge(handle, dir)) return false;
    if (handle === 'a') this.stepA = wrap(this.stepA + dir, CAKE_ANGLE_STEPS);
    else this.stepB = wrap(this.stepB + dir, CAKE_ANGLE_STEPS);
    return true;
  }

  /** Valide la coupe courante : calcule les deux parts, passe en 'choose'. */
  confirmCut(): boolean {
    if (this.phase !== 'cut') return false;
    const s = this.state;
    this.pieces = splitFruits(this.fruits, s.angleA, s.angleB);
    this.phase = 'choose';
    return true;
  }

  /** Le choisisseur prend la part `which` ; l'autre revient au coupeur. */
  choosePiece(which: 0 | 1): boolean {
    if (this.phase !== 'choose' || !this.pieces) return false;
    const chooser = this.chooserOf(this.cutIndex);
    const cutter = this.cutterOf(this.cutIndex);
    const chosen = this.pieces[which];
    const other = this.pieces[which === 0 ? 1 : 0];
    this.applyFruits(chooser, chosen);
    this.applyFruits(cutter, other);
    this.lastChooserPlayer = chooser;

    this.cutIndex += 1;
    if (this.cutIndex >= CAKE_CUTS) {
      this.phase = 'over';
    } else {
      this.pieces = null;
      this.stepA = 0;
      this.stepB = Math.floor(CAKE_ANGLE_STEPS / 2);
      this.fruits = genCake(this.rand, this.helped === null ? null : preferredKind(this.helped));
      this.phase = 'cut';
    }
    return true;
  }

  private applyFruits(player: 0 | 1, fruits: readonly Fruit[]): void {
    for (const f of fruits) {
      this.totalArr[player] += 1;
      if (f.kind === preferredKind(player)) this.scoreArr[player] += 1;
    }
  }

  /**
   * §1.1 critère 4 — la CAUSE en une phrase, avec le départage exact qui a
   * tranché : jamais `winner: null` ici (le dernier choisisseur résout
   * TOUJOURS un reste d'égalité, donc `duel` ne rend jamais de nul, à
   * l'inverse d'une manche coopérative d'un autre jeu de la collection).
   */
  get result(): Result {
    const [s0, s1] = this.scoreArr;
    const [t0, t1] = this.totalArr;
    let winner: 0 | 1;
    let reason: string;
    if (s0 !== s1) {
      winner = s0 > s1 ? 0 : 1;
      const loser = winner === 0 ? 1 : 0;
      reason = `${this.scoreArr[winner]} ${fruitEmoji(preferredKind(winner))} contre ${this.scoreArr[loser]} ${fruitEmoji(preferredKind(loser))}`;
    } else if (t0 !== t1) {
      winner = t0 > t1 ? 0 : 1;
      reason = `${s0} fruits préférés chacun, mais ${Math.max(t0, t1)} fruits en tout contre ${Math.min(t0, t1)}`;
    } else {
      winner = this.lastChooserPlayer ?? 0;
      reason = 'tout à égalité : le dernier choix a tranché';
    }
    return { winner, scores: [s0, s1], reason };
  }
}

function wrap(v: number, mod: number): number {
  return ((v % mod) + mod) % mod;
}
