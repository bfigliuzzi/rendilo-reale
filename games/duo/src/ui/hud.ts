import type { MascotDef } from '../config/mascots';
import type { StarLevel } from '../meta/save';

/**
 * LE BANDEAU DE TABLE (§4.1.3) et les deux régions live.
 *
 * Contenu imposé par la spec, et rien de plus : les deux mascottes, le score
 * ÉPHÉMÈRE de la table, 🔊 et ⏸. Pas de bouton « quitter » ici — il vit dans le
 * panneau de pause : quatre commandes dans un bandeau que deux enfants tapent à
 * l'aveugle, c'est déjà le maximum, et « quitter » à côté de « pause » se
 * touche par erreur au milieu d'une manche.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI LE BANDEAU N'EST PAS DANS `#overlay`
 * `#overlay` vit dans le repère LOGIQUE du micro-jeu courant, qui bascule de
 * 540×960 à 960×540 entre deux jeux. Un ⏸ posé là changerait de taille ET de
 * place à chaque changement de posture, alors que le §1.2 en fait une commande
 * « toujours atteignable » : le plat arrive au milieu de la manche, c'est le
 * cas nominal. Le bandeau vit donc en ESPACE ÉCRAN, dans `#hud`, hors du
 * letterbox. Corollaire : `#hud` est `pointer-events: none`, il faut le rendre
 * au CONTENEUR `.hudbar` et pas seulement à ses boutons — sinon un doigt qui
 * atterrit entre 🔊 et ⏸ traverse (piège vécu sur Berceau).
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le Hud possède aussi `#sr-log` et `#sr-board`, les deux seules voix du jeu
 * pour un lecteur d'écran (le canvas est `aria-hidden`). Les deux n'écrivent
 * QUE sur changement réel : `refresh()` tourne à chaque changement d'état, y
 * compris quand rien d'affiché ne bouge, et réécrire aveuglément ferait répéter
 * la même phrase en boucle.
 */

/** Vue déjà calculée : le Hud ne lit jamais la session ni le save. */
export interface HudView {
  mascots: readonly [MascotDef, MascotDef];
  stars: readonly [StarLevel, StarLevel];
  /** Score de la table — ÉPHÉMÈRE, jamais persisté (§1.3). */
  score: readonly [number, number];
  /** « Le perdant choisit » : sa mascotte est agrandie. `null` sinon. */
  chooser: 0 | 1 | null;
  muted: boolean;
  paused: boolean;
  /**
   * ⏸ n'a de sens qu'en manche. Hors manche il est `disabled` plutôt que
   * masqué : un bouton qui disparaît et réapparaît déplace les deux autres, et
   * deux enfants tapent le bandeau à l'aveugle.
   */
  canPause: boolean;
}

export class Hud {
  private readonly bar: HTMLElement;
  /**
   * ANCRE DE REPLI DU FOCUS (§5). Elle n'existe que pour une fenêtre précise :
   * la fin de manche masque les boutons du micro-jeu et n'ouvre l'écran de
   * résultat qu'après `RESULT_DELAY_SEC` — soit 1,1 s pendant lesquelles
   * l'élément focalisé a disparu de la page et le focus retombe sur `<body>`.
   * Mesuré sur les HUIT jeux (10 échantillons à 90 ms), et c'est exactement ce
   * que le scénario `keyboard` du §7 compte comme échec.
   *
   * `tabindex="-1"` : atteignable par programme, JAMAIS en tabulant — même
   * patron que les titres de `ui/screens.ts`. Elle est `sr-only` et non
   * `display:none`, sans quoi elle ne serait pas focalisable ; elle porte le
   * texte de la cause, donc le lecteur d'écran annonce la fin de manche au
   * moment où elle arrive, et non 1,1 s plus tard.
   */
  private readonly anchor: HTMLElement;
  private readonly socles: [HTMLElement, HTMLElement];
  private readonly starLabels: [HTMLElement, HTMLElement];
  private readonly chips: [HTMLElement, HTMLElement];
  private readonly scoreEl: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;

