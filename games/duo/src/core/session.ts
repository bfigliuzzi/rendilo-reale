import { MASCOTS, mascotById, type MascotDef } from '../config/mascots';
import { loadSave, persist, resetSave, type DuoSave, type StarLevel } from '../meta/save';
import type { Result } from './minigame';

/**
 * L'état de la TABLE : qui joue, avec quelle mascotte, à quel niveau ⭐, où en
 * est le score de la soirée, et à qui revient le choix du jeu suivant.
 *
 * C'est le SEUL module de `games/duo/` qui touche au `localStorage` (même
 * discipline que « seul `flow.ts` écrit la save » dans les cinq autres jeux du
 * hub). Un micro-jeu ne le connaît même pas : il reçoit ses `stars` et son
 * `seed` par `MiniGameCtx`.
 *
 * DEUX ÉTATS, DEUX DURÉES DE VIE, et ce n'est pas un détail :
 *   - ce qui est dans `save` survit à la fermeture de l'onglet (mascottes, ⭐,
 *     muet, mouvement réduit, dernier jeu, jeux vus) ;
 *   - `score` et `chooser` vivent en MÉMOIRE et meurent avec l'onglet (§1.3).
 *     Le palmarès de la table est éphémère par décision de design.
 */
export class Session {
  readonly save: DuoSave;

  /**
   * Score cumulé de la table. ÉPHÉMÈRE : jamais écrit dans le save, jamais
   * relu au boot. Le remettre dans la sauvegarde serait la façon la plus
   * simple de casser §1.3 sans s'en apercevoir.
   */
  readonly score: [number, number] = [0, 0];

  /**
   * « Le perdant choisit le jeu suivant » — la seule règle de méta de la
   * collection, et elle est obligatoire. `null` avant la première manche (ou
   * après une manche coopérative, où personne n'a perdu).
   */
  chooser: 0 | 1 | null = null;

  /** Seed du micro-jeu courant : rejouable, exposé au bot. */
  seed = 1;

  /**
   * `prefers-reduced-motion`, lu UNE FOIS au boot. En OU avec l'option joueur,
   * jamais en ET : on ne contredit pas une préférence système (la case de
   * l'écran d'options est alors cochée ET verrouillée).
   */
  readonly systemReducedMotion: boolean;

  constructor() {
    this.save = loadSave();
    this.systemReducedMotion =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;
    this.seed = randomSeed();
  }

  // ───────── Lectures ─────────

  get reducedMotion(): boolean {
    return this.save.reducedMotion || this.systemReducedMotion;
  }

  get muted(): boolean {
    return this.save.muted;
  }

  /** Niveaux ⭐ des deux sièges, dans la forme attendue par `MiniGameCtx`. */
  get stars(): [StarLevel, StarLevel] {
    return [this.save.players[0].stars, this.save.players[1].stars];
  }

  mascot(player: 0 | 1): MascotDef {
    return mascotById(this.save.players[player].mascot);
  }

  hasSeen(gameId: string): boolean {
    return this.save.seen[gameId] === true;
  }

  // ───────── Écritures (les SEULES du jeu) ─────────

  setMascot(player: 0 | 1, mascotId: string): void {
    this.save.players[player].mascot = mascotById(mascotId).id;
    // Deux joueurs sur la même mascotte, ce sont deux joueurs qui ne se
    // distinguent plus : on pousse l'autre sur une mascotte libre.
    const other: 0 | 1 = player === 0 ? 1 : 0;
    if (this.save.players[other].mascot === this.save.players[player].mascot) {
      this.save.players[other].mascot = firstFreeMascot(this.save.players[player].mascot);
    }
    this.flush();
  }

  setStars(player: 0 | 1, stars: StarLevel): void {
    this.save.players[player].stars = stars;
    this.flush();
  }

  setMuted(muted: boolean): void {
    this.save.muted = muted;
    this.flush();
  }

  setReducedMotion(on: boolean): void {
    this.save.reducedMotion = on;
    this.flush();
  }

  /** Marque un jeu comme vu : sa démo ne s'imposera plus au lancement (§2.4). */
  markSeen(gameId: string): void {
    if (this.save.seen[gameId] === true) return;
    this.save.seen[gameId] = true;
    this.flush();
  }

  setLastGame(gameId: string): void {
    if (this.save.lastGame === gameId) return;
    this.save.lastGame = gameId;
    this.flush();
  }

  /** Remise à zéro complète (bouton de l'écran d'options, deux temps). */
  reset(): void {
    resetSave(this.save);
    this.score[0] = 0;
    this.score[1] = 0;
    this.chooser = null;
    this.flush();
  }

  /** Unique point d'écriture du `localStorage` de toute la collection. */
  private flush(): void {
    persist(this.save);
  }

  // ───────── Manche ─────────

  /** Nouveau tirage pour la manche à venir. Rejouable si on le force. */
  nextSeed(): number {
    this.seed = randomSeed();
    return this.seed;
  }

  /** Le bot fixe le seed pour rejouer une manche à l'identique. */
  setSeed(seed: number): void {
    this.seed = seed >>> 0 || 1;
  }

  /**
   * Enregistre une fin de manche : score éphémère et « le perdant choisit ».
   * Une manche coopérative n'a pas de perdant — le choix reste alors à celui
   * qui l'avait, sinon on punirait la coopération d'une règle arbitraire.
   */
  recordResult(result: Result): void {
    if (result.winner === null) return;
    this.score[result.winner] += 1;
    this.chooser = result.winner === 0 ? 1 : 0;
  }
}

/**
 * Seed de manche. `Math.random` est autorisé ICI et nulle part ailleurs : la
 * règle du §3 interdit le hasard non seedé dans le CONTENU d'une manche, pas le
 * tirage du seed lui-même (même parti pris que le re-seed de campagne de Horde).
 */
function randomSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}

function firstFreeMascot(taken: string): string {
  for (const m of MASCOTS) if (m.id !== taken) return m.id;
  return taken;
}

export { persist };
