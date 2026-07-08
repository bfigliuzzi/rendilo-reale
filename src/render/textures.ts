import { Rectangle, Texture } from 'pixi.js';
import { BIOME_COUNT } from '../config/balance';
import { mulberry32 } from '../core/rng';

/**
 * Atlas placeholder généré en code : un seul canvas source → toutes les frames
 * partagent la même texture de base, donc la scène tient en quelques draw calls
 * (contrainte des ParticleContainer : même source pour toutes les particules).
 */
export interface Atlas {
  soldier: Texture;
  soldierSniper: Texture;
  soldierArt: Texture;
  bullet: Texture;
  bulletSniper: Texture;
  bulletShell: Texture;
  enemyByKind: readonly Texture[]; // indexé par ENEMY_KINDS : grunt, runner, brute, kamikaze, sniper, élite
  enemyAlt: readonly Texture[]; // 2e frame de marche (membres alternés) — swap d'uv au rendu
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
  // marqueurs de danger, blancs à teinter, LISERÉ NOIR INTÉGRÉ (le tint ne
  // touche que le blanc) : contraste ≥ 3:1 garanti sur tout biome (WCAG 1.4.11)
  ring: Texture; // limite de zone (frappes de missiles)
  ringDashed: Texture; // périmètre pointillé (halo de mine — distinct des frappes)
  cross: Texture; // glyphe « frappe chirurgicale »
  trefoil: Texture; // glyphe radiologique (frappe atomique)
  spikes: Texture; // bande de pics tuilable (source séparée, pour TilingSprite)
  grounds: readonly Texture[]; // un motif de voie par biome (sources séparées)
  leaf: Texture; // feuille à teinter (météo de la jungle)
  decor: readonly DecorSet[]; // props non interactifs, un jeu par biome
}

/** Prop de décor : `sway` = amplitude d'oscillation (0 = rigide), `weight` = poids de tirage. */
export interface DecorProp {
  tex: Texture;
  sway: number;
  weight: number;
}

/** Décor d'un biome : props de bas-côté (ancrés au pied) + détails discrets de chaussée. */
export interface DecorSet {
  props: readonly DecorProp[];
  ground: readonly Texture[];
}

/**
 * Palettes des biomes : ville, désert, campagne, jungle, savane, sibérie —
 * tirés au seed de la run (campaign.ts). Les chaussées restent des tons
 * moyens/sombres : les marqueurs de danger gardent leur double lecture
 * (blanc sur biomes sombres, liseré noir intégré sur les clairs — WCAG 1.4.11).
 */
const BIOMES = [
  { side: '#646e78', sideDetail: '#57616c', rail: '#8d99a6', road: '#3f474f', roadAlt: '#454d56', seam: '#2e353c' }, // ville
  { side: '#d9b072', sideDetail: '#cba15f', rail: '#a8825a', road: '#a1743a', roadAlt: '#a97c40', seam: '#82602e' }, // désert
  { side: '#5a8f3c', sideDetail: '#4e8033', rail: '#6fa34c', road: '#8b7355', roadAlt: '#93795b', seam: '#6f5c44' }, // campagne
  { side: '#1d5c33', sideDetail: '#17502b', rail: '#2e7d44', road: '#5d4a33', roadAlt: '#65523a', seam: '#463724' }, // jungle
  { side: '#c9a84c', sideDetail: '#bb9a41', rail: '#a58838', road: '#96683a', roadAlt: '#9e7040', seam: '#75512c' }, // savane
  { side: '#e5edf5', sideDetail: '#d5e2ee', rail: '#b6c5d4', road: '#8fa3b5', roadAlt: '#97abbd', seam: '#71879b' }, // sibérie
] as const;

function circle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string,
  border: string,
  lw = 2.5,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = border;
  ctx.stroke();
}

function oval(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string,
  border: string,
  lw = 2.5,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = border;
  ctx.stroke();
}

/** Deux yeux tournés vers le bas (vers le joueur) : blanc + pupille sombre. */
function eyes(ctx: CanvasRenderingContext2D, cx: number, cy: number, gap: number, r: number): void {
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx + s * gap, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#450a0a';
    ctx.beginPath();
    ctx.arc(cx + s * gap, cy + r * 0.35, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Caisse 96×56 : planches à deux tons, sangles métalliques rivetées, équerres d'angle. */
function drawCrate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  base: string,
  baseAlt: string,
  edge: string,
  metal: string,
): void {
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? base : baseAlt;
    ctx.fillRect(x, y + i * 14, 96, 14);
  }
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 2, y + i * 14);
    ctx.lineTo(x + 94, y + i * 14);
    ctx.stroke();
  }
  // sangles verticales rivetées
  ctx.fillStyle = metal;
  ctx.fillRect(x + 14, y + 2, 7, 52);
  ctx.fillRect(x + 75, y + 2, 7, 52);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 14, y + 2, 7, 52);
  ctx.strokeRect(x + 75, y + 2, 7, 52);
  ctx.fillStyle = edge;
  for (const px of [17.5, 78.5]) {
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(x + px, y + 7 + i * 14, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // équerres d'angle (L métalliques)
  ctx.fillStyle = metal;
  ctx.fillRect(x + 2, y + 2, 10, 4);
  ctx.fillRect(x + 2, y + 2, 4, 10);
  ctx.fillRect(x + 84, y + 2, 10, 4);
  ctx.fillRect(x + 90, y + 2, 4, 10);
  ctx.fillRect(x + 2, y + 50, 10, 4);
  ctx.fillRect(x + 2, y + 44, 4, 10);
  ctx.fillRect(x + 84, y + 50, 10, 4);
  ctx.fillRect(x + 90, y + 44, 4, 10);
  // cadre
  ctx.strokeStyle = edge;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, 93, 53);
}

