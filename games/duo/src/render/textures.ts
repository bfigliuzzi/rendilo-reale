import { Texture } from 'pixi.js';
import type { SocleShape } from '../config/mascots';
import { SPRITES, SPRITE_SIZE } from './sprites';

/**
 * Toutes les textures sont GÉNÉRÉES en canvas au boot : zéro asset, donc zéro
 * octet à précacher et une collection qui s'ouvre hors ligne dès la première
 * visite (pattern des cinq autres jeux du hub).
 *
 * SCALEMODE — justification demandée au §6 : `linear` PARTOUT, y compris pour
 * les deux postures. Aucun micro-jeu de Duo n'a de caméra : tout vit en
 * coordonnées logiques (540×960 ou 960×540), exactement celles de l'overlay de
 * boutons, et le letterbox impose une échelle FRACTIONNAIRE — sous `nearest`,
 * les arêtes scintilleraient d'une frame à l'autre au moindre redimensionnement.
 * La netteté vient du TRACÉ : chaque case d'art est un rectangle plein dessiné
 * en supersampling ×2 puis affiché à 0.5, jamais une petite frame étirée. Les
 * vignettes DOM, elles, sont à échelle ENTIÈRE : c'est là que
 * `image-rendering: pixelated` a un sens (cf. `.pix` dans index.html).
 */

/**
 * Charte CHAUDE et DOUCE — public de 5 ans. Cacao en fond, crème pour le texte,
 * or pour l'appel, et quatre teintes de jeu franches mais adoucies. Pas de
 * rouge sang, pas de noir pur, pas d'aplat blanc : ces trois codes sont ceux de
 * la peur et du danger, et cette collection n'en a aucun.
 *
 * Chaque valeur porte son rôle et son contraste visé. Le scénario `contrast` du
 * bot les recalcule sur CES valeurs (exposées par `window.__game.palette`) —
 * jamais « à l'œil » : sur Cerveau, un bleu à 2,5:1 semblait parfait.
 */
export const PALETTE = {
  bg: 0x3b2a20, // cacao chaud — aussi le theme-color de la page
  bgDeep: 0x2c1f18, // fond OPAQUE des écrans plein cadre
  panel: 0x54392c, // cartouches, socles de boutons (1,3:1 sur bg : fond, pas information)
  panelEdge: 0xc79a7b, // liseré INFORMATIF → 5,4:1 sur bg (WCAG 1.4.11 exige 3:1)
  cream: 0xfff3e2, // texte principal — 12,5:1
  dim: 0xe8cfb4, // texte secondaire — 9,1:1
  gold: 0xffc95e, // appel, sélection, étoiles — 9,0:1
  goldDark: 0x8a5c10, // ombre portée des boutons dorés
  leaf: 0xa9d97f, // vert doux : réussite, but atteint
  sky: 0x87cfe8, // bleu doux : information neutre, anneau de focus
  berry: 0xf2748a, // rose : fruit « fraise », accents chauds
  plum: 0x9c5fd1, // violet : la bête, les mystères
  outline: 0x2a1b14, // contour de tous les sprites — brun, jamais noir
} as const;

/** Côté d'affichage d'un sprite, en pixels logiques. */
export const UNIT_PX = 64;
/** Côté d'affichage d'un socle de mascotte, en pixels logiques. */
export const SOCLE_PX = 80;
/** Côté d'une tuile de fond raccordable, en pixels logiques. */
export const GROUND_PX = 32;

const S = 2; // supersampling : on dessine ×2, on affiche à 0.5

// ───────────────────────── Outils de couleur ─────────────────────────

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Luminance relative WCAG. */
export function luminance(color: number): number {
  const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return (
    0.2126 * lin(((color >> 16) & 0xff) / 255) +
    0.7152 * lin(((color >> 8) & 0xff) / 255) +
    0.0722 * lin((color & 0xff) / 255)
  );
}

/** Rapport de contraste WCAG. ≥ 3:1 pour un marqueur, ≥ 4,5:1 pour du texte. */
export function contrastRatio(a: number, b: number): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ───────────────────────── Peinture ─────────────────────────

