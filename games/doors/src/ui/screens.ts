import type { ItemId, Line } from '../config/rules';
import type { MetaId } from '../meta/tree';

/**
 * Écrans DOM plein cadre : accueil, aide, arbre de méta, succès, et LES SALLES
 * qui ne sont pas des combats (recrutement, trésor, marchand, escouade).
 *
 * Pourquoi les salles ici plutôt que sur le canvas : ce sont des listes de
 * choix chiffrés, et une liste de choix est exactement ce que le DOM fait bien.
 * On récupère la tabulation, les libellés, les états `disabled` qui EXPLIQUENT
 * pourquoi (« 30 or, il t'en manque 12 »), et le défilement natif sur un petit
 * écran. Le canvas ne saurait rien faire de tout ça sans réimplémenter un
 * navigateur.
 *
 * UN SEUL écouteur de clic délégué sur la racine, plus un `change` pour les
 * cases à cocher. Chaque `show*` REPLACE le focus sur le titre du panneau
 * (`tabindex="-1"`) : remplacer `innerHTML` détruit l'élément focalisé et
 * renverrait sinon le focus sur `<body>` (RGAA 7.x / WCAG 2.4.3).
 *
 * Screens ne lit JAMAIS le save ni le modèle : Flow lui passe des vues déjà
 * calculées. C'est ce qui garde les écrans testables et le save à une seule
 * source d'écriture.
 */

export interface HeroCard {
  id: string;
  name: string;
  sprite: string;
  stats: string;
  blurb: string;
  locked: boolean;
}

export interface HomeView {
  heroes: readonly HeroCard[];
  shards: number;
  bestNodes: number;
  bestWinSec: number;
  runs: number;
  wins: number;
  muted: boolean;
  reducedMotion: boolean;
  systemReducedMotion: boolean;
  /** Nœuds de méta encore abordables — pastille sur le bouton de l'arbre. */
  affordable: number;
}

export interface TreeCard {
  id: MetaId;
  name: string;
  icon: string;
  cost: number;
  effect: string;
  why: string;
  owned: boolean;
  affordable: boolean;
}

export interface UnitCard {
  name: string;
  sprite: string;
  stats: string;
  blurb: string;
}

export interface MemberRow {
  id: number;
  name: string;
  sprite: string;
  line: Line;
  slot: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  item: ItemId | null;
  itemName: string;
  /** Une invocation ne se soigne ni ne se ressuscite. */
  summon: boolean;
}

export interface RecruitView {
  card: UnitCard;
  gold: number;
  squad: readonly MemberRow[];
  /** `true` si l'escouade est pleine : il faudra renvoyer quelqu'un. */
  full: boolean;
}

export interface TreasureView {
  card: UnitCard;
  kind: 'item' | 'statue' | 'phial';
  gold: number;
  squad: readonly MemberRow[];
  full: boolean;
}

export interface ShopOffer {
  item: ItemId;
  name: string;
  sprite: string;
  effect: string;
  price: number;
  sold: boolean;
  affordable: boolean;
}

export interface ShopView {
  gold: number;
  offers: readonly ShopOffer[];
  squad: readonly MemberRow[];
  reviveCost: number;
  freeRevives: number;
  healPerHp: number;
  /** Soin acheté par palier — le pas proposé aux boutons. */
  healStep: number;
}

export interface SquadView {
  squad: readonly MemberRow[];
  stash: readonly { item: ItemId; name: string; sprite: string; effect: string }[];
  frontCap: number;
  backCap: number;
  /** Titre et bouton de sortie adaptés à la salle d'où l'on vient. */
  closeLabel: string;
}

export interface ResultView {
  victory: boolean;
  node: number;
  shards: number;
  shardsTotal: number;
  timeSec: number;
  lines: readonly string[];
  freshFeats: readonly { icon: string; name: string }[];
  record: boolean;
}

export interface AchEntry {
  icon: string;
  name: string;
  desc: string;
  tier: number;
  value: number;
  target: number;
}

