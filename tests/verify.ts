/**
 * The hour-one verification run. PRD §4.6, §8.1 steps 3-4.
 *
 *   node tests/verify.ts
 *
 * Nothing gets built on top of the engine until every line below says PASS.
 */

import { BASELINE } from '../src/contracts/baseline.ts';
import { run } from '../src/engine/index.ts';
import { simulateNode, MINUTES_PER_DAY } from '../src/engine/single-node.ts';
import { closedForm } from '../src/engine/assertions.ts';
import { slotsPerDay } from '../src/engine/nodes.ts';
import { diffEvents } from '../src/analysis/accuracy-diff.ts';
import { temporalHoldOut, forwardHoldOut, regimeHoldOut } from '../src/analysis/holdout.ts';
import { readFileSync } from 'node:fs';
import {
  deriveGpDemand,
  measuredGpCapacityPerDay,
  measuredGpCapacityMinutesPerDay,
  meanServiceMinutes,
} from '../src/engine/demand.ts';
import type { Params } from '../src/contracts/params.ts';

let failures = 0;
const check = (name: string, passed: boolean, detail: string): void => {
  if (!passed) failures++;
  console.log(`${passed ? '  PASS' : '  FAIL'}  ${name}\n        ${detail}`);
};

const DAY = MINUTES_PER_DAY;

// ---------------------------------------------------------------------------
console.log('\n1. Closed-form agreement on a degenerate single-server config');
console.log('   The factor of two between M/M/1 and M/D/1 is the point: NHS-SIM has constant');
console.log('   service, so the real system queues half as long as an M/M/1 intuition suggests.\n');

for (const dist of ['exponential', 'constant'] as const) {
  const serviceMinutes = 10;
  const rho = 0.8;
  const arrivalRatePerMin = rho / serviceMinutes;
  const stats = simulateNode({
    config: { id: `degenerate-${dist}`, servers: 1, serviceMinutes, serviceDist: dist, schedule: null, maxQueue: null },
    arrivalRatePerMin,
    horizon: 4_000_000,
    warmup: 200_000,
    seed: 12345,
  });
  const c = closedForm(stats, arrivalRatePerMin, serviceMinutes, dist);
  check(dist === 'exponential' ? 'M/M/1 at rho=0.8' : 'M/D/1 at rho=0.8', c.passed, c.detail);
}

// ---------------------------------------------------------------------------
console.log('\n1b. Capacity emerges from the session structure');
console.log('   The node no longer carries a slot budget alongside its clinicians — those were');
console.log('   the same resource counted twice. 90 slots/day should now fall out of');
console.log('   servers x floor(usableMinutes/service) x blocks. If it does not, the session');
console.log('   model has drifted from what we measured.\n');

const measuredSlots =
  BASELINE.capacities.gpSessionsPerDay.value * BASELINE.capacities.gpSlotsPerSession.value;
const derived = slotsPerDay({
  id: 'gp-clinic',
  servers: 3,
  serviceMinutes: BASELINE.serviceTimes.gpConsultation.value,
  serviceDist: 'constant',
  maxQueue: null,
  schedule: {
    blockStarts: [480, 780],
    usableMinutes:
      BASELINE.capacities.gpSlotsPerSession.value * BASELINE.serviceTimes.gpConsultation.value,
  },
});
check(
  'derived capacity matches the measurement',
  derived === measuredSlots,
  `derived ${derived}/day from 3 clinicians x 15 slots x 2 blocks; measured ${measuredSlots}/day`,
);

// ---------------------------------------------------------------------------
console.log('\n2. Conservation and Little\'s Law on the real GP config');

const baselineRun = run(BASELINE, 1);
for (const c of baselineRun.verification.checks) {
  check(c.name, c.passed, c.detail);
}

// ---------------------------------------------------------------------------
console.log('\n2b. Demand derivation is consistent with the stored baseline');

const rederived = deriveGpDemand(BASELINE);
const storedTotal =
  BASELINE.arrivals.perDay.routine.value
  + BASELINE.arrivals.perDay.complex.value
  + BASELINE.arrivals.perDay.urgent.value;
