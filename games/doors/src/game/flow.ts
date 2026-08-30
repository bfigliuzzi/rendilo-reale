import type { Sfx } from '../audio/sfx';
import {
  CLASSES,
  ENEMIES,
  HEAL_COST_PER_HP,
  HEROES,
  ITEMS,
  ITEM_IDS,
  LINE_CAP,
  NODE_COUNT,
  REVIVE_COST,
  SHARDS_BOSS,
  SHARDS_PER_NODE,
  SHARDS_RUN,
  isSummon,
  unitDef,
} from '../config/balance';
import type { ItemId, Line, UnitDef } from '../config/rules';
import { ACHIEVEMENTS, FEATS, evalFeats, reachedTiers, targetOf } from '../meta/achievements';
import { META_NODES, canAfford, metaEffects, metaNode } from '../meta/tree';
import type { MetaId } from '../meta/tree';
import { persist, resetSave } from '../meta/save';
import type { SaveData } from '../meta/save';
import type { Hud } from '../ui/hud';
import type { MemberRow, Screens, UnitCard } from '../ui/screens';
import { Run } from './run';
import type { Member } from './squad';
import type { World } from './world';

/**
 * La machine à états, et LE SEUL endroit qui écrit la sauvegarde (invariant du
 * repo). `World` ne connaît ni les écrans ni la méta ; `Run` ne connaît pas le
 * save ; `Screens` ne lit rien — Flow leur passe des vues déjà calculées.
 *
 * L'écriture du save se fait en UNE fois par fin de run (`endRun`), plus une
 * écriture par changement d'option ou achat de méta : ce sont des actes
 * explicites du joueur, jamais un effet de bord de la simulation.
 */
export type FlowState = 'menu' | 'help' | 'tree' | 'ach' | 'run' | 'result';

/** Pas de soin proposé d'un clic au marchand. */
const HEAL_STEP = 5;

export class Flow {
  state: FlowState = 'menu';
  run: Run | null = null;

  private runStartMs = 0;
  /** Écran à rouvrir quand on ferme le panneau d'escouade. */
  private squadReturn: 'shop' | 'doors' = 'doors';
  /** Décès CUMULÉS de la run, invocations comprises — lu par les hauts faits. */
  private deaths = 0;
  private knownDead = new Set<number>();
  /** Le panneau d'escouade est-il ouvert par-dessus la salle courante ? */
  private squadOpen = false;

  constructor(
    private readonly world: World,
    private readonly screens: Screens,
    private readonly hud: Hud,
    private readonly save: SaveData,
    private readonly sfx: Sfx,
    private readonly systemReducedMotion: boolean,
  ) {
    world.onCombatOver = (victory) => this.onCombatOver(victory);
    world.onAnnounce = (text) => this.hud.log(text);
    world.onStateChanged = () => this.hud.refresh();

    hud.onMenu = () => this.showMenu();
    hud.onHelp = () => this.showHelp();
    hud.onAct = (action) => {
      this.world.playerAct(action);
      this.hud.refresh();
    };
    hud.onDoor = (i) => this.enterDoor(i);
    hud.onReveal = () => {
      if (this.run?.revealVeiled()) {
        this.sfx.tap();
        this.hud.refresh();
      }
    };
    hud.onSquad = () => {
      this.squadReturn = 'doors';
      this.showSquad();
    };

    screens.onStart = (hero) => this.startRun(hero);
    screens.onHome = () => this.showMenu();
    screens.onHelp = () => this.showHelp();
    screens.onTree = () => this.showTree();
    screens.onAchievements = () => this.showAchievements();
    screens.onBuyMeta = (id) => this.buyMeta(id);
    screens.onToggle = (key, value) => this.setOption(key, value);
    screens.onResetProgress = () => {
      resetSave(this.save);
      persist(this.save);
      this.applyOptions();
      this.showMenu();
    };
    screens.onAccept = () => this.acceptRoom();
    screens.onRefuse = () => this.leaveRoom();
    screens.onDismiss = (id) => this.dismiss(id);
    screens.onShopBuy = (kind, arg) => this.shopBuy(kind, arg);
    screens.onLeaveRoom = () => this.leaveRoom();
    screens.onOpenSquad = () => {
      if (this.run?.phase === 'shop' && !this.squadOpen) this.squadReturn = 'shop';
      this.showSquad();
    };
    screens.onSwapSlots = (a, b) => this.swapSlots(a, b);
    screens.onEquip = (id, item) => this.equip(id, item);
    screens.onUnequip = (id) => this.unequip(id);
    screens.onReplay = () => this.startRun(this.save.lastHero);

    this.applyOptions();
  }

