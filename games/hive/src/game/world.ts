import type { Texture } from 'pixi.js';
import type { Sfx } from '../audio/sfx';
import { FACTION_COLORS, PALETTE } from '../render/textures';
import type { Fx } from '../render/fx';
import type { Layers } from '../render/layers';
import type { Atlas } from '../render/textures';
import { NodesView } from '../render/nodesView';
import { OrbitView } from '../render/orbitView';
import { MAX_FACTIONS, SEND_FRAC_DEFAULT, SPECIES } from '../config/balance';
import { PLAYER, SPECIES_IDS, type Faction, type LevelDef } from '../config/levels';
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
 * mutent JAMAIS la sim directement), stats d'espèces par faction (tables
 * Float32Array remplies à loadLevel, référencées par les pools — zéro alloc
 * au tick), IA par camp et fin de partie N factions.
 * Ne connaît ni les modes ni une future méta : c'est le rôle de Flow.
 */
export class World {
  // stats d'espèce par faction (index 0 = neutre : croissance nulle, puissance 1
  // — la monnaie de défense des nœuds gris). Remplies à loadLevel.
  readonly factionGrowth = new Float32Array(MAX_FACTIONS);
  readonly factionSpeed = new Float32Array(MAX_FACTIONS);
  readonly factionPower = new Float32Array(MAX_FACTIONS);
  /** Index d'espèce (SPECIES_IDS) par faction, 255 = absente de la carte. */
  readonly speciesByFaction = new Uint8Array(MAX_FACTIONS);
  readonly nodes: Nodes;
  readonly units: Units;
  readonly emitter: Emitter;
  readonly drag: DragState = { active: false, srcId: -1, x: 0, y: 0, hoverId: -1 };
  /** Fraction du stock envoyée par ordre JOUEUR — réglée par le stepper du HUD. */
  sendFrac = SEND_FRAC_DEFAULT;
  time = 0;
  playing = false;
  stress = false;
  /** Câblé par Flow. victory du point de vue joueur. */
  onGameOver: (victory: boolean, timeSec: number) => void = () => {};

  private readonly combat = new Combat();
  private readonly ais: readonly Ai[];
  private readonly nodesView: NodesView;
  private readonly orbitView: OrbitView;
  // textures par faction (contenu remplacé à loadLevel selon les espèces)
  private readonly nodeTexByFaction: Texture[];
  private readonly unitTexByFaction: Texture[];
  // file de commandes d'envoi (paires src,dst), drainée en tête de tick
  private readonly cmdSrc = new Int16Array(CMD_CAP);
  private readonly cmdDst = new Int16Array(CMD_CAP);
  private cmdCount = 0;
  private stressTimer = 0;

  constructor(
    private readonly layers: Layers,
    private readonly atlas: Atlas,
    private readonly fx: Fx,
    private readonly sfx: Sfx,
  ) {
    this.factionSpeed.fill(1);
    this.factionPower.fill(1);
    this.nodeTexByFaction = [atlas.nodeBodyNeutral, atlas.nodeBodies[0][0], atlas.nodeBodies[2][1], atlas.nodeBodies[1][2]];
    this.unitTexByFaction = [atlas.unitMote, atlas.unitFrames[0][0], atlas.unitFrames[2][1], atlas.unitFrames[1][2]];
    this.nodes = new Nodes(this.factionGrowth, this.factionPower);
    this.units = new Units(layers.units, this.unitTexByFaction, this.factionSpeed, this.factionPower);
    this.emitter = new Emitter(this.nodes, this.units, this.factionPower);
    // une IA par camp non-joueur, préallouées ; inertes si la faction est absente
    this.ais = [
      new Ai(this.nodes, this.units, this.emitter, 2, this.factionPower, this.factionSpeed),
      new Ai(this.nodes, this.units, this.emitter, 3, this.factionPower, this.factionSpeed),
    ];
    this.nodesView = new NodesView(layers, atlas, this.nodeTexByFaction);
    this.orbitView = new OrbitView(layers.orbit, this.unitTexByFaction);
    this.nodes.onCapture = (i, to): void => {
      this.fx.burst(this.nodes.x[i], this.nodes.y[i], {
        count: 26,
        color: FACTION_COLORS[to],
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
    // stats + textures d'espèce par faction (les pools tiennent les références)
    this.speciesByFaction.fill(255);
    this.factionGrowth[0] = 0;
    this.factionSpeed[0] = 1;
    this.factionPower[0] = 1;
    for (let f = 1; f < MAX_FACTIONS; f++) {
      const fd = def.factions[f - 1];
      const sp = fd ? SPECIES_IDS.indexOf(fd.species) : -1;
      const stats = fd ? SPECIES[fd.species] : SPECIES.bee;
      this.speciesByFaction[f] = sp >= 0 ? sp : 255;
      this.factionGrowth[f] = stats.growthMul;
      this.factionSpeed[f] = stats.speedMul;
      this.factionPower[f] = stats.power;
      const spIdx = sp >= 0 ? sp : 0;
      this.nodeTexByFaction[f] = this.atlas.nodeBodies[spIdx][f - 1];
      this.unitTexByFaction[f] = this.atlas.unitFrames[spIdx][f - 1];
    }
    this.nodes.load(def);
    this.units.clear();
    this.emitter.clear();
    this.fx.clear();
    this.ais[0].reset(def.factions[1]?.ai);
    this.ais[1].reset(def.factions[2]?.ai);
    this.cmdCount = 0;
    this.time = 0;
    this.stress = false;
    this.playing = true;
    this.nodesView.reset(this.nodes);
    this.orbitView.reset();
  }

  /** Poste un ordre d'envoi joueur (appelé par les gestes, hors tick). */
  postSend(src: number, dst: number): void {
    if (this.cmdCount >= CMD_CAP) return;
    this.cmdSrc[this.cmdCount] = src;
    this.cmdDst[this.cmdCount] = dst;
    this.cmdCount++;
  }

  /** API de commande (joueur et bot) : envoi de `sendFrac` du stock. */
  sendOrder(src: number, dst: number, f: Faction): boolean {
    const ok = this.emitter.send(src, dst, f, Math.max(1, Math.floor(this.nodes.stock[src] * this.sendFrac)));
    if (ok) this.sfx.send();
    return ok;
  }

  update(dt: number): void {
    if (!this.playing) return;
    this.time += dt;

    // 1. commandes joueur (fraction du stock au moment de l'ordre)
    for (let c = 0; c < this.cmdCount; c++) this.sendOrder(this.cmdSrc[c], this.cmdDst[c], PLAYER);
    this.cmdCount = 0;

    this.nodes.grow(dt); // 2. production (× croissance d'espèce)
    this.emitter.update(dt); // 3. rafales d'émission
    this.units.update(dt, this.time, this.nodes); // 4. vol + arrivées/captures
    this.combat.update(this.units, this.fx, this.sfx); // 5. combat à puissance
    this.units.sweepDead(); // 6. compactage (les index de grille ne servent plus)
    for (const ai of this.ais) ai.update(dt); // 7. décisions IA
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
      return;
    }
    // victoire = TOUTES les factions IA éliminées (une faction absente de la
    // carte a ses trois compteurs à 0 dès le chargement : trivialement morte)
    for (let f = 2; f < MAX_FACTIONS; f++) {
      if (!this.eliminated(f as Faction)) return;
    }
    this.playing = false;
    this.onGameOver(true, this.time);
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
      enemy: this.nodes.byFaction[2] + this.nodes.byFaction[3],
      neutral: this.nodes.byFaction[0],
      units: this.units.count,
    };
  }
}