export interface FeatEntry {
  icon: string;
  name: string;
  desc: string;
  unlocked: boolean;
  hard: boolean;
}

function fmtTime(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

export class Screens {
  onStart: (hero: string) => void = () => {};
  onHome: () => void = () => {};
  onHelp: () => void = () => {};
  onTree: () => void = () => {};
  onAchievements: () => void = () => {};
  onBuyMeta: (id: MetaId) => void = () => {};
  onToggle: (key: 'muted' | 'reducedMotion', value: boolean) => void = () => {};
  onResetProgress: () => void = () => {};

  onAccept: () => void = () => {};
  onRefuse: () => void = () => {};
  onDismiss: (memberId: number) => void = () => {};
  onShopBuy: (kind: 'item' | 'revive' | 'heal', arg: string) => void = () => {};
  onLeaveRoom: () => void = () => {};
  onOpenSquad: () => void = () => {};
  onSwapSlots: (a: { line: Line; slot: number }, b: { line: Line; slot: number }) => void = () => {};
  onEquip: (memberId: number, item: ItemId) => void = () => {};
  onUnequip: (memberId: number) => void = () => {};
  onReplay: () => void = () => {};

  /** Vignettes de sprite, injectées par le boot (data: URL). */
  sprites: Readonly<Record<string, string>> = {};

  private confirmingReset = false;
  private currentScreen = '';
  /** Emplacement sélectionné dans la grille de formation, ou `null`. */
  private picked: { line: Line; slot: number } | null = null;

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => this.onChange(e));
  }

  /**
   * Ferme le panneau courant. Renvoie `true` s'il PORTAIT le focus : détruire
   * son contenu renvoie alors le focus sur `<body>`, et l'appelant doit le
   * replacer sur l'écran de jeu. Sans ce retour, un joueur au clavier se
   * retrouvait sans focus à chaque sortie de salle — perdu, et sans rien à
   * l'écran pour le lui dire.
   */
  hide(): boolean {
    const hadFocus = this.root.contains(document.activeElement);
    this.root.classList.remove('visible');
    this.root.replaceChildren();
    this.currentScreen = '';
    this.picked = null;
    return hadFocus;
  }

  private img(sprite: string, size = 56): string {
    const src = this.sprites[sprite];
    return src ? `<img class="pix" src="${src}" width="${size}" height="${size}" alt="">` : '';
  }

  // ─────────────────────────────────────────────── accueil

  showHome(v: HomeView): void {
    const heroes = v.heroes
      .map((h) =>
        h.locked
          ? `<button class="card" type="button" disabled
                 aria-label="${h.name} — verrouillé. Débloque « Sœur d’armes » dans l’arbre des éclats.">
              <span class="card-pix" aria-hidden="true">🔒</span>
              <span class="card-body"><span class="card-name">${h.name}</span>
                <span class="card-sub">Verrouillé — nœud « Sœur d’armes »</span></span>
            </button>`
          : `<button class="card" type="button" data-action="start" data-hero="${h.id}"
                 aria-label="Partir avec ${h.name}. ${h.stats}. ${h.blurb}">
              <span class="card-pix" aria-hidden="true">${this.img(h.sprite)}</span>
              <span class="card-body"><span class="card-name">${h.name}</span>
                <span class="card-sub">${h.stats}</span>
                <span class="card-sub">${h.blurb}</span></span>
            </button>`,
      )
      .join('');

    const record =
      v.bestNodes > 0
        ? `<p class="sub">Record : ${v.bestNodes > 9 ? 'boss atteint' : `${v.bestNodes} nœud${v.bestNodes > 1 ? 's' : ''}`}${
            v.bestWinSec > 0 ? ` · meilleure victoire en ${fmtTime(v.bestWinSec)}` : ''
          }</p>`
        : '<p class="sub">Une run dure six à huit minutes. Tu commences seul.</p>';

    const rmChecked = v.reducedMotion || v.systemReducedMotion;
    this.show(
      `<div class="panel">
        <h1 tabindex="-1">TROIS<br>PORTES</h1>
        <p class="sub">Porte · Monstre · Trésor</p>
        ${record}
        <p class="shards">💎 ${v.shards} éclat${v.shards > 1 ? 's' : ''}</p>
        <div class="col">${heroes}</div>
        <div class="row2">
          <button class="btn" type="button" data-action="tree">🌳 Arbre${v.affordable > 0 ? ` <span class="dot">${v.affordable}</span>` : ''}</button>
          <button class="btn" type="button" data-action="ach">🏅 Succès</button>
        </div>
        <button class="btn small" type="button" data-action="help">Comment jouer</button>
        <div class="opt">
          <input type="checkbox" id="opt-rm" data-toggle="reducedMotion"${rmChecked ? ' checked' : ''}${v.systemReducedMotion ? ' disabled' : ''}>
          <label for="opt-rm">Réduire les animations
            <span class="opt-hint">${
              v.systemReducedMotion
                ? 'Activé par votre système — les effets sont déjà atténués.'
                : 'Moins de particules, résolution des tours accélérée.'
            }</span>
          </label>
        </div>
        <div class="opt">
          <input type="checkbox" id="opt-sound" data-toggle="muted"${v.muted ? '' : ' checked'}>
          <label for="opt-sound">Sons</label>
        </div>
        ${this.resetBlock()}
        <a class="hub-link" href="/">← Tous les jeux</a>
      </div>`,
      'home',
    );
  }

  showHelp(bestiary: readonly UnitCard[], classes: readonly UnitCard[]): void {
    const list = (cards: readonly UnitCard[]): string =>
      cards
        .map(
          (c) => `<div class="card static">
            <span class="card-pix" aria-hidden="true">${this.img(c.sprite, 48)}</span>
            <span class="card-body"><span class="card-name">${c.name}</span>
              <span class="card-sub">${c.stats}</span>
              <span class="card-sub">${c.blurb}</span></span>
          </div>`,
        )
        .join('');

    this.show(
      `<div class="panel wide">
        <h2 tabindex="-1">Comment jouer</h2>
        <p class="rules">
          Neuf nœuds, puis le boss. À chaque nœud, <strong>trois portes</strong> : l’icône dit
          la catégorie, rien de plus. En franchir une ferme les deux autres.<br><br>
          <strong>La règle de ligne.</strong> Une attaque <em>au contact</em> ne peut viser que la
          ligne avant adverse. Si cette ligne est vide, la ligne arrière devient la ligne avant.
          Une attaque <em>à distance</em> vise n’importe qui.<br><br>
          <strong>Le tour.</strong> Tout le monde est trié par initiative décroissante, et l’ordre
          est affiché. À son tour, une unité <em>attaque</em>, utilise sa <em>capacité</em>,
          <em>permute</em> (change de ligne — cela consomme le tour entier) ou <em>défend</em>
          (−3 dégâts subis jusqu’à son prochain tour).<br><br>
          <strong>Aucun hasard dans les dégâts.</strong> Pas de jet de toucher, pas de variance :
          tu peux compter ton létal. Le hasard est dans les portes, pas dans les coups.<br><br>
          <strong>Les PV ne remontent jamais tout seuls.</strong> Les morts restent morts jusqu’à
          une résurrection payée au marchand. Soigner, ressusciter et s’équiper puisent dans la
          même bourse : c’est là toute la tension.<br><br>
          <strong>Cap dur à 4 unités.</strong> Recruter à 4/4 oblige à renvoyer quelqu’un,
          définitivement et sans remboursement.
        </p>
        <h2>Au clavier</h2>
        <p class="rules">
          <kbd>Tab</kbd> passe d’un contrôle à l’autre, <kbd>Entrée</kbd> ou <kbd>Espace</kbd>
          valide.<br>
          <kbd>Échap</kbd> annule une désignation de cible en cours.<br>
          Après « Attaquer », le focus saute tout seul sur la première cible légale.
        </p>
        <h2>Tes classes</h2>
        <div class="col">${list(classes)}</div>
        <h2>Le bestiaire</h2>
        <div class="col">${list(bestiary)}</div>
        <button class="btn primary" type="button" data-action="home">Retour</button>
      </div>`,
      'help',
    );
  }

  showTree(cards: readonly TreeCard[], shards: number): void {
    const list = cards
      .map(
        (c) => `<div class="ach${c.owned ? ' owned' : ''}">
          <div class="ach-head"><span aria-hidden="true">${c.icon}</span><strong>${c.name}</strong>
            <span class="ach-tier">${c.owned ? 'acquis' : `💎 ${c.cost}`}</span></div>
          <div class="ach-desc">${c.effect}</div>
          <div class="ach-why">${c.why}</div>
          ${
            c.owned
              ? '<p class="owned-line">✓ Actif dans toutes tes runs.</p>'
              : `<button class="btn small${c.affordable ? ' primary' : ''}" type="button"
                     data-action="buy-meta" data-meta="${c.id}"${c.affordable ? '' : ' disabled'}
                     aria-label="Acheter ${c.name} pour ${c.cost} éclats.${c.affordable ? '' : ` Il t’en manque ${c.cost - shards}.`}">
                   ${c.affordable ? `Acheter — 💎 ${c.cost}` : `Il manque ${c.cost - shards} 💎`}
                 </button>`
          }
        </div>`,
      )
      .join('');

    this.show(
      `<div class="panel">
        <h2 tabindex="-1">🌳 Arbre des éclats</h2>
        <p class="shards">💎 ${shards} éclat${shards > 1 ? 's' : ''}</p>
        <p class="sub">Aucun de ces cinq nœuds n’est un bonus chiffré : chacun ouvre une option
          ou change une règle.</p>
        <div class="ach-list">${list}</div>
        <button class="btn primary" type="button" data-action="home">Retour</button>
      </div>`,
      'tree',
    );
  }

  showAchievements(ach: readonly AchEntry[], feats: readonly FeatEntry[]): void {
    const list = ach
      .map((a) => {
        const pct = Math.min(100, Math.round((a.value / a.target) * 100));
        return `<div class="ach">
          <div class="ach-head"><span aria-hidden="true">${a.icon}</span><strong>${a.name}</strong>
            <span class="ach-tier">palier ${a.tier + 1}</span></div>
          <div class="ach-desc">${a.desc}</div>
          <div class="bar" role="progressbar" aria-label="${a.name}, palier ${a.tier + 1}"
               aria-valuemin="0" aria-valuemax="${a.target}" aria-valuenow="${a.value}"
               aria-valuetext="${a.value} sur ${a.target}">
            <div class="bar-fill" style="width:${pct}%"></div>
          </div>
        </div>`;
      })
      .join('');

    const featList = feats
      .map(
        (f) => `<div class="feat${f.unlocked ? '' : ' locked'}${f.hard ? ' hard' : ''}">
          <span class="feat-icon" aria-hidden="true">${f.unlocked ? f.icon : '🔒'}</span>
          <span class="feat-body">
            <span class="feat-name">${f.name}${f.hard ? ' <span class="feat-hard">★ légende</span>' : ''}</span>
            <span class="feat-desc">${f.desc}</span>
          </span>
        </div>`,
      )
      .join('');

    this.show(
      `<div class="panel">
        <h2 tabindex="-1">🏅 Succès</h2>
        <p class="sub">Les paliers n’ont pas de fin et ne rapportent aucun éclat : c’est une
          trace, pas un raccourci vers l’arbre.</p>
        <div class="ach-list">${list}</div>
        <h2>Hauts faits</h2>
        <div class="feats">${featList}</div>
        <button class="btn primary" type="button" data-action="home">Retour</button>
      </div>`,
      'ach',
    );
  }

  // ─────────────────────────────────────────────── salles

  showRecruit(v: RecruitView): void {
    const dismiss = v.full ? this.dismissBlock(v.squad, 'Ton escouade est pleine (4 / 4).') : '';
    this.show(
      `<div class="panel">
        <h2 tabindex="-1">Une recrue se propose</h2>
        <div class="card static big">
          <span class="card-pix" aria-hidden="true">${this.img(v.card.sprite, 72)}</span>
          <span class="card-body"><span class="card-name">${v.card.name}</span>
            <span class="card-sub">${v.card.stats}</span>
            <span class="card-sub">${v.card.blurb}</span></span>
        </div>
        ${dismiss}
        ${
          v.full
            ? '<p class="warn">Renvoyer est DÉFINITIF et ne rembourse rien.</p>'
            : `<button class="btn primary" type="button" data-action="accept">Recruter ${v.card.name}</button>`
        }
        <button class="btn" type="button" data-action="refuse">Passer son chemin</button>
        <p class="sub">💰 ${v.gold} or</p>
      </div>`,
      'recruit',
    );
  }

  showTreasure(v: TreasureView): void {
    const needsSlot = v.kind === 'statue' && v.full;
    this.show(
      `<div class="panel">
        <h2 tabindex="-1">${v.kind === 'item' ? 'Un objet dans le coffre' : v.kind === 'statue' ? 'Une statue s’éveille' : 'Une fiole d’écho'}</h2>
        <div class="card static big">
          <span class="card-pix" aria-hidden="true">${this.img(v.card.sprite, 72)}</span>
          <span class="card-body"><span class="card-name">${v.card.name}</span>
            <span class="card-sub">${v.card.stats}</span>
            <span class="card-sub">${v.card.blurb}</span></span>
        </div>
        ${
          v.kind === 'statue'
            ? '<p class="sub">Elle occupe une place d’escouade et ne peut être ni soignée ni ressuscitée.</p>'
            : v.kind === 'phial'
              ? '<p class="sub">Consommable : elle invoque un spectre au front pour deux tours, hors du cap.</p>'
              : '<p class="sub">Un objet par unité, transférable librement entre les salles.</p>'
        }
        ${needsSlot ? this.dismissBlock(v.squad, 'Ton escouade est pleine (4 / 4).') : ''}
        ${needsSlot ? '<p class="warn">Renvoyer est DÉFINITIF et ne rembourse rien.</p>' : '<button class="btn primary" type="button" data-action="accept">Prendre</button>'}
        <button class="btn" type="button" data-action="refuse">Laisser</button>
        <p class="sub">💰 ${v.gold} or</p>
      </div>`,
      'treasure',
    );
  }

  showShop(v: ShopView): void {
    const offers = v.offers
      .map(
        (o) => `<div class="offer">
          <span class="card-pix" aria-hidden="true">${this.img(o.sprite, 48)}</span>
          <span class="card-body"><span class="card-name">${o.name}</span>
            <span class="card-sub">${o.effect}</span></span>
          <button class="btn small${o.affordable && !o.sold ? ' primary' : ''}" type="button"
                  data-action="buy-item" data-item="${o.item}"${o.sold || !o.affordable ? ' disabled' : ''}
                  aria-label="${o.sold ? `${o.name}, déjà acheté` : o.affordable ? `Acheter ${o.name} pour ${o.price} or` : `${o.name} coûte ${o.price} or, il t’en manque ${o.price - v.gold}`}">
            ${o.sold ? 'vendu' : `${o.price} 🪙`}
          </button>
        </div>`,
      )
      .join('');

    const care = v.squad
      .map((m) => {
        if (m.dead) {
          if (m.summon) {
            return `<div class="offer"><span class="card-pix" aria-hidden="true">${this.img(m.sprite, 40)}</span>
              <span class="card-body"><span class="card-name">${m.name}</span>
                <span class="card-sub">Invocation : elle ne se ressuscite pas.</span></span></div>`;
          }
          const price = v.freeRevives > 0 ? 0 : v.reviveCost;
          const can = v.gold >= price;
          return `<div class="offer"><span class="card-pix dead" aria-hidden="true">${this.img(m.sprite, 40)}</span>
            <span class="card-body"><span class="card-name">${m.name} — à terre</span>
              <span class="card-sub">Revient à la moitié de ses ${m.maxHp} PV.</span></span>
            <button class="btn small${can ? ' primary' : ''}" type="button" data-action="revive" data-member="${m.id}"${can ? '' : ' disabled'}
                    aria-label="${can ? `Ressusciter ${m.name} pour ${price} or` : `Ressusciter ${m.name} coûte ${price} or, il t’en manque ${price - v.gold}`}">
              ${price === 0 ? 'Répit — gratuit' : `${price} 🪙`}
            </button></div>`;
        }
        const missing = m.maxHp - m.hp;
        if (missing === 0) {
          return `<div class="offer"><span class="card-pix" aria-hidden="true">${this.img(m.sprite, 40)}</span>
            <span class="card-body"><span class="card-name">${m.name}</span>
              <span class="card-sub">${m.hp} / ${m.maxHp} PV — intact.</span></span></div>`;
        }
        if (m.summon) {
          return `<div class="offer"><span class="card-pix" aria-hidden="true">${this.img(m.sprite, 40)}</span>
            <span class="card-body"><span class="card-name">${m.name}</span>
              <span class="card-sub">${m.hp} / ${m.maxHp} PV — une invocation ne se soigne pas.</span></span></div>`;
        }
        const step = Math.min(v.healStep, missing);
        const price = step * v.healPerHp;
        const can = v.gold >= price;
        return `<div class="offer"><span class="card-pix" aria-hidden="true">${this.img(m.sprite, 40)}</span>
          <span class="card-body"><span class="card-name">${m.name}</span>
            <span class="card-sub">${m.hp} / ${m.maxHp} PV — ${v.healPerHp} or par PV.</span></span>
          <button class="btn small${can ? ' primary' : ''}" type="button" data-action="heal" data-member="${m.id}"${can ? '' : ' disabled'}
                  aria-label="${can ? `Soigner ${m.name} de ${step} PV pour ${price} or` : `Soigner ${m.name} coûte ${price} or, il t’en manque ${price - v.gold}`}">
            +${step} PV · ${price} 🪙
          </button></div>`;
      })
      .join('');

    this.show(
      `<div class="panel wide">
        <h2 tabindex="-1">👛 Le marchand</h2>
        <p class="shards">💰 ${v.gold} or</p>
        <h2 class="sec">Réparer</h2>
        <div class="col">${care}</div>
        <h2 class="sec">S’équiper</h2>
        <div class="col">${offers || '<p class="sub">L’étal est vide.</p>'}</div>
        <button class="btn" type="button" data-action="squad">👥 Escouade et objets</button>
        <button class="btn primary" type="button" data-action="leave">Reprendre la route</button>
      </div>`,
      'shop',
    );
  }

  /**
   * La formation, en GRILLE de boutons. Deux touches suffisent à tout : la
   * première choisit un emplacement, la seconde l'échange avec un autre (ou l'y
   * déplace s'il est vide). Un seul geste couvre donc le déplacement ET
   * l'échange, et il se joue entièrement au clavier.
   */
  showSquad(v: SquadView): void {
    const cell = (line: Line, slot: number): string => {
      const m = v.squad.find((x) => x.line === line && x.slot === slot);
      const isPicked = this.picked?.line === line && this.picked.slot === slot;
      const where = line === 0 ? 'ligne avant' : 'ligne arrière';
      const label = m
        ? `${m.name}, ${where}, emplacement ${slot + 1}. ${m.dead ? 'À terre.' : `${m.hp} sur ${m.maxHp} PV.`}${m.item ? ` Porte ${m.itemName}.` : ''}`
        : `Emplacement libre, ${where}, emplacement ${slot + 1}`;
      return `<button class="slot${isPicked ? ' picked' : ''}${m?.dead ? ' dead' : ''}" type="button"
                data-action="slot" data-line="${line}" data-slot="${slot}"
                aria-pressed="${isPicked}" aria-label="${label}">
        ${m ? `${this.img(m.sprite, 44)}<span class="slot-name">${m.name}</span>
              <span class="slot-hp">${m.dead ? 'à terre' : `${m.hp}/${m.maxHp}`}</span>` : '<span class="slot-free">libre</span>'}
      </button>`;
    };

    const front = Array.from({ length: v.frontCap }, (_, i) => cell(0, i)).join('');
    const back = Array.from({ length: v.backCap }, (_, i) => cell(1, i)).join('');

    const gear = v.squad
      .map((m) => {
        const options = [
          `<option value="">${m.item ? '— retirer —' : '— aucun —'}</option>`,
          ...(m.item ? [`<option value="${m.item}" selected>${m.itemName}</option>`] : []),
          ...v.stash.map((s) => `<option value="${s.item}">${s.name}</option>`),
        ].join('');
        return `<div class="offer">
          <span class="card-pix" aria-hidden="true">${this.img(m.sprite, 40)}</span>
          <span class="card-body"><span class="card-name">${m.name}</span>
            <span class="card-sub">${m.item ? m.itemName : 'aucun objet'}</span></span>
          <select class="gear" data-member="${m.id}" aria-label="Objet porté par ${m.name}">${options}</select>
        </div>`;
      })
      .join('');

    this.show(
      `<div class="panel wide">
        <h2 tabindex="-1">👥 Escouade</h2>
        <p class="sub">Touche un emplacement, puis un second : ils s’échangent. Deux places par
          ligne${v.frontCap > 2 ? ', trois au front grâce à « Rang serré »' : ''}. Réorganiser est gratuit.</p>
        <div class="formation" role="group" aria-label="Ligne avant">${front}</div>
        <p class="line-label">↑ ligne avant — au contact</p>
        <div class="formation" role="group" aria-label="Ligne arrière">${back}</div>
        <p class="line-label">↑ ligne arrière — à l’abri du contact</p>
        <h2 class="sec">Objets</h2>
        ${v.stash.length ? `<p class="sub">En sac : ${v.stash.map((s) => s.name).join(', ')}.</p>` : '<p class="sub">Aucun objet en sac.</p>'}
        <div class="col">${gear}</div>
        <button class="btn primary" type="button" data-action="leave">${v.closeLabel}</button>
      </div>`,
      'squad',
    );
  }

  showResult(v: ResultView): void {
    const feats = v.freshFeats
      .map((f) => `<p class="feat-line" role="status">${f.icon} ${f.name} débloqué !</p>`)
      .join('');
    this.show(
      `<div class="panel">
        <h2 class="${v.victory ? 'win' : 'lose'}" tabindex="-1">${v.victory ? 'LE GEÔLIER TOMBE' : 'ESCOUADE À TERRE'}</h2>
        <p class="sub">${
          v.victory
            ? `Run bouclée en ${fmtTime(v.timeSec)}.`
            : `Tombé au nœud ${v.node} sur 9, après ${fmtTime(v.timeSec)}.`
        }</p>
        <p class="shards">💎 +${v.shards} éclat${v.shards > 1 ? 's' : ''} · total ${v.shardsTotal}</p>
        ${v.record ? '<p class="feat-line" role="status">🏅 Nouveau record !</p>' : ''}
        ${feats}
        <div class="stats">${v.lines.map((l) => `<p>${l}</p>`).join('')}</div>
        <button class="btn primary" type="button" data-action="replay">Repartir</button>
        <div class="row2">
          <button class="btn" type="button" data-action="tree">🌳 Arbre</button>
          <button class="btn" type="button" data-action="home">Menu</button>
        </div>
      </div>`,
      'result',
    );
  }

  // ─────────────────────────────────────────────── interne

  private dismissBlock(squad: readonly MemberRow[], intro: string): string {
    const rows = squad
      .map(
        (m) => `<div class="offer">
          <span class="card-pix" aria-hidden="true">${this.img(m.sprite, 40)}</span>
          <span class="card-body"><span class="card-name">${m.name}</span>
            <span class="card-sub">${m.dead ? 'à terre' : `${m.hp} / ${m.maxHp} PV`}${m.item ? ` · ${m.itemName}` : ''}</span></span>
          <button class="btn small danger" type="button" data-action="dismiss" data-member="${m.id}"
                  aria-label="Renvoyer ${m.name} définitivement, sans remboursement, et prendre sa place.">
            Renvoyer
          </button>
        </div>`,
      )
      .join('');
    return `<p class="sub">${intro} Choisis qui laisser partir.</p><div class="col">${rows}</div>`;
  }

  private resetBlock(): string {
    if (!this.confirmingReset) {
      return '<button class="btn small" type="button" data-action="reset-ask">Réinitialiser la progression</button>';
    }
    return `<p class="reset-warn" role="alert">Éclats, arbre, succès et options seront effacés. Sans retour.</p>
      <div class="row2">
        <button class="btn danger" type="button" data-action="reset-do">Effacer</button>
        <button class="btn" type="button" data-action="reset-cancel">Annuler</button>
      </div>`;
  }

  private show(html: string, screen: string): void {
    this.root.innerHTML = html;
    this.root.classList.add('visible');
    const changed = screen !== this.currentScreen;
    this.currentScreen = screen;
    // Le focus ne remonte que si l'ÉCRAN change : un simple rafraîchissement
    // (un achat, une bascule d'option) ne doit pas perdre le joueur en haut du
    // panneau, alors qu'il vient d'agir en bas.
    if (changed) this.root.querySelector<HTMLElement>('[tabindex="-1"]')?.focus();
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const member = Number(el.dataset.member ?? '0');
    switch (el.dataset.action) {
      case 'start':
        this.onStart(el.dataset.hero ?? 'wanderer');
        break;
      case 'home':
        this.confirmingReset = false;
        this.onHome();
        break;
      case 'help':
        this.onHelp();
        break;
      case 'tree':
        this.onTree();
        break;
      case 'ach':
        this.onAchievements();
        break;
      case 'buy-meta':
        this.onBuyMeta(el.dataset.meta as MetaId);
        break;
      case 'accept':
        this.onAccept();
        break;
      case 'refuse':
        this.onRefuse();
        break;
      case 'dismiss':
        this.onDismiss(member);
        break;
      case 'buy-item':
        this.onShopBuy('item', el.dataset.item ?? '');
        break;
      case 'revive':
        this.onShopBuy('revive', String(member));
        break;
      case 'heal':
        this.onShopBuy('heal', String(member));
        break;
      case 'squad':
        this.onOpenSquad();
        break;
      case 'leave':
        this.picked = null;
        this.onLeaveRoom();
        break;
      case 'slot': {
        const line = Number(el.dataset.line) as Line;
        const slot = Number(el.dataset.slot);
        if (!this.picked) this.picked = { line, slot };
        else if (this.picked.line === line && this.picked.slot === slot) this.picked = null;
        else {
          const from = this.picked;
          this.picked = null;
          this.onSwapSlots(from, { line, slot });
          return; // Flow redessine l'écran avec la nouvelle formation
        }
        this.onOpenSquad();
        break;
      }
      case 'replay':
        this.onReplay();
        break;
      case 'reset-ask':
        this.confirmingReset = true;
        this.onHome();
        break;
      case 'reset-cancel':
        this.confirmingReset = false;
        this.onHome();
        break;
      case 'reset-do':
        this.confirmingReset = false;
        this.onResetProgress();
        break;
    }
  }

  private onChange(e: Event): void {
    const el = e.target as HTMLInputElement | HTMLSelectElement | null;
    if (!el) return;
    if (el instanceof HTMLSelectElement && el.classList.contains('gear')) {
      const id = Number(el.dataset.member ?? '0');
      if (el.value === '') this.onUnequip(id);
      else this.onEquip(id, el.value as ItemId);
      return;
    }
    const key = (el as HTMLInputElement).dataset.toggle;
    if (!key) return;
    const checked = (el as HTMLInputElement).checked;
    // la case « Sons » est en logique inversée : cochée = son actif
    if (key === 'muted') this.onToggle('muted', !checked);
    else if (key === 'reducedMotion') this.onToggle('reducedMotion', checked);
  }
}
