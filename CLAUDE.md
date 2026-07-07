# Rendilo Reale — horde-shooter (style Last War)

Jeu web vertical : escouade auto-tir en bas, hordes qui descendent, portes x2/+N, caisses HP,
boss. Campagne + endless + métaprogression (or, boutique, localStorage).
PixiJS v8 + TypeScript strict + Vite. Aucune autre dépendance runtime.

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
node tools/verify.mjs http://localhost:5199/ campaign 90 shot.png   # partie pilotée headless
```

Modes du script verify : `campaign[:N]` | `endless` | `stress`, + 5e argument JSON
d'améliorations méta (ex. `'{"dps":2,"start":1}'`). `?stress` dans l'URL lance directement
le test de perf (escouade 500).

**Référence d'équilibrage** (à re-vérifier après tout changement de balance) : le bot gagne
le N1 sans méta ~1 fois sur 3 (défaites tardives : déluge final ou boss, jamais avant
~480 m) ; N2 avec la méta de ~4-5 victoires
(`'{"upgrades":{"dps":8,"start":3,"armor":1},"weapons":{"gatling":2},"equipped":"gatling"}'`)
se gagne ~1 fois sur 2 en cross-seed, et les trois armes sont à parité à or équivalent
(mesuré : gatling 2/6, fusil 4/6, canon 1/3 — différences dans le bruit statistique).
Les paliers de boutique sont volontairement serrés (+5 % dégâts, +10 % or) avec une
courbe de coût dps adoucie (40×1,28^l) — au net l'or achète ~1,6-2× moins de puissance
qu'un tuning « généreux » ; ne pas re-buffer l'un sans retoucher l'autre.
Le N5 (niveau boss ultra) se gagne ~2 fois sur 3 avec une méta plausible pour ce stade
(`'{"upgrades":{"dps":22,"start":9,"armor":2,"rate":6,"vitality":3},"weapons":{"gatling":4},"equipped":"gatling"}'`),
défaites en plein duel — `ULTRA_HP_MUL` 4 est calibré là-dessus (à 5 le bot mourait à 1 %
des PV : pas de porte pour regonfler pendant le combat, l'usure plafonne la durée tenable).
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
(`pressureHpMul`, +45 %/doublement, plafonné ×2,6), rend les plafonds de pertes lourdes
proportionnels à la masse (`world.heavyCap`) et accélère les missiles. Volontairement
SOUS-proportionnelle au DPS : grossir reste rentable, mais plus auto-win. Rien ne change
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
**Lisibilité des dangers (WCAG, à préserver)** : un calibre ne se lit JAMAIS qu'à la
couleur (1.4.1, daltonisme) — quatre signaux redondants : taille de l'anneau (= rayon
réel du souffle), couleur, densité du cœur (`fillAlpha`), glyphe blanc (croix = rouge,
trèfle = atomique). Les textures de marqueur (`ring`, `ringDashed`, `cross`, `trefoil`)
ont un liseré noir INTÉGRÉ : la teinte porte sur les biomes sombres, le liseré sur les
clairs — ≥ 3:1 partout (1.4.11 ; aucune couleur plate ne passe sur les 4 biomes, vérifié
au calcul). Fin de télégraphe = strobe (`MISSILE_STROBE_TIME`) : signal de mouvement,
indépendant de la vision des couleurs. Toute nouvelle zone de danger suit ce double
codage ET expose son rayon réel (`strike.radius`, lu par le bot d'esquive).
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
- **Flow** : `game/flow.ts` est la machine à états menu → jeu → résultat et le seul endroit
  qui touche à la sauvegarde ; `World` ne connaît ni les modes ni la méta.
- **Juice** : les systèmes remontent des callbacks (`onLost`, `onBreak`, `onDeath`…), `World`
  les traduit en fx/sfx. Les sons fréquents sont throttlés dans `audio/sfx.ts`.
- Labels texte : mettre à jour `Text.text` uniquement quand la valeur affichée change.
- `window.__game` expose `{ world, flow, save, app }` pour les tests automatisés.
