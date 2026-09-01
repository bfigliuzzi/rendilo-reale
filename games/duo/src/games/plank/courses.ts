/**
 * `plank` (§3.1) — les 6 parcours, écrits À LA MAIN, de difficulté croissante.
 * Pure donnée : aucun tirage, aucun `Math.random`, rien qui dépende du seed —
 * une manche de `plank` est donc IDENTIQUE à chaque lancement, ce qui est le
 * point de départ le plus simple pour le scénario `physics` du bot (§7).
 *
 * Repère LOCAL du plateau, indépendant de l'écran : 0..COURT_W × 0..COURT_H,
 * origine en haut-gauche. `index.ts`/`view.ts` placent ce rectangle au centre
 * du tiers central de la posture `side` (960×540) ; `model.ts` ne connaît que
 * ce repère local, jamais l'écran — c'est ce qui le garde PUR.
 *
 * Terrain (§3.1) : des rectangles pleins qui BLOQUENT la bille (murs, et le
 * bord du plateau lui-même, ajouté par `model.ts`), des disques « trou noir »
 * qui ne bloquent RIEN mais renvoient au point de contrôle dès que le CENTRE
 * de la bille y entre, et un disque « trou de sortie » (toujours vert, §3.1)
 * qui termine le parcours dans les mêmes conditions.
 *
 * `⭐` (§1.3) rétrécit les trous et agrandit la sortie — appliqué par
 * `model.ts` à la construction, jamais ici : ce fichier ne connaît que la
 * géométrie DE BASE, commune aux deux réglages.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Disc {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface PlankCourse {
  readonly name: string;
  readonly start: { readonly x: number; readonly y: number };
  readonly walls: readonly Rect[];
  readonly holes: readonly Disc[];
  readonly goal: Disc;
}

/** Taille du plateau, en pixels LOGIQUES locaux. Carré : lisible dans les deux
 *  moitiés du repère `side` (960×540) une fois centré dans le tiers du milieu. */
export const COURT_W = 420;
export const COURT_H = 420;

/**
 * Les 6 parcours (§3.1) : 1 couloir droit → 2 virage → 3 première fosse →
 * 4 chicane → 5 pont étroit → 6 spirale. Chaque géométrie est vérifiée HORS du
 * jeu — départ non bloqué et JAMAIS dans un trou (sinon le replacement boucle à
 * l'infini), sortie atteignable, aucun disque qui chevauche un mur ou déborde
 * de la plaque — et elle l'est DANS LES DEUX RÉGLAGES ⭐ : l'aide agrandit la
 * sortie de 30 %, c'est donc le réglage aidé qui décide des marges, pas la
 * géométrie nue. Trois débordements avaient survécu à une vérification faite
 * sans l'aide (sortie 4 et trous 5 hors plaque, sortie 6 par-dessus deux murs).
 * À refaire après toute retouche de coordonnées.
 */
export const PLANK_COURSE_DATA: readonly PlankCourse[] = [
  {
    // 1 — couloir droit : un seul geste (incliner à droite) suffit. Zéro trou :
    // la première manche n'enseigne que « incliner fait rouler la bille ».
    name: 'Le couloir',
    start: { x: 50, y: 210 },
    walls: [
      { x: 0, y: 0, w: 420, h: 150 },
      { x: 0, y: 270, w: 420, h: 150 },
    ],
    holes: [],
    goal: { x: 370, y: 210, r: 30 },
  },
  {
    // 2 — virage en L : le couloir tourne, la sortie n'est plus dans l'axe du
    // départ. Premier parcours qui a VRAIMENT besoin des deux inclinaisons.
    name: 'Le virage',
    start: { x: 40, y: 80 },
    walls: [{ x: 0, y: 160, w: 280, h: 260 }],
    holes: [],
    goal: { x: 350, y: 380, r: 30 },
  },
  {
    // 3 — première fosse : la ligne droite passe PILE sur le trou, il faut le
    // contourner. Une chute coûte 3 secondes (replacement immédiat), pas la
    // manche (§3.1).
    name: 'La fosse',
    start: { x: 40, y: 220 },
    walls: [
      { x: 0, y: 0, w: 420, h: 50 },
      { x: 0, y: 390, w: 420, h: 30 },
    ],
    holes: [{ x: 210, y: 220, r: 34 }],
    goal: { x: 380, y: 220, r: 30 },
  },
  {
    // 4 — chicane : trois murs en quinconce, l'ouverture alterne bas / haut /
    // bas. Il faut désormais TENIR une inclinaison le temps de traverser
    // l'ouverture, pas juste la donner une fois.
    name: 'La chicane',
    start: { x: 30, y: 210 },
    walls: [
      { x: 80, y: 0, w: 60, h: 280 }, // ouverture en BAS (y 280-420)
      { x: 220, y: 140, w: 60, h: 280 }, // ouverture en HAUT (y 0-140)
      { x: 320, y: 0, w: 60, h: 280 }, // ouverture en BAS (y 280-420)
    ],
    holes: [],
    goal: { x: 380, y: 350, r: 28 },
  },
  {
    // 5 — pont étroit : deux bandes de trous qui se chevauchent (aucune
    // brèche) encadrent un couloir de 110 px — largement plus large que la
    // bille (28 px de diamètre), la difficulté est de GARDER l'inclinaison Y
    // proche de zéro pendant que P0 pousse en X, pas un tracé de précision.
    // Rayons et positions calés pour que CHAQUE disque tienne dans la plaque :
    // un trou qui déborde du plateau se peint sur le fond de page et ment sur
    // l'étendue réelle du danger.
    name: 'Le pont',
    start: { x: 30, y: 210 },
    walls: [],
    holes: [40, 116, 192, 268, 344, 380].flatMap((x) => [
      { x, y: 115, r: 40 },
      { x, y: 305, r: 40 },
    ]),
    goal: { x: 378, y: 210, r: 30 },
  },
  {
    // 6 — spirale : un anneau extérieur (ouvert en haut) puis un bloc central
    // à contourner pour rejoindre la sortie nichée en dessous — deux détours
    // imbriqués, la dernière difficulté de la manche.
    name: 'La spirale',
    start: { x: 30, y: 30 },
    walls: [
      { x: 60, y: 60, w: 60, h: 300 }, // bras gauche de l'anneau
      { x: 300, y: 60, w: 60, h: 300 }, // bras droit de l'anneau
      { x: 60, y: 300, w: 300, h: 60 }, // bras bas de l'anneau (ouvert en haut)
      { x: 180, y: 180, w: 60, h: 60 }, // bloc central à contourner
    ],
    holes: [],
    goal: { x: 210, y: 270, r: 21 }, // ×1,3 (aide ⭐) = 27,3 < les 30 px qui séparent le centre des deux murs
  },
];
