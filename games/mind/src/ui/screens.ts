import type { Difficulty } from '../config/rules';

/** Chaque écran reçoit une vue DÉJÀ calculée : Screens ne lit jamais le save. */
export interface DiffCardView {
  id: Difficulty;
  name: string;
  emoji: string;
  rule: string;
  best: string;
  /**
   * Étiquette mise en avant (« reprise », « conseillé »), ou chaîne vide. Elle
   * est affichée EN MOTS en plus du liseré : un liseré seul serait une
   * information portée par la seule couleur (RGAA 3.1).
   */
  tag: string;
}

export interface HomeView {
  cards: readonly DiffCardView[];
  muted: boolean;
  catMischief: boolean;
  reducedMotion: boolean;
  /** `true` si le système demande déjà moins d'animations (case forcée). */
  systemReducedMotion: boolean;
  streak: number;
  bestStreak: number;
}

export interface AchEntry {
  icon: string;
  name: string;
  desc: string;
  tier: number;
  value: number;
  target: number;
  unit: string;
}

export interface FeatEntry {
  icon: string;
  name: string;
  desc: string;
  unlocked: boolean;
  hard: boolean;
}

export interface ResultInfo {
  victory: boolean;
  difficultyName: string;
  tries: number;
  maxTries: number;
  timeSec: number;
  /** Noms des couleurs du code, dans l'ordre. */
  secret: readonly string[];
  record: boolean;
  freshFeats: readonly { icon: string; name: string }[];
  streak: number;
}

