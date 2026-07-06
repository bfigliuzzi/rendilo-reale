/** PRNG mulberry32 : rapide, seedé — un niveau de campagne est identique à chaque tentative. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Helpers sur un PRNG donné. */
export function rangeOf(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}

export function pickWeighted<T>(rand: () => number, entries: readonly [T, number][]): T {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rand() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}
