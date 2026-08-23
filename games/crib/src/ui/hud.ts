import * as B from '../config/balance';
import type { Stats } from '../game/world';

const UPDATE_MS = 100;

/**
 * HUD en DOM pur (pattern des trois autres jeux) : rien de tout ça n'a besoin d'être
 * dans le canvas, et le DOM donne gratuitement les boutons accessibles et un texte
 * net à toute densité d'écran.
 *
 * Le HUD ne porte JAMAIS seul une information vitale : les PV du berceau se lisent
 * aussi sur son sprite (barreaux cassés), l'engluement sur l'anneau autour du bébé.
 * Le HUD chiffre, il n'alerte pas — sinon on regarderait le coin de l'écran au pire
 * moment.
 */
export class Hud {
  onRestart: (() => void) | null = null;

  private readonly perf: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly barLabel: HTMLElement;
  private readonly bossBar: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly info: HTMLElement;
  private readonly buffs: HTMLElement;
  private readonly live: HTMLElement;
  private readonly root: HTMLElement;

  private acc = 0;
  private frames = 0;
  private fpsAcc = 0;
  private lastInfo = '';
  private lastBuffs = '';
  private lastLive = '';

  constructor() {
    this.root = document.getElementById('hud')!;
    this.perf = document.getElementById('hud-perf')!;
    this.bar = document.getElementById('hud-crib')!;
    this.barFill = document.getElementById('hud-crib-fill')!;
    this.barLabel = document.getElementById('hud-crib-label')!;
    this.bossBar = document.getElementById('hud-boss')!;
    this.bossFill = document.getElementById('hud-boss-fill')!;
    this.info = document.getElementById('hud-info')!;
    this.buffs = document.getElementById('hud-buffs')!;
    this.live = document.getElementById('hud-live')!;
    document.getElementById('hud-restart')!.addEventListener('click', () => this.onRestart?.());
  }

  setInGame(on: boolean): void {
    this.root.classList.toggle('in-game', on);
    if (!on) {
      this.bossBar.hidden = true;
      this.lastLive = '';
      this.live.textContent = '';
    }
  }

  /** Compteur de fps, lu par le bot de vérification autant que par nous. */
  onFrame(frameMs: number): void {
    this.frames++;
    this.fpsAcc += frameMs;
    if (this.fpsAcc >= 500) {
      this.perf.textContent = `${Math.round((this.frames * 1000) / this.fpsAcc)} fps`;
      this.frames = 0;
      this.fpsAcc = 0;
    }
  }

  /** Throttlé : réécrire du texte DOM à 60 Hz coûte plus cher que la sim entière. */
  maybeUpdate(frameMs: number, s: Stats): void {
    this.acc += frameMs;
    if (this.acc < UPDATE_MS) return;
    this.acc = 0;

    const frac = s.cribMax > 0 ? Math.max(0, s.cribHp / s.cribMax) : 0;
    this.barFill.style.width = `${(frac * 100).toFixed(1)}%`;
    // trois paliers de couleur, alignés sur les trois états d'usure du sprite : le
    // HUD et le berceau doivent raconter la même chose au même moment
    this.bar.dataset.wear = frac > B.CRIB_WEAR[0] ? '0' : frac > B.CRIB_WEAR[1] ? '1' : '2';
    const label = `Berceau ${Math.ceil(s.cribHp)}/${Math.round(s.cribMax)}`;
    if (this.barLabel.textContent !== label) this.barLabel.textContent = label;

    this.bossBar.hidden = s.bossHp <= 0;
    if (s.bossHp > 0) this.bossFill.style.width = `${((s.bossHp / s.bossMax) * 100).toFixed(1)}%`;

    const info = `${this.fmt(s.time)}\n${s.enemies} ennemi${s.enemies > 1 ? 's' : ''}`;
    if (info !== this.lastInfo) {
      this.info.textContent = info;
      this.lastInfo = info;
    }

    let buffs = '';
    if (s.bottleT > 0) buffs += `🍼 ${s.bottleT.toFixed(0)}s `;
    if (s.immuneT > 0) buffs += `🧸 ${s.immuneT.toFixed(0)}s `;
    if (s.pinned) buffs += '⚠️ cloué';
    else if (s.grip > B.GRIP_VIGNETTE_FROM) buffs += `englué ${Math.round(s.grip * 100)} %`;
    if (buffs !== this.lastBuffs) {
      this.buffs.textContent = buffs;
      this.lastBuffs = buffs;
    }

    // annonces au lecteur d'écran : uniquement les FRANCHISSEMENTS de palier, jamais
    // une valeur continue — un aria-live qui parle à chaque tick est inutilisable
    const milestone = s.cleared
      ? 'Dernière vague passée.'
      : s.bossHp > 0
        ? 'Aspirateur géant en approche.'
        : frac <= B.CRIB_WEAR[1]
          ? 'Berceau en danger.'
          : frac <= B.CRIB_WEAR[0]
            ? 'Berceau abîmé.'
            : '';
    if (milestone !== this.lastLive) {
      this.live.textContent = milestone;
      this.lastLive = milestone;
    }
  }

  private fmt(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
