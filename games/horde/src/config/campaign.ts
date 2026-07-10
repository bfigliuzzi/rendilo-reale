import { BIOME_COUNT, GIGA_FROM_LEVEL, ULTRA_EVERY, ULTRA_HP_MUL } from './balance';
import { mulberry32, pickWeighted, rangeOf } from '@shared/rng';
import {
  gateAdd,
  gateMul,
  type EnemyKind,
  type LevelDef,
  type LevelEvent,
} from './levels';

/**
 * Niveau de campagne n (1-based), généré procéduralement à partir d'un seed :
 * même seed = niveau identique (le « rejouer ce tirage » du flow), seed
 * différent = nouveau tirage. La difficulté monte via les PV (hpMul), les
 * effectifs, la part de runners/brutes et le boss final.
 */
export function makeCampaignLevel(n: number, seed = 0xc0ffee + n * 7919): LevelDef {
  const rand = mulberry32(seed);
  // le biome est tiré EN PREMIER : lié au seed de la run, indépendant du reste du tirage
  const biome = Math.floor(rand() * BIOME_COUNT);
  // campagne infinie : longueur plafonnée, pente des PV adoucie au-delà de N10
  // (le grind de la boutique — coûts exponentiels — fait « galérer un peu plus »).
  // La pente CASSE à N4 : N1-N3 se franchissent à la skill pure, ensuite le mur —
  // la boutique doit devenir un passage obligé tous les 2 niveaux au maximum.
  const len = Math.min(6500 + n * 700, 13500);
  const hpMul = n <= 3 ? 1 + 0.25 * (n - 1) : n <= 10 ? 1.5 + 0.4 * (n - 3) : 4.3 + 0.2 * (n - 10);
  const events: LevelEvent[] = [];

  // ouverture un peu plus généreuse : l'apocalypse exige un matelas de départ
  events.push({ at: 250, type: 'gates', left: gateAdd(6 + 2 * n), right: gateMul(2) });

  let at = 600;
  let sinceGates = 0;
  while (at < len - 1400) {
    const progress = at / len;
    const roll = rand();
    sinceGates++;
    // une porte au moins tous les 3 segments — l'attrition continue exige une croissance continue
    if (sinceGates >= 3 || roll < 0.14) {
      sinceGates = 0;
      const good = rand() < 0.55 ? gateMul(2) : gateAdd(Math.round(9 + 2 * n + progress * 18));
      const bad =
        rand() < 0.6
          ? gateAdd(-Math.round(6 + progress * 16))
          : gateAdd(Math.round(2 + progress * 4));
      // dans la moitié difficile, parfois deux pièges : limiter la casse fait partie du jeu
      const trap = progress > 0.5 && rand() < 0.15;
      const worst = gateAdd(-Math.round(10 + progress * 20));
      const [left, right] = trap
        ? rand() < 0.5
          ? [bad, worst]
          : [worst, bad]
        : rand() < 0.5
          ? [good, bad]
          : [bad, good];
      events.push({ at, type: 'gates', left, right });
    } else if (roll < 0.3) {
      const hp = Math.round((110 + progress * 280 + n * 60) * rangeOf(rand, 0.8, 1.2));
      const variant = pickWeighted(rand, [
        ['hp', 0.32],
        ['explosive', 0.26],
        ['damage', 0.14],
        ['shield', 0.12],
        ['drone', 0.09],
        ['gold', 0.07],
      ] as const);
      if (rand() < 0.4) {
        // paire bloquante : TOUJOURS au moins une caisse cassable sans souffle —
        // deux explosives seraient un péage de dégâts inesquivable, donc injuste
        const flankerRoll = rand() < 0.5;
        const flanker = variant === 'explosive' ? 'hp' : flankerRoll ? 'explosive' : 'hp';
        events.push({ at, type: 'crate', hp, xNorm: 0.28, variant });
        events.push({ at, type: 'crate', hp, xNorm: 0.72, variant: flanker });
      } else {
        events.push({ at, type: 'crate', hp, xNorm: rangeOf(rand, 0.3, 0.7), variant });
      }
    } else {
      const kind = pickWeighted<EnemyKind>(rand, [
        ['grunt', 0.55],
        ['runner', 0.24],
        ['brute', n >= 2 ? 0.12 : 0],
        ['kamikaze', n >= 2 ? 0.08 : 0],
        ['sniper', n >= 3 ? 0.06 : 0],
        ['elite', n >= 4 ? 0.05 : 0],
      ]);
      // ×1,5 sur la masse totale, mais chargé vers la fin : début jouable, fin déluge
      // (surcroît de masse à partir de N4 — la cassure de difficulté de hpMul)
      const base = 14 + (n - 1) * 4 + Math.max(0, n - 3) * 2 + progress * (64 + n * 16);
      let count =
        kind === 'brute'
          ? Math.round(4 + n + progress * 12)
          : kind === 'elite'
            ? Math.round(2 + n * 0.6 + progress * 4)
            : kind === 'sniper'
              ? Math.round(2 + n * 0.7)
              : kind === 'kamikaze'
                ? Math.round(base * 0.35)
                : Math.round(base * (kind === 'runner' ? 0.55 : 1) * rangeOf(rand, 0.8, 1.25));
      // garantie anti-loterie : pas de méga-horde dans le premier tiers, quel que soit le tirage
      if (progress < 0.33 && kind !== 'brute') count = Math.min(count, 16 + n * 4);
      // plafond absolu : au-delà, le pool sature — les PV portent l'escalade
      count = Math.min(count, kind === 'grunt' || kind === 'runner' || kind === 'kamikaze' ? 220 : 40);
      const pattern = pickWeighted(rand, [
        ['grid', 0.4],
        ['blob', 0.35],
        ['stream', 0.25],
      ] as const);
      events.push({ at, type: 'horde', kind, count, pattern, width: 260 + progress * 160 });
      // seconde vague simultanée, de plus en plus fréquente (même plafond absolu)
      if (progress > 0.35 && rand() < 0.4) {
        events.push({
          at: at + 60,
          type: 'horde',
          kind: 'runner',
          count: Math.min(120, Math.round(base * 0.5)),
          pattern: 'stream',
        });
      }
    }
    at += 280 + rand() * 260;
  }

  // murs de pics (dès N2) : dégrossissent la horde qui les traverse. Jamais
  // toute la voie (le centre du mur est collé à un bord), et jamais à hauteur
  // d'une porte ou d'une caisse — pas de pince inesquivable.
  if (n >= 2) {
    const wallCount = Math.min(4, 1 + Math.floor(n / 3));
    for (let k = 0; k < wallCount; k++) {
      const wallAt =
        len * (0.3 + (0.5 * k) / Math.max(1, wallCount - 1 || 1)) + rangeOf(rand, -150, 150);
      const nearBlocking = events.some(
        (e) => (e.type === 'gates' || e.type === 'crate') && Math.abs(e.at - wallAt) < 260,
      );
      if (nearBlocking) continue;
      const widthFrac = rangeOf(rand, 0.34, 0.5);
      const xNorm = rand() < 0.5 ? widthFrac / 2 : 1 - widthFrac / 2;
      events.push({ at: wallAt, type: 'spikes', xNorm, widthFrac });
    }
  }

  const ultra = n % ULTRA_EVERY === 0; // niveau boss : l'arène finale remplace la ligne d'arrivée
  // surcroît N4+ borné (les niveaux ultra ont déjà leur ×ULTRA_HP_MUL serré)
  const bossHp = Math.round(
    500 *
      (1 + 0.7 * Math.min(n, 12) + 0.4 * Math.max(0, n - 12)) *
      (ultra ? ULTRA_HP_MUL : 1) *
      Math.min(1.6, 1 + 0.06 * Math.max(0, n - 3)),
  );
  events.push({ at: len - 700, type: 'boss', hp: bossHp, final: true, ultra });
  // filet de sécurité : distancer le boss vaut aussi victoire (il punit au contact)…
  // …sauf en niveau boss : l'ultra est épinglé en haut, seule sa mort libère
  if (!ultra) events.push({ at: len + 400, type: 'finish' });

  // filet continu : de petits groupes en permanence — jamais plusieurs secondes sans danger
  for (let t = 750; t < len - 900; t += 190 + rand() * 190) {
    const p = t / len;
    events.push({
      at: t,
      type: 'horde',
      kind: rand() < 0.8 ? 'grunt' : 'runner',
      count: Math.round((2 + p * 6 + n * 0.8) * rangeOf(rand, 0.7, 1.3)),
      pattern: rand() < 0.5 ? 'blob' : 'stream',
      width: 220,
    });
  }
  // mines : par petits groupes, densifiées avec la progression et le niveau
  for (let t = 1500; t < len - 1000; t += 520 + rand() * 620) {
    const cluster = 1 + Math.floor(rand() * Math.min(3, 1 + n * 0.5));
    for (let k = 0; k < cluster; k++) {
      events.push({ at: t + k * (70 + rand() * 90), type: 'mine', xNorm: rangeOf(rand, 0.12, 0.88) });
    }
  }
  events.sort((a, b) => a.at - b.at); // le spawner exige des événements triés

  return {
    scrollSpeed: 130 + Math.min(30, n * 2),
    hpMul,
    biome,
    decorSeed: seed,
    // le barrage monte en puissance avec les niveaux : au N1 il épargne le début de partie
    missileMinDist: n === 1 ? 2200 : 700,
    // le barrage continue de s'intensifier à N4+ (plancher 0,8) au lieu de
    // saturer dès N3 — il participe à la cassure de difficulté
    missileIntervalMul: Math.max(0.8, 1.5 - 0.25 * (n - 1)),
    gigaHorde: n >= GIGA_FROM_LEVEL,
    events,
  };
}

