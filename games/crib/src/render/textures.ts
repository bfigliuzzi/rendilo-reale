import { Rectangle, Texture } from 'pixi.js';
import { mulberry32 } from '@shared/rng';
import * as B from '../config/balance';

/**
 * Toutes les textures sont générées en canvas au boot — aucun asset.
 *
 * PIXEL ART : tout est plotté au PIXEL EXACT (`pxDisc`/`pxEllipse` remplissent des
 * pixels entiers en scanline) et jamais avec `arc()`, qui antialiase et donne le
 * flou « vectoriel » qu'on ne veut pas ici. Le bord sombre est obtenu en dessinant
 * la forme une fois en grand dans la couleur d'encre, puis une fois en petit dans
 * la couleur de corps : un liseré de 1 px, propre par construction.
 *
 * Conséquence : les frames d'animation sont PARAMÉTRÉES (décalages de membres) au
 * lieu d'être dessinées une par une — 4 directions × 3 frames de rampe pour le
 * bébé sortent d'une seule fonction.
 *
 * Un SEUL canvas source pour tout ce qui passe par un `ParticleContainer` (ennemis,
 * projectiles, ombres, particules) : c'est une contrainte de Pixi v8, toutes les
 * particules d'un conteneur doivent partager la même `TextureSource`.
 */

// ------------------------------------------------------------------- palette

/** Ambiance nature : verts de jardin, terre, bois, et un bébé terracotta. */
export const PALETTE = {
  ink: 0x2b2016, // encre commune : le liseré de TOUS les sprites
  grassDark: 0x33482c,
  grass: 0x3d5634,
  /** Bandes de tonte : volontairement à deux points de `grass`, pas plus. */
  grassStripe: 0x3a5231,
  grassLight: 0x49653d,
  grassPale: 0x577140,
  earth: 0x4b3b2b,
  earthLight: 0x5a4634,
  // — matériaux de carte (sol baké). Voies : un changement de MATIÈRE, jamais un
  // code graphique (pas de contour, pas de pointillés, pas d'anneau) : les codes
  // sont réservés aux dangers. Tons moyens, pour préserver la double lecture des
  // marqueurs qui passeront par-dessus.
  path: 0x6b5438,
  pathAlt: 0x775e3f,
  pathEdge: 0x4a3927,
  hedgeDark: 0x22381f,
  hedgeBody: 0x2c4726,
  hedgeLight: 0x3b5c31,
  // l'eau ne doit JAMAIS se lire comme une flaque engluante : le vocabulaire de
  // danger du jeu, c'est « anneau pointillé + corps clair ». Elle n'a donc pas
  // d'anneau, et son corps est nettement plus FROID et plus SOMBRE que la flaque.
  waterDeep: 0x1e3b4a,
  waterBody: 0x27505f,
  waterEdge: 0x3c6b74,
  slab: 0x6d6455,
  slabEdge: 0x8a806c,
  stone: 0x6f6857,
  stoneLight: 0x847c68,
  wood: 0x8a6240,
  woodDark: 0x5c3f28,
  blanket: 0xb9cdae,
  blanketDark: 0x8fa886,
  skin: 0xf0c49e,
  skinShade: 0xd6a17c,
  hair: 0x7a5236,
  onesie: 0xe8a87c,
  onesieShade: 0xc8825c,
  grannyHair: 0xd8cfe0,
  grannyCardigan: 0x8f6f93,
  grannySkirt: 0x5d4a63,
  nappy: 0xbfae7c,
  nappyStain: 0x7f8a45,
  broccoliTop: 0x53803c,
  broccoliTopLight: 0x6b9c4c,
  broccoliStalk: 0xc3cf9c,
  dust: 0x9b9384,
  dustLight: 0xb6ae9d,
  bossBody: 0x8d939c,
  bossDark: 0x4d525a,
  bossTrim: 0xb8443c,
  bossGlass: 0xc9d6d8,
  bottle: 0xf2e0b0,
  bottleTeat: 0xe0a97e,
  doudou: 0xb98fc4,
  doudouDark: 0x8a6894,
  pacifier: 0xe89a7c,
  toy: 0xe4d6b4, // le cube-hochet que lance le bébé
  toyEdge: 0xb99c6d,
  pea: 0x8fbb52,
  bg: 0x27381f,
  /** Réservé aux dangers : jaune de télégraphe, comme dans horde. */
  warn: 0xf2c14e,
  hud: 0xf4ead9,
} as const;

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

// ------------------------------------------------- primitives pixel-exactes

