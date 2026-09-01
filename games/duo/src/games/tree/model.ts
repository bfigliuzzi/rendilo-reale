// §3.3 — `tree` : La branche coupée (Hackenbush aux pommes) · pass · duel · tour par tour.
//
// Coupe une brindille de ta couleur ; ce qui n'est plus relié au sol tombe ; les
// pommes tombées sont pour toi. MODÈLE PUR : ni horloge, ni `Math.random`, ni
// DOM, ni Pixi, ni import de `view.ts` — c'est ce qui permet au bot de rejouer
// une manche entière hors de la page.
//
// ─────────────────────────────────────────────────────────────────────────
// LE POINT DUR DE CE JEU : LA CASCADE
//
// Le graphe n'est pas un simple arbre au sens strict : certaines feuilles ont
// DEUX parents (arêtes redondantes posées à la génération), pour que la règle
// « toute arête sans chemin vers le sol tombe » ait un vrai sens — sans elles,
// couper une arête reviendrait TOUJOURS à faire tomber tout le sous-arbre
// qu'elle porte, et une implémentation naïve (« je fais tomber les enfants du
// nœud coupé ») serait indiscernable de la bonne à l'œil, mais fausse dès
// qu'un enfant garde un autre chemin vivant vers le sol.
//
// L'implémentation ne fait donc JAMAIS ce raccourci : après toute coupe, on
// recalcule l'ensemble ATTEIGNABLE depuis le nœud 0 par propagation sur les
// arêtes encore debout (`computeReach`), et on fait tomber EXACTEMENT les
// arêtes qui ne sont plus dans cet ensemble — ni plus (une arête qui garde un
// chemin ne tombe jamais), ni moins (toute arête livrée à elle-même tombe).
//
// CONSERVATION : les pommes de l'arête coupée ET celles de toutes les arêtes
// tombées avec elle vont TOUJOURS au panier du coupeur, en un seul geste. La
// somme des deux paniers plus les pommes des arêtes encore debout vaut donc en
// permanence `total` — invariant vérifiable à chaque tour par le bot.
//
// FIN DE PARTIE : toute arête vivante porte une couleur (0, 1 ou marron), donc
// elle est TOUJOURS coupable par quelqu'un. La partie ne peut donc se terminer
// que lorsque l'arbre est entièrement tombé : à cet instant, paniers[0] +
// paniers[1] === total, et `total` est IMPAIR par construction — une égalité
// parfaite est donc arithmétiquement impossible.
// ─────────────────────────────────────────────────────────────────────────

import { mulberry32 } from '@shared/rng';
import { TREE_DEPTH, TREE_EDGES, TREE_MAX_APPLES, TREE_MIN_MOVES, TREE_STAR_EXTRA_CUTS } from '../../config/balance';
import type { DemoMove, Result } from '../../core/minigame';
import type { StarLevel } from '../../meta/save';

/** 0 = couleur du joueur 0, 1 = couleur du joueur 1, 2 = marron : coupable par les deux. */
export type EdgeColor = 0 | 1 | 2;

export interface TreeNodeData {
  /** 0 = le sol. Sert à placer le nœud verticalement (racine en bas). */
  readonly depth: number;
  /** Position horizontale NORMALISÉE (0..1) au sein de son palier — la vue la
   *  multiplie par sa largeur logique ; le modèle ne connaît aucun pixel. */
  readonly slot: number;
}

export interface TreeEdgeData {
  readonly id: number;
  /** Nœud côté sol (plus proche de la racine). */
  readonly a: number;
  /** Nœud côté feuille (plus loin de la racine). */
  readonly b: number;
  readonly color: EdgeColor;
  /** 0..`TREE_MAX_APPLES`. */
  readonly apples: number;
}

export interface TreeState {
  readonly nodes: readonly TreeNodeData[];
  readonly edges: readonly TreeEdgeData[];
  /** Par id d'arête : encore debout ? (coupée OU tombée = `false`, définitif). */
  readonly alive: readonly boolean[];
  readonly baskets: readonly [number, number];
  /** À qui de jouer. Invariant hors fin de partie : `hasLegalMove(turn)` est vrai. */
  readonly turn: 0 | 1;
  /** Jetons ✂ restants — l'aide ⭐ est un OBJET VISIBLE (§1.3), jamais un
   *  multiplicateur caché : la vue les affiche en pictogramme à côté du panier. */
  readonly extraCuts: readonly [number, number];
  /** Joueur aidé (⭐), `null` si les deux sièges sont au même niveau. */
  readonly helped: 0 | 1 | null;
  /** Total de pommes de la manche — toujours IMPAIR (voir en-tête). */
  readonly total: number;
  readonly over: boolean;
}

