import { Application } from 'pixi.js';
import { registerSW } from 'virtual:pwa-register';
import { startLoop } from '@shared/loop';
import { DESIGN_H, DESIGN_W } from './config/balance';
import { Flow } from './game/flow';
import { World } from './game/world';
import { Gestures } from './input/gestures';
import { Fx } from './render/fx';
import { Layers } from './render/layers';
import { buildAtlas, PALETTE } from './render/textures';
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
    antialias: false,
  });
  app.ticker.stop(); // on rend nous-mêmes depuis la boucle à pas fixe

  const stage = document.getElementById('stage')!;
  stage.appendChild(app.canvas);

  // letterbox : canvas en résolution logique fixe, mis à l'échelle en CSS
  const resize = (): void => {
    const scale = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  stage.style.width = `${DESIGN_W}px`;
  stage.style.height = `${DESIGN_H}px`;
  resize();
  window.addEventListener('resize', resize);

  const atlas = buildAtlas();
  const layers = new Layers(app.stage, atlas);
  const fx = new Fx(layers.fx, atlas.spark);
  const world = new World(layers, atlas, fx);
  const gestures = new Gestures(app.canvas, world);
  const hud = new Hud();
  const screens = new Screens(document.getElementById('ui')!);
  const flow = new Flow(world, screens, gestures, hud);

  if (new URLSearchParams(location.search).has('stress')) flow.startStress();
  else flow.showMenu();

  // hook de debug pour les tests automatisés et la console
  (window as unknown as Record<string, unknown>).__game = { world, flow, app };

  startLoop(
    (dt) => world.update(dt),
    (alpha, frameMs) => {
      world.render(alpha);
      app.renderer.render(app.stage);
      hud.onFrame(frameMs, world);
    },
  );
}

registerSW({ immediate: true }); // PWA : même SW racine que le hub, idempotent
void boot();
