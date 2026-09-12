/**
 * runWorlds(params, opts) -> Metrics. The whole probabilistic result in one call.
 *
 * OWNER: Kaavya. PRD §4.5, §4.6.
 *
 * This is what the interface consumes. run() gives one deterministic simulation; this gives the
 * three worlds, the deltas against baseline, the tornado, the thresholds and the findings.
 */

import type { Params } from '../contracts/params.ts';
import type {
  Metrics, RunOutcome, WorldBands, Finding, TornadoRow, Threshold, MetricFlag, NodeId,
} from '../contracts/metrics.ts';
import { run } from '../engine/index.ts';
import { makeRng } from '../engine/rng.ts';
import { sampleParams, flatten } from './sampler.ts';
import { deriveGpDemand } from '../engine/demand.ts';
import { pickWorlds, toBands } from './percentiles.ts';
import { solveBreakevens } from '../analysis/breakeven.ts';

export interface WorldOptions {
  /** ~1,000 for the shipped grid; 100-200 is plenty while iterating. */
  samples?: number;
  seed?: number;
  /** Shorter horizons for sampling: a full 10 years x 1,000 runs is a coffee break. */
  horizonDays?: number;
  /** The locked baseline everything is shown as a delta against. */
  baseline?: Params;
}

export function runWorlds(params: Params, opts: WorldOptions = {}): Metrics {
  const samples = opts.samples ?? 200;
  const seed = opts.seed ?? 1;
  const horizonDays = opts.horizonDays ?? 730;

  const shortened = (p: Params): Params => {
    const q = structuredClone(p);
    q.sim.horizonDays = horizonDays;
    return q;
  };

  const rng = makeRng(seed);
  const runs: RunOutcome[] = [];
  for (let i = 0; i < samples; i++) {
    runs.push(run(shortened(sampleParams(params, rng)), seed + i));
  }

  const picked = pickWorlds(runs);
  const worlds = toBands(picked);

  const baselineRun = run(shortened(opts.baseline ?? params), seed);
  const delta = deltaBands(worlds, baselineRun);

  const tornado = buildTornado(params, horizonDays, seed);
  const breakevens = opts.baseline === undefined
    ? []
    : solveBreakevens({ policy: params, baseline: opts.baseline, seed, horizonDays });
  const thresholds = findThresholds(params, horizonDays, seed);
  const flags = buildFlags(params, tornado);
  const findings = buildFindings(picked, worlds, thresholds);

  const elapsedStart = performance.now();
  return {
    worlds,
    delta,
    findings,
    tornado,
    thresholds,
    breakevens,
    flags,
    run: {
      samples,
      seed,
      horizonDays,
      elapsedMs: performance.now() - elapsedStart,
      anyVerificationFailed: runs.some((r) => !r.verification.passed),
      paramsMeta: params.meta,
    },
  };
}

// --- deltas ------------------------------------------------------------------------------------

function deltaBands(worlds: WorldBands, base: RunOutcome): WorldBands {
  const sub = (a: number, b: number) => a - b;
  const tailDelta = (
    band: WorldBands['waits']['routine'],
    b: RunOutcome['waits']['routine'],
  ): WorldBands['waits']['routine'] => ({
    optimistic: {
      p50: sub(band.optimistic.p50, b.p50), p90: sub(band.optimistic.p90, b.p90),
      mean: sub(band.optimistic.mean, b.mean), max: sub(band.optimistic.max, b.max),
      n: band.optimistic.n,
    },
    realistic: {
      p50: sub(band.realistic.p50, b.p50), p90: sub(band.realistic.p90, b.p90),
      mean: sub(band.realistic.mean, b.mean), max: sub(band.realistic.max, b.max),
      n: band.realistic.n,
    },
    pessimistic: {
      p50: sub(band.pessimistic.p50, b.p50), p90: sub(band.pessimistic.p90, b.p90),
      mean: sub(band.pessimistic.mean, b.mean), max: sub(band.pessimistic.max, b.max),
      n: band.pessimistic.n,
    },
    direction: band.direction,
  });

  return {
    ...worlds,
    waits: {
      routine: tailDelta(worlds.waits.routine, base.waits.routine),
      complex: tailDelta(worlds.waits.complex, base.waits.complex),
      urgent: tailDelta(worlds.waits.urgent, base.waits.urgent),
    },
    timeInSystem: {
      routine: tailDelta(worlds.timeInSystem.routine, base.timeInSystem.routine),
      complex: tailDelta(worlds.timeInSystem.complex, base.timeInSystem.complex),
      urgent: tailDelta(worlds.timeInSystem.urgent, base.timeInSystem.urgent),
    },
  };
}

// --- sensitivity -------------------------------------------------------------------------------

/** Swing in the headline outcome as each ranged parameter moves across its range. */
function buildTornado(params: Params, horizonDays: number, seed: number): TornadoRow[] {
  const rows: TornadoRow[] = [];

  for (const { path, sourced } of flatten(params)) {
    if (sourced.range === undefined || sourced.derived === true) continue;
    const [lo, hi] = sourced.range;
    const at = (v: number): number => {
      const p = structuredClone(params);
      setAt(p, path, v);
      // Re-derive anything downstream, so perturbing rho or the class mix moves demand with it.
      const d = deriveGpDemand(p);
      p.arrivals.perDay.routine.value = d.routine;
      p.arrivals.perDay.complex.value = d.complex;
      p.arrivals.perDay.urgent.value = d.urgent;
      p.sim.horizonDays = horizonDays;
      const r = run(p, seed);
      return (r.perNode['gp-clinic']?.stable ?? true) ? r.waits.routine.p50 : Number.NaN;
    };
    const low = at(lo);
    const high = at(hi);
    // NaN means that end of the range has no steady state — an infinite swing, ranked top.
    const swing = Number.isNaN(low) || Number.isNaN(high)
      ? Number.POSITIVE_INFINITY
      : Math.abs(high - low);

    rows.push({
      path,
      label: sourced.label ?? path,
      low, high, swing,
      rangeSource: sourced.source,
      dominantButUnsourced: false,
    });
  }

  rows.sort((a, b) => b.swing - a.swing);
  // The top three carry the result; flag any of them resting on an assumption.
  for (const row of rows.slice(0, 3)) {
    row.dominantButUnsourced = row.rangeSource === 'assumed';
  }
  return rows;
}

