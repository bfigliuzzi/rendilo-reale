import { clamp } from '@shared/math';
import type { Sfx } from '../audio/sfx';
import { CAMPAIGN_BY_SPECIES, CAMPAIGN_LENGTH, CAMPAIGNS } from '../config/campaigns';
import { PLAYER, SPECIES_IDS, type Faction, type LevelDef, type SpeciesId } from '../config/levels';
import { MAPS } from '../config/maps';
import type { Gestures } from '../input/gestures';
import { ACHIEVEMENTS, evalFeats, FEATS, reachedTiers, targetOf } from '../meta/achievements';
import { campaignUnlocked, clampSendFrac, persist, resetSave, type SaveData } from '../meta/save';
import type { Hud } from '../ui/hud';
import type { Screens } from '../ui/screens';
import type { Tutorial } from './tutorial';
import type { World } from './world';

export type FlowState = 'menu' | 'playing' | 'result';

const SPECIES_EMOJI: Record<SpeciesId, string> = { bee: '🐝', fly: '🪰', roach: '🪳' };

/**
 * Machine à états menu (accueil → grille de campagne) → partie → résultat.
 * SEUL endroit habilité à toucher la sauvegarde (déverrouillage, records,
 * fraction d'envoi, mute, reset). `campaign` = campagne actuellement parcourue.
 */
export class Flow {
  state: FlowState = 'menu';
  campaign: SpeciesId = 'bee';
  private levelIdx = 0;

  constructor(
    private readonly world: World,
    private readonly screens: Screens,
    private readonly gestures: Gestures,
    private readonly hud: Hud,
    private readonly tutorial: Tutorial,
    private readonly save: SaveData,
    private readonly sfx: Sfx,
  ) {
    screens.onSelectCampaign = (sp): void => this.showCampaign(sp);
    screens.onPlay = (n): void => this.startGame(n);
    screens.onHome = (): void => this.showMenu();
    screens.onMenu = (): void => this.showCampaign(this.campaign); // résultat → grille
    screens.onReplay = (): void => this.startGame(this.levelIdx);
    screens.onNext = (): void => this.startGame(this.levelIdx + 1);
    screens.onShowAchievements = (): void => this.showAchievements();
    screens.onResetProgress = (): void => {
      resetSave(this.save);
      persist(this.save);
      this.sfx.setMuted(this.save.muted);
      this.showMenu();
    };
    screens.onToggleMute = (): void => {
      this.save.muted = !this.save.muted;
      this.sfx.setMuted(this.save.muted);
      persist(this.save);
      this.showMenu(); // re-render pour l'état du bouton
    };
    // restart instantané (loadLevel est synchrone) — le tutoriel repart avec la carte
    hud.onRestart = (): void => {
      if (this.state === 'playing') this.startGame(this.levelIdx);
    };
    hud.onSendFracChange = (v): void => {
      const frac = clampSendFrac(v);
      this.world.sendFrac = frac;
      this.hud.setSendFrac(frac);
      if (frac !== this.save.sendFrac) {
        this.save.sendFrac = frac;
        persist(this.save);
      }
    };
    world.onGameOver = (victory, timeSec): void => this.onGameOver(victory, timeSec);
  }

  /** Emoji des clans adverses d'une carte (pour l'aria-label des pastilles). */
  private foesOf(def: LevelDef): string {
    return def.factions
      .slice(1)
      .map((f) => SPECIES_EMOJI[f.species])
      .join('');
  }

  /** Accueil : les 3 campagnes, verrouillage dérivé du save (jamais stocké). */
  showMenu(): void {
    this.leaveGame();
    this.screens.showHome({
      campaigns: CAMPAIGNS.map((c) => {
        const locked = !campaignUnlocked(this.save, c.species);
        const done = c.levels.reduce((acc, lvl) => acc + (this.save.bestTimes[lvl.id] !== undefined ? 1 : 0), 0);
        let hint: string | null = null;
        if (locked && c.unlockedBy) {
          hint = CAMPAIGN_BY_SPECIES[c.unlockedBy.campaign].levels[c.unlockedBy.level - 1].name;
        }
        return { species: c.species, emoji: c.emoji, name: c.name, done, total: CAMPAIGN_LENGTH, locked, hint };
      }),
      muted: this.save.muted,
    });
  }

  /** Grille de niveaux d'une campagne (verrouillée = ignorée, garde côté home). */
  private showCampaign(species: SpeciesId): void {
    if (!campaignUnlocked(this.save, species)) return;
    this.campaign = species;
    this.leaveGame();
    const c = CAMPAIGN_BY_SPECIES[species];
    const unlocked = Math.min(this.save.campaigns[species].unlocked, CAMPAIGN_LENGTH);
    let firstUndone = -1;
    const chips = c.levels.map((lvl, i) => {
      const locked = i >= unlocked;
      const done = this.save.bestTimes[lvl.id] !== undefined;
      if (!locked && !done && firstUndone < 0) firstUndone = i;
      return {
        n: i + 1,
        locked,
        done,
        primary: false,
        bestTime: this.save.bestTimes[lvl.id] ?? null,
        fullName: lvl.name,
        foes: this.foesOf(lvl),
      };
    });
    if (firstUndone >= 0) chips[firstUndone].primary = true;
    this.screens.showCampaign({ species, emoji: c.emoji, name: c.name }, chips);
  }

