import type { SpeciesId } from '../config/levels';

/** Carte de campagne sur l'accueil (une par espèce, dérivée du save par Flow). */
export interface CampaignCardView {
  species: SpeciesId;
  emoji: string;
  name: string;
  done: number; // niveaux gagnés (records enregistrés)
  total: number; // longueur de campagne
  locked: boolean;
  hint: string | null; // nom du niveau-jalon à gagner si verrouillée
}

export interface HomeView {
  campaigns: readonly CampaignCardView[];
  muted: boolean;
}

/** En-tête de la grille de niveaux d'une campagne. */
export interface CampaignHeaderView {
  species: SpeciesId;
  emoji: string;
  name: string;
}

/** Pastille d'un niveau dans la grille de campagne. */
export interface ChipView {
  n: number; // numéro affiché (1-based)
  locked: boolean;
  done: boolean;
  primary: boolean; // prochain niveau jouable (mis en avant)
  bestTime: number | null; // meilleur temps de victoire (s), null si jamais gagné
  fullName: string;
  foes: string; // emoji des clans adverses (aria-label)
}

export interface ResultInfo {
  victory: boolean;
  timeSec: number;
  nodesOwned: number;
  levelName: string;
  playerEmoji: string; // espèce jouée (plus de 🐝 hardcodé)
  hasNext: boolean;
  newBest: boolean;
  unlockedCampaign?: { emoji: string; name: string }; // campagne franchie ce coup-ci
  newFeats: readonly string[]; // noms des succès débloqués cette partie
}

/** Famille de succès à paliers, précalculée par Flow (seul lecteur du save). */
export interface AchEntry {
  icon: string;
  name: string;
  desc: string;
  value: number;
  tier: number; // paliers atteints
  prevTarget: number; // cible du dernier palier atteint (0 si aucun)
  nextTarget: number; // cible du prochain palier
}

/** Succès one-shot, précalculé par Flow. */
export interface FeatEntry {
  icon: string;
  name: string;
  desc: string;
  done: boolean;
  hard: boolean; // « ★ légende » : liseré ambre + libellé (jamais la couleur seule)
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Écrans DOM (accueil, grille de campagne, résultat) — le DOM donne
 * l'accessibilité clavier/lecteur d'écran gratuitement. Menu multi-pages sur le
 * modèle de games/horde/src/ui/menu.ts : UN listener délégué [data-action],
 * `show` anti-clignotement (pas d'animation ni de saut de scroll au re-render du
 * MÊME écran). La navigation est déléguée à Flow (seul détenteur du save), qui
 * rappelle la page voulue avec des données fraîches. Callbacks câblés par Flow.
 */
export class Screens {
  onSelectCampaign: (species: SpeciesId) => void = () => {};
  onPlay: (level: number) => void = () => {}; // level = index 0-based
  onHome: () => void = () => {};
  onMenu: () => void = () => {}; // résultat → grille de la campagne courante
  onReplay: () => void = () => {};
  onNext: () => void = () => {};
  onToggleMute: () => void = () => {};
  onResetProgress: () => void = () => {};
  onShowAchievements: () => void = () => {};

  private lastScreen = ''; // anti-clignotement : n'animer qu'au changement d'écran
  private confirmingReset = false; // confirmation en deux temps du reset
  private homeView: HomeView | null = null; // cache pour re-render local (reset)

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('click', (e) => this.onClick(e));
  }

  showHome(view: HomeView): void {
    this.homeView = view;
    this.paintHome();
  }

