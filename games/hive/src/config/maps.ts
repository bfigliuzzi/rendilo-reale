import { NEUTRAL, PLAYER, type Faction, type LevelDef } from './levels';

// Campagne : la difficulté monte par les DONNÉES — tempo/agressivité/coordination
// des IA (AiParams), nombre et niveau des nids de départ, richesse des neutres —
// JAMAIS par l'espèce (budget égal, cf. SPECIES dans balance.ts). Les clans sont
// introduits progressivement : cafards → mouches → abeilles rivales → mêlée.
// INVARIANT : deux factions de même espèce uniquement en duel joueur-vs-rival
// (jamais deux IA de même espèce — lisibilité WCAG).
// Le joueur est toujours en bas (près du pouce), les IA en haut.
// Rappel géométrie : 540×960 logiques, rayons ≤ 42 + orbites → espacer d'au moins ~140 px.

const FOE: Faction = 2; // première faction IA
const FOE2: Faction = 3; // seconde faction IA (mêlées)

/** 0. Tutoriel guidé : cafards somnolents, étapes affichées au HUD. */
const EVEIL: LevelDef = {
  id: 'eveil',
  name: "L'Éveil",
  nodes: [
    { x: 270, y: 830, faction: PLAYER, stock: 40 },
    { x: 270, y: 150, faction: FOE, stock: 10 },
    { x: 150, y: 620, faction: NEUTRAL, stock: 6 },
    { x: 390, y: 620, faction: NEUTRAL, stock: 6 },
    { x: 270, y: 420, faction: NEUTRAL, stock: 14 },
  ],
  factions: [
    { species: 'bee' },
    {
      species: 'roach',
      ai: { decisionInterval: 3, aggression: 0.35, reserveFrac: 0.35, distWeight: 0.6, defendBias: 1.2, waveNodes: 1, grace: 30 },
    },
  ],
  tutorial: [
    { text: '🐝 Touche ta ruche pour la sélectionner', goal: 'select' },
    { text: '🎯 Touche un nid gris : tu y envoies une partie de ton essaim', goal: 'send' },
    { text: '⚔️ Insiste jusqu’à capturer le nid (son stock le défend)', goal: 'capture' },
    { text: '🍯 Nourris un nid PLEIN pour l’améliorer (▲ : il produit plus)', goal: 'upgrade' },
    { text: '👑 Élimine les cafards : capture leur nid !', goal: 'win' },
  ],
};

/** 1. Tutoriel de fait : symétrie parfaite, IA douce et peu coordonnée. */
const CLAIRIERE: LevelDef = {
  id: 'clairiere',
  name: 'La Clairière',
  nodes: [
    { x: 270, y: 810, faction: PLAYER, stock: 25 },
    { x: 270, y: 150, faction: FOE, stock: 25 },
    { x: 110, y: 650, faction: NEUTRAL, stock: 8 },
    { x: 430, y: 650, faction: NEUTRAL, stock: 8 },
    { x: 110, y: 310, faction: NEUTRAL, stock: 8 },
    { x: 430, y: 310, faction: NEUTRAL, stock: 8 },
    { x: 270, y: 480, faction: NEUTRAL, stock: 18 },
  ],
  factions: [
    { species: 'bee' },
    {
      species: 'roach',
      ai: { decisionInterval: 2.2, aggression: 0.5, reserveFrac: 0.3, distWeight: 0.5, defendBias: 1.5, waveNodes: 2 },
    },
  ],
};

/** 2. Un couloir riche à gauche, pauvre à droite : premier vrai choix d'ouverture. */
const VERGER: LevelDef = {
  id: 'verger',
  name: 'Le Verger',
  nodes: [
    { x: 270, y: 830, faction: PLAYER, stock: 25 },
    { x: 270, y: 130, faction: FOE, stock: 30 },
    { x: 100, y: 680, faction: NEUTRAL, stock: 6 },
    { x: 100, y: 480, faction: NEUTRAL, stock: 10 },
    { x: 100, y: 280, faction: NEUTRAL, stock: 6 },
    { x: 440, y: 680, faction: NEUTRAL, stock: 14 },
    { x: 440, y: 280, faction: NEUTRAL, stock: 14 },
    { x: 270, y: 480, faction: NEUTRAL, stock: 20 },
    { x: 270, y: 660, faction: NEUTRAL, stock: 10 },
  ],
  factions: [
    { species: 'bee' },
    {
      species: 'roach',
      ai: { decisionInterval: 2.3, aggression: 0.52, reserveFrac: 0.3, distWeight: 0.5, defendBias: 1.5, waveNodes: 2, grace: 5 },
    },
  ],
};

