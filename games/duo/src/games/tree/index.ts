import { PASS_H, PASS_W, TREE_FALL_SEC } from '../../config/balance';
import { sfx } from '../../audio/sfx';
import type { Demo, DemoMove, MiniGame, MiniGameCtx, MiniGameDef } from '../../core/minigame';
import { colorName, TreeModel } from './model';
import { layoutNodes, TreeView } from './view';

/**
 * `index.ts` câble le modèle PUR et la vue qui ne le mute jamais. C'est le
 * SEUL des trois fichiers autorisé à connaître à la fois le modèle, la vue,
 * le DOM et Pixi.
 *
 * Le canvas est `aria-hidden` : toute l'interaction est posée en vrais
 * `<button>` TRANSPARENTS dans `ctx.overlay`, au repère logique 540×960 —
 * exactement la transformation de letterbox que subit `#stage`. Un bouton par
 * ARÊTE (fixe pour toute la manche : la génération ne change jamais après le
 * lancement, seule sa vivacité bouge), posé SUR le segment qu'il coupe — au
 * milieu si la place est libre, sinon glissé le long de la branche (voir
 * `buttonCenters`) — via `layoutNodes`, LA MÊME fonction que la vue, pour que
 * bouton et branche dessinée ne puissent jamais dériver l'un de l'autre.
 */

/** Côté d'une cible tactile, en px logiques — plancher du §1.1, jamais moins. */
const BUTTON_PX = 60;
/**
 * Écartement VISÉ entre deux centres de boutons (distance de Tchebychev, donc
 * en « carrés »). Au-delà, on ne cherche plus : le milieu de la branche reste
 * toujours le premier candidat essayé.
 */
const BUTTON_SEP = 48;
/** Fractions essayées le long de la branche — le MILIEU d'abord. */
const BUTTON_T: readonly number[] = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78];
/** Décalage perpendiculaire de dernier recours (px logiques). */
const BUTTON_PERP: readonly number[] = [0, -16, 16];

/**
 * Place UNE cible par arête, SUR l'arête, en évitant de recouvrir les
 * précédentes.
 *
 * DÉFAUT RÉEL, MESURÉ, QUE CETTE FONCTION CORRIGE : posés au milieu du
 * segment, deux boutons peuvent tomber au MÊME point — il suffit de deux
 * branches qui se croisent en X (les slots des nœuds se répondent : `a + b`
 * identique ⇒ milieux confondus). Sur 300 tirages, 134 paires de boutons
 * avaient des centres à moins de 2 px et certains boutons se retrouvaient
 * ENTIÈREMENT recouverts : le coup restait jouable au clavier mais était
 * devenu impossible au doigt — l'exact miroir du critère §1.1.2.
 *
 * Le remède est déterministe (aucun tirage) et garde le bouton SUR sa branche :
 * on essaie le milieu, puis des points de plus en plus excentrés le long du
 * segment, puis un léger décalage perpendiculaire, et on retient le premier
 * candidat assez loin des boutons déjà posés — sinon le moins mauvais. Re-mesuré
 * sur les mêmes 300 tirages : plus AUCUN doublon, 42 px entre les deux centres
 * les plus proches, et le bouton le plus recouvert de la campagne garde 64 % de
 * sa surface cliquable.
 */
function buttonCenters(
  edges: readonly { a: number; b: number }[],
  nodePx: readonly { x: number; y: number }[],
): readonly { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const e of edges) {
    const a = nodePx[e.a];
    const b = nodePx[e.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    let best = { x: a.x + dx * 0.5, y: a.y + dy * 0.5 };
    let bestGap = -1;
    search: for (const off of BUTTON_PERP) {
      for (const t of BUTTON_T) {
        const p = { x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off };
        let gap = Infinity;
        for (const q of out) gap = Math.min(gap, Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)));
        if (gap >= BUTTON_SEP) {
          best = p;
          break search;
        }
        if (gap > bestGap) {
          bestGap = gap;
          best = p;
        }
      }
    }
    out.push(best);
  }
  return out;
}

