import { type Container, Sprite, type Texture } from 'pixi.js';
import * as B from '../config/balance';
import { lerp } from '../core/math';
import type { Squad } from './squad';

/**
 * Pool de projectiles ennemis en ligne droite (lances de boss, bolts de sniper).
 * La trajectoire est verrouillée au tir — l'esquive est toujours possible.
 */
export class ProjectilePool {
  count = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  private readonly sprites: Sprite[] = [];

  constructor(
    readonly cap: number,
    parent: Container,
    texture: Texture,
    private readonly speed: number,
  ) {
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.prevX = new Float32Array(cap);
    this.prevY = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    for (let i = 0; i < cap; i++) {
      const s = new Sprite(texture);
      s.anchor.set(0.5);
      s.visible = false;
      this.sprites.push(s);
      parent.addChild(s);
    }
  }

  fire(x: number, y: number, angle: number): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.vx[i] = Math.cos(angle) * this.speed;
    this.vy[i] = Math.sin(angle) * this.speed;
    const s = this.sprites[i];
    s.visible = true;
    // les textures de projectiles pointent vers le bas (+Y)
    s.rotation = angle - Math.PI / 2;
  }

  kill(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.prevX[i] = this.prevX[last];
      this.prevY[i] = this.prevY[last];
      this.vx[i] = this.vx[last];
      this.vy[i] = this.vy[last];
      this.sprites[i].rotation = this.sprites[last].rotation;
    }
    this.sprites[last].visible = false;
  }

  /** Avance les projectiles ; onHit est appelé pour chaque impact sur l'escouade. */
  update(dt: number, squad: Squad, dist: number, onHit: (x: number, y: number) => void): void {
    const sy = squad.worldY(dist);
    const hitR = B.LANCE_RADIUS + 42 * squad.visualScale;
    for (let i = this.count - 1; i >= 0; i--) {
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      const dx = this.x[i] - squad.x;
      const dy = this.y[i] - sy;
      if (dx * dx + dy * dy < hitR * hitR) {
        onHit(this.x[i], this.y[i]);
        this.kill(i);
        continue;
      }
      if (
        this.y[i] > -dist + 200 ||
        this.y[i] < -dist - 1100 ||
        this.x[i] < -60 ||
        this.x[i] > B.DESIGN_W + 60
      ) {
        this.kill(i);
      }
    }
  }

  syncRender(alpha: number): void {
    for (let i = 0; i < this.count; i++) {
      this.sprites[i].position.set(
        lerp(this.prevX[i], this.x[i], alpha),
        lerp(this.prevY[i], this.y[i], alpha),
      );
    }
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) this.sprites[i].visible = false;
    this.count = 0;
  }
}
