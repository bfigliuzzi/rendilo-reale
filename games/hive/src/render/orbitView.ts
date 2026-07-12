import { Particle, type ParticleContainer, type Texture } from 'pixi.js';
import { MAX_NODES, NODE_LEVELS, ORBIT_VISUAL_CAP } from '../config/balance';
import type { Nodes } from '../game/nodes';

const PARK = -9999;

/**
 * Nuée orbitale : la représentation VISUELLE du stock (la sim ne connaît que le
 * nombre). Pool fixe de MAX_NODES×ORBIT_VISUAL_CAP particules ; chaque slot a une
 * orbite propre (angle initial, vitesse ± sens, rayon) précalculée une fois —
 * les positions sont dérivées du temps continu au rendu, zéro état, zéro alloc.
 */
export class OrbitView {
  private readonly particles: Particle[] = [];
  private readonly angle0: Float32Array;
  private readonly angVel: Float32Array;
  private readonly radiusMul: Float32Array;
  private readonly lastFaction = new Uint8Array(MAX_NODES);

  /** `texByFaction` : table possédée par World (0 = mote neutre), remplie à loadLevel. */
  constructor(
    private readonly container: ParticleContainer,
    private readonly texByFaction: readonly Texture[],
  ) {
    const total = MAX_NODES * ORBIT_VISUAL_CAP;
    this.angle0 = new Float32Array(total);
    this.angVel = new Float32Array(total);
    this.radiusMul = new Float32Array(total);
    for (let k = 0; k < total; k++) {
      // répartition déterministe : 3 anneaux, sens alterné, phases dorées
      const ringIdx = k % 3;
      this.angle0[k] = (k * 2.399963) % (Math.PI * 2); // angle d'or : pas d'alignements
      this.angVel[k] = (ringIdx % 2 === 0 ? 1 : -1) * (0.9 + ringIdx * 0.35);
      this.radiusMul[k] = 1.35 + ringIdx * 0.28;
      const p = new Particle({
        texture: texByFaction[0],
        x: PARK,
        y: PARK,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: 0.45,
        scaleY: 0.45,
      });
      this.particles.push(p);
      container.addParticle(p);
    }
    this.lastFaction.fill(255);
  }

  sync(nodes: Nodes, time: number): void {
    for (let i = 0; i < MAX_NODES; i++) {
      const base = i * ORBIT_VISUAL_CAP;
      if (i >= nodes.count) {
        if (this.lastFaction[i] !== 255) {
          for (let k = 0; k < ORBIT_VISUAL_CAP; k++) this.park(base + k);
          this.lastFaction[i] = 255;
        }
        continue;
      }
      const f = nodes.faction[i];
      if (f !== this.lastFaction[i]) {
        this.lastFaction[i] = f;
        const tex = this.texByFaction[f];
        for (let k = 0; k < ORBIT_VISUAL_CAP; k++) this.particles[base + k].texture = tex;
      }
      const visible = Math.min(Math.floor(nodes.stock[i]), ORBIT_VISUAL_CAP);
      const r = NODE_LEVELS[nodes.level[i]].radius;
      for (let k = 0; k < ORBIT_VISUAL_CAP; k++) {
        const idx = base + k;
        const p = this.particles[idx];
        if (k >= visible) {
          if (p.x !== PARK) this.park(idx);
          continue;
        }
        const a = this.angle0[idx] + time * this.angVel[idx];
        const rr = r * this.radiusMul[idx];
        p.x = nodes.x[i] + Math.cos(a) * rr;
        p.y = nodes.y[i] + Math.sin(a) * rr;
        p.rotation = a + (this.angVel[idx] > 0 ? Math.PI : 0); // tangent à l'orbite
      }
    }
    this.container.update();
  }

  /** À l'entrée en partie : invalide le cache de factions — les textures d'une
   *  même faction changent d'une carte à l'autre (espèces différentes). */
  reset(): void {
    this.lastFaction.fill(255);
  }

  private park(idx: number): void {
    const p = this.particles[idx];
    p.x = PARK;
    p.y = PARK;
  }
}
