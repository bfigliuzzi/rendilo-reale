import { type Graphics, Sprite, Text } from 'pixi.js';
import { MAX_NODES, NODE_LEVELS } from '../config/balance';
import type { Nodes } from '../game/nodes';
import type { Layers } from './layers';
import { PALETTE, type Atlas } from './textures';

const BASE_RADIUS = NODE_LEVELS[0].radius;

/**
 * Sprites des nœuds : corps (texture par faction, swap à la capture ; taille
 * selon le niveau d'upgrade), anneau (sélection pulsante OU flash blanc),
 * arc de progression d'upgrade et compteur de stock (+ ▲ par niveau).
 * Le Text n'est mis à jour que quand la valeur AFFICHÉE change (invariant repo).
 */
export class NodesView {
  private readonly bodies: Sprite[] = [];
  private readonly rings: Sprite[] = [];
  private readonly labels: Text[] = [];
  private readonly arcs: Graphics;
  private readonly lastShown = new Int32Array(MAX_NODES);
  private readonly lastFaction = new Uint8Array(MAX_NODES);

  constructor(
    layers: Layers,
    private readonly atlas: Atlas,
  ) {
    this.arcs = layers.arcs;
    for (let i = 0; i < MAX_NODES; i++) {
      const body = new Sprite(atlas.nodeBody[0]);
      body.anchor.set(0.5);
      body.scale.set(0.5); // sources en supersampling ×2
      body.visible = false;
      const ring = new Sprite(atlas.ring);
      ring.anchor.set(0.5);
      ring.scale.set(0.5);
      ring.visible = false;
      const label = new Text({
        text: '',
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: 17,
          fontWeight: '900',
          fill: 0xffffff,
          stroke: { color: 0x000000, width: 4 },
        },
      });
      label.anchor.set(0.5);
      label.visible = false;
      this.bodies.push(body);
      this.rings.push(ring);
      this.labels.push(label);
      layers.nodes.addChild(ring, body);
      layers.labels.addChild(label);
    }
  }

  /** À l'entrée en partie : positionne tout, force la resynchro des caches. */
  reset(nodes: Nodes): void {
    for (let i = 0; i < MAX_NODES; i++) {
      const on = i < nodes.count;
      this.bodies[i].visible = on;
      this.labels[i].visible = on;
      this.rings[i].visible = false;
      if (!on) continue;
      this.bodies[i].position.set(nodes.x[i], nodes.y[i]);
      this.rings[i].position.set(nodes.x[i], nodes.y[i]);
      this.labels[i].position.set(nodes.x[i], nodes.y[i] + nodes.radius(i) + 14);
      this.lastShown[i] = -1;
      this.lastFaction[i] = 255;
    }
  }

  sync(nodes: Nodes, time: number): void {
    this.arcs.clear();
    for (let i = 0; i < nodes.count; i++) {
      const body = this.bodies[i];
      const f = nodes.faction[i];
      if (f !== this.lastFaction[i]) {
        this.lastFaction[i] = f;
        body.texture = this.atlas.nodeBody[f];
      }
      // taille selon le niveau + respiration légère, calculées au rendu
      const sizeMul = nodes.radius(i) / BASE_RADIUS;
      const pulse = 0.5 * sizeMul * (1 + 0.04 * Math.sin(time * 2.2 + i * 1.7));
      body.scale.set(pulse);

      const ring = this.rings[i];
      if (nodes.selected[i]) {
        ring.visible = true;
        ring.tint = PALETTE.select;
        ring.alpha = 0.85 + 0.15 * Math.sin(time * 6);
        ring.scale.set(sizeMul * (0.5 + 0.02 * Math.sin(time * 6)));
      } else if (nodes.flash[i] > 0) {
        ring.visible = true;
        ring.tint = 0xffffff;
        ring.alpha = nodes.flash[i];
        ring.scale.set(sizeMul * (0.5 + (1 - nodes.flash[i]) * 0.25));
      } else {
        ring.visible = false;
      }

      // arc de progression d'upgrade (investissement en cours vers le niveau suivant)
      const cost = nodes.upgradeCost(i);
      if (cost > 0 && nodes.upgradeProgress[i] > 0) {
        const frac = nodes.upgradeProgress[i] / cost;
        this.arcs.arc(nodes.x[i], nodes.y[i], nodes.radius(i) + 7, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        this.arcs.stroke({ width: 4, color: PALETTE.select, alpha: 0.9 });
      }

      // label = stock (+ ▲ par niveau) ; maj seulement quand l'affiché change
      const shown = Math.floor(nodes.stock[i]) + nodes.level[i] * 100000;
      if (shown !== this.lastShown[i]) {
        this.lastShown[i] = shown;
        this.labels[i].text = `${Math.floor(nodes.stock[i])}${'▲'.repeat(nodes.level[i])}`;
        this.labels[i].position.set(nodes.x[i], nodes.y[i] + nodes.radius(i) + 14);
      }
    }
  }
}
