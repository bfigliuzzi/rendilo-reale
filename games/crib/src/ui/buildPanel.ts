import type { OfferView, SlotView } from '../game/buildings';

/**
 * La feuille d'achat, en DOM natif au-dessus du canvas.
 *
 * FEUILLE FIXE EN BAS D'ÉCRAN, et pas une bulle ancrée à l'emplacement. Trois
 * raisons, dans cet ordre :
 *  ① l'arène DÉFILE sous une caméra — un élément DOM ancré au monde devrait être
 *    repositionné à chaque frame ET composer avec la transformation de letterbox,
 *    deux sources de bug pour zéro gain ;
 *  ② en 540×960 logiques, une bulle sur un emplacement du haut n'a nulle part où
 *    aller ;
 *  ③ une feuille fixe a une cible de focus et un ordre de tabulation STABLES, et
 *    c'est ça qui rend la conformité RGAA bon marché.
 * Le lien avec l'emplacement reste lisible : un chevron flotte au-dessus de lui
 * dans le monde, et l'en-tête de la feuille dit son nom.
 *
 * Elle s'ouvre et se ferme À LA PROXIMITÉ, sans bouton : c'est le geste de
 * Thronefall, et un contrôle de moins.
 *
 * On ne VOLE JAMAIS le focus à l'ouverture. La feuille s'ouvre en marchant : voler
 * le focus casserait le joueur au doigt et ferait parler le lecteur d'écran à chaque
 * pas. On annonce, et on reste atteignable au Tab.
 */
export class BuildPanel {
  onBuy: ((slotId: number, offerId: string) => void) | null = null;

  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly list: HTMLElement;
  private key = '';

  constructor() {
    this.root = document.getElementById('hud-build')!;
    this.title = document.getElementById('hud-build-title')!;
    this.list = document.getElementById('hud-build-list')!;
    // délégation : les offres sont réécrites à chaque changement, un écouteur par
    // bouton fuirait à chaque rendu
    this.list.addEventListener('click', (e) => {
      const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('button[data-offer]');
      if (!btn || btn.disabled) return;
      this.onBuy?.(Number(btn.dataset.slot), btn.dataset.offer!);
    });
    // Échap ferme en rendant la main au jeu, sans attendre qu'on s'éloigne
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      (document.getElementById('hud-launch') as HTMLElement | null)?.focus();
    });
  }

  /** L'élément qui, quand il a le focus, doit couper le pilotage au clavier. */
  get element(): HTMLElement {
    return this.root;
  }

  /**
   * Diff-gardé sur une clé : réécrire la liste à 10 Hz reflowerait le DOM en
   * permanence et ferait sauter le focus du bouton en cours de sélection.
   */
  setTarget(slot: SlotView | null, offers: OfferView[]): void {
    const key = slot
      ? `${slot.id}|${slot.building}|${slot.level}|${offers.map((o) => o.id + (o.affordable ? '1' : '0')).join(',')}`
      : '';
    if (key === this.key) return;
    this.key = key;

    if (!slot) {
      // si le focus était DANS la feuille, on le rend à une cible sûre : il ne doit
      // jamais retomber sur <body>, c'est l'assertion RGAA du bot
      if (this.root.contains(document.activeElement)) {
        (document.getElementById('hud-launch') as HTMLElement | null)?.focus();
      }
      this.root.hidden = true;
      this.list.innerHTML = '';
      return;
    }

    this.root.hidden = false;
    this.root.setAttribute('aria-label', `Emplacement : ${slot.name}`);
    this.title.textContent = slot.name;
    if (offers.length === 0) {
      this.list.innerHTML = '<p class="build-none">Rien de plus à faire ici.</p>';
      return;
    }
    this.list.innerHTML = offers
      .map(
        (o) => `
      <button type="button" class="build-offer" data-slot="${slot.id}" data-offer="${o.id}" ${o.affordable ? '' : 'disabled'}>
        <span class="build-icon" aria-hidden="true">${o.icon}</span>
        <span class="build-text"><span class="build-name">${o.name}</span><span class="build-detail">${o.detail}</span></span>
        <span class="build-cost">${o.cost} or</span>
      </button>`,
      )
      .join('');
  }
}