function ctx2d(w: number, h: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('canvas 2d indisponible');
  return c;
}

function toTexture(c: CanvasRenderingContext2D): Texture {
  const tex = Texture.from(c.canvas);
  tex.source.scaleMode = 'linear'; // cf. justification en tête de fichier
  return tex;
}

/** Peint une grille de sprite case par case, en rectangles PLEINS entiers. */
function paintGrid(
  c: CanvasRenderingContext2D,
  grid: readonly string[],
  ink: Readonly<Record<string, number>>,
  cell: number,
  ox = 0,
  oy = 0,
): void {
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const color = ink[ch];
      if (color === undefined) continue;
      c.fillStyle = hex(color);
      c.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    }
  }
}

/**
 * Peint une forme définie par un prédicat, pixel device par pixel device.
 * On ne passe JAMAIS par `arc()` : dans Pixi v8 un `arc()` sans `moveTo`
 * préalable se relie au point courant du chemin — resté à l'origine — et trace
 * une balafre en travers de l'écran (piège vécu sur Berceau). Ici, en canvas
 * 2D, le motif garde en plus des arêtes franches, cohérentes avec le pixel art.
 */
function paintMask(
  c: CanvasRenderingContext2D,
  size: number,
  color: number,
  inside: (u: number, v: number) => boolean,
): void {
  c.fillStyle = hex(color);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    let run = -1;
    for (let x = 0; x <= size; x++) {
      const on = x < size && inside((x + 0.5 - half) / half, (y + 0.5 - half) / half);
      if (on && run < 0) run = x;
      else if (!on && run >= 0) {
        c.fillRect(run, y, x - run, 1); // scanline : un seul fillRect par segment
        run = -1;
      }
    }
  }
}

// ───────────────────────── Formes de socle ─────────────────────────

/**
 * Le DEUXIÈME code d'identité d'un joueur (§5 : jamais la couleur seule).
 * Six masques strictement distincts, tous convexes et pleins — aucun ANNEAU :
 * ce code est réservé aux dangers et aux zones de jeu dans tout le dépôt.
 */
const SOCLE_MASKS: Readonly<Record<SocleShape, (u: number, v: number) => boolean>> = {
  disc: (u, v) => u * u + v * v <= 1,
  square: (u, v) => Math.abs(u) <= 0.86 && Math.abs(v) <= 0.86,
  hex: (u, v) => Math.abs(v) <= 0.86 && Math.abs(u) * 0.866 + Math.abs(v) * 0.5 <= 0.86,
  triangle: (u, v) => v <= 0.86 && v >= -0.86 && Math.abs(u) <= (0.86 - v) * 0.62,
  flower: (u, v) => {
    const r = Math.sqrt(u * u + v * v);
    const a = Math.atan2(v, u);
    return r <= 0.62 + 0.3 * Math.abs(Math.cos(a * 3));
  },
  cloud: (u, v) =>
    (u + 0.42) * (u + 0.42) + (v - 0.08) * (v - 0.08) <= 0.3 ||
    (u - 0.42) * (u - 0.42) + (v - 0.08) * (v - 0.08) <= 0.3 ||
    u * u + (v + 0.18) * (v + 0.18) <= 0.44,
};

export const SOCLE_SHAPES: readonly SocleShape[] = [
  'disc',
  'square',
  'hex',
  'triangle',
  'flower',
  'cloud',
];

// ───────────────────────── Atlas ─────────────────────────

export interface Atlas {
  /** Une texture par sprite de `SPRITES`, à sa taille d'affichage. */
  units: Readonly<Record<string, Texture>>;
  /** Un masque plein par forme de socle, à teinter. */
  socles: Readonly<Record<SocleShape, Texture>>;
  /** Tuile de fond raccordable. */
  ground: Texture;
  /** Disque blanc à teinter : particules, motes, billes de démo. */
  spark: Texture;
  /** Carré blanc à teinter : éclats, blocs, cases. */
  shard: Texture;
  /** Halo doux à teinter : mise en avant d'une cible. */
  glow: Texture;
}

