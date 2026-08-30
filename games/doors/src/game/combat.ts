import {
  AIMED_BONUS,
  BANNER_INIT,
  BLADE_ATK,
  BOSS_PHASE2_AT,
  BOSS_SUMMONS,
  BREW_HEAL,
  DEFEND_REDUCTION,
  LINE_CAP,
  LITANY_HEAL,
  MIN_DAMAGE,
  MOMENTUM_BONUS,
  PACK_BONUS,
  RUNIC_COOLDOWN,
  RUNIC_DAMAGE,
  SECOND_WIND_HEAL,
  SHIELD_REDUCTION,
  unitDef,
} from '../config/balance';
import { abilityIsActive } from '../config/rules';
import type { AbilityId, ItemId, Line, Reach, Side } from '../config/rules';

/**
 * LE MODÈLE DE COMBAT. Il est PUR : pas d'horloge, pas de `Math.random`, pas de
 * DOM, pas de rendu. Deux conséquences voulues :
 *
 * ① **Dégâts déterministes** (design §3.4) — aucune variance, aucun jet de
 *    toucher. Le joueur doit pouvoir COMPTER son létal ; l'aléatoire du jeu vit
 *    dans la génération des portes, jamais dans la résolution.
 * ② Le bot de vérification peut rejouer un combat entier hors de la page, et
 *    l'écran n'a qu'à animer une file d'ÉVÉNEMENTS déjà résolus.
 *
 * La règle de ligne tient en deux phrases et produit l'essentiel des décisions :
 * le contact ne vise que la ligne avant adverse ; si elle est vide, la ligne
 * arrière DEVIENT la ligne avant. La distance ne connaît aucune restriction.
 */

export interface CUnit {
  uid: number;
  defId: string;
  name: string;
  sprite: string;
  side: Side;
  line: Line;
  slot: number;
  hp: number;
  maxHp: number;
  baseAtk: number;
  baseInit: number;
  reach: Reach;
  armor: number;
  ability: AbilityId | null;
  item: ItemId | null;
  /** Réduction de Défendre, active jusqu'au PROCHAIN tour de l'unité. */
  defending: boolean;
  usedSecondWind: boolean;
  /** Recharge de la Salve runique, en tours de cette unité. */
  cd: number;
  /** Bottes lestées : la permutation gratuite du combat a-t-elle été consommée ? */
  usedFreeSwap: boolean;
  /** Spectre : tours restants. `-1` = unité durable. */
  turnsLeft: number;
  /** Le Geôlier est-il déjà passé en phase 2 ? */
  phased: boolean;
  dead: boolean;
}

export type Action =
  | { kind: 'attack'; target: number }
  | { kind: 'ability'; target?: number; line?: Line }
  | { kind: 'swap'; line: Line; slot: number }
  | { kind: 'defend' }
  | { kind: 'phial' };

export type CombatEvent =
  | { type: 'attack'; from: number; to: number; dmg: number }
  | { type: 'volley'; from: number; line: Line; hits: readonly Hit[] }
  | { type: 'wide'; from: number; hits: readonly Hit[] }
  | { type: 'heal'; from: number; to: number; amount: number }
  | { type: 'death'; uid: number }
  | { type: 'swap'; uid: number; other: number | null }
  | { type: 'defend'; uid: number }
  | { type: 'summon'; uids: readonly number[] }
  | { type: 'phase'; uid: number }
  | { type: 'expire'; uid: number }
  | { type: 'end'; victory: boolean };

export interface Hit {
  to: number;
  dmg: number;
}

/** Emplacement visé par une permutation : un allié à échanger, ou une place libre. */
export interface SwapSlot {
  line: Line;
  slot: number;
  occupant: number | null;
}

/** Description d'une unité à poser sur le champ de bataille. */
export interface Placement {
  defId: string;
  side: Side;
  line: Line;
  slot: number;
  /** PV courants (persistants côté joueur). `undefined` = PV pleins. */
  hp?: number;
  item?: ItemId | null;
  /** Sur-cap de PV max déjà calculé par la couche escouade (Amulette). */
  maxHp?: number;
  /** Identité stable côté escouade, pour recopier les PV en fin de combat. */
  memberId?: number;
}

