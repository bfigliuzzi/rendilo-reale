/**
 * Sprites 16×16 écrits à la main, une lettre par teinte — pattern de Trois
 * Portes. Aucun asset : `render/textures.ts` les peint case par case au boot,
 * donc le jeu s'ouvre hors ligne dès la première visite.
 *
 * PARTI PRIS, non négociable (§6) : RIEN QUI FASSE PEUR. Public de 5 ans.
 * Silhouettes rondes, yeux grands, couleurs chaudes — la bête sous le tapis est
 * une peluche à grands yeux, le géant est un nuage joufflu. Aucune information
 * de jeu ne passe par l'image de toute façon : elle passe par les CHIFFRES en
 * clair, la position et la forme.
 *
 * Le contour `o` est un brun (0x2a1b14), jamais un noir pur — cohérence de
 * charte, et un noir pur sur un fond cacao « troue » l'image.
 */

export const SPRITE_SIZE = 16;

export type Ink = Readonly<Record<string, number>>;

export interface SpriteDef {
  /** 16 lignes de 16 caractères. Un caractère absent de `ink` n'est pas peint. */
  grid: readonly string[];
  ink: Ink;
}

/** Encres communes : contour, peau, œil, crème. Chaque sprite les étend. */
const BASE = {
  o: 0x2a1b14, // contour brun — jamais un noir pur
  k: 0xffe0bd, // peau claire
  K: 0xdfb488, // peau ombrée
  e: 0x3b2418, // œil
  w: 0xfff3e2, // crème
} as const;

