import type { RunStats } from '../game/world';
import type { SaveData } from '../meta/save';

export interface ResultView {
  victory: boolean;
  timeSec: number;
  cribHp: number;
  cribMax: number;
  run: RunStats;
  record: boolean;
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
  onToggleMute: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly save: SaveData,
  ) {}

  hide(): void {
    this.root.classList.remove('visible');
    this.root.innerHTML = '';
  }

  showMenu(): void {
    const best =
      this.save.bestTimeSec === null
        ? 'Aucune victoire enregistrée.'
        : `Meilleur temps : ${fmt(this.save.bestTimeSec)} · berceau à ${Math.ceil(this.save.bestCribHp)} PV`;
    this.render(`
      <div class="panel">
        <h1 tabindex="-1">BERCEAU</h1>
        <p class="sub">Le bébé se déplace et lance ses cubes tout seul.<br>
        Les mamies veulent l'attraper — se faire attraper, c'est se retrouver COLLÉ.<br>
        Protège le berceau jusqu'à l'Aspirateur.</p>
        <button class="btn primary" data-act="play">Jouer</button>
        <p class="best">${best}</p>
        <p class="sub small">${this.save.wins} victoire${this.save.wins > 1 ? 's' : ''} · ${this.save.runs} partie${this.save.runs > 1 ? 's' : ''}</p>
        <p class="sub small">Doigt : glisse n'importe où. Clavier : ZQSD / WASD / flèches.</p>
        <button class="btn small" data-act="mute">${this.save.muted ? '🔇 Son coupé' : '🔊 Son activé'}</button>
        <a class="hub-link btn small" href="/">← Autres jeux</a>
      </div>
    `);
  }

  showResult(v: ResultView): void {
    const cls = v.victory ? 'win' : 'lose';
    const title = v.victory ? 'BERCEAU SAUVÉ' : 'BERCEAU TOMBÉ';
    this.render(`
      <div class="panel">
        <h2 class="${cls}" tabindex="-1">${title}</h2>
        ${v.record ? '<p class="record">★ Nouveau record</p>' : ''}
        <p class="sub">${fmt(v.timeSec)}${v.victory ? ` · berceau à ${Math.ceil(v.cribHp)}/${Math.round(v.cribMax)}` : ''}</p>
        <p class="result-stats">
          ${v.run.kills} ennemis repoussés · ${v.run.picked} objets ramassés<br>
          ${v.run.pins === 0 ? 'jamais cloué au sol' : `cloué ${v.run.pins} fois`}
          · engluement max ${Math.round(v.run.maxGrip * 100)} %
        </p>
        <button class="btn primary" data-act="play">Rejouer</button>
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
