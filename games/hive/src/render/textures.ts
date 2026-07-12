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
  honeyTile: Texture; // tuile de fond alvéolée, non interactive
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

/** Tuile de fond alvéolée, tons très sombres (le décor ne code jamais un danger). */
function makeHoneyTile(): Texture {
  const cell = 36 * S;
  const w = cell * 3;
  const h = Math.round(cell * 1.732);
  const c = ctx2d(w, h);
  c.fillStyle = hex(PALETTE.bg);
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(246, 185, 59, 0.06)';
  c.lineWidth = 2 * S;
  const rr = cell * 0.58;
  const drawHex = (cx: number, cy: number): void => {
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
  };
  for (let row = -1; row <= 2; row++) {
    for (let col = -1; col <= 3; col++) {
      const cx = col * cell * 1.5 + (row % 2 === 0 ? 0 : cell * 0.75);
      drawHex(cx, (row * h) / 2);
    }
  }
  return toTexture(c);
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
    honeyTile: makeHoneyTile(),
  };
}
