import { LEVELS } from '../config/levels';
import type { MapId } from '../config/maps';

/**
 * Sauvegarde de Berceau. La CLÉ ne change JAMAIS : la version du schéma vit DANS le
 * JSON, et les migrations s'enchaînent au chargement. Renommer la clé effacerait la
 * progression des joueurs déjà installés.
 *
 * CE QU'ELLE NE CONTIENT PAS, et c'est le point important : ni or, ni bâtiments, ni
 * améliorations du bébé. L'absence de méta-progression est une décision de design, et
 * ce fichier est l'endroit où on la fait respecter — tant que rien de tout cela n'y
 * figure, aucun patch futur ne pourra le rendre persistant par inadvertance.
 *
 * Ce qui survit à un niveau : le fait de l'avoir terminé (d'où DÉRIVE le déblocage
 * du suivant), ses records, et la préférence de son.
 *
 * Pour vérifier la migration v1 → v2, forger un vieux save à la console :
 *   localStorage.setItem('rendilo-reale:crib:save:v1',
 *     JSON.stringify({ version: 1, wins: 3, bestTimeSec: 150, bestCribHp: 90 }))
 * puis recharger : le jardin doit apparaître terminé, et la cuisine déverrouillée.
 */
const KEY = 'rendilo-reale:crib:save:v1';

export interface LevelRecord {
  /** Terminé au moins une fois. C'est LUI qui dérive le déblocage du suivant. */
  cleared: boolean;
  /**
   * Meilleur temps, en secondes de NUIT cumulées. Le jour n'est pas chronométré :
   * le chronométrer récompenserait le joueur qui n'ouvre jamais le panneau d'achat.
   */
  bestNightSec: number | null;
  /** PV de berceau restants à la meilleure victoire — le vrai score d'adresse. */
  bestCribHp: number;
  /** 0-3, DÉRIVÉ à la victoire. Voir `starsFor`. */
  stars: number;
}

export interface SaveData {
  version: 2;
  muted: boolean;
  levels: Record<MapId, LevelRecord>;
  wins: number;
  runs: number;
}

const emptyRecord = (): LevelRecord => ({ cleared: false, bestNightSec: null, bestCribHp: 0, stars: 0 });

const DEFAULTS = (): SaveData => ({
  version: 2,
  muted: false,
  levels: { garden: emptyRecord(), kitchen: emptyRecord(), attic: emptyRecord() },
  wins: 0,
  runs: 0,
});

/**
 * Déblocage SÉQUENTIEL, dérivé et jamais stocké (pattern `campaignUnlocked`
 * d'Essaim). Le stocker créerait deux sources de vérité, dont une qu'un save
 * corrompu peut contredire.
 */
export function levelUnlocked(save: SaveData, id: MapId): boolean {
  const i = LEVELS.findIndex((l) => l.id === id);
  if (i <= 0) return true;
  return save.levels[LEVELS[i - 1].id].cleared;
}

/**
 * Trois étoiles, dérivées à la victoire : ① terminé, ② berceau au-dessus des deux
 * tiers, ③ aucune barricade perdue. Elles ne débloquent rien — c'est un jeu sans
 * méta-progression — elles disent juste ce qu'on aurait pu faire mieux.
 */
export function starsFor(cribFrac: number, barricadesLost: number): number {
  return 1 + (cribFrac > 0.66 ? 1 : 0) + (barricadesLost === 0 ? 1 : 0);
}

/**
 * Remet le save à ses défauts EN PLACE : l'objet est partagé par référence avec
 * Flow, les écrans et `window.__game` — le remplacer laisserait des lecteurs sur
 * l'ancienne instance.
 */
export function resetSave(save: SaveData): void {
  Object.assign(save, DEFAULTS());
}

export function loadSave(): SaveData {
  const save = DEFAULTS();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return save;
    // Typé `unknown` volontairement : ce JSON vient du disque du joueur, il n'a
    // aucune garantie de forme. Chaque champ est vérifié avant d'être adopté —
    // jamais `Object.assign(save, parsed)`.
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.muted === 'boolean') save.muted = parsed.muted;
    if (typeof parsed.wins === 'number' && Number.isFinite(parsed.wins)) save.wins = Math.max(0, Math.floor(parsed.wins));
    if (typeof parsed.runs === 'number' && Number.isFinite(parsed.runs)) save.runs = Math.max(0, Math.floor(parsed.runs));

    const version = typeof parsed.version === 'number' ? parsed.version : 1;
    if (version < 2) {
      migrateV1(save, parsed);
      return save;
    }

    const levels = parsed.levels;
    if (levels && typeof levels === 'object') {
      for (const { id } of LEVELS) {
        const raw = (levels as Record<string, unknown>)[id];
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const out = save.levels[id];
        if (typeof r.cleared === 'boolean') out.cleared = r.cleared;
        if (typeof r.bestNightSec === 'number' && Number.isFinite(r.bestNightSec)) {
          out.bestNightSec = Math.max(0, r.bestNightSec);
        }
        if (typeof r.bestCribHp === 'number' && Number.isFinite(r.bestCribHp)) {
          out.bestCribHp = Math.max(0, r.bestCribHp);
        }
        if (typeof r.stars === 'number' && Number.isFinite(r.stars)) {
          out.stars = Math.min(3, Math.max(0, Math.floor(r.stars)));
        }
      }
    }
  } catch {
    // navigation privée, quota dépassé, JSON corrompu : on repart des défauts
    // plutôt que de casser le boot
  }
  return save;
}

/**
 * v1 → v2. Le niveau de test unique du premier jet ÉTAIT le jardin : un vétéran
 * retrouve donc sa victoire, et surtout le déblocage de la cuisine — la seule chose
 * qu'il serait fâché de perdre.
 *
 * UNE seule étoile, jamais trois : son temps vient d'autres règles (une partie d'un
 * seul tenant, pas quatre nuits) et ne peut pas mériter les étoiles de perfection.
 * C'est plus honnête que de lui offrir un score qu'il n'a pas joué.
 */
function migrateV1(save: SaveData, parsed: Record<string, unknown>): void {
  const t = parsed.bestTimeSec;
  if (typeof t !== 'number' || !Number.isFinite(t)) return;
  const hp = typeof parsed.bestCribHp === 'number' && Number.isFinite(parsed.bestCribHp) ? parsed.bestCribHp : 0;
  save.levels.garden = { cleared: true, bestNightSec: Math.max(0, t), bestCribHp: Math.max(0, hp), stars: 1 };
}

export function persist(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // ignoré : perdre un record vaut mieux que perdre la partie en cours
  }
}
