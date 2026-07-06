import { Rectangle, Texture } from 'pixi.js';

/**
 * Atlas placeholder généré en code : un seul canvas source → toutes les frames
 * partagent la même texture de base, donc la scène tient en quelques draw calls
 * (contrainte des ParticleContainer : même source pour toutes les particules).
 */
export interface Atlas {
  soldier: Texture;
  bullet: Texture;
  enemyByKind: readonly Texture[]; // indexé par ENEMY_KINDS : grunt, runner, brute, kamikaze, sniper, élite
  white: Texture; // rect blanc, à teinter (portes, bannières)
  spark: Texture; // disque blanc, à teinter (particules d'effets, marqueurs)
  lance: Texture; // projectile du boss
  bolt: Texture; // projectile du sniper
  drone: Texture; // drone allié (caisse bonus)
  crate: Texture; // bois (PV)
  crateExplosive: Texture;
  crateBonus: Texture;
  boss: Texture;
  mine: Texture;
  grounds: readonly Texture[]; // un motif de voie par biome (sources séparées)
}

/** Palettes de biomes : pont/eau, désert, neige, nuit — tournent avec les niveaux. */
const BIOMES = [
  { side: '#17456b', sideDetail: '#0f3a5c', rail: '#8d99a6', road: '#4a545e', roadAlt: '#515c67', seam: '#3d454e' },
  { side: '#d4a373', sideDetail: '#c2905e', rail: '#926c43', road: '#9c6f2f', roadAlt: '#a87a36', seam: '#845c26' },
  { side: '#dbeafe', sideDetail: '#c6dcf8', rail: '#94a3b8', road: '#64748b', roadAlt: '#6b7f94', seam: '#526075' },
  { side: '#0b1222', sideDetail: '#0e1830', rail: '#334155', road: '#1e293b', roadAlt: '#243244', seam: '#16202e' },
] as const;

function circle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string,
  border: string,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = border;
  ctx.stroke();
}

function drawCrate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  base: string,
  edge: string,
  cross: string,
): void {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, 96, 56);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, 93, 53);
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 2, y + i * 14);
    ctx.lineTo(x + 94, y + i * 14);
    ctx.stroke();
  }
  ctx.strokeStyle = cross;
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 4);
  ctx.lineTo(x + 92, y + 52);
  ctx.moveTo(x + 92, y + 4);
  ctx.lineTo(x + 4, y + 52);
  ctx.stroke();
}

