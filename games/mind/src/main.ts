import { Application } from 'pixi.js';
import { registerSW } from 'virtual:pwa-register';
import { startLoop } from '@shared/loop';
import { Sfx } from './audio/sfx';
import { DESIGN_H, DESIGN_W } from './config/balance';
import { Board, computeFeedback } from './game/board';
import { Flow } from './game/flow';
import { World } from './game/world';
import { Controls } from './input/controls';
import { loadSave } from './meta/save';
import { Ambience } from './render/ambience';
import { Fx } from './render/fx';
import { Layers } from './render/layers';
import { PALETTE, buildAtlas } from './render/textures';
import { EMPTY_PEG_DEF, PEGS } from './config/pegs';
import { Hud } from './ui/hud';
import { Screens } from './ui/screens';

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    width: DESIGN_W,
    height: DESIGN_H,
    backgroundColor: PALETTE.bg,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    antialias: false, // rendu pixel art : pas de lissage des arêtes
  });
  app.ticker.stop(); // on rend nous-mêmes depuis la boucle à pas fixe

  const stage = document.getElementById('stage')!;
  stage.appendChild(app.canvas);
  const overlay = document.getElementById('overlay')!;

  const atlas = buildAtlas();
  const layers = new Layers(app.stage, atlas);
  const fx = new Fx(layers.fx, atlas.spark, atlas.confetti);
  const ambience = new Ambience(layers.glow, layers.ambient, atlas.spark);
  const save = loadSave();
  const sfx = new Sfx(save.muted);
  const world = new World(layers, atlas, fx, ambience, sfx);
  const hud = new Hud(
    overlay,
    document.getElementById('hud-cat')!,
    document.getElementById('sr-status')!,
    document.getElementById('sr-history')!,
  );
  const screens = new Screens(document.getElementById('ui')!);
  // prefers-reduced-motion est lu UNE fois : l'option du joueur s'y ajoute en OU,
  // elle ne peut pas contredire une préférence système (cf. Flow).
  const systemReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flow = new Flow(world, screens, hud, fx, ambience, save, sfx, systemReducedMotion);
  new Controls(overlay, world);

  // letterbox : canvas en résolution logique fixe, mis à l'échelle en CSS.
  // L'overlay de boutons subit EXACTEMENT la même transformation — c'est ce qui
  // fait tomber chaque bouton transparent sur son pion dessiné.
  const resize = (): void => {
    const scale = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    hud.layout(scale);
  };
  stage.style.width = `${DESIGN_W}px`;
  stage.style.height = `${DESIGN_H}px`;
  resize();
  window.addEventListener('resize', resize);
  // le clavier virtuel et la rotation ne déclenchent pas toujours « resize »
  window.addEventListener('orientationchange', resize);

  flow.showMenu();

  // Hook de debug pour tools/verify-mind.mjs et la console. `computeFeedback` est
  // exposée pour que le bot la fuzze contre sa propre implémentation, et la charte
  // pour qu'il recalcule les contrastes RGAA sur les VRAIES valeurs plutôt que sur
  // une copie qui dériverait.
  (window as unknown as Record<string, unknown>).__game = {
    world,
    flow,
    app,
    save,
    hud,
    Board,
    computeFeedback,
    palette: { ...PALETTE },
    pegs: [...PEGS, EMPTY_PEG_DEF].map((d) => ({ name: d.name, color: d.color, shape: d.shape, glyph: d.glyph })),
  };

  startLoop(
    (dt) => world.update(dt),
    (alpha, frameMs) => {
      world.render(alpha);
      app.renderer.render(app.stage);
      flow.onFrame(frameMs);
    },
  );
}

registerSW({ immediate: true }); // PWA : même SW racine que le hub, idempotent
void boot();
