import { Application } from 'pixi.js';
import { registerSW } from 'virtual:pwa-register';
import { startLoop } from '@shared/loop';
import { Sfx } from './audio/sfx';
import { DESIGN_H, DESIGN_W } from './config/balance';
import { Flow } from './game/flow';
import { World } from './game/world';
import { Steer } from './input/steer';
import { loadSave } from './meta/save';
import { Decor } from './render/decor';
import { Fx } from './render/fx';
import { DebugView } from './render/debugView';
import { Layers } from './render/layers';
import { OverlayView } from './render/overlayView';
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
    // pixel art : le lissage transformerait chaque liseré de 1 px en bouillie
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
  window.addEventListener('orientationchange', resize);

  const atlas = buildAtlas();
  const layers = new Layers(app.stage);
  // `scale` est lu en getter paresseux : le joystick doit diviser ses deltas par
  // l'échelle COURANTE, et elle change à chaque rotation de l'écran
  const steer = new Steer(() => scale);
  const fx = new Fx(layers.fx, atlas.spark);
  const save = loadSave();
  const sfx = new Sfx(save.muted);
  const world = new World(layers, atlas, steer, fx, sfx);
  const decor = new Decor(layers.decor, layers.weather, atlas);
  const hud = new Hud();
  const screens = new Screens(document.getElementById('ui')!, save);
  const overlay = new OverlayView(layers.overlay, atlas);
  const flow = new Flow(world, screens, hud, decor, steer, save, sfx);

  const params = new URLSearchParams(location.search);
  // `?debug` : le masque de terrain tel que la simulation le voit. Voir DebugView.
  if (params.has('debug')) {
    const dbg = new DebugView(layers.marks);
    flow.onLevelLoaded = (level) => dbg.setup(level);
  }

  if (params.has('stress')) flow.startStress();
  else flow.showMenu();

  // hook de debug pour `tools/verify-crib.mjs` et la console
  (window as unknown as Record<string, unknown>).__game = {
    world,
    flow,
    app,
    layers,
    save,
    steer,
    hero: world.hero,
    crib: world.crib,
    boss: world.boss,
    // exposé pour le bot : sans lui, sa règle anti-blocage ne peut pas être écrite
    get level() {
      return world.level;
    },
    get terrain() {
      return world.level?.terrain ?? null;
    },
  };

  startLoop(
    (dt) => {
      world.update(dt);
      decor.update(dt);
    },
    (alpha, frameMs) => {
      world.render(alpha);
      decor.render();
      overlay.render(world, steer, frameMs / 1000);
      app.renderer.render(app.stage);
      hud.onFrame(frameMs);
      if (world.playing) hud.maybeUpdate(frameMs, world.stats());
    },
  );
}

registerSW({ immediate: true }); // PWA : installable, jouable hors ligne, mise à jour auto
void boot();