  // ─────────────────────────────────────────────── options

  private applyOptions(): void {
    this.sfx.setMuted(this.save.muted);
    // `prefers-reduced-motion` s'ajoute en OU à l'option du joueur, jamais en ET :
    // on ne contredit pas une préférence système d'accessibilité.
    this.world.setReducedMotion(this.save.reducedMotion || this.systemReducedMotion);
  }

  private setOption(key: 'muted' | 'reducedMotion', value: boolean): void {
    this.save[key] = value;
    persist(this.save);
    this.applyOptions();
    this.showMenu();
  }

  // ─────────────────────────────────────────────── écrans hors run

  showMenu(): void {
    this.state = 'menu';
    this.run = null;
    this.world.setRun(null);
    this.hud.refresh();
    const effects = metaEffects(this.save);
    this.screens.showHome({
      heroes: HEROES.map((id) => {
        const def = CLASSES[id];
        return {
          id,
          name: def.name,
          sprite: def.sprite,
          stats: statLine(def),
          blurb: def.blurb,
          locked: !effects.heroes.includes(id),
        };
      }),
      shards: this.save.shards,
      bestNodes: this.save.bestNodes,
      bestWinSec: this.save.bestWinSec,
      runs: this.save.counters.runs,
      wins: this.save.counters.wins,
      muted: this.save.muted,
      reducedMotion: this.save.reducedMotion,
      systemReducedMotion: this.systemReducedMotion,
      affordable: META_NODES.filter((n) => canAfford(this.save, n.id)).length,
    });
  }

  showHelp(): void {
    this.state = 'help';
    this.screens.showHelp(
      Object.values(ENEMIES).map(toCard),
      [CLASSES.wanderer, CLASSES.guardian, CLASSES.headsman, CLASSES.archer, CLASSES.herbalist, CLASSES.runist].map(toCard),
    );
  }

  showTree(): void {
    this.state = 'tree';
    this.screens.showTree(
      META_NODES.map((n) => ({
        id: n.id,
        name: n.name,
        icon: n.icon,
        cost: n.cost,
        effect: n.effect,
        why: n.why,
        owned: this.save.unlocked[n.id] === true,
        affordable: canAfford(this.save, n.id),
      })),
      this.save.shards,
    );
  }

  showAchievements(): void {
    this.state = 'ach';
    this.screens.showAchievements(
      ACHIEVEMENTS.map((a) => {
        const tier = reachedTiers(a, this.save);
        return { icon: a.icon, name: a.name, desc: a.desc, tier, value: a.value(this.save), target: targetOf(a, tier) };
      }),
      FEATS.map((f) => ({
        icon: f.icon,
        name: f.name,
        desc: f.desc,
        unlocked: this.save.feats[f.id] === true,
        hard: f.hard === true,
      })),
    );
  }

  private buyMeta(id: MetaId): void {
    if (!canAfford(this.save, id)) return;
    const node = metaNode(id);
    this.save.shards -= node.cost;
    this.save.spent += node.cost;
    this.save.unlocked[id] = true;
    persist(this.save);
    this.sfx.gold();
    this.showTree();
  }

  // ─────────────────────────────────────────────── run

  /** `seed` explicite = run reproductible (c'est ce qu'utilise le bot). */
  startRun(hero: string, seed?: number): void {
    const effects = metaEffects(this.save);
    const chosen = effects.heroes.includes(hero) ? hero : effects.heroes[0];
    this.save.lastHero = chosen;
    this.state = 'run';
    this.deaths = 0;
    this.knownDead.clear();
    this.runStartMs = performance.now();
    this.run = new Run(seed ?? (Math.random() * 0xffffffff) >>> 0, effects, chosen);
    this.world.setRun(this.run);
    this.closeScreens();
  }

