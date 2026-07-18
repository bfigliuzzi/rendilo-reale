import type { Container, Texture } from 'pixi.js';
import { Sprite } from 'pixi.js';
import { lerp } from '@shared/math';
import { DESIGN_H, DESIGN_W } from '../config/balance';
import type { LevelDef } from '../config/levels';
import type { Atlas, DecorProp, DecorSet } from './textures';

const PARK = -9999;
const PROP_CAP = 40;
const WEATHER_CAP = 16;
const NODE_CLEAR = 92; // px min entre un prop et un nœud — la lecture du gameplay prime
const PROP_CLEAR = 34; // px min entre deux props (pas d'amas)
const TRIES = 12; // tentatives de placement avant abandon du tirage

/** Biome d'une carte — pure fonction de LevelDef, aucun état save :
 *  ≥ 2 camps IA → friche de guerre (3), sinon l'espèce du premier adversaire
 *  (abeilles rivales 0, mouches 1, cafards 2). */
export function biomeOf(def: LevelDef): number {
  if (def.factions.length >= 3) return 3;
  const sp = def.factions[1]?.species;
  return sp === 'fly' ? 1 : sp === 'roach' ? 2 : 0;
}

/** FNV-1a de l'id de carte : le décor est STABLE au restart ↻ (même carte = même seed). */
export function decorSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/** Météo d'un biome : null = air calme. vy < 0 = particules ascendantes. */
interface WeatherDef {
  count: number;
  tint: number;
  alpha: number;
  size: readonly [number, number];
  vx: readonly [number, number];
  vy: readonly [number, number];
  swayX: number; // dérive horizontale sinusoïdale additionnelle (px/s)
}

// indexé comme HIVE_BIOMES : prairie, marécage, sous-bois, friche
const WEATHER: readonly (WeatherDef | null)[] = [
  { count: 10, tint: 0xe8d9a8, alpha: 0.25, size: [0.7, 1.2], vx: [-6, 6], vy: [-24, -9], swayX: 10 }, // pollen ascendant pâle
  { count: 12, tint: 0x86a77a, alpha: 0.28, size: [0.6, 1.1], vx: [-8, 8], vy: [8, 20], swayX: 14 }, // spores de vase
  null, // sous-bois nocturne — air calme
  { count: 10, tint: 0x9a938c, alpha: 0.2, size: [0.7, 1.3], vx: [-14, 6], vy: [10, 26], swayX: 12 }, // cendres grises
];

/**
 * Décor non interactif d'une carte : props posés UNE fois à setup() — l'écran
 * est fixe, pas de chunks ni de scroll (≠ horde) — + météo ambiante interpolée.
 * Génération seedée par l'id de carte (stable au restart ↻), clearance autour
 * des nœuds : le décor ne gêne jamais la lecture du gameplay. Même contrat que
 * les pools : sprites préalloués parqués (-9999), zéro allocation dans
 * update()/render().
 */
export class Decor {
  private clock = 0;
  private rngState = 1;
  private count = 0;
  private readonly sprites: Sprite[] = [];
  private readonly px = new Float32Array(PROP_CAP);
  private readonly py = new Float32Array(PROP_CAP);
  private readonly swayAmp = new Float32Array(PROP_CAP);
  private readonly swayPhase = new Float32Array(PROP_CAP);
  // météo (espace écran) : prev/cur pour l'interpolation du rendu
  private weatherCount = 0;
  private swayX = 0;
  private readonly wSprites: Sprite[] = [];
  private readonly wx = new Float32Array(WEATHER_CAP);
  private readonly wy = new Float32Array(WEATHER_CAP);
  private readonly wPrevX = new Float32Array(WEATHER_CAP);
  private readonly wPrevY = new Float32Array(WEATHER_CAP);
  private readonly wvx = new Float32Array(WEATHER_CAP);
  private readonly wvy = new Float32Array(WEATHER_CAP);
  private readonly wPhase = new Float32Array(WEATHER_CAP);

  constructor(
    propLayer: Container,
    weatherLayer: Container,
    private readonly atlas: Atlas,
  ) {
    for (let i = 0; i < PROP_CAP; i++) {
      const s = new Sprite(atlas.decor[0].props[0].tex); // texture remplacée au setup
      s.anchor.set(0.5, 1); // ancré au pied : le balancement pivote à la base
      s.position.set(PARK, PARK);
      propLayer.addChild(s);
      this.sprites.push(s);
    }
    for (let i = 0; i < WEATHER_CAP; i++) {
      const s = new Sprite(atlas.decor[0].mote);
      s.anchor.set(0.5);
      s.position.set(PARK, PARK);
      weatherLayer.addChild(s);
      this.wSprites.push(s);
    }
  }

