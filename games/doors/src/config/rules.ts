// Types du modèle de « Trois Portes ». AUCUNE donnée ici : tout le tuning vit
// dans config/balance.ts (invariant du repo).
//
// Le vocabulaire est celui du design : un CAMP (joueur / ennemi), deux LIGNES
// par camp (avant / arrière), et une RÈGLE DE LIGNE qui tient en deux phrases.

/** 0 = joueur, 1 = ennemi. Un simple index : les tableaux de camp s'indexent avec. */
export type Side = 0 | 1;

/** 0 = ligne avant (au contact), 1 = ligne arrière. */
export type Line = 0 | 1;

/** Portée d'une unité. Décide de ce que la règle de ligne l'autorise à viser. */
export type Reach = 'melee' | 'ranged';

/** Action choisie par une unité à son tour. Une seule, jamais deux. */
export type ActionKind = 'attack' | 'ability' | 'swap' | 'defend';

/** Identifiants d'objets — voir ITEMS dans balance.ts. */
export type ItemId = 'shield' | 'blade' | 'boots' | 'amulet' | 'quiver' | 'banner';

/**
 * Capacités. `null` = aucune (les remplisseurs du bestiaire n'en ont pas).
 * Une capacité est soit PASSIVE (elle modifie un calcul), soit ACTIVE (elle
 * remplace l'attaque au tour de l'unité) — `abilityIsActive()` tranche.
 */
export type AbilityId =
  | 'secondWind' // Vagabond — ACTIVE : +6 PV au lieu d'agir, une fois par combat
  | 'taunt' // Gardien — PASSIVE : le contact doit le cibler tant qu'il est au front
  | 'momentum' // Bourreau — PASSIVE : +3 dégâts sur une cible à PV pleins
  | 'aimed' // Archère — PASSIVE : +2 dégâts sur la ligne arrière adverse
  | 'brew' // Herboriste — ACTIVE : rend 7 PV à un allié
  | 'runicVolley' // Runiste — ACTIVE : 4 dégâts à toute une ligne, recharge 2 tours
  | 'pack' // Chien de meute — PASSIVE : +2 ATQ tant qu'un autre chien vit
  | 'stalker' // Rôdeur — PASSIVE (IA) : vise la ligne arrière du joueur en priorité
  | 'litany' // Idole — ACTIVE (IA) : rend 4 PV à l'ennemi le plus blessé
  | 'jailer'; // Geôlier — le boss : invocation + frappe large sous 50 % PV

/**
 * Une capacité ACTIVE remplace l'attaque ; une passive ne coûte jamais un tour.
 * `litany` et `jailer` sont actives aussi : ce sont les tours de l'Idole et la
 * Frappe large du boss. Les oublier ici faisait échouer `Combat.canUseAbility`,
 * donc `act()`, donc l'IA se rabattait silencieusement sur Défendre — le boss
 * n'avait plus de phase 2 du tout. C'est exactement ce que le scénario `rules`
 * du bot a attrapé.
 */
export function abilityIsActive(a: AbilityId | null): boolean {
  return a === 'secondWind' || a === 'brew' || a === 'runicVolley' || a === 'litany' || a === 'jailer';
}

/** Fiche d'une unité — 4 chiffres et pas un de plus, la capacité porte le reste. */
export interface UnitDef {
  id: string;
  name: string;
  /** Sprite : clé dans l'atlas (render/textures.ts). */
  sprite: string;
  hp: number;
  atk: number;
  init: number;
  reach: Reach;
  /** Réduction SOUSTRACTIVE des dégâts subis, plancher à 1. */
  armor: number;
  ability: AbilityId | null;
  /** Ligne conseillée à l'arrivée dans l'escouade. */
  home: Line;
  /** Une phrase — affichée au recrutement et dans l'aide. */
  blurb: string;
  /** Or lâché / difficulté, côté bestiaire uniquement. */
  boss?: boolean;
}

/** Catégories de porte. `veiled` cache sa vraie catégorie jusqu'au franchissement. */
export type DoorKind = 'fight' | 'fightHard' | 'recruit' | 'treasure' | 'shop' | 'veiled';

/** Ce qu'une porte annonce (le « tell ») et ce qu'elle cache réellement. */
export interface Door {
  /** Icône affichée. `veiled` pour la porte voilée. */
  tell: DoorKind;
  /** Contenu réel — égal à `tell` sauf pour une porte voilée. */
  real: Exclude<DoorKind, 'veiled'>;
  /** Multiplicateur de récompense (1.5 derrière une porte voilée). */
  bonus: number;
  /** Composition ennemie, pour les portes de combat. */
  enemies: readonly string[];
  /** Or de la salle, déjà tiré (déterministe par seed). */
  gold: number;
  /** Classe proposée, pour une porte Recrue. */
  recruit: string | null;
  /** Butin, pour une porte Trésor : un objet ou une invocation. */
  treasure: ItemId | 'statue' | 'phial' | null;
  /** Révélée par « Œil averti » : on affiche alors sa vraie catégorie. */
  revealed: boolean;
}