function ctx2d(w: number, h: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d indisponible');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Rectangle aligné sur la grille de pixels. */
function pxRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: number): void {
  ctx.fillStyle = hex(color);
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/**
 * Ellipse remplie en scanline sur des pixels ENTIERS : chaque ligne est un seul
 * `fillRect`, donc aucun bord antialiasé. `rx`/`ry` sont des demi-largeurs.
 */
function pxEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: number,
): void {
  ctx.fillStyle = hex(color);
  const top = Math.round(cy - ry);
  const bottom = Math.round(cy + ry);
  for (let y = top; y <= bottom; y++) {
    // centre du pixel : +0.5, sinon la forme est asymétrique d'un pixel
    const dy = (y + 0.5 - cy) / ry;
    const k = 1 - dy * dy;
    if (k <= 0) continue;
    const half = rx * Math.sqrt(k);
    const x0 = Math.round(cx - half);
    const w = Math.max(1, Math.round(cx + half) - x0);
    ctx.fillRect(x0, y, w, 1);
  }
}

function pxDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: number): void {
  pxEllipse(ctx, cx, cy, r, r, color);
}

/** Forme cernée : le liseré d'encre est le même disque, 1 px plus gros. */
function inkEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: number,
): void {
  pxEllipse(ctx, cx, cy, rx + 1, ry + 1, PALETTE.ink);
  pxEllipse(ctx, cx, cy, rx, ry, color);
}

function inkDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: number): void {
  inkEllipse(ctx, cx, cy, r, r, color);
}

/** Rectangle cerné, pour les corps anguleux (berceau, boss, cube-hochet). */
function inkRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  pxRect(ctx, x - 1, y - 1, w + 2, h + 2, PALETTE.ink);
  pxRect(ctx, x, y, w, h, color);
}

// --------------------------------------------------------------- types publics

export interface DecorProp {
  tex: Texture;
  /** Amplitude d'oscillation au rendu (0 = minéral, immobile). */
  sway: number;
  weight: number;
}

export interface Atlas {
  /** [direction 0..3][frame 0..2] — 0 bas, 1 gauche, 2 droite, 3 haut. */
  hero: readonly (readonly Texture[])[];
  enemyByKind: readonly Texture[];
  enemyAlt: readonly Texture[];
  toy: Texture;
  pea: Texture;
  spark: Texture;
  shadow: Texture;
  pickups: readonly Texture[];
  /** Berceau : 3 états d'usure, du neuf au bord de la rupture. */
  crib: readonly Texture[];
  boss: Texture;
  bossRage: Texture;
  compass: Texture;
  /** Anneau pointillé d'une flaque, à la taille RÉELLE de son rayon. */
  puddleRing: Texture;
  puddleBody: Texture;
  /** Anneau plein marquant la portée de tir du bébé. */
  rangeRing: Texture;
  ground: Texture;
  /** La TUILE de sol en canvas : le bake de carte la répète sur toute l'arène. */
  groundCanvas: HTMLCanvasElement;
  props: readonly DecorProp[];
  pollen: Texture;
}

// ------------------------------------------------------------- marqueurs HD

/**
 * Supersampling des marqueurs au sol. `resolution` de l'app est plafonnée à 2 :
 * dessiner la source à la taille d'affichage ×2 garantit qu'un anneau reste net
 * sans jamais étirer une petite frame d'atlas (la cause du crénelage dans horde).
 */
const MARKER_SS = 2;
/** Un sprite d'anneau s'affiche à `radius * 2 * MARKER_RING_MARGIN`. */
export const MARKER_RING_MARGIN = 1.14;

/**
 * Anneau à la taille réelle du rayon marqué, avec liseré NOIR intégré : la teinte
 * porte sur le décor clair, le liseré sur le décor sombre — ≥ 3:1 partout (WCAG
 * 1.4.11), sans quoi aucune couleur plate ne passerait sur toute la palette du
 * jardin.
 */
function makeRingTexture(radius: number, dashed: boolean, color: number, width = 0): Texture {
  const half = Math.ceil(radius * MARKER_RING_MARGIN) * MARKER_SS;
  const ctx = ctx2d(half * 2, half * 2);
  const r = radius * MARKER_SS;
  const edgeW = (width > 0 ? width : 7 + radius * 0.04) * MARKER_SS;
  if (dashed) {
    // ~12 tirets quel que soit le rayon : la densité reste lisible à toute taille
    const dash = (2 * Math.PI * r) / 24;
    ctx.setLineDash([dash, dash]);
  }
  ctx.lineCap = 'butt';
  for (const pass of [
    { w: edgeW, c: '#000000' },
    { w: edgeW * 0.5, c: hex(color) },
  ]) {
    ctx.beginPath();
    ctx.arc(half, half, r, 0, Math.PI * 2);
    ctx.lineWidth = pass.w;
    ctx.strokeStyle = pass.c;
    ctx.stroke();
  }
  // les anneaux, eux, restent en `linear` : ce sont des courbes supersamplées ×2,
  // pas des sprites au pixel — en `nearest` leur trait crénelerait
  return Texture.from(ctx.canvas);
}

