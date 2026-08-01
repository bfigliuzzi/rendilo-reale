// Bot de vérification de « Cerveau » (games/mind), pilote headless.
//
//   node tools/verify-mind.mjs <url> <scenario> [seconds] [shot.png]
//
// Scénarios :
//   feedback[:n]              fuzz de computeFeedback contre une implémentation
//                             INDÉPENDANTE écrite ici — le garde-fou des doublons
//   solve:easy|normal|hard[:runs]   un solveur minimax doit GAGNER à chaque run
//   cat[:runs]                chat activé + méfaits forcés : le solveur doit
//                             gagner quand même (preuve que tout est récupérable)
//   lose[:difficulté]         coups volontairement faux : défaite ATTENDUE
//   keyboard[:difficulté]     partie complète AU CLAVIER SEUL, focus jamais perdu
//   contrast                  contrastes RGAA + unicité forme/glyphe, AU CALCUL
//   stress                    saturation des effets, fps mesuré
//
// Exit : 0 ok · 1 erreur console ou issue inattendue · 2 argument invalide.
// En conteneur : lancer node SANS les variables de proxy, sinon Chromium
// proxifie localhost (env -u HTTP_PROXY -u HTTPS_PROXY …), et
// CHROME_PATH=/opt/pw-browsers/chromium.

import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] ?? 'http://localhost:5173/games/mind/';
const SCENARIO = process.argv[3] ?? 'solve:normal';
const SECONDS = Number(process.argv[4] ?? 120);
const SHOT = process.argv[5] ?? '';

const [kind, arg1, arg2] = SCENARIO.split(':');

// ─────────────────────────────────────────────── règles (miroir de balance.ts)
// Dupliquées VOLONTAIREMENT : si le jeu change ses règles sans qu'on le sache,
// le bot doit le détecter, pas s'y adapter en silence.
const DIFFICULTIES = {
  easy: { pegs: 4, colors: 5, tries: 12, duplicates: false, allowEmpty: false },
  normal: { pegs: 4, colors: 6, tries: 10, duplicates: true, allowEmpty: false },
  hard: { pegs: 5, colors: 8, tries: 10, duplicates: true, allowEmpty: true },
};

const EMPTY = -1;

/** Symboles jouables d'une difficulté, en valeurs (le vide en dernier). */
function symbolsOf(def) {
  const s = [];
  for (let i = 0; i < def.colors; i++) s.push(i);
  if (def.allowEmpty) s.push(EMPTY);
  return s;
}

/** Index de palette d'une valeur — le pion vide est la dernière pastille. */
function paletteIndex(def, value) {
  return value < 0 ? def.colors : value;
}

// ─────────────────────────────────────────────── indice, réimplémenté ici
// Écriture DIFFÉRENTE de celle du jeu (tableaux ordinaires, comptage explicite) :
// deux implémentations identiques partageraient leurs bugs.
function feedbackRef(secret, guess) {
  let exact = 0;
  const restS = [];
  const restG = [];
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) exact++;
    else {
      restS.push(secret[i]);
      restG.push(guess[i]);
    }
  }
  let misplaced = 0;
  const used = new Array(restS.length).fill(false);
  for (const g of restG) {
    for (let j = 0; j < restS.length; j++) {
      if (!used[j] && restS[j] === g) {
        used[j] = true;
        misplaced++;
        break;
      }
    }
  }
  return { exact, misplaced };
}

// ─────────────────────────────────────────────── solveur

