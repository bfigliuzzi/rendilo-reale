import { mulberry32 } from '@shared/rng';
import {
  AMULET_REGEN,
  BOSS_PACK,
  DOORS_PER_NODE,
  GOLD_BOSS,
  GOLD_FIGHT,
  GOLD_FIGHT_HARD,
  HARD_FROM_NODE,
  ITEM_IDS,
  ITEMS,
  LINE_CAP,
  MIN_RECRUIT_DOORS,
  NODE_COUNT,
  PACKS_EASY,
  PACKS_HARD,
  packWindow,
  RECRUITABLE,
  REVIVE_HP_FRACTION,
  SHOP_NODE,
  VEILED_BONUS,
  VEILED_FIND_GOLD,
  VEILED_FROM_NODE,
  unitDef,
} from '../config/balance';
import type { Door, DoorKind, ItemId, Line, Side } from '../config/rules';
import { Combat } from './combat';
import type { Placement } from './combat';
import { Squad, freshClasses } from './squad';

/** Effets de méta-progression, DÉRIVÉS du save par meta/tree.ts. */
export interface MetaEffects {
  /** Places en ligne avant (3 avec « Rang serré »). */
  frontCap: number;
  startGold: number;
  /** Portes voilées révélables par run (« Œil averti »). */
  veiledReveals: number;
  /** Héros de départ proposés. */
  heroes: readonly string[];
  /** Résurrections gratuites par run (« Répit »). */
  freeRevives: number;
}

export type RunPhase = 'doors' | 'combat' | 'recruit' | 'treasure' | 'shop' | 'over';

/** Ce que le marchand propose : services fixes + un étal d'objets tiré au sort. */
export interface ShopStock {
  items: ItemId[];
  /** Objets déjà achetés dans CETTE salle — l'étal ne se recharge pas. */
  sold: Set<ItemId>;
}

export interface RunStats {
  nodesCleared: number;
  fightsWon: number;
  goldEarned: number;
  goldSpent: number;
  revives: number;
  dismissals: number;
  swaps: number;
  damageDealt: number;
  kills: number;
  veiledTaken: number;
  itemsBought: number;
  bossDefeated: boolean;
}

function randInt(rand: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)];
}

/**
 * Une run : 9 nœuds + le boss, 3 portes par nœud. Franchir une porte ferme les
 * deux autres — pas de retour en arrière, pas de nettoyage d'étage.
 *
 * Toute la génération est SEEDÉE (mulberry32, zéro `Math.random`) : une run se
 * rejoue à l'identique, ce qui rend le bot de vérification reproductible.
 */
export class Run {
  readonly squad: Squad;
  readonly seed: number;
  /** 0 = pas encore entré · 1..9 nœuds · 10 = le boss. */
  node = 0;
  gold: number;
  doors: Door[] = [];
  phase: RunPhase = 'doors';
  /** Porte franchie au nœud courant — c'est elle qui décrit la salle. */
  current: Door | null = null;
  combat: Combat | null = null;
  shop: ShopStock | null = null;
  /** Butin en attente d'une décision du joueur (recrue, trésor). */
  pending: { recruit: string | null; treasure: ItemId | 'statue' | 'phial' | null } = { recruit: null, treasure: null };
  victory = false;
  readonly stats: RunStats = {
    nodesCleared: 0,
    fightsWon: 0,
    goldEarned: 0,
    goldSpent: 0,
    revives: 0,
    dismissals: 0,
    swaps: 0,
    damageDealt: 0,
    kills: 0,
    veiledTaken: 0,
    itemsBought: 0,
    bossDefeated: false,
  };

  veiledRevealsLeft: number;
  freeRevivesLeft: number;
  /** Fioles d'écho en réserve. Consommable, donc un simple compteur. */
  phials = 0;

  private readonly rand: () => number;
  private lastRoomWasShop = false;
  private recruitDoorsOffered = 0;

