import { COMP_UNLOCK_LEVEL } from '../config/balance';
import { ACHIEVEMENTS, isClaimable } from '../meta/achievements';
import type { SaveData } from '../meta/save';
import { UPGRADES, type UpgradeId } from '../meta/upgrades';
import { WEAPONS, type WeaponId } from '../meta/weapons';

export interface ResultView {
  victory: boolean;
  mode: 'campaign' | 'endless' | 'stress';
  levelN: number;
  kills: number;
  dist: number;
  squad: number;
  goldRun: number;
  goldBonus: number;
  replayBonus: number; // bonus « même tirage » (+25 %)
  newRecord: boolean;
  stars: number; // 0 hors victoire de campagne
}

export interface MenuHandlers {
  startCampaign: (n: number) => void;
  retrySameSeed: () => void; // rejouer exactement le même tirage (+25 % d'or)
  startEndless: () => void;
  buyUpgrade: (id: UpgradeId) => void;
  buyWeapon: (id: WeaponId) => void;
  equipWeapon: (id: WeaponId) => void;
  adjustComposition: (cls: 'sniper' | 'art', delta: number) => void;
  claimAchievement: (id: string) => void;
  toggleMute: () => boolean;
  backToMenu: () => void;
}

const CLASS_INFO = [
  { id: 'rifle', icon: '🪖', name: 'Fusiliers', desc: 'Équilibrés, cadence rapide.' },
  { id: 'sniper', icon: '🎯', name: 'Snipers', desc: 'Balles lentes mais lourdes (+30 % DPS) — idéal contre brutes, élites et boss ; du gâchis contre les nuées.' },
  { id: 'art', icon: '💥', name: 'Artilleurs', desc: 'Obus lents à dégâts de zone — fauchent les hordes, faibles en monocible.' },
] as const;

/**
 * Écrans DOM (menu, boutique, résultat) par-dessus le canvas. Reconstruits en
 * innerHTML à chaque affichage : hors gameplay, la simplicité prime.
 */
export class Menu {
  private handlers: MenuHandlers | null = null;
  private lastScreen = ''; // anti-clignotement : n'animer qu'au changement d'écran

  constructor(
    private readonly root: HTMLElement,
    private readonly save: SaveData,
  ) {
    root.addEventListener('click', (e) => this.onClick(e));
  }

  bind(handlers: MenuHandlers): void {
    this.handlers = handlers;
  }

  hideAll(): void {
    this.lastScreen = '';
    this.root.innerHTML = '';
    this.root.classList.remove('visible');
  }

  showHome(): void {
    const s = this.save;
    const chips: string[] = [];
    const from = Math.max(1, s.campaignLevel - 3);
    for (let n = from; n < s.campaignLevel + 3; n++) {
      const locked = n > s.campaignLevel;
      const done = n < s.campaignLevel;
      const stars = s.stars[n] ?? 0;
      const starsHtml = done || stars > 0 ? `<span class="chip-stars">${'★'.repeat(stars).padEnd(3, '☆')}</span>` : '';
      chips.push(
        `<button class="chip ${locked ? 'locked' : done ? 'done' : 'next'}" ${locked ? 'disabled' : `data-action="level" data-n="${n}"`}>${locked ? '🔒' : ''} ${n}${starsHtml}</button>`,
      );
    }
    const claimables = ACHIEVEMENTS.filter((a) => isClaimable(a, s)).length;
    this.show(`
      <h1>RENDILO<br>REALE</h1>
      <div class="gold-line">💰 ${s.gold}</div>
      <button class="btn primary" data-action="campaign">▶&nbsp; Campagne — Niveau ${s.campaignLevel}</button>
      <div class="chips">${chips.join('')}</div>
      <button class="btn" data-action="endless">∞&nbsp; Sans fin ${s.endlessBest > 0 ? `— Record ${s.endlessBest} m` : ''}</button>
      <button class="btn" data-action="shop">⬆&nbsp; Arsenal</button>
      <button class="btn" data-action="achievements">🏅&nbsp; Succès${claimables > 0 ? ` <span class="pill">${claimables}</span>` : ''}</button>
      <button class="btn small" data-action="mute">${s.muted ? '🔇 Son coupé' : '🔊 Son actif'}</button>
    `, 'home');
  }

