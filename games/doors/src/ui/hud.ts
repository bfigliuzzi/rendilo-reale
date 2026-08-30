import {
  CELL_H,
  CELL_W,
  DESIGN_W,
  ITEMS,
  LINE_CAP,
  NODE_COUNT,
  lineY,
  rowOf,
  slotX,
} from '../config/balance';
import type { Line } from '../config/rules';
import type { Action, CUnit } from '../game/combat';
import type { World } from '../game/world';
import { DOOR_TOP, DOOR_X, TELL_NAME } from '../render/doorsView';
import { DOOR_H, DOOR_W } from '../render/textures';

/**
 * L'INTERFACE DE JEU, en DOM natif superposé au canvas.
 *
 * C'est LA décision d'accessibilité du jeu, reprise de Cerveau : un canvas est
 * opaque aux technologies d'assistance, alors le canvas ne porte que le visuel
 * et l'interaction passe par de vrais `<button>` TRANSPARENTS, posés exactement
 * sur l'unité ou la porte dessinée. On récupère ainsi, sans rien réimplémenter :
 * l'ordre de tabulation, Entrée/Espace, les noms accessibles, et un anneau de
 * focus réellement visible AU-DESSUS du canvas.
 *
 * Les boutons couvrent des CASES, pas des unités : une case vide de la ligne
 * arrière est une destination légale de permutation, et sans bouton dessus le
 * repli — le geste qui « reforme le mur » — serait injouable au clavier.
 *
 * PIÈGE VÉCU AILLEURS, évité ici : `#overlay` est `pointer-events: none` et il
 * faut le rendre à `button` ET aux conteneurs qui portent des boutons, sinon la
 * zone reste parfaite au clavier et morte au doigt.
 */

/** Ce que le joueur est en train de désigner. */
export type PickMode = 'none' | 'attack' | 'ability' | 'swap';

interface Cell {
  side: 0 | 1;
  line: Line;
  slot: number;
  button: HTMLButtonElement;
}

export class Hud {
  // ── callbacks, câblés par Flow
  onAct: (action: Action) => void = () => {};
  onMenu: () => void = () => {};
  onSquad: () => void = () => {};
  onDoor: (index: number) => void = () => {};
  onReveal: () => void = () => {};
  onHelp: () => void = () => {};

  /** Désignation en cours — le rendu s'en sert pour la surbrillance. */
  pick: PickMode = 'none';

  private readonly cells: Cell[] = [];
  private readonly doorButtons: HTMLButtonElement[] = [];
  private readonly actionBar: HTMLDivElement;
  private readonly btnAttack: HTMLButtonElement;
  private readonly btnAbility: HTMLButtonElement;
  private readonly btnSwap: HTMLButtonElement;
  private readonly btnDefend: HTMLButtonElement;
  private readonly btnPhial: HTMLButtonElement;
  private readonly btnCancel: HTMLButtonElement;
  private readonly hint: HTMLParagraphElement;
  private readonly topInfo: HTMLDivElement;
  private readonly btnReveal: HTMLButtonElement;
  private readonly btnSquadRow: HTMLButtonElement;
  private readonly srLog: HTMLElement;
  private readonly srBoard: HTMLElement;

  private world: World | null = null;
  private frontCap = LINE_CAP;
  /** Derniers textes posés dans les régions live — voir `say`. */
  private lastTop = '';
  private lastHint = '';
  private lastBoard = '';

