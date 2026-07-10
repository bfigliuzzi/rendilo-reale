import { Sprite, Text } from 'pixi.js';
import { MAX_NODES } from '../config/balance';
import type { Nodes } from '../game/nodes';
import type { Layers } from './layers';
import { PALETTE, type Atlas } from './textures';

/**
 * Sprites des nœuds : corps (texture par faction, swap à la capture), anneau
 * (sélection pulsante OU flash blanc de capture) et compteur de stock.
 * Le Text n'est mis à jour que quand la valeur AFFICHÉE change (invariant repo).
 */
export class NodesView {
  private readonly bodies: Sprite[] = [];
  private readonly rings: Sprite[] = [];
  private readonly labels: Text[] = [];
  private readonly lastShown = new Int16Array(MAX_NODES);
  private readonly lastFaction = new Uint8Array(MAX_NODES);

  constructor(
    layers: Layers,
    private readonly atlas: Atlas,
  ) {
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
    for (let i = 0; i < nodes.count; i++) {
      const body = this.bodies[i];
      const f = nodes.faction[i];
      if (f !== this.lastFaction[i]) {
        this.lastFaction[i] = f;
        body.texture = this.atlas.nodeBody[f];
      }
      // respiration légère, calculée au rendu
      const pulse = 0.5 * (1 + 0.04 * Math.sin(time * 2.2 + i * 1.7));
      body.scale.set(pulse);

      const ring = this.rings[i];
      if (nodes.selected[i]) {
        ring.visible = true;
        ring.tint = PALETTE.select;
        ring.alpha = 0.85 + 0.15 * Math.sin(time * 6);
        ring.scale.set(0.5 + 0.02 * Math.sin(time * 6));
      } else if (nodes.flash[i] > 0) {
        ring.visible = true;
        ring.tint = 0xffffff;
        ring.alpha = nodes.flash[i];
        ring.scale.set(0.5 + (1 - nodes.flash[i]) * 0.25);
      } else {
        ring.visible = false;
      }

      const shown = Math.floor(nodes.stock[i]);
      if (shown !== this.lastShown[i]) {
        this.lastShown[i] = shown;
        this.labels[i].text = String(shown);
      }
    }
  }
}
