# Prompt d'implémentation — « Duo », collection 2 joueurs sur un même téléphone

> Ce fichier EST le prompt. Il se donne tel quel à une IA autonome disposant du dépôt.
> Tout ce qui suit est une spécification contraignante : les chiffres, les noms de
> fichiers et les règles de jeu sont des décisions prises, pas des suggestions.

---

## 0. Mission

Ajouter au hub **Rendilo Reale** un sixième jeu, `games/duo/`, qui est une **collection de
8 micro-jeux à deux joueurs sur un seul téléphone**, conçue pour occuper **deux enfants de
5 et 8 ans** pendant une attente (restaurant, salle d'attente).

Tu travailles sur une branche dédiée, tu commites par étapes lisibles, tu pousses ;
**tu n'ouvres pas de pull request** sauf demande explicite.

**Avant d'écrire une ligne**, lis `CLAUDE.md` en entier : il contient les invariants
d'architecture du dépôt (boucle 60 Hz, pools SoA, canvas `aria-hidden` + DOM natif,
saves versionnées, bots de vérification). Cette spec s'appuie dessus et n'y déroge nulle
part sans le dire.

---

## 1. Les quatre contraintes non négociables

Ce sont elles qui décident des arbitrages. Toute décision d'implémentation qui en viole
une est une erreur, même si le résultat « marche ».

### 1.1 Le test des 5 ans

Chacun des 8 jeux doit satisfaire les quatre critères suivants. Si une implémentation
en viole un, corrige le JEU, pas le critère.

1. **La règle est un geste, pas une phrase.** Elle s'enseigne par une boucle animée de
   3 secondes, sans un mot. Aucun jeu n'a d'écran de règles écrites.
2. **Le coup illégal est physiquement impossible.** Une case, un bouton, une branche non
   jouable est inerte (`disabled` côté DOM, non tappable, visiblement en retrait). Le jeu
   n'affiche jamais « coup interdit » : il ne le laisse pas arriver.
3. **Le but est un objet visible en permanence** (un trou, un panier de pommes, une pile de
   tuiles, une fleur), jamais une condition abstraite du type « celui qui ne peut plus
   jouer perd ». Cette condition peut rester la règle interne, mais l'écran doit montrer
   un objet qui se remplit.
