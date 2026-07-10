import { ENEMY, PLAYER, type LevelDef } from '../config/levels';
import { MAPS } from '../config/maps';
import type { Gestures } from '../input/gestures';
import type { Hud } from '../ui/hud';
import type { Screens } from '../ui/screens';
import type { World } from './world';

export type FlowState = 'menu' | 'playing' | 'result';

/**
 * Machine à états menu → partie → résultat. SEUL endroit habilité à toucher une
 * future sauvegarde (clé réservée : `rendilo-reale:hive:save:v1`).
 */
export class Flow {
  state: FlowState = 'menu';

  constructor(
    private readonly world: World,
    private readonly screens: Screens,
    private readonly gestures: Gestures,
    private readonly hud: Hud,
  ) {
    screens.onPlay = (): void => this.startGame();
    screens.onReplay = (): void => this.startGame();
    screens.onMenu = (): void => this.showMenu();
    world.onGameOver = (victory, timeSec): void => {
      this.state = 'result';
      this.gestures.setEnabled(false);
      this.hud.setInGame(false);
      this.screens.showResult(victory, timeSec, this.world.nodes.byFaction[PLAYER]);
    };
  }

  showMenu(): void {
    this.state = 'menu';
    this.world.playing = false;
    this.gestures.setEnabled(false);
    this.hud.setInGame(false);
    this.screens.showMenu();
  }

  startGame(): void {
    this.state = 'playing';
    this.world.loadLevel(MAPS[0]);
    this.gestures.setEnabled(true);
    this.hud.setInGame(true);
    this.screens.hide();
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
