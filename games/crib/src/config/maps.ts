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
  /** Une dalle accepte UN rôle : tourelle en surplomb de voie, ou barricade EN travers. */
  accepts: 'tower' | 'barricade';
  /** Voie bouchée — obligatoire pour une barricade, car près du berceau les voies
   *  se superposent et la déduire géométriquement serait ambigu. */
  lane?: string;
  /** Nom lu au panneau d'achat et à l'`aria-live`. */
  name: string;
}

export type MapId = 'garden' | 'kitchen' | 'attic';
export type BiomeId = 'garden' | 'kitchen' | 'attic';

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
    { id: 4, x: 336, y: 444, accepts: 'barricade', lane: 'portail', name: 'la barrière du portail' },
    { id: 5, x: 792, y: 888, accepts: 'barricade', lane: 'mures', name: 'le grillage des mûres' },
  ],
};

export const MAPS: readonly MapDef[] = [GARDEN];

export function mapById(id: MapId): MapDef {
  const m = MAPS.find((x) => x.id === id);
  if (!m) throw new Error(`carte inconnue : ${id}`);
  return m;
}
