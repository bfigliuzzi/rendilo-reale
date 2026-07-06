import { Application } from 'pixi.js';
import { DESIGN_H, DESIGN_W } from './config/balance';
import { MAIN_LEVEL, makeStressLevel } from './config/levels';
import { startLoop } from './core/loop';
import { World } from './game/world';
import { PointerInput } from './input/pointer';
import { Layers } from './render/layers';
import { buildAtlas } from './render/textures';
import { Hud } from './ui/hud';

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

  const stress = new URLSearchParams(location.search).has('stress');
  const level = stress ? makeStressLevel() : MAIN_LEVEL;
  const world = new World(layers, atlas, level, input);

  world.onGameOver = (state, stats) => {
    if (state === 'victory') {
      hud.showOverlay('VICTOIRE', `${stats.kills} ennemis abattus\nEscouade finale : ${stats.squad}`, '#4ade80');
    } else {
      hud.showOverlay('DÉFAITE', `${stats.dist} m parcourus · ${stats.kills} ennemis abattus`, '#f87171');
    }
  };
  hud.onRestart(() => world.reset());

  // hook de debug pour les tests automatisés et la console
  (window as unknown as Record<string, unknown>).__game = { world, app };

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

void boot();
