import { Container, Sprite } from 'pixi.js';
import * as B from '../config/balance';
import type { SlotDef } from '../config/maps';
import type { Atlas } from '../render/textures';
import type { AimTarget, Bullets, Shooter } from './bullets';
import type { Economy } from './economy';
import type { EnemyPool } from './enemies';
import type { Crib } from './crib';
import type { Hero } from './hero';
import type { Level } from './level';
import { applyUpgrade, canUpgrade, upgradeCost } from './loadout';
import type { Terrain } from './terrain';

/** Ce que le tick des ennemis a besoin de savoir des auras de ralentissement. */
export interface SlowField {
  readonly slowX: Float32Array;
  readonly slowY: Float32Array;
  readonly slowR2: Float32Array;
  readonly slowMul: Float32Array;
  readonly slowCount: number;
}

/** Ce que le panneau d'achat affiche pour une offre. Calculé, jamais recalculé côté UI. */
export interface OfferView {
  /** `<id du bâtiment>` pour construire, `'up'` pour améliorer celui présent. */
  id: string;
  icon: string;
  name: string;
  detail: string;
  cost: number;
  affordable: boolean;
}

export interface SlotView {
  id: number;
  name: string;
  accepts: 'tower' | 'barricade' | 'crib';
  /** Index dans `BUILDINGS`, ou -1 si l'emplacement est libre. */
  building: number;
  level: number;
  hp: number;
  maxHp: number;
}

interface Slot {
  def: SlotDef;
  building: number;
  level: number;
  hp: number;
  maxHp: number;
  /** Le tireur, quand le bâtiment tire. `fireAcc` lui appartient — voir `Shooter`. */
  shooter: Shooter;
  sprite: Sprite;
  /** Voie bouchée, pour une barricade. -1 sinon. */
  lane: number;
  /** Nœud bouché sur cette voie. -1 sinon. */
  node: number;
}

/**
 * Les bâtiments posés sur les emplacements PRÉ-PLACÉS de la carte.
 *
 * Douze dalles au plus : pas de SoA ici, un tableau de structs préalloué au
 * chargement suffit — le seul invariant qui compte est « zéro allocation dans le
 * tick », pas « tableaux typés partout ».
 *
 * Deux comportements seulement, et c'est volontaire :
 *  - les TOURS tirent (via le même `Bullets` que le bébé, chacune avec son propre
 *    accumulateur de cadence) ou portent une AURA (talc, mobile) ;
 *  - les BARRICADES ne tirent pas, elles ont des PV et bouchent une voie.
 *
 * Le blocage passe par `terrain.laneBlockNode` : deux comparaisons dans le tick des
 * ennemis, pas une ligne de géométrie, et une barricade ne peut PHYSIQUEMENT pas
 * être contournée sur sa voie — c'est tout l'intérêt des emplacements pré-placés.
 * Les agrippeuses, elles, l'ignorent : la barricade est un filtre pour les fonceurs
 * de berceau, et cette règle-là se lit en une partie.
 */
export class Buildings {
  readonly slots: Slot[] = [];
  /** Emplacement à portée du bébé ce tick, ou -1. Calculé de JOUR seulement. */
  nearSlot = -1;

  /** Auras de ralentissement actives, compactées pour le tick des ennemis. */
  readonly slowX = new Float32Array(B.MAX_SLOTS);
  readonly slowY = new Float32Array(B.MAX_SLOTS);
  readonly slowR2 = new Float32Array(B.MAX_SLOTS);
  readonly slowMul = new Float32Array(B.MAX_SLOTS);
  slowCount = 0;

  /** Diviseur d'engluement dû au talc À LA POSITION DU BÉBÉ, recalculé au tick. */
  talcDiv = 1;

  /** Barricades tombées sur le NIVEAU. Sert à la troisième étoile. */
  lostBarricades = 0;

  private terrain: Terrain | null = null;
  private crib: Crib | null = null;
  private hero: Hero | null = null;

  constructor(
    private readonly layer: Container,
    private readonly atlas: Atlas,
  ) {}

