/**
 * Les CARTES, écrites entièrement à la main (modèle de `games/hive/config/maps.ts`).
 *
 * Le principe est celui du terrain tout entier : on ÉCRIT des vecteurs, on EXÉCUTE
 * un masque de tuiles (`game/terrain.ts`). Ici, donc, rien que de la géométrie
 * relisible — des polylignes qui se lisent comme des trajectoires, des rectangles
 * qu'on peut situer de tête. Le bake en tire le masque, les voies aplaties et les
 * garde-fous.
 *
 * L'AXE DE DESIGN d'une carte, c'est le nombre de voies et l'endroit où elles
 * débouchent. Le jardin en a deux, larges et bien séparées : on peut couvrir les
 * deux en faisant l'aller-retour, c'est ce qui en fait un tutoriel.
 */

/** Polyligne À PLAT : [x0,y0, x1,y1, …]. Une voie tient sur une ligne et se relit
 *  comme une trajectoire ; un tableau d'objets doublerait la hauteur du fichier. */
export type Poly = readonly number[];

export type TerrainShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'disc'; x: number; y: number; r: number }
  /** Bande d'épaisseur constante le long d'une polyligne (haie, ruisseau, plinthe). */
  | { kind: 'band'; pts: Poly; width: number };

/**
 * Le MATÉRIAU décide qui passe, et c'est le SEUL axe de vérité :
 *  - `hedge` : infranchissable pour la horde, TRAVERSABLE par le bébé mais ralenti.
 *    C'est son avantage asymétrique — il coupe, la horde contourne.
 *  - `wall`  : infranchissable pour tout le monde (muret, plan de travail, malle).
 *  - `water` : idem `wall` ; matériau distinct pour le RENDU seulement.
 *
 * Trois suffisent. Chaque matériau de plus multiplie les cas de la table de
 * collision, et aucun quatrième n'apporterait de décision de jeu nouvelle.
 */
export type TerrainMat = 'hedge' | 'wall' | 'water';

export interface TerrainPatch {
  mat: TerrainMat;
  shape: TerrainShape;
}

export interface LaneDef {
  id: string;
  /** Nom parlé : libellé du panneau de barricade et des annonces `aria-live`. */
  name: string;
  /**
   * ENTRÉE → BERCEAU. Le premier point est posé HORS de l'arène : c'est ce qui
   * remplace l'ancien `SPAWN_RING` et garantit qu'aucun ennemi n'apparaît à l'écran.
   * Le dernier point est le berceau lui-même.
   */
  pts: Poly;
  /** Demi-largeur jouable. Plancher `LANE_MIN_HALF` : le boss doit y tenir. */
  halfWidth: number;
}

export interface SlotDef {
  id: number;
  x: number;
  y: number;
  /**
   * Une dalle accepte UN rôle : tourelle en surplomb de voie, barricade EN travers,
   * ou — pour l'emplacement VIRTUEL du berceau, qui n'est jamais déclaré par une
   * carte — la boutique du bébé.
   */
  accepts: 'tower' | 'barricade' | 'crib';
  /** Voie bouchée — obligatoire pour une barricade, car près du berceau les voies
   *  se superposent et la déduire géométriquement serait ambigu. */
  lane?: string;
  /** Nom lu au panneau d'achat et à l'`aria-live`. */
  name: string;
}

export type MapId = 'garden' | 'kitchen' | 'attic';
export type BiomeId = 'garden' | 'kitchen' | 'attic';
/** Ordre de référence : sert à construire les tables indexées par biome. */
export const BIOME_IDS = ['garden', 'kitchen', 'attic'] as const satisfies readonly BiomeId[];

export interface MapDef {
  id: MapId;
  name: string;
  emoji: string;
  /** Multiples de `TERRAIN_TILE`, ≥ écran, ≤ `MAX_ARENA_*`. Vérifié au bake. */
  w: number;
  h: number;
  cribX: number;
  cribY: number;
  /** Palette de sol, matériau de voie et planche de props : le décor en DÉRIVE. */
  biome: BiomeId;
  lanes: readonly LaneDef[];
  terrain: readonly TerrainPatch[];
  slots: readonly SlotDef[];
}