export function buildAtlas(): Atlas {
  if (BIOMES.length !== BIOME_COUNT) throw new Error('BIOMES désynchronisé de BIOME_COUNT');
  const canvas = document.createElement('canvas');
  canvas.width = 384; // bande x=256..384 : personnages (2 frames de marche) + boss
  canvas.height = 256; // bande y=192..256 : marqueurs de danger + mine
  const ctx = canvas.getContext('2d')!;

  // balle (32,0,8,16) — traçante jaune
  ctx.fillStyle = '#ffd54a';
  ctx.beginPath();
  ctx.roundRect(33, 1, 6, 14, 3);
  ctx.fill();
  ctx.fillStyle = '#fff7cf';
  ctx.fillRect(34.5, 2, 3, 6);
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
  // balle sniper (200,70,6,20) — trait cyan
  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.roundRect(201, 70, 4, 19, 2);
  ctx.fill();
  ctx.fillStyle = '#cffafe';
  ctx.fillRect(202, 71, 2, 8);
  // obus artilleur (216,70,14,14) — boule sombre à lueur
  circle(ctx, 223, 77, 6, '#475569', '#1e293b');
  circle(ctx, 223, 75.5, 2.5, '#fbbf24', '#92400e');
  // spark : disque blanc doux (112,16,12,12)
  const grad = ctx.createRadialGradient(118, 22, 1, 118, 22, 6);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0.15)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(118, 22, 6, 0, Math.PI * 2);
  ctx.fill();
  // caisses (96×56) : bois (0,64), explosive (100,64), bonus dorée (0,124)
  drawCrate(ctx, 0, 64, '#c1955a', '#b0854a', '#77542c', '#6b7280');
  drawCrate(ctx, 100, 64, '#dc2626', '#c62222', '#450a0a', '#374151');
  // triangle « danger » de la caisse explosive
  ctx.beginPath();
  ctx.moveTo(148, 78);
  ctx.lineTo(161, 102);
  ctx.lineTo(135, 102);
  ctx.closePath();
  ctx.fillStyle = '#fde68a';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#450a0a';
  ctx.stroke();
  ctx.fillStyle = '#7f1d1d';
  ctx.font = '900 17px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 148, 94);
  drawCrate(ctx, 0, 124, '#f5a623', '#e0940e', '#92400e', '#b45309');
  // reflet diagonal de la caisse bonus (elle « brille »)
  ctx.save();
  ctx.beginPath();
  ctx.rect(2, 126, 92, 52);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,247,207,0.5)';
  ctx.beginPath();
  ctx.moveTo(18, 126);
  ctx.lineTo(34, 126);
  ctx.lineTo(10, 178);
  ctx.lineTo(-6, 178);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- bande y=192..256 : marqueurs de danger, blanc à teinter + liseré noir ---
  // le tint Pixi multiplie : le blanc prend la couleur, le noir reste noir —
  // c'est le liseré qui garantit la lecture sur les biomes clairs (désert, neige)
  const outlined = (draw: (pass: 'edge' | 'body') => void): void => {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 9;
    draw('edge');
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    draw('body');
  };
  // anneau plein (0,192,64,64) — limite de zone des frappes
  outlined(() => {
    ctx.beginPath();
    ctx.arc(32, 224, 26, 0, Math.PI * 2);
    ctx.stroke();
  });
  // anneau pointillé (64,192,64,64) — halo de mine, distinct des frappes
  ctx.setLineDash([9, 8]);
  outlined(() => {
    ctx.beginPath();
    ctx.arc(96, 224, 26, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  // croix (128,192,32,32) — glyphe « frappe chirurgicale »
  ctx.lineCap = 'round';
  outlined(() => {
    ctx.beginPath();
    ctx.moveTo(134, 198);
    ctx.lineTo(154, 218);
    ctx.moveTo(154, 198);
    ctx.lineTo(134, 218);
    ctx.stroke();
  });
  ctx.lineCap = 'butt';
  // trèfle radiologique (160,192,40,40) — trois pales + moyeu
  const blade = (a: number, r0: number, r1: number, half: number, fill: string): void => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(180, 212, r1, a - half, a + half);
    ctx.arc(180, 212, r0, a + half, a - half, true);
    ctx.closePath();
    ctx.fill();
  };
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k / 3) * Math.PI * 2;
    blade(a, 5.5, 19, 0.62, '#000000');
    blade(a, 8, 17, 0.48, '#ffffff');
  }
  circle(ctx, 180, 212, 5.5, '#ffffff', '#000000');
  // mine (208,192,28,28) — corps sombre, jupe hachurée jaune/noir (code danger
  // universel : lisible quelle que soit la vision), témoin blanc à cœur rouge
  circle(ctx, 222, 206, 12, '#111827', '#000000');
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 4.5;
  ctx.setLineDash([5, 4.5]);
  ctx.beginPath();
  ctx.arc(222, 206, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  circle(ctx, 222, 206, 5, '#ffffff', '#000000');
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(222, 206, 3, 0, Math.PI * 2);
  ctx.fill();
  // feuille (238,226,16,16) — blanche à teinter (météo jungle) : ellipse inclinée + nervure
  ctx.save();
  ctx.translate(246, 234);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.2, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -5.5);
  ctx.lineTo(0, 5.5);
  ctx.stroke();
  ctx.restore();

  // --- bande x=256..384 : personnages (2 frames de marche chacun) + boss ---
  drawCharacters(ctx);

  const source = Texture.from(canvas).source;
  const frame = (x: number, y: number, w: number, h: number): Texture =>
    new Texture({ source, frame: new Rectangle(x, y, w, h) });

  return {
    soldier: frame(258, 136, 22, 28),
    soldierSniper: frame(284, 136, 22, 28),
    soldierArt: frame(310, 136, 22, 28),
    bullet: frame(32, 0, 8, 16),
    bulletSniper: frame(200, 70, 6, 20),
    bulletShell: frame(216, 70, 14, 14),
    enemyByKind: [
      frame(258, 2, 22, 22), // grunt
      frame(310, 2, 20, 22), // runner
      frame(258, 94, 36, 38), // brute
      frame(258, 28, 22, 26), // kamikaze
      frame(310, 28, 22, 24), // sniper
      frame(258, 58, 30, 32), // élite
    ],
    enemyAlt: [
      frame(284, 2, 22, 22),
      frame(334, 2, 20, 22),
      frame(298, 94, 36, 38),
      frame(284, 28, 22, 26),
      frame(336, 28, 22, 24),
      frame(292, 58, 30, 32),
    ],
    white: frame(113, 1, 10, 10),
    spark: frame(112, 16, 12, 12),
    lance: frame(200, 0, 12, 30),
    bolt: frame(232, 0, 10, 20),
    drone: frame(120, 130, 24, 14),
    crate: frame(0, 64, 96, 56),
    crateExplosive: frame(100, 64, 96, 56),
    crateBonus: frame(0, 124, 96, 56),
    boss: frame(258, 168, 76, 76),
    mine: frame(208, 192, 28, 28),
    ring: frame(0, 192, 64, 64),
    ringDashed: frame(64, 192, 64, 64),
    cross: frame(128, 192, 32, 32),
    trefoil: frame(160, 192, 40, 40),
    spikes: buildSpikesPattern(),
    grounds: BIOMES.map((b, i) => buildGroundPattern(b, i)),
    leaf: frame(238, 226, 16, 16),
    decor: buildDecorSets(),
  };
}

