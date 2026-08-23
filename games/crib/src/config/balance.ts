/**
 * Tout le tuning de Berceau. Invariant du repo : aucune constante de gameplay
 * ailleurs que dans ce fichier.
 *
 * La mécanique centrale est l'ENGLUEMENT : le bébé n'a pas de PV, le contact
 * ennemi le ralentit jusqu'à l'immobilisation. La seule défaite est la chute du
 * berceau. Les constantes GRIP_* sont donc les plus sensibles du fichier — voir
 * les trois garde-fous documentés sur GRIP_DECAY et GRIP_CONTACT_CAP.
 */

// ---------------------------------------------------------------- cadre logique

/** Résolution logique du canvas (letterbox CSS par-dessus), commune au hub. */
export const DESIGN_W = 540;
export const DESIGN_H = 960;

/**
 * L'arène est plus grande que l'écran — premier jeu du hub dans ce cas. Le monde
 * est en coordonnées absolues [0..ARENA_W] × [0..ARENA_H] et c'est la CAMÉRA qui
 * bouge (`layers.world.position`), jamais les entités.
 */
export const ARENA_W = 1080;
export const ARENA_H = 1440;

/**
 * Borne SUPÉRIEURE des arènes. Elle ne décrit aucune carte : elle sert à
 * dimensionner UNE FOIS la grille spatiale, qu'on ne réalloue donc jamais d'une
 * carte à l'autre (les cellules extérieures d'une petite carte restent vides, c'est
 * gratuit). Toute carte plus grande casserait la grille en silence.
 */
export const MAX_ARENA_W = 1920;
export const MAX_ARENA_H = 2560;

/**
 * Côté d'une tuile du masque de terrain. 24 divise exactement 1080 et 1440, reste
 * plus petit que le diamètre du bébé (26 px, donc aucun mur ne peut « rentrer » dans
 * lui sans être vu par la sonde), et vaut 8× son déplacement maximal par tick
 * (168 / 60 = 2,8 px) — aucun tunneling n'est possible, donc aucun test balayé.
 */
export const TERRAIN_TILE = 24;

/** Le berceau est au centre exact de l'arène, immobile toute la partie. */
export const CRIB_X = ARENA_W / 2;
export const CRIB_Y = ARENA_H / 2;

/**
 * Rayon d'apparition du BOSS quand aucune voie ne lui est assignée. Les vagues, elles,
 * entrent désormais par le premier nœud de leur voie, posé hors de l'arène : c'est la
 * géométrie de la carte, et non plus un rayon, qui garantit qu'un ennemi n'apparaît
 * jamais à l'écran.
 */
export const SPAWN_RING = 560;

// -------------------------------------------------------------------- caméra

/**
 * Deadzone : la caméra ne suit le bébé que s'il sort de ce rectangle centré.
 * Sans elle, le moindre micro-ajustement fait nager tout l'écran (nausée garantie
 * sur un jeu où l'on corrige sa trajectoire en permanence).
 */
export const CAM_DEADZONE_X = 70;
export const CAM_DEADZONE_Y = 110;
/** Vitesse de rattrapage de la caméra (fraction/s, lissage exponentiel). */
export const CAM_LERP = 7;

// ---------------------------------------------------------------------- bébé

export const HERO_SPEED = 168; // px/s à grip nul
export const HERO_RADIUS = 13; // rayon de collision (contacts, engluement)
export const HERO_PICK_RADIUS = 24; // rayon de ramassage, volontairement plus large

/** Accélération/freinage : lissage exponentiel du vecteur vitesse (fraction/s). */
export const HERO_ACCEL = 13;

/**
 * Distance parcourue entre deux frames de rampe. La phase d'animation est indexée
 * sur la DISTANCE et non sur le temps : l'animation ralentit donc exactement au
 * rythme de l'engluement, et se figeage à l'immobilisation. C'est ce détail qui
 * fait lire la mécanique sans regarder la jauge.
 */
export const HERO_STRIDE = 11;
/** Amplitude du squash/stretch de course (rendu uniquement). */
export const HERO_SQUASH = 0.09;
/** Au-delà de ce grip, le bébé se tortille visiblement pour se dégager. */
export const HERO_STRUGGLE_FROM = 0.5;

