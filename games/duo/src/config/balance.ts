/**
 * TOUT le tuning chiffré de la collection Duo. Invariant du dépôt : aucune
 * constante de gameplay ne vit ailleurs — ni dans un modèle, ni dans une vue,
 * ni dans le shell.
 *
 * Les huit micro-jeux se partagent ce fichier plutôt que d'en avoir un chacun :
 * ils sont écrits par des mains différentes et se relisent ensemble, et c'est
 * le seul endroit où l'on voit d'un coup d'œil qu'une manche dure bien 45 à
 * 90 s partout (§1.2, mode restaurant).
 *
 * `assertBalanceSane()` en fin de fichier est le garde-fou DEV : il est appelé
 * une fois au boot et casse bruyamment sur une incohérence de tuning, qui
 * autrement se lirait en jeu comme « ce jeu est bizarre » sans qu'on sache où.
 */

// ───────────────────────── Repères logiques ─────────────────────────
// §1.4 : deux ergonomies, jamais mélangées. Le letterbox prend la taille en
// PARAMÈTRE (cf. Shell.setLogical) — ne jamais réintroduire un 540/960 en dur
// dans le CSS ou dans une vue, sinon le passage d'un jeu `pass` à un jeu `side`
// décale tous les boutons transparents de l'overlay.

/** Posture 'pass' : téléphone tenu en main, portrait. */
export const PASS_W = 540;
export const PASS_H = 960;
/** Posture 'side' : téléphone posé à plat, paysage, deux enfants côte à côte. */
export const SIDE_W = 960;
export const SIDE_H = 540;

/** Largeur du tiers d'écran que possède chaque joueur en posture 'side'. */
export const SIDE_ZONE_W = 250;

/** Plancher de cible tactile, en pixels LOGIQUES (§1.1, corollaire ergonomique). */
export const TOUCH_MIN = 60;

// ───────────────────────── Shell ─────────────────────────

/** Durée visée d'une manche, en secondes — bornes du « mode restaurant » (§1.2). */
export const ROUND_MIN_SEC = 45;
export const ROUND_MAX_SEC = 90;

/** Cadence de rejeu d'une démonstration (§2.4), en secondes par coup. */
export const DEMO_STEP_SEC = 0.9;
/** Mouvement réduit : la démo ralentit (÷2) mais ne s'arrête JAMAIS — sinon la
 *  règle, qui ne s'enseigne que par ce geste, deviendrait illisible. */
export const DEMO_REDUCED_MUL = 2;
/** Pause entre deux boucles de démonstration. */
export const DEMO_LOOP_PAUSE_SEC = 1.2;

/** Délai avant l'ouverture de l'écran de résultat : on laisse voir la CAUSE
 *  (§1.1 critère 4) avant de recouvrir le plateau d'un panneau. */
export const RESULT_DELAY_SEC = 1.1;

// ───────────────────────── 3.1 plank — Le plateau à bille ─────────────────────────

/** Accélération de la bille par unité d'inclinaison (px/s² à inclinaison 1). */
export const PLANK_ACCEL = 900;
/** Frottement visqueux : fraction de vitesse conservée par seconde. */
export const PLANK_FRICTION = 0.12;
/** Vitesse maximale de la bille (px/s). Le sous-pas de collision est
 *  dimensionné dessus : à cette vitesse la bille ne doit traverser AUCUN mur. */
export const PLANK_VMAX = 520;
/** Rayon de la bille (px). */
export const PLANK_BALL_R = 14;
/** Retour élastique du curseur au centre au relâchement (fraction/s). */
export const PLANK_TILT_RETURN = 7;
/** Nombre de parcours écrits à la main, de difficulté croissante. */
export const PLANK_COURSES = 6;
/** Fin de manche au bout de ce temps si les 6 parcours ne sont pas finis. */
export const PLANK_TIME_LIMIT = 90;
/** ⭐ : trous noirs rétrécis, trou de sortie agrandi. Visible, donc admis. */
export const PLANK_STAR_HOLE_MUL = 0.7;
export const PLANK_STAR_GOAL_MUL = 1.3;
/** Sous-pas minimum de collision : la bille n'avance jamais de plus d'un
 *  demi-rayon par sous-pas (`ceil(v*dt / (r/2))`). */
