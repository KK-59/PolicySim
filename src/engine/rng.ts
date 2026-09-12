/**
 * Seeded RNG. The engine's only source of randomness.
 *
 * OWNER: Kaavya.
 *
 * `Math.random` must never appear anywhere under src/engine — same seed, same run, every time, or
 * the precomputed grid stops matching the live run and the accuracy panel becomes meaningless.
 */

/** mulberry32 — small, fast, good enough for queueing sims, and reproducible across engines. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** Inter-arrival time for a Poisson process of the given rate (events per unit time). */
    exponential: (rate: number): number => -Math.log(1 - next()) / rate,
    /** Uniform draw from a sourced range, for the three-worlds sampler. */
    between: (lo: number, hi: number): number => lo + next() * (hi - lo),
    /** Pick an index from a set of weights. Used for class mix and routing. */
    weighted: (weights: readonly number[]): number => {
      const total = weights.reduce((s, w) => s + w, 0);
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i] ?? 0;
        if (r <= 0) return i;
      }
      return weights.length - 1;
    },
  };
}

export interface Rng {
  next(): number;
  exponential(rate: number): number;
  between(lo: number, hi: number): number;
  weighted(weights: readonly number[]): number;
}
