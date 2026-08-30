// TOUT le tuning de « Trois Portes ». Invariant du repo : aucune constante de
// gameplay ailleurs. Les chiffres viennent du design du POC et sont commentés
// quand ils portent une INTENTION plutôt qu'un simple équilibrage.

import type { AbilityId, ItemId, Line, UnitDef } from './rules';

// ───────────────────────────────────────────────────────── écran

export const DESIGN_W = 540;
export const DESIGN_H = 960;

/**
 * Les quatre lignes du champ de bataille, de haut en bas :
 * arrière ennemi · front ennemi ‖ front joueur · arrière joueur.
 * Le design décrit une disposition HORIZONTALE ; on l'empile verticalement pour
 * le portrait téléphone — la règle de ligne est la même, seule la lecture change.
 */
export const LINE_Y = [175, 300, 487, 612] as const;
/** Ordonnée du séparateur « ‖ » entre les deux camps. */
export const MID_Y = 393;
/** Largeur/hauteur d'une case d'unité, en pixels logiques. */
export const CELL_W = 150;
export const CELL_H = 128;
/** Écart entre deux cases d'une même ligne. */
export const CELL_GAP = 14;

/** Abscisse du centre de l'emplacement `slot` d'une ligne qui en compte `count`. */
export function slotX(slot: number, count: number): number {
  const span = count * CELL_W + (count - 1) * CELL_GAP;
  return DESIGN_W / 2 - span / 2 + slot * (CELL_W + CELL_GAP) + CELL_W / 2;
}

/** Ordonnée du centre d'une ligne. `row` : 0..3 de haut en bas. */
export function lineY(row: number): number {
  return LINE_Y[row];
}

/** Ligne écran (0..3) d'un couple camp/ligne. */
export function rowOf(side: number, line: Line): number {
  // ennemi : arrière tout en haut (0) puis front (1) — le front des deux camps
  // est donc au CENTRE, ce qui rend le « contact » lisible d'un coup d'œil.
  return side === 1 ? (line === 1 ? 0 : 1) : line === 0 ? 2 : 3;
}

/** Bandeau de l'ordre de tour. */
export const QUEUE_Y = 712;
export const QUEUE_CELL = 46;

// ───────────────────────────────────────────────────────── escouade

/** Cap DUR de l'escouade. La méta « Rang serré » ne le change pas. */
export const SQUAD_CAP = 4;
/** Places par ligne. « Rang serré » porte l'avant à 3 — voir `frontCapOf`. */
export const LINE_CAP = 2;
export const FRONT_CAP_TIGHT = 3;

// ───────────────────────────────────────────────────────── combat

/** Plancher de dégâts : une attaque fait toujours mal, quelle que soit l'armure. */
export const MIN_DAMAGE = 1;
/** Réduction accordée par l'action Défendre, jusqu'au prochain tour de l'unité. */
export const DEFEND_REDUCTION = 3;
/** Second souffle : PV rendus, une seule fois par combat. */
export const SECOND_WIND_HEAL = 6;
/** Décoction de l'Herboriste. Le SEUL soin gratuit du jeu. */
export const BREW_HEAL = 7;
/** Salve runique : dégâts à TOUTE une ligne ennemie, et sa recharge en tours. */
export const RUNIC_DAMAGE = 4;
export const RUNIC_COOLDOWN = 2;
/** Élan du Bourreau : bonus contre une cible à PV pleins. */
export const MOMENTUM_BONUS = 3;
/** Tir ajusté de l'Archère : bonus contre la ligne arrière adverse. */
export const AIMED_BONUS = 2;
/** Meute : bonus d'ATQ tant qu'un autre chien est vivant. */
export const PACK_BONUS = 2;
/** Litanie de l'Idole : PV rendus chaque tour à l'ennemi le plus blessé. */
export const LITANY_HEAL = 4;
/** Le Geôlier bascule en phase 2 sous cette fraction de ses PV max. */
export const BOSS_PHASE2_AT = 0.5;
/** Tours de vie d'un spectre de Fiole d'écho. */
export const PHIAL_TURNS = 2;

