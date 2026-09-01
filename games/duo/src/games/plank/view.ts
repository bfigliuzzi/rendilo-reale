import { Container, Graphics, Text } from 'pixi.js';
import { PALETTE } from '../../render/textures';
import type { PlankModel } from './model';

/**
 * PLACEHOLDER (§8 étape 1) — vue de `plank`, à réécrire avec le jeu.
 *
 * Deux règles qui, elles, survivront à la réécriture :
 *   ① la vue ne MUTE jamais le modèle : elle le lit, point ;
 *   ② toute animation est une FONCTION CLOSE du temps écoulé (pattern de
 *      `mind/render/boardView.ts`) — aucun état d'animation à faire avancer,
 *      donc rien qui puisse « rester bloqué », et un bot qui saute trois
 *      secondes en avant obtient directement l'état final cohérent.
 */
export class PlankView {
  readonly root = new Container();
  private readonly panel = new Graphics();
  private readonly title: Text;
  private readonly count: Text;

  constructor(
    parent: Container,
    private readonly model: PlankModel,
    private readonly w: number,
    private readonly h: number,
  ) {
    this.title = new Text({
      text: '🎱 Le plateau à bille',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 30, fontWeight: '900', fill: PALETTE.cream },
    });
    this.title.anchor.set(0.5);
    this.title.position.set(w / 2, h / 2 - 130);

    this.count = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 54, fontWeight: '900', fill: PALETTE.gold },
    });
    this.count.anchor.set(0.5);
    this.count.position.set(w / 2, h / 2 - 60);

    this.root.addChild(this.panel, this.title, this.count);
    parent.addChild(this.root);
  }

  render(time: number): void {
    const s = this.model.state;
    // Respiration : fonction périodique du temps, aucun état mémorisé.
    const breathe = 1 + Math.sin(time * 2.2) * 0.02;
    this.panel.clear();
    this.panel
      .roundRect(this.w / 2 - 170 * breathe, this.h / 2 - 20, 340 * breathe, 150, 26)
      .fill(PALETTE.panel)
      .stroke({ width: 3, color: PALETTE.panelEdge });

    const label = `${s.left}`;
    if (this.count.text !== label) this.count.text = label; // écrire seulement au changement
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
