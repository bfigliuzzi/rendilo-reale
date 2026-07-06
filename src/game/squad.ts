import { type Container, Sprite, Text, type Texture } from 'pixi.js';
import * as B from '../config/balance';
import type { GateModifier } from '../config/levels';
import { clamp, lerp } from '../core/math';
import type { Atlas } from '../render/textures';

interface Slot {
  dx: number;
  dy: number;
}

interface Formation {
  slots: Slot[];
  halfWidth: number;
}

const formationCache = new Map<number, Formation>();

/**
 * Formation en masse large (aspect FORM_ASPECT, quinconce) : le nombre de colonnes
 * croît en √n et l'espacement se resserre pour tenir dans FORM_MAX_WIDTH — un gros
 * effectif se densifie en foule au lieu de s'étirer en profondeur. Chaque rang est
 * rempli du centre vers l'extérieur (un rang partiel reste centré).
 */
export function formation(n: number): Formation {
  let f = formationCache.get(n);
  if (f) return f;
  const cols = Math.min(B.FORM_MAX_COLS, Math.max(1, Math.ceil(Math.sqrt(n * B.FORM_ASPECT))));
  const spacingX = Math.min(B.SQUAD_SPACING_X, B.FORM_MAX_WIDTH / Math.max(cols - 1, 1));
  const spacingY = Math.max(B.FORM_MIN_SPACING_Y, spacingX * 0.9);
  const slots: Slot[] = [];
  let halfWidth = 0;
  let remaining = n;
  for (let row = 0; remaining > 0; row++) {
    const take = Math.min(cols, remaining);
    remaining -= take;
    const stagger = row % 2 === 1 && take > 1 ? spacingX / 2 : 0;
    for (let i = 0; i < take; i++) {
      const col = i === 0 ? 0 : i % 2 === 1 ? (i + 1) >> 1 : -(i >> 1);
      const dx = col * spacingX + stagger;
      slots.push({ dx, dy: row * spacingY });
      if (Math.abs(dx) > halfWidth) halfWidth = Math.abs(dx);
    }
  }
  f = { slots, halfWidth };
  formationCache.set(n, f);
  return f;
}

/**
 * `logical` est l'effectif réel (pilote la puissance de feu, sans plafond visuel) ;
 * seuls `rendered = min(logical, RENDER_CAP)` soldats sont affichés. Au-delà du cap,
 * le label d'effectif et un léger scale-up traduisent la croissance.
 */
export class Squad {
  logical = B.START_SQUAD;
  x = B.LANE_CENTER;
  prevX = B.LANE_CENTER;
  rendered = 0;
  visualScale = 1;
  halfWidth = 0;
  shielded = false;
  onLost: (n: number) => void = () => {};
  private badge = '';
  private readonly sprites: Sprite[] = [];
  private readonly curX = new Float32Array(B.SQUAD_RENDER_CAP);
  private readonly curY = new Float32Array(B.SQUAD_RENDER_CAP);
  private readonly tgtX = new Float32Array(B.SQUAD_RENDER_CAP);
  private readonly tgtY = new Float32Array(B.SQUAD_RENDER_CAP);
  private readonly label: Text;
  private muzzleIdx = 0;

  private startCount = B.START_SQUAD;
  private comp = { rifle: 1, sniper: 0, art: 0 };
  private readonly classTex: Texture[];