4. **La défaite a une cause à l'écran.** À la fin d'une manche, l'écran de résultat montre
   POURQUOI (le panier de l'autre est plus plein, la bille est tombée dans le trou noir).

Corollaires ergonomiques : **toute cible tactile fait ≥ 60 px** dans le repère logique, et
**aucun jeu ne demande un tracé de précision** au doigt.

### 1.2 Le mode restaurant

- Une manche dure **45 à 90 s**. Aucun jeu n'a de partie longue. « Encore » est à un tap.
- **Muet par défaut** (`save.muted` initialisé à `true` — écart assumé avec les autres
  jeux du hub, qui démarrent avec le son). Un bouton 🔊 le rétablit.
- **Aucun geste de secousse**, aucun balayage ample, aucun besoin de lever le téléphone.
- **Aucun flash, aucun stroboscope** (WCAG 2.3.1) : il y a une table à côté.
- **Pause instantanée et reprise à l'identique** : un bouton ⏸ toujours atteignable met le
  jeu en pause exacte (les jeux temps réel figent leur accumulateur, les jeux au tour par
  tour n'ont rien à faire). Le plat arrive au milieu de la manche, c'est le cas nominal.
- **Zéro texte à lire pour jouer.** Le joueur de 5 ans ne lit pas. Les libellés écrits
  existent (accessibilité, joueur de 8 ans), mais rien d'essentiel ne passe QUE par eux.

### 1.3 L'écart d'âge est le sujet, pas un accident

- **Le handicap est un OBJET VISIBLE, jamais un chiffre caché.** Le petit commence avec
  deux tuiles déjà posées, il coupe deux fois à son premier tour, il a deux coups de lampe
  de plus. C'est annoncé par un pictogramme sur le plateau. Un multiplicateur invisible est
  interdit : le grand crie à la triche, le petit ne comprend pas sa victoire.
- Réglage **⭐ / ⭐⭐ par joueur**, global à la collection, mémorisé, choisi une fois à
  l'accueil par un tap sur sa mascotte. Il modifie les **chiffres**, jamais les règles.
- **Le perdant choisit le jeu suivant.** À la fermeture de l'écran de résultat, le menu
  s'ouvre avec la mascotte du perdant en tête de bandeau et un halo sur la grille. C'est la
  seule règle de méta de la collection, et elle est obligatoire.
- **Aucun palmarès persistant entre les sessions.** Le score cumulé de la table vit en
  mémoire et meurt à la fermeture de l'onglet. Le schéma de save ne contient AUCUN
  compteur de victoires par joueur — c'est une décision de design, et `meta/save.ts` est
  l'endroit où on la fait respecter (même discipline que l'absence d'économie dans le save
  de Berceau).

### 1.4 Deux ergonomies, jamais mélangées

Chaque jeu déclare son `posture` :

- **`'pass'`** — téléphone **tenu en main, portrait, repère logique 540×960**. Les joueurs
  se le passent. Entre deux tours, un plein écran « **passe le téléphone à 🐰** » affiche
  la mascotte du destinataire et attend un tap de SA part (le tap est le contrat : il n'y a
  pas de vol de tour).
- **`'side'`** — téléphone **posé à plat sur la table, paysage, repère logique 960×540**,
  les deux enfants **assis côte à côte, même orientation** (banquette de restaurant).
  Chacun possède un tiers d'écran : joueur 1 à gauche, joueur 2 à droite, le jeu au
  centre. On n'essaie PAS de faire une vue lisible dans les deux sens ; le côte-à-côte est
  une hypothèse assumée et écrite dans le code.

Le letterbox s'applique au repère logique du jeu courant. Passer d'un jeu `pass` à un jeu
`side` change la taille logique : le moteur de mise à l'échelle doit la prendre en
paramètre, pas la constanter.

---

## 2. Architecture

### 2.1 Un seul jeu de hub, huit micro-jeux dedans

**`games/duo/` est UNE entrée du hub, pas huit.** Sinon le menu du hub explose et chaque
micro-jeu repaie un boot Pixi. Le sous-menu interne est la grille de sélection.

À enregistrer (les DEUX listes doivent rester synchrones, cf. `CLAUDE.md`) :

- `hub/games.ts` → `{ id: 'duo', title: 'Duo', tagline: 'Huit jeux à deux sur un seul téléphone.', path: '/games/duo/', emoji: '👫' }`
- `vite.config.ts` → `build.rollupOptions.input.duo = resolve(__dirname, 'games/duo/index.html')`

`registerSW` est appelé par la page comme dans les autres jeux. Rien à toucher au service
worker (précache par glob).

### 2.2 Arborescence imposée

```
games/duo/
  index.html                  # viewport SANS user-scalable=no, touch-action sur le canvas seul
  src/
    main.ts                   # boot Pixi, letterbox paramétré par la taille logique
    config/
      balance.ts              # TOUT le tuning chiffré de la collection (aucune constante ailleurs)
      games.ts                # registre des 8 micro-jeux (id, titre, emoji, posture, mode, demo)
      mascots.ts              # 6 mascottes : emoji, nom, teinte, forme du socle
    core/
      minigame.ts             # l'interface MiniGame (contrat unique, cf. §2.3)
      session.ts              # état de table : mascottes, ⭐, score éphémère, « le perdant choisit »
      demo.ts                 # rejoueur de démonstration (liste de coups → modèle réel)
    games/
      plank/    { model.ts, view.ts, index.ts }   # Le plateau à bille   (side, coop, temps réel)
      cake/     { model.ts, view.ts, index.ts }   # Je coupe, tu choisis (pass, duel, tour par tour)
      tree/     { model.ts, view.ts, index.ts }   # La branche coupée    (pass, duel, tour par tour)
      tiles/    { model.ts, view.ts, index.ts }   # Dominos croisés      (pass, duel, tour par tour)
      mirror/   { model.ts, view.ts, index.ts }   # Miroir cassé         (side, coop, temps réel)
      ant/      { model.ts, view.ts, index.ts }   # Le géant et la fourmi(side, asym, temps réel)
      beast/    { model.ts, view.ts, index.ts }   # La bête sous le tapis(pass, asym, tour par tour)
      suspects/ { model.ts, view.ts, index.ts }   # Six suspects         (pass, asym, tour par tour)
    meta/save.ts              # rendilo-reale:duo:save:v1
    render/
      layers.ts textures.ts sprites.ts fx.ts ambience.ts
    ui/
      hud.ts screens.ts pass.ts   # pass.ts = l'écran « passe le téléphone à 🐰 »
    audio/sfx.ts
```

`model.ts` est **pur** : ni horloge, ni `Math.random`, ni DOM, ni Pixi, ni import de
`view.ts`. `view.ts` ne mute jamais le modèle. `index.ts` câble les deux et expose le
`MiniGame`. Cette séparation est ce qui rend le bot capable de rejouer un jeu entier hors
de la page (comme `combat.ts` dans Trois Portes) — ne pas la casser.

### 2.3 Le contrat `MiniGame`

Un seul contrat pour les huit, sinon le shell devient un `switch` géant.

```ts
export type Posture = 'pass' | 'side';
export type Mode = 'coop' | 'duel' | 'asym';

export interface MiniGameDef {
  id: string;
  title: string;          // libellé DOM (accessibilité) — jamais requis pour jouer
  emoji: string;
  posture: Posture;
  mode: Mode;
  logical: { w: number; h: number };   // 540×960 (pass) ou 960×540 (side)
  create(ctx: MiniGameCtx): MiniGame;
}

export interface MiniGameCtx {
  stage: Container;        // racine Pixi du micro-jeu (vidée par le shell à la sortie)
  overlay: HTMLElement;    // conteneur DOM des boutons transparents (même letterbox)
  seed: number;            // tiré par le shell, rejouable
  stars: [1 | 2, 1 | 2];   // niveau ⭐ de chaque joueur, dans l'ordre des sièges
  onTurn(player: 0 | 1): void;      // demande au shell l'écran de passage (posture 'pass')
  onAnnounce(text: string): void;   // ligne de région live (#sr-log)
  onOver(result: Result): void;     // fin de manche
}

export interface Result {
  winner: 0 | 1 | null;    // null = coop (ou égalité impossible : voir §3)
  scores: [number, number];
  reason: string;          // phrase courte affichée + annoncée : « 7 pommes contre 5 »
}

export interface MiniGame {
  update(dt: number): void;              // 60 Hz fixe ; no-op pour les jeux au tour par tour
  render(alpha: number): void;           // interpolation prev/cur pour tout ce qui bouge
  setPaused(p: boolean): void;
  destroy(): void;
}
```

Le shell (`main.ts` + `core/session.ts`) possède la boucle (`@shared/loop`), le letterbox,
la pause, l'écran de passage, l'écran de résultat, le menu et la save. **Un micro-jeu ne
touche jamais au `localStorage`** — même discipline que « seul `flow.ts` écrit la save »
dans les autres jeux du hub.

### 2.4 La démonstration EST un rejeu du modèle réel

Chaque micro-jeu exporte une **liste de coups canoniques** (`demo: Move[]`) que
`core/demo.ts` rejoue **à travers le modèle réel**, à cadence lente, en boucle. Cette même
démo sert :

1. de vignette animée dans la grille du menu (rendue en petit) ;
2. de premier écran quand le jeu n'a jamais été lancé (elle tourne, un tap la coupe).

**Interdit d'écrire une animation de démonstration séparée** : elle divergerait de la règle
au premier ajustement, et c'est exactement le tutoriel qui doit rester vrai.

---

## 3. Les huit jeux

Notation commune : `P0` = joueur du siège gauche / premier à jouer, `P1` = l'autre.
Tous les tirages passent par `mulberry32` de `@shared/rng`. **Zéro `Math.random` dans le
contenu** : une manche doit être rejouable à seed égale (c'est ce qui rend le bot fiable).

Sauf mention contraire, **une égalité est structurellement impossible** : la génération
garantit un total impair, ou un départage lisible est défini. Un match nul face à un enfant
de 5 ans est une manche perdue pour rien.

---

### 3.1 `plank` — Le plateau à bille · `side` · coop · temps réel

**Une planche, deux commandes.** Vue de dessus d'un plateau ; une bille roule dessus.

- **P0 contrôle l'inclinaison en X**, P1 **l'inclinaison en Y**. Chacun a, sur son tiers
  d'écran, un **curseur** vertical (P1) ou horizontal (P0) de 60 px de large, tiré au
  pouce, rappel élastique au centre au relâchement. L'axe de chacun est dessiné sur le
  plateau par une flèche de sa teinte : le joueur voit littéralement ce qu'il possède.
- Physique : `accel = (tiltX, tiltY) * PLANK_ACCEL`, frottement `PLANK_FRICTION`, vitesse
  bornée `PLANK_VMAX`. Intégration à pas fixe, **sous-pas de collision** (au moins
  `ceil(v*dt / (rayon/2))` sous-pas) : la bille ne doit **jamais** traverser un mur, quelle
  que soit la vitesse. Le bot le vérifie.
- Terrain : liste de rectangles (murs), un **trou de sortie** (disque vert, but), des
  **trous noirs** (pièges). Tomber dans un piège = **replacement immédiat** au dernier
  point de contrôle, sans écran, sans message, avec un petit fx. La punition doit coûter
  3 secondes, pas la manche.
- **6 parcours** de difficulté croissante, écrits à la main en données (pas générés) :
  1 couloir droit → 2 virage → 3 première fosse → 4 chicane → 5 pont étroit →
  6 spirale. Objectif : ~20 s par parcours pour un adulte, ~40 s pour les enfants.
- Fin de manche : les 6 parcours terminés, ou **90 s** écoulées. `winner: null`,
  `scores = [parcours, parcours]` (score commun affiché une seule fois),
  `reason: '4 parcours sur 6'`.
- ⭐ : si l'un des deux joueurs est ⭐, les trous noirs sont **plus petits** (`× 0.7`) et le
  trou de sortie **plus grand** (`× 1.3`). Visible, donc admis.
- Clavier (desktop, et test du bot) : P0 = `KeyA`/`KeyD`, P1 = `ArrowUp`/`ArrowDown`.

**C'est le premier jeu à construire.** Zéro règle, un but visible, coop : s'il ne tient pas
trois minutes, rien ne tiendra.

---

### 3.2 `cake` — Je coupe, tu choisis · `pass` · duel · tour par tour

**Un gâteau, une coupe, l'autre choisit.** Le seul jeu de la collection qui fait rire
au-delà de l'écran.

- Chaque joueur a un **fruit préféré**, annoncé par sa mascotte au début (le lapin aime les
  🍓, le renard les 🫐). Les deux préférences sont **différentes**.
- Le gâteau est un disque portant `CAKE_FRUITS` (7 à 11) fruits des deux types, posés en
  positions seedées, jamais à moins de `CAKE_MIN_GAP` px l'un de l'autre ni du bord.
- **Tour du coupeur** : il fait glisser une **droite** matérialisée par deux grosses
  poignées (≥ 60 px) accrochées au bord du disque. La coupe est toujours une corde du
  cercle. Les deux parts se **détachent visuellement** en temps réel, et **chaque part
  affiche le compte de chaque fruit en clair** (pictogramme + nombre). Montrer les comptes
  n'affaiblit pas le jeu : la tension vient de ce que le coupeur ne sait pas ce que
  l'autre va privilégier, pas d'un calcul caché — et sans ces comptes, un enfant de 5 ans
  ne peut pas jouer.
- Validation → **écran de passage** → **tour du choisisseur** : deux gros boutons, une part
  chacun. Il prend, l'autre reçoit le reste.
- Score de la manche = nombre de **ses** fruits préférés obtenus. **6 coupes**, les rôles
  alternent à chaque coupe (donc 3 chacun).
- Départage : total de fruits toutes catégories ; puis, si encore égal, le **choisisseur du
  dernier tour** gagne. La génération garantit `CAKE_FRUITS` impair ET une asymétrie de
  répartition qui rend l'égalité parfaite improbable — le départage est un filet, pas la
  règle.
- ⭐ : le joueur ⭐ coupe le **premier** de chaque paire de tours (couper est plus facile
  que d'anticiper), et son gâteau porte **un fruit préféré de plus**.

---

### 3.3 `tree` — La branche coupée (Hackenbush aux pommes) · `pass` · duel · tour par tour

**Coupe une brindille de ta couleur ; ce qui n'est plus relié au sol tombe ; les pommes
tombées sont pour toi.**

- Le modèle est un graphe : `nodes` (dont le nœud 0 = le **sol**), `edges` avec
  `{ a, b, color: 0 | 1 | 2, apples: 0..2 }`. `color 2` = branche **marron**, coupable par
  les deux (c'est le seul « choix supplémentaire » et il ne coûte aucune règle : la couleur
  se voit).
- **Tour** : le joueur tape une arête de sa couleur ou marron. Les autres sont inertes
  (critère 2). L'arête disparaît, puis **toute arête qui n'a plus de chemin vers le sol
  tombe** (parcours depuis le nœud 0). **Toutes les pommes des arêtes tombées vont au
  panier du coupeur**, en animation.
- Fin : plus aucune arête coupable par qui que ce soit. **Le panier le plus rempli gagne.**
  Un joueur sans coup légal **passe automatiquement** (sans écran de passage inutile) tant
  que l'autre peut jouer.
- Génération (seedée) : 12 à 18 arêtes, profondeur 3 à 4, comptes de couleurs équilibrés à
  ±1, **total de pommes IMPAIR**, et assertion DEV : chaque joueur a **≥ 3 coups légaux**
  au premier tour, et aucune arête ne porte plus de `TREE_MAX_APPLES` pommes.
- ⭐ : le joueur ⭐ **coupe deux fois à son premier tour**, matérialisé par deux jetons
  ✂✂ posés à côté de son panier, qu'il dépense.
- Rendu : la chute est l'événement le plus important du jeu. Elle doit être franche
  (rotation + chute + rebond des pommes vers le panier). C'est la récompense.

---

### 3.4 `tiles` — Dominos croisés (Domineering) · `pass` · duel · tour par tour

**Toi tu poses debout, moi je pose couché. Qui vide le plus sa pile ?**

- Grille **6×6**, avec 2 à 4 cases **bloquées** tirées au seed (elles varient la partie et
  cassent l'avantage connu du premier joueur).
- P0 pose des tuiles **verticales** (2 cases empilées), P1 des **horizontales**. Chacun a
  une **pile visible de 12 tuiles** à son bord de plateau ; poser en retire une.
- **Toutes les poses légales sont surlignées en permanence** (léger, pointillé) et **seules
  elles sont tappables**. Un tap pose, avec un « thunk ».
- On joue **jusqu'à ce que plus personne ne puisse poser** (un joueur bloqué passe
  automatiquement, l'autre continue). **Le plus de tuiles posées gagne.** Départage : le
  **dernier à avoir posé** gagne (c'est la règle classique de Domineering, et elle se lit
  en clair : « c'est moi qui ai posé la dernière »).
- ⭐ : le joueur ⭐ commence avec **2 tuiles déjà posées** sur le plateau (positions seedées
  et légales), marquées d'une petite étoile.
- Assertion DEV de génération : au départ, chaque joueur a **≥ 6 poses légales**.

---

### 3.5 `mirror` — Miroir cassé · `side` · coop · temps réel

**Un seul personnage, deux commandes.** P0 le déplace, P1 le fait sauter. Le rire vient de
la désynchronisation, pas de la victoire.

- Vue de côté, **un écran par parcours** (pas de scrolling — la caméra fixe évite tout
  problème de lecture partagée). Plateformes, un trou, une porte à atteindre.
- P0 : deux gros boutons ◀ ▶ (ou un curseur horizontal) sur son tiers. P1 : **un** bouton
  SAUT plein tiers, immense. Un verbe chacun, pas deux.
- Physique plateforme minimale : gravité, AABB, résolution X puis Y séparément (comme le
  bébé de Berceau), pas de saut mural, coyote time `MIRROR_COYOTE` (0,1 s) pour pardonner
  la désynchro — c'est le paramètre qui rend le jeu jouable à deux.
- Chute = **réapparition immédiate au dernier point de contrôle**, sans écran.
- **6 parcours**, les rôles **s'échangent à chaque parcours** (donc chacun saute 3 fois).
  Fin après les 6 parcours ou 90 s. `winner: null`.
- Clavier : P0 `KeyA`/`KeyD`, P1 `ArrowUp` ou `Space`.

---

### 3.6 `ant` — Le géant et la fourmi · `side` · asym · temps réel

**Le petit court, le grand bloque.** Vue **de dessus**, arène 960×540 avec un départ à
gauche et une fleur à droite.

- **La fourmi** (un joueur) : joystick sur son tiers d'écran, se déplace librement.
  Un seul verbe.
- **Le géant** (l'autre) : **tape n'importe où dans l'arène** pour y faire tomber un bloc.
  `ANT_BLOCK_COOLDOWN` 1,2 s, **6 blocs vivants au maximum**, chaque bloc s'efface après
  `ANT_BLOCK_LIFE` 8 s. Il ne peut PAS poser un bloc sur la fourmi ni à moins de
  `ANT_BLOCK_MIN_DIST` (40 px) d'elle — sans cette garde le géant gagne en écrasant, et
  ça n'est pas un jeu.
- La fourmi marque **1 point par traversée**, puis réapparaît au départ. Manche = **45 s**,
  puis **les rôles s'échangent** et on refait 45 s. Le score le plus élevé en tant que
  fourmi gagne. Égalité : le total de temps passé sans bloc adjacent départage — plus
  simple : en cas d'égalité, une **manche de mort subite de 15 s**. Choisis la mort subite.
- ⭐ : la fourmi ⭐ est **plus rapide** (`× 1.15`) et le géant en face a **5 blocs** au lieu
  de 6. Les deux différences sont annoncées par un pictogramme au lancement.

---

### 3.7 `beast` — La bête sous le tapis · `pass` · asym · tour par tour

**L'un se cache et avance, l'autre éclaire.**

- Grille **6 colonnes × 8 rangées**. La bête part sur la **rangée du bas** (colonne
  seedée), doit atteindre la **rangée du haut**.
- **Tour de la bête** : elle voit sa position ; elle se déplace d'**une case orthogonale**
  (les 4 directions, mais jamais hors grille). Elle **doit** bouger.
- **Écran de passage.**
- **Tour du chasseur** : il tape **3 cases** puis valide. Si la bête est sur l'une d'elles,
  **il gagne immédiatement**. Sinon, chaque case éclairée affiche un **thermomètre** selon
  la distance de Manhattan à la bête : `0` impossible (capturée), `1-2` 🔥 chaud,
  `3-4` 🌤 tiède, `≥5` ❄ froid. Le thermomètre est **une couleur ET un pictogramme ET un
  nombre de barres** (triple codage — jamais la couleur seule).
- Les cases éclairées aux tours précédents restent affichées, en atténué, avec leur
  thermomètre : c'est la mémoire du chasseur, et un enfant de 5 ans ne peut pas la tenir de
  tête.
- La bête gagne si elle atteint le haut. Le chasseur gagne s'il la touche **ou** si la bête
  n'y est pas arrivée en `BEAST_TURNS` (12) tours — une barre de progression le montre.
- Puis **les rôles s'échangent** : le vainqueur de la manche est celui qui a réussi son
  rôle le plus vite (bête : en moins de tours ; chasseur : en moins de tours). Départage
  défini et déterministe, à écrire dans `model.ts` et à tester.
- ⭐ : la bête ⭐ a **14 tours** ; le chasseur ⭐ éclaire **4 cases**.

---

### 3.8 `suspects` — Six suspects · `pass` · asym · tour par tour

**Trois questions, une accusation.** Le seul jeu de la collection où trois ans d'écart ne
servent presque à rien.

- **6 suspects**, chacun défini par **4 traits binaires** : chapeau, lunettes, écharpe,
  pull rouge (vs bleu). Les six sont dessinés en grand (≥ 120 px), les traits **lisibles
  au premier coup d'œil**.
- La génération seedée doit garantir que les 6 profils sont **deux à deux distincts** ET
  que **3 questions bien choisies suffisent toujours** à isoler le coupable (système
  séparateur). Vérifie-le par **recherche exhaustive** à la génération (`4 parmi 4`,
  2^3 réponses possibles) et **rejette le tirage** sinon — c'est bon marché et ça évite une
  manche insoluble.
- **Tour de A** : il tape un suspect (c'est le coupable). Écran de passage.
- **Tour de B** : il tape jusqu'à **3 questions** parmi 4 pictogrammes. Le jeu **répond
  lui-même** oui/non (pas d'échange verbal : pas de bruit, pas d'arbitrage, pas de
  mensonge involontaire). Puis il **accuse** en tapant un suspect.
- Trouvé = **1 point**. Rôles échangés à chaque manche, **4 manches**. En cas d'égalité,
  une 5ᵉ manche.
- ⭐ **appliqué à l'information, pas aux chiffres** : pour le joueur ⭐, les suspects
  éliminés par les réponses se **grisent automatiquement**. Pour ⭐⭐, non : il doit
  déduire. La différence est visible des deux côtés, donc acceptée.

---

## 4. Le shell

### 4.1 Accueil et menu

1. **Premier lancement** : choix des mascottes. Deux emplacements côte à côte, 6 animaux
   (`config/mascots.ts` : emoji + nom + teinte + **forme de socle distincte**, triple
   codage WCAG). Un tap sur un animal, un tap sur ⭐ ou ⭐⭐. Rien d'autre. Mémorisé.
2. **Menu** : grille de 8 vignettes, chacune animée par sa **démo** en boucle
   (§2.4), avec l'emoji, le titre, et **deux pictogrammes** : posture (📱 en main / 🀫 à
   plat) et mode (🤝 ensemble / ⚔ l'un contre l'autre). Aucun texte requis.
3. **Bandeau** : les deux mascottes, le score éphémère de la table (`3 – 1`), 🔊, ⏸.
   Quand « le perdant choisit » est actif, sa mascotte est agrandie et la grille porte un
   halo de sa teinte, avec `aria-live` : « au tour du lapin de choisir ».

### 4.2 Écran de passage (posture `pass`)

Plein écran, fond de la teinte du destinataire, sa mascotte en très grand, une flèche
animée, et **un seul bouton plein écran** « c'est à toi ». Il masque totalement le plateau
(un `visibility:hidden` sur le canvas, pas seulement un voile — un voile semi-transparent
laisse deviner). Rien d'autre n'est focusable pendant ce temps.

### 4.3 Écran de résultat

Les deux mascottes, le score, **la cause en une image** (les deux paniers de pommes côte à
côte, les deux piles de tuiles), et deux boutons : **« encore »** (même jeu, nouveau seed)
et **« un autre jeu »**. Pas de statistiques, pas de courbe, pas d'étoiles à collectionner.

### 4.4 Sauvegarde

`rendilo-reale:duo:save:v1`, discipline habituelle du dépôt : **clé jamais renommée**,
version DANS le JSON, `structuredClone(DEFAULTS)` puis fusion **champ par champ avec garde
de type**, `resetSave` qui **mute en place**.

```ts
interface DuoSave {
  v: 1;
  muted: boolean;              // true par défaut (mode restaurant)
  reducedMotion: boolean;      // option joueur, en OU avec prefers-reduced-motion
  players: [
    { mascot: string; stars: 1 | 2 },
    { mascot: string; stars: 1 | 2 },
  ];
  lastGame: string | null;     // pour rouvrir le menu au bon endroit
  seen: Record<string, boolean>;  // jeux déjà lancés (→ la démo ne s'impose qu'une fois)
}
```

**Rien d'autre.** Pas de victoires cumulées, pas de records, pas de succès (§1.3). Si tu
crois avoir besoin d'un champ de plus, relis §1.3 avant de l'ajouter.

Écrite **uniquement** par `core/session.ts`.

---

## 5. Accessibilité — contrat repris de Cerveau et Trois Portes

Non négociable, et vérifié par le bot.

- **Le canvas est `aria-hidden`.** Toute l'interaction passe par de vrais `<button>` /
  `<input>` **transparents** dans `#overlay`, qui subit **exactement** la même
  transformation de letterbox que `#stage`. On récupère gratuitement tabulation,
  Entrée/Espace, noms accessibles et un anneau de focus visible AU-DESSUS du canvas.
- **`#overlay` est `pointer-events: none` et rend les événements à `button` ET à `input`.**
  L'oublier rend le jeu injouable au doigt tout en le laissant parfait au clavier — panne
  qu'aucun test clavier ne voit (piège vécu sur Cerveau).
- **Les boutons couvrent des CASES, pas des objets** : une case vide de la grille de
  `beast`, une pose légale de `tiles`, une part de `cake` sont des cibles. Les cases
  illégales sont `disabled` (critère 1.1.2).
- **`refresh()` synchrone à chaque changement d'état** du modèle : on ne peut pas donner le
  focus à un bouton encore `disabled`.
- **Le focus saute sur la première cible légale** après une validation, et **`restoreFocus`
  ne rend le focus que s'il était à nous** — le voler à quelqu'un qui joue au doigt est
  pire que de le perdre.
- **Le HUD se masque avant l'ouverture d'un panneau** (écran de passage, résultat) : sinon
  on tabule sur des boutons invisibles.
- **`#sr-board`** décrit le plateau en texte, **`#sr-log`** une phrase par événement. Les
  régions live **n'écrivent que sur changement réel** (sinon le lecteur d'écran répète).
- **`user-scalable=no` est RETIRÉ** du viewport (WCAG 1.4.4) et `touch-action: none` vit
  sur le canvas seul. Les deux jeux temps réel `side` ont un geste continu (curseur,
  joystick) : ils posent `touch-action: none` **sur leurs zones de contrôle uniquement**,
  jamais sur le body.
- **Mouvement réduit** : `prefers-reduced-motion` lu **une fois au boot**, en **OU** avec
  l'option joueur (jamais en ET ; la case est alors cochée et verrouillée). Particules
  coupées, secousses à 0, cadence de démo ÷2 mais **jamais 0** — l'information n'est jamais
  amputée.
- **Contrastes vérifiés au calcul**, jamais à l'œil : scénario `contrast` du bot sur les
  vraies valeurs exposées. **≥ 3:1** pour tout élément d'interface porteur d'information
  (WCAG 1.4.11), **≥ 4,5:1** pour le texte.
- **Jamais la couleur seule** : chaque joueur = **teinte + forme de socle + mascotte**.
  Chaque thermomètre = couleur + pictogramme + nombre de barres. Chaque type de fruit =
  couleur + forme. Les deux joueurs doivent rester distinguables en niveaux de gris.
- **Clavier** : les **5 jeux `pass`** (`cake`, `tree`, `tiles`, `beast`, `suspects`) sont
  **intégralement jouables au clavier seul** — c'est le test RGAA du bot. Les **3 jeux
  `side`** (`plank`, `mirror`, `ant`) exposent le mapping deux-zones décrit en §3 : ils
  deviennent jouables à deux sur un ordinateur portable, bonus gratuit à ne pas rater.

---

## 6. Rendu

- **PixiJS v8**, aucune dépendance runtime nouvelle. TypeScript **strict**.
- Boucle `@shared/loop` (60 Hz fixe, rendu interpolé). **Toute entité mobile stocke
  `prevX/prevY`** et est interpolée. Les jeux au tour par tour implémentent `update` en
  no-op et animent **par des fonctions closes du temps écoulé** (pattern de
  `mind/render/boardView.ts`) : aucun état de simulation à faire avancer, ce qui est ce qui
  rend le bot fiable.
- **Zéro allocation dans les `update()`** des trois jeux temps réel : pas de littéral, pas
  de closure, pools préalloués.
- Style : **pixel art chaud**, sprites écrits à la main en grilles de caractères
  (`render/sprites.ts`, pattern de Trois Portes) et peints case par case dans
  `render/textures.ts`. Les vignettes DOM du menu réutilisent les mêmes textures exposées
  en `data:` URL.
- Palette : chaleureuse et douce, **rien qui fasse peur** (public de 5 ans) — la bête sous
  le tapis est une grosse bestiole ronde à grands yeux, le géant est un nuage joufflu.
- **Interdits repris de tout le dépôt** : pas de hachures jaune/noir, pas d'anneaux, pas
  d'aplats blancs dans le décor — ces codes sont réservés aux informations de jeu.
- `scaleMode` : **nearest** pour les jeux `side` s'ils utilisent une caméra (avec arrondi
  pixel obligatoire), **linear** sinon — le letterbox impose une échelle fractionnaire où
  `nearest` scintille. Justifie ton choix en commentaire.
- Sons : `audio/sfx.ts`, **100 % WebAudio synthétisé** (pattern du dépôt), throttlés,
  **muets par défaut**. Aucun son strident, aucun son de défaite punitif.

---

## 7. Le bot de vérification — `tools/verify-duo.mjs`

Même forme que `tools/verify-doors.mjs` (Puppeteer/Playwright sur Chromium,
`CHROME_PATH`, `--no-sandbox` en root, `env -u HTTP_PROXY -u HTTPS_PROXY` en conteneur).
**Exit ≠ 0 si erreur console ou issue inattendue** → utilisable en CI.

`node tools/verify-duo.mjs <url> <scénario>` :

| Scénario | Ce qu'il prouve |
|---|---|
| `rules` | Assertions **hors partie** sur les 5 modèles au tour par tour (`cake`, `tree`, `tiles`, `beast`, `suspects`), montées dans la page depuis `window.__game`. **Au moins 30 assertions.** Détail ci-dessous. |
| `gen[:n]` | Fuzz des générateurs seedés sur n tirages (défaut 200) : toutes les garanties de §3 (pommes impaires, ≥3 coups, ≥6 poses, système séparateur, écarts de fruits). **0 échec attendu.** |
| `play:<jeu>[:seed]` | Joue une manche entière **en cliquant les vrais boutons du DOM** — aucune API de raccourci en node. Une régression d'UI (bouton jamais activé, focus perdu, panneau sans issue) se voit ici. |
| `keyboard[:jeu]` | Manche complète **au clavier seul** depuis l'accueil ; vérifie que le focus ne retombe **jamais** sur `<body>` **après une validation** (le traverser pendant une tabulation est normal — le compter ferait échouer un test conforme) et que le saut sur la première cible légale fonctionne à chaque tour. **C'est le test RGAA.** |
| `contrast` | Recalcule les contrastes sur les **vraies valeurs** exposées par le jeu (`window.__game.palette`), plus l'unicité des paires (teinte, forme) de mascottes. |
| `physics` | `plank` : à `PLANK_VMAX`, la bille **ne traverse aucun mur** sur 5 000 pas ; le modèle est **déterministe** (même seed + même suite d'entrées → mêmes positions au bit près). |
| `stress` | fps avec les 8 démos du menu animées simultanément + un jeu temps réel lancé. |

**Assertions de `rules` — la liste minimale**

- `tree` : conservation des pommes (Σ paniers + Σ arbre = total, à chaque tour) ; la
  cascade tombe **exactement** les arêtes sans chemin vers le sol ; une arête de la couleur
  adverse n'est jamais coupable ; un joueur sans coup passe automatiquement ; le total est
  impair donc jamais d'égalité.
- `tiles` : légalité (jamais de recouvrement, jamais hors grille, jamais sur une case
  bloquée) ; un joueur bloqué passe et l'autre continue ; le compte de tuiles posées
  correspond aux piles ; le départage « dernier posé » s'applique et **uniquement** en cas
  d'égalité.
- `cake` : le comptage des fruits par part est correct pour une corde donnée (contrôle
  contre une **réimplémentation indépendante** du test point/droite — c'est le
  `computeFeedback` de ce jeu : silencieusement cassable, à fuzzer) ; un fruit n'est jamais
  compté deux fois ni perdu ; l'alternance des rôles sur 6 coupes.
- `beast` : la bête bouge d'exactement une case orthogonale ; le thermomètre correspond à
  la distance de Manhattan ; la capture est détectée ; le tour limite déclenche la victoire
  du chasseur ; le départage inter-rôles est déterministe.
- `suspects` : les 6 profils sont distincts ; 3 questions suffisent toujours (vérifié par
  recherche) ; le jeu répond correctement ; l'aide ⭐ ne grise que des suspects réellement
  éliminés.
- `plank` / `mirror` / `ant` : déterminisme du modèle à entrées égales ; garde
  `ANT_BLOCK_MIN_DIST` respectée ; `mirror` — le coyote time est effectif ; `plank` — le
  replacement au point de contrôle ne change aucune autre variable d'état.

**Une bande mesurée est à produire** et à écrire dans `CLAUDE.md` en fin de travail :
résultats de `rules`, `gen:200`, `keyboard`, `contrast`, `physics`, `stress`, et un
`play:<jeu>` pour chacun des 8. Rappelle dans le texte que les taux absolus dépendent de la
machine et se lisent en **relatif**.

**Lancer les scénarios longs sur `npx vite preview`, jamais sur `npm run dev`** : le HMR
recharge la page dès qu'on touche une source et tue le contexte du bot en pleine manche.

`window.__game = { session, save, game, palette, mascots, models }` où `models` expose les
huit modèles purs (constructeurs) pour que le bot monte ses scénarios hors partie.

---

## 8. Ordre de travail

Livre par étapes commitables, chacune vérifiable. **Ne pars pas écrire les huit jeux avant
d'avoir un shell qui tourne.**

1. **Squelette** : `games/duo/` + les deux entrées de registre + boot Pixi + letterbox
   paramétré + `npm run build` vert + le hub liste 6 jeux.
2. **Shell** : `MiniGame`, session, mascottes, menu (vignettes statiques), écran de
   passage, écran de résultat, save, pause, mute. Un micro-jeu **bidon** (« tape le
   bouton ») valide le contrat de bout en bout.
3. **`plank`** (§3.1) + scénario `physics`. C'est le jeu qui valide la posture `side`.
4. **`cake`** (§3.2) + les assertions `rules` correspondantes. Valide la posture `pass`,
   l'écran de passage et l'alternance des rôles.
5. **`tree`**, **`tiles`** — les deux autres modèles purs, avec leurs générateurs et leur
   fuzz `gen`.
6. **`beast`**, **`suspects`** — les deux jeux `pass` asymétriques.
7. **`mirror`**, **`ant`** — les deux jeux `side` restants.
8. **`core/demo.ts`** + les 8 listes de coups canoniques + vignettes animées du menu.
9. **Passe accessibilité** : `keyboard`, `contrast`, régions live, mouvement réduit.
10. **Bande de mesure**, section `## Duo (games/duo/)` dans `CLAUDE.md`, mise à jour de la
    section **Commandes** avec la ligne `verify-duo`.

Après **chaque** étape : `npm run typecheck` puis `npm run build`, et les scénarios déjà
écrits doivent rester verts.

---

## 9. Définition de terminé

- [ ] `npm run build` passe (typecheck strict inclus), **zéro warning nouveau**.
- [ ] Le hub liste 6 jeux ; `/games/duo/` se charge ; les 5 jeux existants sont
      **strictement inchangés** (aucun fichier hors `games/duo/`, `hub/games.ts`,
      `vite.config.ts`, `tools/verify-duo.mjs`, `CLAUDE.md` — et `shared/` **seulement** si
      un module y gagne un **deuxième** consommateur réel).
- [ ] Les 8 jeux se lancent, se jouent jusqu'à un résultat, et se rejouent.
- [ ] `rules` ≥ 30 assertions, 0 échec. `gen:200` 0 échec. `contrast` 0 échec.
      `physics` 0 échec. `keyboard` : focus perdu 0. `play:<jeu>` vert pour les 8.
- [ ] **0 erreur console** sur toute la collection.
- [ ] Aucun `Math.random` dans le contenu ; aucune allocation dans les `update()` temps
      réel ; aucun `localStorage` hors `core/session.ts`.
- [ ] Les quatre critères du **test des 5 ans** (§1.1) sont vérifiables jeu par jeu : écris
      dans le commit final un tableau de 8 lignes × 4 colonnes disant **où** chaque critère
      est réalisé dans le code.
- [ ] `CLAUDE.md` contient une section `## Duo` rédigée **dans le style des autres
      sections** : les décisions et les pièges vécus, pas la description de l'évidence.
      Documente en particulier tout écart que tu as dû prendre à cette spec, et pourquoi.

---

## 10. Hors périmètre — à ne pas ajouter sans re-cadrage

Multijoueur en ligne ou par lien · plus de deux joueurs · comptes, profils persistants,
classements · succès, éclats, monnaie, déblocages, méta-progression d'aucune sorte ·
un neuvième jeu · voix, micro, caméra, vibration, accéléromètre · musique de fond ·
publicité ou lien sortant · toute IA adverse (les 8 jeux se jouent à deux humains, il n'y a
pas de mode solo) · toute mécanique demandant de lire une phrase pour jouer.

Si une de ces choses te semble nécessaire pour finir : **arrête-toi et demande**. C'est le
signe qu'une contrainte du §1 a été mal comprise, pas qu'il manque une fonctionnalité.