/**
 * Bande de pics tuilable (TilingSprite) : socle sombre à hachures jaunes
 * (code danger universel, comme les mines) + pointes acier à liseré noir —
 * lisible sur les 4 biomes et quelle que soit la vision des couleurs.
 */
function buildSpikesPattern(): Texture {
  const w = 96;
  const h = 26;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  // socle : bande sombre bordée de noir, hachures jaunes
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, h - 10, w, 10);
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0, h - 8, w, 6);
  ctx.fillStyle = '#facc15';
  for (let x = 2; x < w; x += 12) ctx.fillRect(x, h - 7, 6, 4);
  // pointes : triangles acier, contour noir épais
  for (let x = 0; x < w; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x + 2, h - 8);
    ctx.lineTo(x + 12, 2);
    ctx.lineTo(x + 22, h - 8);
    ctx.closePath();
    ctx.fillStyle = '#cbd5e1';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.stroke();
    // arête claire : lecture du relief
    ctx.beginPath();
    ctx.moveTo(x + 12, 4);
    ctx.lineTo(x + 8, h - 9);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#f8fafc';
    ctx.stroke();
  }
  return Texture.from(canvas);
}

/**
 * Motif de voie : bas-côtés mouchetés, rambardes à plots, chaussée avec joints
 * et taches d'usure. Tuile haute (480 px) pour casser la répétition visible ;
 * moucheté seedé par index de biome (déterministe, pas de Math.random).
 */
