import { SIDE_H, SIDE_W } from '../../config/balance';
import { sfx } from '../../audio/sfx';
import type { Demo, DemoMove, MiniGame, MiniGameCtx, MiniGameDef } from '../../core/minigame';
import {
  ANT_ARENA_H,
  ANT_ARENA_W,
  ANT_DROP_X_MAX,
  ANT_DROP_X_MIN,
  ANT_DROP_Y_MAX,
  ANT_DROP_Y_MIN,
  ANT_MID_Y,
  ANT_START_X,
  AntModel,
  type AntState,
} from './model';
import { AntView } from './view';

/**
 * `index.ts` de `ant` (§3.6) — SEUL fichier du dossier qui connaît à la fois
 * le modèle, la vue, le DOM et Pixi (contrat de `core/minigame.ts`).
 *
 * DEUX chemins d'entrée, jamais additionnés — la dernière source active
 * gagne (pattern de `plank`, lui-même repris de Berceau) :
 *   • pointeur : un joystick 2D (`.stickzone`, UN seul actif à la fois — celui
 *     du siège COURAMMENT fourmi) et un bouton plein cadre pour le géant, qui
 *     lit la position du clic (§3.6 : « tape n'importe où dans l'arène ») ;
 *   • clavier — MAPPING DEUX ZONES obligatoire (§5) : chaque siège GARDE ses
 *     touches toute la manche, ce qui CHANGE au rôle, c'est ce qu'elles font.
 *       - Siège 1 (gauche) : ZQSD-like `WASD` — déplace la fourmi si ce
 *         siège l'est, sinon déplace un RÉTICULE de visée ; `F` fait tomber
 *         un bloc à la position du réticule.
 *       - Siège 2 (droite) : flèches — même logique ; `Entrée` fait tomber.
 *     Le réticule n'existe QUE pour rendre le clavier capable de choisir une
 *     position arbitraire (comme le ferait un doigt) ; le clic pointeur ne
 *     s'en sert jamais (il lit directement la position du clic).
 */

interface Keys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

