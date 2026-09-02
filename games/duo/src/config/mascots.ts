/**
 * Les six mascottes de la table. Un joueur n'est JAMAIS identifié par sa seule
 * couleur (WCAG 1.4.1) : c'est un TRIPLE codage — la teinte, la FORME DU SOCLE
 * sur lequel la mascotte est posée, et la mascotte elle-même (emoji + sprite).
 * Un enfant daltonien lit la forme, un enfant qui ne lit pas lit l'animal.
 *
 * Contraintes vérifiées AU CALCUL par le scénario `contrast` du bot, jamais à
 * l'œil (leçon de Cerveau, où un bleu à 2,5:1 paraissait parfait) :
 *   ① chaque teinte contraste ≥ 3:1 sur le fond `PALETTE.bg` (#3b2a20) ;
 *   ② les six teintes sont deux à deux séparées d'au moins 1,25:1 EN NIVEAUX
 *      DE GRIS — les luminances sont réparties géométriquement de 0,20 à 0,80,
 *      ce qui est exactement ce qu'autorise le budget une fois la contrainte ①
 *      posée. Toute retouche d'une teinte doit refaire ce calcul : deux
 *      mascottes qui se ressemblent en gris, ce sont deux joueurs qui ne savent
 *      plus qui possède quoi ;
 *   ③ les six formes de socle sont deux à deux distinctes.
 *
 * Interdit de charte, repris de tout le dépôt : pas d'ANNEAU comme forme de
 * socle (code réservé aux dangers et aux zones de jeu), pas d'aplat blanc.
 */

/** Forme du socle — deuxième code, indépendant de la teinte. */
export type SocleShape = 'disc' | 'square' | 'hex' | 'triangle' | 'flower' | 'cloud';

export interface MascotDef {
  id: string;
  /** Emoji : le code que lit un enfant de 5 ans, avant la teinte et la forme. */
  emoji: string;
  /** Nom français — libellé DOM et région live, jamais requis pour jouer. */
  name: string;
  /** Teinte du joueur (hex). Voir les contraintes ① et ② ci-dessus. */
  tint: number;
  /** Forme du socle (contrainte ③). */
  socle: SocleShape;
  /** Clé du sprite 16×16 correspondant dans `render/sprites.ts`. */
  sprite: string;
}

/**
 * Ordonnées par luminance CROISSANTE : c'est la lecture qui compte pour la
 * contrainte ②, et la garder visible dans l'ordre du tableau évite d'insérer
 * une septième teinte au milieu du budget sans s'en rendre compte.
 */
export const MASCOTS: readonly MascotDef[] = [
  { id: 'owl', emoji: '🦉', name: 'la chouette', tint: 0x9c5fd1, socle: 'hex', sprite: 'owl' },
  { id: 'rabbit', emoji: '🐰', name: 'le lapin', tint: 0xdb6695, socle: 'flower', sprite: 'rabbit' },
  { id: 'fox', emoji: '🦊', name: 'le renard', tint: 0xeb884e, socle: 'triangle', sprite: 'fox' },
  { id: 'fish', emoji: '🐟', name: 'le poisson', tint: 0x68c5dc, socle: 'square', sprite: 'fish' },
  { id: 'frog', emoji: '🐸', name: 'la grenouille', tint: 0xaadd88, socle: 'disc', sprite: 'frog' },
  { id: 'bear', emoji: '🐻', name: "l'ourson", tint: 0xf9e6b4, socle: 'cloud', sprite: 'bear' },
];

/** Mascottes par défaut des deux sièges — deux formes ET deux teintes éloignées. */
export const DEFAULT_MASCOTS: readonly [string, string] = ['rabbit', 'frog'];

export function mascotById(id: string): MascotDef {
  for (const m of MASCOTS) if (m.id === id) return m;
  // Un save d'un futur build (ou corrompu) ne doit jamais casser le boot :
  // on retombe sur la première mascotte plutôt que de lancer.
  return MASCOTS[0];
}