/** Corps opaque d'une flaque : la zone à éviter se lit aussi en aplat, pas qu'au bord. */
function makePuddleBody(radius: number): Texture {
  const size = Math.ceil(radius) * 2 + 4;
  const ctx = ctx2d(size, size);
  const c = size / 2;
  const rand = mulberry32(0x9e37);
  // contour irrégulier : une flaque parfaitement ronde lirait comme un marqueur
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    const rr = radius * (0.62 + rand() * 0.3);
    pxDisc(ctx, c + Math.cos(a) * radius * 0.3, c + Math.sin(a) * radius * 0.3, rr, PALETTE.nappyStain);
  }
  return Texture.from(ctx.canvas);
}

// --------------------------------------------------------------- personnages

const HERO_CELL_W = 22;
const HERO_CELL_H = 22;

/**
 * Bébé à quatre pattes, vu de 3/4 dessus. Un seul dessin paramétré par
 * (direction, phase) : `ph` ∈ {-1, 0, 1} alterne les membres, donc la frame
 * « passing » (0) est celle où ils sont rassemblés — c'est la lecture correcte
 * d'un cycle de rampe.
 */
function drawHero(ctx: CanvasRenderingContext2D, ox: number, oy: number, dir: number, ph: number): void {
  const cx = ox + HERO_CELL_W / 2;
  const cy = oy + HERO_CELL_H / 2;
  const back = dir === 3; // vu de dos : on ne voit que les cheveux
  const side = dir === 1 || dir === 2;
  const face = dir === 1 ? -1 : 1; // orientation du regard pour les vues de profil

  // membres d'abord : ils passent SOUS le corps
  const limb = (lx: number, ly: number): void => inkDisc(ctx, lx, ly, 2, PALETTE.skin);
  if (side) {
    // profil : bras avant / arrière décalés en profondeur, jambes de même
    limb(cx + face * 4, cy - 3 + ph * 2);
    limb(cx + face * 3, cy + 4 - ph * 2);
    limb(cx - face * 4, cy - 2 - ph * 2);
    limb(cx - face * 5, cy + 4 + ph * 2);
  } else {
    const sgn = dir === 3 ? -1 : 1; // de dos, les bras sont vers le haut de l'image
    limb(cx - 6, cy + sgn * (1 - ph * 2));
    limb(cx + 6, cy + sgn * (1 + ph * 2));
    limb(cx - 5, cy + sgn * (6 + ph * 2));
    limb(cx + 5, cy + sgn * (6 - ph * 2));
  }

  // corps (pyjama), légèrement écrasé : vue de dessus
  const bodyY = side ? cy + 2 : cy + (dir === 3 ? -1 : 3);
  inkEllipse(ctx, cx, bodyY, side ? 7 : 6, side ? 5 : 5, PALETTE.onesie);
  pxEllipse(ctx, cx, bodyY + 2, side ? 5 : 4, 2, PALETTE.onesieShade);

  // tête : grosse, c'est un bébé — l'essentiel de la silhouette
  const headY = side ? cy - 4 : cy + (dir === 3 ? -6 : -4);
  inkDisc(ctx, cx, headY, 6, back ? PALETTE.hair : PALETTE.skin);
  if (!back) {
    // frange
    pxEllipse(ctx, cx, headY - 4, 6, 2, PALETTE.hair);
    if (side) {
      pxRect(ctx, cx + face * 2, headY - 1, 2, 2, PALETTE.ink); // œil unique de profil
      pxRect(ctx, cx + face * 5, headY + 1, 1, 1, PALETTE.skinShade); // pointe du nez
    } else {
      pxRect(ctx, cx - 3, headY - 1, 2, 2, PALETTE.ink);
      pxRect(ctx, cx + 2, headY - 1, 2, 2, PALETTE.ink);
      pxRect(ctx, cx - 1, headY + 3, 3, 1, PALETTE.skinShade); // bouche
      // joues : ce qui rend la tête « bébé » et pas « boule »
      pxRect(ctx, cx - 6, headY + 1, 1, 2, PALETTE.skinShade);
      pxRect(ctx, cx + 5, headY + 1, 1, 2, PALETTE.skinShade);
    }
  } else {
    pxEllipse(ctx, cx, headY + 3, 4, 2, PALETTE.skinShade); // nuque
    pxRect(ctx, cx - 1, headY - 5, 3, 2, PALETTE.hair); // épi
  }
}