export class Combat {
  readonly units: CUnit[] = [];
  /** File d'événements à animer. Le rendu la DRAINE, le modèle ne la lit jamais. */
  readonly events: CombatEvent[] = [];
  /** Ordre du tour courant (uids), recalculé à chaque manche. */
  order: number[] = [];
  turnIndex = 0;
  round = 0;
  /** `null` tant que le combat dure. */
  outcome: 'victory' | 'defeat' | null = null;
  /** Compteurs de run, lus par la méta et le bot. */
  damageDealt = 0;
  kills = 0;

  private nextUid = 1;
  /** Cap de la ligne avant du joueur (3 avec « Rang serré »). */
  private readonly frontCap: number;

  constructor(placements: readonly Placement[], frontCap: number = LINE_CAP) {
    this.frontCap = frontCap;
    for (const p of placements) this.spawn(p);
    this.startRound();
  }

  // ─────────────────────────────────────────────────── lecture

  byUid(uid: number): CUnit | undefined {
    return this.units.find((u) => u.uid === uid);
  }

  alive(side?: Side): CUnit[] {
    return this.units.filter((u) => !u.dead && (side === undefined || u.side === side));
  }

  /** Unités vivantes d'une ligne, triées par emplacement. */
  lineUnits(side: Side, line: Line): CUnit[] {
    return this.alive(side)
      .filter((u) => u.line === line)
      .sort((a, b) => a.slot - b.slot);
  }

  /**
   * LA règle : la ligne avant EFFECTIVE d'un camp. C'est la ligne 0 tant qu'elle
   * porte au moins un vivant ; sinon la ligne arrière devient la ligne avant et
   * se fait cibler normalement.
   */
  frontLine(side: Side): Line {
    return this.lineUnits(side, 0).length > 0 ? 0 : 1;
  }

  /** Places d'une ligne, cap compris (le front joueur passe à 3 avec Rang serré). */
  capOf(side: Side, line: Line): number {
    return side === 0 && line === 0 ? this.frontCap : LINE_CAP;
  }

  /** ATQ effective : base + Lame ébréchée + Meute. */
  atkOf(u: CUnit): number {
    let atk = u.baseAtk;
    if (u.item === 'blade') atk += BLADE_ATK;
    if (u.ability === 'pack' && this.alive(u.side).some((o) => o.uid !== u.uid && o.ability === 'pack')) {
      atk += PACK_BONUS;
    }
    return atk;
  }

  /** INIT effective : base + Fanion usé porté par N'IMPORTE QUEL allié. */
  initOf(u: CUnit): number {
    return u.baseInit + (this.alive(u.side).some((o) => o.item === 'banner') ? BANNER_INIT : 0);
  }

  /** L'unité ignore-t-elle toute règle de ciblage ? (Carquois lourd) */
  ignoresTargeting(u: CUnit): boolean {
    return u.item === 'quiver';
  }

  /**
   * Cibles légales d'une attaque. Ordre de résolution :
   * ① Carquois lourd ou portée à distance → n'importe quel vivant adverse.
   * ② Sinon : la ligne avant EFFECTIVE seulement…
   * ③ …et si un Gardien y provoque, lui seul.
   */
  legalTargets(uid: number): CUnit[] {
    const u = this.byUid(uid);
    if (!u || u.dead) return [];
    const foe: Side = u.side === 0 ? 1 : 0;
    const all = this.alive(foe);
    if (this.ignoresTargeting(u) || u.reach === 'ranged') return all;
    const front = this.frontLine(foe);
    const reachable = all.filter((t) => t.line === front);
    const taunter = reachable.find((t) => t.ability === 'taunt' && t.line === 0);
    return taunter ? [taunter] : reachable;
  }