// ------------------------------------------------------------------ ENGLUEMENT

/**
 * Le grip CONVERGE vers une cible dérivée de la charge, il ne s'intègre PAS sans
 * borne. C'est la correction la plus importante du modèle : avec une simple
 * intégration, n'importe quel contact finissait par saturer la jauge, donc une
 * SEULE mamie clouait le bébé au sol — le contact était binaire (« libre » ou
 * « cloué ») au lieu d'être un gradient, et l'archétype tank perdait son rôle de
 * menace qu'on peut kiter.
 *
 *   cible = min(1, charge / GRIP_LOAD_FOR_PIN)      charge = Σ gripMul des contacts
 *   speed = HERO_SPEED × (1 - grip)                 (linéaire : la jauge NE MENT pas)
 *
 * Il faut donc littéralement PLUSIEURS agrippeurs pour immobiliser. Barème obtenu :
 * une mamie seule → 50 % de vitesse (pénible, mais on s'échappe : elle avance à 34
 * quand on va encore à 84) ; deux mamies → cloué ; une couche au passage → 17 % ;
 * trois sacs à poussière → 75 %.
 */
export const GRIP_LOAD_FOR_PIN = 3.2;

/**
 * Vitesse de MONTÉE vers la cible (fraction/s). Volontairement vive : la prise doit
 * se sentir dans la frame où elle arrive, sinon on ne relie pas la cause à l'effet.
 */
export const GRIP_RISE = 3.5;

/**
 * Nombre de contacts comptés AU PLUS dans la charge. Sans ce plafond, une meute de
 * dix pousse la cible si loin au-dessus de 1 que tuer les trois plus proches ne
 * change rien : le joueur reste cloué sans comprendre ce qu'il devrait abattre.
 * Avec le plafond, la charge est bornée, donc abattre les trois plus proches suffit
 * TOUJOURS à faire retomber la cible.
 */
export const GRIP_CONTACT_CAP = 3;

/**
 * Récupération, en fraction/s, dès la frame où la charge redescend : pas de fenêtre
 * de grâce, pas de rampe. 1.4/s = retour à zéro en ~0,7 s depuis l'immobilisation.
 * GARDE-FOU : ralentir ce decay transformerait `grip = 1` en game-over déguisé.
 */
export const GRIP_DECAY = 1.4;

/** Seuil d'immobilisation totale. Le bébé TIRE TOUJOURS à cette valeur. */
export const GRIP_PIN = 1;

/** Au-delà, la vignette d'écran pulse : le signal « tu es en train de coller ». */
export const GRIP_VIGNETTE_FROM = 0.45;

/** Durée d'immunité au grip donnée par le doudou — la porte de sortie d'un pinning. */
export const GRIP_IMMUNE_TIME = 6;

// ------------------------------------------------------------------- tir auto

export const HERO_DPS = 30;
export const HERO_RATE = 3.2; // balles/s ; les dégâts par balle en sont DÉRIVÉS
export const HERO_RANGE = 195; // portée d'acquisition ET de vol des projectiles
export const BULLET_SPEED = 400;
export const BULLET_RADIUS = 7;

/**
 * Marge de portée des projectiles au-delà du rayon d'acquisition : une cible
 * acquise à la limite qui s'éloigne d'un cheveu ne doit pas faire disparaître la
 * balle sous le nez du joueur.
 */
export const BULLET_REACH_MARGIN = 40;

// ------------------------------------------------------------------- bestiaire

export type EnemyKindId = 'granny' | 'nappy' | 'broccoli' | 'dust';

export interface EnemyDef {
  id: EnemyKindId;
  label: string;
  hp: number;
  speed: number;
  radius: number;
  /** Ce que l'ennemi cherche : le bébé (il vient te clouer) ou le berceau. */
  target: 'hero' | 'crib';
  /** `true` : s'arrête au contact du bébé et s'accroche. `false` : il traverse. */
  cling: boolean;
  /** Multiplicateur de GRIP_PER_CONTACT tant qu'il touche le bébé. */
  gripMul: number;
  /** Dégâts/s infligés au berceau au contact (0 si `target: 'hero'`). */
  cribDps: number;
  /** > 0 : s'arrête à cette distance du berceau et bombarde le bébé de pois. */
  shootRange: number;
  /** Rayon de la flaque engluante laissée à la mort (0 = aucune). */
  puddle: number;
  /** Teinte de la gerbe de particules à la mort. */
  color: number;
  /** Probabilité de lâcher un ramassable. */
  dropChance: number;
}

