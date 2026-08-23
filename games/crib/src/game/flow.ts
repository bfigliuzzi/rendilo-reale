import type { Sfx } from '../audio/sfx';
import { makeGarden, type LevelDef } from '../config/levels';
import type { Steer } from '../input/steer';
import { persist, type SaveData } from '../meta/save';
import type { Decor } from '../render/decor';
import type { Hud } from '../ui/hud';
import type { Screens } from '../ui/screens';
import { makeLevel, type Level } from './level';
import type { NightCheckpoint, World } from './world';

export type FlowState = 'menu' | 'day' | 'night' | 'result';

/**
 * Machine à états menu → jour ⇄ nuit → résultat, et SEUL endroit du jeu habilité à
 * écrire la sauvegarde. `World` ne connaît ni les modes ni la méta ; `Screens` et
 * `Hud` ne lisent jamais le save pour décider quoi que ce soit.
 *
 * La règle de partage tient en une phrase : **Flow possède la PHASE, World possède
 * l'HORLOGE DE NUIT.** Le jour n'a délibérément aucune horloge — il dure tant que
 * le joueur n'a pas appuyé sur « Lancer la nuit ». C'est ça, la respiration qui
 * manquait au premier jet.
 *
 * C'est aussi Flow qui arme et désarme les entrées : sans ça le bébé dérive en
 * arrière-plan pendant qu'on lit l'écran de résultat.
 */
export class Flow {
  state: FlowState = 'menu';
  /** Seed de la partie courante — rejouable à l'identique, et lisible par le bot. */
  seed = 0xbebe;
  /** Index 0-based de la nuit en cours ou à venir. */
  nightIndex = 0;
  /** Hook de l'overlay `?debug` : appelé après chaque chargement de niveau. */
  onLevelLoaded: ((level: Level) => void) | null = null;

  private def: LevelDef = makeGarden();
  /** État du niveau au lancement de la nuit : c'est « Rejouer la nuit ». */
  private checkpoint: NightCheckpoint | null = null;

  constructor(
    private readonly world: World,
    private readonly screens: Screens,
    private readonly hud: Hud,
    private readonly decor: Decor,
    private readonly steer: Steer,
    private readonly save: SaveData,
    private readonly sfx: Sfx,
  ) {
    this.screens.onPlay = () => this.startLevel();
    this.screens.onMenu = () => this.showMenu();
    this.screens.onRetryNight = () => this.retryNight();
    this.screens.onToggleMute = () => this.toggleMute();
    this.hud.onRestart = () => this.startLevel(this.seed);
    this.hud.onLaunchNight = () => this.startNight();
    this.world.onNightCleared = (i, sec) => this.onNightCleared(i, sec);
    this.world.onCribFallen = () => this.onDefeat();
  }

  showMenu(): void {
    this.state = 'menu';
    this.leaveGame();
    this.screens.showMenu();
  }

  /**
   * Signature STABLE : appelée telle quelle par `tools/verify-crib.mjs`. Le seed est
   * explicite pour que le bot puisse rejouer exactement la même partie — sans ça,
   * une régression d'équilibrage serait indiscernable d'un tirage malheureux.
   *
   * Elle dépose au JOUR 1, arène jouable : contacts, engluement et tir auto tournent
   * déjà, ce qui est la condition pour que le scénario `grip` fonctionne inchangé.
   */
  startLevel(seed?: number): void {
    this.seed = seed ?? (Math.floor(Math.random() * 0xffffff) | 1);
    this.def = makeGarden(this.seed);
    const level = makeLevel(this.def);
    this.screens.hide();
    this.decor.setup(level);
    this.world.loadLevel(level);
    this.nightIndex = 0;
    this.checkpoint = null;
    this.steer.setEnabled(true);
    this.enterDay();
    this.onLevelLoaded?.(level);
  }

  /** Exactement ce que fait le bouton « Lancer la nuit ». Appelé aussi par le bot. */
  startNight(): void {
    if (this.state !== 'day') return;
    this.checkpoint = this.world.checkpoint();
    this.world.startNight(this.nightIndex);
    this.state = 'night';
    this.hud.setPhase('night', this.nightView());
    this.sfx.wave();
  }

