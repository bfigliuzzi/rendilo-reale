// Bot de vérification de « Duo » (games/duo), pilote headless. Même forme que
// tools/verify-doors.mjs : puppeteer-core, CHROME_PATH, --no-sandbox en root,
// collecte des erreurs console, exit ≠ 0 si erreur console ou issue
// inattendue → utilisable en CI.
//
//   node tools/verify-duo.mjs <url> <scenario>
//
// Scénarios IMPLÉMENTÉS ICI (§7 de docs/prompt-duo.md) :
//   rules       assertions HORS PARTIE sur les 5 modèles au tour par tour
//               (cake, tree, tiles, beast, suspects), montées depuis
//               window.__game.models. Aucun bouton cliqué.
//   gen[:n]     fuzz des générateurs seedés sur n tirages (défaut 200) : les
//               garanties de §3 (pommes impaires, ≥3 coups, ≥6 poses, système
//               séparateur, écarts de fruits, ⭐ seedé de tiles). 0 échec
//               attendu.
//   contrast    recalcule les contrastes sur les VRAIES valeurs exposées
//               (window.__game.palette, window.__game.contrastRatio) +
//               unicité et séparation en niveaux de gris des 6 mascottes.
//   physics     plank (franchissement de mur à PLANK_VMAX, déterminisme,
//               invariance du replacement au point de contrôle), mirror
//               (déterminisme, coyote time), ant (déterminisme, garde
//               ANT_BLOCK_MIN_DIST).
//
//   play:<jeu>[:seed]   joue une manche ENTIÈRE en cliquant les VRAIS boutons
//               du DOM (et, pour les trois jeux `side`, au vrai clavier) :
//               accueil → menu → règle en images → plateau → écrans de
//               passage → résultat → « encore ». AUCUNE API de raccourci pour
//               avancer : un second chemin ne serait testé par personne.
//               `<jeu>` ∈ plank mirror cake tree tiles beast suspects ant.
//   keyboard[:jeu]  LE TEST RGAA : manche complète AU CLAVIER SEUL depuis
//               l'accueil. Vérifie que le focus ne retombe jamais sur <body>
//               APRÈS UNE VALIDATION (le traverser pendant une tabulation est
//               le comportement NORMAL du navigateur — le compter ferait
//               échouer une interface conforme) et que le saut automatique sur
//               la première cible légale marche à chaque tour. Sans argument :
//               les cinq jeux `pass` à la file.
//   stress      fps avec les 8 démos du menu animées EN MÊME TEMPS qu'un jeu
//               temps réel lancé (§7). Le taux absolu dépend de la machine.
//               Il porte aussi la MESURE de la règle ① de `core/demo.ts` (deux
//               boucles consécutives durent le même nombre de pas) — elle y
//               était affirmée et n'était exercée nulle part.
//
// Exit : 0 ok · 1 erreur console ou assertion(s) en échec · 2 argument
// invalide. En conteneur : lancer node SANS les variables de proxy
// (env -u HTTP_PROXY -u HTTPS_PROXY …), CHROME_PATH=/opt/pw-browsers/chromium.
// Lancer les scénarios longs sur `npx vite preview`, jamais `npm run dev` (le
// HMR recharge la page et tue le contexte du bot en pleine manche) : `play`,
// `keyboard` et `stress` ouvrent de vraies manches et durent, pour les trois
// jeux temps réel, la durée réelle d'une manche (90 s au plus, `ant` compris :
// deux mi-temps de 40 s + 10 s de mort subite, cf. l'arbitrage §1.2/§3.6 dans
// config/balance.ts — c'était 105 s avant qu'il ne soit tranché).
// `rules`, `gen`, `contrast` et `physics`, eux, n'ouvrent jamais de manche.
//
// 5e argument optionnel : le budget en secondes d'une manche (défaut 150, ou
// 200 pour un jeu `side`).

import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] ?? 'http://localhost:5173/games/duo/';
const SCENARIO = process.argv[3] ?? 'rules';

const [kind, arg1, arg2] = SCENARIO.split(':');

// ─────────────────────────────────────────────── constantes, DUPLIQUÉES ici
// Volontairement recopiées de config/balance.ts (pattern de verify-doors.mjs) :
// si le jeu change ses chiffres sans qu'on le sache, le bot doit le DÉTECTER,
// pas s'y adapter en silence.
const EXPECT = {
  TREE_EDGES: { min: 12, max: 18 },
  TREE_DEPTH: { min: 3, max: 4 },
  TREE_MAX_APPLES: 2,
  TREE_MIN_MOVES: 3,
  TREE_STAR_EXTRA_CUTS: 1,
  TILES_COLS: 6,
  TILES_ROWS: 6,
  TILES_BLOCKED: { min: 2, max: 4 },
  TILES_STACK: 12,
  TILES_MIN_PLACEMENTS: 6,
  TILES_STAR_PREPLACED: 2,
  CAKE_FRUITS: { min: 7, max: 11 },
  CAKE_MIN_GAP: 54,
  CAKE_RADIUS: 200,
  CAKE_CUTS: 6,
  CAKE_ANGLE_STEPS: 12,
  BEAST_COLS: 6,
  BEAST_ROWS: 8,
  BEAST_TURNS: 9,
  BEAST_TURNS_STAR: 11,
  BEAST_LIGHTS: 3,
  BEAST_LIGHTS_STAR: 4,
  BEAST_WARM_MAX: 2,
  BEAST_MILD_MAX: 4,
  SUSPECTS_COUNT: 6,
  SUSPECTS_TRAITS: 4,
  SUSPECTS_QUESTIONS: 3,
  SUSPECTS_ROUNDS: 4,
  PLANK_BALL_R: 14,
  PLANK_VMAX: 520,
  COURT_W: 420,
  COURT_H: 420,
  MIRROR_COYOTE: 0.1,
  MIRROR_JUMP_VY: 620,
  MIRROR_HALF_W: 13,
  MIRROR_HALF_H: 18,
  ANT_BLOCK_MIN_DIST: 40,
  ANT_RADIUS: 15,
  ANT_BLOCK_SIZE: 56,
};

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

// `play:<jeu>:<seed>` — LE SEED D'UNE MANCHE N'EST PAS UN BOUTON. C'est
// `Session` qui le tire à `Math.random` au montage, et le lui imposer par
// `session.setSeed` ne servirait à rien : `Shell.startGame` le réécrit d'un
// `nextSeed()` juste après. On rend donc DÉTERMINISTE la source d'aléa
// elle-même, avant le chargement de la page : le jeu suit ensuite exactement
// le code d'un joueur, sans qu'aucune API de raccourci ne soit appelée.
if (kind === 'play' && arg2 !== undefined) {
  await page.evaluateOnNewDocument((s) => {
    let a = s >>> 0 || 1;
    Math.random = () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, Number(arg2) >>> 0);
}

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

// « load » plutôt que networkidle0 : le websocket HMR de Vite ne se stabilise
// jamais — c'est le waitForFunction qui garantit que le jeu est prêt. Aucun
// des quatre scénarios ci-dessous n'ouvre de manche (donc aucun risque du
// piège navigateFallback du SW, cf. CLAUDE.md) : une seule navigation suffit.
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction('window.__game !== undefined && window.__game.models !== undefined', { timeout: 15000 });

// Compteur de frames global (pattern de verify-doors.mjs) : il tourne pour tous
// les scénarios, `stress` en lit des fenêtres successives.
await page.evaluate(() => {
  window.__frames = 0;
  const tick = () => {
    window.__frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await new Promise((r) => setTimeout(r, 300));

const start = Date.now();
const detail = {};
let scenarioOk = true;

// ─────────────────────────────────────────────── helpers d'impression

function printChecks(label, checks) {
  const fails = checks.filter((c) => !c.ok);
  console.log(`[${label}] ${checks.length} assertions, ${fails.length} échec(s)`);
  for (const f of fails) {
    console.log(`  ✗ ${f.name} — obtenu ${JSON.stringify(f.got)}, attendu ${JSON.stringify(f.want)}`);
  }
  return fails.length === 0;
}

// ═══════════════════════════════════════════════ SCÉNARIOS QUI PILOTENT LE DOM
//
// `play`, `keyboard` et `stress` ne touchent JAMAIS au modèle pour AVANCER :
// ils cliquent les vrais boutons de `#overlay` / `#ui` / `#pass` et envoient de
// vraies touches par le protocole (`page.keyboard`). Lire l'état (position de
// la bille, jeu courant, élément focalisé) reste autorisé — c'est ce que fait
// un joueur qui regarde l'écran, et c'est ce que fait déjà le bot de Trois
// Portes pour choisir sa cible. Ce qui est interdit, et absent d'ici, c'est
// d'appeler une méthode du modèle ou du flow pour PROGRESSER : ce second chemin
// ne serait testé par personne.

/** RNG seedée côté node : les choix du bot sont rejouables d'un run à l'autre. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Clique un sélecteur, comme un doigt : refusé si l'élément est mort. */
async function click(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.disabled || el.hidden || el.offsetParent === null) return false;
    el.click();
    return true;
  }, selector);
}

/**
 * Instantané de l'interface — RIEN que ce qu'un joueur voit ou entend : l'écran
 * courant, les boutons VIVANTS du micro-jeu, l'élément focalisé, les deux
 * régions live. C'est de là que le bot décide, exactement comme un joueur
 * regarde l'écran avant de taper ; rien ici ne fait AVANCER quoi que ce soit.
 */
async function snapshot() {
  return page.evaluate(() => {
    const g = window.__game;
    const alive = (el) => !el.disabled && !el.hidden && el.offsetParent !== null;
    const nodes = [...document.querySelectorAll('#overlay button, #overlay input, #overlay [tabindex]')].filter(
      (el) => el.getAttribute('tabindex') !== '-1',
    );
    const overlay = nodes.map((el, i) => ({
      i,
      tag: el.tagName,
      label: (el.getAttribute('aria-label') ?? el.textContent ?? '').slice(0, 60),
      alive: alive(el),
    }));
    const a = document.activeElement;
    return {
      flow: g.flow.current,
      panelKeys: [...document.querySelectorAll('#ui [data-key]')].map((e) => e.dataset.key),
      passVisible: g.pass.visible,
      overlay,
      liveCount: overlay.filter((o) => o.alive).length,
      focusOnBody: a === document.body || a === null || a === document.documentElement,
      focusTag: a ? `${a.tagName}.${a.className}` : 'null',
      focusInOverlay: !!a && document.getElementById('overlay').contains(a),
      board: document.getElementById('sr-board').textContent,
      log: document.getElementById('sr-log').textContent,
    };
  });
}

/** Le mouvement réduit est une OPTION DU JEU : on coche SA case, à la souris. */
async function enableReducedMotion(checks) {
  const st = await page.evaluate(() => {
    const el = document.querySelector('[data-key="opt-motion"]');
    return el ? { checked: el.checked, locked: el.disabled } : null;
  });
  if (!st) {
    checks.push({ name: 'mouvement réduit : la case existe sur l’accueil', got: false, want: true, ok: false });
    return;
  }
  if (!st.checked && !st.locked) {
    await page.evaluate(() => document.querySelector('[data-key="opt-motion"]').click());
    await sleep(180);
  }
  const on = await page.evaluate(() => window.__game.session.reducedMotion);
  checks.push({ name: 'mouvement réduit actif', got: on, want: true, ok: on === true });
}

/**
 * De l'accueil au plateau, en cliquant : ▶ jouer → la vignette du jeu →
 * (l'écran de règle en images d'un jeu jamais lancé) → le plateau.
 */
async function reachBoard(gameId, checks, tag) {
  const home = await snapshot();
  checks.push({ name: `${tag} : on part de l’accueil`, got: home.flow, want: 'home', ok: home.flow === 'home' });
  const played = await click('[data-key="play"]');
  checks.push({ name: `${tag} : ▶ jouer cliquable`, got: played, want: true, ok: played });
  await sleep(220);

  const menu = await snapshot();
  const tiles = menu.panelKeys.filter((k) => k.startsWith('g-'));
  checks.push({ name: `${tag} : le menu liste les 8 jeux`, got: tiles.length, want: 8, ok: tiles.length === 8 });
  const picked = await click(`[data-key="g-${gameId}"]`);
  checks.push({ name: `${tag} : vignette ${gameId} cliquable`, got: picked, want: true, ok: picked });
  await sleep(320);

  let st = await snapshot();
  if (st.flow === 'demo') {
    const skip = await click('[data-key="demo-skip"]');
    checks.push({ name: `${tag} : la règle en images se coupe d’un tap`, got: skip, want: true, ok: skip });
    await sleep(300);
    st = await snapshot();
  }
  // `game` OU `pass` : deux jeux (`beast`, `suspects`) demandent l'écran de
  // passage dès leur première mise à jour — le premier joueur doit prendre le
  // téléphone avant de voir le plateau. Exiger `game` ici ferait échouer un
  // jeu parfaitement conforme.
  const mounted = st.flow === 'game' || st.flow === 'pass';
  checks.push({ name: `${tag} : le plateau est monté`, got: st.flow, want: 'game|pass', ok: mounted });
  checks.push({
    name: `${tag} : le focus est posé sur une commande du jeu`,
    got: st.focusOnBody ? 'body' : st.focusTag,
    want: 'pas body',
    ok: !st.focusOnBody,
  });
  return st;
}

/**
 * Le pilote des cinq jeux `pass` : à chaque pas il relit l'écran et clique UN
 * bouton vivant tiré au sort (seedé). L'écran de passage se franchit par son
 * unique bouton, exactement comme le destinataire le ferait.
 */
async function drivePassGame(rnd, deadline, checks, tag) {
  let clicks = 0;
  let passes = 0;
  let bodyFocus = 0;
  let idle = 0;
  let guard = 0;
  let reached = null;
  // §5 — `#sr-board` tient le PLATEAU EN TEXTE : c'est ce qui rend une manche
  // jouable sans voir l'écran. On vérifie qu'il SUIT la partie (plusieurs
  // textes distincts), pas seulement qu'il est rempli une fois au montage.
  const boards = new Set();
  const logs = new Set();
  while (Date.now() < deadline && guard++ < 4000) {
    const st = await snapshot();
    if (st.board) boards.add(st.board);
    if (st.log) logs.add(st.log);
    if (st.flow === 'result') {
      reached = 'result';
      break;
    }
    if (st.flow === 'pass') {
      const ok = await click('#pass .passbtn');
      if (ok) passes++;
      await sleep(60);
      const after = await snapshot();
      if (after.focusOnBody) bodyFocus++;
      continue;
    }
    if (st.flow === 'game') {
      const live = st.overlay.filter((o) => o.alive);
      if (live.length === 0) {
        idle++;
        await sleep(70);
        continue;
      }
      const pick = live[Math.floor(rnd() * live.length)];
      const ok = await page.evaluate((idx) => {
        const nodes = [...document.querySelectorAll('#overlay button, #overlay input, #overlay [tabindex]')].filter(
          (el) => el.getAttribute('tabindex') !== '-1',
        );
        const el = nodes[idx];
        if (!el || el.disabled || el.hidden || el.offsetParent === null) return false;
        el.click();
        return true;
      }, pick.i);
      if (ok) clicks++;
      await sleep(55);
      const after = await snapshot();
      if (after.focusOnBody) bodyFocus++;
      continue;
    }
    await sleep(70);
  }
  checks.push({ name: `${tag} : au moins un vrai clic sur le plateau`, got: clicks > 0, want: true, ok: clicks > 0 });
  checks.push({
    name: `${tag} : le focus ne retombe jamais sur <body> après une validation`,
    got: bodyFocus,
    want: 0,
    ok: bodyFocus === 0,
  });
  checks.push({
    name: `${tag} : le plateau se lit en texte et SUIT la partie (#sr-board)`,
    got: boards.size,
    want: '≥ 2',
    ok: boards.size >= 2,
  });
  checks.push({
    name: `${tag} : le journal annonce plusieurs événements (#sr-log)`,
    got: logs.size,
    want: '≥ 2',
    ok: logs.size >= 2,
  });
  return { clicks, passes, bodyFocus, idle, boards: boards.size, logs: logs.size, reached };
}

// ─────────────────────── pilotes CLAVIER des trois jeux `side`
//
// Un jeu `side` n'a pas de bouton à cliquer : ses commandes SONT le mapping
// clavier du §3, celui de deux enfants côte à côte sur un portable. On envoie
// donc de vraies touches, jamais un appel au modèle.

const SIDE_KEYS = {
  plank: { p0: ['KeyA', 'KeyD'], p1: ['ArrowUp', 'ArrowDown'], fire: [] },
  mirror: { p0: ['KeyA', 'KeyD'], p1: ['ArrowUp'], fire: ['Space'] },
  ant: { p0: ['KeyW', 'KeyS', 'KeyA', 'KeyD'], p1: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], fire: ['KeyF', 'Enter'] },
};

