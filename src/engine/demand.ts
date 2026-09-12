/**
 * Deriving GP demand from a target utilisation.
 *
 * OWNER: Kaavya.
 *
 * NHS-SIM cannot tell us the true GP arrival rate — 50,000 registered patients against three
 * clinicians is not internally consistent, and the seeded appointment book is nearly empty. So
 * demand is derived from rho, the regime, rather than counted.
 *
 * Call this in exactly two places:
 *   - calibration, once, to populate Params.arrivals.perDay
 *   - the three-worlds sampler, which varies rho and re-derives
 *
 * Never call it inside run(). If demand were recomputed from capacity on every run, adding GP
 * sessions would add demand in lockstep, utilisation would never move, and every lever would be
 * inert while looking fine.
 */

import type { Params, PatientClass, ByClass } from '../contracts/params.ts';

const CLASSES: readonly PatientClass[] = ['routine', 'complex', 'urgent'];

/**
 * GP capacity per day as MEASURED, in appointment slots — before any lever is applied.
 * Levers move capacity away from this; rho is defined against it.
 */
export function measuredGpCapacityPerDay(params: Params): number {
  return params.capacities.gpSessionsPerDay.value * params.capacities.gpSlotsPerSession.value;
}

/**
 * The same capacity in clinician-MINUTES. 6 x 15 x 15 = 1,350/day for the measured config.
 *
 * This, not the slot count, is what rho must be defined against. Once complex appointments are
 * twice as long, "84.6 patients/day against 90 slots" is not 94% utilisation — it is 1,459 minutes
 * of demand against 1,350 minutes of capacity, which is 108% and has no steady state. Defining
 * rho in patient counts silently made the model unstable the moment classes stopped being alike.
 */
export function measuredGpCapacityMinutesPerDay(params: Params): number {
  return measuredGpCapacityPerDay(params) * params.serviceTimes.gpConsultation.value;
}

/** Mean appointment length across the class mix, in minutes. */
export function meanServiceMinutes(params: Params): number {
  const mix = normalisedClassMix(params);
  const base = params.serviceTimes.gpConsultation.value;
  const m = params.serviceTimes.classMultiplier;
  return (
    mix.routine * base * m.routine.value
    + mix.complex * base * m.complex.value
    + mix.urgent * base * m.urgent.value
  );
}

/** Class shares, normalised so they sum to 1 whatever the sampler drew. */
export function normalisedClassMix(params: Params): ByClass<number> {
  const raw = CLASSES.map((c) => Math.max(0, params.arrivals.classMix[c].value));
  const total = raw.reduce((s, x) => s + x, 0);
  if (total <= 0) return { routine: 1, complex: 0, urgent: 0 };
  return {
    routine: (raw[0] as number) / total,
    complex: (raw[1] as number) / total,
    urgent: (raw[2] as number) / total,
  };
}

/**
 * Arrivals per sim-day per class, for a given rho. Defaults to the params' own targetUtilisation.
 */
export function deriveGpDemand(params: Params, rho?: number): ByClass<number> {
  const utilisation = rho ?? params.arrivals.targetUtilisation.value;
  // Patients per day such that their total service time is rho of the clinician-minutes available.
  const total =
    (utilisation * measuredGpCapacityMinutesPerDay(params)) / meanServiceMinutes(params);
  const mix = normalisedClassMix(params);
  return {
    routine: total * mix.routine,
    complex: total * mix.complex,
    urgent: total * mix.urgent,
  };
}

/** A copy of `params` with `arrivals.perDay` re-derived at `rho`. For the sampler. */
export function withUtilisation(params: Params, rho: number): Params {
  const derived = deriveGpDemand(params, rho);
  const next = structuredClone(params);
  next.arrivals.targetUtilisation.value = rho;
  for (const c of CLASSES) {
    next.arrivals.perDay[c].value = derived[c];
  }
  return next;
}
