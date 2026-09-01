import { PASS_H, PASS_W } from '../../config/balance';
import { sfx } from '../../audio/sfx';
import type { Demo, DemoMove, MiniGame, MiniGameCtx, MiniGameDef } from '../../core/minigame';
import {
  BeastModel,
  DIRS,
  type BeastState,
  type Dir,
  dirBetween,
  dirWord,
  manhattan,
  rowColOf,
  type Tier,
  tierOf,
} from './model';
import { BOARD_Y, CELL, boardX, BeastView } from './view';

/** `chaud`/`tiède`/`froid` — texte français du `Tier` du modèle, pour les
 *  `aria-label` et `#sr-board` uniquement (jamais requis pour jouer, §1.2 :
 *  l'info complète est déjà dans la couleur + le pictogramme + les barres). */
function tierWord(tier: Tier): string {
  return tier === 'hot' ? 'chaud' : tier === 'mild' ? 'tiède' : 'froid';
}

/**
 * `index.ts` câble le modèle PUR et la vue qui ne le mute jamais. C'est le
 * SEUL des trois fichiers autorisé à connaître à la fois le modèle, la vue,
 * le DOM et Pixi.
 *
 * Le canvas est `aria-hidden` : toute l'interaction est posée en vrais
 * `<button>` TRANSPARENTS dans `ctx.overlay`, au repère logique 540×960.
 *
 * **Un seul jeu de 48 boutons couvre les CASES de la grille** (§5, citée
 * littéralement par la spec comme exemple de « case, pas objet ») et sert
 * les DEUX phases : pendant le tour de la bête, seules les cases
 * orthogonalement adjacentes à sa position sont activables (elle doit
 * bouger — aucun verbe « passer ») ; pendant le tour du chasseur, n'importe
 * quelle case est activable jusqu'à `lightsCount` armées, un second tap sur
 * une case déjà armée la retire. Un bouton « valider » séparé, sous la
 * grille, résout le tour du chasseur — il n'apparaît QUE pendant son tour.
 *
 * SECRET : cet `index.ts` ne dessine rien lui-même (voir `BeastView`), mais
 * ses `aria-label` et le résumé `#sr-board` obéissent à la MÊME règle que la
 * vue — ne jamais révéler la position de la bête pendant le tour du
 * chasseur, sous peine de trahir la cachette au lecteur d'écran de celui qui
 * regarde l'écran à ce moment-là.
 */
class BeastGame implements MiniGame {
  private readonly model: BeastModel;
  private readonly view: BeastView;
  private readonly cells: HTMLButtonElement[] = [];
  private readonly validateBtn: HTMLButtonElement;
  private time = 0;
  private paused = false;
  /** Le téléphone est en train de changer de main (écran de passage demandé,
   *  pas encore tapé) : tant que c'est vrai, `#sr-board` reste MUET sur la
   *  position de la bête — voir `updateBoard`. */
  private handOff = false;
  /** Le tout premier passage a-t-il été demandé ? Voir `update`. */
  private opened = false;

  constructor(private readonly ctx: MiniGameCtx) {
    this.model = new BeastModel(ctx.seed, ctx.stars);
    this.view = new BeastView(ctx.stage, this.model, ctx.reducedMotion);

    const s = this.model.state;
    const bx = boardX(s.cols);
    for (let idx = 0; idx < s.cols * s.rows; idx++) {
      const [r, c] = rowColOf(idx, s.cols);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.dataset.cell = `${idx}`;
      const size = CELL - 6; // ≥ 60 px logiques (§1.1)
      b.style.left = `${bx + c * CELL + (CELL - size) / 2}px`;
      b.style.top = `${BOARD_Y + r * CELL + (CELL - size) / 2}px`;
      b.style.width = `${size}px`;
      b.style.height = `${size}px`;
      b.addEventListener('click', () => this.onCell(idx));
      ctx.overlay.appendChild(b);
      this.cells.push(b);
    }

    this.validateBtn = document.createElement('button');
    this.validateBtn.type = 'button';
    this.validateBtn.className = 'bigbtn';
    this.validateBtn.textContent = '🔦 valider';
    this.validateBtn.style.left = `${PASS_W / 2 - 150}px`;
    this.validateBtn.style.top = `${BOARD_Y + s.rows * CELL + 56}px`;
    this.validateBtn.style.width = '300px';
    this.validateBtn.style.height = '70px'; // ≥ 60 px logiques (§1.1)
    this.validateBtn.addEventListener('click', () => this.onValidate());
    ctx.overlay.appendChild(this.validateBtn);

    this.refresh();
  }