  private readonly logEl: HTMLElement;
  private readonly boardEl: HTMLElement;

  private lastLog = '';
  private lastBoard = '';
  private lastScore = '';
  private lastMute = '';

  /** Branchés par le Flow. Par défaut inertes : le Hud ne décide de rien. */
  onMute: () => void = () => {};
  onPause: () => void = () => {};

  constructor(hudRoot: HTMLElement, logEl: HTMLElement, boardEl: HTMLElement) {
    this.logEl = logEl;
    this.boardEl = boardEl;

    this.bar = document.createElement('div');
    this.bar.className = 'hudbar';
    this.bar.setAttribute('role', 'group');
    this.bar.setAttribute('aria-label', 'la table');

    const [chip0, socle0, stars0] = makeChip(0);
    const [chip1, socle1, stars1] = makeChip(1);
    this.chips = [chip0, chip1];
    this.socles = [socle0, socle1];
    this.starLabels = [stars0, stars1];

    this.scoreEl = document.createElement('p');
    this.scoreEl.className = 'hud-score';
    // `role="status"` plutôt qu'un `aria-live` sur le bandeau entier : seul le
    // score change en cours de manche, et il ne doit s'annoncer qu'à ce
    // moment-là.
    this.scoreEl.setAttribute('role', 'status');

    this.muteBtn = makeBtn('🔊');
    this.muteBtn.addEventListener('click', () => this.onMute());
    this.pauseBtn = makeBtn('⏸');
    this.pauseBtn.addEventListener('click', () => this.onPause());

    this.bar.append(chip0, this.scoreEl, chip1, this.muteBtn, this.pauseBtn);
    hudRoot.appendChild(this.bar);

    // Hors du `.hudbar` : `setVisible(false)` la masque, or l'ancre doit rester
    // focalisable pendant la pause et le résultat, où le bandeau disparaît.
    this.anchor = document.createElement('div');
    this.anchor.className = 'sr-only';
    this.anchor.tabIndex = -1;
    // `hidden` (donc `display:none`) TANT QU'ON NE S'EN SERT PAS : le §4.2
    // exige qu'il reste EXACTEMENT un élément focalisable pendant l'écran de
    // passage, et une ancre `sr-only` toujours présente en faisait deux (elle
    // garde un `offsetParent` sous un `visibility:hidden`). On ne la déplie
    // que le temps de garer le focus dessus.
    this.anchor.hidden = true;
    hudRoot.appendChild(this.anchor);
  }

  /**
   * Synchrone à chaque changement d'état (§5) : on ne peut pas donner le focus
   * à un bouton encore `disabled`, et attendre la frame de rendu raterait le
   * saut sur la première cible.
   */
  refresh(view: HudView): void {
    for (const p of [0, 1] as const) {
      const m = view.mascots[p];
      const socle = this.socles[p];
      socle.className = `socle ${m.socle}`;
      socle.style.background = hexOf(m.tint);
      if (socle.textContent !== m.emoji) socle.textContent = m.emoji;
      const stars = view.stars[p] === 2 ? '⭐⭐' : '⭐';
      if (this.starLabels[p].textContent !== stars) this.starLabels[p].textContent = stars;
      // Le choisisseur est agrandi (une TAILLE, pas une couleur) et doublé
      // d'un liseré : jamais la couleur seule.
      this.chips[p].classList.toggle('big', view.chooser === p);
      this.chips[p].setAttribute(
        'aria-label',
        `${m.name}, ${view.stars[p] === 2 ? 'deux étoiles' : 'une étoile'}${
          view.chooser === p ? ', à lui de choisir' : ''
        }`,
      );
    }

    const score = `${view.score[0]} – ${view.score[1]}`;
    if (score !== this.lastScore) {
      this.lastScore = score;
      this.scoreEl.textContent = score;
      this.scoreEl.setAttribute(
        'aria-label',
        `score de la table : ${view.mascots[0].name} ${view.score[0]}, ${view.mascots[1].name} ${view.score[1]}`,
      );
    }

    const mute = view.muted ? '🔇' : '🔊';
    if (mute !== this.lastMute) {
      this.lastMute = mute;
      this.muteBtn.textContent = mute;
      this.muteBtn.setAttribute('aria-label', view.muted ? 'rétablir le son' : 'couper le son');
      this.muteBtn.setAttribute('aria-pressed', view.muted ? 'true' : 'false');
    }

    this.pauseBtn.textContent = view.paused ? '▶' : '⏸';
    this.pauseBtn.setAttribute('aria-label', view.paused ? 'reprendre' : 'mettre en pause');
    this.pauseBtn.disabled = !view.canPause;
  }