/** Tous les codes légaux, à plat dans un Int8Array (pegs valeurs par code). */
function buildCodeSpace(def) {
  const symbols = symbolsOf(def);
  const out = [];
  const cur = new Array(def.pegs);
  const rec = (i) => {
    if (i === def.pegs) {
      out.push(cur.slice());
      return;
    }
    for (const s of symbols) {
      if (!def.duplicates && cur.includes(s, 0) && cur.indexOf(s) < i) continue;
      cur[i] = s;
      rec(i + 1);
    }
  };
  // sans doublon : on filtre après coup, plus simple à lire et assez rapide
  if (def.duplicates) {
    const recDup = (i) => {
      if (i === def.pegs) {
        out.push(cur.slice());
        return;
      }
      for (const s of symbols) {
        cur[i] = s;
        recDup(i + 1);
      }
    };
    recDup(0);
  } else {
    const recNo = (i, used) => {
      if (i === def.pegs) {
        out.push(cur.slice());
        return;
      }
      for (const s of symbols) {
        if (used.has(s)) continue;
        cur[i] = s;
        used.add(s);
        recNo(i + 1, used);
        used.delete(s);
      }
    };
    recNo(0, new Set());
  }
  void rec;
  const flat = new Int8Array(out.length * def.pegs);
  out.forEach((code, i) => flat.set(code, i * def.pegs));
  return { flat, count: out.length };
}

const SC = new Int32Array(16);
const GC = new Int32Array(16);

/** Clé compacte de l'indice entre le code `i` de l'espace et `guess`. */
function fbKey(flat, i, guess, pegs) {
  SC.fill(0);
  GC.fill(0);
  const base = i * pegs;
  let exact = 0;
  for (let k = 0; k < pegs; k++) {
    const s = flat[base + k];
    const g = guess[k];
    if (s === g) exact++;
    else {
      SC[s + 1]++;
      GC[g + 1]++;
    }
  }
  let mis = 0;
  for (let v = 0; v < 16; v++) mis += Math.min(SC[v], GC[v]);
  return exact * (pegs + 1) + mis;
}

/** Premier coup : deux paires, l'ouverture de Knuth généralisée. */
function openingGuess(def) {
  const g = [];
  for (let i = 0; i < def.pegs; i++) {
    g.push(def.duplicates ? Math.min(def.colors - 1, Math.floor(i / 2)) : i % def.colors);
  }
  return g;
}

/**
 * MINIMAX SUR L'ENSEMBLE COHÉRENT. Le minimax complet de Knuth évalue tous les
 * codes contre tous : 1 296² ≈ 1,7 M paires en normal, instantané — mais 59 049²
 * ≈ 3,5 G en difficile, hors de question. On échantillonne donc candidats et
 * sondes, ce qui suffit largement : le budget est de 10 essais pour un optimum
 * théorique autour de 6.
 */
const MAX_CANDS = 400;
const MAX_PROBES = 1200;

function sampleIndices(pool, max, rand) {
  if (pool.length <= max) return pool;
  const out = [];
  const step = pool.length / max;
  for (let i = 0; i < max; i++) out.push(pool[Math.floor(i * step + rand() * step) % pool.length]);
  return out;
}

function chooseGuess(space, consistent, def, rand) {
  if (consistent.length === 1) return codeAt(space, consistent[0], def.pegs);
  const cands = sampleIndices(consistent, MAX_CANDS, rand);
  const probes = sampleIndices(consistent, MAX_PROBES, rand);
  const buckets = new Int32Array((def.pegs + 1) * (def.pegs + 1) + 1);
  let best = cands[0];
  let bestWorst = Infinity;
  for (const ci of cands) {
    const guess = codeAt(space, ci, def.pegs);
    buckets.fill(0);
    let worst = 0;
    for (const pi of probes) {
      const k = fbKey(space.flat, pi, guess, def.pegs);
      const n = ++buckets[k];
      if (n > worst) worst = n;
    }
    if (worst < bestWorst) {
      bestWorst = worst;
      best = ci;
    }
  }
  return codeAt(space, best, def.pegs);
}

function codeAt(space, i, pegs) {
  return Array.from(space.flat.subarray(i * pegs, i * pegs + pegs));
}