  private enterDoor(index: number): void {
    const run = this.run;
    if (!run || run.phase !== 'doors') return;
    this.sfx.door();
    if (!run.enter(index)) return;
    // `run.combat` reste `null` hors salle de combat — on s'en sert plutôt que
    // de relire `run.phase`, que TypeScript a déjà narrowé sur la garde du dessus.
    if (run.current && run.current.gold > 0 && run.combat === null) this.sfx.gold();
    this.openRoom();
  }

  /** Ouvre l'écran correspondant à la phase courante de la run. */
  private openRoom(): void {
    const run = this.run;
    if (!run) return;
    this.squadOpen = false;
    this.world.syncMode();
    // Le HUD se rafraîchit AVANT d'ouvrir un panneau : hors combat et hors
    // portes il se masque entièrement, ce qui retire ses boutons de l'ordre de
    // tabulation. Sans ça, un joueur au clavier pouvait tabuler sur des
    // contrôles de combat invisibles, cachés derrière le panneau du marchand.
    this.hud.refresh();
    switch (run.phase) {
      case 'combat':
        this.closeScreens();
        break;
      case 'recruit':
        this.showRecruit();
        break;
      case 'treasure':
        this.showTreasure();
        break;
      case 'shop':
        this.showShop();
        break;
      default:
        this.closeScreens();
    }
  }

  /**
   * Ferme le panneau courant et rend la main à l'écran de jeu — en replaçant le
   * focus si le panneau l'avait. Toute sortie de salle passe par ici.
   */
  private closeScreens(): void {
    const hadFocus = this.screens.hide();
    this.hud.refresh();
    if (hadFocus) this.hud.focusFirst();
  }

  private showRecruit(): void {
    const run = this.run;
    if (!run?.pending.recruit) return;
    this.screens.showRecruit({
      card: toCard(unitDef(run.pending.recruit)),
      gold: run.gold,
      squad: this.squadRows(),
      full: run.squad.full,
    });
  }

  private showTreasure(): void {
    const run = this.run;
    const t = run?.pending.treasure;
    if (!run || !t) return;
    const kind = t === 'statue' ? 'statue' : t === 'phial' ? 'phial' : 'item';
    const card: UnitCard =
      kind === 'item'
        ? { name: ITEMS[t as ItemId].name, sprite: ITEMS[t as ItemId].sprite, stats: `${ITEMS[t as ItemId].price} or au marchand`, blurb: ITEMS[t as ItemId].effect }
        : kind === 'statue'
          ? toCard(CLASSES.statue)
          : { name: 'Fiole d’écho', sprite: 'wraith', stats: 'Spectre : 8 PV · 5 ATQ · 2 tours', blurb: CLASSES.wraith.blurb };
    this.screens.showTreasure({ card, kind, gold: run.gold, squad: this.squadRows(), full: run.squad.full });
  }

  private showShop(): void {
    const run = this.run;
    if (!run?.shop) return;
    this.screens.showShop({
      gold: run.gold,
      offers: run.shop.items.map((item) => ({
        item,
        name: ITEMS[item].name,
        sprite: ITEMS[item].sprite,
        effect: ITEMS[item].effect,
        price: ITEMS[item].price,
        sold: run.shop!.sold.has(item),
        affordable: run.gold >= ITEMS[item].price,
      })),
      squad: this.squadRows(),
      reviveCost: REVIVE_COST,
      freeRevives: run.freeRevivesLeft,
      healPerHp: HEAL_COST_PER_HP,
      healStep: HEAL_STEP,
    });
  }

  private showSquad(): void {
    const run = this.run;
    if (!run) return;
    this.squadOpen = true;
    this.screens.showSquad({
      squad: this.squadRows(),
      stash: run.squad.stash.map((item) => ({ item, name: ITEMS[item].name, sprite: ITEMS[item].sprite, effect: ITEMS[item].effect })),
      frontCap: run.meta.frontCap,
      backCap: LINE_CAP,
      closeLabel: this.squadReturn === 'shop' ? 'Retour au marchand' : 'Aux portes',
    });
  }