/**
 * Trois rôles distincts et un renfort de boss. Le point de conception : le
 * CIBLAGE diffère par archétype, et c'est de là que vient la tension. La mamie ne
 * touche jamais le berceau — sa menace est de te CLOUER pendant que les autres
 * passent.
 */
export const ENEMY_KINDS = [
  {
    id: 'granny',
    label: 'Mamie bisous',
    hp: 46,
    speed: 34,
    radius: 15,
    target: 'hero',
    cling: true,
    gripMul: 1.6,
    cribDps: 0,
    shootRange: 0,
    puddle: 0,
    color: 0xc9b4d4,
    dropChance: 0.34,
  },
  {
    id: 'nappy',
    label: 'Couche sale',
    hp: 12,
    speed: 84,
    radius: 11,
    target: 'crib',
    cling: false, // elle te frôle et continue : le grip du passage, pas du clouage
    gripMul: 0.55,
    // LE terme dominant du budget de dégâts du jeu, et il n'est borné par rien :
    // une vague entière parvenue au berceau cumule son cribDps. À 6, six couches
    // faisaient 36/s — un berceau plein tombait en 5 s, sans recours, pendant qu'on
    // était engagé sur le boss. À 3.5 : une fuite isolée est un souci (69 s), une
    // vague entière reste une crise (11 s). Ne pas remonter sans retoucher CRIB_HP.
    cribDps: 3.5,
    shootRange: 0,
    puddle: 46, // punit le farm au corps-à-corps : le terrain devient collant
    color: 0x9a8a4e,
    dropChance: 0.12,
  },
  {
    id: 'broccoli',
    label: 'Brocoli',
    hp: 26,
    speed: 46,
    radius: 12,
    target: 'crib',
    cling: false,
    gripMul: 0.3,
    // 0 : il ne mord jamais le berceau, il s'arrête bien avant. Sa pression sur le
    // berceau passe par ses POIS (PEA_CRIB_DMG) — d'où l'intérêt d'aller le chercher.
    cribDps: 0,
    shootRange: 215, // s'arrête loin du berceau et bombarde : LA raison de bouger
    puddle: 0,
    color: 0x6f9a44,
    dropChance: 0.22,
  },
  {
    id: 'dust',
    label: 'Sac à poussière',
    hp: 9,
    speed: 98,
    radius: 9,
    target: 'hero',
    cling: true,
    gripMul: 0.8,
    cribDps: 0,
    shootRange: 0,
    puddle: 0,
    color: 0x9b9384,
    dropChance: 0,
  },
] as const satisfies readonly EnemyDef[];

export const KIND_GRANNY = 0;
export const KIND_NAPPY = 1;
export const KIND_BROCCOLI = 2;
export const KIND_DUST = 3;

/** Index de pool depuis l'id déclaré dans un `LevelDef` (données → runtime). */
export function kindIndex(id: EnemyKindId): number {
  const i = ENEMY_KINDS.findIndex((k) => k.id === id);
  if (i < 0) throw new Error(`ennemi inconnu : ${id}`);
  return i;
}

/** Lissage du pilotage horizontal/vertical vers la cible (fraction/s). */
export const ENEMY_TURN = 4.5;
/** Distance sous laquelle un ennemi `cling` cesse d'avancer (il est accroché). */
export const CLING_SLACK = 2;

// ------------------------------------------------------------- pois du brocoli

export const PEA_SPEED = 165;
export const PEA_RADIUS = 6;
/** Grip posé d'un coup par un pois qui touche — un impact vaut ~1/4 de jauge. */
export const PEA_GRIP = 0.24;
export const PEA_LIFE = 3.2;
/** Intervalle entre deux salves de pois, tiré dans cette plage. */
export const BROCCOLI_INTERVAL: readonly [number, number] = [2, 3.2];

/**
 * Au-delà de cette distance, le brocoli renonce au bébé et BOMBARDE LE BERCEAU.
 * Sans ça il devenait ignorable : trop loin pour te toucher, incapable de mordre,
 * donc gratuit. Là, l'ignorer coûte des PV de berceau — il faut aller le chercher.
 */
