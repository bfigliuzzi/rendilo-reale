import { AMULET_MAX_HP, CLASSES, LINE_CAP, SQUAD_CAP, isSummon, unitDef } from '../config/balance';
import type { ItemId, Line } from '../config/rules';
import type { Placement } from './combat';

/**
 * L'escouade d'UNE run. Les PV ne remontent JAMAIS tout seuls : c'est la règle
 * qui tient toute l'économie debout (design §8.2). Rien ici n'est sauvegardé —
 * l'or, les objets et les unités meurent avec la run, par décision de design.
 */
export interface Member {
  /** Identité stable pendant la run — les combats recopient les PV par cet id. */
  id: number;
  defId: string;
  hp: number;
  item: ItemId | null;
  line: Line;
  slot: number;
  /** Morte mais toujours dans l'escouade : elle occupe sa place jusqu'à la résurrection. */
  dead: boolean;
}

export class Squad {
  readonly members: Member[] = [];
  /** Objets achetés mais portés par personne. Un objet par unité, pas plus. */
  readonly stash: ItemId[] = [];
  private nextId = 1;

  constructor(private frontCap: number = LINE_CAP) {}

  setFrontCap(cap: number): void {
    this.frontCap = cap;
  }

  capOf(line: Line): number {
    return line === 0 ? this.frontCap : LINE_CAP;
  }

  /** PV max d'un membre : sa fiche, plus l'Amulette de sève s'il la porte. */
  maxHpOf(m: Member): number {
    return unitDef(m.defId).hp + (m.item === 'amulet' ? AMULET_MAX_HP : 0);
  }

  get full(): boolean {
    return this.members.length >= SQUAD_CAP;
  }

  /** Vivants — la condition de défaite se lit ici. */
  aliveMembers(): Member[] {
    return this.members.filter((m) => !m.dead);
  }

  /**
   * Recrute. Renvoie `null` si l'escouade est PLEINE : c'est au joueur de
   * renvoyer quelqu'un d'abord, définitivement et sans remboursement — le cap
   * dur est le meilleur générateur de décisions du jeu.
   */
  add(defId: string): Member | null {
    if (this.full) return null;
    const def = unitDef(defId);
    const line = this.freeSlot(def.home) !== null ? def.home : def.home === 0 ? 1 : 0;
    const slot = this.freeSlot(line);
    if (slot === null) return null;
    const m: Member = { id: this.nextId++, defId, hp: def.hp, item: null, line, slot, dead: false };
    // l'Amulette n'est pas encore portée : les PV de départ sont ceux de la fiche
    this.members.push(m);
    return m;
  }

  /** Renvoi définitif. L'objet porté retourne au sac, l'unité non. */
  dismiss(id: number): void {
    const i = this.members.findIndex((m) => m.id === id);
    if (i < 0) return;
    const [m] = this.members.splice(i, 1);
    if (m.item) this.stash.push(m.item);
    this.compact();
  }

  byId(id: number): Member | undefined {
    return this.members.find((m) => m.id === id);
  }

  /** Premier emplacement libre d'une ligne, ou `null` si elle est pleine. */
  freeSlot(line: Line): number | null {
    const taken = new Set(this.members.filter((m) => m.line === line).map((m) => m.slot));
    for (let s = 0; s < this.capOf(line); s++) if (!taken.has(s)) return s;
    return null;
  }

  /**
   * Réorganisation HORS combat : gratuite et libre, dans la limite des caps.
   * Échange avec l'occupant s'il y en a un, sinon simple déplacement.
   */
  place(id: number, line: Line, slot: number): boolean {
    const m = this.byId(id);
    if (!m || slot < 0 || slot >= this.capOf(line)) return false;
    const other = this.members.find((o) => o.line === line && o.slot === slot);
    if (other && other.id === m.id) return true;
    if (other) {
      // un échange est toujours légal : les effectifs par ligne ne bougent pas
      other.line = m.line;
      other.slot = m.slot;
    } else if (m.line !== line && this.members.filter((o) => o.line === line).length >= this.capOf(line)) {
      return false;
    }
    m.line = line;
    m.slot = slot;
    return true;
  }