  load(level: Level, crib: Crib, hero: Hero): void {
    this.crib = crib;
    this.hero = hero;
    // on retire NOS sprites un par un, jamais `removeChildren()` : le calque porte
    // aussi le chevron d'invite, posé par World, qu'un vidage emporterait en silence
    for (const s of this.slots) {
      this.layer.removeChild(s.sprite);
      s.sprite.destroy();
    }
    this.slots.length = 0;
    this.terrain = level.terrain;
    this.nearSlot = -1;
    this.slowCount = 0;
    this.talcDiv = 1;
    this.lostBarricades = 0;
    for (const def of level.def.map.slots) {
      const sprite = new Sprite({ texture: this.atlas.buildings[0][0], anchor: { x: 0.5, y: 0.78 } });
      sprite.position.set(def.x, def.y);
      sprite.visible = false;
      this.layer.addChild(sprite);
      this.slots.push({
        def,
        building: -1,
        level: 0,
        hp: 0,
        maxHp: 0,
        shooter: { x: def.x, y: def.y, rate: 0, dps: 0, range: 0, fireAcc: 0 },
        sprite,
        lane: def.lane !== undefined ? level.terrain.laneIndex(def.lane) : -1,
        node: -1,
      });
    }
    // Le BERCEAU est un emplacement comme un autre — virtuel, jamais déclaré par
    // une carte. Ça économise un type de panneau, c'est découvrable (on y est déjà
    // tout le temps), et c'est juste thématiquement : on répare le berceau AU
    // berceau, et on améliore le bébé là où il dort.
    const cribSlot: SlotDef = {
      id: level.def.map.slots.length,
      x: level.cribX,
      y: level.cribY,
      accepts: 'crib',
      name: 'le berceau',
    };
    const sprite = new Sprite();
    sprite.visible = false;
    this.slots.push({
      def: cribSlot,
      building: -1,
      level: 0,
      hp: 0,
      maxHp: 0,
      shooter: { x: cribSlot.x, y: cribSlot.y, rate: 0, dps: 0, range: 0, fireAcc: 0 },
      sprite,
      lane: -1,
      node: -1,
    });

    level.terrain.clearBlocks();
  }

  // -------------------------------------------------------------------- achat

  view(slotId: number): SlotView | null {
    const s = this.slots[slotId];
    if (!s) return null;
    return {
      id: slotId,
      name: s.def.name,
      accepts: s.def.accepts,
      building: s.building,
      level: s.level,
      hp: s.hp,
      maxHp: s.maxHp,
    };
  }

  /** Offres d'un emplacement : construire s'il est libre, améliorer sinon. */
  offersFor(slotId: number, economy: Economy): OfferView[] {
    const s = this.slots[slotId];
    if (!s) return [];
    const out: OfferView[] = [];
    if (s.def.accepts === 'crib') return this.cribOffers(economy);
    if (s.building < 0) {
      for (let i = 0; i < B.BUILDINGS.length; i++) {
        const def = B.BUILDINGS[i];
        if (def.fits !== s.def.accepts) continue;
        const lvl = def.levels[0];
        out.push({
          id: def.id,
          icon: def.icon,
          name: def.name,
          detail: `${lvl.label} — ${def.desc}`,
          cost: lvl.cost,
          affordable: economy.can(lvl.cost),
        });
      }
    } else {
      const def = B.BUILDINGS[s.building];
      const next = def.levels[s.level];
      if (next) {
        out.push({
          id: 'up',
          icon: def.icon,
          name: `${def.name} — niveau ${s.level + 1}`,
          detail: next.label,
          cost: next.cost,
          affordable: economy.can(next.cost),
        });
      }
    }
    return out;
  }