  private squadRows(): MemberRow[] {
    const run = this.run;
    if (!run) return [];
    return run.squad.members.map((m: Member) => ({
      id: m.id,
      name: unitDef(m.defId).name,
      sprite: unitDef(m.defId).sprite,
      line: m.line,
      slot: m.slot,
      hp: m.hp,
      maxHp: run.squad.maxHpOf(m),
      dead: m.dead,
      item: m.item,
      itemName: m.item ? ITEMS[m.item].name : '',
      summon: isSummon(m.defId),
    }));
  }

  // ─────────────────────────────────────────────── décisions de salle

  private acceptRoom(): void {
    const run = this.run;
    if (!run) return;
    if (run.phase === 'recruit' && run.pending.recruit) {
      if (run.squad.add(run.pending.recruit)) {
        this.sfx.gold();
        this.leaveRoom();
      } else {
        this.showRecruit(); // plein : le panneau propose alors le renvoi
      }
      return;
    }
    if (run.phase === 'treasure' && run.pending.treasure) {
      const t = run.pending.treasure;
      if (t === 'statue') {
        if (!run.squad.add('statue')) {
          this.showTreasure();
          return;
        }
      } else if (t === 'phial') {
        run.phials++;
      } else {
        run.squad.stash.push(t);
      }
      this.sfx.gold();
      this.leaveRoom();
      return;
    }
    this.leaveRoom();
  }

  /**
   * Renvoi DÉFINITIF, sans remboursement : c'est le prix du cap dur, et c'est
   * lui qui transforme une récompense en dilemme. On enchaîne aussitôt sur
   * l'acceptation, sinon le joueur devrait re-cliquer sans nouvelle décision.
   */
  private dismiss(memberId: number): void {
    const run = this.run;
    if (!run) return;
    run.squad.dismiss(memberId);
    run.stats.dismissals++;
    this.sfx.death();
    this.acceptRoom();
  }

  private shopBuy(kind: 'item' | 'revive' | 'heal', arg: string): void {
    const run = this.run;
    if (!run) return;
    let ok = false;
    if (kind === 'item') ok = run.buyItem(arg as ItemId);
    else if (kind === 'revive') ok = run.buyRevive(Number(arg), REVIVE_COST);
    else ok = run.buyHeal(Number(arg), HEAL_STEP, HEAL_COST_PER_HP);
    if (ok) this.sfx.gold();
    this.showShop();
  }

  private swapSlots(a: { line: Line; slot: number }, b: { line: Line; slot: number }): void {
    const run = this.run;
    if (!run) return;
    const moving = run.squad.members.find((m) => m.line === a.line && m.slot === a.slot);
    if (moving) run.squad.place(moving.id, b.line, b.slot);
    else {
      const other = run.squad.members.find((m) => m.line === b.line && m.slot === b.slot);
      if (other) run.squad.place(other.id, a.line, a.slot);
    }
    this.sfx.tap();
    this.showSquad();
  }

  private equip(memberId: number, item: ItemId): void {
    this.run?.squad.equip(memberId, item);
    this.sfx.tap();
    this.showSquad();
  }

  private unequip(memberId: number): void {
    this.run?.squad.unequip(memberId);
    this.sfx.tap();
    this.showSquad();
  }

  /** Quitte la salle courante : le panneau d'escouade revient d'où il vient. */
  private leaveRoom(): void {
    const run = this.run;
    if (!run) return;
    // Fermer le panneau d'escouade ne quitte JAMAIS la salle : il s'ouvre par
    // dessus le marchand comme par dessus les portes, et rend la main à l'écran
    // d'où il vient.
    if (this.squadOpen) {
      this.squadOpen = false;
      if (this.squadReturn === 'shop') {
        this.showShop();
        return;
      }
      this.closeScreens();
      return;
    }
    run.advance();
    this.world.syncMode();
    this.closeScreens();
  }

  // ─────────────────────────────────────────────── fin de combat

  private onCombatOver(victory: boolean): void {
    const run = this.run;
    if (!run) return;
    // les morts de la run se comptent AVANT la clôture : `finishCombat` retire
    // les invocations tombées de l'escouade
    for (const u of run.combat?.units ?? []) {
      if (u.side === 0 && u.dead && !this.knownDead.has(u.uid)) {
        this.knownDead.add(u.uid);
        this.deaths++;
      }
    }
    run.finishCombat();
    if (run.phase === 'over') {
      this.endRun(victory && run.victory);
      return;
    }
    run.advance();
    this.world.syncMode();
    this.hud.refresh();
  }

