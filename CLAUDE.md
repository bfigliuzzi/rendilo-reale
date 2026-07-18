# Rendilo Reale — hub de jeux web

Hub multi-jeux (Vite multi-page) : la racine `/` est un menu de sélection, chaque jeu vit
dans `games/<id>/` avec son propre `index.html` + `src/`. Deux jeux : **Horde**
(`/games/horde/`), horde-shooter vertical style Last War — escouade auto-tir en bas,
hordes qui descendent, portes x2/+N, caisses HP, boss. Campagne + endless +
métaprogression (or, boutique, localStorage). Et **Essaim** (`/games/hive/`), conquête
de nœuds façon Auralux (voir section dédiée). PixiJS v8 + TypeScript strict + Vite.
Aucune autre dépendance runtime.

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