export function colorName(c: EdgeColor): string {
  return c === 0 ? 'bleue' : c === 1 ? 'violette' : 'marron';
}

function other(p: 0 | 1): 0 | 1 {
  return p === 0 ? 1 : 0;
}

// ───────────────────────── Génération (seedée) ─────────────────────────

interface RawEdge {
  a: number;
  b: number;
  color: EdgeColor;
  apples: number;
}

interface RawGraph {
  /** `nodeDepth[i]` = profondeur du nœud `i` (0 pour le sol, à l'index 0). */
  nodeDepth: number[];
  /** `levels[d]` = indices des nœuds de profondeur `d`, `levels[0] = [0]`. */
  levels: number[][];
  edges: RawEdge[];
}

const MAX_GEN_ATTEMPTS = 300;
/** Nœuds par palier : assez pour offrir de vrais choix sans surcharger l'écran. */
const LEVEL_SIZE_MIN = 3;
const LEVEL_SIZE_SPAN = 3; // tailles possibles : 3, 4 ou 5
/** Poids de tirage du nombre de pommes d'une arête (0, 1, ou `TREE_MAX_APPLES`) :
 *  la plupart des brindilles sont légères, peu portent la récolte lourde. */
const APPLE_WEIGHTS: readonly [number, number][] = [
  [0, 45],
  [1, 40],
  [TREE_MAX_APPLES, 15],
];

/**
 * Position horizontale normalisée d'un nœud dans son palier — DOIT rester la
 * copie conforme du calcul de `finalize`, c'est elle qui décide de la
 * géométrie que la vue dessinera.
 */
function slotOf(index: number, size: number): number {
  return size > 1 ? (index + 0.5) / size : 0.5;
}

/** Le palier parent, trié du plus proche au plus loin de `slot` (tri STABLE :
 *  à distance égale, l'ordre du palier tranche — génération déterministe). */
function nearestParents(parentLayer: readonly number[], slot: number): number[] {
  return parentLayer
    .map((p, i) => ({ p, d: Math.abs(slotOf(i, parentLayer.length) - slot) }))
    .sort((x, y) => x.d - y.d)
    .map((c) => c.p);
}

