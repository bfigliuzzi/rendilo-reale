# Rendilo Reale — hub de jeux web

Hub multi-jeux (Vite multi-page) : la racine `/` est un menu de sélection, chaque jeu vit
dans `games/<id>/` avec son propre `index.html` + `src/`. Six jeux : **Horde**
(`/games/horde/`), horde-shooter vertical style Last War — escouade auto-tir en bas,
hordes qui descendent, portes x2/+N, caisses HP, boss. Campagne + endless +
métaprogression (or, boutique, localStorage). **Essaim** (`/games/hive/`), conquête
de nœuds façon Auralux (voir section dédiée). **Cerveau** (`/games/mind/`), un
Mastermind à 3 difficultés avec un chat farceur (voir section dédiée). Et **Berceau**
(`/games/crib/`), tower-defense d'action façon Thronefall/Kingshot — trois cartes à
voies tracées, boucle jour/nuit, monnaie et bâtiments, un bébé qu'on déplace, tir auto,
et un ENGLUEMENT au lieu de PV (voir section dédiée) ; c'est le premier jeu d'action du
hub jouable au clavier, et le premier avec une caméra et du terrain bloquant. Enfin
**Trois Portes** (`/games/doors/`), roguelite tactique Porte/Monstre/Trésor : 9 nœuds à
3 portes, combats au tour par tour sur deux lignes, escouade à cap dur de 4,
méta-progression par éclats (voir section dédiée) ; c'est le second jeu au tour par tour
après Cerveau, et il en reprend l'architecture d'accessibilité. Et **Duo**
(`/games/duo/`), une COLLECTION de 8 micro-jeux à deux joueurs sur un seul téléphone,
pour deux enfants de 5 et 8 ans qui attendent au restaurant (voir section dédiée) ; c'est
la seule entrée du hub qui contient plusieurs jeux, le seul jeu muet par défaut, et le
premier à porter DEUX repères logiques (portrait et paysage) dans la même page.
PixiJS v8 + TypeScript strict + Vite. Aucune autre dépendance runtime.

## Hub & multi-jeux

- **Ajouter un jeu** = un dossier `games/<id>/{index.html, src/}` + une entrée dans
  `hub/games.ts` (registre affiché par le menu) ET dans `build.rollupOptions.input`
  (`vite.config.ts`) — deux listes à garder synchrones. Stack runtime libre (le build
  reste Vite), page isolée : CSS/globals propres, navigation = rechargement, pas de
  teardown à écrire.
- **Le hub** (`index.html` + `hub/`) est du DOM pur, sans framework. Son CSS
  (`hub/style.css`) est une copie locale de la palette du jeu horde — rien n'est partagé
  tant qu'un module n'a pas DEUX consommateurs.
- **`shared/`** (alias `@shared`, déclaré dans `vite.config.ts` + `tsconfig.json` paths) :
  modules communs aux jeux — `loop.ts` (boucle 60 Hz), `rng.ts` (mulberry32),
  `math.ts`, `spatialGrid.ts`. Y migrer un module dès qu'il gagne son 2e consommateur,
  jamais avant ; un module qui divergerait par jeu (ex. `render/fx.ts`) reste une copie
  locale tant que les contrats diffèrent.
