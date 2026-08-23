import type { RunStats } from '../game/world';
import type { LevelRecord, SaveData } from '../meta/save';

export interface LevelCardView {
  idx: number;
  name: string;
  emoji: string;
  nights: number;
  unlocked: boolean;
  /** Nom du niveau prérequis, pour l'annonce d'une carte verrouillée. */
  previous: string | null;
  record: LevelRecord;
}

export interface ResultView {
  victory: boolean;
  levelName: string;
  /** 0-3. Zéro à la défaite. */
  stars: number;
  /** Nuit atteinte, 1-based, et nombre total de nuits du niveau. */
  night: number;
  nights: number;
  /** Temps de NUIT cumulé : le jour n'est pas chronométré. */
  timeSec: number;
  cribHp: number;
  cribMax: number;
  run: RunStats;
  /** Or total gagné sur le niveau — la mesure de ce que le joueur a « produit ». */
  goldEarned: number;
  record: boolean;
  /** Une nuit a été lancée : on peut la rejouer sans reperdre le niveau entier. */
  canRetryNight: boolean;
}

/**
 * Écrans (accueil, résultat) en DOM pur. Ils ne LISENT jamais la sauvegarde
 * directement pour décider quoi que ce soit : Flow leur passe des vues déjà
 * calculées, et c'est Flow — seul — qui écrit le save.
 *
 * Chaque écran remet le focus sur son TITRE (`tabindex="-1"`). C'est le manque
 * relevé dans Essaim : sans ça, après un changement d'écran le focus retombe sur
 * `<body>` et la navigation au clavier repart de zéro à chaque partie.
 */
