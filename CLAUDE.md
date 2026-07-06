# Rendilo Reale — horde-shooter (style Last War)

Jeu web vertical : escouade auto-tir en bas, hordes qui descendent, portes x2/+N, caisses HP,
boss. Campagne + endless + métaprogression (or, boutique, localStorage).
PixiJS v8 + TypeScript strict + Vite. Aucune autre dépendance runtime.

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
le N1 sans méta *de justesse* (~20 survivants) ; N2 sans méta = défaite rapide ; N2 avec
l'or d'une victoire (`{"dps":1,"start":1}`) = meurt au boss ; N2 avec 2-3 victoires
(`{"dps":3,"start":2}`) = victoire.

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
- **DPS découplé des balles** : dégâts/balle = DPS escouade ÷ cadence plafonnée. Ne jamais
  faire scaler le nombre de balles avec l'effectif.
- **Niveaux data-driven** : types dans `config/levels.ts`, générateurs dans
  `config/campaign.ts`. Campagne SEEDÉE par numéro de niveau (rejouable à l'identique,
  `core/rng.ts`) ; endless généré par tronçons via `LevelDef.extend`. Jamais de
  `Math.random` pour le contenu de campagne.
- **Tout le tuning** vit dans `config/balance.ts`. Ne pas hardcoder de constantes de gameplay
  ailleurs.
- **Méta** : `meta/save.ts` (schéma versionné `rendilo-reale:save:v1` — toute évolution =
  migration), `meta/upgrades.ts` (défs data-driven, la boutique s'en dérive). Les stats d'une
  run passent par `computeStats()` → `World.loadLevel(def, stats)`.
- **Flow** : `game/flow.ts` est la machine à états menu → jeu → résultat et le seul endroit
  qui touche à la sauvegarde ; `World` ne connaît ni les modes ni la méta.
- **Juice** : les systèmes remontent des callbacks (`onLost`, `onBreak`, `onDeath`…), `World`
  les traduit en fx/sfx. Les sons fréquents sont throttlés dans `audio/sfx.ts`.
- Labels texte : mettre à jour `Text.text` uniquement quand la valeur affichée change.
- `window.__game` expose `{ world, flow, save, app }` pour les tests automatisés.