function shuffleInPlace<T>(rand: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function pickWeightedLocal(rand: () => number, entries: readonly [number, number][]): number {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rand() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

/**
 * Une tentative de génération. Renvoie `null` si l'une des garanties du §3.3
 * n'est pas atteinte (bornes d'arêtes, ≥3 coups légaux par joueur, total
 * impair) : l'appelant retire alors une nouvelle tentative sur le MÊME flux
 * seedé — déterministe de bout en bout, jamais de `Math.random`.
 */
function tryBuildOnce(rand: () => number): RawGraph | null {
  const depth = TREE_DEPTH.min + Math.floor(rand() * (TREE_DEPTH.max - TREE_DEPTH.min + 1));
  const levels: number[][] = [[0]];
  const nodeDepth: number[] = [0];
  const edges: RawEdge[] = [];

  // Arbre couvrant : chaque nœud d'un palier choisit UN parent dans le palier
  // du dessous — garantit la connexité initiale sans jamais avoir à la vérifier.
  for (let d = 1; d <= depth; d++) {
    const size = LEVEL_SIZE_MIN + Math.floor(rand() * LEVEL_SIZE_SPAN);
    const parentLayer = levels[d - 1];
    const layer: number[] = [];
    for (let k = 0; k < size; k++) {
      // Parent tiré parmi les DEUX PLUS PROCHES à l'horizontale, jamais
      // n'importe lequel du palier : au hasard, les branches se croisent d'un
      // bord à l'autre et l'écran devient une toile d'araignée où l'on ne voit
      // plus ce qui pend à quoi — or c'est TOUT ce que ce jeu demande de lire
      // (§1.1 : la règle est un geste, pas une phrase). Deux candidats, pas un,
      // pour garder des arbres de formes variées. Effet de bord mesuré : les
      // croisements en X étaient aussi ce qui faisait tomber deux cibles
      // tactiles au même point (voir `buttonCenters` dans `index.ts`).
      const parent = nearestParents(parentLayer, slotOf(k, size))[
        parentLayer.length > 1 ? Math.floor(rand() * 2) : 0
      ];
      const idx = nodeDepth.length;
      nodeDepth.push(d);
      layer.push(idx);
      edges.push({ a: parent, b: idx, color: 0, apples: 0 }); // couleur/pommes posées plus bas
    }
    levels.push(layer);
  }

  // Arêtes redondantes : un second appui pour QUELQUES feuilles, depuis un
  // AUTRE nœud du palier inférieur. C'est elles qui rendent la cascade non
  // triviale (voir l'en-tête du fichier) — sans elles le graphe serait un
  // arbre pur où « couper » et « faire tomber le sous-arbre » coïncideraient
  // toujours, et l'algorithme général ne serait jamais mis à l'épreuve.
  const targetTotal = TREE_EDGES.min + Math.floor(rand() * (TREE_EDGES.max - TREE_EDGES.min + 1));
  let guard = 0;
  while (edges.length < targetTotal && guard < 200) {
    guard++;
    const d = 1 + Math.floor(rand() * depth);
    const parentLayer = levels[d - 1];
    if (parentLayer.length < 2) continue; // aucun AUTRE parent possible à ce palier
    const layer = levels[d];
    const k = Math.floor(rand() * layer.length);
    const child = layer[k];
    // Second appui le plus PROCHE possible, pour la même raison que ci-dessus :
    // un second parent pris à l'autre bout du palier traverse tout l'arbre.
    const parent = nearestParents(parentLayer, slotOf(k, layer.length)).find(
      (p) => !edges.some((e) => e.a === p && e.b === child),
    );
    if (parent === undefined) continue; // déjà relié à tout le palier
    edges.push({ a: parent, b: child, color: 0, apples: 0 });
  }
  if (edges.length < TREE_EDGES.min || edges.length > TREE_EDGES.max) return null;

  // Couleurs équilibrées à ±1, plus quelques arêtes marron coupables des deux.
  const numBrown = Math.max(1, Math.round(edges.length * 0.15));
  const remaining = edges.length - numBrown;
  const half = Math.floor(remaining / 2);
  const bonus = remaining % 2 === 1 && rand() < 0.5 ? 1 : 0;
  const countColor0 = half + bonus;
  const countColor1 = remaining - countColor0;
  const colorPool: EdgeColor[] = [
    ...Array<EdgeColor>(countColor0).fill(0),
    ...Array<EdgeColor>(countColor1).fill(1),
    ...Array<EdgeColor>(numBrown).fill(2),
  ];
  shuffleInPlace(rand, colorPool);
  for (let i = 0; i < edges.length; i++) edges[i].color = colorPool[i];

  // ≥ TREE_MIN_MOVES coups légaux pour CHAQUE joueur dès le premier tour
  // (critère 2 du test des 5 ans : jamais un joueur planté d'entrée).
  const legal0 = edges.filter((e) => e.color === 0 || e.color === 2).length;
  const legal1 = edges.filter((e) => e.color === 1 || e.color === 2).length;
  if (legal0 < TREE_MIN_MOVES || legal1 < TREE_MIN_MOVES) return null;

  // Pommes : plafonnées à TREE_MAX_APPLES, total ajusté pour être IMPAIR — la
  // garantie arithmétique qui rend toute égalité finale impossible.
  for (const e of edges) e.apples = Math.min(TREE_MAX_APPLES, pickWeightedLocal(rand, APPLE_WEIGHTS));
  let total = edges.reduce((s, e) => s + e.apples, 0);
  if (total % 2 === 0) {
    const upIdx = edges.findIndex((e) => e.apples < TREE_MAX_APPLES);
    if (upIdx >= 0) {
      edges[upIdx].apples += 1;
      total += 1;
    } else {
      const downIdx = edges.findIndex((e) => e.apples > 0);
      if (downIdx >= 0) {
        edges[downIdx].apples -= 1;
        total -= 1;
      }
    }
  }
  if (total <= 0 || total % 2 === 0) return null; // garde défensive, ne devrait jamais se produire

  return { nodeDepth, levels, edges };
}

/**
 * Graphe de secours, câblé à la main : n'intervient QUE si `MAX_GEN_ATTEMPTS`
 * tentatives seedées échouent toutes (marge très large donnée aux bornes de
 * `config/balance.ts` — ne devrait jamais se produire en pratique). Vérifié
 * une fois à la main : 14 arêtes, profondeur 3, couleurs 6/6/2, 7 pommes
 * (impair), 8 coups légaux de chaque côté.
 */
function fallbackGraph(): RawGraph {
  const rawEdges: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 5], [2, 6], [2, 7], [3, 8], [4, 9],
    [5, 10], [6, 11], [8, 12], [9, 13],
    [6, 10], // arête redondante : le nœud 10 a deux parents (5 et 6)
  ];
  const colors: EdgeColor[] = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2];
  const apples = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
  return {
    nodeDepth: [0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3],
    levels: [[0], [1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13]],
    edges: rawEdges.map(([a, b], i) => ({ a, b, color: colors[i], apples: apples[i] })),
  };
}

