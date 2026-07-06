# Rendilo Reale — POC horde-shooter vertical

POC web du gameplay « phase de tir » de *Last War: Survival* : une escouade en bas d'écran
auto-tire vers le haut pendant que la voie défile ; hordes d'ennemis, portes bonus/malus
(« x2 », « +10 », « -5 ») qui font grossir l'escouade, caisses à points de vie.

**Objectif** : valider la fluidité (centaines d'entités + projectiles) et le fun du concept.

## Lancer

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev -- --host   # + accès depuis un téléphone sur le même réseau
```

- **Contrôles** : glisser (doigt ou souris) pour déplacer l'escouade latéralement.
- **Mode stress** : ajouter `?stress` à l'URL — escouade de 500 au départ, hordes massives
  en continu, cadence de tir au plafond. C'est le scénario du test de fluidité.
- Le HUD affiche FPS, frame-time p95 et compteurs d'entités en haut à gauche.

## Stack

PixiJS v8 (WebGL/WebGPU, `ParticleContainer` pour balles et ennemis) + TypeScript + Vite.
Aucune autre dépendance runtime. Visuels placeholder générés en code.

## Architecture (résumé)

- `src/core/` — moteur générique : boucle à pas fixe 60 Hz + interpolation, grille spatiale.
- `src/game/` — systèmes : pools struct-of-arrays (balles/ennemis, zéro allocation au tick),
  escouade/formation, portes, caisses, spawner, collisions.
- `src/config/` — **tout le tuning** (`balance.ts`) et les niveaux data-driven (`levels.ts`).
- `src/render/` — atlas de textures généré + hiérarchie de layers.
- Les évolutions (armes, boss, vagues…) se branchent dans `config/` + nouveaux systèmes `game/`.

## Vérification automatisée

```bash
npm run dev -- --port 5199 &
node tools/verify.mjs http://localhost:5199/ 30 shot.png          # partie pilotée 30 s
node tools/verify.mjs "http://localhost:5199/?stress" 40 s.png    # stress
```

Le script pilote une partie en Chrome headless (drag automatique), remonte FPS réel,
erreurs console, stats de jeu (`window.__game`) et une capture d'écran.