/** 3. La Nuée : première rencontre avec les mouches — pression de masse rapide. */
const NUEE: LevelDef = {
  id: 'nuee',
  name: 'La Nuée',
  nodes: [
    { x: 270, y: 850, faction: PLAYER, stock: 28 },
    { x: 150, y: 130, faction: FOE, stock: 12 },
    { x: 390, y: 130, faction: FOE, stock: 12 },
    { x: 100, y: 560, faction: NEUTRAL, stock: 10 },
    { x: 440, y: 560, faction: NEUTRAL, stock: 10 },
    { x: 270, y: 650, faction: NEUTRAL, stock: 14 },
    { x: 270, y: 460, faction: NEUTRAL, stock: 18 },
    { x: 100, y: 330, faction: NEUTRAL, stock: 8 },
    { x: 440, y: 330, faction: NEUTRAL, stock: 8 },
  ],
  factions: [
    { species: 'bee' },
    {
      species: 'fly',
      ai: { decisionInterval: 1.8, aggression: 0.58, reserveFrac: 0.26, distWeight: 0.45, defendBias: 1.4, waveNodes: 2, grace: 12 },
    },
  ],
};

/** 4. Deux rives : le centre est un nid niveau 1 très convoité (mouches véloces). */
const RIVIERE: LevelDef = {
  id: 'riviere',
  name: 'La Rivière',
  nodes: [
    { x: 160, y: 840, faction: PLAYER, stock: 28 },
    { x: 380, y: 840, faction: PLAYER, stock: 12 },
    { x: 160, y: 120, faction: FOE, stock: 28 },
    { x: 380, y: 120, faction: FOE, stock: 12 },
    { x: 100, y: 500, faction: NEUTRAL, stock: 12 },
    { x: 440, y: 500, faction: NEUTRAL, stock: 12 },
    { x: 270, y: 480, faction: NEUTRAL, stock: 24, level: 1 },
    { x: 100, y: 680, faction: NEUTRAL, stock: 8 },
    { x: 440, y: 300, faction: NEUTRAL, stock: 8 },
    { x: 270, y: 300, faction: NEUTRAL, stock: 8 },
    { x: 270, y: 680, faction: NEUTRAL, stock: 8 },
  ],
  factions: [
    { species: 'bee' },
    {
      species: 'fly',
      ai: { decisionInterval: 1.6, aggression: 0.62, reserveFrac: 0.26, distWeight: 0.45, defendBias: 1.5, waveNodes: 3, grace: 5 },
    },
  ],
};

/** 5. La Ruche rivale : miroir parfait contre des abeilles ennemies. */
const RUCHE_RIVALE: LevelDef = {
  id: 'ruche-rivale',
  name: 'La Ruche rivale',
  nodes: [
    { x: 270, y: 840, faction: PLAYER, stock: 30 },
    { x: 270, y: 140, faction: FOE, stock: 30 },
    { x: 120, y: 700, faction: NEUTRAL, stock: 8 },
    { x: 420, y: 700, faction: NEUTRAL, stock: 8 },
    { x: 120, y: 260, faction: NEUTRAL, stock: 8 },
    { x: 420, y: 260, faction: NEUTRAL, stock: 8 },
    { x: 150, y: 480, faction: NEUTRAL, stock: 14 },
    { x: 390, y: 480, faction: NEUTRAL, stock: 14 },
  ],
  factions: [
    { species: 'bee' },
    {
      species: 'bee',
      ai: { decisionInterval: 1.5, aggression: 0.65, reserveFrac: 0.25, distWeight: 0.45, defendBias: 1.5, waveNodes: 3, grace: 6 },
    },
  ],
};