  /** Écran des succès : Flow précalcule les entrées (seul lecteur du save). */
  private showAchievements(): void {
    this.leaveGame();
    this.screens.showAchievements(
      ACHIEVEMENTS.map((a) => {
        const tier = reachedTiers(a, this.save);
        return {
          icon: a.icon,
          name: a.name,
          desc: a.desc,
          value: a.value(this.save),
          tier,
          prevTarget: tier > 0 ? targetOf(a, tier - 1) : 0,
          nextTarget: targetOf(a, tier),
        };
      }),
      FEATS.map((f) => ({
        icon: f.icon,
        name: f.name,
        desc: f.desc,
        done: this.save.feats[f.id] === true,
        hard: f.hard === true,
      })),
    );
  }

  /** Sort de l'état « en jeu » (partagé par showMenu/showCampaign). */
  private leaveGame(): void {
    this.state = 'menu';
    this.world.playing = false;
    this.gestures.setEnabled(false);
    this.hud.setInGame(false);
    this.tutorial.stop();
  }

  /**
   * Charge un niveau d'une campagne. Refuse si la campagne est verrouillée ;
   * clampe le niveau sur la progression. Signature stable `(species, level)` :
   * appelée telle quelle par le bot de vérification.
   */
  startLevel(species: SpeciesId, level: number): void {
    if (!campaignUnlocked(this.save, species)) return;
    this.campaign = species;
    const unlocked = Math.min(this.save.campaigns[species].unlocked, CAMPAIGN_LENGTH);
    this.levelIdx = clamp(level, 0, unlocked - 1);
    this.state = 'playing';
    const def = CAMPAIGN_BY_SPECIES[species].levels[this.levelIdx];
    this.world.loadLevel(def);
    this.world.sendFrac = this.save.sendFrac;
    this.hud.setSendFrac(this.save.sendFrac);
    this.gestures.setEnabled(true);
    this.hud.setInGame(true);
    if (def.tutorial) this.tutorial.start(def.tutorial, this.world);
    else this.tutorial.stop();
    this.screens.hide();
  }

  /** Délègue à startLevel dans la campagne courante (compat scripts/replay/next). */
  startGame(level: number): void {
    this.startLevel(this.campaign, level);
  }

  private onGameOver(victory: boolean, timeSec: number): void {
    this.state = 'result';
    this.gestures.setEnabled(false);
    this.hud.setInGame(false);
    this.tutorial.stop();
    if (victory) this.sfx.victory();
    else this.sfx.defeat();
    const sp = this.campaign;
    const def = CAMPAIGN_BY_SPECIES[sp].levels[this.levelIdx];
    let newBest = false;
    let unlockedCampaign: { emoji: string; name: string } | undefined;
    if (victory) {
      // snapshot du franchissement des jalons AVANT écriture (fly/roach)
      const before = SPECIES_IDS.map((s) => campaignUnlocked(this.save, s));
      this.save.campaigns[sp].unlocked = Math.max(
        this.save.campaigns[sp].unlocked,
        Math.min(this.levelIdx + 2, CAMPAIGN_LENGTH),
      );
      const prev = this.save.bestTimes[def.id];
      if (prev === undefined || timeSec < prev) {
        this.save.bestTimes[def.id] = Math.round(timeSec);
        newBest = true;
      }
      for (let i = 0; i < SPECIES_IDS.length; i++) {
        if (!before[i] && campaignUnlocked(this.save, SPECIES_IDS[i])) {
          const c = CAMPAIGN_BY_SPECIES[SPECIES_IDS[i]];
          unlockedCampaign = { emoji: c.emoji, name: c.name };
          break;
        }
      }
    }
    // Flush succès APRÈS progression/bestTimes (les checks de feats lisent le
    // save à jour), puis UNE seule écriture — victoire ET défaite. Le restart ↻
    // et le retour menu ne flushent PAS : une partie abandonnée ne compte pas
    // (assumé — pas de farm de compteurs au restart) ; ?stress ne passe jamais
    // par onGameOver (checkEnd court-circuité).
    const run = this.world.run;
    const sum = this.world.runSummary();
    const counters = this.save.counters;
    counters.captures += run.captures;
    counters.upgrades += run.upgrades;
    counters.unitsSent += sum.unitsSent;
    counters.annihilations += sum.annihilations;
    counters.playSec += Math.round(timeSec);
    if (victory) counters.wins++;
    else counters.losses++;
    const featIds = evalFeats({
      save: this.save,
      victory,
      timeSec,
      campaign: sp,
      levelIdx: this.levelIdx,
      def,
      run,
      unitsSent: sum.unitsSent,
      neutralLeft: this.world.nodes.byFaction[0],
    });
    const newFeats: string[] = [];
    for (const id of featIds) {
      this.save.feats[id] = true;
      const f = FEATS.find((x) => x.id === id);
      if (f) newFeats.push(f.name);
    }
    persist(this.save);
    this.screens.showResult({
      victory,
      timeSec,
      nodesOwned: this.world.nodes.byFaction[PLAYER],
      levelName: def.name,
      playerEmoji: SPECIES_EMOJI[sp],
      hasNext: victory && this.levelIdx + 1 < CAMPAIGN_LENGTH,
      newBest,
      unlockedCampaign,
      newFeats,
    });
  }

  /** Mode ?stress : carte bi-camps saturée, pool d'unités à fond, pas de fin. */
  startStress(): void {
    this.state = 'playing';
    const base = MAPS[1];
    const def: LevelDef = {
      ...base,
      nodes: base.nodes.map((n, i) => ({ ...n, faction: (i % 2 === 0 ? PLAYER : 2) as Faction, stock: 60 })),
      factions: [{ species: 'bee' }, { species: 'roach' }],
      tutorial: undefined,
    };
    this.world.loadLevel(def);
    this.world.stress = true;
    this.gestures.setEnabled(true);
    this.hud.setInGame(true);
    this.screens.hide();
  }
}