  private paintHome(): void {
    const view = this.homeView;
    if (!view) return;
    const cards = view.campaigns
      .map((c) => {
        if (c.locked) {
          const hint = c.hint ? `🔒 Gagne « ${c.hint} »` : '🔒 Verrouillée';
          return `<div class="campaign-card locked" aria-label="${c.name} — verrouillée. ${c.hint ? `Gagne « ${c.hint} »` : ''}">
              <span class="cc-emoji">${c.emoji}</span>
              <span class="cc-body"><span class="cc-name">${c.name}</span><span class="cc-hint">${hint}</span></span>
            </div>`;
        }
        return `<button class="campaign-card" data-action="campaign" data-sp="${c.species}" aria-label="${c.name} — ${c.done} niveaux sur ${c.total}">
            <span class="cc-emoji">${c.emoji}</span>
            <span class="cc-body"><span class="cc-name">${c.name}</span><span class="cc-progress">${c.done}/${c.total}</span></span>
          </button>`;
      })
      .join('');
    const resetBlock = this.confirmingReset
      ? `<div class="reset-warn" role="alert">⚠️ Tout effacer — progression, records, succès ? Définitif.</div>
         <div class="reset-row">
           <button class="btn danger" data-action="reset-confirm">Oui, tout effacer</button>
           <button class="btn" data-action="reset-cancel">Annuler</button>
         </div>`
      : `<button class="btn small" data-action="reset">🗑 Réinitialiser la progression</button>`;
    this.show(
      `
        <h1>ESSAIM</h1>
        <p class="rules">
          👆 Tape tes ruches pour les sélectionner<br />
          🎯 Tape une cible pour envoyer l'essaim<br />
          🍯 Nourris un nid plein pour l'agrandir<br />
          👑 Capture tous les nids pour gagner
        </p>
        <div class="campaigns">${cards}</div>
        <button class="btn" data-action="achievements">🏅 Succès</button>
        <button class="btn small" data-action="mute" aria-pressed="${view.muted}">${view.muted ? '🔇 Son coupé' : '🔊 Son actif'}</button>
        ${resetBlock}
        <a class="btn small hub-link" href="/">← Tous les jeux</a>`,
      'home',
    );
  }

  showCampaign(header: CampaignHeaderView, chips: readonly ChipView[]): void {
    const cells = chips
      .map((ch) => {
        if (ch.locked) {
          return `<button class="chip locked" disabled aria-label="Niveau ${ch.n} — verrouillé">🔒</button>`;
        }
        const cls = ch.primary ? ' primary' : ch.done ? ' done' : '';
        const record = ch.bestTime !== null ? ` — record ${fmtTime(ch.bestTime)}` : '';
        const foes = ch.foes ? ` — adversaires ${ch.foes}` : '';
        // « prochain niveau » : jamais la couleur seule (WCAG 1.4.1) — glyphe ▶
        // + liseré (CSS .chip.primary) + mention dans l'aria-label.
        const next = ch.primary ? ' — prochain niveau' : '';
        const play = ch.primary ? '<span class="chip-next" aria-hidden="true">▶</span>' : '';
        const trophy = ch.bestTime !== null ? '<span class="chip-trophy">🏆</span>' : '';
        const check = ch.done ? '<span class="chip-done">✓</span>' : '';
        return `<button class="chip${cls}" data-action="play" data-idx="${ch.n - 1}" aria-label="Niveau ${ch.n} : ${ch.fullName}${record}${foes}${next}"><span class="chip-n">${ch.n}</span>${check}${trophy}${play}</button>`;
      })
      .join('');
    this.show(
      `
        <h2 class="campaign-title">${header.emoji} ${header.name}</h2>
        <div class="grid">${cells}</div>
        <button class="btn small" data-action="home">← Retour</button>`,
      `campaign:${header.species}`,
    );
  }

