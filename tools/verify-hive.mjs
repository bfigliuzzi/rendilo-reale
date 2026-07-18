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
//     duel:A-B[:R]  R duels (défaut 8, 16 conseillé) espèce A vs espèce B
//                (bee|fly|roach) sur 4 cartes SYMÉTRIQUES cyclées (une géométrie
//                unique est quasi déterministe : l'issue bascule sur des seuils
//                d'ouverture), MÊME classe Ai et MÊMES paramètres des deux côtés,
//                camps alternés à chaque run. Sim en ticks ACCÉLÉRÉS (60 Hz hors
//                temps réel) ; le 4e argument = plafond en secondes SIMULÉES
//                (défaut 600). Rapport win/départage à la puissance restante —
//                LA mesure de parité inter-clans (attendu ~50/50 ou impasse)
//     stress     ?stress : les deux camps canonnent (~600 unités) — mesure les fps
//
// Cartes (1-based) : 1 eveil (TUTORIEL, IA somnolente — pas un scénario de mesure),
// 2 clairiere 🪳, 3 verger 🪳, 4 ruche-rivale 🐝, 5 riviere 🪰, 6 nuee 🪰,
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

// paramètres du camp miroir — garder alignés sur la carte testée (CLAIRIERE,
// soit campaignAi(2, 0) dans config/maps.ts)
const MIRROR_PARAMS = {
  decisionInterval: 2.4,
  aggression: 0.5,
  reserveFrac: 0.3,
  distWeight: 0.5,
  defendBias: 1.4,
  waveNodes: 2,
  grace: 4,
};