function buildUnits(): Record<string, Texture> {
  const out: Record<string, Texture> = {};
  const cell = (UNIT_PX * S) / SPRITE_SIZE; // 64×2/16 = 8 px device — ENTIER, obligatoire
  for (const [name, def] of Object.entries(SPRITES)) {
    const c = ctx2d(UNIT_PX * S, UNIT_PX * S);
    paintGrid(c, def.grid, def.ink, cell);
    out[name] = toTexture(c);
  }
  return out;
}

function buildSocles(): Record<SocleShape, Texture> {
  const size = SOCLE_PX * S;
  const out = {} as Record<SocleShape, Texture>;
  for (const shape of SOCLE_SHAPES) {
    const c = ctx2d(size, size);
    paintMask(c, size, 0xffffff, SOCLE_MASKS[shape]);
    out[shape] = toTexture(c);
  }
  return out;
}

/**
 * Fond : un damier très doux de deux cacaos voisins, plus quelques points.
 * INTERDIT de charte, repris de tout le dépôt : pas de hachures jaune/noir, pas
 * d'anneau, pas d'aplat blanc dans le décor — ces codes appartiennent aux
 * informations de jeu, et un décor qui les emprunte ment au joueur.
 */
function buildGround(): Texture {
  const size = GROUND_PX * S;
  const c = ctx2d(size, size);
  c.fillStyle = hex(PALETTE.bg);
  c.fillRect(0, 0, size, size);
  c.fillStyle = hex(0x423024);
  c.fillRect(0, 0, size / 2, size / 2);
  c.fillRect(size / 2, size / 2, size / 2, size / 2);
  c.fillStyle = hex(0x4a3729);
  c.fillRect(size / 2 - S, size / 2 - S, S * 2, S * 2);
  return toTexture(c);
}

function buildSpark(): Texture {
  const size = 16 * S;
  const c = ctx2d(size, size);
  paintMask(c, size, 0xffffff, (u, v) => u * u + v * v <= 1);
  return toTexture(c);
}

function buildShard(): Texture {
  const size = 12 * S;
  const c = ctx2d(size, size);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, size, size);
  return toTexture(c);
}

/** SEUL endroit où un dégradé est permis : un halo doux ne peut pas se plotter. */
function buildGlow(): Texture {
  const size = 96 * S;
  const c = ctx2d(size, size);
  const half = size / 2;
  const g = c.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  return toTexture(c);
}

export function buildAtlas(): Atlas {
  return {
    units: buildUnits(),
    socles: buildSocles(),
    ground: buildGround(),
    spark: buildSpark(),
    shard: buildShard(),
    glow: buildGlow(),
  };
}

let cached: Atlas | null = null;

/**
 * Atlas partagé par les huit micro-jeux. Il est construit UNE fois : chaque
 * micro-jeu qui le rebâtirait repaierait 20 canvas à chaque « encore », ce que
 * l'on remarque immédiatement sur un téléphone d'attente.
 */
export function getAtlas(): Atlas {
  if (!cached) cached = buildAtlas();
  return cached;
}

/**
 * Les mêmes sprites en `data:` URL, à échelle ENTIÈRE, pour les `<img>` des
 * panneaux DOM (choix des mascottes, vignettes du menu, écran de résultat).
 * Sans eux, la moitié de la collection — qui se joue hors du canvas — serait un
 * mur de texte, ce qu'un enfant de 5 ans ne lit pas.
 */
export function buildSpriteUrls(): Record<string, string> {
  const out: Record<string, string> = {};
  const cell = 4; // 16 × 4 = 64 px, échelle entière
  for (const [name, def] of Object.entries(SPRITES)) {
    const c = ctx2d(SPRITE_SIZE * cell, SPRITE_SIZE * cell);
    paintGrid(c, def.grid, def.ink, cell);
    out[name] = c.canvas.toDataURL('image/png');
  }
  return out;
}