// ───────────────────────────────────────────────────────── classes jouables

/**
 * Six classes, pas une de plus (hors périmètre du POC). Le Vagabond est
 * volontairement FADE : c'est le socle que les recrues viennent spécialiser.
 */
export const CLASSES: Record<string, UnitDef> = {
  wanderer: {
    id: 'wanderer',
    name: 'Vagabond',
    sprite: 'wanderer',
    hp: 22,
    atk: 5,
    init: 5,
    reach: 'melee',
    armor: 0,
    ability: 'secondWind',
    home: 0,
    blurb: 'Second souffle — récupère 6 PV au lieu d’agir, une fois par combat.',
  },
  guardian: {
    id: 'guardian',
    name: 'Gardien',
    sprite: 'guardian',
    hp: 34,
    atk: 3,
    init: 3,
    reach: 'melee',
    armor: 0,
    ability: 'taunt',
    home: 0,
    blurb: 'Provocation — vivant au front, il attire toutes les attaques au contact.',
  },
  headsman: {
    id: 'headsman',
    name: 'Bourreau',
    sprite: 'headsman',
    hp: 20,
    atk: 8,
    init: 4,
    reach: 'melee',
    armor: 0,
    ability: 'momentum',
    home: 0,
    blurb: 'Élan — +3 dégâts contre une cible à PV pleins.',
  },
  archer: {
    id: 'archer',
    name: 'Archère',
    sprite: 'archer',
    hp: 14,
    atk: 6,
    init: 7,
    reach: 'ranged',
    armor: 0,
    ability: 'aimed',
    home: 1,
    blurb: 'Tir ajusté — +2 dégâts contre la ligne arrière adverse.',
  },
  herbalist: {
    id: 'herbalist',
    name: 'Herboriste',
    sprite: 'herbalist',
    hp: 16,
    atk: 2,
    init: 6,
    reach: 'ranged',
    armor: 0,
    ability: 'brew',
    home: 1,
    blurb: 'Décoction — rend 7 PV à un allié au lieu d’attaquer.',
  },
  runist: {
    id: 'runist',
    name: 'Runiste',
    sprite: 'runist',
    hp: 13,
    atk: 4,
    init: 4,
    reach: 'ranged',
    armor: 0,
    ability: 'runicVolley',
    home: 1,
    blurb: 'Salve runique — 4 dégâts à toute une ligne ennemie. Recharge : 2 tours.',
  },
  /** Débloquée par la méta « Sœur d’armes ». Démarre avec l’Écu bosselé. */
  sister: {
    id: 'sister',
    name: 'Sœur d’armes',
    sprite: 'sister',
    hp: 28,
    atk: 4,
    init: 4,
    reach: 'melee',
    armor: 0,
    ability: null,
    home: 0,
    blurb: 'Héroïne de front, équipée de l’Écu bosselé dès le départ.',
  },
  /** Invocation permanente : occupe un slot, ne se soigne ni ne se ressuscite. */
  statue: {
    id: 'statue',
    name: 'Statue éveillée',
    sprite: 'statue',
    hp: 28,
    atk: 4,
    init: 1,
    reach: 'melee',
    armor: 0,
    ability: null,
    home: 0,
    blurb: 'Un mur consommable : ni soin, ni résurrection, et elle coûte une place.',
  },
  /** Spectre de la Fiole d’écho : HORS cap, disparaît après 2 tours. */
  wraith: {
    id: 'wraith',
    name: 'Spectre',
    sprite: 'wraith',
    hp: 8,
    atk: 5,
    init: 8,
    reach: 'melee',
    armor: 0,
    ability: null,
    home: 0,
    blurb: 'Un sort qui a pris la forme d’un corps. Deux tours, puis plus rien.',
  },
};

/** Classes proposables au recrutement — ni le héros, ni les invocations. */
export const RECRUITABLE = ['guardian', 'headsman', 'archer', 'herbalist', 'runist'] as const;

/** Les deux héros de départ. `sister` demande la méta correspondante. */
export const HEROES = ['wanderer', 'sister'] as const;