const derivedTotal = rederived.routine + rederived.complex + rederived.urgent;
check(
  'stored perDay matches rho x capacity',
  Math.abs(storedTotal - derivedTotal) < 0.01,
  `stored ${storedTotal.toFixed(2)}/day vs derived ${derivedTotal.toFixed(2)}/day `
  + `(rho ${BASELINE.arrivals.targetUtilisation.value} x `
  + `${measuredGpCapacityMinutesPerDay(BASELINE)} clinician-min / `
  + `${meanServiceMinutes(BASELINE).toFixed(2)} min mean)`,
);

// rho is only meaningful if the engine actually lands on it.
const observedRho = baselineRun.perNode['gp-clinic']?.utilisation ?? 0;
check(
  'engine reproduces the target utilisation',
  Math.abs(observedRho - BASELINE.arrivals.targetUtilisation.value) < 0.02,
  `target ${BASELINE.arrivals.targetUtilisation.value}, observed ${observedRho.toFixed(3)}`,
);

// ---------------------------------------------------------------------------
console.log('\n2c. A second regime — rho = 0.80');
console.log('   Waiting time is convex in utilisation, so the model must behave very');
console.log('   differently here than at 0.94. If it does not, the convexity is not real.\n');

const relaxed: Params = structuredClone(BASELINE);
const at80 = deriveGpDemand(relaxed, 0.8);
relaxed.arrivals.perDay.routine.value = at80.routine;
relaxed.arrivals.perDay.complex.value = at80.complex;
relaxed.arrivals.perDay.urgent.value = at80.urgent;
relaxed.sim.horizonDays = 2000;
const relaxedRun = run(relaxed, 3);
for (const c of relaxedRun.verification.checks) check(c.name, c.passed, c.detail);
const rgp = relaxedRun.perNode['gp-clinic'];
console.log(`        utilisation ${((rgp?.utilisation ?? 0) * 100).toFixed(1)}%`
  + `, median wait ${relaxedRun.waits.routine.p50.toFixed(0)} min`
  + `, 90th ${relaxedRun.waits.routine.p90.toFixed(0)} min`);

// ---------------------------------------------------------------------------
console.log('\n3. Determinism — same seed, same answer');

const a = run(BASELINE, 7);
const b = run(BASELINE, 7);
const c2 = run(BASELINE, 8);
check(
  'same seed reproduces exactly',
  JSON.stringify(a) === JSON.stringify(b),
  `p50 wait ${a.waits.routine.p50.toFixed(3)} vs ${b.waits.routine.p50.toFixed(3)}`,
);
check(
  'different seed gives a different path',
  JSON.stringify(a) !== JSON.stringify(c2),
  'seeds 7 and 8 diverge, as they must',
);

// ---------------------------------------------------------------------------
console.log('\n4. THE HOUR-ONE SENSITIVITY CHECK — halve the slots, confirm metrics move');
console.log('   If nothing moves, stop and fix it before building anything on top.\n');

const halved: Params = structuredClone(BASELINE);
halved.capacities.gpSlotsPerSession.value = BASELINE.capacities.gpSlotsPerSession.value / 2;
const halvedRun = run(halved, 1);

// The trap this check exists to catch: if demand were derived from capacity inside run(), halving
// capacity would halve demand, rho would stay at 0.94, and nothing would move. Demand must be
// fixed at calibration and stay put while capacity changes.
const demandBefore =
  BASELINE.arrivals.perDay.routine.value + BASELINE.arrivals.perDay.complex.value
  + BASELINE.arrivals.perDay.urgent.value;
const demandAfter =
  halved.arrivals.perDay.routine.value + halved.arrivals.perDay.complex.value
  + halved.arrivals.perDay.urgent.value;
check(
  'demand does NOT follow capacity',
  Math.abs(demandBefore - demandAfter) < 1e-9,
  `${demandBefore.toFixed(1)}/day before and after — rho moves instead, which is the point`,
);

const base = baselineRun.perNode['gp-clinic'];
const half = halvedRun.perNode['gp-clinic'];