/** mulberry32, pour que les échantillonnages du solveur soient reproductibles. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────── navigateur

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
// jamais — c'est le waitForFunction qui garantit que le jeu est prêt.
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction('window.__game !== undefined', { timeout: 15000 });
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
let outcome = null;
let expected = null;
const detail = {};

// ─────────────────────────────────────────────── primitives de pilotage

/** Démarre une partie et renvoie le code secret et la difficulté effective. */
async function startGame(difficulty, seed) {
  return page.evaluate(
    (d, s) => {
      const g = window.__game;
      g.flow.startGame(d, s);
      // le chat est coupé par défaut : une partie de mesure doit être déterministe
      g.world.cat.setEnabled(false);
      const b = g.world.board;
      return { secret: Array.from(b.secret), pegs: b.def.pegs, colors: b.def.colors, tries: b.def.tries };
    },
    difficulty,
    seed,
  );
}

/** Pose un coup via l'API JOUEUR (World), puis valide. Renvoie l'indice rendu. */
async function playGuess(def, guess) {
  return page.evaluate(
    (indices, expectValues) => {
      const g = window.__game;
      const w = g.world;
      for (let s = 0; s < indices.length; s++) w.setSlot(s, indices[s]);
      const posed = Array.from(w.board.active.pegs);
      const fb = w.submit();
      return {
        fb: fb ? { exact: fb.exact, misplaced: fb.misplaced } : null,
        posed,
        matches: posed.length === expectValues.length && posed.every((v, i) => v === expectValues[i]),
        over: w.board.over,
        solved: w.board.solved,
        played: w.board.played,
      };
    },
    guess.map((v) => paletteIndex(def, v)),
    guess,
  );
}

// ─────────────────────────────────────────────── scénarios

