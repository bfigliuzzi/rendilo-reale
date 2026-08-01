import { DIFFICULTIES } from '../config/balance';
import { pegName } from '../config/pegs';
import { DIFFICULTY_IDS } from '../config/rules';
import type { Difficulty } from '../config/rules';
import type { Sfx } from '../audio/sfx';
import { ACHIEVEMENTS, FEATS, evalFeats, reachedTiers, targetOf } from '../meta/achievements';
import { isBetter, persist, resetSave } from '../meta/save';
import type { SaveData } from '../meta/save';
import type { Ambience } from '../render/ambience';
import type { Fx } from '../render/fx';
import { describeFeedback } from '../ui/hud';
import type { Hud } from '../ui/hud';
import type { AchEntry, DiffCardView, FeatEntry, Screens } from '../ui/screens';
import type { World } from './world';

export type FlowState = 'menu' | 'help' | 'ach' | 'playing' | 'result';

const EMOJI: Record<Difficulty, string> = { easy: '🌱', normal: '🎯', hard: '💀' };

function ruleText(d: Difficulty): string {
  const def = DIFFICULTIES[d];
  const extras = [def.duplicates ? 'doublons' : 'sans doublon'];
  if (def.allowEmpty) extras.push('pion vide');
  return `${def.pegs} pions · ${def.colors} couleurs · ${def.tries} essais · ${extras.join(' + ')}`;
}

/**
 * Machine à états menu → jeu → résultat, et SEUL endroit du jeu qui écrit la
 * sauvegarde. `World` ne connaît ni les modes ni la méta ; `Screens` et `Hud` ne
 * lisent jamais le save — Flow leur passe des vues déjà calculées.
 */
export class Flow {
  state: FlowState = 'menu';
  difficulty: Difficulty;
  private seed = 1;

  constructor(
    private readonly world: World,
    private readonly screens: Screens,
    private readonly hud: Hud,
    private readonly fx: Fx,
    private readonly ambience: Ambience,
    private readonly save: SaveData,
    private readonly sfx: Sfx,
    /** `prefers-reduced-motion` du système, lu une fois au boot. */
    private readonly systemReducedMotion: boolean,
  ) {
    this.difficulty = save.lastDifficulty;
    this.applyReducedMotion();

    screens.onStart = (d): void => this.startGame(d);
    screens.onHome = (): void => this.showMenu();
    screens.onHelp = (): void => this.showHelp();
    screens.onAchievements = (): void => this.showAchievements();
    screens.onReplay = (): void => this.startGame(this.difficulty);
    screens.onToggle = (key, value): void => {
      if (key === 'muted') {
        this.save.muted = value;
        this.sfx.setMuted(value);
      } else if (key === 'catMischief') {
        this.save.catMischief = value;
        this.world.cat.setMischief(value);
      } else {
        this.save.reducedMotion = value;
        this.applyReducedMotion();
      }
      persist(this.save);
      // on rafraîchit l'écran sans bouger le focus (même écran → Screens le sait)
      if (this.state === 'menu') this.showMenu();
    };
    screens.onResetProgress = (): void => {
      resetSave(this.save);
      persist(this.save);
      this.difficulty = this.save.lastDifficulty;
      this.sfx.setMuted(this.save.muted);
      this.applyReducedMotion();
      this.showMenu();
    };

    hud.onPick = (i): void => this.world.pick(i);
    hud.onPlace = (slot): void => this.world.place(slot);
    hud.onSet = (slot, index): void => this.world.setSlot(slot, index);
    hud.onClearSlot = (slot): void => this.world.clearSlot(slot);
    hud.onSubmit = (): void => {
      this.world.submit();
    };
    hud.onUndo = (): void => {
      this.world.undo();
    };
    hud.onMenu = (): void => this.showMenu();
    hud.onRestart = (): void => this.startGame(this.difficulty);
    hud.onFocusSlot = (slot): void => {
      this.world.focusSlot = slot;
    };

    world.onRowValidated = (row, fb): void => {
      this.hud.pushHistory(this.world.board!, row);
      const left = this.world.board!.triesLeft;
      this.hud.announce(
        `Essai ${row + 1} : ${describeFeedback(fb.exact, fb.misplaced)}. ` +
          (left > 0 ? `${left} essai${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''}.` : 'Plus d’essai.'),
      );
      if (!this.world.board!.over) this.hud.focusFirstFreeSlot(this.world.board!);
    };
    world.onBoardChanged = (): void => {
      if (this.world.board) this.hud.refreshActions(this.world.board);
    };
    world.onRowComplete = (): void => {
      // l'ordre compte : ✓ doit être ACTIF avant qu'on tente de lui donner le focus
      if (this.world.board) this.hud.refreshActions(this.world.board);
      this.hud.focusSubmitIfInBoard();
    };
    world.onMischief = (e): void => {
      const message =
        e.kind === 'swap'
          ? `Le chat a échangé les pions ${e.a + 1} et ${e.b + 1} ! Bouton Annuler, ou touche Z, pour revenir en arrière.`
          : `Le chat a chipé le pion ${e.a + 1}${e.stolen === null ? '' : ` (${pegName(e.stolen)})`} ! Bouton Annuler, ou touche Z, pour revenir en arrière.`;
      this.hud.announceCat(message, 6);
    };
    world.onGameOver = (victory, timeSec, tries): void => this.onGameOver(victory, timeSec, tries);
  }

