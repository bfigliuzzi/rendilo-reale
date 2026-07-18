import { Rectangle, Texture } from 'pixi.js';
import { NODE_LEVELS } from '../config/balance';
import { SPECIES_IDS } from '../config/levels';

// Toutes les textures sont générées en canvas, dessinées à leur taille d'affichage
// réelle ×2 (leçon horde : jamais de petite frame étirée). Accessibilité (WCAG) :
// l'ESPÈCE se lit à la FORME (hexagone / losange / goutte anguleuse), au GLYPHE
// (abeille / mouche / cafard) et à la silhouette d'unité ; la FACTION se lit à la
// teinte ET au style de contour (plein / double / pointillé) + cœur d'unité évidé
// pour les camps IA — jamais la couleur seule, même entre abeilles rivales.

export const PALETTE = {
  bg: 0x171208, // nuit de miel
  player: 0xf6b93b, // ambre — faction 1 (joueur, toujours)
  playerDark: 0x8a5f13,
  enemy: 0x9c4a1a, // rouille — faction 2
  enemyDark: 0x4a1f08,
  faction3: 0x9d7bea, // violet froid — faction 3 (mêlées)
  faction3Dark: 0x452a78,
  neutral: 0x8b98a8, // gris neutre
  neutralDark: 0x3d4652,
  select: 0xffe9a8, // anneau de sélection
} as const;

/** Teintes par faction (0 neutre, 1 joueur, 2..3 IA) — fx de capture, HUD, drag. */
export const FACTION_COLORS: readonly number[] = [PALETTE.neutral, PALETTE.player, PALETTE.enemy, PALETTE.faction3];
export const FACTION_DARKS: readonly number[] = [PALETTE.neutralDark, PALETTE.playerDark, PALETTE.enemyDark, PALETTE.faction3Dark];

export interface Atlas {
  nodeBodyNeutral: Texture;
  /** nodeBodies[speciesIdx][faction - 1] : forme+glyphe d'espèce, teinte+contour de faction. */
  nodeBodies: readonly (readonly Texture[])[];
  ring: Texture; // anneau HD blanc, à teinter (sélection, flash de capture)
  unitMote: Texture; // point neutre (orbites des nœuds gris)
  /** unitFrames[speciesIdx][faction - 1] : silhouette d'espèce, teinte de faction. */
  unitFrames: readonly (readonly Texture[])[];
  spark: Texture; // disque blanc à teinter (fx)
  /** Tuiles de fond par biome (index = biomeOf, render/decor.ts), non interactives. */
  groundTiles: readonly Texture[];
  /** Props/météo de décor, un jeu par biome — même source canvas, tout se batche. */
  decor: readonly DecorSet[];
}

/** Prop de décor : `sway` = amplitude d'oscillation render-only (0 = rigide),
 *  `weight` = poids de tirage. */
export interface DecorProp {
  tex: Texture;
  sway: number;
  weight: number;
}

/** Décor d'un biome : props (ancrés au pied), détails de sol discrets,
 *  et la frame `mote` (disque flou à teinter) de sa météo ambiante. */
export interface DecorSet {
  props: readonly DecorProp[];
  ground: readonly Texture[];
  mote: Texture;
}

const S = 2; // supersampling
const FACTION_SLOTS = 3; // factions 1..3

function ctx2d(w: number, h: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('canvas 2d indisponible');
  return c;
}

