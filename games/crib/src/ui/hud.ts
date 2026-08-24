import * as B from '../config/balance';
import type { Phase, Stats } from '../game/world';

export interface NightView {
  n: number;
  total: number;
  brief: string;
}

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
  onLaunchNight: (() => void) | null = null;

  private readonly perf: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly barLabel: HTMLElement;
  private readonly bossBar: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossTag: HTMLElement;
  private readonly info: HTMLElement;
  private readonly gold: HTMLElement;
  private readonly buffs: HTMLElement;
  private readonly live: HTMLElement;
  private readonly root: HTMLElement;
  private readonly launch: HTMLButtonElement;
  private readonly launchLabel: HTMLElement;
  private readonly launchBrief: HTMLElement;
  private phase: Phase = 'day';

  private acc = 0;
  private frames = 0;
  private fpsAcc = 0;
  private lastInfo = '';
  private lastGold = -1;
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
    this.bossTag = document.getElementById('hud-boss-tag')!;
    this.info = document.getElementById('hud-info')!;
    this.gold = document.getElementById('hud-gold')!;
    this.buffs = document.getElementById('hud-buffs')!;
    this.live = document.getElementById('hud-live')!;
    this.launch = document.getElementById('hud-launch') as HTMLButtonElement;
    this.launchLabel = document.getElementById('hud-launch-label')!;
    this.launchBrief = document.getElementById('hud-launch-brief')!;
    document.getElementById('hud-restart')!.addEventListener('click', () => this.onRestart?.());
    this.launch.addEventListener('click', () => this.onLaunchNight?.());
  }

  setInGame(on: boolean): void {
    this.root.classList.toggle('in-game', on);
    if (!on) {
      this.root.classList.remove('day', 'night');
      this.bossBar.hidden = true;
      this.lastLive = '';
      this.live.textContent = '';
    }
  }

  /**
   * Le HUD du jour et celui de la nuit ne portent pas les mêmes commandes : de
   * jour, la seule action est « Lancer la nuit », et son libellé porte le RÉSUMÉ de
   * la menace. C'est ce qui fait de la phase de jour une décision et pas un pari —
   * on choisit ses achats en sachant ce qui arrive.
   */
  setPhase(phase: Phase, night: NightView): void {
    this.phase = phase;
    this.root.classList.toggle('day', phase === 'day');
    this.root.classList.toggle('night', phase === 'night');
    if (phase === 'day') {
      this.launchLabel.textContent = `Lancer la nuit ${night.n} / ${night.total}`;
      this.launchBrief.textContent = night.brief;
      this.launch.setAttribute('aria-label', `Lancer la nuit ${night.n} sur ${night.total} : ${night.brief}`);
    }
    this.lastInfo = '';
    this.lastLive = '';
  }

  /** Annonce ponctuelle au lecteur d'écran (franchissement, pas valeur continue). */
  announce(text: string): void {
    this.live.textContent = text;
    this.lastLive = text;
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
    if (s.bossHp > 0) {
      this.bossFill.style.width = `${((s.bossHp / s.bossMax) * 100).toFixed(1)}%`;
      if (this.bossTag.textContent !== s.bossName) this.bossTag.textContent = s.bossName;
    }

    if (s.gold !== this.lastGold) {
      this.gold.textContent = `\u{1F4B0} ${Math.floor(s.gold)}`;
      this.lastGold = s.gold;
    }

    const info =
      s.phase === 'day'
        ? `Jour ${s.night} / ${s.nights}\nconstruis, puis lance la nuit`
        : `Nuit ${s.night} / ${s.nights}\n${this.fmt(s.time)} · ${s.enemies} ennemi${s.enemies > 1 ? 's' : ''}`;
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
    if (this.phase === 'day') return;
    const milestone = s.cleared
      ? 'Dernière vague passée.'
      : s.bossHp > 0
        ? `${s.bossName.replace(/^\S+\s/, '')} en approche.`
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