  private applyReducedMotion(): void {
    const on = this.systemReducedMotion || this.save.reducedMotion;
    this.fx.reducedMotion = on;
    this.ambience.reducedMotion = on;
  }

  // ───────────────────────────────────────────────────────── écrans

  showMenu(): void {
    this.state = 'menu';
    this.world.leave();
    this.hud.setInGame(false);
    // Sur une sauvegarde vierge, `lastDifficulty` vaut « normal » par défaut :
    // l'annoncer comme une « reprise » mentirait. On la présente alors comme le
    // mode CONSEILLÉ (c'est la règle officielle du Mastermind).
    const fresh = this.save.counters.games === 0;
    const cards: DiffCardView[] = DIFFICULTY_IDS.map((id) => {
      const best = this.save.best[id];
      return {
        id,
        name: DIFFICULTIES[id].name,
        emoji: EMOJI[id],
        rule: ruleText(id),
        best: best
          ? `record : ${best.tries} essai${best.tries > 1 ? 's' : ''} · ${this.save.wins[id]} victoire${this.save.wins[id] > 1 ? 's' : ''}`
          : 'jamais gagné',
        tag: id === this.difficulty ? (fresh ? 'conseillé' : 'reprise') : '',
      };
    });
    this.screens.showHome({
      cards,
      muted: this.save.muted,
      catMischief: this.save.catMischief,
      reducedMotion: this.save.reducedMotion,
      systemReducedMotion: this.systemReducedMotion,
      streak: this.save.streak,
      bestStreak: this.save.bestStreak,
    });
  }

  private showHelp(): void {
    this.state = 'help';
    this.screens.showHelp();
  }

  private showAchievements(): void {
    this.state = 'ach';
    const ach: AchEntry[] = ACHIEVEMENTS.map((def) => {
      const tier = reachedTiers(def, this.save);
      return {
        icon: def.icon,
        name: def.name,
        desc: def.desc,
        tier,
        value: def.value(this.save),
        target: targetOf(def, tier),
        unit: def.unit ?? '',
      };
    });
    const feats: FeatEntry[] = FEATS.map((f) => ({
      icon: f.icon,
      name: f.name,
      desc: f.desc,
      unlocked: this.save.feats[f.id] === true,
      hard: f.hard === true,
    }));
    this.screens.showAchievements(ach, feats);
  }

  // ───────────────────────────────────────────────────────── partie

  /**
   * Démarre une partie. SIGNATURE STABLE : `tools/verify-mind.mjs` l'appelle
   * directement, avec une graine fixe pour ses scénarios reproductibles.
   */
  startGame(difficulty: Difficulty, seed?: number): void {
    this.difficulty = difficulty;
    this.seed = seed ?? Math.floor(Math.random() * 0x7fffffff) + 1;
    this.state = 'playing';
    this.screens.hide();
    this.hud.setup(DIFFICULTIES[difficulty]);
    this.hud.setInGame(true);
    this.world.loadGame(DIFFICULTIES[difficulty], this.seed, true, this.save.catMischief);
    if (this.save.lastDifficulty !== difficulty) {
      this.save.lastDifficulty = difficulty;
      persist(this.save);
    }
  }

  /** Frame de rendu : rafraîchit le HUD (libellés, états des boutons). */
  onFrame(frameMs: number): void {
    if (this.state === 'playing' && this.world.board) {
      this.hud.sync(this.world.board, this.world.selected, frameMs / 1000);
    }
  }

  /**
   * Fin de partie. L'ORDRE compte : on met d'abord le save à jour (compteurs,
   * records, série) pour que `evalFeats` lise un état frais, puis on pose les
   * hauts faits, et on fait UNE SEULE écriture. Une partie abandonnée (↻ ou
   * retour menu) n'est délibérément pas comptabilisée.
   */
  private onGameOver(victory: boolean, timeSec: number, tries: number): void {
    this.state = 'result';
    const def = DIFFICULTIES[this.difficulty];
    const c = this.save.counters;
    c.games++;
    c.guesses += this.world.run.guesses;
    c.exactPegs += this.world.run.exactPegs;
    c.catMischiefs += this.world.run.mischiefs;
    c.undos += this.world.run.undos;
    c.playSec += timeSec;

    let record = false;
    if (victory) {
      c.wins++;
      this.save.wins[this.difficulty]++;
      this.save.streak++;
      this.save.bestStreak = Math.max(this.save.bestStreak, this.save.streak);
      const candidate = { tries, timeSec };
      if (isBetter(candidate, this.save.best[this.difficulty])) {
        this.save.best[this.difficulty] = candidate;
        record = true;
      }
    } else {
      c.losses++;
      this.save.streak = 0;
    }

    const fresh = evalFeats({
      save: this.save,
      victory,
      difficulty: this.difficulty,
      tries,
      timeSec,
      mischiefs: this.world.run.mischiefs,
      undos: this.world.run.undos,
    });
    for (const id of fresh) this.save.feats[id] = true;
    persist(this.save);

    const secret = (this.world.board?.secret ?? []).map((v) => pegName(v));
    this.hud.setInGame(false);
    this.screens.showResult({
      victory,
      difficultyName: def.name,
      tries,
      maxTries: def.tries,
      timeSec,
      secret,
      record,
      freshFeats: fresh.map((id) => {
        const f = FEATS.find((x) => x.id === id);
        return { icon: f?.icon ?? '🏅', name: f?.name ?? id };
      }),
      streak: this.save.streak,
    });
  }
}
