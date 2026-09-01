import { Container, Text } from 'pixi.js';
import { mulberry32 } from '@shared/rng';
import { sfx } from '../audio/sfx';
import { PASS_H, PASS_W } from '../config/balance';
import { PALETTE } from '../render/textures';
import type { Demo, DemoMove, MiniGame, MiniGameCtx, MiniGameDef, Result } from './minigame';

/**
 * LE MICRO-JEU BIDON DU §8.2 — « tape le bouton ».
 *
 * Il n'est PAS enregistré dans `config/games.ts` et n'apparaît donc jamais dans
 * la grille : il vit ici, dans `core/`, et se lance par `/games/duo/?probe` ou
 * par `window.__game.probe`. Deux raisons de ne pas l'avoir mis à la place du
 * placeholder de `plank` comme le proposait la consigne :
 *   ① les huit dossiers `games/<id>/` sont réécrits EN PARALLÈLE par huit
 *      agents et doivent rester strictement disjoints — y poser un harnais de
 *      validation du shell reviendrait à le faire supprimer par le premier
 *      d'entre eux, et le shell perdrait son seul test de bout en bout ;
 *   ② `plank` est en posture 'side', donc il ne peut PAS exercer `onTurn`
 *      (l'écran de passage n'existe qu'en posture 'pass'). Le bidon est en
 *      posture 'pass' précisément pour couvrir ce chemin-là.
 *
 * CE QU'IL PROUVE, et c'est tout ce qu'on lui demande — les cinq points du
 * contrat `MiniGame`, dans une manche de quinze secondes :
 *   • `onTurn`   : chaque tape change de joueur → écran de passage plein écran ;
 *   • `onAnnounce` : une phrase par tape dans `#sr-log` ;
 *   • `onOver`   : cinq tapes (IMPAIR : pas d'égalité possible) ou horloge
 *                  écoulée → écran de résultat, score de table, « le perdant
 *                  choisit » ;
 *   • `setPaused`: l'horloge est un ACCUMULATEUR — s'il ne se figeait pas, une
 *                  pause de trente secondes finirait la manche toute seule.
 *                  C'est LE test de la pause instantanée du §1.2 ;
 *   • `destroy`  : le bouton quitte l'overlay et la vue quitte le stage ; le
 *                  shell vide les deux derrière lui, donc une fuite se voit
 *                  immédiatement en tabulant après un retour au menu.
 *
 * Il respecte le même découpage que les huit vrais jeux : le modèle est PUR
 * (aucune horloge, aucun `Math.random`, aucun DOM, aucun Pixi), la vue ne le
 * mute jamais. Ils tiennent dans ce fichier parce qu'il n'est pas un jeu de la
 * collection et qu'on ne veut pas d'un neuvième dossier qui ressemble aux huit.
 */

/** Tapes qui terminent la manche. IMPAIR : l'égalité est structurellement impossible. */
const PROBE_TAPS = 5;
/** Horloge de la manche, en secondes. Courte : c'est un harnais, pas un jeu. */
const PROBE_TIME = 15;

export interface ProbeState {
  readonly taps: readonly [number, number];
  readonly turn: 0 | 1;
  readonly left: number;
  readonly time: number;
  readonly over: boolean;
}

/** Modèle PUR : il reçoit le temps en paramètre, il ne le lit jamais. */
export class ProbeModel {
  private readonly t: [number, number] = [0, 0];
  private cur: 0 | 1;
  private remaining = PROBE_TAPS;
  private clock = PROBE_TIME;

  constructor(readonly seed: number) {
    // Qui commence dérive du seed : à seed égale, manche identique.
    this.cur = mulberry32(seed)() < 0.5 ? 0 : 1;
  }

  get state(): ProbeState {
    return {
      taps: this.t,
      turn: this.cur,
      left: this.remaining,
      time: this.clock,
      over: this.remaining <= 0 || this.clock <= 0,
    };
  }

  canTap(player: 0 | 1): boolean {
    return !this.state.over && player === this.cur;
  }

  /** @returns `true` si le coup a été joué (donc si l'état a changé). */
  tap(player: 0 | 1): boolean {
    if (!this.canTap(player)) return false;
    this.t[player] += 1;
    this.remaining -= 1;
    this.cur = this.cur === 0 ? 1 : 0;
    return true;
  }

  /** Avance l'horloge. Le SHELL décide quand — d'où la pause qui marche. */
  tick(dt: number): void {
    if (this.state.over) return;
    this.clock = Math.max(0, this.clock - dt);
  }

