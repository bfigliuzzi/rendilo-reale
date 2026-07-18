import { NEUTRAL, PLAYER, type AiParams, type Faction, type LevelDef } from './levels';

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

// ---- Difficulté de campagne PAR FORMULE ----
// Mesuré au bot (2026-07) : le tuning local carte par carte avait produit une
// courbe NON monotone (ruche-rivale en 6 plus facile que nuée en 5, fourmilière
// et trône infaisables — bot mort en 33-54 s). Désormais TOUS les AiParams de
// campagne dérivent d'un unique paramètre t = (n−2)/7 (n = numéro de carte
// 1-based ; la carte 1, tutoriel, reste hors courbe) par des rampes MONOTONES :
// la difficulté comportementale ne peut plus régresser d'une carte à l'autre.
// `surplusNests` = nids de départ de l'IA au-delà de ceux du joueur : chaque
// nid excédentaire produit 1.2 de puissance/s dès t=0 — c'est LE terme
// dominant du rapport de forces (stock + 60 s de production : c'est lui qui
// rendait 7-8 injouables) — la grace le compense, de moins en moins en fin de
// campagne. Les cartes ne déclarent plus que : espèce, layout, stocks
// (dénominés en puissance) et surcharges ASSUMÉES (tutoriel, désynchro de
// mêlée). Re-mesurer la courbe (`win:2`..`win:9`, 2 runs min) après TOUT
// changement ici.
function campaignAi(n: number, surplusNests: number, over: Partial<AiParams> = {}): AiParams {
  const t = (n - 2) / 7;
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  return {
    decisionInterval: r2(2.4 - 1.2 * t),
    aggression: r2(0.5 + 0.3 * t),
    reserveFrac: r2(0.3 - 0.08 * t),
    distWeight: r2(0.5 - 0.15 * t),
    defendBias: r2(1.4 + 0.3 * t),
    waveNodes: Math.round(2 + 2 * t),
    grace: Math.round(4 + 6 * t + 10 * surplusNests * (1 - t)),
    ...over,
  };
}

/** 1. Tutoriel guidé : cafards somnolents, étapes affichées au HUD. */
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
    { text: '🍯 Sur-nourris un nid plein : le surplus l’améliore (▲ : il produit plus)', goal: 'upgrade' },
    { text: '👑 Élimine les cafards : capture leur nid !', goal: 'win' },
  ],
};

/** 2. Tutoriel de fait : symétrie parfaite, IA douce et peu coordonnée. */
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
  factions: [{ species: 'bee' }, { species: 'roach', ai: campaignAi(2, 0) }],
};

/** 3. Un couloir riche à gauche, pauvre à droite : premier vrai choix d'ouverture. */
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
  factions: [{ species: 'bee' }, { species: 'roach', ai: campaignAi(3, 0) }],
};

/** 6. La Nuée : la pression de masse des mouches, à deux nids contre un. */
const NUEE: LevelDef = {
  id: 'nuee',
  name: 'La Nuée',
  nodes: [
    { x: 270, y: 850, faction: PLAYER, stock: 30 },
    // 2×7 : même contenus, deux nids produisent +144 de puissance en 60 s —
    // à 2×10 le bot mourait en 48 s, sous la courbe du slot 6 (mesuré)
    { x: 150, y: 130, faction: FOE, stock: 7 },
    { x: 390, y: 130, faction: FOE, stock: 7 },
    { x: 100, y: 560, faction: NEUTRAL, stock: 10 },
    { x: 440, y: 560, faction: NEUTRAL, stock: 10 },
    { x: 270, y: 650, faction: NEUTRAL, stock: 14 },
    { x: 270, y: 460, faction: NEUTRAL, stock: 18 },
    { x: 100, y: 330, faction: NEUTRAL, stock: 8 },
    { x: 440, y: 330, faction: NEUTRAL, stock: 8 },
  ],
  // vagues bornées à 2 et grace 18 : l'identité de la carte est le SIÈGE de
  // masse, pas le blitz — à waveNodes 3 (formule) le rush 2-nids tuait en
  // 35 s, et la première vague à grace 12 fauchait l'expansion en 48 s pile
  // (mesuré au bot ×4) ; l'orage doit laisser le temps de se retrancher
  factions: [{ species: 'bee' }, { species: 'fly', ai: campaignAi(6, 1, { waveNodes: 2, grace: 18 }) }],
};

/** 5. Deux rives, première rencontre avec les mouches : symétrie 2v2, le centre est un nid niveau 1 très convoité. */
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
  factions: [{ species: 'bee' }, { species: 'fly', ai: campaignAi(5, 0) }],
};

