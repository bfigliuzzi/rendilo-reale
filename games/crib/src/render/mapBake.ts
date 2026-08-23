import { Texture } from 'pixi.js';
import { mulberry32 } from '@shared/rng';
import * as B from '../config/balance';
import type { BiomeId } from '../config/maps';
import { M_HEDGE, M_LANE, M_WALL, M_WATER, type Terrain } from '../game/terrain';
import { PALETTE, type Atlas } from './textures';

/**
 * Le SOL d'une carte, cuit une fois au chargement en une texture aux dimensions de
 * l'arène. Un seul sprite, un seul draw call, zéro coût au tick.
 *
 * Deux partis pris qui portent tout le reste :
 *
 * ① On peint DEPUIS LE MASQUE, pas depuis les vecteurs d'origine. Le rendu et la
 *    simulation lisent donc la même table : il est structurellement impossible que
 *    le sol montre une voie là où la horde ne passe pas, ou une haie franchissable
 *    là où elle ne l'est pas. C'est la propriété la plus précieuse du système.
 * ② Tout est plotté en Canvas 2D sur des pixels ENTIERS, jamais avec un `Graphics`
 *    Pixi — qui antialiase — et jamais avec `arc()`, la balafre documentée du jeu.
 *
 * WCAG / vocabulaire de danger, deux règles dures :
 *  - une VOIE se marque par le MATÉRIAU, jamais par un code : pas de contour, pas
 *    de pointillés, pas de jaune/noir, pas d'aplat blanc, pas d'anneau. Ces codes
 *    appartiennent aux menaces, et le joueur doit pouvoir s'y fier absolument ;
 *  - l'EAU ne doit pas se lire comme une flaque engluante : pas d'anneau, un corps
 *    nettement plus froid et plus sombre, un rivage clair. Même piège que la dalle
 *    de terre claire qu'il avait fallu assombrir.
 */

/** Bruit déterministe par tuile : deux tuiles voisines ne se ressemblent jamais. */
function tileHash(cx: number, cy: number): number {
  let h = (cx * 0x1f1f1f1f) ^ (cy * 0x2545f491);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 0xffffffff;
}

interface MatSkin {
  body: number;
  light: number;
  dark: number;
  /** Densité de mouchetis, en éclats par tuile. */
  speck: number;
}

/**
 * Un jeu de matériaux par BIOME. Les rôles ne changent pas d'un biome à l'autre —
 * une haie de jardin, une pile de linge et un tas de cartons bloquent tous la horde
 * et laissent passer le bébé — seule la matière change. C'est ce qui garde le
 * langage visuel apprenable : on apprend « ce vert sombre, je passe dessous » une
 * fois, et la règle vaut ensuite pour le bleu du linge et le brun des cartons.
 */
const BIOME_SKINS: Record<BiomeId, Record<number, MatSkin>> = {
  garden: {
    [M_LANE]: { body: PALETTE.path, light: PALETTE.pathAlt, dark: PALETTE.pathEdge, speck: 5 },
    [M_HEDGE]: { body: PALETTE.hedgeBody, light: PALETTE.hedgeLight, dark: PALETTE.hedgeDark, speck: 7 },
    [M_WALL]: { body: PALETTE.stone, light: PALETTE.stoneLight, dark: PALETTE.ink, speck: 3 },
    [M_WATER]: { body: PALETTE.waterBody, light: PALETTE.waterEdge, dark: PALETTE.waterDeep, speck: 2 },
  },
  kitchen: {
    [M_LANE]: { body: PALETTE.kitchenPath, light: PALETTE.kitchenPathAlt, dark: PALETTE.kitchenPathEdge, speck: 4 },
    [M_HEDGE]: { body: PALETTE.linenBody, light: PALETTE.linenLight, dark: PALETTE.linenDark, speck: 6 },
    [M_WALL]: { body: PALETTE.stone, light: PALETTE.stoneLight, dark: PALETTE.ink, speck: 3 },
    [M_WATER]: { body: PALETTE.waterBody, light: PALETTE.waterEdge, dark: PALETTE.waterDeep, speck: 2 },
  },
  attic: {
    [M_LANE]: { body: PALETTE.atticPath, light: PALETTE.atticPathAlt, dark: PALETTE.atticPathEdge, speck: 5 },
    [M_HEDGE]: { body: PALETTE.cartonBody, light: PALETTE.cartonLight, dark: PALETTE.cartonDark, speck: 5 },
    [M_WALL]: { body: PALETTE.woodDark, light: PALETTE.wood, dark: PALETTE.ink, speck: 4 },
    [M_WATER]: { body: PALETTE.waterBody, light: PALETTE.waterEdge, dark: PALETTE.waterDeep, speck: 2 },
  },
};