export const SPRITES: Readonly<Record<string, SpriteDef>> = {
  /** Lapin : oreilles hautes, museau rose. */
  rabbit: {
    grid: [
      '....oo....oo....',
      '...ohho..ohho...',
      '...ohho..ohho...',
      '...ohho..ohho...',
      '..oohhoooohhoo..',
      '..ohhhhhhhhhho..',
      '.ohhhhhhhhhhhho.',
      '.ohhehhhhhhehho.',
      '.ohhhhhhhhhhhho.',
      '.ohhhhhrrhhhhho.',
      '..ohhhhhhhhhho..',
      '..oohhhhhhhhoo..',
      '...ohhhhhhhho...',
      '...ohhhhhhhho...',
      '..oohho..ohhoo..',
      '..oooo....oooo..',
    ],
    ink: { ...BASE, h: 0xf6d9e4, H: 0xd7aec1, r: 0xf08fb0 },
  },
  /** Renard : oreilles pointues, museau clair. */
  fox: {
    grid: [
      '..oo........oo..',
      '.ohho......ohho.',
      '.ohhho....ohhho.',
      '.ohhhhoooohhhho.',
      '..ohhhhhhhhhho..',
      '..ohhhhhhhhhho..',
      '.ohhehhhhhhehho.',
      '.ohhhhhhhhhhhho.',
      '.ohhhwwwwwwhhho.',
      '..ohwwwoowwwho..',
      '..ohwwwwwwwwho..',
      '...ohhwwwwhho...',
      '...ohhhhhhhho...',
      '..oohhhhhhhhoo..',
      '..oHHo....oHHo..',
      '..oooo....oooo..',
    ],
    ink: { ...BASE, h: 0xf0a463, H: 0xc27a3f, w: 0xfff3e2 },
  },
  /** Grenouille : yeux perchés, large sourire. */
  frog: {
    grid: [
      '..oooo....oooo..',
      '.oggggo..oggggo.',
      '.ogewgo..ogewgo.',
      '.oggggo..oggggo.',
      '.oggggggggggggo.',
      '.oggggggggggggo.',
      '.oggggggggggggo.',
      '.oggwwwwwwwwggo.',
      '.ogggwwwwwwgggo.',
      '.oggggggggggggo.',
      '..oggggggggggo..',
      '..ooggggggggoo..',
      '...oggggggggo...',
      '..oggo....oggo..',
      '.oggggo..oggggo.',
      '.oooooo..oooooo.',
    ],
    ink: { ...BASE, g: 0xa9d97f, w: 0xfff3e2 },
  },
  /** Chouette : grands disques faciaux, bec doré. */
  owl: {
    grid: [
      '...oo......oo...',
      '..ohho....ohho..',
      '..ohhhoooohhho..',
      '.ohhhhhhhhhhhho.',
      '.ohhwwwhhwwwhho.',
      '.ohwweewwweewho.',
      '.ohwweewwweewho.',
      '.ohhwwwyywwwhho.',
      '.ohhhhhyhhhhhho.',
      '.ohhhHHHHHHhhho.',
      '.ohhhHHHHHHhhho.',
      '..ohhHHHHHHhho..',
      '..ohhhHHHHhhho..',
      '...ohhhhhhhho...',
      '...oyyo..oyyo...',
      '...oooo..oooo...',
    ],
    ink: { ...BASE, h: 0xb99ae0, H: 0x8f6cc0, w: 0xfff3e2, y: 0xffc95e },
  },
  /** Poisson : nageoire caudale à gauche, corps rond. */
  fish: {
    grid: [
      '................',
      'oo........oooo..',
      'obo.....oobbbboo',
      'obbo...obbbbbbbo',
      'obbbo.obbbbbbbbo',
      'obbbbobbbbbbbbbo',
      'obbbbbbbebbbbbbo',
      'obbbbbbbbbbbbbbo',
      'obbbbbbwwbbbbbbo',
      'obbbbobbbbbbbbbo',
      'obbbo.obbbbbbbbo',
      'obbo...obbbbbbbo',
      'obo.....oobbbboo',
      'oo........oooo..',
      '................',
      '................',
    ],
    ink: { ...BASE, b: 0x7ed0e4, w: 0xfff3e2 },
  },
  /** Ourson : oreilles rondes, museau clair. */
  bear: {
    grid: [
      '..oo........oo..',
      '.ohho......ohho.',
      '.ohhho....ohhho.',
      '..ohhhoooohhho..',
      '.ohhhhhhhhhhhho.',
      '.ohhhhhhhhhhhho.',
      '.ohhehhhhhhehho.',
      '.ohhhhhhhhhhhho.',
      '.ohhhkkkkkkhhho.',
      '.ohhhkkoookkhho.',
      '.ohhhkkkkkkhhho.',
      '..ohhhhhhhhhho..',
      '..ohhhhhhhhhho..',
      '...ohhhhhhhho...',
      '..oHHo....oHHo..',
      '..oooo....oooo..',
    ],
    ink: { ...BASE, h: 0xfae9c2, H: 0xd9c193, k: 0xe0b98d },
  },
  /** Fraise : forme en cône + akènes clairs (forme ET couleur). */
  strawberry: {
    grid: [
      '......ogo.......',
      '....ogggggo.....',
      '...oggggggggo...',
      '....orrrrrro....',
      '...orrrwrrrro...',
      '..orrrrrrrrrro..',
      '..orrwrrrrwrro..',
      '..orrrrrrrrrro..',
      '..orwrrrrrrwro..',
      '...orrrrrrrro...',
      '...orrwrrwrro...',
      '....orrrrrro....',
      '.....orrrro.....',
      '......orro......',
      '.......oo.......',
      '................',
    ],
    ink: { ...BASE, r: 0xf2748a, g: 0xa9d97f, w: 0xfff3e2 },
  },
  /** Myrtille : disque parfait + couronne (forme ET couleur). */
  blueberry: {
    grid: [
      '................',
      '.....oooooo.....',
      '...oobbbbbboo...',
      '..obbbbbbbbbbo..',
      '.obbbbbobbbbbbo.',
      '.obbbboobbbbbbo.',
      'obbbbbbbbbbbbbbo',
      'obbwwbbbbbbbbbbo',
      'obbwbbbbbbbbbbbo',
      'obbbbbbbbbbbbbbo',
      '.obbbbbbbbbbbbo.',
      '..obbbbbbbbbbo..',
      '...oobbbbbboo...',
      '.....oooooo.....',
      '................',
      '................',
    ],
    ink: { ...BASE, b: 0x8f9fe0, w: 0xfff3e2 },
  },
  /** Pomme : la récompense de `tree`, visible en permanence dans le panier. */
  apple: {
    grid: [
      '........o.......',
      '.......oo.......',
      '......oggo......',
      '...ooo.oo.ooo...',
      '..orrrooorrrro..',
      '.orrrrrrrrrrrro.',
      '.orrwrrrrrrrrro.',
      'orrwrrrrrrrrrrro',
      'orrrrrrrrrrrrrro',
      'orrrrrrrrrrrrrro',
      'orrrrrrrrrrrrrro',
      '.orrrrrrrrrrrro.',
      '.orrrrrrrrrrrro.',
      '..orrrroorrrro..',
      '...oooo..oooo...',
      '................',
    ],
    ink: { ...BASE, r: 0xef7d6a, g: 0xa9d97f, w: 0xfff3e2 },
  },
  /** Domino de `tiles` : deux carrés, donc la tuile se lit debout ou couchée.
   *
   *  SEUL sprite de la collection peint en NEUTRE CLAIR, et c'est délibéré : il
   *  est le seul à être TEINTÉ à l'affichage (bleu « debout » / rose « couché »,
   *  les teintes des deux piles). Un `tint` de Pixi MULTIPLIE ; sur l'ocre
   *  d'origine (0xd9a86e) le bleu ressortait olive (0x728864) et le rose brique
   *  (0xcd4c3b) — donc un domino rouge dans un jeu pour cinq ans, et surtout
   *  plus AUCUN lien de couleur entre la pile et les pièces qu'elle pose. Sur
   *  un corps quasi crème, le produit rend la teinte demandée (6,9:1 et 4,5:1
   *  sur le fond). Le contour reste un brun MOYEN pour que, une fois multiplié,
   *  il donne un brun sombre lisible et jamais un noir pur. */
  tile: {
    grid: [
      'oooooooooooooooo',
      'oaaaaaaaaaaaaaao',
      'oaaaaaaaaaaaaaao',
      'oaaaaaaaaaaaaaao',
      'oaaaAAaaaaAAaaao',
      'oaaaAAaaaaAAaaao',
      'oaaaaaaaaaaaaaao',
      'oooooooooooooooo',
      'oaaaaaaaaaaaaaao',
      'oaaaaaaaaaaaaaao',
      'oaaaAAaaaaAAaaao',
      'oaaaAAaaaaAAaaao',
      'oaaaaaaaaaaaaaao',
      'oaaaaaaaaaaaaaao',
      'oaaaaaaaaaaaaaao',
      'oooooooooooooooo',
    ],
    ink: { ...BASE, o: 0x6b4a34, a: 0xf5efe8, A: 0xa2958a },
  },
  /** Bille de `plank` : éclat en haut à gauche, elle se lit même à l'arrêt. */
  marble: {
    grid: [
      '................',
      '.....oooooo.....',
      '...oobbbbbboo...',
      '..obbwwwbbbbbo..',
      '.obbwwwwbbbbbbo.',
      '.obbwwwbbbbbbbo.',
      'obbbbbbbbbbbbbbo',
      'obbbbbbbbbbbbbbo',
      'obbbbbbbbbbbbbbo',
      'obbbbbbbbbbbbbbo',
      '.obbbbbbbbbbbbo.',
      '.obbbbbbbbbbbbo.',
      '..obbbbbbbbbbo..',
      '...oobbbbbboo...',
      '.....oooooo.....',
      '................',
    ],
    ink: { ...BASE, b: 0x7ed0e4, w: 0xfff3e2 },
  },
  /** Bloc du géant : un cube franc, jamais un piège à pointes (§6, rien qui fasse peur). */
  block: {
    grid: [
      'oooooooooooooooo',
      'oaaaaaaaaaaaaaao',
      'oaAAAAAAAAAAAAao',
      'oaAaaaaaaaaaaAao',
      'oaAaaaaaaaaaaAao',
      'oaAaaaaaaaaaaAao',
      'oaAaaaaaaaaaaAao',
      'oaAaaaaaaaaaaAao',
      'oaAaaaaaaaaaaAao',
      'oaAaaaaaaaaaaAao',
      'oaAaaaaaaaaaaAao',
      'oaAaaaaaaaaaaAao',
      'oaAaaaaaaaaaaAao',
      'oaAaaaaaaaaaaAao',
      'oaAAAAAAAAAAAAao',
      'oooooooooooooooo',
    ],
    ink: { ...BASE, a: 0xd9a86e, A: 0xa8763f },
  },
  /** La bête de `beast` : ronde, poilue, GRANDS yeux — une peluche, pas un monstre. */
  beast: {
    grid: [
      '................',
      '...oo......oo...',
      '..ohho....ohho..',
      '..ohhhoooohhho..',
      '.ohhhhhhhhhhhho.',
      'ohhhhhhhhhhhhhho',
      'ohhwwwhhhhwwwhho',
      'ohhwewhhhhwewhho',
      'ohhwwwhhhhwwwhho',
      'ohhhhhhhhhhhhhho',
      'ohhhhhwwwwhhhhho',
      'ohhhhhwwwwhhhhho',
      '.ohhhhhhhhhhhho.',
      '..ohhhhhhhhhho..',
      '...ohhhhhhhho...',
      '....oooooooo....',
    ],
    ink: { ...BASE, h: 0xc39ae0, w: 0xfff3e2 },
  },
  /** Le géant de `ant` : un nuage joufflu à deux yeux. Il bloque, il n'écrase pas. */
  cloud: {
    grid: [
      '................',
      '......oooo......',
      '....oocccccoo...',
      '..oocccccccccoo.',
      '.occcccccccccco.',
      'occcccccccccccco',
      'occeccccccccecco',
      'occcccccccccccco',
      'occcccccccccccco',
      'occcccCCCCccccco',
      '.occcccccccccco.',
      '..ooccccccccoo..',
      '....oocccccoo...',
      '......oooo......',
      '................',
      '................',
    ],
    ink: { ...BASE, c: 0xe3d6ea, C: 0xb9a8c6 },
  },
  /** La fleur de `ant` : le but, visible en permanence à droite de l'arène (§1.1 critère 3). */
  flower: {
    grid: [
      '................',
      '....oo....oo....',
      '...oyyo..oyyo...',
      '..oyyyyooyyyyo..',
      '..oyyyyyyyyyyo..',
      '.oyyyyorroyyyyo.',
      '.oyyorrrrrroyyo.',
      '.oyyorrrrrroyyo.',
      '.oyyyorrrroyyyo.',
      '..oyyyyyyyyyyo..',
      '..oyyyyooyyyyo..',
      '...oyyo..oyyo...',
      '....oo.gg.oo....',
      '.......gg.......',
      '.....gggggg.....',
      '......gggg......',
    ],
    ink: { ...BASE, y: 0xffc95e, r: 0xef7d6a, g: 0xa9d97f },
  },
  /** Panier de `tree` : l'objet qui se remplit, jamais un score abstrait. */
  basket: {
    grid: [
      '................',
      '..oooooooooooo..',
      '.oaaaaaaaaaaaao.',
      '.oaAaAaAaAaAaao.',
      '.oaaaaaaaaaaaao.',
      '.oaAaAaAaAaAaao.',
      '..oaaaaaaaaaao..',
      '..oaAaAaAaAaao..',
      '..oaaaaaaaaaao..',
      '...oaaaaaaaao...',
      '...oooooooooo...',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    ink: { ...BASE, a: 0xd9a86e, A: 0xa8763f },
  },
  /** Porte de `mirror` : le but du parcours, poignée dorée. */
  door: {
    grid: [
      '..oooooooooooo..',
      '..oaaaaaaaaaao..',
      '..oaAAAAAAAAao..',
      '..oaAaaaaaaAao..',
      '..oaAaaaaaaAao..',
      '..oaAaaaaaaAao..',
      '..oaAaaaaaaAao..',
      '..oaAaaaaaaAao..',
      '..oaAaaaaayAao..',
      '..oaAaaaaaaAao..',
      '..oaAaaaaaaAao..',
      '..oaAaaaaaaAao..',
      '..oaAaaaaaaAao..',
      '..oaAaaaaaaAao..',
      '..oaaaaaaaaaao..',
      '..oooooooooooo..',
    ],
    ink: { ...BASE, a: 0xd9a86e, A: 0xa8763f, y: 0xffc95e },
  },
  /** Suspect de `suspects` : buste NEUTRE. Les 4 traits binaires se peignent par-dessus. */
  suspect: {
    grid: [
      '................',
      '....oooooooo....',
      '...okkkkkkkko...',
      '..okkkkkkkkkko..',
      '..okkkkkkkkkko..',
      '..okkekkkkekko..',
      '..okkkkkkkkkko..',
      '..okkkkKKkkkko..',
      '..okkkkkkkkkko..',
      '...okkkkkkkko...',
      '......okko......',
      '..ooocccccooo...',
      '.occccccccccco..',
      'occcccccccccccco',
      'occcccccccccccco',
      'oooooooooooooooo',
    ],
    ink: { ...BASE, c: 0x8f9fe0 },
  },
};