export const PLANK_SUBSTEP_PX = PLANK_BALL_R / 2;

// ───────────────────────── 3.2 cake — Je coupe, tu choisis ─────────────────────────

/** Nombre de fruits sur le gâteau : tiré dans cette plage, TOUJOURS impair. */
export const CAKE_FRUITS = { min: 7, max: 11 } as const;
/** Écart minimal entre deux fruits, et entre un fruit et le bord (px). */
export const CAKE_MIN_GAP = 54;
/** Rayon du gâteau (px). */
export const CAKE_RADIUS = 200;
/** Nombre de coupes d'une manche — les rôles alternent, donc 3 chacun. */
export const CAKE_CUTS = 6;
/** Rayon des deux poignées de coupe : ≥ TOUCH_MIN/2, on tire au pouce. */
export const CAKE_HANDLE_R = 34;
/** ⭐ : un fruit préféré de plus sur le gâteau du joueur aidé. */
export const CAKE_STAR_BONUS_FRUIT = 1;
/**
 * ÉCART ASSUMÉ à « on tire au pouce » (commentaire de `CAKE_HANDLE_R`) :
 * chaque poignée avance par CRANS discrets autour du disque plutôt que par un
 * drag continu — c'est ce qui rend `cake` jouable AU CLAVIER SEUL (§5, l'un
 * des 5 jeux `pass` qui le doivent) sans traduire une position de pointeur à
 * travers le letterbox, que `MiniGameCtx` n'expose pas à un micro-jeu. Voir le
 * commentaire de `games/cake/view.ts`.
 */
export const CAKE_ANGLE_STEPS = 12;

// ───────────────────────── 3.3 tree — La branche coupée ─────────────────────────

/** Nombre d'arêtes du graphe (bornes de génération). */
export const TREE_EDGES = { min: 12, max: 18 } as const;
/** Profondeur de l'arbre (bornes de génération). */
export const TREE_DEPTH = { min: 3, max: 4 } as const;
/** Pommes par arête, plafond dur — assertion de génération. */
export const TREE_MAX_APPLES = 2;
/** Chaque joueur doit avoir au moins autant de coups légaux au premier tour. */
export const TREE_MIN_MOVES = 3;
/** ⭐ : jetons ✂ supplémentaires posés à côté du panier, dépensés au 1er tour. */
export const TREE_STAR_EXTRA_CUTS = 1;
/** Durée de la chute d'une branche coupée (s) — la récompense du jeu. */
export const TREE_FALL_SEC = 0.75;

// ───────────────────────── 3.4 tiles — Dominos croisés ─────────────────────────

export const TILES_COLS = 6;
export const TILES_ROWS = 6;
/** Cases bloquées tirées au seed : elles cassent l'avantage connu du 1er joueur. */
export const TILES_BLOCKED = { min: 2, max: 4 } as const;
/** Hauteur de la pile visible de chaque joueur, en tuiles. */
export const TILES_STACK = 12;
/** Chaque joueur doit avoir au moins autant de poses légales au départ. */
export const TILES_MIN_PLACEMENTS = 6;
/** ⭐ : tuiles déjà posées (positions seedées et légales), marquées d'une étoile. */
export const TILES_STAR_PREPLACED = 2;

// ───────────────────────── 3.5 mirror — Miroir cassé ─────────────────────────

/** Gravité (px/s²). */
export const MIRROR_GRAVITY = 1750;
/** Vitesse horizontale du personnage (px/s). */
export const MIRROR_MOVE_SPEED = 220;
/** Impulsion de saut (px/s, vers le haut). */
export const MIRROR_JUMP_VY = 620;
/**
 * Coyote time : le saut reste accepté ce temps-là APRÈS avoir quitté le sol.
 * C'est LE paramètre qui rend le jeu jouable à deux — sans lui, la
 * désynchronisation entre celui qui court et celui qui saute est fatale à
 * chaque bord de plateforme, et le jeu n'est plus drôle, il est injuste.
 */