  /** Écran des succès : familles à paliers (barres) + hauts faits one-shot. */
  showAchievements(ach: readonly AchEntry[], feats: readonly FeatEntry[]): void {
    const fmt = (n: number): string => n.toLocaleString('fr-FR');
    const cards = ach
      .map((a) => {
        const span = a.nextTarget - a.prevTarget;
        const pct = Math.max(0, Math.min(100, Math.round(((a.value - a.prevTarget) / (span || 1)) * 100)));
        return `<div class="ach">
            <div class="ach-head">${a.icon} <b>${a.name}</b><span class="ach-tier">palier ${a.tier}</span></div>
            <div class="ach-desc">${a.desc} — ${fmt(a.value)}/${fmt(a.nextTarget)}</div>
            <div class="bar" role="progressbar" aria-label="${a.name} — progression vers le palier ${a.tier + 1}"
              aria-valuemin="${a.prevTarget}" aria-valuemax="${a.nextTarget}" aria-valuenow="${a.value}"
              aria-valuetext="${fmt(a.value)} sur ${fmt(a.nextTarget)}"><div class="bar-fill" style="width:${pct}%"></div></div>
          </div>`;
      })
      .join('');
    const cells = feats
      .map((f) => {
        const status = f.done ? 'débloqué' : 'verrouillé';
        const hard = f.hard ? ' <span class="feat-hard">★ légende</span>' : '';
        return `<div class="feat${f.done ? '' : ' locked'}${f.hard ? ' hard' : ''}"
            aria-label="${f.name} — ${f.desc} (${status}${f.hard ? ', légende' : ''})">
            <span class="feat-icon" aria-hidden="true">${f.done ? f.icon : '🔒'}</span>
            <span class="feat-body"><span class="feat-name">${f.name}${hard}</span><span class="feat-desc">${f.desc}</span></span>
          </div>`;
      })
      .join('');
    this.show(
      `
        <h2 class="campaign-title">🏅 Succès</h2>
        <div class="ach-list">${cards}</div>
        <div class="feats">${cells}</div>
        <button class="btn small" data-action="home">← Retour</button>`,
      'achievements',
    );
  }

  showResult(info: ResultInfo): void {
    const title = info.victory ? 'RUCHE TRIOMPHANTE' : 'ESSAIM DÉCIMÉ';
    const bestLine = info.newBest ? ' · 🏆 record !' : '';
    const unlockLine = info.unlockedCampaign
      ? `<div class="unlock-line" role="status">🎉 Nouvelle campagne : ${info.unlockedCampaign.emoji} ${info.unlockedCampaign.name}</div>`
      : '';
    const featLine = info.newFeats.length
      ? `<div class="feat-line" role="status">🏅 Succès : ${info.newFeats.join(' · ')}</div>`
      : '';
    this.show(
      `
        <h2 class="${info.victory ? 'win' : 'lose'}">${title}</h2>
        ${unlockLine}${featLine}
        <p class="result-stats">${info.levelName} · ${fmtTime(info.timeSec)}${bestLine}<br />
          ${info.playerEmoji} ${info.nodesOwned} nid${info.nodesOwned > 1 ? 's' : ''} en ta possession</p>
        ${info.hasNext ? '<button class="btn primary" data-action="next">Niveau suivant</button>' : ''}
        <button class="btn${info.hasNext ? '' : ' primary'}" data-action="replay">Rejouer</button>
        <button class="btn" data-action="menu">Menu</button>`,
      'result',
    );
  }

  hide(): void {
    this.confirmingReset = false;
    this.lastScreen = '';
    this.root.classList.remove('visible');
    this.root.innerHTML = '';
  }

  private show(html: string, screen: string): void {
    // re-render du même écran : pas d'animation d'entrée, scroll préservé —
    // sinon chaque interaction « clignote » (pattern horde).
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
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!btn || btn.hasAttribute('disabled')) return;
    const action = btn.dataset.action;
    // toute navigation autre que « reset » désarme la confirmation en deux temps
    if (action !== 'reset') this.confirmingReset = false;
    switch (action) {
      case 'campaign':
        this.onSelectCampaign(btn.dataset.sp as SpeciesId);
        break;
      case 'play':
        this.onPlay(Number(btn.dataset.idx));
        break;
      case 'home':
        this.onHome();
        break;
      case 'menu':
        this.onMenu();
        break;
      case 'next':
        this.onNext();
        break;
      case 'replay':
        this.onReplay();
        break;
      case 'mute':
        this.onToggleMute();
        break;
      case 'achievements':
        this.onShowAchievements();
        break;
      case 'reset':
        this.confirmingReset = true;
        this.paintHome();
        break;
      case 'reset-cancel':
        this.paintHome();
        break;
      case 'reset-confirm':
        this.onResetProgress();
        break;
    }
  }
}
