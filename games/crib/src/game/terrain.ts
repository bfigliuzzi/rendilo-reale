import * as B from '../config/balance';
import type { LaneDef, MapDef, TerrainPatch } from '../config/maps';

/** Infranchissable pour la horde (haies, murs, eau). */
export const T_ENEMY = 1;
/** Infranchissable pour le bébé (murs, eau, bordure d'arène — PAS les haies). */
export const T_HERO = 2;
/** Ralentit le bébé : c'est le prix des haies qu'il est seul à pouvoir traverser. */
export const T_SLOW = 4;
/** Tuile de voie. Sert au décor (ne rien y poser) et au rendu. */
export const T_LANE = 8;

const MAT_FLAGS: Record<string, number> = {
  hedge: T_ENEMY | T_SLOW,
  wall: T_ENEMY | T_HERO,
  water: T_ENEMY | T_HERO,
};

/** Identifiants de matériau du masque de RENDU. 0 = sol nu. */
export const M_HEDGE = 1;
export const M_WALL = 2;
export const M_WATER = 3;
export const M_LANE = 4;

const MAT_ID: Record<string, number> = { hedge: M_HEDGE, wall: M_WALL, water: M_WATER };

/**
 * Le terrain d'une carte : des VECTEURS écrits à la main, rasterisés UNE fois au
 * chargement en un masque de tuiles.
 *
 * C'est la décision structurante de tout le système de cartes. La donnée reste
 * lisible et diffable (polylignes, rectangles, disques, bandes), mais au tick toute
 * question de passabilité est UN index de tableau — jamais une itération sur des
 * formes. Aucune allocation, et le coût est indépendant de la complexité de la carte.
 *
 * L'ORDRE du bake est la seule subtilité, et il est porteur de sens :
 *
 *   sol → patchs → VOIES (qui EFFACENT les bits bloquants) → bordure
 *
 * Une haie tracée en travers d'une voie laisse donc automatiquement une porte : c'est
 * exactement comme ça que s'écrit un goulot d'étranglement. Et la bordure ne bloque
 * QUE le bébé, pour que les amorces de voies posées hors de l'arène restent
 * praticables par la horde.
 */
export class Terrain {
  readonly cols: number;
  readonly rows: number;
  readonly mask: Uint8Array;
  /**
   * Matériau par tuile, pour le RENDU seul. Le mur et l'eau partagent exactement les
   * mêmes drapeaux de collision : sans cette seconde table, le sol baké ne saurait
   * pas les distinguer. Et comme le rendu part du MÊME masque que la simulation, le
   * joueur ne peut structurellement pas se tromper sur ce qui est franchissable.
   */
  readonly mat: Uint8Array;

  /** Voies APLATIES : tous les nœuds bout à bout, bornés par laneStart/laneCount. */
  readonly nodeX: Float32Array;
  readonly nodeY: Float32Array;
  /** Direction unitaire SORTANTE du nœud — le passage de nœud est un produit scalaire. */
  readonly segX: Float32Array;
  readonly segY: Float32Array;
  /** Normale (bissectrice unitaire) : l'écartement latéral se replie dans les virages. */
  readonly perpX: Float32Array;
  readonly perpY: Float32Array;
  /** Abscisse curviligne cumulée, pour situer une barricade sur sa voie. */
  readonly nodeS: Float32Array;
  readonly laneStart: Int32Array;
  readonly laneCount: Int32Array;
  readonly laneHalf: Float32Array;
  /**
   * Nœud à partir duquel la voie est bouchée par une barricade vivante, -1 sinon.
   * Écrit par `Buildings`, lu par `EnemyPool` : c'est tout le mécanisme de blocage,
   * en O(1) et sans une seule ligne de géométrie.
   */
  readonly laneBlockNode: Int16Array;
  /** Index du slot barricadant, pour lui router les dégâts. -1 si aucun. */
  readonly laneBlockIdx: Int16Array;
  /** Position du blocage, pré-calculée en même temps que `laneBlockNode`. */
  readonly laneBlockX: Float32Array;
  readonly laneBlockY: Float32Array;

