import type { SaveData } from '../meta/save';
import { UPGRADES, type UpgradeId } from '../meta/upgrades';

export interface ResultView {
  victory: boolean;
  mode: 'campaign' | 'endless' | 'stress';
  levelN: number;
  kills: number;
  dist: number;
  squad: number;
  goldRun: number;
  goldBonus: number;
  newRecord: boolean;
}

export interface MenuHandlers {
  startCampaign: (n: number) => void;
  startEndless: () => void;
  buyUpgrade: (id: UpgradeId) => void;
  toggleMute: () => boolean;
  backToMenu: () => void;
}

/**
 * Écrans DOM (menu, boutique, résultat) par-dessus le canvas. Reconstruits en
 * innerHTML à chaque affichage : hors gameplay, la simplicité prime.
 */
export class Menu {
  private handlers: MenuHandlers | null = null;

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
      chips.push(
        `<button class="chip ${locked ? 'locked' : done ? 'done' : 'next'}" ${locked ? 'disabled' : `data-action="level" data-n="${n}"`}>${locked ? '🔒' : done ? '✔' : ''} ${n}</button>`,
      );
    }
    this.show(`
      <h1>RENDILO<br>REALE</h1>
      <div class="gold-line">💰 ${s.gold}</div>
      <button class="btn primary" data-action="campaign">▶&nbsp; Campagne — Niveau ${s.campaignLevel}</button>
      <div class="chips">${chips.join('')}</div>
      <button class="btn" data-action="endless">∞&nbsp; Sans fin ${s.endlessBest > 0 ? `— Record ${s.endlessBest} m` : ''}</button>
      <button class="btn" data-action="shop">⬆&nbsp; Améliorations</button>
      <button class="btn small" data-action="mute">${s.muted ? '🔇 Son coupé' : '🔊 Son actif'}</button>
    `);
  }

  showShop(): void {
    const s = this.save;
    const cards = UPGRADES.map((u) => {
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
    this.show(`
      <h2>Améliorations</h2>
      <div class="gold-line">💰 ${s.gold}</div>
      <div class="cards">${cards}</div>
      <button class="btn small" data-action="menu">← Retour</button>
    `);
  }

  showResult(r: ResultView): void {
    const title = r.victory ? 'VICTOIRE' : 'DÉFAITE';
    const sub =
      r.mode === 'campaign'
        ? `Niveau ${r.levelN}`
        : r.mode === 'endless'
          ? `${r.dist} m ${r.newRecord ? '· 🏆 nouveau record !' : ''}`
          : 'Mode stress';
    const goldLine =
      r.mode === 'stress'
        ? ''
        : `<div class="gold-line">+${r.goldRun + r.goldBonus} 💰${r.goldBonus > 0 ? ` <span class="dim">(dont bonus ${r.goldBonus})</span>` : ''}</div>`;
    const nextBtn =
      r.victory && r.mode === 'campaign'
        ? `<button class="btn primary" data-action="level" data-n="${r.levelN + 1}">Niveau suivant ▶</button>`
        : '';
    const retry =
      r.mode === 'campaign'
        ? `<button class="btn" data-action="level" data-n="${r.levelN}">↻ Rejouer</button>`
        : `<button class="btn" data-action="${r.mode === 'endless' ? 'endless' : 'menu'}">↻ Rejouer</button>`;
    this.show(`
      <h2 class="${r.victory ? 'win' : 'lose'}">${title}</h2>
      <div class="sub">${sub}</div>
      <div class="result-stats">☠ ${r.kills} ennemis · ⚔ ${r.squad} survivants · ${r.dist} m</div>
      ${goldLine}
      ${nextBtn}
      ${retry}
      <button class="btn small" data-action="menu">Menu</button>
    `);
  }

  private show(html: string): void {
    this.root.innerHTML = `<div class="panel">${html}</div>`;
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
      case 'endless':
        h.startEndless();
        break;
      case 'shop':
        this.showShop();
        break;
      case 'buy':
        h.buyUpgrade(btn.dataset.id as UpgradeId);
        this.showShop(); // re-render : or et niveaux à jour
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