interface BuiltGraph {
  nodes: TreeNodeData[];
  edges: TreeEdgeData[];
  /** Un dernier tirage du même flux seedé, réservé au choix du premier joueur. */
  firstRand: number;
}

function finalize(raw: RawGraph): { nodes: TreeNodeData[]; edges: TreeEdgeData[] } {
  const nodes: TreeNodeData[] = raw.nodeDepth.map((d, i) => {
    if (i === 0) return { depth: 0, slot: 0.5 };
    const layer = raw.levels[d];
    const pos = layer.indexOf(i);
    const slot = layer.length > 1 ? (pos + 0.5) / layer.length : 0.5;
    return { depth: d, slot };
  });
  const edges: TreeEdgeData[] = raw.edges.map((e, i) => ({ id: i, a: e.a, b: e.b, color: e.color, apples: e.apples }));
  return { nodes, edges };
}

function generateTree(seed: number): BuiltGraph {
  const rand = mulberry32(seed);
  for (let attempt = 0; attempt < MAX_GEN_ATTEMPTS; attempt++) {
    const raw = tryBuildOnce(rand);
    if (raw) return { ...finalize(raw), firstRand: rand() };
  }
  return { ...finalize(fallbackGraph()), firstRand: rand() };
}

/** Garde-fou DEV, bon marché sur un graphe de cette taille (≤18 arêtes) : une
 *  incohérence ici se lirait sinon en jeu comme « ce coup n'a aucun sens ». */
function assertGraphSane(nodes: readonly TreeNodeData[], edges: readonly TreeEdgeData[], total: number): void {
  if (edges.length < TREE_EDGES.min || edges.length > TREE_EDGES.max) {
    throw new Error(`[duo/tree] nombre d'arêtes hors bornes : ${edges.length}`);
  }
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  if (maxDepth < TREE_DEPTH.min || maxDepth > TREE_DEPTH.max) {
    throw new Error(`[duo/tree] profondeur hors bornes : ${maxDepth}`);
  }
  if (edges.some((e) => e.apples > TREE_MAX_APPLES || e.apples < 0)) {
    throw new Error('[duo/tree] pommes hors plafond');
  }
  if (total <= 0 || total % 2 === 0) throw new Error(`[duo/tree] total de pommes non impair : ${total}`);
  const legal0 = edges.filter((e) => e.color === 0 || e.color === 2).length;
  const legal1 = edges.filter((e) => e.color === 1 || e.color === 2).length;
  if (legal0 < TREE_MIN_MOVES || legal1 < TREE_MIN_MOVES) {
    throw new Error('[duo/tree] pas assez de coups légaux au premier tour');
  }
}

// ───────────────────────── Modèle ─────────────────────────

export class TreeModel {
  private readonly nodesArr: TreeNodeData[];
  private readonly edgesArr: TreeEdgeData[];
  private readonly deadArr: boolean[];
  private readonly basketArr: [number, number] = [0, 0];
  private readonly extraCutsArr: [number, number];
  private readonly helpedPlayer: 0 | 1 | null;
  private cur: 0 | 1;
  /** Toujours IMPAIR (voir en-tête du fichier). */
  readonly total: number;