/**
 * Mode endless : seed aléatoire à chaque run, génération par tronçons via `extend`
 * — la difficulté (PV, effectifs, brutes, mini-boss) est fonction de la distance.
 */
export function makeEndlessLevel(): LevelDef {
  const seed = (Math.random() * 0x7fffffff) | 0;
  const rand = mulberry32(seed);
  const events: LevelEvent[] = [{ at: 250, type: 'gates', left: gateAdd(8), right: gateMul(2) }];
  let genAt = 600;
  let sinceGates = 0;
  let sinceBoss = 0;

  const extend = (evts: LevelEvent[], dist: number): void => {
    while (genAt < dist + 3000) {
      const d = genAt;
      const hpMul = 1 + d / 2800;
      sinceGates += 1;
      sinceBoss += 1;
      if (sinceBoss > 11 && d > 4000 && rand() < 0.4) {
        sinceBoss = 0;
        evts.push({ at: genAt, type: 'boss', hp: Math.round(400 + d / 6) });
      } else if (sinceGates > 3 && rand() < 0.35) {
        sinceGates = 0;
        // la croissance se paie : le mauvais côté est souvent un vrai piège
        const good = rand() < 0.4 ? gateMul(2) : gateAdd(Math.round(8 + d / 550));
        const bad = rand() < 0.55 ? gateAdd(-Math.round(6 + d / 600)) : gateAdd(Math.round(3 + d / 1000));
        const [left, right] = rand() < 0.5 ? [good, bad] : [bad, good];
        evts.push({ at: genAt, type: 'gates', left, right });
      } else if (rand() < 0.15) {
        const hp = Math.round(120 + d / 14);
        const variant = pickWeighted(rand, [
          ['hp', 0.32],
          ['explosive', 0.26],
          ['damage', 0.14],
          ['shield', 0.12],
          ['drone', 0.09],
          ['gold', 0.07],
        ] as const);
        evts.push({ at: genAt, type: 'crate', hp, xNorm: rangeOf(rand, 0.3, 0.7), variant });
      } else {
        const kind = pickWeighted<EnemyKind>(rand, [
          ['grunt', 0.55],
          ['runner', 0.22],
          ['brute', d > 2000 ? 0.13 : 0],
          ['kamikaze', d > 3000 ? 0.08 : 0],
          ['sniper', d > 5000 ? 0.06 : 0],
          ['elite', d > 7000 ? 0.05 : 0],
        ]);
        const count =
          kind === 'brute'
            ? Math.round(6 + d / 1000)
            : kind === 'elite'
              ? Math.round(2 + d / 3000)
              : kind === 'sniper'
                ? Math.round(2 + d / 4000)
                : kind === 'kamikaze'
                  ? Math.round(8 + d / 400)
                  : Math.min(240, Math.round((22 + d / 130) * rangeOf(rand, 0.8, 1.25)));
        const pattern = pickWeighted(rand, [
          ['grid', 0.4],
          ['blob', 0.35],
          ['stream', 0.25],
        ] as const);
        evts.push({ at: genAt, type: 'horde', kind, count, pattern, hpMul, width: 300 });
      }
      // filet continu + mines : le même traitement anti-temps-mort qu'en campagne
      evts.push({
        at: genAt + 90 + rand() * 120,
        type: 'horde',
        kind: rand() < 0.8 ? 'grunt' : 'runner',
        count: Math.round((4 + d / 600) * rangeOf(rand, 0.7, 1.3)),
        pattern: rand() < 0.5 ? 'blob' : 'stream',
        width: 220,
      });
      if (d > 1500 && rand() < 0.22) {
        evts.push({ at: genAt + 150, type: 'mine', xNorm: rangeOf(rand, 0.12, 0.88) });
      }
      // murs de pics : même garantie qu'en campagne (un bord, jamais toute la voie)
      if (d > 2200 && rand() < 0.11) {
        const widthFrac = rangeOf(rand, 0.34, 0.5);
        evts.push({
          at: genAt + 200,
          type: 'spikes',
          xNorm: rand() < 0.5 ? widthFrac / 2 : 1 - widthFrac / 2,
          widthFrac,
          hpMul,
        });
      }
      genAt += 260 + rand() * 240;
    }
    evts.sort((a, b) => a.at - b.at); // le spawner exige des événements triés
  };

  extend(events, 0);
  return {
    scrollSpeed: 135,
    biome: Math.floor(rand() * BIOME_COUNT),
    decorSeed: seed,
    missileMinDist: 2000,
    events,
    extend,
  };
}