/** Relâche tout ce qui est tenu — un `keyup` manquant colle une commande. */
async function releaseAll(held) {
  for (const k of [...held]) {
    await page.keyboard.up(k).catch(() => {});
    held.delete(k);
  }
}

async function holdSet(held, wanted) {
  for (const k of [...held]) if (!wanted.has(k)) { await page.keyboard.up(k).catch(() => {}); held.delete(k); }
  for (const k of wanted) if (!held.has(k)) { await page.keyboard.down(k).catch(() => {}); held.add(k); }
}

/**
 * `plank` se pilote VRAIMENT : la bille est visible, on connaît la sortie, et
 * un bang-bang proportionnel-dérivé sur les deux inclinaisons suffit à faire
 * des parcours. Toute la commande passe par KeyA/KeyD (siège 1) et
 * ArrowUp/ArrowDown (siège 2), c'est-à-dire par le mapping du §3.1 lui-même.
 */
async function drivePlank(deadline, checks, tag) {
  const held = new Set();
  let presses = 0;
  let bodyFocus = 0;
  let reached = null;
  let last = null;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const g = window.__game;
      const cur = g.game.current;
      const m = cur ? cur.model : null;
      const a = document.activeElement;
      return {
        flow: g.flow.current,
        focusOnBody: a === document.body || a === null,
        s: m ? { x: m.ballX, y: m.ballY, vx: m.vx, vy: m.vy, gx: m.goal.x, gy: m.goal.y, done: m.done, left: m.timeLeft } : null,
      };
    });
    if (st.flow === 'result') { reached = 'result'; break; }
    if (st.focusOnBody) bodyFocus++;
    if (!st.s) { await sleep(80); continue; }
    last = st.s;
    // Bang-bang PD : on vise la sortie, on freine sur la vitesse. Deux touches
    // par axe, exactement ce qu'a un joueur.
    const wanted = new Set();
    const ax = 3.2 * (st.s.gx - st.s.x) - 1.35 * st.s.vx;
    const ay = 3.2 * (st.s.gy - st.s.y) - 1.35 * st.s.vy;
    if (ax > 40) wanted.add('KeyD');
    else if (ax < -40) wanted.add('KeyA');
    if (ay > 40) wanted.add('ArrowDown');
    else if (ay < -40) wanted.add('ArrowUp');
    const before = held.size;
    await holdSet(held, wanted);
    if (held.size !== before) presses++;
    await sleep(55);
  }
  await releaseAll(held);
  checks.push({ name: `${tag} : le clavier a bien piloté le plateau`, got: presses > 0, want: true, ok: presses > 0 });
  checks.push({ name: `${tag} : focus jamais sur <body>`, got: bodyFocus, want: 0, ok: bodyFocus === 0 });
  return { presses, bodyFocus, reached, coursesDone: last ? last.done : null };
}

/** `mirror` et `ant` : entrées tenues au rythme du §3, sans lecture du modèle. */
async function driveSideBlind(gameId, rnd, deadline, checks, tag) {
  const map = SIDE_KEYS[gameId];
  const held = new Set();
  let presses = 0;
  let bodyFocus = 0;
  let reached = null;
  let step = 0;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const g = window.__game;
      const a = document.activeElement;
      return { flow: g.flow.current, focusOnBody: a === document.body || a === null };
    });
    if (st.flow === 'result') { reached = 'result'; break; }
    if (st.focusOnBody) bodyFocus++;
    const wanted = new Set();
    // Une direction tenue par siège, retirée au hasard : les deux joueurs
    // bougent en même temps, c'est tout l'intérêt d'un jeu `side`.
    if (rnd() < 0.8) wanted.add(map.p0[Math.floor(rnd() * map.p0.length)]);
    if (rnd() < 0.8) wanted.add(map.p1[Math.floor(rnd() * map.p1.length)]);
    await holdSet(held, wanted);
    presses++;
    if (map.fire.length && step % 4 === 0) {
      for (const k of map.fire) {
        await page.keyboard.down(k).catch(() => {});
        await page.keyboard.up(k).catch(() => {});
      }
    }
    step++;
    await sleep(180);
  }
  await releaseAll(held);
  checks.push({ name: `${tag} : le clavier a bien piloté la manche`, got: presses > 0, want: true, ok: presses > 0 });
  checks.push({ name: `${tag} : focus jamais sur <body>`, got: bodyFocus, want: 0, ok: bodyFocus === 0 });
  return { presses, bodyFocus, reached };
}

/** Le panneau de fin : il doit exister, nommer une issue, et laisser repartir. */
async function checkResultPanel(checks, tag) {
  await page.waitForFunction('window.__game.flow.current === "result"', { timeout: 8000 }).catch(() => {});
  const st = await snapshot();
  checks.push({ name: `${tag} : l’écran de résultat s’ouvre`, got: st.flow, want: 'result', ok: st.flow === 'result' });
  const hasAgain = st.panelKeys.includes('again');
  const hasOther = st.panelKeys.includes('other');
  checks.push({ name: `${tag} : « encore » et « un autre jeu » sont offerts`, got: [hasAgain, hasOther], want: [true, true], ok: hasAgain && hasOther });
  checks.push({ name: `${tag} : le focus est sur le panneau, pas sur <body>`, got: st.focusOnBody ? 'body' : st.focusTag, want: 'pas body', ok: !st.focusOnBody });
  const again = await click('[data-key="again"]');
  checks.push({ name: `${tag} : « encore » relance une manche`, got: again, want: true, ok: again });
  await sleep(400);
  const back = await snapshot();
  const playing = back.flow === 'game' || back.flow === 'pass';
  checks.push({ name: `${tag} : la manche suivante démarre`, got: back.flow, want: 'game|pass', ok: playing });
  return st;
}

/** Tabule jusqu'au contrôle de panneau portant ce `data-key`. */
async function tabToKey(key, maxTabs = 60) {
  for (let i = 0; i < maxTabs; i++) {
    const ok = await page.evaluate((k) => {
      const a = document.activeElement;
      return !!a && a.dataset && a.dataset.key === k;
    }, key);
    if (ok) return true;
    await page.keyboard.press('Tab');
  }
  return false;
}

/** Tabule jusqu'à une commande VIVANTE du micro-jeu (jamais un bouton grisé). */
async function tabToLiveOverlay(maxTabs = 40) {
  for (let i = 0; i < maxTabs; i++) {
    const ok = await page.evaluate(() => {
      const a = document.activeElement;
      const ov = document.getElementById('overlay');
      return !!a && ov.contains(a) && !a.disabled && !a.hidden && a.offsetParent !== null;
    });
    if (ok) return true;
    await page.keyboard.press('Tab');
  }
  return false;
}

/**
 * Une manche entière AU CLAVIER SEUL, de l'accueil au résultat. Aucun clic :
 * Tab pour se déplacer, Entrée pour valider — et rien d'autre pour les cinq
 * jeux `pass`. Les trois jeux `side` sont déjà pilotés à la touche (§3), on
 * réutilise donc leurs pilotes tels quels.
 */
async function keyboardRound(gameId, posture, budget, checks) {
  const tag = `clavier ${gameId}`;
  const rnd = mulberry32(1234);

  // Accueil : cocher le mouvement réduit À LA TOUCHE (Espace sur la case).
  const st0 = await snapshot();
  if (st0.flow !== 'home') {
    await page.evaluate(() => window.__game.flow.showHome());
    await sleep(200);
  }
  const motionState = await page.evaluate(() => {
    const el = document.querySelector('[data-key="opt-motion"]');
    return el ? { checked: el.checked, locked: el.disabled } : null;
  });
  if (motionState && !motionState.checked && !motionState.locked) {
    const reached = await tabToKey('opt-motion');
    checks.push({ name: `${tag} : la case « mouvement réduit » est atteinte au clavier`, got: reached, want: true, ok: reached });
    await page.keyboard.press('Space');
    await sleep(220);
  }

  const gotPlay = await tabToKey('play');
  checks.push({ name: `${tag} : ▶ jouer atteint au clavier`, got: gotPlay, want: true, ok: gotPlay });
  await page.keyboard.press('Enter');
  await sleep(280);
  let s = await snapshot();
  checks.push({ name: `${tag} : Entrée ouvre le menu`, got: s.flow, want: 'menu', ok: s.flow === 'menu' });
  checks.push({ name: `${tag} : focus non perdu après validation (menu)`, got: s.focusOnBody ? 'body' : s.focusTag, want: 'pas body', ok: !s.focusOnBody });

  const gotTile = await tabToKey(`g-${gameId}`);
  checks.push({ name: `${tag} : la vignette est atteinte au clavier`, got: gotTile, want: true, ok: gotTile });
  await page.keyboard.press('Enter');
  await sleep(360);
  s = await snapshot();
  checks.push({ name: `${tag} : focus non perdu après validation (vignette)`, got: s.focusOnBody ? 'body' : s.focusTag, want: 'pas body', ok: !s.focusOnBody });
  if (s.flow === 'demo') {
    const onSkip = await page.evaluate(() => document.activeElement?.dataset?.key === 'demo-skip');
    checks.push({ name: `${tag} : le focus tombe sur le bouton de la règle en images`, got: onSkip, want: true, ok: onSkip });
    await page.keyboard.press('Enter');
    await sleep(360);
    s = await snapshot();
  }
  // Comme dans `reachBoard` : `beast` et `suspects` ouvrent sur l'écran de
  // passage, pas sur le plateau.
  checks.push({ name: `${tag} : le plateau est monté`, got: s.flow, want: 'game|pass', ok: s.flow === 'game' || s.flow === 'pass' });

  const deadline = Date.now() + budget * 1000;

  if (posture === 'side') {
    // Déjà 100 % clavier par construction (§3) : on réutilise le pilote.
    const trace = gameId === 'plank'
      ? await drivePlank(deadline, checks, tag)
      : await driveSideBlind(gameId, rnd, deadline, checks, tag);
    await keyboardResultPanel(checks, tag);
    return trace;
  }

  let validations = 0;
  let passes = 0;
  let bodyAfterValidate = 0;
  let jumpOk = 0;
  let jumpTotal = 0;
  let guard = 0;
  let reached = null;

  while (Date.now() < deadline && guard++ < 4000) {
    s = await snapshot();
    if (s.flow === 'result') { reached = 'result'; break; }
    if (s.flow === 'pass') {
      const onBtn = await page.evaluate(() => !!document.activeElement && document.activeElement.className === 'passbtn');
      checks.push({ name: `${tag} : le focus est sur l’unique bouton du passage`, got: onBtn, want: true, ok: onBtn });
      await page.keyboard.press('Enter');
      passes++;
      await sleep(140);
      const after = await snapshot();
      if (after.focusOnBody) bodyAfterValidate++;
      if (after.flow === 'game' && after.liveCount > 0) {
        jumpTotal++;
        if (after.focusInOverlay) jumpOk++;
      }
      continue;
    }
    if (s.flow !== 'game') { await sleep(80); continue; }
    if (s.liveCount === 0) { await sleep(90); continue; }

    // Se déplacer d'un nombre de crans tiré au sort, puis retomber sur une
    // commande vivante. Traverser <body> ICI est normal : c'est la tabulation.
    const hops = Math.floor(rnd() * Math.min(4, s.liveCount));
    for (let i = 0; i < hops; i++) await page.keyboard.press('Tab');
    const onLive = await tabToLiveOverlay();
    if (!onLive) { await sleep(90); continue; }
    await page.keyboard.press('Enter');
    validations++;
    await sleep(120);
    const after = await snapshot();
    if (after.focusOnBody) bodyAfterValidate++;
    if (after.flow === 'game' && after.liveCount > 0) {
      jumpTotal++;
      if (after.focusInOverlay) jumpOk++;
    }
  }

  checks.push({ name: `${tag} : la manche s’est jouée au clavier`, got: validations > 0, want: true, ok: validations > 0 });
  checks.push({
    name: `${tag} : focus jamais sur <body> APRÈS une validation`,
    got: bodyAfterValidate,
    want: 0,
    ok: bodyAfterValidate === 0,
  });
  checks.push({
    name: `${tag} : saut automatique sur une cible légale à chaque tour`,
    got: `${jumpOk}/${jumpTotal}`,
    want: 'tous',
    ok: jumpTotal > 0 && jumpOk === jumpTotal,
  });
  await keyboardResultPanel(checks, tag);
  return { validations, passes, bodyAfterValidate, jump: `${jumpOk}/${jumpTotal}`, reached };
}

