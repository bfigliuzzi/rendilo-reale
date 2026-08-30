import type { Sfx } from '../audio/sfx';
import { CELL_W, DESIGN_W, lineY, rowOf, slotX, unitDef } from '../config/balance';
import type { Layers } from '../render/layers';
import { BattleView } from '../render/battleView';
import { DoorsView } from '../render/doorsView';
import { FLOAT_DAMAGE, FLOAT_HEAL, Fx } from '../render/fx';
import { PALETTE } from '../render/textures';
import type { Atlas } from '../render/textures';
import type { Ambience } from '../render/ambience';
import type { Action, CombatEvent, CUnit } from './combat';
import type { Run } from './run';

/**
 * L'orchestrateur : il possède la run, REJOUE les événements déjà résolus par
 * `Combat`, et rend l'écran. Il ne décide jamais d'une règle.
 *
 * Le modèle résout un tour INSTANTANÉMENT ; World le donne à voir en drainant
 * la file d'événements à cadence humaine. C'est ce découplage qui permet au bot
 * de vérification de jouer sans attendre les animations, et à `Combat` de
 * rester pur.
 */

/** Durée d'affichage de chaque type d'événement, en secondes. */
const DELAY: Readonly<Record<CombatEvent['type'], number>> = {
  attack: 0.42,
  volley: 0.55,
  wide: 0.6,
  heal: 0.42,
  death: 0.45,
  swap: 0.4,
  defend: 0.3,
  summon: 0.7,
  phase: 0.9,
  expire: 0.4,
  end: 0.25,
};

/** Temps de « réflexion » de l'IA — sans lui, ses tours seraient illisibles. */
const ENEMY_THINK = 0.5;

export type WorldMode = 'idle' | 'doors' | 'combat';

export class World {
  run: Run | null = null;
  mode: WorldMode = 'idle';
  readonly battle: BattleView;
  readonly doors: DoorsView;

  /** Appelé quand la file d'événements est vide ET le combat terminé. */
  onCombatOver: (victory: boolean) => void = () => {};
  /** Une phrase par événement, pour le miroir `aria-live` du HUD. */
  onAnnounce: (text: string) => void = () => {};
  /** L'état a changé : le HUD doit se reconstruire SYNCHRONEMENT. */
  onStateChanged: () => void = () => {};

  /** `true` tant qu'une animation joue : l'UI n'accepte alors aucune action. */
  busy = false;
  /** Cadence des animations : 0.5 en mouvement réduit (jamais 0 — on doit lire). */
  private paceMul = 1;

  private timer = 0;
  private think = 0;
  private ended = false;

  constructor(
    readonly layers: Layers,
    atlas: Atlas,
    private readonly fx: Fx,
    private readonly ambience: Ambience,
    private readonly sfx: Sfx,
  ) {
    this.battle = new BattleView(layers, atlas);
    this.doors = new DoorsView(layers, atlas);
  }

  setReducedMotion(on: boolean): void {
    this.paceMul = on ? 0.5 : 1;
    this.fx.particleMul = on ? 0 : 1;
    this.ambience.setEnabled(!on);
  }

  setRun(run: Run | null): void {
    this.run = run;
    this.ended = false;
    this.timer = 0;
    this.think = 0;
    this.busy = false;
    this.fx.clear();
    this.syncMode();
  }

  /** Aligne le mode d'affichage sur la phase de la run. */
  syncMode(): void {
    const next: WorldMode = !this.run ? 'idle' : this.run.phase === 'combat' ? 'combat' : this.run.phase === 'doors' ? 'doors' : 'idle';
    if (next !== this.mode) {
      this.battle.reset();
      this.doors.reset();
      this.mode = next;
    }
    if (next === 'combat') this.ended = false;
    this.layers.doors.visible = next === 'doors';
    this.layers.units.visible = next !== 'idle';
    this.layers.bars.visible = next === 'combat';
  }

  // ─────────────────────────────────────────────── entrées du joueur

