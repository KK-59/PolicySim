/**
 * Turning many sampled runs into three worlds. PRD §4.5.
 *
 * OWNER: Kaavya.
 *
 * Each world is ONE ACTUAL RUN, picked at a percentile of the outcome distribution — not a
 * field-by-field percentile across runs. That matters: a field-wise composite is not a scenario
 * that could ever occur, and the whole argument for percentiles over worst-case corners is that
 * each of the three worlds is individually plausible. Picking real runs keeps that true.
 *
 * A run with no steady state is ranked as the worst possible outcome, because it is.
 */

import type { RunOutcome, ThreeWorlds, WorldBands, NodeId } from '../contracts/metrics.ts';

export interface PickedWorlds {
  optimistic: RunOutcome;
  realistic: RunOutcome;
  pessimistic: RunOutcome;
  /** How many of the sampled runs had no stable operating point. */
  unstableCount: number;
  samples: number;
}

/**
 * Score a run so it can be ranked. Lower is better.
 *
 * Two tiers. Stable runs are ranked by the routine median wait — the number a planner would quote.
 * Unstable runs all rank below every stable one, and among THEMSELVES are ranked by how big the
 * backlog got.
 *
 * Scoring every unstable run as Infinity would leave their relative order undefined, and the sort
 * would then hand back an arbitrary member of that group for the pessimistic world — which can
 * easily look better than the realistic one. Ranking by backlog keeps the three worlds monotone.
 */
const UNSTABLE_FLOOR = 1e9;

export function score(r: RunOutcome): number {
  const gp = r.perNode['gp-clinic'];
  const broken = (gp !== undefined && !gp.stable) || !r.verification.passed;
  if (!broken) return r.waits.routine.p50;
  return UNSTABLE_FLOOR + (gp?.queueLength ?? 0);
}

export function pickWorlds(runs: readonly RunOutcome[]): PickedWorlds {
  if (runs.length === 0) throw new Error('pickWorlds: no runs');
  const ranked = [...runs].sort((a, b) => score(a) - score(b));
  const at = (p: number): RunOutcome =>
    ranked[Math.min(ranked.length - 1, Math.floor((p / 100) * ranked.length))] as RunOutcome;

  return {
    // Lower wait is better, so the FAVOURABLE tail is the 10th percentile of the wait. Naming
    // these semantically is what stops the panels being swapped.
    optimistic: at(10),
    realistic: at(50),
    pessimistic: at(90),
    unstableCount: runs.filter((r) => (r.perNode['gp-clinic']?.stable ?? true) === false).length,
    samples: runs.length,
  };
}

const NODES: readonly NodeId[] = ['gp-clinic', 'gp-admin', 'community-visit', 'test'];

/** Assemble the three picked runs into the banded shape the UI renders. */
export function toBands(w: PickedWorlds): WorldBands {
  const band = <T>(f: (r: RunOutcome) => T, direction: 'lower-is-better' | 'higher-is-better') =>
    ({
      optimistic: f(w.optimistic),
      realistic: f(w.realistic),
      pessimistic: f(w.pessimistic),
      direction,
    }) as ThreeWorlds<T>;

  const perNode: Partial<Record<NodeId, ThreeWorlds<NonNullable<RunOutcome['perNode'][NodeId]>>>> = {};
  for (const id of NODES) {
    if (w.realistic.perNode[id] === undefined) continue;
    perNode[id] = band(
      (r) => r.perNode[id] as NonNullable<RunOutcome['perNode'][NodeId]>,
      'lower-is-better',
    );
  }

  return {
    waits: {
      routine: band((r) => r.waits.routine, 'lower-is-better'),
      complex: band((r) => r.waits.complex, 'lower-is-better'),
      urgent: band((r) => r.waits.urgent, 'lower-is-better'),
    },
    timeInSystem: {
      routine: band((r) => r.timeInSystem.routine, 'lower-is-better'),
      complex: band((r) => r.timeInSystem.complex, 'lower-is-better'),
      urgent: band((r) => r.timeInSystem.urgent, 'lower-is-better'),
    },
    perNode,
    completed: {
      routine: band((r) => r.completed.routine, 'higher-is-better'),
      complex: band((r) => r.completed.complex, 'higher-is-better'),
      urgent: band((r) => r.completed.urgent, 'higher-is-better'),
    },
    rejections: band((r) => r.rejections, 'lower-is-better'),
    unfiledLetters: band((r) => r.unfiledLetters, 'lower-is-better'),
    unfiledResults: band((r) => r.unfiledResults, 'lower-is-better'),
  };
}