/**
 * 🌿 Le jardin — la carte d'apprentissage.
 *
 * Deux voies larges, qui arrivent par le haut et par le bas-droite : elles sont
 * assez éloignées pour qu'on ne puisse pas les tenir toutes les deux au corps à
 * corps, et assez peu nombreuses pour qu'un aller-retour suffise. C'est là qu'on
 * apprend que le placement des tours répartit ce que le bébé ne peut pas couvrir.
 *
 * La haie de gauche et la mare ne barrent aucune voie : sur la carte 1, le terrain
 * enseigne le raccourci (le bébé passe la haie, les mamies la contournent) avant
 * d'enseigner le goulot, qui est le sujet de la cuisine.
 */
export const GARDEN: MapDef = {
  id: 'garden',
  name: 'Le jardin',
  emoji: '\u{1F33F}',
  w: 1080,
  h: 1440,
  cribX: 540,
  cribY: 720,
  biome: 'garden',
  lanes: [
    {
      id: 'portail',
      name: 'l’allée du portail',
      pts: [456, -96, 456, 168, 336, 336, 336, 552, 456, 672, 540, 714],
      halfWidth: 60,
    },
    {
      id: 'mures',
      name: 'le sentier des mûres',
      pts: [1176, 1152, 912, 1152, 792, 984, 792, 792, 648, 732, 540, 726],
      halfWidth: 60,
    },
  ],
  terrain: [
    // la grande haie de gauche : le raccourci du bébé, l'obstacle des mamies
    { mat: 'hedge', shape: { kind: 'band', pts: [144, 216, 144, 1224], width: 72 } },
    // le massif du fond, qui empêche de couper du portail vers les mûres
    { mat: 'hedge', shape: { kind: 'rect', x: 672, y: 168, w: 288, h: 216 } },
    // la haie du talus est : elle protège le flanc droit du berceau
    { mat: 'hedge', shape: { kind: 'rect', x: 936, y: 600, w: 120, h: 384 } },
    // la mare : infranchissable pour tous, et surtout PAS lisible comme une flaque
    { mat: 'water', shape: { kind: 'disc', x: 264, y: 1032, r: 132 } },
    // le muret de pierres : le seul abri contre l'aspiration du boss
    { mat: 'wall', shape: { kind: 'rect', x: 600, y: 408, w: 240, h: 96 } },
  ],
  slots: [
    { id: 0, x: 588, y: 240, accepts: 'tower', name: 'le tabouret nord' },
    { id: 1, x: 216, y: 456, accepts: 'tower', name: 'la brouette' },
    { id: 2, x: 672, y: 900, accepts: 'tower', name: 'le pot de fleurs' },
    { id: 3, x: 960, y: 1044, accepts: 'tower', name: 'le banc' },
    // Deux dalles au PIED du berceau. Elles manquaient, et ça s'est vu au bot : les
    // quatre premières couvrent les voies loin en amont, donc pendant la phase de
    // boss — quand le bébé est occupé à contourner l'embout — plus rien ne défendait
    // le berceau lui-même et deux couches suffisaient à le vider. Une carte doit
    // toujours offrir la possibilité de tenir son objectif sans y être.
    { id: 4, x: 432, y: 828, accepts: 'tower', name: 'le tapis d’éveil' },
    { id: 5, x: 648, y: 612, accepts: 'tower', name: 'la table à langer' },
    { id: 6, x: 336, y: 444, accepts: 'barricade', lane: 'portail', name: 'la barrière du portail' },
    { id: 7, x: 792, y: 888, accepts: 'barricade', lane: 'mures', name: 'le grillage des mûres' },
  ],
};

/**
 * 🍳 La cuisine — la carte des GOULOTS.
 *
 * Trois voies, et surtout des plans de travail qui les étranglent : chaque voie
 * passe par une porte de deux tuiles où toute une vague se met en file. C'est là
 * qu'une barricade ou un mobile musical valent le double, et c'est le sujet de la
 * carte — le jardin enseignait le raccourci, la cuisine enseigne le pincement.
 *
 * Les piles de linge jouent le rôle des haies : le bébé rampe dessous, la horde
 * contourne. Même règle, autre matière — c'est ce qui rend le langage apprenable.
 */