  constructor(readonly def: MapDef) {
    const tile = B.TERRAIN_TILE;
    this.cols = Math.ceil(def.w / tile);
    this.rows = Math.ceil(def.h / tile);
    this.mask = new Uint8Array(this.cols * this.rows);
    this.mat = new Uint8Array(this.cols * this.rows);

    let total = 0;
    for (const l of def.lanes) total += l.pts.length >> 1;
    this.nodeX = new Float32Array(total);
    this.nodeY = new Float32Array(total);
    this.segX = new Float32Array(total);
    this.segY = new Float32Array(total);
    this.perpX = new Float32Array(total);
    this.perpY = new Float32Array(total);
    this.nodeS = new Float32Array(total);
    this.laneStart = new Int32Array(def.lanes.length);
    this.laneCount = new Int32Array(def.lanes.length);
    this.laneHalf = new Float32Array(def.lanes.length);
    this.laneBlockNode = new Int16Array(def.lanes.length).fill(-1);
    this.laneBlockIdx = new Int16Array(def.lanes.length).fill(-1);
    this.laneBlockX = new Float32Array(def.lanes.length);
    this.laneBlockY = new Float32Array(def.lanes.length);

    this.buildLanes(def.lanes);
    for (const p of def.terrain) this.stamp(p);
    this.carveLanes(def.lanes);
    this.borderHero();
    if (import.meta.env.DEV) this.assertSane();
  }

  // ------------------------------------------------------------------- requêtes

  flagsAt(x: number, y: number): number {
    const cx = (x / B.TERRAIN_TILE) | 0;
    const cy = (y / B.TERRAIN_TILE) | 0;
    // hors arène : praticable (les amorces de voies y vivent), et le clamp d'arène
    // du bébé l'empêche de toute façon d'y aller
    if (x < 0 || y < 0 || cx >= this.cols || cy >= this.rows) return 0;
    return this.mask[cy * this.cols + cx];
  }

  blockedEnemy(x: number, y: number): boolean {
    return (this.flagsAt(x, y) & T_ENEMY) !== 0;
  }

  /**
   * Sonde aux QUATRE COINS de l'AABB du bébé. Un seul test au centre le laisserait
   * enfoncer la moitié de son corps dans un mur avant de s'arrêter, ce qui se voit.
   * Les haies ne portent pas `T_HERO` : la sonde ne les voit tout simplement pas.
   */
  blockedHeroBox(x: number, y: number): boolean {
    const r = B.HERO_RADIUS - 1;
    return (
      (this.flagsAt(x - r, y - r) & T_HERO) !== 0 ||
      (this.flagsAt(x + r, y - r) & T_HERO) !== 0 ||
      (this.flagsAt(x - r, y + r) & T_HERO) !== 0 ||
      (this.flagsAt(x + r, y + r) & T_HERO) !== 0
    );
  }

  laneIndex(id: string): number {
    const i = this.def.lanes.findIndex((l) => l.id === id);
    if (i < 0) throw new Error(`voie inconnue : ${id}`);
    return i;
  }

