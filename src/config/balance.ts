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
export const SQUAD_RENDER_CAP = 150; // soldats affichés max ; au-delà, label + scale-up
export const SQUAD_HARD_CAP = 9999;
export const SQUAD_SPACING_X = 22; // espacement max (petits effectifs)
export const SQUAD_SPACING_Y = 20;
// Formation : plus large que profonde (aspect ~2.5), compactée quand l'effectif grossit
// pour tenir dans FORM_MAX_WIDTH — la masse se densifie au lieu de s'étirer en profondeur.
export const FORM_ASPECT = 2.5;
export const FORM_MAX_COLS = 21;
export const FORM_MAX_WIDTH = 220;
export const FORM_MIN_SPACING_Y = 13;
// Au-delà du cap de rendu, le blob grossit : ×1.4 à 10× le cap, plafonné à ×1.8
export const SQUAD_SCALE_LOG = 0.4;
export const SQUAD_SCALE_MAX = 1.8;
export const SOLDIER_RADIUS = 9;
export const DRAG_SENSITIVITY = 1.2;

// Tir — le DPS est découplé du nombre de balles : la cadence visuelle sature,
// les dégâts par balle compensent. « x2 » double donc exactement la vitesse de kill.
export const SOLDIER_DPS = 8;
export const FIRE_RATE_PER_SOLDIER = 5;
export const FIRE_SOLDIER_CAP = 48; // cadence max = 48 × 5 = 240 balles/s
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
export const CRATE_CONTACT_KILLS = 12;
export const CRATE_HALF_W = 85;
export const CRATE_HALF_H = 50;

// Boss
export const BOSS_RADIUS = 42;
export const BOSS_SPEED = 46;
export const BOSS_STEER = 60;
export const BOSS_CONTACT_KILLS = 20;
export const BOSS_KNOCKBACK = 260;

// Or (multiplié par le bonus Butin de la méta)
export const GOLD_PER_KILL = 0.5;
export const GOLD_PER_CRATE = 10;
export const GOLD_PER_BOSS = 80;
export const GOLD_VICTORY_BASE = 40;
export const GOLD_VICTORY_PER_LEVEL = 20;
export const GOLD_ENDLESS_PER_100M = 3;

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