  /** Synchrone à chaque changement d'état (§5) : on ne donne jamais le focus
   *  à un bouton encore `disabled`, et attendre la frame de rendu le raterait. */
  private refresh(): void {
    // Capturé AVANT toute mutation de `disabled`/`hidden` : après, l'élément
    // qui portait le focus a déjà pu être tué et `activeElement` est `<body>`.
    const prev = document.activeElement as HTMLElement | null;
    const wasOurs = !!prev && this.ctx.overlay.contains(prev);
    const s = this.model.state;
    const locked = this.paused || s.over;
    for (let idx = 0; idx < this.cells.length; idx++) {
      const b = this.cells[idx];
      const [r, c] = rowColOf(idx, s.cols);
      if (s.phase === 'beast') {
        const dir = dirBetween(s.beastIdx, idx, s.cols, s.rows);
        const legal = dir !== null && this.model.canMove(s.active, dir);
        b.disabled = locked || !legal;
        b.setAttribute(
          'aria-label',
          legal ? `avancer ${dirWord(dir as Dir)}` : `rangée ${r + 1} colonne ${c + 1}`,
        );
      } else {
        const armed = s.selected.includes(idx);
        const legal = this.model.canToggleLight(s.active, idx);
        b.disabled = locked || !legal;
        const past = s.revealed.find((rv) => rv.idx === idx);
        const pastWord = past ? `, dernière lecture ${tierWord(past.tier)}` : '';
        b.setAttribute(
          'aria-label',
          armed
            ? `case rangée ${r + 1} colonne ${c + 1} armée, retirer${pastWord}`
            : `éclairer rangée ${r + 1} colonne ${c + 1}${pastWord}`,
        );
      }
    }
    this.validateBtn.hidden = s.phase !== 'hunter';
    this.validateBtn.disabled = locked || !this.model.canValidate(s.active);
    this.validateBtn.setAttribute('aria-label', `valider les ${s.lightsCount} cases éclairées`);
    this.updateBoard(s);
    this.restoreFocus(prev, wasOurs);
  }

  /** Le trou classique (§5) : une action rend son propre bouton `disabled` ou
   *  `hidden` — « valider », une case qu'on vient d'armer en dernier — et le
   *  navigateur renvoie le focus sur `<body>`, en plein milieu d'un tour. On ne
   *  le rend QUE s'il était à nous : le voler à quelqu'un qui joue au doigt
   *  serait pire que de le perdre. */
  private restoreFocus(prev: HTMLElement | null, wasOurs: boolean): void {
    if (!wasOurs || !prev) return;
    const dead = (prev as HTMLButtonElement).disabled || prev.hidden || !prev.isConnected;
    if (!dead) return;
    const cell = this.cells.find((b) => !b.disabled && !b.hidden);
    if (cell) {
      cell.focus();
      return;
    }
    if (!this.validateBtn.disabled && !this.validateBtn.hidden) this.validateBtn.focus();
  }