/** Mamie bisous : ronde, voûtée, bras tendus vers l'avant. `ph` alterne les bras. */
function drawGranny(ctx: CanvasRenderingContext2D, ox: number, oy: number, ph: number): void {
  const cx = ox + 16;
  const cy = oy + 17;
  // bras tendus : la silhouette qui dit « je vais t'attraper »
  inkEllipse(ctx, cx - 9, cy + 2 + ph * 2, 3, 2, PALETTE.grannyCardigan);
  inkEllipse(ctx, cx + 9, cy + 2 - ph * 2, 3, 2, PALETTE.grannyCardigan);
  inkDisc(ctx, cx - 11, cy + 3 + ph * 2, 2, PALETTE.skin);
  inkDisc(ctx, cx + 11, cy + 3 - ph * 2, 2, PALETTE.skin);
  // jupe puis cardigan
  inkEllipse(ctx, cx, cy + 7, 8, 5, PALETTE.grannySkirt);
  inkEllipse(ctx, cx, cy + 1, 7, 6, PALETTE.grannyCardigan);
  pxRect(ctx, cx - 1, cy - 4, 2, 9, PALETTE.grannySkirt); // boutonnière
  // tête + chignon
  inkDisc(ctx, cx, cy - 7, 6, PALETTE.skin);
  pxEllipse(ctx, cx, cy - 11, 6, 3, PALETTE.grannyHair);
  pxDisc(ctx, cx, cy - 13, 3, PALETTE.grannyHair);
  pxRect(ctx, cx - 3, cy - 7, 2, 2, PALETTE.ink);
  pxRect(ctx, cx + 2, cy - 7, 2, 2, PALETTE.ink);
  // lunettes : le trait qui la rend reconnaissable en un pixel
  pxRect(ctx, cx - 4, cy - 8, 8, 1, PALETTE.stoneLight);
  // bouche en cœur du bisou, qui s'ouvre selon la phase
  pxEllipse(ctx, cx, cy - 3, 2, ph > 0 ? 2 : 1, PALETTE.bossTrim);
}

/** Couche sale : basse, large, tachée. Elle roule — `ph` la fait tanguer. */
function drawNappy(ctx: CanvasRenderingContext2D, ox: number, oy: number, ph: number): void {
  const cx = ox + 13;
  const cy = oy + 12;
  inkEllipse(ctx, cx, cy + ph, 9, 6, PALETTE.nappy);
  // taches : la lecture « sale », pas juste « beige »
  pxDisc(ctx, cx - 3, cy + 1 + ph, 3, PALETTE.nappyStain);
  pxDisc(ctx, cx + 4, cy - 1 + ph, 2, PALETTE.nappyStain);
  // épingles : deux points clairs qui accrochent l'œil
  pxRect(ctx, cx - 8, cy - 2 + ph, 2, 2, PALETTE.stoneLight);
  pxRect(ctx, cx + 7, cy - 2 + ph, 2, 2, PALETTE.stoneLight);
  // vapeur : 2 px qui montent en alternance de phase
  pxRect(ctx, cx - 2, cy - 8 - ph, 1, 2, PALETTE.nappyStain);
  pxRect(ctx, cx + 2, cy - 9 + ph, 1, 2, PALETTE.nappyStain);
}

/** Brocoli : haut et étroit, touffe sombre sur pied pâle. `ph` fait vibrer la touffe. */
function drawBroccoli(ctx: CanvasRenderingContext2D, ox: number, oy: number, ph: number): void {
  const cx = ox + 13;
  const cy = oy + 18;
  // pied : c'est LUI qui le sépare du gazon (vert sur vert, sinon illisible)
  inkEllipse(ctx, cx, cy + 8, 4, 5, PALETTE.broccoliStalk);
  pxRect(ctx, cx - 3, cy + 6, 1, 5, PALETTE.stone);
  // petites racines-pattes
  inkDisc(ctx, cx - 4, cy + 12 + ph, 2, PALETTE.broccoliStalk);
  inkDisc(ctx, cx + 4, cy + 12 - ph, 2, PALETTE.broccoliStalk);
  // touffe en lobes : la silhouette « bouquet »
  inkEllipse(ctx, cx, cy - 2, 9, 7, PALETTE.broccoliTop);
  for (const [lx, ly, lr] of [
    [-5, -5, 3],
    [0, -8, 4],
    [5, -5, 3],
    [-7, -1, 3],
    [7, -1, 3],
  ] as const) {
    pxDisc(ctx, cx + lx, cy + ly + (ph > 0 ? -1 : 0), lr, PALETTE.broccoliTopLight);
  }
  pxRect(ctx, cx - 3, cy - 3, 2, 2, PALETTE.ink);
  pxRect(ctx, cx + 2, cy - 3, 2, 2, PALETTE.ink);
}

