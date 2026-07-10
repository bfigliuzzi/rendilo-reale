import { Rectangle, Texture } from 'pixi.js';
import { NODE_LEVELS } from '../config/balance';
import type { Faction } from '../config/levels';

// Toutes les textures sont générées en canvas, dessinées à leur taille d'affichage
// réelle ×2 (leçon horde : jamais de petite frame étirée). Accessibilité : chaque
// faction se lit à la FORME (hexagone / goutte anguleuse / cercle) et au GLYPHE
// (abeille / cafard), jamais à la couleur seule.

export const PALETTE = {
  bg: 0x171208, // nuit de miel
  player: 0xf6b93b, // ambre abeille
  playerDark: 0x8a5f13,
  enemy: 0x9c4a1a, // brun cafard
  enemyDark: 0x4a1f08,
  neutral: 0x8b98a8, // gris neutre
  neutralDark: 0x3d4652,
  select: 0xffe9a8, // anneau de sélection
} as const;

export interface Atlas {
  nodeBody: readonly Texture[]; // indexé par Faction (0 neutre, 1 abeilles, 2 cafards)
  ring: Texture; // anneau HD blanc, à teinter (sélection, flash de capture)
  unitByFaction: readonly Texture[]; // frames d'unités, indexé par Faction (0 = mote)
  spark: Texture; // disque blanc à teinter (fx)
  honeyTile: Texture; // tuile de fond alvéolée, non interactive
}

const S = 2; // supersampling

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

/** Corps de nœud : forme + remplissage + glyphe intégré (swap de texture = tout change). */
function makeNodeBody(faction: Faction): Texture {
  const r = NODE_LEVELS[0].radius * S;
  const pad = 6 * S;
  const size = (r + pad) * 2;
  const c = ctx2d(size, size);
  const cx = size / 2;
  const cy = size / 2;
  c.lineWidth = 3.5 * S;

  if (faction === 1) {
    // abeilles : HEXAGONE alvéole
    c.fillStyle = hex(PALETTE.player);
    c.strokeStyle = hex(PALETTE.playerDark);
    c.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 3;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (k === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
    c.fill();
    c.stroke();
    drawBeeGlyph(c, cx, cy - r * 0.05, r * 0.52);
  } else if (faction === 2) {
    // cafards : GOUTTE ANGULEUSE (écusson pointé vers le bas)
    c.fillStyle = hex(PALETTE.enemy);
    c.strokeStyle = hex(PALETTE.enemyDark);
    c.beginPath();
    c.moveTo(cx, cy - r);
    c.lineTo(cx + r * 0.92, cy - r * 0.25);
    c.lineTo(cx + r * 0.6, cy + r * 0.62);
    c.lineTo(cx, cy + r);
    c.lineTo(cx - r * 0.6, cy + r * 0.62);
    c.lineTo(cx - r * 0.92, cy - r * 0.25);
    c.closePath();
    c.fill();
    c.stroke();
    drawRoachGlyph(c, cx, cy - r * 0.06, r * 0.5);
  } else {
    // neutres : CERCLE terne + anneau intérieur pointillé, pas de glyphe
    c.fillStyle = hex(PALETTE.neutral);
    c.strokeStyle = hex(PALETTE.neutralDark);
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.setLineDash([5 * S, 6 * S]);
    c.lineWidth = 2.5 * S;
    c.beginPath();
    c.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
  }
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

/**
 * Frames d'unités : silhouettes DISTINCTES par faction (ovale trapu abeille vs
 * trait effilé cafard) — lisible sans la couleur. Couleur cuite dans la frame,
 * une seule source → orbites + unités en vol se batchent (uv dynamique).
 */
function makeUnitAtlas(): { unitByFaction: Texture[]; spark: Texture } {
  const cell = 16 * S;
  const c = ctx2d(cell * 4, cell);
  const mid = cell / 2;

  // frame 0 : mote neutre (petit disque gris)
  c.fillStyle = hex(PALETTE.neutral);
  c.strokeStyle = 'rgba(0,0,0,0.5)';
  c.lineWidth = S;
  c.beginPath();
  c.arc(mid, mid, 3.4 * S, 0, Math.PI * 2);
  c.fill();
  c.stroke();

  // frame 1 : abeille — ovale trapu ambre rayé
  c.save();
  c.translate(cell + mid, mid);
  c.fillStyle = hex(PALETTE.player);
  c.strokeStyle = 'rgba(0,0,0,0.7)';
  c.lineWidth = S;
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
  c.restore();

  // frame 2 : cafard — trait effilé brun
  c.save();
  c.translate(cell * 2 + mid, mid);
  c.fillStyle = hex(PALETTE.enemy);
  c.strokeStyle = 'rgba(0,0,0,0.7)';
  c.lineWidth = S;
  c.beginPath();
  c.moveTo(0, -6 * S);
  c.quadraticCurveTo(2.6 * S, 0, 0, 6 * S);
  c.quadraticCurveTo(-2.6 * S, 0, 0, -6 * S);
  c.fill();
  c.stroke();
  c.restore();

  // frame 3 : spark blanc (fx, à teinter)
  c.save();
  c.translate(cell * 3 + mid, mid);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 5 * S);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(-mid, -mid, cell, cell);
  c.restore();

  const source = Texture.from(c.canvas).source;
  const frame = (i: number): Texture => new Texture({ source, frame: new Rectangle(cell * i, 0, cell, cell) });
  return { unitByFaction: [frame(0), frame(1), frame(2)], spark: frame(3) };
}

export function buildAtlas(): Atlas {
  const { unitByFaction, spark } = makeUnitAtlas();
  return {
    nodeBody: [makeNodeBody(0), makeNodeBody(1), makeNodeBody(2)],
    ring: makeRing(),
    unitByFaction,
    spark,
    honeyTile: makeHoneyTile(),
  };
}