// Deux fonctions plutôt qu'un tuple retourné : un `[x, y]` allouait un tableau
// à CHAQUE tick (`updateReticle` est appelée à 60 Hz), et le §6 interdit toute
// allocation dans l'`update()` des trois jeux temps réel.
function dirX(k: Keys): number {
  return (k.right ? 1 : 0) - (k.left ? 1 : 0);
}
function dirY(k: Keys): number {
  return (k.down ? 1 : 0) - (k.up ? 1 : 0);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Vitesse du réticule de visée clavier (px/s) — jamais un paramètre de
 *  BALANCE : c'est un confort d'accessibilité, pas une règle de jeu. */
const RETICLE_SPEED = 460;

const STICK_SIZE = 168;
const STICK_MARGIN = 22;
const STICK_Y = SIDE_H - STICK_SIZE - STICK_MARGIN;

class AntGame implements MiniGame {
  private readonly model: AntModel;
  private readonly view: AntView;

  private readonly dropBtn: HTMLButtonElement;
  private readonly stick: readonly [HTMLDivElement, HTMLDivElement];
  /**
   * ANCRE DE REPLI DU FOCUS (pattern de `tree`/`suspects` et du bandeau).
   * `tabIndex = -1` : jamais atteinte en tabulant, seulement par `.focus()`.
   *
   * Elle existe parce que le bouton du géant est le SEUL focalisable de ce
   * jeu (les deux joysticks sont des zones de pointeur), et qu'il passe
   * `disabled` à chaque recharge — 1,2 s, et bien plus longtemps quand les
   * blocs sont tous posés. Le navigateur jette alors le focus sur `<body>` :
   * mesuré au bot, 217 échantillons sur une manche entière, soit un tiers du
   * temps SANS aucun focus dans la page. On l'y gare donc, avec la RAISON en
   * toutes lettres, et on le rend au bouton dès qu'il redevient actif.
   */
  private readonly anchor: HTMLDivElement;

  private readonly p0Keys: Keys = { up: false, down: false, left: false, right: false };
  private readonly p1Keys: Keys = { up: false, down: false, left: false, right: false };
  private readonly reticle: { x: number; y: number } = {
    x: SIDE_W / 2,
    y: (ANT_DROP_Y_MIN + ANT_DROP_Y_MAX) / 2,
  };

  private paused = false;
  private reportedOver = false;
  private lastCanDrop: boolean | null = null;
  /** Le bouton du géant portait-il le focus avant de passer `disabled` ? */
  private focusWasOurs = false;
  private lastCrossFlashAt = -Infinity;
  private lastAntSeat: 0 | 1 | -1 = -1;
  private lastPhase: AntState['phase'] | '' = '';

  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly ctx: MiniGameCtx) {
    this.model = new AntModel(ctx.seed, ctx.stars);
    this.view = new AntView(ctx.stage, this.model, ctx.reducedMotion, ctx.safeTop);

    // Bouton du géant : PLEIN CADRE, il lit la position du clic (§3.6). La
    // classe `.cell` donne gratuitement le liseré « ceci est actionnable »
    // et l'anneau de focus au-dessus du canvas — inhabituel à cette taille,
    // mais c'est exactement le même contrat qu'une case normale, en plus
    // grand : coup illégal (cooldown, plafond) = `disabled`, physiquement
    // impossible à déclencher (§1.1 critère 2).
    this.dropBtn = document.createElement('button');
    this.dropBtn.type = 'button';
    this.dropBtn.className = 'cell';
    this.dropBtn.style.cssText = `left:0px;top:0px;width:${ANT_ARENA_W}px;height:${ANT_ARENA_H}px;border-radius:22px;`;
    this.dropBtn.addEventListener('click', this.onDropClick);
    ctx.overlay.appendChild(this.dropBtn);

    this.anchor = document.createElement('div');
    this.anchor.className = 'sr-only';
    this.anchor.tabIndex = -1;
    // `hidden` tant qu'on ne s'en sert pas : un élément déplié en permanence
    // serait lu par le lecteur d'écran alors qu'il ne dit rien.
    this.anchor.hidden = true;
    ctx.overlay.appendChild(this.anchor);

    const stick0 = this.makeStick(STICK_MARGIN, STICK_Y, 'Fourmi — joystick, joueur 1');
    const stick1 = this.makeStick(SIDE_W - STICK_MARGIN - STICK_SIZE, STICK_Y, 'Fourmi — joystick, joueur 2');
    ctx.overlay.appendChild(stick0);
    ctx.overlay.appendChild(stick1);
    this.stick = [stick0, stick1];
    this.bindStick(stick0, 0);
    this.bindStick(stick1, 1);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.cleanups.push(() => window.removeEventListener('keydown', this.onKeyDown));
    this.cleanups.push(() => window.removeEventListener('keyup', this.onKeyUp));

    // Annonce + pictogrammes de départ (§1.3) : le rôle ET l'aide ⭐ sont
    // visibles/annoncés dès la première frame, pas seulement au changement.
    this.onRoleChanged(this.model.state);
  }

  private makeStick(x: number, y: number, label: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'stickzone';
    el.style.cssText = `left:${x}px;top:${y}px;width:${STICK_SIZE}px;height:${STICK_SIZE}px;border-radius:50%;background:rgba(255,243,226,0.1);box-shadow:inset 0 0 0 3px rgba(255,243,226,0.35);`;
    el.setAttribute('role', 'application');
    el.setAttribute('aria-label', label);
    return el;
  }

  /** Piège du §5 : `getBoundingClientRect()` d'un élément transformé par le
   *  letterbox renvoie déjà sa taille RENDUE — la fraction est donc invariante
   *  à l'échelle (même technique que `plank`). */
  private bindStick(zone: HTMLDivElement, seat: 0 | 1): void {
    let activeId: number | null = null;
    // Calcul INLINE : un `pointermove` tenu tire 60 à 120 événements par
    // seconde, et rendre un tuple `[dx, dy]` y allouait un tableau à chaque
    // fois. `setAntInput` renormalise déjà au-delà de 1.
    const apply = (e: PointerEvent): void => {
      if (this.model.antSeat !== seat) return; // caché normalement, garde-fou quand même
      const rect = zone.getBoundingClientRect();
      const dx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const dy = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      this.model.setAntInput(dx, dy);
    };
    const onDown = (e: PointerEvent): void => {
      if (this.paused) return;
      activeId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      apply(e);
    };
    const onMove = (e: PointerEvent): void => {
      if (this.paused || e.pointerId !== activeId) return;
      apply(e);
    };
    const onRelease = (e: PointerEvent): void => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      if (this.model.antSeat === seat) this.model.setAntInput(0, 0);
    };
    zone.addEventListener('pointerdown', onDown);
    zone.addEventListener('pointermove', onMove);
    zone.addEventListener('pointerup', onRelease);
    zone.addEventListener('pointercancel', onRelease);
    this.cleanups.push(() => {
      zone.removeEventListener('pointerdown', onDown);
      zone.removeEventListener('pointermove', onMove);
      zone.removeEventListener('pointerup', onRelease);
      zone.removeEventListener('pointercancel', onRelease);
    });
  }

  private readonly onDropClick = (e: MouseEvent): void => {
    if (this.paused) return;
    // `detail === 0` : activation clavier NATIVE (Entrée/Espace sur le bouton
    // focusé) — elle n'a aucune position à donner. Un bouton focusable qui ne
    // fait RIEN quand on l'active est le trou classique du §5 : on la traite
    // donc comme le mapping dédié, en posant le bloc au réticule (que la vue
    // dessine en permanence). `Entrée` déclenche alors DEUX chemins pour le
    // géant du siège 2 (ce clic natif + `case 'Enter'`), mais le second est
    // sans effet : le cooldown vient d'être armé par le premier.
    if (e.detail === 0) {
      this.attemptDrop(this.reticle.x, this.reticle.y);
      return;
    }
    const rect = this.dropBtn.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    this.attemptDrop(fx * ANT_ARENA_W, fy * ANT_ARENA_H);
  };

  private attemptDrop(x: number, y: number): void {
    const ok = this.model.tryDropBlock(x, y);
    if (ok) {
      sfx.thunk();
      this.ctx.onAnnounce('Un bloc tombe.');
    }
    this.pollCanDrop(true);
  }

  /**
   * TROU RÉEL, invisible à tout test au doigt (leçon de `steer.setKeyboardBlocker`
   * dans Berceau, prise ici à l'envers) : les écouteurs vivent sur `window` et
   * font `preventDefault`. `Entrée` sert au géant du siège 2 — donc, focus posé
   * sur le ⏸ ou le 🔊 du bandeau, `Entrée` était AVALÉE et la pause devenait
   * inatteignable au clavier, alors que le §1.2 exige un ⏸ « toujours
   * atteignable ». On rend donc la main dès que le focus est sur un contrôle
   * qui n'est pas à nous ; notre propre bouton de dépôt, lui, garde le mapping.
   */
  private foreignFocus(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (!t || t === this.dropBtn || t === document.body) return false;
    const tag = t.tagName;
    return tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.paused || this.foreignFocus(e)) return;
    switch (e.code) {
      case 'KeyW':
        this.p0Keys.up = true;
        break;
      case 'KeyS':
        this.p0Keys.down = true;
        break;
      case 'KeyA':
        this.p0Keys.left = true;
        break;
      case 'KeyD':
        this.p0Keys.right = true;
        break;
      case 'ArrowUp':
        this.p1Keys.up = true;
        break;
      case 'ArrowDown':
        this.p1Keys.down = true;
        break;
      case 'ArrowLeft':
        this.p1Keys.left = true;
        break;
      case 'ArrowRight':
        this.p1Keys.right = true;
        break;
      case 'KeyF':
        if (this.model.giantSeat === 0) {
          e.preventDefault();
          this.attemptDrop(this.reticle.x, this.reticle.y);
        }
        return;
      case 'Enter':
        if (this.model.giantSeat === 1) {
          e.preventDefault();
          this.attemptDrop(this.reticle.x, this.reticle.y);
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    this.applyAntKeys();
  };

  // Un RELÂCHEMENT est toujours traité, même si le focus est passé ailleurs
  // entre-temps : l'ignorer laisserait une touche « collée » et la fourmi
  // partirait toute seule (seul le `preventDefault` est conditionnel).
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const foreign = this.foreignFocus(e);
    switch (e.code) {
      case 'KeyW':
        this.p0Keys.up = false;
        break;
      case 'KeyS':
        this.p0Keys.down = false;
        break;
      case 'KeyA':
        this.p0Keys.left = false;
        break;
      case 'KeyD':
        this.p0Keys.right = false;
        break;
      case 'ArrowUp':
        this.p1Keys.up = false;
        break;
      case 'ArrowDown':
        this.p1Keys.down = false;
        break;
      case 'ArrowLeft':
        this.p1Keys.left = false;
        break;
      case 'ArrowRight':
        this.p1Keys.right = false;
        break;
      default:
        return;
    }
    if (!foreign) e.preventDefault();
    this.applyAntKeys();
  };

  /** Pousse au modèle le vecteur du siège COURAMMENT fourmi — l'autre siège
   *  garde ses touches tenues pour le réticule (§ci-dessus), lu en continu
   *  dans `update()` puisqu'il n'a aucune autre source concurrente. */
  private applyAntKeys(): void {
    const k = this.model.antSeat === 0 ? this.p0Keys : this.p1Keys;
    this.model.setAntInput(dirX(k), dirY(k));
  }

  private updateReticle(dt: number): void {
    const k = this.model.giantSeat === 0 ? this.p0Keys : this.p1Keys;
    const x = dirX(k);
    const y = dirY(k);
    const len = Math.hypot(x, y);
    if (len === 0) return;
    // Borné aux poses LÉGALES et pas à l'écran : `tryDropBlock` clampe le
    // point qu'il reçoit, donc un réticule qui sort de cette zone promettrait
    // une pose là où le bloc ne tombera pas.
    this.reticle.x = clamp(this.reticle.x + (x / len) * RETICLE_SPEED * dt, ANT_DROP_X_MIN, ANT_DROP_X_MAX);
    this.reticle.y = clamp(this.reticle.y + (y / len) * RETICLE_SPEED * dt, ANT_DROP_Y_MIN, ANT_DROP_Y_MAX);
  }

  /** `refresh()` du contrat DOM (§5) : synchrone à chaque changement de rôle
   *  (jamais différé à la frame de rendu suivante). */
  private onRoleChanged(s: AntState): void {
    this.lastAntSeat = s.antSeat;
    this.lastPhase = s.phase;
    // La manche se termine parfois par le MÊME tick qu'un changement de phase
    // (une traversée décisive en mort subite passe `suddenDeath` → `over`
    // sans jamais repasser par `round`) : pas d'annonce de « nouvelle manche »
    // à ce moment-là, `update()` va immédiatement déclencher `ctx.onOver`.
    if (s.phase === 'over') return;
    this.reticle.x = SIDE_W / 2;
    this.reticle.y = (ANT_DROP_Y_MIN + ANT_DROP_Y_MAX) / 2;
    this.stick[0].hidden = s.antSeat !== 0;
    this.stick[1].hidden = s.antSeat !== 1;
    this.applyAntKeys();
    this.pollCanDrop(true);

    const antNum = s.antSeat + 1;
    const giantNum = s.antSeat === 0 ? 2 : 1;
    const phaseTxt = s.phase === 'suddenDeath' ? 'Mort subite !' : `Manche ${s.half + 1} sur 2.`;
    const boostTxt = s.boosted
      ? ` La fourmi de joueur ${antNum} est aidée : plus rapide, et le géant a moins de blocs.`
      : '';
    this.ctx.onAnnounce(
      `${phaseTxt} Joueur ${antNum} est la fourmi, joueur ${giantNum} est le géant.${boostTxt}`,
    );
    sfx.pass();
  }

  private pollCanDrop(force = false): void {
    const can = !this.paused && this.model.canDrop();
    if (!force && can === this.lastCanDrop) return;
    // TROU CLASSIQUE DU §5, ici toutes les 1,2 s : le navigateur jette le
    // focus sur `<body>` dès qu'un bouton FOCUSÉ passe `disabled`. Sans ce
    // rattrapage, le géant au clavier voyait son anneau de focus disparaître à
    // chaque recharge et ne le retrouvait plus. On le rend au bouton dès qu'il
    // redevient actif, et SEULEMENT s'il était à nous ET s'il est retombé sur
    // `<body>` — voler le focus d'un joueur parti sur ⏸ serait pire.
    // L'état du focus se CAPTURE avant toute mutation de `disabled` (§5) :
    // après, l'information est déjà perdue.
    const active = document.activeElement;
    if (active === this.dropBtn || active === this.anchor) this.focusWasOurs = true;
    this.lastCanDrop = can;
    this.dropBtn.disabled = !can;
    this.dropBtn.setAttribute(
      'aria-label',
      can ? 'géant — toucher pour faire tomber un bloc' : 'géant — pas de bloc disponible pour l’instant',
    );
    if (can) {
      const wasAnchor = document.activeElement === this.anchor;
      this.anchor.hidden = true;
      // On ne rend le focus que s'il était à NOUS et qu'il est retombé : le
      // voler à un joueur parti sur ⏸ serait pire que de le perdre.
      if (this.focusWasOurs && (wasAnchor || document.activeElement === document.body)) this.dropBtn.focus();
      this.focusWasOurs = false;
      return;
    }
    // Le bouton vient de se griser : le focus part sur `<body>` tout seul. On
    // le GARE au lieu de le laisser tomber — c'est la seule différence entre
    // « le géant attend sa recharge » et « le géant au clavier est perdu ».
    if (this.focusWasOurs && (active === this.dropBtn || document.activeElement === document.body)) {
      this.anchor.hidden = false;
      this.anchor.textContent = 'géant — pas de bloc disponible, la recharge arrive';
      this.anchor.focus({ preventScroll: true });
    }
  }

  update(dt: number): void {
    if (this.paused) return;
    this.model.update(dt);
    this.updateReticle(dt);

    const s = this.model.state;
    if (s.crossFlashAt !== this.lastCrossFlashAt) {
      this.lastCrossFlashAt = s.crossFlashAt;
      sfx.goal();
      this.ctx.onAnnounce(`La fourmi traverse ! Joueur ${s.antSeat + 1} marque.`);
    }
    if (s.antSeat !== this.lastAntSeat || s.phase !== this.lastPhase) {
      this.onRoleChanged(s);
    }
    this.pollCanDrop();

    if (s.over && !this.reportedOver) {
      this.reportedOver = true;
      this.ctx.onOver(this.model.result);
    }
  }

  render(alpha: number): void {
    this.view.render(alpha, this.reticle);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.pollCanDrop(true);
  }

  /** §2.4 — rejoue le MODÈLE RÉEL, jamais une animation séparée. `ant` pose
   *  une direction continue (`hold` la tient) ou dépose un bloc ponctuel. */
  applyDemo(move: DemoMove): void {
    const [a = 0, b = 0] = move.args ?? [];
    if (move.move === 'ant') this.model.setAntInput(a, b);
    else if (move.move === 'drop') this.model.tryDropBlock(a, b);
    this.pollCanDrop(true);
  }

  destroy(): void {
    this.dropBtn.removeEventListener('click', this.onDropClick);
    this.dropBtn.remove();
    this.stick[0].remove();
    this.stick[1].remove();
    for (const cleanup of this.cleanups) cleanup();
    this.view.destroy();
  }
}