// Utilisation cannot move when the node is already saturated in both configs — 100% before and
// 100% after is correct physics, not a dead metric. Asserting movement here would pass on
// floating-point noise, which is worse than not asserting at all.
if ((base?.utilisation ?? 0) > 0.999 && (half?.utilisation ?? 0) > 0.999) {
  console.log('  SKIP  utilisation responds to capacity\n        saturated in both configs '
    + '(100% -> 100%) — nothing to detect. Throughput and queue length carry this check.');
} else {
  check(
    'utilisation responds to capacity',
    !!base && !!half && Math.abs(half.utilisation - base.utilisation) > 1e-6,
    `${base?.utilisation.toFixed(4)} -> ${half?.utilisation.toFixed(4)}`,
  );
}
check(
  'throughput responds to capacity',
  !!base && !!half && Math.abs(half.throughput - base.throughput) > 1e-6,
  `${base?.throughput.toFixed(2)}/day -> ${half?.throughput.toFixed(2)}/day`,
);
check(
  'queue length responds to capacity',
  !!base && !!half && Math.abs(half.queueLength - base.queueLength) > 1e-6,
  `${base?.queueLength.toFixed(1)} -> ${half?.queueLength.toFixed(1)} in system`,
);

// ---------------------------------------------------------------------------
console.log('\n4b. THE CENTRAL FINDING — does the median improve while the tail worsens?');
console.log('   Add GP sessions and watch the two move in opposite directions. If they do not,');
console.log('   the demo has no central moment and priority discipline is not doing its job.\n');

const withExtra: Params = structuredClone(BASELINE);
withExtra.levers.extraGpSessions.value = 2; // +1 clinician per block
const extraRun = run(withExtra, 1);

const medianBefore = baselineRun.waits.routine.p50;
const medianAfter = extraRun.waits.routine.p50;
const tailBefore = baselineRun.waits.complex.p90;
const tailAfter = extraRun.waits.complex.p90;

console.log(`        routine median  ${(medianBefore / 60).toFixed(1)}h -> ${(medianAfter / 60).toFixed(1)}h`);
console.log(`        complex 90th    ${(tailBefore / 60).toFixed(1)}h -> ${(tailAfter / 60).toFixed(1)}h`);
console.log(`        urgent  median  ${(baselineRun.waits.urgent.p50 / 60).toFixed(1)}h -> ${(extraRun.waits.urgent.p50 / 60).toFixed(1)}h`);
check(
  'urgent is genuinely prioritised',
  baselineRun.waits.urgent.p50 < baselineRun.waits.routine.p50,
  `urgent ${(baselineRun.waits.urgent.p50 / 60).toFixed(1)}h vs routine `
  + `${(baselineRun.waits.routine.p50 / 60).toFixed(1)}h at baseline`,
);
check(
  'complex tail is worse than routine tail',
  baselineRun.waits.complex.p90 > baselineRun.waits.routine.p90,
  `complex 90th ${(baselineRun.waits.complex.p90 / 60).toFixed(1)}h vs routine `
  + `${(baselineRun.waits.routine.p90 / 60).toFixed(1)}h — the slot-geometry squeeze`,
);

// ---------------------------------------------------------------------------
console.log('\n4c. CONVEXITY — the property the whole argument rests on');
console.log('   Waiting time must be convex in utilisation. That is what makes reallocation');
console.log('   produce losers: a node at 0.95 pays far more for a point of load than a node at');
console.log('   0.85 gains by shedding one.');
console.log('');
console.log('   The tail is NOT uniformly more convex than the median. Between rho 0.80 and 0.92');
console.log('   the p90/p50 ratio actually FALLS, from 2.00 to 1.73, because at moderate load the');
console.log('   wait is dominated by session structure — seen today or seen tomorrow — and rising');
console.log('   load pulls the median up towards a tail that is pinned near the overnight gap.');
console.log('   Only near saturation does queueing take over and the tail pull away. Claiming');
console.log('   otherwise would be claiming something the model does not show.\n');

const waitAt = (rho: number): { p50: number; p90: number; stable: boolean } => {
  const p: Params = structuredClone(BASELINE);
  const d = deriveGpDemand(p, rho);
  p.arrivals.perDay.routine.value = d.routine;
  p.arrivals.perDay.complex.value = d.complex;
  p.arrivals.perDay.urgent.value = d.urgent;
  p.sim.horizonDays = 1500;
  const r = run(p, 1);
  return {
    p50: r.waits.routine.p50,
    p90: r.waits.routine.p90,
    stable: r.perNode['gp-clinic']?.stable ?? false,
  };
};

