// Sauvegarde locale d'Essaim. Schéma VERSIONNÉ : toute évolution = migration ici
// (pattern horde). Seul game/flow.ts a le droit d'écrire dedans.
//
// Vérification manuelle des migrations — snippets à coller en console AVANT de
// recharger la page (la clé est la même à toutes les versions) :
//
//   // 1. Save v1 forgé (vétéran pré-tutoriel : 4 niveaux ouverts, verger battu)
//   //    → attendu v3 : campaigns.bee.unlocked = 5 (+1 tutoriel, migrateUnlocked),
//   //      fly/roach = 1, counters à zéro, feats = {}.
//   localStorage.setItem('rendilo-reale:hive:save:v1', JSON.stringify({
//     version: 1, unlocked: 4, bestTimes: { verger: 88 }, muted: false, sendFrac: 0.5,
//   }));
//
//   // 2. Save v2 forgé (vétéran complet : unlocked clampé à 9 MAIS
//   //    guerre-des-clans battue — lisible uniquement dans bestTimes)
//   //    → attendu v3 : campaigns.bee.unlocked = 10 ET campaignUnlocked(save,'fly') === true.
//   localStorage.setItem('rendilo-reale:hive:save:v1', JSON.stringify({
//     version: 2, unlocked: 9, bestTimes: { 'guerre-des-clans': 141 }, muted: false, sendFrac: 0.5,
//   }));
//
//   // Contrôle après reload : JSON.parse(localStorage.getItem('rendilo-reale:hive:save:v1'))
//   // (ou window.__game.save si la partie est lancée).

import { SEND_FRAC_DEFAULT, SEND_FRAC_MIN, SEND_FRAC_STEP } from '../config/balance';
import { CAMPAIGN_BY_SPECIES, CAMPAIGN_LENGTH } from '../config/campaigns';
import { SPECIES_IDS, type SpeciesId } from '../config/levels';
import { MAPS } from '../config/maps';

const KEY = 'rendilo-reale:hive:save:v1'; // clé historique — ne pas renommer

/** Compteurs cumulés toutes parties (succès à paliers, volet 4). */
export interface Counters {
  captures: number;
  unitsSent: number;
  upgrades: number;
  wins: number;
  losses: number;
  annihilations: number;
  playSec: number;
}

export interface SaveData {
  version: 3;
  /** Progression par campagne : nombre de niveaux déverrouillés (1 = seul le premier). */
  campaigns: Record<SpeciesId, { unlocked: number }>;
  /** Meilleur temps de victoire par id de carte, en secondes (plat : ids uniques). */
  bestTimes: Record<string, number>;
  muted: boolean;
  /** Fraction du stock envoyée par ordre joueur (HUD), crans de 10 %. */
  sendFrac: number;
  counters: Counters;
  /** Succès one-shot débloqués (présence de la clé = acquis). */
  feats: Record<string, true>;
}

const COUNTER_KEYS = ['captures', 'unitsSent', 'upgrades', 'wins', 'losses', 'annihilations', 'playSec'] as const;

const DEFAULT_COUNTERS: Counters = {
  captures: 0,
  unitsSent: 0,
  upgrades: 0,
  wins: 0,
  losses: 0,
  annihilations: 0,
  playSec: 0,
};

const DEFAULTS: SaveData = {
  version: 3,
  campaigns: { bee: { unlocked: 1 }, fly: { unlocked: 1 }, roach: { unlocked: 1 } },
  bestTimes: {},
  muted: false,
  sendFrac: SEND_FRAC_DEFAULT,
  counters: DEFAULT_COUNTERS,
  feats: {},
};

/** Arrondit au cran de 10 % dans [SEND_FRAC_MIN, 1] (re-quantifié à 2
 *  décimales : 7 × 0.1 = 0.7000…01 en flottant, qui polluerait le save). */
export function clampSendFrac(v: number): number {
  const snapped = Math.round(Math.round(v / SEND_FRAC_STEP) * SEND_FRAC_STEP * 100) / 100;
  return Math.min(1, Math.max(SEND_FRAC_MIN, snapped));
}

/** Une campagne est jouable si son jalon amont est franchi (absent = ouverte).
 *  Dérivé du save, jamais stocké : `unlockedBy.level` battu ⇔ le niveau suivant
 *  est déverrouillé dans la campagne amont (unlocked > level). */
export function campaignUnlocked(save: SaveData, species: SpeciesId): boolean {
  const by = CAMPAIGN_BY_SPECIES[species].unlockedBy;
  if (!by) return true;
  return save.campaigns[by.campaign].unlocked > by.level;
}

/** Remise à zéro EN PLACE (l'objet save est partagé par référence dans toute
 *  l'app) — la persistance reste à la charge de Flow. */