/**
 * Coups canoniques (§2.4) : la fourmi approche, un bloc tombe droit devant
 * elle, elle plonge dessous pour l'éviter puis file jusqu'à la fleur — le
 * geste complet (« le géant bloque, la fourmi contourne ») en une seule
 * traversée, sans un mot.
 *
 * ÉCART ASSUMÉ AU « 3 secondes » DU §1.1, et il est GÉOMÉTRIQUE : la ligne
 * d'arrivée est à `ANT_FLOWER_X - ANT_START_X` = 784 px du départ, et
 * `ANT_SPEED` vaut 190 px/s — une traversée ne peut pas durer moins de 4,1 s.
 * Cette liste en fait 4,3, soit le plancher plus le détour du contournement :
 * c'est le minimum pour que la démo montre le BUT atteint (la fleur, §1.1
 * critère 3) et pas seulement l'esquive. Amputer la fin la rendrait plus
 * courte et moins vraie.
 */
const DEMO: Demo = [
  { move: 'ant', args: [1, 0], hold: 0.6 },
  // `hold: 0` EXPLICITE, et il est indispensable : le contrat de `core/demo.ts`
  // donne la cadence lente (`DEMO_STEP_SEC`) à tout coup SANS `hold`, or un
  // dépôt de bloc est instantané — laisser 0,9 s ici faisait courir la fourmi
  // 171 px de plus, droit dans le bloc qu'elle venait de faire tomber, et la
  // démonstration montrait exactement le contraire de ce qu'elle enseigne
  // (constaté à la capture d'écran de l'écran de démonstration).
  { move: 'drop', args: [ANT_START_X + 260, ANT_MID_Y], hold: 0 },
  { move: 'ant', args: [1, 1], hold: 0.5 },
  { move: 'ant', args: [1, 0], hold: 3.2 },
];

export const def: MiniGameDef = {
  id: 'ant',
  title: 'Le géant et la fourmi',
  emoji: '🐜',
  posture: 'side',
  mode: 'asym',
  logical: { w: SIDE_W, h: SIDE_H },
  demo: DEMO,
  create: (ctx) => new AntGame(ctx),
};

/** Modèle PUR exposé au bot via `window.__game.models` (§7). */
export { AntModel as Model };
