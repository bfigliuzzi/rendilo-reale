import { Texture } from 'pixi.js';
import { SPRITES, SPRITE_SIZE } from './sprites';

/**
 * Toutes les textures sont GÉNÉRÉES en canvas au boot : zéro asset, donc zéro
 * octet à précacher et un jeu qui s'ouvre hors ligne dès la première visite
 * (pattern des quatre autres jeux du hub).
 *
 * Le rendu pixel art vient du TRACÉ : chaque case d'art est un rectangle plein
 * de `S × CELL` pixels device, sans dégradé ni anti-aliasing. La source est
 * dessinée à sa taille d'affichage réelle ×2 puis affichée à 0.5 — jamais une
 * petite frame étirée, qui donnerait le flou reproché aux premiers jets de
 * Horde. Le `scaleMode` reste `linear` : le letterbox impose une échelle
 * fractionnaire, où `nearest` ferait scintiller les arêtes d'une frame à l'autre.
 *
 * ACCESSIBILITÉ (WCAG 1.4.1 / 1.4.11) : une unité se lit à sa SILHOUETTE et à
 * ses chiffres autant qu'à sa teinte, et les deux camps sont séparés par la
 * POSITION (deux lignes chacun) plus un liseré de socle distinct — jamais par
 * la seule couleur. Les contrastes de `PALETTE` sont vérifiés AU CALCUL par le
 * scénario `contrast` de tools/verify-doors.mjs, sur ces valeurs-ci.
 */

/**
 * Charte CHAUDE et CHATOYANTE : prune profond en fond, ambre et or en accents,
 * crème pour le texte. Le seul froid du jeu est `cool`, réservé aux indications
 * neutres (soins, runes) — il tranche justement parce qu'il est rare.
 */
export const PALETTE = {
  bg: 0x2e1b2b, // prune nuit — aussi le theme-color de la page
  bgDeep: 0x241522,
  panel: 0x43263c,
  // Les DEUX liserés portent de l'information — le cadre du bandeau d'ordre de
  // tour, et surtout la ligne ARRIÈRE, que son pointillé oppose au liseré plein
  // de la ligne avant effective. Ils tombent donc sous WCAG 1.4.11 (3:1), que
  // les teintes d'origine (#7a4457 à 1,77:1 et #8a5060 à 2,15:1) rataient — un
  // écart parfaitement invisible à l'inspection visuelle, attrapé au calcul par
  // le scénario `contrast` du bot. Remontés à 3,4 et 3,6:1 : juste ce qu'il
  // faut, pour rester des liserés et pas des barres.
  panelEdge: 0xad7080,
  plinth: 0x3a2033,
  plinthEdge: 0xb0748a,
  gold: 0xffc247, // titres, or, cadre de l'unité active
  goldDark: 0x8a5c10,
  ember: 0xff8f6b, // corail : dégâts, danger, camp ennemi
  emberDark: 0x8c3d28,
  cool: 0x7fe0d8, // menthe : soins, runes, information neutre
  coolDark: 0x1d6b64,
  leaf: 0x9ce07a, // vert : PV, gain
  cream: 0xfff3dc, // texte principal
  dim: 0xe6c0aa, // texte secondaire
  outline: 0x1a0d18,
} as const;

export interface Atlas {
  /** Une texture par sprite de `SPRITES`, à sa taille d'affichage. */
  units: Readonly<Record<string, Texture>>;
  /** Tuile de fond raccordable. */
  ground: Texture;
  /** Porte fermée, planches et arche — le tell se blitte par-dessus. */
  door: Texture;
  /** Disque blanc à teinter : particules et lucioles. */
  spark: Texture;
  /** Carré blanc à teinter : éclats d'impact. */
  shard: Texture;
  /** Halo doux à teinter : auréole de l'unité active. */
  glow: Texture;
}

const S = 2; // supersampling : on dessine ×2, on affiche à 0.5

