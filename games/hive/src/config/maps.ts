import { ENEMY, NEUTRAL, PLAYER, type LevelDef } from './levels';

// Campagne : la difficulté monte par les DONNÉES — tempo/agressivité/coordination
// de l'IA (AiParams), nombre et niveau des nids de départ, richesse des neutres.
// Le joueur est toujours en bas (près du pouce), l'IA en haut.
// Rappel géométrie : 540×960 logiques, rayons ≤ 42 + orbites → espacer d'au moins ~140 px.

/** 1. Tutoriel de fait : symétrie parfaite, IA douce et peu coordonnée. */
const CLAIRIERE: LevelDef = {
  id: 'clairiere',
  name: 'La Clairière',
  nodes: [
    { x: 270, y: 810, faction: PLAYER, stock: 25 },
    { x: 270, y: 150, faction: ENEMY, stock: 25 },
    { x: 110, y: 650, faction: NEUTRAL, stock: 8 },
    { x: 430, y: 650, faction: NEUTRAL, stock: 8 },
    { x: 110, y: 310, faction: NEUTRAL, stock: 8 },
    { x: 430, y: 310, faction: NEUTRAL, stock: 8 },
    { x: 270, y: 480, faction: NEUTRAL, stock: 18 },
  ],
  ai: { decisionInterval: 2.2, aggression: 0.5, reserveFrac: 0.3, distWeight: 0.5, defendBias: 1.5, waveNodes: 2 },
};

/** 2. Un couloir riche à gauche, pauvre à droite : premier vrai choix d'ouverture. */
const VERGER: LevelDef = {
  id: 'verger',
  name: 'Le Verger',
  nodes: [
    { x: 270, y: 830, faction: PLAYER, stock: 25 },
    { x: 270, y: 130, faction: ENEMY, stock: 30 },
    { x: 100, y: 680, faction: NEUTRAL, stock: 6 },
    { x: 100, y: 480, faction: NEUTRAL, stock: 10 },
    { x: 100, y: 280, faction: NEUTRAL, stock: 6 },
    { x: 440, y: 680, faction: NEUTRAL, stock: 14 },
    { x: 440, y: 280, faction: NEUTRAL, stock: 14 },
    { x: 270, y: 480, faction: NEUTRAL, stock: 20 },
    { x: 270, y: 660, faction: NEUTRAL, stock: 10 },
  ],
  ai: { decisionInterval: 1.9, aggression: 0.55, reserveFrac: 0.28, distWeight: 0.5, defendBias: 1.5, waveNodes: 2 },
};

/** 3. Deux rives : le centre est un nid niveau 1 très convoité. */
const RIVIERE: LevelDef = {
  id: 'riviere',
  name: 'La Rivière',
  nodes: [
    { x: 160, y: 840, faction: PLAYER, stock: 28 },
    { x: 380, y: 840, faction: PLAYER, stock: 12 },
    { x: 160, y: 120, faction: ENEMY, stock: 28 },
    { x: 380, y: 120, faction: ENEMY, stock: 12 },
    { x: 100, y: 500, faction: NEUTRAL, stock: 12 },
    { x: 440, y: 500, faction: NEUTRAL, stock: 12 },
    { x: 270, y: 480, faction: NEUTRAL, stock: 24, level: 1 },
    { x: 100, y: 680, faction: NEUTRAL, stock: 8 },
    { x: 440, y: 300, faction: NEUTRAL, stock: 8 },
    { x: 270, y: 300, faction: NEUTRAL, stock: 8 },
    { x: 270, y: 680, faction: NEUTRAL, stock: 8 },
  ],
  ai: { decisionInterval: 1.6, aggression: 0.62, reserveFrac: 0.26, distWeight: 0.45, defendBias: 1.5, waveNodes: 3, grace: 5 },
};

/** 4. L'IA part à deux nids et coordonne trois fronts : défendre devient un métier. */
const FOURMILIERE: LevelDef = {
  id: 'fourmiliere',
  name: 'La Fourmilière',
  nodes: [
    { x: 270, y: 850, faction: PLAYER, stock: 30 },
    { x: 130, y: 130, faction: ENEMY, stock: 24 },
    { x: 410, y: 130, faction: ENEMY, stock: 24 },
    { x: 100, y: 640, faction: NEUTRAL, stock: 8 },
    { x: 440, y: 640, faction: NEUTRAL, stock: 8 },
    { x: 270, y: 700, faction: NEUTRAL, stock: 12 },
    { x: 100, y: 420, faction: NEUTRAL, stock: 12 },
    { x: 440, y: 420, faction: NEUTRAL, stock: 12 },
    { x: 270, y: 500, faction: NEUTRAL, stock: 22 },
    { x: 270, y: 290, faction: NEUTRAL, stock: 14 },
  ],
  ai: { decisionInterval: 1.4, aggression: 0.7, reserveFrac: 0.24, distWeight: 0.4, defendBias: 1.6, waveNodes: 3, grace: 7 },
};

/** 5. Le Trône : un nid-forteresse niveau 2, une IA rapide qui mobilise large. */
const TRONE: LevelDef = {
  id: 'trone',
  name: 'Le Trône',
  nodes: [
    { x: 270, y: 850, faction: PLAYER, stock: 30 },
    { x: 270, y: 120, faction: ENEMY, stock: 40, level: 2 },
    { x: 120, y: 250, faction: ENEMY, stock: 12 },
    { x: 420, y: 250, faction: ENEMY, stock: 12 },
    { x: 100, y: 700, faction: NEUTRAL, stock: 8 },
    { x: 440, y: 700, faction: NEUTRAL, stock: 8 },
    { x: 100, y: 490, faction: NEUTRAL, stock: 12 },
    { x: 440, y: 490, faction: NEUTRAL, stock: 12 },
    { x: 270, y: 560, faction: NEUTRAL, stock: 20, level: 1 },
    { x: 270, y: 370, faction: NEUTRAL, stock: 16 },
  ],
  ai: { decisionInterval: 1.2, aggression: 0.8, reserveFrac: 0.2, distWeight: 0.35, defendBias: 1.7, waveNodes: 4, grace: 8 },
};

export const MAPS: readonly LevelDef[] = [CLAIRIERE, VERGER, RIVIERE, FOURMILIERE, TRONE];