  /**
   * La boutique du berceau : le réparer, l'agrandir, et améliorer le bébé.
   *
   * La réparation vient EN PREMIER et c'est délibéré : c'est le seul soin fiable du
   * jeu, et sans lui le berceau saigne monotonement sur quatre nuits — la dernière
   * se jouerait toujours sur une réserve entamée trois nuits plus tôt, quelle que
   * soit l'adresse du joueur.
   */
  private cribOffers(economy: Economy): OfferView[] {
    const crib = this.crib;
    const hero = this.hero;
    if (!crib || !hero) return [];
    const out: OfferView[] = [];
    if (crib.hp < crib.maxHp) {
      out.push({
        id: 'repair',
        icon: '\u{1F527}',
        name: 'Réparer le berceau',
        detail: `+${B.CRIB_REPAIR_HP} PV (actuellement ${Math.ceil(crib.hp)}/${Math.round(crib.maxHp)})`,
        cost: B.CRIB_REPAIR_COST,
        affordable: economy.can(B.CRIB_REPAIR_COST),
      });
    }
    out.push({
      id: 'cribhp',
      icon: '\u{1F6CF}',
      name: 'Berceau renforcé',
      detail: `+${B.CRIB_MAXHP_STEP} PV maximum, et autant de réparé`,
      cost: B.CRIB_MAXHP_COST,
      affordable: economy.can(B.CRIB_MAXHP_COST),
    });
    for (const def of B.BABY_UPGRADES) {
      if (!canUpgrade(hero.loadout, def.id)) continue;
      const cost = upgradeCost(hero.loadout, def.id);
      out.push({
        id: `baby:${def.id}`,
        icon: def.icon,
        name: `${def.name} ${hero.loadout.levels[def.id] + 1}/${def.maxLevel}`,
        detail: def.desc,
        cost,
        affordable: economy.can(cost),
      });
    }
    return out;
  }

  /**
   * LE seul chemin d'achat. Le bouton du panneau et le bot appellent exactement
   * cette fonction : il n'existe donc pas de second chemin non testé, et la garde
   * « jour + à portée + finançable » ne peut pas être contournée.
   */
  buy(slotId: number, offerId: string, economy: Economy, phase: 'day' | 'night'): boolean {
    if (phase !== 'day') return false;
    if (slotId !== this.nearSlot) return false;
    const s = this.slots[slotId];
    if (!s) return false;
    if (s.def.accepts === 'crib') return this.buyCrib(offerId, economy);
    if (offerId === 'up') {
      if (s.building < 0) return false;
      const def = B.BUILDINGS[s.building];
      const next = def.levels[s.level];
      if (!next || !economy.trySpend(next.cost)) return false;
      s.level++;
      this.applyLevel(s);
      return true;
    }
    if (s.building >= 0) return false;
    const idx = B.BUILDINGS.findIndex((b) => b.id === offerId);
    if (idx < 0) return false;
    const def = B.BUILDINGS[idx];
    if (def.fits !== s.def.accepts) return false;
    if (!economy.trySpend(def.levels[0].cost)) return false;
    s.building = idx;
    s.level = 1;
    this.applyLevel(s);
    return true;
  }

  private buyCrib(offerId: string, economy: Economy): boolean {
    const crib = this.crib;
    const hero = this.hero;
    if (!crib || !hero) return false;
    if (offerId === 'repair') {
      if (crib.hp >= crib.maxHp || !economy.trySpend(B.CRIB_REPAIR_COST)) return false;
      crib.heal(B.CRIB_REPAIR_HP);
      return true;
    }
    if (offerId === 'cribhp') {
      if (!economy.trySpend(B.CRIB_MAXHP_COST)) return false;
      crib.maxHp += B.CRIB_MAXHP_STEP;
      crib.heal(B.CRIB_MAXHP_STEP);
      return true;
    }
    if (!offerId.startsWith('baby:')) return false;
    const id = offerId.slice(5) as B.BabyUpgradeId;
    if (!B.BABY_UPGRADES.some((u) => u.id === id)) return false;
    if (!canUpgrade(hero.loadout, id) || !economy.trySpend(upgradeCost(hero.loadout, id))) return false;
    applyUpgrade(hero.loadout, id);
    return true;
  }

  private applyLevel(s: Slot): void {
    const def = B.BUILDINGS[s.building];
    const lvl = B.buildingLevel(s.building, s.level);
    s.shooter.dps = lvl.dps ?? 0;
    s.shooter.rate = lvl.rate ?? 0;
    s.shooter.range = lvl.range ?? 0;
    s.maxHp = lvl.hp ?? 0;
    s.hp = s.maxHp;
    s.sprite.texture = this.atlas.buildings[s.building][s.level - 1];
    s.sprite.visible = true;
    if (def.id === 'barricade') this.raise(s);
  }

  /** Une barricade bouche sa voie au nœud le plus proche d'elle. */
  private raise(s: Slot): void {
    const t = this.terrain;
    if (!t || s.lane < 0) return;
    s.node = t.nodeNear(s.lane, s.def.x, s.def.y);
    t.laneBlockNode[s.lane] = s.node;
    t.laneBlockIdx[s.lane] = this.slots.indexOf(s);
    t.laneBlockX[s.lane] = s.def.x;
    t.laneBlockY[s.lane] = s.def.y;
  }