  /** mulberry32 « déroulé » en méthode : pas de closure, état rembobiné par setup(). */
  private nextRand(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(this.rngState ^ (this.rngState >>> 15), 1 | this.rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private range(min: number, max: number): number {
    return min + this.nextRand() * (max - min);
  }

  /** Pose tout le décor de la carte UNE fois : props avec clearance, détails
   *  de sol discrets, puis installe la météo du biome. */
  setup(def: LevelDef): void {
    const biome = biomeOf(def);
    this.rngState = (decorSeed(def.id) ^ 0x9e3779b9) | 0;
    this.clock = 0;
    for (let i = 0; i < this.count; i++) {
      this.sprites[i].position.set(PARK, PARK);
      this.sprites[i].rotation = 0;
    }
    this.count = 0;
    const set = this.atlas.decor[biome];
    const nProps = 23 + Math.floor(this.nextRand() * 7); // 23..29 tirages
    for (let k = 0; k < nProps; k++) this.placeProp(def, set);
    // détails de sol : très discrets (alpha ≤ 0.5), posés sans clearance
    const nGround = 3 + Math.floor(this.nextRand() * 3); // 3..5
    for (let k = 0; k < nGround; k++) {
      const tex = set.ground[Math.floor(this.nextRand() * set.ground.length)];
      this.spawnSprite(tex, this.range(30, DESIGN_W - 30), this.range(30, DESIGN_H - 30), 0, 0.45);
    }
    // météo du biome (aucune sur le biome à air calme)
    const w = WEATHER[biome];
    this.weatherCount = w ? w.count : 0;
    this.swayX = w ? w.swayX : 0;
    for (let i = 0; i < WEATHER_CAP; i++) {
      const s = this.wSprites[i];
      if (!w || i >= w.count) {
        s.position.set(PARK, PARK);
        continue;
      }
      s.texture = set.mote;
      s.tint = w.tint;
      s.alpha = w.alpha;
      s.scale.set(this.range(w.size[0], w.size[1]));
      this.wx[i] = this.wPrevX[i] = this.range(0, DESIGN_W);
      this.wy[i] = this.wPrevY[i] = this.range(0, DESIGN_H);
      this.wvx[i] = this.range(w.vx[0], w.vx[1]);
      this.wvy[i] = this.range(w.vy[0], w.vy[1]);
      this.wPhase[i] = this.range(0, Math.PI * 2);
    }
  }

  /** Météo seule — les props sont statiques ; no-op sur le biome à air calme. */
  update(dt: number): void {
    this.clock += dt;
    for (let i = 0; i < this.weatherCount; i++) {
      this.wPrevX[i] = this.wx[i];
      this.wPrevY[i] = this.wy[i];
      const drift = this.swayX > 0 ? Math.sin(this.clock * 1.6 + this.wPhase[i]) * this.swayX : 0;
      this.wx[i] += (this.wvx[i] + drift) * dt;
      this.wy[i] += this.wvy[i] * dt;
      // wrap écran : téléport = prev recalé, pas de traînée au rendu
      if (this.wy[i] > DESIGN_H + 12) this.wPrevY[i] = this.wy[i] -= DESIGN_H + 24;
      else if (this.wy[i] < -12) this.wPrevY[i] = this.wy[i] += DESIGN_H + 24;
      if (this.wx[i] > DESIGN_W + 12) this.wPrevX[i] = this.wx[i] -= DESIGN_W + 24;
      else if (this.wx[i] < -12) this.wPrevX[i] = this.wx[i] += DESIGN_W + 24;
    }
  }

  render(alpha: number): void {
    // balancement render-only de la végétation (pivot au pied, amplitude par prop)
    for (let i = 0; i < this.count; i++) {
      const amp = this.swayAmp[i];
      if (amp > 0) this.sprites[i].rotation = Math.sin(this.clock * 1.7 + this.swayPhase[i]) * amp;
    }
    for (let i = 0; i < this.weatherCount; i++) {
      const s = this.wSprites[i];
      s.x = lerp(this.wPrevX[i], this.wx[i], alpha);
      s.y = lerp(this.wPrevY[i], this.wy[i], alpha);
    }
  }

  /** ≤ 12 tentatives : rejet si trop près d'un nœud (92 px) ou d'un prop posé (34 px). */
  private placeProp(def: LevelDef, set: DecorSet): void {
    for (let t = 0; t < TRIES; t++) {
      const x = this.range(14, DESIGN_W - 14);
      const y = this.range(24, DESIGN_H - 8);
      if (!this.clear(def, x, y)) continue;
      const p = this.pickProp(set.props);
      this.spawnSprite(p.tex, x, y, p.sway, 0.9);
      return;
    }
  }

  private clear(def: LevelDef, x: number, y: number): boolean {
    const nodes = def.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const dx = nodes[i].x - x;
      const dy = nodes[i].y - y;
      if (dx * dx + dy * dy < NODE_CLEAR * NODE_CLEAR) return false;
    }
    for (let i = 0; i < this.count; i++) {
      const dx = this.px[i] - x;
      const dy = this.py[i] - y;
      if (dx * dx + dy * dy < PROP_CLEAR * PROP_CLEAR) return false;
    }
    return true;
  }

  private spawnSprite(tex: Texture, x: number, y: number, sway: number, alpha: number): void {
    if (this.count >= PROP_CAP) return;
    const i = this.count++;
    const s = this.sprites[i];
    s.texture = tex;
    s.position.set(x, y);
    s.alpha = alpha;
    const scale = this.range(0.8, 1.15);
    s.scale.set(this.nextRand() < 0.5 ? -scale : scale, scale); // flip X gratuit
    s.rotation = 0;
    this.px[i] = x;
    this.py[i] = y;
    this.swayAmp[i] = sway;
    this.swayPhase[i] = this.range(0, Math.PI * 2);
  }

  private pickProp(props: readonly DecorProp[]): DecorProp {
    let total = 0;
    for (let i = 0; i < props.length; i++) total += props[i].weight;
    let r = this.nextRand() * total;
    for (let i = 0; i < props.length; i++) {
      r -= props[i].weight;
      if (r <= 0) return props[i];
    }
    return props[props.length - 1];
  }
}