  showShop(): void {
    const s = this.save;
    const upgradeCards = UPGRADES.map((u) => {
      const lvl = s.upgrades[u.id] ?? 0;
      const maxed = lvl >= u.maxLevel;
      const cost = maxed ? 0 : u.cost(lvl);
      const canBuy = !maxed && s.gold >= cost;
      return `
        <div class="card">
          <div class="card-head">${u.icon} <b>${u.name}</b><span class="lvl">niv. ${lvl}/${u.maxLevel}</span></div>
          <div class="card-effect">${u.effectLabel(lvl)}${maxed ? '' : ` &nbsp;→&nbsp; ${u.effectLabel(lvl + 1)}`}</div>
          <button class="btn buy" data-action="buy" data-id="${u.id}" ${canBuy ? '' : 'disabled'}>
            ${maxed ? 'MAX' : `Acheter — ${cost} 💰`}
          </button>
        </div>`;
    }).join('');
    const weaponCards = WEAPONS.map((w) => {
      const lvl = s.weapons[w.id] ?? 0;
      const owned = lvl >= 1;
      const equipped = s.equipped === w.id;
      const maxed = lvl >= w.maxLevel;
      const cost = !owned ? w.unlockCost : maxed ? 0 : w.levelCost(lvl);
      const canBuy = !maxed && s.gold >= cost;
      const buyLabel = !owned ? `Débloquer — ${cost} 💰` : maxed ? 'MAX' : `Améliorer — ${cost} 💰`;
      return `
        <div class="card ${equipped ? 'equipped' : ''}">
          <div class="card-head">${w.icon} <b>${w.name}</b><span class="lvl">${owned ? `niv. ${lvl}/${w.maxLevel}` : '🔒'}</span></div>
          <div class="card-effect">${w.desc}</div>
          <div class="card-row">
            <button class="btn buy" data-action="wbuy" data-id="${w.id}" ${canBuy ? '' : 'disabled'}>${buyLabel}</button>
            ${owned ? `<button class="btn buy alt" data-action="wequip" data-id="${w.id}" ${equipped ? 'disabled' : ''}>${equipped ? '✓ Équipée' : 'Équiper'}</button>` : ''}
          </div>
        </div>`;
    }).join('');
    // composition : débloquée en cours de campagne
    let compSection = `<div class="section-title">Composition</div>
      <div class="card comp-locked">🔒 Débloquée au niveau ${COMP_UNLOCK_LEVEL} de campagne</div>`;
    if (s.campaignLevel >= COMP_UNLOCK_LEVEL) {
      const rows = CLASS_INFO.map((c) => {
        const pct = s.composition[c.id as keyof typeof s.composition];
        const controls =
          c.id === 'rifle'
            ? `<span class="comp-pct">${pct} %</span>`
            : `<button class="btn stepper" data-action="comp" data-cls="${c.id}" data-delta="-10" ${pct <= 0 ? 'disabled' : ''}>−</button>
               <span class="comp-pct">${pct} %</span>
               <button class="btn stepper" data-action="comp" data-cls="${c.id}" data-delta="10" ${s.composition.rifle < 10 ? 'disabled' : ''}>+</button>`;
        return `
          <div class="card">
            <div class="card-head">${c.icon} <b>${c.name}</b><span class="comp-controls">${controls}</span></div>
            <div class="card-effect">${c.desc}</div>
          </div>`;
      }).join('');
      compSection = `<div class="section-title">Composition</div><div class="cards">${rows}</div>`;
    }
    this.show(`
      <h2>Arsenal</h2>
      <div class="gold-line">💰 ${s.gold}</div>
      <div class="section-title">Armes</div>
      <div class="cards">${weaponCards}</div>
      ${compSection}
      <div class="section-title">Améliorations</div>
      <div class="cards">${upgradeCards}</div>
      <button class="btn small" data-action="menu">← Retour</button>
    `, 'shop');
  }

  showAchievements(): void {
    const s = this.save;
    const cards = ACHIEVEMENTS.map((a) => {
      const value = Math.min(a.value(s), a.target);
      const claimed = s.claimed.includes(a.id);
      const claimable = isClaimable(a, s);
      const pct = Math.round((value / a.target) * 100);
      return `
        <div class="card ${claimed ? 'claimed' : ''}">
          <div class="card-head">${a.icon} <b>${a.name}</b><span class="lvl">${value}/${a.target}</span></div>
          <div class="card-effect">${a.desc}</div>
          <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
          <button class="btn buy" data-action="claim" data-id="${a.id}" ${claimable ? '' : 'disabled'}>
            ${claimed ? '✓ Réclamé' : `Réclamer — ${a.reward} 💰`}
          </button>
        </div>`;
    }).join('');
    this.show(`
      <h2>Succès</h2>
      <div class="gold-line">💰 ${s.gold}</div>
      <div class="cards">${cards}</div>
      <button class="btn small" data-action="menu">← Retour</button>
    `, 'achievements');
  }