  /**
   * Emplacements où l'unité peut permuter : un allié de l'AUTRE ligne (échange)
   * ou une place libre de cette ligne (repli). Le repli est indispensable —
   * sans lui, « reformer le mur » après la chute du dernier tank serait
   * impossible, alors que le design en fait la respiration tactique du jeu.
   */
  legalSwaps(uid: number): SwapSlot[] {
    const u = this.byUid(uid);
    if (!u || u.dead) return [];
    const other: Line = u.line === 0 ? 1 : 0;
    const occupants = this.lineUnits(u.side, other);
    const out: SwapSlot[] = occupants.map((o) => ({ line: other, slot: o.slot, occupant: o.uid }));
    if (occupants.length < this.capOf(u.side, other)) {
      const taken = new Set(occupants.map((o) => o.slot));
      for (let s = 0; s < this.capOf(u.side, other); s++) {
        if (!taken.has(s)) {
          out.push({ line: other, slot: s, occupant: null });
          break; // une seule place libre proposée : elles sont interchangeables
        }
      }
    }
    return out;
  }

  /** L'unité peut-elle utiliser sa capacité ACTIVE maintenant ? */
  canUseAbility(uid: number): boolean {
    const u = this.byUid(uid);
    if (!u || u.dead || !abilityIsActive(u.ability)) return false;
    if (u.ability === 'secondWind') return !u.usedSecondWind;
    if (u.ability === 'runicVolley') return u.cd <= 0;
    if (u.ability === 'brew') return this.alive(u.side).length > 0;
    // La Frappe large n'existe qu'en phase 2 : avant, le boss attaque normalement.
    if (u.ability === 'jailer') return u.phased;
    return true;
  }

  /** Unité dont c'est le tour, ou `null` si le combat est fini. */
  current(): CUnit | null {
    if (this.outcome) return null;
    const uid = this.order[this.turnIndex];
    const u = uid === undefined ? undefined : this.byUid(uid);
    return u && !u.dead ? u : null;
  }

  /**
   * Ordre de tour À AFFICHER : la fin de la manche en cours, PROLONGÉE par la
   * manche suivante jusqu'à `max` vignettes.
   *
   * Le prolongement n'est pas cosmétique : en fin de manche il ne reste qu'une
   * ou deux unités, et un bandeau presque vide ne dit plus rien de l'ordre —
   * alors que « l'INIT est une statistique, pas une décoration » est
   * précisément ce que le bandeau doit enseigner. La projection est exacte tant
   * que personne ne meurt d'ici là, ce que le joueur sait.
   */
  queue(max = 8): CUnit[] {
    const out: CUnit[] = [];
    for (let i = this.turnIndex; i < this.order.length && out.length < max; i++) {
      const u = this.byUid(this.order[i]);
      if (u && !u.dead) out.push(u);
    }
    if (out.length >= max || this.outcome) return out;
    for (const u of this.projectedOrder()) {
      if (out.length >= max) break;
      out.push(u);
    }
    return out;
  }

  /** L'ordre qu'aura la prochaine manche, à effectif constant. */
  private projectedOrder(): CUnit[] {
    return this.alive()
      .slice()
      .sort((a, b) => {
        const d = this.initOf(b) - this.initOf(a);
        if (d !== 0) return d;
        if (a.side !== b.side) return a.side - b.side;
        return a.uid - b.uid;
      });
  }

  /**
   * Dégâts d'une attaque, à l'unité près. Réduction SOUSTRACTIVE, plancher à 1 :
   * une armure ne rend jamais invulnérable.
   */
  damageOf(attacker: CUnit, target: CUnit): number {
    let raw = this.atkOf(attacker);
    if (attacker.ability === 'momentum' && target.hp >= target.maxHp) raw += MOMENTUM_BONUS;
    if (attacker.ability === 'aimed' && target.line === 1) raw += AIMED_BONUS;
    let cut = target.armor;
    if (target.defending) cut += DEFEND_REDUCTION;
    if (attacker.reach === 'melee' && target.item === 'shield') cut += SHIELD_REDUCTION;
    return Math.max(MIN_DAMAGE, raw - cut);
  }

  // ─────────────────────────────────────────────────── écriture

