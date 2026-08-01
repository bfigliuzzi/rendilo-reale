import { DIFFICULTIES } from '../config/balance';
import { DIFFICULTY_IDS } from '../config/rules';
import type { Difficulty } from '../config/rules';
import type { SaveData } from './save';

// TOUT ici est en LECTURE SEULE du save : seul game/flow.ts écrit. L'écran 🏅 se
// dérive intégralement de ces deux tables.
//
// Cerveau n'a pas de monnaie : les paliers sont un AFFICHAGE, sans récompense ni
// réclamation. Ils sont donc SANS FIN (croissance géométrique) — un joueur au
// long cours a toujours un palier devant lui, sans qu'on ait à inventer du contenu.

export interface AchievementDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  /** Cible du palier 0. */
  base: number;
  /** Multiplicateur de cible d'un palier au suivant (≥ 2.5 : les paliers doivent
   *  s'espacer vite, sinon la liste devient une corvée de complétion). */
  growth: number;
  value: (save: SaveData) => number;
  /** Unité affichée après la valeur (« min »), si pertinente. */
  unit?: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'played',
    icon: '🎲',
    name: 'Habitué',
    desc: 'Parties jouées, gagnées ou perdues.',
    base: 5,
    growth: 3,
    value: (s) => s.counters.games,
  },
  {
    id: 'wins',
    icon: '🏆',
    name: 'Briseur de codes',
    desc: 'Codes secrets trouvés.',
    base: 3,
    growth: 3,
    value: (s) => s.counters.wins,
  },
  {
    id: 'guesses',
    icon: '🧩',
    name: 'Déductions',
    desc: 'Essais soumis, tous modes confondus.',
    base: 25,
    growth: 3,
    value: (s) => s.counters.guesses,
  },
  {
    id: 'exact',
    icon: '◆',
    name: 'Bien placé',
    desc: 'Pions tombés à la bonne place, cumulés.',
    base: 40,
    growth: 3,
    value: (s) => s.counters.exactPegs,
  },
  {
    id: 'cat',
    icon: '🐾',
    name: 'Souffre-douleur',
    desc: 'Méfaits du chat encaissés.',
    base: 3,
    growth: 2.6,
    value: (s) => s.counters.catMischiefs,
  },
  {
    id: 'time',
    icon: '⏱',
    name: 'Cogitation',
    desc: 'Temps passé à réfléchir.',
    base: 10,
    growth: 3,
    unit: 'min',
    value: (s) => Math.floor(s.counters.playSec / 60),
  },
];

/** Cible du palier `tier` (0-based), arrondie à deux chiffres significatifs. */
export function targetOf(def: AchievementDef, tier: number): number {
  const raw = def.base * def.growth ** tier;
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / mag) * mag;
}

/** Nombre de paliers atteints — sans plafond, par construction. */
export function reachedTiers(def: AchievementDef, save: SaveData): number {
  const v = def.value(save);
  let t = 0;
  while (v >= targetOf(def, t)) t++;
  return t;
}

// ─────────────────────────────────────────────────────── hauts faits one-shot

export interface FeatContext {
  /** Save DÉJÀ mis à jour par Flow : les compteurs cumulés sont à jour. */
  save: SaveData;
  victory: boolean;
  difficulty: Difficulty;
  /** Essais consommés dans cette partie. */
  tries: number;
  timeSec: number;
  /** Méfaits du chat subis dans CETTE partie. */
  mischiefs: number;
  /** Annulations ↩ utilisées dans CETTE partie. */
  undos: number;
}

export interface FeatDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  /** « ★ légende » : quasi hors d'atteinte, signalé au libellé ET au liseré. */
  hard?: boolean;
  check: (ctx: FeatContext) => boolean;
}

/** Un record ≤ `max` essais dans TOUTES les difficultés ? */
function allBestUnder(save: SaveData, max: number): boolean {
  return DIFFICULTY_IDS.every((id) => {
    const best = save.best[id];
    return best !== null && best.tries <= max;
  });
}

export const FEATS: readonly FeatDef[] = [
  {
    id: 'first-win',
    icon: '🔓',
    name: 'Premier code',
    desc: 'Trouver un code secret.',
    check: (c) => c.victory,
  },
  {
    id: 'two-tries',
    icon: '⚡',
    name: 'Éclair',
    desc: 'Gagner en 2 essais ou moins.',
    check: (c) => c.victory && c.tries <= 2,
  },
  {
    id: 'hole-in-one',
    icon: '🎯',
    name: 'Coup de génie',
    desc: 'Trouver le code du premier essai.',
    hard: true,
    check: (c) => c.victory && c.tries === 1,
  },
  {
    id: 'five-normal',
    icon: '🧠',
    name: 'Borne de Knuth',
    desc: 'Gagner en Normal en 5 essais ou moins — le maximum du solveur optimal.',
    check: (c) => c.victory && c.difficulty === 'normal' && c.tries <= 5,
  },
  {
    id: 'hard-win',
    icon: '💀',
    name: 'Tête dure',
    desc: 'Gagner une partie en Difficile.',
    check: (c) => c.victory && c.difficulty === 'hard',
  },
  {
    id: 'hard-six',
    icon: '👑',
    name: 'Maître du code',
    desc: 'Gagner en Difficile en 6 essais ou moins.',
    hard: true,
    check: (c) => c.victory && c.difficulty === 'hard' && c.tries <= 6,
  },
  {
    id: 'triple-crown',
    icon: '🏛',
    name: 'Triple couronne',
    desc: 'Un record de 5 essais ou moins dans les trois difficultés.',
    hard: true,
    check: (c) => allBestUnder(c.save, 5),
  },
  {
    id: 'last-chance',
    icon: '😰',
    name: 'In extremis',
    desc: 'Gagner au tout dernier essai.',
    check: (c) => c.victory && c.tries === DIFFICULTIES[c.difficulty].tries,
  },
  {
    id: 'no-undo',
    icon: '🐈',
    name: 'Chat toléré',
    desc: 'Gagner après un méfait du chat sans utiliser Annuler.',
    check: (c) => c.victory && c.mischiefs > 0 && c.undos === 0,
  },
  {
    id: 'cat-lover',
    icon: '🐾',
    name: 'Ami des chats',
    desc: 'Encaisser 25 méfaits sans désactiver le chat.',
    check: (c) => c.save.counters.catMischiefs >= 25,
  },
  {
    id: 'speedrun',
    icon: '⏱',
    name: 'Vif',
    desc: 'Gagner en Normal en moins de 60 secondes.',
    check: (c) => c.victory && c.difficulty === 'normal' && c.timeSec < 60,
  },
  {
    id: 'streak-5',
    icon: '🔥',
    name: 'En série',
    desc: 'Enchaîner 5 victoires.',
    check: (c) => c.save.bestStreak >= 5,
  },
];

/**
 * Renvoie les ids des hauts faits NOUVELLEMENT débloqués. N'écrit rien : Flow
 * pose les clés et fait l'unique `persist()` de la fin de partie.
 */
export function evalFeats(ctx: FeatContext): string[] {
  const fresh: string[] = [];
  for (const feat of FEATS) {
    if (ctx.save.feats[feat.id]) continue;
    if (feat.check(ctx)) fresh.push(feat.id);
  }
  return fresh;
}