  constructor(
    seed: number,
    readonly meta: MetaEffects,
    hero: string,
  ) {
    this.seed = seed >>> 0;
    this.rand = mulberry32(this.seed);
    this.gold = meta.startGold;
    this.veiledRevealsLeft = meta.veiledReveals;
    this.freeRevivesLeft = meta.freeRevives;
    this.squad = new Squad(meta.frontCap);
    const m = this.squad.add(hero);
    // La Sœur d'armes démarre avec l'Écu bosselé (méta « Sœur d'armes »).
    if (m && hero === 'sister') {
      this.squad.stash.push('shield');
      this.squad.equip(m.id, 'shield');
    }
    this.nextNode();
  }

  get isBossNode(): boolean {
    return this.node > NODE_COUNT;
  }

  // ─────────────────────────────────────────────── génération des portes

  /** Avance d'un nœud et tire ses portes. */
  nextNode(): void {
    this.node++;
    this.current = null;
    this.phase = 'doors';
    this.doors = this.isBossNode ? [this.bossDoor()] : this.rollDoors(this.node);
  }

  private bossDoor(): Door {
    return {
      tell: 'fightHard',
      real: 'fightHard',
      bonus: 1,
      enemies: BOSS_PACK,
      gold: GOLD_BOSS,
      recruit: null,
      treasure: null,
      revealed: true,
    };
  }

  /**
   * Les cinq règles de génération du design, dans l'ordre où elles contraignent :
   * recrue garantie au nœud 1 · jamais deux marchands consécutifs · au moins deux
   * portes Recrue sur la run · marchand garanti au nœud 8 · combats dangereux
   * seulement à partir du nœud 4. Une porte voilée par nœud dès le nœud 3.
   */
  private rollDoors(node: number): Door[] {
    const forced: DoorKind[] = [];
    if (node === 1) forced.push('recruit');
    if (node === SHOP_NODE) forced.push('shop');
    // Si les nœuds restants ne suffisent plus à tenir le minimum de recrues, on
    // force ici. Le calcul se fait sur les nœuds APRÈS celui-ci.
    const deficit = MIN_RECRUIT_DOORS - this.recruitDoorsOffered;
    if (deficit > 0 && NODE_COUNT - node < deficit && !forced.includes('recruit')) forced.push('recruit');

    const pool: [DoorKind, number][] = [
      ['fight', 40],
      ['fightHard', node >= HARD_FROM_NODE ? 10 : 0],
      ['recruit', 20],
      ['treasure', 15],
      // « Jamais deux Marchands consécutifs » : la salle PRÉCÉDEMMENT FRANCHIE
      // décide. Le nœud SHOP_NODE−1 n'en propose jamais non plus : sans cette
      // seconde clause, le marchand GARANTI du nœud 8 se retrouvait en double
      // dès que le joueur avait acheté au nœud 7, et les deux règles du design
      // — « garanti au 8 » et « jamais deux d'affilée » — se contredisaient.
      // Mesuré par le scénario `gen` du bot : 7 runs sur 40.
      ['shop', this.lastRoomWasShop || node === SHOP_NODE - 1 ? 0 : 15],
    ];

    const kinds: DoorKind[] = [...forced];
    while (kinds.length < DOORS_PER_NODE) {
      // au plus deux portes identiques : trois icônes identiques ne posent
      // aucune question, et le tell est justement là pour qu'on décide
      const banned = new Set<DoorKind>(kinds.filter((k) => kinds.filter((x) => x === k).length >= 2));
      const usable = pool.filter(([k, w]) => w > 0 && !banned.has(k));
      kinds.push(this.weighted(usable.length ? usable : pool.filter(([, w]) => w > 0)));
    }

    const doors = kinds.map((k) => this.makeDoor(k as Exclude<DoorKind, 'veiled'>, node));
    this.recruitDoorsOffered += doors.filter((d) => d.real === 'recruit').length;

    // La porte voilée ne se pose JAMAIS sur une porte forcée : cacher le
    // marchand garanti du nœud 8 annulerait la garantie.
    if (node >= VEILED_FROM_NODE) {
      const candidates = doors.map((_, i) => i).filter((i) => i >= forced.length);
      const idx = candidates.length ? pick(this.rand, candidates) : Math.floor(this.rand() * doors.length);
      doors[idx].tell = 'veiled';
      doors[idx].bonus = VEILED_BONUS;
      doors[idx].gold = Math.round(doors[idx].gold * VEILED_BONUS);
      // une salle sans or paie quand même le pari : voir VEILED_FIND_GOLD
      if (doors[idx].gold === 0) doors[idx].gold = VEILED_FIND_GOLD;
    }
    return doors;
  }

