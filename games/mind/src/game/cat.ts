import { mulberry32 } from '@shared/rng';
import {
  CAT_DECISION_INTERVAL,
  CAT_FLEE_TIME,
  CAT_FRAME_TIME,
  CAT_MIN_PEGS_TO_SWAP,
  CAT_MISCHIEF_CHANCE,
  CAT_MISCHIEF_COOLDOWN,
  CAT_PAUSE_MAX,
  CAT_PAUSE_MIN,
  CAT_PAW_TIME,
  CAT_SPARE_LAST_TRY,
  CAT_SPEED,
  BOARD_BOTTOM,
  BOARD_TOP,
  DESIGN_W,
  MAX_PEGS,
  rowY,
  slotX,
} from '../config/balance';
import { CAT_ANIM } from '../render/textures';
import type { Board } from './board';

export type CatState = 'sleep' | 'walk' | 'sit' | 'stalk' | 'paw' | 'flee';
export type MischiefKind = 'swap' | 'steal';

export interface MischiefEvent {
  kind: MischiefKind;
  /** Emplacement principal (le seul concerné pour un vol). */
  a: number;
  /** Second emplacement d'un échange, −1 pour un vol. */
  b: number;
  /** Valeur emportée par le chat, pour l'annonce (`null` si échange). */
  stolen: number | null;
}

/** Aire de promenade : le chat marche SUR le plateau, c'est tout l'intérêt. */
const ROAM_X0 = 40;
const ROAM_X1 = DESIGN_W - 40;
const ROAM_Y0 = BOARD_TOP + 6;
// borné au bas du plateau : au-delà, le chat passait sur le bandeau de statut
const ROAM_Y1 = BOARD_BOTTOM - 14;

/** Tampon des emplacements remplis — évite d'allouer dans le tick. */
const FILLED = new Int8Array(MAX_PEGS);

/** Groupe d'animation et nombre de frames par état. */
const ANIM: Record<CatState, { group: number; frames: number; frameTime: number }> = {
  sleep: { group: CAT_ANIM.sleep, frames: 2, frameTime: CAT_FRAME_TIME * 6 },
  walk: { group: CAT_ANIM.walk, frames: 4, frameTime: CAT_FRAME_TIME },
  sit: { group: CAT_ANIM.sit, frames: 2, frameTime: CAT_FRAME_TIME * 5 },
  stalk: { group: CAT_ANIM.walk, frames: 4, frameTime: CAT_FRAME_TIME * 0.8 },
  paw: { group: CAT_ANIM.paw, frames: 3, frameTime: CAT_PAW_TIME / 3 },
  flee: { group: CAT_ANIM.run, frames: 2, frameTime: CAT_FRAME_TIME * 0.6 },
};

/**
 * Le chat farceur. Il vit DEHORS de la logique : `Board` ne le connaît pas, et le
 * chat n'a aucun accès privilégié — il passe par la MÊME API que le joueur
 * (`setPeg`, `swapPegs`), après un `markUndoPoint()` qui arme le bouton ↩.
 *
 * Trois garde-fous font qu'il reste une farce et non une punition :
 *  ① il ne touche QUE la ligne en cours de composition — jamais l'historique
 *    validé, jamais le code secret ;
 *  ② il s'abstient au dernier essai (`CAT_SPARE_LAST_TRY`) : un vol au tout
 *    dernier tour ne serait plus drôle, ce serait une défaite volée ;
 *  ③ tout est annulable d'un bouton, et réparable à la main de toute façon.
 *
 * `setEnabled(false)` le rend totalement inerte : c'est ce que fait le bot de
 * vérification pour que ses parties soient déterministes.
 */
export class Cat {
  x = ROAM_X1;
  y = ROAM_Y1;
  prevX = this.x;
  prevY = this.y;
  /** +1 = regarde à droite, −1 = à gauche. */
  facing = -1;
  state: CatState = 'sleep';

  /** Le chat existe-t-il à l'écran ? (le bot le coupe entièrement) */
  enabled = true;
  /** Peut-il déplacer des pions ? Désactivé, il continue à se balader. */
  mischiefEnabled = true;

  onMischief: (e: MischiefEvent) => void = () => {};
  onMeow: () => void = () => {};
  onPaw: () => void = () => {};

