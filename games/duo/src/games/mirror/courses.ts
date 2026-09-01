import { MIRROR_COURSES, SIDE_W, SIDE_ZONE_W } from '../../config/balance';

/**
 * Les 6 parcours de « Miroir cassé », écrits À LA MAIN — même choix que
 * `plank/courses.ts` (voir son commentaire « six parcours écrits à la main » /
 * `assertBalanceSane`) : le tuning PHYSIQUE (gravité, vitesse, saut, coyote)
 * vit dans `config/balance.ts`, partagé par les trois jeux temps réel ; le
 * TRACÉ de chaque parcours est un contenu propre à ce jeu, donc il vit ici.
 *
 * Repère : coordonnées LOGIQUES de la posture 'side' (960×540). Tout le
 * tracé reste dans la bande centrale [`GAME_LEFT`, `GAME_RIGHT`] — les deux
 * tiers latéraux sont réservés aux contrôles DOM des deux sièges (§1.4), le
 * canvas n'y dessine rien.
 *
 * Chaque plateforme touche le bas de l'écran (`y + h === SIDE_H`) : la scène
 * se lit comme un canyon dont seule la hauteur varie, jamais comme des blocs
 * flottants isolés — c'est ce qui rend un trou reconnaissable au premier
 * coup d'œil (le vide expose le fond sombre commun à tout le jeu).
 */

export const GAME_LEFT = SIDE_ZONE_W;
export const GAME_RIGHT = SIDE_W - SIDE_ZONE_W;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface MirrorCheckpoint {
  /** Zone qui, une fois chevauchée par le personnage, arme ce point de reprise. */
  readonly trigger: Rect;
  readonly respawnX: number;
  readonly respawnY: number;
}

export interface MirrorCourse {
  readonly platforms: readonly Rect[];
  readonly spawn: { readonly x: number; readonly y: number };
  /** Dans l'ordre du parcours : le dernier chevauché l'emporte. */
  readonly checkpoints: readonly MirrorCheckpoint[];
  /** La porte — le but visible en permanence (§1.1 critère 3). */
  readonly goal: Rect;
}

/**
 * Un point de reprise se pose comme une position de repos EXACTE (centre du
 * personnage posé sur la plateforme visée) : pas de recherche au moment de la
 * chute, juste une réapparition immédiate (§3.5), sans écran.
 */
export const COURSES: readonly MirrorCourse[] = [
  // 0 — un seul trou, tout plat : le geste de base (courir, sauter, atterrir).
  {
    platforms: [
      { x: GAME_LEFT, y: 460, w: 150, h: 80 },
      { x: 490, y: 460, w: GAME_RIGHT - 490, h: 80 },
    ],
    spawn: { x: GAME_LEFT + 40, y: 442 },
    checkpoints: [],
    goal: { x: 640, y: 390, w: 50, h: 70 },
  },

  // 1 — trou plus large, arrivée un peu plus haute (première estrade).
  {
    platforms: [
      { x: GAME_LEFT, y: 460, w: 140, h: 80 },
      { x: 500, y: 420, w: GAME_RIGHT - 500, h: 120 },
    ],
    spawn: { x: GAME_LEFT + 40, y: 442 },
    checkpoints: [],
    goal: { x: 650, y: 350, w: 50, h: 70 },
  },

  // 2 — deux trous et une plateforme entre eux : premier point de reprise.
  {
    platforms: [
      { x: GAME_LEFT, y: 460, w: 110, h: 80 },
      { x: 430, y: 460, w: 80, h: 80 },
      { x: 590, y: 460, w: GAME_RIGHT - 590, h: 80 },
    ],
    spawn: { x: GAME_LEFT + 35, y: 442 },
    checkpoints: [{ trigger: { x: 430, y: 400, w: 80, h: 60 }, respawnX: 465, respawnY: 442 }],
    goal: { x: 650, y: 390, w: 50, h: 70 },
  },

  // 3 — un mur à sauter (pas de trou : une marche qu'on ne peut PAS remonter
  // en marchant, il faut sauter par-dessus) puis un petit trou de sortie.
  {
    platforms: [
      { x: GAME_LEFT, y: 460, w: 160, h: 80 },
      { x: 410, y: 370, w: 150, h: 170 },
      { x: 600, y: 370, w: GAME_RIGHT - 600, h: 170 },
    ],
    spawn: { x: GAME_LEFT + 40, y: 442 },
    checkpoints: [{ trigger: { x: 410, y: 330, w: 150, h: 40 }, respawnX: 480, respawnY: 352 }],
    goal: { x: 660, y: 300, w: 50, h: 70 },
  },

  // 4 — on part HAUT et on descend : les trous semblent grands, mais on tombe
  // vers eux, donc on les franchit largement (un jeu volontairement rassurant
  // après le mur du parcours précédent).
  {
    platforms: [
      { x: GAME_LEFT, y: 380, w: 130, h: 160 },
      { x: 520, y: 440, w: 80, h: 100 },
      { x: 650, y: 470, w: GAME_RIGHT - 650, h: 70 },
    ],
    spawn: { x: GAME_LEFT + 40, y: 362 },
    checkpoints: [{ trigger: { x: 520, y: 400, w: 80, h: 40 }, respawnX: 560, respawnY: 422 }],
    goal: { x: 665, y: 400, w: 40, h: 70 },
  },

  // 5 — le parcours du coyote time : on grimpe par petites plateformes, puis
  // le DERNIER trou (130 px) n'est franchissable qu'en sautant pile au bord —
  // ou juste après l'avoir quitté, grâce à `MIRROR_COYOTE`.
  {
    platforms: [
      { x: GAME_LEFT, y: 460, w: 60, h: 80 },
      { x: 370, y: 430, w: 50, h: 110 },
      { x: 490, y: 390, w: 50, h: 150 },
      { x: 660, y: 460, w: GAME_RIGHT - 660, h: 80 },
    ],
    spawn: { x: GAME_LEFT + 30, y: 442 },
    checkpoints: [
      { trigger: { x: 370, y: 390, w: 50, h: 40 }, respawnX: 395, respawnY: 412 },
      { trigger: { x: 490, y: 350, w: 50, h: 40 }, respawnX: 515, respawnY: 372 },
    ],
    goal: { x: 672, y: 390, w: 36, h: 70 },
  },
];

if (COURSES.length !== MIRROR_COURSES) {
  throw new Error(`[duo/mirror] ${COURSES.length} parcours déclarés, ${MIRROR_COURSES} attendus`);
}
for (const c of COURSES) {
  if (c.platforms.length === 0) throw new Error('[duo/mirror] un parcours sans plateforme est infranchissable');
  if (c.goal.x < GAME_LEFT || c.goal.x + c.goal.w > GAME_RIGHT) {
    throw new Error('[duo/mirror] une porte déborde de la bande de jeu');
  }
}