  get result(): Result {
    const [a, b] = this.t;
    const winner: 0 | 1 | null = a === b ? null : a > b ? 0 : 1;
    return {
      winner,
      scores: [a, b],
      reason:
        winner === null
          ? `${a} tapes chacun, le temps est écoulé`
          : `${Math.max(a, b)} tapes contre ${Math.min(a, b)}`,
    };
  }
}

class ProbeGame implements MiniGame {
  private readonly model: ProbeModel;
  private readonly root = new Container();
  private readonly title: Text;
  private readonly info: Text;
  private readonly button: HTMLButtonElement;
  private paused = false;
  private done = false;
  private lastInfo = '';

  constructor(private readonly ctx: MiniGameCtx) {
    this.model = new ProbeModel(ctx.seed);

    this.title = label('👉 tape le bouton', 30, PALETTE.cream, PASS_W / 2, 300);
    this.info = label('', 44, PALETTE.gold, PASS_W / 2, 380);
    this.root.addChild(this.title, this.info);
    ctx.stage.addChild(this.root);

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'bigbtn';
    this.button.style.left = `${PASS_W / 2 - 170}px`;
    this.button.style.top = `${PASS_H / 2 + 60}px`;
    this.button.style.width = '340px';
    this.button.style.height = '160px'; // ≫ 60 px logiques (§1.1)
    this.button.textContent = '👆';
    this.button.addEventListener('click', this.onTap);
    ctx.overlay.appendChild(this.button);

    this.refresh();
  }

  /** Synchrone à chaque changement d'état (§5). */
  private refresh(): void {
    const s = this.model.state;
    this.button.disabled = s.over || this.paused;
    this.button.setAttribute(
      'aria-label',
      s.over ? 'manche terminée' : `taper — encore ${s.left} tapes`,
    );
  }

  private readonly onTap = (): void => {
    if (this.paused || this.done) return;
    const player = this.model.state.turn;
    if (!this.model.tap(player)) return;
    sfx.tap();
    this.ctx.onAnnounce(`joueur ${player + 1} a tapé`);
    this.refresh();
    this.finishOrPass();
  };

  private finishOrPass(): void {
    const s = this.model.state;
    if (s.over) {
      this.done = true;
      this.refresh();
      this.ctx.onOver(this.model.result);
      return;
    }
    // Le tour a changé : le shell ouvre l'écran de passage et fige le monde
    // jusqu'au tap du destinataire.
    this.ctx.onTurn(s.turn);
  }

  update(dt: number): void {
    if (this.paused || this.done) return;
    this.model.tick(dt);
    if (this.model.state.over) this.finishOrPass();
  }

  render(): void {
    const s = this.model.state;
    const text = `${s.taps[0]} – ${s.taps[1]}   ⏱ ${Math.ceil(s.time)}`;
    // Écrire un `Text` à chaque frame coûte un re-upload de texture : on
    // n'écrit que si la valeur affichée change (règle du dépôt).
    if (text !== this.lastInfo) {
      this.lastInfo = text;
      this.info.text = text;
    }
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.refresh();
  }

  /** §2.4 — la démo rejoue le MODÈLE RÉEL, jamais une animation séparée. */
  applyDemo(move: DemoMove): void {
    if (move.move !== 'tap') return;
    this.model.tap(this.model.state.turn);
    this.refresh();
  }

  destroy(): void {
    this.button.removeEventListener('click', this.onTap);
    this.button.remove();
    this.root.destroy({ children: true });
  }
}

function label(text: string, size: number, fill: number, x: number, y: number): Text {
  const t = new Text({
    text,
    style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fontWeight: '900', fill },
  });
  t.anchor.set(0.5);
  t.position.set(x, y);
  return t;
}

const DEMO: Demo = [{ move: 'tap' }, { move: 'tap' }, { move: 'tap' }];

/**
 * Volontairement ABSENT de `GAMES` : ce n'est pas un jeu de la collection, et
 * une neuvième vignette contredirait le §10 (« un neuvième jeu » est hors
 * périmètre).
 */
export const PROBE_DEF: MiniGameDef = {
  id: 'probe',
  title: 'Tape le bouton (validation)',
  emoji: '👆',
  posture: 'pass',
  mode: 'duel',
  logical: { w: PASS_W, h: PASS_H },
  demo: DEMO,
  create: (ctx) => new ProbeGame(ctx),
};