/** Sac à poussière : petite boule floconneuse recrachée par le boss. */
function drawDust(ctx: CanvasRenderingContext2D, ox: number, oy: number, ph: number): void {
  const cx = ox + 11;
  const cy = oy + 11;
  inkDisc(ctx, cx, cy, 6, PALETTE.dust);
  for (const [lx, ly] of [
    [-4, -3],
    [3, -4],
    [4, 3],
    [-3, 4],
  ] as const) {
    pxDisc(ctx, cx + lx, cy + ly + ph, 2, PALETTE.dustLight);
  }
  pxRect(ctx, cx - 2, cy - 1, 1, 1, PALETTE.ink);
  pxRect(ctx, cx + 1, cy - 1, 1, 1, PALETTE.ink);
}

/**
 * Berceau, trois états d'usure. `wear` 0 = neuf, 2 = au bord de la rupture : les
 * barreaux cassent et la couverture glisse. L'état se lit donc SANS la barre de PV.
 */
function drawCrib(ctx: CanvasRenderingContext2D, ox: number, oy: number, wear: number): void {
  const cx = ox + 38;
  const cy = oy + 30;
  // ombre au sol puis caisse
  pxEllipse(ctx, cx, cy + 20, 28, 7, PALETTE.grassDark);
  inkRect(ctx, cx - 26, cy - 6, 52, 24, PALETTE.wood);
  pxRect(ctx, cx - 24, cy + 10, 48, 6, PALETTE.woodDark);
  // matelas + couverture (glisse d'un cran par palier d'usure)
  const slip = wear * 4;
  inkEllipse(ctx, cx + slip, cy - 4, 22, 7, PALETTE.blanket);
  pxEllipse(ctx, cx + slip, cy - 2, 18, 4, PALETTE.blanketDark);
  // barreaux : on en casse un de plus à chaque palier
  for (let i = 0; i < 7; i++) {
    if (wear >= 1 && i === 2) continue;
    if (wear >= 2 && (i === 5 || i === 0)) continue;
    const bx = cx - 22 + i * 7;
    const h = wear >= 2 && i === 4 ? 10 : 18; // barreau brisé à mi-hauteur
    inkRect(ctx, bx, cy - 22, 3, h, PALETTE.wood);
  }
  // main courante (elle tombe au dernier palier)
  if (wear < 2) inkRect(ctx, cx - 26, cy - 25, 52, 4, PALETTE.woodDark);
  else inkRect(ctx, cx - 26, cy - 25, 24, 4, PALETTE.woodDark);
  // mobile au-dessus : le détail « chambre d'enfant »
  if (wear === 0) {
    pxRect(ctx, cx + 20, cy - 30, 1, 6, PALETTE.woodDark);
    pxDisc(ctx, cx + 20, cy - 32, 3, PALETTE.doudou);
  }
}

/**
 * Aspirateur géant. Il regarde vers le HAUT de sa cellule ; le sprite est ensuite
 * pivoté au rendu vers sa direction de marche, comme un char — l'embout et le cône
 * d'aspiration doivent coïncider exactement.
 */
function drawBoss(ctx: CanvasRenderingContext2D, ox: number, oy: number, rage: boolean): void {
  const cx = ox + 42;
  const cy = oy + 46;
  // corps
  inkEllipse(ctx, cx, cy + 6, 24, 20, PALETTE.bossBody);
  pxEllipse(ctx, cx, cy + 14, 20, 9, PALETTE.bossDark);
  // roues
  inkDisc(ctx, cx - 22, cy + 18, 6, PALETTE.bossDark);
  inkDisc(ctx, cx + 22, cy + 18, 6, PALETTE.bossDark);
  // sac transparent + bande rouge
  inkEllipse(ctx, cx, cy + 2, 15, 11, PALETTE.bossGlass);
  pxRect(ctx, cx - 24, cy - 2, 48, 3, PALETTE.bossTrim);
  // tuyau puis embout : l'ouverture DOIT être au sommet, le cône en part
  inkRect(ctx, cx - 5, cy - 26, 10, 20, PALETTE.bossDark);
  inkEllipse(ctx, cx, cy - 30, rage ? 17 : 13, 8, PALETTE.bossDark);
  pxEllipse(ctx, cx, cy - 30, rage ? 13 : 9, 5, PALETTE.ink);
  // deux yeux dans le sac : il faut qu'il ait l'air vivant
  pxRect(ctx, cx - 6, cy, 3, 3, PALETTE.ink);
  pxRect(ctx, cx + 3, cy, 3, 3, PALETTE.ink);
  if (rage) {
    // sourcils tombants + halo de rage sur l'embout
    pxRect(ctx, cx - 8, cy - 3, 5, 2, PALETTE.bossTrim);
    pxRect(ctx, cx + 3, cy - 3, 5, 2, PALETTE.bossTrim);
    pxEllipse(ctx, cx, cy - 36, 8, 3, PALETTE.bossTrim);
  }
}

