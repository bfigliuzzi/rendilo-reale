/**
 * Écrans DOM (accueil, résultat) — le DOM donne l'accessibilité clavier/lecteur
 * d'écran gratuitement. Callbacks câblés par Flow.
 */
export class Screens {
  onPlay: () => void = () => {};
  onReplay: () => void = () => {};
  onMenu: () => void = () => {};

  constructor(private readonly root: HTMLElement) {}

  showMenu(): void {
    this.root.innerHTML = `
      <div class="panel">
        <h1>ESSAIM</h1>
        <p class="sub">Abeilles contre cafards : submerge la ruche adverse.</p>
        <p class="rules">
          🐝 Tape tes ruches pour les sélectionner<br />
          🎯 Tape une cible pour envoyer l'essaim<br />
          👑 Capture tous les nids pour gagner
        </p>
        <button class="btn primary" data-act="play">Jouer</button>
        <a class="hub-link" href="/">← Tous les jeux</a>
      </div>`;
    this.bind();
    this.root.classList.add('visible');
  }

  showResult(victory: boolean, timeSec: number, nodesOwned: number): void {
    const mins = Math.floor(timeSec / 60);
    const secs = Math.floor(timeSec % 60);
    const time = `${mins}:${String(secs).padStart(2, '0')}`;
    this.root.innerHTML = `
      <div class="panel">
        <h2 class="${victory ? 'win' : 'lose'}">${victory ? 'RUCHE TRIOMPHANTE' : 'ESSAIM DÉCIMÉ'}</h2>
        <p class="result-stats">${victory ? '🐝' : '🪳'} Partie de ${time} · ${nodesOwned} nid${nodesOwned > 1 ? 's' : ''} en ta possession</p>
        <button class="btn primary" data-act="replay">Rejouer</button>
        <button class="btn" data-act="menu">Menu</button>
      </div>`;
    this.bind();
    this.root.classList.add('visible');
  }

  hide(): void {
    this.root.classList.remove('visible');
    this.root.innerHTML = '';
  }

  private bind(): void {
    this.root.querySelector('[data-act="play"]')?.addEventListener('click', () => this.onPlay());
    this.root.querySelector('[data-act="replay"]')?.addEventListener('click', () => this.onReplay());
    this.root.querySelector('[data-act="menu"]')?.addEventListener('click', () => this.onMenu());
  }
}
