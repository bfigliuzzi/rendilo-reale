import { clamp } from '@shared/math';
import type { Sfx } from '../audio/sfx';
import { PLAYER, type Faction, type LevelDef, type SpeciesId } from '../config/levels';
import { MAPS } from '../config/maps';
import type { Gestures } from '../input/gestures';
import { clampSendFrac, persist, type SaveData } from '../meta/save';
import type { Hud } from '../ui/hud';
import type { Screens } from '../ui/screens';
import type { Tutorial } from './tutorial';
import type { World } from './world';

export type FlowState = 'menu' | 'playing' | 'result';

const SPECIES_EMOJI: Record<SpeciesId, string> = { bee: '🐝', fly: '🪰', roach: '🪳' };

/**
 * Machine à états menu (sélection de niveau) → partie → résultat.
 * SEUL endroit habilité à toucher la sauvegarde (déverrouillage, records,
 * fraction d'envoi, mute).
 */
export class Flow {
  state: FlowState = 'menu';
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

  showMenu(): void {
    this.state = 'menu';
    this.world.playing = false;
    this.gestures.setEnabled(false);
    this.hud.setInGame(false);
    this.tutorial.stop();
    this.screens.showMenu(
      MAPS.map((m, i) => ({
        name: m.name,
        locked: i >= this.save.unlocked,
        bestTime: this.save.bestTimes[m.id] ?? null,
        foes: m.factions
          .slice(1)
          .map((f) => SPECIES_EMOJI[f.species])
          .join(''),
      })),
      this.save.muted,
    );
  }

  startGame(level: number): void {
    this.levelIdx = clamp(level, 0, Math.min(this.save.unlocked, MAPS.length) - 1);
    this.state = 'playing';
    const def = MAPS[this.levelIdx];
    this.world.loadLevel(def);
    this.world.sendFrac = this.save.sendFrac;
    this.hud.setSendFrac(this.save.sendFrac);
    this.gestures.setEnabled(true);
    this.hud.setInGame(true);
    if (def.tutorial) this.tutorial.start(def.tutorial, this.world);
    else this.tutorial.stop();
    this.screens.hide();
  }

  private onGameOver(victory: boolean, timeSec: number): void {
    this.state = 'result';
    this.gestures.setEnabled(false);
    this.hud.setInGame(false);
    this.tutorial.stop();
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