  /**
   * @param seed  tirage de la manche — tout le graphe en dérive, aucun
   *              `Math.random`.
   * @param stars niveaux ⭐ des deux sièges (§1.3). Modifient un CHIFFRE (le
   *              nombre de jetons ✂ du joueur aidé), jamais une règle.
   */
  constructor(
    readonly seed: number,
    readonly stars: readonly [StarLevel, StarLevel],
  ) {
    // SENS DU RÉGLAGE ⭐, à ne pas réinventer : l'accueil libelle lui-même
    // « ⭐ = un coup de plus » / « ⭐⭐ = sans coup de plus » (`ui/screens.ts`),
    // et le §3.3 dit « le joueur ⭐ coupe deux fois à son premier tour ». Le
    // joueur AIDÉ est donc celui à UNE étoile — l'inverser donnait le jeton au
    // grand, exactement le « le grand crie à la triche » du §1.3.
    this.helpedPlayer = stars[0] !== stars[1] ? (stars[0] === 1 ? 0 : 1) : null;
    const built = generateTree(seed);
    this.nodesArr = built.nodes;
    this.edgesArr = built.edges;
    this.deadArr = this.edgesArr.map(() => false);
    this.total = this.edgesArr.reduce((s, e) => s + e.apples, 0);
    this.extraCutsArr = [
      this.helpedPlayer === 0 ? TREE_STAR_EXTRA_CUTS : 0,
      this.helpedPlayer === 1 ? TREE_STAR_EXTRA_CUTS : 0,
    ];
    // Le joueur aidé commence : son jeton ✂ se dépense tout de suite, sous les
    // yeux de l'enfant qui vient de le recevoir (§1.1 critère 1). Un jeton =
    // un coup EN PLUS, donc deux coupes à son premier tour (§3.3).
    this.cur = this.helpedPlayer ?? (built.firstRand < 0.5 ? 0 : 1);
    if (!this.hasLegalMove(this.cur) && this.hasLegalMove(other(this.cur))) {
      this.cur = other(this.cur); // garde défensive, TREE_MIN_MOVES la rend normalement inutile
    }
    if (import.meta.env.DEV) assertGraphSane(this.nodesArr, this.edgesArr, this.total);
  }

  get state(): TreeState {
    return {
      nodes: this.nodesArr,
      edges: this.edgesArr,
      alive: this.deadArr.map((d) => !d),
      baskets: this.basketArr,
      turn: this.cur,
      extraCuts: this.extraCutsArr,
      helped: this.helpedPlayer,
      total: this.total,
      over: this.over,
    };
  }

  /** Debout ET connectée au sol par construction (voir en-tête). */
  private hasLegalMove(player: 0 | 1): boolean {
    for (const e of this.edgesArr) {
      if (this.deadArr[e.id]) continue;
      if (e.color === player || e.color === 2) return true;
    }
    return false;
  }

  get over(): boolean {
    return !this.hasLegalMove(0) && !this.hasLegalMove(1);
  }

  /** Coup légal ? Le jeu n'affiche jamais « coup interdit » : il l'empêche —
   *  le bouton correspondant est `disabled` (§1.1 critère 2). */
  canCut(player: 0 | 1, edgeId: number): boolean {
    if (this.over) return false;
    if (player !== this.cur) return false;
    const e = this.edgesArr[edgeId];
    if (!e || this.deadArr[edgeId]) return false;
    return e.color === player || e.color === 2;
  }

