import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] ?? 'http://localhost:5199/';
const SECONDS = Number(process.argv[3] ?? 20);
const SHOT = process.argv[4] ?? 'verify.png';

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

// petit drag gauche-droite pendant la partie pour exercer l'input
const drag = async (fromX, toX) => {
  await page.mouse.move(fromX, 800);
  await page.mouse.down();
  for (let i = 0; i <= 10; i++) {
    await page.mouse.move(fromX + ((toX - fromX) * i) / 10, 800);
    await new Promise((r) => setTimeout(r, 25));
  }
  await page.mouse.up();
};

const samples = [];
const start = Date.now();
let dragFlip = false;
while (Date.now() - start < SECONDS * 1000) {
  await drag(dragFlip ? 400 : 140, dragFlip ? 140 : 400);
  dragFlip = !dragFlip;
  const s = await page.evaluate(() => {
    const w = window.__game.world;
    return {
      state: w.state,
      squad: w.squad.logical,
      kills: w.kills,
      dist: Math.round(w.dist),
      bullets: w.bullets.count,
      enemies: w.enemies.count,
    };
  });
  samples.push(s);
  if (s.state !== 'playing') break;
}

// FPS réel mesuré dans la page sur 2 s
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
console.log(JSON.stringify({ fps, errors: errors.slice(0, 5), last: samples.at(-1), samples: samples.filter((_, i) => i % 4 === 0) }, null, 1));
await browser.close();