export function bakeMap(terrain: Terrain, atlas: Atlas): Texture {
  const map = terrain.def;
  const SKINS = BIOME_SKINS[map.biome];
  const t = B.TERRAIN_TILE;
  const canvas = document.createElement('canvas');
  canvas.width = map.w;
  canvas.height = map.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d indisponible');
  ctx.imageSmoothingEnabled = false;

  // ① le sol : la tuile existante répétée. Tout le grain vient d'elle, donc c'est
  // un seul remplissage motif et pas une boucle sur 1,5 million de pixels.
  const pattern = ctx.createPattern(atlas.grounds[map.biome], 'repeat');
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, map.w, map.h);
  } else {
    ctx.fillStyle = `#${PALETTE.grass.toString(16)}`;
    ctx.fillRect(0, 0, map.w, map.h);
  }

  const at = (cx: number, cy: number): number =>
    cx < 0 || cy < 0 || cx >= terrain.cols || cy >= terrain.rows ? 0 : terrain.mat[cy * terrain.cols + cx];

  // ② les matériaux, tuile par tuile, dans l'ordre voie → massifs → dur : une voie
  // passe SOUS une haie au rendu comme elle passe au-dessus dans le masque, ce qui
  // ne se produit jamais (le carve efface) mais garde l'ordre lisible.
  for (const pass of [M_LANE, M_HEDGE, M_WATER, M_WALL]) {
    const skin = SKINS[pass];
    for (let cy = 0; cy < terrain.rows; cy++) {
      for (let cx = 0; cx < terrain.cols; cx++) {
        if (at(cx, cy) !== pass) continue;
        const x = cx * t;
        const y = cy * t;
        ctx.fillStyle = hexOf(skin.body);
        ctx.fillRect(x, y, t, t);

        // grain : quelques éclats plotés au pixel, position dérivée de la tuile
        const rand = mulberry32(((cx * 73856093) ^ (cy * 19349663)) >>> 0);
        for (let k = 0; k < skin.speck; k++) {
          const sx = x + Math.floor(rand() * (t - 3));
          const sy = y + Math.floor(rand() * (t - 3));
          ctx.fillStyle = hexOf(rand() < 0.55 ? skin.light : skin.dark);
          ctx.fillRect(sx, sy, 2 + Math.floor(rand() * 2), 2);
        }

        // bordure DENTELÉE vers l'extérieur : sans elle, les tuiles de 24 px
        // dessinent un escalier parfaitement régulier qui hurle « grille ».
        const h = tileHash(cx, cy);
        if (at(cx, cy - 1) !== pass) notch(ctx, x, y, t, 'top', h, skin.dark);
        if (at(cx, cy + 1) !== pass) notch(ctx, x, y, t, 'bottom', h, skin.dark);
        if (at(cx - 1, cy) !== pass) notch(ctx, x, y, t, 'left', h, skin.dark);
        if (at(cx + 1, cy) !== pass) notch(ctx, x, y, t, 'right', h, skin.dark);
      }
    }
  }

  // ③ le volume. Un massif peint à plat se lit comme un aplat de couleur, pas
  // comme un buisson : on pose donc des touffes SUR le massif, des pierres sur le
  // mur et des roseaux au bord de l'eau. Tout est cuit dans la même texture — c'est
  // du décor immobile, il n'a rien à faire dans un conteneur de sprites — et posé
  // DÉTERMINISTEMENT depuis la tuile, donc stable au redémarrage.
  for (let cy = 0; cy < terrain.rows; cy++) {
    for (let cx = 0; cx < terrain.cols; cx++) {
      const m = at(cx, cy);
      if (m !== M_HEDGE && m !== M_WATER && m !== M_WALL) continue;
      const h = tileHash(cx, cy);
      if (h > 0.66) continue;
      const px = cx * t + 4 + Math.floor(h * (t - 10));
      const py = cy * t + 4 + Math.floor((h * 7.3) % 1 * (t - 10));
      if (m === M_HEDGE) {
        // touffe : trois bulbes cernés d'encre, comme les props du décor
        const sk = SKINS[M_HEDGE];
        inkDisc(ctx, px, py, 6, sk.light);
        inkDisc(ctx, px + 6, py + 3, 5, sk.body);
        inkDisc(ctx, px - 5, py + 4, 4, sk.light);
      } else if (m === M_WALL) {
        // appareillage : deux assises décalées, et une arête claire au sommet
        ctx.fillStyle = hexOf(SKINS[M_WALL].dark);
        ctx.fillRect(cx * t, cy * t + t / 2 - 1, t, 2);
        ctx.fillStyle = hexOf(SKINS[M_WALL].light);
        ctx.fillRect(cx * t + 3, cy * t + 3, t - 10, 2);
      } else {
        // reflets d'eau : traits horizontaux clairs, JAMAIS un anneau
        ctx.fillStyle = hexOf(PALETTE.waterEdge);
        ctx.fillRect(px - 5, py, 10, 2);
        ctx.fillRect(px + 2, py + 6, 6, 2);
      }
    }
  }

  // rivage : liseré clair sur les tuiles d'eau qui touchent la terre. C'est ce qui
  // fait lire « mare » plutôt que « tache bleue », sans emprunter le moindre code
  // de danger.
  for (let cy = 0; cy < terrain.rows; cy++) {
    for (let cx = 0; cx < terrain.cols; cx++) {
      if (at(cx, cy) !== M_WATER) continue;
      const x = cx * t;
      const y = cy * t;
      ctx.fillStyle = hexOf(PALETTE.waterEdge);
      if (at(cx, cy - 1) !== M_WATER) ctx.fillRect(x, y, t, 3);
      if (at(cx, cy + 1) !== M_WATER) ctx.fillRect(x, y + t - 3, t, 3);
      if (at(cx - 1, cy) !== M_WATER) ctx.fillRect(x, y, 3, t);
      if (at(cx + 1, cy) !== M_WATER) ctx.fillRect(x + t - 3, y, 3, t);
    }
  }

  // ④ les socles de construction : un carré de dalle, pas un anneau. L'anneau est
  // le code des dangers ; un emplacement libre ne doit jamais l'emprunter.
  for (const slot of map.slots) {
    const r = 22;
    ctx.fillStyle = hexOf(PALETTE.slab);
    ctx.fillRect(slot.x - r, slot.y - r, r * 2, r * 2);
    ctx.fillStyle = hexOf(PALETTE.slabEdge);
    ctx.fillRect(slot.x - r, slot.y - r, r * 2, 2);
    ctx.fillRect(slot.x - r, slot.y - r, 2, r * 2);
    ctx.fillStyle = hexOf(PALETTE.ink);
    ctx.fillRect(slot.x - r, slot.y + r - 2, r * 2, 2);
    ctx.fillRect(slot.x + r - 2, slot.y - r, 2, r * 2);
    // joints : quatre pavés, pour que la dalle se lise comme un ouvrage et pas
    // comme un aplat
    ctx.fillStyle = hexOf(PALETTE.ink);
    ctx.fillRect(slot.x - r + 2, slot.y - 1, r * 2 - 4, 2);
    ctx.fillRect(slot.x - 1, slot.y - r + 2, 2, r * 2 - 4);
  }

  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

