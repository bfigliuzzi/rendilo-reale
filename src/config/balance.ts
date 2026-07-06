// Toutes les constantes de tuning du POC. Unités : px logiques (résolution 540×960), secondes.

// Écran / voie
export const DESIGN_W = 540;
export const DESIGN_H = 960;
export const SQUAD_SCREEN_Y = 780; // Y écran fixe de l'escouade
export const LANE_MIN_X = 60;
export const LANE_MAX_X = 480;
export const LANE_CENTER = 270;

// Défilement / caméra
export const SCROLL_SPEED = 130;
export const SPAWN_AHEAD = 900; // distance d'avance à laquelle le spawner déclenche les événements
export const CULL_AHEAD = 920; // au-delà : balles détruites
export const CULL_BEHIND = 200; // en-deçà derrière l'escouade : entités détruites

// Escouade
export const START_SQUAD = 5;
export const SQUAD_RENDER_CAP = 50; // soldats affichés max ; au-delà, label + scale-up
export const SQUAD_HARD_CAP = 9999;
export const SQUAD_SPACING_X = 22;
export const SQUAD_SPACING_Y = 20;
export const SOLDIER_RADIUS = 9;
export const DRAG_SENSITIVITY = 1.2;

// Tir — le DPS est découplé du nombre de balles : la cadence visuelle sature,
// les dégâts par balle compensent. « x2 » double donc exactement la vitesse de kill.
export const SOLDIER_DPS = 8;
export const FIRE_RATE_PER_SOLDIER = 5;
export const FIRE_SOLDIER_CAP = 24; // cadence max = 24 × 5 = 120 balles/s
export const BULLET_SPEED = 760;
export const BULLET_RADIUS = 5;
export const BULLET_X_JITTER = 60;

// Pools
export const MAX_BULLETS = 1500;
export const MAX_ENEMIES = 600;

// Grille de collisions (couvre la bande visible + portée des balles)
export const GRID_CELL = 64;
export const GRID_COLS = 9; // 9 × 64 = 576 ≥ 540
export const GRID_ROWS = 18; // 18 × 64 = 1152 ≥ 920 devant + 200 derrière
export const GRID_AHEAD = 920;
export const GRID_MAX_PER_CELL = 48;

// Caisses
export const CRATE_CONTACT_KILLS = 8;
export const CRATE_HALF_W = 85;
export const CRATE_HALF_H = 50;

// Ennemis
export interface EnemyKindDef {
  hp: number;
  speed: number;
  radius: number;
  steer: number; // vitesse max de pilotage horizontal vers l'escouade
}
export const ENEMY_KINDS: readonly EnemyKindDef[] = [
  { hp: 6, speed: 70, radius: 9, steer: 40 }, // 0: grunt
  { hp: 5, speed: 150, radius: 8, steer: 90 }, // 1: runner
  { hp: 50, speed: 45, radius: 15, steer: 25 }, // 2: brute
];