  /**
   * Nœud de `lane` le plus proche de (x, y), en repartant vers l'AVANT. Utilisé
   * quand une chasseuse abandonne sa poursuite et rejoint sa voie — un seul balayage
   * linéaire, hors du chemin chaud.
   */
  nearestNode(lane: number, x: number, y: number): number {
    const start = this.laneStart[lane];
    const end = start + this.laneCount[lane] - 1;
    let best = start;
    let bestD2 = Infinity;
    for (let i = start; i <= end; i++) {
      const dx = this.nodeX[i] - x;
      const dy = this.nodeY[i] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return Math.min(best + 1, end);
  }

  /** Nœud de `lane` le plus proche de (x, y) — pour situer une barricade. */
  nodeNear(lane: number, x: number, y: number): number {
    const start = this.laneStart[lane];
    const end = start + this.laneCount[lane] - 1;
    let best = start;
    let bestD2 = Infinity;
    for (let i = start; i <= end; i++) {
      const dx = this.nodeX[i] - x;
      const dy = this.nodeY[i] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  }

  /**
   * Premier nœud de `lane` situé à moins de `dist` du berceau.
   *
   * Sert à faire entrer le boss : le laisser partir du bout de sa voie lui donnait
   * une approche de près de quarante secondes, contre les vingt sur lesquelles tout
   * son budget de PV est calé. On le pose donc à la distance historique, ce qui
   * garde la propriété qui compte — il apparaît hors champ — sans casser l'arithmétique.
   */
  nodeWithin(lane: number, cribX: number, cribY: number, dist: number): number {
    const start = this.laneStart[lane];
    const end = start + this.laneCount[lane] - 1;
    for (let i = start; i < end; i++) {
      if (Math.hypot(this.nodeX[i] - cribX, this.nodeY[i] - cribY) <= dist) return i;
    }
    return end;
  }

  /** Distance d'un point à la voie la plus proche (pour valider un emplacement). */
  distToAnyLane(x: number, y: number): number {
    let best = Infinity;
    for (let l = 0; l < this.laneCount.length; l++) {
      const start = this.laneStart[l];
      const n = this.laneCount[l];
      for (let i = start; i < start + n - 1; i++) {
        const d = segDist(x, y, this.nodeX[i], this.nodeY[i], this.nodeX[i + 1], this.nodeY[i + 1]);
        if (d < best) best = d;
      }
    }
    return best;
  }

  clearBlocks(): void {
    this.laneBlockNode.fill(-1);
    this.laneBlockIdx.fill(-1);
  }

  // --------------------------------------------------------------------- bake

  private buildLanes(lanes: readonly LaneDef[]): void {
    let at = 0;
    for (let l = 0; l < lanes.length; l++) {
      const pts = lanes[l].pts;
      const n = pts.length >> 1;
      this.laneStart[l] = at;
      this.laneCount[l] = n;
      this.laneHalf[l] = lanes[l].halfWidth;
      for (let i = 0; i < n; i++) {
        this.nodeX[at + i] = pts[i * 2];
        this.nodeY[at + i] = pts[i * 2 + 1];
      }
      let s = 0;
      for (let i = 0; i < n; i++) {
        const j = at + i;
        // direction SORTANTE ; le dernier nœud hérite de l'entrante (il n'a pas de suite)
        const k = i < n - 1 ? j : j - 1;
        const dx = this.nodeX[k + 1] - this.nodeX[k];
        const dy = this.nodeY[k + 1] - this.nodeY[k];
        const d = Math.hypot(dx, dy) || 1;
        this.segX[j] = dx / d;
        this.segY[j] = dy / d;
        if (i > 0) {
          s += Math.hypot(this.nodeX[j] - this.nodeX[j - 1], this.nodeY[j] - this.nodeY[j - 1]);
        }
        this.nodeS[j] = s;
      }
      // bissectrice : moyenne des directions entrante et sortante, puis normale.
      // Sans elle, l'écartement latéral se dédouble dans les virages et les rangs
      // extérieurs coupent à travers le coude.
      for (let i = 0; i < n; i++) {
        const j = at + i;
        const inX = i > 0 ? this.segX[j - 1] : this.segX[j];
        const inY = i > 0 ? this.segY[j - 1] : this.segY[j];
        const bx = inX + this.segX[j];
        const by = inY + this.segY[j];
        const b = Math.hypot(bx, by) || 1;
        this.perpX[j] = -(by / b);
        this.perpY[j] = bx / b;
      }
      at += n;
    }
  }

  private stamp(patch: TerrainPatch): void {
    const flags = MAT_FLAGS[patch.mat];
    this.matNow = MAT_ID[patch.mat];
    const sh = patch.shape;
    if (sh.kind === 'rect') {
      this.fillRect(sh.x, sh.y, sh.x + sh.w, sh.y + sh.h, flags, false);
    } else if (sh.kind === 'disc') {
      this.fillDisc(sh.x, sh.y, sh.r, flags, false);
    } else {
      const pts = sh.pts;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        this.fillBand(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], sh.width / 2, flags, false);
      }
    }
  }