  /**
   * Masqué AVANT l'ouverture d'un panneau (§5) : sans cet ordre on tabule sur
   * un ⏸ invisible posé derrière l'écran de passage. `hidden` (donc
   * `display:none`) et pas `opacity` : il faut sortir de l'ordre de tabulation.
   */
  setVisible(on: boolean): void {
    this.bar.hidden = !on;
  }

  /** Une phrase par événement. N'écrit QUE sur changement réel. */
  log(text: string): void {
    if (text === this.lastLog) return;
    this.lastLog = text;
    this.logEl.textContent = text;
  }

  /** Le plateau EN TEXTE : ce qui rend une manche jouable sans voir l'écran. */
  board(text: string): void {
    if (text === this.lastBoard) return;
    this.lastBoard = text;
    this.boardEl.textContent = text;
  }

  /**
   * Repli de focus quand un panneau se ferme et que le jeu n'a aucune cible
   * légale. On saute le premier bouton s'il est `disabled` : `.focus()` sur un
   * bouton inerte ne fait RIEN, et le focus resterait sur `<body>` — soit
   * exactement la panne qu'on cherche à éviter.
   */
  focusFirst(): void {
    const target = [this.pauseBtn, this.muteBtn].find((b) => !b.disabled && !this.bar.hidden);
    target?.focus();
  }

  /**
   * Gare le focus sur l'ancre, en l'annonçant. Appelée AVANT de masquer les
   * boutons du micro-jeu (fin de manche) : dans l'autre ordre, le focus est
   * déjà parti sur `<body>` quand on arrive, et `<body>` n'est pas un endroit
   * d'où l'on revient — un joueur au clavier est perdu, sans rien à l'écran qui
   * l'indique.
   */
  focusAnchor(text: string): void {
    this.anchor.hidden = false;
    this.anchor.textContent = text;
    // `preventScroll` : l'ancre est un carré d'un pixel, la faire défiler à
    // l'écran secouerait la page sans rien montrer.
    this.anchor.focus({ preventScroll: true });
  }

  /**
   * Replie l'ancre. Appelée à chaque changement d'écran : la fenêtre où elle
   * sert (le délai de résultat) est finie, et la laisser dépliée ajouterait un
   * second élément focalisable pendant l'écran de passage. Le focus qu'elle
   * portait est repris SYNCHRONEMENT par l'appelant (titre du panneau, ou
   * première cible du jeu) — jamais à la frame suivante.
   */
  hideAnchor(): void {
    this.anchor.hidden = true;
  }

  get element(): HTMLElement {
    return this.bar;
  }
}

function makeChip(player: 0 | 1): [HTMLElement, HTMLElement, HTMLElement] {
  const chip = document.createElement('div');
  chip.className = 'chip';
  // `role="img"` : sans rôle, un <div> ne porterait pas son `aria-label` et la
  // mascotte serait muette pour un lecteur d'écran.
  chip.setAttribute('role', 'img');
  chip.dataset.player = String(player);
  const socle = document.createElement('span');
  socle.className = 'socle disc';
  socle.setAttribute('aria-hidden', 'true'); // l'info est dans l'aria-label du chip
  const stars = document.createElement('span');
  stars.className = 'chip-stars';
  stars.setAttribute('aria-hidden', 'true');
  chip.append(socle, stars);
  return [chip, socle, stars];
}

function makeBtn(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hudbtn';
  b.textContent = label;
  return b;
}

function hexOf(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