  /** Dégâts reçus par une barricade. Détruite, la dalle redevient libre. */
  damage(slotIdx: number, n: number): void {
    const s = this.slots[slotIdx];
    if (!s || s.maxHp <= 0 || s.hp <= 0) return;
    s.hp = Math.max(0, s.hp - n);
    if (s.hp > 0) return;
    // détruite : la dalle est libre, et il faudra la racheter au prix PLEIN le jour
    // suivant. Perdre un mur doit coûter, sinon la barricade est un consommable
    // gratuit qu'on repose sans y penser.
    const t = this.terrain;
    if (t && s.lane >= 0) {
      t.laneBlockNode[s.lane] = -1;
      t.laneBlockIdx[s.lane] = -1;
    }
    s.building = -1;
    s.level = 0;
    s.node = -1;
    s.sprite.visible = false;
    this.lostBarricades++;
  }

  /**
   * Lever du jour : les bâtiments entamés repartent à neuf, gratuitement. Sans ça,
   * la dernière nuit se joue derrière un mur de ruines déjà payé, et le joueur ne
   * peut plus que subir ce qu'il a acheté trois nuits plus tôt.
   */
  repairAll(): void {
    for (const s of this.slots) if (s.maxHp > 0) s.hp = s.maxHp;
  }

  // --------------------------------------------------------------------- tick

  update(
    dt: number,
    phase: 'day' | 'night',
    hero: Hero,
    bullets: Bullets,
    enemies: EnemyPool,
    boss: AimTarget,
  ): number {
    // proximité : de JOUR seulement, le panneau d'achat n'a pas à s'ouvrir sous le
    // feu — et une feuille DOM qui apparaît en pleine vague masquerait le danger.
    this.nearSlot = -1;
    if (phase === 'day') {
      let best = Infinity;
      for (let i = 0; i < this.slots.length; i++) {
        const d = this.slots[i].def;
        const reach = d.accepts === 'crib' ? B.CRIB_SHOP_REACH : B.BUILD_REACH;
        const dx = d.x - hero.x;
        const dy = d.y - hero.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= reach * reach && d2 < best) {
          best = d2;
          this.nearSlot = i;
        }
      }
    }

    this.slowCount = 0;
    this.talcDiv = 1;
    let fired = 0;
    for (const s of this.slots) {
      if (s.building < 0) continue;
      const def = B.BUILDINGS[s.building];
      const lvl = B.buildingLevel(s.building, s.level);
      if (s.shooter.dps > 0 && phase === 'night') {
        fired += bullets.autoFire(dt, s.shooter, enemies, boss);
      }
      if (lvl.radius === undefined || lvl.mul === undefined) continue;
      const r2 = lvl.radius * lvl.radius;
      if (def.id === 'mobile') {
        const k = this.slowCount++;
        this.slowX[k] = s.def.x;
        this.slowY[k] = s.def.y;
        this.slowR2[k] = r2;
        this.slowMul[k] = lvl.mul;
      } else if (def.id === 'talc') {
        const dx = s.def.x - hero.x;
        const dy = s.def.y - hero.y;
        // le meilleur nuage gagne, ils ne se cumulent pas : empiler deux boîtes
        // rendrait l'engluement indolore, et c'est la mécanique centrale du jeu
        if (dx * dx + dy * dy <= r2) this.talcDiv = Math.max(this.talcDiv, lvl.mul);
      }
    }
    return fired;
  }

  renderSync(clock: number): void {
    for (const s of this.slots) {
      if (s.building < 0) continue;
      // respiration lente : un bâtiment parfaitement immobile se lit comme du décor
      s.sprite.scale.set(1, 1 + Math.sin(clock * 1.7 + s.def.id) * 0.02);
      // une barricade entamée s'affaisse : son état se lit SUR ELLE, pas au HUD
      if (s.maxHp > 0) s.sprite.alpha = 0.55 + 0.45 * (s.hp / s.maxHp);
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.building = -1;
      s.level = 0;
      s.hp = 0;
      s.maxHp = 0;
      s.sprite.visible = false;
    }
  }
}
