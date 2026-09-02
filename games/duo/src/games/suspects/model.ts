// §3.8 — `suspects` : Six suspects · pass · asym · tour par tour.
//
// Le seul jeu de la collection où trois ans d'écart ne servent presque à rien :
// A choisit un coupable en secret parmi 6 suspects, B pose jusqu'à 3 questions
// (le jeu répond lui-même oui/non) puis accuse. Rôles échangés à chaque
// manche, 4 manches (+ une 5ᵉ en cas d'égalité).
//
// MODÈLE PUR (contrat de `core/minigame.ts`) : ni horloge, ni `Math.random`
// (mulberry32 seedé), ni DOM, ni Pixi, ni import de `view.ts` — rejouable hors
// de la page à seed égal, ce qui permet au bot de vérifier une manche entière
// sans cliquer un seul bouton. Le secret (qui est le coupable) est bien exposé
// par `state.culprit` — un modèle pur n'a pas de notion d'« écran » — c'est à
// `index.ts`/`view.ts` de ne jamais l'afficher pendant le tour de B (règle de
// secret, comme `beast` ne dessine la bête que pendant son propre tour).
//
// ─────────────────────────────────────────────────────────────────────────
// LE POINT DUR DE CE JEU : LE SYSTÈME SÉPARATEUR.
//
// Il faut GARANTIR que 3 questions bien choisies suffisent TOUJOURS à isoler
// le coupable, quel que soit celui des 6 suspects choisi par A. Avec 4 traits
// binaires, poser 3 questions revient à choisir 3 des 4 traits (on en « omet »
// un) : les réponses ne séparent tous les suspects que si, pour CHACUN des
// C(4,3) = 4 sous-ensembles de 3 traits, les 6 empreintes obtenues sont deux à
// deux distinctes (`isSeparating`, recherche EXHAUSTIVE, 2^3 = 8 réponses
// possibles par sous-ensemble). Ça équivaut à exiger une distance de Hamming
// ≥ 2 entre deux suspects quelconques (omettre 1 trait ne peut alors jamais
// effacer LA SEULE différence restante) — mais on vérifie la version littérale
// de la spec, pas le raccourci mathématique, pour que le test du bot porte sur
// la même propriété que celle décrite ici.
//
// La génération exploite cette équivalence : parmi les 16 profils possibles
// (2^4), les 8 de parité PAIRE (nombre de traits actifs pair) sont deux à deux
// à distance ≥ 2 (changer 1 seul trait change toujours la parité), et il en va
// de même pour les 8 de parité impaire. N'IMPORTE QUEL sous-ensemble de 6
// profils pris dans une SEULE de ces deux classes est donc automatiquement
// séparateur — la génération choisit une classe (seedée) puis 6 de ses 8
// profils, et vérifie quand même `isSeparating` avant de rendre la main : si
// jamais cette propriété combinatoire cessait d'être vraie après une retouche
// future, le tirage serait REJETÉ et retenté plutôt que de livrer une manche
// insoluble (voir `genSuspects`).
// ─────────────────────────────────────────────────────────────────────────

import { mulberry32 } from '@shared/rng';
import { SUSPECTS_COUNT, SUSPECTS_QUESTIONS, SUSPECTS_ROUNDS, SUSPECTS_TRAITS } from '../../config/balance';
import type { Result } from '../../core/minigame';
import type { StarLevel } from '../../meta/save';

export type TraitKey = 'hat' | 'glasses' | 'scarf' | 'redPull';

export interface TraitMeta {
  readonly key: TraitKey;
  /** La question, en clair — jamais REQUISE pour jouer (le pictogramme et la
   *  réponse oui/non suffisent), mais lue par `#sr-log`/les `aria-label`. */
  readonly question: string;
  readonly emoji: string;
}

/** Les 4 traits binaires du §3.8, dans un ordre FIXE (index = bit du profil). */
export const TRAITS: readonly TraitMeta[] = [
  { key: 'hat', question: 'porte-t-il un chapeau ?', emoji: '🎩' },
  { key: 'glasses', question: 'porte-t-il des lunettes ?', emoji: '🕶️' },
  { key: 'scarf', question: 'porte-t-il une écharpe ?', emoji: '🧣' },
  { key: 'redPull', question: 'porte-t-il un pull rouge ?', emoji: '🟥' },
];

export interface Suspect {
  readonly id: number;
  readonly hat: boolean;
  readonly glasses: boolean;
  readonly scarf: boolean;
  readonly redPull: boolean;
}

export function traitOf(s: Suspect, key: TraitKey): boolean {
  return s[key];
}

/** Toutes les k-combinaisons (indices) de `[0, n)` — utilisé UNE fois à la
 *  génération, jamais au tick : rien de coûteux ici. */