  /**
   * Joue l'action de l'unité active. Renvoie `false` si l'action est illégale —
   * l'UI n'a alors rien à défaire, et le bot le détecte immédiatement.
   */
  act(action: Action): boolean {
    const u = this.current();
    if (!u) return false;

    switch (action.kind) {
      case 'attack': {
        const target = this.legalTargets(u.uid).find((t) => t.uid === action.target);
        if (!target) return false;
        this.strike(u, target);
        break;
      }
      case 'ability': {
        if (!this.canUseAbility(u.uid)) return false;
        if (!this.useAbility(u, action)) return false;
        break;
      }
      case 'swap': {
        const dest = this.legalSwaps(u.uid).find((s) => s.line === action.line && s.slot === action.slot);
        if (!dest) return false;
        const free = u.item === 'boots' && !u.usedFreeSwap;
        this.applySwap(u, dest);
        // Bottes lestées : la première permutation du combat ne consomme PAS le
        // tour — l'unité rejoue immédiatement, sans avancer la file.
        if (free) {
          u.usedFreeSwap = true;
          return true;
        }
        break;
      }
      case 'defend':
        u.defending = true;
        this.events.push({ type: 'defend', uid: u.uid });
        break;
      case 'phial': {
        // La Fiole d'écho est HORS cap d'escouade — ce n'est pas une unité,
        // c'est un sort qui a pris la forme d'un corps — mais elle a quand même
        // besoin d'une PLACE sur le plateau : sans emplacement libre au front,
        // le sort n'a nulle part où tomber et l'action est refusée.
        const slot = this.freeFrontSlot(u.side);
        if (slot === null) return false;
        const w = this.spawn({ defId: 'wraith', side: u.side, line: 0, slot });
        this.events.push({ type: 'summon', uids: [w.uid] });
        break;
      }
    }

    if (this.checkEnd()) return true;
    this.advance();
    return true;
  }

  /** Fait jouer l'IA de l'unité active (côté ennemi). Toujours déterministe. */
  autoAct(): void {
    const u = this.current();
    if (!u || u.side !== 1) return;
    if (!this.act(this.enemyAction(u))) {
      // filet de sécurité : une IA sans coup légal se contente de se défendre,
      // plutôt que de bloquer la file de tour pour toujours.
      this.act({ kind: 'defend' });
    }
  }

