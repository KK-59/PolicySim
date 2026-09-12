/**
 * Metrics — everything a run returns. The engine's only output, and therefore the only thing
 * the interface can render.
 *
 * OWNER: Kaavya. CONSUMED BY: Elsa (every view), Kaavya (sensitivity, ranking, accuracy).
 * PRD §4.5, §4.6, §4.8.
 *
 * Two families of content, deliberately kept apart:
 *   - OUTCOMES    — the product. Waits, queues, utilisation. Exactly the quantities absent from
 *                   Params, because the engine derives them rather than assuming them.
 *   - VERIFICATION — proof the run is trustworthy. Rarely on screen, always attached, because a
 *                   slider move re-runs the engine live: there is no test suite standing between
 *                   the user and a bad number.
 */

import type { ByClass, PatientClass, ParamPath } from './params.ts';

// ---------------------------------------------------------------------------
// TWO DIFFERENT PERCENTILE AXES. Do not conflate them.
// ---------------------------------------------------------------------------
//
//   WITHIN a run, across patients  -> the TAIL.    "the 90th-percentile patient waited 40 days"
//   ACROSS runs, across sampled    -> the WORLDS.  "in the pessimistic world, that figure is X"
//   parameter draws
//
// Both appear on screen at once: three world panels, each showing median AND 90th percentile.
// So a headline number is doubly indexed — worlds.pessimistic.waits.routine.p90.
//
// ---------------------------------------------------------------------------

/** Distribution of an outcome across patients within a single run. */
export interface Tail {
  p50: number;
  p90: number;
  mean: number;
  max: number;
  n: number;
}

/**
 * The same outcome across ~1,000 runs with parameters sampled from their ranges (PRD §4.5).
 *
 * ⚠️ THE DIRECTION TRAP. The PRD says "optimistic = P90". That is only right for metrics where
 * higher is better. For a WAIT, the optimistic world is the P10 of the distribution — the short
 * one. Defining these semantically rather than numerically is what stops that bug: `optimistic`
 * always means the favourable tail, whichever numeric end that is. The sampler reads
 * `direction` to decide.
 */
export interface ThreeWorlds<T> {
  /** The favourable tail — 10th or 90th percentile depending on `direction`. */
  optimistic: T;
  /** The central estimate. P50 either way. */
  realistic: T;
  /** The unfavourable tail. */
  pessimistic: T;
  direction: MetricDirection;
}

export type MetricDirection = 'lower-is-better' | 'higher-is-better';

// ---------------------------------------------------------------------------
// Outcomes — one run
// ---------------------------------------------------------------------------

/**
 * The nodes the engine models. Anything not here is declared unmodelled on screen.
 *
 * `result-review` and `filing` are deliberately absent as separate nodes: both are GP admin work,
 * and giving each its own servers would split the one resource they actually share. Results and
 * discharge letters queue together on `gp-admin`, which is the clinic/admin coupling the model is
 * supposed to have — a busy letter inbox should delay somebody's blood result, because it does.
 *
 * `hospital-outpatient` and `pharmacy` are cut (PRD §7): least grounded, least demo-relevant.
 */
export type NodeId =
  | 'gp-clinic'
  | 'gp-admin'
  | 'test'
  | 'community-visit';

export interface NodeState {
  /** Fraction of capacity in use. Waiting time is convex in this — 92→97% is catastrophic. */
  utilisation: number;
  /**
   * False when the queue is still growing at the end of the run — the node has no stable
   * operating point at this configuration.
   *
   * When this is false EVERY WAIT FIGURE FROM THIS NODE IS MEANINGLESS: the queue grows for as
   * long as you run it, so the "median wait" is really a statement about the horizon. The UI must
   * show "no stable operating point" rather than a number. That is not a limitation to apologise
   * for — a policy that leaves a service with no steady state is the strongest finding the model
   * can produce, and reporting it as "waits rise to 4,604 hours" would understate it while
   * looking like false precision.
   */
  stable: boolean;
  /** Mean number of work items in the node. Little's Law checks this against λW. */
  queueLength: number;
  /** Items completed per sim-day. */
  throughput: number;
  /** Items refused because the node was full (the sim's 409). */
  refused: number;
}

