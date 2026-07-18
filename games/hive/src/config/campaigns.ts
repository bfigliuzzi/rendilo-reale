// Les 3 campagnes jouables (une par espèce). Chacune fait 30 niveaux ; le
// déblocage est SÉQUENTIEL (Abeilles → Mouches → Cafards), dérivé du save via
// `unlockedBy` (jamais stocké). Les 9 cartes historiques (config/maps.ts,
// tunées au bot) sont ABSORBÉES comme niveaux 1-9 de la campagne Abeilles ;
// le reste est généré à la volée, déterministe par (espèce, n) — cf. mapgen.ts.
// Les ids générés (`bee-10`…`roach-30`) sont globalement uniques → `bestTimes`
// reste plat. Les noms sont curatés ici, en données.

import { MAX_NODES } from './balance';
import { type LevelDef, type SpeciesId } from './levels';
import { difficultyBudget, generateLevel } from './mapgen';
import { MAPS } from './maps';

export interface CampaignDef {
  species: SpeciesId;
  name: string;
  emoji: string;
  levels: readonly LevelDef[];
  unlockedBy?: { campaign: SpeciesId; level: number };
}

export const CAMPAIGN_LENGTH = 30;

// Noms curatés des niveaux GÉNÉRÉS (les 9 premiers bee gardent les leurs).
// Abeilles 10-30 (21 titres — thème ruche/miel/royauté).
const BEE_NAMES: readonly string[] = [
  'La Grande Miellée',
  'Le Rucher royal',
  'Les Champs d’or',
  'La Ruche-mère',
  'Le Vol nuptial',
  'La Gelée royale',
  'Les Rayons sans fin',
  'La Danse frétillante',
  'Le Bourdon solaire',
  'La Cire et le miel',
  'Le Dôme d’ambre',
  'La Reine des cimes',
  'Les Sentinelles dorées',
  'Le Miel noir',
  'La Colonie sans bornes',
  'L’Aiguillon suprême',
  'Le Trône de cire',
  'La Ruche assiégée',
  'Le Nectar interdit',
  'L’Apogée dorée',
  'La Ruche éternelle',
];
// Mouches 1-30 (30 titres — thème marais/putréfaction/nuée).
const FLY_NAMES: readonly string[] = [
  'Le Marais dormant',
  'Les Roseaux gris',
  'La Charogne',
  'L’Essaim bourdonnant',
  'Les Eaux stagnantes',
  'La Vase noire',
  'Le Nuage de spores',
  'Les Berges pourries',
  'La Mare aux carcasses',
  'Le Bourbier',
  'Les Larves grouillantes',
  'La Brume putride',
  'Le Cloaque',
  'Les Miasmes',
  'La Fange profonde',
  'Le Festin des mouches',
  'Les Ailes translucides',
  'Le Marécage sans fond',
  'La Ponte innombrable',
  'Les Nuées d’été',
  'Le Limon fétide',
  'La Décomposition',
  'Les Eaux mortes',
  'Le Règne des diptères',
  'La Grande Éclosion',
  'Le Tourbillon d’ailes',
  'Les Marais infinis',
  'La Reine putride',
  'L’Apogée du marais',
  'Le Trône de vase',
];
// Cafards 1-30 (30 titres — thème sous-bois/nuit/souterrain).
const ROACH_NAMES: readonly string[] = [
  'Le Sous-bois nocturne',
  'Les Feuilles mortes',
  'La Souche creuse',
  'L’Écorce pourrie',
  'Le Terrier sombre',
  'Les Galeries',
  'Le Champignon pâle',
  'La Litière humide',
  'Les Racines noueuses',
  'Le Bois mort',
  'La Fissure',
  'Les Ténèbres humides',
  'Le Nid sous la pierre',
  'Les Antennes dans le noir',
  'La Colonie souterraine',
  'Le Règne des blattes',
  'Les Carapaces',
  'Le Vieux Tronc',
  'La Nuit sans lune',
  'Les Profondeurs',
  'Le Dédale de racines',
  'La Mue collective',
  'Les Ombres rampantes',
  'Le Cœur du bois mort',
  'La Grande Migration',
  'Les Légions nocturnes',
  'Le Sous-sol infini',
  'La Reine des ombres',
  'L’Apogée souterraine',
  'Le Trône de chitine',
];