  /**
   * Choix de l'IA. Aucune part de hasard : le joueur doit pouvoir ANTICIPER,
   * c'est la contrepartie des dégâts déterministes.
   */
  enemyAction(u: CUnit): Action {
    // Idole ronflante : elle ne frappe jamais, elle répare.
    if (u.ability === 'litany') {
      const hurt = this.mostWounded(u.side);
      if (hurt) return { kind: 'ability', target: hurt.uid };
      return { kind: 'defend' };
    }
    // Geôlier en phase 2 : Frappe large, elle touche tout le front adverse.
    if (u.ability === 'jailer' && u.phased) return { kind: 'ability' };

    const targets = this.legalTargets(u.uid);
    if (targets.length === 0) return { kind: 'defend' };

    // Rôdeur : le perceur. Il vise la ligne ARRIÈRE du joueur en priorité —
    // c'est lui qui interdit « je mure et je gagne » et qui force la permutation
    // à un moment que le joueur n'a pas choisi.
    const pool = u.ability === 'stalker' ? (targets.filter((t) => t.line === 1).length ? targets.filter((t) => t.line === 1) : targets) : targets;

    // Priorité au létal, puis à la cible la plus basse en PV : lisible, et ça
    // punit exactement le joueur qui laisse traîner un blessé au front.
    let best = pool[0];
    let bestScore = -Infinity;
    for (const t of pool) {
      const dmg = this.damageOf(u, t);
      const score = (dmg >= t.hp ? 1000 : 0) - t.hp + dmg;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return { kind: 'attack', target: best.uid };
  }

  // ─────────────────────────────────────────────────── interne

  private spawn(p: Placement): CUnit {
    const def = unitDef(p.defId);
    const maxHp = p.maxHp ?? def.hp;
    const u: CUnit = {
      uid: this.nextUid++,
      defId: def.id,
      name: def.name,
      sprite: def.sprite,
      side: p.side,
      line: p.line,
      slot: p.slot,
      hp: Math.max(1, Math.min(maxHp, p.hp ?? maxHp)),
      maxHp,
      baseAtk: def.atk,
      baseInit: def.init,
      reach: def.reach,
      armor: def.armor,
      ability: def.ability,
      item: p.item ?? null,
      defending: false,
      usedSecondWind: false,
      cd: 0,
      usedFreeSwap: false,
      turnsLeft: def.id === 'wraith' ? 2 : -1,
      phased: false,
      dead: false,
    };
    this.units.push(u);
    return u;
  }

  private mostWounded(side: Side): CUnit | null {
    let best: CUnit | null = null;
    let worst = 0;
    for (const u of this.alive(side)) {
      const missing = u.maxHp - u.hp;
      if (missing > worst) {
        worst = missing;
        best = u;
      }
    }
    return best;
  }

  private strike(attacker: CUnit, target: CUnit): void {
    const dmg = this.damageOf(attacker, target);
    this.events.push({ type: 'attack', from: attacker.uid, to: target.uid, dmg });
    this.applyDamage(attacker, target, dmg);
  }

  private applyDamage(source: CUnit | null, target: CUnit, dmg: number): void {
    target.hp -= dmg;
    if (source && source.side === 0) this.damageDealt += dmg;
    if (target.hp <= 0) {
      target.hp = 0;
      this.kill(target);
      if (source && source.side === 0) this.kills++;
    } else if (target.ability === 'jailer' && !target.phased && target.hp <= target.maxHp * BOSS_PHASE2_AT) {
      this.enterPhase2(target);
    }
  }

  /**
   * Une unité morte LIBÈRE son emplacement. C'est indispensable : sans ça, un
   * arrière ne pourrait jamais remonter au front pour reformer le mur, alors que
   * le design en fait le moment fort du combat.
   */
  private kill(u: CUnit): void {
    u.dead = true;
    this.events.push({ type: 'death', uid: u.uid });
  }

  private enterPhase2(boss: CUnit): void {
    boss.phased = true;
    this.events.push({ type: 'phase', uid: boss.uid });
    const uids: number[] = [];
    const taken = new Set(this.lineUnits(1, 1).map((o) => o.slot));
    for (const id of BOSS_SUMMONS) {
      let slot = 0;
      while (taken.has(slot)) slot++;
      if (slot >= LINE_CAP) break; // la ligne arrière est pleine : pas de renfort
      taken.add(slot);
      uids.push(this.spawn({ defId: id, side: 1, line: 1, slot }).uid);
    }
    if (uids.length) this.events.push({ type: 'summon', uids });
  }

  private useAbility(u: CUnit, action: Action & { kind: 'ability' }): boolean {
    switch (u.ability) {
      case 'secondWind': {
        u.usedSecondWind = true;
        const gain = Math.min(SECOND_WIND_HEAL, u.maxHp - u.hp);
        u.hp += gain;
        this.events.push({ type: 'heal', from: u.uid, to: u.uid, amount: gain });
        return true;
      }
      case 'brew': {
        const target = this.alive(u.side).find((t) => t.uid === action.target);
        if (!target) return false;
        const gain = Math.min(BREW_HEAL, target.maxHp - target.hp);
        target.hp += gain;
        this.events.push({ type: 'heal', from: u.uid, to: target.uid, amount: gain });
        return true;
      }
      case 'runicVolley': {
        const foe: Side = u.side === 0 ? 1 : 0;
        const line: Line = action.line === 1 ? 1 : 0;
        const victims = this.lineUnits(foe, line);
        if (victims.length === 0) return false;
        const hits: Hit[] = victims.map((t) => ({ to: t.uid, dmg: RUNIC_DAMAGE }));
        this.events.push({ type: 'volley', from: u.uid, line, hits });
        for (const h of hits) {
          const t = this.byUid(h.to);
          if (t && !t.dead) this.applyDamage(u, t, h.dmg);
        }
        u.cd = RUNIC_COOLDOWN + 1; // +1 : la recharge est décomptée dès ce tour
        return true;
      }
      case 'litany': {
        const target = this.alive(u.side).find((t) => t.uid === action.target);
        if (!target) return false;
        const gain = Math.min(LITANY_HEAL, target.maxHp - target.hp);
        target.hp += gain;
        this.events.push({ type: 'heal', from: u.uid, to: target.uid, amount: gain });
        return true;
      }
      case 'jailer': {
        // Frappe large : tout le front adverse à la fois. Elle récompense
        // exactement le joueur qui a gardé un front à deux en bonne santé.
        const foe: Side = u.side === 0 ? 1 : 0;
        const victims = this.lineUnits(foe, this.frontLine(foe));
        if (victims.length === 0) return false;
        const hits: Hit[] = victims.map((t) => ({ to: t.uid, dmg: this.damageOf(u, t) }));
        this.events.push({ type: 'wide', from: u.uid, hits });
        for (const h of hits) {
          const t = this.byUid(h.to);
          if (t && !t.dead) this.applyDamage(u, t, h.dmg);
        }
        return true;
      }
      default:
        return false;
    }
  }

  private applySwap(u: CUnit, dest: SwapSlot): void {
    const other = dest.occupant === null ? null : this.byUid(dest.occupant) ?? null;
    const fromLine = u.line;
    const fromSlot = u.slot;
    u.line = dest.line;
    u.slot = dest.slot;
    if (other) {
      other.line = fromLine;
      other.slot = fromSlot;
    }
    this.events.push({ type: 'swap', uid: u.uid, other: other?.uid ?? null });
  }

  private checkEnd(): boolean {
    if (this.outcome) return true;
    if (this.alive(1).length === 0) {
      this.outcome = 'victory';
      this.events.push({ type: 'end', victory: true });
      return true;
    }
    // Un spectre ne compte pas : il expire tout seul, une escouade réduite à un
    // spectre a déjà perdu (design — ce n'est pas une unité, c'est un sort).
    if (this.alive(0).filter((u) => u.defId !== 'wraith').length === 0) {
      this.outcome = 'defeat';
      this.events.push({ type: 'end', victory: false });
      return true;
    }
    return false;
  }

  /** Y a-t-il une place au front de ce camp ? (invocation de Fiole d'écho) */
  freeFrontSlot(side: Side): number | null {
    const cap = this.capOf(side, 0);
    const taken = new Set(this.lineUnits(side, 0).map((u) => u.slot));
    for (let s = 0; s < cap; s++) if (!taken.has(s)) return s;
    return null;
  }

  /** Trie la manche : INIT décroissante, égalité → l'unité alliée passe devant. */
  private startRound(): void {
    this.round++;
    this.order = this.alive()
      .slice()
      .sort((a, b) => {
        const d = this.initOf(b) - this.initOf(a);
        if (d !== 0) return d;
        if (a.side !== b.side) return a.side - b.side;
        return a.uid - b.uid;
      })
      .map((u) => u.uid);
    this.turnIndex = -1;
    this.advance();
  }

  /** Passe à l'unité suivante, en sautant les mortes et en ouvrant son tour. */
  private advance(): void {
    if (this.outcome) return;
    for (let guard = 0; guard < 64; guard++) {
      this.turnIndex++;
      if (this.turnIndex >= this.order.length) {
        this.startRound();
        return;
      }
      const u = this.byUid(this.order[this.turnIndex]);
      if (!u || u.dead) continue;
      if (this.beginTurn(u)) return;
    }
  }

  /** Ouvre le tour d'une unité. `false` si elle ne joue pas (spectre expiré). */
  private beginTurn(u: CUnit): boolean {
    // La réduction de Défendre court « jusqu'au prochain tour » : elle tombe
    // donc À L'OUVERTURE du tour suivant, avant que l'unité ne rejoue.
    u.defending = false;
    if (u.cd > 0) u.cd--;
    if (u.turnsLeft > 0) {
      u.turnsLeft--;
      if (u.turnsLeft === 0) {
        // le spectre agit une dernière fois, il disparaîtra au tour d'après
        return true;
      }
    } else if (u.turnsLeft === 0) {
      this.events.push({ type: 'expire', uid: u.uid });
      u.dead = true;
      this.checkEnd();
      return false;
    }
    return true;
  }
}