// Les consommateurs affichent ces textures à 1/S de leur taille (supersampling).
function toTexture(c: CanvasRenderingContext2D): Texture {
  const tex = Texture.from(c.canvas);
  tex.source.scaleMode = 'linear';
  return tex;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Glyphe abeille : corps rayé + deux ailes. Blanc à liseré sombre. */
function drawBeeGlyph(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  c.save();
  c.translate(x, y);
  c.lineWidth = s * 0.14;
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.fillStyle = '#ffffff';
  // ailes
  c.beginPath();
  c.ellipse(-s * 0.42, -s * 0.34, s * 0.34, s * 0.2, -0.5, 0, Math.PI * 2);
  c.ellipse(s * 0.42, -s * 0.34, s * 0.34, s * 0.2, 0.5, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  // corps
  c.beginPath();
  c.ellipse(0, s * 0.12, s * 0.3, s * 0.5, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  // rayures
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.lineWidth = s * 0.11;
  for (const dy of [-0.08, 0.16, 0.4]) {
    const w = s * (0.27 - Math.abs(dy) * 0.18);
    c.beginPath();
    c.moveTo(-w, s * dy + s * 0.12);
    c.lineTo(w, s * dy + s * 0.12);
    c.stroke();
  }
  c.restore();
}

/** Glyphe mouche : deux GRANDES ailes rondes + petit corps, gros yeux. */
function drawFlyGlyph(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  c.save();
  c.translate(x, y);
  c.lineWidth = s * 0.12;
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.fillStyle = '#ffffff';
  // ailes surdimensionnées (la signature de la mouche)
  c.beginPath();
  c.ellipse(-s * 0.42, s * 0.06, s * 0.42, s * 0.26, -1.05, 0, Math.PI * 2);
  c.ellipse(s * 0.42, s * 0.06, s * 0.42, s * 0.26, 1.05, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  // corps court
  c.beginPath();
  c.ellipse(0, s * 0.18, s * 0.22, s * 0.34, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  // tête + yeux
  c.beginPath();
  c.arc(0, -s * 0.32, s * 0.2, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.fillStyle = 'rgba(0,0,0,0.85)';
  c.beginPath();
  c.arc(-s * 0.09, -s * 0.34, s * 0.07, 0, Math.PI * 2);
  c.arc(s * 0.09, -s * 0.34, s * 0.07, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Glyphe cafard : corps effilé + antennes. Blanc à liseré sombre. */
function drawRoachGlyph(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  c.save();
  c.translate(x, y);
  c.lineWidth = s * 0.14;
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.fillStyle = '#ffffff';
  // antennes
  c.beginPath();
  c.moveTo(-s * 0.14, -s * 0.34);
  c.quadraticCurveTo(-s * 0.5, -s * 0.7, -s * 0.62, -s * 0.52);
  c.moveTo(s * 0.14, -s * 0.34);
  c.quadraticCurveTo(s * 0.5, -s * 0.7, s * 0.62, -s * 0.52);
  c.lineWidth = s * 0.1;
  c.stroke();
  // corps effilé
  c.beginPath();
  c.moveTo(0, -s * 0.44);
  c.quadraticCurveTo(s * 0.34, -s * 0.05, 0, s * 0.62);
  c.quadraticCurveTo(-s * 0.34, -s * 0.05, 0, -s * 0.44);
  c.lineWidth = s * 0.14;
  c.fill();
  c.stroke();
  // ligne dorsale
  c.beginPath();
  c.moveTo(0, -s * 0.3);
  c.lineTo(0, s * 0.5);
  c.lineWidth = s * 0.09;
  c.stroke();
  c.restore();
}

/** Trace la FORME d'espèce (chemin seul) : hexagone abeille, losange mouche, goutte cafard. */
function traceSpeciesShape(c: CanvasRenderingContext2D, species: number, cx: number, cy: number, r: number): void {
  c.beginPath();
  if (species === 0) {
    // abeilles : HEXAGONE alvéole
    for (let k = 0; k < 6; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 3;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (k === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
  } else if (species === 1) {
    // mouches : LOSANGE élargi (vif, anguleux)
    c.moveTo(cx, cy - r);
    c.lineTo(cx + r * 0.95, cy);
    c.lineTo(cx, cy + r);
    c.lineTo(cx - r * 0.95, cy);
  } else {
    // cafards : GOUTTE ANGULEUSE (écusson pointé vers le bas)
    c.moveTo(cx, cy - r);
    c.lineTo(cx + r * 0.92, cy - r * 0.25);
    c.lineTo(cx + r * 0.6, cy + r * 0.62);
    c.lineTo(cx, cy + r);
    c.lineTo(cx - r * 0.6, cy + r * 0.62);
    c.lineTo(cx - r * 0.92, cy - r * 0.25);
  }
  c.closePath();
}

const GLYPHS = [drawBeeGlyph, drawFlyGlyph, drawRoachGlyph] as const;

/**
 * Corps de nœud : forme+glyphe d'ESPÈCE, teinte+style de contour de FACTION
 * (slot 0 = plein, 1 = double liseré clair, 2 = pointillé) — deux clans de même
 * espèce restent distinguables sans la couleur (swap de texture = tout change).
 */
function makeNodeBody(species: number, slot: number): Texture {
  const r = NODE_LEVELS[0].radius * S;
  const pad = 6 * S;
  const size = (r + pad) * 2;
  const c = ctx2d(size, size);
  const cx = size / 2;
  const cy = size / 2;
  const faction = slot + 1;

  c.fillStyle = hex(FACTION_COLORS[faction]);
  c.strokeStyle = hex(FACTION_DARKS[faction]);
  c.lineWidth = 3.5 * S;
  if (slot === 2) c.setLineDash([7 * S, 5 * S]);
  traceSpeciesShape(c, species, cx, cy, r);
  c.fill();
  c.stroke();
  c.setLineDash([]);
  if (slot === 1) {
    // contour DOUBLE : liseré clair interne en plus du trait sombre
    c.strokeStyle = 'rgba(255,255,255,0.75)';
    c.lineWidth = 1.6 * S;
    traceSpeciesShape(c, species, cx, cy, r * 0.86);
    c.stroke();
  }
  GLYPHS[species](c, cx, cy - r * 0.05, r * 0.5);
  return toTexture(c);
}

/** Nœud neutre : CERCLE terne + anneau intérieur pointillé, pas de glyphe. */
function makeNeutralBody(): Texture {
  const r = NODE_LEVELS[0].radius * S;
  const pad = 6 * S;
  const size = (r + pad) * 2;
  const c = ctx2d(size, size);
  const cx = size / 2;
  c.fillStyle = hex(PALETTE.neutral);
  c.strokeStyle = hex(PALETTE.neutralDark);
  c.lineWidth = 3.5 * S;
  c.beginPath();
  c.arc(cx, cx, r, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.setLineDash([5 * S, 6 * S]);
  c.lineWidth = 2.5 * S;
  c.beginPath();
  c.arc(cx, cx, r * 0.62, 0, Math.PI * 2);
  c.stroke();
  c.setLineDash([]);
  return toTexture(c);
}

/** Anneau de sélection HD, blanc (teinté au rendu), dessiné à sa taille réelle ×2. */
function makeRing(): Texture {
  const r = (NODE_LEVELS[0].radius + 10) * S;
  const size = (r + 5 * S) * 2;
  const c = ctx2d(size, size);
  const cx = size / 2;
  // liseré sombre intégré : lisible sur fond clair comme sombre
  c.strokeStyle = 'rgba(0,0,0,0.6)';
  c.lineWidth = 6.5 * S;
  c.beginPath();
  c.arc(cx, cx, r, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = '#ffffff';
  c.lineWidth = 4 * S;
  c.beginPath();
  c.arc(cx, cx, r, 0, Math.PI * 2);
  c.stroke();
  return toTexture(c);
}

/**
 * Palettes des 4 biomes de fond, dérivés de l'adversaire (render/decor.ts:biomeOf).
 * Les bases restent TOUTES plus sombres que PALETTE.neutralDark : le contraste
 * nœuds/unités prime (WCAG), le décor ne rivalise jamais avec le gameplay.
 */
export const HIVE_BIOMES = [
  { base: '#191408', line: '#f6b93b', lineAlpha: 0.06 }, // prairie de la ruche — alvéoles ambre, l'identité historique
  { base: '#0d1410', line: '#3f6a4e', lineAlpha: 0.055 }, // marécage (mouches)
  { base: '#100e13', line: '#4a4256', lineAlpha: 0.06 }, // sous-bois nocturne (cafards)
  { base: '#16100e', line: '#5a4038', lineAlpha: 0.055 }, // friche de guerre (mêlées)
] as const;

function rgba(hexColor: string, alpha: number): string {
  const n = parseInt(hexColor.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Taches sombres anti-répétition par biome : positions FIXES (fractions de tuile,
// loin des bords — la tuile reste raccordable) et rayon en cellules.
const TILE_BLOTCHES: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [0.24, 0.38, 1.2],
    [0.7, 0.66, 1.0],
  ],
  [
    [0.32, 0.6, 1.3],
    [0.76, 0.32, 1.0],
    [0.58, 0.74, 0.9],
  ],
  [
    [0.28, 0.34, 1.1],
    [0.68, 0.68, 1.3],
  ],
  [
    [0.22, 0.62, 1.0],
    [0.58, 0.3, 1.2],
    [0.8, 0.7, 0.9],
  ],
];

/**
 * Tuile de fond d'un biome : MÊME treillis hexagonal pour tous (l'identité du
 * jeu), base/teinte de lignes par biome + 2-3 taches radiales très sombres qui
 * cassent la répétition. Tons très sombres : le décor ne code jamais un danger.
 */
function makeGroundTile(biome: number): Texture {
  const cell = 36 * S;
  const w = cell * 6; // 2 périodes horizontales du treillis
  const h = Math.round(cell * 3.464); // 2 périodes verticales
  const c = ctx2d(w, h);
  const pal = HIVE_BIOMES[biome];
  c.fillStyle = pal.base;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = rgba(pal.line, pal.lineAlpha);
  c.lineWidth = 2 * S;
  const rr = cell * 0.58;
  for (let row = -1; row <= 5; row++) {
    for (let col = -1; col <= 5; col++) {
      const cx = col * cell * 1.5 + (row % 2 === 0 ? 0 : cell * 0.75);
      const cy = row * cell * 0.866;
      c.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        if (k === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      c.stroke();
    }
  }
  for (const [fx, fy, fr] of TILE_BLOTCHES[biome]) {
    const g = c.createRadialGradient(w * fx, h * fy, 0, w * fx, h * fy, cell * fr);
    g.addColorStop(0, 'rgba(0,0,0,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  return toTexture(c);
}

/**
 * Planche de décor : tous les props des 4 biomes sur UN canvas 512×512 — une
 * seule source, les sprites d'une carte se batchent (pattern horde). Style :
 * aplats TERNES bordés d'un trait sombre, luminance modérée. AUCUN code danger
 * (hachures jaune/noir, anneaux, glyphes/à-plats blancs) ni teinte saturée de
 * faction : ces codes restent réservés au gameplay.
 */
function buildDecorSets(): DecorSet[] {
  const c = ctx2d(512, 512);
  let curX = 0;
  let curY = 0;
  let rowH = 0;
  const cells: { biome: number; ground: boolean; sway: number; weight: number; rect: Rectangle }[] = [];
  const place = (w: number, h: number): { x: number; y: number } => {
    if (curX + w + 4 > 512) {
      curX = 0;
      curY += rowH;
      rowH = 0;
    }
    rowH = Math.max(rowH, h + 4);
    const p = { x: curX + 2, y: curY + 2 };
    curX += w + 4;
    return p;
  };
  const prop = (
    biome: number,
    w: number,
    h: number,
    sway: number,
    weight: number,
    draw: (x: number, y: number) => void,
  ): void => {
    const { x, y } = place(w, h);
    draw(x, y);
    cells.push({ biome, ground: false, sway, weight, rect: new Rectangle(x, y, w, h) });
  };
  const groundDetail = (biome: number, w: number, h: number, draw: (x: number, y: number) => void): void => {
    const { x, y } = place(w, h);
    draw(x, y);
    cells.push({ biome, ground: true, sway: 0, weight: 1, rect: new Rectangle(x, y, w, h) });
  };

  // — primitives partagées —
  const edge = (color: string, lw = 2): void => {
    c.lineWidth = lw;
    c.strokeStyle = color;
    c.stroke();
  };
  const disc = (cx: number, cy: number, r: number, fill: string, edgeC?: string, lw = 1.5): void => {
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    if (edgeC) edge(edgeC, lw);
  };
  /** Touffe : brins en éventail depuis le pied (le pivot du sway au rendu). */
  const tuft = (cx: number, baseY: number, w: number, h: number, colors: readonly string[], n = 7): void => {
    c.lineCap = 'round';
    c.lineWidth = 2;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const spread = (t - 0.5) * w;
      c.strokeStyle = colors[k % colors.length];
      c.beginPath();
      c.moveTo(cx + spread * 0.25, baseY);
      c.quadraticCurveTo(
        cx + spread * 0.55,
        baseY - h * 0.6,
        cx + spread,
        baseY - h * (0.7 + 0.3 * (1 - Math.abs(t - 0.5) * 2)),
      );
      c.stroke();
    }
    c.lineCap = 'butt';
  };

  // ————— PRAIRIE DE LA RUCHE (0) : fleurs désaturées, herbes, trèfles —————
  prop(0, 20, 28, 0.07, 1, (x, y) => {
    const cx = x + 10;
    c.strokeStyle = '#3d4a26';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx, y + 27);
    c.quadraticCurveTo(cx - 2.5, y + 19, cx, y + 12);
    c.stroke();
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
      disc(cx + Math.cos(a) * 4.6, y + 9 + Math.sin(a) * 4.6, 3.4, '#8f6a5e', '#3a241d');
    }
    disc(cx, y + 9, 2.8, '#6e5a36', '#3a2d18');
  });
  prop(0, 18, 24, 0.07, 0.9, (x, y) => {
    const cx = x + 9;
    c.strokeStyle = '#44502c';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx, y + 23);
    c.lineTo(cx + 1.5, y + 11);
    c.stroke();
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      c.beginPath();
      c.ellipse(cx + Math.cos(a) * 4.4, y + 8 + Math.sin(a) * 4.4, 3, 1.8, a, 0, Math.PI * 2);
      c.fillStyle = '#948a66';
      c.fill();
      edge('#4a4430', 1.4);
    }
    disc(cx, y + 8, 2.4, '#5c5032');
  });
  prop(0, 26, 24, 0.09, 1.4, (x, y) => tuft(x + 13, y + 23, 20, 20, ['#45522f', '#37421f', '#52603a']));
  prop(0, 22, 32, 0.09, 1.1, (x, y) => tuft(x + 11, y + 31, 14, 28, ['#4d5a33', '#3b4826'], 5));
  prop(0, 18, 18, 0.05, 1, (x, y) => {
    c.strokeStyle = '#33421f';
    c.lineWidth = 1.8;
    c.beginPath();
    c.moveTo(x + 9, y + 17);
    c.quadraticCurveTo(x + 10, y + 13, x + 9, y + 10);
    c.stroke();
    disc(x + 6, y + 8, 3.4, '#3f5230', '#232e18');
    disc(x + 12, y + 8, 3.4, '#3f5230', '#232e18');
    disc(x + 9, y + 4.8, 3.4, '#3f5230', '#232e18');
  });
  prop(0, 18, 12, 0, 0.7, (x, y) => {
    c.beginPath();
    c.moveTo(x + 2, y + 11);
    c.lineTo(x + 4, y + 4);
    c.lineTo(x + 10, y + 1.5);
    c.lineTo(x + 15, y + 5);
    c.lineTo(x + 16, y + 11);
    c.closePath();
    c.fillStyle = '#4e4a40';
    c.fill();
    edge('#2a2722', 1.6);
    c.fillStyle = '#5e5a50';
    c.beginPath();
    c.moveTo(x + 5, y + 5);
    c.lineTo(x + 9, y + 3);
    c.lineTo(x + 11, y + 6);
    c.lineTo(x + 7, y + 7);
    c.closePath();
    c.fill();
  });
  prop(0, 14, 18, 0.06, 0.8, (x, y) => {
    const cx = x + 7;
    c.strokeStyle = '#45522f';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx, y + 17);
    c.lineTo(cx, y + 7);
    c.stroke();
    c.fillStyle = '#52603a';
    c.beginPath();
    c.ellipse(cx - 3, y + 6, 3.6, 2, -0.7, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(cx + 3, y + 5, 3.6, 2, 0.7, 0, Math.PI * 2);
    c.fill();
  });
  groundDetail(0, 26, 16, (x, y) => {
    // fleurettes éparses
    for (const [dx, dy] of [
      [4, 5],
      [12, 10],
      [20, 4],
      [17, 13],
      [7, 13],
    ] as const) {
      disc(x + dx, y + dy, 1.6, '#7a705a');
    }
  });
  groundDetail(0, 30, 16, (x, y) => {
    // herbe rase
    c.strokeStyle = '#33401f';
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    for (let k = 0; k < 7; k++) {
      const bx = x + 3 + k * 4;
      c.beginPath();
      c.moveTo(bx, y + 14);
      c.quadraticCurveTo(bx + 1, y + 9, bx + (k % 2) * 4 - 2, y + 5);
      c.stroke();
    }
    c.lineCap = 'butt';
  });

  // ————— MARÉCAGE (1) : roseaux, flaques, carcasse terne, champignons de vase —————
  prop(1, 22, 42, 0.07, 1.3, (x, y) => {
    c.strokeStyle = '#3d5232';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x + 6, y + 41);
    c.quadraticCurveTo(x + 4, y + 24, x + 5, y + 8);
    c.stroke();
    c.beginPath();
    c.moveTo(x + 16, y + 41);
    c.quadraticCurveTo(x + 18, y + 26, x + 17, y + 12);
    c.stroke();
    c.beginPath();
    c.moveTo(x + 11, y + 41);
    c.lineTo(x + 11, y + 4);
    c.stroke();
    // quenouille brun terne
    c.beginPath();
    c.ellipse(x + 11, y + 9, 2.6, 6, 0, 0, Math.PI * 2);
    c.fillStyle = '#5c4a33';
    c.fill();
    edge('#33281a', 1.4);
  });
  prop(1, 30, 46, 0.08, 1, (x, y) => {
    c.strokeStyle = '#3d5232';
    c.lineWidth = 2;
    for (const [bx, top, bend] of [
      [6, 10, -3],
      [12, 6, 1],
      [19, 12, 3],
      [25, 8, 2],
    ] as const) {
      c.beginPath();
      c.moveTo(x + bx, y + 45);
      c.quadraticCurveTo(x + bx + bend, y + 26, x + bx + bend * 0.6, y + top);
      c.stroke();
    }
    for (const [bx, hy] of [
      [12.6, 11],
      [26.2, 13],
    ] as const) {
      c.beginPath();
      c.ellipse(x + bx, y + hy, 2.4, 5.5, 0, 0, Math.PI * 2);
      c.fillStyle = '#5c4a33';
      c.fill();
      edge('#33281a', 1.4);
    }
  });
  prop(1, 40, 18, 0, 1, (x, y) => {
    c.beginPath();
    c.ellipse(x + 20, y + 11, 18, 6.5, 0, 0, Math.PI * 2);
    c.fillStyle = '#122019';
    c.fill();
    edge('#2e4a3a', 1.6);
    c.beginPath();
    c.ellipse(x + 15, y + 9.5, 7, 2.2, -0.2, 0, Math.PI * 2);
    c.fillStyle = '#1c3328';
    c.fill();
  });
  prop(1, 36, 20, 0, 0.5, (x, y) => {
    // carcasse beige TERNE — jamais d'os blanc
    c.strokeStyle = '#8a7a5f';
    c.lineWidth = 2.4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x + 3, y + 16);
    c.quadraticCurveTo(x + 18, y + 20, x + 30, y + 14);
    c.stroke();
    for (let k = 0; k < 4; k++) {
      const bx = x + 8 + k * 6;
      c.beginPath();
      c.moveTo(bx, y + 17);
      c.quadraticCurveTo(bx + 2, y + 8, bx + 6, y + 6);
      c.stroke();
    }
    c.lineCap = 'butt';
    disc(x + 32, y + 13, 3, '#8a7a5f', '#4f4536', 1.4);
    disc(x + 33, y + 12.4, 1, '#3b3428');
  });
  prop(1, 22, 16, 0, 0.9, (x, y) => {
    c.fillStyle = '#4a4f38';
    c.fillRect(x + 5, y + 9, 3, 6);
    c.fillRect(x + 13, y + 11, 3, 4);
    c.beginPath();
    c.ellipse(x + 6.5, y + 8, 6, 3.6, 0, Math.PI, 0);
    c.closePath();
    c.fillStyle = '#5f6a45';
    c.fill();
    edge('#333c22', 1.5);
    c.beginPath();
    c.ellipse(x + 14.5, y + 10.5, 5, 3, 0, Math.PI, 0);
    c.closePath();
    c.fillStyle = '#57613f';
    c.fill();
    edge('#333c22', 1.4);
  });
  prop(1, 24, 24, 0.08, 1.1, (x, y) => tuft(x + 12, y + 23, 18, 20, ['#3f5638', '#2f4429']));
  prop(1, 26, 14, 0, 0.7, (x, y) => {
    c.strokeStyle = '#3a3026';
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x + 2, y + 12);
    c.quadraticCurveTo(x + 10, y + 2, x + 16, y + 8);
    c.quadraticCurveTo(x + 20, y + 12, x + 24, y + 7);
    c.stroke();
    c.lineCap = 'butt';
  });
  groundDetail(1, 30, 14, (x, y) => {
    // nappe de vase
    c.beginPath();
    c.ellipse(x + 15, y + 7, 14, 5.5, 0, 0, Math.PI * 2);
    c.fillStyle = '#0a1710';
    c.fill();
    c.beginPath();
    c.ellipse(x + 12, y + 6, 8, 3, 0.15, 0, Math.PI * 2);
    c.fillStyle = '#132218';
    c.fill();
  });
  groundDetail(1, 18, 12, (x, y) => {
    // bulles de vase (disques pleins — jamais d'anneaux, code danger)
    disc(x + 5, y + 7, 2.6, '#1d332a');
    disc(x + 12, y + 4, 1.8, '#1d332a');
    disc(x + 13, y + 9, 1.2, '#1d332a');
  });

  // ————— SOUS-BOIS NOCTURNE (2) : feuilles mortes, brindilles, champignons —————
  prop(2, 20, 14, 0, 1.3, (x, y) => {
    c.beginPath();
    c.moveTo(x + 2, y + 8);
    c.quadraticCurveTo(x + 8, y + 1, x + 17, y + 4);
    c.quadraticCurveTo(x + 12, y + 12, x + 2, y + 8);
    c.fillStyle = '#6b4f35';
    c.fill();
    edge('#3a2a1a', 1.4);
    c.strokeStyle = '#402d1c';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(x + 3, y + 8);
    c.quadraticCurveTo(x + 10, y + 5, x + 16, y + 4.5);
    c.stroke();
  });
  prop(2, 26, 16, 0, 1, (x, y) => {
    for (const [dx, dy, rot, fill] of [
      [8, 7, 0.4, '#75563a'],
      [18, 9, -0.6, '#5c4630'],
    ] as const) {
      c.save();
      c.translate(x + dx, y + dy);
      c.rotate(rot);
      c.beginPath();
      c.ellipse(0, 0, 6.5, 3.2, 0, 0, Math.PI * 2);
      c.fillStyle = fill;
      c.fill();
      edge('#35251a', 1.3);
      c.restore();
    }
  });
  prop(2, 26, 12, 0, 0.9, (x, y) => {
    c.strokeStyle = '#4a3a2a';
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x + 2, y + 9);
    c.lineTo(x + 23, y + 4);
    c.stroke();
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(x + 12, y + 6.8);
    c.lineTo(x + 17, y + 1.5);
    c.stroke();
    c.lineCap = 'butt';
  });
  prop(2, 22, 20, 0, 1, (x, y) => {
    c.fillStyle = '#7a6a55';
    c.fillRect(x + 6, y + 10, 3.6, 9);
    c.fillRect(x + 14, y + 13, 3, 6);
    c.beginPath();
    c.ellipse(x + 8, y + 9, 7, 4.4, 0, Math.PI, 0);
    c.closePath();
    c.fillStyle = '#8a6a52';
    c.fill();
    edge('#4a3324', 1.6);
    c.beginPath();
    c.ellipse(x + 15.5, y + 12.5, 5, 3.2, 0, Math.PI, 0);
    c.closePath();
    c.fillStyle = '#7d5f49';
    c.fill();
    edge('#4a3324', 1.4);
    // taches TERNES du chapeau (jamais blanches)
    disc(x + 5, y + 7, 1.1, '#a08a70');
    disc(x + 10, y + 6, 1.3, '#a08a70');
  });
  prop(2, 26, 18, 0, 0.8, (x, y) => {
    c.beginPath();
    c.moveTo(x + 3, y + 17);
    c.lineTo(x + 5, y + 7);
    c.lineTo(x + 13, y + 3);
    c.lineTo(x + 21, y + 8);
    c.lineTo(x + 23, y + 17);
    c.closePath();
    c.fillStyle = '#4a4a52';
    c.fill();
    edge('#2a2a30', 1.6);
    c.beginPath();
    c.ellipse(x + 10, y + 7, 5, 3, -0.3, 0, Math.PI * 2);
    c.fillStyle = '#435038';
    c.fill();
  });
  prop(2, 26, 26, 0.06, 1, (x, y) => {
    c.strokeStyle = '#3d4a35';
    c.lineWidth = 1.8;
    c.lineCap = 'round';
    for (let k = -2; k <= 2; k++) {
      c.beginPath();
      c.moveTo(x + 13, y + 25);
      c.quadraticCurveTo(x + 13 + k * 4, y + 14, x + 13 + k * 6, y + 6 + Math.abs(k) * 4);
      c.stroke();
    }
    c.lineCap = 'butt';
  });
  prop(2, 12, 12, 0, 0.7, (x, y) => {
    c.beginPath();
    c.ellipse(x + 6, y + 7.5, 3.4, 3.8, 0, 0, Math.PI * 2);
    c.fillStyle = '#6a4f33';
    c.fill();
    edge('#3a2a18', 1.3);
    c.beginPath();
    c.ellipse(x + 6, y + 3.8, 4, 2, 0, Math.PI, 0);
    c.closePath();
    c.fillStyle = '#4a3624';
    c.fill();
  });
  groundDetail(2, 30, 18, (x, y) => {
    // tapis de feuilles
    c.fillStyle = '#553f2a';
    for (const [dx, dy, rot] of [
      [6, 6, 0.4],
      [16, 4, -0.5],
      [24, 9, 0.2],
      [11, 13, -0.2],
      [21, 14, 0.6],
    ] as const) {
      c.save();
      c.translate(x + dx, y + dy);
      c.rotate(rot);
      c.beginPath();
      c.ellipse(0, 0, 3.6, 1.8, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  });
  groundDetail(2, 24, 14, (x, y) => {
    // plaque de mousse
    c.beginPath();
    c.ellipse(x + 12, y + 7, 11, 5, 0, 0, Math.PI * 2);
    c.fillStyle = '#35402c';
    c.fill();
    disc(x + 8, y + 6, 2.4, '#42502f');
    disc(x + 16, y + 8, 2, '#42502f');
  });

  // ————— FRICHE DE GUERRE (3) : souches calcinées, herbes sèches, monticules —————
  prop(3, 28, 24, 0, 1, (x, y) => {
    c.fillStyle = '#26201c';
    c.fillRect(x + 7, y + 6, 14, 17);
    c.beginPath();
    c.moveTo(x + 7, y + 23);
    c.lineTo(x + 4, y + 23);
    c.lineTo(x + 7, y + 17);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(x + 21, y + 23);
    c.lineTo(x + 24, y + 23);
    c.lineTo(x + 21, y + 18);
    c.closePath();
    c.fill();
    c.beginPath();
    c.ellipse(x + 14, y + 6, 7, 3, 0, 0, Math.PI * 2);
    c.fillStyle = '#3a322c';
    c.fill();
    edge('#15100d', 1.5);
    c.strokeStyle = '#28221d';
    c.lineWidth = 1.2;
    c.beginPath();
    c.ellipse(x + 14, y + 6, 4, 1.6, 0, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = '#120d0b';
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(x + 10, y + 9);
    c.lineTo(x + 10, y + 20);
    c.moveTo(x + 17, y + 8);
    c.lineTo(x + 17, y + 22);
    c.stroke();
  });
  prop(3, 26, 18, 0, 0.8, (x, y) => {
    c.beginPath();
    c.moveTo(x + 5, y + 17);
    c.lineTo(x + 9, y + 4);
    c.lineTo(x + 18, y + 2);
    c.lineTo(x + 17, y + 17);
    c.closePath();
    c.fillStyle = '#26201c';
    c.fill();
    edge('#120d0b', 1.5);
    c.beginPath();
    c.ellipse(x + 13.5, y + 3.4, 4.8, 1.8, -0.15, 0, Math.PI * 2);
    c.fillStyle = '#3a322c';
    c.fill();
  });
  prop(3, 24, 24, 0.08, 1.2, (x, y) => tuft(x + 12, y + 23, 18, 20, ['#7a6748', '#6a5838', '#57482c']));
  prop(3, 32, 16, 0, 1, (x, y) => {
    c.beginPath();
    c.moveTo(x + 2, y + 15);
    c.quadraticCurveTo(x + 16, y - 4, x + 30, y + 15);
    c.closePath();
    c.fillStyle = '#2e2620';
    c.fill();
    edge('#191412', 1.6);
    c.fillStyle = '#3a3028';
    c.beginPath();
    c.moveTo(x + 10, y + 15);
    c.quadraticCurveTo(x + 16, y + 4, x + 24, y + 15);
    c.closePath();
    c.fill();
  });
  prop(3, 30, 12, 0, 0.9, (x, y) => {
    c.strokeStyle = '#221c18';
    c.lineWidth = 2.6;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x + 2, y + 10);
    c.quadraticCurveTo(x + 14, y + 4, x + 27, y + 7);
    c.stroke();
    c.lineWidth = 1.8;
    c.beginPath();
    c.moveTo(x + 14, y + 6.6);
    c.lineTo(x + 19, y + 1.5);
    c.stroke();
    c.lineCap = 'butt';
  });
  prop(3, 22, 16, 0, 0.8, (x, y) => {
    c.beginPath();
    c.moveTo(x + 3, y + 15);
    c.lineTo(x + 5, y + 5);
    c.lineTo(x + 12, y + 2);
    c.lineTo(x + 18, y + 6);
    c.lineTo(x + 19, y + 15);
    c.closePath();
    c.fillStyle = '#4a423c';
    c.fill();
    edge('#262220', 1.6);
    c.strokeStyle = '#1a1614';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(x + 11, y + 3);
    c.lineTo(x + 9, y + 9);
    c.lineTo(x + 12, y + 15);
    c.stroke();
  });
  groundDetail(3, 30, 16, (x, y) => {
    // craquelures de terre brûlée
    c.strokeStyle = '#0e0a08';
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x + 3, y + 12);
    c.lineTo(x + 12, y + 8);
    c.lineTo(x + 20, y + 10);
    c.lineTo(x + 27, y + 5);
    c.moveTo(x + 12, y + 8);
    c.lineTo(x + 15, y + 2);
    c.moveTo(x + 20, y + 10);
    c.lineTo(x + 22, y + 14);
    c.stroke();
    c.lineCap = 'butt';
  });
  groundDetail(3, 26, 14, (x, y) => {
    // plaque de cendre
    c.beginPath();
    c.ellipse(x + 13, y + 7, 12, 5, 0, 0, Math.PI * 2);
    c.fillStyle = '#3a3632';
    c.fill();
    disc(x + 9, y + 6, 1.4, '#4a4640');
    disc(x + 17, y + 8, 1.2, '#4a4640');
  });

  // frame météo : disque flou 12×12 à teinter (jamais affiché brut)
  const m = place(12, 12);
  const g = c.createRadialGradient(m.x + 6, m.y + 6, 0, m.x + 6, m.y + 6, 5.5);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(m.x, m.y, 12, 12);

  const source = Texture.from(c.canvas).source;
  source.scaleMode = 'linear';
  const mote = new Texture({ source, frame: new Rectangle(m.x, m.y, 12, 12) });
  const sets = HIVE_BIOMES.map(() => ({ props: [] as DecorProp[], ground: [] as Texture[], mote }));
  for (const cell of cells) {
    const tex = new Texture({ source, frame: cell.rect });
    if (cell.ground) sets[cell.biome].ground.push(tex);
    else sets[cell.biome].props.push({ tex, sway: cell.sway, weight: cell.weight });
  }
  return sets;
}

/** Silhouette d'unité par espèce, teinte de faction ; les camps IA (slot ≥ 1)
 *  ont le cœur ÉVIDÉ (point sombre central) — le joueur est plein. */
function drawUnitSilhouette(c: CanvasRenderingContext2D, species: number, slot: number): void {
  const faction = slot + 1;
  c.fillStyle = hex(FACTION_COLORS[faction]);
  c.strokeStyle = 'rgba(0,0,0,0.7)';
  c.lineWidth = S;
  if (species === 0) {
    // abeille — ovale trapu rayé
    c.beginPath();
    c.ellipse(0, 0, 3.6 * S, 5.2 * S, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.strokeStyle = 'rgba(20,10,0,0.9)';
    c.lineWidth = 1.2 * S;
    c.beginPath();
    c.moveTo(-2.6 * S, -1.2 * S);
    c.lineTo(2.6 * S, -1.2 * S);
    c.moveTo(-2.8 * S, 1.4 * S);
    c.lineTo(2.8 * S, 1.4 * S);
    c.stroke();
  } else if (species === 1) {
    // mouche — petit corps rond + deux ailes latérales écartées
    c.beginPath();
    c.ellipse(-3.2 * S, -1.4 * S, 2.6 * S, 1.3 * S, -0.85, 0, Math.PI * 2);
    c.ellipse(3.2 * S, -1.4 * S, 2.6 * S, 1.3 * S, 0.85, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.beginPath();
    c.arc(0, 1.2 * S, 2.6 * S, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  } else {
    // cafard — trait effilé
    c.beginPath();
    c.moveTo(0, -6 * S);
    c.quadraticCurveTo(2.6 * S, 0, 0, 6 * S);
    c.quadraticCurveTo(-2.6 * S, 0, 0, -6 * S);
    c.fill();
    c.stroke();
  }
  if (slot >= 1) {
    // cœur évidé des camps IA (signal non-couleur, WCAG)
    c.fillStyle = 'rgba(0,0,0,0.75)';
    c.beginPath();
    c.arc(0, species === 1 ? 1.2 * S : 0.4 * S, 1.3 * S, 0, Math.PI * 2);
    c.fill();
  }
}

/**
 * Frames d'unités : silhouettes DISTINCTES par espèce × teinte par faction —
 * lisible sans la couleur. Couleur cuite dans la frame, UNE SEULE source →
 * orbites + unités en vol se batchent (uv dynamique).
 * Layout : [mote | 9 frames espèce×faction | spark].
 */
function makeUnitAtlas(): { unitMote: Texture; unitFrames: Texture[][]; spark: Texture } {
  const cell = 16 * S;
  const cells = 1 + SPECIES_IDS.length * FACTION_SLOTS + 1;
  const c = ctx2d(cell * cells, cell);
  const mid = cell / 2;

  // frame 0 : mote neutre (petit disque gris)
  c.fillStyle = hex(PALETTE.neutral);
  c.strokeStyle = 'rgba(0,0,0,0.5)';
  c.lineWidth = S;
  c.beginPath();
  c.arc(mid, mid, 3.4 * S, 0, Math.PI * 2);
  c.fill();
  c.stroke();

  // frames 1..9 : espèce × faction
  for (let sp = 0; sp < SPECIES_IDS.length; sp++) {
    for (let slot = 0; slot < FACTION_SLOTS; slot++) {
      c.save();
      c.translate(cell * (1 + sp * FACTION_SLOTS + slot) + mid, mid);
      drawUnitSilhouette(c, sp, slot);
      c.restore();
    }
  }

  // dernière frame : spark blanc (fx, à teinter)
  c.save();
  c.translate(cell * (cells - 1) + mid, mid);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 5 * S);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(-mid, -mid, cell, cell);
  c.restore();

  const source = Texture.from(c.canvas).source;
  const frame = (i: number): Texture => new Texture({ source, frame: new Rectangle(cell * i, 0, cell, cell) });
  const unitFrames = SPECIES_IDS.map((_, sp) =>
    Array.from({ length: FACTION_SLOTS }, (__, slot) => frame(1 + sp * FACTION_SLOTS + slot)),
  );
  return { unitMote: frame(0), unitFrames, spark: frame(cells - 1) };
}

export function buildAtlas(): Atlas {
  const { unitMote, unitFrames, spark } = makeUnitAtlas();
  return {
    nodeBodyNeutral: makeNeutralBody(),
    nodeBodies: SPECIES_IDS.map((_, sp) => Array.from({ length: FACTION_SLOTS }, (__, slot) => makeNodeBody(sp, slot))),
    ring: makeRing(),
    unitMote,
    unitFrames,
    spark,
    groundTiles: HIVE_BIOMES.map((_, i) => makeGroundTile(i)),
    decor: buildDecorSets(),
  };
}
