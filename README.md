# Rendilo Reale — horde-shooter vertical

Jeu web du gameplay « phase de tir » de *Last War: Survival* : une escouade en bas d'écran
auto-tire vers le haut pendant que la voie défile ; hordes d'ennemis, portes bonus/malus
(« x2 », « +10 », « -5 ») qui font grossir l'escouade, caisses à points de vie, boss de
fin de niveau.

## Lancer

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev -- --host   # + accès depuis un téléphone sur le même réseau
```

- **Contrôles** : glisser (doigt ou souris) pour déplacer l'escouade latéralement.
- **Modes** : Campagne (niveaux seedés à difficulté croissante, boss final), Sans fin
  (record de distance, mini-boss récurrents), et `?stress` dans l'URL pour le test de
  fluidité (escouade 500, hordes massives).
- **Métaprogression** : l'or gagné (kills, caisses, boss, bonus de fin) s'investit dans
  la boutique — effectif de départ, puissance de feu, butin, blindage. Sauvegarde en
  localStorage.
- Le HUD affiche FPS, frame-time p95 et compteurs d'entités en haut à gauche.

## Stack

PixiJS v8 (WebGL/WebGPU, `ParticleContainer` pour balles/ennemis/particules) + TypeScript
+ Vite. Audio 100 % synthétisé en WebAudio. Aucune autre dépendance runtime. Visuels
placeholder générés en code.

## Architecture (résumé)

- `src/core/` — moteur générique : boucle à pas fixe 60 Hz + interpolation, grille
  spatiale, PRNG seedé.
- `src/game/` — systèmes : pools struct-of-arrays (balles/ennemis, zéro allocation au
  tick), escouade/formation, portes, caisses, boss, spawner, collisions, `flow.ts`
  (machine à états menu → jeu → résultat).
- `src/config/` — **tout le tuning** (`balance.ts`), les types de niveaux (`levels.ts`)
  et les générateurs campagne/endless (`campaign.ts`).
- `src/meta/` — sauvegarde versionnée + améliorations data-driven.
- `src/render/` — atlas généré, layers, particules d'effets + screen shake.
- `src/audio/` — effets synthétisés WebAudio (mute persisté).
- `src/ui/` — HUD (DOM, 4 Hz) et écrans menu/boutique/résultat (DOM).

## Vérification automatisée

```bash
npm run dev -- --port 5199 &
node tools/verify.mjs http://localhost:5199/ campaign 90 shot.png
node tools/verify.mjs http://localhost:5199/ endless 120 shot2.png
node tools/verify.mjs http://localhost:5199/ stress 30 shot3.png
```

Le script pilote une partie en Chrome headless (un bot tient le centre et choisit les
bonnes portes), remonte FPS réel, erreurs console, stats (`window.__game`) et une capture.
Référence : le bot gagne le niveau 1 de campagne sans aucune amélioration.