  showResult(r: ResultView): void {
    const title = r.victory ? 'VICTOIRE' : 'DÉFAITE';
    const starsLine =
      r.stars > 0 ? `<div class="result-stars">${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}</div>` : '';
    const sub =
      r.mode === 'campaign'
        ? `Niveau ${r.levelN}`
        : r.mode === 'endless'
          ? `${r.dist} m ${r.newRecord ? '· 🏆 nouveau record !' : ''}`
          : 'Mode stress';
    const totalGold = r.goldRun + r.goldBonus + r.replayBonus;
    const details = [
      r.goldBonus > 0 ? `bonus ${r.goldBonus}` : '',
      r.replayBonus > 0 ? `rejeu +${r.replayBonus}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const goldLine =
      r.mode === 'stress'
        ? ''
        : `<div class="gold-line">+${totalGold} 💰${details ? ` <span class="dim">(${details})</span>` : ''}</div>`;
    const nextBtn =
      r.victory && r.mode === 'campaign'
        ? `<button class="btn primary" data-action="level" data-n="${r.levelN + 1}">Niveau suivant ▶</button>`
        : '';
    // la revanche sur le même tirage (bonifiée) n'existe qu'après une défaite —
    // sinon on farmerait le +25 % en rejouant en boucle un tirage déjà maîtrisé
    const retrySame = !r.victory
      ? `<button class="btn" data-action="retry-same">↻ Rejouer ce tirage <span class="dim">(+25 % 💰)</span></button>`
      : '';
    const retry =
      r.mode === 'campaign'
        ? `${retrySame}
           <button class="btn" data-action="level" data-n="${r.levelN}">🎲 Nouveau tirage</button>`
        : `<button class="btn" data-action="${r.mode === 'endless' ? 'endless' : 'menu'}">↻ Rejouer</button>`;
    this.show(`
      <h2 class="${r.victory ? 'win' : 'lose'}">${title}</h2>
      ${starsLine}
      <div class="sub">${sub}</div>
      <div class="result-stats">☠ ${r.kills} ennemis · ⚔ ${r.squad} survivants · ${r.dist} m</div>
      ${goldLine}
      ${nextBtn}
      ${retry}
      <button class="btn small" data-action="menu">Menu</button>
    `, 'result');
  }

  private show(html: string, screen: string): void {
    // re-render du même écran (achat, réglage…) : pas d'animation d'entrée, et on
    // préserve la position de scroll — sinon chaque clic « clignote »
    const sameScreen = screen === this.lastScreen;
    const prevScroll = sameScreen ? (this.root.firstElementChild?.scrollTop ?? 0) : 0;
    this.lastScreen = screen;
    this.root.innerHTML = `<div class="panel${sameScreen ? ' no-anim' : ''}">${html}</div>`;
    if (sameScreen && prevScroll > 0) {
      (this.root.firstElementChild as HTMLElement).scrollTop = prevScroll;
    }
    this.root.classList.add('visible');
  }

  private onClick(e: Event): void {
    const h = this.handlers;
    if (!h) return;
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!btn || btn.hasAttribute('disabled')) return;
    switch (btn.dataset.action) {
      case 'campaign':
        h.startCampaign(this.save.campaignLevel);
        break;
      case 'level':
        h.startCampaign(Number(btn.dataset.n));
        break;
      case 'retry-same':
        h.retrySameSeed();
        break;
      case 'endless':
        h.startEndless();
        break;
      case 'shop':
        this.showShop();
        break;
      case 'achievements':
        this.showAchievements();
        break;
      case 'buy':
        h.buyUpgrade(btn.dataset.id as UpgradeId);
        this.showShop(); // re-render : or et niveaux à jour
        break;
      case 'wbuy':
        h.buyWeapon(btn.dataset.id as WeaponId);
        this.showShop();
        break;
      case 'wequip':
        h.equipWeapon(btn.dataset.id as WeaponId);
        this.showShop();
        break;
      case 'comp':
        h.adjustComposition(btn.dataset.cls as 'sniper' | 'art', Number(btn.dataset.delta));
        this.showShop();
        break;
      case 'claim':
        h.claimAchievement(btn.dataset.id!);
        this.showAchievements();
        break;
      case 'mute':
        h.toggleMute();
        this.showHome();
        break;
      case 'menu':
        h.backToMenu();
        break;
    }
  }
}
