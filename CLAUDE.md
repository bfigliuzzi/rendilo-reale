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

POC jouable : 1 carte skirmish (`config/maps.ts`, données `LevelDef` dans
`config/levels.ts`) — abeilles (joueur, faction 1) vs cafards (IA, faction 2) +
neutres. Les nœuds produisent en continu (table `NODE_LEVELS` : prod/cap/rayon par
niveau d'upgrade — l'upgrade est câblé dans la donnée mais pas exposé) ; le stock est
visualisé en nuée orbitale (`orbitView`, purement rendu, plafond 60 points) + compteur.
Contrôles : tap ruche = sélection/cumul, tap cible = envoi depuis toute la sélection,
tap vide = désélection, drag = envoi direct (aussi LE geste de renfort allié).

- **Un envoi = `SEND_FRAC` (50 %) du stock, jamais 100 %** : le stock EST la défense
  (capture dès que < 0) — le 100 % rendait chaque envoi suicidaire (un éclaireur
  retournait le nœud vidé). Re-taper envoie la moitié suivante. Mesuré au bot.
- Un envoi = rafale étalée (`EMIT_INTERVAL`), `remaining` figé à l'ordre ; flux annulé
  si la source tombe ou se vide. Arrivée résolue contre la faction COURANTE du nœud.
- Combat = annihilation 1:1 en vol via `@shared/spatialGrid` (cafards insérés, abeilles
  interrogent 3×3) ; morts marquées `dead=1`, `sweepDead()` APRÈS la phase grille.
- Fin de partie : une faction est éliminée quand nœuds == 0 ET unités en vol == 0 ET
  flux == 0 (une nuée en vol peut encore reprendre un nœud).
- **IA** (`game/ai.ts`) : décision toutes `decisionInterval` s — défense, sinon vague
  groupée des `waveNodes` nids les PLUS PROCHES de la cible (les borner est vital :
  mobiliser toute l'économie écrasait le joueur), sinon accumulation. Paramètres par
  carte dans `LevelDef.ai` ; passe par la même API `emitter.send` que le joueur.
- **Équilibrage mesuré au bot** (même méthode que horde, scripts éphémères pilotant
  `window.__game` — `{world, flow, app}`, `world.postSend/sendOrder` scriptables) :
  bot passif ou dispersé = défaite en 45-85 s ; bot all-in persistant (marteler LE nid
  le plus faible) = victoire 3/3 en 44-74 s ; IA miroir contre elle-même = impasse
  (timeout) — l'équilibre de tortue est un connu du genre, c'est l'action qui paie.
- Accessibilité : faction = FORME (hexagone/goutte/cercle) + glyphe + silhouette
  d'unité distincte, jamais la couleur seule. `?stress` = les deux camps canonnent
  (~600 unités, mesuré 120 fps desktop). Pas de save (clé réservée
  `rendilo-reale:hive:save:v1`, à ne créer que via `game/flow.ts`).

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
