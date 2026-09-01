import { registerSW } from 'virtual:pwa-register';
import { startLoop } from '@shared/loop';
import { assertBalanceSane } from './config/balance';
import { GAMES, MODELS, gameById } from './config/games';
import { MASCOTS } from './config/mascots';
import { Flow } from './core/flow';
import { PROBE_DEF } from './core/probe';
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
  // Garde-fou DEV : une incohérence de tuning se lirait sinon en jeu comme
  // « ce jeu est bizarre », sans jamais dire où.
  if (import.meta.env.DEV) assertBalanceSane();

  const shell = new Shell(getAtlas());
  await shell.init();

  const flow = new Flow(shell);
  flow.start();

  // `#probe` — le micro-jeu bidon du §8.2, hors grille : il exerce d'un bout à
  // l'autre `onTurn` (écran de passage), `onAnnounce`, `onOver` (écran de
  // résultat + « le perdant choisit »), `setPaused` (accumulateur figé) et
  // `destroy`. C'est le test de bout en bout du shell tant que les huit vrais
  // jeux sont des placeholders.
  //
  // UN HASH, PAS UNE QUERY, et c'est un piège mesuré : le service worker du hub
  // est configuré avec `navigateFallback: '/index.html'`, donc une navigation
  // vers `/games/duo/?probe` — URL absente du précache à cause de la query —
  // retombe sur la PAGE DU HUB dès que le SW est installé. Le hash, lui, ne
  // part jamais dans la requête réseau. (Le `?probe` reste accepté : il marche
  // au premier chargement, avant l'installation du SW.)
  const wanted = window.location.hash === '#probe' || new URLSearchParams(window.location.search).has('probe');
  if (wanted) flow.startRound(PROBE_DEF);

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
    probe: PROBE_DEF,
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
