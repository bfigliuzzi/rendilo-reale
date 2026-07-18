// Générateur de niveaux de campagne — étend les 9 cartes tunées à la main
// (config/maps.ts) en 3 campagnes de 30. Un niveau est ENTIÈREMENT dérivé de
// (espèce, n) via un PRNG mulberry32 seedé : identique à chaque boot, zéro
// Math.random. La difficulté monte par les DONNÉES (AiParams, surplus de nids,
// stocks, forteresses), JAMAIS par l'espèce (budget égal, cf. SPECIES).
//
// INVARIANT DE GEL : une fois la calibration au bot faite (phase 7), le
// générateur est FIGÉ — toute modif d'une constante ci-dessous re-tire les
// ~72 layouts et invalide la bande de référence. Le SEUL point de tuning
// post-calibration est la table OVERRIDES (grace/stocks par id de niveau,
// pattern NUEE/TRONE des cartes historiques).

import { mulberry32 } from '@shared/rng';
import { MAX_NODES, NODE_LEVELS } from './balance';
import { NEUTRAL, PLAYER, SPECIES_IDS, type AiParams, type Faction, type FactionDef, type LevelDef, type NodeDef, type SpeciesId } from './levels';
import { campaignAi } from './maps';

const FOE: Faction = 2;
const FOE2: Faction = 3;

// Cadre logique 540×960 : joueur en bas (près du pouce), IA en haut, neutres au
// milieu. Marges pour laisser les orbites/rayons (≤ 42) respirer.
const X_MIN = 100;
const X_MAX = 440;
const CX = 270;
const PLAYER_Y0 = 790;
const PLAYER_Y1 = 850;
const FOE_Y0 = 110;
// Bande IA alignée sur les cartes historiques (GUERRE_DES_CLANS pose un nid IA
// à y=320) : à 245 elle était trop étroite pour loger 1+3 nids à 130 px d'écart,
// le sampling abandonnait des nids secondaires — or le surplus de nids est LE
// terme dominant de la difficulté (~24 cartes aplaties, mesuré à la revue).
const FOE_Y1 = 320;
const NEUT_Y0 = 360;
const NEUT_Y1 = 745;
const NEUT_CY = 500;
// Espacement min entre nids : 140 visé, relâché à 130 avant d'abandonner le nid
// (rejection sampling — un layout sur-peuplé perd un neutre plutôt que d'entasser).
const MIN_DIST = 140;
const MIN_DIST_RELAX = 130;

const r2 = (v: number): number => Math.round(v * 100) / 100;

// ---- IA de campagne étendue ----
// d ≤ 9 : délègue à campaignAi (les 9 cartes bee restent au bit près). Au-delà,
// rampes ASYMPTOTIQUES sur u = min(1, (d−9)/21) — les bornes basses (u=0)
// coïncident EXACTEMENT avec campaignAi à t=1, la courbe est donc continue au
// raccord d=9→10. waveNodes figé à 4 (mobiliser plus écraserait le joueur) ;
// la grace reste LE levier fin, ré-amorçant la compensation de surplus au-delà
// de t=1.
export function campaignAiExt(d: number, surplus: number, over: Partial<AiParams> = {}): AiParams {
  if (d <= 9) return campaignAi(d, surplus, over);
  const u = Math.min(1, (d - 9) / 21);
  return {
    decisionInterval: r2(1.2 - 0.4 * u),
    aggression: r2(0.8 + 0.15 * u),
    reserveFrac: r2(0.22 - 0.08 * u),
    distWeight: r2(0.35 - 0.15 * u),
    defendBias: r2(1.7 + 0.3 * u),
    waveNodes: 4,
    grace: Math.max(4, Math.round(10 - 5 * u + 8 * surplus * (1 - 0.6 * u))),
    ...over,
  };
}

// ---- Table de foes déterministe ----
// Les deux espèces adverses « naturelles » (hors rival de même espèce) par
// espèce joueur — ordre d'introduction.
const OTHERS: Record<SpeciesId, readonly [SpeciesId, SpeciesId]> = {
  bee: ['fly', 'roach'],
  fly: ['roach', 'bee'],
  roach: ['bee', 'fly'],
};
// Mêlées (2 IA) aux difficultés listées ; ailleurs 1 seule IA. INVARIANT : une
// mêlée oppose TOUJOURS les deux espèces adverses (jamais deux IA de même
// espèce — WCAG) ; le rival de même espèce que le joueur n'apparaît qu'en 1v1.
const MELEE_AT = new Set<number>([13, 17, 21, 25, 28, 30]);

