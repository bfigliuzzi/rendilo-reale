import type { Sfx } from '../audio/sfx';
import * as B from '../config/balance';
import { makeCampaignLevel, makeEndlessLevel } from '../config/campaign';
import { makeStressLevel } from '../config/levels';
import { ACHIEVEMENTS, isClaimable } from '../meta/achievements';
import { persist, type SaveData } from '../meta/save';
import { computeStats, UPGRADES, type UpgradeId } from '../meta/upgrades';
import { WEAPONS, type WeaponId } from '../meta/weapons';
import type { Hud } from '../ui/hud';
import type { Menu } from '../ui/menu';
import type { RunResult, World } from './world';

export type Mode = 'campaign' | 'endless' | 'stress';

/** Machine à états menu → jeu → résultat ; fait le lien méta (or, sauvegarde) ↔ monde. */
export class Flow {
  mode: Mode = 'campaign';
  levelN = 1;

  constructor(
    private readonly world: World,
    private readonly menu: Menu,
    private readonly sfx: Sfx,
    private readonly hud: Hud,
    private readonly save: SaveData,
  ) {
    menu.bind({
      startCampaign: (n) => this.startCampaign(n),
      startEndless: () => this.startEndless(),
      buyUpgrade: (id) => this.buyUpgrade(id),
      buyWeapon: (id) => this.buyWeapon(id),
      equipWeapon: (id) => this.equipWeapon(id),
      claimAchievement: (id) => this.claimAchievement(id),
      toggleMute: () => this.toggleMute(),
      backToMenu: () => this.showMenu(),
    });
    world.onGameOver = (r) => this.handleGameOver(r);
  }

  showMenu(): void {
    this.world.toIdle();
    this.hud.setInGame(false);
    this.menu.showHome();
  }

  startCampaign(n: number = this.save.campaignLevel): void {
    this.mode = 'campaign';
    this.levelN = Math.max(1, Math.min(n, this.save.campaignLevel));
    this.start(makeCampaignLevel(this.levelN));
  }

  startEndless(): void {
    this.mode = 'endless';
    this.start(makeEndlessLevel());
  }

  startStress(): void {
    this.mode = 'stress';
    this.start(makeStressLevel());
  }

  private start(def: Parameters<World['loadLevel']>[0]): void {
    this.menu.hideAll();
    this.hud.setInGame(true);
    this.world.loadLevel(def, computeStats(this.save));
  }

  private handleGameOver(r: RunResult): void {
    const lootMul = computeStats(this.save).lootMul;
    let bonus = 0;
    let newRecord = false;
    let stars = 0;
    if (this.mode === 'campaign' && r.victory) {
      bonus = Math.round((B.GOLD_VICTORY_BASE + B.GOLD_VICTORY_PER_LEVEL * this.levelN) * lootMul);
      if (this.levelN === this.save.campaignLevel) this.save.campaignLevel++;
      // étoiles selon les survivants ; les nouvelles étoiles paient
      stars = r.squad >= 100 ? 3 : r.squad >= 40 ? 2 : 1;
      const prev = this.save.stars[this.levelN] ?? 0;
      if (stars > prev) {
        bonus += (stars - prev) * 40;
        this.save.stars[this.levelN] = stars;
      }
    } else if (this.mode === 'endless') {
      bonus = Math.round(Math.floor(r.dist / 100) * B.GOLD_ENDLESS_PER_100M * lootMul);
      if (r.dist > this.save.endlessBest) {
        this.save.endlessBest = r.dist;
        newRecord = true;
      }
    }
    if (this.mode !== 'stress') {
      this.save.gold += r.gold + bonus;
      this.save.counters.kills += r.kills;
      this.save.counters.bossKills += r.bossKills;
      this.save.counters.bonusCrates += r.bonusCrates;
      if (this.mode === 'campaign' && r.victory) this.save.counters.wins++;
      persist(this.save);
    }
    if (r.victory) this.sfx.victory();
    else this.sfx.defeat();
    this.hud.setInGame(false);
    this.menu.showResult({
      victory: r.victory,
      mode: this.mode,
      levelN: this.levelN,
      kills: r.kills,
      dist: r.dist,
      squad: r.squad,
      goldRun: r.gold,
      goldBonus: bonus,
      newRecord,
      stars,
    });
  }

  private buyWeapon(id: WeaponId): void {
    const def = WEAPONS.find((w) => w.id === id);
    if (!def) return;
    const level = this.save.weapons[id] ?? 0;
    const cost = level === 0 ? def.unlockCost : level >= def.maxLevel ? Infinity : def.levelCost(level);
    if (this.save.gold < cost) return;
    this.save.gold -= cost;
    this.save.weapons[id] = level + 1;
    if (level === 0) this.save.equipped = id; // débloquer = équiper, réflexe naturel
    persist(this.save);
    this.sfx.buy();
  }

  private equipWeapon(id: WeaponId): void {
    if ((this.save.weapons[id] ?? 0) < 1) return;
    this.save.equipped = id;
    persist(this.save);
    this.sfx.buy();
  }

  private claimAchievement(id: string): void {
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def || !isClaimable(def, this.save)) return;
    this.save.claimed.push(id);
    this.save.gold += def.reward;
    persist(this.save);
    this.sfx.victory();
  }

  private buyUpgrade(id: UpgradeId): void {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return;
    const lvl = this.save.upgrades[id] ?? 0;
    if (lvl >= def.maxLevel) return;
    const cost = def.cost(lvl);
    if (this.save.gold < cost) return;
    this.save.gold -= cost;
    this.save.upgrades[id] = lvl + 1;
    persist(this.save);
    this.sfx.buy();
  }

  private toggleMute(): boolean {
    this.save.muted = !this.save.muted;
    this.sfx.setMuted(this.save.muted);
    persist(this.save);
    return this.save.muted;
  }
}