  /** `#sr-board` (via le shell — `ctx` n'expose pas ce résumé, cf. digest
   *  §8.2). RÈGLE DE SECRET reprise de la vue : la position de la bête n'est
   *  décrite QUE pendant son propre tour — l'annoncer pendant celui du
   *  chasseur trahirait la cachette au lecteur d'écran. */
  private updateBoard(s: BeastState): void {
    const g = (window as unknown as { __game?: { game?: { setBoardText?: (t: string) => void } } }).__game?.game;
    if (!g?.setBoardText) return;
    if (s.over) {
      g.setBoardText('Manche terminée.');
      return;
    }
    // SECRET : entre deux tours (passage du téléphone) et en pause, celui qui
    // tient l'appareil n'est PAS celui qui doit jouer. Une région `aria-live`
    // écrite maintenant lui lirait la cachette à voix haute — le seul canal par
    // lequel le plateau muet peut trahir. On n'écrit la vraie ligne qu'au
    // dépliage (`setPaused(false)`), qui rappelle `refresh`.
    if (this.handOff || this.paused) {
      g.setBoardText('En attente : passe le téléphone à l\'autre joueur.');
      return;
    }
    const progress = `Tour ${s.turnsUsed} sur ${s.turnLimit}.`;
    const text =
      s.phase === 'beast'
        ? (() => {
            const [r, c] = rowColOf(s.beastIdx, s.cols);
            return `À toi, siège ${s.active + 1}, tu es la bête, rangée ${r + 1} colonne ${c + 1}. Objectif : rangée 1. ${progress}`;
          })()
        : `À toi, siège ${s.active + 1}, tu es le chasseur. ${s.selected.length} sur ${s.lightsCount} cases armées. ${s.revealed.length} cases en mémoire. ${progress}`;
    g.setBoardText(text);
  }

  private focusFirstLegal(): void {
    const first = this.cells.find((b) => !b.hidden && !b.disabled);
    first?.focus();
  }

  /** Le focus saute sur « valider » dès que le compte de cases armées est
   *  atteint (pattern de Cerveau : le focus saute sur ✓ dès la ligne
   *  complète) — SEULEMENT si le focus est déjà dans notre overlay, pour ne
   *  jamais le voler à quelqu'un qui joue au doigt. */
  private focusValidateIfOurs(): void {
    const active = document.activeElement;
    if (active && this.ctx.overlay.contains(active)) this.validateBtn.focus();
  }

  private afterAction(actingPlayer: 0 | 1): void {
    const s = this.model.state;
    // Posé AVANT le rafraîchissement : c'est lui qui décide si `#sr-board` a le
    // droit de décrire le plateau (voir `updateBoard`).
    this.handOff = !s.over && s.active !== actingPlayer;
    this.refresh();
    if (s.over) {
      this.ctx.onOver(this.model.result);
      return;
    }
    if (s.active !== actingPlayer) {
      // Le tour a changé de MAIN — soit un tour normal (bête → chasseur ou
      // l'inverse), soit une moitié qui vient de basculer avec échange des
      // rôles : dans les deux cas, un AUTRE siège doit regarder l'écran.
      this.ctx.onTurn(s.active);
    } else {
      // Le même siège continue (une moitié vient de finir sur une action du
      // chasseur : il devient la bête de la seconde moitié, phone en main).
      this.focusFirstLegal();
    }
  }

  private onCell(idx: number): void {
    if (this.paused) return;
    // Quelqu'un joue : le téléphone est forcément arrivé à destination. Ceinture
    // et bretelles pour `handOff`, dont la remise à zéro normale vient de
    // `setPaused(false)` à la fin de l'écran de passage.
    this.handOff = false;
    const s = this.model.state;
    const actingPlayer = s.active;
    // NOMBRE, pas objet : `state` rend les tableaux internes par RÉFÉRENCE
    // (cf. le commentaire de `BeastState`), donc `avant.halves` ET
    // `après.halves` sont le MÊME tableau. La comparaison de longueurs entre
    // deux instantanés était toujours fausse : ni `sfx.goal()` ni l'annonce
    // « la bête a filé » ni celle de la capture ne se sont jamais déclenchées.
    const halvesBefore = s.halves.length;
    if (s.phase === 'beast') {
      const dir = dirBetween(s.beastIdx, idx, s.cols, s.rows);
      if (dir === null || !this.model.move(actingPlayer, dir)) return;
      const ns = this.model.state;
      if (ns.halves.length > halvesBefore) {
        const h = ns.halves[ns.halves.length - 1];
        sfx.goal();
        this.ctx.onAnnounce(`la bête a filé jusqu'en haut en ${h.turnsUsed} tours`);
      } else {
        sfx.tap();
        this.ctx.onAnnounce(`la bête avance ${dirWord(dir)}`);
      }
      this.afterAction(actingPlayer);
    } else {
      if (!this.model.toggleLight(actingPlayer, idx)) return;
      sfx.tap();
      this.refresh();
      const ns = this.model.state;
      if (ns.selected.length === ns.lightsCount) this.focusValidateIfOurs();
    }
  }

