/**
 * Params — the complete input to the engine.
 *
 * OWNER: Kaavya.
 * CONSUMED BY: Elsa (sliders, source tags), Albert (source table), Oriol (extractor output).
 * PRD §4.3. Measured values and their provenance: docs/calibration-findings.md.
 *
 * Contract: run(params, seed) -> Metrics. Params is the whole world description. Anything the
 * engine derives — waits, queue lengths, utilisation — is deliberately absent: putting a wait in
 * here would be assuming the answer.
 */

// ---------------------------------------------------------------------------
// Sourcing
// ---------------------------------------------------------------------------

/**
 * Where a number came from. Rendered next to every value on screen.
 * - measured   — counted in the NHS-SIM snapshot
 * - documented — stated in the uploaded policy, or in the NHS-SIM handbook
 * - literature — retrieved from the evidence corpus, with a published range
 * - assumed    — neither source covers it. Shown in amber. Never silently defaulted.
 */
export type SourceTag = 'measured' | 'documented' | 'literature' | 'assumed';

/**
 * A number that knows where it came from and how uncertain it is.
 *
 * `range` is what the three-worlds sampler draws from. No range means no spread, which means the
 * three worlds collapse toward each other — so a missing range on a dominant parameter is a
 * finding, not a detail (PRD §8.3).
 *
 * `bounds` are physical, not evidential: extraction clamps to them so a bad LLM read cannot
 * produce a negative capacity.
 */
export interface Sourced {
  value: number;
  /** [low, high] for sampling. Absent = point estimate, no contribution to world spread. */
  range?: readonly [number, number];
  /** [min, max] physically possible. Extraction clamps to this. */
  bounds: readonly [number, number];
  source: SourceTag;
  /** Corpus id, endpoint, or document span. Rendered on screen; required unless `assumed`. */
  citation?: string;
  /** Shown in the parameter panel instead of the field name. */
  label?: string;
  /** Why this is uncertain, or what the sim does not model here. Rendered on hover. */
  note?: string;
  /**
   * True for values COMPUTED from other parameters rather than set independently.
   *
   * The sampler and the tornado both skip these. Perturbing a derived value directly would put it
   * out of step with whatever it was derived from — moving `arrivals.perDay` without moving
   * `targetUtilisation` produces a run that is not at the utilisation it claims to be at, and
   * counts the same uncertainty twice.
   */
  derived?: boolean;
}

// ---------------------------------------------------------------------------
// Patient classes
// ---------------------------------------------------------------------------

/**
 * Three classes under priority discipline. This split is what produces the
 * median-improves-while-tail-worsens finding (PRD §8.1 step 6).
 *
 * NOTE: NHS-SIM has only acuity 2 and 3 (urgent / routine). `complex` is our construct — a
 * multi-service patient whose pathway touches more than one node. Tag it `assumed` and say so.
 */
export type PatientClass = 'routine' | 'complex' | 'urgent';

export type ByClass<T> = Readonly<Record<PatientClass, T>>;

// ---------------------------------------------------------------------------
// Policy-invariant primitives — measured or documented, never derived
// ---------------------------------------------------------------------------

export interface Arrivals {
  /**
   * GP demand per sim-day, per class. ABSOLUTE rates, fixed at calibration time.
   *
   * These are derived from `targetUtilisation` once, by `deriveGpDemand`, and then held constant
   * while levers move capacity. That ordering matters: if demand were recomputed from capacity on
   * every run, adding GP sessions would add demand in lockstep, utilisation would never move, and
   * every lever would look inert. The hour-one sensitivity check exists to catch exactly that.
   */
  perDay: ByClass<Sourced>;

  /**
   * rho — GP demand as a fraction of measured GP capacity.
   *
   * NHS-SIM cannot tell us the true GP arrival rate: it registers 50,000 patients against three
   * clinicians, which is not internally consistent, and its seeded appointment book is nearly
   * empty. So we calibrate the REGIME rather than the count.
   *
   * That is defensible rather than evasive, because waiting time is convex in utilisation and
   * every claim we make is ordinal, structural or threshold-shaped. 80 -> 85% barely matters;
   * 92 -> 97% is catastrophic. Which regime we are in is the whole question, and it is the thing
   * the literature can actually answer.
   *
   * Equivalently: 90 slots/day at English appointment rates fits a list of roughly 4,000 patients.
   * Saying "we model the ~4,000-patient practice this session diary supports" and setting rho are
   * the same act — the second is just harder to say on stage.
   *
   * The sampler varies THIS and re-derives `perDay`, so its range is a direct input to the width
   * of the three worlds.
   */
  targetUtilisation: Sourced;

  /** Share of demand in each class. Normalised before use, so these need not sum to exactly 1. */
  classMix: ByClass<Sourced>;