  /** Joue l'action de l'unité active. `false` si elle est illégale ou hors tour. */
  playerAct(action: Action): boolean {
    const c = this.run?.combat;
    if (!c || this.busy || c.outcome) return false;
    const u = c.current();
    if (!u || u.side !== 0) return false;
    if (action.kind === 'phial' && this.run!.phials <= 0) return false;
    if (!c.act(action)) return false;
    // Les compteurs ne bougent QU'APRÈS une action réellement acceptée : les
    // incrémenter avant ferait mentir les succès sur un coup illégal.
    if (action.kind === 'swap') this.run!.stats.swaps++;
    if (action.kind === 'phial') this.run!.phials--;
    this.busy = c.events.length > 0;
    this.onStateChanged();
    return true;
  }

  // ─────────────────────────────────────────────── boucle

  update(dt: number): void {
    this.ambience.update(dt);
    this.fx.update(dt);
    this.battle.update(dt);
    this.doors.update(dt);
    if (this.mode !== 'combat') return;

    // `busy` PILOTE l'activation des boutons du HUD. Il passe à faux tout seul,
    // à la frame où la file d'événements se vide — c'est-à-dire sans qu'aucune
    // action ne se produise. Si on ne prévient pas le HUD ICI, la barre d'action
    // reste grisée après le dernier coup ennemi de la manche et le joueur n'a
    // plus AUCUN moyen de jouer son tour : partie bloquée, sans erreur console.
    // (Diagnostiqué par le scénario `keyboard` du bot, qui ne trouvait jamais le
    // bouton « Attaquer » focusable.)
    const wasBusy = this.busy;
    this.step(dt);
    if (wasBusy !== this.busy) this.onStateChanged();
  }

  private step(dt: number): void {
    const c = this.run?.combat;
    if (!c) return;

    if (this.timer > 0) {
      this.timer -= dt;
      return;
    }
    if (c.events.length > 0) {
      const evt = c.events.shift() as CombatEvent;
      this.play(c, evt);
      this.timer = DELAY[evt.type] * this.paceMul;
      this.busy = true;
      return;
    }
    this.busy = false;

    if (c.outcome) {
      if (!this.ended) {
        this.ended = true;
        this.onCombatOver(c.outcome === 'victory');
      }
      return;
    }

    const u = c.current();
    if (u && u.side === 1) {
      this.think += dt;
      if (this.think >= ENEMY_THINK * this.paceMul) {
        this.think = 0;
        c.autoAct();
        this.busy = c.events.length > 0;
        this.onStateChanged();
      }
    } else {
      this.think = 0;
    }
  }

  render(): void {
    if (this.mode === 'combat' && this.run?.combat) {
      this.battle.draw(this.run.combat, this.run.meta.frontCap);
    } else if (this.mode === 'doors' && this.run) {
      const squad = this.run.squad;
      this.doors.draw(this.run.doors, this.run.node);
      this.doors.drawSquad(
        squad.members.map((m) => ({
          sprite: unitDef(m.defId).sprite,
          hp: m.hp,
          maxHp: squad.maxHpOf(m),
          dead: m.dead,
        })),
      );
    }
  }

  /** Centre écran d'une unité — le HUD y pose son bouton transparent. */
  cellOf(u: CUnit): { x: number; y: number } {
    const c = this.run?.combat;
    const cap = c ? c.capOf(u.side, u.line) : 2;
    return { x: slotX(u.slot, cap), y: lineY(rowOf(u.side, u.line)) };
  }

  // ─────────────────────────────────────────────── rejeu d'un événement

