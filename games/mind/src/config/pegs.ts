// Table des pions : couleur, FORME, GLYPHE et nom français — UNE seule source,
// lue par le générateur de textures (render/textures.ts) ET par les libellés
// accessibles du HUD (ui/hud.ts). Les tenir séparés les ferait désynchroniser.
//
// ACCESSIBILITÉ (WCAG 1.4.1) : huit couleurs ne peuvent pas se distinguer à la
// teinte seule — ni pour un daltonien, ni en niveaux de gris, ni sur un écran
// délavé au soleil. Chaque pion porte donc TROIS signaux redondants : une teinte,
// une FORME de corps et un GLYPHE. Le nom français est le quatrième, pour les
// lecteurs d'écran. Ne jamais ajouter un pion sans ses quatre signaux.
//
// CONTRASTE (WCAG 1.4.11) : chaque corps doit atteindre 3:1 contre les trois fonds
// du jeu (#1a1030 fond, #241945 plateau, #150c26 socle). Vérifié AU CALCUL, jamais
// à l'œil : le bleu #3a4fd8 et un pion vide sombre échouaient à 2,5 et 2,7:1 —
// invisible à l'inspection visuelle, net au calcul. Recalculer après tout
// changement de teinte. Les écarts de LUMINANCE entre pions voisins sont en
// revanche parfois faibles (orange/cyan, jaune/vert) : c'est assumé, ce sont la
// forme et le glyphe qui les séparent en niveaux de gris.

/** Forme du corps du pion — dessinée par `tracePegShape` (render/textures.ts). */
export type PegShape = 'disc' | 'hex' | 'diamond' | 'square' | 'triangle' | 'drop' | 'octagon' | 'pentagon';

/** Glyphe surimprimé — dessiné par `drawPegGlyph` (render/textures.ts). */
export type PegGlyph = 'dot' | 'up' | 'rhombus' | 'bar' | 'cross' | 'star' | 'ring' | 'stripes' | 'slash';

export interface PegDef {
  /** Corps du pion. */
  color: number;
  /** Ombre interne / liseré chaud du corps. */
  dark: number;
  shape: PegShape;
  glyph: PegGlyph;
  /** Nom prononcé par les lecteurs d'écran (« emplacement 2 : cyan »). */
  name: string;
}

/**
 * Les 8 pions, dans l'ordre des touches 1-8 du clavier. Les difficultés n'en
 * utilisent que les `colors` premiers (5 en facile, 6 en normal, 8 en difficile).
 * L'ordre est donc porteur : les cinq premiers doivent déjà être franchement
 * distincts entre eux, sans compter sur les suivants.
 */
export const PEGS: readonly PegDef[] = [
  { color: 0xffd23f, dark: 0x9c7200, shape: 'disc', glyph: 'dot', name: 'jaune' },
  { color: 0x4cc9f0, dark: 0x0b6a86, shape: 'hex', glyph: 'up', name: 'cyan' },
  { color: 0xb06bff, dark: 0x5b21a8, shape: 'diamond', glyph: 'rhombus', name: 'violet' },
  { color: 0xff6b8a, dark: 0x9c1f3c, shape: 'square', glyph: 'bar', name: 'rose' },
  { color: 0x7ef29a, dark: 0x1d7a3f, shape: 'triangle', glyph: 'cross', name: 'vert' },
  { color: 0xff9f45, dark: 0x9c4e00, shape: 'drop', glyph: 'star', name: 'orange' },
  { color: 0xf2f0ff, dark: 0x6f6a8c, shape: 'octagon', glyph: 'ring', name: 'blanc' },
  { color: 0x5b72e6, dark: 0x1632c3, shape: 'pentagon', glyph: 'stripes', name: 'bleu' },
];

/**
 * Le pion vide (difficile) : 9ᵉ entrée de la palette, touche 0. Son nom dit
 * « pion vide » et non « vide » : un emplacement NON REMPLI s'annonce « libre »,
 * et confondre les deux à l'oral rendrait le mode difficile injouable au lecteur
 * d'écran.
 */
export const EMPTY_PEG_DEF: PegDef = {
  // Corps clair et DÉSATURÉ, glyphe ⊘ barré : à 42 px, un pion vide sombre à
  // simple anneau se confondait avec un emplacement NON REMPLI — la confusion la
  // plus coûteuse du mode difficile. La désaturation dit « pas une couleur ».
  color: 0xc4bccc,
  dark: 0x7f6a97,
  shape: 'disc',
  glyph: 'slash',
  name: 'pion vide',
};

/** Nom accessible d'une valeur de pion (`EMPTY_PEG` compris). */
export function pegName(value: number): string {
  return value < 0 ? EMPTY_PEG_DEF.name : (PEGS[value]?.name ?? 'inconnu');
}