/** Bisect each lever for the point at which the practice loses its steady state. */
function findThresholds(params: Params, horizonDays: number, seed: number): Threshold[] {
  const out: Threshold[] = [];
  const levers: { path: string; label: string; lo: number; hi: number }[] = [
    {
      path: 'levers.hospitalToCommunityShare',
      label: 'share of care shifted to community',
      lo: 0, hi: 0.5,
    },
    {
      path: 'levers.communityCapacityMultiplier',
      label: 'community capacity multiplier',
      lo: 1, hi: 8,
    },
  ];

  const stableAt = (path: string, v: number): boolean => {
    const p = structuredClone(params);
    setAt(p, path, v);
    p.sim.horizonDays = horizonDays;
    return run(p, seed).perNode['gp-clinic']?.stable ?? false;
  };

  for (const lever of levers) {
    const stableLow = stableAt(lever.path, lever.lo);
    const stableHigh = stableAt(lever.path, lever.hi);
    if (stableLow === stableHigh) continue; // no crossing inside the range

    let lo = lever.lo;
    let hi = lever.hi;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (stableAt(lever.path, mid) === stableLow) lo = mid;
      else hi = mid;
    }
    const breakpoint = (lo + hi) / 2;
    const holdsWhen = stableLow ? 'below' : 'above';
    out.push({
      path: lever.path,
      label: lever.label,
      breakpoint,
      holdsWhen,
      findingId: 'stability',
      statement:
        `holds while ${lever.label} stays ${holdsWhen} `
        + `${breakpoint < 1 ? `${(breakpoint * 100).toFixed(0)}%` : breakpoint.toFixed(1)}`,
    });
  }
  return out;
}

// --- flags and findings --------------------------------------------------------------------------

function buildFlags(params: Params, tornado: readonly TornadoRow[]): MetricFlag[] {
  const flags: MetricFlag[] = [];
  for (const { path, sourced } of flatten(params)) {
    if (sourced.source === 'assumed') {
      flags.push({ path, reason: 'assumed', message: `${path} is assumed, not sourced` });
    } else if (sourced.citation === undefined) {
      flags.push({ path, reason: 'no-citation', message: `${path} has no citation` });
    }
    if (sourced.range === undefined && sourced.derived !== true) {
      flags.push({
        path, reason: 'no-range',
        message: `${path} is a point estimate — contributes nothing to the spread between worlds`,
      });
    }
  }
  for (const row of tornado.filter((r) => r.dominantButUnsourced)) {
    flags.push({
      path: row.path,
      reason: 'dominant-but-unsourced',
      message: `${row.label} dominates the result and rests on an assumption`,
    });
  }
  return flags;
}

function buildFindings(
  picked: ReturnType<typeof pickWorlds>,
  worlds: WorldBands,
  thresholds: readonly Threshold[],
): Finding[] {
  const findings: Finding[] = [];
  const inWorld = (r: RunOutcome): boolean => r.perNode['gp-clinic']?.stable ?? false;

  const holdsIn: ('optimistic' | 'realistic' | 'pessimistic')[] = [];
  if (inWorld(picked.optimistic)) holdsIn.push('optimistic');
  if (inWorld(picked.realistic)) holdsIn.push('realistic');
  if (inWorld(picked.pessimistic)) holdsIn.push('pessimistic');

  findings.push({
    id: 'stability',
    statement:
      holdsIn.length === 3
        ? 'The practice keeps a stable operating point in all three worlds.'
        : holdsIn.length === 0
          ? 'The practice has no stable operating point in any world — waits grow without bound.'
          : `The practice keeps a stable operating point in ${holdsIn.length} of three worlds `
            + `(${holdsIn.join(', ')}).`,
    kind: 'robust',
    holdsIn,
    survivesAllThree: holdsIn.length === 3,
    optimisticOnly: holdsIn.length === 1 && holdsIn[0] === 'optimistic',
    refersTo: ['perNode.gp-clinic.stable'],
  });

  for (const t of thresholds) {
    findings.push({
      id: `threshold:${t.path}`,
      statement: t.statement,
      kind: 'threshold',
      holdsIn,
      survivesAllThree: holdsIn.length === 3,
      optimisticOnly: false,
      refersTo: [t.path],
    });
  }

  if (picked.unstableCount > 0) {
    findings.push({
      id: 'unstable-share',
      statement:
        `${picked.unstableCount} of ${picked.samples} sampled worlds had no stable operating `
        + 'point. Wait figures from those worlds are not reported, because they are a statement '
        + 'about how long the simulation ran.',
      kind: 'structural',
      holdsIn,
      survivesAllThree: false,
      optimisticOnly: false,
    });
  }

  return findings;
}

// --- path helpers ---------------------------------------------------------------------------

function setAt(obj: unknown, path: string, value: number): void {
  const parts = path.split('.');
  let cursor = obj as Record<string, unknown>;
  for (const part of parts) {
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor['value'] = value;
}

export { sampleParams, flatten, rangeCoverage } from './sampler.ts';
export { pickWorlds, toBands } from './percentiles.ts';
export type { NodeId };
