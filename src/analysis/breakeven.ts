/**
 * Reverse breakeven on the declared boundaries. PRD §4.3, §4.6.
 *
 * OWNER: Kaavya.
 *
 * We set induced demand, substitution and gaming to zero and say so on screen. The obvious
 * challenge is "you ignored the thing that would change your answer". The answer is not to guess a
 * value — it is to solve for the value that WOULD change it, and let the reader judge whether that
 * is plausible.
 *
 *   "Induced demand would have to exceed 34% before this policy stops helping."
 *
 * That is a stronger claim than any fitted number, because it does not depend on being right about
 * the boundary — only on the reader being able to judge 34%.
 */

import type { Params } from '../contracts/params.ts';
import type { Breakeven } from '../contracts/metrics.ts';
import { run } from '../engine/index.ts';

/** Paths solved, with how large a value stops being credible. */
const BOUNDARIES: { path: 'inducedDemand' | 'substitution' | 'gaming'; label: string }[] = [
  { path: 'inducedDemand', label: 'induced demand' },
  { path: 'substitution', label: 'substitution' },
  { path: 'gaming', label: 'reclassification' },
];

/** Above this, a boundary large enough to overturn the claim is not a realistic worry. */
const IMPLAUSIBLE_ABOVE = 0.5;

export interface BreakevenOptions {
  /** The policy under test. */
  policy: Params;
  /** What it is being compared against — usually the locked baseline. */
  baseline: Params;
  seed?: number;
  horizonDays?: number;
}

/**
 * The headline quantity: routine median wait. An unstable run scores as maximally bad, so a
 * boundary that destabilises the practice counts as overturning the claim.
 */
function headline(p: Params, seed: number, horizonDays: number): number {
  const q = structuredClone(p);
  q.sim.horizonDays = horizonDays;
  const r = run(q, seed);
  return (r.perNode['gp-clinic']?.stable ?? false)
    ? r.waits.routine.p50
    : Number.POSITIVE_INFINITY;
}

export function solveBreakevens(opts: BreakevenOptions): Breakeven[] {
  const seed = opts.seed ?? 1;
  const horizonDays = opts.horizonDays ?? 730;

  const baseWait = headline(opts.baseline, seed, horizonDays);
  const policyWait = headline(opts.policy, seed, horizonDays);

  // If the policy does not help even at zero, there is no claim to overturn.
  if (!(policyWait < baseWait)) return [];

  const out: Breakeven[] = [];

  for (const { path, label } of BOUNDARIES) {
    const at = (v: number): number => {
      const p = structuredClone(opts.policy);
      p.boundaries[path].value = v;
      return headline(p, seed, horizonDays);
    };

    // Does the boundary overturn the claim anywhere in its physical range?
    if (at(1) < baseWait) {
      out.push({
        path: `boundaries.${path}`,
        label,
        value: Number.POSITIVE_INFINITY,
        statement: `${label} could not overturn this claim at any value`,
        implausible: true,
      });
      continue;
    }

    // Bisect for the crossing.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid) < baseWait) lo = mid;
      else hi = mid;
    }
    const value = (lo + hi) / 2;

    out.push({
      path: `boundaries.${path}`,
      label,
      value,
      statement:
        `${label} would have to exceed ${(value * 100).toFixed(0)}% before this policy stops `
        + 'helping',
      implausible: value > IMPLAUSIBLE_ABOVE,
    });
  }

  return out;
}