function hexOf(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** Disque plein en scanline sur pixels ENTIERS — jamais `arc()`, qui antialiase. */
function pxDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: number): void {
  ctx.fillStyle = hexOf(color);
  const top = Math.round(cy - r);
  const bottom = Math.round(cy + r);
  for (let y = top; y <= bottom; y++) {
    const dy = (y + 0.5 - cy) / r;
    const k = 1 - dy * dy;
    if (k <= 0) continue;
    const half = r * Math.sqrt(k);
    const x0 = Math.round(cx - half);
    ctx.fillRect(x0, y, Math.max(1, Math.round(cx + half) - x0), 1);
  }
}

/** Le liseré d'encre est le même disque, un pixel plus gros. Pattern du jeu. */
function inkDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: number): void {
  pxDisc(ctx, cx, cy, r + 1, PALETTE.ink);
  pxDisc(ctx, cx, cy, r, color);
}

/** Entaille d'un bord de tuile : deux ou trois pixels rongés, à position stable. */
function notch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  side: 'top' | 'bottom' | 'left' | 'right',
  h: number,
  dark: number,
): void {
  const d = 2 + Math.floor(h * 3);
  const off = Math.floor(h * (t - 8));
  ctx.fillStyle = hexOf(dark);
  if (side === 'top') ctx.fillRect(x, y, t, 2);
  else if (side === 'bottom') ctx.fillRect(x, y + t - 2, t, 2);
  else if (side === 'left') ctx.fillRect(x, y, 2, t);
  else ctx.fillRect(x + t - 2, y, 2, t);
  // le « creux » : on n'efface pas (on ne connaît pas le fond), on assombrit un
  // fragment décalé — l'œil lit une irrégularité, pas une grille
  ctx.fillStyle = hexOf(dark);
  if (side === 'top') ctx.fillRect(x + off, y + 2, 6, d);
  else if (side === 'bottom') ctx.fillRect(x + off, y + t - 2 - d, 6, d);
  else if (side === 'left') ctx.fillRect(x + 2, y + off, d, 6);
  else ctx.fillRect(x + t - 2 - d, y + off, d, 6);
}