function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  function rec(start: number): void {
    if (cur.length === k) {
      out.push(cur.slice());
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      rec(i + 1);
      cur.pop();
    }
  }
  rec(0);
  return out;
}

/** Les C(4,3) = 4 sous-ensembles de `SUSPECTS_QUESTIONS` traits parmi
 *  `SUSPECTS_TRAITS`, calculés une fois — voir l'en-tête du fichier. */
const QUESTION_SETS: readonly TraitKey[][] = combinations(SUSPECTS_TRAITS, SUSPECTS_QUESTIONS).map((idxs) =>
  idxs.map((i) => TRAITS[i].key),
);

/**
 * LA fonction séparatrice, décrite dans l'en-tête du fichier : recherche
 * EXHAUSTIVE sur tous les sous-ensembles de questions possibles. Exposée pour
 * que le bot puisse la rejouer indépendamment (`window.__game.models`).
 */
export function isSeparating(suspects: readonly Suspect[]): boolean {
  for (const keys of QUESTION_SETS) {
    const seen = new Set<string>();
    for (const s of suspects) {
      const pattern = keys.map((k) => (traitOf(s, k) ? '1' : '0')).join('');
      if (seen.has(pattern)) return false;
      seen.add(pattern);
    }
  }
  return true;
}

function allProfiles(): readonly (readonly boolean[])[] {
  const out: boolean[][] = [];
  for (let m = 0; m < 1 << SUSPECTS_TRAITS; m++) {
    const profile: boolean[] = [];
    for (let i = 0; i < SUSPECTS_TRAITS; i++) profile.push((m & (1 << i)) !== 0);
    out.push(profile);
  }
  return out;
}

function parityOf(profile: readonly boolean[]): 0 | 1 {
  let n = 0;
  for (const b of profile) if (b) n++;
  return (n % 2) as 0 | 1;
}