  /** Équipe un objet du sac. L'objet remplacé y retourne — jamais perdu. */
  equip(id: number, item: ItemId): boolean {
    const m = this.byId(id);
    const i = this.stash.indexOf(item);
    if (!m || i < 0) return false;
    this.stash.splice(i, 1);
    if (m.item) this.stash.push(m.item);
    m.item = item;
    m.hp = Math.min(m.hp, this.maxHpOf(m)); // l'Amulette retirée reclampe les PV
    return true;
  }

  unequip(id: number): boolean {
    const m = this.byId(id);
    if (!m?.item) return false;
    this.stash.push(m.item);
    m.item = null;
    m.hp = Math.min(m.hp, this.maxHpOf(m));
    return true;
  }

  /** Soin payant du marchand. Renvoie les PV réellement rendus. */
  heal(id: number, amount: number): number {
    const m = this.byId(id);
    if (!m || m.dead || isSummon(m.defId)) return 0;
    const gain = Math.min(amount, this.maxHpOf(m) - m.hp);
    m.hp += gain;
    return gain;
  }

  /** Une invocation ne se ressuscite pas : c'est ce qui la rend consommable. */
  canRevive(m: Member): boolean {
    return m.dead && !isSummon(m.defId);
  }

  revive(id: number, fraction: number): boolean {
    const m = this.byId(id);
    if (!m || !this.canRevive(m)) return false;
    m.dead = false;
    m.hp = Math.max(1, Math.round(this.maxHpOf(m) * fraction));
    return true;
  }

  /** Placements de départ d'un combat — les morts restent au vestiaire. */
  toPlacements(): Placement[] {
    return this.aliveMembers().map((m) => ({
      defId: m.defId,
      side: 0 as const,
      line: m.line,
      slot: m.slot,
      hp: m.hp,
      maxHp: this.maxHpOf(m),
      item: m.item,
      memberId: m.id,
    }));
  }

  /**
   * Recopie l'issue d'un combat dans l'escouade : PV persistants, morts
   * enregistrées, et régénération de l'Amulette de sève — le seul PV rendu
   * gratuitement en fin de salle, et il se PAIE à l'achat.
   */
  applyOutcome(rows: readonly { memberId: number; hp: number; dead: boolean }[], amuletRegen: number): void {
    for (const row of rows) {
      const m = this.byId(row.memberId);
      if (!m) continue;
      m.dead = row.dead;
      m.hp = row.dead ? 0 : row.hp;
      if (!row.dead && m.item === 'amulet') m.hp = Math.min(this.maxHpOf(m), m.hp + amuletRegen);
    }
    // Les invocations mortes quittent l'escouade : elles ne se ressuscitent pas,
    // les garder occuperait un slot pour rien.
    for (let i = this.members.length - 1; i >= 0; i--) {
      const m = this.members[i];
      if (m.dead && isSummon(m.defId)) this.members.splice(i, 1);
    }
    this.compact();
  }

  /** Referme les trous d'emplacement après un départ : pas de case fantôme. */
  private compact(): void {
    for (const line of [0, 1] as const) {
      const row = this.members.filter((m) => m.line === line).sort((a, b) => a.slot - b.slot);
      row.forEach((m, i) => {
        m.slot = i;
      });
      // un débordement de cap (Rang serré perdu entre deux runs) redescend
      while (row.length > this.capOf(line)) {
        const m = row.pop();
        if (!m) break;
        const other: Line = line === 0 ? 1 : 0;
        const s = this.freeSlot(other);
        if (s === null) break;
        m.line = other;
        m.slot = s;
      }
    }
  }
}

/** Classes recrutables encore absentes de l'escouade — variété d'abord. */
export function freshClasses(squad: Squad, pool: readonly string[]): string[] {
  const owned = new Set(squad.members.map((m) => m.defId));
  const fresh = pool.filter((id) => !owned.has(id) && CLASSES[id]);
  return fresh.length ? fresh : [...pool];
}