export function resetSave(save: SaveData): void {
  Object.assign(save, structuredClone(DEFAULTS));
}

/**
 * Migration v1 → v2 : `unlocked` est POSITIONNEL et la campagne a changé
 * d'ordre (tutoriel inséré en 0, nouvelles cartes intercalées). Le `+1` couvre
 * l'insertion du tutoriel pour les débutants ; la dérivation depuis les cartes
 * déjà GAGNÉES (bestTimes, ids conservés) restaure la progression des vétérans.
 * Légèrement généreuse dans les cas limites : assumé.
 */
function migrateUnlocked(oldUnlocked: number, bestTimes: Record<string, number>): number {
  let unlocked = Math.min(oldUnlocked + 1, MAPS.length);
  for (let i = 0; i < MAPS.length; i++) {
    if (bestTimes[MAPS[i].id] !== undefined) unlocked = Math.max(unlocked, Math.min(i + 2, MAPS.length));
  }
  return Math.max(1, unlocked);
}

/**
 * Migration v2 → v3 : le `unlocked` scalaire devient `campaigns.bee.unlocked`.
 * PIÈGE : en v2 il était clampé à MAPS.length (9) — « guerre-des-clans battue »
 * n'est lisible que dans bestTimes. On re-dérive donc depuis les 30 niveaux de
 * la campagne bee (ids historiques inclus) : le vétéran obtient unlocked = 10,
 * qui franchit du même coup le jalon des Mouches (campaignUnlocked).
 */
function migrateBeeUnlocked(v2Unlocked: number, bestTimes: Record<string, number>): number {
  let unlocked = Math.min(v2Unlocked, CAMPAIGN_LENGTH);
  const levels = CAMPAIGN_BY_SPECIES.bee.levels;
  for (let i = 0; i < levels.length; i++) {
    if (bestTimes[levels[i].id] !== undefined) unlocked = Math.max(unlocked, Math.min(i + 2, CAMPAIGN_LENGTH));
  }
  return Math.max(1, unlocked);
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // merge sur les défauts : les champs ajoutés par les futures versions
    // reçoivent leur valeur par défaut, les inconnus sont ignorés
    const save = structuredClone(DEFAULTS);
    const version = typeof parsed.version === 'number' ? parsed.version : 1;
    if (parsed.bestTimes && typeof parsed.bestTimes === 'object') {
      save.bestTimes = { ...(parsed.bestTimes as Record<string, number>) };
    }
    if (typeof parsed.muted === 'boolean') save.muted = parsed.muted;
    if (typeof parsed.sendFrac === 'number' && Number.isFinite(parsed.sendFrac)) save.sendFrac = clampSendFrac(parsed.sendFrac);
    if (version < 3) {
      // Chaîne v1 → v2 (migrateUnlocked) → v3 (migrateBeeUnlocked) ; fly/roach
      // n'existaient pas : ils restent au défaut (1).
      let v2Unlocked = 1;
      if (typeof parsed.unlocked === 'number') {
        const old = Math.max(1, Math.floor(parsed.unlocked));
        v2Unlocked = version < 2 ? migrateUnlocked(old, save.bestTimes) : Math.min(old, MAPS.length);
      }
      save.campaigns.bee.unlocked = migrateBeeUnlocked(v2Unlocked, save.bestTimes);
    } else {
      // v3 : merge champ par champ, avec clamp [1, CAMPAIGN_LENGTH] par campagne.
      const campaigns = parsed.campaigns as Record<string, { unlocked?: unknown } | undefined> | undefined;
      if (campaigns && typeof campaigns === 'object') {
        for (const sp of SPECIES_IDS) {
          const u = campaigns[sp]?.unlocked;
          if (typeof u === 'number' && Number.isFinite(u)) {
            save.campaigns[sp].unlocked = Math.min(CAMPAIGN_LENGTH, Math.max(1, Math.floor(u)));
          }
        }
      }
      const counters = parsed.counters as Record<string, unknown> | undefined;
      if (counters && typeof counters === 'object') {
        for (const k of COUNTER_KEYS) {
          const v = counters[k];
          if (typeof v === 'number' && Number.isFinite(v)) save.counters[k] = Math.max(0, v);
        }
      }
      const feats = parsed.feats as Record<string, unknown> | undefined;
      if (feats && typeof feats === 'object') {
        for (const k of Object.keys(feats)) if (feats[k] === true) save.feats[k] = true;
      }
    }
    return save;
  } catch {
    return structuredClone(DEFAULTS); // navigation privée / quota / JSON corrompu
  }
}

export function persist(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // silencieux : la partie reste jouable sans persistance
  }
}