export const MIRROR_COYOTE = 0.1;
/** Nombre de parcours ; les rôles s'échangent à chaque parcours. */
export const MIRROR_COURSES = 6;
/** Fin de manche au bout de ce temps si les 6 parcours ne sont pas finis. */
export const MIRROR_TIME_LIMIT = 90;
/** Demi-largeur / demi-hauteur de l'AABB du personnage (px). */
export const MIRROR_HALF_W = 13;
export const MIRROR_HALF_H = 18;

// ───────────────────────── 3.6 ant — Le géant et la fourmi ─────────────────────────

/** Vitesse de la fourmi (px/s). Un seul verbe : elle se déplace. */
export const ANT_SPEED = 190;
/** ⭐ : la fourmi aidée est plus rapide (annoncé par un pictogramme). */
export const ANT_STAR_SPEED_MUL = 1.15;
/** Délai entre deux blocs du géant (s). */
export const ANT_BLOCK_COOLDOWN = 1.2;
/** Durée de vie d'un bloc (s). */
export const ANT_BLOCK_LIFE = 8;
/**
 * Distance minimale entre un bloc posé et la fourmi (px). SANS cette garde, le
 * géant gagne en écrasant la fourmi et ce n'est plus un jeu — c'est la règle
 * qui fait exister le duel.
 */
export const ANT_BLOCK_MIN_DIST = 40;
/** Blocs vivants simultanément, au maximum. */
export const ANT_BLOCK_MAX = 6;
/** ⭐ : le géant qui affronte une fourmi aidée n'en a que 5. */
export const ANT_BLOCK_MAX_STAR = 5;
/** Côté d'un bloc (px). */
export const ANT_BLOCK_SIZE = 56;
/** Rayon de la fourmi (px). */
export const ANT_RADIUS = 15;
/** Durée d'une mi-temps (s) ; puis les rôles s'échangent. */
export const ANT_ROUND_TIME = 45;
/** Mort subite en cas d'égalité (s) — choisie plutôt qu'un départage calculé :
 *  un enfant de 5 ans comprend « on rejoue vite », pas « temps sans bloc ». */
export const ANT_SUDDEN_DEATH = 15;

// ───────────────────────── 3.7 beast — La bête sous le tapis ─────────────────────────

export const BEAST_COLS = 6;
export const BEAST_ROWS = 8;
/**
 * ═══ ARBITRAGE §1.2 CONTRE §3.7 — LA MANCHE NE COMPTE PLUS QU'UNE MOITIÉ ═══
 *
 * Les deux sections de la spec se contredisent, et le §1.2 est déclaré NON
 * NÉGOCIABLE : « une manche dure 45 à 90 s ». Or le §3.7 empile deux moitiés ×
 * jusqu'à 12 tours × (un déplacement + trois taps + une validation), avec un
 * ÉCRAN DE PASSAGE À CHAQUE demi-tour. Mesuré au bot sur 60 manches (politique
 * « la bête monte tout droit à 70 % », chasseur au hasard) : 77 gestes et 29
 * écrans de passage en MÉDIANE — soit, au budget assumé de 1,1 s par tap et
 * 2,5 s par passage (le tap PLUS la remise du téléphone), près de 160 s. Deux
 * fois et demie la bande.
 *
 * Ce n'est pas un défaut d'implémentation : les constantes étaient EXACTEMENT
 * celles du §3.7. C'est la STRUCTURE qui ne rentre pas, et le seul terme
 * divisible par deux sans toucher à une seule règle du jeu est le nombre de
 * moitiés. Réduire la grille à la place aurait été pire : la bête a besoin de
 * `rows - 1` déplacements, donc raccourcir la manche par les rangées revient à
 * lui offrir le haut avant que le chasseur n'ait rien appris — on aurait payé
 * la durée avec l'équilibre du jeu.
 *
 * CE QUI NE CHANGE PAS : la grille, le thermomètre, le budget de tours, les
 * trois cases éclairées, la mémoire du chasseur, les handicaps ⭐. Une moitié
 * se joue à la lettre du §3.7.
 * CE QUI CHANGE : les rôles ne s'échangent plus À L'INTÉRIEUR d'une manche
 * mais D'UNE MANCHE À L'AUTRE (le siège de la bête est retiré au seed de
 * chaque manche), et le vainqueur est celui qui a réussi son rôle — plus
 * besoin de départager deux moitiés. Le score de TABLE, que le shell cumule
 * déjà, porte la symétrie des rôles à la place du départage : c'est la même
 * promesse, sur l'échelle au-dessus.
 * Le départage à deux moitiés reste ÉCRIT et testé (`decide`) : remettre 2 ici
 * suffit à le rallumer si un jour la spec tranche dans l'autre sens.
 */
