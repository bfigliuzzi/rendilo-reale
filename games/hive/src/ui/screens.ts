/** Entrée du menu de sélection de niveau (dérivée de MAPS + save par Flow). */
export interface LevelEntry {
  name: string;
  locked: boolean;
  bestTime: number | null; // meilleur temps de victoire (s), null si jamais gagné
}

export interface ResultInfo {
  victory: boolean;
  timeSec: number;
  nodesOwned: number;
  levelName: string;
  hasNext: boolean;
  newBest: boolean;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Écrans DOM (sélection de niveau, résultat) — le DOM donne l'accessibilité
 * clavier/lecteur d'écran gratuitement. Callbacks câblés par Flow.
 */
export class Screens {
  onPlay: (level: number) => void = () => {};
  onReplay: () => void = () => {};
  onNext: () => void = () => {};
  onMenu: () => void = () => {};
  onToggleMute: () => void = () => {};

  constructor(private readonly root: HTMLElement) {}

  showMenu(levels: LevelEntry[], muted: boolean): void {
    const items = levels
      .map((l, i) => {
        if (l.locked) {
          return `<button class="btn level locked" disabled aria-label="${l.name} (verrouillé)">🔒 ${i + 1}. ${l.name}</button>`;
        }
        const best = l.bestTime !== null ? `<span class="best">🏆 ${fmtTime(l.bestTime)}</span>` : '';
        return `<button class="btn level${l.bestTime !== null ? ' done' : ' primary'}" data-level="${i}">${i + 1}. ${l.name}${best}</button>`;
      })
      .join('');
    this.root.innerHTML = `
      <div class="panel">
        <h1>ESSAIM</h1>
        <p class="rules">
          🐝 Tape tes ruches pour les sélectionner<br />
          🎯 Tape une cible pour envoyer l'essaim<br />
          🍯 Nourris un nid plein pour l'agrandir<br />
          👑 Capture tous les nids pour gagner
        </p>
        <div class="levels">${items}</div>
        <button class="btn small" data-act="mute" aria-pressed="${muted}">${muted ? '🔇 Son coupé' : '🔊 Son actif'}</button>
        <a class="hub-link" href="/">← Tous les jeux</a>
      </div>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((btn) => {
      btn.addEventListener('click', () => this.onPlay(Number(btn.dataset.level)));
    });
    this.root.querySelector('[data-act="mute"]')?.addEventListener('click', () => this.onToggleMute());
    this.root.classList.add('visible');
  }

  showResult(info: ResultInfo): void {
    const title = info.victory ? 'RUCHE TRIOMPHANTE' : 'ESSAIM DÉCIMÉ';
    const bestLine = info.newBest ? ' · 🏆 record !' : '';
    this.root.innerHTML = `
      <div class="panel">
        <h2 class="${info.victory ? 'win' : 'lose'}">${title}</h2>
        <p class="result-stats">${info.levelName} · ${fmtTime(info.timeSec)}${bestLine}<br />
          ${info.victory ? '🐝' : '🪳'} ${info.nodesOwned} nid${info.nodesOwned > 1 ? 's' : ''} en ta possession</p>
        ${info.hasNext ? '<button class="btn primary" data-act="next">Niveau suivant</button>' : ''}
        <button class="btn${info.hasNext ? '' : ' primary'}" data-act="replay">Rejouer</button>
        <button class="btn" data-act="menu">Menu</button>
      </div>`;
    this.root.querySelector('[data-act="next"]')?.addEventListener('click', () => this.onNext());
    this.root.querySelector('[data-act="replay"]')?.addEventListener('click', () => this.onReplay());
    this.root.querySelector('[data-act="menu"]')?.addEventListener('click', () => this.onMenu());
    this.root.classList.add('visible');
  }

  hide(): void {
    this.root.classList.remove('visible');
    this.root.innerHTML = '';
  }
}
