/**
 * BASELINE — Params as measured from NHS-SIM world team-4551d2471320 on 12 Sep 2026.
 *
 * This is the locked baseline every result is shown as a delta against (PRD §4.8).
 * Derivations and caveats: docs/calibration-findings.md.
 *
 * OWNER: Kaavya. Oriol's calibration extractor overwrites the `measured` entries from a fresh
 * snapshot; the `literature` and `assumed` entries are Albert's to source.
 */

import type { Params, Sourced } from './params';

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
  arrivals: {
    perDay: {
      // 1,309 of 1,312 attendances at acuity 3, over 9 sim-days at ~142/day.
      routine: s(141.7, [0, 1000], 'measured', `${SNAP} · attendances.createdAt, n=1312`, {
        range: [140, 144],
        note: 'σ ≈ 1.2 across nine sim-days — the generator is near-deterministic.',
      }),
      // Our construct: NHS-SIM has no complex class. Define it, then defend it.
      complex: s(0, [0, 1000], 'assumed', undefined, {
        note: 'NHS-SIM has only acuity 2 and 3. "Complex" is ours — a multi-service pathway. '
          + 'Needs a literature-sourced share of total demand from Albert.',
      }),
      urgent: s(0.3, [0, 1000], 'measured', `${SNAP} · acuity 2, n=3`, {
        note: 'Only 3 acuity-2 arrivals in nine days. Thin — widen the range before trusting it.',
      }),
    },
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
    documentReviewHop: s(60, [1, 1440], 'measured', `${SNAP} · provenance.changes, n=28, variance 0`),
    bloodResultTurnaround: s(120, [1, 2880], 'documented', 'NHS-SIM handbook', {
      note: 'Not yet observed live — no completed result transitions in this world.',
    }),
    pharmacyApproval: s(60, [1, 1440], 'assumed', undefined, {
      note: 'Not measurable: exactly one approved prescription exists in the world.',
    }),
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
    telephoneFollowUpShare: s(0.33, [0, 1], 'measured', `${SNAP} · 2 of 6 sessions mode=telephone`),
    monitoringIntensity: s(1, [0, 10], 'measured', `${SNAP} · baseline = no change`, {
      note: 'Base is measurable; the EFFECT of monitoring on admission is not in the sim. '
        + 'Effect size must come from the corpus.',
    }),
    hospitalToCommunityShare: s(0, [0, 1], 'literature', undefined, {
      note: '⚠️ NOT GROUNDED. The only 7 community visits in the world were created by team14. '
        + 'There is no baseline referral flow to measure.',
    }),
    weekdayDischargeShare: s(1, [0, 1], 'assumed', undefined, {
      note: '⚠️ NOT GROUNDED. NHS-SIM has no weekday logic — sessions are seeded for a fixed '
        + '7-day window from world creation. Amber on screen.',
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
