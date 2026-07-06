import { Rectangle, Texture } from 'pixi.js';

/**
 * Atlas placeholder généré en code : un seul canvas source → toutes les frames
 * partagent la même texture de base, donc la scène tient en quelques draw calls
 * (contrainte des ParticleContainer : même source pour toutes les particules).
 */
export interface Atlas {
  soldier: Texture;
  bullet: Texture;
  enemyByKind: readonly [Texture, Texture, Texture]; // grunt, runner, brute
  white: Texture; // rect blanc, à teinter (portes, bannières)
  crate: Texture;
  ground: Texture; // motif de la voie, pour TilingSprite (source séparée)
}

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

export function buildAtlas(): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  // soldat (0,0,20,20) — bleu, casque clair
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
  // blanc (112,0,12,12)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(112, 0, 12, 12);
  // caisse (0,64,96,56) — planches bois
  ctx.fillStyle = '#b98a4a';
  ctx.fillRect(0, 64, 96, 56);
  ctx.strokeStyle = '#8a6234';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 65.5, 93, 53);
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(2, 64 + i * 14);
    ctx.lineTo(94, 64 + i * 14);
    ctx.stroke();
  }
  ctx.strokeStyle = '#77542c';
  ctx.beginPath();
  ctx.moveTo(4, 68);
  ctx.lineTo(92, 116);
  ctx.moveTo(92, 68);
  ctx.lineTo(4, 116);
  ctx.stroke();

  const source = Texture.from(canvas).source;
  const frame = (x: number, y: number, w: number, h: number): Texture =>
    new Texture({ source, frame: new Rectangle(x, y, w, h) });

  return {
    soldier: frame(0, 0, 20, 20),
    bullet: frame(32, 0, 8, 16),
    enemyByKind: [frame(0, 32, 20, 20), frame(32, 32, 18, 18), frame(64, 32, 32, 32)],
    white: frame(113, 1, 10, 10),
    crate: frame(0, 64, 96, 56),
    ground: buildGroundPattern(),
  };
}

/** Motif du pont : eau sur les côtés, rambardes, asphalte avec joints réguliers. */
function buildGroundPattern(): Texture {
  const w = 540;
  const h = 240;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#17456b'; // eau
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#0f3a5c';
  for (let y = 0; y < h; y += 30) {
    ctx.fillRect(0, y, 24, 12);
    ctx.fillRect(w - 24, y + 15, 24, 12);
  }
  ctx.fillStyle = '#8d99a6'; // rambardes
  ctx.fillRect(24, 0, 14, h);
  ctx.fillRect(w - 38, 0, 14, h);
  ctx.fillStyle = '#4a545e'; // asphalte
  ctx.fillRect(38, 0, w - 76, h);
  ctx.fillStyle = '#515c67';
  ctx.fillRect(38, 0, w - 76, h / 2);
  ctx.strokeStyle = '#3d454e'; // joints
  ctx.lineWidth = 4;
  for (const y of [0, h / 2]) {
    ctx.beginPath();
    ctx.moveTo(38, y + 2);
    ctx.lineTo(w - 38, y + 2);
    ctx.stroke();
  }
  return Texture.from(canvas);
}