function buildGroundPattern(biome: (typeof BIOMES)[number], index: number): Texture {
  const w = 540;
  const h = 480;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(0xb10e + index * 101);

  ctx.fillStyle = biome.side;
  ctx.fillRect(0, 0, w, h);
  // bas-côtés : moucheté organique à deux tons plutôt que des pavés réguliers
  for (let k = 0; k < 90; k++) {
    const left = rand() < 0.5;
    const x = left ? rand() * 22 : w - 22 + rand() * 22;
    const y = rand() * h;
    const r = 2 + rand() * 6;
    ctx.fillStyle = rand() < 0.6 ? biome.sideDetail : biome.rail;
    ctx.globalAlpha = 0.5 + rand() * 0.5;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + rand() * 0.6), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // rambardes : lisses continues + plots réguliers plus sombres
  ctx.fillStyle = biome.rail;
  ctx.fillRect(24, 0, 14, h);
  ctx.fillRect(w - 38, 0, 14, h);
  ctx.fillStyle = biome.seam;
  for (let y = 10; y < h; y += 60) {
    ctx.fillRect(24, y, 14, 6);
    ctx.fillRect(w - 38, y + 30, 14, 6);
  }
  // chaussée : bandes alternées + joints
  ctx.fillStyle = biome.road;
  ctx.fillRect(38, 0, w - 76, h);
  ctx.fillStyle = biome.roadAlt;
  for (let y = 0; y < h; y += 240) ctx.fillRect(38, y, w - 76, 120);
  ctx.strokeStyle = biome.seam;
  ctx.lineWidth = 4;
  for (let y = 0; y < h; y += 120) {
    ctx.beginPath();
    ctx.moveTo(38, y + 2);
    ctx.lineTo(w - 38, y + 2);
    ctx.stroke();
  }
  // usure : taches et griffures discrètes, dans les tons de la chaussée
  for (let k = 0; k < 26; k++) {
    const x = 60 + rand() * (w - 120);
    const y = rand() * h;
    ctx.fillStyle = rand() < 0.5 ? biome.seam : biome.roadAlt;
    ctx.globalAlpha = 0.16 + rand() * 0.2;
    ctx.beginPath();
    ctx.ellipse(x, y, 4 + rand() * 14, 2 + rand() * 5, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return Texture.from(canvas);
}

/**
 * Personnages de la bande x=256..384. Vue de dessus stylisée : les ennemis
 * regardent vers le bas (vers le joueur), les soldats vers le haut. Chaque
 * ennemi existe en DEUX frames (membres alternés, `po` = ±1) : le swap d'uv
 * au rendu donne le cycle de marche — les silhouettes ne sont plus des ronds
 * en translation.
 */
function drawCharacters(ctx: CanvasRenderingContext2D): void {
  // — grunt 22×22 : trapu, deux poings, regard mauvais —
  const grunt = (x: number, y: number, po: number): void => {
    const cx = x + 11;
    const cy = y + 11;
    circle(ctx, cx - 8, cy + po * 3, 3.4, '#b91c1c', '#7f1d1d', 2);
    circle(ctx, cx + 8, cy - po * 3, 3.4, '#b91c1c', '#7f1d1d', 2);
    circle(ctx, cx, cy, 7.5, '#ef4444', '#991b1b');
    eyes(ctx, cx, cy + 3.5, 3, 1.8);
  };
  grunt(258, 2, -1);
  grunt(284, 2, 1);

  // — runner 20×22 : effilé, tête baissée, jambes-traînées derrière —
  const runner = (x: number, y: number, po: number): void => {
    const cx = x + 10;
    const cy = y + 12;
    circle(ctx, cx - 4.5, cy - 8 - po * 2, 2.4, '#c2410c', '#7c2d12', 1.5);
    circle(ctx, cx + 4.5, cy - 8 + po * 2, 2.4, '#c2410c', '#7c2d12', 1.5);
    oval(ctx, cx, cy, 5.5, 7.2, '#f97316', '#9a3412', 2);
    circle(ctx, cx, cy + 4.5, 3.8, '#fb923c', '#9a3412', 2);
    eyes(ctx, cx, cy + 5.5, 1.8, 1.2);
  };
  runner(310, 2, -1);
  runner(334, 2, 1);

  // — kamikaze 22×26 : bombe à pattes, mèche qui crépite (le clignotement
  //   vient du swap de frame : étincelle jaune / braise rouge) —
  const kami = (x: number, y: number, po: number): void => {
    const cx = x + 11;
    circle(ctx, cx - 4, y + 22.5 - po * 1.2, 2, '#7c2d12', '#431407', 1.5);
    circle(ctx, cx + 4, y + 22.5 + po * 1.2, 2, '#7c2d12', '#431407', 1.5);
    circle(ctx, cx, y + 15, 7.5, '#fb923c', '#9a3412');
    ctx.strokeStyle = '#9ca3af'; // mèche
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, y + 8);
    ctx.quadraticCurveTo(cx + 1, y + 5.5, cx + 3, y + 4.5);
    ctx.stroke();
    ctx.fillStyle = '#374151'; // chapeau de mise à feu
    ctx.fillRect(cx - 3, y + 6.5, 6, 3.5);
    if (po < 0) {
      circle(ctx, cx + 3.5, y + 3.5, 2.6, '#fde047', '#eab308', 1.5);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx + 3.5, y + 3.5, 1.1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      circle(ctx, cx + 3.5, y + 4, 1.6, '#ef4444', '#7f1d1d', 1.5);
    }
    eyes(ctx, cx, y + 17.5, 2.6, 1.5);
  };
  kami(258, 28, -1);
  kami(284, 28, 1);

  // — sniper ennemi 22×24 : encapuchonné, fusil vers le joueur (frame B : lueur au canon) —
  const esniper = (x: number, y: number, po: number): void => {
    const cx = x + 11;
    const cy = y + 10;
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(cx + 3, cy, 2.5, 12);
    circle(ctx, cx, cy, 7, '#a855f7', '#581c87');
    circle(ctx, cx + 4.5, cy + 3, 2.5, '#7e22ce', '#581c87', 1.5); // main sur le fusil
    circle(ctx, cx - 1, cy + 1.5, 4.5, '#581c87', '#3b0764', 2); // capuche
    ctx.fillStyle = '#e9d5ff'; // regard luisant sous la capuche
    ctx.beginPath();
    ctx.arc(cx - 2.5, cy + 3.5, 1.2, 0, Math.PI * 2);
    ctx.arc(cx + 0.5, cy + 3.5, 1.2, 0, Math.PI * 2);
    ctx.fill();
    if (po > 0) circle(ctx, cx + 4.2, cy + 12, 1.7, '#f5f3ff', '#a855f7', 1); // départ de tir
  };
  esniper(310, 28, -1);
  esniper(336, 28, 1);

  // — élite 30×32 : blindé, épaulières, visière lumineuse, crête —
  const elite = (x: number, y: number, po: number): void => {
    const cx = x + 15;
    const cy = y + 16;
    ctx.fillStyle = '#1e293b'; // crête
    ctx.beginPath();
    ctx.moveTo(cx - 2, cy - 8);
    ctx.lineTo(cx, cy - 14);
    ctx.lineTo(cx + 2, cy - 8);
    ctx.closePath();
    ctx.fill();
    circle(ctx, cx - 9.5, cy + po * 2.5, 4.6, '#334155', '#0f172a', 2);
    circle(ctx, cx + 9.5, cy - po * 2.5, 4.6, '#334155', '#0f172a', 2);
    circle(ctx, cx, cy, 10, '#64748b', '#1e293b');
    circle(ctx, cx, cy, 6.5, '#334155', '#0f172a', 2);
    ctx.fillStyle = '#7dd3fc'; // visière
    ctx.fillRect(cx - 3.5, cy + 4.5, 7, 2.5);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#0f172a';
    ctx.strokeRect(cx - 3.5, cy + 4.5, 7, 2.5);
  };
  elite(258, 58, -1);
  elite(292, 58, 1);

  // — brute 36×38 : masse d'épaules, pointes dorsales, petite tête féroce —
  const brute = (x: number, y: number, po: number): void => {
    const cx = x + 18;
    const cy = y + 19;
    ctx.fillStyle = '#450a0a'; // pointes dorsales
    for (const dx of [-7, 0, 7]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx - 3, cy - 9);
      ctx.lineTo(cx + dx, cy - 16.5);
      ctx.lineTo(cx + dx + 3, cy - 9);
      ctx.closePath();
      ctx.fill();
    }
    circle(ctx, cx - 11, cy + po * 3, 5.5, '#7f1d1d', '#450a0a', 2);
    circle(ctx, cx + 11, cy - po * 3, 5.5, '#7f1d1d', '#450a0a', 2);
    circle(ctx, cx, cy, 12, '#b91c1c', '#450a0a');
    circle(ctx, cx, cy - 1, 6.5, '#7f1d1d', '#450a0a', 2); // plastron
    circle(ctx, cx, cy + 8.5, 4.5, '#991b1b', '#450a0a', 2); // tête
    eyes(ctx, cx, cy + 9, 2, 1.3);
  };
  brute(258, 94, -1);
  brute(298, 94, 1);

  // — soldats 22×28 : casque, buste, sac, canon vers l'avant (haut) —
  const soldier = (x: number, y: number, kind: 0 | 1 | 2): void => {
    const cx = x + 11;
    const palette = [
      ['#3b82f6', '#1d4ed8', '#93c5fd'],
      ['#6366f1', '#3730a3', '#c7d2fe'],
      ['#f59e0b', '#92400e', '#fde68a'],
    ][kind];
    const [body, dark, helm] = palette;
    ctx.fillStyle = '#1e293b'; // canon : fin/long (sniper), large (artilleur)
    if (kind === 0) ctx.fillRect(cx - 1.5, y + 2, 3, 10);
    else if (kind === 1) ctx.fillRect(cx - 1, y, 2, 13);
    else ctx.fillRect(cx - 3, y + 3, 6, 9);
    oval(ctx, cx, y + 24, 5, 3, dark, dark, 1.5); // sac à dos (derrière)
    oval(ctx, cx, y + 18, 9, 6.5, body, dark, 2); // épaules
    circle(ctx, cx, y + 13.5, 5.5, body, dark, 2); // casque
    circle(ctx, cx, y + 12, 3.2, helm, dark, 1.5); // visière
  };
  soldier(258, 136, 0);
  soldier(284, 136, 1);
  soldier(310, 136, 2);

  // — boss 76×76 : couronne de pointes, plastron, yeux braise, gueule à crocs —
  const bx = 296;
  const by = 206;
  ctx.fillStyle = '#7f1d1d';
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(bx + Math.cos(a - 0.2) * 24, by + Math.sin(a - 0.2) * 24);
    ctx.lineTo(bx + Math.cos(a) * 35, by + Math.sin(a) * 35);
    ctx.lineTo(bx + Math.cos(a + 0.2) * 24, by + Math.sin(a + 0.2) * 24);
    ctx.closePath();
    ctx.fill();
  }
  circle(ctx, bx, by, 25, '#b91c1c', '#450a0a', 3);
  circle(ctx, bx, by, 15.5, '#7f1d1d', '#450a0a', 2.5);
  oval(ctx, bx, by + 9, 9, 5.5, '#450a0a', '#450a0a', 1); // gueule
  ctx.fillStyle = '#fee2e2'; // crocs
  for (const dx of [-5, 0, 5]) {
    ctx.beginPath();
    ctx.moveTo(bx + dx - 2, by + 5.5);
    ctx.lineTo(bx + dx + 2, by + 5.5);
    ctx.lineTo(bx + dx, by + 11);
    ctx.closePath();
    ctx.fill();
  }
  for (const s of [-1, 1]) {
    circle(ctx, bx + s * 8, by - 4, 4.2, '#fbbf24', '#92400e', 2); // œil braise
    ctx.fillStyle = '#450a0a';
    ctx.fillRect(bx + s * 8 - 1, by - 6.5, 2, 5.5); // pupille fendue
  }
}

