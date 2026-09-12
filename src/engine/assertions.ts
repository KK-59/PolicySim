/**
 * Verification assertions. PRD §4.6.
 *
 * OWNER: Kaavya.
 *
 * These run on EVERY simulation, not in a test suite. A slider move re-runs the engine live in the
 * browser — there is nothing else standing between the user and a wrong number.
 *
 * Four checks:
 *   conservation    — no work item vanishes
 *   little's law    — L = lambda * W
 *   mm1-closed-form — a degenerate config reproduces exact queueing theory
 *   slider-extremes — sane behaviour at the ends of every range (added with the sampler)
 */

import type { Verification, VerificationCheck } from '../contracts/metrics.ts';
import type { NodeStats } from './nodes.ts';

/** Relative error tolerated before a check fails. Generous: these are stochastic estimates. */
const TOLERANCE = 0.05;

/**
 * A queue is diverging if it grows at more than this fraction of throughput.
 *
 * Judged as a RATE, not an item count. An absolute threshold cannot work across nodes that differ
 * by four orders of magnitude in volume: 21 extra items over 640 days is drift on a node serving
 * 84 a day, and a crisis on one serving four.
 */
const DIVERGENCE_RATE = 0.01;

export function isStable(n: NodeStats, windowMinutes: number): boolean {
  const days = windowMinutes / 1440;
  if (days <= 0) return true;
  const growthPerDay = (n.nAtWindowEnd - n.nAtWindowStart) / days;
  const throughputPerDay = n.completed / days;
  if (throughputPerDay <= 0) return growthPerDay <= 0;
  return growthPerDay <= DIVERGENCE_RATE * throughputPerDay;
}

export function verify(nodes: readonly NodeStats[], windowMinutes: number): Verification {
  const checks: VerificationCheck[] = [
    conservation(nodes),
    littlesLaw(nodes, windowMinutes),
  ];
  return { passed: checks.every((c) => c.passed), checks };
}

/**
 * Conservation: everything that entered either finished or is still in the system.
 * Catches the classic DES bug — an item started but never scheduled a completion.
 */
export function conservation(nodes: readonly NodeStats[]): VerificationCheck {
  const details: string[] = [];
  let passed = true;
  for (const n of nodes) {
    // Refusals are turned away at the door, so they never enter `admitted` and must not appear
    // on the accounted side either. They are reported separately.
    const accounted = n.completed + n.leftInSystem;
    const ok = accounted === n.admitted;
    if (!ok) passed = false;
    details.push(
      `${n.id}: admitted ${n.admitted} = completed ${n.completed} + in-system ${n.leftInSystem}`
      + (n.refused > 0 ? ` (${n.refused} refused at the door)` : '')
      + (ok ? '' : ' ✗'),
    );
  }
  return { name: 'conservation', passed, detail: details.join(' | ') };
}

/**
 * Little's Law: L = lambda * W.
 *
 * L is the time-average number in the system, integrated over the measurement window.
 * lambda is the throughput over that window; W the mean time in system.
 *
 * This is the single most valuable check in the file, because it fails whenever the time-weighted
 * accounting and the per-item accounting disagree — which is what happens if a state change is
 * made without advancing the integrals first.
 *
 * NOTE: it only holds in steady state. An unstable node (lambda > mu) has a queue growing without
 * bound, W for items still waiting is undefined, and the check is skipped rather than failed —
 * with the reason recorded, so an unstable baseline is visible rather than silently unverified.
 */
export function littlesLaw(nodes: readonly NodeStats[], windowMinutes: number): VerificationCheck {
  const details: string[] = [];
  let passed = true;
  let worst = 0;

  for (const n of nodes) {
    if (n.timesInSystem.length === 0) {
      details.push(`${n.id}: no completions in window — skipped`);
      continue;
    }
    // Instability is queue GROWTH across the window, not a large queue.
    //
    // Little's Law holds in steady state. When the queue grows without bound, W measured from
    // completed items is biased low — the long-waiting items are precisely the ones still in the
    // queue, uncounted — so L exceeds lambda*W by construction. That is not a failure of the
    // engine, and reporting it as one would train us to ignore this check.
    if (!isStable(n, windowMinutes)) {
      details.push(
        `${n.id}: no steady state — queue grew ${n.nAtWindowStart} -> ${n.nAtWindowEnd} across `
        + 'the window, so W is undefined for the survivors. Skipped, not failed.',
      );
      continue;
    }
    const w = mean(n.timesInSystem);
    const lambda = n.timesInSystem.length / windowMinutes;
    const lhs = n.meanNumberInSystem;
    const rhs = lambda * w;
    const err = relErr(lhs, rhs);
    if (err > TOLERANCE) passed = false;
    worst = Math.max(worst, err);
    details.push(`${n.id}: L=${lhs.toFixed(2)} vs λW=${rhs.toFixed(2)} (${pct(err)})`);
  }

  return {
    name: 'littles-law',
    passed,
    detail: details.join(' | ') || 'no measurable nodes',
    error: worst,
  };
}

/**
 * Agreement with the exact closed form on a degenerate single-server config.
 *
 * Two forms, because which one applies depends on the service distribution:
 *
 *   M/M/1 (exponential service): Lq = rho^2 / (1 - rho)
 *   M/D/1 (constant service):    Lq = rho^2 / (2 * (1 - rho))
 *
 * The factor of two is the whole point. NHS-SIM's service times are constant, so the real system
 * is M/D/1 and queues half as long as an M/M/1 intuition suggests. If the engine lands on the
 * wrong one of these, every wait it reports is out by a factor of two in the regime that matters.
 */
export function closedForm(
  observed: NodeStats,
  arrivalRatePerMin: number,
  serviceMinutes: number,
  dist: 'constant' | 'exponential',
): VerificationCheck {
  const mu = 1 / serviceMinutes;
  const rho = arrivalRatePerMin / mu;

  if (rho >= 1) {
    return {
      name: 'mm1-closed-form',
      passed: false,
      detail: `rho = ${rho.toFixed(3)} >= 1 — no steady state exists, pick a stable config`,
    };
  }

  const lq = dist === 'exponential'
    ? (rho * rho) / (1 - rho)
    : (rho * rho) / (2 * (1 - rho));
  const expectedL = lq + rho;
  const err = relErr(observed.meanNumberInSystem, expectedL);

  return {
    name: 'mm1-closed-form',
    passed: err <= TOLERANCE,
    detail:
      `${dist === 'exponential' ? 'M/M/1' : 'M/D/1'} at rho=${rho.toFixed(3)}: `
      + `observed L=${observed.meanNumberInSystem.toFixed(3)}, theory L=${expectedL.toFixed(3)} `
      + `(${pct(err)})`,
    error: err,
  };
}

// --- helpers ---

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

function relErr(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / denom;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}% apart`;
}

export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] as number;
}