- **PWA : UN SEUL service worker, à la racine** (manifest hub, `scope: '/'`), précache
  intégral hub + jeux. INVARIANT : `/sw.js` ne doit JAMAIS répondre du HTML (pas de
  fallback `/*` dans `netlify.toml` — un 404 devenu HTML empoisonnerait le SW installé
  chez les joueurs, qui serviraient l'ancienne app à vie). `registerSW` est appelé par
  le hub ET par chaque jeu (même SW, idempotent).
- **Save** : chaque jeu garde sa clé localStorage namespacée (`rendilo-reale:save:v1`
  pour horde — clé historique des joueurs, ne pas la renommer).
- `appType: 'mpa'` : URL inconnue → 404 franc en dev comme en prod.

## Essaim (`games/hive/`) — conquête de nœuds façon Auralux

**3 campagnes de 30 niveaux, une par espèce JOUABLE** (`config/campaigns.ts` :
`CampaignDef {species, name, emoji, levels, unlockedBy?}`, déblocage SÉQUENTIEL
dérivé du save — Mouches à la victoire du niveau 9 Abeilles, Cafards au 9 Mouches,
jamais stocké : `campaignUnlocked(save, sp)`). La campagne Abeilles ABSORBE les
9 cartes historiques de `config/maps.ts` (ids conservés → records migrés) ; tout
le reste (bee 10-30, fly/roach 1-30) est GÉNÉRÉ au boot par `config/mapgen.ts` —
déterministe par (espèce, n), mulberry32, zéro Math.random, noms curatés en
données dans campaigns.ts, sanity-check dev (géométrie, factions, monotonie).
La difficulté monte par les DONNÉES : AiParams (tempo, agressivité, `waveNodes`,
`grace` = délai avant la première décision IA, vital dès que l'IA part
multi-nids), nids de départ et leurs niveaux, richesse des neutres — JAMAIS par
l'espèce (budget égal, voir Clans). AiParams DÉRIVÉS de `campaignAi(n, surplus)`
(rampes MONOTONES en t = (n−2)/7 ; le tuning local produisait une courbe non
monotone) prolongée par `campaignAiExt` (u = (d−9)/21, continuité exacte au
raccord, `waveNodes` figé à 4) avec d = n (bee) ou n+1 (fly/roach, pas de
tutoriel). **GRAMMAIRE du générateur, apprise au bot (ne pas régresser)** :
nid principal IA tout en HAUT (y ≤ 160, pattern des 9 cartes main — posé plus
bas, l'IA rafle l'économie centrale), secondaires jusqu'à y=320, mêlées en
tripodes quinconce (seule géométrie qui loge 2×3 nids à ≥130 px), poche joueur
de 2 neutres à 8 sur ses flancs (sans elle l'expansion coûte le double), richesse
neutre concentrée au centre (6 + 14t², pas d'uniforme 13-19), stock joueur
26→40 croissant, grace = formule + rampe +0→8 (les cartes historiques mordantes
surchargent TOUTES la formule brute : NUEE 18, TRONE 19), surplus calculé sur
les nids RÉELLEMENT posés. Le générateur est GELÉ post-calibration : le SEUL
tuning par carte passe par `OVERRIDES` (grace d'abord, stocks ensuite — keyé
par id `fly-2`…). `surplusNests` : chaque nid IA excédentaire = +1.2 de
puissance/s dès t=0, LE terme dominant du rapport de forces. Les cartes à la
main ne déclarent que espèce, layout, stocks et surcharges assumées (tutoriel,
désynchro de mêlée) ; l'ORDRE de `MAPS` suit la courbe mesurée (`win:bee-2..9`,
2 runs min après tout changement). Carte 0 = tutoriel guidé (exclusif à bee-1),
puis introduction progressive : cafards → abeilles rivales → mouches → mêlée à
3 clans.
Les nœuds produisent en continu (table `NODE_LEVELS` : prod/cap/rayon par niveau,
× croissance d'espèce) ; le stock est visualisé en nuée orbitale (`orbitView`,
purement rendu, plafond 60 points) + compteur.
Contrôles : tap ruche = sélection/cumul, tap cible = envoi depuis toute la sélection,
tap vide = désélection, drag = envoi direct (aussi LE geste de renfort allié) ;
bouton ↻ du HUD (bas gauche, visible en jeu) = redémarrage instantané du niveau
(`Hud.onRestart` → `Flow.startGame`, loadLevel synchrone).
**Biomes de décor** (`render/decor.ts` + `HIVE_BIOMES`/`buildDecorSets` dans
`render/textures.ts`) : 4 biomes DÉRIVÉS de la carte par `biomeOf(def)` — ≥2 IA
→ friche de guerre, sinon l'espèce de l'IA : abeilles rivales → prairie, mouches
→ marécage, cafards → sous-bois nocturne. Fond = `groundTiles[biome]` (treillis
hexagonal décliné par palette), props posés UNE fois à loadLevel (seed FNV-1a de
`def.id` — stable au restart ↻, clearance 92 px des nids), météo légère en
particules SOUS le gameplay (≠ horde, délibéré : les unités font 8-16 px).
Layers : bg → decor → weather → orbit → nodes → … Zéro alloc au tick, +2 draw
calls ; interdits WCAG du décor identiques à horde (pas de hachures jaune/noir,
d'anneaux ni de glyphes/à-plats blancs — codes réservés aux dangers).
**Upgrade de nœuds** : sur-nourrir un nid allié investit TOUT ce qui déborde du cap
vers le niveau suivant (`UPGRADE_COSTS`, arc de progression au rendu, ▲ au label,
taille du nid dérivée du niveau) — aucun geste dédié. Le débordement d'une arrivée
compte (exiger un nid strictement plein à chaque arrivée jetait l'excédent :
l'upgrade était quasi introuvable en partie réelle). La capture CONSERVE le niveau
(gros nid = prise stratégique) mais remet l'investissement en cours à zéro ; l'IA
investit dans ses temps calmes (`Ai.invest`).

- **Clans (espèces) à budget égal** : la FACTION est un camp (0 neutre, 1 joueur —
  l'espèce de la CAMPAGNE : `factions[0].species`, sans `ai` —, 2-3 IA), l'ESPÈCE
  est son peuple (`FactionDef` dans
  `LevelDef.factions`, stats `SPECIES` dans `balance.ts`). On ne déclare QUE
  `growthMul`/`speedMul`, la puissance est DÉRIVÉE : `power = 1/growthMul`
  (**parité d'usure** : débit de puissance produit identique — c'est CE ratio qui
  décide des guerres d'attrition, mesuré au bot : une pondération `√vitesse` dans
  le budget faisait gagner toute guerre longue au clan lent). La granularité
  (growth/power) est donc AGRÉGAT-NEUTRE : c'est l'axe d'IDENTITÉ (nuée dense ⇔
  unités rares et grosses) ; la VITESSE est l'axe d'équilibrage résiduel, CALIBRÉE
  PAR CLAN au scénario `duel` (cible ~50 % contre chaque autre clan — la lenteur
  0.8 historique du cafard n'était « payée » que par les fuites de parité depuis
  corrigées, il s'effondrait à 1/15 une fois celles-ci fermées ; re-mesurer les
  duels après TOUT changement de SPECIES ou du combat).
  Abeilles 1/1/1, mouches 1.5/1.3/≈0.67, cafards 0.85/0.95/≈1.18 (toujours le
  clan le plus lent — son identité se lit à la rareté/taille). INVARIANT de
  données : jamais deux IA de même espèce sur une carte (le duel joueur-vs-abeilles
  rivales est le seul cas de même espèce — distinguable par teinte + style de
  contour + cœur d'unité évidé côté IA).
- **Un envoi = `world.sendFrac` du stock, jamais 100 %** : le stock EST la défense
  (capture dès que < 0) — le 100 % rendait chaque envoi suicidaire (un éclaireur
  retournait le nœud vidé). Défaut `SEND_FRAC_DEFAULT` (50 %), réglable 10-100 %
  par crans de 10 % au SLIDER VERTICAL du HUD (bord droit, zone pouce ;
  `<input type=range>` natif en writing-mode vertical, crans dessinés sur la
  piste, `aria-valuetext` ; avec ↻ c'est la seule zone interactive du HUD,
  `#hud-send`, persisté `save.sendFrac` — validation/clamp `clampSendFrac`, écrit
  par Flow seul). Le bot de verify suppose le défaut 50 %.
- Un envoi = rafale étalée (`EMIT_INTERVAL`), `remaining` figé à l'ordre ; flux annulé
  si la source tombe ou se vide. Arrivée résolue contre la faction COURANTE du nœud,
  à hauteur de `hp restant / power du défenseur` (renfort, dégât ET investissement
  d'upgrade — une unité pleine vaut 1 chez un allié, pas d'exploit de soin en transit).
- **Combat à puissance N factions** via `@shared/spatialGrid` : TOUTES les unités
  vivantes insérées, chaque unité non engagée INITIE un contact 3×3 contre une
  autre faction — dégâts mutuels `min(hp_i, hp_j)` (deux égaux s'annihilent, un
  costaud mange un faible et survit entamé), flag `engaged` = une INITIATION par
  tick mais une unité engagée reste CIBLABLE tant qu'elle vit (sans quoi le camp
  le plus NOMBREUX saturait les adversaires et son surplus traversait l'écran
  sans combattre, et le costaud n'encaissait qu'un coup par tick — les deux
  mesurés au scénario `duel` ; chaque contact détruit la même puissance des deux
  côtés, l'usure agrégée reste 1:1), mort sous `HP_EPSILON` ; morts marquées
  `dead=1`, `sweepDead()` APRÈS la phase grille. `GRID_MAX_PER_CELL` doit rester
  LARGE (128) : un insert au-delà du plafond est ignoré → « fantôme » qui frappe
  sans être ciblable, avantage mesurable au camp dense. Fx/sfx uniquement sur
  mort (pas de grésillement de grignotage).
- Fin de partie : défaite si le joueur est éliminé, victoire quand TOUTES les
  factions IA le sont (éliminée = nœuds == 0 ET unités en vol == 0 ET flux == 0 —
  une nuée en vol peut encore reprendre un nœud ; une faction absente de la carte
  est trivialement éliminée : aucun cas particulier pour les duels).
- **IA** (`game/ai.ts`) : une instance PAR camp IA (préallouées dans World,
  inertes si la faction est absente), décision toutes `decisionInterval` s —
  défense, sinon vague groupée des `waveNodes` nids les PLUS PROCHES de la cible
  (les borner est vital : mobiliser toute l'économie écrasait le joueur), sinon
  accumulation. Tout nœud non-mien est un ennemi potentiel (en mêlée, les unités
  tierces gonflent la défense estimée d'une cible — surestimation assumée,
  « laisse-les s'entretuer » émergent) ; la marge de supériorité est pondérée par
  le rapport de puissance des espèces (`factionPower`). Paramètres par camp dans
  `LevelDef.factions[k].ai` ; passe par la même API `emitter.send` que le joueur.
- **Tutoriel** (`game/tutorial.ts`) : déclaratif (`LevelDef.tutorial`, étapes
  select/send/capture/upgrade/win), pur OBSERVATEUR de l'état du monde depuis la
  boucle de rendu (throttlé, zéro hook dans la sim), bandeau DOM `#hud-tuto`
  (`aria-live`). Flow le démarre/coupe.
- **Équilibrage mesuré au bot** : `node tools/verify-hive.mjs <url> <scenario>` —
  scénarios `win[:carte]` (bot all-in CONSCIENT DES PUISSANCES via
  `world.factionPower`, ATTEND une victoire ; carte = `N` 1-based bee, ou
  `<espèce>-<N>` : `win:fly-3`, `idle:roach-12` — le harness déverrouille TOUTE
  la chaîne de campagnes, `startLevel` refuse sinon les campagnes aval ; défaut
  bee-2, la carte 1 est le tutoriel), `idle[:carte]` (passif, ATTEND une défaite),
  `mirror[:runs]` (camp abeilles piloté par la MÊME classe `Ai`, exposée sur
  `window.__game` — pas de duplication d'heuristiques ; garder `MIRROR_PARAMS`
  alignés sur la carte testée), `duel:A-B[:runs]` (duels d'ESPÈCES A vs B sur
  carte symétrique, MÊME `Ai`/paramètres des deux côtés, camps alternés, ticks
  accélérés hors temps réel — LA mesure de parité inter-clans, attendu ~50/50 ;
  c'est lui qui a mesuré la fuite de combat, les fantômes de grille et la
  dotation initiale non dénominée), `stress` (fps à ~600 unités).
  Exit ≠ 0 si erreur console ou issue inattendue → utilisable en CI.
  **PARITÉ D'USURE — les cinq tuyaux à garder en puissance** (chacun a été
  mesuré comme déséquilibre réel au bot) : ① production `growth·power ≡ 1`,
  ② cadence d'émission `EMIT_INTERVAL × power`, ③ cap et coût d'upgrade
  `÷ power`, ④ estimations de l'IA et du bot en monnaie de puissance,
  ⑤ stock initial des cartes `÷ power` (déclaré EN PUISSANCE dans `maps.ts`
  ET `mapgen.ts`, converti en unités locales par `Nodes.load` — sinon un nid
  cafard de départ valait +18 % de défense, exactement le ressenti « cafards
  trop forts » des premières cartes). Toute
  nouvelle mécanique quantitative (coût, stock, débit) doit choisir sa
  dénomination puissance/unités EXPLICITEMENT, sinon le clan costaud (cafards)
  gagne toute guerre longue — symptôme type : mirror non-impasse, bot-win des
  premières cartes qui bascule en lose.
  Bande de référence bee 1-9 (conteneur, rendu logiciel, 2026-07, POST-corrections
  de parité ET courbe campaignAi, cross-runs — le signal est BRUITÉ, 2-3 runs
  minimum par carte ; les morts du bot sont quasi DÉTERMINISTES par carte,
  déclenchées par la première vague coordonnée : la grace est le levier fin) :
  cartes 2-4 bot-win en temps croissants (~70 → 110 s), cartes 5-9 bot-lose
  (survie ~55-85 s — défi humain : le bot n'a ni retranchement ni adaptation ;
  la carte 8 est au point de bascule, à grace 22 le bot la GAGNAIT une fois
  sur deux, 19 = calibré), idle carte 2 = défaite ~55 s, mirror = mixte
  (win,timeout — MIRROR_PARAMS alignés sur campaignAi(2,0)), stress ~28 fps
  (la grille à 128/cellule et le re-ciblage coûtent ~5 fps en mêlée maximale —
  assumé : les plafonds bas créaient des « fantômes » inéquitables), duels :
  bee-fly ≈ parité (~10/6), bee-roach voir la note SPECIES (balance.ts).
  **Bande campagnes générées (Mac 120 fps, 2026-07 — le bot y est PLUS FORT
  qu'en conteneur : bee-5 bot-win ici vs lose conteneur ; lire en RELATIF,
  même machine)**, checkpoints ×2 runs {2,5,9,13,17,22,26,30} : règles de
  calibration = ouvertures (n≤2) bot-WIN fiables, JAMAIS de survie < 40 s
  (symptôme « infaisable » → OVERRIDES.grace), au-delà la variance par layout
  est assumée (défi humain). Mesuré : bee 13-30 bot-lose survies 96→42 s ;
  fly-2 win ×3 (~40 s, via OVERRIDE playerStock 40 + grace 14), fly-5 mixte
  (frontière), fly-9 win, fly-13+ lose (37-76 s, fly-17 calée à grace 20 →
  47-51 s) ; roach 2-13 win (39-65 s, bascule entre 13 et 17), roach-17+ lose
  (42-70 s) ; idle fly-2/roach-2 = lose 59/46 s ; duels contrôle bee-fly 9/7,
  bee-roach 6/10 (≈ note SPECIES, combat inchangé).
  Contrôle même machine : horde campagne N1 = victoire, 0 erreur console.
  À re-mesurer en RELATIF après tout changement de balance, batch de contrôle
  sur l'ancien tuning en cas de doute (mêmes précautions machine que horde).
  L'anti-enlisement de l'IA (`STALL_DECISIONS` : vague élargie après 8
  décisions sans attaque abordable) est calibré sur idle — un élargissement
  PERMANENT écrasait toutes les cartes.
  `window.__game = {world, flow, app, Ai, save}`, `world.postSend/sendOrder`
  scriptables.
- Sons : `audio/sfx.ts`, 100 % WebAudio synthétisé (pattern horde), throttlés en
  interne (annihilations surtout) ; l'IA est muette (seuls `World.sendOrder` et les
  événements sonorisent — `Emitter.send` direct ne fait aucun bruit). Mute persistant
  (bouton menu, `save.muted`).
- Accessibilité : ESPÈCE = FORME (hexagone abeille / losange mouche / goutte
  cafard / cercle neutre) + glyphe + silhouette d'unité distincte ; FACTION =
  teinte ET style de contour (plein joueur / double f2 / pointillé f3) + cœur
  d'unité évidé côté IA — jamais la couleur seule, même entre abeilles rivales.
  `?stress` = les deux camps canonnent (~600 unités, mesuré 120 fps desktop).
  Save `rendilo-reale:hive:save:v1` (`meta/save.ts`, schéma versionné v3 + merge
  sur défauts ; migrations en CHAÎNE v1→v2→v3 — v3 : `campaigns` par espèce
  remplace `unlocked`, re-dérivé de `bestTimes` car le v2 clampait à 9 : le
  vétéran « guerre-des-clans battue » obtient bee.unlocked=10 ET le jalon
  Mouches) : progression par campagne + records par carte (`bestTimes` plat,
  ids historiques + namespacés) + `sendFrac` + `counters`/`feats` (succès) —
  écrite UNIQUEMENT par `game/flow.ts` ; `resetSave(save)` mute EN PLACE
  (objet partagé par référence), bouton reset deux temps sur l'accueil.
- **Succès** (`meta/achievements.ts`, écran 🏅 du menu) : 6 familles à paliers
  géométriques SANS FIN et SANS récompense (hive n'a pas de monnaie — affichage
  pur, pas de claim ; `targetOf`/`reachedTiers` pattern horde) sur les
  `counters` du save, + 12 hauts faits one-shot (`feats`, dont 3 « ★ légende »
  quasi impossibles : Triple couronne, Va-tout 100 %, Nomade ≤1 nid).
  Instrumentation LECTURE SEULE zéro-alloc (`world.run` RunStats,
  `emitter.sentByFaction`, `combat.deaths`, `nodes.onCapture(i, from, to)`) ;
  flush en UNE écriture par fin de partie dans `Flow.onGameOver` (victoire ET
  défaite ; restart ↻/menu non flushés — assumé), feats de la partie affichés
  sur l'écran de résultat.

## Cerveau (`games/mind/`) — Mastermind, chat farceur, RGAA

**3 difficultés, table unique dans `config/balance.ts`** (`DIFFICULTIES`) : Facile
4 pions / 5 couleurs / 12 essais / SANS doublon (espace 120 codes — le mode où l'on
peut raisonner par élimination dès le premier indice, c'est ça qui le rend facile,
pas le nombre d'essais), Normal 4/6/10 avec doublons (LA règle officielle, le point
d'ancrage), Difficile 5 pions / 8 couleurs / 10 essais + **pion vide JOUABLE**
(9 symboles ⇒ 59 049 codes, 45× l'espace du normal à budget d'essais égal).

- **Le modèle est PUR** (`game/board.ts`) : ni horloge, ni `Math.random` (secret tiré
  par `mulberry32(seed)`), ni DOM, ni rendu. Tout ce qui bouge — rebonds, cascade
  d'indices, ondes de choc, révélation — est du RENDU, reconstruit par des fonctions
  CLOSES du temps écoulé (`render/boardView.ts`), sans état de sim à faire avancer.
  C'est cet isolement qui rend le bot fiable et qui autorise le chat à muter la ligne.
- **`computeFeedback` est le seul endroit silencieusement cassable** du jeu : compter
  les « mal placés » sans retirer d'abord les paires exactes double les doublons
  (secret AABB vs essai ABAB → 4 au lieu de 2+2). D'où le comptage en deux temps sur
  histogrammes préalloués, et le scénario `feedback` du bot qui le fuzze contre une
  réimplémentation INDÉPENDANTE. À relancer après toute retouche.
- **`null` ≠ `EMPTY_PEG`** : emplacement non rempli vs pion vide POSÉ. Sans les deux
  notions on ne sait pas si une ligne est complète. Ils se lisent différemment (socle
  creux à liseré pointillé vs pion clair à glyphe ⊘) et s'annoncent différemment
  (« libre » vs « pion vide ») — les confondre à l'oral rendrait le difficile injouable
  au lecteur d'écran.
- **ACCESSIBILITÉ : le canvas est `aria-hidden`, l'interaction est du DOM natif.**
  `ui/hud.ts` pose de vrais `<button>` (emplacements, actions) et
  `<input type="radio">` (palette, en `radiogroup`) TRANSPARENTS dans `#overlay`, qui
  subit exactement la même transformation de letterbox que `#stage`. On récupère
  gratuitement tabulation, Entrée/Espace, noms accessibles, navigation aux flèches du
  groupe radio, et un anneau de focus réellement visible AU-DESSUS du canvas. Les
  boutons d'emplacement SUIVENT la ligne en cours (un seul jeu suffit).
  `appearance: none` sur les radios (jamais `opacity: 0`) : sans quoi ils ne
  pourraient plus afficher leur focus. **Piège vécu** : `#overlay` est
  `pointer-events: none` et il faut le rendre à `button` ET à `input` — l'oublier
  rendait la palette injouable au doigt tout en restant parfaite au clavier, panne
  qu'aucun test clavier ne voit.
- **Focus managé** : tabindex glissant sur la ligne (un seul arrêt, flèches pour
  changer d'emplacement), les chiffres 1-8/0 posent ET avancent (sans quoi « 1 2 3 4 »
  écraserait quatre fois le même emplacement), le focus saute sur ✓ dès que la ligne
  est complète — donc Entrée valide sans tabuler — et revient au premier emplacement
  libre après validation. `Hud.refreshActions` doit être appelée SYNCHRONEMENT à chaque
  changement de plateau (`world.onBoardChanged`) : on ne peut pas donner le focus à un
  bouton encore `disabled`, et attendre la frame de rendu faisait rater le saut sur ✓.
  Les écrans replacent le focus sur leur titre (`tabindex="-1"`) — le manque d'Essaim.
- **Contrastes vérifiés AU CALCUL, jamais à l'œil** : scénario `contrast` du bot, qui
  lit les VRAIES valeurs exposées sur `window.__game`. Le bleu `#3a4fd8` et un pion
  vide sombre échouaient à 2,5 et 2,7:1 sur le plateau (WCAG 1.4.11 exige 3:1) —
  invisible à l'inspection visuelle. Corrigés en `#5b72e6` et `#c4bccc`. L'encre du
  glyphe est DÉRIVÉE de la luminance du corps (seuil 0,42) : un glyphe blanc sur le
  pion blanc ou le pion vide disparaîtrait. Les écarts de luminance entre pions voisins
  restent parfois faibles (orange/cyan, jaune/vert) : assumé, ce sont la FORME et le
  GLYPHE qui les séparent en niveaux de gris (table `config/pegs.ts`, 8 formes et
  8 glyphes tous distincts — le bot vérifie l'unicité de la paire).
- **Les marqueurs d'indice n'utilisent PAS le noir/blanc classique** du Mastermind :
  c'est une différence de couleur seule, donc non conforme. Losange PLEIN jaune (bien
  placé) contre anneau CREUX bleu (mal placé), plus le compte en clair dans
  l'`aria-label` de la ligne et dans le miroir `#sr-history`.
- **Écart assumé aux deux autres jeux** : `user-scalable=no` est RETIRÉ du viewport
  (WCAG 1.4.4) et `touch-action: none` passe du `body` au canvas seul — un jeu au tour
  par tour n'a aucun geste continu à protéger d'un pincement.
- **Mouvement réduit** traité côté CANVAS aussi, pas seulement en CSS (le manque
  d'Essaim) : `prefers-reduced-motion` lu UNE fois au boot, en OU avec l'option joueur
  (jamais en ET — on ne contredit pas une préférence système, la case est alors cochée
  et verrouillée). Particules × `RM_PARTICLE_MUL`, shake à 0, aucun flash (WCAG 2.3.1),
  rayons de victoire immobiles. L'INFORMATION n'est jamais amputée : les indices se
  lisent sans une seule animation.
- **Le chat** (`game/cat.ts` + `render/catView.ts`) vit DEHORS de la logique : `Board`
  ne le connaît pas, il passe par la MÊME API que le joueur (`setPeg`/`swapPegs`) après
  un `markUndoPoint()` qui arme ↩. Trois garde-fous non négociables : ① il ne touche que
  la ligne EN COURS (jamais l'historique validé, jamais le code secret), ② il s'abstient
  au dernier essai (`CAT_SPARE_LAST_TRY` — un vol au tout dernier tour n'est plus une
  farce, c'est une défaite volée), ③ tout est annulable (bouton ↩, touche Z) et
  réparable à la main. Un échange n'est tenté qu'entre deux pions DIFFÉRENTS, sinon
  l'annonce mentirait. Machine à états semée par `seed ^ 0x9e3779b9` (indépendante du
  code secret : rejouer le même tirage ne rejoue pas les mêmes farces).
  `cat.setEnabled(false)` le rend totalement inerte — c'est ce que fait le bot pour être
  déterministe ; `setMischief(false)` (option joueur) le laisse se promener sans toucher
  aux pions : on garde la vie sans la frustration. Annonce en `aria-live` ASSERTIF, le
  seul du jeu — le méfait change la saisie en cours, le manquer coûterait un essai.
- **L'écran de résultat est DIFFÉRÉ** (`WIN_RESULT_DELAY` / `LOSE_RESULT_DELAY`) : sans
  ça le panneau s'ouvrait avant la révélation du code et les confettis, et le joueur ne
  voyait jamais la récompense. `World` met la fin de partie en attente, `Flow` l'ouvre
  au timer — d'où l'attente de `flow.state === 'result'` côté bot.
- Save `rendilo-reale:mind:save:v1` (`meta/save.ts`, pattern d'Essaim : clé jamais
  renommée, version DANS le JSON, `structuredClone(DEFAULTS)` puis fusion champ par
  champ avec garde de type, `resetSave` mute EN PLACE) : records par difficulté
  (moins d'essais, puis plus rapide), victoires, série, options, `counters`, `feats`.
  Écrite UNIQUEMENT par `game/flow.ts`, en UNE écriture par fin de partie.
  Succès (`meta/achievements.ts`) : 6 familles à paliers géométriques sans fin et sans
  récompense (pas de monnaie ici) + 12 hauts faits dont 3 « ★ légende ».
- **Vérification** : `node tools/verify-mind.mjs <url> <scénario>` — `contrast`,
  `feedback[:n]`, `solve:easy|normal|hard[:runs]`, `cat[:runs]`, `lose[:diff]`,
  `keyboard[:diff]`, `stress`. Le SOLVEUR vit dans node, pas dans la page : il recalcule
  chaque indice depuis son propre historique et le compare à celui du jeu, ce qui croise
  les deux implémentations à chaque partie. Minimax sur l'ensemble cohérent, ÉCHANTILLONNÉ
  en difficile (le minimax complet de Knuth ferait 59 049² ≈ 3,5 G paires). Le scénario
  `keyboard` joue une partie entière au clavier SEUL depuis l'accueil et vérifie que le
  focus ne retombe jamais sur `<body>` — c'est le test de non-régression RGAA.
  Bande mesurée (conteneur, 2026-08) : solve easy 4-5 essais, normal 3-5 (avg 4 —
  l'optimal de Knuth est 4,478), difficile 5-7 sur 10 ; `cat` gagne malgré le méfait ;
  `keyboard` 10-12 tours, focus perdu 0 ; `contrast` 0 échec ; `stress` ~19 fps en
  conteneur (rendu logiciel). `window.__game = {world, flow, app, save, hud, Board,
  computeFeedback, palette, pegs}`.

## Berceau (`games/crib/`) — tower-defense d'action, jour/nuit, engluement

**Trois cartes, trois sujets** (`config/maps.ts`, écrites entièrement à la main sur le
modèle de `hive/config/maps.ts`) : 🌿 **Le jardin** (4 nuits) enseigne le RACCOURCI —
le bébé passe sous les haies, la horde contourne ; 🍳 **La cuisine** (5 nuits)
enseigne le GOULOT — trois voies qui passent chacune par une porte de deux tuiles
taillée dans un plan de travail ; 🕯️ **Le grenier** (7 nuits) enseigne le DOS —
quatre voies dont un conduit qui débouche à quelques pas du berceau et qu'on ne
remonte jamais à temps, donc il faut DÉLÉGUER à une tour. Déblocage séquentiel dérivé
du save. Pas de méta-progression : l'or et les achats meurent avec le niveau.

- **LA mécanique : le bébé n'a PAS de PV, il a du GRIP.** Le contact ennemi l'englue,
  `vitesse = HERO_SPEED × (1 - grip)`, jusqu'à l'immobilisation. La seule défaite est
  la chute du berceau : la punition n'est jamais « tu meurs », c'est « tu ne peux plus
  défendre ». Le grip **CONVERGE** vers `charge / GRIP_LOAD_FOR_PIN` (charge = Σ des
  `gripMul` des contacts, plafonnée à `GRIP_CONTACT_CAP` = 3 contacts), il ne s'intègre
  PAS : le premier modèle intégrait sans borne, donc n'importe quel contact finissait
  par clouer et l'engluement était BINAIRE — une mamie isolée immobilisait, et le tank
  perdait son rôle de menace kitable. Barème : 1 mamie → 50 % de vitesse, 2 mamies →
  cloué, 1 couche au passage → 17 %, 3 sacs à poussière → 75 %.
- **Quatre garde-fous non négociables** : ① le tir ne consulte JAMAIS le grip — cloué,
  le bébé tire à pleine portée et se libère seul ; ② le plafond de contacts borne la
  charge, donc abattre les trois plus proches suffit TOUJOURS — et comme l'aim-assist
  tire aussi au plus proche, les ennemis comptés sont exactement ceux qu'on abat ;
  ③ le decay démarre à la frame où la charge retombe, sans rampe ; ④ le doudou
  (`GRIP_IMMUNE_TIME`) est la porte de sortie d'un pinning mal engagé.
  La **boîte à talc** (bâtiment) et l'amélioration **peau savonnée** DIVISENT la charge,
  et cette division vit au SITE D'APPEL dans `World` — pas dans `Hero` — pour que le
  commentaire de `GRIP_LOAD_FOR_PIN` continue de dire la vérité sur le modèle nu.
- **Quatre codes redondants de l'engluement**, jamais la couleur seule : l'anneau qui
  se remplit autour du bébé (une FORME), la cadence de l'animation de rampe — indexée
  sur la DISTANCE parcourue, donc elle ralentit toute seule et se fige à l'arrêt —,
  les filets de bave vers chaque colleur, et le pommeau du joystick + la vignette.

### Boucle jour/nuit

**Flow possède la PHASE, World possède l'HORLOGE DE NUIT.** `world.t` compte les
secondes depuis le début de LA NUIT ; `nightSecTotal` cumule pour le record. Le jour
n'a **aucune horloge** — il dure tant que le joueur n'appuie pas sur « Lancer la
nuit » — et le chronométrer récompenserait celui qui n'ouvre jamais le panneau
d'achat.

**Le tick est STRICTEMENT IDENTIQUE de jour et de nuit** — contacts, engluement, tir
auto, collisions, ramassages, caméra. Trois différences seulement : le spawner n'est
alimenté qu'en nuit, la construction n'est ouverte qu'au jour, et « nuit tenue » ne se
teste qu'en nuit. C'est cette identité qui laisse le scénario `grip` du bot
fonctionner sans une ligne de changement.

> **INVARIANT, écrit aussi dans `world.ts` car le refactor tentant le casse en
> silence** : `startNight`/`endNight` ne touchent JAMAIS ce qui se cumule sur un
> niveau (or, bâtiments, améliorations, PV du berceau). Seul `loadLevel` le remet à
> zéro. C'est par cette asymétrie, et pas par un flag, que les bâtiments persistent
> d'une nuit à l'autre et disparaissent d'un niveau à l'autre.

Le `brief` de la nuit est affiché SUR le bouton de lancement : on choisit ses achats
en sachant ce qui arrive, sinon la phase de jour est un pari et non une décision. Une
défaite propose DEUX issues — « Rejouer la nuit » (instantané pris au lancement) et
« Recommencer le niveau » : reperdre huit minutes de construction sur une erreur de
placement serait la punition la plus décourageante possible dans un jeu sans
méta-progression, où repartir de zéro n'apporte rien de nouveau. Les bâtiments
entamés sont réparés gratuitement au lever du jour, sinon la dernière nuit se joue
derrière un mur de ruines déjà payé.

### Terrain : on écrit des vecteurs, on exécute un masque

`config/maps.ts` déclare des polylignes, rectangles, disques et bandes ; `game/terrain.ts`
les rasterise UNE fois au chargement dans un `Uint8Array` de tuiles de
`TERRAIN_TILE = 24` px. Au tick, toute question de passabilité est UN index de
tableau. Drapeaux : `T_ENEMY` · `T_HERO` · `T_SLOW` (haies) · `T_LANE`.

**L'ORDRE du bake porte le sens** : sol → patchs → **voies (qui EFFACENT les bits
bloquants)** → bordure (`T_HERO` seul, pour que les amorces de voies hors arène
restent praticables par la horde). Une haie tracée en travers d'une voie laisse donc
automatiquement une porte : c'est comme ça que s'écrit un goulot. Le carve de
PASSABILITÉ prend **une tuile de marge** de plus que `halfWidth` — sinon un point à
`halfWidth − 8` de l'axe peut tomber dans une tuile dont le centre est plus loin,
restée bloquante, et l'ennemi s'y fait éjecter à chaque frame (mesuré : `idle:kitchen`
en timeout) ; `T_LANE` n'est peint qu'à la largeur réelle, la voie a donc un
accotement praticable non peint.

**Trois matériaux et pas un de plus** : `hedge` bloque la horde et laisse passer le
bébé (ralenti à `HEDGE_SLOW` — couper doit être un ÉCHANGE, pas un cadeau), `wall` et
`water` bloquent tout le monde et ne diffèrent qu'au rendu. Les rôles ne changent pas
d'un biome à l'autre — haie de jardin, pile de linge, tas de cartons — seule la
matière change : c'est ce qui garde le langage visuel apprenable.

**Sept assertions DEV** au chargement, chacune pour un bug qui ne se voit qu'en jeu et
sur une seule carte. La plus importante interdit toute bande de moins de deux tuiles :
c'est elle qui rend géométriquement impossible qu'un ennemi touche le bébé à travers
un mur (portée de contact max 28 < 48), donc qui protège le garde-fou ② de
l'engluement. Plus `assertBalanceSane` (tuning) et `assertLevelSane` (contenu).
**`?debug` dessine le masque, les nœuds de voie et les emplacements tels que la
simulation les voit** — un bake faux est invisible en jeu, on constate seulement que
« les ennemis font n'importe quoi ».

**Le bébé** teste le masque par une sonde aux QUATRE COINS de son AABB et résout **X
puis Y séparément** : c'est cette séparation qui donne le glissement le long d'un mur,
sans quoi un joystick un rien de travers le colle net. L'aspiration du boss passe par
la même collision — un mur protège du vide. **Balles et pois IGNORENT le terrain**
(décision explicite) : ça garde le garde-fou ② exactement vrai, évite tout raycast, et
c'est l'avantage asymétrique du bébé.

### Suivi de voie

Cinq tableaux SoA de plus au pool (`lane`, `node`, `slotOff`, `spd`, `chase`,
`lostD/lostT`, `freeX/Y`). **⚠️ Tous doivent être recopiés dans le swap-remove de
`kill()`** — un ennemi qui hérite du `node` de l'occupant précédent se téléporte
d'intention en pleine voie, et ça se lit comme « le pathfinding est cassé ».

On n'a PAS réécrit le moteur de déplacement : on a remplacé une cible fixe par une
cible mobile. Deux subtilités : le passage de nœud est un **produit scalaire** mesuré
depuis la cible DÉCALÉE de l'ennemi et pas depuis le nœud brut (mesuré depuis le nœud,
un ennemi écarté latéralement se fige EXACTEMENT sur sa cible et n'avance plus jamais),
avec un rayon d'arrivée pour fermer le cas limite ; et la distance d'ARRÊT se mesure
sur l'objectif, pas sur le waypoint.

Anti-agglutination sans requête de voisinage (trop chère à 460 ennemis) : écartement
latéral, étagement longitudinal, jitter de vitesse déterministe.

Les agrippeuses quittent leur voie sous `ENEMY_AGGRO_RANGE` — c'est LE levier du
joueur, il attire les mamies hors du chemin. Garde-fou obligatoire : décrochage après
`ENEMY_LOST_TIME` sans progresser, sans quoi un bébé derrière une haie possède une
zone sûre PERMANENTE et le jeu est mort comme design. Hors voie, la poursuite glisse
par axe ; une éjection universelle vers la dernière position libre, suivie d'un pas de
poussée vers la cible, rend sûre toute poussée présente ou future.

**ANTI-ENLISEMENT** : dès que plus rien n'arrivera de la nuit, les bombardiers
AVANCENT au lieu de rester postés. Sans ça, une nuit peut ne JAMAIS se terminer dès
qu'un ennemi immobile est hors de portée de tout le monde — c'est exactement ce qui
arrivait quand `broccoli.shootRange` (215) dépassait `HERO_RANGE` (195). Le garde-fou
tient quelle que soit la valeur future de `shootRange`, et `assertBalanceSane` interdit
en plus `shootRange ≥ HERO_RANGE`.

### Économie et bâtiments

- `game/economy.ts` : la bourse d'UN NIVEAU. Elle n'est **jamais** dans la sauvegarde —
  l'absence de méta-progression est une décision de design, et le schéma de save est
  l'endroit où on la fait respecter. L'or non dépensé se reporte d'une nuit à l'autre.
- L'or tombe DIRECTEMENT au compteur à la mort : pas de pièce à ramasser, une pièce
  perdue hors champ serait une punition invisible. Règle de dérivation
  **`EnemyDef.gold ≈ hp / 3`**, donc le revenu d'une nuit est dérivé de son CONTENU et
  ajouter une vague la finance automatiquement. Deux écarts assumés : la mamie paie
  au-dessus du barème (l'ignorer, c'est se faire clouer), le sac à poussière ne paie
  RIEN (le boss enragé en recrache trois toutes les 2,6 s, il serait une pompe à or).
  Garde-fou DEV : le revenu doit être MONOTONE d'une nuit à l'autre.
- **On construit en MARCHANT jusqu'à la dalle** : le panneau s'ouvre à la proximité,
  jamais depuis un menu. Quatre bâtiments (`BUILDINGS`), et un seul choix vraiment
  opinionné : la **boîte à talc** divise l'engluement dans son rayon, donc c'est le
  seul qui pose une question de placement intéressante (« où est-ce que je me fais
  clouer ? ») — une tourelle de plus n'aurait posé que « où passent-ils ? », à quoi la
  carte répond déjà. Ni les talcs ni les mobiles ne se cumulent : le meilleur gagne.
- Les **barricades** passent par `terrain.laneBlockNode` : deux comparaisons dans le
  tick, pas une ligne de géométrie, et une barricade ne peut PHYSIQUEMENT pas être
  contournée sur sa voie. Les agrippeuses l'ignorent — filtre pour les fonceurs de
  berceau, règle qui se lit en une partie. Un fonceur arrêté lui inflige exactement son
  `cribDps` : pas de seconde statistique à équilibrer. Détruite, la dalle se rachète au
  prix plein : perdre un mur doit coûter.
- **Le berceau EST la boutique du bébé** — un emplacement virtuel, jamais déclaré par
  une carte. On y répare (25 or les 40 PV, le seul soin FIABLE du jeu : la tétine est
  un ramassable, donc un hasard), on l'agrandit, et on achète les cinq améliorations du
  bébé (`game/loadout.ts`, 4 paliers, courbe 50/80/128/205). **`emptyLoadout()` est
  l'IDENTITÉ** : une partie fraîche a exactement les stats d'avant, ce qui est la
  condition pour que `grip` mesure toujours les mêmes paliers.
- `Bullets` accepte un **`Shooter`** (bébé ou tour) et `fireAcc` vit sur le TIREUR :
  avec un accumulateur partagé, tout le monde tirerait en salve synchrone à cadence
  divisée. La durée de vie d'une balle dérive de la portée du tireur.

### Bestiaire et boss

**Le CIBLAGE est l'axe de design** (`ENEMY_KINDS`) : **Mamie bisous** vise le BÉBÉ,
lente, grosse, s'agrippe — elle ne touche jamais le berceau, sa menace est de te clouer
pendant que les autres passent ; **Couche sale** vise le BERCEAU, rapide, fragile,
t'englue au passage et laisse une FLAQUE à sa mort ; **Brocoli** se poste à
`shootRange` du berceau et bombarde — le bébé s'il est à `PEA_AIM_RANGE`, LE BERCEAU
sinon. `cribDps` de la couche est LE terme dominant du budget de dégâts et n'est borné
par rien.

**Trois boss, TROIS CONTRE-JEUX** (`BOSS_KINDS`, socle partagé, seul `update`
diverge) — trois barres de PV avec des sprites différents n'auraient été qu'un seul
combat répété trois fois :
- 🧹 **Aspirateur** (jardin) : l'embout PIVOTE vers le bébé et **gobe les projectiles
  du cône**. Invulnérable de face, il faut le CONTOURNER — tourner autour de près bat
  sa rotation (168/150 ≈ 1.12 > 1.1), de loin non, ce qui met le joueur là où les
  mamies font mal.
- 🍳 **Robot ménager** (cuisine) : télégraphe court avec sa ligne dessinée au sol, dash
  rapide, puis une récupération immobile qui EST la fenêtre de dégâts. Il ne charge
  qu'une fois ARRIVÉ au berceau (ou si le bébé vient le chercher) — sans cette porte il
  passait la nuit en allers-retours et ne rongeait jamais l'objectif. La charge
  n'englue qu'UNE fois par passage : la punition doit être « tu es collé », pas « tu as
  perdu ».
- 🌀 **Machine à laver** (grenier) : se gare sur le berceau et pulse des anneaux de
  mousse complets (compte IMPAIR, on passe entre deux mousses). Rien ne la fait taire :
  il faut du DPS soutenu, donc des tours. C'est le boss qui valide l'équilibre 50/50.
  Elle ne pivote PAS — un gros caisson carré incliné se lit comme un bug.

`hpMul` porte aussi les PV du boss : UN seul levier de difficulté par carte. Marqueurs
de danger au double codage habituel : une FORME (le couloir à sa largeur exacte de
contact, l'anneau qui se remplit) et un MOUVEMENT (le strobe de fin de télégraphe).

### Rendu

- **Le sol de chaque carte est CUIT une fois** (`render/mapBake.ts`) à la taille de
  l'arène : un sprite, un draw call, zéro coût au tick, caché par `map.id` pour que le
  ↻ ne le repaie pas. On peint **DEPUIS LE MASQUE**, pas depuis les vecteurs : rendu et
  simulation lisent la même table, il est donc structurellement impossible que le sol
  montre une voie là où la horde ne passe pas. `Terrain.mat` distingue au rendu le mur
  de l'eau, que la collision confond.
- **ARRONDI PIXEL de la caméra**, obligatoire : sous une texture de sol échantillonnée
  au plus proche voisin, un décalage fractionnaire duplique des lignes et des colonnes
  entières qui rampent sur tout l'écran au moindre panoramique.
- **Pixel art** : tout est plotté au PIXEL EXACT (`pxEllipse`/`pxDisc` en scanline),
  jamais `arc()`. Trois réglages solidaires décident de la netteté : `antialias: false`,
  `scaleMode` **nearest**, et `image-rendering: pixelated` sur le canvas.
- **Piège de rendu vécu** : dans Pixi v8, `g.arc()` sans `moveTo` préalable se relie au
  point courant du chemin — resté à l'ORIGINE DU MONDE — et trace une balafre en
  travers de l'écran. Vu sur la jauge de grip et les arcs du cône.
- **Trois biomes** (`garden`/`kitchen`/`attic`) : tuile de sol, matériau de voie,
  planche de props et teinte des motes d'ambiance. Interdits identiques aux autres jeux
  — pas de hachures jaune/noir, pas d'anneaux, pas d'aplats blancs — et le décor ne
  doit jamais IMITER un danger : l'EAU n'a aucun anneau et son corps est nettement plus
  froid et sombre que la flaque engluante (même piège que la dalle `earthLight`
  assombrie). Une VOIE se marque par le MATÉRIAU, jamais par un code. Le décor refuse
  de poser un prop sur une voie ou dans un massif : un buisson au milieu du chemin ment
  sur la passabilité.

### Interface et accessibilité

- **Feuille d'achat FIXE en bas d'écran**, pas une bulle ancrée au monde : l'arène
  défile (une bulle devrait être repositionnée chaque frame ET composer avec le
  letterbox), et en 540×960 elle n'aurait nulle part où aller sur un emplacement du
  haut. Une feuille fixe a un ordre de tabulation STABLE, et c'est ça qui rend la
  conformité RGAA bon marché. On ne vole JAMAIS le focus à l'ouverture — elle s'ouvre
  en marchant. Invite en jeu : un chevron qui FLOTTE au-dessus de la dalle, jamais un
  anneau (code des dangers).
- **`steer.setKeyboardBlocker`** : le trou réel, invisible à tout test au doigt.
  `onKeyDown` avale ZQSD et fait `preventDefault`, donc tabuler dans la feuille faisait
  courir le bébé hors de portée et le panneau se refermait sous les doigts. Le
  pointeur, lui, reste actif. Et `#hud-build` est `pointer-events: auto` sur tout son
  CONTENEUR, pas seulement ses boutons — sinon un glissement démarré entre deux offres
  passe au travers (leçon de Cerveau prise à l'envers).
- Une carte verrouillée de l'écran de sélection est un `<button disabled>` dont
  l'`aria-label` NOMME le prérequis : un bouton muet qui ne répond pas est pire que pas
  de bouton.
- **Arène plus grande que l'écran**, caméra à deadzone clampée aux bords. Corollaire
  OBLIGATOIRE du hors-champ (`render/overlayView.ts`, espace écran) : chevrons de bord
  priorisés par proximité au BERCEAU, flèche vers le berceau, liseré rouge pulsé quand
  il est mordu loin du regard. Sans ces trois signaux on perd sans comprendre pourquoi.
- **Contrôles** (`input/steer.ts`) : joystick virtuel (écoute sur `window`, deltas
  divisés par le scale du letterbox) ET clavier ZQSD/WASD/flèches par `event.code`. Les
  deux sources sont FUSIONNÉES, jamais additionnées : la dernière active gagne. `blur`
  relâche tout.

### Sauvegarde

`rendilo-reale:crib:save:v1` (clé jamais renommée, version DANS le JSON, fusion champ
par champ avec garde de type, `resetSave` mute EN PLACE). Schéma **v2** : `muted`,
`wins`, `runs`, et par niveau `{cleared, bestNightSec, bestCribHp, stars}`.
`levelUnlocked` DÉRIVE le déblocage séquentiel, il n'est jamais stocké — le stocker
créerait deux sources de vérité dont une qu'un save corrompu contredit. Migration
v1 → v2 : le niveau de test unique ÉTAIT le jardin, donc le vétéran retrouve sa
victoire et le déblocage de la cuisine, avec UNE étoile seulement (son temps vient
d'autres règles). Écrite UNIQUEMENT par `game/flow.ts`, en une écriture par fin de
niveau ; le ↻ et le retour menu ne flushent pas.

### Vérification

`node tools/verify-crib.mjs <url> <scénario>` — `grip`, `day`, `win[:carte[:seed]]`,
`idle[:carte[:seed]]`, `keyboard`, `stress`. Carte = `garden` | `kitchen` | `attic`,
ou 1-3 ; le harness DÉVERROUILLE toute la chaîne, `startCampaignLevel` clampe sinon.

- **`grip` est le test de non-régression de la mécanique centrale et se lance après
  TOUTE retouche des `GRIP_*` ou du tir** : trois phases, sept assertions. Il survit
  sans modification grâce à « le tick est identique jour/nuit ». Son contrat est écrit
  en commentaire dans `world.ts` — ne pas le casser.
- **`day` est son équivalent pour la moitié économie** : neuf assertions, dont
  « acheter la nuit est REFUSÉ » (la garde est dans `buy`, pas dans l'UI) et « le
  bâtiment survit à la nuit ».
- Le bot MARCHE jusqu'aux dalles et n'implémente AUCUN coût en node : `buy` applique
  exactement les gardes du bouton, il n'existe donc pas de second chemin non testé.
  Un achat téléportable laisserait passer une régression sur la moitié du design de la
  phase de jour. Il échantillonne à 90 ms : il pilote en boucle ouverte, donc sa
  qualité de jeu suit la cadence — à 140 ms et 40 fps, l'issue d'un run dépendait du
  bruit de la machine plus que de l'équilibrage.
- **La mesure d'équilibrage est `run.cribDamage`, PAS les PV restants** : la réparation
  ne coûte que 25 or les 40 PV, donc qui a de l'or termine presque toujours au maximum.
  Le cumul mesure la carte, les PV restants ne mesurent que la dernière nuit. C'est lui
  qui a montré que la cuisine ne prenait que 89 PV sur cinq nuits.

Bande mesurée (conteneur, rendu logiciel, 2026-08 — taux absolus dépendants de la
machine, lire en RELATIF, 2 runs minimum) : `grip` 7/7, `day` 9/9, `keyboard` 7/7,
`stress` ~32-35 fps à 400 ennemis, 0 erreur console.

- **jardin** `win` 3/3, berceau restant 44-141 sur 360, dégâts cumulés 299-356 ;
  `idle` défaite nuit 4 (401 de dégâts).
- **cuisine** `win`, dégâts cumulés 168 sur 300 — la carte où bâtir paie ; `idle`
  défaite nuit 3.
- **grenier** `win`, dégâts cumulés 359 sur 340 ; `idle` défaite nuit 3.

Règle de calage : **le jardin est le tutoriel, sa victoire doit être FIABLE**. À
320 PV de berceau elle était à 2/3 — un tirage à pile ou face, le pire ressenti
possible sur un premier niveau ; à 360 elle est à 3/3 sans que la nuit du boss cesse
de mordre (44 PV restants sur l'un des trois runs). Au-delà du jardin, la variance
par carte est assumée : le bot n'a ni retranchement ni adaptation.
Contrôle même machine : hub = 4 jeux listés.

`window.__game = {world, flow, app, layers, save, steer, hero, crib, boss, economy,
buildings, level, terrain}`, `world.postSpawn(kind, x, y)` scriptable.

## Trois Portes (`games/doors/`) — roguelite tactique à deux lignes

**Porte / Monstre / Trésor.** Une run = 9 nœuds + 1 boss, 6 à 8 minutes. À chaque nœud,
**3 portes** dont l'icône annonce la catégorie (le « tell ») et rien d'autre ; en franchir
une ferme les deux autres. Le joueur part **seul** et finit à 4 s'il joue bien.
Méta-progression par **éclats**, gagnés même en cas de wipe.

C'est le second jeu au TOUR PAR TOUR du hub, et il reprend l'architecture de Cerveau :
canvas Pixi `aria-hidden` pour le visuel, **toute** l'interaction en DOM natif.

### Les trois piliers, et ce qui les rend vrais dans le code

1. **Le front est une ressource qui se consomme.** Toute la tactique découle de la règle
   de ligne (`Combat.legalTargets`) : le contact ne vise que la ligne avant adverse ; si
   elle est vide, la ligne arrière DEVIENT la ligne avant ; la distance ne connaît aucune
   restriction. Deux phrases, et elles produisent l'essentiel des décisions.
2. **Le cap dur transforme une récompense en dilemme.** `SQUAD_CAP = 4`. Recruter à 4/4
   impose de renvoyer quelqu'un, définitivement et **sans remboursement** (`Squad.dismiss`).
3. **L'or ne peut pas tout faire.** Soigner (2 or/PV), ressusciter (25) et s'équiper
   (25-40) puisent dans la même bourse. `assertBalanceSane` interdit qu'un objet coûte
   MOINS qu'une résurrection — sauver reste la moins chère des options, mais ne fait pas
   progresser. Le Fanion usé est délibérément À ÉGALITÉ (25) : c'est là que la question
   pique.

### Le modèle de combat est PUR

`game/combat.ts` n'a ni horloge, ni `Math.random`, ni DOM, ni rendu — et **aucune variance
de dégâts** (design §3.4 : le joueur doit pouvoir compter son létal ; l'aléatoire vit dans
la génération des portes, jamais dans la résolution). Réduction SOUSTRACTIVE, plancher à
1 dégât. Deux conséquences voulues : le bot rejoue un combat entier hors de la page, et
l'écran n'a qu'à animer une file d'ÉVÉNEMENTS déjà résolus (`World.play`, un délai par
type dans `DELAY`).

- **Une mort LIBÈRE son emplacement.** Sans ça, un arrière ne pourrait jamais remonter au
  front, alors que « reformer le mur quand le dernier tank tombe » est le moment fort que
  le design décrit. C'est aussi pourquoi `legalSwaps` propose une place LIBRE et pas
  seulement un allié à échanger.
- **`abilityIsActive` doit inclure les capacités d'IA** (`litany`, `jailer`). Les oublier
  faisait échouer `canUseAbility`, donc `act()`, donc `autoAct` se rabattait
  silencieusement sur Défendre : **le boss n'avait plus de phase 2 du tout**. Attrapé par
  le scénario `rules` du bot, invisible en jeu.
- **La permutation coûte le tour entier**, sauf la première du combat avec les Bottes
  lestées (`usedFreeSwap`) — auquel cas `act()` ne fait PAS avancer la file.
- L'IA est **déterministe** : létal d'abord, puis la cible la plus basse en PV. C'est la
  contrepartie des dégâts déterministes — le joueur doit pouvoir anticiper.
- **Le Rôdeur est la pièce la plus importante du bestiaire** : perceur, il vise la ligne
  arrière du joueur. C'est lui qui interdit « je mure et je gagne » et qui force la
  permutation à un moment que le joueur n'a pas choisi. S'il n'apparaît pas assez tôt, le
  critère de réussite n°1 du POC (« le joueur permute-t-il ? ») ne peut pas être observé.
- **L'Idole ronflante est un puzzle, pas une menace** : 0 ATQ, elle rend 4 PV au plus
  blessé chaque tour et vit hors de portée du contact. Le combat devient ingagnable tant
  qu'elle vit → il faut une réponse à distance, **ou le Carquois lourd**.
- **Écart assumé au design sur le Carquois lourd** : le texte dit « les attaques *à
  distance* ignorent toute règle de ciblage prioritaire », mais un objet réservé à la
  distance ne répond PAS à l'Idole — que le même document désigne pourtant comme sa raison
  d'être, puisque le contact ne peut pas atteindre une ligne arrière. On l'étend donc à
  TOUTES les attaques de l'unité (ligne avant ET provocation). Un objet qui casse une
  règle EST sa promesse.

### Génération des portes (`game/run.ts`)

Seedée par `mulberry32`, zéro `Math.random` : une run se rejoue à l'identique, ce qui rend
le bot reproductible. Les cinq règles du design, dans l'ordre où elles contraignent :
recrue garantie au nœud 1 · jamais deux marchands consécutifs · au moins deux portes
Recrue sur la run · marchand garanti au nœud 8 · combats dangereux à partir du nœud 4.
Une porte voilée par nœud dès le nœud 3, jamais posée sur une porte FORCÉE (cacher le
marchand garanti annulerait la garantie).

- **Le nœud 7 ne propose JAMAIS de marchand.** Sans cette clause, les deux règles du
  design se contredisent : le marchand garanti du nœud 8 devient un doublon dès que le
  joueur a acheté au 7. Mesuré par le scénario `gen` : 7 runs sur 40.
- **`VEILED_FIND_GOLD`** : une porte voilée cachant une salle sans or (recrue, trésor,
  marchand) verse quand même une trouvaille. « Majoré de 50 % » n'a aucun sens sur un
  objet ; sans ce versement, la moitié des paris seraient silencieusement perdants et le
  joueur cesserait de parier — ce qui viderait la porte voilée de sa fonction.
- **Correctif d'ouverture** : le nœud 1 garantit une recrue. Sans lui, une mauvaise porte
  au nœud 1 tue la run avant qu'elle commence, et sans or on ne peut même pas ressusciter.
- **La difficulté monte par l'ORDRE des tables, pas par les chiffres** : `PACKS_EASY` et
  `PACKS_HARD` sont triées du plus doux au plus dur et `packWindow(node)` n'ouvre le
  tirage qu'à leurs `node + 1` premières entrées. Le design ne décrit que des fréquences ;
  sans cette rampe le nœud 9 est aussi mou que le nœud 1, et avec elle le nœud 1 ne peut
  plus tirer une meute de chiens contre un héros SEUL — ce qui faisait du correctif
  d'ouverture une obligation à la lettre plutôt qu'un conseil. Aucun chiffre d'ennemi ne
  bouge : ré-ordonner une table SUFFIT à retoucher la courbe.

### Économie et méta

L'or et les objets **meurent avec la run** : l'absence de méta-progression matérielle est
une décision de design, et `meta/save.ts` est l'endroit où on la fait respecter — le
schéma ne contient ni or, ni objets, ni escouade. Revenu attendu d'une run : 140-180 or,
soit environ six résurrections si le joueur ne dépense rien d'autre (`assertBalanceSane`
garde la fourchette).

L'arbre a **cinq nœuds et aucun bonus chiffré** : chacun ouvre une option ou change une
règle (`meta/tree.ts`), correctif à la faiblesse habituelle des stats permanentes qui
rendent les premières runs artificiellement dures et les tardives triviales. **Rang serré
change une run entière** à lui seul — un front à trois autorise une composition défensive
qui n'existait pas. `metaEffects(save)` DÉRIVE tout ; rien n'est stocké en double.
Les succès (`meta/achievements.ts`, 6 familles sans fin + 12 hauts faits dont 3 ★ légende)
ne rapportent **aucun éclat** : la complétion ne doit pas devenir un raccourci vers
l'arbre, et l'arbre est justement ce qu'on veut mériter.

### Accessibilité — la même décision que Cerveau, poussée plus loin

Le canvas est `aria-hidden` ; l'interaction est faite de vrais `<button>` TRANSPARENTS
posés dans le repère logique 540×960, qui subit exactement le même letterbox que le
canvas. On récupère gratuitement tabulation, Entrée/Espace, noms accessibles et anneau de
focus visible AU-DESSUS du canvas.

- **Les boutons couvrent des CASES, pas des unités.** Une case vide de ligne arrière est
  une destination légale de permutation ; sans bouton dessus, le repli — le geste qui
  reforme le mur — serait injouable au clavier.
- **`World.busy` PILOTE l'activation de la barre d'action, et il retombe TOUT SEUL** — à
  la frame où la file d'événements se vide, donc sans qu'aucune action ne se produise.
  Sans le `onStateChanged()` posé sur cette transition (`World.update`), la barre restait
  grisée après le dernier coup ennemi de la manche et le joueur n'avait plus AUCUN moyen
  de jouer : partie bloquée, zéro erreur console. Diagnostiqué par le bot, qui ne trouvait
  jamais « Attaquer » focusable.
- **`Hud.restoreFocus` + `Screens.hide()` qui renvoie `true`** : le trou classique de ce
  genre d'interface. Le joueur valide une cible, le bouton de cette case passe `disabled`
  dans la foulée, le navigateur renvoie le focus sur `<body>` — et un joueur au clavier
  est perdu en plein combat, sans rien à l'écran qui l'indique. Même chose à la fermeture
  d'un panneau, dont le contenu est détruit. On ne rend le focus QUE s'il était à nous :
  le voler à quelqu'un qui joue au doigt serait pire que de le perdre.
- **Le HUD se masque AVANT l'ouverture d'un panneau** (`Flow.openRoom`) : sans ça, on
  pouvait tabuler sur des boutons de combat invisibles, cachés derrière le marchand.
- **Les régions live n'écrivent que sur changement réel** (`Hud.setTop`/`setHint` et le
  résumé de plateau). `refresh()` est appelée à chaque changement d'état ; réécrire
  aveuglément ferait répéter « 25 or, manche 3 » toutes les demi-secondes au lecteur
  d'écran. C'est la règle des `Text` du canvas, appliquée au DOM.
- **Le focus SAUTE sur la première cible légale** après « Attaquer ». Sans ça, un joueur
  au clavier retraverserait toute la barre d'action à chaque coup. `Hud.refresh` est
  appelée SYNCHRONEMENT à chaque changement d'état (`World.onStateChanged`) : on ne peut
  pas donner le focus à un bouton encore `disabled`.
- **`#sr-board`** tient le plateau EN TEXTE (`boardSummary`) et `#sr-log` une phrase par
  événement (`World.onAnnounce`) : c'est ce qui rend la partie jouable sans voir l'écran.
- **La règle de ligne se lit sans les couleurs** : les deux camps occupent des BANDES
  distinctes séparées par un trait, la ligne avant EFFECTIVE porte un liseré plein et
  l'arrière un pointillé (continuité + épaisseur, pas deux teintes), les cibles légales
  et les emplacements de permutation sont encadrés en POINTILLÉ, l'unité active a un
  halo + un anneau plein, et l'ordre de tour affiche un socle plein (toi) ou creux
  (l'ennemi). Les chiffres sont écrits en clair sous chaque unité.
- **Les stats du canvas sont en toutes lettres** (`6 atq · 9 ini · contact`), jamais en
  dingbats : le canvas retombe sur la police système, où ⚔ ⚡ 🛡 sortent en tofu selon la
  machine. Les emoji restent réservés au DOM.
- **Le bandeau d'ordre de tour se PROLONGE sur la manche suivante** (`Combat.queue`) : en
  fin de manche il ne restait qu'une vignette, et un bandeau vide n'enseigne plus que
  « l'INIT est une statistique, pas une décoration ».
- Comme Cerveau : `user-scalable=no` est RETIRÉ (WCAG 1.4.4) et `touch-action: none` ne
  vit que sur le canvas — un jeu au tour par tour n'a aucun geste continu à protéger.
- **Mouvement réduit** traité côté canvas ET DOM : `prefers-reduced-motion` lu UNE fois au
  boot, en OU avec l'option joueur (jamais en ET). Particules coupées, motes garées,
  cadence de rejeu ÷2 — jamais 0 : on doit encore LIRE ce qui se passe.

### Rendu — pixel art chaud, écrit à la main

`render/sprites.ts` : 27 sprites en grilles de **16×16 caractères**, une lettre par teinte,
palette par sprite. `render/textures.ts` les peint case par case (rectangles pleins de
taille ENTIÈRE en pixels device) et les expose aussi en `data:` URL — les panneaux DOM
(recrutement, marchand, escouade, bestiaire) les affichent en `<img>`, sans quoi la moitié
du jeu, qui se joue hors du champ de bataille, serait un mur de texte.

**PARTI PRIS : rien qui fasse peur.** Le bestiaire garde EXACTEMENT les rôles et les
chiffres du design, mais ses silhouettes sont rondes, ses yeux grands et ses couleurs
chaudes — un rat joufflu, un tas d'os débonnaire, une idole qui ronfle pour de vrai, un
geôlier bougon. La menace se lit aux CHIFFRES et à la position sur les lignes ; comme les
dégâts sont déterministes, on ne perd littéralement aucune information en la retirant de
l'image. Même parti pris pour les tells : une lame plutôt qu'un crâne, deux lames croisées
pour le combat dangereux (le tell double, comme les deux crânes du design).

Charte : prune nuit `#2e1b2b`, ambre, or `#ffc247`, crème `#fff3dc`. Le seul froid du jeu
(`cool #7fe0d8`) est réservé aux informations neutres — il tranche parce qu'il est rare.
`scaleMode` reste **linear** (le letterbox impose une échelle fractionnaire, où `nearest`
scintillerait d'une frame à l'autre) ; les vignettes DOM, elles, sont à échelle entière et
donc en `image-rendering: pixelated`. Le « chatoyant » est un semis de motes dorées
(`render/ambience.ts`) posé SOUS le gameplay, comme la météo d'Essaim.

**Composition de l'écran des portes** : portes en HAUT, escouade EN DESSOUS. On regarde
d'abord ce qu'on choisit, on relit ensuite avec quoi on le choisit — l'inverse laissait
160 px de vide en bas et reléguait la décision au milieu de nulle part.

### Vérification

`node tools/verify-doors.mjs <url> <scénario>` — `rules`, `gen[:runs]`, `win[:seed]`,
`band[:runs]`, `lose`, `keyboard`, `contrast`, `stress`.

**Lancer les scénarios longs sur `npx vite preview`, jamais sur `npm run dev`** : le HMR
recharge la page dès qu'on touche une source et tue le contexte d'exécution du bot en
plein milieu d'une run.

- **`rules` est le test de non-régression du modèle** et se lance après TOUTE retouche de
  `combat.ts` ou de `balance.ts` : 27 assertions montées à la main DANS la page mais HORS
  de toute partie — règle de ligne, front vide, distance, provocation, carquois, armure
  plancher, élan, tir ajusté, meute, défense qui retombe au bon tour, phase 2 du boss,
  expiration du spectre, emplacement libéré par une mort, déterminisme, plus les gardes
  d'ÉCONOMIE (soin sans or, résurrection d'une invocation, étal qui ne se recharge pas,
  objet rendu au sac par un renvoi, révélation unique, amulette).
- **`gen` vérifie les cinq règles de génération** sur N runs seedées, jouées à sec.
- **`win` / `lose` jouent une run entière en cliquant les VRAIS boutons du DOM** — aucune
  API de raccourci en node. Il n'existe donc pas de second chemin non testé, et une
  régression d'UI (bouton jamais activé, focus perdu, panneau sans issue) se voit avant de
  se voir en jeu. Le bot active le mouvement réduit, qui est une OPTION DU JEU et non une
  porte dérobée : sans elle une run dépasse les trois minutes d'horloge en animations.
- **`band` est la bande d'équilibrage** : N runs sur des seeds différents, distribution
  des nœuds atteints. C'est CE chiffre qu'on relit après tout changement de tuning.
- **`keyboard` joue AU CLAVIER SEUL** depuis l'accueil et vérifie que le focus ne retombe
  jamais sur `<body>` **après une validation** (le traverser pendant une tabulation est le
  comportement NORMAL du navigateur — le compter ferait échouer le test sur une interface
  parfaitement conforme) et que le saut automatique sur la première cible fonctionne à
  chaque tour. C'est le test RGAA.
- **`contrast` recalcule les contrastes** sur les VRAIES valeurs exposées par le jeu,
  jamais « à l'œil ».

`window.__game = {world, flow, hud, app, save, Combat, Run, metaEffects, contrastRatio,
palette, classes, enemies, items}` — `Combat` et `Run` sont exposés pour que le bot monte
ses propres scénarios hors partie.

**Bande mesurée** (conteneur, rendu logiciel, `vite preview`, 2026-08 — les taux absolus
dépendent de la machine, lire en RELATIF, 8 runs minimum) : `rules` 27/27 · `gen:80`
0 échec · `keyboard` 8 tours, saut sur cible 8/8, focus perdu 0 · `contrast` 0 échec ·
`lose` défaite au nœud 1 en 13 s · `stress` ~14 fps · 0 erreur console.

`band:8` → **5 runs sur 8 atteignent le boss, 2 le battent, nœud médian 10**, 35 à 95 s
d'horloge par run en mouvement réduit. C'est la bande visée pour un POC : le bot n'a ni
retranchement ni adaptation, il doit voir le boss souvent et le battre rarement. ATTENTION
en la relisant : `band` répartit son budget de temps entre les runs (`SECONDS / runs`), une
run lente est donc TRONQUÉE et compte comme un arrêt prématuré — donner large (`band:8 600`
au minimum) avant de conclure qu'une run est morte tôt.

Run de référence `win:12345` : boss atteint en 43 s, soin du héros au marchand du nœud 5,
résurrection de l'Archère + achat du Carquois lourd au nœud 8, arrivée à 4 unités. C'est
exactement l'histoire économique que le design attend — l'or part sur les DEUX postes, ce
qui est le critère de réussite n°3 du POC.

**Limite connue du bot, à garder en tête en lisant la bande** : il ne PERMUTE
quasiment jamais (il ne le fait que privé de cible), alors que « le joueur permute-t-il ? »
est le critère de réussite n°1 du POC. Le bot ne peut donc pas répondre à cette
question-là — c'est une observation à faire sur un humain. Il mesure la SURVIE et
l'ÉCONOMIE, pas la richesse tactique.

Contrôle même machine : hub = 5 jeux listés, `verify-crib grip` 7/7.

### Hors périmètre (à ne pas ajouter sans re-cadrer)

Étage 2 et biomes multiples · alliés temporaires hors cap sur plusieurs combats · types,
éléments, faiblesses · niveaux d'unité et expérience · craft et fusion d'objets ·
événements narratifs à choix multiples · plus de six objets ou plus de six classes.
L'allié temporaire hors cap DURABLE est écarté explicitement : il contredit frontalement
le cap dur, qui est le meilleur générateur de décisions du jeu.

## Duo (`games/duo/`) — huit micro-jeux à deux enfants sur un seul téléphone

**Une collection, pas un jeu** (~15 000 lignes, `docs/prompt-duo.md` = la spec
contraignante). Le public est une paire d'enfants de **5 et 8 ans** qui attend au
restaurant, et c'est lui qui tranche TOUS les arbitrages : une manche dure 45 à 90 s,
la règle s'apprend par une boucle animée **sans un mot**, « encore » est à un tap, le
son est **muet par défaut** (seul jeu du hub dans ce cas) et ⏸ fige tout à l'instant —
le plat qui arrive au milieu d'une manche est le cas NOMINAL, pas l'exception.
`games/duo/` est **UNE** entrée du hub et pas huit : huit entrées auraient fait exploser
le menu du hub ET repayé un boot Pixi par micro-jeu. La grille de sélection est un
sous-menu interne ; `hub/games.ts` et `vite.config.ts` ne portent qu'une ligne `duo`.

**Deux postures, jamais mélangées** (`MiniGameDef.posture`) : `pass` = téléphone en
main, portrait **540×960**, on se le passe entre deux tours derrière un plein écran
« passe le téléphone à 🐰 » (`cake`, `tree`, `tiles`, `beast`, `suspects`) ; `side` =
téléphone posé à plat, paysage **960×540**, les deux enfants assis **côte à côte, même
orientation**, un tiers d'écran chacun (`plank`, `mirror`, `ant`). Le côte-à-côte est
une hypothèse ASSUMÉE et écrite dans le code — on n'essaie pas de rendre une vue lisible
dans les deux sens. Corollaire non négociable : **la taille logique est un PARAMÈTRE du
letterbox, jamais une constante** (`Shell.setLogical`, appelée à chaque changement de
jeu) ; `#stage` et `#overlay` reçoivent EXACTEMENT la même transform, mesurée identique
sur 4 fenêtres × 8 jeux en basculant `pass` ⇄ `side` à chaud.

### Le contrat `MiniGame` — la réponse au « switch géant »

Un seul contrat pour les huit (`core/minigame.ts`) : `def` (id, titre, emoji, posture,
mode, `logical`, `demo`) + `create(ctx)` → `{ update(dt), render(alpha), setPaused,
destroy }`. Le shell possède la boucle 60 Hz (`@shared/loop`), le letterbox, la pause,
l'écran de passage, l'écran de résultat, le menu et la save ; un micro-jeu ne reçoit que
`seed`, `stars`, `reducedMotion`, `safeTop()` et quatre rappels (`onTurn`, `onAnnounce`,
`onOver`, `onBoard`). **Aucun micro-jeu ne touche au `localStorage`.**

**`model.ts` est PUR** — ni horloge, ni `Math.random`, ni DOM, ni Pixi, ni import de
`view.ts` ; `view.ts` ne mute JAMAIS le modèle ; `index.ts` câble les deux. C'est cette
séparation, et rien d'autre, qui rend le bot capable de rejouer un jeu entier **hors de
la page** (`window.__game.models` expose les huit constructeurs) — même dividende que
`combat.ts` dans Trois Portes : le scénario `rules` monte 1844 assertions sans ouvrir
une seule manche. Ne pas la casser. Les cinq jeux au tour par tour n'avancent dans
`update` qu'une **horloge de rendu** — aucun état de simulation — et animent par des
**fonctions closes du temps écoulé** (pattern de `mind/render/boardView.ts`) : c'est ce
qui fait qu'une animation se fige toute seule dès que le shell cesse d'appeler `update`
(pause, écran de passage) au lieu de se jouer derrière un écran caché.

### Les quatre contraintes du §1, et où le CODE les fait respecter

- **① La règle est un geste** : chaque jeu exporte une liste de coups canoniques
  (`def.demo`) rejouée **à travers le modèle réel** par `core/demo.ts` (voir plus bas).
  Il n'existe AUCUN écran de règles écrites dans toute la collection.
- **② Le coup illégal est physiquement impossible** : la garde vit dans le MODÈLE
  (`canPlace`, `canCut`, `canNudge`, `canMove`, `canToggleLight`, `canValidate`,
  `canPick`, `canAsk`, `canAccuse`, `tryDropBlock`), le DOM ne fait que la refléter en
  `disabled`/`hidden`. Vérifié en forçant à l'état actif puis en cliquant TOUTES les
  cibles mortes des cinq jeux `pass` : **zéro mutation de `model.state`**. Aucun jeu
  n'affiche jamais « coup interdit » — les deux seules occurrences de « impossible »
  dans les sources sont des `throw` de génération.
- **③ Le but est un objet visible en permanence** : paniers de `cake` et de `tree`,
  piles de dominos de `tiles`, bandeau de sortie à chevrons de `beast`, portraits +
  compteurs 🔍 de `suspects`, disque vert + fanion de `plank`, rangée des six arches de
  `mirror`, quatre fleurs sur la ligne d'arrivée de `ant`. **QUATRE de ces objets ont dû
  être ajoutés après coup** (les paniers de `cake`, la rangée d'arches de `mirror`, le
  bandeau de sortie de `beast`, les compteurs de `suspects`) : c'est le critère qu'on
  croit tenu parce que la RÈGLE interne est claire, alors que l'écran ne montre rien qui
  se remplisse.
- **④ La défaite a une cause à l'écran** : `Result.reason` a DES BRANCHES, jamais une
  formule unique — « 6 parcours sur 6 : tout est fini ! » ≠ « 4 parcours sur 6 : le
  temps est écoulé », « 8 tuiles posées contre 5 » ≠ « 8 tuiles chacun : la dernière
  posée l'emporte ». Le shell fige exprès le plateau `RESULT_DELAY_SEC` (1,1 s) AVANT
  d'ouvrir le panneau, pour que la cause se voie en image.
- **Corollaires ergonomiques** : toute cible tactile fait **≥ 60 px** logiques (mesuré
  dans la page sur les huit jeux, l'accueil, le menu et la pause : 0 cible en dessous)
  et **aucun jeu ne demande un tracé de précision**.

### L'écart d'âge est le sujet : ⭐, et « le perdant choisit »

- **Le handicap est un OBJET, jamais un multiplicateur caché** (§1.3) : deux dominos
  déjà posés et marqués, un jeton ✂ à côté du panier, une lampe de plus sous le
  plateau, une fourmi plus rapide annoncée par un ⭐ collé à elle, des trous rétrécis
  avec un ⭐ posé contre le plateau. Sept jeux sur huit en portent un.
- **PIÈGE VÉCU, LE PLUS GRAVE DE LA COLLECTION — la polarité ⭐ était INVERSÉE dans six
  jeux sur huit** : l'accueil libelle ⭐ « un coup de plus » (le petit, qu'on aide) et
  ⭐⭐ « sans coup de plus », mais `cake`, `plank`, `tree` et `tiles` (attrapés à l'audit
  jeu par jeu), puis `ant` et `beast` (à l'harmonisation), lisaient `stars === 2` comme
  l'aidé. **L'aide partait au mauvais enfant** — exactement la panne que le §1.3 décrit
  (« le grand crie à la triche, le petit ne comprend pas sa victoire »), et elle est
  invisible à l'œil : mesurée au fuzz sur `cake`, le siège ⭐ obtenait 40,5 % de son
  fruit préféré au lieu de 59,3 %. Le patron canonique est désormais écrit **dans
  `core/minigame.ts`**, le seul fichier que les huit lisent :
  `helped = stars[0] !== stars[1] ? (stars[0] === 1 ? 0 : 1) : null` — `null` parce
  qu'**un handicap donné aux DEUX n'en est plus un**.
- **Le perdant choisit le jeu suivant** (seule règle de méta, obligatoire) : le menu
  s'ouvre avec sa mascotte agrandie, un halo de SA teinte sur la grille et une ligne
  `aria-live`. Une manche coopérative laisse le choisisseur inchangé.
- **Aucun palmarès persistant.** Le score de table (`3 – 1`) vit en mémoire et meurt
  avec l'onglet ; le save ne contient **aucun** compteur de victoires, aucun record,
  aucun succès. `meta/save.ts` est l'endroit où cette décision de design se fait
  respecter — même discipline que l'absence d'économie dans le save de Berceau. Clé
  `rendilo-reale:duo:save:v1`, version DANS le JSON, fusion champ par champ avec garde
  de type, `resetSave` qui mute en place.

### Le shell — les quatre pannes qu'il a coûtées

`core/shell.ts` (letterbox, calques, régions live, montage d'un micro-jeu),
`core/flow.ts` (`home | menu | game | pass | result | pause`), `ui/{hud,screens,pass}.ts`.

- **LE BANDEAU DE TABLE RECOUVRAIT LE HAUT DU REPÈRE LOGIQUE.** Il vit en espace ÉCRAN
  (§4.1.3 : ⏸ ne doit pas valser d'un jeu `pass` à un jeu `side`) alors que le plateau
  est letterboxé et centré sur la fenêtre entière : les deux se recouvraient d'une
  hauteur qui n'est même pas constante — **mesuré de 0 à 114 px LOGIQUES** selon la
  fenêtre et la posture. Cinq des huit jeux avaient contourné le trou chacun de son
  côté, avec cinq constantes empiriques différentes (dont un `SHELL_BAR_H = 96` dans
  `ant` faux dans les DEUX sens), et le sixième format de fenêtre les prenait toutes en
  défaut. Correction de fond : le bandeau est **réservé hors du letterbox** (le plateau
  se centre dans la bande libre), et `ctx.safeTop()` publie le recouvrement RÉSIDUEL
  **recalculé, jamais affirmé** — il retombe à 0 pour les huit jeux dans les deux
  postures. Un micro-jeu qui borde son bord haut lit CE nombre, jamais une constante.
- **LE FOCUS RETOMBAIT SUR `<body>` PENDANT LE DÉLAI DE RÉSULTAT, SUR LES HUIT JEUX.**
  `onOver` masque `#overlay` — donc l'élément focalisé disparaît — et le panneau n'ouvre
  qu'1,1 s plus tard : entre les deux, plus rien à focaliser. Correctif : **le focus
  d'abord, le masquage ensuite**, sur une ancre VIVANTE et nommée du bandeau qui annonce
  au passage la cause de la fin de manche.
- **L'ÉCRAN DE PASSAGE SURVIVAIT À TOUT CHANGEMENT D'ÉCRAN.** `#pass` n'était fermé que
  par le tap de son propre bouton : « encore », « un autre jeu », « quitter » ou une fin
  de manche déclenchée depuis le passage laissaient un plein écran OPAQUE par-dessus le
  reste. Vu à la capture d'écran, pas au raisonnement — les huit jeux s'affichaient
  derrière une grenouille géante, **sans une erreur console**. `Flow.enter()` est
  désormais LE point unique qui re-décide les cinq plans d'un bloc (plateau, bandeau,
  boutons du jeu, écran de passage, vignettes du menu) : toute nouvelle transition doit
  y passer.
- **LE SERVICE WORKER DU HUB SERT LA PAGE DU HUB SUR UNE URL À QUERY.** Il est configuré
  avec `navigateFallback: '/index.html'` : dès qu'il est installé, une navigation vers
  `/games/duo/?probe` (absente du précache À CAUSE de la query) rend le hub. D'où
  `#probe` — un hash n'est jamais envoyé au réseau. À garder en tête pour tout outil :
  **un scénario qui change d'URL doit utiliser un hash ou repartir d'un contexte neuf**,
  et un changement de hash SEUL ne recharge pas le document (il faut un `reload()`).

Le plein écran de passage **masque** le plateau (`visibility:hidden`), il ne le voile
pas : un voile semi-transparent laisse deviner le coup de l'autre. Pendant son
affichage, il reste **exactement un élément focalisable** dans la page — mesuré.

### La démonstration EST un rejeu du modèle réel (§2.4)

`core/demo.ts` rejoue `def.demo` **à travers le modèle réel**, à cadence lente, en
boucle. Écrire une animation de démonstration séparée est interdit : elle divergerait de
la règle au premier ajustement, et c'est exactement le tutoriel qui doit rester vrai. Le
rejoueur a **huit règles écrites en tête de fichier** parce que les huit jeux ont dû les
DEVINER avant qu'il n'existe — la première porte tout : **le rejoueur recrée le micro-jeu
à chaque tour de boucle, au même seed, donc deux boucles consécutives sont IDENTIQUES à
la frame près**. Les autres : un verbe inconnu est transmis tel quel (le rejoueur ne juge
aucun verbe, sinon la règle vivrait à deux endroits) ; `hold` absent ⇒ cadence lente,
`hold` présent ⇒ exactement cette durée, zéro compris ; `update` n'est jamais appelé
avant le premier coup ; les rappels du contexte sont INERTES et `stars = [2, 2]` (une
vignette n'ouvre pas d'écran de passage et n'enseigne pas le réglage de la table) ;
l'overlay est détaché du document ; les écouteurs `window` du micro-jeu sont neutralisés
pendant `create()` — sans quoi une vignette de `plank` volait les flèches au joueur qui
navigue dans le menu au clavier (mesuré : `defaultPrevented === true` sur ↑↓←→ et ZQSD).

- **PIÈGE VÉCU : les démos divergeaient à leur deuxième boucle.** Celle de `plank`
  franchissait la sortie du parcours 1 en 1,08 s, donc le tour suivant repartait du
  parcours 2, puis du 3 — la vignette cessait d'enseigner le geste. Celle de `beast` se
  FIGEAIT avec un chasseur ⭐ (la validation exige le compte exact de cases, la liste
  canonique n'en éclaire que 3) et ne montrait que des 🔥, donc ni le thermomètre ni ses
  trois codages. Celle de `cake` appliquait trois crans en un pas et téléportait la
  poignée de 90°. La règle ① est aujourd'hui **mesurée** par le scénario `stress`
  (`lastLoopTicks` identique d'une boucle à la suivante), pas seulement affirmée.
- **LES VIGNETTES ANIMÉES DU MENU : la dépense est la RASTÉRISATION, pas le rejeu.**
  Les huit micro-jeux sont montés dans huit conteneurs d'UNE MÊME scène Pixi, sur une
  planche de 3×3 cellules invisible sous le panneau de menu, puis chaque cellule est
  recopiée par UN `drawImage` dans le petit `<canvas>` de sa vignette — surface à
  surface, sans `extract`, sans `toDataURL`, sans allocation. Mesuré : accueil 44 fps,
  menu à huit vignettes repeintes par frame **14 fps**, et les rendre invisibles rend
  **36 fps d'un coup** — couper le rejeu des modèles ou la recopie ne rend ~1 fps ni
  l'un ni l'autre. D'où `PAINT_PER_FRAME = 2` en tourniquet : le coût par frame est
  BORNÉ et indépendant du nombre de vignettes, chacune se rafraîchit à ~8 Hz et le
  MODÈLE, lui, continue d'avancer à 60 Hz — **on espace la peinture, jamais le temps.**
  Un `IntersectionObserver` coupe tick, rendu et recopie d'une vignette hors champ.
  Écartés : huit `Application` Pixi (le navigateur plafonne les contextes WebGL) et une
  grille de menu dessinée en Pixi (elle refaisait tout le focus et le défilement).

### Accessibilité — le contrat de Cerveau et Trois Portes, à huit jeux

Canvas `aria-hidden`, interaction en **vrais `<button>`/`<input>` transparents** dans
`#overlay`, qui subit la même transformation que `#stage`. `#overlay` est
`pointer-events: none` et rend les événements à `button`, `input`, **`.pad` et
`.stickzone`** (les zones continues des jeux `side`) — sur leurs CONTENEURS, pas
seulement sur les boutons, leçon de Cerveau prise à l'endroit cette fois. `refresh()`
synchrone à chaque changement d'état, focus qui saute sur la première cible légale,
`restoreFocus` qui ne rend le focus **que s'il était à nous**.

- **PIÈGE VÉCU, invisible à tout test au doigt : trois jeux `side` volaient le clavier
  au shell.** `onKeyDown` écoute sur `window` et faisait `preventDefault()` sans
  regarder où était le focus — focus sur ⏸ ou 🔊 + Espace/Entrée = le personnage sautait
  ET l'activation native du bouton était AVALÉE, donc **la pause devenait
  inatteignable au clavier**, ce qui casse le §1.2. Même famille : `mirror` annulait
  l'activation native du bouton ⬆ qu'il croyait protéger d'un double déclenchement, donc
  Espace sur ⬆ focalisé ne sautait pas du tout ; et son ⬆ n'écoutait que `click` (donc
  le `pointerup`), alors que sa fenêtre de coyote fait 0,1 s — la latence ÉTAIT la
  mécanique.
- **Le bot du dépôt avance par `el.click()`, une synthèse JS qui traverse
  `pointer-events: none` sans rien remarquer.** Contrôle fait au VRAI pointeur sur les
  huit jeux : les 49 contrôles vivants renvoient bien eux-mêmes sous leur centre, et un
  glissement réel sur le `.pad` de `plank` fait bouger la bille. À refaire après toute
  retouche du CSS de `#overlay`.
- **Contrastes calculés, jamais jugés à l'œil** : une quinzaine d'échecs WCAG 1.4.11
  trouvés au calcul et INVISIBLES à l'inspection — l'anneau de zone interdite de `ant`
  (2,31:1), la mémoire du chasseur de `beast` atténuée à alpha 0,4 (1,96:1), le sol de
  `mirror` contre le vide (1,56:1, c'est-à-dire l'information centrale du jeu), les
  cases bloquées de `tiles` (1,54:1), le liseré de la sortie de `plank` (1,48:1). Le
  texte ne se pose JAMAIS sur une teinte de mascotte : la chouette plafonne à 3,93:1,
  donc l'écran de passage met son libellé sur une plaque `bgDeep` et garde la teinte
  comme grand aplat (objet graphique, seuil 3:1). **`plum` est le piège récurrent** :
  2,49:1 sur `panel`, 3,23:1 sur `bg`, 3,78:1 sur `bgDeep` — trois usages, trois
  traitements explicites, et le scénario `contrast` du bot ne teste PAS `panel`.
- **Jamais la couleur seule** : joueur = teinte + forme de socle + mascotte ; thermomètre
  de `beast` = teinte + pictogramme + nombre de barres ; fruits de `cake` = couleur +
  forme ; paniers de `tree` = disque/losange, teinte, et cadre doré pour le tour actif.
- **Mouvement réduit** lu UNE fois au boot, en **OU** avec l'option joueur (jamais en
  ET ; la case est alors cochée ET verrouillée). Il ne doit JAMAIS amputer
  l'information : `tree` escamotait branche et pommes en une frame, donc supprimait
  « ce que tu coupes tombe et part dans TON panier » — la chute est conservée, seule la
  durée change ; la cadence de démo est ÷2, **jamais 0**.

### Les huit jeux — ce que chacun a coûté

- **`plank`** (side, coop) — sous-pas de collision : la bille ne traverse aucun mur à
  `PLANK_VMAX`. **PIÈGE : la géométrie de 3 des 6 parcours était fausse UNIQUEMENT avec
  l'aide ⭐ activée** (sortie ×1,3 mordant un bloc ou débordant de la plaque, trous
  rétrécis peints hors plateau) — la vérification précédente, faite sans ⭐, ne pouvait
  pas les voir. Toute vérification géométrique doit se faire **dans les deux réglages**.
  **PIÈGE : la bille OSCILLAIT pendant la pause et tout l'écran de résultat** —
  `prevX/prevY` étaient posés au MILIEU d'`update`, après les gardes de sortie : dès que
  le modèle cesse d'avancer, `prev` reste une frame en arrière alors que le shell
  continue d'appeler `render(alpha)` avec un alpha qui varie. `prev` se pose AVANT toute
  garde, plus un `freezePrev()` appelé par `setPaused(true)`. Idem pour toute entité
  interpolée d'un futur jeu.
- **`mirror`** (side, coop) — un personnage, deux commandes, `MIRROR_COYOTE` = 0,1 s :
  c'est LE paramètre qui rend le jeu jouable à deux. Rien ne bornait `x` à la bande de
  jeu : sur le dernier parcours le personnage sortait par la droite, passait SOUS le
  bouton ⬆ (l'overlay DOM est au-dessus du canvas) et tombait hors champ.
- **`cake`** (pass, duel) — le point silencieusement cassable du jeu est le comptage des
  fruits par part (le `computeFeedback` de cette collection) : fuzzé contre une
  réimplémentation indépendante. **PIÈGE : les pastilles de compte étaient posées à
  gauche et à droite de l'ÉCRAN**, alors que les parts sont à gauche et à droite de la
  CORDE — dès que la corde penchait, l'enfant lisait le compte de l'autre part. Chaque
  pastille est désormais au barycentre exact de sa part.
- **`tree`** (pass, duel) — Hackenbush aux pommes, total de pommes IMPAIR donc jamais
  d'égalité. **PIÈGE : la chute, « l'événement le plus important du jeu », n'était
  JAMAIS vue** — `ctx.onTurn` était appelé à la frame même de la coupe, donc le plein
  écran de passage recouvrait le plateau avant le premier pixel de chute. **PIÈGE :
  deux boutons de branche tombaient au même point dès que deux branches se croisent**
  (134 paires à moins de 2 px sur 300 tirages) : jouable au clavier, impossible au
  doigt. Les paniers ont été descendus au sol — ils étaient en haut, et les pommes
  REMONTAIENT l'écran.
- **`tiles`** (pass, duel) — Domineering 6×6. **PIÈGE PIXI v8 : `sprite.width/height` ne
  fait qu'ÉCRIRE `scale`**, donc le `scale.set(p)` du pop d'apparition écrasait le
  format 1×2 et chaque domino retombait sur UNE case — la forme debout/couché, seul
  porteur de la règle, disparaissait de l'écran. **PIÈGE : le `tint` de Pixi MULTIPLIE**
  — sur un sprite ocre, le bleu ciel sortait olive et le rose sortait rouge brique
  (aucun lien de couleur avec la pile, et une pièce rouge dans un jeu pour 5 ans).
- **`beast`** (pass, asym) — **PIÈGE : le secret fuyait par la région live.** `#sr-board`
  était réécrit AVANT `ctx.onTurn`, donc `aria-live` lisait « tu es la bête, rangée R
  colonne C » à celui qui tenait ENCORE le téléphone ; et au lancement, `startRound`
  affiche le plateau sans écran de passage, donc une manche sur deux le chasseur voyait
  la case de départ. Drapeau `handOff` : tant que le passage n'est pas consommé,
  `#sr-board` n'écrit qu'une ligne neutre.
- **`suspects`** (pass, asym) — génération rejetée tant que 3 questions ne suffisent pas
  à isoler le coupable (recherche exhaustive, c'est bon marché). **PIÈGE : le match nul**
  — la 5ᵉ manche de départage pouvait se solder par le même score (31 nuls sur 80
  parties mesurées), et un nul face à un enfant de 5 ans est une manche perdue pour rien.
  **PIÈGE : le focus atterrissait sur un coup DESTRUCTEUR** — après chaque question,
  `restoreFocus` prenait le premier bouton actif de l'ordre du DOM, donc « accuser » :
  une Entrée de trop et la manche était jouée.
- **`ant`** (side, asym) — le petit court, le grand bloque. **PIÈGE : la garde
  `ANT_BLOCK_MIN_DIST` ne couvrait pas la RÉAPPARITION** (fuzz de 400 tirages) : un
  géant qui campe le départ écrasait la fourmi à chaque but, et « le géant gagne en
  écrasant » n'est pas un jeu. **PIÈGE : la zone interdite DESSINÉE ne disait pas la
  vérité** — un cercle de rayon 40 pour une garde qui est en réalité la somme de
  Minkowski du carré du bloc et du disque de garde (68 px sur l'axe, ~80 en diagonale),
  et le clamp des bornes de pose renvoyait en plus tout le hors-bornes dans la zone
  refusée. Tout un anneau était **dessiné comme permis et refusé en silence** — l'exact
  contraire du critère ②. Le dessin est maintenant le LIEU EXACT des centres refusés
  (carré arrondi, prolongé jusqu'au bord sur tout axe qui touche une borne), balayé sur
  6 072 points : 0 point dessiné comme permis n'est refusé.
- **Le tableau 8 lignes × 4 colonnes exigé par le §9** (où chaque critère du test des
  5 ans est réalisé dans le code) n'a jamais été écrit dans un message de commit :
  **c'est cette section qui en tient lieu**, et les quatre puces du §1 ci-dessus en
  portent les entrées.

### Écarts assumés à la spec — à lire avant de « corriger » quoi que ce soit

Un écart qu'on n'écrit pas est un piège pour le prochain.

- **TROIS pictogrammes de mode au lieu des deux du §4.1.2** : 🤝 coop, ⚔️ duel,
  🎭 asym. Ranger un jeu asymétrique sous « l'un contre l'autre » aurait menti sur ce que
  font les deux joueurs. Le sens complet reste dans l'`aria-label` de la vignette.
- **`beast` ne joue plus qu'UNE moitié** (`BEAST_HALVES = 1`) et la bête a **9 tours au
  lieu de 12** — arbitrage §1.2 contre §3.7, les deux sections se contredisent et le
  §1.2 est déclaré non négociable. Mesuré sur 60 manches : 77 gestes + 29 écrans de
  passage, soit **≈160 s** au budget assumé du dépôt (1,1 s par tap, 2,5 s par passage —
  le tap PLUS la remise du téléphone) ; à une moitié la médiane tombe à **77 s**, et
  12 → 9 tours ramène la QUEUE de 126 à 109 s. Aucune règle du jeu ne bouge : les rôles
  s'échangent d'une MANCHE à l'autre au lieu de le faire au milieu, et le score de table
  porte la symétrie. **Conséquence à connaître** : le départage à deux moitiés reste
  écrit et testé (`decide`) mais ses formules (« l'autre moitié : … », « le sort a
  tranché ») sont **INATTEIGNABLES** tant que `BEAST_HALVES` vaut 1 — ne pas les citer
  comme la réponse du jeu. Remettre 2 suffit à tout rallumer.
- **`ant` : 40 + 40 + 10 s au lieu des 45 + 45 + 15 du §3.6.** C'est le seul jeu dont
  l'horloge est DÉTERMINISTE — il ne peut pas rentrer dans la bande par la qualité du
  jeu — et 45+45+15 fait 105 s, au-dessus du plafond. Pire cas désormais **90 s pile**,
  nominal 80 s (`play:ant` mesuré 108,3 s d'horloge avant, 93,3 s après). Le garde-fou
  de `assertBalanceSane` ne vérifiait que le NOMINAL sous un commentaire promettant le
  contraire : il porte maintenant sur le pire cas, plus un plancher. **Un garde-fou qui
  vérifie autre chose que ce qu'il annonce est pire qu'absent.**
- **Cinq démos sur huit enseignent leur geste en plus de 3 s** (§1.1). Durée d'un tour
  de boucle, pause de lecture de 1,2 s comprise — donc le geste seul vaut la boucle
  moins 1,2 s ; elle est mesurée en pas de simulation et ne varie JAMAIS d'un tour à
  l'autre, c'est l'assertion exacte de la règle ① : plank 2,9 s · mirror 3,0 ·
  tree 3,9 · tiles 4,8 · ant 5,5 · suspects 5,7 · cake 6,6 · beast 7,5.
  Pour les deux plus longues l'écart est un plancher **GÉOMÉTRIQUE** : la fourmi doit
  traverser 784 px à 190 px/s pour ATTEINDRE la fleur (critère ③, 4,1 s incompressibles)
  et le thermomètre de `beast` doit montrer 🔥 🌤 ❄ plus une validation, soit sept coups.
  On préfère une boucle plus longue à une boucle qui ampute son enseignement.
- **`mirror` n'a AUCUN handicap ⭐**, et c'est conforme : le §3.5 est la seule section du
  §3 sans ligne « ⭐ ». `stars` est accepté au constructeur pour la parité de signature
  de `window.__game.models` et ne pilote rien.
- **Arborescence** : cinq fichiers de plus que le §2.2 — `core/shell.ts` et
  `core/flow.ts` (garder `Shell` dans `main.ts` faisait importer son type par
  `core/flow.ts` : cycle d'imports ; `main.ts` ne fait plus que booter),
  `core/probe.ts`, `games/plank/courses.ts` et `games/mirror/courses.ts` (donnée pure de
  niveau).
- **Le `localStorage` est réellement touché par `meta/save.ts`, pas par
  `core/session.ts`** : deux appels (`getItem`/`setItem`) dans toute la collection,
  `session.ts` en est le seul APPELANT. Le §9 dit « aucun `localStorage` hors
  `core/session.ts` » mais le §2.2 impose par ailleurs un `meta/save.ts`, qui est le seul
  à connaître le schéma et sa migration. Écart nommé dans les deux fichiers — les
  commentaires disaient auparavant l'inverse l'un de l'autre, ET tous les deux à côté du
  code, ce qui faisait conclure au grep que l'invariant était cassé.
- **`core/probe.ts` est un micro-jeu jouable, hors de `GAMES` et du menu**, lancé par
  `/games/duo/#probe` : c'était l'échafaudage du §8.2 (valider le contrat `MiniGame` de
  bout en bout) et il est resté dans le bundle. Le §10 interdit « un neuvième jeu » :
  décision de périmètre à trancher — le supprimer coûte un harnais, le garder coûte une
  ligne au §10. Aucun scénario du bot ne s'en sert.
- **Du tuning de gameplay vit hors de `config/balance.ts`**, contre le §2.2 :
  `ANT_TOP_MARGIN` / `BOTTOM_MARGIN` / `ANT_START_X` dans `games/ant/model.ts` (ils
  fixent la distance à parcourir et la hauteur de bande jouable, donc l'équilibrage du
  duel) et `LEVEL_SIZE_MIN` / `LEVEL_SIZE_SPAN` dans `games/tree/model.ts`. Les
  `MAX_GEN_ATTEMPTS` sont des garde-fous, pas du tuning.
- **`suspects` est le seul des huit à ne pas appliquer le patron ⭐ canonique** : il lit
  `stars[guesser] === 1` sans la garde `stars[0] !== stars[1]`, donc deux joueurs réglés
  ⭐/⭐ reçoivent TOUS DEUX le grisé automatique là où les autres n'accordent alors aucune
  aide. Symétrique, donc pas injuste — mais ⭐ n'y veut pas dire tout à fait la même
  chose qu'ailleurs.
- **`cake` ne fait pas glisser « deux grosses poignées »** (§3.2) : la coupe se règle par
  quatre boutons de cran plus « ✂ couper ». Désobéissance à la lettre, mais elle sert le
  second corollaire ergonomique (aucun tracé de précision au doigt) et rend `canNudge`
  exprimable en `disabled`. `tree` affiche UN jeton ✂ (= un coup de plus, donc deux
  coupes au premier tour) là où le §3.3 écrit « deux jetons ✂✂ ».
- **« Le perdant choisit » n'est pas littéral** : sa mascotte est agrandie, doublée d'un
  liseré, d'un halo et d'une annonce, mais l'ORDRE des chips du bandeau ne change pas —
  deux enfants assis ont chacun son côté du bandeau. Conforme au §4.1.3, écart au §1.3
  littéral. De même, **aucun jeu n'utilise la teinte de la MASCOTTE pour identifier un
  siège sur le plateau** (paire fixe `sky`/`berry`, `sky`/`plum` pour `tree`) : deux
  mascottes quelconques n'ont aucun contraste garanti entre elles, mais le lien « le
  lapin rose, c'est moi » ne se prolonge donc jamais sur le plateau.
- **Le plancher de 45 s du §1.2 n'est pas tenu sur certains tirages** de `tiles`
  (39-45 s), `suspects` (30-49 s) et `tree` (35-58 s). Assumé : c'est le PLAFOND qui
  protège le restaurant, et la phrase suivante du §1.2 dit « aucun jeu n'a de partie
  longue ». Allonger un micro-jeu contredirait la spec plus qu'il ne la servirait.
- **`assertBalanceSane()` n'est appelé que sous `import.meta.env.DEV`**, or tous les
  scénarios du bot tournent sur `vite preview` (un build de PRODUCTION) : **aucun
  scénario n'exerce le garde-fou de tuning**. C'est par ce trou que l'assertion
  mensongère de `ant` a survécu. À exercer à la main (esbuild + import node) après toute
  retouche de `balance.ts`, ou à câbler dans un scénario.
- **`ant/view.ts` re-enregistre cinq chemins Pixi par frame** (zone interdite, fourmi,
  jauge, jetons, réticule) là où `plank` et `mirror` gardent une géométrie statique et ne
  font que `position.set` — et le commentaire de `plank/view.ts` énonce la règle POUR LA
  COLLECTION. Non résolu : `crib/render/overlayView.ts` fait exactement la même chose
  dans un jeu livré, où l'invariant « zéro allocation dans le tick » se lit comme portant
  sur la SIMULATION. À trancher : soit le commentaire de `plank` est trop absolu, soit
  `ant` doit s'y plier.

### Vérification

`node tools/verify-duo.mjs <url> <scénario>` — `rules` · `gen[:n]` · `contrast` ·
`physics` · `play:<jeu>[:seed]` · `keyboard[:jeu]` · `stress`.

**Lancer les scénarios sur `npx vite preview`, JAMAIS sur `npm run dev`** : le HMR
recharge la page dès qu'on touche une source et tue le contexte du bot en pleine manche
(deux runs perdus comme ça pendant l'écriture des huit jeux en parallèle).

- **`rules` est le test de non-régression des modèles** et se lance après toute retouche
  d'un `model.ts` ou de `balance.ts` : montées **hors de toute partie** sur
  `window.__game.models`, donc elles rejouent les jeux sans les afficher.
- **`play` et `keyboard` jouent en cliquant les VRAIS boutons du DOM / au clavier seul**,
  depuis l'accueil — aucune API de raccourci en node. Il n'existe donc pas de second
  chemin non testé, et les deux pannes d'interface les plus coûteuses de la collection
  (le focus perdu un tiers de la manche dans `ant`, une poignée de `cake` qui se grisait
  SOUS le focus) n'étaient visibles par AUCUNE assertion de modèle. Règle de comptage :
  **traverser `<body>` pendant une TABULATION est le comportement normal du navigateur**
  — seul le focus mesuré APRÈS une validation est compté.
- **`play:<jeu>:<seed>` rejoue une manche à l'identique** (le seed rend déterministe le
  `Math.random` du bot avant le chargement de la page, puisque le seed d'une manche n'est
  pas un bouton).
- Le budget de temps de `keyboard` est **par jeu** (280 s pour `beast`, 150 s pour les
  autres `pass`) : `beast` demande 138 à 183 validations contre 12 à 48 aux quatre
  autres, et un budget commun le faisait échouer sur du code parfaitement sain. **Un
  test qui échoue à moitié sur du code sain est pire qu'un test absent.**

**Bande mesurée** (conteneur, rendu logiciel, `vite preview`, 2026-09 — les taux absolus
dépendent de la machine, lire en **RELATIF**, 2 runs minimum ; les runs de relecture ont
tourné avec trois Chromium concurrents sur la même machine, ce qui divise les fps par
deux sans toucher aux compteurs déterministes) :

| scénario | assertions | échecs |
|---|---|---|
| `rules` | 1844 | 0 |
| `gen:200` | 5 agrégats sur 200 tirages | 0 |
| `contrast` | 26 | 0 |
| `physics` | 94 (90 avant les 4 assertions de frontière d'`ant`) | 0 |
| `stress` | 6 (4 avant les 2 assertions d'identité de boucle) | 0 |
| `keyboard` | 128 à 135 selon le tirage | 0 |

0 erreur console partout. `keyboard` : **focus perdu après validation 0** sur les cinq
jeux `pass`, saut sur la première cible légale **100 %** (cake 47-48 validations, tree
12-14, tiles 12-13, beast 138-183, suspects 22).

`play` : les huit jeux atteignent `result`, 0 échec — 17 assertions pour un jeu `pass`,
15 pour un `side` (pas de `#sr-board` à suivre sur un temps réel). Durées d'horloge :
les trois `side` durent la **durée réelle d'une manche** (plank 93-96 s, mirror 93-95 s,
ant **93,3 s** après le retune, 108,3 s avant) ; les cinq `pass` vont de 9 à 15 s, sauf
`beast` (12 à 38 s selon la machine et le tirage).

**PIÈGE DE LECTURE DE LA BANDE** : `play:beast` pilote **au hasard uniforme** parmi les
boutons vivants, donc la bête erre au lieu de monter et la manche explose à 164-179 s au
budget humain. Ce n'est pas l'équilibrage du jeu, c'est le bot : avec une politique
plausible (bête qui monte, chasseur qui éclaire puis valide) la médiane retombe à **67 s**
sur 8 tirages × 3 réglages ⭐, toutes ≤ 90 s. Toute relecture de la bande de `beast` doit
refaire cette distinction. Même prudence sur `stress` : la bande de référence donnait
~27 fps (menu), ~27-28 (`plank` seul) et ~22-23 (combiné), mais re-mesurée trois fois sur
machine chargée elle sort à 11-16 fps **et l'écart de ~5 fps entre les phases ne se
reproduit pas** (deltas +2, −2, 0) — la conclusion « les huit démos coûtent ~5 fps » est
dans le bruit, à ne pas reprendre telle quelle. Enfin, `gen` ne fuzze QUE les quatre
générateurs au tour par tour à contenu tiré (`tree`, `tiles`, `cake`, `suspects`),
conformément au §7 — pas les huit.

**Contrôle même machine** : hub = 6 jeux listés ; `verify-crib grip` 7/7 ;
`verify-doors rules` 0 échec ; `verify-mind contrast` 0 échec ; `npm run typecheck` et
`npm run build` verts, 0 warning nouveau (+47 modules, +2 entrées de précache par rapport
au dépôt sans Duo).

`window.__game = { session, save, game /* Shell */, flow, hud, screens, pass, palette,
mascots, models, contrastRatio, games, gameById, probe, demoBoard }` — `models` expose
les huit modèles purs pour que le bot monte ses scénarios hors partie.

### Hors périmètre (à ne pas ajouter sans re-cadrer)

Multijoueur en ligne ou par lien · plus de deux joueurs · comptes, profils persistants,
classements · succès, éclats, monnaie, déblocages, méta-progression d'aucune sorte ·
un neuvième jeu · voix, micro, caméra, vibration, accéléromètre · musique de fond ·
publicité ou lien sortant · toute IA adverse (les huit jeux se jouent à deux humains, il
n'y a aucun mode solo) · toute mécanique demandant de lire une phrase pour jouer.
Si l'une de ces choses semble nécessaire, c'est le signe qu'une contrainte du §1 a été
mal comprise, pas qu'il manque une fonctionnalité.

## Déploiement

- **Prod** : https://rendilo-reale.netlify.app — déploiement continu Netlify sur push
  `main` (repo GitHub `bfigliuzzi/rendilo-reale`, webhook + deploy key, config dans
  `netlify.toml` : `npm run build` → `dist`, Node 22).
- Admin Netlify : https://app.netlify.com/projects/rendilo-reale

## Commandes

```bash
npm run dev              # serveur de dev (-- --host pour tester sur mobile)
npm run typecheck        # tsc --noEmit
npm run build            # typecheck + vite build
node tools/verify.mjs http://localhost:5199/games/horde/ campaign 90 shot.png   # partie pilotée headless
node tools/verify-hive.mjs http://localhost:5199/games/hive/ win:2               # Essaim
node tools/verify-mind.mjs http://localhost:5199/games/mind/ contrast            # Cerveau
node tools/verify-crib.mjs http://localhost:5199/games/crib/ grip                # Berceau
node tools/verify-crib.mjs http://localhost:5199/games/crib/ win:kitchen          # Berceau, carte 2
node tools/verify-doors.mjs http://localhost:5199/games/doors/ rules            # Trois Portes
node tools/verify-doors.mjs http://localhost:5199/games/doors/ win:12345 420    # Trois Portes, run complète
node tools/verify-duo.mjs http://localhost:5199/games/duo/ rules                # Duo, les 8 modèles hors partie
node tools/verify-duo.mjs http://localhost:5199/games/duo/ play:cake            # Duo, une manche aux vrais boutons
node tools/verify-duo.mjs http://localhost:5199/games/duo/ keyboard:beast 300   # Duo, test RGAA d'un seul jeu
```

Modes du script verify : `campaign[:N]` | `endless` | `stress`, + 5e argument JSON
d'améliorations méta (ex. `'{"dps":2,"start":1}'`). `/games/horde/?stress` lance
directement le test de perf (escouade 500). Env : `CHROME_PATH` surcharge le binaire Chrome (Linux/CI :
`/opt/pw-browsers/chromium` ; `--no-sandbox` est ajouté automatiquement en root) ; en
conteneur, lancer node SANS les variables proxy (`env -u HTTP_PROXY -u HTTPS_PROXY …`),
sinon Chromium proxifie localhost.

**Référence d'équilibrage** (à re-vérifier après tout changement de balance). ATTENTION :
les taux absolus du bot dépendent de la machine (rendu logiciel ~27 fps en conteneur vs
Mac 60 fps : le bot y est plus fort sur N1 mais sature dès N4 quel que soit le tuning —
0/6 à N4 méta modeste MÊME sur l'ancien tuning jugé trop facile par un humain). Toujours
mesurer en RELATIF sur la même machine, avec un batch de contrôle sur l'ancien tuning en
cas de doute. Bandes historiques (Mac) : N1 sans méta ~1/3 ; N2 avec la méta de ~4-5
victoires (`'{"upgrades":{"dps":8,"start":3,"armor":1},"weapons":{"gatling":2},"equipped":"gatling"}'`)
~1/2 ; armes à parité à or équivalent. Mesures conteneur (2026-07) : N1 sans méta 5/6,
N3 sans méta 0/6 (identique avant/après la cassure — N1-N3 inchangés), N4 sans méta 0/6,
N5 ultra avec méta documentée 5/6.
**Cassure de difficulté à N4** (vision produit : N1-N3 fun à la skill pure, mur N4-N5,
boutique obligatoire ~tous les 2 niveaux ensuite) : `hpMul` passe à `1.5 + 0.4·(n-3)`
dès N4 (N4 1,9 · N5 2,3 · N6 2,7, adouci `4.3 + 0.2·(n-10)` après N10), masse de horde
+2/niveau dès N4, `missileIntervalMul` plancher 0,8 atteint à N4 (au lieu de saturer à
1,0 dès N3), boss ×`(1 + 0.06·(n-3))` plafonné ×1,6. N1-N3 sont STRICTEMENT inchangés.
Les paliers de boutique sont volontairement serrés (+5 % dégâts, +10 % or) avec une
courbe de coût dps adoucie (40×1,28^l) — au net l'or achète ~1,6-2× moins de puissance
qu'un tuning « généreux » ; ne pas re-buffer l'un sans retoucher l'autre.
Le N5 (niveau boss ultra) se gagne ~2 fois sur 3 avec une méta plausible pour ce stade
(`'{"upgrades":{"dps":22,"start":9,"armor":2,"rate":6,"vitality":3},"weapons":{"gatling":4},"equipped":"gatling"}'`),
défaites en plein duel — `ULTRA_HP_MUL` 4 est calibré là-dessus (à 5 le bot mourait à 1 %
des PV : pas de porte pour regonfler pendant le combat, l'usure plafonne la durée tenable) ;
re-mesuré 5/6 en conteneur après la cassure N4 et la riposte renforcée.
Le 5e argument de verify.mjs accepte un patch complet `{upgrades, weapons, equipped}` ou
des upgrades seuls. Le bot casse les caisses de loin, esquive missiles/lances/bolts et
murs de pics (il lit `spikes.list` : `cx`/`halfW`), choisit les bonnes portes — c'est le
proxy « bon joueur ».
Les niveaux de campagne sont désormais RE-SEEDÉS à chaque tentative (seed aléatoire via
`flow.startCampaign(n, seed?, replayBonus?)`) ; « Rejouer ce tirage » réutilise le seed
courant avec +25 % d'or. La bande d'équilibrage se mesure donc en cross-seed (plusieurs
runs). Pour un test reproductible : passer un seed fixe au flow. L'intensité des missiles est un paramètre de niveau
(`missileMinDist`, `missileIntervalMul`) : le N1 épargne le début de partie.

**Garanties d'équité du générateur** (à préserver) : une paire de caisses bloquante
contient toujours au moins une caisse non explosive ; pas de méga-horde dans le premier
tiers d'un niveau (cap déterministe) ; le filet continu d'ennemis (anti-temps-mort) et
les mines sont ajoutés APRÈS la boucle principale puis `events.sort()` — le spawner
exige des événements triés. Les mines ne sont ni tirables ni dans l'aim-assist :
danger de positionnement pur. Leur zone se lit au sol : corps opaque (jupe hachurée
jaune/noir), halo pointillé rotatif à `MINE_RADIUS` — le point ET la zone à éviter.
Les murs de pics (dès N2, `game/spikes.ts`) ne couvrent JAMAIS toute la voie (centre
collé à un bord, ≤ 50 % de largeur) et jamais à moins de 260 px d'une porte ou d'une
caisse — pas de pince inesquivable. Indestructibles, hors aim-assist et collisions
balles ; ils rognent les PV de tout ce qui les touche : la horde se dégrossit en les
traversant (dégâts ×hpMul du niveau, PAS ×riposte — les gonfler sous pression serait
un cadeau au joueur), l'escouade saigne en continu par le canal heavy (proportionnel
+ plancher/plafond).

**Aim-assist** : les balles ciblent la menace la plus proche du cône frontal — ennemis,
boss ET caisses (`bullets.aimVX`). Toute nouvelle entité tirable doit y être ajoutée,
sinon elle devient quasi intouchable dès qu'il y a des ennemis à l'écran.
**Dégâts de zone sur l'escouade** (missiles, explosions, lances) : toujours proportionnels
à l'effectif avec un plancher/plafond — jamais un forfait fixe, qui one-shot les petites
escouades en début de niveau.
**Pertes de soldats** : TOUTES les sources passent par `squad.loseSoldiers(n, heavy?)` —
l'Endurance (PV/soldat) absorbe pleinement le contact ordinaire mais est PLAFONNÉE à
`VITALITY_HEAVY_CAP` (1,5) contre les sources `heavy` (missiles, mines, explosions,
lances, bolts, contacts boss/caisse) : les dangers esquivables doivent rester des
menaces à tout niveau de méta. Toute nouvelle source de dégâts doit choisir son canal.
**Riposte adaptative** (anti-steamroll) : au-delà de `PRESSURE_SQUAD_REF` (130) soldats,
`world.pressure = log2(effectif/réf)` fait monter les PV ennemis/boss/caisses au spawn
(`pressureHpMul`, +60 %/doublement, plafonné ×3,2), rend les plafonds de pertes lourdes
proportionnels à la masse (`world.heavyCap`) et accélère les missiles (+75 %/doublement).
Volontairement SOUS-proportionnelle au DPS : grossir reste rentable, mais plus auto-win.
C'est le frein principal contre le « bon joueur » qui steamrolle avec une grosse escouade
(renforcée de +45 %/×2,6/+55 % après le retour « 5 niveaux sans boutique »). Rien ne change
sous la référence — la bande d'équilibrage N1/N2 n'est pas affectée. Toute nouvelle
source de PV spawnés ou de pertes plafonnées doit passer par ces deux helpers. Affichée
au HUD (`⚠️ riposte ×N`).
**GIGA HORDE** (N ≥ `GIGA_FROM_LEVEL`, campagne) : le boss final arrive escorté d'une
nuée massive — UNIQUEMENT si la riposte est active (`pressure > 0`) : c'est une réponse
à la masse critique, jamais un mur pour les petites escouades. Placée ENTRE le boss et
le joueur (elle fait écran : l'aim-assist tire au plus proche, il faut la mâcher pendant
que le boss canonne), placement déterministe (pas de `Math.random` — seule la pression,
état de jeu, module la taille), counts bornés (`GIGA_COUNT_CAP`).
**Niveaux boss** (tous les `ULTRA_EVERY` niveaux) : phase normale jusqu'au bout, puis
boss ULTRA — PV ×`ULTRA_HP_MUL`, lances ×`ULTRA_DMG_MUL` (via `world.ultraLanceMul`),
ÉPINGLÉ en haut de l'écran (`ULTRA_PIN_AHEAD`) : aucun contact possible, PAS de ligne
d'arrivée (seule sa mort libère — le scroll continue en arène). Son défi est distinct :
volée permanente à 3 (5 enragé), cadence ×`ULTRA_LANCE_RATE`, frappes de missiles
appelées sur le joueur et invocations qui détournent l'aim-assist. Marqué ☠ au menu.
**Missiles en quatre calibres** (`MISSILE_KINDS`) : jaune (large/faible), orange
(standard), rouge (chirurgical/punitif, télégraphe court), atomique (rare, RÉSERVÉ à la
riposte adaptative, zone énorme + gros dégâts compensés par un long télégraphe).
**Lisibilité des dangers (WCAG/RGAA, à préserver)** : un calibre ne se lit JAMAIS qu'à la
couleur (1.4.1, daltonisme) — quatre signaux redondants : taille de l'anneau (= rayon
réel du souffle), couleur, densité du cœur (`fillAlpha`), glyphe blanc (croix = rouge,
trèfle = atomique). Les textures de marqueur (`missileRing[kind]`, `mineHalo`, `cross`,
`trefoil`, `glow` — sources dédiées HAUTE RÉSOLUTION dans `render/textures.ts`, dessinées
à la taille d'affichage réelle ×2 via `makeRingTexture` et compagnie ; ne JAMAIS revenir
à une petite frame d'atlas étirée, c'était la cause du crénelage/flou) ont un liseré noir
INTÉGRÉ : la teinte porte sur les biomes sombres, le liseré sur les clairs — ≥ 3:1 partout
(1.4.11 ; aucune couleur plate ne passe sur les 4 biomes, vérifié au calcul). Un sprite
d'anneau s'affiche à `radius * 2 * MARKER_RING_MARGIN` pour que l'anneau tombe exactement
sur le rayon du souffle. Fin de télégraphe = strobe (`MISSILE_STROBE_TIME`) : signal de
mouvement, indépendant de la vision des couleurs. Toute nouvelle zone de danger suit ce
double codage ET expose son rayon réel (`strike.radius`, lu par le bot d'esquive).
**Cadence de tir** : base ×0,75 (`RATE_BASE`, calibrée au bot — 0,70 sortait le N1 de
la bande), remontée par l'amélioration méta `rate`
et l'arme. Le DPS reste découplé du nombre de balles — la cadence ne joue que sur la
répartition des dégâts (surplus gâché sur les petits ennemis).
**Armes à budget de puissance** (`meta/weapons.ts`) : le `dpsBonus` d'une arme est
DÉRIVÉ, jamais réglé à la main — utilité = (1 + 0,18·log2(cadence)) · (1 + 0,005·splash),
puissance cible = 1 + 0,1·log2(1 + coût/400), dpsBonus = cible/utilité ; le coût des
niveaux suit aussi la puissance cible. Une nouvelle arme ne définit QUE
cadence/splash/coût de déblocage. C'est un `dpsBonus` libre qui avait rendu la gatling
dominante (×1,15 de DPS ET ×1,7 de cadence = moins de surplus gâché, strictement
meilleure partout) — une arme rapide doit payer sa cadence en dégâts bruts.

**Sprites de personnages** : dessinés dans la bande x ≥ 256 de l'atlas, en DEUX frames
de marche par ennemi (`enemyByKind` + `enemyAlt`, membres alternés) — le cycle est un
swap d'uv dans `enemies.syncRender` (canal uv déjà dynamique, coût nul). Tout nouveau
type d'ennemi doit fournir ses deux frames et les enregistrer dans LES DEUX tableaux.
Les ennemis regardent vers le bas (vers le joueur), les soldats vers le haut. Vie des
entités : soldats = bob + roulis (`squad.renderSync`), boss = respiration/roulis
accélérés par la rage (`boss.renderSync`), caisses = pop à l'impact + pulsation des
bonus (`crate.animate`, appelé par `Crates.update(squad, dist, time, dt)`).

**Biomes & décor** (`render/decor.ts`) : `BIOME_COUNT` (6) biomes — ville, désert,
campagne, jungle, savane, sibérie — tirés au PREMIER tirage du seed de la run
(campagne et endless ; « rejouer ce tirage » = même biome). Palettes, tuiles de sol
et planche de props dans `render/textures.ts` (une seule source canvas → le décor se
batche). Le décor est 100 % NON INTERACTIF : props des bas-côtés (x < LANE_MIN_X /
> LANE_MAX_X, couche `layers.decor` sous tout le gameplay), détails de chaussée à
alpha réduit, météo par biome en espace écran (`layers.weather`). Génération seedée
par tranches (`LevelDef.decorSeed`), pool recyclé swap-remove, zéro alloc au tick ;
la végétation oscille au rendu (sway, pivot au pied), la météo est interpolée
(prev/cur). Interdit au décor : hachures jaune/noir, anneaux, glyphes blancs —
codes réservés aux dangers réels (WCAG) ; les chaussées restent des tons
moyens/sombres pour préserver la double lecture des marqueurs.

## Invariants d'architecture

- **Boucle** : simulation à pas fixe 60 Hz (`core/loop.ts`), rendu interpolé (`prevX/prevY` +
  alpha). Toute nouvelle entité mobile doit stocker sa position précédente et être interpolée.
- **Coordonnées** : monde en Y négatif vers l'avant (`worldY = -distance`). La caméra ne bouge
  pas les entités : `layers.world.y = dist + SQUAD_SCREEN_Y` au rendu (+ offset de shake).
- **Pools SoA** (`bullets.ts`, `enemies.ts`, `render/fx.ts`) : Float32Array + swap-remove,
  particules Pixi index-verrouillées, garées à (-9999,-9999) quand mortes. **Zéro allocation
  dans le tick** — pas de littéraux/closures dans les `update()`.
- **Morts d'ennemis différées** : les collisions marquent `hp <= 0`, `sweepDead()` fait le
  swap-remove après — les index de la grille spatiale restent valides toute la phase.
- **DPS découplé des balles** : dégâts/balle = DPS ÷ cadence plafonnée, par FLUX de classe
  (fusiliers/snipers/artilleurs selon `save.composition`, défs dans `SOLDIER_CLASSES`).
  Ne jamais faire scaler le nombre de balles avec l'effectif. Le splash est PAR BALLE
  (`bullets.splash[i]`), pas global.
- **Campagne infinie** : longueur cappée à 13 500, pente des PV adoucie après N10, hordes
  plafonnées (le pool sature — les PV portent l'escalade), améliorations dps/start/loot
  quasi déplafonnées (le coût exponentiel régule). Tout nouveau count de horde doit être
  borné (`Math.min`) : à N50+ les formules linéaires explosent.
- **Niveaux data-driven** : types dans `config/levels.ts`, générateurs dans
  `config/campaign.ts`. Campagne SEEDÉE par numéro de niveau (rejouable à l'identique,
  `core/rng.ts`) ; endless généré par tronçons via `LevelDef.extend`. Jamais de
  `Math.random` pour le contenu de campagne.
- **Tout le tuning** vit dans `config/balance.ts`. Ne pas hardcoder de constantes de gameplay
  ailleurs.
- **Méta** : `meta/save.ts` (schéma versionné `rendilo-reale:save:v1` — toute évolution =
  migration), `meta/upgrades.ts` + `meta/weapons.ts` + `meta/achievements.ts` (défs
  data-driven, les écrans s'en dérivent). Les stats d'une run passent par
  `computeStats(save)` → `World.loadLevel(def, stats)` (arme équipée incluse : cadence,
  DPS, splash).
- **Succès à paliers SANS FIN** (`meta/achievements.ts`) : cible du palier t =
  `base·growth^t` (growth ≥ ×1,6), récompense = `rewardBase·1,35^t` plafonnée à 400 —
  le ratio or/effort DÉCROÎT par construction : un succès reste un bonus, jamais une
  pompe à or ; ne pas ajouter de famille au reward proportionnel à la cible. Réclamation
  par famille (tous les paliers atteints d'un coup, `claimedTiers` dans le save ; l'ancien
  `claimed: string[]` est migré au chargement sans re-verser l'or). L'écran expose la
  progression en texte + `role="progressbar"`/`aria-value*` (RGAA).
- **Flow** : `game/flow.ts` est la machine à états menu → jeu → résultat et le seul endroit
  qui touche à la sauvegarde ; `World` ne connaît ni les modes ni la méta.
- **Juice** : les systèmes remontent des callbacks (`onLost`, `onBreak`, `onDeath`…), `World`
  les traduit en fx/sfx. Les sons fréquents sont throttlés dans `audio/sfx.ts`.
- Labels texte : mettre à jour `Text.text` uniquement quand la valeur affichée change.
- `window.__game` expose `{ world, flow, save, app }` pour les tests automatisés.