  private onValidate(): void {
    if (this.paused) return;
    this.handOff = false; // idem `onCell`
    const s = this.model.state;
    const actingPlayer = s.active;
    const halvesBefore = s.halves.length; // NOMBRE — voir `onCell`
    const lights = s.lightsCount;
    if (!this.model.validate(actingPlayer)) return;
    const ns = this.model.state;
    if (ns.halves.length > halvesBefore) {
      const h = ns.halves[ns.halves.length - 1];
      if (h.captured) {
        sfx.bump();
        this.ctx.onAnnounce(`le chasseur a débusqué la bête au tour ${h.turnsUsed}`);
      } else {
        sfx.thunk();
        this.ctx.onAnnounce("le temps est écoulé, la bête n'a pas atteint le haut");
      }
    } else {
      sfx.thunk();
      this.ctx.onAnnounce(`${lights} cases éclairées, la bête reste cachée`);
    }
    this.afterAction(actingPlayer);
  }

  update(dt: number): void {
    if (this.paused) return;
    // LE PREMIER PASSAGE, et c'est une question de SECRET, pas de confort : au
    // lancement d'une manche, `Flow.startRound` affiche le plateau sans écran
    // de passage — celui qui tient le téléphone est celui qui a choisi le jeu,
    // et le siège bête est TIRÉ AU SORT. Une fois sur deux, le chasseur voyait
    // donc la case de départ de la bête avant même de commencer. Le demander
    // depuis le constructeur ne marche pas : `startRound` fait `enter('game')`
    // APRÈS `create()` et écraserait l'écran de passage. Au premier tick, en
    // revanche, le montage est fini — et l'écran de passage masque le plateau
    // avant que la moindre frame ne soit rendue (`update` précède `render`).
    if (!this.opened) {
      this.opened = true;
      this.handOff = true;
      this.refresh();
      this.ctx.onTurn(this.model.state.active);
      return;
    }
    // Horloge de la VUE (les animations en sont des fonctions closes), jamais
    // du modèle : le modèle reste pur et rejouable hors de la page — c'est un
    // jeu au tour par tour, cette horloge ne pilote QUE les petits « pop »
    // d'apparition d'un thermomètre et la respiration des libellés de siège.
    this.time += dt;
  }

  render(_alpha: number): void {
    this.view.render(this.time);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    // Le dépliage marque la fin du passage : le destinataire a tapé, il tient
    // l'appareil, `#sr-board` peut de nouveau décrire SON plateau.
    if (!p) this.handOff = false;
    this.refresh();
  }

  private demoPickDir(s: BeastState): Dir | null {
    // Priorité au haut (l'histoire est « elle avance vers le but ») ; sinon
    // n'importe quelle direction légale, pour ne jamais rester bloqué même
    // sur une position de bord tirée par le seed de démo.
    const order: readonly Dir[] = ['up', 'left', 'right', 'down'];
    for (const dir of order) if (this.model.canMove(s.active, dir)) return dir;
    for (const dir of DIRS) if (this.model.canMove(s.active, dir)) return dir;
    return null;
  }

  /** Distance visée par palier — le coup de démo demande un PALIER, pas une
   *  case : la boucle de trois secondes doit montrer 🔥 PUIS 🌤 PUIS ❄, c'est
   *  ça, la règle du thermomètre. Viser « la case la plus proche » trois fois
   *  de suite (ce que faisait la version précédente) donnait trois 🔥 : la
   *  démo n'enseignait alors qu'une moitié du geste. */
  private static readonly DEMO_TARGET: Readonly<Record<Tier, number>> = { hot: 2, mild: 4, cold: 7 };

