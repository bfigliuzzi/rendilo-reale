import type { AiParams, SpeciesId } from './levels';

// TOUT le tuning gameplay de « Essaim » vit ici — jamais de constante ailleurs.

export const DESIGN_W = 540;
export const DESIGN_H = 960;

// Factions : 0 = neutre + 3 camps max (joueur + 2 IA). Tous les compteurs
// par faction sont dimensionnés là-dessus.
export const MAX_FACTIONS = 4;

// Espèces (clans) — ÉQUILIBRAGE PAR BUDGET (pattern « armes à budget » de
// horde) : on ne déclare QUE croissance et vitesse, la puissance est DÉRIVÉE
// pour la PARITÉ D'USURE : growthMul · power ≡ 1 (débit de puissance produit
// identique pour tous — c'est CE ratio qui décide des guerres d'attrition,
// mesuré au bot : le pondérer par la vitesse faisait gagner toute guerre
// longue au clan lent). La granularité (growth/power) est ainsi
// AGRÉGAT-NEUTRE : c'est l'axe d'IDENTITÉ (nuée dense vs unités rares et
// grosses), la VITESSE est l'axe d'équilibrage résiduel.
// VALEURS CALIBRÉES au scénario `duel` de tools/verify-hive.mjs (IA identique
// des deux côtés, 4 cartes symétriques, camps alternés — re-mesurer après
// TOUT changement ici ou dans le combat). Mesures 2026-07, APRÈS correction
// des quatre fuites de parité (combat re-ciblable, fantômes de grille,
// dotation initiale, seuil d'invest IA — cf. combat.ts / spatialGrid /
// nodes.ts / ai.ts) :
// - mouche 1.5/1.3 (valeurs historiques) → ~10/6 contre abeille : sa vitesse
//   compense sa fragilité de granularité, NE PAS y toucher isolément ;
// - cafard : la lenteur 0.8 historique n'était « payée » que par ces bugs
//   (1/15 une fois corrigés — sa tankiness n'a AUCUNE valeur agrégée, le
//   combat min() étant équitable en puissance) → 0.9/0.95 : power 1.11
//   (résidu per-échange divisé par ~1.6 — l'ex-ressenti « gagne tous les
//   échanges »), toujours le clan le plus lent. Il SOUS-performe encore en
//   duel IA-vs-IA (~15-30 % selon la config : artefact des heuristiques de
//   l'IA, quantifiées plus grossièrement à grosses unités ; l'issue d'un
//   duel est quasi DÉTERMINISTE par géométrie, la précision sous ±20 %
//   n'existe pas). Ce n'est PAS un biais côté joueur (toujours abeille) :
//   la difficulté d'une carte cafard se règle par ses AiParams/DONNÉES,
//   JAMAIS en re-gonflant un tuyau de puissance de l'espèce.
// Les clans se valent à économie égale : la difficulté vient des DONNÉES de
// carte, jamais de l'espèce.
export interface SpeciesStats {
  growthMul: number; // multiplie la production des nids possédés
  speedMul: number; // multiplie la vitesse des unités en vol
  power: number; // PV/dégâts d'une unité — DÉRIVÉ, jamais réglé à la main
}

function species(growthMul: number, speedMul: number): SpeciesStats {
  return { growthMul, speedMul, power: 1 / growthMul };
}

export const SPECIES: Record<SpeciesId, SpeciesStats> = {
  bee: species(1, 1), // référence (power 1)
  fly: species(1.5, 1.3), // nuée rapide et fragile (power ≈ 0.67)
  roach: species(0.9, 0.95), // rares, costauds, les plus lents (power ≈ 1.11)
};

// Nœuds — table par niveau d'upgrade : production, cap et rayon sont TOUS
// dérivés d'ici via NodeDef.level / Nodes.level.
export const NODE_LEVELS: readonly { prodPerSec: number; cap: number; radius: number }[] = [
  { prodPerSec: 1.2, cap: 60, radius: 30 },
  { prodPerSec: 1.9, cap: 90, radius: 36 },
  { prodPerSec: 2.8, cap: 120, radius: 42 },
];
// Coût de montée au niveau suivant (unités NOURRIES dans un nid allié déjà au
// cap — le surplus devient investissement au lieu d'être perdu, geste Auralux).
// La capture CONSERVE le niveau (les gros nids sont des prises stratégiques)
// mais remet la progression en cours à zéro.
export const UPGRADE_COSTS: readonly number[] = [25, 50];
export const MAX_NODES = 16;
export const ARRIVE_FRAC = 0.5; // rayon d'arrivée = fraction du rayon du nœud

// Unités en vol
export const UNIT_CAP = 600; // pool global, toutes factions confondues
export const UNIT_SPEED = 90; // px/s (× speedMul de l'espèce)
export const UNIT_SPEED_JITTER = 0.15; // ±15 % par unité
export const COLLIDE_R = 9; // rayon de contact (combat à puissance)
export const HP_EPSILON = 1e-3; // sous ce reste de PV, l'unité est morte (anti-zombie flottant)
export const WOBBLE_FREQ = 6; // rad/s du serpentin
export const WOBBLE_VEL_MIN = 30; // vitesse latérale du serpentin, px/s
export const WOBBLE_VEL_MAX = 80;

// Émission (un envoi = une rafale étalée, jamais un bloc instantané)
export const EMIT_INTERVAL = 0.06; // s entre deux unités d'un même flux (~16 u/s) — global, levier de tuning par espèce si besoin futur
export const MAX_STREAMS = 32;
// Fraction du stock envoyée par ordre joueur — RÉGLABLE en partie via le
// stepper du HUD (SEND_FRAC_MIN..1 par crans de SEND_FRAC_STEP, persistée
// dans le save). PAS de défaut à 100 % : le stock est aussi la défense du
// nœud (capture dès que < 0) — tout envoyer rendait chaque envoi suicidaire.
export const SEND_FRAC_DEFAULT = 0.5;
export const SEND_FRAC_MIN = 0.1;
export const SEND_FRAC_STEP = 0.1;

// Grille de collision (combat) : 12×20 cellules de 48 px couvrent 540×960.
// TOUTES les unités vivantes sont insérées (combat N factions) : densité par
// cellule dimensionnée en conséquence.
export const GRID_COLS = 12;
export const GRID_ROWS = 20;
export const GRID_CELL = 48;
export const GRID_MAX_PER_CELL = 128;

// Contrôles
export const TAP_RADIUS_PAD = 12; // zone de tap = max(radius + pad, TAP_RADIUS_MIN)
export const TAP_RADIUS_MIN = 34;
export const DRAG_THRESHOLD = 14; // au-delà, le geste est un drag, plus un tap

// Nuée orbitale (représentation visuelle du stock — jamais simulée)
export const ORBIT_VISUAL_CAP = 60; // points affichés max par nœud, même si stock supérieur

// IA — défauts, surchargés par FactionDef.ai
export const AI_DEFAULTS: AiParams = {
  decisionInterval: 1.2,
  aggression: 0.6,
  reserveFrac: 0.25,
  distWeight: 0.5,
  defendBias: 1.5,
  waveNodes: 3,
};
