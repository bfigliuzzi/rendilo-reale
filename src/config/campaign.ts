import { mulberry32, pickWeighted, rangeOf } from '../core/rng';
import {
  gateAdd,
  gateMul,
  type EnemyKind,
  type LevelDef,
  type LevelEvent,
} from './levels';

/**
 * Niveau de campagne n (1-based), généré procéduralement mais SEEDÉ par n :
 * un niveau raté se rejoue à l'identique. La difficulté monte via les PV
 * (hpMul), les effectifs, la part de runners/brutes et le boss final.
 */
export function makeCampaignLevel(n: number): LevelDef {
  const rand = mulberry32(0xc0ffee + n * 7919);
  const len = 6500 + n * 700;
  const hpMul = 1 + 0.25 * (n - 1);
  const events: LevelEvent[] = [];

  // ouverture généreuse : la première porte lance la boucle de croissance
  events.push({ at: 250, type: 'gates', left: gateAdd(6 + 2 * n), right: gateMul(2) });

  let at = 600;
  let sinceGates = 0;
  while (at < len - 1400) {
    const progress = at / len;
    const roll = rand();
    sinceGates++;
    // la croissance de l'escouade est LA boucle du jeu : une porte au moins tous les 4 segments
    if (sinceGates >= 4 || roll < 0.18) {
      sinceGates = 0;
      // portes : un bon choix et un piège (ou un choix moyen)
      const good = rand() < 0.5 ? gateMul(2) : gateAdd(Math.round(8 + n * 2 + progress * 20));
      const bad =
        rand() < 0.5
          ? gateAdd(-Math.round(4 + progress * 12))
          : gateAdd(Math.round(3 + progress * 6));
      const [left, right] = rand() < 0.5 ? [good, bad] : [bad, good];
      events.push({ at, type: 'gates', left, right });
    } else if (roll < 0.3) {
      const hp = Math.round((90 + progress * 220 + n * 45) * rangeOf(rand, 0.8, 1.2));
      if (rand() < 0.35) {
        events.push({ at, type: 'crate', hp, xNorm: 0.28 });
        events.push({ at, type: 'crate', hp, xNorm: 0.72 });
      } else {
        events.push({ at, type: 'crate', hp, xNorm: rangeOf(rand, 0.3, 0.7) });
      }
    } else {
      const kind = pickWeighted<EnemyKind>(rand, [
        ['grunt', 0.65],
        ['runner', 0.25],
        ['brute', n >= 2 ? 0.12 : 0],
      ]);
      const base = 8 + n * 2 + progress * (18 + n * 3);
      const count =
        kind === 'brute'
          ? Math.round(2 + n * 0.5 + progress * 5)
          : Math.round(base * (kind === 'runner' ? 0.55 : 1) * rangeOf(rand, 0.8, 1.25));
      const pattern = pickWeighted(rand, [
        ['grid', 0.4],
        ['blob', 0.35],
        ['stream', 0.25],
      ] as const);
      events.push({ at, type: 'horde', kind, count, pattern, width: 260 + progress * 160 });
      // seconde vague simultanée dans la moitié difficile du niveau
      if (progress > 0.45 && rand() < 0.25) {
        events.push({
          at: at + 60,
          type: 'horde',
          kind: 'runner',
          count: Math.round(base * 0.4),
          pattern: 'stream',
        });
      }
    }
    at += 280 + rand() * 260;
  }

  events.push({ at: len - 700, type: 'boss', hp: Math.round(350 * (1 + 0.55 * n)), final: true });
  // filet de sécurité : distancer le boss vaut aussi victoire (il punit au contact)
  events.push({ at: len + 400, type: 'finish' });

  return { scrollSpeed: 130 + Math.min(30, n * 2), hpMul, events };
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
      const hpMul = 1 + d / 3500;
      sinceGates += 1;
      sinceBoss += 1;
      if (sinceBoss > 14 && d > 5000 && rand() < 0.3) {
        sinceBoss = 0;
        evts.push({ at: genAt, type: 'boss', hp: Math.round(300 + d / 8) });
      } else if (sinceGates > 2 && rand() < 0.35) {
        sinceGates = 0;
        // l'endless doit continuer à nourrir la croissance : portes surtout positives
        const good = rand() < 0.45 ? gateMul(2) : gateAdd(Math.round(10 + d / 400));
        const bad = rand() < 0.4 ? gateAdd(-Math.round(5 + d / 800)) : gateAdd(Math.round(4 + d / 900));
        const [left, right] = rand() < 0.5 ? [good, bad] : [bad, good];
        evts.push({ at: genAt, type: 'gates', left, right });
      } else if (rand() < 0.14) {
        const hp = Math.round(100 + d / 18);
        evts.push({ at: genAt, type: 'crate', hp, xNorm: rangeOf(rand, 0.3, 0.7) });
      } else {
        const kind = pickWeighted<EnemyKind>(rand, [
          ['grunt', 0.6],
          ['runner', 0.25],
          ['brute', d > 2500 ? 0.15 : 0],
        ]);
        const count =
          kind === 'brute'
            ? Math.round(2 + d / 2200)
            : Math.min(130, Math.round((10 + d / 260) * rangeOf(rand, 0.8, 1.25)));
        const pattern = pickWeighted(rand, [
          ['grid', 0.4],
          ['blob', 0.35],
          ['stream', 0.25],
        ] as const);
        evts.push({ at: genAt, type: 'horde', kind, count, pattern, hpMul, width: 300 });
      }
      genAt += 260 + rand() * 240;
    }
  };

  extend(events, 0);
  return { scrollSpeed: 135, events, extend };
}