  // ─────────────────────────────────────────────── fin de run

  private endRun(victory: boolean): void {
    const run = this.run;
    if (!run) return;
    const timeSec = (performance.now() - this.runStartMs) / 1000;
    const nodes = Math.min(NODE_COUNT, run.stats.nodesCleared);
    const shards = nodes * SHARDS_PER_NODE + (run.stats.bossDefeated ? SHARDS_BOSS : 0) + SHARDS_RUN;

    // ── UNE écriture de save par fin de run
    const s = this.save;
    s.shards += shards;
    s.counters.runs++;
    s.counters.nodes += nodes;
    s.counters.kills += run.stats.kills;
    s.counters.gold += run.stats.goldEarned;
    s.counters.revives += run.stats.revives;
    s.counters.swaps += run.stats.swaps;
    s.counters.dismissals += run.stats.dismissals;
    s.counters.veiled += run.stats.veiledTaken;
    s.counters.items += run.stats.itemsBought;
    s.counters.playSec += timeSec;
    if (victory) s.counters.wins++;

    const reached = victory ? NODE_COUNT + 1 : run.node;
    const record = reached > s.bestNodes || (victory && (s.bestWinSec === 0 || timeSec < s.bestWinSec));
    if (reached > s.bestNodes) s.bestNodes = reached;
    if (victory && (s.bestWinSec === 0 || timeSec < s.bestWinSec)) s.bestWinSec = timeSec;

    const fresh = evalFeats({
      save: s,
      victory,
      stats: run.stats,
      node: reached,
      gold: run.gold,
      survivors: run.squad.aliveMembers().length,
      deaths: this.deaths,
      timeSec,
    });
    for (const id of fresh) s.feats[id] = true;
    persist(s);

    this.state = 'result';
    this.world.setRun(null);
    this.hud.refresh();
    if (victory) this.sfx.victory();
    else this.sfx.defeat();

    this.screens.showResult({
      victory,
      node: run.node,
      nodeCount: NODE_COUNT,
      shards,
      shardsTotal: s.shards,
      timeSec,
      record,
      lines: [
        `${run.stats.fightsWon} combat${run.stats.fightsWon > 1 ? 's' : ''} remporté${run.stats.fightsWon > 1 ? 's' : ''} · ${run.stats.kills} ennemi${run.stats.kills > 1 ? 's' : ''} abattu${run.stats.kills > 1 ? 's' : ''}`,
        `${run.stats.goldEarned} or gagné · ${run.stats.goldSpent} dépensé`,
        `${run.stats.revives} résurrection${run.stats.revives > 1 ? 's' : ''} · ${run.stats.itemsBought} objet${run.stats.itemsBought > 1 ? 's' : ''} acheté${run.stats.itemsBought > 1 ? 's' : ''}`,
        `${run.stats.swaps} permutation${run.stats.swaps > 1 ? 's' : ''} · ${run.stats.veiledTaken} porte${run.stats.veiledTaken > 1 ? 's' : ''} voilée${run.stats.veiledTaken > 1 ? 's' : ''} franchie${run.stats.veiledTaken > 1 ? 's' : ''}`,
      ],
      freshFeats: fresh.map((id) => {
        const f = FEATS.find((x) => x.id === id);
        return { icon: f?.icon ?? '★', name: f?.name ?? id };
      }),
    });
    this.run = null;
  }
}

function statLine(def: UnitDef): string {
  const bits = [`${def.hp} PV`, `${def.atk} ATQ`, `${def.init} INIT`, def.reach === 'melee' ? 'contact' : 'distance'];
  if (def.armor > 0) bits.push(`armure ${def.armor}`);
  return bits.join(' · ');
}

function toCard(def: UnitDef): UnitCard {
  return { name: def.name, sprite: def.sprite, stats: statLine(def), blurb: def.blurb };
}

/** Objets du jeu, pour l'aide — dérivés de la table, jamais recopiés. */
export const ITEM_CARDS: readonly UnitCard[] = ITEM_IDS.map((id) => ({
  name: ITEMS[id].name,
  sprite: ITEMS[id].sprite,
  stats: `${ITEMS[id].price} or`,
  blurb: ITEMS[id].effect,
}));