  constructor(
    private readonly root: HTMLElement,
    srLog: HTMLElement,
    srBoard: HTMLElement,
  ) {
    this.srLog = srLog;
    this.srBoard = srBoard;

    this.topInfo = document.createElement('div');
    this.topInfo.className = 'topinfo';
    this.topInfo.setAttribute('role', 'status');
    this.root.appendChild(this.topInfo);

    this.makeTopButton('⌂', 'Retour au menu', 8, () => this.onMenu());
    this.makeTopButton('?', 'Règles et bestiaire', DESIGN_W - 52, () => this.onHelp());

    // ── cases : 3 (Rang serré) + 2 côté joueur, 2 + 2 côté ennemi
    for (const side of [1, 0] as const) {
      for (const line of [0, 1] as const) {
        for (let slot = 0; slot < 3; slot++) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'cell';
          // Adressage stable pour le bot de vérification : il pilote le jeu par
          // les MÊMES boutons que le joueur, donc il n'existe pas de second
          // chemin non testé (leçon de Berceau).
          b.dataset.cell = `${side}:${line}:${slot}`;
          b.hidden = true;
          b.addEventListener('click', () => this.onCell(side, line, slot));
          b.addEventListener('focus', () => this.setHighlightCell(side, line, slot));
          b.addEventListener('pointerenter', () => this.setHighlightCell(side, line, slot));
          this.root.appendChild(b);
          this.cells.push({ side, line, slot, button: b });
        }
      }
    }

