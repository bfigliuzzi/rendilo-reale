import { DEFAULT_MASCOTS, mascotById } from '../config/mascots';

/**
 * Sauvegarde de la collection Duo. Discipline du dépôt, à la lettre :
 * clé JAMAIS renommée, version DANS le JSON, `structuredClone(DEFAULTS)` puis
 * fusion CHAMP PAR CHAMP avec garde de type (jamais un `Object.assign` du JSON
 * analysé : un save corrompu ou d'un futur build injecterait une forme
 * inattendue), `resetSave` qui mute EN PLACE (l'objet est partagé par référence
 * avec la session, les écrans et `window.__game`).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS ICI, ET NE DOIT PAS Y ARRIVER (§1.3)
 *
 * AUCUN compteur de victoires, aucun record, aucun succès, aucune monnaie.
 * Le score cumulé de la table vit en MÉMOIRE dans `core/session.ts` et meurt à
 * la fermeture de l'onglet. Ce n'est pas un oubli : un palmarès persistant
 * entre deux enfants de 5 et 8 ans transforme une attente au restaurant en
 * classement permanent, où le petit perd tous les jours. Ce fichier est
 * l'endroit où cette décision de design se fait respecter — exactement comme
 * l'absence d'économie dans le save de Berceau. Si un champ de plus semble
 * nécessaire, relire §1.3 avant de l'ajouter.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * DEUX RÔLES, À NE PAS CONFONDRE (les deux commentaires disaient l'inverse
 * l'un de l'autre, et tous les deux à côté du code) : les DEUX SEULS appels à
 * `localStorage` de toute la collection sont ceux de CE fichier (`loadSave` /
 * `persist`, plus bas) ; `core/session.ts` en est le seul APPELANT. Le §9 de la
 * spec dit « aucun `localStorage` hors `core/session.ts` » — l'écart est
 * assumé et il est ici : la spec impose par ailleurs (§2.2) un `meta/save.ts`,
 * et c'est lui qui connaît le schéma et sa migration. Aucun micro-jeu n'accède
 * ni à l'un ni à l'autre : il ne reçoit que ses `stars` et son `seed`.
 */

const KEY = 'rendilo-reale:duo:save:v1';

export type StarLevel = 1 | 2;

export interface PlayerSave {
  /** Identifiant d'une mascotte de `config/mascots.ts`. */
  mascot: string;
  /** ⭐ ou ⭐⭐ : modifie les CHIFFRES d'un jeu, jamais ses règles (§1.3). */
  stars: StarLevel;
}

export interface DuoSave {
  v: 1;
  /**
   * MUET PAR DÉFAUT — écart assumé avec les cinq autres jeux du hub, qui
   * démarrent avec le son. Le cas nominal est une salle d'attente ; un jeu qui
   * se met à sonner tout seul se fait couper, pas monter.
   */
  muted: boolean;
  /** Option joueur, en OU avec `prefers-reduced-motion` (jamais en ET). */
  reducedMotion: boolean;
  players: [PlayerSave, PlayerSave];
  /** Dernier micro-jeu lancé : rouvre le menu au bon endroit. */
  lastGame: string | null;
  /** Jeux déjà lancés → la démo ne s'impose qu'une fois (§2.4). */
  seen: Record<string, boolean>;
}

const DEFAULTS: DuoSave = {
  v: 1,
  muted: true,
  reducedMotion: false,
  players: [
    { mascot: DEFAULT_MASCOTS[0], stars: 1 },
    { mascot: DEFAULT_MASCOTS[1], stars: 2 },
  ],
  lastGame: null,
  seen: {},
};

/** Mute EN PLACE : l'objet est partagé par référence avec toute l'application. */
export function resetSave(save: DuoSave): void {
  Object.assign(save, structuredClone(DEFAULTS));
}

function readPlayer(raw: unknown, into: PlayerSave): void {
  if (!raw || typeof raw !== 'object') return;
  const p = raw as Record<string, unknown>;
  // Whitelist : une mascotte inconnue retombe sur la première, jamais sur une
  // chaîne arbitraire qui casserait le rendu.
  if (typeof p.mascot === 'string') into.mascot = mascotById(p.mascot).id;
  if (p.stars === 1 || p.stars === 2) into.stars = p.stars;
}

export function loadSave(): DuoSave {
  const save = structuredClone(DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return save;
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (typeof parsed.muted === 'boolean') save.muted = parsed.muted;
    if (typeof parsed.reducedMotion === 'boolean') save.reducedMotion = parsed.reducedMotion;

    if (Array.isArray(parsed.players)) {
      readPlayer(parsed.players[0], save.players[0]);
      readPlayer(parsed.players[1], save.players[1]);
    }

    if (typeof parsed.lastGame === 'string') save.lastGame = parsed.lastGame;

    const seen = parsed.seen;
    if (seen && typeof seen === 'object') {
      for (const [id, v] of Object.entries(seen as Record<string, unknown>)) {
        if (v === true) save.seen[id] = true;
      }
    }
  } catch {
    // Navigation privée, quota, JSON corrompu : repartir des défauts plutôt que
    // de casser le boot. Perdre un choix de mascotte n'est pas grave.
  }
  return save;
}

export function persist(save: DuoSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Ignoré : perdre un point de save vaut mieux que perdre la partie en cours.
  }
}