export const BEAST_HALVES: 1 | 2 = 1;
/**
 * Tours dont dispose la bête pour atteindre le haut. Ramené de 12 à 9 : à une
 * seule moitié la MÉDIANE tombe déjà à 77 s (mesurée, cf. `BEAST_HALVES`), mais
 * la QUEUE de distribution — la bête qui erre jusqu'au plafond de tours —
 * restait à 126 s ; 9 la ramène à 109. Il reste deux déplacements de rattrapage
 * sur les sept nécessaires : assez pour un pas de côté qui trompe le
 * thermomètre, pas assez pour tourner en rond. Descendre plus bas ne gagne plus
 * rien (mesuré à 8 : médiane inchangée, queue à 105) et coûterait le dernier
 * pas de côté — la bête n'aurait plus qu'à monter droit, et le jeu n'aurait
 * plus de cachette.
 */
export const BEAST_TURNS = 9;
/** ⭐ : la bête aidée en a deux de plus (le +2 du §3.7, qui pèse d'autant plus
 *  que la base a baissé — le handicap est plus franc qu'avant). */
export const BEAST_TURNS_STAR = 11;
/** Cases éclairées par le chasseur à chaque tour. */
export const BEAST_LIGHTS = 3;
/** ⭐ : le chasseur aidé en éclaire une de plus. */
export const BEAST_LIGHTS_STAR = 4;
/** Thermomètre : distance de Manhattan ≤ ce seuil = 🔥 chaud (2 barres). */
export const BEAST_WARM_MAX = 2;
/** … ≤ ce seuil = 🌤 tiède (1 barre) ; au-delà = ❄ froid (0 barre). */
export const BEAST_MILD_MAX = 4;

// ───────────────────────── 3.8 suspects — Six suspects ─────────────────────────

export const SUSPECTS_COUNT = 6;
/** Traits binaires : chapeau, lunettes, écharpe, pull rouge. */
export const SUSPECTS_TRAITS = 4;
/** Questions posables avant l'accusation. */
export const SUSPECTS_QUESTIONS = 3;
/** Manches d'une partie ; les rôles s'échangent à chaque manche. */
export const SUSPECTS_ROUNDS = 4;
/** Côté minimal d'un portrait de suspect (px) : lisible au premier coup d'œil. */
export const SUSPECT_PORTRAIT_PX = 120;

// ───────────────────────── Garde-fou DEV ─────────────────────────

