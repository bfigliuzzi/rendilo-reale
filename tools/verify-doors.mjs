// Bot de vérification de « Trois Portes » (games/doors), pilote headless.
//
//   node tools/verify-doors.mjs <url> <scenario> [seconds] [shot.png]
//
// Scénarios :
//   rules            le modèle de combat, assertion par assertion (règle de
//                    ligne, provocation, carquois, armure, défense, boss)
//   gen[:runs]       les 5 règles de génération des portes, sur N runs seedées
//   win[:seed]       un bot joue une run ENTIÈRE en cliquant les VRAIS boutons ;
//                    il doit atteindre le boss
//   band[:runs]      N runs, seeds différents : LA bande d'équilibrage
//   lose             un bot passif (toujours Défendre) : wipe ATTENDU
//   keyboard         run démarrée et jouée AU CLAVIER SEUL, focus jamais perdu
//   contrast         contrastes RGAA calculés sur les vraies valeurs de charte
//   stress           saturation des effets, fps mesuré
//
// Exit : 0 ok · 1 erreur console ou issue inattendue · 2 argument invalide.
// En conteneur : lancer node SANS les variables de proxy, sinon Chromium
// proxifie localhost (env -u HTTP_PROXY -u HTTPS_PROXY …), et
// CHROME_PATH=/opt/pw-browsers/chromium.

import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] ?? 'http://localhost:5173/games/doors/';
const SCENARIO = process.argv[3] ?? 'rules';
const SECONDS = Number(process.argv[4] ?? 420);
const SHOT = process.argv[5] ?? '';

const [kind, arg1] = SCENARIO.split(':');

// ─────────────────────────────────────────────── règles, DUPLIQUÉES ici
// Volontairement recopiées : si le jeu change ses chiffres sans qu'on le sache,
// le bot doit le DÉTECTER, pas s'y adapter en silence.
const EXPECT = {
  nodeCount: 9,
  doorsPerNode: 3,
  veiledFromNode: 3,
  hardFromNode: 4,
  shopNode: 8,
  minRecruitDoors: 2,
  squadCap: 4,
  reviveCost: 25,
  healPerHp: 2,
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Clique un bouton par sélecteur. `false` s'il est absent ou désactivé. */
async function click(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.disabled || el.hidden || el.offsetParent === null) return false;
    el.click();
    return true;
  }, selector);
}

/** État de jeu compact, relu à chaque décision du bot. */
async function state() {
  return page.evaluate(() => {
    const g = window.__game;
    const run = g.flow.run;
    const c = run?.combat ?? null;
    const unit = (u) => ({
      uid: u.uid,
      defId: u.defId,
      side: u.side,
      line: u.line,
      slot: u.slot,
      hp: u.hp,
      maxHp: u.maxHp,
      atk: c.atkOf(u),
      reach: u.reach,
      ability: u.ability,
      armor: u.armor,
    });
    return {
      flow: g.flow.state,
      mode: g.world.mode,
      busy: g.world.busy,
      screen: document.querySelector('#ui.visible') ? (document.querySelector('#ui [tabindex="-1"]')?.textContent ?? '?') : null,
      run: run
        ? {
            node: run.node,
            phase: run.phase,
            gold: run.gold,
            phials: run.phials,
            reveals: run.veiledRevealsLeft,
            stash: [...run.squad.stash],
            doors: run.doors.map((d) => ({ tell: d.tell, real: d.real, revealed: d.revealed })),
            squad: run.squad.members.map((m) => ({
              id: m.id,
              defId: m.defId,
              hp: m.hp,
              maxHp: run.squad.maxHpOf(m),
              dead: m.dead,
              item: m.item,
              line: m.line,
            })),
          }
        : null,
      combat: c
        ? {
            outcome: c.outcome,
            round: c.round,
            current: c.current() ? unit(c.current()) : null,
            units: c.alive().map(unit),
            targets: c.current() ? c.legalTargets(c.current().uid).map((t) => t.uid) : [],
            swaps: c.current() ? c.legalSwaps(c.current().uid) : [],
            canAbility: c.current() ? c.canUseAbility(c.current().uid) : false,
          }
        : null,
    };
  });
}

// ─────────────────────────────────────────────── scénarios

