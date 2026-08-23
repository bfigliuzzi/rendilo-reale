import * as B from './balance';
import type { EnemyKindId, PickupKindId } from './balance';
import { GARDEN, type MapDef } from './maps';

/**
 * Niveaux data-driven.
 *
 * Deux échelles de temps, et il ne faut pas les confondre : `at` compte les
 * secondes depuis le début de LA NUIT en cours, jamais depuis le début du niveau.
 * Chaque nuit repart donc de zéro, ce qui est le seul changement de sémantique
 * qu'a demandé la boucle jour/nuit — le spawner garde son curseur d'une simplicité
 * absolue.
 *
 * `events` DOIT être trié par `at` croissant, nuit par nuit : le spawner le
 * consomme dans l'ordre avec un curseur, il ne re-trie rien.
 */
export type NightEvent =
  | {
      at: number;
      type: 'wave';
      kind: EnemyKindId;
      count: number;
      /** Voie d'arrivée (`LaneDef.id`). C'est ELLE qui a remplacé l'angle de spawn :
       *  une vague entre par un chemin, plus par un secteur du cercle. */
      lane: string;
      /** Fraction de la largeur de voie occupée par le front, 0..1. Défaut 0,7. */
      spread?: number;
    }
  | { at: number; type: 'pickup'; variant: PickupKindId; x: number; y: number }
  | { at: number; type: 'boss'; lane: string }
  /** Dernier événement de CHAQUE nuit : il arme la condition « nuit tenue ». */
  | { at: number; type: 'clear' };

export interface NightDef {
  /** 1-based : affiché (« Nuit 3 / 4 ») et lu par l'annonce `aria-live`. */
  n: number;
  /**
   * Résumé de la menace, affiché SUR le bouton de lancement. Le joueur décide ses
   * achats AVANT de lancer la nuit : il lui faut savoir ce qui arrive, sinon la
   * phase de jour est un pari et non une décision.
   */
  brief: string;
  events: NightEvent[];
}

export interface LevelDef {
  id: string;
  name: string;
  seed: number;
  /** La GÉOMÉTRIE : arène, berceau, voies, terrain, emplacements. */
  map: MapDef;
  cribHp: number;
  /** Multiplicateur global de PV ennemis — le levier de difficulté le plus direct. */
  hpMul: number;
  /** Bourse de départ. L'or est PAR NIVEAU : aucune méta-progression. */
  startGold: number;
  /** 4 (jardin) / 5 (cuisine) / 7 (grenier). La DERNIÈRE porte toujours un boss. */
  nights: readonly NightDef[];
}

/**
 * 🌿 Le jardin — quatre nuits, un boss.
 *
 * La courbe reprend l'ordre pédagogique du niveau de test, mais découpée par la
 * boucle jour/nuit : chaque archétype a désormais SA nuit d'introduction, avec un
 * jour entier avant pour préparer la réponse. C'est tout le gain du rythme
 * Thronefall — on ne subit plus une escalade continue, on décide entre deux assauts.
 */
