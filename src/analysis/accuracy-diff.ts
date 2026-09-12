/**
 * Predicted vs observed. PRD §4.7 step 7, §8.1 step 10.
 *
 * OWNER: Kaavya. INPUT: Oriol's observed event list. OUTPUT: Elsa's accuracy panel.
 *
 * After approved actions are applied to the real world and the clock advances, this compares what
 * the engine said would happen against what NHS-SIM actually did. It is the claim that the model
 * is a fair representation of the simulator, made checkable.
 *
 * Every divergence gets a reason. "78% matched" invites the question "and the other 22%?" — if the
 * panel cannot answer, the number is worse than useless.
 */

import type { AccuracyReport, EventDiff, EventRecord } from '../contracts/metrics.ts';

export interface DiffOptions {
  /**
   * How far apart two events can be and still count as the same event, in minutes.
   *
   * Default 120 — NHS-SIM's own delays are 60-minute steps, so anything tighter would score a
   * one-step timing difference as a miss AND an extra, double-counting a single small error.
   */
  toleranceMinutes?: number;
  /** Carried forward so the panel can accumulate over the day. */
  previous?: AccuracyReport;
}

const MS_PER_MIN = 60_000;

/** Events are the same thing if they are the same type for the same patient. */
function key(e: EventRecord): string {
  return `${e.eventType}::${e.patientId ?? ''}`;
}

export function diffEvents(
  predicted: readonly EventRecord[],
  observed: readonly EventRecord[],
  opts: DiffOptions = {},
): AccuracyReport {
  const tolerance = (opts.toleranceMinutes ?? 120) * MS_PER_MIN;

  // Bucket by identity, then match nearest-in-time within each bucket. Greedy nearest-first is
  // enough here: buckets are small (one patient, one event type) and a full assignment solver
  // would be precision the data does not support.
  const buckets = new Map<string, { pred: EventRecord[]; obs: EventRecord[] }>();
  for (const e of predicted) {
    const k = key(e);
    if (!buckets.has(k)) buckets.set(k, { pred: [], obs: [] });
    (buckets.get(k) as { pred: EventRecord[] }).pred.push(e);
  }
  for (const e of observed) {
    const k = key(e);
    if (!buckets.has(k)) buckets.set(k, { pred: [], obs: [] });
    (buckets.get(k) as { obs: EventRecord[] }).obs.push(e);
  }

  const matched: EventDiff[] = [];
  const missed: EventDiff[] = [];
  const extra: EventDiff[] = [];

  for (const [, bucket] of buckets) {
    const pred = [...bucket.pred].sort((a, b) => a.at - b.at);
    const obs = [...bucket.obs].sort((a, b) => a.at - b.at);
    const usedObs = new Set<number>();

    for (const p of pred) {
      let bestIdx = -1;
      let bestGap = Number.POSITIVE_INFINITY;
      for (let i = 0; i < obs.length; i++) {
        if (usedObs.has(i)) continue;
        const gap = Math.abs((obs[i] as EventRecord).at - p.at);
        if (gap < bestGap) {
          bestGap = gap;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0 && bestGap <= tolerance) {
        usedObs.add(bestIdx);
        const o = obs[bestIdx] as EventRecord;
        matched.push({
          eventType: p.eventType,
          patientId: p.patientId,
          predictedAt: p.at,
          observedAt: o.at,
          timingErrorMin: (o.at - p.at) / MS_PER_MIN,
          reason: o.detail ?? p.detail,
        });
      } else {
        missed.push({
          eventType: p.eventType,
          patientId: p.patientId,
          predictedAt: p.at,
          reason: explainMissed(p, obs.length > 0, bestGap, tolerance),
        });
      }
    }

    for (let i = 0; i < obs.length; i++) {
      if (usedObs.has(i)) continue;
      const o = obs[i] as EventRecord;
      extra.push({
        eventType: o.eventType,
        patientId: o.patientId,
        observedAt: o.at,
        reason: o.detail ?? 'happened in the real world but was not predicted',
      });
    }
  }

  const allMatched = [...(opts.previous?.matched ?? []), ...matched];
  const allMissed = [...(opts.previous?.missed ?? []), ...missed];
  const allExtra = [...(opts.previous?.extra ?? []), ...extra];
  const denominator = allMatched.length + allMissed.length + allExtra.length;

  return {
    matchedPct: denominator === 0 ? 0 : (allMatched.length / denominator) * 100,
    medianTimingErrorMin: median(allMatched.map((m) => m.timingErrorMin ?? 0)),
    matched: allMatched,
    missed: allMissed,
    extra: allExtra,
    runsIncluded: (opts.previous?.runsIncluded ?? 0) + 1,
  };
}

function explainMissed(
  p: EventRecord,
  hadCandidates: boolean,
  bestGap: number,
  tolerance: number,
): string {
  if (!hadCandidates) return 'predicted, but nothing of this kind happened for this patient';
  if (bestGap > tolerance) {
    const hours = (bestGap / MS_PER_MIN / 60).toFixed(1);
    return `happened, but ${hours}h from the predicted time — outside the matching window`;
  }
  return `predicted at ${new Date(p.at).toISOString()}, no counterpart observed`;
}

/** Signed median, so systematic earliness and lateness stay distinguishable. */
function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}