/** Fisher-Yates seedé — zéro `Math.random` (contrat §3). */
function shuffle<T>(rand: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Ne devrait JAMAIS être atteint (voir l'en-tête : une classe de parité est
 *  mathématiquement toujours séparatrice) — filet de sécurité si le tuning
 *  (nombre de traits/questions/suspects) changeait un jour sans revoir cette
 *  fonction : on RETENTE plutôt que de livrer une manche insoluble. */
const MAX_GEN_ATTEMPTS = 100;

function genSuspects(rand: () => number): Suspect[] {
  const universe = allProfiles();
  for (let attempt = 0; attempt < MAX_GEN_ATTEMPTS; attempt++) {
    const parity: 0 | 1 = rand() < 0.5 ? 0 : 1;
    const sameParity = universe.filter((p) => parityOf(p) === parity);
    const pool = shuffle(rand, sameParity.slice());
    const chosen = pool.slice(0, SUSPECTS_COUNT).map(
      (profile, id): Suspect => ({
        id,
        hat: profile[0],
        glasses: profile[1],
        scarf: profile[2],
        redPull: profile[3],
      }),
    );
    if (chosen.length === SUSPECTS_COUNT && isSeparating(chosen)) return chosen;
  }
  throw new Error('[duo/suspects] génération de profils impossible : invariant séparateur introuvable');
}

export type Phase = 'pick' | 'guess';

export interface AskRecord {
  readonly trait: TraitKey;
  readonly answer: boolean;
}

/** Résumé de la DERNIÈRE manche résolue — persiste pendant que le modèle a
 *  déjà basculé sur la manche suivante, pour que la vue puisse encore afficher
 *  « trouvé ! c'était … » un court instant (§1.1 critère 4). */
export interface RoundLog {
  readonly round: number;
  readonly picker: 0 | 1;
  readonly guesser: 0 | 1;
  readonly culprit: number;
  readonly accused: number;
  readonly correct: boolean;
  /** Manche de DÉPARTAGE (la 5ᵉ) : c'est la seule où un échec RAPPORTE au
   *  cachottier — voir `advanceRound`/`accuse`. */
  readonly decisive: boolean;
  /** À QUI est allé le point de cette manche. Jamais `null` en manche de
   *  départage : c'est ce qui rend l'égalité finale impossible. */
  readonly pointTo: 0 | 1 | null;
  readonly asked: readonly AskRecord[];
}

export interface SuspectsState {
  /** Les 6 profils, FIXES pour toute la partie (identité stable des boutons). */
  readonly suspects: readonly Suspect[];
  /** Manche courante, 0-based. */
  readonly round: number;
  /** 4, ou 5 si la 4ᵉ s'est soldée par une égalité (§3.8). */
  readonly totalRounds: number;
  readonly phase: Phase;
  readonly picker: 0 | 1;
  readonly guesser: 0 | 1;
  /** Le coupable choisi par le picker CE tour — `null` avant son choix. Secret
   *  du point de vue du jeu : ne JAMAIS l'exposer côté vue pendant `'guess'`. */
  readonly culprit: number | null;
  readonly asked: readonly AskRecord[];
  /** Suspects INCOMPATIBLES avec les réponses obtenues jusqu'ici — TOUJOURS
   *  calculé (la vue ne le montre que si `showHint`, §1.3). */
  readonly eliminated: readonly boolean[];
  readonly lastRound: RoundLog | null;
  readonly scores: readonly [number, number];
  /** ⭐ appliqué à l'INFORMATION (§1.3, §3.8) : le joueur ⭐ (niveau 1, « un
   *  coup de plus » — cf. l'aria-label des boutons ⭐/⭐⭐ de l'accueil) voit
   *  les suspects éliminés grisés automatiquement quand c'est lui qui devine ;
   *  le joueur ⭐⭐ (niveau 2, « sans coup de plus ») doit déduire seul. Décidé
   *  par le niveau du GUESSER courant, donc peut changer de manche en manche. */
  readonly showHint: boolean;
  /** La manche COURANTE est-elle la manche de départage (la 5ᵉ) ? La vue s'en
   *  sert pour l'annoncer AVANT qu'elle ne se joue : un point qui change de
   *  règle sans prévenir se lit comme une triche. */
  readonly decisive: boolean;
  readonly over: boolean;
}

function otherOf(p: 0 | 1): 0 | 1 {
  return p === 0 ? 1 : 0;
}

export class SuspectsModel {
  readonly suspects: readonly Suspect[];

  private roundIdx = 0;
  private totalRoundsVal: number = SUSPECTS_ROUNDS;
  private phaseVal: Phase = 'pick';
  private culpritVal: number | null = null;
  private askedArr: readonly AskRecord[] = [];
  private lastRoundVal: RoundLog | null = null;
  private readonly scoreArr: [number, number] = [0, 0];
  private isOverFlag = false;

  /**
   * @param seed  tirage des 6 profils — aucun `Math.random`, tout en dérive.
   * @param stars niveaux ⭐ des deux sièges (§1.3) : ne changent QUE l'aide à
   *              l'information (`showHint`), jamais les 4 traits, jamais le
   *              nombre de questions ni de manches.
   */
  constructor(
    readonly seed: number,
    readonly stars: readonly [StarLevel, StarLevel],
  ) {
    const rand = mulberry32(seed);
    this.suspects = genSuspects(rand);
  }

  private pickerOf(round: number): 0 | 1 {
    // Rôles échangés à CHAQUE manche (§3.8) : parité de l'index de manche.
    return round % 2 === 0 ? 0 : 1;
  }

  private guesserOf(round: number): 0 | 1 {
    return otherOf(this.pickerOf(round));
  }

  private computeEliminated(): boolean[] {
    if (this.culpritVal === null) return this.suspects.map(() => false);
    return this.suspects.map((s) => this.askedArr.some((a) => traitOf(s, a.trait) !== a.answer));
  }

  get state(): SuspectsState {
    const picker = this.pickerOf(this.roundIdx);
    const guesser = this.guesserOf(this.roundIdx);
    return {
      suspects: this.suspects,
      round: this.roundIdx,
      totalRounds: this.totalRoundsVal,
      phase: this.phaseVal,
      picker,
      guesser,
      culprit: this.culpritVal,
      asked: this.askedArr,
      eliminated: this.computeEliminated(),
      lastRound: this.lastRoundVal,
      scores: this.scoreArr,
      showHint: this.stars[guesser] === 1,
      decisive: this.roundIdx >= SUSPECTS_ROUNDS,
      over: this.isOverFlag,
    };
  }

  /** Coup légal ? Le jeu n'affiche jamais « coup interdit » : il l'empêche
   *  (le bouton correspondant est `disabled` — §1.1 critère 2). */
  canPick(player: 0 | 1, suspectId: number): boolean {
    if (this.isOverFlag || this.phaseVal !== 'pick') return false;
    if (player !== this.pickerOf(this.roundIdx)) return false;
    return suspectId >= 0 && suspectId < this.suspects.length;
  }

  /** A choisit le coupable EN SECRET. @returns `true` si le choix a eu lieu. */
  pick(player: 0 | 1, suspectId: number): boolean {
    if (!this.canPick(player, suspectId)) return false;
    this.culpritVal = suspectId;
    this.askedArr = [];
    this.phaseVal = 'guess';
    return true;
  }

  canAsk(player: 0 | 1, trait: TraitKey): boolean {
    if (this.isOverFlag || this.phaseVal !== 'guess') return false;
    if (player !== this.guesserOf(this.roundIdx)) return false;
    if (this.askedArr.length >= SUSPECTS_QUESTIONS) return false;
    return !this.askedArr.some((a) => a.trait === trait);
  }

  /** Le jeu répond lui-même oui/non — jamais d'échange verbal (§3.8). */
  ask(player: 0 | 1, trait: TraitKey): boolean {
    if (!this.canAsk(player, trait)) return false;
    const culprit = this.suspects[this.culpritVal as number];
    this.askedArr = [...this.askedArr, { trait, answer: traitOf(culprit, trait) }];
    return true;
  }

  /** N'importe lequel des 6 reste une cible légale d'accusation en
   *  permanence : le jeu ne force jamais un coup « intelligent » (§3.8, « il
   *  accuse en tapant un suspect »). */
  canAccuse(player: 0 | 1, suspectId: number): boolean {
    if (this.isOverFlag || this.phaseVal !== 'guess') return false;
    if (player !== this.guesserOf(this.roundIdx)) return false;
    return suspectId >= 0 && suspectId < this.suspects.length;
  }

  /** B accuse : résout la manche, met à jour le score, avance vers la
   *  suivante (ou la fin de partie). @returns `true` si l'accusation a eu lieu. */
  accuse(player: 0 | 1, suspectId: number): boolean {
    if (!this.canAccuse(player, suspectId)) return false;
    const round = this.roundIdx;
    const picker = this.pickerOf(round);
    const guesser = this.guesserOf(round);
    const culprit = this.culpritVal as number;
    const correct = suspectId === culprit;
    // MANCHE DE DÉPARTAGE (§3 : « une égalité est structurellement impossible,
    // ou un départage lisible est défini »). Sur les 4 manches ordinaires,
    // seul « trouvé » rapporte ; sur la 5ᵉ, qui n'existe QUE pour départager,
    // un échec donne le point au cachottier — sans quoi la 5ᵉ manche pouvait
    // se solder par le MÊME 2-2 et le match se terminait sur un nul (mesuré au
    // fuzz : 31 nuls sur 80 parties). Un point est donc TOUJOURS attribué en
    // manche décisive : l'égalité finale est impossible par construction.
    const decisive = round >= SUSPECTS_ROUNDS;
    const pointTo: 0 | 1 | null = correct ? guesser : decisive ? picker : null;
    if (pointTo !== null) this.scoreArr[pointTo] += 1;
    this.lastRoundVal = {
      round,
      picker,
      guesser,
      culprit,
      accused: suspectId,
      correct,
      decisive,
      pointTo,
      asked: this.askedArr,
    };
    this.advanceRound();
    return true;
  }

  private startRound(round: number): void {
    this.roundIdx = round;
    this.phaseVal = 'pick';
    this.culpritVal = null;
    this.askedArr = [];
  }

  /** §3.8 : « rôles échangés à chaque manche, 4 manches. En cas d'égalité,
   *  une 5ᵉ manche. » Cette 5ᵉ manche attribue TOUJOURS son point (voir
   *  `accuse`), donc elle départage toujours : il n'y a jamais de 6ᵉ manche,
   *  jamais de nul, et la durée reste bornée (§1.2, 45-90 s). */
  private advanceRound(): void {
    const next = this.roundIdx + 1;
    if (next < SUSPECTS_ROUNDS) {
      this.startRound(next);
      return;
    }
    if (next === SUSPECTS_ROUNDS && this.scoreArr[0] === this.scoreArr[1]) {
      this.totalRoundsVal = SUSPECTS_ROUNDS + 1;
      this.startRound(next);
      return;
    }
    this.isOverFlag = true;
  }

  /** §1.1 critère 4 — la CAUSE en une phrase courte. Deux formulations, parce
   *  qu'il y a deux causes possibles de victoire : avoir démasqué plus de
   *  coupables, ou en avoir caché un jusqu'au bout à la manche décisive (un
   *  « 3 coupables trouvés contre 2 » mentirait alors sur le dernier point).
   *  `winner === null` n'est plus atteignable en fin de partie (cf. `accuse`)
   *  mais reste géré : `result` est aussi lu en cours de partie par le bot. */
  get result(): Result {
    const [a, b] = this.scoreArr;
    const winner: 0 | 1 | null = a === b ? null : a > b ? 0 : 1;
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    const plural = (n: number): string => (n > 1 ? 's' : '');
    const hidden = this.lastRoundVal?.decisive === true && this.lastRoundVal.correct === false;
    const reason =
      winner === null
        ? `${a} coupable${plural(a)} trouvé${plural(a)} chacun`
        : hidden
          ? `coupable resté caché à la dernière manche : ${hi} contre ${lo}`
          : `${hi} coupable${plural(hi)} trouvé${plural(hi)} contre ${lo}`;
    return { winner, scores: [a, b], reason };
  }
}
