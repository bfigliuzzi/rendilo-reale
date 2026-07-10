import { Container, Sprite } from 'pixi.js';
import * as B from '../config/balance';
import { lerp } from '@shared/math';
import type { Atlas, DecorProp } from './textures';

const PARK = -9999;
const PROP_CAP = 96;
const WEATHER_CAP = 32;
const CHUNK = 200; // tranche de voie (px) par passe de génération

/** Réglage météo d'un biome : null = air calme. Espace écran, wrap sur les bords. */
interface WeatherDef {
  count: number;
  leaf: boolean; // texture feuille (sinon spark)
  tints: readonly number[];
  alpha: number;
  size: readonly [number, number];
  vx: readonly [number, number];
  vy: readonly [number, number];
  swayX: number; // dérive horizontale sinusoïdale additionnelle (px/s)
}

// indexé comme BIOMES : ville, désert, campagne, jungle, savane, sibérie
const WEATHER: readonly (WeatherDef | null)[] = [
  null, // ville — air calme
  { count: 24, leaf: false, tints: [0xeac98a], alpha: 0.4, size: [0.5, 1.1], vx: [70, 150], vy: [18, 48], swayX: 0 }, // sable
  { count: 12, leaf: false, tints: [0xfef9c3, 0xffffff], alpha: 0.35, size: [0.4, 0.8], vx: [-10, 10], vy: [10, 26], swayX: 14 }, // pollen
  { count: 16, leaf: true, tints: [0x65a30d, 0x4d7c0f, 0x84cc16], alpha: 0.9, size: [0.8, 1.3], vx: [-14, 14], vy: [40, 80], swayX: 26 }, // feuilles
  { count: 10, leaf: false, tints: [0xdec083], alpha: 0.3, size: [0.5, 1], vx: [50, 110], vy: [12, 34], swayX: 0 }, // poussière
  { count: 30, leaf: false, tints: [0xffffff], alpha: 0.65, size: [0.5, 1.1], vx: [-20, 20], vy: [55, 110], swayX: 18 }, // neige
];

/**
 * Décor non interactif : props des bas-côtés + détails discrets de chaussée
 * (coordonnées monde, sous toutes les entités de jeu) et météo ambiante
 * (espace écran, au-dessus du monde). Génération SEEDÉE par tranches de voie
 * — même seed = même décor, aucun impact gameplay. Même contrat que les autres
 * pools : sprites préalloués, swap-remove, zéro allocation dans update().
 */
