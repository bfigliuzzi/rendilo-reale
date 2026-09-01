import type { MascotDef } from '../config/mascots';
import type { MiniGameDef } from '../core/minigame';
import type { StarLevel } from '../meta/save';
import { buildSpriteUrls } from '../render/textures';

/**
 * LES ÉCRANS PLEIN CADRE : accueil (§4.1.1), menu (§4.1.2), résultat (§4.3) et
 * pause (§1.2). Ils vivent dans `#ui`, fond OPAQUE — un plateau qui
 * transparaîtrait rendrait le contraste réel imprévisible, donc invérifiable.
 *
 * Comme dans Trois Portes : UN SEUL écouteur `click` délégué (et un `change`
 * pour les cases à cocher) plutôt qu'un écouteur par bouton généré, et chaque
 * `show*()` reçoit une VUE DÉJÀ CALCULÉE — `Screens` ne lit jamais le save ni
 * la session. C'est ce qui laisse `core/session.ts` seul écrivain.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PIÈGE DE FOCUS DE CET ÉCRAN-CI, et il est spécifique à Duo : l'accueil se
 * re-rend à CHAQUE tap (choisir une mascotte, basculer une étoile), ce qui
 * détruit l'élément qui portait le focus — un joueur au clavier se retrouverait
 * sur `<body>` après chaque choix. D'où `data-key` sur chaque contrôle : on
 * relit la clé de l'élément actif AVANT de remplacer le contenu, et on rend le
 * focus à l'élément de MÊME clé après. Le focus ne va sur le titre que quand
 * l'écran CHANGE réellement (pattern de Trois Portes) : un simple
 * rafraîchissement ne doit pas remonter le joueur en haut.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface PlayerView {
  mascot: MascotDef;
  stars: StarLevel;
}

export interface HomeView {
  players: readonly [PlayerView, PlayerView];
  mascots: readonly MascotDef[];
  muted: boolean;
  reducedMotion: boolean;
  /** `prefers-reduced-motion` système : la case est alors cochée ET verrouillée. */
  motionLocked: boolean;
  /** Reset en deux temps : le premier tap arme, le second efface. */
  resetArmed: boolean;
}

export interface MenuView {
  games: readonly MiniGameDef[];
  /** « Le perdant choisit » : la mascotte du choisisseur, ou `null`. */
  chooser: MascotDef | null;
}

export interface ResultView {
  game: MiniGameDef;
  winner: 0 | 1 | null;
  scores: readonly [number, number];
  reason: string;
  players: readonly [PlayerView, PlayerView];
}

export interface PauseView {
  muted: boolean;
}

type ScreenId = '' | 'home' | 'menu' | 'result' | 'pause';

export class Screens {
  private readonly root: HTMLElement;
  private readonly sprites: Record<string, string>;
  private current: ScreenId = '';