    // ── portes
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'doorbtn';
      b.dataset.door = `${i}`;
      b.hidden = true;
      b.addEventListener('click', () => this.onDoor(i));
      b.addEventListener('focus', () => this.setDoorHighlight(i));
      b.addEventListener('pointerenter', () => this.setDoorHighlight(i));
      b.addEventListener('blur', () => this.setDoorHighlight(-1));
      b.addEventListener('pointerleave', () => this.setDoorHighlight(-1));
      this.root.appendChild(b);
      this.doorButtons.push(b);
    }

    this.btnReveal = document.createElement('button');
    this.btnReveal.type = 'button';
    this.btnReveal.className = 'action wide';
    this.btnReveal.dataset.act = 'reveal';
    this.btnReveal.style.cssText = 'left:24px;top:496px;width:238px;height:56px;';
    this.btnReveal.addEventListener('click', () => this.onReveal());
    this.btnReveal.hidden = true;
    this.root.appendChild(this.btnReveal);

    this.btnSquadRow = document.createElement('button');
    this.btnSquadRow.type = 'button';
    this.btnSquadRow.className = 'action wide';
    this.btnSquadRow.dataset.act = 'squad';
    this.btnSquadRow.textContent = '👥 Escouade';
    this.btnSquadRow.style.cssText = 'left:278px;top:496px;width:238px;height:56px;';
    this.btnSquadRow.addEventListener('click', () => this.onSquad());
    this.btnSquadRow.hidden = true;
    this.root.appendChild(this.btnSquadRow);

    // ── barre d'action de combat
    this.actionBar = document.createElement('div');
    this.actionBar.className = 'actionbar';
    this.actionBar.setAttribute('role', 'group');
    this.actionBar.setAttribute('aria-label', 'Actions du tour');
    // Ancre de repli focalisable : voir `restoreFocus`. Elle n'est jamais dans
    // l'ordre de tabulation (tabindex négatif), on ne l'atteint que par script.
    this.actionBar.tabIndex = -1;
    this.actionBar.hidden = true;
    this.root.appendChild(this.actionBar);

    this.btnAttack = this.makeAction('⚔ Attaquer', 'primary', () => this.startPick('attack'), 'attack');
    this.btnAbility = this.makeAction('✦ Capacité', '', () => this.startPick('ability'), 'ability');
    this.btnSwap = this.makeAction('⇅ Permuter', '', () => this.startPick('swap'), 'swap');
    this.btnDefend = this.makeAction('🛡 Défendre', '', () => this.commit({ kind: 'defend' }), 'defend');
    this.btnPhial = this.makeAction('🧪 Fiole', '', () => this.commit({ kind: 'phial' }), 'phial');
    this.btnCancel = this.makeAction('↩ Annuler', 'ghost', () => this.cancelPick(), 'cancel');

    this.hint = document.createElement('p');
    this.hint.className = 'hint';
    this.hint.setAttribute('role', 'status');
    this.root.appendChild(this.hint);

    // Échap annule une désignation où que soit le focus dans le jeu.
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.pick !== 'none') {
        e.preventDefault();
        this.cancelPick();
      }
    });
  }

  private makeTopButton(glyph: string, label: string, left: number, onClick: () => void): void {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'topbtn';
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
    b.style.cssText = `left:${left}px;top:8px;`;
    b.addEventListener('click', onClick);
    this.root.appendChild(b);
  }

  private makeAction(label: string, extra: string, onClick: () => void, act = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    if (act) b.dataset.act = act;
    b.className = `action${extra ? ` ${extra}` : ''}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    this.actionBar.appendChild(b);
    return b;
  }

  /** Letterbox : l'overlay subit EXACTEMENT la transformation du canvas. */
  layout(scale: number): void {
    this.root.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  bind(world: World): void {
    this.world = world;
  }

  /**
   * Place le focus sur le premier contrôle de jeu disponible. Appelée quand un
   * panneau vient de se fermer EN AYANT le focus : c'est le pendant du saut
   * automatique sur la cible, pour les transitions de salle.
   */
  focusFirst(): void {
    const first = [
      ...this.doorButtons,
      this.btnAttack,
      this.btnAbility,
      this.btnSwap,
      this.btnDefend,
      this.btnPhial,
      this.btnCancel,
      this.btnSquadRow,
    ].find((b) => !b.disabled && !b.hidden);
    first?.focus();
  }

  /** Une phrase de journal, annoncée aux lecteurs d'écran. */
  log(text: string): void {
    this.srLog.textContent = text;
  }

  // ─────────────────────────────────────────────── état

  private setHighlightCell(side: 0 | 1, line: Line, slot: number): void {
    const c = this.world?.run?.combat;
    if (!c) return;
    const u = c.alive(side).find((x) => x.line === line && x.slot === slot);
    this.world!.battle.highlight = u?.uid ?? 0;
  }

  private setDoorHighlight(i: number): void {
    if (this.world) this.world.doors.highlight = i;
  }

  private startPick(mode: PickMode): void {
    const c = this.world?.run?.combat;
    const u = c?.current();
    // La garde `busy` vit AUSSI ici, pas seulement dans l'état `disabled` des
    // boutons : l'état visuel est un reflet, jamais la règle.
    if (!c || !u || u.side !== 0 || this.world?.busy) return;
    // Second souffle n'a pas de cible : le faire désigner serait un clic pour rien.
    if (mode === 'ability' && u.ability === 'secondWind') {
      this.commit({ kind: 'ability' });
      return;
    }
    this.pick = mode;
    this.refresh();
    // Le focus SAUTE sur la première cible légale : sans ça, un joueur au
    // clavier devrait retraverser toute la barre d'action à chaque coup.
    const first = this.cells.find((cell) => !cell.button.hidden && !cell.button.disabled);
    first?.button.focus();
  }

  private cancelPick(): void {
    this.pick = 'none';
    this.refresh();
    // `focusFirst` et non `btnAttack` : une unité sans cible légale a son bouton
    // Attaquer désactivé, et `focus()` sur un bouton désactivé ne fait RIEN —
    // le focus resterait sur la case qu'on vient de désactiver, donc nulle part.
    this.focusFirst();
  }

  private commit(action: Action): void {
    this.pick = 'none';
    this.onAct(action);
  }

  private onCell(side: 0 | 1, line: Line, slot: number): void {
    const c = this.world?.run?.combat;
    const u = c?.current();
    if (!c || !u) return;
    const occupant = c.alive(side).find((x) => x.line === line && x.slot === slot);

    switch (this.pick) {
      case 'attack':
        if (occupant) this.commit({ kind: 'attack', target: occupant.uid });
        break;
      case 'ability':
        if (!occupant) return;
        // La Salve runique vise une LIGNE : on la désigne en touchant n'importe
        // quelle unité de cette ligne — un sélecteur de ligne séparé serait un
        // concept de plus pour zéro information supplémentaire.
        if (u.ability === 'runicVolley') this.commit({ kind: 'ability', line: occupant.line });
        else this.commit({ kind: 'ability', target: occupant.uid });
        break;
      case 'swap':
        this.commit({ kind: 'swap', line, slot });
        break;
      default:
        // hors désignation, toucher une unité l'INSPECTE — le seul moyen de
        // relire une capacité en cours de combat
        if (occupant) this.log(describe(occupant, c));
    }
  }

  // ─────────────────────────────────────────────── rendu du HUD

  /**
   * Reconstruit l'état des boutons. DOIT être appelée SYNCHRONEMENT à chaque
   * changement d'état : on ne peut pas donner le focus à un bouton encore
   * `disabled`, et attendre la frame de rendu ferait rater le saut sur la cible.
   */
  refresh(): void {
    // Qui a le focus AVANT qu'on ne rebatte les états `disabled` ? On ne rendra
    // le focus que s'il était à nous : voler le focus à un joueur qui joue au
    // doigt serait pire que de le perdre.
    const prev = document.activeElement as HTMLElement | null;
    const wasOurs = !!prev && this.root.contains(prev);
    const world = this.world;
    const run = world?.run ?? null;
    const combat = run?.combat ?? null;
    this.frontCap = run?.meta.frontCap ?? LINE_CAP;

    const inCombat = world?.mode === 'combat' && !!combat;
    const inDoors = world?.mode === 'doors' && !!run;
    this.root.hidden = !inCombat && !inDoors;
    this.hint.hidden = !inCombat && !inDoors;
    this.actionBar.hidden = !inCombat;
    for (const b of this.doorButtons) b.hidden = !inDoors;
    this.btnReveal.hidden = !inDoors;
    this.btnSquadRow.hidden = !inDoors;
    if (!run) {
      for (const cell of this.cells) cell.button.hidden = true;
      return;
    }

    this.setTop(
      inDoors
        ? `Nœud ${run.node} · ${run.gold} or · ${run.squad.aliveMembers().length}/${run.squad.members.length} debout`
        : `${run.gold} or · manche ${combat?.round ?? 1}`,
    );

    if (inDoors) {
      this.refreshDoors(run);
      this.setHint(
        run.node > NODE_COUNT
          ? 'Le Geôlier t’attend. Aucune autre porte.'
          : 'Franchir une porte ferme les deux autres. Aucun retour en arrière.',
      );
    }
    if (inCombat && combat) this.refreshCombat(combat);
    else for (const cell of this.cells) cell.button.hidden = true;
    this.restoreFocus(prev, wasOurs);
  }

  /**
   * Rend le focus quand le contrôle qui l'avait vient d'être désactivé ou caché.
   *
   * C'est le trou classique de ce genre d'interface : le joueur valide une cible,
   * le bouton de cette case passe `disabled` dans la foulée, et le navigateur
   * renvoie le focus sur `<body>` — un joueur au clavier est alors perdu au
   * milieu du combat, sans rien à l'écran qui l'indique. Attrapé par le scénario
   * `keyboard` du bot (`finalFocus: BODY`), invisible à tout test au doigt.
   *
   * L'ancre est, dans l'ordre : le premier bouton d'action encore actif, sinon
   * le conteneur de la barre d'action (focalisable mais hors tabulation), sinon
   * rien — on ne déplace jamais un focus qui n'était pas à nous.
   */
  private restoreFocus(prev: HTMLElement | null, wasOurs: boolean): void {
    if (!wasOurs || !prev) return;
    const dead = (prev as HTMLButtonElement).disabled === true || prev.hidden || !prev.isConnected;
    const onAnchor = prev === this.actionBar;
    if (!dead && !onAnchor) return;

    // Les portes comptent comme ancres : quand un combat se termine sans ouvrir
    // de panneau, l'écran bascule sur les portes et la barre d'action disparaît
    // — sans elles, le focus retomberait sur `<body>` juste après la victoire.
    const first = [
      this.btnAttack,
      this.btnAbility,
      this.btnSwap,
      this.btnDefend,
      this.btnPhial,
      this.btnCancel,
      ...this.doorButtons,
      this.btnSquadRow,
    ].find((b) => !b.disabled && !b.hidden);
    // Depuis l'ancre, on ne saute sur un bouton QUE s'il vient de se rouvrir :
    // le tour de l'adversaire ne doit pas faire sautiller le focus.
    if (onAnchor && !first) return;
    if (first) first.focus();
    else if (!this.actionBar.hidden) this.actionBar.focus();
  }

  private refreshDoors(run: NonNullable<World['run']>): void {
    const solo = run.doors.length === 1;
    for (let i = 0; i < 3; i++) {
      const b = this.doorButtons[i];
      const door = run.doors[i];
      if (!door) {
        b.hidden = true;
        continue;
      }
      const scale = solo ? 1.3 : 1;
      const x = solo ? DESIGN_W / 2 : DOOR_X[i];
      const w = DOOR_W * scale + 16;
      const h = DOOR_H * scale + 20;
      b.hidden = false;
      b.style.cssText = `left:${x - w / 2}px;top:${DOOR_TOP - 10}px;width:${w}px;height:${h}px;`;
      const shown = door.tell === 'veiled' && door.revealed ? door.real : door.tell;
      const name = door.tell === 'veiled' && !door.revealed ? TELL_NAME.veiled : TELL_NAME[shown];
      b.setAttribute(
        'aria-label',
        door.tell === 'veiled' && !door.revealed
          ? `Porte ${i + 1} : porte voilée. Contenu inconnu, butin majoré de 50 pour cent.`
          : `Porte ${i + 1} : ${name}.${door.bonus > 1 ? ' Butin majoré de 50 pour cent.' : ''}`,
      );
      b.textContent = name;
    }
    const veiled = run.doors.some((d) => d.tell === 'veiled' && !d.revealed);
    this.btnReveal.hidden = false;
    this.btnReveal.disabled = run.veiledRevealsLeft <= 0 || !veiled;
    this.btnReveal.textContent = `👁 Révéler (${run.veiledRevealsLeft})`;
    this.btnReveal.setAttribute(
      'aria-label',
      run.veiledRevealsLeft > 0 && veiled
        ? 'Révéler la porte voilée de ce nœud. Un usage par run.'
        : 'Révélation indisponible',
    );
    this.btnSquadRow.setAttribute(
      'aria-label',
      `Escouade : ${run.squad.members.length} unité${run.squad.members.length > 1 ? 's' : ''}. Réorganiser les lignes et les objets.`,
    );
  }

  private refreshCombat(combat: NonNullable<World['run']>['combat']): void {
    if (!combat) return;
    const world = this.world!;
    const active = combat.current();
    const mine = active?.side === 0;
    const idle = this.pick === 'none';
    const locked = world.busy || !mine;

    const targets = active ? combat.legalTargets(active.uid) : [];
    const swaps = active ? combat.legalSwaps(active.uid) : [];
    const abilityTargets: CUnit[] =
      active && this.pick === 'ability'
        ? active.ability === 'brew'
          ? combat.alive(0)
          : active.ability === 'runicVolley'
            ? combat.alive(1)
            : []
        : [];

    // ── surbrillance : le rendu lit ces deux listes, il ne les calcule pas
    world.battle.targets =
      this.pick === 'attack' ? targets.map((t) => t.uid) : this.pick === 'ability' ? abilityTargets.map((t) => t.uid) : [];
    world.battle.swapSlots = this.pick === 'swap' ? swaps.map((s) => `${s.line}:${s.slot}`) : [];

    // ── cases
    for (const cell of this.cells) {
      const cap = cell.side === 0 && cell.line === 0 ? this.frontCap : LINE_CAP;
      if (cell.slot >= cap) {
        cell.button.hidden = true;
        continue;
      }
      const occupant = combat.alive(cell.side).find((u) => u.line === cell.line && u.slot === cell.slot);
      const x = slotX(cell.slot, cap);
      const y = lineY(rowOf(cell.side, cell.line));
      cell.button.hidden = false;
      cell.button.style.cssText = `left:${x - (CELL_W - 8) / 2}px;top:${y - (CELL_H - 6) / 2}px;width:${CELL_W - 8}px;height:${CELL_H - 6}px;`;

      let enabled = false;
      if (!locked) {
        if (this.pick === 'attack') enabled = !!occupant && targets.some((t) => t.uid === occupant.uid);
        else if (this.pick === 'ability') enabled = !!occupant && abilityTargets.some((t) => t.uid === occupant.uid);
        else if (this.pick === 'swap') enabled = swaps.some((s) => cell.side === 0 && s.line === cell.line && s.slot === cell.slot);
        else enabled = !!occupant; // inspection libre
      }
      cell.button.disabled = !enabled;
      cell.button.setAttribute('aria-label', this.cellLabel(cell, occupant, combat));
      cell.button.textContent = occupant ? occupant.name : '';
    }

    // ── actions
    // `abilityIsActive` couvre aussi les capacités d'IA (Litanie, Frappe large) :
    // le bouton ne s'affiche que pour celles que le JOUEUR peut déclencher.
    const playerAbility =
      active?.ability === 'secondWind' || active?.ability === 'brew' || active?.ability === 'runicVolley';
    const canAbility = !!active && playerAbility && combat.canUseAbility(active.uid);
    this.btnAttack.disabled = locked || !idle || targets.length === 0;
    this.btnAbility.disabled = locked || !idle || !canAbility;
    this.btnSwap.disabled = locked || !idle || swaps.length === 0;
    this.btnDefend.disabled = locked || !idle;
    const phials = this.world?.run?.phials ?? 0;
    const roomAtFront = !!active && combat.freeFrontSlot(0) !== null;
    this.btnPhial.hidden = idle ? phials === 0 : true;
    this.btnPhial.disabled = locked || !idle || phials === 0 || !roomAtFront;
    this.btnPhial.textContent = `🧪 Fiole (${phials})`;
    this.btnPhial.setAttribute(
      'aria-label',
      roomAtFront
        ? `Briser une fiole d’écho : invoque un spectre au front pour deux tours. Il t’en reste ${phials}. Consomme le tour.`
        : 'Fiole d’écho indisponible : aucune place libre à ta ligne avant.',
    );
    this.btnCancel.hidden = idle;
    this.btnCancel.disabled = idle;
    this.btnAttack.hidden = !idle;
    this.btnAbility.hidden = !idle;
    this.btnSwap.hidden = !idle;
    this.btnDefend.hidden = !idle;

    this.btnAbility.textContent = active ? `✦ ${abilityLabel(active)}` : '✦ Capacité';
    this.btnAbility.setAttribute(
      'aria-label',
      active && playerAbility
        ? `${abilityLabel(active)} — ${abilityHelp(active)}${combat.canUseAbility(active.uid) ? '' : ' (indisponible)'}`
        : 'Aucune capacité active',
    );
    this.btnSwap.setAttribute(
      'aria-label',
      'Permuter — change de ligne. Consomme le tour entier, sauf avec les Bottes lestées.',
    );

    this.setHint(this.hintText(combat, active, mine));
    // Le résumé de plateau est lui aussi une région live : même garde.
    const board = boardSummary(combat);
    if (board !== this.lastBoard) {
      this.lastBoard = board;
      this.srBoard.textContent = board;
    }
  }

  /**
   * `#topinfo` et `.hint` sont des régions `role="status"`, donc annoncées à
   * chaque MUTATION. `refresh()` étant appelée à chaque changement d'état — y
   * compris quand rien d'affiché ne bouge — réécrire aveuglément ferait répéter
   * « 25 or, manche 3 » toutes les demi-secondes au lecteur d'écran. On
   * n'écrit donc que sur changement réel (même règle que les `Text` du canvas).
   */
  private setTop(text: string): void {
    if (text === this.lastTop) return;
    this.lastTop = text;
    this.topInfo.textContent = text;
  }

  private setHint(text: string): void {
    if (text === this.lastHint) return;
    this.lastHint = text;
    this.hint.textContent = text;
  }

  private cellLabel(cell: Cell, occupant: CUnit | undefined, combat: NonNullable<World['run']>['combat']): string {
    if (!combat) return '';
    const side = cell.side === 0 ? 'ton camp' : 'l’ennemi';
    const line = cell.line === 0 ? 'ligne avant' : 'ligne arrière';
    if (!occupant) return `Emplacement libre, ${line} de ${side}`;
    return `${occupant.name}, ${line} de ${side}. ${describe(occupant, combat)}`;
  }

  private hintText(combat: NonNullable<World['run']>['combat'], active: CUnit | null, mine: boolean): string {
    if (!combat) return '';
    // Pendant le rejeu des événements, TOUT est désactivé : le dire explicitement
    // évite qu'un joueur croie à un bouton cassé.
    if (this.world?.busy) return 'Résolution du coup…';
    if (this.pick === 'attack') return 'Choisis une cible.';
    if (this.pick === 'swap') return 'Choisis l’emplacement où te placer.';
    if (this.pick === 'ability' && active?.ability === 'runicVolley') return 'Choisis une unité de la ligne à frapper.';
    if (this.pick === 'ability') return 'Choisis un allié.';
    if (!active) return '';
    if (!mine) return `Au tour de ${active.name}…`;
    const front = combat.frontLine(1);
    return `À toi, ${active.name}. ${active.reach === 'melee' ? `Au contact : seule la ligne ${front === 0 ? 'avant' : 'arrière'} ennemie est atteignable.` : 'À distance : toutes les cibles sont atteignables.'}`;
  }
}