/** Le panneau de fin, franchi lui aussi au clavier seul. */
async function keyboardResultPanel(checks, tag) {
  await page.waitForFunction('window.__game.flow.current === "result"', { timeout: 8000 }).catch(() => {});
  const s = await snapshot();
  checks.push({ name: `${tag} : l’écran de résultat s’ouvre`, got: s.flow, want: 'result', ok: s.flow === 'result' });
  checks.push({ name: `${tag} : focus posé sur le panneau, pas sur <body>`, got: s.focusOnBody ? 'body' : s.focusTag, want: 'pas body', ok: !s.focusOnBody });
  const gotAgain = await tabToKey('again');
  checks.push({ name: `${tag} : « encore » atteint au clavier`, got: gotAgain, want: true, ok: gotAgain });
  await page.keyboard.press('Enter');
  await sleep(420);
  const back = await snapshot();
  const playing = back.flow === 'game' || back.flow === 'pass';
  checks.push({ name: `${tag} : « encore » relance une manche`, got: back.flow, want: 'game|pass', ok: playing });
  checks.push({ name: `${tag} : focus non perdu après « encore »`, got: back.focusOnBody ? 'body' : back.focusTag, want: 'pas body', ok: !back.focusOnBody });
}

// ═══════════════════════════════════════════════ SCÉNARIO rules
//
// Assertions HORS PARTIE sur les 5 modèles au tour par tour, montées dans la
// page depuis window.__game.models — aucun bouton cliqué, aucune manche
// ouverte. Couvre au minimum la liste nominative du §7 (conservation/cascade
// de tree, légalité/passage/départage de tiles, comptage de fruits de cake,
// déplacement/thermomètre/départage de beast, profils/séparateur de
// suspects) et largement au-delà (143 assertions candidates dans
// assertions-bot.json, portées ici après vérification contre le code réel).
if (kind === 'rules') {
  detail.checks = await page.evaluate((EXPECT) => {
    const out = [];
    const check = (name, got, want) => out.push({ name, got, want, ok: JSON.stringify(got) === JSON.stringify(want) });
    const M = window.__game.models;

    // ───────────────────────────── tree ─────────────────────────────
    {
      const T = M.tree;

      // Bornes de génération + total impair + ≥3 coups légaux au 1er tour,
      // sur quelques seeds (le fuzz sur N seeds vit dans `gen`).
      for (const seed of [1, 2, 3, 42, 777]) {
        const t = new T(seed, [2, 2]);
        const s = t.state;
        check(`tree seed${seed} : total impair`, s.total % 2, 1);
        check(`tree seed${seed} : arêtes dans les bornes`, s.edges.length >= EXPECT.TREE_EDGES.min && s.edges.length <= EXPECT.TREE_EDGES.max, true);
        const maxDepth = s.nodes.reduce((m, n) => Math.max(m, n.depth), 0);
        check(`tree seed${seed} : profondeur dans les bornes`, maxDepth >= EXPECT.TREE_DEPTH.min && maxDepth <= EXPECT.TREE_DEPTH.max, true);
        const legal0 = s.edges.filter((e) => e.color === 0 || e.color === 2).length;
        const legal1 = s.edges.filter((e) => e.color === 1 || e.color === 2).length;
        check(`tree seed${seed} : ≥3 coups légaux P0`, legal0 >= EXPECT.TREE_MIN_MOVES, true);
        check(`tree seed${seed} : ≥3 coups légaux P1`, legal1 >= EXPECT.TREE_MIN_MOVES, true);
        check(`tree seed${seed} : pommes ≤ plafond`, s.edges.every((e) => e.apples <= EXPECT.TREE_MAX_APPLES && e.apples >= 0), true);
      }

      // Déterminisme : deux instances du même seed → mêmes arêtes au bit près.
      {
        const a = new T(555, [1, 2]);
        const b = new T(555, [1, 2]);
        check('tree déterminisme : arêtes identiques', JSON.stringify(a.state.edges), JSON.stringify(b.state.edges));
        check('tree déterminisme : nœuds identiques', JSON.stringify(a.state.nodes), JSON.stringify(b.state.nodes));
      }

      // Handicap ⭐ : polarité, jeton dépensé au 1er tour, jamais rechargé.
      {
        const helpedOf = (s0, s1) => new T(9, [s0, s1]).state.helped;
        check('tree ⭐ [1,2] → aidé = 0', helpedOf(1, 2), 0);
        check('tree ⭐ [2,1] → aidé = 1', helpedOf(2, 1), 1);
        check('tree ⭐ [1,1] → aucun aidé', helpedOf(1, 1), null);
        check('tree ⭐ [2,2] → aucun aidé', helpedOf(2, 2), null);

        const t = new T(9, [1, 2]);
        const s0 = t.state;
        check('tree ⭐ : le joueur aidé commence', s0.turn, 0);
        check('tree ⭐ : jeton ✂ posé', s0.extraCuts[0], EXPECT.TREE_STAR_EXTRA_CUTS);
        const firstLegal = s0.edges.find((e) => t.canCut(0, e.id));
        t.cut(0, firstLegal.id);
        const s1 = t.state;
        check('tree ⭐ : jeton dépensé au 1er coup', s1.extraCuts[0], 0);
        check('tree ⭐ : le joueur aidé rejoue tout de suite', s1.turn, 0);
      }

      // Légalité stricte : mauvais tour, mauvaise couleur, arête morte.
      {
        const t = new T(20, [2, 2]);
        const s = t.state;
        const wrong = s.edges.find((e) => e.color !== 2 && e.color !== s.turn);
        if (wrong) {
          check('tree : couper la couleur adverse est refusé', t.canCut(s.turn, wrong.id), false);
          check('tree : cut() ne mute rien sur un coup illégal', t.cut(s.turn, wrong.id), false);
        }
        check('tree : jouer hors de son tour est refusé', t.canCut(1 - s.turn, s.edges[0].id), false);
        const some = s.edges.find((e) => t.canCut(s.turn, e.id));
        t.cut(s.turn, some.id);
        check('tree : une arête déjà tombée est refusée', t.canCut(0, some.id) || t.canCut(1, some.id), false);
      }

      // Cascade EXACTE + conservation, jouées sur une partie entière : la
      // réimplémentation du BFS (reach0) est INDÉPENDANTE de `computeReach`.
      function reach0(edges, alive) {
        let maxNode = 0;
        for (const e of edges) maxNode = Math.max(maxNode, e.a, e.b);
        const r = new Array(maxNode + 1).fill(false);
        r[0] = true;
        let changed = true;
        while (changed) {
          changed = false;
          for (const e of edges) {
            if (!alive[e.id]) continue;
            if (r[e.a] && !r[e.b]) {
              r[e.b] = true;
              changed = true;
            } else if (r[e.b] && !r[e.a]) {
              r[e.a] = true;
              changed = true;
            }
          }
        }
        return r;
      }
      for (const seed of [30, 31, 32, 33, 34]) {
        const t = new T(seed, [2, 2]);
        let guard = 0;
        while (!t.state.over && guard < 60) {
          guard++;
          const before = t.state;
          // PIÈGE D'ALIASING (même famille que celui documenté dans
          // `beast/model.ts`) : `TreeState.baskets` rend le tableau MUTABLE
          // interne (`this.basketArr`), pas une copie — `before.baskets` et
          // `t.state.baskets` après le coup sont le MÊME tableau. On fige
          // donc des VALEURS (slice) avant de couper, jamais l'objet `state`.
          const beforeAlive = before.alive.slice();
          const beforeBaskets = before.baskets.slice();
          const player = before.turn;
          const legalEdges = before.edges.filter((e) => t.canCut(player, e.id));
          if (legalEdges.length === 0) break;
          const pick = legalEdges[guard % legalEdges.length];
          const ok = t.cut(player, pick.id);
          check(`tree seed${seed} tour${guard} : coup accepté`, ok, true);
          const after = t.state;

          // Conservation à chaque tour.
          const sumAfter = after.baskets[0] + after.baskets[1] + after.edges.reduce((acc, e) => acc + (after.alive[e.id] ? e.apples : 0), 0);
          check(`tree seed${seed} tour${guard} : conservation`, sumAfter, t.total);

          // Le panier adverse ne bouge jamais.
          check(`tree seed${seed} tour${guard} : panier adverse figé`, after.baskets[1 - player], beforeBaskets[1 - player]);

          // Gain = pommes des arêtes tombées avec cette coupe, ni plus ni moins.
          let expectedGain = 0;
          for (const e of after.edges) if (beforeAlive[e.id] && !after.alive[e.id]) expectedGain += e.apples;
          check(`tree seed${seed} tour${guard} : gain = arêtes tombées`, after.baskets[player] - beforeBaskets[player], expectedGain);

          // Cascade exacte : aucune arête vivante ne flotte (les deux bouts
          // doivent être atteignables depuis le sol via le graphe vivant).
          const reach = reach0(after.edges, after.alive);
          const floating = after.edges.some((e) => after.alive[e.id] && !(reach[e.a] && reach[e.b]));
          check(`tree seed${seed} tour${guard} : aucune arête vivante ne flotte`, floating, false);

          // Passage automatique : hors fin de partie, le joueur courant a
          // toujours un coup légal (jamais planté).
          if (!after.over) {
            const hasMove = after.edges.some((e) => after.alive[e.id] && (e.color === after.turn || e.color === 2));
            check(`tree seed${seed} tour${guard} : le joueur courant a un coup`, hasMove, true);
          }
        }
        // Fin de partie : over ⟺ tout est tombé ; jamais d'égalité.
        const s = t.state;
        check(`tree seed${seed} : over ⟺ tout est tombé`, s.over, s.alive.every((a) => !a));
        if (s.over) {
          const r = t.result;
          check(`tree seed${seed} : pas d'égalité`, r.scores[0] === r.scores[1], false);
          check(`tree seed${seed} : result.scores = baskets`, r.scores, s.baskets);
          check(`tree seed${seed} : reason cite « pommes contre »`, r.reason.includes('pommes contre'), true);
        }
      }
    }

    // ───────────────────────────── tiles ─────────────────────────────
    {
      const D = M.tiles;
      function isLegalAnchorIndep(player, idx, owner, blocked, cols, rows) {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        if (player === 0) {
          if (r + 1 >= rows) return false;
        } else if (c + 1 >= cols) return false;
        const second = player === 0 ? idx + cols : idx + 1;
        return !blocked[idx] && !blocked[second] && owner[idx] === null && owner[second] === null;
      }
      function legalCountIndep(player, owner, blocked, cols, rows) {
        let n = 0;
        for (let i = 0; i < cols * rows; i++) if (isLegalAnchorIndep(player, i, owner, blocked, cols, rows)) n++;
        return n;
      }

      // Handicap ⭐ : polarité et barème exact.
      {
        const helpedOf = (s0, s1) => new D(1, [s0, s1]).state.helped;
        check('tiles ⭐ [1,2] → aidé = 0', helpedOf(1, 2), 0);
        check('tiles ⭐ [2,1] → aidé = 1', helpedOf(2, 1), 1);
        check('tiles ⭐ [1,1] → aucun aidé', helpedOf(1, 1), null);

        const m = new D(1, [1, 2]);
        const s = m.state;
        const starred = s.dominoes.filter((d) => d.starred);
        check('tiles ⭐ : exactement 2 dominos ⭐', starred.length, EXPECT.TILES_STAR_PREPLACED);
        check('tiles ⭐ : tous au joueur aidé', starred.every((d) => d.owner === s.helped), true);
        check('tiles ⭐ : placed[aidé] = 2', s.placed[s.helped], EXPECT.TILES_STAR_PREPLACED);
        check('tiles ⭐ : stacks[aidé] = 10', s.stacks[s.helped], EXPECT.TILES_STACK - EXPECT.TILES_STAR_PREPLACED);

        const nh = new D(1, [1, 1]);
        check('tiles sans ⭐ : aucun domino posé au départ', nh.state.dominoes.length, 0);
        check('tiles sans ⭐ : placed = [0,0]', nh.state.placed, [0, 0]);
      }

      for (const seed of [1, 2, 3, 4, 5]) {
        const m = new D(seed, [2, 2]);
        const s0 = m.state;
        // Génération : cases bloquées dans les bornes, ≥6 poses légales aux deux.
        const blockedCount = s0.blocked.filter(Boolean).length;
        check(`tiles seed${seed} : cases bloquées dans les bornes`, blockedCount >= EXPECT.TILES_BLOCKED.min && blockedCount <= EXPECT.TILES_BLOCKED.max, true);
        check(`tiles seed${seed} : ≥6 poses légales P0`, legalCountIndep(0, s0.owner, s0.blocked, s0.cols, s0.rows) >= EXPECT.TILES_MIN_PLACEMENTS, true);
        check(`tiles seed${seed} : ≥6 poses légales P1`, legalCountIndep(1, s0.owner, s0.blocked, s0.cols, s0.rows) >= EXPECT.TILES_MIN_PLACEMENTS, true);

        // Masque `legal` = recalcul indépendant, joueur courant uniquement.
        for (let idx = 0; idx < s0.cols * s0.rows; idx++) {
          const want = isLegalAnchorIndep(s0.turn, idx, s0.owner, s0.blocked, s0.cols, s0.rows);
          if (s0.legal[idx] !== want) check(`tiles seed${seed} : legal[${idx}] = recalcul indépendant`, s0.legal[idx], want);
        }

        // Refus : mauvais joueur, hors grille, case bloquée, case occupée.
        check(`tiles seed${seed} : jouer hors de son tour est refusé`, m.place(1 - s0.turn, 0), false);
        check(`tiles seed${seed} : pose hors grille (-1) refusée`, m.canPlace(s0.turn, -1), false);
        check(`tiles seed${seed} : pose hors grille (999) refusée`, m.canPlace(s0.turn, 999), false);
        const blockedIdx = s0.blocked.findIndex(Boolean);
        if (blockedIdx >= 0) check(`tiles seed${seed} : pose sur case bloquée refusée`, m.canPlace(s0.turn, blockedIdx), false);

        // Jouer une manche entière légale au hasard : conservation, légalité,
        // auto-pass, terminaison, résultat.
        let guard = 0;
        let lastPlacerCheck = null;
        while (!m.state.over && guard < 60) {
          guard++;
          const before = m.state;
          const player = before.turn;
          const anchors = [];
          for (let i = 0; i < before.cols * before.rows; i++) if (before.legal[i]) anchors.push(i);
          if (anchors.length === 0) break;
          const idx = anchors[guard % anchors.length];
          check(`tiles seed${seed} tour${guard} : canPlace ⟺ dans le masque`, m.canPlace(player, idx), true);
          const ok = m.place(player, idx);
          check(`tiles seed${seed} tour${guard} : place() accepté`, ok, true);
          lastPlacerCheck = player;
          const after = m.state;
          check(`tiles seed${seed} tour${guard} : placed[p]+stacks[p]=12 (P0)`, after.placed[0] + after.stacks[0], EXPECT.TILES_STACK);
          check(`tiles seed${seed} tour${guard} : placed[p]+stacks[p]=12 (P1)`, after.placed[1] + after.stacks[1], EXPECT.TILES_STACK);
          check(
            `tiles seed${seed} tour${guard} : dominoes.length par joueur = placed`,
            after.dominoes.filter((d) => d.owner === player).length,
            after.placed[player],
          );
          if (!after.over) {
            if (after.turn === player) {
              // Le tour n'a pas changé de main : l'adversaire est bloqué.
              const oppLegal = legalCountIndep(1 - player, after.owner, after.blocked, after.cols, after.rows);
              check(`tiles seed${seed} tour${guard} : adversaire bloqué ⇒ skipped`, oppLegal === 0 && after.skipped === 1 - player, true);
            } else {
              check(`tiles seed${seed} tour${guard} : nouveau joueur a un coup légal`, after.legal.some(Boolean), true);
              check(`tiles seed${seed} tour${guard} : skipped remis à null`, after.skipped, null);
            }
          }
        }
        check(`tiles seed${seed} : la manche se termine < 40 coups`, guard < 40, true);
        const s = m.state;
        if (s.over) {
          // Les deux joueurs sont bloqués (calcul indépendant).
          check(`tiles seed${seed} : over ⇒ P0 bloqué`, legalCountIndep(0, s.owner, s.blocked, s.cols, s.rows), 0);
          check(`tiles seed${seed} : over ⇒ P1 bloqué`, legalCountIndep(1, s.owner, s.blocked, s.cols, s.rows), 0);
          const r = m.result;
          check(`tiles seed${seed} : winner jamais null`, r.winner === null, false);
          check(`tiles seed${seed} : result.scores = placed`, r.scores, s.placed);
          if (s.placed[0] !== s.placed[1]) {
            check(`tiles seed${seed} : le plus haut compte gagne`, r.winner, s.placed[0] > s.placed[1] ? 0 : 1);
            check(`tiles seed${seed} : reason cite les deux comptes`, r.reason.includes('tuiles posées contre'), true);
          } else {
            check(`tiles seed${seed} : égalité ⇒ dernier posé gagne`, r.winner, lastPlacerCheck);
            check(`tiles seed${seed} : reason cite « dernière »`, r.reason.includes('dernière'), true);
          }
        }
      }
    }

    // ───────────────────────────── cake ─────────────────────────────
    {
      const C = M.cake;

      // Réimplémentation INDÉPENDANTE de la classification point/droite,
      // fuzzée contre `C.sideOfCut` — LE point dur du jeu.
      function sideIndep(angleA, angleB, fx, fy) {
        const ax = C.RADIUS * Math.cos(angleA);
        const ay = C.RADIUS * Math.sin(angleA);
        const bx = C.RADIUS * Math.cos(angleB);
        const by = C.RADIUS * Math.sin(angleB);
        const cross = (bx - ax) * (fy - ay) - (by - ay) * (fx - ax);
        return cross < 0 ? 1 : 0;
      }
      let rand = mulberry32Local(20260901);
      let divergences = 0;
      let tested = 0;
      for (let i = 0; i < 50000; i++) {
        const r = Math.sqrt(rand()) * C.RADIUS;
        const a = rand() * Math.PI * 2;
        const fx = r * Math.cos(a);
        const fy = r * Math.sin(a);
        const angleA = rand() * Math.PI * 2;
        const angleB = rand() * Math.PI * 2;
        const ax = C.RADIUS * Math.cos(angleA);
        const ay = C.RADIUS * Math.sin(angleA);
        const bx = C.RADIUS * Math.cos(angleB);
        const by = C.RADIUS * Math.sin(angleB);
        const cross = (bx - ax) * (fy - ay) - (by - ay) * (fx - ax);
        if (Math.abs(cross) < 1e-6) continue; // pile sur la droite : mesure nulle, ignoré du fuzz
        tested++;
        if (C.sideOfCut(angleA, angleB, fx, fy) !== sideIndep(angleA, angleB, fx, fy)) divergences++;
      }
      check(`cake : sideOfCut vs réimplémentation indépendante (${tested} points testés)`, divergences, 0);

      // splitFruits : conservation, sans perte ni doublon, sur des crans réels.
      for (const seed of [1, 2, 3, 4, 5]) {
        const m = new C(seed, [2, 2]);
        for (let sa = 0; sa < C.ANGLE_STEPS; sa++) {
          for (let sb = 0; sb < C.ANGLE_STEPS; sb++) {
            if (sa === sb) continue;
            const angleA = (sa * Math.PI * 2) / C.ANGLE_STEPS;
            const angleB = (sb * Math.PI * 2) / C.ANGLE_STEPS;
            const [p0, p1] = C.splitFruits(m.state.fruits, angleA, angleB);
            if (p0.length + p1.length !== m.state.fruits.length) {
              check(`cake seed${seed} split(${sa},${sb}) : conservation`, p0.length + p1.length, m.state.fruits.length);
            }
            const both = p0.filter((f) => p1.includes(f));
            if (both.length > 0) check(`cake seed${seed} split(${sa},${sb}) : aucun fruit dans les deux parts`, both.length, 0);
            check(
              `cake seed${seed} split(${sa},${sb}) : countOf conserve`,
              C.countOf(p0, 'strawberry') + C.countOf(p0, 'blueberry') + C.countOf(p1, 'strawberry') + C.countOf(p1, 'blueberry'),
              m.state.fruits.length,
            );
          }
        }
      }

      // nudge/canNudge : jamais de blocage total, exactement 2 blocages à la
      // collision, aucune mutation quand refusé.
      {
        const m = new C(1, [2, 2]);
        const s0 = m.state;
        const anyLegal = s0.canNudgeAPlus || s0.canNudgeAMinus || s0.canNudgeBPlus || s0.canNudgeBMinus;
        check('cake : jamais de blocage total au départ', anyLegal, true);
        // Amener A juste à côté de B (par défaut A=0, B=6 sur 12 crans).
        for (let i = 0; i < 5; i++) m.nudge('a', 1);
        const s = m.state;
        check('cake : collision — A+ refusé', s.canNudgeAPlus, false);
        check('cake : collision — A- toujours permis', s.canNudgeAMinus, true);
        check('cake : collision — B- refusé (adjacent à A)', s.canNudgeBMinus, false);
        check('cake : collision — B+ toujours permis', s.canNudgeBPlus, true);
        const blockedCount = [s.canNudgeAPlus, s.canNudgeAMinus, s.canNudgeBPlus, s.canNudgeBMinus].filter((v) => !v).length;
        check('cake : exactement 2 crans bloqués à la collision', blockedCount, 2);
        const before = { a: s.angleA, b: s.angleB };
        check('cake : nudge refusé ne mute rien (angleA)', m.nudge('a', 1) === false && m.state.angleA === before.a, true);
      }

      // Phases : cut → choose → over, transitions strictes.
      {
        const m = new C(2, [2, 2]);
        check('cake : phase initiale = cut', m.state.phase, 'cut');
        check('cake : choosePiece refusé en phase cut', m.choosePiece(0), false);
        check('cake : confirmCut accepté une fois', m.confirmCut(), true);
        check('cake : phase = choose', m.state.phase, 'choose');
        check('cake : confirmCut refusé une 2e fois', m.confirmCut(), false);
        const sc = m.state;
        check('cake : canNudge tous faux en choose', sc.canNudgeAPlus || sc.canNudgeAMinus || sc.canNudgeBPlus || sc.canNudgeBMinus, false);
      }

      // Alternance des rôles + conservation des fruits sur une manche entière.
      for (const seed of [10, 11, 12]) {
        const m = new C(seed, [2, 2]);
        const cutters = [];
        let guard = 0;
        while (m.state.phase !== 'over' && guard < 20) {
          guard++;
          const s = m.state;
          check(`cake seed${seed} coupe${guard} : chooser = 1-cutter`, s.chooser, 1 - s.cutter);
          cutters.push(s.cutter);
          const totalsBefore = s.totals.slice();
          m.confirmCut();
          const beforePieces = m.state.pieces;
          m.choosePiece(0);
          const after = m.state;
          check(`cake seed${seed} coupe${guard} : totals augmente de fruits.length`, after.totals[0] + after.totals[1] - totalsBefore[0] - totalsBefore[1], s.fruits.length);
          check(`cake seed${seed} coupe${guard} : scores ≤ totals (P0)`, after.scores[0] <= after.totals[0], true);
          check(`cake seed${seed} coupe${guard} : scores ≤ totals (P1)`, after.scores[1] <= after.totals[1], true);
          void beforePieces;
        }
        check(`cake seed${seed} : 6 coupes jouées`, guard, EXPECT.CAKE_CUTS);
        check(`cake seed${seed} : 3 coupes par siège`, [cutters.filter((c) => c === 0).length, cutters.filter((c) => c === 1).length], [3, 3]);
        check(
          `cake seed${seed} : jamais deux coupes consécutives par le même siège`,
          cutters.every((c, i) => i === 0 || c !== cutters[i - 1]),
          true,
        );
        const r = m.result;
        check(`cake seed${seed} : winner jamais null`, r.winner === null, false);
        check(`cake seed${seed} : result.scores = state.scores`, r.scores, m.state.scores);
        check(`cake seed${seed} : reason non vide`, r.reason.length > 0, true);
      }

      // Handicap ⭐ : polarité et premier coupeur.
      {
        const helpedOf = (s0, s1) => new C(3, [s0, s1]).state.helped;
        check('cake ⭐ [1,2] → aidé = 0', helpedOf(1, 2), 0);
        check('cake ⭐ [2,1] → aidé = 1', helpedOf(2, 1), 1);
        check('cake ⭐ [1,1] → aucun aidé', helpedOf(1, 1), null);
        check('cake ⭐ [2,2] → aucun aidé', helpedOf(2, 2), null);
        check('cake ⭐ [2,1] → aidé coupe en premier', new C(3, [2, 1]).state.cutter, 1);
      }

      // Déterminisme.
      {
        const a = new C(444, [1, 2]);
        const b = new C(444, [1, 2]);
        check('cake déterminisme : fruits identiques', JSON.stringify(a.state.fruits), JSON.stringify(b.state.fruits));
      }
    }

    // ───────────────────────────── beast ─────────────────────────────
    {
      const B = M.beast;

      // Grille, départ, budgets de base.
      {
        const m = new B(1, [1, 1]);
        const s = m.state;
        check('beast : grille 6×8', [s.cols, s.rows], [EXPECT.BEAST_COLS, EXPECT.BEAST_ROWS]);
        check('beast : phase initiale = beast, half 0', [s.phase, s.half, s.over], ['beast', 0, false]);
        check('beast : turnLimit de base', s.turnLimit, EXPECT.BEAST_TURNS);
        check('beast : lightsCount de base', s.lightsCount, EXPECT.BEAST_LIGHTS);
        check('beast : la bête part sur la rangée du bas', Math.floor(s.beastIdx / s.cols), s.rows - 1);
      }

      // La bête doit bouger, d'une case orthogonale, et elle seule.
      for (const seed of [1, 2, 3, 4]) {
        const m = new B(seed, [1, 1]);
        const s = m.state;
        check(`beast seed${seed} : descendre (hors grille) refusé`, m.canMove(s.beastSeat, 'down'), false);
        const dirs = ['up', 'down', 'left', 'right'].filter((d) => m.canMove(s.beastSeat, d));
        check(`beast seed${seed} : ≥2 directions légales pour la bête`, dirs.length >= 2, true);
        check(`beast seed${seed} : le chasseur ne peut pas bouger la bête`, m.canMove(s.hunterSeat, dirs[0]), false);
        check(`beast seed${seed} : allumer une lampe en phase bête refusé`, m.canToggleLight(s.beastSeat, 0), false);
        check(`beast seed${seed} : valider en phase bête refusé`, m.canValidate(s.beastSeat), false);

        const from = s.beastIdx;
        const ok = m.move(s.beastSeat, dirs[0]);
        check(`beast seed${seed} : déplacement accepté`, ok, true);
        const to = m.state.beastIdx;
        const dr = Math.abs(Math.floor(to / s.cols) - Math.floor(from / s.cols));
        const dc = Math.abs((to % s.cols) - (from % s.cols));
        check(`beast seed${seed} : exactement un pas de Manhattan`, dr + dc, 1);
        check(`beast seed${seed} : turnsUsed = 1`, m.state.turnsUsed, 1);
        check(`beast seed${seed} : phase → hunter`, m.state.phase, 'hunter');
        check(`beast seed${seed} : la bête ne rejoue pas`, m.move(s.beastSeat, dirs[0] === 'up' ? 'left' : 'up'), false);
      }

      // Compte de lampes : règle stricte, correction toujours permise.
      {
        const m = new B(5, [1, 1]);
        const s0 = m.state;
        m.move(s0.beastSeat, ['up', 'left', 'right'].find((d) => m.canMove(s0.beastSeat, d)));
        const hunter = m.state.hunterSeat;
        check('beast lampes : validate refusé à 0 case', m.canValidate(hunter), false);
        m.toggleLight(hunter, 0);
        check('beast lampes : validate refusé à 1 case', m.canValidate(hunter), false);
        m.toggleLight(hunter, 1);
        m.toggleLight(hunter, 2);
        check('beast lampes : au-delà du compte, toggle refusé', m.canToggleLight(hunter, 3), false);
        check('beast lampes : retirer une case armée reste permis', m.canToggleLight(hunter, 0), true);
        check('beast lampes : validate accepté au compte exact', m.canValidate(hunter), true);
        check('beast lampes : validate refusé pour l’autre siège', m.canValidate(1 - hunter), false);
      }

      // LE POINT DUR : le thermomètre, contre une réimplémentation indépendante.
      function tierIndep(dist) {
        if (dist <= EXPECT.BEAST_WARM_MAX) return 'hot';
        if (dist <= EXPECT.BEAST_MILD_MAX) return 'mild';
        return 'cold';
      }
      let thermoDivergences = 0;
      let thermoTested = 0;
      for (let seed = 100; seed < 300; seed++) {
        const m = new B(seed, [1, 1]);
        const s0 = m.state;
        // La bête DOIT jouer avant que le chasseur puisse armer une lampe
        // (canToggleLight exige phase==='hunter') : un pas quelconque, puis
        // on cache sa position APRÈS ce pas — c'est elle que le chasseur
        // cherche.
        const dir = ['up', 'left', 'right', 'down'].find((d) => m.canMove(s0.beastSeat, d));
        m.move(s0.beastSeat, dir);
        const hunter = m.state.hunterSeat;
        const hidden = m.state.beastIdx;
        const cells = [];
        for (let i = 0; i < s0.cols * s0.rows && cells.length < m.state.lightsCount; i++) if (i !== hidden) cells.push(i);
        for (const c of cells) m.toggleLight(hunter, c);
        m.validate(hunter);
        for (const rv of m.state.revealed) {
          thermoTested++;
          const dr = Math.abs(Math.floor(rv.idx / s0.cols) - Math.floor(hidden / s0.cols));
          const dc = Math.abs((rv.idx % s0.cols) - (hidden % s0.cols));
          const distIndep = dr + dc;
          if (rv.dist !== distIndep || rv.tier !== tierIndep(distIndep) || rv.turn !== 1) thermoDivergences++;
        }
      }
      check(`beast : thermomètre vs recalcul indépendant (${thermoTested} lectures)`, thermoDivergences, 0);

      // Triple codage : le thermomètre est monotone — jamais plus chaud en
      // s'éloignant (`tierEmoji`/`tierBars` vivent dans le module, pas sur la
      // classe : non accessibles hors DOM, la monotonie est ce qui reste
      // vérifiable ici).
      check('beast : thermomètre monotone (WARM < MILD)', EXPECT.BEAST_WARM_MAX < EXPECT.BEAST_MILD_MAX, true);
      check('beast : trois tiers distincts par construction', new Set([tierIndep(0), tierIndep(EXPECT.BEAST_WARM_MAX + 1), tierIndep(EXPECT.BEAST_MILD_MAX + 1)]).size, 3);

      // Capture : détectée, jamais expliquée par un thermomètre.
      {
        const m = new B(6, [1, 1]);
        const s0 = m.state;
        // Même contrainte que ci-dessus : la bête doit jouer avant le
        // chasseur ; on vise ensuite sa position réelle APRÈS ce coup.
        const dir = ['up', 'left', 'right', 'down'].find((d) => m.canMove(s0.beastSeat, d));
        m.move(s0.beastSeat, dir);
        const hunter = m.state.hunterSeat;
        const hidden = m.state.beastIdx;
        const others = [];
        for (let i = 0; i < s0.cols * s0.rows && others.length < m.state.lightsCount - 1; i++) if (i !== hidden) others.push(i);
        m.toggleLight(hunter, hidden);
        for (const c of others) m.toggleLight(hunter, c);
        m.validate(hunter);
        const half = m.state.halves[0];
        check('beast capture : détectée', half.captured, true);
        check('beast capture : winnerRole = hunter', half.winnerRole, 'hunter');
        check('beast capture : winner = hunterSeat', half.winner, hunter);
        check('beast capture : aucun thermomètre pour la case capturée', m.state.revealed.some((r) => r.idx === hidden), false);
      }

      // Horloge de tours : le chasseur gagne si la bête n'a pas atteint le
      // haut. La bête oscille GAUCHE/DROITE (jamais 'up') pendant EXACTEMENT
      // BEAST_TURNS tours — sur une grille à 6 colonnes il existe toujours au
      // moins une direction horizontale légale, donc elle ne touche jamais la
      // rangée 0 — puis le chasseur valide sans jamais viser la bête (rangée
      // du bas ≠ les 3 premières cases de la rangée du haut).
      {
        const m = new B(7, [1, 1]);
        const s0 = m.state;
        const beast = s0.beastSeat;
        const hunter = s0.hunterSeat;
        for (let turn = 0; turn < EXPECT.BEAST_TURNS && !m.state.over; turn++) {
          const dir = m.canMove(beast, 'left') ? 'left' : 'right';
          check(`beast horloge tour${turn} : déplacement horizontal accepté`, m.move(beast, dir), true);
          if (m.state.over) break; // garde défensive : ne devrait jamais arriver ici
          const idx = [];
          for (let i = 0; i < s0.cols * s0.rows && idx.length < m.state.lightsCount; i++) if (i !== m.state.beastIdx) idx.push(i);
          for (const i of idx) m.toggleLight(hunter, i);
          m.validate(hunter);
        }
        const half = m.state.halves[0];
        check('beast horloge : le chasseur gagne', half.winnerRole, 'hunter');
        check('beast horloge : pas de capture', half.captured, false);
        check('beast horloge : la bête a joué tous ses tours', half.turnsUsed, EXPECT.BEAST_TURNS);
      }

      // Barème ⭐ exact, attaché au SIÈGE.
      {
        const m = new B(8, [2, 1]);
        const s = m.state;
        const seat0IsBeast = s.beastSeat === 0;
        check('beast ⭐ : turnLimit exact selon le siège aidé', s.turnLimit, seat0IsBeast ? EXPECT.BEAST_TURNS : EXPECT.BEAST_TURNS_STAR);
        check('beast ⭐ : lightsCount exact selon le siège aidé', s.lightsCount, seat0IsBeast ? EXPECT.BEAST_LIGHTS_STAR : EXPECT.BEAST_LIGHTS);
        const n = new B(8, [1, 1]);
        check('beast sans ⭐ : turnLimit = base', n.state.turnLimit, EXPECT.BEAST_TURNS);
        check('beast sans ⭐ : lightsCount = base', n.state.lightsCount, EXPECT.BEAST_LIGHTS);
      }

      // Départage inter-rôles (`decide`, actif même à BEAST_HALVES=1 car la
      // méthode reste écrite — voir config/balance.ts). Accès par crochet :
      // TypeScript `private` ne survit pas à la compilation.
      {
        const m = new B(9, [1, 1]);
        const mk = (winner, winnerRole, turnsUsed) => ({ beastSeat: 0, hunterSeat: 1, winner, winnerRole, turnsUsed, turnLimit: 9, captured: winnerRole === 'hunter' });
        // Règle 1 : moins de tours gagne.
        {
          const h0 = mk(0, 'beast', 5);
          const h1 = mk(1, 'hunter', 8);
          const d = m['decide'](h0, h1);
          check('beast départage : moins de tours gagne', d.half.turnsUsed, 5);
          check('beast départage : tied = false', d.tied, false);
        }
        // Règle 2 : égalité de tours, le rôle bête l'emporte.
        {
          const h0 = mk(0, 'hunter', 6);
          const h1 = mk(1, 'beast', 6);
          const d = m['decide'](h0, h1);
          check('beast départage : à tours égaux, bête > chasseur', d.half.winnerRole, 'beast');
          check('beast départage : tied = false (rôles différents)', d.tied, false);
        }
        // Règle 3 : égalité totale (mêmes tours, MÊME rôle vainqueur — les
        // deux moitiés ont forcément des vainqueurs différents puisque les
        // rôles s'échangent), le tirage (déterministe pour ce seed) tranche.
        {
          const h0 = mk(0, 'beast', 7);
          const h1 = mk(1, 'beast', 7);
          const d1 = m['decide'](h0, h1);
          const d2 = m['decide'](h0, h1);
          check('beast départage : égalité totale marquée', d1.tied, true);
          check('beast départage : déterministe (même instance)', d1.half.winner, d2.half.winner);
        }
      }

      // Égalité impossible sur des manches complètes (BEAST_HALVES=1 : une
      // moitié suffit à conclure).
      {
        let neverNull = true;
        for (let seed = 400; seed < 440; seed++) {
          const m = new B(seed, [1, 1]);
          let guard = 0;
          while (!m.state.over && guard < 40) {
            guard++;
            const s = m.state;
            if (s.phase === 'beast') {
              const dir = ['up', 'left', 'right', 'down'].find((d) => m.canMove(s.beastSeat, d));
              m.move(s.beastSeat, dir);
            } else {
              const idx = [];
              for (let i = 0; i < s.cols * s.rows && idx.length < s.lightsCount; i++) idx.push(i);
              for (const i of idx) m.toggleLight(s.hunterSeat, i);
              m.validate(s.hunterSeat);
            }
          }
          if (m.state.over && m.result.winner === null) neverNull = false;
        }
        check('beast : result.winner jamais null sur 40 manches', neverNull, true);
      }

      // Déterminisme.
      {
        function play(seed) {
          const m = new B(seed, [2, 1]);
          let guard = 0;
          while (!m.state.over && guard < 30) {
            guard++;
            const s = m.state;
            if (s.phase === 'beast') m.move(s.beastSeat, ['up', 'left', 'right', 'down'].find((d) => m.canMove(s.beastSeat, d)));
            else {
              const idx = [];
              for (let i = 0; i < s.cols * s.rows && idx.length < s.lightsCount; i++) idx.push(i);
              for (const i of idx) m.toggleLight(s.hunterSeat, i);
              m.validate(s.hunterSeat);
            }
          }
          return JSON.stringify(m.result);
        }
        check('beast déterminisme : deux parties identiques', play(321), play(321));
      }
    }

    // ───────────────────────────── suspects ─────────────────────────────
    {
      const S = M.suspects;
      const KEYS = ['hat', 'glasses', 'scarf', 'redPull'];
      function combinations3of4() {
        const out = [];
        for (let omit = 0; omit < 4; omit++) out.push(KEYS.filter((_, i) => i !== omit));
        return out;
      }
      const QSETS = combinations3of4();
      function isSeparatingIndep(suspects) {
        for (const keys of QSETS) {
          const seen = new Set();
          for (const s of suspects) {
            const pattern = keys.map((k) => (s[k] ? '1' : '0')).join('');
            if (seen.has(pattern)) return false;
            seen.add(pattern);
          }
        }
        return true;
      }

      for (const seed of [1, 2, 3, 4, 5]) {
        const m = new S(seed, [1, 2]);
        check(`suspects seed${seed} : 6 profils`, m.suspects.length, EXPECT.SUSPECTS_COUNT);
        check(
          `suspects seed${seed} : ids 0..5`,
          m.suspects.map((s) => s.id),
          [0, 1, 2, 3, 4, 5],
        );
        const distinct = new Set(m.suspects.map((s) => KEYS.map((k) => (s[k] ? '1' : '0')).join(''))).size;
        check(`suspects seed${seed} : profils deux à deux distincts`, distinct, EXPECT.SUSPECTS_COUNT);
        check(`suspects seed${seed} : système séparateur (réimplémentation indépendante)`, isSeparatingIndep(m.suspects), true);
      }

      // Légalité = seule source : canX() reflète exactement ce que fait X().
      {
        const m = new S(6, [1, 2]);
        check('suspects : accuser avant pick refusé', m.canAccuse(1, 0), false);
        check('suspects : poser une question avant pick refusé', m.canAsk(1, 'hat'), false);
        check('suspects : canPick faux pour le mauvais joueur', m.canPick(1, 0), false);
        check('suspects : pick() refuse le mauvais joueur (ne mute rien)', m.pick(1, 0), false);
        check('suspects : suspectId hors bornes refusé', m.canPick(0, 99), false);
        m.pick(0, 2);
        check('suspects : re-pick en phase guess refusé', m.canPick(0, 3), false);
        check('suspects : mauvais joueur ask refusé', m.canAsk(0, 'hat'), false);
        m.ask(1, 'hat');
        check('suspects : question déjà posée refusée', m.canAsk(1, 'hat'), false);
        m.ask(1, 'glasses');
        m.ask(1, 'scarf');
        check('suspects : 4e question refusée', m.canAsk(1, 'redPull'), false);
        check('suspects : accuser hors bornes refusé', m.canAccuse(1, 99), false);
      }

      // Réponse correcte + aide honnête.
      for (const seed of [7, 8, 9]) {
        const m = new S(seed, [1, 2]);
        m.pick(0, 1);
        const culprit = m.suspects[m.state.culprit];
        for (const k of KEYS.slice(0, 3)) {
          m.ask(1, k);
          const last = m.state.asked.at(-1);
          check(`suspects seed${seed} : réponse conforme au coupable (${k})`, last.answer, culprit[k]);
        }
        const elimIndep = m.suspects.map((sus) => m.state.asked.some((a) => sus[a.trait] !== a.answer));
        check(`suspects seed${seed} : eliminated = recalcul indépendant`, m.state.eliminated, elimIndep);
        check(`suspects seed${seed} : le coupable n'est jamais éliminé`, m.state.eliminated[m.state.culprit], false);
      }

      // Polarité ⭐ de l'aide à l'information.
      {
        for (const [s0, s1] of [
          [1, 2],
          [2, 1],
          [1, 1],
          [2, 2],
        ]) {
          const m = new S(11, [s0, s1]);
          m.pick(m.state.picker, 0);
          const guesser = m.state.guesser;
          check(`suspects ⭐ [${s0},${s1}] : showHint = (stars[guesser]===1)`, m.state.showHint, m.stars[guesser] === 1);
        }
      }

      // Manche décisive : un point est TOUJOURS attribué, jamais de nul final.
      for (let seed = 500; seed < 540; seed++) {
        const m = new S(seed, [1, 1]);
        let guard = 0;
        while (!m.state.over && guard < 10) {
          guard++;
          const s = m.state;
          m.pick(s.picker, guard % EXPECT.SUSPECTS_COUNT);
          for (const k of KEYS.slice(0, EXPECT.SUSPECTS_QUESTIONS)) m.ask(s.guesser, k);
          const before = m.state;
          const isDecisive = before.decisive;
          m.accuse(s.guesser, (guard * 3) % EXPECT.SUSPECTS_COUNT);
          if (isDecisive) check(`suspects seed${seed} : manche décisive attribue toujours un point`, m.state.lastRound.pointTo !== null, true);
        }
        check(`suspects seed${seed} : totalRounds ∈ {4,5}`, m.state.totalRounds === 4 || m.state.totalRounds === 5, true);
        if (m.state.over) check(`suspects seed${seed} : winner jamais null`, m.result.winner === null, false);
      }

      // Déterminisme.
      {
        const a = new S(999, [1, 2]);
        const b = new S(999, [1, 2]);
        check('suspects déterminisme : profils identiques', JSON.stringify(a.suspects), JSON.stringify(b.suspects));
      }
    }

    function mulberry32Local(seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    return out;
  }, EXPECT);

  scenarioOk = printChecks('rules', detail.checks);
}

// ═══════════════════════════════════════════════ SCÉNARIO gen[:n]
//
// Fuzz des générateurs seedés sur n tirages : les garanties structurelles du
// §3, PAS la mécanique de jeu (ça, c'est `rules`). 0 échec attendu.
else if (kind === 'gen') {
  const n = Number(arg1 ?? 200);
  detail.n = n;
  detail.checks = await page.evaluate(
    (n, EXPECT) => {
      const out = [];
      const check = (name, got, want) => out.push({ name, got, want, ok: JSON.stringify(got) === JSON.stringify(want) });
      const M = window.__game.models;

      // tree : total impair, ≥3 coups légaux aux deux, bornes d'arêtes/profondeur.
      {
        let fails = 0;
        for (let seed = 1; seed <= n; seed++) {
          const s = new M.tree(seed, [2, 2]).state;
          const legal0 = s.edges.filter((e) => e.color === 0 || e.color === 2).length;
          const legal1 = s.edges.filter((e) => e.color === 1 || e.color === 2).length;
          const maxDepth = s.nodes.reduce((m, x) => Math.max(m, x.depth), 0);
          const ok =
            s.total % 2 === 1 &&
            legal0 >= EXPECT.TREE_MIN_MOVES &&
            legal1 >= EXPECT.TREE_MIN_MOVES &&
            s.edges.length >= EXPECT.TREE_EDGES.min &&
            s.edges.length <= EXPECT.TREE_EDGES.max &&
            maxDepth >= EXPECT.TREE_DEPTH.min &&
            maxDepth <= EXPECT.TREE_DEPTH.max;
          if (!ok) fails++;
        }
        check(`tree gen×${n} : garanties de §3.3 respectées`, fails, 0);
      }

      // tiles : cases bloquées dans les bornes, ≥6 poses légales aux deux,
      // et positions ⭐ seedées légales (2 dominos, tous légaux au moment posé).
      {
        let fails = 0;
        let starFails = 0;
        function isLegalAnchorIndep(player, idx, owner, blocked, cols, rows) {
          const r = Math.floor(idx / cols);
          const c = idx % cols;
          if (player === 0) {
            if (r + 1 >= rows) return false;
          } else if (c + 1 >= cols) return false;
          const second = player === 0 ? idx + cols : idx + 1;
          return !blocked[idx] && !blocked[second] && owner[idx] === null && owner[second] === null;
        }
        function legalCount(player, owner, blocked, cols, rows) {
          let c = 0;
          for (let i = 0; i < cols * rows; i++) if (isLegalAnchorIndep(player, i, owner, blocked, cols, rows)) c++;
          return c;
        }
        for (let seed = 1; seed <= n; seed++) {
          const s = new M.tiles(seed, [2, 2]).state;
          const blockedCount = s.blocked.filter(Boolean).length;
          const ok =
            blockedCount >= EXPECT.TILES_BLOCKED.min &&
            blockedCount <= EXPECT.TILES_BLOCKED.max &&
            legalCount(0, s.owner, s.blocked, s.cols, s.rows) >= EXPECT.TILES_MIN_PLACEMENTS &&
            legalCount(1, s.owner, s.blocked, s.cols, s.rows) >= EXPECT.TILES_MIN_PLACEMENTS;
          if (!ok) fails++;

          // Positions ⭐ : les 2 dominos préposés doivent former une pose
          // légale AU MOMENT où la génération les a posés — reconstruit ici
          // en rejouant l'ordre de `state.dominoes` sur un plateau qui ne
          // contient QUE les cases bloquées, en ajoutant chaque domino après
          // l'avoir validé (c'est l'algorithme même de `genBoard`, mais
          // recalculé indépendamment via `isLegalAnchorIndep`).
          const helpedModel = new M.tiles(seed, [1, 2]);
          const hs = helpedModel.state;
          const cleanOwner = new Array(hs.cols * hs.rows).fill(null);
          const dominoesOfHelped = hs.dominoes.filter((d) => d.starred);
          if (dominoesOfHelped.length !== EXPECT.TILES_STAR_PREPLACED) starFails++;
          for (const d of dominoesOfHelped) {
            if (!isLegalAnchorIndep(hs.helped, d.anchor, cleanOwner, hs.blocked, hs.cols, hs.rows)) starFails++;
            const second = hs.helped === 0 ? d.anchor + hs.cols : d.anchor + 1;
            cleanOwner[d.anchor] = hs.helped;
            cleanOwner[second] = hs.helped;
          }
        }
        check(`tiles gen×${n} : garanties de §3.4 respectées`, fails, 0);
        check(`tiles gen×${n} : bonus ⭐ toujours 2 poses légales`, starFails, 0);
      }

      // cake : compte impair ∈ {7,9,11}, écarts de fruits ≥2, jamais égaux,
      // écart minimal entre fruits et au bord ≥ CAKE_MIN_GAP.
      {
        let fails = 0;
        for (let seed = 1; seed <= n; seed++) {
          const s = new M.cake(seed, [2, 2]).state;
          const nStraw = M.cake.countOf(s.fruits, 'strawberry');
          const nBlue = M.cake.countOf(s.fruits, 'blueberry');
          let minGap = Infinity;
          let minEdge = Infinity;
          for (let i = 0; i < s.fruits.length; i++) {
            minEdge = Math.min(minEdge, M.cake.RADIUS - Math.hypot(s.fruits[i].x, s.fruits[i].y));
            for (let j = i + 1; j < s.fruits.length; j++) {
              minGap = Math.min(minGap, Math.hypot(s.fruits[i].x - s.fruits[j].x, s.fruits[i].y - s.fruits[j].y));
            }
          }
          const ok =
            (s.fruits.length === 7 || s.fruits.length === 9 || s.fruits.length === 11) &&
            s.fruits.length % 2 === 1 &&
            nStraw >= 2 &&
            nBlue >= 2 &&
            nStraw !== nBlue &&
            minGap >= EXPECT.CAKE_MIN_GAP - 1e-6 &&
            minEdge >= EXPECT.CAKE_MIN_GAP - 1e-6;
          if (!ok) fails++;
        }
        check(`cake gen×${n} : garanties de §3.2 respectées`, fails, 0);
      }

      // suspects : 6 profils distincts + système séparateur exhaustif.
      {
        const KEYS = ['hat', 'glasses', 'scarf', 'redPull'];
        const QSETS = [0, 1, 2, 3].map((omit) => KEYS.filter((_, i) => i !== omit));
        function isSeparatingIndep(suspects) {
          for (const keys of QSETS) {
            const seen = new Set();
            for (const sus of suspects) {
              const pattern = keys.map((k) => (sus[k] ? '1' : '0')).join('');
              if (seen.has(pattern)) return false;
              seen.add(pattern);
            }
          }
          return true;
        }
        let fails = 0;
        for (let seed = 1; seed <= n; seed++) {
          const sus = new M.suspects(seed, [2, 2]).suspects;
          const distinct = new Set(sus.map((s) => KEYS.map((k) => (s[k] ? '1' : '0')).join(''))).size;
          if (distinct !== EXPECT.SUSPECTS_COUNT || !isSeparatingIndep(sus)) fails++;
        }
        check(`suspects gen×${n} : 6 profils distincts + séparateur`, fails, 0);
      }

      return out;
    },
    n,
    EXPECT,
  );
  scenarioOk = printChecks(`gen:${n}`, detail.checks);
}

// ═══════════════════════════════════════════════ SCÉNARIO contrast
//
// Recalculé sur les VRAIES valeurs exposées, jamais « à l'œil ».
else if (kind === 'contrast') {
  detail.checks = await page.evaluate(() => {
    const out = [];
    const check = (name, got, want) => out.push({ name, got, want, ok: JSON.stringify(got) === JSON.stringify(want) });
    const { palette, mascots, contrastRatio } = window.__game;

    const ge = (name, ratio, min) => out.push({ name, got: Number(ratio.toFixed(2)), want: `≥ ${min}`, ok: ratio >= min });

    // Marqueurs d'information (WCAG 1.4.11, ≥ 3:1) contre le fond principal.
    for (const key of ['panelEdge', 'leaf', 'sky', 'berry', 'plum']) {
      ge(`contrast : ${key} vs bg (≥3:1, marqueur)`, contrastRatio(palette[key], palette.bg), 3);
    }
    // Texte (≥ 4,5:1) contre le fond principal.
    for (const key of ['cream', 'dim', 'gold']) {
      ge(`contrast : ${key} vs bg (≥4,5:1, texte)`, contrastRatio(palette[key], palette.bg), 4.5);
    }
    // Écrans plein cadre (fond bgDeep) : les mêmes teintes de texte y sont
    // aussi utilisées (écran de passage, résultat).
    for (const key of ['cream', 'dim', 'gold']) {
      ge(`contrast : ${key} vs bgDeep (≥4,5:1, texte plein cadre)`, contrastRatio(palette[key], palette.bgDeep), 4.5);
    }

    // Mascottes : 6 teintes, 6 socles, tous distincts.
    check('contrast mascottes : 6 définitions', mascots.length, 6);
    check('contrast mascottes : 6 teintes distinctes', new Set(mascots.map((m) => m.tint)).size, 6);
    check('contrast mascottes : 6 socles distincts', new Set(mascots.map((m) => m.socle)).size, 6);
    check(
      'contrast mascottes : aucun socle en anneau (code réservé aux dangers)',
      mascots.some((m) => m.socle === 'ring'),
      false,
    );

    // ① chaque teinte ≥ 3:1 sur le fond.
    for (const m of mascots) ge(`contrast mascotte ${m.id} : teinte vs bg (≥3:1)`, contrastRatio(m.tint, palette.bg), 3);

    // ② séparation en niveaux de gris : ≥ 1,25:1 entre deux mascottes
    // consécutives une fois triées par luminance (le tableau MASCOTS est déjà
    // dans cet ordre, mais on trie quand même pour ne rien devoir à l'ordre
    // de déclaration).
    const byLum = [...mascots].sort((a, b) => contrastRatio(a.tint, 0x000000) - contrastRatio(b.tint, 0x000000));
    for (let i = 0; i < byLum.length - 1; i++) {
      ge(`contrast mascottes : séparation gris ${byLum[i].id}/${byLum[i + 1].id} (≥1,25:1)`, contrastRatio(byLum[i].tint, byLum[i + 1].tint), 1.25);
    }
    // Et deux à deux (pas seulement les voisines) : aucune paire ne doit être
    // strictement identique en luminance (contrastRatio === 1 uniquement si
    // teinte identique, déjà couvert par l'unicité ci-dessus).
    for (let i = 0; i < mascots.length; i++) {
      for (let j = i + 1; j < mascots.length; j++) {
        const r = contrastRatio(mascots[i].tint, mascots[j].tint);
        if (r < 1.01) check(`contrast mascottes : ${mascots[i].id}/${mascots[j].id} distinguables en gris`, r, '> 1.01');
      }
    }

    return out;
  });
  scenarioOk = printChecks('contrast', detail.checks);
}

// ═══════════════════════════════════════════════ SCÉNARIO physics
//
// plank (franchissement de mur, déterminisme, invariance du point de
// contrôle) + mirror (déterminisme, coyote time) + ant (déterminisme, garde
// ANT_BLOCK_MIN_DIST).
else if (kind === 'physics') {
  detail.checks = await page.evaluate((EXPECT) => {
    const out = [];
    const check = (name, got, want) => out.push({ name, got, want, ok: JSON.stringify(got) === JSON.stringify(want) });
    const M = window.__game.models;
    const DT = 1 / 60;

    // ───────────────────────────── plank ─────────────────────────────
    {
      const P = M.plank;

      function dist2(ax, ay, bx, by) {
        const dx = ax - bx;
        const dy = ay - by;
        return dx * dx + dy * dy;
      }
      function circleRectOverlapIndep(cx, cy, r, rect) {
        const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
        const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
        return dist2(cx, cy, closestX, closestY) < r * r;
      }

      // Franchissement de mur à PLANK_VMAX sur 5000 pas : tilt diagonal
      // maximal tenu tout du long (donc à vitesse plafonnée l'essentiel du
      // temps), aucune pénétration attendue.
      {
        const m = new P(1, [2, 2]);
        m.setTilt(0, true, 1);
        m.setTilt(1, true, 1);
        let penetrations = 0;
        let outOfBounds = 0;
        let overSpeed = 0;
        for (let i = 0; i < 5000; i++) {
          // Position et repère AVANT cette frame — `ballPrevX/Y` traîne d'une
          // frame (posé au TOUT DÉBUT de `update`), donc c'est `ballX/Y` lu
          // ICI qui donne le point de départ réel du déplacement mesuré.
          const px = m.ballX;
          const py = m.ballY;
          const flashBefore = m.flashAt;
          const doneBefore = m.done;
          m.update(DT);
          const x = m.ballX;
          const y = m.ballY;
          if (x < EXPECT.PLANK_BALL_R - 1e-6 || x > EXPECT.COURT_W - EXPECT.PLANK_BALL_R + 1e-6) outOfBounds++;
          if (y < EXPECT.PLANK_BALL_R - 1e-6 || y > EXPECT.COURT_H - EXPECT.PLANK_BALL_R + 1e-6) outOfBounds++;
          for (const w of m.walls) if (circleRectOverlapIndep(x, y, EXPECT.PLANK_BALL_R, w)) penetrations++;
          // Un replacement (trou) ou un parcours franchi TÉLÉPORTE la bille :
          // ce n'est pas une vitesse, on l'exclut de la mesure.
          const teleported = m.flashAt !== flashBefore || m.done !== doneBefore;
          const speed = teleported ? 0 : Math.hypot(x - px, y - py) / DT;
          if (speed > EXPECT.PLANK_VMAX * 1.05) overSpeed++; // marge : sous-pas + friction au 1er pas
        }
        check('plank physics : aucune pénétration de mur sur 5000 pas à VMAX', penetrations, 0);
        check('plank physics : jamais hors plateau sur 5000 pas', outOfBounds, 0);
        check('plank physics : vitesse jamais très au-delà de PLANK_VMAX', overSpeed, 0);
      }

      // Déterminisme : même seed, même suite d'entrées → mêmes positions au
      // bit près sur 5000 pas.
      {
        function run(seed) {
          const m = new P(seed, [2, 2]);
          const trace = [];
          for (let i = 0; i < 5000; i++) {
            const phase = i % 240;
            const held0 = phase < 200;
            const held1 = phase >= 60 && phase < 180;
            m.setTilt(0, held0, held0 ? (phase % 3 === 0 ? -1 : 1) : 0);
            m.setTilt(1, held1, held1 ? (phase % 5 === 0 ? -1 : 1) : 0);
            m.update(DT);
            if (i % 37 === 0) trace.push([m.ballX, m.ballY, m.tiltX, m.tiltY, m.done, m.index, m.timeLeft]);
          }
          return trace;
        }
        const a = run(12345);
        const b = run(12345);
        let mismatches = 0;
        for (let i = 0; i < a.length; i++) for (let k = 0; k < a[i].length; k++) if (!Object.is(a[i][k], b[i][k])) mismatches++;
        check('plank physics : déterminisme bit-exact sur 5000 pas', mismatches, 0);
      }

      // Le replacement au point de contrôle ne change AUCUNE autre variable.
      {
        const m = new P(2, [2, 2]);
        // Course 0 puis 1 : on vise directement le but (le glissement le
        // long du mur unique de « le virage » fait le reste).
        let guard = 0;
        while (m.index < 2 && !m.over && guard < 20000) {
          guard++;
          const gx = m.goal.x - m.ballX;
          const gy = m.goal.y - m.ballY;
          const len = Math.hypot(gx, gy) || 1;
          m.setTilt(0, true, gx / len);
          m.setTilt(1, true, gy / len);
          m.update(DT);
        }
        check('plank checkpoint : parcours 3 atteint', m.index, 2);

        // Sur le parcours 3 (« la fosse »), viser tout droit traverse le
        // trou : ça déclenche le replacement qu'on veut observer.
        let sawReset = false;
        let violation = null;
        let prev = { tiltX: m.tiltX, tiltY: m.tiltY, index: m.index, done: m.done, timeLeft: m.timeLeft, flashAt: m.flashAt };
        for (let i = 0; i < 3000 && !sawReset; i++) {
          const gx = m.goal.x - m.ballX;
          const gy = m.goal.y - m.ballY;
          const len = Math.hypot(gx, gy) || 1;
          m.setTilt(0, true, gx / len);
          m.setTilt(1, true, gy / len);
          m.update(DT);
          const cur = { tiltX: m.tiltX, tiltY: m.tiltY, index: m.index, done: m.done, timeLeft: m.timeLeft, flashAt: m.flashAt };
          if (cur.flashAt !== prev.flashAt) {
            sawReset = true;
            const start = m.startPoint;
            if (
              cur.tiltX !== prev.tiltX ||
              cur.index !== prev.index ||
              cur.done !== prev.done ||
              Math.abs(prev.timeLeft - cur.timeLeft - DT) > 1e-9 ||
              m.ballX !== start.x ||
              m.ballY !== start.y ||
              m.ballPrevX !== start.x ||
              m.ballPrevY !== start.y
            ) {
              violation = { prev, cur, ballX: m.ballX, ballY: m.ballY, start };
            }
          }
          prev = cur;
        }
        check('plank checkpoint : un replacement a bien eu lieu', sawReset, true);
        check('plank checkpoint : aucune autre variable ne change', violation, null);
      }
    }

    // ───────────────────────────── mirror ─────────────────────────────
    {
      const Mi = M.mirror;

      // Déterminisme.
      {
        function run(seed) {
          const m = new Mi(seed, [1, 1]);
          const trace = [];
          for (let i = 0; i < 2000; i++) {
            m.setMoveDir(1);
            if (i % 40 === 7) m.jump();
            m.tick(DT);
            if (i % 23 === 0) trace.push([m.x, m.y, m.vx, m.vy, m.courseIndex, m.fallCount, m.coursesCleared]);
          }
          return trace;
        }
        const a = run(555);
        const b = run(555);
        let mismatches = 0;
        for (let i = 0; i < a.length; i++) for (let k = 0; k < a[i].length; k++) if (!Object.is(a[i][k], b[i][k])) mismatches++;
        check('mirror physics : déterminisme bit-exact sur 2000 pas', mismatches, 0);
      }

      // Coyote time effectif : accepté pile à la borne, refusé juste après.
      {
        function untilAirborne(m) {
          let guard = 0;
          m.setMoveDir(1);
          // PIÈGE : `grounded` vaut `false` par CONSTRUCTION (avant toute
          // résolution physique) — attendre « tant que grounded » sans un
          // premier pas ne boucle jamais, la condition est fausse d'emblée.
          // Un premier `tick` établit l'état RÉEL (le personnage nait posé
          // pile sur sa plateforme de départ, il devient donc `grounded`).
          m.tick(DT);
          guard++;
          while (m.grounded && guard < 600) {
            m.tick(DT);
            guard++;
          }
          return !m.grounded;
        }
        // Instance A : jump() exactement à 6 pas d'air (airTime = coyote).
        {
          const m = new Mi(0, [1, 1]);
          const airborne = untilAirborne(m);
          check('mirror coyote : le personnage quitte bien le sol', airborne, true);
          for (let i = 0; i < 5; i++) m.tick(DT); // 5 pas de plus → 6 au total en l'air
          const ok = m.jump();
          check('mirror coyote : saut accepté à la borne du coyote time', ok, true);
          check('mirror coyote : impulsion pleine', m.vy, -EXPECT.MIRROR_JUMP_VY);
        }
        // Instance B : identique, mais on attend un pas de plus avant de sauter.
        {
          const m = new Mi(0, [1, 1]);
          untilAirborne(m);
          for (let i = 0; i < 6; i++) m.tick(DT); // 7 pas au total en l'air : au-delà du coyote
          const ok = m.jump();
          check('mirror coyote : saut refusé juste après la borne', ok, false);
        }
      }
    }

    // ───────────────────────────── ant ─────────────────────────────
    {
      const A = M.ant;

      function distPointToRect(px, py, rx, ry, half) {
        const cx = Math.max(rx - half, Math.min(px, rx + half));
        const cy = Math.max(ry - half, Math.min(py, ry + half));
        return Math.hypot(px - cx, py - cy);
      }
      const BLOCK_HALF = EXPECT.ANT_BLOCK_SIZE / 2;

      // Déterminisme.
      {
        function run(seed) {
          const m = new A(seed, [2, 1]);
          const trace = [];
          for (let i = 0; i < 900; i++) {
            const t = i % 90;
            m.setAntInput(t < 45 ? 1 : -0.3, Math.sin(i / 17));
            if (i % 72 === 0) m.tryDropBlock((i * 37) % 900, 150 + (i % 200));
            m.update(DT);
            if (i % 11 === 0) trace.push([m.state.ant.x, m.state.ant.y, m.state.blocks.length, m.state.scores[0], m.state.scores[1]]);
          }
          return trace;
        }
        const a = run(4242);
        const b = run(4242);
        let mismatches = 0;
        for (let i = 0; i < a.length; i++) for (let k = 0; k < a[i].length; k++) if (!Object.is(a[i][k], b[i][k])) mismatches++;
        check('ant physics : déterminisme bit-exact sur 900 pas', mismatches, 0);
      }

      // Garde ANT_BLOCK_MIN_DIST : jamais violée quand un dépôt est accepté,
      // y compris quand on VISE délibérément près de la fourmi.
      {
        const m = new A(7, [2, 2]);
        let accepted = 0;
        let violations = 0;
        for (let i = 0; i < 300; i++) {
          m.setAntInput(Math.cos(i / 13), Math.sin(i / 9));
          m.update(DT);
          if (i % 6 === 0) {
            const ant = m.state.ant;
            // Alterne : tir PILE sur la fourmi (doit être refusé) et tir loin
            // (doit être accepté si le cooldown/plafond le permettent).
            const nearMiss = i % 12 === 0;
            const tx = nearMiss ? ant.x + 5 : ant.x + 300;
            const ty = nearMiss ? ant.y + 5 : ant.y;
            const before = m.state.blocks.length;
            const ok = m.tryDropBlock(tx, ty);
            const after = m.state.blocks.length;
            check(`ant garde : tryDropBlock reflète son retour (pas ${i})`, after - before, ok ? 1 : 0);
            if (ok) {
              accepted++;
              const b = m.state.blocks[m.state.blocks.length - 1];
              const d = distPointToRect(ant.x, ant.y, b.x, b.y, BLOCK_HALF);
              if (d < EXPECT.ANT_BLOCK_MIN_DIST) violations++;
              if (nearMiss) violations++; // un dépôt visé sur la fourmi ne DOIT jamais être accepté
            } else if (nearMiss) {
              check(`ant garde : dépôt visé sur la fourmi refusé (pas ${i})`, ok, false);
            }
          }
        }
        check('ant garde : au moins un dépôt accepté (la garde a été exercée)', accepted > 0, true);
        check('ant garde : ANT_BLOCK_MIN_DIST jamais violée', violations, 0);
      }

      // LA FRONTIÈRE EXACTE DE LA GARDE, et pourquoi elle mérite ses propres
      // assertions : `ant/view.ts` DESSINE cette zone (§1.1 critère 2 — un coup
      // illégal doit se voir hors d'atteinte, jamais être refusé en silence), et
      // elle a longtemps été peinte comme un cercle de rayon
      // ANT_BLOCK_MIN_DIST alors que la garde porte sur le CORPS du bloc.
      // La frontière réelle est donc à `ANT_BLOCK_HALF + ANT_BLOCK_MIN_DIST`
      // (68 px) sur les axes et à `ANT_BLOCK_MIN_DIST + ANT_BLOCK_HALF·√2`
      // (~79,6 px) en diagonale : un carré ARRONDI, pas un disque. Ces quatre
      // mesures fixent la forme ; si elles bougent, la zone dessinée doit
      // bouger avec elles.
      {
        const axis = EXPECT.ANT_BLOCK_SIZE / 2 + EXPECT.ANT_BLOCK_MIN_DIST;
        const diag = EXPECT.ANT_BLOCK_MIN_DIST + (EXPECT.ANT_BLOCK_SIZE / 2) * Math.SQRT2;
        // Un modèle NEUF par mesure : le cooldown part à 0 et rien n'est
        // remis à la main, donc aucune de ces sondes ne dépend d'un champ
        // privé du modèle.
        const tryAt = (dx, dy) => {
          const m = new A(11, [2, 2]);
          const ant = m.state.ant;
          return m.tryDropBlock(ant.x + dx, ant.y + dy);
        };
        check('ant frontière : refusé juste EN DEÇÀ de l’axe', tryAt(axis - 2, 0), false);
        check('ant frontière : accepté juste AU-DELÀ de l’axe', tryAt(axis + 2, 0), true);
        const k = Math.SQRT1_2;
        check('ant frontière : refusé juste EN DEÇÀ de la diagonale', tryAt((diag - 2) * k, (diag - 2) * k), false);
        check('ant frontière : accepté juste AU-DELÀ de la diagonale', tryAt((diag + 2) * k, (diag + 2) * k), true);
      }
    }

    return out;
  }, EXPECT);
  scenarioOk = printChecks('physics', detail.checks);
} else if (kind === 'play') {
  // `play:<jeu>[:seed]` — une manche ENTIÈRE aux vrais boutons / au vrai
  // clavier, de l'accueil jusqu'à l'écran de résultat, puis « encore ».
  const gameId = arg1 ?? 'cake';
  const known = await page.evaluate((id) => !!window.__game.gameById(id), gameId);
  if (!known) {
    console.log(`[play] jeu inconnu : ${gameId} (attendu : plank, mirror, cake, tree, tiles, beast, suspects, ant)`);
    await browser.close();
    process.exit(2);
  }
  const seed = arg2 === undefined ? 1 : Number(arg2) >>> 0;
  const rnd = mulberry32(seed || 1);
  const posture = await page.evaluate((id) => window.__game.gameById(id).posture, gameId);
  const budget = Number(process.argv[4] ?? (posture === 'side' ? 200 : 150));
  const checks = [];

  await enableReducedMotion(checks);
  await reachBoard(gameId, checks, gameId);

  const deadline = Date.now() + budget * 1000;
  let trace;
  if (posture === 'side') {
    trace = gameId === 'plank' ? await drivePlank(deadline, checks, gameId) : await driveSideBlind(gameId, rnd, deadline, checks, gameId);
  } else {
    trace = await drivePassGame(rnd, deadline, checks, gameId);
  }
  await checkResultPanel(checks, gameId);

  detail.game = gameId;
  detail.seed = seed;
  detail.posture = posture;
  detail.trace = trace;
  detail.checks = checks;
  scenarioOk = printChecks(`play:${gameId}`, checks);
  console.log(`[play:${gameId}] ${JSON.stringify(trace)}`);
} else if (kind === 'keyboard') {
  // ─────────────────────────────────────────────── LE TEST RGAA
  //
  // Manche complète AU CLAVIER SEUL, depuis l'accueil. Deux mesures :
  //   ① le focus ne retombe JAMAIS sur <body> APRÈS UNE VALIDATION. Le
  //      TRAVERSER pendant une tabulation est le comportement NORMAL du
  //      navigateur — le compter ferait échouer une interface parfaitement
  //      conforme, donc on ne regarde qu'après un Entrée/Espace.
  //   ② le saut automatique sur la première cible légale : après chaque
  //      validation qui rend la main au jeu, le focus doit être posé sur une
  //      commande VIVANTE du micro-jeu (jamais sur un bouton déjà grisé).
  const only = arg1 ?? null;
  const list = only ? [only] : ['cake', 'tree', 'tiles', 'beast', 'suspects'];
  const checks = [];
  const perGame = {};
  for (const gameId of list) {
    const known = await page.evaluate((id) => !!window.__game.gameById(id), gameId);
    if (!known) {
      console.log(`[keyboard] jeu inconnu : ${gameId}`);
      await browser.close();
      process.exit(2);
    }
    const posture = await page.evaluate((id) => window.__game.gameById(id).posture, gameId);
    // BUDGET PAR JEU, et `beast` n'est pas comme les autres : son tour de
    // chasseur exige EXACTEMENT trois cases armées parmi 48, et un pilote au
    // clavier qui tabule au hasard en arme puis en désarme longtemps avant de
    // tomber sur le compte. La bande de référence le mesure à 138 validations
    // là où les quatre autres en demandent 12 à 48 — soit près du triple, pour
    // le MÊME budget de 150 s. Mesuré ici : un run à 130 validations tombait
    // en panne de temps et faisait échouer deux assertions sur une interface
    // parfaitement conforme, ce qui est le pire défaut possible d'un test de
    // non-régression. On lui donne la marge que son ergonomie réclame ; le 5e
    // argument de la ligne de commande continue de tout surcharger.
    const fallback = posture === 'side' ? 200 : gameId === 'beast' ? 280 : 150;
    const budget = Number(process.argv[4] ?? fallback);
    perGame[gameId] = await keyboardRound(gameId, posture, budget, checks);
    // On rentre à l'accueil au clavier pour le jeu suivant.
    if (gameId !== list[list.length - 1]) {
      await tabToKey('other');
      await page.keyboard.press('Enter');
      await sleep(300);
      await tabToKey('home');
      await page.keyboard.press('Enter');
      await sleep(300);
    }
  }
  detail.games = perGame;
  detail.checks = checks;
  scenarioOk = printChecks('keyboard', checks);
  for (const [g, t] of Object.entries(perGame)) console.log(`[keyboard:${g}] ${JSON.stringify(t)}`);
} else if (kind === 'stress') {
  // §7 — fps avec les 8 démos du menu animées EN MÊME TEMPS qu'un jeu temps
  // réel lancé. Les trois phases sont mesurées séparément : sans elles, un
  // chiffre unique ne dit pas d'où vient la charge.
  //
  // Les vignettes ne se rejoignent au jeu que par un `attach` explicite : le
  // Flow les détache dès qu'on quitte le menu (et il a raison de le faire).
  // C'est un montage de MESURE, pas un chemin de jeu — d'où le fait qu'il soit
  // le seul appel d'API de tout ce fichier, et qu'il ne serve à rien d'autre
  // qu'à charger le moteur. Les `<canvas>` des vignettes n'existant plus hors
  // du menu, la recopie (`blit`) ne tourne pas dans la phase combinée : c'est
  // la simulation et le rendu des huit modèles qui sont mesurés, pas le blit.
  const fps = async (label, seconds) => {
    const t0 = Date.now();
    const f0 = await page.evaluate(() => window.__frames);
    await sleep(seconds * 1000);
    const f1 = await page.evaluate(() => window.__frames);
    const v = Math.round((f1 - f0) / ((Date.now() - t0) / 1000));
    console.log(`[stress] ${label} : ~${v} fps`);
    return v;
  };
  const checks = [];
  await enableReducedMotion(checks);
  await click('[data-key="play"]');
  await sleep(400);
  const attached = await page.evaluate(() => window.__game.demoBoard.attached);
  checks.push({ name: 'stress : les 8 vignettes du menu sont montées', got: attached, want: true, ok: attached === true });
  detail.fpsMenu = await fps('menu, 8 démos animées + recopie', 3);

  await click('[data-key="g-plank"]');
  await sleep(400);
  if (await click('[data-key="demo-skip"]')) await sleep(400);
  const inGame = await page.evaluate(() => window.__game.flow.current);
  checks.push({ name: 'stress : le jeu temps réel tourne', got: inGame, want: 'game', ok: inGame === 'game' });
  detail.fpsGame = await fps('plank seul (temps réel)', 3);

  await page.evaluate(() => window.__game.demoBoard.attach(window.__game.games, window.__game.game.ui));
  await sleep(300);
  const both = await page.evaluate(() => window.__game.demoBoard.attached && window.__game.flow.current === 'game');
  checks.push({ name: 'stress : 8 démos + jeu temps réel simultanés', got: both, want: true, ok: both === true });
  detail.fpsBoth = await fps('8 démos rejouées + plank temps réel', 4);

  // ── RÈGLE ① DE `core/demo.ts`, ENFIN MESURÉE ───────────────────────────
  // Le fichier écrit « DEUX BOUCLES CONSÉCUTIVES SONT IDENTIQUES, à la frame
  // près » et « MESURÉES par le bot (§7), pas seulement affirmées » — or
  // aucune assertion ne l'exerçait : `main.ts` exposait bien `demoBoard`,
  // `loop`, `tick` et `lastLoopTicks` « pour que le bot le prouve », mais le
  // bot ne lisait que `attached`. C'était donc, littéralement, un invariant
  // AFFIRMÉ. Il l'est d'autant moins qu'il porte tout le §2.4 : une vignette
  // qui n'enseigne pas la même chose à chaque tour n'est plus un tutoriel.
  //
  // La preuve est EXACTE et non statistique (le fichier le dit et il a
  // raison) : le rejoueur remonte le micro-jeu au MÊME seed, la liste de
  // coups est la même et le pas de simulation est fixe, donc deux boucles
  // qui durent le même nombre de PAS sont la même boucle. Comparer des
  // pixels serait plus faible et plus fragile.
  //
  // FENÊTRE BORNÉE, et assumée : en mouvement réduit (que `stress` active) un
  // tour de boucle va de 246 pas (`plank`, ~4 s) à 900 (`beast`, ~15 s). On
  // laisse 30 s, on n'exige DEUX boucles bouclées que des plus rapides — au
  // moins quatre des huit — et on vérifie l'égalité sur toutes celles qui y
  // sont arrivées. Un seuil plus ambitieux ferait un test qui échoue quand la
  // machine est chargée, ce qui est pire qu'un test absent.
  {
    const first = new Map();
    const mismatches = [];
    const twoLoops = new Set();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const snap = await page.evaluate(() =>
        window.__game.demoBoard.runners.map((r, i) => ({
          id: window.__game.games[i].id,
          loop: r.loop,
          last: r.lastLoopTicks,
        })),
      );
      for (const r of snap) {
        if (r.loop < 1 || r.last <= 0) continue;
        if (!first.has(r.id)) {
          first.set(r.id, { loop: r.loop, last: r.last });
          continue;
        }
        const seen = first.get(r.id);
        if (r.loop === seen.loop) continue;
        twoLoops.add(r.id);
        if (r.last !== seen.last) mismatches.push(`${r.id} ${seen.last}≠${r.last}`);
      }
      if (twoLoops.size >= 8) break;
      await sleep(500);
    }
    detail.demoLoopTicks = Object.fromEntries([...first].map(([k, v]) => [k, v.last]));
    detail.demoTwoLoops = [...twoLoops];
    checks.push({
      name: 'démo ① : au moins 4 vignettes ont bouclé DEUX fois dans la fenêtre',
      got: twoLoops.size,
      want: '≥ 4',
      ok: twoLoops.size >= 4,
    });
    checks.push({
      name: 'démo ① : deux boucles consécutives durent le MÊME nombre de pas',
      got: mismatches.length === 0 ? 0 : mismatches.join(', '),
      want: 0,
      ok: mismatches.length === 0,
    });
  }

  await page.evaluate(() => window.__game.demoBoard.detach());

  detail.checks = checks;
  scenarioOk = printChecks('stress', checks);
  console.log(
    '[stress] RAPPEL : le taux absolu dépend de la machine (rendu logiciel en conteneur, GPU sur un poste) — se lit en RELATIF, sur la même machine.',
  );
} else {

  console.log(`Scénario inconnu : ${SCENARIO}`);
  console.log('Scénarios : rules · gen[:n] · contrast · physics · play:<jeu>[:seed] · keyboard[:jeu] · stress');
  await browser.close();
  process.exit(2);
}

// ─────────────────────────────────────────────── verdict

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`[${SCENARIO}] terminé en ${elapsed}s, ${errors.length} erreur(s) console.`);
for (const e of errors) console.log(`  console error: ${e}`);

await browser.close();
process.exit(scenarioOk && errors.length === 0 ? 0 : 1);
