import { type Container, TilingSprite } from 'pixi.js';
import * as B from '../config/balance';
import type { Atlas } from '../render/textures';
import type { EnemyPool } from './enemies';
import type { Squad } from './squad';

interface SpikeWall {
  cx: number;
  halfW: number;
  y: number;
  enemyDps: number; // dégâts/s aux ennemis (×hpMul du niveau au spawn)
  dead: boolean;
  sprite: TilingSprite;
}

/**
 * Murs de pics : obstacles INDESTRUCTIBLES — ni tirables, ni dans l'aim-assist,
 * hors collisions balles (comme les mines : danger de lecture du terrain).
 * Tout ce qui les touche perd des PV : la horde qui les traverse se dégrossit
 * (hp -= dps·dt, morts ramassées par le sweepDead existant), l'escouade au
 * contact saigne en continu via le canal heavy (proportionnel + plancher/
 * plafond, remonté à World par onSquadContact). Le générateur garantit qu'un
 * mur ne couvre JAMAIS toute la voie.
 */
export class Spikes {
  list: SpikeWall[] = []; // public : bot de test (esquive)
  /** Remonté avec un taux de pertes/s : World applique loseSoldiers(rate·dt, heavy). */
  onSquadContact: (x: number, y: number, dt: number) => void = () => {};

  constructor(
    private readonly parent: Container,
    private readonly atlas: Atlas,
  ) {}

  spawn(at: number, xNorm: number, widthFrac: number, hpMul: number): void {
    const lane = B.LANE_MAX_X - B.LANE_MIN_X;
    const halfW = (widthFrac * lane) / 2;
    const cx = B.LANE_MIN_X + xNorm * lane;
    const sprite = new TilingSprite({
      texture: this.atlas.spikes,
      width: halfW * 2,
      height: B.SPIKE_H,
    });
    sprite.anchor.set(0.5);
    sprite.position.set(cx, -at);
    this.parent.addChild(sprite);
    this.list.push({ cx, halfW, y: -at, enemyDps: B.SPIKE_ENEMY_DPS * hpMul, dead: false, sprite });
  }

  update(dt: number, enemies: EnemyPool, squad: Squad, dist: number): void {
    let anyDead = false;
    const frontY = squad.worldY(dist);
    // profondeur approximative de la formation : le mur blesse pendant TOUTE la traversée
    const squadDepth = Math.max(24, squad.halfWidth * squad.visualScale * 0.9);
    const squadHalfW = squad.halfWidth * squad.visualScale * 0.8 + 8;
    for (const wall of this.list) {
      if (wall.dead) {
        anyDead = true;
        continue;
      }
      if (wall.y > -dist + B.CULL_BEHIND) {
        wall.dead = true;
        wall.sprite.destroy();
        anyDead = true;
        continue;
      }
      // ennemis : PV rognés tant qu'ils chevauchent la bande (mort différée → sweepDead)
      const halfH = B.SPIKE_H / 2;
      for (let i = 0; i < enemies.count; i++) {
        if (enemies.hp[i] <= 0) continue;
        const r = enemies.radius[i];
        if (
          Math.abs(enemies.y[i] - wall.y) < halfH + r &&
          Math.abs(enemies.x[i] - wall.cx) < wall.halfW + r
        ) {
          enemies.hp[i] -= wall.enemyDps * dt;
        }
      }
      // escouade : contact pendant la traversée (le mur descend de frontY à frontY+depth)
      if (
        wall.y > frontY - halfH - 6 &&
        wall.y < frontY + squadDepth &&
        Math.abs(wall.cx - squad.x) < wall.halfW + squadHalfW
      ) {
        this.onSquadContact(squad.x < wall.cx ? wall.cx - wall.halfW : wall.cx + wall.halfW, wall.y, dt);
      }
    }
    if (anyDead) this.list = this.list.filter((w) => !w.dead);
  }

  reset(): void {
    for (const wall of this.list) if (!wall.dead) wall.sprite.destroy();
    this.list = [];
  }
}
