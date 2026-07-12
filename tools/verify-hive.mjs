// Vérification headless du jeu Essaim via window.__game (pendant de verify.mjs
// pour horde). Remonte FPS réel, erreurs console, issue de partie et capture.
//
// Usage : node tools/verify-hive.mjs [url] [scenario] [secondes] [capture.png]
//   scenario :
//     win[:N]    bot « bon joueur » (expansion, défense, all-in persistant) sur la
//                carte N (1-based, défaut 2) — ATTEND une victoire
//     idle[:N]   bot passif sur la carte N — ATTEND une défaite (l'IA punit l'inaction)
//     mirror[:R] R parties (défaut 3, carte 2) où le camp abeilles est piloté par la
//                MÊME classe Ai que l'adversaire (exposée sur __game) — rapport
//                win/lose/timeout, aucune attente stricte (l'impasse est valide à niveau égal)
//     stress     ?stress : les deux camps canonnent (~600 unités) — mesure les fps
//
// Cartes (1-based) : 1 eveil (TUTORIEL, IA somnolente — pas un scénario de mesure),
// 2 clairiere 🪳, 3 verger 🪳, 4 nuee 🪰, 5 riviere 🪰, 6 ruche-rivale 🐝,
// 7 fourmiliere 🐝, 8 trone 🐝, 9 guerre-des-clans 🪰🪳 (mêlée à 3).
//
// Env : CHROME_PATH surcharge le binaire Chrome ; --no-sandbox ajouté en root ;
// en conteneur, lancer node SANS les variables proxy (cf. CLAUDE.md).
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] ?? 'http://localhost:5173/games/hive/';
const SCENARIO = process.argv[3] ?? 'win';
const SECONDS = Number(process.argv[4] ?? 240);
const SHOT = process.argv[5] ?? '';

// paramètres du camp miroir — garder alignés sur la carte testée (CLAIRIERE)
const MIRROR_PARAMS = {
  decisionInterval: 2.2,
  aggression: 0.5,
  reserveFrac: 0.3,
  distWeight: 0.5,
  defendBias: 1.5,
  waveNodes: 2,
};

const [kind, suffixStr] = SCENARIO.split(':');
const MIRROR_RUNS = kind === 'mirror' ? Number(suffixStr ?? 3) : 3;
// défaut carte 2 (clairiere) : la carte 1 est le tutoriel à IA somnolente
const LEVEL = kind === 'win' || kind === 'idle' ? Number(suffixStr ?? 2) : 2;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--window-size=560,1000',
    '--force-device-scale-factor=1',
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 540, height: 960 });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(kind === 'stress' ? `${URL}?stress` : URL, { waitUntil: 'load' });
await page.waitForFunction('window.__game !== undefined', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 400));

