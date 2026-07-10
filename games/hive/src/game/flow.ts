import { clamp } from '@shared/math';
import type { Sfx } from '../audio/sfx';
import { ENEMY, PLAYER, type LevelDef } from '../config/levels';
import { MAPS } from '../config/maps';
import type { Gestures } from '../input/gestures';
import { persist, type SaveData } from '../meta/save';
import type { Hud } from '../ui/hud';
import type { Screens } from '../ui/screens';
import type { World } from './world';

export type FlowState = 'menu' | 'playing' | 'result';

/**
 * Machine à états menu (sélection de niveau) → partie → résultat.
 * SEUL endroit habilité à toucher la sauvegarde (déverrouillage, records).
 */
export class Flow {
  state: FlowState = 'menu';
  private levelIdx = 0;

  constructor(
    private readonly world: World,
    private readonly screens: Screens,
    private readonly gestures: Gestures,
    private readonly hud: Hud,
    private readonly save: SaveData,
    private readonly sfx: Sfx,
  ) {
    screens.onPlay = (n): void => this.startGame(n);
    screens.onReplay = (): void => this.startGame(this.levelIdx);
    screens.onNext = (): void => this.startGame(this.levelIdx + 1);
    screens.onMenu = (): void => this.showMenu();
    screens.onToggleMute = (): void => {
      this.save.muted = !this.save.muted;
      this.sfx.setMuted(this.save.muted);
      persist(this.save);
      this.showMenu(); // re-render pour l'état du bouton
    };
    world.onGameOver = (victory, timeSec): void => this.onGameOver(victory, timeSec);
  }

  showMenu(): void {
    this.state = 'menu';
    this.world.playing = false;
    this.gestures.setEnabled(false);
    this.hud.setInGame(false);
    this.screens.showMenu(
      MAPS.map((m, i) => ({
        name: m.name,
        locked: i >= this.save.unlocked,
        bestTime: this.save.bestTimes[m.id] ?? null,
      })),
      this.save.muted,
    );
  }

  startGame(level: number): void {
    this.levelIdx = clamp(level, 0, Math.min(this.save.unlocked, MAPS.length) - 1);
    this.state = 'playing';
    this.world.loadLevel(MAPS[this.levelIdx]);
    this.gestures.setEnabled(true);
    this.hud.setInGame(true);
    this.screens.hide();
  }

  private onGameOver(victory: boolean, timeSec: number): void {
    this.state = 'result';
    this.gestures.setEnabled(false);
    this.hud.setInGame(false);
    if (victory) this.sfx.victory();
    else this.sfx.defeat();
    const def = MAPS[this.levelIdx];
    let newBest = false;
    if (victory) {
      this.save.unlocked = Math.max(this.save.unlocked, Math.min(this.levelIdx + 2, MAPS.length));
      const prev = this.save.bestTimes[def.id];
      if (prev === undefined || timeSec < prev) {
        this.save.bestTimes[def.id] = Math.round(timeSec);
        newBest = true;
      }
      persist(this.save);
    }
    this.screens.showResult({
      victory,
      timeSec,
      nodesOwned: this.world.nodes.byFaction[PLAYER],
      levelName: def.name,
      hasNext: victory && this.levelIdx + 1 < MAPS.length,
      newBest,
    });
  }

  /** Mode ?stress : carte bi-camps saturée, pool d'unités à fond, pas de fin. */
  startStress(): void {
    this.state = 'playing';
    const base = MAPS[0];
    const def: LevelDef = {
      ...base,
      nodes: base.nodes.map((n, i) => ({ ...n, faction: i % 2 === 0 ? PLAYER : ENEMY, stock: 60 })),
    };
    this.world.loadLevel(def);
    this.world.stress = true;
    this.gestures.setEnabled(true);
    this.hud.setInGame(true);
    this.screens.hide();
  }
}