  /** Case NON-bête la plus représentative du palier demandé — jamais la case
   *  exacte de la bête, sinon la démo se termine sur une capture au 1er coup. */
  private demoPickLight(s: BeastState, want: Tier): number | null {
    if (s.phase !== 'hunter') return null;
    const target = BeastGame.DEMO_TARGET[want];
    let best = -1;
    let bestScore = Infinity;
    let fallback = -1;
    for (let idx = 0; idx < s.cols * s.rows; idx++) {
      if (idx === s.beastIdx || s.selected.includes(idx)) continue;
      if (!this.model.canToggleLight(s.active, idx)) continue;
      if (fallback < 0) fallback = idx;
      const d = manhattan(idx, s.beastIdx, s.cols);
      if (tierOf(d) !== want) continue;
      const score = Math.abs(d - target);
      if (score < bestScore) {
        bestScore = score;
        best = idx;
      }
    }
    // Un palier peut être hors d'atteinte selon où la bête se trouve (une bête
    // au centre n'a aucune case à distance ≥ 5 sur une 6×8 ? si — mais un coin
    // en a peu) : on éclaire quand même, la démo ne doit jamais caler.
    return best >= 0 ? best : fallback >= 0 ? fallback : null;
  }

  /** §2.4 — la démo rejoue le MODÈLE RÉEL, jamais une animation séparée. */
  applyDemo(move: DemoMove): void {
    const s = this.model.state;
    if (move.move === 'move') {
      const dir = this.demoPickDir(s);
      if (dir !== null) this.model.move(s.active, dir);
    } else if (move.move === 'light') {
      const want: Tier = move.args?.[0] === 1 ? 'mild' : move.args?.[0] === 2 ? 'cold' : 'hot';
      const idx = this.demoPickLight(s, want);
      if (idx !== null) this.model.toggleLight(s.active, idx);
    } else if (move.move === 'validate') {
      // La démo tourne avec les ⭐ de la table : un chasseur aidé a QUATRE
      // cases alors que la liste canonique n'en éclaire que trois, et
      // `validate` exige le compte EXACT. On complète par le modèle réel —
      // jamais par une animation parallèle — plutôt que de laisser la boucle
      // se figer sur un bouton qui ne s'activera jamais.
      let guard = 0;
      while (!this.model.canValidate(s.active) && guard++ < 8) {
        const extra = this.demoPickLight(this.model.state, 'cold');
        if (extra === null || !this.model.toggleLight(s.active, extra)) break;
      }
      this.model.validate(s.active);
    }
    this.refresh();
  }

  destroy(): void {
    for (const b of this.cells) b.remove();
    this.cells.length = 0;
    this.validateBtn.remove();
    this.view.destroy();
  }
}

/**
 * Coups canoniques rejoués en boucle par `core/demo.ts` (§2.4), à travers le
 * MODÈLE RÉEL : la bête avance deux fois, le chasseur éclaire trois cases —
 * une par palier, donc l'éventail 🔥 / 🌤 / ❄ apparaît en entier — et valide,
 * puis elle repart. Toute la règle en sept coups et sans un mot.
 */
const DEMO: Demo = [
  { move: 'move' },
  { move: 'move' },
  { move: 'light', args: [0] }, // 🔥 chaud  — deux barres
  { move: 'light', args: [1] }, // 🌤 tiède  — une barre
  { move: 'light', args: [2] }, // ❄ froid  — aucune barre
  { move: 'validate' },
  { move: 'move' },
];

export const def: MiniGameDef = {
  id: 'beast',
  title: 'La bête sous le tapis',
  emoji: '🐾',
  posture: 'pass',
  mode: 'asym',
  logical: { w: PASS_W, h: PASS_H },
  demo: DEMO,
  create: (ctx) => new BeastGame(ctx),
};

/** Modèle PUR exposé au bot via `window.__game.models` (§7). */
export { BeastModel as Model };