// compteur de frames pour le fps réel
await page.evaluate(() => {
  window.__frames = 0;
  const count = () => {
    window.__frames++;
    requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
});

/** Bot « bon joueur » : défense, expansion vers les neutres, all-in persistant.
 *  Conscient des PUISSANCES d'espèce (un bon joueur envoie plus de monde contre
 *  un clan costaud) : les masses sont comptées en puissance via factionPower. */
function driveWinBot() {
  return page.evaluate(() => {
    const g = window.__game;
    if (g.flow.state !== 'playing') return;
    const w = g.world;
    const n = w.nodes;
    const u = w.units;
    const P = w.factionPower;
    const incFoe = new Array(n.count).fill(0); // en puissance
    const incMine = new Array(n.count).fill(0);
    for (let i = 0; i < u.count; i++) {
      if (u.dead[i]) continue;
      if (u.faction[i] !== 1) incFoe[u.target[i]] += P[u.faction[i]];
      else incMine[u.target[i]] += P[1];
    }
    // défense : un nœud assiégé appelle le voisin allié le plus fourni
    for (let i = 0; i < n.count; i++) {
      if (n.faction[i] !== 1 || incFoe[i] <= n.stock[i] * P[1] + incMine[i]) continue;
      let helper = -1;
      let best = 0;
      for (let j = 0; j < n.count; j++) {
        if (n.faction[j] !== 1 || j === i || n.stock[j] < 14) continue;
        if (n.stock[j] > best) {
          best = n.stock[j];
          helper = j;
        }
      }
      if (helper >= 0) {
        w.postSend(helper, i);
        break;
      }
    }
    // expansion : nœuds pleins vers le neutre le plus proche
    for (let i = 0; i < n.count; i++) {
      if (n.faction[i] !== 1 || n.stock[i] < 20) continue;
      let bestJ = -1;
      let bestD = Infinity;
      for (let j = 0; j < n.count; j++) {
        if (n.faction[j] !== 0) continue;
        const d = (n.x[j] - n.x[i]) ** 2 + (n.y[j] - n.y[i]) ** 2;
        if (d < bestD) {
          bestD = d;
          bestJ = j;
        }
      }
      if (bestJ >= 0) w.postSend(i, bestJ);
    }
    // all-in persistant : dès 70 de masse (en puissance), marteler LE nid
    // faible jusqu'à sa chute
    let total = 0;
    for (let i = 0; i < n.count; i++) if (n.faction[i] === 1) total += n.stock[i] * P[1];
    let target = window.__botTarget ?? -1;
    if (target >= 0 && n.faction[target] < 2) target = -1;
    if (target < 0 && total >= 70) {
      let weakest = Infinity;
      for (let j = 0; j < n.count; j++) {
        if (n.faction[j] < 2) continue; // hostile = toute faction IA (2 ou 3)
        const def = n.stock[j] * P[n.faction[j]] + incFoe[j] - incMine[j];
        if (def < weakest) {
          weakest = def;
          target = j;
        }
      }
    }
    window.__botTarget = target;
    if (target >= 0) {
      for (let i = 0; i < n.count; i++) {
        if (n.faction[i] === 1 && n.stock[i] >= 12) {
          w.postSend(i, target); // double-tap : 50 % puis 25 %
          w.postSend(i, target);
        }
      }
    }
  });
}

const snapshot = () =>
  page.evaluate(() => {
    const g = window.__game;
    const s = g.world.stats();
    return {
      state: g.flow.state,
      time: Math.round(g.world.time),
      ...s,
      frames: window.__frames,
      resultClass:
        g.flow.state === 'result' ? (document.querySelector('#ui h2')?.className ?? '?') : null,
    };
  });

/** Joue une partie jusqu'au résultat (ou timeout). Retourne 'win'|'lose'|'timeout'. */
async function playOne(drive, timeoutSec, samples) {
  await page.evaluate((levelIdx) => {
    window.__botTarget = -1;
    window.__game.save.unlocked = 99; // headless : toutes les cartes accessibles
    window.__game.flow.startGame(levelIdx);
  }, LEVEL - 1);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutSec * 1000) {
    await new Promise((r) => setTimeout(r, 1500));
    if (drive) await drive();
    const snap = await snapshot();
    if (samples) samples.push(snap);
    if (snap.state === 'result') return snap.resultClass;
  }
  return 'timeout';
}

const start = Date.now();
const samples = [];
let outcome;
let expected;

if (kind === 'stress') {
  expected = null;
  const t0 = Date.now();
  while (Date.now() - t0 < Math.min(SECONDS, 30) * 1000) {
    await new Promise((r) => setTimeout(r, 1500));
    samples.push(await snapshot());
  }
  outcome = 'stress-done';
} else if (kind === 'win') {
  expected = 'win';
  outcome = await playOne(driveWinBot, SECONDS, samples);
} else if (kind === 'idle') {
  expected = 'lose';
  outcome = await playOne(null, SECONDS, samples);
} else if (kind === 'mirror') {
  expected = null;
  const results = [];
  for (let run = 0; run < MIRROR_RUNS; run++) {
    // le camp abeilles est piloté par la même classe Ai que l'adversaire
    await page.evaluate((params) => {
      if (window.__mirrorTimer) clearInterval(window.__mirrorTimer);
      const g = window.__game;
      const ai = new g.Ai(g.world.nodes, g.world.units, g.world.emitter, 1, g.world.factionPower, g.world.factionSpeed);
      ai.reset(params);
      let last = performance.now();
      window.__mirrorTimer = setInterval(() => {
        if (g.flow.state !== 'playing') return;
        const now = performance.now();
        ai.update((now - last) / 1000);
        last = now;
      }, 250);
    }, MIRROR_PARAMS);
    results.push(await playOne(null, SECONDS, run === 0 ? samples : null));
  }
  await page.evaluate(() => clearInterval(window.__mirrorTimer));
  outcome = results.join(',');
} else {
  console.error(`scénario inconnu : ${SCENARIO}`);
  process.exit(2);
}

if (SHOT) await page.screenshot({ path: SHOT });
const elapsed = (Date.now() - start) / 1000;
const lastSnap = samples[samples.length - 1];
const report = {
  scenario: SCENARIO,
  outcome,
  expected,
  ok: errors.length === 0 && (expected === null || outcome === expected),
  fpsAvg: lastSnap ? Math.round(lastSnap.frames / elapsed) : null,
  errors,
  last: lastSnap,
  samples: samples.filter((_, i) => i % 10 === 0),
};
console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(report.ok ? 0 : 1);
