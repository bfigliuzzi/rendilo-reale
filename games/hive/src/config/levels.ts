// Types data-driven des niveaux : une carte est une DONNÉE (config/maps.ts),
// jamais du code — une future campagne = de nouvelles entrées, zéro logique.

export type Faction = 0 | 1 | 2;
export const NEUTRAL: Faction = 0;
export const PLAYER: Faction = 1; // abeilles
export const ENEMY: Faction = 2; // cafards

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

export interface LevelDef {
  id: string;
  name: string;
  nodes: NodeDef[]; // l'index dans ce tableau = id runtime du nœud
  ai: AiParams;
}