export const KITCHEN: MapDef = {
  id: 'kitchen',
  name: 'La cuisine',
  emoji: '\u{1F373}',
  w: 1152,
  h: 1440,
  cribX: 576,
  cribY: 744,
  biome: 'kitchen',
  lanes: [
    {
      id: 'porte',
      name: 'la porte du couloir',
      pts: [192, -96, 192, 216, 312, 384, 312, 576, 456, 696, 552, 732],
      halfWidth: 52,
    },
    {
      id: 'evier',
      name: 'le pied de l’évier',
      pts: [1248, 456, 936, 456, 816, 576, 816, 672, 672, 720, 564, 738],
      halfWidth: 52,
    },
    {
      id: 'placard',
      name: 'le placard du bas',
      pts: [648, 1536, 648, 1224, 768, 1080, 768, 960, 624, 840, 582, 780],
      halfWidth: 52,
    },
  ],
  terrain: [
    // les plans de travail : ils ÉTRANGLENT les voies. Une haie ou un mur tracé en
    // travers laisse automatiquement une porte, parce que le carve des voies passe
    // après — c'est exactement comme ça qu'on écrit un goulot.
    { mat: 'wall', shape: { kind: 'rect', x: 0, y: 216, w: 528, h: 96 } },
    { mat: 'wall', shape: { kind: 'rect', x: 624, y: 216, w: 528, h: 96 } },
    { mat: 'wall', shape: { kind: 'rect', x: 864, y: 600, w: 288, h: 96 } },
    { mat: 'wall', shape: { kind: 'rect', x: 456, y: 1104, w: 480, h: 96 } },
    // l'îlot central : il oblige à contourner pour passer d'une voie à l'autre
    { mat: 'wall', shape: { kind: 'rect', x: 240, y: 792, w: 216, h: 168 } },
    // la flaque de l'évier : infranchissable, et surtout PAS lisible comme une
    // flaque engluante (pas d'anneau, corps froid et sombre — voir mapBake)
    { mat: 'water', shape: { kind: 'disc', x: 984, y: 936, r: 120 } },
    // le linge entassé : le raccourci du bébé
    { mat: 'hedge', shape: { kind: 'band', pts: [96, 480, 96, 1080], width: 96 } },
    { mat: 'hedge', shape: { kind: 'rect', x: 912, y: 1176, w: 216, h: 168 } },
  ],
  slots: [
    { id: 0, x: 408, y: 456, accepts: 'tower', name: 'le tabouret' },
    { id: 1, x: 936, y: 768, accepts: 'tower', name: 'l’égouttoir' },
    { id: 2, x: 624, y: 1008, accepts: 'tower', name: 'la corbeille' },
    { id: 3, x: 456, y: 840, accepts: 'tower', name: 'la chaise haute' },
    { id: 4, x: 696, y: 636, accepts: 'tower', name: 'le micro-ondes' },
    { id: 5, x: 312, y: 480, accepts: 'barricade', lane: 'porte', name: 'la barrière du couloir' },
    { id: 6, x: 816, y: 624, accepts: 'barricade', lane: 'evier', name: 'le carton de l’évier' },
    { id: 7, x: 768, y: 1020, accepts: 'barricade', lane: 'placard', name: 'la porte du placard' },
  ],
};

/**
 * 🕯️ Le grenier — la carte du DOS.
 *
 * Quatre voies, dont une, le conduit, qui débouche à quelques pas du berceau :
 * elle est courte, on n'a jamais le temps de la remonter, et c'est tout son
 * propos. Le grenier oblige à DÉLÉGUER — une tour couvre le conduit pendant que
 * le bébé tient les trois autres, ou bien on renonce à l'une d'elles.
 *
 * C'est aussi la carte la plus longue (sept nuits) : c'est là que l'arbre d'achat
 * va au bout.
 */