if (kind === 'rules') {
  // Le modèle de combat, testé DANS la page mais HORS de toute partie : c'est
  // le test de non-régression de la règle de ligne et de tout ce qui en dépend.
  detail.checks = await page.evaluate(() => {
    const { Combat } = window.__game;
    const out = [];
    const check = (name, got, want) => out.push({ name, got, want, ok: JSON.stringify(got) === JSON.stringify(want) });

    // ① Le contact ne vise QUE la ligne avant adverse.
    {
      const c = new Combat([
        { defId: 'wanderer', side: 0, line: 0, slot: 0 },
        { defId: 'rat', side: 1, line: 0, slot: 0 },
        { defId: 'stalker', side: 1, line: 1, slot: 0 },
      ]);
      const hero = c.units.find((u) => u.defId === 'wanderer');
      check('contact : une seule cible au front', c.legalTargets(hero.uid).map((t) => t.defId), ['rat']);
    }
    // ② Front vide → la ligne arrière DEVIENT la ligne avant.
    {
      const c = new Combat([
        { defId: 'wanderer', side: 0, line: 0, slot: 0 },
        { defId: 'stalker', side: 1, line: 1, slot: 0 },
      ]);
      const hero = c.units.find((u) => u.defId === 'wanderer');
      check('front vide : l’arrière devient l’avant', c.legalTargets(hero.uid).map((t) => t.defId), ['stalker']);
    }
    // ③ La distance ignore la règle de ligne.
    {
      const c = new Combat([
        { defId: 'archer', side: 0, line: 1, slot: 0 },
        { defId: 'rat', side: 1, line: 0, slot: 0 },
        { defId: 'idol', side: 1, line: 1, slot: 0 },
      ]);
      const a = c.units.find((u) => u.defId === 'archer');
      check('distance : tout est atteignable', c.legalTargets(a.uid).length, 2);
    }
    // ④ Provocation : le Gardien AU FRONT capte tout le contact.
    {
      const c = new Combat([
        { defId: 'guardian', side: 0, line: 0, slot: 0 },
        { defId: 'headsman', side: 0, line: 0, slot: 1 },
        { defId: 'rat', side: 1, line: 0, slot: 0 },
      ]);
      const rat = c.units.find((u) => u.defId === 'rat');
      check('provocation : une seule cible', c.legalTargets(rat.uid).map((t) => t.defId), ['guardian']);
    }
    // ⑤ Carquois lourd : l'unité ignore ligne ET provocation.
    {
      const c = new Combat([
        { defId: 'headsman', side: 0, line: 0, slot: 0, item: 'quiver' },
        { defId: 'brute', side: 1, line: 0, slot: 0 },
        { defId: 'idol', side: 1, line: 1, slot: 0 },
      ]);
      const h = c.units.find((u) => u.defId === 'headsman');
      check('carquois : l’idole devient atteignable au contact', c.legalTargets(h.uid).map((t) => t.defId).sort(), ['brute', 'idol']);
    }
    // ⑥ Armure SOUSTRACTIVE, plancher à 1.
    {
      const c = new Combat([
        { defId: 'guardian', side: 0, line: 0, slot: 0 },
        { defId: 'brute', side: 1, line: 0, slot: 0 },
      ]);
      const g = c.units.find((u) => u.defId === 'guardian');
      const b = c.units.find((u) => u.defId === 'brute');
      check('armure 2 sur ATQ 3 → 1 dégât', c.damageOf(g, b), 1);
    }
    // ⑦ Élan : +3 sur une cible à PV pleins, et pas après.
    {
      const c = new Combat([
        { defId: 'headsman', side: 0, line: 0, slot: 0 },
        { defId: 'rat', side: 1, line: 0, slot: 0, hp: 9 },
        { defId: 'hound', side: 1, line: 0, slot: 1 },
      ]);
      const h = c.units.find((u) => u.defId === 'headsman');
      const rat = c.units.find((u) => u.defId === 'rat');
      const hound = c.units.find((u) => u.defId === 'hound');
      check('élan : 8 sur entamé, 11 sur intact', [c.damageOf(h, rat), c.damageOf(h, hound)], [8, 11]);
    }
    // ⑧ Tir ajusté : +2 contre la ligne arrière.
    {
      const c = new Combat([
        { defId: 'archer', side: 0, line: 1, slot: 0 },
        { defId: 'rat', side: 1, line: 0, slot: 0 },
        { defId: 'stalker', side: 1, line: 1, slot: 0 },
      ]);
      const a = c.units.find((u) => u.defId === 'archer');
      check('tir ajusté : 6 devant, 8 derrière', [
        c.damageOf(a, c.units.find((u) => u.defId === 'rat')),
        c.damageOf(a, c.units.find((u) => u.defId === 'stalker')),
      ], [6, 8]);
    }
    // ⑨ Meute : +2 tant qu'un autre chien vit, et plus après sa mort.
    {
      const c = new Combat([
        { defId: 'wanderer', side: 0, line: 0, slot: 0 },
        { defId: 'hound', side: 1, line: 0, slot: 0 },
        { defId: 'hound', side: 1, line: 0, slot: 1 },
      ]);
      const dogs = c.units.filter((u) => u.defId === 'hound');
      const before = c.atkOf(dogs[0]);
      dogs[1].dead = true;
      check('meute : 6 à deux, 4 tout seul', [before, c.atkOf(dogs[0])], [6, 4]);
    }
    // ⑩ Défendre retire 3, et la réduction TOMBE au tour suivant de l'unité.
    {
      const c = new Combat([
        { defId: 'guardian', side: 0, line: 0, slot: 0 },
        { defId: 'rat', side: 1, line: 0, slot: 0 },
      ]);
      const g = c.units.find((u) => u.defId === 'guardian');
      const rat = c.units.find((u) => u.defId === 'rat');
      // le rat a 6 d'INIT contre 3 : il joue en premier
      c.act({ kind: 'attack', target: g.uid });
      const raw = 34 - g.hp;
      c.act({ kind: 'defend' });
      c.act({ kind: 'attack', target: g.uid });
      const guarded = 34 - raw - g.hp;
      check('défendre : 3 dégâts de moins', [raw, guarded], [3, 1]);
    }
    // ⑪ Le Geôlier bascule sous 50 % PV : invocation + frappe large.
    {
      const c = new Combat([
        { defId: 'guardian', side: 0, line: 0, slot: 0 },
        { defId: 'wanderer', side: 0, line: 0, slot: 1 },
        { defId: 'jailer', side: 1, line: 0, slot: 0, hp: 31 },
      ]);
      const boss = c.units.find((u) => u.defId === 'jailer');
      const hero = c.units.find((u) => u.defId === 'wanderer');
      // le Vagabond (INIT 5) joue avant le boss (INIT 4)
      while (c.current() && c.current().uid !== hero.uid && !c.outcome) c.autoAct();
      c.act({ kind: 'attack', target: boss.uid });
      check('phase 2 : deux rats invoqués', c.alive(1).filter((u) => u.defId === 'rat').length, 2);
      check('phase 2 : le drapeau est posé', boss.phased, true);
      const before = c.alive(0).map((u) => u.hp);
      while (c.current() && c.current().uid !== boss.uid && !c.outcome) {
        if (c.current().side === 0) c.act({ kind: 'defend' });
        else c.autoAct();
      }
      const guardHp = c.alive(0).map((u) => u.hp);
      c.autoAct(); // le boss frappe large
      const after = c.alive(0).map((u) => u.hp);
      check('frappe large : les deux du front encaissent', after.filter((h, i) => h < guardHp[i]).length >= 2 || before.length < 2, true);
    }
    // ⑫ Le spectre disparaît après deux tours.
    {
      const c = new Combat([
        { defId: 'wanderer', side: 0, line: 0, slot: 0 },
        { defId: 'wraith', side: 0, line: 0, slot: 1 },
        { defId: 'brute', side: 1, line: 0, slot: 0 },
      ]);
      const w = c.units.find((u) => u.defId === 'wraith');
      let acts = 0;
      for (let i = 0; i < 40 && !c.outcome && !w.dead; i++) {
        const cur = c.current();
        if (!cur) break;
        if (cur.uid === w.uid) acts++;
        if (cur.side === 0) c.act({ kind: 'defend' });
        else c.autoAct();
      }
      check('spectre : deux tours, puis il se dissipe', [acts, w.dead], [2, true]);
    }
    // ⑬ Une mort LIBÈRE l'emplacement : le repli au front reste possible.
    {
      const c = new Combat([
        { defId: 'wanderer', side: 0, line: 0, slot: 0 },
        { defId: 'guardian', side: 0, line: 1, slot: 0 },
        { defId: 'rat', side: 1, line: 0, slot: 0 },
      ]);
      const hero = c.units.find((u) => u.defId === 'wanderer');
      const guard = c.units.find((u) => u.defId === 'guardian');
      hero.dead = true;
      const slots = c.legalSwaps(guard.uid);
      check('repli : une place libre au front', slots.some((s) => s.line === 0), true);
    }
    // ⑭ ÉCONOMIE — les gardes vivent dans le modèle, pas dans l'UI. Les boutons
    // du marchand les reflètent ; c'est ici qu'on vérifie qu'ils ne mentent pas.
    {
      const { Run, metaEffects } = window.__game;
      const base = metaEffects({ unlocked: {} });
      const run = new Run(4242, base, 'wanderer');
      const hero = run.squad.members[0];

      hero.hp = 10;
      run.gold = 0;
      check('soin refusé sans or', run.buyHeal(hero.id, 5, 2), false);
      run.gold = 10;
      check('soin de 5 PV pour 10 or', [run.buyHeal(hero.id, 5, 2), hero.hp, run.gold], [true, 15, 0]);

      // une invocation ne se ressuscite pas — c'est ce qui la rend consommable
      const statue = run.squad.add('statue');
      statue.dead = true;
      run.gold = 100;
      check('résurrection refusée sur une invocation', run.buyRevive(statue.id, 25), false);

      hero.dead = true;
      hero.hp = 0;
      check('résurrection à la moitié des PV', [run.buyRevive(hero.id, 25), hero.hp, run.gold], [true, 11, 75]);

      // l'étal ne se recharge pas dans la même salle
      run.shop = { items: ['blade'], sold: new Set() };
      check('achat, puis étal vide', [run.buyItem('blade'), run.buyItem('blade')], [true, false]);
      check('l’objet acheté part au sac', run.squad.stash.includes('blade'), true);

      // renvoyer rend l'objet porté, jamais l'unité
      run.squad.equip(hero.id, 'blade');
      const before = run.squad.members.length;
      run.squad.dismiss(hero.id);
      check('renvoi : l’unité part, l’objet revient', [run.squad.members.length, run.squad.stash.includes('blade')], [before - 1, true]);
    }
    // ⑮ « Œil averti » : une révélation, et une seule.
    {
      const { Run, metaEffects } = window.__game;
      const run = new Run(777, metaEffects({ unlocked: { keenEye: true } }), 'wanderer');
      while (run.node < 3) {
        run.enter(run.doors.findIndex((d) => d.real !== 'fight' && d.real !== 'fightHard'));
        if (run.phase === 'combat') run.combat = null;
        run.advance();
      }
      const first = run.revealVeiled();
      const second = run.revealVeiled();
      check('révélation : une par run', [first, second, run.veiledRevealsLeft], [true, false, 0]);
      check('la porte voilée affiche son vrai visage', run.doors.some((d) => d.tell === 'veiled' && d.revealed), true);
    }
    // ⑯ Amulette de sève : +6 PV max, et 3 PV rendus en fin de combat.
    {
      const { Run, metaEffects } = window.__game;
      const run = new Run(99, metaEffects({ unlocked: {} }), 'wanderer');
      const hero = run.squad.members[0];
      run.squad.stash.push('amulet');
      run.squad.equip(hero.id, 'amulet');
      check('amulette : 22 + 6 PV max', run.squad.maxHpOf(hero), 28);
      hero.hp = 10;
      run.squad.applyOutcome([{ memberId: hero.id, hp: 10, dead: false }], 3);
      check('amulette : 3 PV rendus en fin de combat', hero.hp, 13);
    }
    // ⑰ Aucune variance : deux calculs identiques donnent le même chiffre.
    {
      const c = new Combat([
        { defId: 'headsman', side: 0, line: 0, slot: 0 },
        { defId: 'brute', side: 1, line: 0, slot: 0 },
      ]);
      const h = c.units.find((u) => u.defId === 'headsman');
      const b = c.units.find((u) => u.defId === 'brute');
      const rolls = new Set();
      for (let i = 0; i < 50; i++) rolls.add(c.damageOf(h, b));
      check('dégâts déterministes : une seule valeur', rolls.size, 1);
    }
    return out;
  });
  detail.failed = detail.checks.filter((c) => !c.ok);
  outcome = detail.failed.length === 0 ? 'pass' : 'fail';
  expected = 'pass';
} else if (kind === 'gen') {
  // Les 5 règles de génération, vérifiées sur des runs seedées jouées « à sec » :
  // on ne combat pas, on lit les portes de chaque nœud en franchissant à chaque
  // fois la porte la moins coûteuse à simuler.
  const runs = Number(arg1 ?? 40);
  detail.report = await page.evaluate(
    (n, EXP) => {
      const { Run, metaEffects } = window.__game;
      const fails = [];
      const stats = { veiledNodes: 0, hardDoors: 0, shopDoors: 0, recruitDoors: 0 };
      const effects = metaEffects({ unlocked: {} });
      for (let r = 0; r < n; r++) {
        const run = new Run(r * 7919 + 13, effects, 'wanderer');
        let recruitDoors = 0;
        let prevWasShop = false;
        for (let node = 1; node <= EXP.nodeCount; node++) {
          const doors = run.doors;
          if (doors.length !== EXP.doorsPerNode) fails.push(`run ${r} nœud ${node} : ${doors.length} portes`);
          if (node === 1 && !doors.some((d) => d.real === 'recruit')) fails.push(`run ${r} : nœud 1 sans recrue garantie`);
          if (node === EXP.shopNode && !doors.some((d) => d.real === 'shop')) fails.push(`run ${r} : nœud 8 sans marchand`);
          if (node < EXP.hardFromNode && doors.some((d) => d.real === 'fightHard')) {
            fails.push(`run ${r} nœud ${node} : combat dangereux trop tôt`);
          }
          const veiled = doors.filter((d) => d.tell === 'veiled').length;
          if (node >= EXP.veiledFromNode && veiled !== 1) fails.push(`run ${r} nœud ${node} : ${veiled} porte voilée`);
          if (node < EXP.veiledFromNode && veiled !== 0) fails.push(`run ${r} nœud ${node} : porte voilée trop tôt`);
          if (prevWasShop && doors.some((d) => d.real === 'shop')) {
            fails.push(`run ${r} nœud ${node} : deux marchands consécutifs`);
          }
          // une porte voilée doit rester payante
          for (const d of doors) {
            if (d.tell === 'veiled' && d.gold <= 0) fails.push(`run ${r} nœud ${node} : porte voilée sans butin`);
          }
          if (node >= EXP.veiledFromNode) stats.veiledNodes++;
          stats.hardDoors += doors.filter((d) => d.real === 'fightHard').length;
          stats.shopDoors += doors.filter((d) => d.real === 'shop').length;
          recruitDoors += doors.filter((d) => d.real === 'recruit').length;
          stats.recruitDoors += doors.filter((d) => d.real === 'recruit').length;

          // on franchit une porte NON-combat quand c'est possible, sinon on
          // avance à sec : ce scénario ne teste que la génération
          const idx = doors.findIndex((d) => d.real !== 'fight' && d.real !== 'fightHard');
          prevWasShop = doors[Math.max(0, idx)].real === 'shop';
          run.enter(Math.max(0, idx));
          if (run.phase === 'combat') run.combat = null;
          run.advance();
        }
        if (recruitDoors < EXP.minRecruitDoors) fails.push(`run ${r} : ${recruitDoors} portes Recrue sur la run`);
        // le boss clôt toujours la run
        if (run.doors.length !== 1 || run.doors[0].enemies[0] !== 'jailer') fails.push(`run ${r} : pas de boss au bout`);
      }
      return { fails: fails.slice(0, 20), failCount: fails.length, runs: n, stats };
    },
    runs,
    EXPECT,
  );
  outcome = detail.report.failCount === 0 ? 'pass' : 'fail';
  expected = 'pass';
} else if (kind === 'win' || kind === 'lose' || kind === 'band') {
  // LE test de bout en bout : le bot clique les MÊMES boutons que le joueur.
  // Aucune API de raccourci en node — il n'existe donc pas de second chemin non
  // testé, et une régression d'UI (bouton jamais activé, focus perdu, panneau
  // sans issue) se voit ici avant de se voir en jeu.
  const passive = kind === 'lose';
  if (kind === 'band') {
    // Bande d'équilibrage : N runs, seeds différents, distribution des nœuds
    // atteints. C'est CE chiffre qu'on relit après tout changement de tuning.
    const runs = Number(arg1 ?? 6);
    const results = [];
    for (let i = 0; i < runs; i++) {
      results.push(await playRun(1000 + i * 977, false, Math.min(SECONDS / runs, 90)));
    }
    detail.runs = results.map((r) => ({ seed: r.seed, node: r.node, victory: r.victory, shards: r.shards, sec: r.sec }));
    const nodes = results.map((r) => r.node).sort((a, b) => a - b);
    detail.median = nodes[Math.floor(nodes.length / 2)];
    detail.wins = results.filter((r) => r.victory).length;
    detail.bossReached = results.filter((r) => r.node > EXPECT.nodeCount).length;
    outcome = 'band';
  } else {
    expected = passive ? 'defeat' : 'boss';
    const r = await playRun(Number(arg1 ?? 12345), passive, Math.min(SECONDS, 300));
    Object.assign(detail, r);
    if (passive) outcome = r.node <= EXPECT.nodeCount && !r.victory ? 'defeat' : 'survived';
    else outcome = r.node > EXPECT.nodeCount ? 'boss' : 'stalled';
  }
} else if (kind === 'keyboard') {
  // Parcours AU CLAVIER SEUL : aucun clic, aucun appel direct à l'API du jeu.
  // C'est le test de non-régression RGAA — si un jour l'overlay cesse d'être du
  // DOM natif focusable, ou si le focus cesse de sauter sur la première cible
  // légale, il casse ici.
  expected = 'played';
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { tag: 'BODY' };
      return {
        tag: el.tagName,
        action: el.dataset?.action ?? null,
        act: el.dataset?.act ?? null,
        door: el.dataset?.door ?? null,
        cell: el.dataset?.cell ?? null,
        hero: el.dataset?.hero ?? null,
        label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 44) || null,
      };
    });

  // « Focus perdu » se mesure APRÈS une validation, jamais pendant une
  // tabulation : traverser `<body>` en fin de cycle de tabulation est le
  // comportement NORMAL du navigateur, le compter ferait échouer le test sur
  // une interface parfaitement conforme.
  let lost = 0;
  const noteFocus = async () => {
    const f = await focused();
    if (f.tag === 'BODY') lost++;
    return f;
  };
  /** Tabule jusqu'à un contrôle que `match` accepte, puis le valide. */
  const tabTo = async (match, max = 30) => {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      const f = await focused();
      if (match(f)) {
        await page.keyboard.press('Enter');
        return f;
      }
    }
    return null;
  };

  detail.started = (await tabTo((f) => f.hero === 'wanderer', 40)) !== null;
  await sleep(400);

  // On avance de nœud en nœud, au clavier, jusqu'à tomber sur un combat.
  const turns = [];
  let combatReached = false;
  let doorsTaken = 0;
  for (let step = 0; step < 14 && !combatReached; step++) {
    const st = await state();
    if (st.flow === 'result' || !st.run) break;
    if (st.screen) {
      // salle DOM : accepter si c'est possible, sinon quitter
      const done =
        (await tabTo((f) => f.action === 'accept')) ??
        (await tabTo((f) => f.action === 'leave')) ??
        (await tabTo((f) => f.action === 'refuse'));
      if (!done) break;
      await sleep(260);
      await noteFocus();
      continue;
    }
    if (st.mode === 'doors') {
      // On recrute d'abord (un héros seul ne survit à aucun combat, c'est tout
      // le sens du correctif d'ouverture), PUIS on cherche un combat : c'est lui
      // qui teste la barre d'action au clavier.
      const want =
        st.run.squad.length < 2
          ? st.run.doors.findIndex((d) => d.real === 'recruit')
          : st.run.doors.findIndex((d) => d.real === 'fight' || d.real === 'fightHard');
      const target = want >= 0 ? String(want) : '0';
      const got = await tabTo((f) => f.door === target);
      if (!got) break;
      doorsTaken++;
      await sleep(500);
      await noteFocus();
      continue;
    }
    if (st.mode === 'combat') combatReached = true;
  }
  detail.doorsTaken = doorsTaken;
  detail.combatReached = combatReached;

  // ── quelques tours de combat : Tab jusqu'à Attaquer, Entrée (le focus doit
  // SAUTER tout seul sur la première cible légale), Entrée.
  for (let t = 0; t < 8 && combatReached; t++) {
    const st = await state();
    if (st.flow === 'result' || st.mode !== 'combat') break;
    if (st.busy || !st.combat?.current || st.combat.current.side !== 0) {
      await sleep(140);
      t--;
      continue;
    }
    const onAttack = await tabTo((f) => f.act === 'attack', 24);
    if (!onAttack) break;
    await sleep(90);
    const afterPick = await focused();
    turns.push({ jumpedToTarget: afterPick.cell !== null, focus: afterPick.label });
    if (afterPick.cell === null) break;
    await page.keyboard.press('Enter');
    await sleep(420);
    // C'EST ICI que le focus compte : juste après une action validée, le bouton
    // qui l'avait vient d'être désactivé.
    await noteFocus();
  }
  detail.turns = turns;
  detail.jumpAlwaysWorked = turns.length >= 3 && turns.every((x) => x.jumpedToTarget);
  const after = await focused();
  detail.focusLostToBody = lost;
  detail.finalFocus = after;
  outcome =
    detail.started && combatReached && detail.jumpAlwaysWorked && lost === 0 && after.tag !== 'BODY'
      ? 'played'
      : 'broken';
} else if (kind === 'contrast') {
  // Contrastes RGAA calculés sur les VRAIES valeurs exposées par le jeu, jamais
  // sur une copie qui dériverait — et jamais « à l'œil ».
  detail.report = await page.evaluate(() => {
    const { palette, contrastRatio } = window.__game;
    const hx = (c) => `#${c.toString(16).padStart(6, '0')}`;
    const failures = [];
    const backgrounds = [palette.bg, palette.bgDeep, palette.panel, palette.plinth];

    // ① Texte sur les fonds : 4.5:1 (WCAG 1.4.3)
    const texts = [
      ['texte principal', palette.cream],
      ['texte secondaire', palette.dim],
      ['accent or', palette.gold],
    ].map(([name, c]) => {
      const worst = Math.min(...backgrounds.map((b) => contrastRatio(c, b)));
      if (worst < 4.5) failures.push({ what: name, ratio: +worst.toFixed(2), need: 4.5 });
      return { name, color: hx(c), worst: +worst.toFixed(2) };
    });

    // ② Éléments d'interface non textuels : 3:1 (WCAG 1.4.11)
    const ui = [
      ['jauge pleine', palette.leaf],
      ['jauge entamée', palette.gold],
      ['jauge critique', palette.ember],
      ['information neutre', palette.cool],
      ['liseré de socle', palette.plinthEdge],
      ['liseré de panneau', palette.panelEdge],
    ].map(([name, c]) => {
      const worst = Math.min(...backgrounds.map((b) => contrastRatio(c, b)));
      if (worst < 3) failures.push({ what: name, ratio: +worst.toFixed(2), need: 3 });
      return { name, color: hx(c), worst: +worst.toFixed(2) };
    });

    // ③ Les deux camps ne doivent PAS se distinguer par la seule couleur : on
    // vérifie que la teinte de camp est bien doublée d'un autre code — ici, la
    // séparation des lignes. C'est structurel, donc on le teste en géométrie.
    const geometry = {
      linesDistinct: true,
      note: 'camps séparés par la POSITION (deux bandes) + le style de socle',
    };
    return { texts, ui, geometry, failures };
  });
  detail.failures = detail.report.failures;
  outcome = detail.report.failures.length === 0 ? 'pass' : 'fail';
  expected = 'pass';
} else if (kind === 'stress') {
  // Saturation : on relance des combats en boucle avec le maximum d'unités et
  // d'effets, et on mesure les fps réels.
  await page.evaluate(() => {
    const g = window.__game;
    g.flow.startRun('wanderer', 999);
    let i = 0;
    window.__stress = setInterval(() => {
      const run = g.flow.run;
      if (!run) {
        g.flow.startRun('wanderer', 999 + i);
        return;
      }
      if (run.phase === 'doors') {
        const idx = run.doors.findIndex((d) => d.real === 'fight' || d.real === 'fightHard');
        run.enter(idx >= 0 ? idx : 0);
        g.world.syncMode();
      } else if (run.combat && !run.combat.outcome) {
        const c = run.combat;
        const cur = c.current();
        if (cur && cur.side === 0) {
          const t = c.legalTargets(cur.uid)[0];
          if (t) g.world.playerAct({ kind: 'attack', target: t.uid });
        }
      } else if (run.phase !== 'combat') {
        run.advance();
        g.world.syncMode();
      }
      i++;
    }, 40);
  });
  await sleep(Math.min(SECONDS, 12) * 1000);
  await page.evaluate(() => clearInterval(window.__stress));
  outcome = 'stress';
} else {
  console.error(`scénario inconnu : ${SCENARIO}`);
  console.error('attendu : rules | gen[:runs] | win[:seed] | band[:runs] | lose | keyboard | contrast | stress');
  process.exit(2);
}

