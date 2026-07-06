# Rendilo Reale — POC horde-shooter (style Last War)

Jeu web vertical : escouade auto-tir en bas, hordes qui descendent, portes x2/+N, caisses HP.
PixiJS v8 + TypeScript strict + Vite. Aucune autre dépendance runtime.

## Commandes

```bash
npm run dev              # serveur de dev (-- --host pour tester sur mobile)
npm run typecheck        # tsc --noEmit
npm run build            # typecheck + vite build
node tools/verify.mjs http://localhost:5199/ 30 shot.png   # partie pilotée headless (FPS, erreurs, stats, capture)
```

Mode stress : `?stress` dans l'URL (escouade 500, hordes massives — scénario du test de perf).

## Invariants d'architecture

- **Boucle** : simulation à pas fixe 60 Hz (`core/loop.ts`), rendu interpolé (`prevX/prevY` + alpha).
  Toute nouvelle entité mobile doit stocker sa position précédente et être interpolée au rendu.
- **Coordonnées** : monde en Y négatif vers l'avant (`worldY = -distance`). La caméra ne bouge pas
  les entités : `layers.world.y = dist + SQUAD_SCREEN_Y` au rendu.
- **Pools SoA** (`bullets.ts`, `enemies.ts`) : Float32Array + swap-remove, particules Pixi
  index-verrouillées, garées à (-9999,-9999) quand mortes. **Zéro allocation dans le tick** —
  pas de littéraux/closures dans les `update()`.
- **Morts d'ennemis différées** : les collisions marquent `hp <= 0`, `sweepDead()` fait le
  swap-remove après — les index de la grille spatiale restent valides toute la phase.
- **DPS découplé des balles** : dégâts/balle = DPS escouade ÷ cadence plafonnée. Ne jamais
  faire scaler le nombre de balles avec l'effectif.
- **Tout le tuning** vit dans `config/balance.ts`, les niveaux dans `config/levels.ts`
  (événements triés par distance `at`). Ne pas hardcoder de constantes de gameplay ailleurs.
- Labels texte : mettre à jour `Text.text` uniquement quand la valeur affichée change.
- `window.__game` expose `{ world, app }` pour les tests automatisés.