export const ATTIC: MapDef = {
  id: 'attic',
  name: 'Le grenier',
  emoji: '\u{1F56F}',
  w: 1200,
  h: 1560,
  cribX: 600,
  cribY: 792,
  biome: 'attic',
  lanes: [
    {
      id: 'escalier',
      name: 'la trappe de l’escalier',
      pts: [456, 1656, 456, 1344, 336, 1176, 336, 1008, 480, 864, 570, 810],
      halfWidth: 54,
    },
    {
      id: 'lucarne',
      name: 'la lucarne',
      pts: [744, -96, 744, 216, 864, 384, 864, 552, 720, 696, 618, 762],
      halfWidth: 54,
    },
    {
      id: 'malles',
      name: 'la travée des malles',
      pts: [-96, 600, 216, 600, 336, 720, 480, 768, 564, 786],
      halfWidth: 54,
    },
    {
      // COURTE, et débouchant dans le dos du berceau : on ne la remonte jamais à
      // temps. C'est l'axe de design de la carte, et la raison d'être des tours.
      id: 'conduit',
      name: 'le conduit d’aération',
      pts: [1296, 984, 984, 984, 840, 912, 690, 828, 630, 810],
      halfWidth: 50,
    },
  ],
  terrain: [
    // les malles et les armoires : elles cloisonnent, et le conduit débouche
    // justement là où elles n'en protègent pas
    { mat: 'wall', shape: { kind: 'rect', x: 96, y: 216, w: 384, h: 120 } },
    { mat: 'wall', shape: { kind: 'rect', x: 936, y: 168, w: 216, h: 288 } },
    { mat: 'wall', shape: { kind: 'rect', x: 120, y: 1272, w: 240, h: 120 } },
    { mat: 'wall', shape: { kind: 'rect', x: 792, y: 1200, w: 336, h: 120 } },
    { mat: 'wall', shape: { kind: 'rect', x: 216, y: 840, w: 168, h: 120 } },
    // la fuite du toit
    { mat: 'water', shape: { kind: 'disc', x: 984, y: 672, r: 108 } },
    // les cartons empilés : le raccourci du bébé, et le seul moyen de couper vers
    // le conduit sans faire tout le tour
    { mat: 'hedge', shape: { kind: 'rect', x: 672, y: 936, w: 216, h: 168 } },
    { mat: 'hedge', shape: { kind: 'band', pts: [144, 456, 144, 1128], width: 96 } },
    { mat: 'hedge', shape: { kind: 'rect', x: 456, y: 336, w: 216, h: 144 } },
  ],
  slots: [
    { id: 0, x: 456, y: 984, accepts: 'tower', name: 'la caisse à jouets' },
    { id: 1, x: 744, y: 744, accepts: 'tower', name: 'le vieux fauteuil' },
    { id: 2, x: 456, y: 672, accepts: 'tower', name: 'le mannequin de couture' },
    { id: 3, x: 888, y: 1032, accepts: 'tower', name: 'la lampe à pétrole' },
    { id: 4, x: 216, y: 1104, accepts: 'tower', name: 'le tourne-disque' },
    { id: 5, x: 720, y: 384, accepts: 'tower', name: 'le cheval à bascule' },
    { id: 6, x: 336, y: 1128, accepts: 'barricade', lane: 'escalier', name: 'la rambarde' },
    { id: 7, x: 864, y: 480, accepts: 'barricade', lane: 'lucarne', name: 'le volet' },
    { id: 8, x: 336, y: 720, accepts: 'barricade', lane: 'malles', name: 'la malle en travers' },
    { id: 9, x: 984, y: 984, accepts: 'barricade', lane: 'conduit', name: 'la grille du conduit' },
  ],
};

export const MAPS: readonly MapDef[] = [GARDEN, KITCHEN, ATTIC];

export function mapById(id: MapId): MapDef {
  const m = MAPS.find((x) => x.id === id);
  if (!m) throw new Error(`carte inconnue : ${id}`);
  return m;
}