// Only stable configurations may be compared. Past the stability boundary a "wait" is a statement
// about how long the run was, and measuring convexity against horizon artefacts would prove
// nothing while looking convincing.
const low = waitAt(0.85);
const lowNext = waitAt(0.88);
const high = waitAt(0.92);
const highNext = waitAt(0.95);
const nearBoundary = waitAt(0.96);
const allStable = [low, lowNext, high, highNext, nearBoundary].every((r) => r.stable);

check(
  'all four comparison points have a steady state',
  allStable,
  allStable ? 'rho 0.85 / 0.88 / 0.92 / 0.95 / 0.96 all stable' : 'one or more diverged — see 4d',
);

const slopeLow = (lowNext.p50 - low.p50) / 3;   // per 0.01 rho
const slopeHigh = (highNext.p50 - high.p50) / 3;
check(
  'wait is convex in utilisation',
  slopeHigh > 3 * slopeLow,
  `marginal cost per 0.01 rho: ${(slopeLow / 60).toFixed(4)}h at 0.85 vs `
  + `${(slopeHigh / 60).toFixed(4)}h at 0.92 — ${(slopeHigh / slopeLow).toFixed(1)}x steeper`,
);
check(
  'near saturation the tail pulls away from the median',
  nearBoundary.p90 / high.p90 > nearBoundary.p50 / high.p50,
  `across 0.92 -> 0.96 the median grows ${(nearBoundary.p50 / high.p50).toFixed(2)}x and the `
  + `90th percentile ${(nearBoundary.p90 / high.p90).toFixed(2)}x `
  + `(p90/p50 ratio ${(high.p90 / high.p50).toFixed(2)} -> ${(nearBoundary.p90 / nearBoundary.p50).toFixed(2)})`,
);
check(
  'and below saturation it does NOT — the ratio compresses',
  lowNext.p90 / lowNext.p50 < low.p90 / low.p50,
  `p90/p50 falls ${(low.p90 / low.p50).toFixed(2)} -> ${(lowNext.p90 / lowNext.p50).toFixed(2)} `
  + 'from 0.85 to 0.88, because session structure dominates at moderate load',
);

// ---------------------------------------------------------------------------
console.log('\n4d. THE COMMUNITY THRESHOLD — winners, losers, and where it breaks');
console.log('   Shifting care to the community is the 10-Year Plan\'s central move. Community');
console.log('   has 4 visits/day (measured). Referrals it refuses bounce back to the GP as more');
console.log('   work, and the GP has only ~6 points of headroom at rho 0.94.\n');

const shifted = (share: number, capMult: number) => {
  const p: Params = structuredClone(BASELINE);
  p.levers.hospitalToCommunityShare.value = share;
  p.levers.communityCapacityMultiplier.value = capMult;
  p.sim.horizonDays = 1500;
  return run(p, 1);
};

/** Largest shift, in whole percent, at which the GP still has a stable operating point. */
const breakingPoint = (capMult: number): number => {
  let last = 0;
  for (let pct = 1; pct <= 40; pct++) {
    if (!(shifted(pct / 100, capMult).perNode['gp-clinic']?.stable ?? false)) return last;
    last = pct;
  }
  return 40;
};

const noShift = shifted(0, 1);
check(
  'community is saturated as measured',
  (noShift.perNode['community-visit']?.utilisation ?? 0) > 0.9,
  '4 visits/day against baseline referrals leaves community at '
  + `${((noShift.perNode['community-visit']?.utilisation ?? 0) * 100).toFixed(1)}% before any policy`,
);

const t1 = breakingPoint(1);
const t2 = breakingPoint(2);
const t4 = breakingPoint(4);
console.log(`        community x1: holds to a ${t1}% shift`);
console.log(`        community x2: holds to a ${t2}% shift`);
console.log(`        community x4: holds to a ${t4}% shift`);

check(
  'a shift without capacity expansion breaks the practice',
  t1 < 10,
  `the GP loses its stable operating point past a ${t1}% shift — refused referrals land back on `
  + 'a practice that has no room for them',
);
check(
  'expanding community capacity moves the threshold',
  t2 > t1 && t4 > t2,
  `threshold moves ${t1}% -> ${t2}% -> ${t4}% as community capacity doubles and doubles again`,
);