function must(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[duo/balance] ${msg}`);
}

/**
 * Vérifie la COHÉRENCE du tuning, pas ses valeurs : chaque assertion protège
 * une règle du §1 ou une garantie du §3 qui, violée, ne se verrait qu'en jeu.
 * Appelée une fois au boot en DEV (cf. main.ts).
 */
export function assertBalanceSane(): void {
  // §1.4 — les deux repères sont bien deux orientations du MÊME cadre : c'est
  // ce qui garantit qu'un letterbox `Math.min(w/W, h/H)` donne la même échelle
  // utile dans les deux postures, sur le même téléphone.
  must(PASS_W < PASS_H, 'la posture pass doit être portrait');
  must(SIDE_W > SIDE_H, 'la posture side doit être paysage');
  must(PASS_W === SIDE_H && PASS_H === SIDE_W, 'les deux repères doivent être la transposée l’un de l’autre');
  must(SIDE_ZONE_W * 2 < SIDE_W, 'les deux tiers joueurs doivent laisser de la place au jeu au centre');
  must(TOUCH_MIN >= 60, 'plancher de cible tactile : 60 px logiques (§1.1)');

  // §1.2 — mode restaurant : aucune manche ne dépasse 90 s d'horloge.
  must(ROUND_MIN_SEC < ROUND_MAX_SEC, 'bornes de durée de manche incohérentes');
  must(PLANK_TIME_LIMIT <= ROUND_MAX_SEC, 'plank dépasse la manche maximale');
  must(MIRROR_TIME_LIMIT <= ROUND_MAX_SEC, 'mirror dépasse la manche maximale');
  must(ANT_ROUND_TIME * 2 <= ROUND_MAX_SEC, 'ant (deux mi-temps) dépasse la manche maximale');
  must(ANT_SUDDEN_DEATH > 0 && ANT_SUDDEN_DEATH < ANT_ROUND_TIME, 'la mort subite doit être plus courte qu’une mi-temps');
  must(DEMO_REDUCED_MUL >= 1, 'la démo ralentit en mouvement réduit, elle ne s’arrête jamais');

  // §3.1 — la bille ne doit jamais traverser un mur : le sous-pas doit rester
  // franchement inférieur au rayon, sinon la garde géométrique ne tient plus.
  must(PLANK_SUBSTEP_PX > 0 && PLANK_SUBSTEP_PX <= PLANK_BALL_R / 2, 'sous-pas de collision trop grossier');
  must(PLANK_VMAX > 0 && PLANK_ACCEL > 0, 'physique de plank non initialisée');
  must(PLANK_FRICTION > 0 && PLANK_FRICTION < 1, 'le frottement est une fraction ouverte');
  must(PLANK_STAR_HOLE_MUL < 1 && PLANK_STAR_GOAL_MUL > 1, '⭐ doit AIDER : trous plus petits, sortie plus grande');
  must(PLANK_COURSES === 6, 'six parcours écrits à la main');

  // §3.2 — le compte de fruits est impair aux deux bornes : une égalité
  // parfaite face à un enfant de 5 ans est une manche perdue pour rien.
  must(CAKE_FRUITS.min % 2 === 1 && CAKE_FRUITS.max % 2 === 1, 'les bornes de fruits doivent être impaires');
  must(CAKE_FRUITS.min >= 7 && CAKE_FRUITS.max <= 11, 'plage de fruits hors spec');
  must(CAKE_MIN_GAP * 2 < CAKE_RADIUS, 'les fruits ne tiendraient pas sur le gâteau');
  must(CAKE_HANDLE_R * 2 >= TOUCH_MIN, 'les poignées de coupe doivent faire ≥ 60 px');
  must(CAKE_CUTS % 2 === 0, 'les rôles alternent : le nombre de coupes doit être pair');
  must(CAKE_ANGLE_STEPS >= 6, 'assez de crans pour une coupe précise (cake)');
  // PAIR : sans cran diamétralement opposé, aucune corde ne passe par le
  // centre du gâteau, donc la coupe ÉQUITABLE — celle que le jeu enseigne —
  // devient géométriquement inatteignable.
  must(CAKE_ANGLE_STEPS % 2 === 0, 'un cran doit faire face à chaque cran (coupe par le centre)');

  // §3.3 / §3.4 — les garanties de génération, côté tuning.
  must(TREE_EDGES.min >= TREE_MIN_MOVES * 2, 'trop peu d’arêtes pour garantir 3 coups à chacun');
  must(TREE_MAX_APPLES >= 1, 'un arbre sans pomme n’a pas de but visible (§1.1 critère 3)');
  must(TREE_STAR_EXTRA_CUTS >= 1, '⭐ doit donner un jeton ✂ visible');
  must(TILES_COLS === 6 && TILES_ROWS === 6, 'grille 6×6');
  must(TILES_BLOCKED.min >= 2 && TILES_BLOCKED.max <= 4, 'cases bloquées hors spec');
  must(
    TILES_STACK * 2 >= (TILES_COLS * TILES_ROWS - TILES_BLOCKED.max) / 2,
    'les piles doivent pouvoir couvrir le plateau, sinon la fin de manche est une pénurie et non un blocage',
  );
  must(TILES_STAR_PREPLACED * 2 < TILES_STACK, '⭐ ne doit pas vider la pile avant de jouer');

  // §3.5 — le coyote time est ce qui pardonne la désynchronisation.
  must(MIRROR_COYOTE > 0 && MIRROR_COYOTE <= 0.3, 'coyote time hors plage jouable');
  must(MIRROR_JUMP_VY > 0 && MIRROR_GRAVITY > 0, 'physique de mirror non initialisée');
  must(MIRROR_COURSES % 2 === 0, 'les rôles s’échangent à chaque parcours : nombre pair');

  // §3.6 — sans la garde de distance, le géant gagne en écrasant.
  must(ANT_BLOCK_MIN_DIST > ANT_RADIUS, 'la garde doit dépasser le rayon de la fourmi');
  must(ANT_BLOCK_MAX_STAR < ANT_BLOCK_MAX, '⭐ doit AFFAIBLIR le géant d’en face');
  must(ANT_STAR_SPEED_MUL > 1, '⭐ doit accélérer la fourmi');
  must(ANT_BLOCK_COOLDOWN > 0 && ANT_BLOCK_LIFE > ANT_BLOCK_COOLDOWN, 'un bloc doit vivre plus longtemps que le délai de pose');

  // §3.7 — le thermomètre est monotone, et ⭐ aide bien celui qu'il prétend aider.
  must(BEAST_WARM_MAX < BEAST_MILD_MAX, 'thermomètre non monotone');
  must(BEAST_MILD_MAX < BEAST_COLS + BEAST_ROWS, 'le palier froid serait inatteignable');
  must(BEAST_TURNS_STAR > BEAST_TURNS, '⭐ doit donner des tours en plus à la bête');
  must(BEAST_LIGHTS_STAR > BEAST_LIGHTS, '⭐ doit donner une case en plus au chasseur');
  must(BEAST_TURNS >= BEAST_ROWS - 1, 'la bête doit pouvoir atteindre le haut en jouant droit');
  // Une manche à zéro moitié n'a pas de vainqueur, et au-delà de deux le
  // départage de `beast/model.ts` (écrit pour un couple) ne sait plus trancher.
  must(BEAST_HALVES === 1 || BEAST_HALVES === 2, 'beast : 1 ou 2 moitiés par manche');
  must(BEAST_LIGHTS < BEAST_COLS * BEAST_ROWS, 'le chasseur ne doit pas pouvoir tout éclairer');

  // §3.8 — 3 questions binaires séparent au plus 8 profils : 6 suspects passent.
  must(SUSPECTS_COUNT <= 2 ** SUSPECTS_QUESTIONS, '3 questions ne peuvent pas séparer plus de 8 suspects');
  must(SUSPECTS_COUNT <= 2 ** SUSPECTS_TRAITS, 'pas assez de traits pour 6 profils distincts');
  must(SUSPECTS_ROUNDS % 2 === 0, 'les rôles s’échangent à chaque manche : nombre pair');
  must(SUSPECT_PORTRAIT_PX >= TOUCH_MIN * 2, 'un portrait doit rester lisible au premier coup d’œil');
}
