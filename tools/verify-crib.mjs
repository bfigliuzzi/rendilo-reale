// Vérification headless de Berceau (games/crib).
//
// Usage : node tools/verify-crib.mjs [url] [scénario] [capture.png]
//   grip            ASSERTION de la mécanique centrale — à lancer après TOUTE
//                   retouche des GRIP_* ou du tir. Vérifie qu'un bébé enseveli
//                   sous des mamies atteint bien l'immobilisation, que sa vitesse
//                   tombe à zéro, que son tir auto SEUL le libère, et que le grip
//                   redescend à zéro. « Le bébé reste piégé » est le pire bug
//                   possible de ce jeu : c'est ce scénario qui le voit.
//   win[:seed]      bot qui joue une partie complète, ATTEND une victoire.
//   idle[:seed]     passif, ATTEND une défaite — mesure la pression brute.
//   keyboard        joue au clavier SEUL depuis l'accueil : vérifie les 8 directions,
//                   qu'un contrôle reste atteignable au Tab en jeu, et que le focus
//                   ne retombe JAMAIS sur <body> après un changement d'écran (le
//                   test de non-régression RGAA).
//   stress          fps à ~400 ennemis.
//
// Exit : 0 ok · 1 erreur console ou issue inattendue · 2 argument invalide.
//
// Env : CHROME_PATH surcharge le binaire. En conteneur, lancer node SANS les
// variables proxy (env -u HTTP_PROXY -u HTTPS_PROXY …), sinon Chromium proxifie
// localhost.
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] ?? 'http://localhost:5199/games/crib/';
const SCENARIO = process.argv[3] ?? 'grip';
const SHOT = process.argv[4] ?? '';