class TreeGame implements MiniGame {
  private readonly model: TreeModel;
  private readonly view: TreeView;
  private readonly buttons: HTMLButtonElement[];
  /** Ancre de repli (`tabindex="-1"`, jamais dans l'ordre de tabulation) :
   *  au tout dernier coup, TOUTES les branches meurent d'un coup et plus
   *  aucun bouton n'est focalisable — sans elle, le focus retombe sur
   *  `<body>` pendant le court délai avant l'écran de résultat (§5). */
  private readonly anchor: HTMLDivElement;
  private time = 0;
  private paused = false;
  /**
   * LA CHUTE EST LA RÉCOMPENSE (§3.3), donc elle doit être VUE par celui qui
   * vient de couper. On retient ce qui suit la coupe pendant `TREE_FALL_SEC` :
   *   • `'turn'` — `ctx.onTurn` ouvre un plein écran « passe le téléphone » à
   *     la frame MÊME de la coupe ; le coupeur ne voyait jamais tomber sa
   *     branche, et l'animation reprenait plus tard, chez l'autre joueur ;
   *   • `'over'` — `ctx.onOver` fige le shell (donc l'horloge de la vue) : la
   *     dernière chute restait gelée à p=0 pendant tout le délai de résultat,
   *     l'arbre encore DEBOUT alors que les paniers avaient déjà changé — soit
   *     exactement la cause à l'écran que le §1.1 critère 4 exige de montrer ;
   *   • `'same'` — jeton ✂ ou passage automatique : même joueur, mais la
   *     chute mérite les mêmes 0,75 s avant qu'il rejoue.
   * Pendant l'attente, TOUS les boutons sont `disabled` (`refresh`) : personne
   * ne peut couper à la place du destinataire.
   */
  private pending: 'turn' | 'over' | 'same' | null = null;
  private pendingIn = 0;
  /** Le résumé de plateau a-t-il déjà été posé APRÈS la ligne générique du shell ? */
  private boardPosted = false;