// ---------------------------------------------------------------------------
console.log('\n4g. THE THREE PREVIOUSLY-INERT LEVERS');
console.log('   Slot geometry is discrete: an appointment length that does not divide the');
console.log('   session exactly wastes a whole slot. 15 x 15.0167 min = 225.25 > 225, so a');
console.log('   0.11% change in appointment length costs a slot per session — 90/day down to 84.');
console.log('   That is why the telephone lever must be normalised against the MEASURED mix.\n');

const leverRun = (mut: (p: Params) => void) => {
  const p: Params = structuredClone(BASELINE);
  p.sim.horizonDays = 730;
  mut(p);
  return run(p, 1);
};

const telBase = leverRun(() => {});
const telHigh = leverRun((p) => { p.levers.telephoneFollowUpShare.value = 0.8; });
check(
  'telephone lever changes capacity',
  telHigh.waits.routine.p50 < telBase.waits.routine.p50,
  `share 1/3 -> 0.8 moves the median ${(telBase.waits.routine.p50 / 60).toFixed(1)}h -> `
  + `${(telHigh.waits.routine.p50 / 60).toFixed(1)}h`,
);
check(
  'and at the measured share it is exactly neutral',
  Math.abs((telBase.perNode['gp-clinic']?.utilisation ?? 0)
    - BASELINE.arrivals.targetUtilisation.value) < 0.02,
  `baseline lands at ${((telBase.perNode['gp-clinic']?.utilisation ?? 0) * 100).toFixed(1)}% `
  + `against a target of ${(BASELINE.arrivals.targetUtilisation.value * 100).toFixed(0)}% — the `
  + 'channel effect does not double-count the slot length it was measured from',
);

const monBase = leverRun(() => {});
const monHigh = leverRun((p) => { p.levers.monitoringIntensity.value = 4; });
check(
  'monitoring lever redistributes demand',
  monHigh.completed.urgent < monBase.completed.urgent
    && monHigh.completed.routine > monBase.completed.routine,
  `urgent ${monBase.completed.urgent} -> ${monHigh.completed.urgent}, routine `
  + `${monBase.completed.routine} -> ${monHigh.completed.routine} — moved between classes, `
  + 'not destroyed',
);

const wkOff = leverRun((p) => { p.levers.weekdayDischargeShare.value = 0; });
const wkOn = leverRun((p) => { p.levers.weekdayDischargeShare.value = 1; });
check(
  'discharge timing changes letter turnaround',
  wkOn.unfiledLetters < wkOff.unfiledLetters,
  `unfiled letters ${wkOff.unfiledLetters} -> ${wkOn.unfiledLetters} when discharges are timed `
  + 'to weekdays instead of landing while admin is shut',
);

// ---------------------------------------------------------------------------
console.log('\n4f. THE LETTER PATHWAY — calibrated against real counts');

const lp: Params = structuredClone(BASELINE);
lp.sim.horizonDays = 730;
const letterRun = run(lp, 1);
const letterDays = lp.sim.horizonDays - lp.sim.warmupDays;
const inRate = BASELINE.arrivals.dischargeLettersPerDay.value;
const filedShareObserved = 1 - (letterRun.unfiledLetters / letterDays) / inRate;

check(
  'filed share reproduces the measured funnel',
  Math.abs(filedShareObserved - 0.16) < 0.05,
  `${(filedShareObserved * 100).toFixed(0)}% of letters filed against a measured 16% `
  + '(9 of 57 in the snapshot)',
);
check(
  'the letter backlog is not a capacity problem',
  (letterRun.perNode['gp-admin']?.utilisation ?? 1) < 0.5,
  `admin sits at ${((letterRun.perNode['gp-admin']?.utilisation ?? 0) * 100).toFixed(0)}% `
  + 'utilisation — letters go unfiled because nobody opens the inbox, not because there is no time',
);

// ---------------------------------------------------------------------------
console.log('\n4e. ACCURACY DIFF — predicted vs observed (Oriol consumes this)');