/** Côté d'affichage d'un sprite d'unité, en pixels logiques. */
export const UNIT_PX = 64;
/** Côté d'affichage d'une icône d'objet ou de tell, en pixels logiques. */
export const ICON_PX = 40;
/** Taille d'une porte dessinée, en pixels logiques. */
export const DOOR_W = 132;
export const DOOR_H = 176;

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
  tex.source.scaleMode = 'linear';
  return tex;
}

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function rgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff},${alpha})`;
}

/** Luminance perçue (0-1), formule WCAG. */
export function luminance(color: number): number {
  const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return (
    0.2126 * lin(((color >> 16) & 0xff) / 255) +
    0.7152 * lin(((color >> 8) & 0xff) / 255) +
    0.0722 * lin((color & 0xff) / 255)
  );
}

/** Rapport de contraste WCAG entre deux couleurs opaques. */
export function contrastRatio(a: number, b: number): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Peint une grille de sprite. `cell` est la taille d'une case d'art en pixels
 * device : tout tombe sur des entiers, donc aucune case n'est à cheval.
 */
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

function buildUnits(): Record<string, Texture> {
  const out: Record<string, Texture> = {};
  const cell = (UNIT_PX * S) / SPRITE_SIZE; // 8 px device : entier, donc net
  for (const [name, def] of Object.entries(SPRITES)) {
    const c = ctx2d(UNIT_PX * S, UNIT_PX * S);
    paintGrid(c, def.grid, def.ink, cell);
    out[name] = toTexture(c);
  }
  return out;
}

/**
 * Sol : un damas de losanges ambrés sur prune. Le motif est CALÉ sur la tuile
 * (les bords se raccordent exactement), et son contraste reste faible — il ne
 * doit jamais concurrencer la lecture des unités posées dessus.
 */
function buildGround(): Texture {
  const T = 32; // tuile logique
  const c = ctx2d(T * S, T * S);
  c.fillStyle = hex(PALETTE.bgDeep);
  c.fillRect(0, 0, T * S, T * S);
  const p = 4 * S; // pas du motif, en pixels device
  c.fillStyle = rgba(PALETTE.panelEdge, 0.22);
  for (let y = 0; y < T * S; y += p * 2) {
    for (let x = 0; x < T * S; x += p * 2) {
      c.fillRect(x, y, p, p);
      c.fillRect(x + p, y + p, p, p);
    }
  }
  // fils d'or épars : le « chatoyant » de la charte, sans bruit à l'écran
  c.fillStyle = rgba(PALETTE.gold, 0.12);
  c.fillRect(0, 0, T * S, p / 2);
  c.fillRect(0, 0, p / 2, T * S);
  return toTexture(c);
}

/**
 * Porte fermée : arche, planches verticales, ferrures. Le tell se blitte au
 * centre par-dessus — c'est le SEUL élément qui distingue deux portes, donc il
 * est posé sur un cartouche sombre à contraste garanti.
 */
function buildDoor(): Texture {
  const c = ctx2d(DOOR_W * S, DOOR_H * S);
  const px = 4 * S; // case d'art : la porte est dessinée en 33×44 cases
  const cols = Math.round((DOOR_W * S) / px);
  const rows = Math.round((DOOR_H * S) / px);
  const fill = (x: number, y: number, w: number, h: number, color: number, alpha = 1): void => {
    c.fillStyle = alpha === 1 ? hex(color) : rgba(color, alpha);
    c.fillRect(x * px, y * px, w * px, h * px);
  };

  // arche : un demi-disque tramé en cases, jamais un arc() — même piège que crib
  const cx = (cols - 1) / 2;
  const archR = cols / 2;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dy = y - archR;
      const inside = dy >= 0 ? true : (x - cx) ** 2 / archR ** 2 + (dy / archR) ** 2 <= 1;
      if (!inside) continue;
      const edge =
        x <= 1 ||
        x >= cols - 2 ||
        y >= rows - 2 ||
        (dy < 0 && (x - cx) ** 2 / (archR - 1.6) ** 2 + (dy / (archR - 1.6)) ** 2 > 1);
      if (edge) fill(x, y, 1, 1, PALETTE.outline);
      else fill(x, y, 1, 1, x % 6 === 2 || x % 6 === 3 ? 0x8a4a2a : 0xa85c33);
    }
  }
  // ferrures horizontales + cartouche central du tell
  fill(2, Math.round(rows * 0.28), cols - 4, 1, 0x6b3a20);
  fill(2, Math.round(rows * 0.78), cols - 4, 1, 0x6b3a20);
  const plaqueW = 15;
  const plaqueH = 15;
  const plaqueX = Math.round(cx - plaqueW / 2 + 0.5);
  const plaqueY = Math.round(rows * 0.34);
  fill(plaqueX - 1, plaqueY - 1, plaqueW + 2, plaqueH + 2, PALETTE.outline);
  fill(plaqueX, plaqueY, plaqueW, plaqueH, PALETTE.bgDeep);
  // poignée
  fill(cols - 7, Math.round(rows * 0.62), 3, 2, PALETTE.gold);
  return toTexture(c);
}

/** Coordonnées du cartouche de tell, en pixels logiques dans la porte. */
export const DOOR_PLAQUE = {
  x: DOOR_W / 2,
  y: Math.round(DOOR_H * 0.34 + 30),
  size: 56,
} as const;

function buildSpark(): Texture {
  const r = 8 * S;
  const c = ctx2d(r * 2, r * 2);
  // disque plotté en scanlines : des arêtes franches, pas un arc() lissé
  for (let y = -r; y < r; y++) {
    const w = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
    if (w <= 0) continue;
    c.fillStyle = '#ffffff';
    c.fillRect(r - w, r + y, w * 2, 1);
  }
  return toTexture(c);
}

function buildShard(): Texture {
  const c = ctx2d(4 * S, 4 * S);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, 4 * S, 4 * S);
  return toTexture(c);
}

/** Halo doux : un dégradé radial, seul endroit du jeu où le lissage est voulu. */
function buildGlow(): Texture {
  const r = 48 * S;
  const c = ctx2d(r * 2, r * 2);
  const g = c.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, r * 2, r * 2);
  return toTexture(c);
}

/**
 * Les mêmes sprites, en `data:` URL — les PANNEAUX DOM (recrutement, marchand,
 * escouade, bestiaire) les affichent en `<img>`. Sans ça, la moitié du jeu, qui
 * se joue hors du champ de bataille, serait un mur de texte : on veut voir la
 * tête de la recrue qu'on accepte, et l'objet qu'on achète.
 */
export function buildSpriteUrls(): Record<string, string> {
  const out: Record<string, string> = {};
  const cell = 4; // 64 px de côté : la taille d'affichage des vignettes DOM
  for (const [name, def] of Object.entries(SPRITES)) {
    const c = ctx2d(SPRITE_SIZE * cell, SPRITE_SIZE * cell);
    paintGrid(c, def.grid, def.ink, cell);
    out[name] = c.canvas.toDataURL('image/png');
  }
  return out;
}

export function buildAtlas(): Atlas {
  return {
    units: buildUnits(),
    ground: buildGround(),
    door: buildDoor(),
    spark: buildSpark(),
    shard: buildShard(),
    glow: buildGlow(),
  };
}
