/**
 * Which parameter draw IS the optimistic world?
 *
 * The three worlds are actual runs picked at percentiles of the outcome, so each one has a
 * specific set of sampled parameters behind it. This recovers those, so a world can be re-run and
 * watched rather than only summarised.
 *
 * It uses the same draws, the same seed and the same scoring as runWorlds, which is the point: the
 * pessimistic world someone scrubs through has to be the pessimistic world the chart was drawn
 * from, or the two screens are quietly describing different things.
 */

import type { Params } from '../contracts/params.ts';
import { run } from '../engine/index.ts';
import { makeRng } from '../engine/rng.ts';
import { sampleParams } from './sampler.ts';
import { score } from './percentiles.ts';

export type WorldName = 'optimistic' | 'realistic' | 'pessimistic';

export interface SelectOptions {
  samples?: number;
  horizonDays?: number;
  seed?: number;
}

export interface SelectedWorld {
  /** The sampled parameter draw behind this world. */
  params: Params;
  /** The seed it ran under, so a trace reproduces it exactly rather than approximately. */
  seed: number;
}

/** The draw and seed behind each of the three worlds. */
export function selectWorlds(
  base: Params,
  opts: SelectOptions = {},
): Record<WorldName, SelectedWorld> {
  const samples = opts.samples ?? 16;
  const horizonDays = opts.horizonDays ?? 450;
  const seed = opts.seed ?? 1;

  const rng = makeRng(seed);
  const scored = Array.from({ length: samples }, (_, i) => {
    const params = sampleParams(base, rng);
    const forRun = structuredClone(params);
    forRun.sim.horizonDays = horizonDays;
    return { params, seed: seed + i, score: score(run(forRun, seed + i)) };
  });

  scored.sort((a, b) => a.score - b.score);
  const at = (p: number): SelectedWorld => {
    const picked = scored[Math.min(scored.length - 1, Math.floor((p / 100) * scored.length))] as
      { params: Params; seed: number };
    return { params: picked.params, seed: picked.seed };
  };

  return {
    // Lower wait is better, so the favourable world is the LOW percentile. Named semantically
    // for the same reason as everywhere else: which numeric end is good depends on direction.
    optimistic: at(10),
    realistic: at(50),
    pessimistic: at(90),
  };
}