/** Une invocation ne se soigne pas et ne se ressuscite pas (design). */
export function isSummon(defId: string): boolean {
  return defId === 'statue' || defId === 'wraith';
}

// ───────────────────────────────────────────────────────── bestiaire

export const ENEMIES: Record<string, UnitDef> = {
  rat: {
    id: 'rat',
    name: 'Rat-goule',
    sprite: 'rat',
    hp: 10,
    atk: 3,
    init: 6,
    reach: 'melee',
    armor: 0,
    ability: null,
    home: 0,
    blurb: 'Le remplisseur : sature le front et mesure les dégâts de zone.',
  },
  brute: {
    id: 'brute',
    name: 'Brute d’ossements',
    sprite: 'brute',
    hp: 26,
    atk: 6,
    init: 2,
    reach: 'melee',
    armor: 2,
    ability: null,
    home: 0,
    blurb: 'Lente et lourde. Punit les escouades sans dégâts concentrés.',
  },
  stalker: {
    id: 'stalker',
    name: 'Rôdeur',
    sprite: 'stalker',
    hp: 12,
    atk: 5,
    init: 8,
    reach: 'ranged',
    armor: 0,
    ability: 'stalker',
    home: 1,
    blurb: 'Perceur : il vise ta ligne arrière. C’est lui qui interdit de murer.',
  },
  hound: {
    id: 'hound',
    name: 'Chien de meute',
    sprite: 'hound',
    hp: 12,
    atk: 4,
    init: 9,
    reach: 'melee',
    armor: 0,
    ability: 'pack',
    home: 0,
    blurb: 'Meute — +2 ATQ tant qu’un autre chien vit. Il agit avant presque tout.',
  },
  idol: {
    id: 'idol',
    name: 'Idole ronflante',
    sprite: 'idol',
    hp: 18,
    atk: 0,
    init: 3,
    reach: 'ranged',
    armor: 0,
    ability: 'litany',
    home: 1,
    blurb: 'Litanie — rend 4 PV au plus blessé. Un puzzle, pas une menace.',
  },
  jailer: {
    id: 'jailer',
    name: 'Le Geôlier',
    sprite: 'jailer',
    hp: 60,
    atk: 7,
    init: 4,
    reach: 'melee',
    armor: 1,
    ability: 'jailer',
    home: 0,
    boss: true,
    blurb: 'Sous 50 % PV : il invoque deux rats et frappe LARGE sur tout ton front.',
  },
};

/** Fiche d'une unité, côté joueur ou côté bestiaire — une seule table à lire. */
export function unitDef(id: string): UnitDef {
  return CLASSES[id] ?? ENEMIES[id];
}

// ───────────────────────────────────────────────────────── objets

export interface ItemDef {
  id: ItemId;
  name: string;
  sprite: string;
  price: number;
  effect: string;
}

/**
 * Six objets, un par unité, transférables entre les salles. Les Bottes et le
 * Carquois sont les objets SIGNATURE : ils ne donnent pas des chiffres, ils
 * modifient une règle.
 */
export const ITEMS: Record<ItemId, ItemDef> = {
  shield: { id: 'shield', name: 'Écu bosselé', sprite: 'itemShield', price: 30, effect: '−2 dégâts subis au contact.' },
  blade: { id: 'blade', name: 'Lame ébréchée', sprite: 'itemBlade', price: 30, effect: '+3 ATQ.' },
  boots: {
    id: 'boots',
    name: 'Bottes lestées',
    sprite: 'itemBoots',
    price: 40,
    effect: 'La première permutation de chaque combat ne consomme pas le tour.',
  },
  amulet: {
    id: 'amulet',
    name: 'Amulette de sève',
    sprite: 'itemAmulet',
    price: 35,
    effect: '+6 PV max · récupère 3 PV en fin de combat.',
  },
  quiver: {
    id: 'quiver',
    name: 'Carquois lourd',
    sprite: 'itemQuiver',
    price: 40,
    // Le design écrit « attaques à distance » ; on l'étend à TOUTES les attaques
    // de l'unité, sinon l'objet ne répond pas à l'Idole ronflante — que le même
    // document désigne pourtant comme sa raison d'être (le contact ne peut pas
    // atteindre une ligne arrière). Un objet qui casse la règle de ligne EST sa
    // promesse : « il ne donne pas des chiffres, il modifie une règle ».
    effect: 'Les attaques de l’unité ignorent toute règle de ciblage : ligne avant et provocation.',
  },
  banner: { id: 'banner', name: 'Fanion usé', sprite: 'itemBanner', price: 25, effect: '+2 INIT à toute l’escouade.' },
};

