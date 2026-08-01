import { Rectangle, Texture } from 'pixi.js';
import { EMPTY_PEG_DEF, PEGS } from '../config/pegs';
import type { PegDef, PegGlyph, PegShape } from '../config/pegs';

// Toutes les textures sont GÉNÉRÉES en canvas, dessinées à leur taille
// d'affichage réelle ×2 puis affichées à 0.5 (leçon horde : jamais une petite
// frame étirée). Le rendu « pixel art » vient du STYLE de tracé — polygones à
// arêtes franches, aplats sans dégradé, liserés de 2 px device (= 1 px logique),
// ombres et reflets en marches d'escalier — et non d'un scaleMode `nearest` :
// le letterbox impose une échelle fractionnaire, où `nearest` scintillerait.
//
// ACCESSIBILITÉ (WCAG 1.4.1 / 1.4.11) : la valeur d'un pion se lit à la FORME et
// au GLYPHE autant qu'à la teinte (table dans config/pegs.ts) ; les marqueurs
// d'indice opposent un LOSANGE PLEIN à un ANNEAU CREUX — le noir/blanc classique
// du Mastermind est une différence de couleur seule, donc non conforme. Chaque
// forme porte un liseré sombre intégré : elle tient sur fond clair comme sombre.

export const PALETTE = {
  bg: 0x1a1030, // violet nuit — aussi le theme-color de la page
  boardBg: 0x241945,
  boardEdge: 0x4c327f,
  socket: 0x150c26,
  socketEdge: 0x3a2764,
  accent: 0xffd23f, // jaune : titres, cadre actif, « bien placé »
  accentDark: 0x8a6400,
  cool: 0x4cc9f0, // bleu : « mal placé »
  coolDark: 0x0b6a86,
  text: 0xffffff,
  textDim: 0xc9bce8,
  win: 0x7ef29a,
  lose: 0xff6b8a,
  outline: 0x0a0416,
} as const;

/** Groupes d'animation du chat — index de `Atlas.catFrames`. */
export const CAT_ANIM = { walk: 0, sit: 1, sleep: 2, paw: 3, run: 4 } as const;

export interface Atlas {
  /** `pegFrames[0..7]` = couleurs, `pegFrames[8]` = pion vide (difficile). */
  pegFrames: readonly Texture[];
  /** Emplacement pas encore rempli : socle creux à liseré pointillé. */
  socket: Texture;
  /** Case du code secret tant qu'il est caché. */
  masked: Texture;
  markExact: Texture;
  markMisplaced: Texture;
  /** Emplacement de marqueur sans indice (creux discret). */
  markBlank: Texture;
  /** Disque blanc à teinter — particules. */
  spark: Texture;
  /** Rectangle blanc à teinter — confettis. */
  confetti: Texture;
  /** Faisceau blanc à teinter — rayons de victoire. */
  ray: Texture;
  /** Tuile de fond raccordable. */
  ground: Texture;
  /** `catFrames[CAT_ANIM.x][frame]`, toutes issues de la même source canvas. */
  catFrames: readonly (readonly Texture[])[];
}

const S = 2; // supersampling

/** Taille de cellule d'un pion, en pixels logiques. */
export const PEG_CELL = 48;
/** Taille de cellule d'un marqueur, en pixels logiques. */
export const MARK_CELL = 16;
/** Cellule du chat, en pixels logiques (le chat regarde à DROITE par défaut). */
export const CAT_CELL_W = 44;
export const CAT_CELL_H = 34;

function ctx2d(w: number, h: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('canvas 2d indisponible');
  return c;
}