function named(def: LevelDef, name: string): LevelDef {
  return { ...def, name };
}

// Abeilles : 9 cartes historiques + 21 générées (n = 10..30).
const BEE_LEVELS: readonly LevelDef[] = [
  ...MAPS,
  ...BEE_NAMES.map((name, i) => named(generateLevel('bee', 10 + i), name)),
];
const FLY_LEVELS: readonly LevelDef[] = FLY_NAMES.map((name, i) => named(generateLevel('fly', 1 + i), name));
const ROACH_LEVELS: readonly LevelDef[] = ROACH_NAMES.map((name, i) => named(generateLevel('roach', 1 + i), name));

export const CAMPAIGNS: readonly CampaignDef[] = [
  { species: 'bee', name: 'Les Abeilles', emoji: '🐝', levels: BEE_LEVELS },
  { species: 'fly', name: 'Les Mouches', emoji: '🪰', levels: FLY_LEVELS, unlockedBy: { campaign: 'bee', level: 9 } },
  { species: 'roach', name: 'Les Cafards', emoji: '🪳', levels: ROACH_LEVELS, unlockedBy: { campaign: 'fly', level: 9 } },
];

export const CAMPAIGN_BY_SPECIES: Record<SpeciesId, CampaignDef> = {
  bee: CAMPAIGNS[0],
  fly: CAMPAIGNS[1],
  roach: CAMPAIGNS[2],
};

// Sanity-check DEV uniquement (élidé en prod) : garde-fous des invariants de
// données du générateur. Un échec = régression de mapgen à corriger AVANT
// de re-geler.
if (import.meta.env.DEV) {
  for (const c of CAMPAIGNS) {
    console.assert(c.levels.length === CAMPAIGN_LENGTH, `[campaigns] ${c.species} : ${c.levels.length} niveaux ≠ ${CAMPAIGN_LENGTH}`);
    let prevBudget = -Infinity;
    c.levels.forEach((lvl, i) => {
      const tag = `${c.species}#${i + 1} (${lvl.id})`;
      // Cadre géométrique
      console.assert(lvl.nodes.length <= MAX_NODES, `[campaigns] ${tag} : ${lvl.nodes.length} > MAX_NODES`);
      // Espèce du joueur = espèce de la campagne, sans IA
      console.assert(lvl.factions[0].species === c.species, `[campaigns] ${tag} : joueur ${lvl.factions[0].species} ≠ ${c.species}`);
      console.assert(!lvl.factions[0].ai, `[campaigns] ${tag} : le joueur ne doit pas avoir d'ai`);
      // Jamais deux IA de même espèce
      const aiSpecies = lvl.factions.slice(1).map((f) => f.species);
      console.assert(new Set(aiSpecies).size === aiSpecies.length, `[campaigns] ${tag} : deux IA de même espèce`);
      // Stocks strictement positifs
      for (const nd of lvl.nodes) console.assert(nd.stock > 0, `[campaigns] ${tag} : stock ≤ 0`);
      // Espacement ≥ 130 px entre tous les nids
      for (let a = 0; a < lvl.nodes.length; a++) {
        for (let b = a + 1; b < lvl.nodes.length; b++) {
          const dx = lvl.nodes[a].x - lvl.nodes[b].x;
          const dy = lvl.nodes[a].y - lvl.nodes[b].y;
          console.assert(dx * dx + dy * dy >= 130 * 130, `[campaigns] ${tag} : nids ${a}/${b} trop proches`);
        }
      }
      // Monotonie du budget de difficulté sur la campagne
      const budget = difficultyBudget(c.species, i + 1);
      console.assert(budget >= prevBudget - 1e-6, `[campaigns] ${tag} : budget ${budget.toFixed(1)} < précédent ${prevBudget.toFixed(1)}`);
      prevBudget = budget;
    });
  }
}