export const ITEM_IDS = ['shield', 'blade', 'boots', 'amulet', 'quiver', 'banner'] as const;

export const SHIELD_REDUCTION = 2;
export const BLADE_ATK = 3;
export const AMULET_MAX_HP = 6;
export const AMULET_REGEN = 3;
export const BANNER_INIT = 2;

// ───────────────────────────────────────────────────────── économie

/** Résurrection : l'unité revient à cette fraction de ses PV max. */
export const REVIVE_COST = 25;
export const REVIVE_HP_FRACTION = 0.5;
/** Soin à l'unité de PV. Deux postes, une seule bourse : c'est LA question. */
export const HEAL_COST_PER_HP = 2;
/** Bourse de départ, sans méta. */
export const START_GOLD = 0;

/** Fourchettes d'or par type de salle (bornes incluses). */
export const GOLD_FIGHT: readonly [number, number] = [12, 18];
export const GOLD_FIGHT_HARD: readonly [number, number] = [25, 30];
export const GOLD_BOSS = 50;
/** Majoration d'une porte voilée. */
export const VEILED_BONUS = 1.5;
/**
 * Une porte voilée qui cache une salle SANS or (recrue, trésor, marchand) paie
 * quand même son pari : « majoré de 50 % » n'a aucun sens sur un objet, alors on
 * verse une trouvaille. Sans elle, la moitié des paris seraient silencieusement
 * perdants et le joueur cesserait de les prendre.
 */
export const VEILED_FIND_GOLD = 12;

// ───────────────────────────────────────────────────────── structure de run

/** 9 nœuds, puis le boss. Une run doit tenir sous 8 minutes. */
export const NODE_COUNT = 9;
export const DOORS_PER_NODE = 3;
/** La porte voilée apparaît à partir de ce nœud (1-based), une par nœud. */
export const VEILED_FROM_NODE = 3;
/** Les combats dangereux n'apparaissent qu'à partir de ce nœud. */
export const HARD_FROM_NODE = 4;
/** Marchand garanti à ce nœud — juste avant le boss. */
export const SHOP_NODE = 8;
/** Minimum de portes Recrue proposées sur l'ensemble de la run. */
export const MIN_RECRUIT_DOORS = 2;

/**
 * Compositions de combat standard (2 à 3 ennemis), **ORDONNÉES DU PLUS DOUX AU
 * PLUS DUR**. L'ordre porte le sens : `packWindow()` n'ouvre le tirage qu'aux
 * `node + 1` premières entrées, si bien que la difficulté d'un combat monte
 * avec le nœud sans qu'aucun chiffre d'ennemi ne bouge.
 *
 * Le design ne décrit pas cette rampe — il ne donne que des fréquences. Sans
 * elle, le nœud 9 est aussi mou que le nœud 1 ; avec elle, le nœud 1 ne peut
 * plus tirer une meute de chiens contre un héros SEUL, ce qui rendait le
 * « correctif d'ouverture » (porte Recrue garantie) obligatoire à la lettre
 * plutôt que conseillé.
 */
export const PACKS_EASY: readonly (readonly string[])[] = [
  ['rat', 'rat'],
  ['rat', 'hound'],
  ['rat', 'rat', 'rat'],
  ['rat', 'rat', 'stalker'],
  ['hound', 'hound'],
  ['brute', 'rat'],
  ['hound', 'rat', 'stalker'],
  ['brute', 'stalker'],
  ['rat', 'idol'],
];

