// Partie pilotée en Chrome headless : démarre un mode via window.__game.flow,
// joue avec un bot simple (tient le centre, choisit la meilleure porte),
// remonte FPS réel, erreurs console, stats de jeu et une capture d'écran.
//
// Usage : node tools/verify.mjs [url] [mode] [secondes] [capture.png] [upgradesJSON]
//   mode : campaign | campaign:N | endless | stress
//   upgradesJSON : ex. '{"dps":2,"start":1}' — améliorations méta injectées avant la run
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] ?? 'http://localhost:5173/';
const MODE = process.argv[3] ?? 'campaign';
const SECONDS = Number(process.argv[4] ?? 60);
const SHOT = process.argv[5] ?? 'verify.png';
const UPGRADES = process.argv[6] ? JSON.parse(process.argv[6]) : {};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-size=560,1000', '--force-device-scale-factor=1'],
});
const page = await browser.newPage();
await page.setViewport({ width: 540, height: 960 });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game !== undefined', { timeout: 5000 });

await page.evaluate(
  (mode, upgrades) => {
    const g = window.__game;
    Object.assign(g.save.upgrades, upgrades);
    if (mode === 'stress') g.flow.startStress();
    else if (mode === 'endless') g.flow.startEndless();
    else {
      const n = Number(mode.split(':')[1] ?? 1);
      g.save.campaignLevel = Math.max(g.save.campaignLevel, n);
      g.flow.startCampaign(n);
    }
  },
  MODE,
  UPGRADES,
);

const samples = [];
const start = Date.now();
let last = null;
while (Date.now() - start < SECONDS * 1000) {
  last = await page.evaluate(() => {
    const w = window.__game.world;
    if (w.state === 'playing') {
      // bot : viser la meilleure porte à venir, sinon tenir le centre
      let targetX = 270;
      const pairs = w.gates?.pairs ?? [];
      for (const p of pairs) {
        if (p.consumed || p.y > -w.dist) continue;
        if (p.y < -w.dist - 700) continue;
        const score = (m) => (m.op === 'mul' ? w.squad.logical * (m.value - 1) : m.value);
        targetX = score(p.left) >= score(p.right) ? 165 : 375;
        break;
      }
      const dx = targetX - w.squad.x;
      w.squad.x += Math.max(-45, Math.min(45, dx));
    }
    return {
      state: w.state,
      squad: w.squad.logical,
      kills: w.kills,
      gold: w.gold,
      dist: Math.round(w.dist / 10),
      bullets: w.bullets.count,
      enemies: w.enemies.count,
      bosses: w.bosses.list.length,
    };
  });
  samples.push(last);
  if (last.state !== 'playing') break;
  await new Promise((r) => setTimeout(r, 150));
}

const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else resolve(Math.round((frames * 1000) / (performance.now() - t0)));
      };
      requestAnimationFrame(tick);
    }),
);

await page.screenshot({ path: SHOT });
console.log(
  JSON.stringify(
    {
      fps,
      errors: errors.slice(0, 5),
      last,
      samples: samples.filter((_, i) => i % 20 === 0),
    },
    null,
    1,
  ),
);
await browser.close();