export interface FoeSpec {
  species: SpeciesId;
  desync: boolean; // mêlée : tempo décalé pour ne pas synchroniser les vagues
}

export function foesFor(species: SpeciesId, d: number): FoeSpec[] {
  const [o0, o1] = OTHERS[species];
  if (MELEE_AT.has(d)) {
    return [
      { species: o0, desync: false },
      { species: o1, desync: true },
    ];
  }
  // 1v1 : rotation qui introduit d'abord les deux espèces adverses, puis le
  // rival de même espèce (duel fratricide, lisible par contour + cœur évidé).
  const cycle: readonly SpeciesId[] = [o0, o0, o0, o1, o0, o1, species, o1];
  return [{ species: cycle[d % cycle.length], desync: false }];
}

// ---- Scalaires de difficulté dérivés de d (tous MONOTONES) ----
function derive(d: number): { foeMainLevel: number; foeStockMul: number; surplus: number; nodeCount: number; neutralLevel: number } {
  const maxLevel = NODE_LEVELS.length - 1;
  return {
    // forteresse IA : L1 dès d≥12, L2 dès d≥18 (compensée par le boost du départ joueur)
    foeMainLevel: Math.min(maxLevel, d >= 18 ? 2 : d >= 12 ? 1 : 0),
    // stocks IA ×1.0→×1.6 sur d 10..30
    foeStockMul: Math.min(1.6, Math.max(1, 1 + (d - 10) * 0.03)),
    // nids IA excédentaires 1→3 (le terme dominant du rapport de forces)
    surplus: d < 12 ? 0 : Math.min(3, Math.floor((d - 12) / 8) + 1),
    // 7→16 nœuds selon la difficulté
    nodeCount: Math.min(MAX_NODES, 7 + Math.floor((d - 2) / 3)),
    // neutre convoité au centre : L1 dès d≥12, L2 dès d≥18
    neutralLevel: Math.min(maxLevel, d >= 18 ? 2 : d >= 12 ? 1 : 0),
  };
}

// Budget de difficulté (proxy monotone en d) — sert au sanity-check de
// monotonie par campagne. Somme de termes tous croissants en d : le surplus de
// nids domine (chaque nid ≈ 1.2 puissance/s × 60 s), les mêlées n'entrent PAS
// dans ce budget (les IA s'entre-tuent — « laisse-les s'entretuer »).
export function difficultyBudget(species: SpeciesId, n: number): number {
  const d = species === 'bee' ? n : n + 1;
  const { foeMainLevel, foeStockMul, surplus } = derive(d);
  const ai = campaignAiExt(d, surplus);
  return surplus * 72 + foeStockMul * 28 + foeMainLevel * 30 + (2.4 - ai.decisionInterval) * 10 + ai.aggression * 8;
}

// ---- Surcharges post-calibration (SEUL point de tuning, générateur gelé) ----
// Clé = id namespacé du niveau (`bee-12`, `fly-7`…). Comme les surcharges
// assumées des cartes historiques (NUEE/TRONE), on n'ajuste ici que la grace
// (levier fin), les stocks et — au besoin — des AiParams par camp IA. VIDE tant
// que la calibration au bot (bande cible du plan) n'a rien mesuré.
export interface LevelOverride {
  ai?: readonly Partial<AiParams>[]; // par camp IA (index 0 = premier foe) — grace en priorité
  foeStockMul?: number; // remplace le multiplicateur de stock IA dérivé
  playerStock?: number; // remplace le stock de départ du joueur (EN PUISSANCE)
}
// Calibration 2026-07 (Mac 120 fps, verify-hive, 2 runs concordants par carte —
// lire la bande en RELATIF, cf. CLAUDE.md) : ouvertures remusclées (fly-2 était
// bot-timeout, fly/roach-5 bot-lose à ~45-70 s), fly-17 resserrée (bot-win 40 s
// à d=18), plancher de survie ≥ 40 s rétabli sur les fins de campagne.
export const OVERRIDES: Record<string, LevelOverride> = {
  'fly-2': { playerStock: 40, foeStockMul: 0.85, ai: [{ grace: 14 }] },
  'fly-5': { playerStock: 38, ai: [{ grace: 18 }] },
  'roach-5': { ai: [{ grace: 18 }] },
  'fly-17': { ai: [{ grace: 20 }] },
  'fly-26': { ai: [{ grace: 32 }] },
  'roach-26': { ai: [{ grace: 32 }] },
  'roach-30': { ai: [{ grace: 32 }] },
};

