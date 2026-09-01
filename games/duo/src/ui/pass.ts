import type { MascotDef } from '../config/mascots';

/**
 * L'ÉCRAN DE PASSAGE (§4.2) — « passe le téléphone à 🐰 ».
 *
 * Plein écran, fond de la teinte du destinataire, sa mascotte en TRÈS grand,
 * une flèche animée, et UN SEUL bouton qui occupe tout l'écran. Le tap EST le
 * contrat : tant que le destinataire n'a pas touché, personne ne joue — c'est
 * ce qui rend le vol de tour impossible sans une ligne de logique de plus.
 *
 * TROIS RÈGLES, chacune pour une raison précise :
 *
 * ① IL MASQUE, IL NE VOILE PAS. Le shell pose `visibility:hidden` sur le canvas
 *    ET sur le bandeau ; cet écran est opaque. Un voile semi-transparent
 *    laisserait DEVINER le coup de l'autre, ce qui vide l'écran de sa fonction —
 *    la spec l'écrit noir sur blanc.
 * ② RIEN D'AUTRE N'EST FOCALISABLE. Le bandeau est `hidden`, `#overlay` est
 *    dans `#hud` donc masqué avec lui, `#ui` est en `display:none`. Il reste
 *    exactement un bouton dans l'ordre de tabulation : impossible de tabuler
 *    par erreur sur le plateau caché et de jouer à l'aveugle.
 * ③ LE TEXTE NE SE POSE JAMAIS SUR LA TEINTE. Les six teintes vont de 3,93:1
 *    (la chouette) à 13,4:1 avec l'encre sombre : la chouette échouerait le
 *    4,5:1 exigé d'un texte. Le libellé vit donc sur une plaque `bgDeep`
 *    posée par-dessus, où il est à ~13:1 quelle que soit la mascotte. La teinte
 *    reste un GRAND APLAT — un objet graphique, seuil 3:1, tenu par les six.
 */
export class PassScreen {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly socle: HTMLElement;
  private readonly plate: HTMLElement;

  /** Branché par le Flow : le destinataire a tapé. */
  onTap: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'passbtn';

    this.socle = document.createElement('span');
    // Les DEUX classes : `socle` porte les six formes (le second code d'un
    // joueur, WCAG 1.4.1), `pass-socle` n'en change que la taille. Poser la
    // seule `pass-socle` faisait perdre la forme et ne laissait que la teinte.
    this.socle.className = 'socle pass-socle disc';
    this.socle.setAttribute('aria-hidden', 'true');

    const arrow = document.createElement('span');
    arrow.className = 'pass-arrow';
    arrow.textContent = '👇';
    arrow.setAttribute('aria-hidden', 'true');

    this.plate = document.createElement('span');
    this.plate.className = 'pass-plate';

    this.button.append(this.socle, arrow, this.plate);
    this.button.addEventListener('click', () => this.onTap());
    this.root.appendChild(this.button);
    this.root.hidden = true;
  }

  /**
   * Affiche l'écran pour `mascot`. Le focus va sur le bouton : au clavier
   * comme au doigt, l'unique geste possible est le bon.
   */
  show(mascot: MascotDef): void {
    this.root.style.background = hexOf(mascot.tint);
    this.socle.className = `socle pass-socle ${mascot.socle}`;
    this.socle.style.background = 'rgba(44, 31, 24, 0.22)';
    this.socle.textContent = mascot.emoji;
    this.plate.textContent = `c’est à toi, ${mascot.name} !`;
    this.button.setAttribute('aria-label', `passe le téléphone à ${mascot.name} — c’est à toi`);
    this.root.hidden = false;
    this.root.classList.add('visible');
    this.button.focus();
  }

  /** Renvoie `true` si le focus était à nous (l'appelant doit le replacer). */
  hide(): boolean {
    const had = this.root.contains(document.activeElement);
    this.root.classList.remove('visible');
    this.root.hidden = true;
    return had;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}

function hexOf(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