/** 4. La Ruche rivale : miroir parfait contre des abeilles ennemies — ta première guerre contre tes semblables. */
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
  factions: [{ species: 'bee' }, { species: 'bee', ai: campaignAi(4, 0) }],
};

/** 7. Les rivales partent à deux nids et coordonnent trois fronts : défendre devient un métier. */
const FOURMILIERE: LevelDef = {
  id: 'fourmiliere',
  name: 'La Fourmilière',
  nodes: [
    { x: 270, y: 850, faction: PLAYER, stock: 30 },
    // 2×15 (et non 24) : le 2e nid IA produit déjà +72 de puissance sur les
    // 60 premières secondes — à 2×24 le rapport de forces initial était de
    // 1.9:1, mesuré infaisable (bot ET joueur)
    { x: 130, y: 130, faction: FOE, stock: 15 },
    { x: 410, y: 130, faction: FOE, stock: 15 },
    { x: 100, y: 640, faction: NEUTRAL, stock: 8 },
    { x: 440, y: 640, faction: NEUTRAL, stock: 8 },
    { x: 270, y: 700, faction: NEUTRAL, stock: 12 },
    { x: 100, y: 420, faction: NEUTRAL, stock: 12 },
    { x: 440, y: 420, faction: NEUTRAL, stock: 12 },
    { x: 270, y: 500, faction: NEUTRAL, stock: 22 },
    { x: 270, y: 290, faction: NEUTRAL, stock: 14 },
  ],
  factions: [{ species: 'bee' }, { species: 'bee', ai: campaignAi(7, 1) }],
};

/** 8. Le Trône : la reine rivale sur un nid-forteresse niveau 2, IA rapide qui mobilise large. */
const TRONE: LevelDef = {
  id: 'trone',
  name: 'Le Trône',
  nodes: [
    // départ joueur renforcé (40) : la forteresse L2 produit 2.8 de
    // puissance/s quoi qu'il arrive — c'est l'ouverture du joueur qu'on
    // muscle, pas l'identité de la carte qu'on rabote (bot mort ~40 s sinon)
    { x: 270, y: 850, faction: PLAYER, stock: 40 },
    { x: 270, y: 120, faction: FOE, stock: 30, level: 2 },
    { x: 120, y: 250, faction: FOE, stock: 6 },
    { x: 420, y: 250, faction: FOE, stock: 6 },
    { x: 100, y: 700, faction: NEUTRAL, stock: 8 },
    { x: 440, y: 700, faction: NEUTRAL, stock: 8 },
    { x: 100, y: 490, faction: NEUTRAL, stock: 12 },
    { x: 440, y: 490, faction: NEUTRAL, stock: 12 },
    { x: 270, y: 560, faction: NEUTRAL, stock: 20, level: 1 },
    { x: 270, y: 370, faction: NEUTRAL, stock: 16 },
  ],
  // grace élargie : rampe d'approche de la forteresse — sa production L2
  // domine le rapport de forces quoi qu'il arrive, c'est l'ouverture qui
  // doit laisser respirer (mesuré : mort du bot en ~34-46 s à grace 12-16,
  // toujours sur la première vague coordonnée)
  factions: [{ species: 'bee' }, { species: 'bee', ai: campaignAi(8, 2, { grace: 19 }) }],
};

/** 9. La Guerre des clans : mêlée finale à trois — mouches et cafards se battent AUSSI entre eux. */
const GUERRE_DES_CLANS: LevelDef = {
  id: 'guerre-des-clans',
  name: 'La Guerre des clans',
  nodes: [
    { x: 270, y: 835, faction: PLAYER, stock: 30 },
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
    // mêlée : vagues bornées à 3 (deux fronts chacun) et tempos DÉSYNCHRONISÉS
    // entre clans (sinon leurs vagues se croisent en rythme et convergent sur
    // le joueur) — seules surcharges assumées de la formule
    { species: 'fly', ai: campaignAi(9, 1, { waveNodes: 3 }) },
    { species: 'roach', ai: campaignAi(9, 1, { decisionInterval: 1.35, waveNodes: 3, grace: 12 }) },
  ],
};

// Ordre = courbe de difficulté MESURÉE (bot win:2..win:9) : la ruche rivale
// (miroir 1v1, la plus abordable des intermédiaires) précède les deux cartes
// mouches ; toute permutation = re-mesurer la courbe ET réaligner les appels
// campaignAi(n, …) sur les nouveaux numéros.
export const MAPS: readonly LevelDef[] = [
  EVEIL,
  CLAIRIERE,
  VERGER,
  RUCHE_RIVALE,
  RIVIERE,
  NUEE,
  FOURMILIERE,
  TRONE,
  GUERRE_DES_CLANS,
];
