import type { Sfx } from '../audio/sfx';
import { PALETTE } from '../render/textures';
import type { Fx } from '../render/fx';
import type { Layers } from '../render/layers';
import type { Atlas } from '../render/textures';
import { NodesView } from '../render/nodesView';
import { OrbitView } from '../render/orbitView';
import { SEND_FRAC } from '../config/balance';
import { ENEMY, PLAYER, type Faction, type LevelDef } from '../config/levels';
import { Ai } from './ai';
import { Combat } from './combat';
import { Emitter } from './emitter';
import { Nodes } from './nodes';
import { Units } from './units';

const CMD_CAP = 64;

/** État de drag partagé avec l'input (objet muté, jamais recréé). */
export interface DragState {
  active: boolean;
  srcId: number;
  x: number;
  y: number;
  hoverId: number;
}

/**
 * Orchestrateur de partie : ordre du tick, file de commandes (les gestes ne
 * mutent JAMAIS la sim directement), compteurs par faction et fin de partie.
 * Ne connaît ni les modes ni une future méta : c'est le rôle de Flow.
 */
export class World {
  readonly nodes = new Nodes();
  readonly units: Units;
  readonly emitter: Emitter;
  readonly drag: DragState = { active: false, srcId: -1, x: 0, y: 0, hoverId: -1 };
  time = 0;
  playing = false;
  stress = false;
  /** Câblé par Flow. victory du point de vue joueur. */
  onGameOver: (victory: boolean, timeSec: number) => void = () => {};

  private readonly combat = new Combat();
  private readonly ai: Ai;
  private readonly nodesView: NodesView;
  private readonly orbitView: OrbitView;
  // file de commandes d'envoi (paires src,dst), drainée en tête de tick
  private readonly cmdSrc = new Int16Array(CMD_CAP);
  private readonly cmdDst = new Int16Array(CMD_CAP);
  private cmdCount = 0;
  private stressTimer = 0;

  constructor(
    private readonly layers: Layers,
    atlas: Atlas,
    private readonly fx: Fx,
    private readonly sfx: Sfx,
  ) {
    this.units = new Units(layers.units, atlas);
    this.emitter = new Emitter(this.nodes, this.units);
    this.ai = new Ai(this.nodes, this.units, this.emitter);
    this.nodesView = new NodesView(layers, atlas);
    this.orbitView = new OrbitView(layers.orbit, atlas);
    this.nodes.onCapture = (i, to): void => {
      this.fx.burst(this.nodes.x[i], this.nodes.y[i], {
        count: 26,
        color: to === PLAYER ? PALETTE.player : PALETTE.enemy,
        speed: 220,
        life: 0.5,
        size: 1.1,
      });
      this.fx.shake(4);
      this.sfx.capture(to === PLAYER);
    };
    this.nodes.onUpgrade = (i): void => {
      this.fx.burst(this.nodes.x[i], this.nodes.y[i], {
        count: 18,
        color: PALETTE.select,
        speed: 160,
        life: 0.6,
        size: 1.2,
      });
      this.fx.shake(2);
      this.sfx.upgrade();
    };
  }

  loadLevel(def: LevelDef): void {
    this.nodes.load(def);
    this.units.clear();
    this.emitter.clear();
    this.fx.clear();
    this.ai.reset(def.ai);
    this.cmdCount = 0;
    this.time = 0;
    this.stress = false;
    this.playing = true;
    this.nodesView.reset(this.nodes);
  }

  /** Poste un ordre d'envoi joueur (appelé par les gestes, hors tick). */
  postSend(src: number, dst: number): void {
    if (this.cmdCount >= CMD_CAP) return;
    this.cmdSrc[this.cmdCount] = src;
    this.cmdDst[this.cmdCount] = dst;
    this.cmdCount++;
  }

  /** API de commande (joueur et futur bot) : envoi de SEND_FRAC du stock. */
  sendOrder(src: number, dst: number, f: Faction): boolean {
    const ok = this.emitter.send(src, dst, f, Math.max(1, Math.floor(this.nodes.stock[src] * SEND_FRAC)));
    if (ok) this.sfx.send();
    return ok;
  }