// ---------------------------------------------------------------- ramassables

function drawBottle(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  const cx = ox + 11;
  const cy = oy + 11;
  inkRect(ctx, cx - 5, cy - 3, 10, 12, PALETTE.bottle);
  pxRect(ctx, cx - 3, cy + 1, 6, 6, PALETTE.bottleTeat);
  inkRect(ctx, cx - 3, cy - 8, 6, 5, PALETTE.bottleTeat);
  pxRect(ctx, cx - 1, cy - 10, 2, 2, PALETTE.bottleTeat);
}

function drawBlanket(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  const cx = ox + 11;
  const cy = oy + 11;
  inkDisc(ctx, cx, cy + 1, 7, PALETTE.doudou);
  // oreilles + museau : un doudou lapin se reconnaît à sa silhouette
  inkDisc(ctx, cx - 4, cy - 7, 3, PALETTE.doudou);
  inkDisc(ctx, cx + 4, cy - 7, 3, PALETTE.doudou);
  pxRect(ctx, cx - 3, cy - 1, 2, 2, PALETTE.ink);
  pxRect(ctx, cx + 2, cy - 1, 2, 2, PALETTE.ink);
  pxRect(ctx, cx - 1, cy + 3, 3, 2, PALETTE.pacifier);
}

function drawPacifier(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  const cx = ox + 11;
  const cy = oy + 11;
  inkDisc(ctx, cx, cy + 2, 7, PALETTE.pacifier);
  pxDisc(ctx, cx, cy + 2, 3, PALETTE.bottle);
  inkRect(ctx, cx - 2, cy - 9, 4, 6, PALETTE.bottle);
  pxRect(ctx, cx - 4, cy - 10, 8, 2, PALETTE.bottleTeat);
}

// --------------------------------------------------------------------- décor

/**
 * Sol du jardin : treillis de gazon tuilable. Tuile HAUTE (256) pour casser la
 * répétition, mouchetage déterministe (`mulberry32`) — jamais `Math.random` dans
 * une texture, sinon le décor change à chaque rechargement.
 */
function buildGround(): HTMLCanvasElement {
  const size = 256;
  const ctx = ctx2d(size, size);
  pxRect(ctx, 0, 0, size, size, PALETTE.grass);
  const rand = mulberry32(0x6a5d);
  // bandes de tonte : le motif qui donne « pelouse » plutôt qu'« aplat vert ». Le
  // contraste doit rester À PEINE perceptible — au premier essai (grassDark) le sol
  // devenait un velours côtelé qui criait plus fort que les entités.
  for (let y = 0; y < size; y += 16) {
    pxRect(ctx, 0, y, size, 8, PALETTE.grassStripe);
  }
  // brins : 3 px verticaux, deux valeurs, densité forte mais alpha porté par la couleur
  for (let k = 0; k < 1400; k++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const c = rand() < 0.55 ? PALETTE.grassLight : PALETTE.grassPale;
    pxRect(ctx, x, y, 1, 1 + Math.floor(rand() * 2), c);
  }
  // quelques cailloux, très épars : des points d'accroche pour l'œil en mouvement
  for (let k = 0; k < 22; k++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    pxDisc(ctx, x, y, 1 + Math.floor(rand() * 2), PALETTE.stone);
  }
  return ctx.canvas;
}

/**
 * Planche de props du jardin, packée en étagères. Le décor est 100 % NON
 * INTERACTIF et n'utilise JAMAIS les codes réservés aux dangers (pas de hachures
 * jaune/noir, pas d'anneaux, pas d'aplats blancs) — invariant partagé avec les
 * trois autres jeux.
 */