export function makeGarden(seed = 0xbebe): LevelDef {
  const cx = GARDEN.cribX;
  const cy = GARDEN.cribY;
  return {
    id: 'garden',
    name: GARDEN.name,
    seed,
    map: GARDEN,
    cribHp: 240,
    hpMul: 1,
    // exactement le prix d'UNE tourelle : le premier jour du jeu n'offre pas un
    // choix, il offre un geste — aller à un emplacement et construire.
    startGold: 70,
    nights: [
      {
        n: 1,
        brief: 'des couches sales, par l’allée du portail',
        events: [
          // une seule voie, un seul archétype : la nuit où l'on apprend qu'un
          // chemin a un début, une fin, et qu'on peut se poster dessus.
          { at: 2, type: 'wave', kind: 'nappy', count: 3, lane: 'portail', spread: 0.4 },
          { at: 11, type: 'wave', kind: 'nappy', count: 4, lane: 'portail', spread: 0.6 },
          { at: 20, type: 'wave', kind: 'nappy', count: 5, lane: 'portail', spread: 0.7 },
          { at: 24, type: 'pickup', variant: 'bottle', x: cx + 190, y: cy - 150 },
          { at: 28, type: 'clear' },
        ],
      },
      {
        n: 2,
        brief: 'des mamies bisous par le sentier des mûres',
        events: [
          // les deux voies s'ouvrent : on ne peut plus tout tenir depuis un point.
          { at: 2, type: 'wave', kind: 'granny', count: 2, lane: 'mures', spread: 0.5 },
          { at: 10, type: 'wave', kind: 'nappy', count: 5, lane: 'portail', spread: 0.7 },
          { at: 18, type: 'wave', kind: 'granny', count: 2, lane: 'mures', spread: 0.6 },
          { at: 22, type: 'pickup', variant: 'blanket', x: cx - 210, y: cy + 170 },
          { at: 27, type: 'wave', kind: 'nappy', count: 4, lane: 'mures', spread: 0.6 },
          { at: 34, type: 'wave', kind: 'granny', count: 1, lane: 'portail', spread: 0.2 },
          { at: 40, type: 'clear' },
        ],
      },
      {
        n: 3,
        brief: 'des brocolis : rester immobile ne sera plus possible',
        events: [
          { at: 2, type: 'wave', kind: 'broccoli', count: 2, lane: 'mures', spread: 0.5 },
          { at: 9, type: 'wave', kind: 'nappy', count: 6, lane: 'portail', spread: 0.8 },
          { at: 17, type: 'wave', kind: 'granny', count: 2, lane: 'portail', spread: 0.7 },
          { at: 22, type: 'pickup', variant: 'pacifier', x: cx + 60, y: cy + 260 },
          { at: 26, type: 'wave', kind: 'broccoli', count: 2, lane: 'portail', spread: 0.6 },
          { at: 33, type: 'wave', kind: 'nappy', count: 6, lane: 'mures', spread: 0.8 },
          { at: 40, type: 'wave', kind: 'granny', count: 2, lane: 'mures', spread: 0.5 },
          { at: 48, type: 'clear' },
        ],
      },
      {
        n: 4,
        brief: 'l’Aspirateur remonte l’allée — et il n’est pas seul',
        events: [
          // la mêlée d'abord, le boss ensuite : son escorte compte double, le tir
          // auto vise le PLUS PROCHE et chaque couche vivante est du DPS volé.
          { at: 2, type: 'wave', kind: 'nappy', count: 7, lane: 'mures', spread: 0.85 },
          { at: 5, type: 'wave', kind: 'nappy', count: 4, lane: 'portail', spread: 0.7 },
          { at: 11, type: 'wave', kind: 'granny', count: 3, lane: 'portail', spread: 0.85 },
          { at: 15, type: 'pickup', variant: 'bottle', x: cx - 120, y: cy - 250 },
          { at: 19, type: 'wave', kind: 'broccoli', count: 3, lane: 'mures', spread: 0.7 },
          { at: 25, type: 'wave', kind: 'nappy', count: 8, lane: 'portail', spread: 0.85 },
          { at: 31, type: 'wave', kind: 'granny', count: 2, lane: 'mures', spread: 0.5 },
          { at: 35, type: 'pickup', variant: 'pacifier', x: cx + 240, y: cy + 90 },
          // il remonte l'allée du portail, la voie la plus longue : c'est ce qui
          // laisse le temps de nettoyer avant qu'il n'arrive.
          { at: 40, type: 'boss', lane: 'portail' },
          { at: 49, type: 'wave', kind: 'nappy', count: 4, lane: 'mures', spread: 0.6 },
          { at: 57, type: 'wave', kind: 'granny', count: 2, lane: 'mures', spread: 0.7 },
          { at: 65, type: 'wave', kind: 'broccoli', count: 2, lane: 'portail', spread: 0.6 },
          { at: 73, type: 'wave', kind: 'nappy', count: 6, lane: 'mures', spread: 0.85 },
          // après ce point plus rien n'arrive : tuer le boss et nettoyer suffit. Un
          // joueur lent sur le boss n'est pas puni par de nouvelles vagues — c'est
          // le boss lui-même qui ronge le berceau, et cette pression-là suffit.
          { at: 80, type: 'clear' },
        ],
      },
    ],
  };
}

export const LEVELS: readonly ((seed?: number) => LevelDef)[] = [makeGarden];

/**
 * Or que RAPPORTE une nuit si le joueur tue tout. Le revenu étant dérivé du
 * contenu (`gold ≈ hp / 3` par archétype), ajouter une vague la finance
 * automatiquement — on n'a donc jamais à tenir alignées à la main une courbe de
 * difficulté et une courbe économique.
 */
export function nightIncome(night: NightDef): number {
  let total = 0;
  for (const ev of night.events) {
    if (ev.type === 'wave') total += B.ENEMY_KINDS[B.kindIndex(ev.kind)].gold * ev.count;
    else if (ev.type === 'boss') total += B.BOSS_GOLD;
  }
  return total;
}

/**
 * Garde-fous DEV du contenu. Même esprit que les assertions du terrain : chacun
 * correspond à un bug qui ne se voit qu'en jeu, tard, et sur une seule nuit.
 */
export function assertLevelSane(def: LevelDef): void {
  if (def.nights.length === 0) throw new Error(`${def.id} : aucune nuit`);
  const laneIds = new Set(def.map.lanes.map((l) => l.id));
  def.nights.forEach((night, k) => {
    for (let i = 1; i < night.events.length; i++) {
      if (night.events[i].at < night.events[i - 1].at) {
        throw new Error(`${def.id} nuit ${night.n} : events non trié à l'index ${i}`);
      }
    }
    const clears = night.events.filter((e) => e.type === 'clear');
    if (clears.length !== 1) throw new Error(`${def.id} nuit ${night.n} : il faut exactement un 'clear'`);
    if (night.events[night.events.length - 1].type !== 'clear') {
      throw new Error(`${def.id} nuit ${night.n} : le 'clear' doit être le dernier événement`);
    }
    for (const ev of night.events) {
      if ((ev.type === 'wave' || ev.type === 'boss') && !laneIds.has(ev.lane)) {
        throw new Error(`${def.id} nuit ${night.n} : voie inconnue « ${ev.lane} »`);
      }
    }
    // la dernière nuit porte le boss : c'est le climax de la carte, et l'écran de
    // victoire n'a aucun sens sans lui
    const hasBoss = night.events.some((e) => e.type === 'boss');
    if (k === def.nights.length - 1 && !hasBoss) {
      throw new Error(`${def.id} : la dernière nuit doit porter un boss`);
    }
    // revenu MONOTONE : une nuit qui rapporte moins que la précédente casse la
    // promesse implicite du jour (« la prochaine me donnera de quoi répondre ») et
    // ne se voit qu'après plusieurs parties.
    if (k > 0 && nightIncome(night) < nightIncome(def.nights[k - 1])) {
      throw new Error(`${def.id} nuit ${night.n} : revenu en baisse (${nightIncome(night)})`);
    }
  });
}
