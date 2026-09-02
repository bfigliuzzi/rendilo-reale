import { registerSW } from 'virtual:pwa-register';
import { startLoop } from '@shared/loop';
import { assertBalanceSane } from './config/balance';
import { GAMES, MODELS, gameById } from './config/games';
import { MASCOTS } from './config/mascots';
import { DEMO_SEEDS } from './core/demo';
import { Flow } from './core/flow';
import { Shell } from './core/shell';
import { PALETTE, contrastRatio, getAtlas } from './render/textures';

/**
 * BOOT de la collection, et rien d'autre.
 *
 * Le moteur vit dans `core/shell.ts` (Pixi, letterbox à taille logique
 * variable, boucle, pause, montage d'un micro-jeu) et la machine à états dans
 * `core/flow.ts` (accueil → menu → jeu → passage → résultat → menu).
 *
 * ÉCART ASSUMÉ À L'ARBORESCENCE DU §2.2 : la spec ne liste que `main.ts` et
 * `core/{minigame,session,demo}.ts`. Garder `Shell` dans `main.ts` aurait
 * obligé `core/flow.ts` à importer son type depuis `main.ts`, donc un cycle
 * d'imports entre le boot et l'état — exactement ce qu'on ne veut pas dans un
 * fichier qui, lui, doit rester lisible d'un coup d'œil.
 *
 * L'ORDRE de la boucle n'est pas neutre : `flow.update` AVANT `shell.update`.
 * Le compte à rebours de l'écran de résultat vit dans le flow et doit couler
 * pendant que le shell est en pause (il l'est justement à ce moment-là) ; dans
 * l'autre sens, le résultat resterait suspendu pour toujours.
 */
async function boot(): Promise<void> {
  // Garde-fou de tuning : une incohérence se lirait sinon en jeu comme « ce jeu
  // est bizarre », sans jamais dire où. Appelé INCONDITIONNELLEMENT (convention
  // de Trois Portes, et non celle de Berceau qui le réserve au DEV) : le bot de
  // vérification tourne sur `vite preview`, donc sur un build de PRODUCTION —
  // sous `import.meta.env.DEV` le garde-fou n'aurait été exercé par aucun
  // scénario, ce qui est exactement le cas où l'on croit avoir un filet.
  assertBalanceSane();

  const shell = new Shell(getAtlas());
  await shell.init();

  const flow = new Flow(shell);
  flow.start();

  (window as unknown as Record<string, unknown>).__game = {
    session: shell.session,
    save: shell.session.save,
    game: shell,
    flow,
    hud: shell.hud,
    screens: flow.screens,
    pass: flow.pass,
    palette: PALETTE,
    mascots: MASCOTS,
    models: MODELS,
    // Le bot recalcule les contrastes sur les VRAIES valeurs jouées (§7).
    contrastRatio,
    games: GAMES,
    gameById,
    // §8.8 — le bot lit l'état des huit vignettes animées : `blitLoop[i]` et
    // `blitTick[i]` disent EXACTEMENT à quel tour de boucle et à quel pas de
    // simulation correspond l'image actuellement affichée dans le `<canvas>`
    // de la vignette i. C'est ce qui lui permet de prouver que deux boucles
    // consécutives sont identiques : même tick ⇒ mêmes pixels.
    demoBoard: shell.menuBoard,
    demoSeeds: DEMO_SEEDS,
  };

  startLoop(
    (dt) => {
      flow.update(dt);
      shell.update(dt);
    },
    (alpha) => shell.render(alpha),
  );
}

registerSW({ immediate: true }); // MÊME service worker que le hub, idempotent
void boot();
