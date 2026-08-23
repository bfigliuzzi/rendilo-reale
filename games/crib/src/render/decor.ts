import { Container, Sprite } from 'pixi.js';
import { mulberry32 } from '@shared/rng';
import * as B from '../config/balance';
import type { Level } from '../game/level';
import { T_ENEMY, T_LANE } from '../game/terrain';
import type { Atlas, DecorProp } from './textures';

const PARK = -9999;
const PROP_CAP = 96;
const POLLEN_CAP = 26;
/** Dégagement autour du berceau : rien ne doit masquer l'objectif. */
const CRIB_CLEAR = 110;
/** Dégagement entre deux props : sans lui, ils se collent en tas illisibles. */
const PROP_CLEAR = 38;
const TRIES = 14;

/** Hachage FNV-1a de l'id du niveau : le décor est stable d'un redémarrage à l'autre. */
function decorSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Décor du jardin. Arène FIXE, donc pose unique au chargement (modèle d'Essaim)
 * plutôt que génération par tranches (modèle de horde, qui défile).
 *
 * Le décor est 100 % NON INTERACTIF et n'utilise JAMAIS les codes réservés aux
 * dangers — pas de hachures jaune/noir, pas d'anneaux, pas d'aplats blancs. Un
 * joueur doit pouvoir se fier au fait qu'un anneau au sol est TOUJOURS une menace.
 *
 * La météo (pollen) est en espace ÉCRAN et passe AU-DESSUS du monde : les entités
 * font 20-30 px, un pollen sous le gameplay serait invisible et un pollen dense les
 * masquerait — d'où le très faible nombre de grains.
 */
export class Decor {
  private count = 0;
  private readonly propX = new Float32Array(PROP_CAP);
  private readonly propY = new Float32Array(PROP_CAP);
  private readonly swayAmp = new Float32Array(PROP_CAP);
  private readonly swayPhase = new Float32Array(PROP_CAP);
  private readonly props: Sprite[] = [];

  private readonly px = new Float32Array(POLLEN_CAP);
  private readonly py = new Float32Array(POLLEN_CAP);
  private readonly pvx = new Float32Array(POLLEN_CAP);
  private readonly pvy = new Float32Array(POLLEN_CAP);
  private readonly pPhase = new Float32Array(POLLEN_CAP);
  private readonly pollen: Sprite[] = [];

  private clock = 0;
  private cribX = 0;
  private cribY = 0;
  private level: Level | null = null;
  /** Planche de props du biome courant : le décor DÉRIVE de la carte. */
  private pool: readonly DecorProp[] = [];

  constructor(
    propLayer: Container,
    weatherLayer: Container,
    private readonly atlas: Atlas,
  ) {
    for (let i = 0; i < PROP_CAP; i++) {
      // ancre au PIED : le balancement pivote à la base, pas au centre — sans ça
      // les buissons ont l'air de flotter
      const s = new Sprite({ texture: atlas.props.garden[0].tex, anchor: { x: 0.5, y: 1 } });
      s.position.set(PARK, PARK);
      this.props.push(s);
      propLayer.addChild(s);
    }
    for (let i = 0; i < POLLEN_CAP; i++) {
      const s = new Sprite({ texture: atlas.pollen, anchor: { x: 0.5, y: 0.5 }, alpha: 0.45 });
      s.position.set(PARK, PARK);
      this.pollen.push(s);
      weatherLayer.addChild(s);
    }
  }

  setup(level: Level): void {
    const def = level.def;
    const rand = mulberry32(decorSeed(def.id) ^ def.seed);
    this.level = level;
    this.cribX = level.cribX;
    this.cribY = level.cribY;
    this.pool = this.atlas.props[def.map.biome];
    // motes d'ambiance : pollen au jardin, vapeur en cuisine, poussière au grenier.
    // Une teinte suffit — la forme est la même, et c'est l'AMBIANCE qui change.
    const tint = def.map.biome === 'kitchen' ? 0xd8e2e6 : def.map.biome === 'attic' ? 0xbfae94 : 0xffffff;
    for (const p of this.pollen) p.tint = tint;
    for (let i = 0; i < this.count; i++) this.props[i].position.set(PARK, PARK);
    this.count = 0;

    const wanted = 62 + Math.floor(rand() * 14);
    for (let k = 0; k < wanted && this.count < PROP_CAP; k++) {
      const prop = this.pick(rand);
      // rejection sampling : on renonce après TRIES essais plutôt que de forcer un
      // placement invalide. Un prop manquant ne se voit pas ; un prop dans le
      // berceau, oui.
      for (let t = 0; t < TRIES; t++) {
        const x = 24 + rand() * (level.w - 48);
        const y = 24 + rand() * (level.h - 48);
        if (!this.clear(x, y)) continue;
        this.place(prop, x, y, rand);
        break;
      }
    }

    for (let i = 0; i < POLLEN_CAP; i++) {
      this.px[i] = rand() * B.DESIGN_W;
      this.py[i] = rand() * B.DESIGN_H;
      this.pvx[i] = 6 + rand() * 14;
      this.pvy[i] = 8 + rand() * 12;
      this.pPhase[i] = rand() * Math.PI * 2;
      this.pollen[i].alpha = 0.25 + rand() * 0.3;
    }
  }

  private pick(rand: () => number): DecorProp {
    let total = 0;
    for (const p of this.pool) total += p.weight;
    let roll = rand() * total;
    for (const p of this.pool) {
      roll -= p.weight;
      if (roll <= 0) return p;
    }
    return this.pool[this.pool.length - 1];
  }

  private clear(x: number, y: number): boolean {
    // rien sur une voie ni dans un massif : un buisson au milieu du chemin MENT sur
    // la passabilité, et le joueur apprendrait à se méfier du sol
    if (this.level && (this.level.terrain.flagsAt(x, y) & (T_ENEMY | T_LANE)) !== 0) return false;
    const cdx = x - this.cribX;
    const cdy = y - this.cribY;
    if (cdx * cdx + cdy * cdy < CRIB_CLEAR * CRIB_CLEAR) return false;
    for (let i = 0; i < this.count; i++) {
      const dx = x - this.propX[i];
      const dy = y - this.propY[i];
      if (dx * dx + dy * dy < PROP_CLEAR * PROP_CLEAR) return false;
    }
    return true;
  }

  private place(prop: DecorProp, x: number, y: number, rand: () => number): void {
    const i = this.count++;
    this.propX[i] = x;
    this.propY[i] = y;
    this.swayAmp[i] = prop.sway;
    this.swayPhase[i] = rand() * Math.PI * 2;
    const s = this.props[i];
    s.texture = prop.tex;
    s.position.set(x, y);
    // flip X gratuit : deux fois plus de variété pour zéro texture de plus
    s.scale.set(rand() < 0.5 ? -1 : 1, 1);
  }

  update(dt: number): void {
    this.clock += dt;
    for (let i = 0; i < POLLEN_CAP; i++) {
      this.px[i] += this.pvx[i] * dt;
      this.py[i] += this.pvy[i] * dt;
      // enroulement en espace écran, sans interpolation à recaler : le pollen n'a
      // pas de position précédente, il est purement décoratif et lent
      if (this.px[i] > B.DESIGN_W + 8) this.px[i] = -8;
      if (this.py[i] > B.DESIGN_H + 8) this.py[i] = -8;
    }
  }

  render(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.swayAmp[i] <= 0) continue;
      this.props[i].rotation = Math.sin(this.clock * 1.5 + this.swayPhase[i]) * this.swayAmp[i];
    }
    for (let i = 0; i < POLLEN_CAP; i++) {
      this.pollen[i].position.set(
        this.px[i] + Math.sin(this.clock * 1.1 + this.pPhase[i]) * 7,
        this.py[i],
      );
    }
  }
}