  private play(c: import('./combat').Combat, evt: CombatEvent): void {
    switch (evt.type) {
      case 'attack': {
        const from = c.byUid(evt.from);
        const to = c.byUid(evt.to);
        if (!to) return;
        this.impact(to, evt.dmg, from?.ability === 'jailer');
        this.onAnnounce(`${from?.name ?? '?'} frappe ${to.name} : ${evt.dmg} dégâts.`);
        break;
      }
      case 'volley': {
        const from = c.byUid(evt.from);
        this.sfx.volley();
        for (const h of evt.hits) {
          const to = c.byUid(h.to);
          if (to) this.impact(to, h.dmg, false, false);
        }
        this.onAnnounce(
          `${from?.name ?? '?'} lance une salve runique sur la ligne ${evt.line === 0 ? 'avant' : 'arrière'} : ${evt.hits.length} cible${evt.hits.length > 1 ? 's' : ''} à ${evt.hits[0]?.dmg ?? 0} dégâts.`,
        );
        break;
      }
      case 'wide': {
        const from = c.byUid(evt.from);
        this.sfx.hit(true);
        for (const h of evt.hits) {
          const to = c.byUid(h.to);
          if (to) this.impact(to, h.dmg, true, false);
        }
        this.onAnnounce(`${from?.name ?? '?'} assène une FRAPPE LARGE sur tout ton front.`);
        break;
      }
      case 'heal': {
        const to = c.byUid(evt.to);
        const from = c.byUid(evt.from);
        if (!to) return;
        const p = this.cellOf(to);
        this.sfx.heal();
        this.fx.burst(p.x, p.y - 12, PALETTE.leaf, 0.8);
        this.fx.float(p.x, p.y - 40, `+${evt.amount}`, FLOAT_HEAL);
        this.onAnnounce(
          evt.from === evt.to
            ? `${to.name} reprend son souffle : ${evt.amount} PV.`
            : `${from?.name ?? '?'} soigne ${to.name} de ${evt.amount} PV.`,
        );
        break;
      }
      case 'death': {
        const u = c.byUid(evt.uid);
        if (!u) return;
        const p = this.cellOf(u);
        this.sfx.death();
        this.fx.burst(p.x, p.y - 12, u.side === 0 ? PALETTE.gold : PALETTE.ember, 1.6);
        this.onAnnounce(`${u.name} tombe.`);
        break;
      }
      case 'swap': {
        const u = c.byUid(evt.uid);
        const o = evt.other === null ? null : c.byUid(evt.other);
        this.sfx.swap();
        this.onAnnounce(
          o ? `${u?.name ?? '?'} permute avec ${o.name}.` : `${u?.name ?? '?'} change de ligne.`,
        );
        break;
      }
      case 'defend': {
        const u = c.byUid(evt.uid);
        this.sfx.defend();
        this.onAnnounce(`${u?.name ?? '?'} se met en garde : 3 dégâts de moins jusqu'à son prochain tour.`);
        break;
      }
      case 'summon': {
        this.sfx.phase();
        for (const uid of evt.uids) {
          const u = c.byUid(uid);
          if (!u) continue;
          const p = this.cellOf(u);
          this.fx.burst(p.x, p.y, PALETTE.ember, 1.2);
        }
        this.onAnnounce(`Deux Rats-goules apparaissent à la ligne arrière ennemie.`);
        break;
      }
      case 'phase': {
        const u = c.byUid(evt.uid);
        this.sfx.phase();
        if (u) {
          const p = this.cellOf(u);
          this.fx.burst(p.x, p.y, PALETTE.gold, 2);
        }
        this.onAnnounce(`${u?.name ?? 'Le boss'} passe en seconde phase : frappe large sur ton front.`);
        break;
      }
      case 'expire': {
        const u = c.byUid(evt.uid);
        if (u) {
          const p = this.cellOf(u);
          this.fx.burst(p.x, p.y - 12, PALETTE.cool, 1);
        }
        this.onAnnounce(`${u?.name ?? 'Le spectre'} se dissipe.`);
        break;
      }
      case 'end':
        if (evt.victory) this.sfx.victory();
        else this.sfx.defeat();
        this.onAnnounce(evt.victory ? 'Salle nettoyée.' : 'Toute ton escouade est à terre.');
        break;
    }
  }

  private impact(target: CUnit, dmg: number, heavy: boolean, sound = true): void {
    const p = this.cellOf(target);
    if (sound) this.sfx.hit(heavy);
    this.battle.hit(target.uid);
    this.fx.burst(p.x, p.y - 10, PALETTE.ember, heavy ? 1.6 : 1);
    this.fx.float(p.x + (target.side === 0 ? -18 : 18), p.y - 44, `−${dmg}`, FLOAT_DAMAGE);
  }
}

/** Largeur utile d'une case — le HUD dimensionne ses boutons dessus. */
export const HIT_W = CELL_W - 8;
export const SCREEN_W = DESIGN_W;
