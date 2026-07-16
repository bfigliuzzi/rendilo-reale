import type { AiParams, SpeciesId } from './levels';

// TOUT le tuning gameplay de « Essaim » vit ici — jamais de constante ailleurs.

export const DESIGN_W = 540;
export const DESIGN_H = 960;

// Factions : 0 = neutre + 3 camps max (joueur + 2 IA). Tous les compteurs
// par faction sont dimensionnés là-dessus.
export const MAX_FACTIONS = 4;

// Espèces (clans) — ÉQUILIBRAGE PAR BUDGET (pattern « armes à budget » de
// horde) : on déclare un ARCHÉTYPE (croissance, vitesse), les valeurs JOUÉES
// sont dérivées par deux règles :
// ① PARITÉ D'USURE : power = 1/growthMul (débit de puissance produit identique
//   pour tous — c'est CE ratio qui décide des guerres d'attrition, mesuré au
//   bot : le pondérer par la vitesse faisait gagner toute guerre longue au
//   clan lent).
// ② TEMPÉRAGE : growthMul = archG^TEMPER_GROWTH, speedMul = archS^TEMPER_SPEED.
//   La VITESSE est le seul axe que le budget ne peut PAS pricer (la parité
//   d'usure ne contraint que la production) et son élasticité est BRUTALE :
//   l'avance de vol se recompose en boule de neige d'expansion. Mesuré au
//   scénario `duel` de tools/verify-hive.mjs (IA identique, carte symétrique) :
//   mouche ×1.3 → 16/16 contre abeille, ×1.17 → 11/12, quand abeille-cafard
//   (granularité pure, ±15 % de vitesse) restait ~50/50. D'où DEUX exposants :
//   la vitesse fortement compressée (l'axe décisif), la granularité doucement
//   (aggregate-neutre par ①, on la resserre seulement pour borner l'avantage
//   per-échange du cafard — le résidu du survivant après un échange 1c1, le
//   ressenti « le cafard gagne tous les échanges »). Les identités tiennent :
//   la nuée se LIT à la densité d'unités, le cafard à la rareté/taille.
//   Chaque exposant est CALIBRÉ aux duels (cible : tous matchups ≈ 50 %) —
//   le retuner = re-mesurer.
// Les clans se valent à économie égale : la difficulté vient des DONNÉES de
// carte, jamais de l'espèce.
export interface SpeciesStats {
  growthMul: number; // multiplie la production des nids possédés
  speedMul: number; // multiplie la vitesse des unités en vol
  power: number; // PV/dégâts d'une unité — DÉRIVÉ, jamais réglé à la main
}

export const SPECIES_TEMPER_GROWTH = 0.75;
export const SPECIES_TEMPER_SPEED = 0.3;

function species(archGrowth: number, archSpeed: number): SpeciesStats {
  const growthMul = archGrowth ** SPECIES_TEMPER_GROWTH;
  return { growthMul, speedMul: archSpeed ** SPECIES_TEMPER_SPEED, power: 1 / growthMul };
}

export const SPECIES: Record<SpeciesId, SpeciesStats> = {
  bee: species(1, 1), // référence (power 1)
  fly: species(1.5, 1.3), // nuée rapide et fragile (joué ≈ ×1.28/×1.08, power ≈ 0.78)
  roach: species(0.85, 0.8), // rares, lents, costauds (joué ≈ ×0.91/×0.94, power ≈ 1.10)
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
