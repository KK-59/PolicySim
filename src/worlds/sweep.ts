/**
 * Sweeping one lever, in the shape the interface draws.
 *
 * OWNER: Kaavya.
 *
 * Separate from runWorlds because the cost is different. runWorlds recomputes the tornado and
 * bisects the thresholds, which is right once per policy and wasteful thirteen times over: the
 * sweep only needs the three bands at each position, so it samples and takes percentiles and
 * nothing else. That is the difference between a two-minute build step and something a user can
 * wait for.
 */

import type { Params } from '../contracts/params.ts';
import type { RunOutcome } from '../contracts/metrics.ts';
import { run } from '../engine/index.ts';
import { makeRng } from '../engine/rng.ts';
import { sampleParams } from './sampler.ts';

const MIN_PER_DAY = 1440;

export type WorldName = 'optimistic' | 'realistic' | 'pessimistic';
const WORLDS: WorldName[] = ['optimistic', 'realistic', 'pessimistic'];

export interface SweepOptions {
  /** Dotted path of the lever to sweep, e.g. 'levers.communityCapacityMultiplier'. */
  path: string;
  label: string;
  unit: string;
  baseValue: number;
  baseUnit: string;
  positions: number[];
  /** Where the uploaded policy sits on the sweep, so the chart can mark it. */
  policyIndex: number;
  samples?: number;
  horizonDays?: number;
  seed?: number;
  ghosts?: number;
}

function setAt(params: Params, path: string, value: number): void {
  const parts = path.split('.');
  let cursor = params as unknown as Record<string, unknown>;
  for (const part of parts) cursor = cursor[part] as Record<string, unknown>;
  cursor['value'] = value;
}

/** Percentile of a sorted-ascending list. */
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[i] as number;
}

export function sweepLever(base: Params, opts: SweepOptions) {
  const samples = opts.samples ?? 24;
  const horizonDays = opts.horizonDays ?? 450;
  const seed = opts.seed ?? 1;
  const ghostCount = opts.ghosts ?? 12;

  const at = (value: number, params: Params, runSeed: number): RunOutcome => {
    const p = structuredClone(params);
    setAt(p, opts.path, value);
    p.sim.horizonDays = horizonDays;
    return run(p, runSeed);
  };

  type Band = { p50: Record<WorldName, number>; p90: Record<WorldName, number>; stable: boolean };
  const routine: Band[] = [];
  const complex: Band[] = [];

  const rng = makeRng(seed);
  // One set of parameter draws reused across every position, so a difference between positions is
  // the lever and not the sample. Sampling afresh per position would put noise on the x-axis.
  const draws = Array.from({ length: samples }, () => sampleParams(base, rng));

  // Ghost curves are harvested from the runs below rather than re-run. Re-running the same draws
  // with a different seed cost as much again and drew a different line from the one the bands
  // were built out of, which is the opposite of what a ghost is for.
  const ghostTracks = new Map<number, { x: number; y: number }[]>();

  for (const value of opts.positions) {
    const routineP50: number[] = [];
    const routineP90: number[] = [];
    const complexP50: number[] = [];
    const complexP90: number[] = [];
    let stableCount = 0;

    draws.forEach((drawn, i) => {
      const r = at(value, drawn, seed + i);
      const stable = r.perNode['gp-clinic']?.stable ?? false;

      // A run with no steady state is ranked as the WORST outcome, not dropped.
      //
      // Dropping them looks tidier and is survivorship bias: the positions where the policy fails
      // are exactly the positions where the failures disappear from the average, so the curve
      // bends the wrong way and low capacity looks better than high. Infinity sorts last, and a
      // percentile landing on one is reported as "no steady state" rather than as a number.
      if (stable) stableCount++;
      routineP50.push(stable ? r.waits.routine.p50 : Number.POSITIVE_INFINITY);
      routineP90.push(stable ? r.waits.routine.p90 : Number.POSITIVE_INFINITY);
      complexP50.push(stable ? r.waits.complex.p50 : Number.POSITIVE_INFINITY);
      complexP90.push(stable ? r.waits.complex.p90 : Number.POSITIVE_INFINITY);

      if (i < ghostCount && stable) {
        const track = ghostTracks.get(i) ?? [];
        track.push({ x: value, y: r.waits.routine.p50 / MIN_PER_DAY });
        ghostTracks.set(i, track);
      }
    });

    const band = (p50: number[], p90: number[]): Band => {
      p50.sort((a, b) => a - b);
      p90.sort((a, b) => a - b);
      return {
        // Lower wait is better, so the favourable world is the LOW percentile.
        p50: { optimistic: pct(p50, 10), realistic: pct(p50, 50), pessimistic: pct(p50, 90) },
        p90: { optimistic: pct(p90, 10), realistic: pct(p90, 50), pessimistic: pct(p90, 90) },
        stable: stableCount > samples / 2,
      };
    };

    routine.push(band(routineP50, routineP90));
    complex.push(band(complexP50, complexP90));
  }

  const ghosts = [...ghostTracks.entries()]
    .filter(([, points]) => points.length > 1)
    .map(([id, points]) => ({ id, points }));

  /** Lowest position at which this world holds a steady state. Null if it never does. */
  const breakpointFor = (world: WorldName): number | null => {
    for (let i = 0; i < opts.positions.length; i++) {
      const v = routine[i]?.p50[world];
      if (v !== undefined && Number.isFinite(v)) return opts.positions[i] as number;
    }
    return null;
  };

  const series = (
    bands: Band[],
    patientClass: 'routine' | 'complex',
    metric: 'p50' | 'p90',
    label: string,
  ) => ({
    patientClass,
    metric,
    label,
    direction: 'lower-is-better' as const,
    worlds: WORLDS.map((world) => ({
      world,
      points: opts.positions.map((x, i) => {
        const v = (bands[i] as Band)[metric][world];
        return { x, y: Number.isFinite(v) ? v / MIN_PER_DAY : Number.NaN };
      }).filter((pt) => Number.isFinite(pt.y)),
    })),
    ghosts: patientClass === 'routine' ? ghosts : [],
  });

  return {
    lever: {
      path: opts.path,
      label: opts.label,
      unit: opts.unit,
      baseValue: opts.baseValue,
      baseUnit: opts.baseUnit,
      positions: opts.positions,
    },
    baselineIndex: 0,
    policyIndex: opts.policyIndex,
    breakpoint: breakpointFor('realistic'),
    breakpointByWorld: {
      optimistic: breakpointFor('optimistic'),
      realistic: breakpointFor('realistic'),
      pessimistic: breakpointFor('pessimistic'),
    },
    series: [
      series(routine, 'routine', 'p50', 'Median wait, routine'),
      series(complex, 'complex', 'p90', '90th percentile wait, complex'),
    ],
  };
}
