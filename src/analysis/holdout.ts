/**
 * Hold-out validation. PRD §4.6, §8.1 step 10.
 *
 * OWNER: Kaavya.
 *
 * Every other check in this repo asks whether the engine is internally consistent — conservation,
 * Little's Law, the closed forms. None of them ask whether it is right about the world. A hold-out
 * does: fit on data the model is allowed to see, predict data it is not, then compare.
 *
 * Three forms, in descending order of how much they are worth:
 *
 *   1. REGIME hold-out — calibrate on a calm baseline, predict an incident world BEFORE observing
 *      it. The strongest, and unavailable: /api/control/incidents returns 403 to a team key, so we
 *      cannot fire winter-pressure or staff-shortage. Kept here as a function so it runs the
 *      moment an organiser fires one.
 *
 *   2. FORWARD hold-out — calibrate on a snapshot, advance the real clock, predict the state we
 *      will read back, then read it. Needs the server.
 *
 *   3. TEMPORAL hold-out — split a single observed window, fit on the early part, predict the
 *      late part. Weaker, because both halves come from the same regime, but it needs nothing
 *      except data already captured, which on a day when the server is returning 502 is the
 *      difference between having a validation section and not.
 *
 * A prediction made after seeing the answer is not a prediction. Each function here takes the
 * fitting data and the held-out data as separate arguments so the split cannot blur.
 */

export interface HoldOutRow {
  label: string;
  predicted: number;
  observed: number;
  /** observed - predicted. Signed, so systematic over- and under-prediction stay visible. */
  error: number;
  absPctError: number;
  /** How the prediction was arrived at, for the report. */
  basis: string;
}

export interface HoldOutResult {
  kind: 'regime' | 'forward' | 'temporal';
  rows: HoldOutRow[];
  medianAbsPctError: number;
  /** Rows inside the tolerance band. */
  within: number;
  total: number;
  /** Plain English, for the brief and the Rehearsal Report. */
  statement: string;
}

const DEFAULT_TOLERANCE_PCT = 10;

function assemble(
  kind: HoldOutResult['kind'],
  rows: HoldOutRow[],
  tolerancePct: number,
): HoldOutResult {
  const errors = rows.map((r) => r.absPctError).sort((a, b) => a - b);
  const median = errors.length === 0
    ? 0
    : (errors[Math.floor(errors.length / 2)] as number);
  const within = rows.filter((r) => r.absPctError <= tolerancePct).length;
  return {
    kind,
    rows,
    medianAbsPctError: median,
    within,
    total: rows.length,
    statement:
      rows.length === 0
        ? 'No hold-out was run.'
        : `${within} of ${rows.length} predictions landed within ${tolerancePct}%, `
          + `median absolute error ${median.toFixed(1)}%.`,
  };
}

function row(label: string, predicted: number, observed: number, basis: string): HoldOutRow {
  const error = observed - predicted;
  return {
    label,
    predicted,
    observed,
    error,
    absPctError: observed === 0 ? (predicted === 0 ? 0 : 100) : Math.abs(error / observed) * 100,
    basis,
  };
}

// ---------------------------------------------------------------------------
// 3. Temporal hold-out — runs on captured data alone
// ---------------------------------------------------------------------------

export interface TemporalHoldOutOptions {
  /** Event timestamps in ms, any order. */
  arrivalTimes: readonly number[];
  /** Fraction of the observed window used for fitting. The rest is held out. */
  fitFraction?: number;
  label?: string;
  tolerancePct?: number;
}

/**
 * Fit an arrival rate on the first part of an observed window; predict the count in the rest.
 *
 * This is the honest version of "we measured 142 arrivals a day". Quoting that number back is a
 * tautology — it is the number we fitted. Predicting the last three days from the first six is
 * not, and it is what tells you whether the rate is stable or whether you happened to average
 * across a trend.
 */
export function temporalHoldOut(opts: TemporalHoldOutOptions): HoldOutResult {
  const times = [...opts.arrivalTimes].sort((a, b) => a - b);
  const tolerancePct = opts.tolerancePct ?? DEFAULT_TOLERANCE_PCT;
  if (times.length < 10) return assemble('temporal', [], tolerancePct);

  const start = times[0] as number;
  const end = times[times.length - 1] as number;
  const fitFraction = opts.fitFraction ?? 0.667;
  const splitAt = start + (end - start) * fitFraction;

  const fitWindow = times.filter((t) => t < splitAt);
  const heldOut = times.filter((t) => t >= splitAt);
  if (fitWindow.length === 0 || heldOut.length === 0) {
    return assemble('temporal', [], tolerancePct);
  }

  const fitDays = (splitAt - start) / 86_400_000;
  const heldDays = (end - splitAt) / 86_400_000;
  const ratePerDay = fitWindow.length / fitDays;
  const predicted = ratePerDay * heldDays;

  return assemble('temporal', [
    row(
      opts.label ?? 'arrivals in the held-out window',
      Math.round(predicted),
      heldOut.length,
      `${ratePerDay.toFixed(2)}/day fitted on the first ${fitDays.toFixed(1)} days `
      + `(n=${fitWindow.length}), projected over the remaining ${heldDays.toFixed(1)} days`,
    ),
  ], tolerancePct);
}

// ---------------------------------------------------------------------------
// 2. Forward hold-out — predict the state after a real clock advance
// ---------------------------------------------------------------------------

export interface ForwardQuantity {
  label: string;
  /** Count read from the snapshot before advancing. */
  before: number;
  /** Rate per sim-day the engine expects this quantity to change by. */
  predictedRatePerDay: number;
  /** Count read back after advancing. Supplied only once the read has happened. */
  after?: number;
}

/**
 * Predict each quantity forward, then compare against the read-back.
 *
 * Call it once WITHOUT `after` to record the predictions, advance the clock, then call it again
 * with them. Recording first is not ceremony: a prediction produced in the same breath as the
 * observation is not evidence of anything.
 */
export function forwardHoldOut(
  quantities: readonly ForwardQuantity[],
  advanceMinutes: number,
  tolerancePct = DEFAULT_TOLERANCE_PCT,
): HoldOutResult {
  const days = advanceMinutes / 1440;
  const rows = quantities
    .filter((q) => q.after !== undefined)
    .map((q) => row(
      q.label,
      Math.round(q.before + q.predictedRatePerDay * days),
      q.after as number,
      `${q.before} before, plus ${q.predictedRatePerDay.toFixed(2)}/day over `
      + `${days.toFixed(2)} sim-days`,
    ));
  return assemble('forward', rows, tolerancePct);
}

// ---------------------------------------------------------------------------
// 1. Regime hold-out — the one we cannot run
// ---------------------------------------------------------------------------

export interface RegimeQuantity {
  label: string;
  /** What the engine predicts under the incident, calibrated only on calm data. */
  predicted: number;
  /** What the incident world actually did. */
  observed: number;
}

/**
 * Compare a calm-calibrated prediction of an incident world against the incident world.
 *
 * Unavailable today — incidents are operator-gated and a team key gets 403 — so this exists to be
 * ready rather than to be run. If an organiser fires winter-pressure or staff-shortage, predict
 * FIRST, write it down, then observe.
 */
export function regimeHoldOut(
  quantities: readonly RegimeQuantity[],
  tolerancePct = DEFAULT_TOLERANCE_PCT,
): HoldOutResult {
  return assemble('regime', quantities.map((q) =>
    row(q.label, q.predicted, q.observed, 'predicted from calm calibration, before observing')),
    tolerancePct);
}
