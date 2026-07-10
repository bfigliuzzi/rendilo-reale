import type { AiParams } from './levels';

// TOUT le tuning gameplay de « Essaim » vit ici — jamais de constante ailleurs.

export const DESIGN_W = 540;
export const DESIGN_H = 960;

// Nœuds — table par niveau d'upgrade. POC : une seule entrée ; le futur upgrade
// incrémentera NodeDef.level et tout (production, cap, rayon) sera dérivé d'ici.
export const NODE_LEVELS: readonly { prodPerSec: number; cap: number; radius: number }[] = [
  { prodPerSec: 1.2, cap: 60, radius: 30 },
];
export const MAX_NODES = 16;
export const ARRIVE_FRAC = 0.5; // rayon d'arrivée = fraction du rayon du nœud

// Unités en vol
export const UNIT_CAP = 600; // pool global, deux factions confondues
export const UNIT_SPEED = 90; // px/s
export const UNIT_SPEED_JITTER = 0.15; // ±15 % par unité
export const COLLIDE_R = 9; // rayon d'annihilation 1:1
export const WOBBLE_FREQ = 6; // rad/s du serpentin
export const WOBBLE_VEL_MIN = 30; // vitesse latérale du serpentin, px/s
export const WOBBLE_VEL_MAX = 80;

// Émission (un envoi = une rafale étalée, jamais un bloc instantané)
export const EMIT_INTERVAL = 0.06; // s entre deux unités d'un même flux (~16 u/s)
export const MAX_STREAMS = 32;
// Fraction du stock envoyée par ordre joueur. PAS 100 % : le stock est aussi la
// défense du nœud (capture dès que < 0) — tout envoyer rendait chaque envoi
// suicidaire (un éclaireur suffisait à retourner le nœud vidé). Re-taper la
// cible envoie la moitié suivante.
export const SEND_FRAC = 0.5;

// Grille de collision (annihilation) : 12×20 cellules de 48 px couvrent 540×960.
export const GRID_COLS = 12;
export const GRID_ROWS = 20;
export const GRID_CELL = 48;
export const GRID_MAX_PER_CELL = 24;

// Contrôles
export const TAP_RADIUS_PAD = 12; // zone de tap = max(radius + pad, TAP_RADIUS_MIN)
export const TAP_RADIUS_MIN = 34;
export const DRAG_THRESHOLD = 14; // au-delà, le geste est un drag, plus un tap

// Nuée orbitale (représentation visuelle du stock — jamais simulée)
export const ORBIT_VISUAL_CAP = 60; // points affichés max par nœud, même si stock supérieur

// IA — défauts, surchargés par LevelDef.ai
export const AI_DEFAULTS: AiParams = {
  decisionInterval: 1.2,
  aggression: 0.6,
  reserveFrac: 0.25,
  distWeight: 0.5,
  defendBias: 1.5,
  waveNodes: 3,
};