/**
 * Planche de décor : tous les props de tous les biomes sur UN canvas — une seule
 * source, les sprites de décor d'une run se batchent. Style commun au jeu :
 * aplats bordés d'un trait sombre. AUCUN code danger (hachures jaune/noir,
 * anneaux, glyphes blancs) : ils restent réservés aux menaces réelles.
 */
function buildDecorSets(): DecorSet[] {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext('2d')!;
  let curX = 0;
  let curY = 0;
  let rowH = 0;
  const cells: { biome: number; ground: boolean; sway: number; weight: number; rect: Rectangle }[] = [];
  const place = (w: number, h: number): { x: number; y: number } => {
    if (curX + w + 4 > canvas.width) {
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
  const edge = (color: string, lw = 2.5): void => {
    ctx.lineWidth = lw;
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  /** Couronne d'arbre à lobes : silhouette sombre (fait office de bord), masse, reflets. */
  const canopy = (cx: number, cy: number, r: number, dark: string, base: string, light: string): void => {
    for (const [color, grow] of [
      [dark, 2.5],
      [base, 0],
    ] as const) {
      ctx.fillStyle = color;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r * 0.58, cy + Math.sin(a) * r * 0.58, r * 0.5 + grow, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.75 + grow, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = light;
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI * 0.75 + k * 0.8;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  /** Touffe d'herbe : brins en éventail depuis le pied. */
  const tuft = (cx: number, baseY: number, w: number, h: number, colors: readonly string[], n = 7): void => {
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.5;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const spread = (t - 0.5) * w;
      ctx.strokeStyle = colors[k % colors.length];
      ctx.beginPath();
      ctx.moveTo(cx + spread * 0.25, baseY);
      ctx.quadraticCurveTo(
        cx + spread * 0.55,
        baseY - h * 0.6,
        cx + spread,
        baseY - h * (0.7 + 0.3 * (1 - Math.abs(t - 0.5) * 2)),
      );
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  };
  /** Conifère : tronc + trois étages triangulaires, neige en option. */
  const pineTree = (cx: number, bottom: number, w: number, h: number, base: string, dark: string, snow: boolean): void => {
    ctx.fillStyle = '#5d4632';
    ctx.fillRect(cx - 3, bottom - 9, 6, 9);
    const bh = h - 9;
    for (let k = 0; k < 3; k++) {
      const tw = w * (1 - 0.24 * k);
      const yB = bottom - 9 - k * bh * 0.27;
      const yT = yB - bh * 0.42;
      ctx.beginPath();
      ctx.moveTo(cx - tw / 2, yB);
      ctx.lineTo(cx + tw / 2, yB);
      ctx.lineTo(cx, yT);
      ctx.closePath();
      ctx.fillStyle = base;
      ctx.fill();
      edge(dark);
      if (snow) {
        ctx.strokeStyle = '#eef4fa';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, yT + 1.5);
        ctx.lineTo(cx - tw * 0.34, yT + (yB - yT) * 0.62);
        ctx.moveTo(cx, yT + 1.5);
        ctx.lineTo(cx + tw * 0.3, yT + (yB - yT) * 0.55);
        ctx.stroke();
      }
    }
  };
  /** Rocher : polygone irrégulier + facette claire. */
  const rockShape = (cx: number, bottom: number, w: number, h: number, base: string, edgeC: string, light: string): void => {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, bottom);
    ctx.lineTo(cx - w * 0.38, bottom - h * 0.72);
    ctx.lineTo(cx - w * 0.05, bottom - h);
    ctx.lineTo(cx + w * 0.32, bottom - h * 0.78);
    ctx.lineTo(cx + w / 2, bottom - h * 0.2);
    ctx.lineTo(cx + w * 0.42, bottom);
    ctx.closePath();
    ctx.fillStyle = base;
    ctx.fill();
    edge(edgeC);
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.3, bottom - h * 0.66);
    ctx.lineTo(cx - w * 0.04, bottom - h * 0.9);
    ctx.lineTo(cx + w * 0.18, bottom - h * 0.7);
    ctx.lineTo(cx - w * 0.08, bottom - h * 0.5);
    ctx.closePath();
    ctx.fill();
  };

  // ————— VILLE (0) : toits, lampadaires, voitures — vus de dessus —————
  prop(0, 56, 80, 0, 1, (x, y) => {
    ctx.fillStyle = '#414b58';
    ctx.fillRect(x, y, 56, 80);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#232932';
    ctx.strokeRect(x + 1.5, y + 1.5, 53, 77);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#5a6674';
    ctx.strokeRect(x + 8, y + 8, 40, 64);
    for (const [ax, ay, aw, ah] of [
      [x + 13, y + 15, 14, 11],
      [x + 29, y + 50, 16, 12],
    ] as const) {
      ctx.fillStyle = '#707c8c';
      ctx.fillRect(ax, ay, aw, ah);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#232932';
      ctx.strokeRect(ax, ay, aw, ah);
    }
    ctx.fillStyle = '#f3d36b'; // lucarnes éclairées
    ctx.fillRect(x + 36, y + 18, 8, 8);
    ctx.fillRect(x + 13, y + 55, 8, 8);
  });
  prop(0, 48, 96, 0, 0.6, (x, y) => {
    ctx.fillStyle = '#4a5462';
    ctx.fillRect(x, y, 48, 96);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#262c35';
    ctx.strokeRect(x + 1.5, y + 1.5, 45, 93);
    circle(ctx, x + 24, y + 32, 15, '#5b6674', '#262c35');
    ctx.fillStyle = '#e5e9ef';
    ctx.font = '900 17px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', x + 24, y + 33);
    circle(ctx, x + 37, y + 78, 3.5, '#ef4444', '#7f1d1d'); // balise
  });
  prop(0, 32, 32, 0, 0.8, (x, y) => {
    const g = ctx.createRadialGradient(x + 16, y + 16, 2, x + 16, y + 16, 15);
    g.addColorStop(0, 'rgba(255,221,130,0.95)');
    g.addColorStop(1, 'rgba(255,221,130,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x + 16, y + 16, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#39404a'; // bras du mât, vu de dessus
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 16, y + 16);
    ctx.lineTo(x + 27, y + 22);
    ctx.stroke();
    circle(ctx, x + 16, y + 16, 3.5, '#4a545f', '#1c2127');
  });
  prop(0, 40, 42, 0.045, 0.7, (x, y) => canopy(x + 20, y + 22, 16, '#2f5424', '#4d7c36', '#68a04a'));
  prop(0, 30, 54, 0, 0.7, (x, y) => {
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 3, 24, 48, 8);
    ctx.fillStyle = '#5d7f9e';
    ctx.fill();
    edge('#2c3844');
    ctx.fillStyle = '#a9c1d4';
    ctx.beginPath();
    ctx.roundRect(x + 6, y + 12, 18, 8, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x + 6, y + 38, 18, 7, 2);
    ctx.fill();
    ctx.fillStyle = '#6c8fae';
    ctx.fillRect(x + 6, y + 23, 18, 12);
  });
  groundDetail(0, 22, 22, (x, y) => {
    circle(ctx, x + 11, y + 11, 9, '#333a42', '#22272e');
    ctx.strokeStyle = '#4a525c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + 11, y + 11, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 11);
    ctx.lineTo(x + 17, y + 11);
    ctx.stroke();
  });
  groundDetail(0, 46, 24, (x, y) => {
    ctx.strokeStyle = '#2b323a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 20);
    ctx.lineTo(x + 14, y + 14);
    ctx.lineTo(x + 20, y + 4);
    ctx.moveTo(x + 14, y + 14);
    ctx.lineTo(x + 32, y + 10);
    ctx.lineTo(x + 44, y + 2);
    ctx.moveTo(x + 32, y + 10);
    ctx.lineTo(x + 40, y + 18);
    ctx.stroke();
  });

  // ————— DÉSERT (1) : cactus, rochers, buissons secs, ossements —————
  prop(1, 40, 58, 0.035, 1, (x, y) => {
    const cx = x + 20;
    ctx.fillStyle = '#4e8a50';
    ctx.strokeStyle = '#2f5a33';
    ctx.lineWidth = 2.5;
    for (const [rx, ry, rw, rh] of [
      [cx - 7, y + 12, 14, 44],
      [cx - 18, y + 20, 10, 16],
      [cx + 8, y + 16, 10, 14],
    ] as const) {
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, 5);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#4e8a50'; // jonctions des bras
    ctx.fillRect(cx - 10, y + 27, 8, 7);
    ctx.fillRect(cx + 3, y + 22, 8, 7);
    ctx.strokeStyle = '#69a86b'; // côtes
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 2.5, y + 16);
    ctx.lineTo(cx - 2.5, y + 52);
    ctx.moveTo(cx + 2.5, y + 16);
    ctx.lineTo(cx + 2.5, y + 52);
    ctx.stroke();
  });
  prop(1, 46, 30, 0, 0.9, (x, y) => rockShape(x + 23, y + 28, 42, 26, '#b08a5e', '#7a5c3c', '#c49a6a'));
  prop(1, 34, 26, 0.07, 0.8, (x, y) => tuft(x + 17, y + 24, 30, 22, ['#a67c3e', '#8f6832', '#bd914a']));
  prop(1, 20, 18, 0, 0.3, (x, y) => {
    circle(ctx, x + 10, y + 8, 6, '#e8e0cf', '#a99f88');
    ctx.fillStyle = '#e8e0cf';
    ctx.fillRect(x + 7, y + 11, 6, 5);
    ctx.fillStyle = '#3c362b';
    ctx.fillRect(x + 7, y + 6, 2.5, 3);
    ctx.fillRect(x + 11, y + 6, 2.5, 3);
  });
  groundDetail(1, 48, 14, (x, y) => {
    ctx.strokeStyle = '#c1934f';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(x + 2 + k * 4, y + 3 + k * 4);
      ctx.quadraticCurveTo(x + 24, y - 2 + k * 4, x + 46 - k * 4, y + 3 + k * 4);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  });
  groundDetail(1, 28, 12, (x, y) => {
    circle(ctx, x + 6, y + 7, 4, '#b08a5e', '#82603a');
    circle(ctx, x + 16, y + 5, 3, '#c49a6a', '#82603a');
    circle(ctx, x + 23, y + 8, 2.5, '#b08a5e', '#82603a');
  });

  // ————— CAMPAGNE (2) : arbres, foin, clôtures, fleurs —————
  prop(2, 60, 64, 0.04, 1, (x, y) => {
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(x + 26, y + 42, 8, 20);
    canopy(x + 30, y + 27, 24, '#33602a', '#4f8f38', '#71b350');
  });
  prop(2, 38, 28, 0, 0.6, (x, y) => {
    ctx.beginPath();
    ctx.arc(x + 19, y + 26, 16, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = '#d9b45c';
    ctx.fill();
    edge('#a8853c');
    ctx.strokeStyle = '#b8934a';
    ctx.lineWidth = 2;
    for (const dx of [-8, 0, 8]) {
      ctx.beginPath();
      ctx.moveTo(x + 19 + dx, y + 26);
      ctx.lineTo(x + 19 + dx * 0.6, y + 13);
      ctx.stroke();
    }
  });
  prop(2, 52, 24, 0, 0.5, (x, y) => {
    ctx.fillStyle = '#a3805a';
    ctx.fillRect(x, y + 6, 52, 4);
    ctx.fillRect(x, y + 14, 52, 4);
    ctx.fillStyle = '#8a6a48';
    ctx.strokeStyle = '#5f4830';
    ctx.lineWidth = 2;
    for (const px of [x + 3, x + 24, x + 45]) {
      ctx.fillRect(px, y + 2, 5, 20);
      ctx.strokeRect(px, y + 2, 5, 20);
    }
  });
  prop(2, 30, 20, 0.08, 0.8, (x, y) => {
    tuft(x + 15, y + 18, 24, 14, ['#4e8033', '#5fa03e'], 5);
    circle(ctx, x + 8, y + 6, 3, '#e86a8a', '#a83c5c');
    circle(ctx, x + 16, y + 4, 3, '#f3d36b', '#b08a2e');
    circle(ctx, x + 23, y + 7, 3, '#e86a8a', '#a83c5c');
  });
  groundDetail(2, 26, 16, (x, y) => tuft(x + 13, y + 14, 20, 12, ['#4e8033', '#5fa03e'], 5));
  groundDetail(2, 24, 12, (x, y) => {
    circle(ctx, x + 5, y + 6, 2.5, '#e86a8a', '#a83c5c');
    circle(ctx, x + 12, y + 4, 2.5, '#f0ead2', '#a8a084');
    circle(ctx, x + 19, y + 7, 2.5, '#f3d36b', '#b08a2e');
  });

  // ————— JUNGLE (3) : canopées, fougères, fleurs exotiques —————
  prop(3, 68, 68, 0.035, 1, (x, y) => {
    canopy(x + 34, y + 32, 28, '#0f3d20', '#1f6b38', '#37954f');
    ctx.fillStyle = '#4fb069';
    for (const [dx, dy] of [
      [-14, -6],
      [4, 12],
      [16, -10],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x + 34 + dx, y + 32 + dy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  prop(3, 40, 34, 0.09, 0.9, (x, y) => {
    ctx.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      const t = k / 4 - 0.5;
      ctx.strokeStyle = k % 2 === 0 ? '#2f8a4a' : '#4fb069';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 20, y + 32);
      ctx.quadraticCurveTo(x + 20 + t * 16, y + 14, x + 20 + t * 36, y + 8 + Math.abs(t) * 14);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  });
  prop(3, 26, 26, 0.06, 0.5, (x, y) => {
    ctx.fillStyle = '#e0566a';
    ctx.strokeStyle = '#8f2f3f';
    ctx.lineWidth = 2;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      ctx.save();
      ctx.translate(x + 13 + Math.cos(a) * 6.5, y + 13 + Math.sin(a) * 6.5);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.5, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    circle(ctx, x + 13, y + 13, 4, '#f3d36b', '#b08a2e');
  });
  prop(3, 42, 28, 0, 0.5, (x, y) => {
    rockShape(x + 21, y + 26, 38, 22, '#7d8890', '#4a545c', '#98a2aa');
    ctx.fillStyle = '#2f8a4a'; // coiffe de mousse
    ctx.beginPath();
    ctx.ellipse(x + 18, y + 8, 12, 5, -0.2, 0, Math.PI * 2);
    ctx.fill();
  });
  groundDetail(3, 32, 16, (x, y) => {
    for (const [dx, dy, rot, color] of [
      [8, 8, 0.5, '#3f7a3a'],
      [18, 6, -0.7, '#6b8f3a'],
      [26, 10, 1.2, '#7a5a3a'],
    ] as const) {
      ctx.save();
      ctx.translate(x + dx, y + dy);
      ctx.rotate(rot);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });
  groundDetail(3, 46, 20, (x, y) => {
    ctx.fillStyle = '#39555e';
    ctx.beginPath();
    ctx.ellipse(x + 23, y + 10, 21, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#547a86';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x + 23, y + 10, 16, 5.5, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  });

  // ————— SAVANE (4) : acacias, termitières, hautes herbes —————
  prop(4, 64, 58, 0.03, 0.9, (x, y) => {
    ctx.strokeStyle = '#6b4e30';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 32, y + 56);
    ctx.lineTo(x + 20, y + 22);
    ctx.moveTo(x + 30, y + 42);
    ctx.lineTo(x + 42, y + 24);
    ctx.stroke();
    ctx.lineCap = 'butt';
    for (const [cx2, cy2, rx, ry] of [
      [x + 32, y + 14, 29, 11],
      [x + 40, y + 24, 17, 6],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(cx2, cy2, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#708b36';
      ctx.fill();
      edge('#4c6626');
    }
  });
  prop(4, 30, 40, 0, 0.6, (x, y) => {
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 38);
    ctx.quadraticCurveTo(x + 6, y + 12, x + 15, y + 3);
    ctx.quadraticCurveTo(x + 24, y + 12, x + 27, y + 38);
    ctx.closePath();
    ctx.fillStyle = '#a6713d';
    ctx.fill();
    edge('#7a4f28');
    ctx.strokeStyle = '#bd8850';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 32);
    ctx.quadraticCurveTo(x + 10, y + 16, x + 14, y + 8);
    ctx.stroke();
    ctx.fillStyle = '#5c3a1c';
    ctx.beginPath();
    ctx.arc(x + 17, y + 26, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
  prop(4, 40, 32, 0.09, 1, (x, y) => tuft(x + 20, y + 30, 36, 28, ['#cbb050', '#b89a3e', '#d9c064'], 9));
  prop(4, 42, 26, 0, 0.5, (x, y) => rockShape(x + 21, y + 24, 38, 22, '#9c8a70', '#6d5f4c', '#b3a288'));
  groundDetail(4, 26, 14, (x, y) => tuft(x + 13, y + 12, 20, 10, ['#bb9a41', '#a5883a'], 5));
  groundDetail(4, 36, 14, (x, y) => {
    ctx.strokeStyle = '#7d5630';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 7);
    ctx.lineTo(x + 12, y + 4);
    ctx.lineTo(x + 22, y + 9);
    ctx.lineTo(x + 34, y + 5);
    ctx.moveTo(x + 12, y + 4);
    ctx.lineTo(x + 16, y + 12);
    ctx.stroke();
  });

  // ————— SIBÉRIE (5) : sapins, congères, souches —————
  prop(5, 46, 66, 0.03, 1, (x, y) => pineTree(x + 23, y + 64, 42, 62, '#2c5c46', '#1a3d2c', true));
  prop(5, 38, 56, 0.03, 0.8, (x, y) => pineTree(x + 19, y + 54, 34, 52, '#22493a', '#132e22', false));
  prop(5, 48, 20, 0, 0.6, (x, y) => {
    ctx.beginPath();
    ctx.ellipse(x + 24, y + 18, 22, 12, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = '#f2f7fc';
    ctx.fill();
    edge('#c3d3e2');
    ctx.strokeStyle = '#b9cadb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x + 24, y + 17, 16, 7, 0, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  });
  prop(5, 24, 20, 0, 0.4, (x, y) => {
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(x + 3, y + 8, 18, 10);
    ctx.strokeStyle = '#54402a';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y + 8, 18, 10);
    ctx.beginPath();
    ctx.ellipse(x + 12, y + 8, 9, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#c4a077';
    ctx.fill();
    edge('#8a6a48', 2);
    ctx.strokeStyle = '#a8845c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x + 12, y + 8, 4.5, 2.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  });
  groundDetail(5, 46, 22, (x, y) => {
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 14);
    ctx.lineTo(x + 14, y + 3);
    ctx.lineTo(x + 34, y + 2);
    ctx.lineTo(x + 44, y + 10);
    ctx.lineTo(x + 36, y + 20);
    ctx.lineTo(x + 10, y + 19);
    ctx.closePath();
    ctx.fillStyle = '#d5e6f2';
    ctx.fill();
    edge('#a9c4d8', 2);
    ctx.strokeStyle = '#eef6fc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 12, y + 12);
    ctx.lineTo(x + 24, y + 8);
    ctx.lineTo(x + 36, y + 12);
    ctx.stroke();
  });
  groundDetail(5, 22, 30, (x, y) => {
    ctx.fillStyle = '#7e93a6';
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.ellipse(x + 6, y + 4 + k * 10, 3, 4, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + 16, y + 9 + k * 10, 3, 4, -0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const source = Texture.from(canvas).source;
  const sets = BIOMES.map(() => ({ props: [] as DecorProp[], ground: [] as Texture[] }));
  for (const cell of cells) {
    const tex = new Texture({ source, frame: cell.rect });
    if (cell.ground) sets[cell.biome].ground.push(tex);
    else sets[cell.biome].props.push({ tex, sway: cell.sway, weight: cell.weight });
  }
  return sets;
}