/** 6. Les rivales partent à deux nids et coordonnent trois fronts : défendre devient un métier. */
const FOURMILIERE: LevelDef = {
  id: 'fourmiliere',
  name: 'La Fourmilière',
  nodes: [
    { x: 270, y: 850, faction: PLAYER, stock: 30 },
    { x: 130, y: 130, faction: FOE, stock: 24 },
    { x: 410, y: 130, faction: FOE, stock: 24 },
    { x: 100, y: 640, faction: NEUTRAL, stock: 8 },
    { x: 440, y: 640, faction: NEUTRAL, stock: 8 },
    { x: 270, y: 700, faction: NEUTRAL, stock: 12 },
    { x: 100, y: 420, faction: NEUTRAL, stock: 12 },
    { x: 440, y: 420, faction: NEUTRAL, stock: 12 },
    { x: 270, y: 500, faction: NEUTRAL, stock: 22 },
    { x: 270, y: 290, faction: NEUTRAL, stock: 14 },
  ],
  factions: [
    { species: 'bee' },
    {
      species: 'bee',
      ai: { decisionInterval: 1.4, aggression: 0.7, reserveFrac: 0.24, distWeight: 0.4, defendBias: 1.6, waveNodes: 3, grace: 7 },
    },
  ],
};

/** 7. Le Trône : la reine rivale sur un nid-forteresse niveau 2, IA rapide qui mobilise large. */
const TRONE: LevelDef = {
  id: 'trone',
  name: 'Le Trône',
  nodes: [
    { x: 270, y: 850, faction: PLAYER, stock: 30 },
    { x: 270, y: 120, faction: FOE, stock: 40, level: 2 },
    { x: 120, y: 250, faction: FOE, stock: 12 },
    { x: 420, y: 250, faction: FOE, stock: 12 },
    { x: 100, y: 700, faction: NEUTRAL, stock: 8 },
    { x: 440, y: 700, faction: NEUTRAL, stock: 8 },
    { x: 100, y: 490, faction: NEUTRAL, stock: 12 },
    { x: 440, y: 490, faction: NEUTRAL, stock: 12 },
    { x: 270, y: 560, faction: NEUTRAL, stock: 20, level: 1 },
    { x: 270, y: 370, faction: NEUTRAL, stock: 16 },
  ],
  factions: [
    { species: 'bee' },
    {
      species: 'bee',
      ai: { decisionInterval: 1.2, aggression: 0.8, reserveFrac: 0.2, distWeight: 0.35, defendBias: 1.7, waveNodes: 4, grace: 8 },
    },
  ],
};

/** 8. La Guerre des clans : mêlée finale à trois — mouches et cafards se battent AUSSI entre eux. */
const GUERRE_DES_CLANS: LevelDef = {
  id: 'guerre-des-clans',
  name: 'La Guerre des clans',
  nodes: [
    { x: 270, y: 860, faction: PLAYER, stock: 30 },
    { x: 130, y: 140, faction: FOE, stock: 20 },
    { x: 130, y: 320, faction: FOE, stock: 12 },
    { x: 410, y: 140, faction: FOE2, stock: 20 },
    { x: 410, y: 320, faction: FOE2, stock: 12 },
    { x: 270, y: 500, faction: NEUTRAL, stock: 20, level: 1 },
    { x: 100, y: 560, faction: NEUTRAL, stock: 10 },
    { x: 440, y: 560, faction: NEUTRAL, stock: 10 },
    { x: 270, y: 690, faction: NEUTRAL, stock: 12 },
    { x: 270, y: 300, faction: NEUTRAL, stock: 14 },
  ],
  factions: [
    { species: 'bee' },
    {
      species: 'fly',
      ai: { decisionInterval: 1.5, aggression: 0.7, reserveFrac: 0.22, distWeight: 0.45, defendBias: 1.4, waveNodes: 2, grace: 10 },
    },
    {
      species: 'roach',
      ai: { decisionInterval: 1.7, aggression: 0.65, reserveFrac: 0.26, distWeight: 0.45, defendBias: 1.5, waveNodes: 3, grace: 12 },
    },
  ],
};

export const MAPS: readonly LevelDef[] = [
  EVEIL,
  CLAIRIERE,
  VERGER,
  NUEE,
  RIVIERE,
  RUCHE_RIVALE,
  FOURMILIERE,
  TRONE,
  GUERRE_DES_CLANS,
];