const [kind, suffixStr, suffix2] = SCENARIO.split(':');
const MIRROR_RUNS = kind === 'mirror' ? Number(suffixStr ?? 3) : 3;
// défaut carte 2 (clairiere) : la carte 1 est le tutoriel à IA somnolente
const LEVEL = kind === 'win' || kind === 'idle' ? Number(suffixStr ?? 2) : 2;
const DUEL_RUNS = kind === 'duel' ? Number(suffix2 ?? 8) : 0;
const DUEL_SPECIES = kind === 'duel' ? (suffixStr ?? 'bee-roach').split('-') : [];
const DUEL_SIM_CAP = Number(process.argv[4] ?? 600); // secondes SIMULÉES par duel

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
} else if (kind === 'duel') {
  expected = null;
  const [spA, spB] = DUEL_SPECIES;
  const tally = { [spA]: 0, [spB]: 0, draw: 0 };
  for (let run = 0; run < DUEL_RUNS; run++) {
    // camps alternés à chaque run : garde-fou contre toute asymétrie f1/f2 résiduelle
    const f1 = run % 2 === 1 ? spB : spA;
    const f2 = run % 2 === 1 ? spA : spB;
    await page.evaluate(
      (sp1, sp2, params, mapIdx) => {
        const g = window.__game;
        // gèle la boucle rAF : la sim n'avance QUE par nos rafales de ticks (sinon le
        // camp 2, mis à jour dans world.update, serait avantagé pendant les pauses)
        if (!window.__realUpdate) {
          window.__realUpdate = g.world.update.bind(g.world);
          g.world.update = () => {};
        }
        // 4 cartes SYMÉTRIQUES (symétrie centrale x→540−x, y→960−y), cyclées par
        // run : sur une seule géométrie l'issue est quasi déterministe (elle
        // bascule sur des seuils d'ouverture) — varier les cartes échantillonne
        // les ouvertures et rend le win-rate mesurable.
        const MAPS = [
          [
            // clairière : anneau régulier + centre riche
            { x: 270, y: 810, faction: 1, stock: 25 },
            { x: 270, y: 150, faction: 2, stock: 25 },
            { x: 110, y: 650, faction: 0, stock: 8 },
            { x: 430, y: 310, faction: 0, stock: 8 },
            { x: 430, y: 650, faction: 0, stock: 8 },
            { x: 110, y: 310, faction: 0, stock: 8 },
            { x: 270, y: 480, faction: 0, stock: 18 },
          ],
          [
            // anneau : couronne autour d'un axe central pauvre
            { x: 270, y: 850, faction: 1, stock: 25 },
            { x: 270, y: 110, faction: 2, stock: 25 },
            { x: 270, y: 660, faction: 0, stock: 12 },
            { x: 270, y: 300, faction: 0, stock: 12 },
            { x: 120, y: 480, faction: 0, stock: 10 },
            { x: 420, y: 480, faction: 0, stock: 10 },
            { x: 140, y: 220, faction: 0, stock: 8 },
            { x: 400, y: 740, faction: 0, stock: 8 },
          ],
          [
            // couloirs : départs excentrés, poches asymétriques par côté
            { x: 135, y: 840, faction: 1, stock: 25 },
            { x: 405, y: 120, faction: 2, stock: 25 },
            { x: 135, y: 600, faction: 0, stock: 10 },
            { x: 405, y: 360, faction: 0, stock: 10 },
            { x: 135, y: 360, faction: 0, stock: 14 },
            { x: 405, y: 600, faction: 0, stock: 14 },
            { x: 405, y: 840, faction: 0, stock: 6 },
            { x: 135, y: 120, faction: 0, stock: 6 },
            { x: 270, y: 480, faction: 0, stock: 20 },
          ],
          [
            // flancs riches : gros neutres décentrés, centre très convoité
            { x: 270, y: 820, faction: 1, stock: 25 },
            { x: 270, y: 140, faction: 2, stock: 25 },
            { x: 100, y: 760, faction: 0, stock: 16 },
            { x: 440, y: 200, faction: 0, stock: 16 },
            { x: 440, y: 760, faction: 0, stock: 6 },
            { x: 100, y: 200, faction: 0, stock: 6 },
            { x: 100, y: 480, faction: 0, stock: 10 },
            { x: 440, y: 480, faction: 0, stock: 10 },
            { x: 270, y: 480, faction: 0, stock: 24 },
          ],
        ];
        g.world.loadLevel({
          id: 'duel',
          name: 'Duel',
          nodes: MAPS[mapIdx],
          factions: [{ species: sp1 }, { species: sp2, ai: params }],
        });
        window.__duelResult = null;
        g.world.onGameOver = (victory, time) => {
          window.__duelResult = { victory, time };
        };
        // le camp 1 est piloté par la MÊME classe Ai avec les MÊMES paramètres
        window.__duelAi = new g.Ai(g.world.nodes, g.world.units, g.world.emitter, 1, g.world.factionPower, g.world.factionSpeed);
        window.__duelAi.reset(params);
      },
      f1,
      f2,
      MIRROR_PARAMS,
      Math.floor(run / 2) % 4, // même carte pour chaque paire de runs à camps alternés
    );
    let step;
    do {
      step = await page.evaluate(
        (ticks, cap) => {
          const g = window.__game;
          const w = g.world;
          const dt = 1 / 60;
          for (let k = 0; k < ticks && !window.__duelResult && w.time < cap; k++) {
            window.__realUpdate(dt);
            window.__duelAi.update(dt);
          }
          const P = w.factionPower;
          const power = [0, 0, 0, 0];
          for (let i = 0; i < w.nodes.count; i++) power[w.nodes.faction[i]] += w.nodes.stock[i] * P[w.nodes.faction[i]];
          for (let i = 0; i < w.units.count; i++) if (!w.units.dead[i]) power[w.units.faction[i]] += w.units.hp[i];
          return {
            done: !!window.__duelResult,
            victory: window.__duelResult ? window.__duelResult.victory : null,
            time: w.time,
            p1: Math.round(power[1]),
            p2: Math.round(power[2]),
          };
        },
        2400,
        DUEL_SIM_CAP,
      );
    } while (!step.done && step.time < DUEL_SIM_CAP);
    // timeout : départage à la puissance restante, « draw » sous 10 % d'écart
    const winner = step.done
      ? step.victory
        ? f1
        : f2
      : Math.abs(step.p1 - step.p2) < 0.1 * (step.p1 + step.p2)
        ? 'draw'
        : step.p1 > step.p2
          ? f1
          : f2;
    tally[winner]++;
    samples.push({ run, map: Math.floor(run / 2) % 4, f1, f2, time: Math.round(step.time), p1: step.p1, p2: step.p2, winner, decided: step.done });
  }
  await page.evaluate(() => {
    window.__game.world.update = window.__realUpdate;
  });
  outcome = `${spA} ${tally[spA]} / draw ${tally.draw} / ${spB} ${tally[spB]}`;
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
  // duel : un échantillon par run (tous gardés) ; sinon décimation temporelle
  samples: kind === 'duel' ? samples : samples.filter((_, i) => i % 10 === 0),
};
console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(report.ok ? 0 : 1);