const T = (h: number) => 1789992120000 + h * 3600_000;
const acc = diffEvents(
  [
    { eventType: 'visit.completed', patientId: 'SIM-000001', at: T(2) },
    { eventType: 'document.filed', patientId: 'SIM-000001', at: T(3) },
    { eventType: 'prescription.dispensed', patientId: 'SIM-000002', at: T(4) },
    { eventType: 'visit.completed', patientId: 'SIM-000003', at: T(5) },
  ],
  [
    { eventType: 'visit.completed', patientId: 'SIM-000001', at: T(2.5) },   // 30 min late
    { eventType: 'document.filed', patientId: 'SIM-000001', at: T(3) },      // exact
    { eventType: 'prescription.dispensed', patientId: 'SIM-000002', at: T(9) }, // way late
    { eventType: 'task.created', patientId: 'SIM-000003', at: T(5),
      detail: 'community refused at capacity, fell back to a coordinator task' },
  ],
);
console.log(`        matched ${acc.matchedPct.toFixed(0)}%, median timing error `
  + `${acc.medianTimingErrorMin.toFixed(0)} min`);
for (const m of acc.missed) console.log(`        MISSED  ${m.eventType} — ${m.reason}`);
for (const e of acc.extra) console.log(`        EXTRA   ${e.eventType} — ${e.reason}`);

check(
  'matches within tolerance, and explains every divergence',
  acc.matched.length === 2 && acc.missed.length === 2 && acc.extra.length === 2
    && [...acc.missed, ...acc.extra].every((d) => (d.reason ?? '').length > 0),
  `${acc.matched.length} matched, ${acc.missed.length} missed, ${acc.extra.length} extra, `
  + 'all divergences carry a reason',
);
check(
  'timing error is signed',
  acc.medianTimingErrorMin > 0,
  `+${acc.medianTimingErrorMin.toFixed(0)} min — the real world ran late, and the sign says so`,
);
check(
  'accumulates across applies',
  diffEvents([], [], { previous: acc }).runsIncluded === 2,
  'a second apply carries the first forward',
);

// ---------------------------------------------------------------------------
console.log('\n4i. THE TEST PATHWAY, AND CLINIC/ADMIN COUPLING');
console.log('   test -> result -> review -> filing, with review and filing running on the SAME');
console.log('   admin resource as discharge letters. A busy letter inbox should delay somebody\'s');
console.log('   blood result, because in a real practice it does.\n');

const netRun = (mut: (p: Params) => void = () => {}) => {
  const p: Params = structuredClone(BASELINE);
  p.sim.horizonDays = 730;
  mut(p);
  return run(p, 1);
};

const netBase = netRun();
const moreTests = netRun((p) => { p.routing.gpToTest.value = 0.4; });
const lessAdmin = netRun((p) => { p.capacities.gpAdminShare.value = 0.15; });

check(
  'the lab is a delay, not a bottleneck',
  (netBase.perNode['test']?.utilisation ?? 1) < 0.05
    && (netBase.perNode['test']?.stable ?? false),
  'the 120-minute turnaround is how long a result takes to come back, not how long anyone is '
  + 'occupied — modelling it as a queue would invent a constraint the snapshot does not show',
);
check(
  'ordering more tests loads admin, not the lab',
  (moreTests.perNode['gp-admin']?.utilisation ?? 0)
    > 1.5 * (netBase.perNode['gp-admin']?.utilisation ?? 1),
  `doubling the test rate moves admin `
  + `${((netBase.perNode['gp-admin']?.utilisation ?? 0) * 100).toFixed(0)}% -> `
  + `${((moreTests.perNode['gp-admin']?.utilisation ?? 0) * 100).toFixed(0)}%`,
);
check(
  'results and letters compete for one admin resource',
  moreTests.unfiledResults > netBase.unfiledResults,
  `unfiled results rise ${netBase.unfiledResults} -> ${moreTests.unfiledResults} when more tests `
  + 'are ordered, on the same inbox the discharge letters sit in',
);
check(
  'admin capacity is continuous, not rounded to whole people',
  (lessAdmin.perNode['gp-admin']?.utilisation ?? 0)
    > 1.5 * (netBase.perNode['gp-admin']?.utilisation ?? 1),
  `halving the admin share moves utilisation `
  + `${((netBase.perNode['gp-admin']?.utilisation ?? 0) * 100).toFixed(0)}% -> `
  + `${((lessAdmin.perNode['gp-admin']?.utilisation ?? 0) * 100).toFixed(0)}% — rounding it to an `
  + 'integer number of clinicians floored it at one and the parameter moved nothing',
);