export class Screens {
  onPlay: (() => void) | null = null;
  onMenu: (() => void) | null = null;
  onLevelSelect: (() => void) | null = null;
  onSelectLevel: ((idx: number) => void) | null = null;
  onRetryNight: (() => void) | null = null;
  onToggleMute: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly save: SaveData,
  ) {}

  hide(): void {
    this.root.classList.remove('visible');
    this.root.innerHTML = '';
  }

  showMenu(anyCleared: boolean): void {
    this.render(`
      <div class="panel">
        <h1 tabindex="-1">BERCEAU</h1>
        <p class="sub">Le bébé se déplace et lance ses cubes tout seul.<br>
        Les mamies veulent l'attraper — se faire attraper, c'est se retrouver COLLÉ.<br>
        Le JOUR, promène-toi et construis. La NUIT, tiens le berceau.</p>
        <button class="btn primary" data-act="play">${anyCleared ? 'Choisir un niveau' : 'Jouer'}</button>
        <p class="sub small">${this.save.wins} victoire${this.save.wins > 1 ? 's' : ''} · ${this.save.runs} partie${this.save.runs > 1 ? 's' : ''}</p>
        <p class="sub small">Doigt : glisse n'importe où. Clavier : ZQSD / WASD / flèches.</p>
        <button class="btn small" data-act="mute">${this.save.muted ? '🔇 Son coupé' : '🔊 Son activé'}</button>
        <a class="hub-link btn small" href="/">← Autres jeux</a>
      </div>
    `);
  }

  /**
   * Sélection de niveau. Une carte verrouillée reste un `<button disabled>` dont
   * l'`aria-label` NOMME le prérequis : « verrouillé, termine Le jardin d'abord ».
   * Un bouton désactivé muet est le pire des deux mondes — on voit qu'il existe et
   * on ne sait pas pourquoi il ne répond pas.
   */
  showLevelSelect(cards: readonly LevelCardView[]): void {
    const rows = cards
      .map((c) => {
        const r = c.record;
        const stars = `${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}`;
        const best =
          r.bestNightSec === null
            ? 'jamais terminé'
            : `${fmt(r.bestNightSec)} de nuit · berceau ${Math.ceil(r.bestCribHp)}`;
        const label = c.unlocked
          ? `${c.name}, ${c.nights} nuits, ${stars}`
          : `${c.name}, verrouillé : termine ${c.previous ?? 'le niveau précédent'} d'abord`;
        return `
        <button class="btn level" data-level="${c.idx}" ${c.unlocked ? '' : 'disabled'} aria-label="${label}">
          <span class="level-emoji" aria-hidden="true">${c.unlocked ? c.emoji : '🔒'}</span>
          <span class="level-text">
            <span class="level-name">${c.name}</span>
            <span class="level-sub">${c.nights} nuits · ${c.unlocked ? best : 'verrouillé'}</span>
          </span>
          <span class="level-stars" aria-hidden="true">${c.unlocked ? stars : ''}</span>
        </button>`;
      })
      .join('');
    this.render(`
      <div class="panel">
        <h1 tabindex="-1">NIVEAUX</h1>
        ${rows}
        <button class="btn small" data-act="home">← Accueil</button>
      </div>
    `);
  }

  showResult(v: ResultView): void {
    const cls = v.victory ? 'win' : 'lose';
    const title = v.victory ? 'BERCEAU SAUVÉ' : 'BERCEAU TOMBÉ';
    const where = v.victory ? `${v.levelName} · ${v.nights} nuits tenues` : `${v.levelName} · tombé à la nuit ${v.night} sur ${v.nights}`;
    // Deux issues à la défaite, dans cet ordre : rejouer la NUIT d'abord, parce que
    // c'est presque toujours ce qu'on veut. Recommencer le niveau entier après une
    // erreur de la dernière nuit serait la punition la plus décourageante possible
    // dans un jeu sans méta-progression, où repartir de zéro n'apporte rien.
    const actions = v.victory
      ? '<button class="btn primary" data-act="play">Rejouer le niveau</button>'
      : `${v.canRetryNight ? '<button class="btn primary" data-act="retry">Rejouer la nuit</button>' : ''}
         <button class="btn" data-act="play">Recommencer le niveau</button>`;
    this.render(`
      <div class="panel">
        <h2 class="${cls}" tabindex="-1">${title}</h2>
        ${v.victory ? `<p class="record">${'★'.repeat(v.stars)}${'☆'.repeat(3 - v.stars)}</p>` : ''}
        ${v.record ? '<p class="record">Nouveau record</p>' : ''}
        <p class="sub">${where} · ${fmt(v.timeSec)} de nuit${v.victory ? `<br>berceau à ${Math.ceil(v.cribHp)}/${Math.round(v.cribMax)}` : ''}</p>
        <p class="result-stats">
          ${v.run.kills} ennemis repoussés · ${Math.round(v.goldEarned)} pièces d’or<br>
          ${v.run.picked} objets ramassés ·
          ${v.run.pins === 0 ? 'jamais cloué au sol' : `cloué ${v.run.pins} fois`}
          · engluement max ${Math.round(v.run.maxGrip * 100)} %
        </p>
        ${actions}
        <button class="btn small" data-act="levels">Niveaux</button>
        <button class="btn small" data-act="menu">Menu</button>
      </div>
    `);
  }

  private render(html: string): void {
    this.root.innerHTML = html;
    this.root.classList.add('visible');
    this.root.querySelector<HTMLButtonElement>('[data-act="play"]')?.addEventListener('click', () => this.onPlay?.());
    this.root.querySelector<HTMLButtonElement>('[data-act="menu"]')?.addEventListener('click', () => this.onMenu?.());
    this.root
      .querySelector<HTMLButtonElement>('[data-act="retry"]')
      ?.addEventListener('click', () => this.onRetryNight?.());
    this.root
      .querySelector<HTMLButtonElement>('[data-act="levels"]')
      ?.addEventListener('click', () => this.onLevelSelect?.());
    this.root.querySelector<HTMLButtonElement>('[data-act="home"]')?.addEventListener('click', () => this.onMenu?.());
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('button[data-level]')) {
      btn.addEventListener('click', () => this.onSelectLevel?.(Number(btn.dataset.level)));
    }
    this.root
      .querySelector<HTMLButtonElement>('[data-act="mute"]')
      ?.addEventListener('click', () => this.onToggleMute?.());
    // le focus va au titre, pas au bouton : on annonce OÙ on est avant de proposer
    // quoi faire, et Tab tombe ensuite naturellement sur l'action principale
    this.root.querySelector<HTMLElement>('h1, h2')?.focus();
  }
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m} min ${s.toString().padStart(2, '0')} s`;
}
