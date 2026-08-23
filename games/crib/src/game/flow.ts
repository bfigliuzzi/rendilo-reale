import type { Sfx } from '../audio/sfx';
import { makeTestLevel } from '../config/levels';
import type { Steer } from '../input/steer';
import { persist, type SaveData } from '../meta/save';
import type { Decor } from '../render/decor';
import type { Hud } from '../ui/hud';
import type { Screens } from '../ui/screens';
import type { World } from './world';

export type FlowState = 'menu' | 'playing' | 'result';

/**
 * Machine à états menu → jeu → résultat, et SEUL endroit du jeu habilité à écrire
 * la sauvegarde. `World` ne connaît ni les modes ni la méta ; `Screens` et `Hud` ne
 * lisent jamais le save pour décider quoi que ce soit.
 *
 * C'est aussi Flow qui arme et désarme les entrées : sans ça le bébé dérive en
 * arrière-plan pendant qu'on lit l'écran de résultat, et un appui sur Z relance une
 * course invisible.
 */
export class Flow {
  state: FlowState = 'menu';
  /** Seed de la partie courante — rejouable à l'identique, et lisible par le bot. */
  seed = 0xbebe;

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
    this.screens.onToggleMute = () => this.toggleMute();
    this.hud.onRestart = () => this.startLevel(this.seed);
    this.world.onGameOver = (victory, timeSec) => this.onGameOver(victory, timeSec);
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
   */
  startLevel(seed?: number): void {
    this.seed = seed ?? (Math.floor(Math.random() * 0xffffff) | 1);
    const def = makeTestLevel(this.seed);
    this.screens.hide();
    this.decor.setup(def);
    this.world.loadLevel(def);
    this.steer.setEnabled(true);
    this.hud.setInGame(true);
    this.state = 'playing';
  }

  /** `?stress` : mesure du budget de rendu, hors de toute condition de fin. */
  startStress(): void {
    this.startLevel(1);
    this.world.startStress();
  }

  private leaveGame(): void {
    this.world.playing = false;
    this.steer.setEnabled(false);
    this.hud.setInGame(false);
  }

  private onGameOver(victory: boolean, timeSec: number): void {
    this.state = 'result';
    this.leaveGame();

    // une SEULE écriture par fin de partie, victoire comme défaite. Le redémarrage
    // ↻ et le retour menu ne flushent pas : assumé, c'est un abandon, pas un score.
    this.save.runs++;
    let record = false;
    if (victory) {
      this.save.wins++;
      // le critère de record est le temps, mais les PV de berceau restants
      // départagent : finir vite en laissant le berceau en ruine n'est pas mieux
      const better =
        this.save.bestTimeSec === null ||
        timeSec < this.save.bestTimeSec ||
        (Math.abs(timeSec - this.save.bestTimeSec) < 0.5 && this.world.crib.hp > this.save.bestCribHp);
      if (better) {
        this.save.bestTimeSec = timeSec;
        this.save.bestCribHp = this.world.crib.hp;
        record = true;
      }
    }
    persist(this.save);

    if (victory) this.sfx.victory();
    else this.sfx.defeat();

    this.screens.showResult({
      victory,
      timeSec,
      cribHp: this.world.crib.hp,
      cribMax: this.world.crib.maxHp,
      run: this.world.run,
      record,
    });
  }

  private toggleMute(): void {
    this.save.muted = !this.save.muted;
    this.sfx.setMuted(this.save.muted);
    persist(this.save);
    if (!this.save.muted) this.sfx.ui();
    this.screens.showMenu();
  }
}
