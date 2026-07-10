import { ENEMY, NEUTRAL, PLAYER, type LevelDef } from './levels';

// Carte POC : symétrie miroir vertical = départ équitable. Le joueur est en bas
// (près du pouce), l'IA en haut, le centre est le gros enjeu du milieu de partie.
export const SKIRMISH_1: LevelDef = {
  id: 'skirmish-1',
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
  // tempo détendu pour la carte d'intro : l'IA réfléchit toutes les 2,2 s,
  // exige une nette supériorité (aggression 0,5) et ne mobilise que 2 nids
  // par vague — le joueur garde des fenêtres de contre-attaque
  ai: { decisionInterval: 2.2, aggression: 0.5, reserveFrac: 0.3, distWeight: 0.5, defendBias: 1.5, waveNodes: 2 },
};

export const MAPS: readonly LevelDef[] = [SKIRMISH_1];