/** What one run of the engine produces. */
export interface RunOutcome {
  /** Minutes from request to service start, per patient class. Render as days. */
  waits: ByClass<Tail>;
  /** Minutes from request to pathway completion, per class. */
  timeInSystem: ByClass<Tail>;
  /**
   * Partial: the engine grows nodes one at a time, and a zero-filled node is indistinguishable
   * from an implemented-but-idle one. A missing key means "not modelled yet".
   */
  perNode: Partial<Readonly<Record<NodeId, NodeState>>>;
  /** Items completed over the whole run, per class. */
  completed: ByClass<number>;
  /** Referrals refused at capacity and fed back to the GP. */
  rejections: number;
  /**
   * Discharge letters never filed — the manual-chasing attrition, measured at 84% in the baseline.
   * Letters ONLY: this figure is calibrated against a real count (9 of 57 filed), so folding
   * anything else into it breaks the one number in the model that can be checked against the sim.
   */
  unfiledLetters: number;
  /** Blood results reviewed and never filed. Same failure, different pathway, separate number. */
  unfiledResults: number;
  verification: Verification;
  /**
   * Every arrival, service start, completion and refusal over a bounded window.
   *
   * Present only when the run asked for it. This is what the world view is drawn from: the model
   * already knows all of it and normally discards it, so showing the simulation is a matter of
   * keeping the events rather than inventing a second representation of the world.
   */
  trace?: readonly {
    t: number;
    kind: 'arrive' | 'start' | 'complete' | 'refuse';
    node: string;
    item: number;
    cls: string;
  }[];
}

// ---------------------------------------------------------------------------
// Verification — runs on every simulation, not on demand
// ---------------------------------------------------------------------------

export interface Verification {
  passed: boolean;
  checks: readonly VerificationCheck[];
}

export interface VerificationCheck {
  name:
    | 'conservation'      // no work item vanishes
    | 'littles-law'       // L = λW
    | 'mm1-closed-form'   // agrees with M/M/1 on a degenerate config
    | 'slider-extremes';  // sane behaviour at the ends of every range
  passed: boolean;
  /** What the check compared, e.g. "L=41.2 vs λW=41.0, 0.5% apart". */
  detail: string;
  /** Relative error where the check is numeric. */
  error?: number;
}

// ---------------------------------------------------------------------------
// The probabilistic result — what the UI actually renders
// ---------------------------------------------------------------------------

export interface Metrics {
  /** Every headline outcome, as three worlds. */
  worlds: WorldBands;
  /** The same outcomes as a change from the locked baseline. The UI shows THIS, never absolutes. */
  delta: WorldBands;
  /** Conclusions, with their robustness already computed. This is what the brief is written from. */
  findings: readonly Finding[];
  /** Parameter → outcome swing, sorted. Expect 2–3 dominant. */
  tornado: readonly TornadoRow[];
  /** "Holds while community capacity ≥ X." */
  thresholds: readonly Threshold[];
  /** "Induced demand would have to exceed 34% before this stops helping." */
  breakevens: readonly Breakeven[];
  /** Parameters that need flagging on screen: assumed, uncited, or range-less. */
  flags: readonly MetricFlag[];
  run: RunMeta;
}

/** Each outcome carried across the three worlds. */
export interface WorldBands {
  waits: ByClass<ThreeWorlds<Tail>>;
  timeInSystem: ByClass<ThreeWorlds<Tail>>;
  perNode: Partial<Readonly<Record<NodeId, ThreeWorlds<NodeState>>>>;
  completed: ByClass<ThreeWorlds<number>>;
  rejections: ThreeWorlds<number>;
  unfiledLetters: ThreeWorlds<number>;
  unfiledResults: ThreeWorlds<number>;
}

export interface RunMeta {
  /** ~1,000. Below a few hundred the tails are noise. */
  samples: number;
  seed: number;
  horizonDays: number;
  /** Wall-clock ms. Ten sim-years must be well under a second. */
  elapsedMs: number;
  /** True if any sampled run failed an assertion. Nothing renders as a finding if so. */
  anyVerificationFailed: boolean;
  /** Which Params produced this — snapshot id or uploaded document name. */
  paramsMeta?: unknown;
}

// ---------------------------------------------------------------------------
// Findings — the claim, not the number
// ---------------------------------------------------------------------------

/**
 * We do not claim "waits fall to 9.4 days" (PRD §5). We claim ordinal, structural, threshold and
 * robustness statements. A Finding is one such claim with its robustness already resolved, so the
 * UI never has to decide whether something is safe to present as a result.
 */
export interface Finding {
  id: string;
  /** Plain English, as it appears on screen. */
  statement: string;
  kind: 'ordinal' | 'structural' | 'threshold' | 'robust';
  /**
   * How many of the three worlds this holds in.
   * 3 → recommendation. 1–2 → shown, but labelled. 1 and optimistic-only → never a finding.
   */
  holdsIn: readonly ('optimistic' | 'realistic' | 'pessimistic')[];
  /** True only when holdsIn covers all three. The UI gates on this. */
  survivesAllThree: boolean;
  /** Set when the finding appears only in the optimistic world. Rendered as a warning, not a result. */
  optimisticOnly: boolean;
  /** Which outcomes it is about, for linking the sentence to the panel. */
  refersTo?: readonly string[];
}