if (kind === 'feedback') {
  // Fuzz : mêmes paires (secret, coup) des deux côtés, indice comparé.
  expected = 'match';
  const total = Number(arg1 ?? 5000);
  const rand = mulberry32(12345);
  let checked = 0;
  let mismatches = 0;
  const samples = [];

  for (const [name, def] of Object.entries(DIFFICULTIES)) {
    const symbols = symbolsOf(def);
    const perDiff = Math.ceil(total / 3);
    for (let batch = 0; batch < perDiff; batch += 500) {
      const pairs = [];
      const n = Math.min(500, perDiff - batch);
      for (let i = 0; i < n; i++) {
        const secret = Array.from({ length: def.pegs }, () => symbols[Math.floor(rand() * symbols.length)]);
        const guess = Array.from({ length: def.pegs }, () => symbols[Math.floor(rand() * symbols.length)]);
        pairs.push([secret, guess]);
      }
      const got = await page.evaluate(
        (list) => list.map(([s, g]) => window.__game.computeFeedback(s, g)),
        pairs,
      );
      for (let i = 0; i < pairs.length; i++) {
        const ref = feedbackRef(pairs[i][0], pairs[i][1]);
        checked++;
        if (ref.exact !== got[i].exact || ref.misplaced !== got[i].misplaced) {
          mismatches++;
          if (samples.length < 5) {
            samples.push({ difficulty: name, secret: pairs[i][0], guess: pairs[i][1], ref, got: got[i] });
          }
        }
      }
    }
  }
  detail.checked = checked;
  detail.mismatches = mismatches;
  detail.mismatchSamples = samples;
  outcome = mismatches === 0 ? 'match' : 'mismatch';
} else if (kind === 'solve' || kind === 'cat') {
  const difficulty = kind === 'cat' ? 'normal' : (arg1 ?? 'normal');
  if (!DIFFICULTIES[difficulty]) {
    console.error(`difficulté inconnue : ${difficulty} (easy|normal|hard)`);
    process.exit(2);
  }
  const runs = Number((kind === 'cat' ? arg1 : arg2) ?? 3) || 3;
  const def = DIFFICULTIES[difficulty];
  expected = 'win';
  const space = buildCodeSpace(def);
  detail.difficulty = difficulty;
  detail.codeSpace = space.count;
  detail.runs = [];

  let allWon = true;
  for (let run = 0; run < runs; run++) {
    if ((Date.now() - start) / 1000 > SECONDS) break;
    const seed = 1000 + run * 7919;
    const info = await startGame(difficulty, seed);
    if (kind === 'cat') {
      await page.evaluate(() => {
        const g = window.__game;
        g.world.cat.setEnabled(true);
        g.world.cat.setMischief(true);
      });
    }

    const rand = mulberry32(seed);
    let consistent = Array.from({ length: space.count }, (_, i) => i);
    let guess = openingGuess(def);
    let won = false;
    let tries = 0;
    let mischiefs = 0;
    let repairs = 0;

    for (let turn = 0; turn < def.tries; turn++) {
      let res;
      if (kind === 'cat') {
        // On pose le coup, on laisse le chat frapper, puis on RELIT le plateau :
        // c'est exactement ce qu'un joueur doit pouvoir faire.
        res = await page.evaluate(
          (indices, values) => {
            const g = window.__game;
            const w = g.world;
            for (let s = 0; s < indices.length; s++) w.setSlot(s, indices[s]);
            const before = w.run.mischiefs;
            const struck = w.forceCatMischief();
            let repaired = 0;
            if (struck) {
              // Le chat doit d'abord TRAVERSER le plateau, puis lever la patte :
              // on avance la sim jusqu'à ce que le méfait ait effectivement lieu
              // (borné, pour ne pas boucler si une condition l'en empêche).
              for (let t = 0; t < 1800 && w.run.mischiefs === before; t++) w.update(1 / 60);
              const after = Array.from(w.board.active.pegs);
              const dirty = after.some((v, i) => v !== values[i]);
              if (dirty) {
                // d'abord le bouton ↩, puis réparation à la main si besoin
                w.undo();
                const undone = Array.from(w.board.active.pegs);
                if (undone.some((v, i) => v !== values[i])) {
                  for (let s = 0; s < indices.length; s++) w.setSlot(s, indices[s]);
                  repaired = 2;
                } else {
                  repaired = 1;
                }
              }
            }
            const posed = Array.from(w.board.active.pegs);
            const fb = w.submit();
            return {
              fb: fb ? { exact: fb.exact, misplaced: fb.misplaced } : null,
              posed,
              matches: posed.every((v, i) => v === values[i]),
              over: w.board.over,
              solved: w.board.solved,
              played: w.board.played,
              struck,
              repaired,
              mischiefs: w.run.mischiefs,
            };
          },
          guess.map((v) => paletteIndex(def, v)),
          guess,
        );
        mischiefs = res.mischiefs;
        if (res.repaired) repairs++;
      } else {
        res = await playGuess(def, guess);
      }

      if (!res.fb) {
        detail.runs.push({ seed, error: 'submit refusé', posed: res.posed });
        allWon = false;
        break;
      }
      if (!res.matches) {
        detail.runs.push({ seed, error: 'la ligne posée ne correspond pas au coup', posed: res.posed, guess });
        allWon = false;
        break;
      }
      // l'indice rendu par le jeu doit être celui qu'on recalcule ici
      const ref = feedbackRef(info.secret, guess);
      if (ref.exact !== res.fb.exact || ref.misplaced !== res.fb.misplaced) {
        detail.runs.push({ seed, error: 'indice divergent', guess, ref, got: res.fb });
        allWon = false;
        break;
      }

      tries = res.played;
      if (res.solved) {
        won = true;
        break;
      }
      if (res.over) break;

      const key = res.fb.exact * (def.pegs + 1) + res.fb.misplaced;
      consistent = consistent.filter((i) => fbKey(space.flat, i, guess, def.pegs) === key);
      if (consistent.length === 0) {
        detail.runs.push({ seed, error: 'ensemble cohérent vide — indice incohérent', guess });
        allWon = false;
        break;
      }
      guess = chooseGuess(space, consistent, def, rand);
    }

    detail.runs.push({ seed, won, tries, secret: info.secret, mischiefs, repairs });
    if (!won) allWon = false;
  }

  const played = detail.runs.filter((r) => r.won !== undefined);
  detail.avgTries = played.length
    ? Math.round((played.reduce((a, r) => a + r.tries, 0) / played.length) * 100) / 100
    : null;
  detail.maxTries = played.length ? Math.max(...played.map((r) => r.tries)) : null;

  if (kind === 'cat') {
    // un scénario « chat » où le chat n'a jamais frappé ne prouve rien
    const struck = detail.runs.reduce((a, r) => a + (r.mischiefs ?? 0), 0);
    detail.totalMischiefs = struck;
    if (struck === 0) allWon = false;
  }
  outcome = allWon ? 'win' : 'lose';
} else if (kind === 'lose') {
  const difficulty = arg1 ?? 'normal';
  if (!DIFFICULTIES[difficulty]) {
    console.error(`difficulté inconnue : ${difficulty} (easy|normal|hard)`);
    process.exit(2);
  }
  expected = 'lose';
  const def = DIFFICULTIES[difficulty];
  const info = await startGame(difficulty, 4242);
  // On joue exprès des coups faux : un code différent du secret à chaque tour.
  const symbols = symbolsOf(def);
  let played = 0;
  let solved = false;
  for (let turn = 0; turn < def.tries + 1; turn++) {
    const guess = info.secret.map((v) => {
      const others = symbols.filter((s) => s !== v);
      return others[turn % others.length];
    });
    const res = await playGuess(def, guess);
    if (!res.fb) break;
    played = res.played;
    solved = res.solved;
    if (res.over) break;
  }
  // l'écran de résultat est volontairement différé (le temps que le code se
  // dévoile) : on l'attend au lieu de lire l'état trop tôt
  await page
    .waitForFunction("window.__game.flow.state === 'result'", { timeout: 8000 })
    .catch(() => {});
  const state = await page.evaluate(() => ({
    over: window.__game.world.board.over,
    revealed: window.__game.world.revealed,
    flow: window.__game.flow.state,
  }));
  detail.played = played;
  detail.solved = solved;
  detail.revealed = state.revealed;
  detail.flowState = state.flow;
  // défaite = tous les essais consommés, code révélé, écran de résultat affiché
  outcome = !solved && state.over && state.revealed && state.flow === 'result' ? 'lose' : 'win';
} else if (kind === 'contrast') {
  // Contrastes RGAA recalculés sur les VRAIES valeurs exposées par le jeu — pas
  // sur une copie qui dériverait en silence. Deux seuils : 4,5:1 pour le texte
  // (RGAA 3.2 / WCAG 1.4.3), 3:1 pour les corps de pions et les marqueurs, qui
  // sont des composants d'interface porteurs de sens (WCAG 1.4.11).
  expected = 'pass';
  const { palette, pegs } = await page.evaluate(() => ({
    palette: window.__game.palette,
    pegs: window.__game.pegs,
  }));

  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (h) =>
    0.2126 * lin(((h >> 16) & 0xff) / 255) +
    0.7152 * lin(((h >> 8) & 0xff) / 255) +
    0.0722 * lin((h & 0xff) / 255);
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const hx = (c) => `#${c.toString(16).padStart(6, '0')}`;

  const backgrounds = [palette.bg, palette.boardBg, palette.socket];
  const failures = [];

  // texte sur le fond de page
  const texts = [palette.text, palette.textDim, palette.accent, palette.cool, palette.win, palette.lose];
  const textReport = texts.map((c) => {
    const r = ratio(c, palette.bg);
    if (r < 4.5) failures.push({ what: `texte ${hx(c)}`, ratio: +r.toFixed(2), need: 4.5 });
    return { color: hx(c), ratio: +r.toFixed(2) };
  });

  // corps de pions contre les TROIS fonds du jeu
  const pegReport = pegs.map((p) => {
    const worst = Math.min(...backgrounds.map((b) => ratio(p.color, b)));
    if (worst < 3) failures.push({ what: `pion ${p.name} ${hx(p.color)}`, ratio: +worst.toFixed(2), need: 3 });
    return {
      name: p.name,
      color: hx(p.color),
      shape: p.shape,
      glyph: p.glyph,
      worst: +worst.toFixed(2),
      grey: +(lum(p.color) * 100).toFixed(1),
    };
  });

  // marqueurs d'indice sur le plateau
  const marks = [
    ['bien placé', palette.accent],
    ['mal placé', palette.cool],
  ].map(([name, c]) => {
    const r = ratio(c, palette.boardBg);
    if (r < 3) failures.push({ what: `marqueur ${name}`, ratio: +r.toFixed(2), need: 3 });
    return { name, color: hx(c), ratio: +r.toFixed(2) };
  });

  // Unicité FORME+GLYPHE : c'est ce qui rend les pions distinguables sans la
  // couleur (WCAG 1.4.1). Deux pions ne doivent jamais partager les deux.
  const signatures = new Map();
  for (const p of pegs) {
    const key = `${p.shape}/${p.glyph}`;
    if (signatures.has(key)) failures.push({ what: `forme+glyphe en double : ${key}`, ratio: 0, need: 0 });
    signatures.set(key, p.name);
  }

  detail.texts = textReport;
  detail.pegs = pegReport.sort((a, b) => a.grey - b.grey);
  detail.marks = marks;
  detail.uniqueShapeGlyph = signatures.size === pegs.length;
  detail.failures = failures;
  outcome = failures.length === 0 ? 'pass' : 'fail';
} else if (kind === 'keyboard') {
  // Parcours AU CLAVIER SEUL, de l'accueil à l'écran de résultat : aucun clic,
  // aucun appel direct à l'API du jeu. C'est le test de non-régression RGAA —
  // si un jour l'overlay cesse d'être du DOM natif focusable, il casse ici.
  const difficulty = arg1 ?? 'normal';
  if (!DIFFICULTIES[difficulty]) {
    console.error(`difficulté inconnue : ${difficulty} (easy|normal|hard)`);
    process.exit(2);
  }
  expected = 'result';
  const def = DIFFICULTIES[difficulty];

  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { tag: 'BODY' };
      return {
        tag: el.tagName,
        slot: el.dataset?.slot ?? null,
        symbol: el.dataset?.symbol ?? null,
        action: el.dataset?.action ?? null,
        diff: el.dataset?.diff ?? null,
        id: el.id || null,
        label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 40) || null,
      };
    });

  // ① l'accueil : tabuler jusqu'à la carte de difficulté, puis Entrée
  let steps = 0;
  let lost = 0;
  let target = null;
  for (; steps < 40; steps++) {
    await page.keyboard.press('Tab');
    const f = await focused();
    if (f.tag === 'BODY') lost++;
    if (f.diff === difficulty) {
      target = f;
      break;
    }
  }
  detail.tabsToCard = steps + 1;
  detail.cardReached = target !== null;
  if (!target) {
    detail.error = 'carte de difficulté inatteignable au clavier';
  } else {
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 350));

    // ② en jeu : Tab jusqu'au premier emplacement
    let onSlot = false;
    for (let i = 0; i < 20 && !onSlot; i++) {
      await page.keyboard.press('Tab');
      const f = await focused();
      if (f.tag === 'BODY') lost++;
      onSlot = f.slot !== null;
    }
    detail.slotReached = onSlot;

    // ③ on joue toutes les lignes : chiffres pour poser, Entrée pour valider.
    // Le focus doit s'enchaîner tout seul (avance après chaque chiffre, saut sur
    // ✓ quand la ligne est complète, retour au premier emplacement libre après).
    const digits = [];
    for (let i = 0; i < def.pegs; i++) digits.push(String((i % def.colors) + 1));
    const turns = [];
    for (let t = 0; t < def.tries && onSlot; t++) {
      // on varie le coup à chaque tour pour ne pas tomber sur le code par hasard
      const rotated = digits.map((d, i) => String(((Number(d) - 1 + t + i) % def.colors) + 1));
      for (const d of rotated) await page.keyboard.press(d);
      const afterFill = await focused();
      await page.keyboard.press('Enter');
      await new Promise((r) => setTimeout(r, 120));
      const state = await page.evaluate(() => ({
        played: window.__game.world.board?.played ?? -1,
        over: window.__game.world.board?.over ?? true,
        flow: window.__game.flow.state,
      }));
      turns.push({ submitFocused: afterFill.id === 'submit', played: state.played, flow: state.flow, focus: afterFill.label });
      if (state.over || state.flow !== 'playing') break;
      const f = await focused();
      if (f.tag === 'BODY') lost++;
      onSlot = f.slot !== null;
    }
    detail.turns = turns;
    // le focus doit atterrir sur ✓ Valider à CHAQUE ligne complétée
    detail.submitAutoFocused = turns.every((t) => t.submitFocused);
    detail.progressed = turns.length > 0 && turns[turns.length - 1].played > 0;
  }

  await page
    .waitForFunction("window.__game.flow.state === 'result'", { timeout: 9000 })
    .catch(() => {});
  const flow = await page.evaluate(() => window.__game.flow.state);
  // le focus ne doit JAMAIS retomber sur <body> : c'est le piège classique du
  // re-render d'écran, et le manque relevé dans Essaim
  const afterResult = await focused();
  detail.focusLostToBody = lost;
  detail.finalFocus = afterResult;
  detail.flowState = flow;
  outcome =
    flow === 'result' &&
    lost === 0 &&
    detail.cardReached &&
    detail.slotReached &&
    detail.submitAutoFocused &&
    afterResult.tag !== 'BODY'
      ? 'result'
      : 'broken';
} else if (kind === 'stress') {
  // Saturation : on remplit et vide la ligne en boucle (chaque pose déclenche
  // gerbe + onde de choc), chat activé, et on mesure les fps réels.
  await startGame('hard', 777);
  await page.evaluate(() => {
    const g = window.__game;
    g.world.cat.setEnabled(true);
    let i = 0;
    window.__stress = setInterval(() => {
      const w = g.world;
      if (!w.board || w.board.over) g.flow.startGame('hard', 777 + i);
      for (let s = 0; s < w.board.def.pegs; s++) w.setSlot(s, (i + s) % w.board.def.colors);
      if (i % 4 === 3) w.clearSlot(i % w.board.def.pegs);
      if (i % 12 === 11) w.submit();
      i++;
    }, 60);
  });
  await new Promise((r) => setTimeout(r, Math.min(SECONDS, 12) * 1000));
  await page.evaluate(() => clearInterval(window.__stress));
  outcome = 'stress';
} else {
  console.error(`scénario inconnu : ${SCENARIO}`);
  console.error(
    'attendu : feedback[:n] | solve:easy|normal|hard[:runs] | cat[:runs] | lose[:diff] |\n           keyboard[:diff] | contrast | stress',
  );
  process.exit(2);
}

if (SHOT) await page.screenshot({ path: SHOT });
const elapsed = (Date.now() - start) / 1000;
const frames = await page.evaluate(() => window.__frames);
const report = {
  scenario: SCENARIO,
  outcome,
  expected,
  ok: errors.length === 0 && (expected === null || outcome === expected),
  fpsAvg: Math.round(frames / Math.max(0.001, (Date.now() - start) / 1000 + 0.3)),
  seconds: Math.round(elapsed * 10) / 10,
  errors,
  ...detail,
};
console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(report.ok ? 0 : 1);