// Les consommateurs affichent ces textures à 1/S de leur taille.
function toTexture(c: CanvasRenderingContext2D): Texture {
  const tex = Texture.from(c.canvas);
  tex.source.scaleMode = 'linear';
  return tex;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * Luminance perçue (0-1), formule WCAG. Sert à choisir l'ENCRE d'un glyphe : un
 * glyphe blanc sur un corps clair (le pion blanc, le pion vide) disparaîtrait.
 */
function luminance(color: number): number {
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const r = lin(((color >> 16) & 0xff) / 255);
  const g = lin(((color >> 8) & 0xff) / 255);
  const b = lin((color & 0xff) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgba(color: number, alpha: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

// ───────────────────────────────────────────────────────── formes des pions

/**
 * Trace le contour d'un pion, sans remplir ni tracer : l'appelant décide.
 * Toutes les formes tiennent dans le cercle de rayon `r` et sont centrées —
 * elles restent donc interchangeables dans un emplacement.
 */
function tracePegShape(c: CanvasRenderingContext2D, shape: PegShape, cx: number, cy: number, r: number): void {
  c.beginPath();
  switch (shape) {
    case 'disc':
      c.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    case 'hex':
      polygon(c, cx, cy, r, 6, 0);
      break;
    case 'diamond':
      polygon(c, cx, cy, r, 4, -Math.PI / 2);
      break;
    case 'square': {
      const s = r * 0.84;
      c.rect(cx - s, cy - s, s * 2, s * 2);
      break;
    }
    case 'triangle':
      polygon(c, cx, cy + r * 0.16, r * 1.1, 3, -Math.PI / 2);
      break;
    case 'drop':
      // goutte : pointe en haut, ventre en bas — silhouette très typée
      c.moveTo(cx, cy - r);
      c.quadraticCurveTo(cx + r * 0.95, cy - r * 0.1, cx + r * 0.72, cy + r * 0.45);
      c.quadraticCurveTo(cx + r * 0.4, cy + r, cx, cy + r);
      c.quadraticCurveTo(cx - r * 0.4, cy + r, cx - r * 0.72, cy + r * 0.45);
      c.quadraticCurveTo(cx - r * 0.95, cy - r * 0.1, cx, cy - r);
      break;
    case 'octagon':
      polygon(c, cx, cy, r, 8, Math.PI / 8);
      break;
    case 'pentagon':
      polygon(c, cx, cy, r, 5, -Math.PI / 2);
      break;
  }
  c.closePath();
}

function polygon(
  c: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rot: number,
): void {
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
}

// ───────────────────────────────────────────────────────── glyphes

/**
 * Glyphe surimprimé au corps du pion, à liseré contrasté. `onLight` inverse
 * l'encre : sur un corps clair, un glyphe blanc serait invisible — la teinte du
 * pion décide donc de son encre, elle n'est jamais codée à la main.
 */
function drawPegGlyph(
  c: CanvasRenderingContext2D,
  glyph: PegGlyph,
  cx: number,
  cy: number,
  s: number,
  onLight: boolean,
): void {
  c.save();
  c.translate(cx, cy);
  c.fillStyle = onLight ? hex(PALETTE.outline) : '#ffffff';
  c.strokeStyle = onLight ? 'rgba(255,255,255,0.55)' : rgba(PALETTE.outline, 0.9);
  c.lineWidth = Math.max(2, s * 0.16);
  c.lineJoin = 'miter';

  const stroked = (): void => {
    c.fill();
    c.stroke();
  };

  switch (glyph) {
    case 'dot':
      c.beginPath();
      c.arc(0, 0, s * 0.42, 0, Math.PI * 2);
      stroked();
      break;
    case 'up':
      c.beginPath();
      polygon(c, 0, s * 0.08, s * 0.56, 3, -Math.PI / 2);
      c.closePath();
      stroked();
      break;
    case 'rhombus':
      c.beginPath();
      polygon(c, 0, 0, s * 0.52, 4, -Math.PI / 2);
      c.closePath();
      stroked();
      break;
    case 'bar':
      c.beginPath();
      c.rect(-s * 0.6, -s * 0.19, s * 1.2, s * 0.38);
      stroked();
      break;
    case 'cross':
      c.beginPath();
      c.rect(-s * 0.62, -s * 0.19, s * 1.24, s * 0.38);
      c.rect(-s * 0.19, -s * 0.62, s * 0.38, s * 1.24);
      stroked();
      break;
    case 'star': {
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 === 0 ? s * 0.62 : s * 0.27;
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.closePath();
      stroked();
      break;
    }
    case 'ring':
      // anneau : tracé en deux cercles de sens opposés pour évider le centre
      c.beginPath();
      c.arc(0, 0, s * 0.52, 0, Math.PI * 2);
      c.arc(0, 0, s * 0.26, 0, Math.PI * 2, true);
      stroked();
      break;
    case 'stripes':
      c.beginPath();
      for (let i = -1; i <= 1; i++) c.rect(-s * 0.58, i * s * 0.32 - s * 0.09, s * 1.16, s * 0.18);
      stroked();
      break;
    case 'slash':
      // ⊘ : anneau évidé barré d'une diagonale — la marque du « rien »
      c.beginPath();
      c.arc(0, 0, s * 0.56, 0, Math.PI * 2);
      c.arc(0, 0, s * 0.34, 0, Math.PI * 2, true);
      stroked();
      c.save();
      c.rotate(-Math.PI / 4);
      c.beginPath();
      c.rect(-s * 0.66, -s * 0.1, s * 1.32, s * 0.2);
      stroked();
      c.restore();
      break;
  }
  c.restore();
}

// ───────────────────────────────────────────────────────── pions

/**
 * Corps d'un pion dans une cellule `PEG_CELL`. Le volume est posé en MARCHES
 * (un reflet en haut-gauche, une ombre en bas-droite), jamais en dégradé : c'est
 * ce qui donne la lecture « pixel art » tout en restant net à l'échelle.
 */
function drawPeg(c: CanvasRenderingContext2D, def: PegDef, x0: number): void {
  const cell = PEG_CELL * S;
  const cx = x0 + cell / 2;
  const cy = cell / 2;
  const r = 21 * S;

  c.save();
  // ombre portée au sol, discrète : ancre le pion dans son socle
  c.fillStyle = rgba(PALETTE.outline, 0.45);
  c.beginPath();
  c.ellipse(cx, cy + r * 0.86, r * 0.72, r * 0.22, 0, 0, Math.PI * 2);
  c.fill();

  // corps
  tracePegShape(c, def.shape, cx, cy, r);
  c.fillStyle = hex(def.color);
  c.fill();

  // ombre interne : moitié basse-droite, écrêtée par la forme
  c.save();
  tracePegShape(c, def.shape, cx, cy, r);
  c.clip();
  c.fillStyle = rgba(def.dark, 0.85);
  c.beginPath();
  c.moveTo(cx - r, cy + r * 0.34);
  c.lineTo(cx + r, cy - r * 0.1);
  c.lineTo(cx + r, cy + r);
  c.lineTo(cx - r, cy + r);
  c.closePath();
  c.fill();
  // reflet en marches, en haut-gauche
  c.fillStyle = rgba(0xffffff, 0.4);
  c.fillRect(cx - r * 0.66, cy - r * 0.66, r * 0.4, r * 0.16);
  c.fillRect(cx - r * 0.66, cy - r * 0.5, r * 0.22, r * 0.16);
  c.restore();

  // liseré sombre intégré : la forme tient sur n'importe quel fond (WCAG 1.4.11)
  tracePegShape(c, def.shape, cx, cy, r);
  c.strokeStyle = hex(PALETTE.outline);
  c.lineWidth = 2 * S;
  c.lineJoin = 'miter';
  c.stroke();

  // seuil 0.42 : au-delà, le corps est trop clair pour un glyphe blanc
  drawPegGlyph(c, def.glyph, cx, cy, r * 0.62, luminance(def.color) > 0.42);
  c.restore();
}

/** Emplacement vide : creux à liseré POINTILLÉ — distinct du pion vide plein. */
function drawSocket(c: CanvasRenderingContext2D, x0: number): void {
  const cell = PEG_CELL * S;
  const cx = x0 + cell / 2;
  const cy = cell / 2;
  const r = 19 * S;
  c.save();
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = hex(PALETTE.socket);
  c.fill();
  // creux : un liseré clair en bas, sombre en haut (lumière venant du haut)
  c.beginPath();
  c.arc(cx, cy, r, Math.PI * 0.1, Math.PI * 0.9);
  c.strokeStyle = rgba(PALETTE.socketEdge, 0.9);
  c.lineWidth = 2 * S;
  c.stroke();
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.setLineDash([5 * S, 4 * S]);
  c.strokeStyle = rgba(PALETTE.boardEdge, 0.95);
  c.lineWidth = 2 * S;
  c.stroke();
  c.restore();
}

/** Case du code secret, couverte : un « ? » sur un couvercle violet. */
function drawMasked(c: CanvasRenderingContext2D, x0: number): void {
  const cell = PEG_CELL * S;
  const cx = x0 + cell / 2;
  const cy = cell / 2;
  const r = 21 * S;
  c.save();
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = hex(PALETTE.boardEdge);
  c.fill();
  c.strokeStyle = hex(PALETTE.outline);
  c.lineWidth = 2 * S;
  c.stroke();
  c.fillStyle = hex(PALETTE.accent);
  c.font = `900 ${Math.round(r * 1.35)}px system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('?', cx, cy + r * 0.06);
  c.restore();
}

// ───────────────────────────────────────────────────────── marqueurs d'indice

function drawMarkExact(c: CanvasRenderingContext2D, x0: number): void {
  const cell = MARK_CELL * S;
  const cx = x0 + cell / 2;
  const cy = cell / 2;
  const r = 6.5 * S;
  c.save();
  // LOSANGE PLEIN : la forme porte l'information autant que le jaune
  c.beginPath();
  polygon(c, cx, cy, r, 4, -Math.PI / 2);
  c.closePath();
  c.fillStyle = hex(PALETTE.accent);
  c.fill();
  c.strokeStyle = hex(PALETTE.outline);
  c.lineWidth = 1.5 * S;
  c.lineJoin = 'miter';
  c.stroke();
  c.restore();
}

function drawMarkMisplaced(c: CanvasRenderingContext2D, x0: number): void {
  const cell = MARK_CELL * S;
  const cx = x0 + cell / 2;
  const cy = cell / 2;
  const r = 6 * S;
  c.save();
  // ANNEAU CREUX : franchement différent du losange, même en niveaux de gris
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.strokeStyle = hex(PALETTE.outline);
  c.lineWidth = 3.4 * S;
  c.stroke();
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.strokeStyle = hex(PALETTE.cool);
  c.lineWidth = 2 * S;
  c.stroke();
  c.restore();
}

function drawMarkBlank(c: CanvasRenderingContext2D, x0: number): void {
  const cell = MARK_CELL * S;
  const cx = x0 + cell / 2;
  const cy = cell / 2;
  c.save();
  c.beginPath();
  c.arc(cx, cy, 2.2 * S, 0, Math.PI * 2);
  c.fillStyle = rgba(PALETTE.socket, 0.9);
  c.fill();
  c.restore();
}

// ───────────────────────────────────────────────────────── particules

/**
 * Étincelle et confetti dans UNE source : le pool de particules peut alterner les
 * deux formes en changeant l'uv, et tout reste sur un seul draw call. Les tailles
 * diffèrent, d'où les deux `Rectangle` explicites.
 */
function makeFxSheet(): { spark: Texture; confetti: Texture } {
  const sparkS = 16 * S;
  const confW = 8 * S;
  const confH = 12 * S;
  const c = ctx2d(sparkS + confW, sparkS);

  // étincelle : disque blanc à bord estompé, teinté au runtime
  const g = c.createRadialGradient(sparkS / 2, sparkS / 2, 0, sparkS / 2, sparkS / 2, sparkS / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, sparkS, sparkS);

  // confetti : rectangle blanc, moitié basse assombrie → il « tourne » à l'œil
  c.fillStyle = '#ffffff';
  c.fillRect(sparkS, 0, confW, confH);
  c.fillStyle = 'rgba(0,0,0,0.28)';
  c.fillRect(sparkS, confH * 0.62, confW, confH * 0.38);

  const source = Texture.from(c.canvas).source;
  source.scaleMode = 'linear';
  return {
    spark: new Texture({ source, frame: new Rectangle(0, 0, sparkS, sparkS) }),
    confetti: new Texture({ source, frame: new Rectangle(sparkS, 0, confW, confH) }),
  };
}

/** Faisceau de lumière : opaque au pied, transparent à la pointe. */
function makeRay(): Texture {
  const w = 10 * S;
  const h = 200 * S;
  const c = ctx2d(w, h);
  const g = c.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  // trapèze : s'affine vers la pointe
  c.beginPath();
  c.moveTo(0, h);
  c.lineTo(w, h);
  c.lineTo(w * 0.62, 0);
  c.lineTo(w * 0.38, 0);
  c.closePath();
  c.fill();
  return toTexture(c);
}

/**
 * Tuile de fond raccordable : treillis de losanges violets. Les motifs sont
 * posés à des fractions FIXES de la tuile et dupliqués sur les quatre bords,
 * pour que la répétition soit invisible sans casser le raccord.
 */
function makeGround(): Texture {
  const t = 60 * S;
  const c = ctx2d(t, t);
  c.fillStyle = hex(PALETTE.bg);
  c.fillRect(0, 0, t, t);

  // treillis : deux familles de diagonales, très peu contrastées
  c.strokeStyle = rgba(0x6b4fa8, 0.22);
  c.lineWidth = 1.5 * S;
  for (let i = -1; i <= 1; i++) {
    c.beginPath();
    c.moveTo(i * t, 0);
    c.lineTo(i * t + t, t);
    c.stroke();
    c.beginPath();
    c.moveTo(i * t + t, 0);
    c.lineTo(i * t, t);
    c.stroke();
  }
  // quelques « étoiles » de 2 px aux croisements, pour la texture
  c.fillStyle = rgba(0x9d7bea, 0.3);
  for (const [fx, fy] of [
    [0.5, 0.5],
    [0.0, 0.0],
    [0.25, 0.75],
    [0.75, 0.25],
  ] as const) {
    c.fillRect(Math.round(fx * t) - S, Math.round(fy * t) - S, 2 * S, 2 * S);
  }
  return toTexture(c);
}

// ───────────────────────────────────────────────────────── le chat

const FUR = 0xf6efe2;
const FUR_SHADE = 0xb9a8cf;
const FUR_DARK = 0x6f5f92;
const CAT_EYE = 0xffd23f;

/**
 * Un chat pixel-art crème à ombres violettes — assez clair pour se détacher du
 * plateau, assez froid pour ne pas se confondre avec les pions jaunes (le seul
 * élément jaune du chat est son œil et sa clochette, tous deux minuscules).
 *
 * `legPhase` décale les pattes, `tail` l'angle de la queue : deux paramètres
 * suffisent à tirer un cycle de marche lisible.
 */
function drawCat(
  c: CanvasRenderingContext2D,
  x0: number,
  opts: { legPhase: number; tail: number; crouch?: number; paw?: number; curled?: boolean; eyes?: 'open' | 'shut' | 'wide' },
): void {
  const w = CAT_CELL_W * S;
  const h = CAT_CELL_H * S;
  const u = S * 2; // « pixel » de base du chat : 2 px logiques
  const baseY = h - u * 1.5;
  const crouch = (opts.crouch ?? 0) * u;
  const eyes = opts.eyes ?? 'open';

  c.save();
  c.translate(x0, 0);
  c.lineJoin = 'miter';

  // ombre au sol
  c.fillStyle = rgba(PALETTE.outline, 0.35);
  c.beginPath();
  c.ellipse(w * 0.5, baseY + u * 0.4, w * 0.34, u * 0.8, 0, 0, Math.PI * 2);
  c.fill();

  const outline = (path: () => void, fill: string): void => {
    c.beginPath();
    path();
    c.fillStyle = fill;
    c.fill();
    c.strokeStyle = hex(PALETTE.outline);
    c.lineWidth = 1.6 * S;
    c.stroke();
  };

  if (opts.curled) {
    // chat roulé en boule : un disque, une oreille, la queue en écharpe
    outline(() => c.arc(w * 0.5, baseY - u * 3.4, u * 4.4, 0, Math.PI * 2), hex(FUR));
    c.fillStyle = rgba(FUR_SHADE, 0.75);
    c.beginPath();
    c.arc(w * 0.5, baseY - u * 3.4, u * 4.4, Math.PI * 0.08, Math.PI * 0.92);
    c.fill();
    // queue enroulée
    c.beginPath();
    c.arc(w * 0.5, baseY - u * 3.4, u * 5.2, Math.PI * 0.15, Math.PI * 0.95);
    c.strokeStyle = hex(FUR);
    c.lineWidth = 1.7 * u;
    c.lineCap = 'round';
    c.stroke();
    c.strokeStyle = rgba(PALETTE.outline, 0.55);
    c.lineWidth = 0.5 * u;
    c.stroke();
    // oreilles
    outline(() => {
      c.moveTo(w * 0.5 - u * 3.4, baseY - u * 6);
      c.lineTo(w * 0.5 - u * 2.2, baseY - u * 8);
      c.lineTo(w * 0.5 - u * 1.1, baseY - u * 5.9);
      c.closePath();
    }, hex(FUR));
    // yeux fermés : deux traits
    c.strokeStyle = hex(PALETTE.outline);
    c.lineWidth = 1.4 * S;
    for (const dx of [-1.6, 1.2]) {
      c.beginPath();
      c.moveTo(w * 0.5 + dx * u - u * 0.5, baseY - u * 3.6);
      c.lineTo(w * 0.5 + dx * u + u * 0.5, baseY - u * 3.6);
      c.stroke();
    }
    c.restore();
    return;
  }

  const bodyY = baseY - u * 3.2 + crouch;
  const headX = w * 0.72;
  const headY = bodyY - u * 2.6 - crouch * 0.4;

  // queue
  c.save();
  c.translate(w * 0.24, bodyY - u * 0.6);
  c.rotate(opts.tail);
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(-u * 3.6, -u * 1.6, -u * 4.2, -u * 5);
  c.strokeStyle = hex(FUR);
  c.lineWidth = 1.6 * u;
  c.lineCap = 'round';
  c.stroke();
  c.strokeStyle = rgba(PALETTE.outline, 0.6);
  c.lineWidth = 0.5 * u;
  c.stroke();
  // bout de queue plus sombre
  c.beginPath();
  c.arc(-u * 4.2, -u * 5, u * 0.9, 0, Math.PI * 2);
  c.fillStyle = hex(FUR_SHADE);
  c.fill();
  c.restore();

  // pattes — deux paires décalées par legPhase
  c.strokeStyle = hex(FUR_DARK);
  c.lineWidth = 1.5 * u;
  c.lineCap = 'round';
  for (const [i, dx] of [-2.6, -0.6, 1.6, 3.4].entries()) {
    const swing = Math.sin(opts.legPhase + i * Math.PI * 0.5) * u * 1.1;
    c.beginPath();
    c.moveTo(w * 0.42 + dx * u, bodyY + u * 0.8);
    c.lineTo(w * 0.42 + dx * u + swing, baseY);
    c.stroke();
  }

  // corps
  outline(() => c.ellipse(w * 0.45, bodyY, u * 5.4, u * 3.1, 0, 0, Math.PI * 2), hex(FUR));
  c.save();
  c.beginPath();
  c.ellipse(w * 0.45, bodyY, u * 5.4, u * 3.1, 0, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = rgba(FUR_SHADE, 0.8);
  c.fillRect(w * 0.45 - u * 5.4, bodyY + u * 0.5, u * 11, u * 4);
  // rayures de tabby
  c.fillStyle = rgba(FUR_DARK, 0.35);
  for (let i = 0; i < 3; i++) c.fillRect(w * 0.45 - u * 3 + i * u * 2.2, bodyY - u * 3.2, u * 0.8, u * 2.6);
  c.restore();

  // tête
  outline(() => c.arc(headX, headY, u * 3.2, 0, Math.PI * 2), hex(FUR));
  // oreilles
  outline(() => {
    c.moveTo(headX - u * 2.9, headY - u * 1.7);
    c.lineTo(headX - u * 2.5, headY - u * 4.4);
    c.lineTo(headX - u * 0.6, headY - u * 2.7);
    c.closePath();
  }, hex(FUR));
  outline(() => {
    c.moveTo(headX + u * 0.7, headY - u * 2.8);
    c.lineTo(headX + u * 2.6, headY - u * 4.3);
    c.lineTo(headX + u * 2.9, headY - u * 1.6);
    c.closePath();
  }, hex(FUR));

  // yeux
  if (eyes === 'shut') {
    c.strokeStyle = hex(PALETTE.outline);
    c.lineWidth = 1.4 * S;
    for (const dx of [-1.3, 1.3]) {
      c.beginPath();
      c.moveTo(headX + dx * u - u * 0.6, headY - u * 0.2);
      c.lineTo(headX + dx * u + u * 0.6, headY - u * 0.2);
      c.stroke();
    }
  } else {
    const rEye = eyes === 'wide' ? u * 1.05 : u * 0.85;
    for (const dx of [-1.3, 1.3]) {
      c.beginPath();
      c.arc(headX + dx * u, headY - u * 0.3, rEye, 0, Math.PI * 2);
      c.fillStyle = hex(CAT_EYE);
      c.fill();
      c.strokeStyle = hex(PALETTE.outline);
      c.lineWidth = 1.1 * S;
      c.stroke();
      // pupille fendue
      c.fillStyle = hex(PALETTE.outline);
      c.fillRect(headX + dx * u - u * 0.16, headY - u * 0.3 - rEye * 0.7, u * 0.32, rEye * 1.4);
    }
  }
  // museau
  c.fillStyle = hex(0xff9fb4);
  c.beginPath();
  c.moveTo(headX, headY + u * 0.9);
  c.lineTo(headX - u * 0.55, headY + u * 0.35);
  c.lineTo(headX + u * 0.55, headY + u * 0.35);
  c.closePath();
  c.fill();
  // moustaches
  c.strokeStyle = rgba(PALETTE.outline, 0.7);
  c.lineWidth = S;
  for (const dy of [-0.2, 0.5]) {
    c.beginPath();
    c.moveTo(headX + u * 1.4, headY + dy * u + u * 0.6);
    c.lineTo(headX + u * 3.6, headY + dy * u * 1.6 + u * 0.4);
    c.stroke();
  }

  // clochette : l'unique autre touche de jaune, minuscule
  c.beginPath();
  c.arc(headX - u * 2.4, headY + u * 2.4, u * 0.8, 0, Math.PI * 2);
  c.fillStyle = hex(PALETTE.accent);
  c.fill();
  c.strokeStyle = hex(PALETTE.outline);
  c.lineWidth = S;
  c.stroke();

  // patte levée (coup de patte)
  if (opts.paw) {
    c.save();
    c.translate(headX - u * 1.2, bodyY - u * 1.2);
    c.rotate(-opts.paw);
    c.strokeStyle = hex(FUR);
    c.lineWidth = 1.7 * u;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(u * 4.4, -u * 1.2);
    c.stroke();
    c.strokeStyle = rgba(PALETTE.outline, 0.6);
    c.lineWidth = 0.5 * u;
    c.stroke();
    // griffes sorties : trois traits fins
    c.strokeStyle = hex(PALETTE.text);
    c.lineWidth = 0.9 * S;
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.moveTo(u * 4.6, -u * 1.2 + i * u * 0.7);
      c.lineTo(u * 6, -u * 1.6 + i * u * 0.9);
      c.stroke();
    }
    c.restore();
  }

  c.restore();
}

/** Une frame par état, toutes dans UNE source canvas → un seul draw call. */
function makeCatFrames(): readonly (readonly Texture[])[] {
  const cw = CAT_CELL_W * S;
  const ch = CAT_CELL_H * S;
  // walk×4, sit×2, sleep×2, paw×3, run×2 = 13
  const specs: { legPhase: number; tail: number; crouch?: number; paw?: number; curled?: boolean; eyes?: 'open' | 'shut' | 'wide' }[] = [
    { legPhase: 0, tail: 0.2 },
    { legPhase: Math.PI * 0.5, tail: 0.4 },
    { legPhase: Math.PI, tail: 0.2 },
    { legPhase: Math.PI * 1.5, tail: 0 },
    { legPhase: 0, tail: 0.15, crouch: 1.6 },
    { legPhase: 0, tail: 0.6, crouch: 1.6, eyes: 'shut' },
    { legPhase: 0, tail: 0, curled: true },
    { legPhase: 0, tail: 0.1, curled: true },
    { legPhase: 0, tail: -0.3, crouch: 1.2, paw: 0.15, eyes: 'wide' },
    { legPhase: 0, tail: -0.6, crouch: 1, paw: 0.9, eyes: 'wide' },
    { legPhase: 0, tail: -0.2, crouch: 1.4, paw: 0.35, eyes: 'wide' },
    { legPhase: 0.9, tail: -0.9, crouch: 0.8, eyes: 'wide' },
    { legPhase: Math.PI + 0.9, tail: -1.2, crouch: 0.8, eyes: 'wide' },
  ];

  const c = ctx2d(cw * specs.length, ch);
  specs.forEach((spec, i) => drawCat(c, cw * i, spec));

  const source = Texture.from(c.canvas).source;
  source.scaleMode = 'linear';
  const frame = (i: number): Texture => new Texture({ source, frame: new Rectangle(cw * i, 0, cw, ch) });
  const range = (from: number, count: number): Texture[] =>
    Array.from({ length: count }, (_, k) => frame(from + k));

  const frames: Texture[][] = [];
  frames[CAT_ANIM.walk] = range(0, 4);
  frames[CAT_ANIM.sit] = range(4, 2);
  frames[CAT_ANIM.sleep] = range(6, 2);
  frames[CAT_ANIM.paw] = range(8, 3);
  frames[CAT_ANIM.run] = range(11, 2);
  return frames;
}

// ───────────────────────────────────────────────────────── assemblage

/**
 * Construit l'atlas complet, en synchrone et sans aucun asset réseau. Les pions,
 * le socle et le couvercle partagent UNE source canvas (ils se batchent) ; les
 * marqueurs en partagent une autre.
 */
export function buildAtlas(): Atlas {
  const pegDefs = [...PEGS, EMPTY_PEG_DEF];
  const pegCell = PEG_CELL * S;
  // [8 couleurs + vide][socle][couvercle]
  const pegSheet = ctx2d(pegCell * (pegDefs.length + 2), pegCell);
  pegDefs.forEach((def, i) => drawPeg(pegSheet, def, pegCell * i));
  drawSocket(pegSheet, pegCell * pegDefs.length);
  drawMasked(pegSheet, pegCell * (pegDefs.length + 1));
  const pegSource = Texture.from(pegSheet.canvas).source;
  pegSource.scaleMode = 'linear';
  const pegFrame = (i: number): Texture =>
    new Texture({ source: pegSource, frame: new Rectangle(pegCell * i, 0, pegCell, pegCell) });

  const markCell = MARK_CELL * S;
  const markSheet = ctx2d(markCell * 3, markCell);
  drawMarkExact(markSheet, 0);
  drawMarkMisplaced(markSheet, markCell);
  drawMarkBlank(markSheet, markCell * 2);
  const markSource = Texture.from(markSheet.canvas).source;
  markSource.scaleMode = 'linear';
  const markFrame = (i: number): Texture =>
    new Texture({ source: markSource, frame: new Rectangle(markCell * i, 0, markCell, markCell) });

  const { spark, confetti } = makeFxSheet();
  return {
    pegFrames: pegDefs.map((_, i) => pegFrame(i)),
    socket: pegFrame(pegDefs.length),
    masked: pegFrame(pegDefs.length + 1),
    markExact: markFrame(0),
    markMisplaced: markFrame(1),
    markBlank: markFrame(2),
    spark,
    confetti,
    ray: makeRay(),
    ground: makeGround(),
    catFrames: makeCatFrames(),
  };
}

/** Index de frame d'un pion dans `Atlas.pegFrames` (le vide en dernier). */
export function pegFrameIndex(value: number): number {
  return value < 0 ? PEGS.length : value;
}

/** Teinte d'un pion — utilisée par les particules pour « éclabousser » sa couleur. */
export function pegColor(value: number): number {
  return value < 0 ? EMPTY_PEG_DEF.color : PEGS[value].color;
}