  private weighted(entries: readonly [DoorKind, number][]): DoorKind {
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = this.rand() * total;
    for (const [k, w] of entries) {
      r -= w;
      if (r <= 0) return k;
    }
    return entries[entries.length - 1][0];
  }

  private makeDoor(kind: Exclude<DoorKind, 'veiled'>, node: number): Door {
    const d: Door = {
      tell: kind,
      real: kind,
      bonus: 1,
      enemies: [],
      gold: 0,
      recruit: null,
      treasure: null,
      revealed: false,
    };
    if (kind === 'fight') {
      // fenêtre glissante : la difficulté monte par l'ORDRE de la table, pas
      // par une retouche des chiffres d'ennemis (voir PACKS_EASY)
      d.enemies = pick(this.rand, PACKS_EASY.slice(0, packWindow(PACKS_EASY.length, node)));
      d.gold = randInt(this.rand, GOLD_FIGHT[0], GOLD_FIGHT[1]);
    } else if (kind === 'fightHard') {
      d.enemies = pick(this.rand, PACKS_HARD.slice(0, packWindow(PACKS_HARD.length, node, HARD_FROM_NODE)));
      d.gold = randInt(this.rand, GOLD_FIGHT_HARD[0], GOLD_FIGHT_HARD[1]);
    } else if (kind === 'recruit') {
      d.recruit = pick(this.rand, freshClasses(this.squad, RECRUITABLE));
    } else if (kind === 'treasure') {
      const roll = this.rand();
      if (roll < 0.16) d.treasure = 'statue';
      else if (roll < 0.3) d.treasure = 'phial';
      else d.treasure = pick(this.rand, this.unownedItems());
    }
    return d;
  }

  /** Objets que l'escouade ne possède pas encore — la variété d'abord. */
  private unownedItems(): ItemId[] {
    const owned = new Set<ItemId>([
      ...this.squad.stash,
      ...this.squad.members.map((m) => m.item).filter((i): i is ItemId => i !== null),
    ]);
    const fresh = ITEM_IDS.filter((i) => !owned.has(i));
    return fresh.length ? [...fresh] : [...ITEM_IDS];
  }

  /** Dépense « Œil averti » : la porte voilée du nœud affiche sa vraie catégorie. */
  revealVeiled(): boolean {
    if (this.veiledRevealsLeft <= 0) return false;
    const door = this.doors.find((d) => d.tell === 'veiled' && !d.revealed);
    if (!door) return false;
    door.revealed = true;
    this.veiledRevealsLeft--;
    return true;
  }

  // ─────────────────────────────────────────────── franchissement

  /** Franchit une porte. Les deux autres se ferment : aucun retour en arrière. */
  enter(index: number): boolean {
    if (this.phase !== 'doors') return false;
    const door = this.doors[index];
    if (!door) return false;
    this.current = door;
    this.doors = [door];
    if (door.tell === 'veiled') this.stats.veiledTaken++;
    this.lastRoomWasShop = door.real === 'shop';

    switch (door.real) {
      case 'fight':
      case 'fightHard':
        this.phase = 'combat';
        this.combat = new Combat([...this.squad.toPlacements(), ...enemyPlacements(door.enemies)], this.meta.frontCap);
        break;
      case 'recruit':
        this.phase = 'recruit';
        this.pending.recruit = door.recruit;
        this.collect(door.gold);
        break;
      case 'treasure':
        this.phase = 'treasure';
        this.pending.treasure = door.treasure;
        this.collect(door.gold);
        break;
      case 'shop':
        this.phase = 'shop';
        this.shop = { items: this.rollStock(), sold: new Set() };
        this.collect(door.gold);
        break;
    }
    return true;
  }

  private collect(gold: number): void {
    if (gold <= 0) return;
    this.gold += gold;
    this.stats.goldEarned += gold;
  }

  private rollStock(): ItemId[] {
    const pool = this.unownedItems();
    const out: ItemId[] = [];
    const bag = [...pool];
    for (let i = 0; i < 3 && bag.length; i++) {
      out.push(bag.splice(Math.floor(this.rand() * bag.length), 1)[0]);
    }
    return out;
  }