  private rand: () => number;
  private targetX = this.x;
  private targetY = this.y;
  private stateTime = 0;
  private waitTime = 0;
  private sinceDecision = 0;
  private sinceMischief = 0;
  private frameTimer = 0;
  private frameIndex = 0;
  /** Méfait décidé, appliqué au milieu du coup de patte. */
  private pendingSlot = -1;
  private pawApplied = false;

  constructor(seed: number) {
    this.rand = mulberry32(seed);
  }

  /** Nouvelle partie : le chat repart de son coin, endormi. */
  reset(seed: number): void {
    this.rand = mulberry32(seed);
    this.x = this.prevX = ROAM_X1;
    this.y = this.prevY = ROAM_Y1;
    this.facing = -1;
    this.state = 'sleep';
    this.stateTime = 0;
    // il dort un moment : personne n'aime être chahuté au premier essai
    this.waitTime = 6 + this.rand() * 6;
    this.sinceDecision = 0;
    this.sinceMischief = 0;
    this.frameTimer = 0;
    this.frameIndex = 0;
    this.pendingSlot = -1;
    this.pawApplied = false;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  setMischief(on: boolean): void {
    this.mischiefEnabled = on;
  }

  /** Groupe et frame d'animation courants — lus par render/catView.ts. */
  get animGroup(): number {
    return ANIM[this.state].group;
  }

  get animFrame(): number {
    return this.frameIndex;
  }

  update(dt: number, board: Board | null, playing: boolean): void {
    if (!this.enabled) return;
    this.prevX = this.x;
    this.prevY = this.y;
    this.stateTime += dt;

    const anim = ANIM[this.state];
    this.frameTimer += dt;
    if (this.frameTimer >= anim.frameTime) {
      this.frameTimer -= anim.frameTime;
      this.frameIndex = (this.frameIndex + 1) % anim.frames;
    }

    if (playing && board) {
      this.sinceDecision += dt;
      this.sinceMischief += dt;
      if (this.sinceDecision >= CAT_DECISION_INTERVAL) {
        this.sinceDecision = 0;
        this.considerMischief(board);
      }
    }

    switch (this.state) {
      case 'sleep':
      case 'sit':
        if (this.stateTime >= this.waitTime) this.wander();
        break;
      case 'walk':
      case 'stalk':
      case 'flee':
        this.moveToward(dt, this.state === 'flee' ? CAT_SPEED * 2.6 : CAT_SPEED);
        break;
      case 'paw':
        // le méfait s'applique à MI-COURSE du geste : le joueur voit la patte
        // partir avant que la ligne ne change
        if (!this.pawApplied && this.stateTime >= CAT_PAW_TIME * 0.45) {
          this.pawApplied = true;
          if (board) this.applyMischief(board);
        }
        if (this.stateTime >= CAT_PAW_TIME) this.flee();
        break;
    }

    if (this.state === 'flee' && this.stateTime >= CAT_FLEE_TIME) this.wander();
  }

  /** Le chat traverse l'écran en courant — appelé à la victoire. */
  celebrate(): void {
    if (!this.enabled) return;
    this.state = 'flee';
    this.stateTime = 0;
    this.frameIndex = 0;
    this.targetX = this.x < DESIGN_W / 2 ? ROAM_X1 : ROAM_X0;
    this.targetY = (ROAM_Y0 + ROAM_Y1) / 2;
    this.facing = this.targetX > this.x ? 1 : -1;
  }

  /**
   * Déclenche un méfait immédiatement si les conditions le permettent. Le bot
   * l'appelle pour tester le chat sans attendre le hasard.
   */
  forceMischief(board: Board): boolean {
    if (!this.enabled || !this.canMisbehave(board)) return false;
    this.startStalk(board);
    return true;
  }

  // ───────────────────────────────────────────────────────── décision

  private canMisbehave(board: Board): boolean {
    if (!this.mischiefEnabled || board.over) return false;
    if (CAT_SPARE_LAST_TRY && board.lastTry) return false;
    if (this.state === 'stalk' || this.state === 'paw' || this.state === 'flee') return false;
    return board.placed() >= 1;
  }

  private considerMischief(board: Board): void {
    if (this.sinceMischief < CAT_MISCHIEF_COOLDOWN) return;
    if (!this.canMisbehave(board)) return;
    if (this.rand() >= CAT_MISCHIEF_CHANCE) return;
    this.startStalk(board);
  }

  private startStalk(board: Board): void {
    // il vise un emplacement REMPLI de la ligne en cours
    const n = this.collectFilled(board);
    if (n === 0) return;
    this.pendingSlot = FILLED[Math.floor(this.rand() * n)];
    this.state = 'stalk';
    this.stateTime = 0;
    this.frameIndex = 0;
    this.pawApplied = false;
    this.targetX = slotX(this.pendingSlot, board.def.pegs) - 30;
    this.targetY = rowY(board.activeRow, board.def.tries) + 6;
    this.facing = this.targetX > this.x ? 1 : -1;
    this.onMeow();
  }

  private collectFilled(board: Board): number {
    let n = 0;
    const pegs = board.active.pegs;
    for (let i = 0; i < pegs.length; i++) {
      if (pegs[i] !== null) FILLED[n++] = i;
    }
    return n;
  }

  // ───────────────────────────────────────────────────────── méfaits

  private applyMischief(board: Board): void {
    if (board.over) return;
    const n = this.collectFilled(board);
    if (n === 0) return;

    // Un échange n'a de sens qu'entre deux pions DIFFÉRENTS : échanger deux pions
    // identiques ne changerait rien et l'annonce mentirait au joueur.
    let swapA = -1;
    let swapB = -1;
    if (n >= CAT_MIN_PEGS_TO_SWAP) {
      for (let i = 0; i < n && swapA < 0; i++) {
        for (let j = i + 1; j < n; j++) {
          if (board.active.pegs[FILLED[i]] !== board.active.pegs[FILLED[j]]) {
            swapA = FILLED[i];
            swapB = FILLED[j];
            break;
          }
        }
      }
    }

    const wantSwap = swapA >= 0 && this.rand() < 0.55;
    board.markUndoPoint();

    if (wantSwap) {
      board.swapPegs(swapA, swapB);
      this.onPaw();
      this.onMischief({ kind: 'swap', a: swapA, b: swapB, stolen: null });
      return;
    }

    const slot = this.pendingSlot >= 0 && board.active.pegs[this.pendingSlot] !== null
      ? this.pendingSlot
      : FILLED[Math.floor(this.rand() * n)];
    const stolen = board.active.pegs[slot];
    board.setPeg(slot, null);
    this.onPaw();
    this.onMischief({ kind: 'steal', a: slot, b: -1, stolen });
  }

  // ───────────────────────────────────────────────────────── déplacement

  private wander(): void {
    this.state = 'walk';
    this.stateTime = 0;
    this.frameIndex = 0;
    this.targetX = ROAM_X0 + this.rand() * (ROAM_X1 - ROAM_X0);
    this.targetY = ROAM_Y0 + this.rand() * (ROAM_Y1 - ROAM_Y0);
    this.facing = this.targetX > this.x ? 1 : -1;
  }

  private flee(): void {
    this.state = 'flee';
    this.stateTime = 0;
    this.frameIndex = 0;
    this.targetX = this.x < DESIGN_W / 2 ? ROAM_X0 : ROAM_X1;
    this.targetY = ROAM_Y0 + this.rand() * (ROAM_Y1 - ROAM_Y0);
    this.facing = this.targetX > this.x ? 1 : -1;
  }

  private moveToward(dt: number, speed: number): void {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) {
      this.arrive();
      return;
    }
    const step = Math.min(dist, speed * dt);
    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
    if (Math.abs(dx) > 4) this.facing = dx > 0 ? 1 : -1;
  }

  private arrive(): void {
    if (this.state === 'stalk') {
      this.state = 'paw';
      this.stateTime = 0;
      this.frameIndex = 0;
      this.pawApplied = false;
      this.sinceMischief = 0;
      return;
    }
    // il s'assoit, se toilette, et se rendort de temps en temps
    this.state = this.rand() < 0.25 ? 'sleep' : 'sit';
    this.stateTime = 0;
    this.frameIndex = 0;
    this.waitTime = CAT_PAUSE_MIN + this.rand() * (CAT_PAUSE_MAX - CAT_PAUSE_MIN);
  }
}