  /**
   * A&E arrivals per sim-day. Measured at 142, sigma ~1.2 — the one arrival rate NHS-SIM does
   * expose. Parked here until the ED node exists (step 5); it must NOT be fed to the GP.
   */
  edPerDay: Sourced;

  /**
   * Discharge letters reaching the practice per sim-day. Measured: 57 letters over ~9 sim-days.
   *
   * A separate stream, not a share of GP contacts — letters come from hospital discharges and
   * scale with hospital activity, not with how busy the surgery is.
   */
  dischargeLettersPerDay: Sourced;
}

export interface Capacities {
  /** GP appointment sessions per day. Measured: 6. */
  gpSessionsPerDay: Sourced;
  /** Usable slots per session, after protected breaks. Measured: 15 (16 minus one break). */
  gpSlotsPerSession: Sourced;
  /** Community home-visit slots per day. Measured: 4 — the binding constraint. */
  communitySlotsPerDay: Sourced;
  /** Concurrently staffed assessment spaces. Measured: 8 (4 doctors + 4 nurses). */
  staffedSpaces: Sourced;
  /** Share of a GP's day spent on admin rather than clinic. Couples the two queues. */
  gpAdminShare: Sourced;
}

export interface ServiceTimes {
  /**
   * Minutes. NHS-SIM's service times are CONSTANT — measured variance is exactly zero across
   * every observed transition. If the engine draws these from a distribution instead, that is a
   * deliberate divergence from the ground truth and must be declared (see calibration findings).
   */
  gpConsultation: Sourced;
  /** Measured: 90, n=7, zero variance. Matches the handbook figure. */
  communityVisit: Sourced;
  /**
   * Measured: 60 minutes per hop, sent -> reviewed -> filed.
   *
   * This is ELAPSED TURNAROUND, not clinician effort. Reading it as service time made one
   * clinician able to handle six letters a day and the admin queue diverge instantly. The work
   * content is `documentReviewWork`; this figure is what the sim's own status transitions took.
   */
  documentReviewHop: Sourced;

  /** Clinician minutes actually spent reviewing a letter. Not measurable in NHS-SIM. */
  documentReviewWork: Sourced;
  /** Handbook figure; not yet observed live. */
  bloodResultTurnaround: Sourced;
  /** Not measurable in the current world — only one approved prescription exists. */
  pharmacyApproval: Sourced;

  /**
   * Service time multiplier per patient class.
   *
   * A complex patient needs a longer appointment than a routine one. This is the mechanism behind
   * the median-improves-tail-worsens finding, and it is worth being precise about why:
   *
   * We do NOT claim anyone deprioritises complex patients. Urgent cases jump the queue, and
   * routine and complex sit at the same priority level. What happens is geometric — a 30-minute
   * appointment needs 30 contiguous minutes before the session closes, so as a session fills up
   * there is a window where a routine patient still fits and a complex one no longer does. Under
   * pressure the long jobs get squeezed out of the end of every session and roll to the next day.
   *
   * That is a real feature of slot-based booking, it emerges from the schedule rather than from an
   * assumption about clinical priority, and it is defensible to a judge who asks.
   */
  classMultiplier: ByClass<Sourced>;
}

export interface Routing {
  /** P(GP encounter -> test ordered). */
  gpToTest: Sourced;
  /** P(GP encounter -> hospital outpatient referral). */
  gpToHospital: Sourced;
  /** P(GP encounter -> community visit referral). */
  gpToCommunity: Sourced;
  /** P(discharge letter progresses past `sent`). Measured: 0.37 (21 of 57). */
  letterSentToReviewed: Sourced;
  /** P(reviewed letter reaches `filed`). Measured: 0.16 of all sent (9 of 57). */
  letterReviewedToFiled: Sourced;
  /** P(community referral rejected and fed back to the GP) when at capacity. */
  communityRejection: Sourced;
}

// ---------------------------------------------------------------------------
// Policy levers — set by extraction, then exposed as sliders
// ---------------------------------------------------------------------------

/**
 * The 5-6 things a policy actually changes. Extraction sets these from the uploaded document
 * (PRD §2); Elsa's sliders move them afterwards for threshold-hunting. They are not the way in.
 *
 * Each is a MULTIPLIER or SHARE applied to the primitives above, never an absolute — so a lever
 * stays meaningful when calibration replaces a primitive underneath it.
 */
