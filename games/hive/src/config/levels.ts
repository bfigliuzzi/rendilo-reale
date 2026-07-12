// Types data-driven des niveaux : une carte est une DONNÉE (config/maps.ts),
// jamais du code — une future campagne = de nouvelles entrées, zéro logique.

export type Faction = 0 | 1 | 2 | 3;
export const NEUTRAL: Faction = 0;
export const PLAYER: Faction = 1; // toujours les abeilles

// Espèces (clans) : la faction est un CAMP (slot 1..3), l'espèce est son peuple.
// Le joueur joue toujours les abeilles ; une carte peut opposer des abeilles
// RIVALES (même espèce, autre faction). Stats dans balance.ts (SPECIES).
export const SPECIES_IDS = ['bee', 'fly', 'roach'] as const;
export type SpeciesId = (typeof SPECIES_IDS)[number];

export interface NodeDef {
  x: number; // px logiques 540×960
  y: number;
  faction: Faction;
  stock: number; // stock initial d'unités
  level?: number; // index dans NODE_LEVELS (défaut 0) — upgrade futur déjà câblé
}

export interface AiParams {
  decisionInterval: number; // s entre deux décisions
  aggression: number; // 0..1 — pondère l'attaque du joueur et abaisse la marge exigée
  reserveFrac: number; // fraction du stock gardée sur chaque nœud IA
  distWeight: number; // pénalité de distance dans le score des cibles
  defendBias: number; // multiplicateur de priorité de la défense
  waveNodes: number; // contributeurs max d'une vague (les plus proches de la cible)
  grace?: number; // s avant la PREMIÈRE décision (le joueur s'oriente) — défaut decisionInterval
}

/** Camp présent sur la carte : factions[k] décrit la faction k+1. factions[0]
 *  est TOUJOURS le joueur ({ species: 'bee' }, jamais d'ai). INVARIANT de
 *  données : deux factions de même espèce ne coexistent qu'en duel
 *  joueur-vs-rival (jamais deux IA de même espèce — la teinte + le style de
 *  contour doivent suffire à les distinguer, WCAG). */
export interface FactionDef {
  species: SpeciesId;
  ai?: AiParams;
}

// Tutoriel déclaratif : game/tutorial.ts observe l'état du monde et avance
// quand la condition du goal devient vraie. Zéro closure dans la config.
export type TutorialGoal = 'select' | 'send' | 'capture' | 'upgrade' | 'win';
export interface TutorialStep {
  text: string;
  goal: TutorialGoal;
}

export interface LevelDef {
  id: string;
  name: string;
  nodes: NodeDef[]; // l'index dans ce tableau = id runtime du nœud
  factions: readonly FactionDef[]; // factions[0] = joueur, 1..2 = camps IA
  tutorial?: readonly TutorialStep[];
}
