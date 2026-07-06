import { Application } from 'pixi.js';
import { registerSW } from 'virtual:pwa-register';
import { Sfx } from './audio/sfx';
import { DESIGN_H, DESIGN_W } from './config/balance';
import { startLoop } from './core/loop';
import { Flow } from './game/flow';
import { World } from './game/world';
import { PointerInput } from './input/pointer';
import { loadSave } from './meta/save';
import { Fx } from './render/fx';
import { Layers } from './render/layers';
import { buildAtlas } from './render/textures';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    width: DESIGN_W,
    height: DESIGN_H,
    backgroundColor: 0x0b1016,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    antialias: false,
  });
  app.ticker.stop(); // on rend nous-mêmes depuis la boucle à pas fixe

  const stage = document.getElementById('stage')!;
  stage.appendChild(app.canvas);

  // letterbox : canvas en résolution logique fixe, mis à l'échelle en CSS
  let scale = 1;
  const resize = (): void => {
    scale = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  stage.style.width = `${DESIGN_W}px`;
  stage.style.height = `${DESIGN_H}px`;
  resize();
  window.addEventListener('resize', resize);

  const atlas = buildAtlas();
  const layers = new Layers(app.stage, atlas);
  const input = new PointerInput(() => scale);
  const hud = new Hud();
  const save = loadSave();
  const sfx = new Sfx(save.muted);
  const fx = new Fx(layers.fx, atlas.spark);
  const world = new World(layers, atlas, input, fx, sfx);
  const menu = new Menu(document.getElementById('ui')!, save);
  const flow = new Flow(world, menu, sfx, hud, save);

  if (new URLSearchParams(location.search).has('stress')) flow.startStress();
  else flow.showMenu();

  // hook de debug pour les tests automatisés et la console
  (window as unknown as Record<string, unknown>).__game = { world, flow, save, app };

  startLoop(
    (dt) => world.update(dt),
    (alpha, frameMs) => {
      world.render(alpha);
      app.renderer.render(app.stage);
      hud.onFrame(frameMs);
      hud.maybeUpdate(frameMs, world.stats());
    },
  );
}

registerSW({ immediate: true }); // PWA : installable, jouable hors ligne, mise à jour auto
void boot();