function buildProps(): DecorProp[] {
  const W = 256;
  const ctx = ctx2d(W, 320);
  const source = Texture.from(ctx.canvas).source;
  source.scaleMode = 'nearest';
  const out: DecorProp[] = [];
  let shelfX = 0;
  let shelfY = 0;
  let shelfH = 0;

  const prop = (w: number, h: number, sway: number, weight: number, draw: (x: number, y: number) => void): void => {
    if (shelfX + w + 2 > W) {
      shelfX = 0;
      shelfY += shelfH + 2;
      shelfH = 0;
    }
    draw(shelfX, shelfY);
    out.push({ tex: new Texture({ source, frame: new Rectangle(shelfX, shelfY, w, h) }), sway, weight });
    shelfX += w + 2;
    shelfH = Math.max(shelfH, h);
  };

  // buisson
  prop(40, 34, 0.05, 1, (x, y) => {
    inkEllipse(ctx, x + 20, y + 24, 17, 10, PALETTE.grassDark);
    for (const [lx, ly, lr] of [
      [-9, -4, 7],
      [0, -9, 9],
      [9, -3, 7],
    ] as const) {
      pxDisc(ctx, x + 20 + lx, y + 22 + ly, lr, PALETTE.grassLight);
    }
    pxDisc(ctx, x + 15, y + 12, 4, PALETTE.grassPale);
  });

  // petit arbre
  prop(46, 58, 0.035, 0.7, (x, y) => {
    inkRect(ctx, x + 21, y + 32, 5, 22, PALETTE.woodDark);
    inkEllipse(ctx, x + 23, y + 24, 20, 16, PALETTE.grassDark);
    for (const [lx, ly, lr] of [
      [-10, -4, 8],
      [2, -10, 10],
      [11, -2, 8],
      [-3, 4, 8],
    ] as const) {
      pxDisc(ctx, x + 23 + lx, y + 22 + ly, lr, PALETTE.grassLight);
    }
    pxDisc(ctx, x + 16, y + 12, 5, PALETTE.grassPale);
  });

  // touffe d'herbes hautes
  prop(26, 30, 0.11, 1.4, (x, y) => {
    for (let i = 0; i < 9; i++) {
      const bx = x + 4 + i * 2;
      const bh = 12 + ((i * 7) % 13);
      pxRect(ctx, bx, y + 28 - bh, 2, bh, i % 2 ? PALETTE.grassLight : PALETTE.grassPale);
    }
    pxEllipse(ctx, x + 13, y + 28, 10, 3, PALETTE.grassDark);
  });

  // pissenlits
  prop(22, 20, 0.13, 1.1, (x, y) => {
    pxEllipse(ctx, x + 11, y + 17, 8, 3, PALETTE.grassDark);
    for (const [fx, fy] of [
      [-5, -6],
      [3, -9],
      [6, -3],
    ] as const) {
      pxRect(ctx, x + 11 + fx, y + 16 + fy, 1, 6 + fy * -1, PALETTE.grassPale);
      inkDisc(ctx, x + 11 + fx, y + 15 + fy, 2, PALETTE.bottle);
    }
  });

  // rocher
  prop(30, 22, 0, 0.6, (x, y) => {
    inkEllipse(ctx, x + 15, y + 14, 13, 7, PALETTE.stone);
    pxEllipse(ctx, x + 12, y + 11, 8, 4, PALETTE.stoneLight);
  });

  // dalle de terre battue. Sombre exprès : en tons clairs elle se lisait comme une
  // FLAQUE, or une flaque englue. Le décor ne doit jamais imiter un danger.
  prop(38, 20, 0, 0.5, (x, y) => {
    pxEllipse(ctx, x + 19, y + 11, 17, 8, PALETTE.earth);
    pxEllipse(ctx, x + 16, y + 10, 11, 5, PALETTE.earthLight);
  });

  // cube de bois (jouet oublié) — rappelle le thème sans être interactif
  prop(20, 20, 0, 0.4, (x, y) => {
    inkRect(ctx, x + 4, y + 6, 12, 11, PALETTE.wood);
    pxRect(ctx, x + 6, y + 8, 4, 4, PALETTE.bottle);
    pxRect(ctx, x + 11, y + 12, 3, 3, PALETTE.blanket);
  });

  // la planche a été dessinée APRÈS la capture de la source : il faut invalider
  // explicitement, sinon on dépend de l'ordre d'upload de Pixi
  source.update();
  return out;
}

// -------------------------------------------------------------- construction