export const PEA_AIM_RANGE = 270;
/** Dégâts d'un pois qui atteint le berceau. */
export const PEA_CRIB_DMG = 5;

// -------------------------------------------------------------------- flaques

export const PUDDLE_LIFE = 7;
/** Grip/s d'une flaque quand le bébé est dedans (bien moins qu'un contact vivant). */
export const PUDDLE_GRIP = 0.5;

// -------------------------------------------------------------------- berceau

/**
 * 240 et non 200 : c'est la marge qui rend la phase de boss jouable. Il faut pouvoir
 * s'engager sur l'Aspirateur — donc lâcher le berceau une quinzaine de secondes —
 * sans que la première fuite d'escorte rende la partie perdue d'avance.
 */
export const CRIB_HP = 240;
export const CRIB_RADIUS = 32;
/** Rayon de contact pour mordre le berceau (un peu plus large que le visuel). */
export const CRIB_BITE_RADIUS = 40;
/** Seuils d'usure visuelle du berceau, en fraction de PV. */
export const CRIB_WEAR = [0.66, 0.33] as const;

// ---------------------------------------------------------------- ramassables

export type PickupKindId = 'bottle' | 'blanket' | 'pacifier';

export interface PickupDef {
  id: PickupKindId;
  label: string;
  color: number;
  weight: number;
}

export const PICKUP_KINDS = [
  { id: 'bottle', label: 'Biberon', color: 0xf2e0b0, weight: 0.4 },
  { id: 'blanket', label: 'Doudou', color: 0xb98fc4, weight: 0.3 },
  { id: 'pacifier', label: 'Tétine', color: 0xe89a7c, weight: 0.3 },
] as const satisfies readonly PickupDef[];

export const PICK_BOTTLE = 0;
export const PICK_BLANKET = 1;
export const PICK_PACIFIER = 2;

export function pickupIndex(id: PickupKindId): number {
  const i = PICKUP_KINDS.findIndex((p) => p.id === id);
  if (i < 0) throw new Error(`ramassable inconnu : ${id}`);
  return i;
}

export const PICKUP_RADIUS = 13;
export const PICKUP_LIFE = 13;
/** Dernières secondes : le ramassable clignote avant de disparaître. */
export const PICKUP_BLINK = 3.5;

export const BOTTLE_TIME = 8;
export const BOTTLE_RATE_MUL = 2;
export const PACIFIER_HEAL = 40;

// ----------------------------------------------------------- boss Aspirateur

/**
 * Budget de la phase de boss, mesuré au bot et NON négociable à la légère — c'est
 * l'endroit du jeu le plus facile à casser.
 *
 * Le calcul : l'Aspirateur met ~20 s à franchir l'anneau de spawn, et le tir du bébé
 * ne porte qu'à ~70 % du temps (le cône gobe les cubes de face, il faut contourner)
 * → ~21 DPS effectifs, donc ~20 s pour 420 PV. Une fois garé au berceau il ronge à
 * 6/s : le berceau perd donc quelques dizaines de PV pendant qu'on l'achève, ce qui
 * est la tension voulue.
 *
 * Le premier tuning (900 PV, 22 dégâts/s) était injouable pour une raison
 * arithmétique et non de skill : le berceau tombait en 9 s parqué, quand tuer le
 * boss en demandait 40. Aucun déplacement ne rattrape ça — mesuré au bot, qui
 * arrivait au boss avec un berceau INTACT et le perdait quand même.
 */
export const BOSS_HP = 420;
export const BOSS_SPEED = 27;
export const BOSS_RADIUS = 34;
export const BOSS_CRIB_DPS = 6;

/** Portée du cône d'aspiration. */
export const BOSS_SUCK_RANGE = 300;
/** Demi-angle du cône, en radians (~31°). */
export const BOSS_SUCK_HALF_ANGLE = 0.55;
/** Force d'aspiration au contact, en px/s ; décroît linéairement avec la distance. */
export const BOSS_SUCK_PULL = 135;