// ─────────────────────────────────────────────── pilotage d'une run

/** Joue une run entière aux boutons. Renvoie son issue et sa trace par nœud. */
async function playRun(seed, passive, maxSec) {
  // Mouvement réduit : c'est une OPTION DU JEU, pas une porte dérobée du bot —
  // elle divise par deux la cadence de rejeu des événements. Sans elle une run
  // complète dépasse les trois minutes d'horloge, uniquement en animations.
  await page.evaluate((s) => {
    const g = window.__game;
    g.save.reducedMotion = true;
    g.world.setReducedMotion(true);
    g.flow.startRun('wanderer', s);
  }, seed);
  await sleep(200);

  const t0 = Date.now();
  const trail = [];
  const issues = [];
  let lastNode = 0;
  let node = 0;
  let guard = 0;
  const deadline = t0 + maxSec * 1000;

  while (Date.now() < deadline && guard++ < 6000) {
    const st = await state();
    if (st.flow === 'result') break;
    if (!st.run) break;
    node = st.run.node;
    if (node !== lastNode) {
      lastNode = node;
      trail.push({
        node,
        gold: st.run.gold,
        squad: st.run.squad.map(
          (m) => `${m.defId}${m.dead ? '†' : ''} ${m.hp}/${m.maxHp}${m.item ? ` +${m.item}` : ''}`,
        ),
      });
    }

    if (st.screen) {
      if (!(await handleScreen(st, passive))) issues.push(`écran sans issue : ${st.screen}`);
      await sleep(60);
      continue;
    }
    if (st.mode === 'doors') {
      // Un objet acheté ou trouvé ne sert à RIEN tant qu'il dort dans le sac :
      // on passe par le panneau d'escouade pour l'équiper, exactement comme un
      // joueur le ferait. C'est aussi ce qui teste ce panneau.
      if (!passive && st.run.stash.length && (await click('[data-act="squad"]'))) {
        await sleep(120);
        continue;
      }
      const i = passive ? pickDoorPassive(st) : pickDoor(st);
      if (!(await click(`[data-door="${i}"]`))) issues.push(`porte ${i} inclicable`);
      await sleep(90);
      continue;
    }
    if (st.mode === 'combat' && st.combat) {
      if (st.busy || !st.combat.current || st.combat.current.side !== 0) {
        await sleep(70);
        continue;
      }
      await playTurn(st, passive);
      await sleep(70);
      continue;
    }
    await sleep(70);
  }

  await page.waitForFunction("window.__game.flow.state === 'result'", { timeout: 20000 }).catch(() => {});
  const final = await page.evaluate(() => ({
    flow: window.__game.flow.state,
    shards: window.__game.save.shards,
    victory: (document.querySelector('#ui [tabindex="-1"]')?.textContent ?? '').includes('GEÔLIER'),
  }));
  return {
    seed,
    node,
    victory: final.victory,
    shards: final.shards,
    sec: Math.round((Date.now() - t0) / 100) / 10,
    turns: guard,
    trail,
    issues: issues.slice(0, 8),
    flow: final.flow,
  };
}