  /** Propagation depuis le sol sur les arêtes encore debout — LE cœur de la
   *  cascade (voir l'en-tête du fichier). Non dirigée à dessein : une future
   *  variante moins « tuyauterie verticale » resterait correcte.
   *  `ignore` permet de demander « et SI on coupait celle-là ? » sans rien
   *  muter : c'est ce qui laisse la démo choisir sa plus belle cascade avec le
   *  VRAI algorithme, jamais une approximation qui pourrait en diverger. */
  private computeReach(ignore = -1): boolean[] {
    const reach = new Array<boolean>(this.nodesArr.length).fill(false);
    reach[0] = true;
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of this.edgesArr) {
        if (this.deadArr[e.id] || e.id === ignore) continue;
        if (reach[e.a] && !reach[e.b]) {
          reach[e.b] = true;
          changed = true;
        } else if (reach[e.b] && !reach[e.a]) {
          reach[e.a] = true;
          changed = true;
        }
      }
    }
    return reach;
  }

  /**
   * Coupe l'arête `edgeId` pour `player`. Fait tomber la cascade, crédite le
   * panier du coupeur (l'arête coupée ET toutes les arêtes tombées avec elle),
   * puis fait avancer le tour (jeton ✂ ou passage automatique).
   *
   * @returns `true` si le coup a été joué (donc si l'état a changé).
   */
  cut(player: 0 | 1, edgeId: number): boolean {
    if (!this.canCut(player, edgeId)) return false;

    this.deadArr[edgeId] = true;
    let gained = this.edgesArr[edgeId].apples;

    const reach = this.computeReach();
    for (const e of this.edgesArr) {
      if (this.deadArr[e.id]) continue; // déjà coupée (dont l'arête qu'on vient de couper)
      if (!reach[e.a]) {
        this.deadArr[e.id] = true;
        gained += e.apples;
      }
    }
    this.basketArr[player] += gained;
    this.advanceTurn(player);
    return true;
  }

  private advanceTurn(actor: 0 | 1): void {
    let next: 0 | 1;
    if (this.extraCutsArr[actor] > 0) {
      this.extraCutsArr[actor] -= 1;
      next = actor; // jeton ✂ dépensé : il rejoue tout de suite
    } else {
      next = other(actor);
    }
    // Passage automatique, SANS écran de passage : un joueur sans coup légal
    // ne bloque jamais la partie tant que l'autre peut jouer (§3.3).
    if (!this.hasLegalMove(next) && this.hasLegalMove(other(next))) next = other(next);
    this.cur = next;
  }

  /**
   * §1.1 critère 4 — la CAUSE en une phrase. Jamais `winner: null` : le total
   * de pommes est impair, donc à la fin (l'arbre est nécessairement tombé en
   * entier — voir en-tête) les deux paniers ne peuvent jamais être égaux.
   */
  get result(): Result {
    const [b0, b1] = this.basketArr;
    const winner: 0 | 1 = b0 > b1 ? 0 : 1;
    const loser = other(winner);
    return {
      winner,
      scores: [b0, b1],
      reason: `${this.basketArr[winner]} pommes contre ${this.basketArr[loser]}`,
    };
  }

  /** Ce que ferait tomber la coupe de `edgeId`, SANS rien muter : le nombre de
   *  brindilles emportées (l'arête coupée comprise) et les pommes récoltées. */
  private cascadeOf(edgeId: number): { count: number; apples: number } {
    const reach = this.computeReach(edgeId);
    let count = 1;
    let apples = this.edgesArr[edgeId].apples;
    for (const e of this.edgesArr) {
      if (this.deadArr[e.id] || e.id === edgeId) continue;
      if (!reach[e.a]) {
        count++;
        apples += e.apples;
      }
    }
    return { count, apples };
  }

  /**
   * §2.4 — la démo rejoue le MODÈLE RÉEL, jamais une animation séparée, et
   * elle est agnostique du seed : aucun identifiant d'arête codé en dur.
   *
   * Elle joue le coup qui emporte le PLUS de brindilles (puis le plus de
   * pommes) : la démo doit enseigner la règle en trois secondes et sans un mot,
   * or « couper » ne l'enseigne pas — c'est la CASCADE et les pommes qui
   * roulent vers le panier qui la disent. Le choix « une brindille plantée dans
   * le sol » ne garantissait rien : mesuré sur 300 tirages, 26 % des démos ne
   * faisaient tomber QUE les trois arêtes coupées (zéro cascade) et 4 ne
   * récoltaient pas une seule pomme. Ici, on interroge le VRAI algorithme de
   * cascade (`cascadeOf` → `computeReach`), donc la démo ne peut pas diverger
   * de la règle. Déterministe : à score égal, la plus petite id gagne.
   */
  applyDemo(move: DemoMove): void {
    if (move.move !== 'cut') return;
    const player = this.cur;
    let best = -1;
    let bestScore = -1;
    for (const e of this.edgesArr) {
      if (!this.canCut(player, e.id)) continue;
      const c = this.cascadeOf(e.id);
      const score = c.count * 100 + c.apples;
      if (score > bestScore) {
        bestScore = score;
        best = e.id;
      }
    }
    if (best >= 0) this.cut(player, best);
  }
}
