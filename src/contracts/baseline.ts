/**
 * BASELINE — Params as measured from NHS-SIM world team-4551d2471320 on 12 Sep 2026.
 *
 * This is the locked baseline every result is shown as a delta against (PRD §4.8).
 * Derivations and caveats: docs/calibration-findings.md.
 *
 * OWNER: Kaavya. Oriol's calibration extractor overwrites the `measured` entries from a fresh
 * snapshot; the `literature` and `assumed` entries are Albert's to source.
 */

import type { Params, Sourced } from './params.ts';

const SNAP = 'snapshot 2026-09-21T12:02Z · world team-4551d2471320';

/** Terse constructor so the table below stays readable. */
const s = (
  value: number,
  bounds: readonly [number, number],
  source: Sourced['source'],
  citation?: string,
  extra: Partial<Sourced> = {},
): Sourced => ({ value, bounds, source, citation, ...extra });

export const BASELINE: Params = {
  // GP demand is DERIVED from targetUtilisation, not measured — see the note on `targetUtilisation`
  // in params.ts. rho is defined in clinician-MINUTES, not patient counts, because complex
  // appointments are longer: 0.94 x 1,350 min/day / 17.25 min mean = 73.6 patients/day.
  arrivals: {
    perDay: {
      routine: s(58.852, [0, 1000], 'literature', 'derived: 0.94 x 1350min / 17.25min x 0.80', {
        derived: true,
        range: [46.5, 64.4], // rho and mix ranges propagated
        note: 'Derived, not measured. Re-derive with deriveGpDemand() if capacity or rho change.',
      }),
      complex: s(11.035, [0, 1000], 'assumed', 'derived: 0.94 x 1350min / 17.25min x 0.15', {
        derived: true,
        range: [5.3, 18.3],
        note: '⚠️ Carries the median-improves-tail-worsens finding, and rests on an assumed share. '
          + 'Albert: this is the most load-bearing unsourced number in the model.',
      }),
      urgent: s(3.678, [0, 1000], 'assumed', 'derived: 0.94 x 1350min / 17.25min x 0.05', {
        derived: true,
        range: [1.3, 7.3],
      }),
    },

    targetUtilisation: s(0.94, [0, 1.2], 'literature', undefined, {
      range: [0.85, 0.99],
      note: 'TODO(albert): needs a real citation for utilisation in English general practice. '
        + 'Expect this at the top of the tornado — waiting time is convex in it, so its range '
        + 'drives the width of the three worlds more than anything else in the model.',
    }),

    classMix: {
      routine: s(0.80, [0, 1], 'assumed', undefined, { range: [0.70, 0.88] }),
      complex: s(0.15, [0, 1], 'assumed', undefined, {
        range: [0.08, 0.25],
        note: 'NHS-SIM has only acuity 2 and 3, so "complex" has no ground truth at all.',
      }),
      urgent: s(0.05, [0, 1], 'assumed', undefined, {
        range: [0.02, 0.10],
        note: 'A&E acuity-2 share was 0.2%, but that is emergency mix, not GP mix.',
      }),
    },

    dischargeLettersPerDay: s(6.3, [0, 500], 'measured',
      `${SNAP} · 57 discharge summaries over ~9 sim-days`, {
      range: [5, 8],
      note: 'A hospital-driven stream, independent of GP demand.',
    }),
    edPerDay: s(142, [0, 10000], 'measured', `${SNAP} · attendances.createdAt, 9 sim-days`, {
      range: [140, 144],
      note: 'Parked for the ED node (step 5). Must NOT be fed to the GP node — doing so was what '
        + 'produced the 691-day baseline wait.',
    }),
  },

  capacities: {
    gpSessionsPerDay: s(6, [0, 24], 'measured', `${SNAP} · appointments?date=2026-09-12`),
    gpSlotsPerSession: s(15, [0, 64], 'measured', `${SNAP} · 240min / 15min − 1 protected break`),
    communitySlotsPerDay: s(4, [0, 200], 'measured', `${SNAP} · capacity-community.data.total`, {
      note: 'The binding constraint. Small base means the capacity multiplier bites hard.',
    }),
    staffedSpaces: s(8, [0, 100], 'measured', `${SNAP} · view.staffing (4 doctors, 4 nurses)`),
    gpAdminShare: s(0.3, [0, 1], 'literature', undefined, {
      note: 'TODO(albert): source this. It couples the clinic and admin queues, so the tornado '
        + 'may well find it dominant.',
    }),
  },

  serviceTimes: {
    gpConsultation: s(15, [1, 240], 'measured', `${SNAP} · session.data.slotMinutes`),
    communityVisit: s(90, [1, 480], 'measured', `${SNAP} · provenance.changes, n=7, variance 0`, {
      note: 'Constant in the ground truth, and matches the handbook figure exactly.',
    }),
    documentReviewHop: s(60, [1, 1440], 'measured', `${SNAP} · provenance.changes, n=28, variance 0`, {
      note: 'Elapsed turnaround between status changes — NOT clinician effort.',
    }),
    documentReviewWork: s(4, [1, 60], 'assumed', undefined, {
      range: [2, 8],
      note: 'Clinician minutes per letter. Not measurable in NHS-SIM — the sim records elapsed '
        + 'time between status changes, not work content. TODO(albert): source it.',
    }),
    bloodResultTurnaround: s(120, [1, 2880], 'documented', 'NHS-SIM handbook', {
      note: 'Not yet observed live — no completed result transitions in this world.',
    }),
    pharmacyApproval: s(60, [1, 1440], 'assumed', undefined, {
      note: 'Not measurable: exactly one approved prescription exists in the world.',
    }),
    classMultiplier: {
      routine: s(1, [1, 1], 'measured', `${SNAP} · the 15-minute slot is the unit`),
      complex: s(2, [1, 6], 'assumed', undefined, {
        range: [1.5, 3],
        note: 'A double appointment. Assumed — NHS-SIM has no complex class to measure. '
          + 'Drives the tail finding, so its range feeds straight into the three worlds.',
      }),
      urgent: s(1, [1, 6], 'assumed', undefined, { range: [1, 1.5] }),
    },
  },

  routing: {
    gpToTest: s(0.2, [0, 1], 'assumed'),
    gpToHospital: s(0.1, [0, 1], 'assumed'),
    gpToCommunity: s(0.05, [0, 1], 'assumed'),
    letterSentToReviewed: s(0.37, [0, 1], 'measured', `${SNAP} · 21 of 57 past 'sent'`),
    letterReviewedToFiled: s(0.16, [0, 1], 'measured', `${SNAP} · 9 of 57 filed`, {
      note: 'The manual-chasing attrition Chapter 3 is about. 84% of letters never get filed.',
    }),
    communityRejection: s(0, [0, 1], 'assumed', undefined, {
      note: 'Community refuses at capacity (409), but no baseline referral flow exists to measure.',
    }),
  },

  // Levers at baseline = "no policy applied". Extraction moves them.
  levers: {
    communityCapacityMultiplier: s(1, [0, 10], 'measured', `${SNAP} · baseline = no change`),
    extraGpSessions: s(0, [0, 12], 'measured', `${SNAP} · baseline = no change`),
    // Exactly 2/6, not 0.33. The engine normalises the channel effect against the measured share,
    // so a rounding difference here becomes a real change in appointment length — and at rho 0.94
    // a 0.11% change in appointment length was enough to flip the practice from stable to not.
    telephoneFollowUpShare: s(1 / 3, [0, 1], 'measured',
      `${SNAP} · 2 of 6 sessions mode=telephone`),
    monitoringIntensity: s(1, [0, 10], 'measured', `${SNAP} · baseline = no change`, {
      note: 'Base is measurable; the EFFECT of monitoring on admission is not in the sim. '
        + 'Effect size must come from the corpus.',
    }),
    hospitalToCommunityShare: s(0, [0, 1], 'literature', undefined, {
      note: '⚠️ NOT GROUNDED. The only 7 community visits in the world were created by team14. '
        + 'There is no baseline referral flow to measure.',
    }),
    weekdayDischargeShare: s(1, [0, 1], 'assumed', undefined, {
      range: [0.7, 1],
      note: '⚠️ The weekend is ours: NHS-SIM has no weekday logic. Acts on letter turnaround '
        + 'only — admin is shut at weekends, so a Saturday discharge waits for Monday.',
    }),
  },

  effects: {
    telephoneServiceMultiplier: s(0.7, [0.2, 1.5], 'assumed', undefined, {
      range: [0.55, 0.9],
      note: 'A telephone consultation is shorter than a face-to-face one, but NHS-SIM books both '
        + 'in the same 15-minute slot, so it cannot tell us by how much. '
        + 'TODO(albert): source it — without a real number the telephone lever is decorative.',
    }),
    telephoneBaselineShare: s(1 / 3, [0, 1], 'measured',
      `${SNAP} · 2 of 6 sessions have data.mode = 'telephone'`, {
      note: 'Not a lever. The mix already inside the measured 15-minute slot, so the engine can '
        + 'normalise and avoid discounting a slot length that is already an average.',
    }),
    monitoringEscalationReduction: s(0.1, [0, 0.5], 'assumed', undefined, {
      range: [0, 0.25],
      note: 'Fraction of urgent/complex demand that monitoring turns into routine demand, per '
        + 'unit of intensity. The range starts at ZERO deliberately: "remote monitoring changes '
        + 'nothing" has to stay inside the pessimistic world, or the model assumes the answer.',
    }),
  },

  // All zero, each with a reverse breakeven. See the note on Boundaries in params.ts.
  boundaries: {
    inducedDemand: s(0, [0, 1], 'assumed', undefined, {
      note: 'Declared, not measured. NHS-SIM generates 142 arrivals/day regardless of what we do, '
        + 'so induced demand cannot occur in the ground truth. Report the breakeven instead.',
    }),
    substitution: s(0, [0, 1], 'assumed', undefined, {
      note: 'Declared. Report the breakeven.',
    }),
    gaming: s(0, [0, 1], 'assumed', undefined, {
      note: 'Declared. No coding or reclassification exists in the sim to game.',
    }),
  },

  environment: {
    winterPressure: false,
    staffShortage: false,
    winterDemandMultiplier: s(1.15, [1, 2], 'literature', undefined, {
      range: [1.08, 1.25],
      note: 'TODO(albert): source winter demand uplift in primary care.',
    }),
    winterUrgentMultiplier: s(1.6, [1, 5], 'literature', undefined, {
      range: [1.3, 2.2],
      note: 'NHS-SIM\'s winter-pressure scenario raises urgent arrivals; magnitude is ours.',
    }),
    shortageCommunityMultiplier: s(0.6, [0, 1], 'literature', undefined, {
      range: [0.45, 0.8],
      note: 'NHS-SIM\'s staff-shortage scenario reduces home-visit slots.',
    }),
  },

  sim: {
    horizonDays: 3650,
    warmupDays: 90,
    startFromSteadyState: true,
  },

  meta: {
    worldId: 'team-4551d2471320',
    snapshotId: '2026-09-21T12:02:00Z',
    calibratedAt: 1789992120000,
  },
};