  constructor(private readonly ctx: MiniGameCtx) {
    this.model = new TreeModel(ctx.seed, ctx.stars);
    this.view = new TreeView(ctx.stage, this.model, PASS_W, PASS_H, ctx.reducedMotion);

    this.anchor = document.createElement('div');
    this.anchor.tabIndex = -1;
    this.anchor.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;outline:none;';
    ctx.overlay.appendChild(this.anchor);

    const s = this.model.state;
    const centers = buttonCenters(s.edges, layoutNodes(s.nodes, PASS_W));
    this.buttons = s.edges.map((e, i) => {
      const c = centers[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cell';
      // ≥ 60 px logiques de côté : plancher de cible tactile (§1.1).
      btn.style.left = `${c.x - BUTTON_PX / 2}px`;
      btn.style.top = `${c.y - BUTTON_PX / 2}px`;
      btn.style.width = `${BUTTON_PX}px`;
      btn.style.height = `${BUTTON_PX}px`;
      btn.addEventListener('click', () => this.onCut(e.id));
      this.ctx.overlay.appendChild(btn);
      return btn;
    });

    this.refresh();
  }

  /** Synchrone à chaque changement d'état (§5) : on ne donne jamais le focus
   *  à un bouton encore `disabled`, et attendre la frame de rendu le raterait. */
  private refresh(): void {
    // Capturé AVANT toute mutation : c'est la seule façon de savoir si le
    // focus qu'on s'apprête peut-être à détruire était le NÔTRE (§5 — on ne
    // vole jamais celui de quelqu'un d'autre).
    const prev = document.activeElement as HTMLElement | null;
    const wasOurs = !!prev && this.ctx.overlay.contains(prev);

    const s = this.model.state;
    const locked = this.paused || s.over || this.pending !== null;
    for (const e of s.edges) {
      const btn = this.buttons[e.id];
      const alive = s.alive[e.id];
      btn.hidden = !alive;
      // `hidden` sort déjà la branche tombée du rendu ET du focus ; on la
      // désactive AUSSI, pour qu'un futur CSS qui redonnerait un `display` aux
      // boutons masqués ne ressuscite pas un coup impossible (§1.1 critère 2).
      btn.disabled = !alive || locked || !this.model.canCut(s.turn, e.id);
      if (!alive) continue;
      const apples = e.apples > 0 ? `, ${e.apples} pomme${e.apples > 1 ? 's' : ''}` : ', sans pomme';
      btn.setAttribute('aria-label', `couper la brindille ${colorName(e.color)}${apples}`);
    }
    this.updateBoard(s.baskets, s.turn, s.over);

    // Le bouton qui portait le focus vient peut-être de mourir — c'est le cas
    // systématique de celui qu'on VIENT de couper. On gare alors le focus sur
    // notre ancre plutôt que de le laisser retomber sur `<body>` (§5).
    if (wasOurs && prev && (prev.hidden || (prev as HTMLButtonElement).disabled)) this.anchor.focus();
  }

  /** `#sr-board` (`ctx.onBoard`). */
  private updateBoard(baskets: readonly [number, number], turn: 0 | 1, over: boolean): void {
    // « 1 pommes » à la synthèse vocale, c'est une faute qu'on entend.
    const bleu = `Panier bleu : ${baskets[0]} pomme${baskets[0] > 1 ? 's' : ''}`;
    const violet = `Panier violet : ${baskets[1]} pomme${baskets[1] > 1 ? 's' : ''}`;
    const text = over
      ? `Manche terminée. ${bleu}. ${violet}.`
      : `${bleu}. ${violet}. À ${turn === 0 ? 'bleu' : 'violet'} de couper.`;
    this.ctx.onBoard(text);
  }

  private onCut(edgeId: number): void {
    // Garde dupliquée anti-course (les boutons sont déjà `disabled` dans ces
    // deux états) : deux événements DOM rapprochés ne doivent pas pouvoir se
    // glisser dans la chute en cours.
    if (this.paused || this.pending !== null) return;
    const before = this.model.state;
    const player = before.turn;
    if (!this.model.cut(player, edgeId)) return;
    const after = this.model.state;

    sfx.cut();
    const gained = after.baskets[player] - before.baskets[player];
    const fallenCount = before.alive.filter(Boolean).length - after.alive.filter(Boolean).length;
    if (gained > 0) sfx.pick();
    const who = player === 0 ? 'bleu' : 'violet';
    const fruit = `${gained} pomme${gained > 1 ? 's' : ''}`;
    this.ctx.onAnnounce(
      fallenCount > 1
        ? `coupé : ${fallenCount} brindilles tombent, ${fruit} pour ${who}`
        : gained > 0
          ? `coupé : ${fruit} pour ${who}`
          : 'brindille coupée, sans pomme',
    );
    this.refresh();

    // On n'enchaîne RIEN tant que la branche n'est pas tombée — voir le
    // commentaire de `pending`. `refresh()` a déjà tout verrouillé.
    this.pending = after.over ? 'over' : after.turn !== player ? 'turn' : 'same';
    this.pendingIn = TREE_FALL_SEC;
  }

  /** Fin du délai de chute : on rend la main (voir `pending`). */
  private resolvePending(): void {
    const kind = this.pending;
    this.pending = null;
    this.refresh(); // déverrouille les boutons du joueur courant
    if (kind === 'over') {
      // Toutes les branches sont tombées : plus un seul bouton n'est
      // focalisable. On garde le focus chez nous, sur l'ancre — sans quoi il
      // retomberait sur `<body>` pendant le délai avant l'écran de résultat.
      this.anchor.focus();
      this.ctx.onOver(this.model.result);
      return;
    }
    if (kind === 'turn') {
      // Changement de main : posture 'pass', le shell ouvre l'écran de passage
      // et rendra lui-même le focus à la première cible légale.
      this.ctx.onTurn(this.model.state.turn);
      return;
    }
    // Même joueur (jeton ✂ dépensé, ou l'autre a passé automatiquement) :
    // aucun écran de passage, mais le focus doit quand même sauter sur la
    // première cible légale (§5).
    this.focusFirstLegal();
  }

  private focusFirstLegal(): void {
    const active = document.activeElement as HTMLElement | null;
    // Ne rendre le focus que s'il était à nous (ou nulle part) : le voler à
    // quelqu'un qui joue au doigt est pire que de le perdre (§5).
    if (active && active !== document.body && !this.ctx.overlay.contains(active)) return;
    this.buttons.find((b) => !b.hidden && !b.disabled)?.focus();
  }

  update(dt: number): void {
    if (this.paused) return;
    // Jeu au TOUR PAR TOUR : aucune simulation à faire avancer ici. Cette
    // horloge est de PRÉSENTATION, et elle sert exactement à deux choses :
    //   ① alimenter les fonctions CLOSES du temps de la vue (chute des
    //      branches, rebond des pommes) — le modèle, lui, n'a pas d'horloge et
    //      se rejoue intégralement sans elle ;
    //   ② tenir le délai qui laisse VOIR la chute avant l'écran de passage ou
    //      de résultat (voir `pending`).
    // Elle se fige à la pause (§1.2 : reprise à l'identique), comme tout
    // accumulateur du dépôt.
    this.time += dt;
    // Le verrou de chute est armé ICI, à chaque pas, et non à la frame de
    // rendu : il fige l'instant où une brindille tombe, et cet instant doit
    // être celui de la SIMULATION (cf. le commentaire de `detectFalls`).
    this.view.detectFalls(this.model.state, this.time);
    if (!this.boardPosted) {
      // Le shell écrit SA ligne générique dans `#sr-board` après `startGame`
      // (`Flow.enter`) : le résumé posé par le `refresh()` du constructeur est
      // donc écrasé, et un joueur au lecteur d'écran n'entendait ni les
      // paniers ni à qui de jouer avant d'avoir coupé une première fois. On le
      // repose à la première frame ; `refresh()` s'en charge ensuite.
      this.boardPosted = true;
      const s = this.model.state;
      this.updateBoard(s.baskets, s.turn, s.over);
    }
    if (this.pending === null) return;
    this.pendingIn -= dt;
    if (this.pendingIn <= 0) this.resolvePending();
  }

  render(_alpha: number): void {
    this.view.render(this.time);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.refresh();
  }

  /** §2.4 — la démo rejoue le MODÈLE RÉEL, jamais une animation séparée. */
  applyDemo(move: DemoMove): void {
    this.model.applyDemo(move);
    this.refresh();
  }

  destroy(): void {
    this.pending = null; // plus rien à résoudre : ni passage ni résultat après la sortie
    for (const b of this.buttons) b.remove();
    this.anchor.remove();
    this.view.destroy();
  }
}

/**
 * Coups canoniques rejoués en boucle par `core/demo.ts` (§2.4) : trois coupes
 * du joueur courant. `applyDemo` (dans `model.ts`) choisit lui-même, à chaque
 * pas, une brindille plantée dans le sol s'il en trouve une à sa couleur —
 * garantit une cascade visible quel que soit le graphe réellement généré pour
 * le seed utilisé par la démo, sans jamais coder d'identifiant d'arête en dur.
 */
const DEMO: Demo = [{ move: 'cut' }, { move: 'cut' }, { move: 'cut' }];

export const def: MiniGameDef = {
  id: 'tree',
  title: 'La branche coupée',
  emoji: '🍏',
  posture: 'pass',
  mode: 'duel',
  logical: { w: PASS_W, h: PASS_H },
  demo: DEMO,
  create: (ctx) => new TreeGame(ctx),
};

/** Modèle PUR exposé au bot via `window.__game.models` (§7). */
export { TreeModel as Model };