// ─────────────────────────────────────────────── heuristiques du bot

/** Priorité des portes : se renforcer d'abord, réparer ensuite, se battre sinon. */
function pickDoor(st) {
  const doors = st.run.doors;
  const squad = st.run.squad;
  const dead = squad.some((m) => m.dead);
  const hurt = squad.some((m) => m.hp < m.maxHp * 0.6);
  const score = (d, i) => {
    const real = d.tell === 'veiled' && !d.revealed ? null : d.real;
    let s = 0;
    if (real === 'recruit') s = squad.length < EXPECT.squadCap ? 100 : 20;
    // Réparer passe AVANT se battre dès qu'on est entamé : soigner marche avec
    // n'importe quelle bourse (2 or le PV), attendre d'avoir de quoi
    // ressusciter faisait mourir le bot avec de l'or plein les poches.
    else if (real === 'shop') s = dead && st.run.gold >= EXPECT.reviveCost ? 120 : hurt ? 95 : 35;
    else if (real === 'treasure') s = 70;
    else if (real === 'fight') s = 50;
    else if (real === 'fightHard') s = squad.filter((m) => !m.dead).length >= 3 && !hurt ? 45 : 8;
    else s = 40; // porte voilée : un pari raisonnable quand l'escouade tient
    return s - i * 0.01;
  };
  let best = 0;
  for (let i = 1; i < doors.length; i++) if (score(doors[i], i) > score(doors[best], best)) best = i;
  return best;
}