const [kind, arg] = SCENARIO.split(':');
if (!['grip', 'win', 'idle', 'keyboard', 'stress'].includes(kind)) {
  console.error(`scénario inconnu : ${SCENARIO}`);
  process.exit(2);
}
const SEED = arg ? Number(arg) : 0xbebe;
if (Number.isNaN(SEED)) {
  console.error(`seed invalide : ${arg}`);
  process.exit(2);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--window-size=560,1000',
    '--force-device-scale-factor=1',
    // conteneurs/CI : Chromium refuse de tourner en root avec son sandbox
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

// « load » plutôt que networkidle0 : le websocket HMR de Vite ne se stabilise
// jamais — c'est le waitForFunction qui garantit que le jeu est prêt
await page.goto(kind === 'stress' ? `${URL}?stress` : URL, { waitUntil: 'load' });
await page.waitForFunction('window.__game !== undefined', { timeout: 15000 });

// compteur de frames, pour les fps réels
await page.evaluate(() => {
  window.__frames = 0;
  const tick = () => {
    window.__frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Instantané complet, la seule fenêtre du bot sur l'état du jeu. */
const snapshot = () =>
  page.evaluate(() => {
    const g = window.__game;
    const w = g.world;
    return {
      state: g.flow.state,
      playing: w.playing,
      ...w.stats(),
      run: { ...w.run },
      hero: { x: w.hero.x, y: w.hero.y, speed: w.hero.speed, grip: w.hero.grip, clung: w.hero.clung },
      frames: window.__frames,
    };
  });

const report = { scenario: SCENARIO, outcome: 'unknown', expected: null, ok: false, errors: [] };
const detail = {};

// ---------------------------------------------------------------------- grip

if (kind === 'grip') {
  report.expected = 'pass';
  const checks = {};

  // ---- phase A : une MEUTE cloue, et le tir auto seul en sort
  //
  // On neutralise le spawner du niveau : le scénario doit mesurer une meute
  // scriptée, pas la courbe du niveau qui viendrait la polluer. Même procédé que
  // verify-hive quand il remplace world.update pour ticker hors temps réel.
  await page.evaluate((seed) => {
    const g = window.__game;
    g.flow.startLevel(seed);
    g.world.spawner.update = () => {};
    g.world.enemies.clear();
    const h = g.world.hero;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      g.world.postSpawn(0, h.x + Math.cos(a) * 20, h.y + Math.sin(a) * 20);
    }
  }, SEED);

  const samples = [];
  let pinnedAt = -1;
  let freedAt = -1;
  let minSpeedWhilePinned = Infinity;
  const t0 = Date.now();
  while (Date.now() - t0 < 14000) {
    await sleep(100);
    const s = await snapshot();
    const t = (Date.now() - t0) / 1000;
    samples.push({ t: +t.toFixed(2), grip: +s.grip.toFixed(3), speed: Math.round(s.hero.speed), enemies: s.enemies });
    if (s.pinned) {
      if (pinnedAt < 0) pinnedAt = t;
      minSpeedWhilePinned = Math.min(minSpeedWhilePinned, s.hero.speed);
    }
    // libéré : plus aucun contact ET jauge revenue à zéro
    if (pinnedAt >= 0 && freedAt < 0 && s.grip <= 0.001 && s.enemies === 0) freedAt = t;
    if (freedAt >= 0) break;
  }

  // ① la meute cloue bien le bébé, et vite
  checks.packPins = pinnedAt >= 0 && pinnedAt < 2.5;
  // ② cloué VEUT DIRE cloué : vitesse nulle
  checks.speedZero = minSpeedWhilePinned <= 0.01;
  // ③ le tir auto SEUL le libère — le bot n'a pas touché aux commandes
  checks.freesItself = freedAt >= 0;
  detail.pack = {
    pinnedAt: pinnedAt < 0 ? null : +pinnedAt.toFixed(2),
    freedAt: freedAt < 0 ? null : +freedAt.toFixed(2),
    minSpeedWhilePinned: Number.isFinite(minSpeedWhilePinned) ? +minSpeedWhilePinned.toFixed(3) : null,
    samples: samples.filter((_, i) => i % 4 === 0),
  };

  // ---- phase B : UN SEUL agrippeur ne doit PAS clouer
  //
  // C'est l'invariant de conception le plus fragile du jeu. Avec un grip qui
  // s'intègre sans borne (le premier modèle), une mamie isolée finissait toujours
  // par immobiliser : l'engluement était binaire et le tank perdait son rôle de
  // menace kitable. Le grip CONVERGE désormais vers charge / GRIP_LOAD_FOR_PIN, et
  // ce contrôle est ce qui empêche la régression.
  await page.evaluate(() => {
    const g = window.__game;
    g.world.enemies.clear();
    // remise à zéro des bonus : la phase A a tué quatre mamies, qui ont pu lâcher un
    // DOUDOU ramassé au passage — l'immunité au grip faussait alors toute la mesure.
    // (Le piège a été vécu : phase B mesurait un grip de 0 et accusait le modèle.)
    g.world.pickups.clear();
    g.world.hero.immuneT = 0;
    g.world.hero.bottleT = 0;
    g.world.hero.grip = 0;
    // PV infinis : la mesure doit porter sur le palier de grip, pas sur la course
    // entre le grip qui monte et la mamie qui meurt
    g.world.postSpawn(0, g.world.hero.x + 22, g.world.hero.y);
    g.world.enemies.hp[0] = 1e9;
  });
  let soloGrip = 0;
  let soloSpeed = 0;
  let soloPinned = false;
  const t1 = Date.now();
  const soloSamples = [];
  while (Date.now() - t1 < 3000) {
    await sleep(120);
    const s = await snapshot();
    soloGrip = s.grip;
    soloSpeed = s.hero.speed;
    if (s.pinned) soloPinned = true;
    soloSamples.push({ grip: +s.grip.toFixed(3), speed: Math.round(s.hero.speed) });
  }
  // ④ une mamie seule ralentit fort mais ne cloue jamais
  checks.soloNeverPins = !soloPinned;
  // ⑤ et le palier atteint est bien celui annoncé : gripMul 1.6 / 3.2 = 0.5
  checks.soloTarget = Math.abs(soloGrip - 0.5) < 0.06;
  // ⑥ donc on garde de quoi s'échapper : la mamie avance à 34 px/s
  checks.soloEscapable = soloSpeed > 40;
  detail.solo = {
    grip: +soloGrip.toFixed(3),
    speed: Math.round(soloSpeed),
    pinned: soloPinned,
    samples: soloSamples.filter((_, i) => i % 4 === 0),
  };

  // ---- phase C : le doudou annule tout, c'est la porte de sortie
  //
  // Troisième garde-fou de la mécanique : même collé, un bébé sous doudou récupère
  // sa pleine vitesse. Sans lui, un pinning mal engagé n'aurait aucune issue.
  await page.evaluate(() => {
    window.__game.hero.immuneT = 6;
  });
  await sleep(500);
  const immune = await snapshot();
  checks.blanketFrees = immune.grip <= 0.001 && immune.hero.speed > 160 && immune.hero.clung > 0;
  detail.blanket = {
    grip: +immune.grip.toFixed(3),
    speed: Math.round(immune.hero.speed),
    clung: immune.hero.clung,
  };

  detail.checks = checks;
  report.outcome = Object.values(checks).every(Boolean) ? 'pass' : 'fail';
}

// ------------------------------------------------------------------ win/idle

if (kind === 'win' || kind === 'idle') {
  report.expected = kind === 'win' ? 'win' : 'lose';
  await page.evaluate((seed) => window.__game.flow.startLevel(seed), SEED);

  const samples = [];
  const t0 = Date.now();
  const limitMs = 280000;
  let last = null;
  while (Date.now() - t0 < limitMs) {
    await sleep(140);
    if (kind === 'win') await drive();
    last = await snapshot();
    if (samples.length === 0 || last.time - samples[samples.length - 1].time > 5) {
      samples.push({
        time: +last.time.toFixed(1),
        crib: Math.round(last.cribHp),
        enemies: last.enemies,
        grip: +last.grip.toFixed(2),
        boss: Math.round(last.bossHp),
        kills: last.run.kills,
      });
    }
    if (last.state === 'result') break;
  }
  detail.samples = samples;
  detail.last = last;
  if (last?.state === 'result') {
    report.outcome = await page.evaluate(() => {
      const h = document.querySelector('#ui h2');
      return h?.classList.contains('win') ? 'win' : h?.classList.contains('lose') ? 'lose' : 'unknown';
    });
  } else {
    report.outcome = 'timeout';
  }
}

/**
 * Le bot « bon joueur ». Il écrit directement `steer.dirX/dirY` : aucun événement
 * d'entrée ne survenant, `Steer.recompute` ne les écrase jamais — c'est le hook de
 * pilotage prévu, et il traverse exactement le même chemin que le joueur ensuite.
 *
 * Priorités, dans l'ordre : se dégager d'un engluement → sortir du cône de
 * l'Aspirateur → ramasser ce qui est sur le chemin → repousser ce qui mord le
 * berceau → aller chercher le boss → intercepter la menace la plus avancée →
 * revenir couvrir le berceau.
 */
async function drive() {
  await page.evaluate(() => {
    const g = window.__game;
    const w = g.world;
    if (!w.playing) return;
    const h = w.hero;
    const e = w.enemies;
    const crib = w.crib;
    let dx = 0;
    let dy = 0;

    const set = (x, y) => {
      const d = Math.hypot(x, y) || 1;
      dx = x / d;
      dy = y / d;
    };

    // ① englué : fuir la moyenne des colleurs. Même cloué on pousse — la vitesse
    // repart dès que le tir auto en a tué un.
    if (h.grip > 0.45) {
      let ax = 0;
      let ay = 0;
      let n = 0;
      for (let i = 0; i < e.count; i++) {
        const ddx = e.x[i] - h.x;
        const ddy = e.y[i] - h.y;
        if (ddx * ddx + ddy * ddy < 60 * 60) {
          ax += ddx;
          ay += ddy;
          n++;
        }
      }
      if (n > 0) set(-ax, -ay);
    }

    // ② JAMAIS tirer dans l'aspirateur. Dès qu'on est dans le cône, se dégager par
    // la tangente passe avant tout le reste : les cubes y sont gobés, donc tout ce
    // qu'on fait depuis cette position est perdu.
    //
    // Le piège a été mesuré : sans cette priorité, le bot allait défendre le berceau,
    // se plantait pile devant l'embout garé dessus, et ne tuait plus RIEN pendant
    // vingt secondes (kills figés, PV du boss figés, berceau qui fond). L'Aspirateur
    // protège son escorte — c'est voulu, et il faut le contourner.
    if (dx === 0 && dy === 0 && w.boss.active && w.boss.inCone(h.x, h.y)) {
      const bdx = w.boss.x - h.x;
      const bdy = w.boss.y - h.y;
      const bd = Math.hypot(bdx, bdy) || 1;
      // tangentielle + une pincée vers l'intérieur : tourner de PRÈS bat sa vitesse
      // de rotation (1.1 rad/s), tourner de loin non
      set(-bdy / bd + (bdx / bd) * 0.35, bdx / bd + (bdy / bd) * 0.35);
    }

    // ③ ramassable proche : c'est sur le chemin, on le prend
    if (dx === 0 && dy === 0) {
      let best = -1;
      let bestD = 200 * 200;
      for (let i = 0; i < w.pickups.count; i++) {
        const ddx = w.pickups.x[i] - h.x;
        const ddy = w.pickups.y[i] - h.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      if (best >= 0) set(w.pickups.x[best] - h.x, w.pickups.y[best] - h.y);
    }

    // ④ URGENCE BERCEAU : quelque chose est en train de mordre. Ça passe AVANT
    // d'aller chercher le boss — un bon joueur ne reste pas collé à l'Aspirateur
    // pendant que trois couches rongent derrière lui.
    if (dx === 0 && dy === 0) {
      let urgent = -1;
      let urgentD = 150 * 150;
      for (let i = 0; i < e.count; i++) {
        if (e.hp[i] <= 0) continue;
        const kind = e.kind[i];
        // seuls ceux qui abîment le berceau comptent comme urgence
        if (kind !== 1) continue;
        const ddx = e.x[i] - crib.x;
        const ddy = e.y[i] - crib.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < urgentD) {
          urgentD = d2;
          urgent = i;
        }
      }
      if (urgent >= 0) set(e.x[urgent] - h.x, e.y[urgent] - h.y);
    }

    // ⑤ boss : on va le chercher, mais seulement une fois hors de son cône (traité
    // en ②) et le berceau au calme
    if (dx === 0 && dy === 0 && w.boss.active) {
      const bdx = w.boss.x - h.x;
      const bdy = w.boss.y - h.y;
      if (Math.hypot(bdx, bdy) > 150) set(bdx, bdy);
    }

    // ⑥ intercepter : la menace la plus PROCHE DU BERCEAU, en se plaçant entre elle
    // et lui — c'est ce qui vaut au bot de tenir les cent premières secondes
    if (dx === 0 && dy === 0) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < e.count; i++) {
        if (e.hp[i] <= 0) continue;
        const ddx = e.x[i] - crib.x;
        const ddy = e.y[i] - crib.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      if (best >= 0) {
        const bx = e.x[best];
        const by = e.y[best];
        const toCrib = Math.hypot(bx - crib.x, by - crib.y) || 1;
        // point d'interception : sur le segment cible→berceau, à 60 px de la cible
        const ix = bx + ((crib.x - bx) / toCrib) * 60;
        const iy = by + ((crib.y - by) / toCrib) * 60;
        set(ix - h.x, iy - h.y);
      }
    }

    // ⑦ rien à faire : couvrir le berceau
    if (dx === 0 && dy === 0) {
      const ddx = crib.x - h.x;
      const ddy = crib.y - h.y + 70;
      if (Math.hypot(ddx, ddy) > 30) set(ddx, ddy);
    }

    g.steer.dirX = dx;
    g.steer.dirY = dy;
  });
}

// ------------------------------------------------------------------ keyboard

if (kind === 'keyboard') {
  report.expected = 'pass';
  // parcours au clavier SEUL, depuis l'accueil : c'est le test de non-régression
  // de l'accessibilité. Aucun clic, aucune écriture dans le modèle.
  const focused = () =>
    page.evaluate(() => {
      const a = document.activeElement;
      return { tag: a?.tagName ?? 'none', label: a?.textContent?.trim().slice(0, 24) ?? '' };
    });

  const atMenu = await focused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await sleep(400);
  const started = await page.evaluate(() => window.__game.flow.state);

  // les huit directions, une par une, en mesurant le déplacement RÉEL
  const dirs = [
    ['KeyW', 0, -1],
    ['KeyS', 0, 1],
    ['KeyA', -1, 0],
    ['KeyD', 1, 0],
    ['ArrowUp', 0, -1],
    ['ArrowDown', 0, 1],
    ['ArrowLeft', -1, 0],
    ['ArrowRight', 1, 0],
  ];
  const moves = [];
  for (const [code, ex, ey] of dirs) {
    const before = await page.evaluate(() => ({ x: window.__game.hero.x, y: window.__game.hero.y }));
    await page.keyboard.down(code);
    await sleep(280);
    await page.keyboard.up(code);
    await sleep(60);
    const after = await page.evaluate(() => ({ x: window.__game.hero.x, y: window.__game.hero.y }));
    const mx = after.x - before.x;
    const my = after.y - before.y;
    // le signe doit correspondre, et le déplacement être franc (> 10 px) — sauf si
    // le bébé était contre une butée de l'arène, cas signalé plutôt que masqué
    const okX = ex === 0 ? Math.abs(mx) < 12 : Math.sign(mx) === ex && Math.abs(mx) > 10;
    const okY = ey === 0 ? Math.abs(my) < 12 : Math.sign(my) === ey && Math.abs(my) > 10;
    moves.push({ code, mx: Math.round(mx), my: Math.round(my), ok: okX && okY });
  }

  // en JEU, le focus est sur <body> et c'est CORRECT : `Steer` écoute sur window, et
  // une arène n'a rien à focaliser. Ce qu'on vérifie, c'est qu'un contrôle reste
  // ATTEIGNABLE au clavier — Tab doit tomber sur le bouton de redémarrage.
  await page.keyboard.press('Tab');
  const inGameTab = await focused();

  // fin de partie forcée, puis focus de l'écran de résultat
  await page.evaluate(() => window.__game.world.crib.damage(1e9));
  await sleep(500);
  const atResult = await focused();

  detail.atMenu = atMenu;
  detail.inGameTab = inGameTab;
  detail.atResult = atResult;
  detail.started = started;
  detail.moves = moves;
  detail.checks = {
    started: started === 'playing',
    allMoved: moves.every((m) => m.ok),
    // LE test de non-régression RGAA : après un changement d'écran, le focus ne doit
    // jamais retomber sur <body> — c'est le manque relevé dans Essaim, et le piège
    // classique du re-render d'écran.
    menuFocused: atMenu.tag !== 'BODY',
    resultFocused: atResult.tag !== 'BODY',
    controlReachable: inGameTab.tag === 'BUTTON',
  };
  report.outcome = Object.values(detail.checks).every(Boolean) ? 'pass' : 'fail';
}

// -------------------------------------------------------------------- stress

if (kind === 'stress') {
  report.expected = 'pass';
  await sleep(1500);
  const s = await snapshot();
  detail.enemies = s.enemies;
  report.outcome = 'pass';
}

// -------------------------------------------------------------------- rapport

const f0 = await page.evaluate(() => window.__frames);
await sleep(2000);
const f1 = await page.evaluate(() => window.__frames);
report.fpsAvg = Math.round(((f1 - f0) / 2000) * 1000);
if (SHOT) await page.screenshot({ path: SHOT });

report.errors = errors.slice(0, 5);
report.ok = errors.length === 0 && report.outcome === report.expected;
Object.assign(report, detail);
console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(report.ok ? 0 : 1);
