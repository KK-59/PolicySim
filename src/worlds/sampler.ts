/**
 * Sampling parameters from their evidence ranges. PRD §4.5.
 *
 * OWNER: Kaavya.
 *
 * Every Sourced value with a `range` is drawn from it; values without a range are held fixed.
 * That is why a missing range on a dominant parameter matters — it contributes nothing to the
 * spread between worlds, so the three worlds quietly converge and the robustness claim weakens.
 */

import type { Params, Sourced } from '../contracts/params.ts';
import type { Rng } from '../engine/rng.ts';
import { deriveGpDemand } from '../engine/demand.ts';

/** True for anything shaped like a Sourced leaf. */
function isSourced(x: unknown): x is Sourced {
  return (
    typeof x === 'object'
    && x !== null
    && typeof (x as Sourced).value === 'number'
    && Array.isArray((x as Sourced).bounds)
  );
}

/** Walk every Sourced leaf in an object, in a stable order, calling `visit`. */
function walk(obj: unknown, path: string, visit: (path: string, s: Sourced) => void): void {
  if (isSourced(obj)) {
    visit(path, obj);
    return;
  }
  if (typeof obj !== 'object' || obj === null) return;
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    walk((obj as Record<string, unknown>)[key], path === '' ? key : `${path}.${key}`, visit);
  }
}

/** Every samplable parameter, with its path. Drives the tornado as well as the sampler. */
export function flatten(params: Params): { path: string; sourced: Sourced }[] {
  const out: { path: string; sourced: Sourced }[] = [];
  walk(params, '', (path, sourced) => out.push({ path, sourced }));
  return out;
}

/**
 * One draw from the evidence.
 *
 * Boundary parameters (induced demand, substitution, gaming) default to 0 and are sampled UPWARD
 * from zero, so the unfavourable worlds carry some of the effect we declined to model rather than
 * assuming it away.
 */
export function sampleParams(base: Params, rng: Rng): Params {
  const next = structuredClone(base);

  walk(next, '', (_path, s) => {
    if (s.range === undefined || s.derived === true) return;
    const [lo, hi] = s.range;
    const drawn = rng.between(lo, hi);
    s.value = Math.min(s.bounds[1], Math.max(s.bounds[0], drawn));
  });

  // Demand is derived, never sampled independently — otherwise rho and the arrival rates drift
  // apart and the run no longer sits at the utilisation the sample claims.
  const demand = deriveGpDemand(next);
  next.arrivals.perDay.routine.value = demand.routine;
  next.arrivals.perDay.complex.value = demand.complex;
  next.arrivals.perDay.urgent.value = demand.urgent;

  return next;
}

/** How many parameters actually carry a range. Low counts mean narrow worlds. */
export function rangeCoverage(params: Params): { withRange: number; total: number } {
  const all = flatten(params);
  return { withRange: all.filter((p) => p.sourced.range !== undefined).length, total: all.length };
}