  constructor(container: Container, labels: Container, atlas: Atlas) {
    this.classTex = [atlas.soldier, atlas.soldierSniper, atlas.soldierArt];
    for (let i = 0; i < B.SQUAD_RENDER_CAP; i++) {
      const s = new Sprite(atlas.soldier);
      s.anchor.set(0.5);
      s.visible = false;
      this.sprites.push(s);
      container.addChild(s);
    }
    this.label = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 26,
        fontWeight: '900',
        fill: 0xffffff,
        stroke: { color: 0x0b1016, width: 5 },
      },
    });
    this.label.anchor.set(0.5, 1);
    labels.addChild(this.label);
    this.reset(this.startCount);
  }

  reset(startCount: number, comp?: { rifle: number; sniper: number; art: number }): void {
    this.startCount = startCount;
    if (comp) this.comp = comp;
    this.logical = startCount;
    this.x = this.prevX = B.LANE_CENTER;
    this.muzzleIdx = 0;
    this.rendered = 0;
    this.syncFormation(true);
  }

  update(dt: number, dragDX: number): void {
    this.prevX = this.x;
    // le centre est borné pour que la masse déborde à peine de la voie, même très large
    const hw = this.halfWidth * this.visualScale;
    const minX = Math.min(B.LANE_CENTER, B.LANE_MIN_X - 12 + hw);
    const maxX = Math.max(B.LANE_CENTER, B.LANE_MAX_X + 12 - hw);
    this.x = clamp(this.x + dragDX * B.DRAG_SENSITIVITY, Math.max(B.LANE_MIN_X, minX), Math.min(B.LANE_MAX_X, maxX));
    const t = Math.min(1, dt * 8);
    for (let i = 0; i < this.rendered; i++) {
      this.curX[i] += (this.tgtX[i] - this.curX[i]) * t;
      this.curY[i] += (this.tgtY[i] - this.curY[i]) * t;
    }
  }

  applyModifier(mod: GateModifier): void {
    this.setLogical(mod.op === 'mul' ? this.logical * mod.value : this.logical + mod.value);
  }

  loseSoldiers(n: number): void {
    if (n <= 0 || this.logical <= 0) return;
    if (this.shielded) return; // bouclier temporaire : aucune perte
    this.setLogical(this.logical - n);
    this.onLost(n);
  }

  /** Bouclier actif : les pertes sont annulées et les soldats virent au bleu clair. */
  setShielded(on: boolean): void {
    if (on === this.shielded) return;
    this.shielded = on;
    const tint = on ? 0x9bd8ff : 0xffffff;
    for (const s of this.sprites) s.tint = tint;
  }

  /** Suffixe affiché à côté de l'effectif (buffs actifs). */
  setBadge(badge: string): void {
    if (badge === this.badge) return;
    this.badge = badge;
    this.refreshLabel();
  }

  private refreshLabel(): void {
    this.label.text = this.badge ? `${this.logical} ${this.badge}` : String(this.logical);
  }

  private setLogical(n: number): void {
    this.logical = clamp(Math.round(n), 0, B.SQUAD_HARD_CAP);
    this.syncFormation(false);
  }

  private syncFormation(snap: boolean): void {
    const r = Math.min(this.logical, B.SQUAD_RENDER_CAP);
    const { slots, halfWidth } = formation(Math.max(r, 1));
    this.halfWidth = halfWidth;
    for (let i = 0; i < r; i++) {
      this.tgtX[i] = slots[i].dx;
      this.tgtY[i] = slots[i].dy;
      if (snap || i >= this.rendered) {
        // nouvel arrivant : apparaît au centre-arrière et lerpe vers son slot
        this.curX[i] = snap ? slots[i].dx : 0;
        this.curY[i] = snap ? slots[i].dy : 50;
      }
      this.sprites[i].texture = this.classTex[this.classOf(i)];
      this.sprites[i].visible = true;
    }
    for (let i = r; i < B.SQUAD_RENDER_CAP; i++) this.sprites[i].visible = false;
    this.rendered = r;
    this.visualScale =
      this.logical > B.SQUAD_RENDER_CAP
        ? Math.min(
            B.SQUAD_SCALE_MAX,
            1 + B.SQUAD_SCALE_LOG * Math.log10(this.logical / B.SQUAD_RENDER_CAP),
          )
        : 1;
    this.refreshLabel();
  }

  /** Classe visuelle du soldat i : hachage stable → la répartition suit la composition. */
  private classOf(i: number): number {
    const h = ((i * 37 + 11) % 100) / 100;
    if (h < this.comp.rifle) return 0;
    if (h < this.comp.rifle + this.comp.sniper) return 1;
    return 2;
  }

  worldY(dist: number): number {
    return -dist;
  }

  soldierWorldX(i: number): number {
    return this.x + this.curX[i] * this.visualScale;
  }

  soldierWorldY(i: number, dist: number): number {
    return -dist + this.curY[i] * this.visualScale;
  }

  /** Point de tir suivant, en round-robin sur les soldats affichés. */
  nextMuzzle(dist: number, out: { x: number; y: number }): void {
    if (this.rendered === 0) {
      out.x = this.x;
      out.y = -dist;
      return;
    }
    this.muzzleIdx = (this.muzzleIdx + 1) % this.rendered;
    out.x = this.soldierWorldX(this.muzzleIdx);
    out.y = this.soldierWorldY(this.muzzleIdx, dist) - 12;
  }

  renderSync(alpha: number, distI: number): void {
    const cx = lerp(this.prevX, this.x, alpha);
    // trottinement : chaque soldat oscille en phase avec l'avancée, décalé par index
    const phase = distI * 0.08;
    for (let i = 0; i < this.rendered; i++) {
      const s = this.sprites[i];
      const bob = Math.sin(phase + i * 1.31) * 1.6;
      s.position.set(
        cx + this.curX[i] * this.visualScale,
        -distI + this.curY[i] * this.visualScale + bob,
      );
      s.scale.set(this.visualScale);
    }
    this.label.position.set(cx, -distI - 22);
    this.label.visible = this.logical > 0;
  }
}