export function buildAtlas(): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  // soldat (0,0,20,20) — bleu, casque clair, canon vers l'avant
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(8.5, 0, 3, 7); // canon
  circle(ctx, 10, 10, 8, '#3b82f6', '#1d4ed8');
  circle(ctx, 10, 7, 4, '#93c5fd', '#1d4ed8');
  // balle (32,0,8,16) — traçante jaune
  ctx.fillStyle = '#ffd54a';
  ctx.beginPath();
  ctx.roundRect(33, 1, 6, 14, 3);
  ctx.fill();
  ctx.fillStyle = '#fff7cf';
  ctx.fillRect(34.5, 2, 3, 6);
  // grunt (0,32,20,20) — rouge
  circle(ctx, 10, 42, 8.5, '#ef4444', '#991b1b');
  // runner (32,32,18,18) — orange
  circle(ctx, 41, 41, 7.5, '#f97316', '#9a3412');
  // brute (64,32,32,32) — rouge sombre, double cercle
  circle(ctx, 80, 48, 14.5, '#b91c1c', '#450a0a');
  circle(ctx, 80, 48, 8, '#7f1d1d', '#450a0a');
  // kamikaze (48,0,20,20) — bombe orange, mèche
  circle(ctx, 58, 11, 8, '#fb923c', '#9a3412');
  ctx.fillStyle = '#fde68a';
  ctx.fillRect(56.5, 1, 3, 5);
  // sniper (72,0,20,20) — violet, capuche sombre
  circle(ctx, 82, 10, 8, '#a855f7', '#581c87');
  circle(ctx, 82, 8, 4.5, '#581c87', '#3b0764');
  // élite (200,34,28,28) — acier bleuté, anneau blindé
  circle(ctx, 214, 48, 12.5, '#64748b', '#1e293b');
  circle(ctx, 214, 48, 7, '#334155', '#0f172a');
  // bolt du sniper (232,0,10,20) — dard violet
  ctx.fillStyle = '#a855f7';
  ctx.beginPath();
  ctx.roundRect(234, 1, 6, 17, 3);
  ctx.fill();
  ctx.fillStyle = '#e9d5ff';
  ctx.fillRect(235.5, 12, 3, 5);
  // drone allié (120,130,24,14) — aile bleue
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.moveTo(132, 130);
  ctx.lineTo(144, 140);
  ctx.lineTo(132, 137);
  ctx.lineTo(120, 140);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0ea5e9';
  ctx.fillRect(130, 134, 4, 8);
  // blanc (112,0,12,12)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(112, 0, 12, 12);
  // lance du boss (200,0,12,30) — dard rouge sombre pointe claire, pointe vers le bas
  ctx.fillStyle = '#7f1d1d';
  ctx.beginPath();
  ctx.moveTo(206, 30); // pointe
  ctx.lineTo(212, 8);
  ctx.quadraticCurveTo(206, 2, 200, 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fca5a5';
  ctx.beginPath();
  ctx.moveTo(206, 30);
  ctx.lineTo(209, 16);
  ctx.lineTo(203, 16);
  ctx.closePath();
  ctx.fill();
  // mine (232,32,22,22) — disque sombre, picots, témoin rouge (le clignotement est fait en jeu)
  circle(ctx, 243, 43, 9, '#1f2937', '#0b1016');
  ctx.fillStyle = '#374151';
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    ctx.fillRect(243 + Math.cos(a) * 8 - 1.5, 43 + Math.sin(a) * 8 - 1.5, 3, 3);
  }
  circle(ctx, 243, 43, 3, '#ef4444', '#7f1d1d');
  // spark : disque blanc doux (112,16,12,12)
  const grad = ctx.createRadialGradient(118, 22, 1, 118, 22, 6);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0.15)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(118, 22, 6, 0, Math.PI * 2);
  ctx.fill();
  // caisses (96×56) : bois (0,64), explosive (100,64), bonus dorée (0,124)
  drawCrate(ctx, 0, 64, '#b98a4a', '#8a6234', '#77542c');
  drawCrate(ctx, 100, 64, '#dc2626', '#7f1d1d', '#450a0a');
  ctx.fillStyle = '#fde68a'; // pastille « danger » de la caisse explosive
  ctx.beginPath();
  ctx.arc(148, 92, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7f1d1d';
  ctx.font = '900 17px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 148, 93);
  drawCrate(ctx, 0, 124, '#f59e0b', '#b45309', '#92400e');
  // boss (150,130,44,44) — masse sombre à pointes, œil
  const bx = 172;
  const by = 152;
  ctx.fillStyle = '#7f1d1d';
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(bx + Math.cos(a - 0.24) * 15, by + Math.sin(a - 0.24) * 15);
    ctx.lineTo(bx + Math.cos(a) * 21.5, by + Math.sin(a) * 21.5);
    ctx.lineTo(bx + Math.cos(a + 0.24) * 15, by + Math.sin(a + 0.24) * 15);
    ctx.closePath();
    ctx.fill();
  }
  circle(ctx, bx, by, 15, '#b91c1c', '#450a0a');
  circle(ctx, bx, by, 8.5, '#7f1d1d', '#450a0a');
  circle(ctx, bx, by, 4, '#fbbf24', '#92400e'); // œil

  const source = Texture.from(canvas).source;
  const frame = (x: number, y: number, w: number, h: number): Texture =>
    new Texture({ source, frame: new Rectangle(x, y, w, h) });

  return {
    soldier: frame(0, 0, 20, 20),
    bullet: frame(32, 0, 8, 16),
    enemyByKind: [
      frame(0, 32, 20, 20), // grunt
      frame(32, 32, 18, 18), // runner
      frame(64, 32, 32, 32), // brute
      frame(48, 0, 20, 20), // kamikaze
      frame(72, 0, 20, 20), // sniper
      frame(200, 34, 28, 28), // élite
    ],
    white: frame(113, 1, 10, 10),
    spark: frame(112, 16, 12, 12),
    lance: frame(200, 0, 12, 30),
    bolt: frame(232, 0, 10, 20),
    drone: frame(120, 130, 24, 14),
    crate: frame(0, 64, 96, 56),
    crateExplosive: frame(100, 64, 96, 56),
    crateBonus: frame(0, 124, 96, 56),
    boss: frame(150, 130, 44, 44),
    mine: frame(232, 32, 22, 22),
    grounds: BIOMES.map((b) => buildGroundPattern(b)),
  };
}

/** Motif de voie : bas-côtés, rambardes, chaussée avec joints réguliers. */
function buildGroundPattern(biome: (typeof BIOMES)[number]): Texture {
  const w = 540;
  const h = 240;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = biome.side;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = biome.sideDetail;
  for (let y = 0; y < h; y += 30) {
    ctx.fillRect(0, y, 24, 12);
    ctx.fillRect(w - 24, y + 15, 24, 12);
  }
  ctx.fillStyle = biome.rail;
  ctx.fillRect(24, 0, 14, h);
  ctx.fillRect(w - 38, 0, 14, h);
  ctx.fillStyle = biome.road;
  ctx.fillRect(38, 0, w - 76, h);
  ctx.fillStyle = biome.roadAlt;
  ctx.fillRect(38, 0, w - 76, h / 2);
  ctx.strokeStyle = biome.seam;
  ctx.lineWidth = 4;
  for (const y of [0, h / 2]) {
    ctx.beginPath();
    ctx.moveTo(38, y + 2);
    ctx.lineTo(w - 38, y + 2);
    ctx.stroke();
  }
  return Texture.from(canvas);
}
