import { mulberry32, pickWeighted, rangeOf } from '../core/rng';
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
  // campagne infinie : longueur plafonnée, pente des PV adoucie au-delà de N10
  // (le grind de la boutique — coûts exponentiels — fait « galérer un peu plus »)
  const len = Math.min(6500 + n * 700, 13500);
  const hpMul = n <= 10 ? 1 + 0.25 * (n - 1) : 3.25 + 0.16 * (n - 10);
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
      const base = 14 + (n - 1) * 4 + progress * (64 + n * 16);
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

  const bossHp = Math.round(500 * (1 + 0.7 * Math.min(n, 12) + 0.4 * Math.max(0, n - 12)));
  events.push({ at: len - 700, type: 'boss', hp: bossHp, final: true });
  // filet de sécurité : distancer le boss vaut aussi victoire (il punit au contact)
  events.push({ at: len + 400, type: 'finish' });

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
    biome: (n - 1) % 4,
    // le barrage monte en puissance avec les niveaux : au N1 il épargne le début de partie
    missileMinDist: n === 1 ? 2200 : 700,
    missileIntervalMul: Math.max(1, 1.5 - 0.25 * (n - 1)),
    events,
  };
}

/**
 * Mode endless : seed aléatoire à chaque run, génération par tronçons via `extend`
 * — la difficulté (PV, effectifs, brutes, mini-boss) est fonction de la distance.
 */
export function makeEndlessLevel(): LevelDef {
  const rand = mulberry32((Math.random() * 0x7fffffff) | 0);
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
      genAt += 260 + rand() * 240;
    }
    evts.sort((a, b) => a.at - b.at); // le spawner exige des événements triés
  };

  extend(events, 0);
  return {
    scrollSpeed: 135,
    biome: Math.floor(rand() * 4),
    missileMinDist: 2000,
    events,
    extend,
  };
}