  update(dt: number): void {
    if (!this.playing) return;
    this.time += dt;

    // 1. commandes joueur (envoi = 100 % du stock au moment de l'ordre)
    for (let c = 0; c < this.cmdCount; c++) this.sendOrder(this.cmdSrc[c], this.cmdDst[c], PLAYER);
    this.cmdCount = 0;

    this.nodes.grow(dt); // 2. production
    this.emitter.update(dt); // 3. rafales d'émission
    this.units.update(dt, this.time, this.nodes); // 4. vol + arrivées/captures
    this.combat.update(this.units, this.fx, this.sfx); // 5. annihilation 1:1
    this.units.sweepDead(); // 6. compactage (les index de grille ne servent plus)
    this.ai.update(dt); // 7. décision IA
    if (this.stress) this.stressDrive(dt);
    else this.checkEnd(); // 8. fin de partie
    this.fx.update(dt); // 9. effets
  }

  render(alpha: number): void {
    this.layers.stage.position.set(this.fx.shakeX.value, this.fx.shakeY.value);
    this.nodesView.sync(this.nodes, this.time);
    this.orbitView.sync(this.nodes, performance.now() / 1000);
    this.units.syncRender(alpha, this.layers.units);
    this.fx.syncRender(alpha);
    this.syncDragOverlay();
  }

  private syncDragOverlay(): void {
    const g = this.layers.overlay;
    g.clear();
    if (!this.drag.active || this.drag.srcId < 0) return;
    const sx = this.nodes.x[this.drag.srcId];
    const sy = this.nodes.y[this.drag.srcId];
    g.moveTo(sx, sy);
    g.lineTo(this.drag.x, this.drag.y);
    g.stroke({ width: 4, color: PALETTE.select, alpha: 0.7 });
    // cible valide survolée : anneau sur le nœud, sinon simple curseur
    const hover = this.drag.hoverId;
    if (hover >= 0 && hover !== this.drag.srcId) {
      g.circle(this.nodes.x[hover], this.nodes.y[hover], this.nodes.radius(hover) + 12);
      g.stroke({ width: 4, color: PALETTE.select, alpha: 0.95 });
    } else {
      g.circle(this.drag.x, this.drag.y, 10);
      g.stroke({ width: 3, color: PALETTE.select, alpha: 0.9 });
    }
  }

  /** Une faction est éliminée quand elle n'a plus NI nœud NI unité NI flux. */
  private eliminated(f: Faction): boolean {
    return this.nodes.byFaction[f] === 0 && this.units.byFaction[f] === 0 && this.emitter.byFaction[f] === 0;
  }

  private checkEnd(): void {
    if (this.eliminated(PLAYER)) {
      this.playing = false;
      this.onGameOver(false, this.time);
    } else if (this.eliminated(ENEMY)) {
      this.playing = false;
      this.onGameOver(true, this.time);
    }
  }

  /** Mode ?stress : sature le pool d'unités pour mesurer les perfs. */
  private stressDrive(dt: number): void {
    for (let i = 0; i < this.nodes.count; i++) this.nodes.stock[i] = this.nodes.cap(i);
    this.stressTimer -= dt;
    if (this.stressTimer > 0) return;
    this.stressTimer = 0.4;
    // chaque nœud canonne le nœud adverse le plus lointain : croisements maximaux
    for (let i = 0; i < this.nodes.count; i++) {
      const f = this.nodes.faction[i] as Faction;
      if (f === 0) continue;
      let far = -1;
      let farD = -1;
      for (let j = 0; j < this.nodes.count; j++) {
        if (this.nodes.faction[j] === f) continue;
        const dx = this.nodes.x[j] - this.nodes.x[i];
        const dy = this.nodes.y[j] - this.nodes.y[i];
        const d = dx * dx + dy * dy;
        if (d > farD) {
          farD = d;
          far = j;
        }
      }
      if (far >= 0) this.emitter.send(i, far, f, 20);
    }
  }

  stats(): { player: number; enemy: number; neutral: number; units: number } {
    return {
      player: this.nodes.byFaction[1],
      enemy: this.nodes.byFaction[2],
      neutral: this.nodes.byFaction[0],
      units: this.units.count,
    };
  }
}