function fmtTime(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/**
 * Écrans DOM (accueil, aide, succès, résultat). Un SEUL écouteur de clic délégué
 * sur la racine, plus un écouteur `change` pour les cases à cocher.
 *
 * Chaque `show*` REPLACE le focus sur le titre du panneau (`tabindex="-1"`) :
 * remplacer `innerHTML` détruit l'élément focalisé et renverrait sinon le focus
 * sur `<body>`, ce qui perdrait un joueur au clavier ou au lecteur d'écran
 * (RGAA 7.x / WCAG 2.4.3).
 */
export class Screens {
  onStart: (d: Difficulty) => void = () => {};
  onHome: () => void = () => {};
  onHelp: () => void = () => {};
  onAchievements: () => void = () => {};
  onReplay: () => void = () => {};
  onResetProgress: () => void = () => {};
  onToggle: (key: 'muted' | 'catMischief' | 'reducedMotion', value: boolean) => void = () => {};

  private confirmingReset = false;
  private currentScreen = '';

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => this.onChange(e));
  }

  hide(): void {
    this.root.classList.remove('visible');
    this.root.replaceChildren();
    this.currentScreen = '';
  }

  showHome(view: HomeView): void {
    const cards = view.cards
      .map(
        (c) => `
      <button class="diff-card${c.tag ? ' recommended' : ''}" type="button"
              data-action="start" data-diff="${c.id}"
              aria-label="${c.name} — ${c.rule}. ${c.best}.${c.tag ? ` ${c.tag}.` : ''}">
        <span class="dc-emoji" aria-hidden="true">${c.emoji}</span>
        <span class="dc-body">
          <span class="dc-name">${c.name}${c.tag ? ` · ${c.tag}` : ''}</span>
          <span class="dc-rule">${c.rule}</span>
          <span class="dc-best">${c.best}</span>
        </span>
      </button>`,
      )
      .join('');

    const streak =
      view.bestStreak > 0
        ? `<p class="sub">Série en cours : ${view.streak} · record : ${view.bestStreak}</p>`
        : '';

    // La case « mouvement réduit » est FORCÉE et désactivée quand le système le
    // demande déjà : on n'autorise pas à contredire une préférence d'accessibilité.
    const rmChecked = view.reducedMotion || view.systemReducedMotion;
    this.show(
      `<div class="panel">
        <h1 tabindex="-1">CERVEAU</h1>
        <p class="sub">Casse le code secret. Le chat, lui, s'en moque.</p>
        ${streak}
        <div class="col">${cards}</div>
        <div class="opt">
          <input type="checkbox" id="opt-cat" data-toggle="catMischief"${view.catMischief ? ' checked' : ''}>
          <label for="opt-cat">Chat farceur
            <span class="opt-hint">Décoché, le chat se promène toujours mais ne touche plus aux pions.</span>
          </label>
        </div>
        <div class="opt">
          <input type="checkbox" id="opt-rm" data-toggle="reducedMotion"${rmChecked ? ' checked' : ''}${view.systemReducedMotion ? ' disabled' : ''}>
          <label for="opt-rm">Réduire les animations
            <span class="opt-hint">${
              view.systemReducedMotion
                ? 'Activé par votre système — les effets sont déjà atténués.'
                : 'Moins de particules, aucune secousse ni éclair.'
            }</span>
          </label>
        </div>
        <div class="opt">
          <input type="checkbox" id="opt-sound" data-toggle="muted"${view.muted ? '' : ' checked'}>
          <label for="opt-sound">Sons</label>
        </div>
        <div class="row2">
          <button class="btn small" type="button" data-action="help">Comment jouer</button>
          <button class="btn small" type="button" data-action="ach">🏅 Succès</button>
        </div>
        ${this.resetBlock()}
        <a class="hub-link" href="/">← Tous les jeux</a>
      </div>`,
      'home',
    );
  }

  showHelp(): void {
    this.show(
      `<div class="panel">
        <h2 tabindex="-1">Comment jouer</h2>
        <p class="rules">
          L'ordinateur cache un code de pions colorés. À chaque essai, remplis la ligne
          en cours puis valide : tu obtiens deux sortes d'indices, sans savoir lesquels
          correspondent à quel emplacement.<br><br>
          <strong>◆ losange jaune plein</strong> — un pion de la bonne couleur, à la bonne place.<br>
          <strong>○ anneau bleu creux</strong> — un pion de la bonne couleur, à la mauvaise place.<br><br>
          Chaque couleur a aussi sa <strong>forme</strong> et son <strong>symbole</strong> :
          nul besoin de distinguer les teintes pour jouer.
        </p>
        <h2>Au clavier</h2>
        <p class="rules">
          <kbd>Tab</kbd> passe d'une zone à l'autre.<br>
          <kbd>←</kbd> <kbd>→</kbd> changent d'emplacement dans la ligne.<br>
          <kbd>1</kbd>…<kbd>8</kbd> posent une couleur, <kbd>0</kbd> le pion vide.<br>
          <kbd>Suppr</kbd> vide l'emplacement.<br>
          <kbd>Entrée</kbd> valide la ligne dès qu'elle est complète.<br>
          <kbd>Z</kbd> annule un méfait du chat.
        </p>
        <button class="btn primary" type="button" data-action="home">Retour</button>
      </div>`,
      'help',
    );
  }

  showAchievements(ach: readonly AchEntry[], feats: readonly FeatEntry[]): void {
    const list = ach
      .map((a) => {
        const pct = Math.min(100, Math.round((a.value / a.target) * 100));
        const unit = a.unit ? ` ${a.unit}` : '';
        return `<div class="ach">
          <div class="ach-head"><span aria-hidden="true">${a.icon}</span><strong>${a.name}</strong>
            <span class="ach-tier">palier ${a.tier + 1}</span></div>
          <div class="ach-desc">${a.desc}</div>
          <div class="bar" role="progressbar" aria-label="${a.name}, palier ${a.tier + 1}"
               aria-valuemin="0" aria-valuemax="${a.target}" aria-valuenow="${a.value}"
               aria-valuetext="${a.value}${unit} sur ${a.target}${unit}">
            <div class="bar-fill" style="width:${pct}%"></div>
          </div>
        </div>`;
      })
      .join('');

    const featList = feats
      .map(
        (f) => `<div class="feat${f.unlocked ? '' : ' locked'}${f.hard ? ' hard' : ''}">
          <span class="feat-icon" aria-hidden="true">${f.unlocked ? f.icon : '🔒'}</span>
          <span class="feat-body">
            <span class="feat-name">${f.name}${f.hard ? ' <span class="feat-hard">★ légende</span>' : ''}</span>
            <span class="feat-desc">${f.desc}</span>
          </span>
        </div>`,
      )
      .join('');

    this.show(
      `<div class="panel">
        <h2 tabindex="-1">🏅 Succès</h2>
        <p class="sub">Les paliers n'ont pas de fin et ne rapportent rien : c'est une trace, pas une monnaie.</p>
        <div class="ach-list">${list}</div>
        <h2>Hauts faits</h2>
        <div class="feats">${featList}</div>
        <button class="btn primary" type="button" data-action="home">Retour</button>
      </div>`,
      'ach',
    );
  }

  showResult(info: ResultInfo): void {
    const code = info.secret.map((n) => `<span>${n}</span>`).join(' · ');
    const feats = info.freshFeats
      .map((f) => `<p class="feat-line" role="status">${f.icon} ${f.name} débloqué !</p>`)
      .join('');
    const record = info.record ? '<p class="feat-line" role="status">🏅 Nouveau record !</p>' : '';
    const streak = info.victory && info.streak > 1 ? `<p class="sub">${info.streak} victoires d'affilée</p>` : '';

    this.show(
      `<div class="panel">
        <h2 class="${info.victory ? 'win' : 'lose'}" tabindex="-1">${info.victory ? 'CODE TROUVÉ' : 'CODE MANQUÉ'}</h2>
        <p class="sub">${info.difficultyName} — ${
          info.victory
            ? `${info.tries} essai${info.tries > 1 ? 's' : ''} sur ${info.maxTries}, en ${fmtTime(info.timeSec)}`
            : `${info.maxTries} essais épuisés en ${fmtTime(info.timeSec)}`
        }</p>
        <div class="result-code" aria-label="Le code était : ${info.secret.join(', ')}">${code}</div>
        ${record}${streak}${feats}
        <button class="btn primary" type="button" data-action="replay">Rejouer</button>
        <div class="row2">
          <button class="btn" type="button" data-action="home">Menu</button>
          <button class="btn" type="button" data-action="ach">🏅</button>
        </div>
      </div>`,
      'result',
    );
  }

  // ───────────────────────────────────────────────────────── interne

  private resetBlock(): string {
    if (!this.confirmingReset) {
      return '<button class="btn small" type="button" data-action="reset-ask">Réinitialiser la progression</button>';
    }
    return `<p class="reset-warn" role="alert">Records, succès et options seront effacés. Sans retour.</p>
      <div class="row2">
        <button class="btn danger" type="button" data-action="reset-do">Effacer</button>
        <button class="btn" type="button" data-action="reset-cancel">Annuler</button>
      </div>`;
  }

  private show(html: string, screen: string): void {
    this.root.innerHTML = html;
    this.root.classList.add('visible');
    const changed = screen !== this.currentScreen;
    this.currentScreen = screen;
    // On ne replace le focus que si l'ÉCRAN change : un simple rafraîchissement
    // (bascule d'option, confirmation de reset) ne doit pas remonter le focus en
    // haut du panneau et perdre le joueur.
    if (changed) {
      const heading = this.root.querySelector<HTMLElement>('[tabindex="-1"]');
      heading?.focus();
    }
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'start': {
        const diff = el.dataset.diff as Difficulty | undefined;
        if (diff) this.onStart(diff);
        break;
      }
      case 'home':
        this.confirmingReset = false;
        this.onHome();
        break;
      case 'help':
        this.onHelp();
        break;
      case 'ach':
        this.onAchievements();
        break;
      case 'replay':
        this.onReplay();
        break;
      case 'reset-ask':
        this.confirmingReset = true;
        this.onHome();
        break;
      case 'reset-cancel':
        this.confirmingReset = false;
        this.onHome();
        break;
      case 'reset-do':
        this.confirmingReset = false;
        this.onResetProgress();
        break;
    }
  }

  private onChange(e: Event): void {
    const el = e.target as HTMLInputElement | null;
    const key = el?.dataset.toggle;
    if (!el || !key) return;
    // la case « Sons » est en logique inversée : cochée = son actif
    if (key === 'muted') this.onToggle('muted', !el.checked);
    else if (key === 'catMischief' || key === 'reducedMotion') this.onToggle(key, el.checked);
  }
}