/**
 * Vitesse de rotation de l'embout vers le bébé, en rad/s. C'EST le paramètre qui
 * rend le boss contournable au déplacement seul : à 1.1 rad/s, un bébé à pleine
 * vitesse le dépasse en vitesse angulaire tant qu'il tourne à moins de ~150 px de
 * lui (168 / 150 ≈ 1.12 rad/s), et se fait suivre s'il tourne de loin. Le
 * contournement est donc payant mais oblige à venir DANS la zone dangereuse.
 * L'augmenter rendrait le boss intouchable ; le baisser rendrait le cône décoratif.
 */
export const BOSS_TURN = 1.1;
/** Fraction de PV sous laquelle il s'enrage. */
export const BOSS_RAGE_HP = 0.4;
/** Demi-angle enragé : le contournement devient bien plus serré. */
export const BOSS_RAGE_HALF_ANGLE = 0.92;
/** Intervalle de recrachage de sacs à poussière (phase enragée seulement). */
export const BOSS_DUST_INTERVAL = 2.6;
export const BOSS_DUST_COUNT = 3;
/** Le cône englue aussi : être aspiré, c'est déjà commencer à coller. */
export const BOSS_SUCK_GRIP = 0.35;

// -------------------------------------------------------------- voies & terrain

/**
 * Demi-largeur minimale d'une voie. Le boss fait 34 px de rayon : sous 44, il
 * raclerait les bords et s'éjecterait tout seul. Vérifié au chargement.
 */
export const LANE_MIN_HALF = 44;

/** Distance max d'un emplacement de construction à la voie qu'il est censé couvrir. */
export const SLOT_MAX_LANE_DIST = 190;

/**
 * Vitesse du bébé dans une haie. Traverser doit être un ÉCHANGE — chemin plus court
 * contre vitesse moindre — et pas un cadeau : à 1, camper dans une haie serait
 * strictement meilleur que se tenir à côté, et le jeu se réduirait à trouver le bon
 * buisson.
 */
export const HEDGE_SLOW = 0.62;

/**
 * Distance à laquelle une chasseuse (`target: 'hero'`) quitte sa voie pour foncer
 * sur le bébé. Calé JUSTE au-delà de sa portée de tir (195) : l'aggro ne doit jamais
 * partir avant qu'il puisse riposter, sinon on est mordu par surprise.
 */
export const ENEMY_AGGRO_RANGE = 200;
/** Au-delà, elle décroche et rejoint sa voie. */
export const ENEMY_AGGRO_DROP = 260;

/**
 * Une chasseuse dont la distance au bébé ne décroît plus pendant ce temps abandonne
 * et rejoint sa voie. GARDE-FOU : sans lui, un bébé posté derrière une haie possède
 * une zone sûre PERMANENTE — la horde s'entasse contre le buisson et le jeu est mort
 * comme design.
 */
export const ENEMY_LOST_TIME = 2.5;

/** Étagement longitudinal des rangs au spawn, en px (anti-file indienne). */
export const SPAWN_STAGGER = 26;

/**
 * Fraction de la demi-largeur réellement occupée par le front d'une vague. À 1, les
 * rangs extérieurs frôlent le bord de la voie et raclent les virages.
 */
export const LANE_SPREAD_MAX = 0.85;

/**
 * Dispersion de vitesse entre deux ennemis d'une même vague, en fraction. Sans
 * elle, un rang entier avance au pas et se superpose exactement — moche, et
 * in-esquivable au corps à corps. Tirée DÉTERMINISTEMENT à l'apparition.
 */
export const ENEMY_SPEED_JITTER = 0.06;

/** Distance d'arrêt devant une barricade, en plus du rayon de l'ennemi. */
export const BARRICADE_STOP = 26;
/** Rayon de collision d'une barricade (elle occupe la largeur de sa voie). */
export const BARRICADE_RADIUS = 34;

// -------------------------------------------------- améliorations du bébé (niveau)

export type BabyUpgradeId = 'dps' | 'rate' | 'range' | 'speed' | 'grit';

export interface BabyUpgradeDef {
  id: BabyUpgradeId;
  icon: string;
  name: string;
  desc: string;
  /** 4 paliers : la course dure UN niveau, pas trente. */
  maxLevel: number;
  /** Gain par palier, appliqué en MULTIPLICATIF depuis le niveau (jamais cumulé). */
  per: number;
  /** Coût du palier `level` (0-based) : 50 / 80 / 128 / 205. */
  cost: (level: number) => number;
}