  /** Branchés par le Flow — `Screens` ne décide de rien. */
  onPlay: () => void = () => {};
  onHome: () => void = () => {};
  onMascot: (player: 0 | 1, mascotId: string) => void = () => {};
  onStars: (player: 0 | 1, stars: StarLevel) => void = () => {};
  onPick: (gameId: string) => void = () => {};
  onAgain: () => void = () => {};
  onOther: () => void = () => {};
  onResume: () => void = () => {};
  onQuit: () => void = () => {};
  onMute: (on: boolean) => void = () => {};
  onMotion: (on: boolean) => void = () => {};
  onReset: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.sprites = buildSpriteUrls();
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('change', this.onChange);
  }

  /**
   * Vignette pixel art des sprites du jeu, en `data:` URL (§6) : les panneaux
   * DOM sont la moitié de la collection, et un mur de texte n'est pas jouable à
   * cinq ans. `alt=""` — le nom de l'animal est déjà écrit à côté, et
   * l'`aria-label` du bouton le porte de toute façon.
   */
  private img(sprite: string, size: number): string {
    const src = this.sprites[sprite];
    return src ? `<img class="pix" src="${src}" width="${size}" height="${size}" alt="">` : '';
  }

  get visible(): boolean {
    return this.current !== '';
  }

  get screen(): ScreenId {
    return this.current;
  }

  // ───────────────────────── Accueil (§4.1.1) ─────────────────────────

  /**
   * Deux emplacements, six animaux, un tap sur ⭐ ou ⭐⭐. Rien d'autre : le
   * §4.1.1 est court exprès, c'est l'écran que deux enfants traversent en dix
   * secondes avant de jouer.
   */
  showHome(v: HomeView): void {
    const slots = [0, 1]
      .map((i) => this.slotHtml(i as 0 | 1, v))
      .join('');
    this.show(
      'home',
      `<div class="panel">
        <h1 tabindex="-1">Duo</h1>
        <p class="sub">Huit jeux à deux, sur un seul téléphone.</p>
        ${slots}
        <label class="opt"><input type="checkbox" data-opt="mute" data-key="opt-mute"${
          v.muted ? ' checked' : ''
        }><span>🔇 silence (mode restaurant)</span></label>
        <label class="opt"><input type="checkbox" data-opt="motion" data-key="opt-motion"${
          v.reducedMotion ? ' checked' : ''
        }${v.motionLocked ? ' disabled' : ''}><span>🐢 moins d'animations${
          v.motionLocked ? ' (réglage du téléphone)' : ''
        }</span></label>
        <button class="btn primary huge" data-action="play" data-key="play">▶ jouer</button>
        <button class="btn" data-action="reset" data-key="reset">${
          v.resetArmed ? '⚠️ confirmer l’effacement' : '↺ tout effacer'
        }</button>
        <a class="hub-link" href="/">← retour au hub</a>
      </div>`,
    );
  }

  private slotHtml(player: 0 | 1, v: HomeView): string {
    const me = v.players[player];
    const buttons = v.mascots
      .map((m) => {
        const on = m.id === me.mascot.id;
        return `<button class="mbtn" data-action="mascot" data-p="${player}" data-m="${m.id}"
          data-key="m-${player}-${m.id}" aria-pressed="${on}"
          aria-label="joueur ${player + 1} : ${m.name}">
          <span class="socle ${m.socle}" style="background:${hexOf(m.tint)};width:40px;height:40px" aria-hidden="true">${this.img(m.sprite, 32)}</span>
          <span>${m.emoji} ${m.name}</span>
        </button>`;
      })
      .join('');
    // ⭐ / ⭐⭐ : un handicap VISIBLE (§1.3). Le libellé dit ce qu'il fait — « un
    // coup de plus » — et jamais « niveau facile », qui se lit comme une insulte
    // à huit ans.
    const stars = ([1, 2] as const)
      .map(
        (s) => `<button class="starbtn" data-action="stars" data-p="${player}" data-s="${s}"
        data-key="s-${player}-${s}" aria-pressed="${me.stars === s}"
        aria-label="joueur ${player + 1} : ${s === 1 ? 'un coup de plus (⭐)' : 'sans coup de plus (⭐⭐)'}">${
          s === 1 ? '⭐' : '⭐⭐'
        }</button>`,
      )
      .join('');
    return `<div class="slot" role="group" aria-label="joueur ${player + 1}">
      <div class="mascotgrid">${buttons}</div>
      <div class="starrow">${stars}</div>
    </div>`;
  }

  // ───────────────────────── Menu (§4.1.2) ─────────────────────────

  /**
   * Grille de huit vignettes : emoji, titre, et DEUX pictogrammes — posture
   * (📱 en main / 🀫 à plat) et mode. Le §4.1.2 n'en nomme que deux pour le
   * mode ; la collection en a TROIS (`asym`), donc 🎭 s'ajoute à 🤝 et ⚔️ :
   * inventer un troisième pictogramme est moins mensonger que de ranger un jeu
   * asymétrique sous « l'un contre l'autre » alors que les deux joueurs n'y
   * font pas la même chose. Le sens complet vit dans l'`aria-label`, jamais
   * dans le pictogramme seul.
   *
   * Les vignettes sont STATIQUES à ce stade : l'étape §8.8 les animera avec la
   * démo (`def.demo` rejouée à travers le modèle réel).
   */
  showMenu(v: MenuView): void {
    const tiles = v.games
      .map((g) => {
        const post = g.posture === 'pass' ? '📱' : '🀫';
        const mode = g.mode === 'coop' ? '🤝' : g.mode === 'duel' ? '⚔️' : '🎭';
        const label = `${g.title} — ${
          g.posture === 'pass' ? 'téléphone en main, on se le passe' : 'téléphone posé à plat, côte à côte'
        }, ${modeLabel(g.mode)}`;
        return `<button class="tile" data-action="game" data-id="${g.id}" data-key="g-${g.id}" aria-label="${label}">
          <span class="tile-emoji" aria-hidden="true">${g.emoji}</span>
          <span class="tile-name">${g.title}</span>
          <span class="tile-tags" aria-hidden="true">${post}${mode}</span>
        </button>`;
      })
      .join('');

    // Halo de la teinte du choisisseur + mascotte agrandie dans le bandeau +
    // phrase en région live : TROIS codes pour la même information, dont aucun
    // n'est la couleur seule.
    const grid = v.chooser
      ? `<div class="grid halo" style="--halo:${hexOf(v.chooser.tint)}">`
      : '<div class="grid">';
    const head = v.chooser
      ? `<h2 tabindex="-1"><span aria-hidden="true">${v.chooser.emoji}</span> à ${v.chooser.name} de choisir</h2>`
      : `<h2 tabindex="-1">à quoi on joue ?</h2>`;

    this.show(
      'menu',
      `<div class="panel wide">
        ${head}
        ${grid}${tiles}</div>
        <button class="btn" data-action="home" data-key="home">🐰 changer de mascotte</button>
      </div>`,
    );
  }

  // ───────────────────────── Résultat (§4.3) ─────────────────────────

  /**
   * Les deux mascottes, le score, LA CAUSE EN UNE IMAGE, et deux boutons.
   * Aucune statistique, aucune courbe, aucune étoile à collectionner (§4.3).
   *
   * La cause générique est une paire de barres de la teinte de chaque joueur,
   * longueur proportionnelle au score : elle dit « son panier est plus plein »
   * sans une phrase, ce qui est exactement le critère 4 du test des 5 ans. Un
   * micro-jeu qui a mieux à montrer (deux paniers de pommes, deux piles de
   * tuiles) le dessine sur son canvas ; ceci est le plancher, pas le plafond.
   */
  showResult(v: ResultView): void {
    const max = Math.max(1, v.scores[0], v.scores[1]);
    const rows = [0, 1]
      .map((i) => {
        const p = v.players[i];
        const w = Math.round((v.scores[i] / max) * 100);
        const crown = v.winner === i ? ' 🏆' : '';
        return `<div class="causerow">
          <span class="socle ${p.mascot.socle}" style="background:${hexOf(p.mascot.tint)}" aria-hidden="true">${p.mascot.emoji}</span>
          <span class="causebar" style="background:${hexOf(p.mascot.tint)};width:${Math.max(6, w)}%"></span>
          <span class="causenum">${v.scores[i]}${crown}</span>
        </div>`;
      })
      .join('');

    const title =
      v.winner === null
        ? `<h2 tabindex="-1">🤝 ensemble</h2>`
        : `<h2 tabindex="-1"><span aria-hidden="true">${v.players[v.winner].mascot.emoji} 🏆</span> ${v.players[v.winner].mascot.name} gagne</h2>`;

    this.show(
      'result',
      `<div class="panel">
        ${title}
        <p class="sub"><span aria-hidden="true">${v.game.emoji}</span> ${v.game.title}</p>
        <p class="sub">${v.reason}</p>
        <div class="cause" role="img" aria-label="${causeLabel(v)}">${rows}</div>
        <button class="btn primary huge" data-action="again" data-key="again">🔁 encore</button>
        <button class="btn" data-action="other" data-key="other">🎲 un autre jeu</button>
      </div>`,
    );
  }

  // ───────────────────────── Pause (§1.2) ─────────────────────────

  /** « Le plat arrive au milieu de la manche, c'est le cas nominal. » */
  showPause(v: PauseView): void {
    this.show(
      'pause',
      `<div class="panel">
        <h2 tabindex="-1">⏸ pause</h2>
        <button class="btn primary huge" data-action="resume" data-key="resume">▶ reprendre</button>
        <label class="opt"><input type="checkbox" data-opt="mute" data-key="opt-mute"${
          v.muted ? ' checked' : ''
        }><span>🔇 silence</span></label>
        <button class="btn" data-action="quit" data-key="quit">🏠 quitter la manche</button>
      </div>`,
    );
  }

  // ───────────────────────── Mécanique commune ─────────────────────────

  /**
   * `hide()` renvoie `true` si le focus était à nous : remplacer le contenu
   * détruit l'élément focalisé, et l'appelant doit alors le replacer côté jeu
   * (contrat repris de Trois Portes). Sans ce retour, un joueur au clavier se
   * retrouve sur `<body>` en plein milieu d'une manche.
   */
  hide(): boolean {
    const had = this.root.contains(document.activeElement);
    this.root.classList.remove('visible');
    this.root.replaceChildren();
    this.current = '';
    return had;
  }

  private show(screen: ScreenId, html: string): void {
    const prev = document.activeElement as HTMLElement | null;
    const key = prev && this.root.contains(prev) ? (prev.dataset.key ?? '') : '';

    this.root.innerHTML = html;
    this.root.classList.add('visible');
    const changed = screen !== this.current;
    this.current = screen;

    if (changed) {
      this.root.querySelector<HTMLElement>('[tabindex="-1"]')?.focus();
      return;
    }
    // Même écran re-rendu (un choix de mascotte, une case cochée) : on rend le
    // focus au MÊME contrôle, jamais au titre.
    const again = key ? this.root.querySelector<HTMLElement>(`[data-key="${key}"]`) : null;
    if (again) again.focus();
    else this.root.querySelector<HTMLElement>('[tabindex="-1"]')?.focus();
  }

  private readonly onClick = (e: Event): void => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const p = (Number(el.dataset.p) === 1 ? 1 : 0) as 0 | 1;
    switch (el.dataset.action) {
      case 'play':
        this.onPlay();
        break;
      case 'home':
        this.onHome();
        break;
      case 'mascot':
        this.onMascot(p, el.dataset.m ?? '');
        break;
      case 'stars':
        this.onStars(p, el.dataset.s === '2' ? 2 : 1);
        break;
      case 'game':
        this.onPick(el.dataset.id ?? '');
        break;
      case 'again':
        this.onAgain();
        break;
      case 'other':
        this.onOther();
        break;
      case 'resume':
        this.onResume();
        break;
      case 'quit':
        this.onQuit();
        break;
      case 'reset':
        this.onReset();
        break;
      default:
        break;
    }
  };

  private readonly onChange = (e: Event): void => {
    const el = e.target as HTMLInputElement | null;
    if (!el || el.type !== 'checkbox') return;
    // La case est libellée « silence », PAS « son » : elle porte directement la
    // sémantique du save (`muted`), et une case « son » cochée alors que le jeu
    // démarre muet (§1.2) se lisait exactement à l'envers.
    if (el.dataset.opt === 'mute') this.onMute(el.checked);
    else if (el.dataset.opt === 'motion') this.onMotion(el.checked);
  };
}

function modeLabel(mode: MiniGameDef['mode']): string {
  if (mode === 'coop') return 'ensemble';
  if (mode === 'duel') return "l'un contre l'autre";
  return 'chacun son rôle';
}

function causeLabel(v: ResultView): string {
  const a = `${v.players[0].mascot.name} ${v.scores[0]}`;
  const b = `${v.players[1].mascot.name} ${v.scores[1]}`;
  return `${a}, ${b}`;
}

function hexOf(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
