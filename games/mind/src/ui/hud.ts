import {
  ACTIONS_H,
  ACTIONS_TOP,
  DESIGN_H,
  DESIGN_W,
  PALETTE_Y,
  rowH,
  SLOT_GAP,
  paletteX,
  rowY,
  slotX,
} from '../config/balance';
import { pegName } from '../config/pegs';
import { EMPTY_PEG } from '../config/rules';
import type { DifficultyDef } from '../config/rules';
import type { Board } from '../game/board';
import { symbolAt, symbolCount } from '../game/board';

/**
 * L'interface de jeu, en DOM NATIF superposé au canvas.
 *
 * C'est LA décision d'accessibilité du jeu : un canvas est opaque aux
 * technologies d'assistance, alors le canvas ne porte que le visuel et
 * l'interaction passe par de vrais `<button>` et `<input type="radio">`
 * TRANSPARENTS, posés exactement sur les pions dessinés. On récupère ainsi sans
 * rien réimplémenter : l'ordre de tabulation, Entrée/Espace, les noms
 * accessibles, la sémantique de groupe de boutons radio (et sa navigation aux
 * flèches), et un anneau de focus réellement visible AU-DESSUS du canvas.
 *
 * Les boutons d'emplacement SUIVENT la ligne en cours : un seul jeu de boutons
 * suffit, puisque l'historique n'est pas interactif.
 */
export class Hud {
  // ── callbacks, câblés par Flow
  onPick: (index: number) => void = () => {};
  /** Tap/Entrée sur un emplacement : y poser la couleur sélectionnée. */
  onPlace: (slot: number) => void = () => {};
  /** Touche 1-8 / 0 : poser directement un symbole. */
  onSet: (slot: number, index: number) => void = () => {};
  onClearSlot: (slot: number) => void = () => {};
  onSubmit: () => void = () => {};
  onUndo: () => void = () => {};
  onMenu: () => void = () => {};
  onRestart: () => void = () => {};
  /** L'emplacement visé a changé — le rendu y pose son anneau de visée. */
  onFocusSlot: (slot: number) => void = () => {};

  /** Emplacement visé (focus clavier ou dernier tap) — lu par le rendu. */
  focusSlot = 0;

  private readonly slots: HTMLButtonElement[] = [];
  private readonly swatches: HTMLInputElement[] = [];
  private readonly slotGroup: HTMLDivElement;
  private readonly paletteGroup: HTMLDivElement;
  private readonly submitBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private def: DifficultyDef | null = null;