/** Une unité en toutes lettres — c'est ce que lit un lecteur d'écran. */
export function describe(u: CUnit, combat: NonNullable<World['run']>['combat']): string {
  if (!combat) return u.name;
  const bits = [
    `${u.hp} PV sur ${u.maxHp}`,
    `${combat.atkOf(u)} attaque`,
    `${combat.initOf(u)} initiative`,
    u.reach === 'melee' ? 'au contact' : 'à distance',
  ];
  if (u.armor > 0) bits.push(`${u.armor} d’armure`);
  if (u.defending) bits.push('en garde');
  if (u.item) bits.push(`porte ${ITEMS[u.item].name}`);
  return bits.join(', ') + '.';
}

function abilityLabel(u: CUnit): string {
  switch (u.ability) {
    case 'secondWind': return 'Second souffle';
    case 'brew': return 'Décoction';
    case 'runicVolley': return 'Salve runique';
    default: return 'Capacité';
  }
}

function abilityHelp(u: CUnit): string {
  switch (u.ability) {
    case 'secondWind': return 'récupère 6 PV au lieu d’agir, une fois par combat';
    case 'brew': return 'rend 7 PV à un allié';
    case 'runicVolley': return '4 dégâts à toute une ligne ennemie, recharge 2 tours';
    default: return '';
  }
}

/**
 * Le plateau en texte. Le canvas est `aria-hidden` : c'est CE résumé qui rend
 * la partie réellement jouable sans voir l'écran, et il se relit à volonté
 * puisqu'il vit dans une région `aria-live="polite"` atomique.
 */
export function boardSummary(combat: NonNullable<World['run']>['combat']): string {
  if (!combat) return '';
  const say = (side: 0 | 1, line: Line): string => {
    const list = combat.lineUnits(side, line);
    if (list.length === 0) return 'vide';
    return list.map((u) => `${u.name} ${u.hp} sur ${u.maxHp} PV`).join(', ');
  };
  return [
    `Ton front : ${say(0, 0)}.`,
    `Ton arrière : ${say(0, 1)}.`,
    `Front ennemi : ${say(1, 0)}.`,
    `Arrière ennemi : ${say(1, 1)}.`,
  ].join(' ');
}