const babyCost = (level: number): number => Math.round(50 * Math.pow(1.6, level));

/**
 * Achetées AU BERCEAU, valables pour le niveau seulement. Elles ne touchent jamais
 * le save : l'absence de méta-progression est une décision de design, et c'est le
 * schéma de sauvegarde qui la fait respecter (rien de tout ceci n'y figure).
 *
 * `grit` est la seule qui parle à la mécanique centrale : à 4 paliers, `gritDiv`
 * vaut 1,6 — deux mamies ne clouent plus, trois oui. Volontairement le palier le
 * plus cher en ressenti : rendre l'engluement indolore tuerait le jeu.
 */
export const BABY_UPGRADES = [
  { id: 'dps', icon: '\u{1F9F8}', name: 'Cubes lourds', desc: 'Dégâts +18 % par palier', maxLevel: 4, per: 0.18, cost: babyCost },
  { id: 'rate', icon: '\u{1F37C}', name: 'Petits bras vifs', desc: 'Cadence +12 % par palier', maxLevel: 4, per: 0.12, cost: babyCost },
  { id: 'range', icon: '\u{1F441}', name: 'Bon oeil', desc: 'Portée +10 % par palier', maxLevel: 4, per: 0.1, cost: babyCost },
  { id: 'speed', icon: '\u{1F45F}', name: 'Genoux rodés', desc: 'Vitesse +8 % par palier', maxLevel: 4, per: 0.08, cost: babyCost },
  { id: 'grit', icon: '\u{1F9FC}', name: 'Peau savonnée', desc: 'Engluement divisé par 1,15 par palier', maxLevel: 4, per: 0.15, cost: babyCost },
] as const satisfies readonly BabyUpgradeDef[];

export function babyUpgrade(id: BabyUpgradeId): BabyUpgradeDef {
  const d = BABY_UPGRADES.find((u) => u.id === id);
  if (!d) throw new Error(`amélioration inconnue : ${id}`);
  return d;
}

// ----------------------------------------------------------------- pools/grille

export const MAX_ENEMIES = 460;
export const MAX_BULLETS = 300;
export const MAX_PEAS = 140;
export const MAX_PICKUPS = 28;
export const MAX_PUDDLES = 36;

export const GRID_CELL = 64;
/**
 * Marge NÉGATIVE de la grille, en cellules. Les amorces de voies posent les ennemis
 * HORS de l'arène (coordonnées négatives) et `SpatialGrid.insert` ignore
 * SILENCIEUSEMENT tout index hors bornes : un ennemi ignoré devient un « fantôme »
 * qui agit sans être ciblable — exactement le bug d'équité mesuré dans Essaim. Le
 * bébé posté au bord tire à 195 px dans l'amorce, il faut donc que la grille l'y
 * couvre.
 */
export const GRID_MARGIN_CELLS = 6;
/** Dimensionnée sur la PLUS GRANDE arène : jamais réallouée d'une carte à l'autre. */
export const GRID_COLS = Math.ceil(MAX_ARENA_W / GRID_CELL) + 1 + GRID_MARGIN_CELLS * 2;
export const GRID_ROWS = Math.ceil(MAX_ARENA_H / GRID_CELL) + 1 + GRID_MARGIN_CELLS * 2;
/**
 * DOIT rester large. Un insert au-delà du plafond est ignoré silencieusement par
 * `SpatialGrid` : l'entité devient un « fantôme » qui agit sans être ciblable —
 * exactement le bug d'équité mesuré dans Essaim.
 */
export const GRID_MAX_PER_CELL = 128;

// -------------------------------------------------------------------- interface

/** Rayon max du joystick virtuel, en pixels logiques. */
export const STICK_RADIUS = 62;
/** Déplacement du doigt en deçà duquel on considère le stick au repos. */
export const STICK_DEADZONE = 6;

/** Marge du bord d'écran où s'affiche la boussole du berceau. */
export const COMPASS_MARGIN = 34;

// ------------------------------------------------------------------ mode stress

/** `?stress` : nombre d'ennemis balancés d'un coup pour mesurer le budget de rendu. */
export const STRESS_COUNT = 400;