/** Combats dangereux : 4 ennemis, ou une élite bien accompagnée. Même ordre. */
export const PACKS_HARD: readonly (readonly string[])[] = [
  ['rat', 'rat', 'stalker', 'stalker'],
  ['brute', 'rat', 'stalker', 'rat'],
  ['hound', 'hound', 'stalker', 'rat'],
  ['brute', 'brute', 'idol'],
  ['brute', 'rat', 'idol', 'stalker'],
  ['hound', 'hound', 'idol', 'rat'],
];

/**
 * Entrées tirables d'une table de compositions au nœud `node`. Toujours au
 * moins deux : un tirage à une seule composition rendrait les premiers nœuds
 * identiques d'une run à l'autre.
 */
export function packWindow(count: number, node: number, from = 1): number {
  return Math.max(2, Math.min(count, node - from + 2));
}

/** Le boss et son escorte de départ (le reste arrive en phase 2). */
export const BOSS_PACK: readonly string[] = ['jailer'];
/** Ce que le Geôlier invoque à sa ligne arrière en phase 2. */
export const BOSS_SUMMONS: readonly string[] = ['rat', 'rat'];

// ───────────────────────────────────────────────────────── méta

export const SHARDS_PER_NODE = 1;
export const SHARDS_BOSS = 10;
export const SHARDS_RUN = 5;

/** Garde-fou DEV : le tuning déclaré doit rester cohérent avec le design. */
export function assertBalanceSane(): void {
  if (!import.meta.env.DEV) return;
  const oops = (m: string): void => console.error(`[balance] ${m}`);

  // ① Le revenu attendu d'une run complète doit rester dans la fourchette du
  // design (140-180 or) : c'est lui qui calibre « environ six résurrections ».
  const lo = 6 * GOLD_FIGHT[0] + 1 * GOLD_FIGHT_HARD[0] + GOLD_BOSS;
  const hi = 6 * GOLD_FIGHT[1] + 1 * GOLD_FIGHT_HARD[1] + GOLD_BOSS;
  if (lo < 120 || hi > 200) oops(`revenu de run hors bande : ${lo}-${hi}`);

  // ② Aucun objet ne doit coûter MOINS qu'une résurrection : sauver quelqu'un
  // reste l'option la moins chère, mais ne fait pas progresser. C'est ce ratio
  // qui fait hésiter, et l'inverser retournerait toute l'économie. Le Fanion
  // usé est délibérément À ÉGALITÉ (25) : c'est le plus faible des six, et le
  // seul dont l'effet profite à toute l'escouade — l'égalité est la question.
  for (const id of ITEM_IDS) {
    if (ITEMS[id].price < REVIVE_COST) oops(`objet ${id} (${ITEMS[id].price}) < résurrection (${REVIVE_COST})`);
  }

  // ③ Le cap de ligne ne doit jamais dépasser le cap d'escouade, sinon la
  // « répartition libre » autoriserait une ligne que l'escouade ne peut remplir.
  if (FRONT_CAP_TIGHT > SQUAD_CAP) oops('cap de front > cap d’escouade');

  // ④ Toute composition déclarée doit être une clé du bestiaire.
  for (const pack of [...PACKS_EASY, ...PACKS_HARD, BOSS_PACK, BOSS_SUMMONS]) {
    for (const id of pack) if (!ENEMIES[id]) oops(`ennemi inconnu dans un pack : ${id}`);
  }

  // ⑤ Un combat standard ne doit jamais tenir plus que le cap de ligne × 2 :
  // un 5e ennemi n'aurait aucun emplacement où se poser.
  for (const pack of [...PACKS_EASY, ...PACKS_HARD]) {
    if (pack.length > LINE_CAP * 2) oops(`pack de ${pack.length} ennemis : plus de place que de lignes`);
  }

  // ⑥ Les capacités déclarées doivent être connues du moteur.
  const known: readonly AbilityId[] = [
    'secondWind', 'taunt', 'momentum', 'aimed', 'brew', 'runicVolley', 'pack', 'stalker', 'litany', 'jailer',
  ];
  for (const d of [...Object.values(CLASSES), ...Object.values(ENEMIES)]) {
    if (d.ability && !known.includes(d.ability)) oops(`capacité inconnue : ${d.ability} (${d.id})`);
  }
}
