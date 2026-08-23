import { Container, Sprite } from 'pixi.js';
import * as B from '../config/balance';
import type { Atlas } from '../render/textures';
import { MARKER_RING_MARGIN } from '../render/textures';

const PARK = -9999;

/**
 * Flaques laissées par les couches sales à leur mort. Une zone qui englue en
 * continu : c'est ce qui punit le farm au corps-à-corps — tuer la vague sur place
 * transforme le terrain sous ses pieds.
 *
 * Chaque flaque a DEUX sprites : un corps opaque et un anneau pointillé posé
 * exactement sur son rayon réel. Double codage obligatoire pour une zone de danger
 * (l'anneau pour la limite, l'aplat pour la surface) — la couleur seule ne suffit
 * jamais, et un joueur ne doit pas avoir à deviner où la flaque s'arrête.
 *
 * Peu nombreuses et statiques : des `Sprite` suffisent, pas besoin de pool SoA.
 */
export class Puddles {
  count = 0;
  private readonly x = new Float32Array(B.MAX_PUDDLES);
  private readonly y = new Float32Array(B.MAX_PUDDLES);
  private readonly life = new Float32Array(B.MAX_PUDDLES);
  private readonly bodies: Sprite[] = [];
  private readonly rings: Sprite[] = [];
  /** Rayon commun, celui déclaré par la couche sale. */
  private readonly radius = B.ENEMY_KINDS[B.KIND_NAPPY].puddle;
  /** Échelle qui fait tomber le trait de l'anneau pile sur `radius`. */
  private readonly ringScale: number;

  constructor(atlas: Atlas, parent: Container) {
    this.ringScale = (this.radius * 2 * MARKER_RING_MARGIN) / atlas.puddleRing.width;
    for (let i = 0; i < B.MAX_PUDDLES; i++) {
      const body = new Sprite({ texture: atlas.puddleBody, anchor: { x: 0.5, y: 0.5 }, alpha: 0.75 });
      // l'anneau s'affiche à `radius * 2 * MARKER_RING_MARGIN` pour que le trait
      // tombe pile sur le rayon marqué (la source est supersamplée ×2)
      const ring = new Sprite({ texture: atlas.puddleRing, anchor: { x: 0.5, y: 0.5 } });
      body.position.set(PARK, PARK);
      ring.position.set(PARK, PARK);
      this.bodies.push(body);
      this.rings.push(ring);
      parent.addChild(body, ring);
    }
  }

  spawn(x: number, y: number): void {
    // pool saturé : on recycle la plus ancienne plutôt que d'ignorer la nouvelle —
    // une flaque manquante là où une couche vient de mourir serait un mensonge visuel
    let i: number;
    if (this.count < B.MAX_PUDDLES) {
      i = this.count++;
    } else {
      i = 0;
      for (let k = 1; k < this.count; k++) if (this.life[k] < this.life[i]) i = k;
    }
    this.x[i] = x;
    this.y[i] = y;
    this.life[i] = B.PUDDLE_LIFE;
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.life[i] = this.life[last];
    }
    this.bodies[last].position.set(PARK, PARK);
    this.rings[last].position.set(PARK, PARK);
  }

  update(dt: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) this.kill(i);
    }
  }

  /**
   * Charge de grip subie par le bébé s'il patauge. Les flaques se CUMULENT entre
   * elles mais comptent chacune moins qu'un ennemi vivant : mourir sur place ne
   * doit pas créer un piège permanent.
   */
  gripAt(hx: number, hy: number): number {
    let load = 0;
    const r = this.radius + B.HERO_RADIUS;
    for (let i = 0; i < this.count; i++) {
      const dx = this.x[i] - hx;
      const dy = this.y[i] - hy;
      if (dx * dx + dy * dy <= r * r) load += B.PUDDLE_GRIP;
    }
    return load;
  }

  renderSync(clock: number): void {
    for (let i = 0; i < this.count; i++) {
      const t = this.life[i] / B.PUDDLE_LIFE;
      const body = this.bodies[i];
      const ring = this.rings[i];
      body.position.set(this.x[i], this.y[i]);
      ring.position.set(this.x[i], this.y[i]);
      // apparition en pop, puis évanouissement : la flaque annonce sa fin de vie
      const grow = Math.min(1, (1 - t) * 6);
      body.scale.set(grow, grow * 0.55);
      body.alpha = 0.75 * Math.min(1, t * 3);
      ring.alpha = 0.85 * Math.min(1, t * 3);
      // rotation lente de l'anneau pointillé : signal de MOUVEMENT, lisible sans
      // aucune perception des couleurs
      ring.rotation = clock * 0.5;
      ring.scale.set(this.ringScale * grow);
    }
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) {
      this.bodies[i].position.set(PARK, PARK);
      this.rings[i].position.set(PARK, PARK);
    }
    this.count = 0;
  }
}