export function buildAtlas(): Atlas {
  const groundCv = buildGround();
  const groundTex = Texture.from(groundCv);
  groundTex.source.scaleMode = 'nearest';

  // — atlas principal : tout ce qui alimente un ParticleContainer vit ici
  const AW = 384;
  const AH = 352;
  const ctx = ctx2d(AW, AH);
  const source = Texture.from(ctx.canvas).source;
  // `nearest` : sans ça Pixi échantillonne en linéaire et le moindre squash/stretch
  // de rendu (respiration, flip, pop) rend les sprites flous — l'exact contraire du
  // pixel art net qu'on plotte au pixel entier juste au-dessus.
  source.scaleMode = 'nearest';
  const frame = (x: number, y: number, w: number, h: number): Texture =>
    new Texture({ source, frame: new Rectangle(x, y, w, h) });

  // bébé : 4 directions × 3 frames (phase -1, 0, +1)
  const hero: Texture[][] = [];
  for (let dir = 0; dir < 4; dir++) {
    const row: Texture[] = [];
    for (let f = 0; f < 3; f++) {
      const x = f * HERO_CELL_W;
      const y = dir * HERO_CELL_H;
      drawHero(ctx, x, y, dir, f - 1);
      row.push(frame(x, y, HERO_CELL_W, HERO_CELL_H));
    }
    hero.push(row);
  }

  // ennemis : 2 frames chacun. Vue 3/4 + flip X au rendu selon le signe de vx —
  // 4 directions dessinées par archétype serait hors budget d'un niveau de test.
  const EX = 70;
  drawGranny(ctx, EX, 0, -1);
  drawGranny(ctx, EX + 34, 0, 1);
  drawNappy(ctx, EX, 36, -1);
  drawNappy(ctx, EX + 28, 36, 1);
  drawBroccoli(ctx, EX, 62, -1);
  drawBroccoli(ctx, EX + 28, 62, 1);
  drawDust(ctx, EX, 104, -1);
  drawDust(ctx, EX + 24, 104, 1);
  const enemyByKind = [
    frame(EX, 0, 32, 34),
    frame(EX, 36, 26, 24),
    frame(EX, 62, 26, 40),
    frame(EX, 104, 22, 22),
  ];
  const enemyAlt = [
    frame(EX + 34, 0, 32, 34),
    frame(EX + 28, 36, 26, 24),
    frame(EX + 28, 62, 26, 40),
    frame(EX + 24, 104, 22, 22),
  ];

  // — petits objets
  const OX = 140;
  // cube-hochet : le projectile du bébé, lisible même à 12 px
  inkRect(ctx, OX + 2, 2, 10, 10, PALETTE.toy);
  pxRect(ctx, OX + 4, 4, 3, 3, PALETTE.toyEdge);
  pxRect(ctx, OX + 8, 8, 3, 3, PALETTE.pea);
  const toy = frame(OX, 0, 14, 14);

  inkDisc(ctx, OX + 20, 6, 4, PALETTE.pea);
  pxDisc(ctx, OX + 19, 5, 2, PALETTE.broccoliTopLight);
  const pea = frame(OX + 14, 0, 12, 12);

  pxDisc(ctx, OX + 32, 5, 3, PALETTE.hud);
  const spark = frame(OX + 28, 0, 10, 10);

  // ombre portée : c'est elle qui vend le top-down, à un draw call pour tous
  pxEllipse(ctx, OX + 54, 6, 12, 5, PALETTE.grassDark);
  const shadow = frame(OX + 40, 0, 28, 12);

  drawBottle(ctx, OX, 16);
  drawBlanket(ctx, OX + 24, 16);
  drawPacifier(ctx, OX + 48, 16);
  const pickups = [frame(OX, 16, 22, 22), frame(OX + 24, 16, 22, 22), frame(OX + 48, 16, 22, 22)];

  // flèche de boussole (pointe vers le HAUT, pivotée au rendu)
  const CX = OX + 76;
  for (let i = 0; i < 9; i++) pxRect(ctx, CX + 10 - i, 3 + i, i * 2 + 1, 1, PALETTE.ink);
  for (let i = 1; i < 8; i++) pxRect(ctx, CX + 10 - i, 4 + i, i * 2 - 1, 1, PALETTE.hud);
  const compass = frame(CX, 0, 22, 22);

  // berceau : 3 états d'usure
  const crib: Texture[] = [];
  for (let w = 0; w < 3; w++) {
    drawCrib(ctx, w * 78, 132, w);
    crib.push(frame(w * 78, 132, 78, 62));
  }

  drawBoss(ctx, 0, 200, false);
  drawBoss(ctx, 90, 200, true);
  const boss = frame(0, 200, 84, 92);
  const bossRage = frame(90, 200, 84, 92);

  // pollen : le grain de météo, en espace écran
  pxDisc(ctx, 200, 300, 2, PALETTE.bottle);
  const pollen = frame(196, 296, 9, 9);

  source.update();

  return {
    hero,
    enemyByKind,
    enemyAlt,
    toy,
    pea,
    spark,
    shadow,
    pickups,
    crib,
    boss,
    bossRage,
    compass,
    // marqueurs : sources DÉDIÉES supersamplées, jamais une frame d'atlas étirée
    puddleRing: makeRingTexture(B.ENEMY_KINDS[B.KIND_NAPPY].puddle, true, PALETTE.warn),
    puddleBody: makePuddleBody(B.ENEMY_KINDS[B.KIND_NAPPY].puddle),
    // PLEIN et fin, là où les zones de danger sont POINTILLÉES : le pointillé reste
    // réservé aux menaces. En pointillé épais, cet anneau se lisait comme des
    // brindilles éparpillées au sol plutôt que comme une portée de tir.
    rangeRing: makeRingTexture(B.HERO_RANGE, false, PALETTE.blanket, 2),
    ground: groundTex,
    groundCanvas: groundCv,
    props: buildProps(),
    pollen,
  };
}