  private catTimer = 0;
  private lastSubmitEnabled = false;
  private lastUndoEnabled = false;
  private historyCount = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly catEl: HTMLElement,
    private readonly srStatus: HTMLElement,
    private readonly srHistory: HTMLElement,
  ) {
    // Les deux groupes couvrent tout l'overlay : leurs enfants se positionnent
    // donc dans le même repère logique 540×960 que le canvas.
    this.slotGroup = document.createElement('div');
    this.slotGroup.setAttribute('role', 'group');
    this.slotGroup.setAttribute('aria-label', 'Ligne en cours');
    this.paletteGroup = document.createElement('div');
    this.paletteGroup.setAttribute('role', 'radiogroup');
    this.paletteGroup.setAttribute('aria-label', 'Couleur à poser');
    for (const g of [this.slotGroup, this.paletteGroup]) {
      g.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
      this.root.appendChild(g);
    }

    const menu = this.makeTopButton('⌂', 'Retour au menu', 8);
    menu.addEventListener('click', () => this.onMenu());
    const restart = this.makeTopButton('↻', 'Nouvelle partie', DESIGN_W - 52);
    restart.addEventListener('click', () => this.onRestart());

    this.submitBtn = document.createElement('button');
    this.submitBtn.type = 'button';
    this.submitBtn.id = 'submit';
    this.submitBtn.className = 'action primary';
    this.submitBtn.textContent = '✓ Valider';
    // Désactivé D'ENTRÉE : une ligne vide n'est pas validable, et l'état initial
    // doit correspondre à `lastSubmitEnabled = false` sinon le premier diff est
    // sauté et le bouton reste actif à tort.
    this.submitBtn.disabled = true;
    this.submitBtn.style.cssText = `left:24px;top:${ACTIONS_TOP}px;width:272px;height:${ACTIONS_H}px;`;
    this.submitBtn.addEventListener('click', () => this.onSubmit());
    this.root.appendChild(this.submitBtn);

    this.undoBtn = document.createElement('button');
    this.undoBtn.type = 'button';
    this.undoBtn.id = 'undo';
    this.undoBtn.className = 'action';
    this.undoBtn.textContent = '↩ Annuler';
    this.undoBtn.disabled = true;
    this.undoBtn.style.cssText = `left:308px;top:${ACTIONS_TOP}px;width:208px;height:${ACTIONS_H}px;`;
    this.undoBtn.addEventListener('click', () => this.onUndo());
    this.root.appendChild(this.undoBtn);

    // Raccourci global : Z annule le méfait où que soit le focus dans le jeu.
    this.root.addEventListener('keydown', (e) => {
      if ((e.key === 'z' || e.key === 'Z') && !e.ctrlKey && !e.metaKey && !this.undoBtn.disabled) {
        e.preventDefault();
        this.onUndo();
      }
    });
  }

  private makeTopButton(glyph: string, label: string, left: number): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'topbtn';
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
    b.style.cssText = `left:${left}px;top:8px;`;
    this.root.appendChild(b);
    return b;
  }

  /** (Re)construit les boutons pour une difficulté. */
  setup(def: DifficultyDef): void {
    this.def = def;
    this.focusSlot = 0;
    this.lastSubmitEnabled = false;
    this.lastUndoEnabled = false;
    this.submitBtn.disabled = true;
    this.undoBtn.disabled = true;
    this.slotGroup.replaceChildren();
    this.paletteGroup.replaceChildren();
    this.slots.length = 0;
    this.swatches.length = 0;
    this.resetHistory();

    for (let s = 0; s < def.pegs; s++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hit';
      b.dataset.slot = `${s}`;
      // un SEUL arrêt de tabulation pour toute la ligne (tabindex glissant,
      // pratique ARIA des grilles) : les flèches font le reste
      b.tabIndex = s === 0 ? 0 : -1;
      const w = SLOT_GAP - 8;
      const h = rowH(def.tries) - 4;
      b.style.cssText = `left:${slotX(s, def.pegs) - w / 2}px;top:0px;width:${w}px;height:${h}px;`;
      b.addEventListener('click', () => {
        this.setFocusSlot(s, false);
        this.onPlace(s);
      });
      b.addEventListener('focus', () => this.setFocusSlot(s, false));
      b.addEventListener('keydown', (e) => this.onSlotKey(e, s));
      this.slotGroup.appendChild(b);
      this.slots.push(b);
    }

    const symbols = symbolCount(def);
    for (let i = 0; i < symbols; i++) {
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = 'mind-palette';
      r.className = 'hit';
      r.dataset.symbol = `${i}`;
      // `appearance: none` (CSS) efface le rond natif MAIS garde l'élément
      // focusable et capable d'afficher un anneau de focus — c'est pour ça qu'on
      // ne le masque pas en `opacity: 0`.
      r.setAttribute('aria-label', pegName(symbolAt(def, i)));
      const size = 50;
      r.style.cssText = `left:${paletteX(i, symbols) - size / 2}px;top:${PALETTE_Y - size / 2}px;width:${size}px;height:${size}px;appearance:none;-webkit-appearance:none;`;
      r.addEventListener('change', () => this.onPick(i));
      r.addEventListener('click', () => this.onPick(i));
      this.paletteGroup.appendChild(r);
      this.swatches.push(r);
    }
  }

  setInGame(on: boolean): void {
    this.root.hidden = !on;
    if (!on) this.hideCat();
  }

  /** Applique la même transformation de letterbox que le canvas. */
  layout(scale: number): void {
    this.root.style.transform = `translate(-50%, -50%) scale(${scale})`;
    this.root.style.width = `${DESIGN_W}px`;
    this.root.style.height = `${DESIGN_H}px`;
  }

  // ───────────────────────────────────────────────────────── clavier

  private onSlotKey(e: KeyboardEvent, slot: number): void {
    const def = this.def;
    if (!def) return;
    const symbols = symbolCount(def);

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        this.setFocusSlot((slot - 1 + def.pegs) % def.pegs, true);
        return;
      case 'ArrowRight':
        e.preventDefault();
        this.setFocusSlot((slot + 1) % def.pegs, true);
        return;
      case 'Home':
        e.preventDefault();
        this.setFocusSlot(0, true);
        return;
      case 'End':
        e.preventDefault();
        this.setFocusSlot(def.pegs - 1, true);
        return;
      case 'Backspace':
      case 'Delete':
        e.preventDefault();
        this.onClearSlot(slot);
        return;
    }

    // 1-8 = une couleur, 0 = le pion vide (difficile). La saisie au clavier ne
    // passe donc PAS par la palette : c'est le chemin le plus rapide, et le seul
    // qui ne demande aucun pointage.
    if (e.key >= '1' && e.key <= '8') {
      const index = Number(e.key) - 1;
      if (index < def.colors) {
        e.preventDefault();
        this.setAndAdvance(slot, index, def.pegs);
      }
      return;
    }
    if (e.key === '0' && def.allowEmpty) {
      e.preventDefault();
      this.setAndAdvance(slot, def.colors, def.pegs);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // évite que la page tente de défiler sous le plateau
      e.preventDefault();
      const cur = this.swatches.findIndex((s) => s.checked);
      const next = e.key === 'ArrowDown' ? (cur + 1 + symbols) % symbols : (cur - 1 + symbols) % symbols;
      this.selectSwatch(next);
      this.onPick(next);
    }
  }

  /**
   * Pose un symbole au clavier puis AVANCE d'un emplacement. Sans cet
   * enchaînement, taper « 1 2 3 4 » écraserait quatre fois le même emplacement :
   * c'est ce qui rend la saisie au clavier réellement praticable.
   *
   * L'avance est sautée si la ligne vient de se compléter — World a alors déjà
   * porté le focus sur ✓ Valider, et le lui reprendre annulerait le service rendu.
   */
  private setAndAdvance(slot: number, index: number, pegs: number): void {
    this.onSet(slot, index);
    if (document.activeElement === this.submitBtn) return;
    if (slot + 1 < pegs) this.setFocusSlot(slot + 1, true);
  }

  /** Déplace le tabindex glissant, et le focus réel si demandé. */
  setFocusSlot(slot: number, moveFocus: boolean): void {
    this.focusSlot = slot;
    for (let i = 0; i < this.slots.length; i++) this.slots[i].tabIndex = i === slot ? 0 : -1;
    if (moveFocus) this.slots[slot]?.focus();
    this.onFocusSlot(slot);
  }

  /** Coche une pastille de palette sans redéclencher `onPick`. */
  selectSwatch(index: number): void {
    for (let i = 0; i < this.swatches.length; i++) this.swatches[i].checked = i === index;
  }

  /** Focus sur le premier emplacement encore libre — après une validation. */
  focusFirstFreeSlot(board: Board): void {
    const pegs = board.active.pegs;
    const target = Math.max(0, pegs.findIndex((p) => p === null));
    this.setFocusSlot(target, true);
  }

  /**
   * Amène le focus sur ✓ Valider quand la ligne se complète — mais SEULEMENT si
   * le focus était déjà dans le plateau, pour ne jamais le voler à un joueur en
   * train de faire autre chose (RGAA : pas de changement de contexte non demandé).
   */
  focusSubmitIfInBoard(): void {
    const active = document.activeElement;
    if (active && this.root.contains(active)) this.submitBtn.focus();
  }

  // ───────────────────────────────────────────────────────── synchronisation

  sync(board: Board, selected: number | null, dt: number): void {
    const def = this.def;
    if (!def) return;
    const y = rowY(board.activeRow, def.tries);
    const h = rowH(def.tries) - 4;

    for (let s = 0; s < this.slots.length; s++) {
      const b = this.slots[s];
      // les boutons suivent la ligne en cours
      b.style.top = `${y - h / 2}px`;
      const value = board.active.pegs[s];
      const content = value === null ? 'libre' : pegName(value);
      const label = `Essai ${board.played + 1}, emplacement ${s + 1} sur ${def.pegs} : ${content}`;
      if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
      b.disabled = board.over;
    }

    if (selected !== null && !this.swatches[selected]?.checked) this.selectSwatch(selected);
    this.refreshActions(board);

    if (this.catTimer > 0) {
      this.catTimer -= dt;
      if (this.catTimer <= 0) this.hideCat();
    }
  }

  /**
   * Met l'état des boutons d'action en phase avec le modèle. À appeler
   * SYNCHRONEMENT après chaque changement de plateau, et pas seulement depuis
   * `sync()` : `focusSubmitIfInBoard()` ne peut pas donner le focus à un bouton
   * encore `disabled`, et attendre la frame suivante faisait rater le focus —
   * la ligne se complétait, ✓ restait injoignable au clavier.
   */
  refreshActions(board: Board): void {
    const canSubmit = board.complete();
    if (canSubmit !== this.lastSubmitEnabled) {
      this.lastSubmitEnabled = canSubmit;
      this.submitBtn.disabled = !canSubmit;
    }
    const canUndo = board.canUndo && !board.over;
    if (canUndo !== this.lastUndoEnabled) {
      this.lastUndoEnabled = canUndo;
      this.undoBtn.disabled = !canUndo;
    }
  }

  // ───────────────────────────────────────────────────────── lecteurs d'écran

  /** Décrit une ligne validée en clair — le miroir textuel du plateau. */
  pushHistory(board: Board, row: number): void {
    const r = board.rows[row];
    const fb = r.feedback;
    if (!fb) return;
    const colors = r.pegs.map((p) => (p === null ? 'libre' : pegName(p))).join(', ');
    const li = document.createElement('li');
    li.textContent = `Essai ${row + 1} : ${colors} — ${describeFeedback(fb.exact, fb.misplaced)}.`;
    this.srHistory.appendChild(li);
    this.historyCount++;
  }

  resetHistory(): void {
    this.srHistory.replaceChildren();
    this.historyCount = 0;
    this.srStatus.textContent = '';
  }

  /** Nombre de lignes déjà écrites dans le miroir (garde-fou de resynchro). */
  get historyLength(): number {
    return this.historyCount;
  }

  /** Région `aria-live` polie : le retour d'un essai, annoncé sans interrompre. */
  announce(message: string): void {
    this.srStatus.textContent = message;
  }

  /**
   * Bandeau du chat, en `aria-live` ASSERTIF : le méfait change la saisie en cours
   * du joueur, le manquer avant de valider coûterait un essai.
   */
  announceCat(message: string, seconds: number): void {
    this.catEl.textContent = message;
    this.catEl.classList.add('visible');
    this.catTimer = seconds;
  }

  hideCat(): void {
    this.catEl.classList.remove('visible');
    this.catEl.textContent = '';
    this.catTimer = 0;
  }

  /** Bouton ✓, pour que les gestes tactiles puissent le viser. */
  get submitElement(): HTMLButtonElement {
    return this.submitBtn;
  }

  /** Boutons d'emplacement, pour le glisser-déposer (input/controls.ts). */
  get slotElements(): readonly HTMLButtonElement[] {
    return this.slots;
  }

  get swatchElements(): readonly HTMLInputElement[] {
    return this.swatches;
  }
}

/** Formule française de l'indice, réutilisée par l'historique et les annonces. */
export function describeFeedback(exact: number, misplaced: number): string {
  if (exact === 0 && misplaced === 0) return 'aucune couleur du code';
  const parts: string[] = [];
  if (exact > 0) parts.push(`${exact} bien placé${exact > 1 ? 's' : ''}`);
  if (misplaced > 0) parts.push(`${misplaced} mal placé${misplaced > 1 ? 's' : ''}`);
  return parts.join(', ');
}

/** Nom du symbole d'index `i` dans la palette d'une difficulté. */
export function symbolName(def: DifficultyDef, i: number): string {
  const v = symbolAt(def, i);
  return v === EMPTY_PEG ? pegName(EMPTY_PEG) : pegName(v);
}