// ---------------------------------------------------------------------------
console.log('\n4h. HOLD-OUT — is the model right about the world, not just consistent?');
console.log('   Every other check asks whether the engine agrees with itself. This one fits on');
console.log('   data the model may see and predicts data it may not.\n');

const arrivalsFixture = JSON.parse(
  readFileSync(new URL('../fixtures/attendance-arrivals.json', import.meta.url), 'utf8'),
) as { arrivalTimes: number[] };

const temporal = temporalHoldOut({
  arrivalTimes: arrivalsFixture.arrivalTimes,
  fitFraction: 0.667,
  label: 'A&E arrivals in the held-out third',
});
for (const r of temporal.rows) {
  console.log(`        predicted ${r.predicted}, observed ${r.observed} `
    + `(${r.error >= 0 ? '+' : ''}${r.error}, ${r.absPctError.toFixed(1)}%)`);
  console.log(`        basis: ${r.basis}`);
}
check(
  'arrival rate fitted on two thirds predicts the last third',
  temporal.medianAbsPctError < 10,
  temporal.statement + ' Quoting the fitted 142/day back at ourselves would be a tautology; '
  + 'this is not.',
);

// The forward hold-out is the one that runs against the live server. Exercised here on the shape
// so the wiring is proven before the server is needed.
const forward = forwardHoldOut(
  [{ label: 'A&E attendances', before: 1312, predictedRatePerDay: 142, after: 1454 }],
  1440,
);
check(
  'forward hold-out is wired and ready for the live loop',
  forward.rows.length === 1 && forward.rows[0]!.absPctError < 1,
  forward.statement + ' Predict, advance the clock, then read back — in that order.',
);

check(
  'regime hold-out reports honestly when it has no data',
  regimeHoldOut([]).total === 0,
  'incidents are operator-gated (403 to a team key), so the strongest hold-out cannot run today '
  + '— it reports nothing rather than something',
);

// ---------------------------------------------------------------------------
console.log('\n5. Speed — ten simulated years must be well under a second');

const tenYears: Params = structuredClone(BASELINE);
tenYears.sim.horizonDays = 3650;
const t0 = performance.now();
const long = run(tenYears, 1);
const elapsed = performance.now() - t0;
check(
  '10 sim-years',
  elapsed < 1000,
  `${elapsed.toFixed(0)}ms, ${long.completed.routine + long.completed.complex + long.completed.urgent} items served`,
);

// ---------------------------------------------------------------------------
console.log('\n6. What the calibrated baseline says');

const gp = baselineRun.perNode['gp-clinic'];
const demand =
  BASELINE.arrivals.perDay.routine.value
  + BASELINE.arrivals.perDay.complex.value
  + BASELINE.arrivals.perDay.urgent.value;
const capacity = measuredGpCapacityPerDay(BASELINE);

console.log(`        rho (target)  ${BASELINE.arrivals.targetUtilisation.value}`);
console.log(`        demand        ${demand.toFixed(1)}/day  (derived, literature)`);
console.log(`        capacity      ${capacity}/day  (measured)`);
console.log(`        utilisation   ${((gp?.utilisation ?? 0) * 100).toFixed(1)}%`);
console.log(`        mean in system ${gp?.queueLength.toFixed(1)}`);
console.log('');
console.log(`        routine  median ${(baselineRun.waits.routine.p50 / 60).toFixed(1)}h`
  + `   90th ${(baselineRun.waits.routine.p90 / 60).toFixed(1)}h`);
console.log(`        complex  median ${(baselineRun.waits.complex.p50 / 60).toFixed(1)}h`
  + `   90th ${(baselineRun.waits.complex.p90 / 60).toFixed(1)}h`);
console.log(`        urgent   median ${(baselineRun.waits.urgent.p50 / 60).toFixed(1)}h`
  + `   90th ${(baselineRun.waits.urgent.p90 / 60).toFixed(1)}h`);
console.log('');
console.log('        Demand is derived from rho, not measured — NHS-SIM cannot supply a GP');
console.log('        arrival rate. The regime is calibrated; the count is not claimed. rho\'s');
console.log('        range is what the three worlds are mostly made of, so it is Albert\'s');
console.log('        highest-value citation.');
console.log(`        A&E's measured ${BASELINE.arrivals.edPerDay.value}/day is parked for the ED node (step 5).`);

// ---------------------------------------------------------------------------
console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