export interface Levers {
  /** × communitySlotsPerDay. Base is 4, so this bites hard — best lever we have. */
  communityCapacityMultiplier: Sourced;
  /** Additional GP sessions per day. +1 = +15 slots ≈ +17%. */
  extraGpSessions: Sourced;
  /** Share of follow-ups by telephone rather than in person. Measured base: 0.33 (2 of 6). */
  telephoneFollowUpShare: Sourced;
  /** × wearable observation frequency. Base measurable; effect on admission is literature-only. */
  monitoringIntensity: Sourced;
  /**
   * Share of hospital discharges routed to community rather than outpatient.
   * ⚠️ NOT GROUNDED — the sim has no baseline community referral flow. Tag `literature`.
   */
  hospitalToCommunityShare: Sourced;
  /**
   * Share of discharges timed to weekdays.
   * ⚠️ NOT GROUNDED — NHS-SIM has no weekday logic at all. Tag `assumed`, amber on screen.
   */
  weekdayDischargeShare: Sourced;
}

// ---------------------------------------------------------------------------
// Declared boundaries — what we choose not to model, said out loud
// ---------------------------------------------------------------------------

/**
 * All default to 0, each with a reverse breakeven ("this would have to exceed X to overturn the
 * conclusion"). Rendered on screen as declared limits, not hidden.
 *
 * These are not parameters we failed to measure. NHS-SIM generates 142 arrivals/day regardless of
 * what anyone does — induced demand and substitution cannot occur in it, and there is no coding to
 * game. 0 is the truthful value for the ground truth we are modelling, and the breakeven is the
 * honest way to show what would change the answer.
 */
export interface Boundaries {
  /** Roemer: new capacity generates its own demand. Fraction of freed capacity refilled. */
  inducedDemand: Sourced;
  /** The bottleneck relocates rather than clearing. Fraction of relieved load reappearing. */
  substitution: Sourced;
  /** Reclassification to meet the target rather than the need. */
  gaming: Sourced;
}

// ---------------------------------------------------------------------------
// Environment — a SEPARATE axis from the three worlds
// ---------------------------------------------------------------------------

/**
 * Explicit toggles, deliberately not folded into "pessimistic" — otherwise the pessimistic world
 * becomes an undifferentiated bag of everything bad (PRD §4.5). Each world runs under calm or
 * stressed conditions independently.
 *
 * Both map to real NHS-SIM incident scenarios (`winter-pressure`, `staff-shortage`), but
 * /api/control/incidents is operator-gated — 403 with a team key. Engine toggles only unless the
 * organisers fire one for us.
 */
export interface Environment {
  /** `winter-pressure`: more urgent arrivals, fewer beds. */
  winterPressure: boolean;
  /** `staff-shortage`: fewer community home-visit slots. */
  staffShortage: boolean;

  // Magnitudes, applied only when the matching toggle is on. Sourced so they appear in the
  // parameter panel and can be argued with, rather than buried as constants in the engine.

  /** Multiplier on total demand under winter pressure. */
  winterDemandMultiplier: Sourced;
  /** Multiplier on the urgent share under winter pressure — the mix shifts, not just the volume. */
  winterUrgentMultiplier: Sourced;
  /** Multiplier on community capacity under a staffing shortage. */
  shortageCommunityMultiplier: Sourced;
}

// ---------------------------------------------------------------------------
// Run configuration — engine mechanics, not policy
// ---------------------------------------------------------------------------

export interface SimConfig {
  /** Simulated days per run. Ten years must complete in well under a second. */
  horizonDays: number;
  /** Days discarded before metrics collection, so the queue reaches steady state first. */
  warmupDays: number;
  /**
   * NHS-SIM's baseline is an unserved queue: 1,307 of 1,312 attendances still `waiting` after
   * nine sim-days. If the engine reproduces that, every metric diverges. Start from a served
   * steady state and say so, or reproduce the gridlock deliberately — but pick one.
   */
  startFromSteadyState: boolean;
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export interface Params {
  arrivals: Arrivals;
  capacities: Capacities;
  serviceTimes: ServiceTimes;
  routing: Routing;
  levers: Levers;
  boundaries: Boundaries;
  environment: Environment;
  sim: SimConfig;
  /** Provenance of the whole set — which snapshot, which document, when. */
  meta: ParamsMeta;
}

export interface ParamsMeta {
  /** NHS-SIM world id, e.g. "team-4551d2471320". */
  worldId?: string;
  /** Snapshot directory these were calibrated from. */
  snapshotId?: string;
  /** Filename of the uploaded policy, if extraction produced this set. */
  sourceDocument?: string;
  calibratedAt?: number;
}

// ---------------------------------------------------------------------------
// Helpers the whole team uses
// ---------------------------------------------------------------------------

/** Every Sourced leaf in a Params, flattened. Drives the parameter panel and the source table. */
export type ParamPath = string;

export interface FlatParam extends Sourced {
  path: ParamPath;
}

/** A parameter needs attention on screen if it is assumed, unsourced, or has no range. */
export interface ParamFlag {
  path: ParamPath;
  reason: 'assumed' | 'no-citation' | 'no-range';
}