  /**
   * Les voies EFFACENT les bits bloquants et posent `T_LANE` : elles battent tout.
   *
   * DEUX passes, et la première n'est pas cosmétique. Le masque est une grille de
   * 24 px : une tuile n'est creusée que si son CENTRE est dans la bande, donc un
   * point situé à `halfWidth - 8` de l'axe peut parfaitement tomber dans une tuile
   * dont le centre est à `halfWidth + 9` — restée bloquante. Un ennemi écarté
   * latéralement s'y faisait éjecter à chaque frame, oscillait sur place, et la nuit
   * ne se terminait jamais (mesuré : `idle:kitchen` en timeout à la nuit 2).
   *
   * On creuse donc la passabilité avec UNE TUILE de marge — la demi-diagonale d'une
   * tuile vaut 17, donc tout point à moins de `halfWidth` est garanti creusé — et on
   * ne peint `T_LANE` (rendu, exclusion du décor) qu'à la largeur réelle. La voie a
   * ainsi un accotement praticable mais non peint, exactement comme un vrai chemin.
   */
  private carveLanes(lanes: readonly LaneDef[]): void {
    for (const lane of lanes) {
      const pts = lane.pts;
      this.matNow = 0;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        this.fillBand(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], lane.halfWidth + B.TERRAIN_TILE, 0, true);
      }
      this.matNow = M_LANE;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        this.fillBand(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], lane.halfWidth, T_LANE, true);
      }
    }
  }

  /** Bordure d'arène : bloque le bébé SEUL, pour laisser vivre les amorces de voies. */
  private borderHero(): void {
    const c = this.cols;
    const r = this.rows;
    for (let x = 0; x < c; x++) {
      this.mask[x] |= T_HERO;
      this.mask[(r - 1) * c + x] |= T_HERO;
    }
    for (let y = 0; y < r; y++) {
      this.mask[y * c] |= T_HERO;
      this.mask[y * c + c - 1] |= T_HERO;
    }
  }

  private matNow = 0;

  private set(cx: number, cy: number, flags: number, carve: boolean): void {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return;
    const i = cy * this.cols + cx;
    if (carve) this.mask[i] = (this.mask[i] & ~(T_ENEMY | T_HERO | T_SLOW)) | flags;
    else this.mask[i] |= flags;
    this.mat[i] = this.matNow;
  }

  private fillRect(x0: number, y0: number, x1: number, y1: number, flags: number, carve: boolean): void {
    const t = B.TERRAIN_TILE;
    const cx0 = Math.max(0, Math.floor(x0 / t));
    const cy0 = Math.max(0, Math.floor(y0 / t));
    const cx1 = Math.min(this.cols - 1, Math.floor((x1 - 0.001) / t));
    const cy1 = Math.min(this.rows - 1, Math.floor((y1 - 0.001) / t));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.set(cx, cy, flags, carve);
  }

  private fillDisc(x: number, y: number, r: number, flags: number, carve: boolean): void {
    const t = B.TERRAIN_TILE;
    const cx0 = Math.floor((x - r) / t);
    const cy0 = Math.floor((y - r) / t);
    const cx1 = Math.floor((x + r) / t);
    const cy1 = Math.floor((y + r) / t);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const px = cx * t + t / 2 - x;
        const py = cy * t + t / 2 - y;
        if (px * px + py * py <= r * r) this.set(cx, cy, flags, carve);
      }
    }
  }

  private fillBand(
    ax: number, ay: number, bx: number, by: number,
    half: number, flags: number, carve: boolean,
  ): void {
    const t = B.TERRAIN_TILE;
    const cx0 = Math.floor((Math.min(ax, bx) - half) / t);
    const cy0 = Math.floor((Math.min(ay, by) - half) / t);
    const cx1 = Math.floor((Math.max(ax, bx) + half) / t);
    const cy1 = Math.floor((Math.max(ay, by) + half) / t);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (segDist(cx * t + t / 2, cy * t + t / 2, ax, ay, bx, by) <= half) {
          this.set(cx, cy, flags, carve);
        }
      }
    }
  }

  // ----------------------------------------------------------- garde-fous DEV

  /**
   * Chacune de ces assertions correspond à un bug qui, autrement, ne se voit qu'en
   * jeu et sur UNE carte — le pire profil de régression. Même esprit que
   * `assertSorted` : on casse fort au chargement plutôt que de dériver en silence.
   */
  private assertSane(): void {
    const d = this.def;
    const t = B.TERRAIN_TILE;
    const fail = (m: string): never => {
      throw new Error(`carte ${d.id} : ${m}`);
    };

    // ① cadre
    if (d.w % t !== 0 || d.h % t !== 0) fail(`dimensions non multiples de ${t}`);
    if (d.w < B.DESIGN_W || d.h < B.DESIGN_H) fail('arène plus petite que l’écran (le clamp caméra s’inverse)');
    if (d.w > B.MAX_ARENA_W || d.h > B.MAX_ARENA_H) fail('arène au-delà de la grille spatiale');

    for (let l = 0; l < d.lanes.length; l++) {
      const lane = d.lanes[l];
      const n = this.laneCount[l];
      const s = this.laneStart[l];
      // ② entrée hors champ, sortie sur le berceau
      const ex = this.nodeX[s];
      const ey = this.nodeY[s];
      if (ex >= 0 && ey >= 0 && ex <= d.w && ey <= d.h) fail(`voie ${lane.id} : l’entrée doit être HORS de l’arène`);
      const lx = this.nodeX[s + n - 1];
      const ly = this.nodeY[s + n - 1];
      if (Math.hypot(lx - d.cribX, ly - d.cribY) > B.CRIB_RADIUS * 2) {
        fail(`voie ${lane.id} : le dernier nœud n’aboutit pas au berceau`);
      }
      // ③ le boss doit tenir dans la voie
      if (lane.halfWidth < B.LANE_MIN_HALF) fail(`voie ${lane.id} : halfWidth < ${B.LANE_MIN_HALF} (le boss n’y tient pas)`);
      // ⑤ aucune tuile de voie bloquée après carve
      for (let i = s; i < s + n; i++) {
        if (this.blockedEnemy(this.nodeX[i], this.nodeY[i]) && this.nodeX[i] >= 0 && this.nodeY[i] >= 0) {
          fail(`voie ${lane.id} : nœud ${i - s} sur une tuile bloquée`);
        }
      }
    }

    // ④ aucun couloir franchissable plus étroit que 2 tuiles : c'est ce qui rend
    // géométriquement impossible qu'un ennemi touche le bébé À TRAVERS un mur
    // (portée de contact max = HERO_RADIUS + rayon mamie = 28 < 48), et donc ce qui
    // protège le garde-fou ② de l'engluement.
    for (const p of d.terrain) {
      if (p.shape.kind === 'band' && p.shape.width < t * 2) fail('bande de terrain plus fine que 2 tuiles');
      if (p.shape.kind === 'rect' && (p.shape.w < t * 2 || p.shape.h < t * 2)) fail('patch de terrain plus fin que 2 tuiles');
      if (p.shape.kind === 'disc' && p.shape.r < t) fail('disque de terrain plus fin que 2 tuiles');
    }

    // ⑥ dégagement autour du berceau : le scénario `grip` y fait apparaître des
    // mamies à ±22 px du bébé, et le décor y réserve déjà sa clearance
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      for (let r = 0; r <= 120; r += t) {
        if (this.blockedEnemy(d.cribX + Math.cos(ang) * r, d.cribY + Math.sin(ang) * r)) {
          fail('terrain bloquant à moins de 120 px du berceau');
        }
      }
    }

    // ⑦ emplacements praticables et effectivement au bord d'une voie
    for (const slot of d.slots) {
      if (this.blockedEnemy(slot.x, slot.y)) fail(`emplacement ${slot.name} sur une tuile bloquée`);
      const dist = this.distToAnyLane(slot.x, slot.y);
      if (dist > B.SLOT_MAX_LANE_DIST) fail(`emplacement ${slot.name} à ${Math.round(dist)} px de toute voie`);
      if (slot.accepts === 'barricade') {
        if (slot.lane === undefined) fail(`emplacement ${slot.name} : barricade sans voie déclarée`);
        else if (!d.lanes.some((l) => l.id === slot.lane)) fail(`emplacement ${slot.name} : voie ${slot.lane} inconnue`);
      }
    }
  }
}

/** Distance d'un point au segment [a, b]. Hors tick — lisibilité avant vitesse. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