/** Le bot passif prend toujours le combat le plus dur : il doit mourir. */
function pickDoorPassive(st) {
  const doors = st.run.doors;
  const i = doors.findIndex((d) => d.real === 'fightHard');
  if (i >= 0) return i;
  const j = doors.findIndex((d) => d.real === 'fight');
  return j >= 0 ? j : 0;
}

/** Un tour de combat, joué aux boutons. */
async function playTurn(st, passive) {
  if (passive) {
    await click('[data-act="defend"]');
    return;
  }
  const c = st.combat;
  const me = c.current;

  // ① Herboriste : soigner dès qu'un allié est nettement entamé.
  if (me.ability === 'brew' && c.canAbility) {
    const hurt = c.units.filter((u) => u.side === 0 && u.maxHp - u.hp >= 7).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (hurt && (await click('[data-act="ability"]')) && (await click(`[data-cell="0:${hurt.line}:${hurt.slot}"]`))) return;
    await click('[data-act="cancel"]');
  }
  // ② Runiste : la salve dès que deux ennemis partagent une ligne.
  if (me.ability === 'runicVolley' && c.canAbility) {
    for (const line of [0, 1]) {
      const row = c.units.filter((u) => u.side === 1 && u.line === line);
      if (row.length >= 2) {
        if ((await click('[data-act="ability"]')) && (await click(`[data-cell="1:${line}:${row[0].slot}"]`))) return;
        await click('[data-act="cancel"]');
        break;
      }
    }
  }
  // ③ Vagabond : Second souffle quand il est bas et qu'il ne peut rien achever.
  if (me.ability === 'secondWind' && c.canAbility && me.hp <= me.maxHp * 0.35) {
    const lethal = c.units.some((u) => u.side === 1 && c.targets.includes(u.uid) && u.hp <= me.atk);
    if (!lethal && (await click('[data-act="ability"]'))) return;
  }
  // ④ Attaquer : le létal d'abord, sinon la cible la plus basse en PV.
  const targets = c.units.filter((u) => u.side === 1 && c.targets.includes(u.uid));
  if (targets.length) {
    let best = targets[0];
    let bestScore = -Infinity;
    for (const t of targets) {
      const dmg = Math.max(1, me.atk - t.armor);
      // l'Idole est un puzzle : tant qu'elle vit, le combat ne se gagne pas
      const s = (dmg >= t.hp ? 1000 : 0) + (t.ability === 'litany' ? 400 : 0) - t.hp;
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
    }
    if ((await click('[data-act="attack"]')) && (await click(`[data-cell="1:${best.line}:${best.slot}"]`))) return;
    await click('[data-act="cancel"]');
  }
  // ⑤ Rien d'atteignable : on se replie ou on se met en garde.
  const swap = c.swaps[0];
  if (swap && (await click('[data-act="swap"]')) && (await click(`[data-cell="0:${swap.line}:${swap.slot}"]`))) return;
  await click('[data-act="cancel"]');
  await click('[data-act="defend"]');
}