// ---------------------------------------------------------------------------
// Sensitivity
// ---------------------------------------------------------------------------

export interface TornadoRow {
  path: ParamPath;
  label: string;
  /** Outcome at the low end of this parameter's range, everything else at P50. */
  low: number;
  high: number;
  /** |high − low|. The sort key. */
  swing: number;
  /** Whether the range behind this swing is real evidence or an assumption. */
  rangeSource: 'measured' | 'documented' | 'literature' | 'assumed';
  /**
   * True when this parameter is dominant AND has no sourced range — the case that quietly
   * collapses the three worlds. Kaavya raises these with Albert (PRD §8.5).
   */
  dominantButUnsourced: boolean;
}

export interface Threshold {
  path: ParamPath;
  label: string;
  /** The value at which the claim stops holding. */
  breakpoint: number;
  /** Which side of the breakpoint is safe. */
  holdsWhen: 'above' | 'below';
  /** The claim this threshold qualifies. */
  findingId: string;
  /** Restated for the screen: "holds while community capacity ≥ 6 visits/day". */
  statement: string;
}

/** A reverse breakeven on a declared boundary: how big would it have to be to overturn us? */
export interface Breakeven {
  path: ParamPath;
  label: string;
  /** The value at which the headline claim flips. */
  value: number;
  /** Plain English: "induced demand would have to exceed 34% to overturn this". */
  statement: string;
  /** True when the breakeven is implausibly large — i.e. the conclusion is safe. */
  implausible: boolean;
}

export interface MetricFlag {
  path: ParamPath;
  reason: 'assumed' | 'no-citation' | 'no-range' | 'dominant-but-unsourced';
  /** Rendered in amber next to the parameter. */
  message: string;
}

// ---------------------------------------------------------------------------
// Accuracy — predicted vs observed, after a real apply (PRD §4.7 step 7)
// ---------------------------------------------------------------------------
//
// Not a run output: produced by comparing a prediction against NHS-SIM after the clock advances.
// It lives here because Elsa renders it and needs the shape frozen at the same time.

/**
 * One event, either predicted by the engine or observed in NHS-SIM after a real apply.
 * Oriol produces the observed list from re-reads; the engine produces the predicted list.
 */
export interface EventRecord {
  /** e.g. 'visit.completed', 'document.filed', 'prescription.dispensed'. */
  eventType: string;
  patientId?: string;
  /** Absolute sim time in ms, matching NHS-SIM's clock. */
  at: number;
  /** Anything useful for explaining a divergence — the resource id, the fallback taken. */
  detail?: string;
}

export interface AccuracyReport {
  matchedPct: number;
  /** Minutes. Signed, so early and late are distinguishable. */
  medianTimingErrorMin: number;
  matched: readonly EventDiff[];
  /** Predicted but never observed. */
  missed: readonly EventDiff[];
  /** Observed but never predicted. */
  extra: readonly EventDiff[];
  /** Accumulates across every apply during the day. */
  runsIncluded: number;
}

export interface EventDiff {
  eventType: string;
  patientId?: string;
  predictedAt?: number;
  observedAt?: number;
  /** Signed minutes, observed − predicted. */
  timingErrorMin?: number;
  /** Why it diverged. Every divergence gets one — "community refused at capacity, fell back". */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Clinician mode — plan comparison (PRD §4.7 steps 3b–4)
// ---------------------------------------------------------------------------

export interface RankedPlan {
  planId: string;
  /** Disqualified outright by one of Albert's hard safety rules. Ranked last regardless. */
  safetyFail?: string;
  /** Each plan is run in all three worlds. A plan that only wins in the optimistic one loses. */
  outcome: ThreeWorlds<PlanOutcome>;
  /** First tiebreak after hard safety: in how many worlds does this plan win? */
  winsInWorlds: number;
  rank: number;
  /** Generated from the event log, not from an LLM guess. */
  whyThisRank: string;
}

export interface PlanOutcome {
  /** Minutes until Albert's safe-state definition is met. */
  timeToSafeMin: number;
  /** Contacts, journeys, waiting — however Albert defines it. */
  patientBurden: number;
  /** Clinician minutes consumed. */
  staffBurden: number;
  /** Actions that failed and fell back. */
  fallbacks: number;
}

export type { PatientClass };