export class Decor {
  private biome = 0;
  private rngState = 1;
  private clock = 0;
  private nextChunk = 0;
  private count = 0;
  private readonly sprites: Sprite[] = [];
  private readonly propY = new Float32Array(PROP_CAP);
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
      const s = new Sprite(atlas.spark); // texture remplacée au spawn
      s.anchor.set(0.5, 1); // ancré au pied : le balancement pivote à la base
      s.position.set(PARK, PARK);
      propLayer.addChild(s);
      this.sprites.push(s);
    }
    for (let i = 0; i < WEATHER_CAP; i++) {
      const s = new Sprite(atlas.spark);
      s.anchor.set(0.5);
      s.position.set(PARK, PARK);
      weatherLayer.addChild(s);
      this.wSprites.push(s);
    }
  }

  /** mulberry32 « déroulé » en méthode : pas de closure, état rembobinable par setup(). */
  private nextRand(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(this.rngState ^ (this.rngState >>> 15), 1 | this.rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private range(min: number, max: number): number {
    return min + this.nextRand() * (max - min);
  }

  /** Nouvelle run : rembobine le générateur (dist repart de 0) et installe la météo. */
  setup(biome: number, seed: number): void {
    this.biome = Math.min(biome, this.atlas.decor.length - 1);
    this.rngState = (seed ^ 0x9e3779b9) | 0;
    this.nextChunk = 0;
    this.clock = 0;
    for (let i = 0; i < this.count; i++) {
      this.sprites[i].position.set(PARK, PARK);
      this.sprites[i].rotation = 0;
    }
    this.count = 0;
    const w = WEATHER[this.biome] ?? null;
    this.weatherCount = w ? w.count : 0;
    this.swayX = w ? w.swayX : 0;
    for (let i = 0; i < WEATHER_CAP; i++) {
      const s = this.wSprites[i];
      if (!w || i >= w.count) {
        s.position.set(PARK, PARK);
        continue;
      }
      s.texture = w.leaf ? this.atlas.leaf : this.atlas.spark;
      s.tint = w.tints[i % w.tints.length];
      s.alpha = w.alpha;
      s.scale.set(this.range(w.size[0], w.size[1]));
      s.rotation = w.leaf ? this.range(0, Math.PI * 2) : 0;
      this.wx[i] = this.wPrevX[i] = this.range(0, B.DESIGN_W);
      this.wy[i] = this.wPrevY[i] = this.range(0, B.DESIGN_H);
      this.wvx[i] = this.range(w.vx[0], w.vx[1]);
      this.wvy[i] = this.range(w.vy[0], w.vy[1]);
      this.wPhase[i] = this.range(0, Math.PI * 2);
    }
  }

  update(dt: number, dist: number): void {
    this.clock += dt;
    // génération devant la caméra, recyclage derrière
    const aheadTo = dist + B.DESIGN_H + 260;
    while (this.nextChunk * CHUNK < aheadTo) this.spawnChunk(this.nextChunk++);
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.propY[i] > -dist + B.CULL_BEHIND + 100) this.kill(i);
    }
    // météo : chute + dérive, wrap écran (téléport = prev recalé, pas de traînée)
    for (let i = 0; i < this.weatherCount; i++) {
      this.wPrevX[i] = this.wx[i];
      this.wPrevY[i] = this.wy[i];
      const drift = this.swayX > 0 ? Math.sin(this.clock * 1.6 + this.wPhase[i]) * this.swayX : 0;
      this.wx[i] += (this.wvx[i] + drift) * dt;
      this.wy[i] += this.wvy[i] * dt;
      if (this.wy[i] > B.DESIGN_H + 12) this.wPrevY[i] = this.wy[i] -= B.DESIGN_H + 24;
      if (this.wx[i] > B.DESIGN_W + 12) this.wPrevX[i] = this.wx[i] -= B.DESIGN_W + 24;
      else if (this.wx[i] < -12) this.wPrevX[i] = this.wx[i] += B.DESIGN_W + 24;
    }
  }

  render(alpha: number): void {
    // balancement de la végétation (pivot au pied, amplitude par prop)
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

  /** Une tranche de voie : 1-3 props de bas-côté + parfois un détail de chaussée. */
  private spawnChunk(idx: number): void {
    const set = this.atlas.decor[this.biome];
    const y0 = -(idx * CHUNK); // le monde avance en Y négatif
    const n = 1 + Math.floor(this.nextRand() * 2.6);
    for (let k = 0; k < n; k++) {
      const p = this.pickProp(set.props);
      const left = this.nextRand() < 0.5;
      const x = left ? this.range(8, 52) : this.range(B.DESIGN_W - 52, B.DESIGN_W - 8);
      this.spawnSprite(p.tex, x, y0 - this.nextRand() * CHUNK, p.sway, 1);
    }
    // détail de chaussée, discret : alpha réduit, jamais un code danger
    if (set.ground.length > 0 && this.nextRand() < 0.55) {
      const tex = set.ground[Math.floor(this.nextRand() * set.ground.length)];
      const x = this.range(B.LANE_MIN_X + 30, B.LANE_MAX_X - 30);
      this.spawnSprite(tex, x, y0 - this.nextRand() * CHUNK, 0, 0.55);
    }
  }

  private spawnSprite(tex: DecorProp['tex'], x: number, y: number, sway: number, alpha: number): void {
    if (this.count >= PROP_CAP) return;
    const i = this.count++;
    const s = this.sprites[i];
    s.texture = tex;
    s.position.set(x, y);
    s.alpha = alpha;
    const scale = this.range(0.8, 1.15);
    s.scale.set(this.nextRand() < 0.5 ? -scale : scale, scale);
    s.rotation = 0;
    this.propY[i] = y;
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

  private kill(i: number): void {
    const last = --this.count;
    const s = this.sprites[i];
    this.sprites[i] = this.sprites[last];
    this.sprites[last] = s;
    this.propY[i] = this.propY[last];
    this.swayAmp[i] = this.swayAmp[last];
    this.swayPhase[i] = this.swayPhase[last];
    s.position.set(PARK, PARK);
    s.rotation = 0;
  }
}
