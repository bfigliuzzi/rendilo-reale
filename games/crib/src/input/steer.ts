import { clamp } from '@shared/math';
import * as B from '../config/balance';

/** Sources d'entrée, mutuellement exclusives : la dernière active gagne. */
type Source = 'none' | 'stick' | 'keys';

const KEY_VECTORS: Readonly<Record<string, readonly [number, number]>> = {
  // ZQSD (azerty), WASD (qwerty) et flèches, tous acceptés en même temps :
  // `event.code` est indépendant de la disposition, donc KeyW EST la touche Z
  // d'un clavier français. On mappe les DEUX familles de codes pour couvrir les
  // deux dispositions physiques sans détecter le layout.
  KeyW: [0, -1],
  KeyZ: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  KeyQ: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/**
 * Le seul verbe du jeu : diriger le bébé. Expose un vecteur `dirX`/`dirY` de
 * magnitude ≤ 1, consommé par `Hero.update` — la classe ne mute JAMAIS la sim
 * elle-même.
 *
 * Deux sources fusionnées, jamais additionnées : poser le pouce coupe le clavier
 * et inversement. Les mélanger produisait des diagonales fantômes quand une touche
 * restait « collée » (perte de focus pendant un appui, très fréquent sur mobile
 * avec un clavier Bluetooth).
 *
 * Le joystick écoute sur `window` plutôt que sur le canvas (pattern de horde) :
 * le pouce peut sortir de la zone letterboxée en pleine course sans que le stick
 * ne décroche.
 */
export class Steer {
  dirX = 0;
  dirY = 0;

  /** Origine du stick en pixels logiques, pour le rendu du joystick. */
  stickX = 0;
  stickY = 0;
  /** Décalage courant du stick, déjà clampé à STICK_RADIUS. */
  stickDX = 0;
  stickDY = 0;
  stickActive = false;

  private enabled = false;
  private pointerId = -1;
  private originX = 0;
  private originY = 0;
  private readonly keys = new Set<string>();
  private source: Source = 'none';

  constructor(private readonly getScale: () => number) {
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    // perte de focus (alt-tab, notification) : sans ça une touche reste « collée »
    // et le bébé part en ligne droite tout seul
    window.addEventListener('blur', this.releaseAll);
  }

  /**
   * Piloté par `Flow` : aucune entrée ne doit fuir dans les menus, sinon le bébé
   * dérive en arrière-plan pendant qu'on lit l'écran de résultat.
   */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.releaseAll();
  }

  /**
   * Tant que le focus est DANS cet élément, le clavier ne pilote plus le bébé.
   *
   * C'est le trou réel du panneau d'achat, et il ne se voit à aucun test au doigt :
   * `onKeyDown` avale ZQSD/WASD et fait `preventDefault`, donc un joueur qui tabule
   * dans la feuille ferait courir le bébé hors de portée et le panneau se
   * refermerait sous ses doigts.
   *
   * Le POINTEUR, lui, reste actif : on doit pouvoir déplacer le bébé au doigt
   * panneau ouvert. Et `Steer` ne connaît toujours aucun identifiant du HUD — on lui
   * passe l'élément, il ne va pas le chercher.
   */
  setKeyboardBlocker(el: HTMLElement | null): void {
    this.blocker = el;
  }

  private blocker: HTMLElement | null = null;

  private get keyboardBlocked(): boolean {
    return this.blocker !== null && document.activeElement !== null && this.blocker.contains(document.activeElement);
  }

  destroy(): void {
    window.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
  }

  private readonly releaseAll = (): void => {
    this.keys.clear();
    this.pointerId = -1;
    this.stickActive = false;
    this.stickDX = 0;
    this.stickDY = 0;
    this.dirX = 0;
    this.dirY = 0;
    this.source = 'none';
  };

  // ------------------------------------------------------------------ joystick

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.enabled || this.pointerId !== -1) return;
    // ne pas voler le geste aux boutons du HUD (bouton ↻, mute…)
    // ne pas voler le geste aux contrôles du HUD (↻, mute, lancement de nuit) NI au
    // FOND de la feuille d'achat : elle est `pointer-events: auto` sur tout son
    // conteneur, sinon un glissement démarré entre deux boutons passerait au travers
    // et ferait courir le bébé sous le panneau.
    if (e.target instanceof Element && e.target.closest('button, a, input, #hud-build')) return;
    this.pointerId = e.pointerId;
    const scale = this.getScale();
    this.originX = e.clientX / scale;
    this.originY = e.clientY / scale;
    // origine du stick en coordonnées logiques du canvas (centré, letterboxé)
    this.stickX = (e.clientX - window.innerWidth / 2) / scale + B.DESIGN_W / 2;
    this.stickY = (e.clientY - window.innerHeight / 2) / scale + B.DESIGN_H / 2;
    this.stickDX = 0;
    this.stickDY = 0;
    this.stickActive = true;
    this.source = 'stick';
    this.recompute();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const scale = this.getScale();
    const dx = e.clientX / scale - this.originX;
    const dy = e.clientY / scale - this.originY;
    const len = Math.hypot(dx, dy);
    if (len > B.STICK_RADIUS) {
      // au-delà du rayon, l'origine SUIT le doigt : un long glissement ne laisse
      // pas le stick collé à sa butée initiale, la direction reste vivante
      this.originX += (dx / len) * (len - B.STICK_RADIUS);
      this.originY += (dy / len) * (len - B.STICK_RADIUS);
      this.stickDX = (dx / len) * B.STICK_RADIUS;
      this.stickDY = (dy / len) * B.STICK_RADIUS;
    } else {
      this.stickDX = dx;
      this.stickDY = dy;
    }
    this.source = 'stick';
    this.recompute();
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    this.stickActive = false;
    this.stickDX = 0;
    this.stickDY = 0;
    if (this.source === 'stick') this.source = this.keys.size > 0 ? 'keys' : 'none';
    this.recompute();
  };

  // ------------------------------------------------------------------- clavier

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || this.keyboardBlocked || !(e.code in KEY_VECTORS)) return;
    // les flèches font défiler la page sur desktop : on les consomme
    e.preventDefault();
    this.keys.add(e.code);
    this.source = 'keys';
    this.recompute();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (!(e.code in KEY_VECTORS)) return;
    this.keys.delete(e.code);
    if (this.keys.size === 0 && this.source === 'keys') {
      this.source = this.stickActive ? 'stick' : 'none';
    }
    this.recompute();
  };

  // ------------------------------------------------------------------ fusion

  private recompute(): void {
    if (!this.enabled || this.source === 'none') {
      this.dirX = 0;
      this.dirY = 0;
      return;
    }
    let x = 0;
    let y = 0;
    if (this.source === 'stick') {
      // magnitude analogique : on peut avancer doucement pour se recaler d'un cheveu
      x = this.stickDX / B.STICK_RADIUS;
      y = this.stickDY / B.STICK_RADIUS;
      const len = Math.hypot(x, y);
      if (len < B.STICK_DEADZONE / B.STICK_RADIUS) {
        x = 0;
        y = 0;
      }
    } else {
      for (const code of this.keys) {
        const v = KEY_VECTORS[code];
        x += v[0];
        y += v[1];
      }
      // le clavier est tout-ou-rien : on normalise pour que la diagonale ne soit
      // pas 41 % plus rapide qu'une ligne droite
      const len = Math.hypot(x, y);
      if (len > 0) {
        x /= len;
        y /= len;
      }
    }
    this.dirX = clamp(x, -1, 1);
    this.dirY = clamp(y, -1, 1);
  }
}