// ---- Générateur ----
export function generateLevel(species: SpeciesId, n: number): LevelDef {
  const spIdx = SPECIES_IDS.indexOf(species);
  // d = indice de difficulté : fly/roach n'ont pas de tutoriel, leur niveau 1
  // démarre à la difficulté de la Clairière (d=2).
  const d = species === 'bee' ? n : n + 1;
  const id = `${species}-${n}`;
  const rand = mulberry32((((spIdx + 1) * 0x10000 + n) ^ 0x9e3779b9) >>> 0);
  const derived = derive(d);
  const over = OVERRIDES[id];
  const foeStockMul = over?.foeStockMul ?? derived.foeStockMul;

  const foes = foesFor(species, d);
  const melee = foes.length > 1;
  // Mode de symétrie tiré au seed : miroir gauche/droite, symétrie centrale
  // (point (CX, 480)), ou champ neutre asymétrique mais équilibré.
  const symRoll = rand();
  const mode: 'mirror' | 'central' | 'asym' = symRoll < 0.4 ? 'mirror' : symRoll < 0.7 ? 'central' : 'asym';

  const nodes: NodeDef[] = [];
  const farEnough = (x: number, y: number, min: number): boolean => {
    for (const p of nodes) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < min * min) return false;
    }
    return true;
  };
  // Coordonnées ARRONDIES avant le test de distance : les nids sont stockés en
  // entiers, tester sur les flottants laisserait une paire à 130.2 tomber sous
  // 130 après arrondi (mesuré : 2 layouts en violation marginale).
  const sample = (xlo: number, xhi: number, ylo: number, yhi: number): { x: number; y: number } | null => {
    for (let a = 0; a < 40; a++) {
      const x = Math.round(xlo + rand() * (xhi - xlo));
      const y = Math.round(ylo + rand() * (yhi - ylo));
      if (farEnough(x, y, MIN_DIST)) return { x, y };
    }
    for (let a = 0; a < 20; a++) {
      const x = Math.round(xlo + rand() * (xhi - xlo));
      const y = Math.round(ylo + rand() * (yhi - ylo));
      if (farEnough(x, y, MIN_DIST_RELAX)) return { x, y };
    }
    return null;
  };

  // --- Joueur (1 nid, bas-centre) ---
  // Départ qui MONTE avec d (26 → 40), pattern des cartes historiques (25 en
  // ouverture, 30 dès la mi-campagne, 40 face au Trône) : c'est l'ouverture du
  // joueur qu'on muscle, pas l'identité des cartes qu'on rabote. À 28 fixe le
  // bot mourait sur la première vague dès d=6 (mesuré).
  const playerStock = over?.playerStock ?? Math.min(40, 26 + Math.round(1.7 * (d - 2)));
  const px = Math.round(CX + (rand() - 0.5) * 100);
  const py = Math.round(PLAYER_Y0 + rand() * (PLAYER_Y1 - PLAYER_Y0));
  nodes.push({ x: px, y: py, faction: PLAYER, stock: playerStock });

  // --- Camps IA (haut) ---
  // Chaque camp : 1 nid principal (niveau forteresse) + `campSurplus` nids
  // secondaires. En mêlée on borne le surplus par camp (les IA se partagent la
  // pression), pattern GUERRE_DES_CLANS.
  const campSurplus = melee ? Math.min(2, derived.surplus) : derived.surplus;
  const mainStock = Math.round(28 * foeStockMul);
  const sideStock = Math.round(11 * foeStockMul);
  const factionOf = (fi: number): Faction => (fi === 0 ? FOE : FOE2);

  foes.forEach((_foe, fi) => {
    const faction = factionOf(fi);
    // Mêlée : camp 0 à gauche, camp 1 à droite ; 1v1 : pleine largeur.
    const xlo = melee ? (fi === 0 ? X_MIN : CX + 20) : X_MIN;
    const xhi = melee ? (fi === 0 ? CX - 20 : X_MAX) : X_MAX;
    // Ancres de secours déterministes (coins/médianes du secteur) quand le
    // sampling échoue : chaque nid IA voulu DOIT exister, un nid fantôme
    // fausse le rapport de forces ET la grace qui le compense.
    const ax0 = xlo + 15;
    const ax1 = xhi - 15;
    const ay0 = FOE_Y0 + 15;
    const ay1 = FOE_Y1 - 15;
    const cxm = Math.round((xlo + xhi) / 2);
    const cym = Math.round((FOE_Y0 + FOE_Y1) / 2);
    // Mêlée : deux tripodes en quinconce (colonnes extérieures + un nid vers le
    // centre, diagonales opposées) — la SEULE géométrie qui loge 2×3 nids à
    // ≥130 px dans la bande IA ; le sampling seul n'y arrive pas (mesuré).
    // Jitter ±4 px seedé : 140 px entre ancres − 8 de jitter cumulé ≥ 130.
    const anchors: readonly (readonly [number, number])[] = melee
      ? fi === 0
        ? [[110, 120], [110, 300], [250, 120]]
        : [[430, 120], [430, 300], [290, 300]]
      : [[ax0, ay0], [ax1, ay1], [ax0, ay1], [ax1, ay0], [ax1, cym], [ax0, cym], [cxm, ay0], [cxm, ay1]];
    const jitter = (v: number): number => Math.round(v + (rand() - 0.5) * 8);
    const place = (): { x: number; y: number } | null => {
      if (melee) {
        // ancres d'abord (géométrie garantie), sampling en secours
        for (const [x0, y0] of anchors) {
          const x = jitter(x0);
          const y = jitter(y0);
          if (farEnough(x, y, MIN_DIST_RELAX)) return { x, y };
        }
        return sample(xlo, xhi, FOE_Y0, FOE_Y1);
      }
      const s = sample(xlo, xhi, FOE_Y0, FOE_Y1);
      if (s) return s;
      for (const [x, y] of anchors) if (farEnough(x, y, MIN_DIST_RELAX)) return { x, y };
      return null;
    };
    // Nid PRINCIPAL tout en haut (y ≤ 160, pattern constant des cartes
    // historiques) : posé plus bas, l'IA atteint l'économie centrale bien
    // avant le joueur (mesuré : régression introduite par l'élargissement de
    // la bande — seuls les nids SECONDAIRES descendent jusqu'à 320).
    let p = melee ? place() : (sample(xlo, xhi, FOE_Y0, 160) ?? place());
    if (!p) p = { x: cxm, y: cym };
    nodes.push({ x: p.x, y: p.y, faction, stock: mainStock, level: derived.foeMainLevel || undefined });
    for (let k = 1; k <= campSurplus; k++) {
      const s = place();
      if (s) nodes.push({ x: s.x, y: s.y, faction, stock: sideStock });
    }
  });

  // surplusNests CALCULÉ (jamais déclaré) : nids réellement posés du camp − nids joueur.
  const playerNests = nodes.filter((nd) => nd.faction === PLAYER).length;

  // --- Neutres (milieu) — richesse concentrée AU CENTRE, chute rapide ---
  // Le stock d'un neutre est son PRIX de capture : les cartes historiques ne
  // mettent des neutres chers (14-20) qu'au centre contesté, et des 6-10 en
  // périphérie. Une richesse uniforme 13-19 (1er tirage du générateur) rendait
  // l'expansion deux fois plus chère que sur clairiere/verger et donnait toute
  // l'économie à l'IA, plus proche du champ central (mesuré : fly/roach-2
  // bot-lose là où les cartes historiques de même d gagnent).
  const structural = nodes.length;
  const neutralCount = Math.max(2, Math.min(derived.nodeCount, MAX_NODES) - structural);
  const neutStock = (y: number): number => {
    const t = Math.max(0, 1 - Math.abs(y - NEUT_CY) / 250);
    return Math.round(6 + 14 * t * t);
  };
  // Nid central convoité (forteresse neutre à niveau à mesure que d monte).
  {
    let c = sample(CX - 30, CX + 30, NEUT_CY - 30, NEUT_CY + 30);
    if (!c) c = { x: CX, y: NEUT_CY };
    nodes.push({ x: c.x, y: c.y, faction: NEUTRAL, stock: 18 + derived.neutralLevel * 6, level: derived.neutralLevel || undefined });
  }
  let placed = 1;
  // Poche du joueur : deux neutres BON MARCHÉ sur ses flancs (pattern constant
  // des cartes historiques — l'ouverture du joueur). Sans eux, le premier
  // nid coûte 15+ et l'IA prend le milieu pendant ce temps.
  {
    const plx = Math.round(112 + rand() * 30);
    const ply = Math.round(620 + rand() * 90);
    if (placed < neutralCount && farEnough(plx, ply, MIN_DIST_RELAX)) {
      nodes.push({ x: plx, y: ply, faction: NEUTRAL, stock: 8 });
      placed++;
    }
    const pry = Math.round(620 + rand() * 90);
    if (placed < neutralCount && farEnough(540 - plx, pry, MIN_DIST_RELAX)) {
      nodes.push({ x: 540 - plx, y: pry, faction: NEUTRAL, stock: 8 });
      placed++;
    }
  }
  let guard = 0;
  while (placed < neutralCount && guard++ < 200) {
    if (mode === 'mirror') {
      const p = sample(X_MIN, CX - 10, NEUT_Y0, NEUT_Y1);
      if (!p) break;
      nodes.push({ x: p.x, y: p.y, faction: NEUTRAL, stock: neutStock(p.y) });
      placed++;
      const mx = 540 - p.x;
      if (placed < neutralCount && farEnough(mx, p.y, MIN_DIST_RELAX)) {
        nodes.push({ x: mx, y: p.y, faction: NEUTRAL, stock: neutStock(p.y) });
        placed++;
      }
    } else if (mode === 'central') {
      const p = sample(X_MIN, X_MAX, NEUT_CY, NEUT_Y1);
      if (!p) break;
      nodes.push({ x: p.x, y: p.y, faction: NEUTRAL, stock: neutStock(p.y) });
      placed++;
      const mx = 540 - p.x;
      const my = 960 - p.y;
      if (placed < neutralCount && farEnough(mx, my, MIN_DIST_RELAX)) {
        nodes.push({ x: mx, y: my, faction: NEUTRAL, stock: neutStock(my) });
        placed++;
      }
    } else {
      const p = sample(X_MIN, X_MAX, NEUT_Y0, NEUT_Y1);
      if (!p) break;
      nodes.push({ x: p.x, y: p.y, faction: NEUTRAL, stock: neutStock(p.y) });
      placed++;
    }
  }

  // --- Factions : [0]=joueur (sans ai), puis un camp IA par foe ---
  const factions: FactionDef[] = [
    { species },
    ...foes.map((foe, fi): FactionDef => {
      // Surplus RÉELLEMENT posé de ce camp (les ancres garantissent le compte
      // voulu, mais si un nid était quand même abandonné, la grace doit
      // compenser la réalité, pas l'intention).
      let campNests = 0;
      for (const nd of nodes) if (nd.faction === factionOf(fi)) campNests++;
      const surplus = Math.max(0, campNests - playerNests);
      let ai = campaignAiExt(d, surplus);
      // Rampe d'approche des cartes générées : les cartes historiques d'un
      // certain mordant surchargent TOUTES la grace de +6..+7 au-dessus de la
      // formule (NUEE 18, TRONE 19) — la formule brute tue le bot sur la
      // première vague coordonnée (~33 s, mesuré ici aussi). Rampe 0 (d≤3) → 8
      // (d≥7), plafonnée : en fin de campagne le défi humain reprend le dessus.
      const graceLift = Math.max(0, Math.min(8, (d - 3) * 2));
      ai = { ...ai, grace: (ai.grace ?? 4) + graceLift };
      if (foe.desync) {
        // Décale le tempo pour désynchroniser les vagues des deux clans en mêlée.
        ai = { ...ai, decisionInterval: r2(ai.decisionInterval * 0.87), grace: Math.max(4, (ai.grace ?? 4) - 3) };
      }
      return { species: foe.species, ai };
    }),
  ];
  // Surcharges post-calibration (par camp IA), grace en priorité.
  if (over?.ai) {
    for (let fi = 0; fi < foes.length; fi++) {
      const patch = over.ai[fi];
      if (patch) factions[fi + 1] = { species: factions[fi + 1].species, ai: { ...factions[fi + 1].ai!, ...patch } };
    }
  }

  return { id, name: id, nodes, factions };
}