  /**
   * Clôture le combat courant. Les PV ne remontent pas, les morts restent
   * mortes : c'est ce qui donne son poids à la résurrection payante.
   */
  finishCombat(): void {
    const c = this.combat;
    if (!c || !c.outcome) return;
    const rows = c.units
      .filter((u) => u.side === 0)
      .map((u) => ({ uid: u.uid, hp: u.hp, dead: u.dead, defId: u.defId }));
    // On retrouve le membre par ORDRE d'apparition : `Combat` ne connaît pas
    // l'escouade, et les placements ont été poussés dans cet ordre-là.
    const members = this.squad.aliveMembers();
    const outcome = rows.slice(0, members.length).map((row, i) => ({
      memberId: members[i].id,
      hp: row.hp,
      dead: row.dead,
    }));
    this.squad.applyOutcome(outcome, AMULET_REGEN);
    this.stats.damageDealt += c.damageDealt;
    this.stats.kills += c.kills;

    if (c.outcome === 'victory') {
      this.stats.fightsWon++;
      this.collect(this.current?.gold ?? 0);
      if (this.isBossNode) {
        this.stats.bossDefeated = true;
        this.victory = true;
        this.phase = 'over';
        return;
      }
    } else {
      this.phase = 'over';
      return;
    }
    this.phase = 'doors';
  }

  /** Quitte la salle courante et ouvre le nœud suivant. */
  advance(): void {
    if (this.phase === 'over') return;
    this.stats.nodesCleared = this.node;
    this.pending.recruit = null;
    this.pending.treasure = null;
    this.shop = null;
    this.combat = null;
    this.nextNode();
  }

  /** Défaite : plus une seule unité debout. */
  get wiped(): boolean {
    return this.squad.aliveMembers().length === 0;
  }

  // ─────────────────────────────────────────────── marchand

  reviveCost(base: number): number {
    return this.freeRevivesLeft > 0 ? 0 : base;
  }

  buyRevive(memberId: number, cost: number): boolean {
    const m = this.squad.byId(memberId);
    if (!m || !this.squad.canRevive(m)) return false;
    const price = this.reviveCost(cost);
    if (this.gold < price) return false;
    if (!this.squad.revive(memberId, REVIVE_HP_FRACTION)) return false;
    if (price === 0) this.freeRevivesLeft--;
    this.spend(price);
    this.stats.revives++;
    return true;
  }

  buyHeal(memberId: number, hp: number, costPerHp: number): boolean {
    const m = this.squad.byId(memberId);
    if (!m || m.dead) return false;
    const missing = this.squad.maxHpOf(m) - m.hp;
    const amount = Math.min(hp, missing);
    const price = amount * costPerHp;
    if (amount <= 0 || this.gold < price) return false;
    this.squad.heal(memberId, amount);
    this.spend(price);
    return true;
  }

  buyItem(item: ItemId): boolean {
    const stock = this.shop;
    if (!stock || !stock.items.includes(item) || stock.sold.has(item)) return false;
    const price = ITEMS[item].price;
    if (this.gold < price) return false;
    stock.sold.add(item);
    this.squad.stash.push(item);
    this.spend(price);
    this.stats.itemsBought++;
    return true;
  }

  private spend(gold: number): void {
    this.gold -= gold;
    this.stats.goldSpent += gold;
  }
}

/**
 * Pose une composition ennemie sur ses deux lignes. Chaque fiche indique sa
 * ligne de prédilection ; le débordement passe sur l'autre ligne, ce qui garde
 * les gros paquets (4 ennemis) légalement plaçables.
 */
export function enemyPlacements(ids: readonly string[]): Placement[] {
  const used: [number, number] = [0, 0];
  const out: Placement[] = [];
  for (const id of ids) {
    const home = unitDef(id).home;
    const other: Line = home === 0 ? 1 : 0;
    const line: Line = used[home] < LINE_CAP ? home : used[other] < LINE_CAP ? other : home;
    const slot = used[line];
    if (slot >= LINE_CAP) continue; // les deux lignes sont pleines : on ignore
    used[line]++;
    out.push({ defId: id, side: 1 as Side, line, slot });
  }
  return out;
}