  /** `?stress` : mesure du budget de rendu, hors de toute condition de fin. */
  startStress(): void {
    this.startLevel(1);
    this.world.startStress();
  }

  private enterDay(): void {
    this.state = 'day';
    this.world.phase = 'day';
    this.world.nightIndex = this.nightIndex;
    this.world.playing = true;
    this.steer.setEnabled(true);
    this.hud.setInGame(true);
    this.hud.setPhase('day', this.nightView());
  }

  private nightView(): { n: number; total: number; brief: string } {
    const night = this.def.nights[Math.min(this.nightIndex, this.def.nights.length - 1)];
    return { n: night.n, total: this.def.nights.length, brief: night.brief };
  }

  private leaveGame(): void {
    this.world.playing = false;
    this.steer.setEnabled(false);
    this.hud.setInGame(false);
  }

  private onNightCleared(index: number, sec: number): void {
    if (index >= this.def.nights.length - 1) {
      this.onVictory();
      return;
    }
    this.nightIndex = index + 1;
    // les bâtiments entamés sont réparés au lever du jour (dès qu'ils existeront) :
    // sinon la dernière nuit se joue derrière un mur de ruines et le joueur ne peut
    // que subir ce qu'il a déjà payé.
    this.sfx.pickup();
    this.enterDay();
    this.hud.announce(`Nuit ${index + 1} tenue en ${Math.round(sec)} secondes. Jour ${index + 2}.`);
  }

  private onVictory(): void {
    this.state = 'result';
    this.leaveGame();
    const timeSec = this.world.nightSecTotal;

    // une SEULE écriture par fin de NIVEAU, victoire comme défaite. Le redémarrage
    // ↻ et le retour menu ne flushent pas : assumé, c'est un abandon, pas un score.
    this.save.runs++;
    this.save.wins++;
    // le critère de record est le temps de nuit cumulé, mais les PV de berceau
    // départagent : finir vite en laissant le berceau en ruine n'est pas mieux
    const better =
      this.save.bestTimeSec === null ||
      timeSec < this.save.bestTimeSec ||
      (Math.abs(timeSec - this.save.bestTimeSec) < 0.5 && this.world.crib.hp > this.save.bestCribHp);
    if (better) {
      this.save.bestTimeSec = timeSec;
      this.save.bestCribHp = this.world.crib.hp;
    }
    persist(this.save);
    this.sfx.victory();
    this.screens.showResult({
      victory: true,
      night: this.def.nights.length,
      nights: this.def.nights.length,
      timeSec,
      cribHp: this.world.crib.hp,
      cribMax: this.world.crib.maxHp,
      run: this.world.run,
      goldEarned: this.world.economy.earnedTotal,
      record: better,
      canRetryNight: false,
    });
  }

  private onDefeat(): void {
    this.state = 'result';
    this.leaveGame();
    this.save.runs++;
    persist(this.save);
    this.sfx.defeat();
    this.screens.showResult({
      victory: false,
      night: this.nightIndex + 1,
      nights: this.def.nights.length,
      timeSec: this.world.nightSecTotal,
      cribHp: 0,
      cribMax: this.world.crib.maxHp,
      run: this.world.run,
      goldEarned: this.world.economy.earnedTotal,
      record: false,
      // deux issues, et c'est un choix de design : recommencer tout le niveau après
      // une erreur de placement de la dernière nuit serait la punition la plus
      // décourageante possible dans un jeu sans méta-progression, où repartir de
      // zéro n'apporte STRICTEMENT rien de nouveau.
      canRetryNight: this.checkpoint !== null,
    });
  }

  /** Rejoue la nuit perdue à partir de l'instantané pris à son lancement. */
  private retryNight(): void {
    if (!this.checkpoint) {
      this.startLevel(this.seed);
      return;
    }
    this.screens.hide();
    this.world.restore(this.checkpoint);
    this.world.endNight();
    this.enterDay();
    this.startNight();
  }

  private toggleMute(): void {
    this.save.muted = !this.save.muted;
    this.sfx.setMuted(this.save.muted);
    persist(this.save);
    this.screens.showMenu();
  }
}
