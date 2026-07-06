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
~480 m) ; N2 se gagne avec la méta de ~4-5 victoires
(`'{"upgrades":{"dps":8,"start":3,"armor":1},"weapons":{"gatling":2},"equipped":"gatling"}'`).
Les paliers de boutique sont volontairement serrés (+5 % dégâts, +10 % or) avec une
courbe de coût dps adoucie (40×1,28^l) — au net l'or achète ~1,6-2× moins de puissance
qu'un tuning « généreux » ; ne pas re-buffer l'un sans retoucher l'autre.
Le 5e argument de verify.mjs accepte un patch complet `{upgrades, weapons, equipped}` ou
des upgrades seuls. Le bot casse les caisses de loin, esquive missiles/lances/bolts,
choisit les bonnes portes — c'est le proxy « bon joueur ».
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
danger de positionnement pur.

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
**Missiles en quatre calibres** (`MISSILE_KINDS`) : jaune (large/faible), orange
(standard), rouge (chirurgical/punitif, télégraphe court), atomique (rare, RÉSERVÉ à la
riposte adaptative, zone énorme + gros dégâts compensés par un long télégraphe). Le
danger d'un calibre se lit à la couleur/taille du marqueur — préserver cette lisibilité.
Le bot d'esquive lit `strike.radius` : toute nouvelle zone de danger doit exposer son
rayon réel.
**Cadence de tir** : base ×0,75 (`RATE_BASE`, calibrée au bot — 0,70 sortait le N1 de
la bande), remontée par l'amélioration méta `rate`
et l'arme. Le DPS reste découplé du nombre de balles — la cadence ne joue que sur la
répartition des dégâts (surplus gâché sur les petits ennemis).

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