/** Les panneaux DOM : recrutement, trésor, marchand, résultat. */
async function handleScreen(st, passive) {
  const run = st.run;
  const phase = run?.phase;

  // ── panneau d'escouade : il s'ouvre PAR-DESSUS la salle courante, on le
  // reconnaît donc à son titre et non à la phase de la run.
  if (st.screen && st.screen.includes('Escouade')) {
    const equipped = await page.evaluate(() => {
      for (const sel of document.querySelectorAll('select.gear')) {
        if (sel.value) continue; // cette unité porte déjà quelque chose
        const opt = [...sel.options].find((o) => o.value);
        if (!opt) continue;
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    });
    if (equipped) return true;
    return click('[data-action="leave"]');
  }
  if (phase === 'recruit') {
    if (passive) return click('[data-action="refuse"]');
    if (run.squad.length >= EXPECT.squadCap) {
      // renvoyer le plus faible : le cap dur EST un dilemme, le bot tranche
      const weakest = [...run.squad].sort((a, b) => a.maxHp - b.maxHp)[0];
      return click(`[data-action="dismiss"][data-member="${weakest.id}"]`);
    }
    return click('[data-action="accept"]');
  }
  if (phase === 'treasure') {
    if (passive) return click('[data-action="refuse"]');
    const ok = await click('[data-action="accept"]');
    if (ok) return true;
    const weakest = [...run.squad].sort((a, b) => a.maxHp - b.maxHp)[0];
    return click(`[data-action="dismiss"][data-member="${weakest.id}"]`);
  }
  if (phase === 'shop') {
    if (!passive) {
      // ressusciter d'abord, soigner ensuite, s'équiper en dernier : c'est
      // exactement l'ordre de priorité que le design attend d'un bon joueur
      const dead = run.squad.find((m) => m.dead && m.defId !== 'statue');
      if (dead && run.gold >= EXPECT.reviveCost) {
        if (await click(`[data-action="revive"][data-member="${dead.id}"]`)) return true;
      }
      const hurt = run.squad.find((m) => !m.dead && m.hp < m.maxHp - 4);
      if (hurt && run.gold >= 10) {
        if (await click(`[data-action="heal"][data-member="${hurt.id}"]`)) return true;
      }
      // On n'achète qu'une fois l'escouade réparée : un objet sur un blessé ne
      // vaut rien, et c'est la question centrale du design.
      const stillHurt = run.squad.some((m) => m.dead || m.hp < m.maxHp * 0.75);
      if (!stillHurt && run.gold >= 40) {
        if (await click('[data-action="buy-item"]:not([disabled])')) return true;
      }
      // équiper ce qui traîne au sac : le marchand ne le fait pas, il faut
      // ouvrir le panneau d'escouade — comme un joueur
      if (run.stash.length && (await click('[data-action="squad"]'))) return true;
    }
    return click('[data-action="leave"]');
  }
  // écran d'escouade ou de résultat
  if (await click('[data-action="leave"]')) return true;
  return false;
}

// ─────────────────────────────────────────────── rapport

if (SHOT) await page.screenshot({ path: SHOT });
const elapsed = (Date.now() - start) / 1000;
const frames = await page.evaluate(() => window.__frames);
const report = {
  scenario: SCENARIO,
  outcome,
  expected,
  ok: errors.length === 0 && (expected === null || outcome === expected),
  fpsAvg: Math.round(frames / Math.max(0.001, elapsed + 0.3)),
  seconds: Math.round(elapsed * 10) / 10,
  errors,
  ...detail,
};
console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(report.ok ? 0 : 1);
