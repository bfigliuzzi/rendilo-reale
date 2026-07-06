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
export const START_SQUAD = 8;
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
export const SOLDIER_DPS = 10;
export const FIRE_RATE_PER_SOLDIER = 5;
export const FIRE_SOLDIER_CAP = 48; // cadence max = 48 × 5 = 240 balles/s
export const BULLET_SPEED = 760;
export const BULLET_RADIUS = 5;
export const BULLET_X_JITTER = 60;
// aim-assist : les balles dévient vers l'ennemi le plus proche dans ce cône frontal
export const BULLET_AIM_RANGE_X = 170;
export const BULLET_AIM_MAX_VX = 220;

// Pools
export const MAX_BULLETS = 1500;
export const MAX_ENEMIES = 1350;

// Grille de collisions (couvre la bande visible + portée des balles)
export const GRID_CELL = 64;
export const GRID_COLS = 9; // 9 × 64 = 576 ≥ 540
export const GRID_ROWS = 18; // 18 × 64 = 1152 ≥ 920 devant + 200 derrière
export const GRID_AHEAD = 920;
export const GRID_MAX_PER_CELL = 64;

// Caisses
export const CRATE_CONTACT_KILLS = 12;
export const CRATE_HALF_W = 85;
export const CRATE_HALF_H = 50;
export const CRATE_EXPLOSIVE_KILLS = 16; // contact ou explosion proche
export const EXPLOSION_RADIUS = 175; // souffle : tue les ennemis, blesse l'escouade si proche
export const EXPLOSION_BOSS_DAMAGE = 120;

// Buffs temporaires (caisses bonus)
export const BUFF_DMG_MUL = 2;
export const BUFF_DMG_DURATION = 10;
export const BUFF_SHIELD_DURATION = 8;
export const BUFF_DRONE_DURATION = 12; // drone allié : +50 % du DPS d'escouade, tir autonome
export const BUFF_DRONE_DPS_RATIO = 0.5;
export const BUFF_DRONE_FIRE_RATE = 10;
export const BUFF_GOLD_MUL = 2;
export const BUFF_GOLD_DURATION = 15;

// Mines : pièges au sol, non tirables — se repèrent et s'évitent
export const MINE_TRIGGER_R = 26; // + demi-largeur de la formation
export const MINE_RADIUS = 105; // souffle (tue aussi les ennemis proches)
export const MINE_KILLS_RATIO = 0.18;
export const MINE_KILLS_MAX = 8;

// Missiles (urgence à l'approche des portes + frappes ambiantes)
export const MISSILE_WARNING = 1.25; // délai marqueur → impact
export const MISSILE_RADIUS = 130;
export const MISSILE_KILLS = 12; // plafond — les pertes réelles sont proportionnelles à l'effectif
export const MISSILE_MIN_DIST = 700; // pas de frappes en tout début de niveau
export const MISSILE_GATE_RANGE = 650; // barrage tant qu'une porte est à moins de X devant
export const MISSILE_GATE_INTERVAL: [number, number] = [1.0, 1.7];
export const MISSILE_AMBIENT_FROM = 2500; // frappes aléatoires au-delà de cette distance
export const MISSILE_AMBIENT_INTERVAL: [number, number] = [6, 12];

// Boss
export const BOSS_RADIUS = 42;
export const BOSS_SPEED = 46;
export const BOSS_STEER = 60;
export const BOSS_CONTACT_KILLS = 20;
export const BOSS_KNOCKBACK = 260;

// Lances du boss : télégraphiées par une ligne de visée, puis tir en ligne droite
export const LANCE_TELEGRAPH = 0.85; // durée d'affichage de la ligne de visée
export const LANCE_SPEED = 520;
export const LANCE_INTERVAL: [number, number] = [2.0, 3.2]; // réduit quand le boss est blessé
export const LANCE_KILLS_RATIO = 0.15; // pertes = clamp(ratio × effectif, 2, max)
export const LANCE_KILLS_MAX = 10;
export const LANCE_RADIUS = 10;
export const MAX_LANCES = 24;

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
  { hp: 9, speed: 185, radius: 9, steer: 140 }, // 3: kamikaze — fonce et explose au contact
  { hp: 14, speed: 32, radius: 10, steer: 10 }, // 4: sniper — reste loin, tire des bolts
  { hp: 130, speed: 50, radius: 13, steer: 35 }, // 5: élite — blindée, rapide pour sa taille
];
export const KIND_KAMIKAZE = 3;
export const KIND_SNIPER = 4;

// Kamikaze : explosion au contact (rayon court, pertes proportionnelles)
export const KAMIKAZE_RADIUS = 95;
export const KAMIKAZE_KILLS_RATIO = 0.12;
export const KAMIKAZE_KILLS_MAX = 8;

// Sniper : bolts en ligne droite visant l'escouade
export const SNIPER_RANGE = 700; // ne tire que si l'escouade est à portée
export const SNIPER_INTERVAL: [number, number] = [1.6, 2.6];
export const BOLT_SPEED = 300;
export const BOLT_KILLS_RATIO = 0.08;
export const BOLT_KILLS_MAX = 5;
export const MAX_BOLTS = 48;

// Boss : volée triple (éventail) quand il passe sous 50 % de PV
export const LANCE_VOLLEY_HP = 0.5;
export const LANCE_VOLLEY_SPREAD = 0.24; // rad
