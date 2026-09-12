/**
 * run(params, seed) -> RunOutcome. The engine's one public entry point.
 *
 * OWNER: Kaavya. PRD §4.2.
 *
 * Pure. No global state, no I/O, no clock reads. A slider change is a full re-run from scratch,
 * and the same (params, seed) must always produce the same result — the precomputed grid and the
 * accuracy panel both depend on it.
 *
 * PHASE 1: single GP node. The network (test -> result -> review -> filing, hospital outpatient,
 * community visits, rejection feedback) is step 5; priority discipline is step 6. Get one queue
 * behaving correctly first.
 */

import type { Params, PatientClass, ByClass } from '../contracts/params.ts';
import type { RunOutcome, Tail, NodeState } from '../contracts/metrics.ts';
import { simulateNetwork, MINUTES_PER_DAY } from './simulate.ts';
import type { NodeConfig, NodeStats } from './nodes.ts';
import { verify, percentile, isStable } from './assertions.ts';

const CLASSES: readonly PatientClass[] = ['routine', 'complex', 'urgent'];

/**
 * How many times a referral may be refused and re-referred before the patient is managed another
 * way. Two is a judgement, not a measurement — flagged as such, and worth a sensitivity check.
 */
const MAX_REFERRAL_BOUNCES = 2;

export function run(params: Params, seed: number): RunOutcome {
  const horizon = params.sim.horizonDays * MINUTES_PER_DAY;
  const warmup = params.sim.warmupDays * MINUTES_PER_DAY;

  // --- GP -------------------------------------------------------------------------------------
  //
  // Sessions run 08:00-12:00 and 13:00-17:00 (measured), so the day has two blocks. Concurrency is
  // sessions/day across those blocks: 6 sessions over 2 blocks = 3 clinicians. Extra sessions add
  // clinicians to the existing blocks rather than inventing new times of day.

  const BLOCK_STARTS = [8 * 60, 13 * 60];
  const sessionsPerDay =
    params.capacities.gpSessionsPerDay.value + params.levers.extraGpSessions.value;
  const gpService = params.serviceTimes.gpConsultation.value;

  // Sessions spread across the blocks one at a time: 7 sessions is 4 clinicians in the morning
  // and 3 in the afternoon, not 4 in both. Rounding made one extra session behave like two.
  const serversPerBlock = BLOCK_STARTS.map((_, i) =>
    Math.floor(sessionsPerDay / BLOCK_STARTS.length)
    + (i < sessionsPerDay % BLOCK_STARTS.length ? 1 : 0));

  const gpConfig: NodeConfig = {
    id: 'gp-clinic',
    servers: Math.max(...serversPerBlock),
    serviceMinutes: gpService,
    serviceDist: 'constant', // NHS-SIM's measured service variance is exactly zero.
    schedule: {
      blockStarts: BLOCK_STARTS,
      usableMinutes: params.capacities.gpSlotsPerSession.value * gpService,
      serversPerBlock,
    },
    maxQueue: null, // nobody is turned away from their own GP; they wait
  };

  // --- Community ------------------------------------------------------------------------------
  //
  // Measured: 4 visits/day at 90 minutes each. One visiting team working a 360-minute day gives
  // exactly that, so capacity emerges from the schedule here too. The capacity multiplier adds
  // teams.
  //
  // This node is BOUNDED. A visiting team with four slots a day cannot hold an unlimited backlog,
  // and NHS-SIM itself returns 409 at capacity. Refused referrals bounce back to the GP.

  const communityService = params.serviceTimes.communityVisit.value;
  const communityTeams = Math.max(
    1,
    Math.round(params.levers.communityCapacityMultiplier.value),
  );
  // A staffing shortage cuts home-visit slots — NHS-SIM's own staff-shortage scenario.
  const shortage = params.environment.staffShortage
    ? params.environment.shortageCommunityMultiplier.value
    : 1;
  const communitySlotsPerDay = Math.max(
    1,
    params.capacities.communitySlotsPerDay.value * shortage,
  );

  const communityConfig: NodeConfig = {
    id: 'community-visit',
    servers: communityTeams,
    serviceMinutes: communityService,
    serviceDist: 'constant',
    schedule: {
      blockStarts: [8 * 60],
      usableMinutes: communitySlotsPerDay * communityService,
    },
    // A fortnight of backlog. Beyond that the referral is refused rather than queued forever,
    // which is what a visiting service with a four-slot day actually does.
    maxQueue: Math.max(1, Math.round(communitySlotsPerDay * communityTeams * 14)),
  };

  // --- The discharge letter pathway ------------------------------------------------------------
  //
  // sent -> reviewed -> filed, 60 minutes per hop (measured, zero variance). This is the one
  // pathway in the model with routing taken from real counts rather than literature: of 57 letters
  // that reached the practice, 21 got past `sent` and 9 reached `filed`.
  //
  // It runs on GP ADMIN time, which is the point. Admin and clinic draw on the same clinicians, so
  // letters and appointments compete — the coupling the PRD asks for. A letter that is never filed
  // is not a tidy-up task, it is a discharge whose follow-up nobody picked up.

  const adminShare = clamp01(params.capacities.gpAdminShare.value);

  // Admin gets its share of clinician-blocks, rounded to whole people.
  const adminServers = Math.max(1, Math.round(
    serversPerBlock.reduce((a, b) => a + b, 0) * adminShare / BLOCK_STARTS.length));

  const adminConfig: NodeConfig = {
    id: 'gp-admin',
    servers: adminServers,
    serviceMinutes: params.serviceTimes.documentReviewWork.value,
    serviceDist: 'constant',
    schedule: {
      blockStarts: BLOCK_STARTS,
      usableMinutes: params.capacities.gpSlotsPerSession.value * gpService,
      closedWeekends: true,
    },
    maxQueue: null,
  };

  // --- arrivals -------------------------------------------------------------------------------

  const weights = arrivalWeights(params);
  const totalPerDay = weights.reduce((s, w) => s + w, 0);

  // Telephone appointments are shorter, so raising their share raises effective capacity without
  // adding a clinician. The lever moves the mix; effects.telephoneServiceMultiplier decides
  // whether that is worth anything.
  const telShare = clamp01(params.levers.telephoneFollowUpShare.value);
  const telMultiplier = params.effects.telephoneServiceMultiplier.value;
  const telBaseShare = clamp01(params.effects.telephoneBaselineShare.value);
  // Normalised so the measured mix comes out at exactly the measured slot length. Without this,
  // the baseline quietly gained 10% capacity and stopped sitting at the rho it was calibrated to.
  const channelBase = 1 - telBaseShare + telBaseShare * telMultiplier;

  // Priority. Urgent is served first; routine and complex share a level and are separated by
  // appointment length rather than rank — see ServiceTimes.classMultiplier.
  const PRIORITY: Readonly<Record<PatientClass, number>> = { urgent: 0, routine: 1, complex: 1 };
  const mult = params.serviceTimes.classMultiplier;

  // Share of GP encounters referred on for a community visit. The lever shifts work here.
  // Substitution: a share of the work moved to community reappears upstream rather than clearing.
  // Modelled as some of the shifted load never actually leaving the GP.
  const filedShare = clamp01(params.routing.letterReviewedToFiled.value
    / Math.max(1e-9, params.routing.letterSentToReviewed.value));
  const shifted = params.levers.hospitalToCommunityShare.value
    * (1 - clamp01(params.boundaries.substitution.value));
  const referralShare = clamp01(params.routing.gpToCommunity.value + shifted);

  let filed = 0;
  let unfiled = 0;

  const lettersPerDay = params.arrivals.dischargeLettersPerDay.value;
  const reviewedShare = clamp01(params.routing.letterSentToReviewed.value);
  const reviewedLettersPerDay = lettersPerDay * reviewedShare;
  const weekdayShare = clamp01(params.levers.weekdayDischargeShare.value);
  // Never picked up at all. Counted directly rather than simulated — they consume no capacity.
  const neverReviewedPerDay = lettersPerDay * (1 - reviewedShare);

  const result = simulateNetwork({
    nodes: [gpConfig, communityConfig, adminConfig],
    entries: [
      {
        nodeId: 'gp-clinic',
        ratePerMin: totalPerDay / MINUTES_PER_DAY,
        tagFor: (rng): string => CLASSES[rng.weighted(weights)] as string,
        classOf: (tag): { priority: number; serviceMultiplier: number } => {
          const cls = (tag ?? 'routine') as PatientClass;
          const base = mult[cls]?.value ?? 1;
          // Expected length across the channel mix. Applied as the mean rather than drawn per
          // patient: which individual gets a phone call is not something the model knows, and
          // pretending otherwise would add variance we have no evidence for.
          const channel = (1 - telShare + telShare * telMultiplier) / channelBase;
          return { priority: PRIORITY[cls] ?? 1, serviceMultiplier: base * channel };
        },
      },
      {
        // Discharge letters, measured independently of GP demand.
        //
        // Only the share that is ever PICKED UP enters the queue. Measured: 37% of letters that
        // reach the practice get past `sent`. The other 63% are not waiting for capacity — admin
        // sits at 8% utilisation — they are simply never actioned. Queueing them would model the
        // wrong failure: this is an inbox nobody opens, not a backlog.
        nodeId: 'gp-admin',
        ratePerMin: reviewedLettersPerDay / MINUTES_PER_DAY,
        // Discharges timed to weekdays land while admin is open. The rest arrive whenever and
        // wait for Monday, which is the whole content of the discharge-timing lever.
        weekdayOnlyShare: weekdayShare,
        tagFor: (): string => 'letter',
        classOf: (): { priority: number; serviceMultiplier: number } =>
          ({ priority: 1, serviceMultiplier: 1 }),
      },
    ],
    route: (item, from, rng) => {
      if (from === 'gp-admin') {
        // reviewed -> filed is a second hop through admin, and most letters never make it.
        if ((item.bounces ?? 0) >= 1) { filed++; return null; }
        item.bounces = (item.bounces ?? 0) + 1;
        if (rng.next() < filedShare) return 'gp-admin';
        unfiled++; // reviewed, then dropped — the manual-chasing gap
        return null;
      }
      if (from !== 'gp-clinic') return null; // a community visit completes the pathway
      // A patient already turned away twice is managed in-practice or escalated rather than
      // re-referred forever. Without this the feedback loop compounds without limit and the
      // model reports waits that are an artefact of the loop, not of the capacity shortfall.
      if ((item.bounces ?? 0) >= MAX_REFERRAL_BOUNCES) return null;
      return rng.next() < referralShare ? 'community-visit' : null;
    },
    // The rejection feedback loop (PRD §4.2). A refused referral does not vanish — it comes back
    // as a fresh GP appointment to sort out. This is where over-shifting to community costs the
    // practice rather than saving it.
    onRefused: () => 'gp-clinic',
    horizon,
    warmup,
    seed,
  });

  const gpStats = result.nodes.get('gp-clinic') as NodeStats;
  const communityStats = result.nodes.get('community-visit') as NodeStats;
  const adminStats = result.nodes.get('gp-admin') as NodeStats;

  // --- results --------------------------------------------------------------------------------

  const waitsByClass = splitByTag(gpStats.waits, gpStats.tags);
  const tisByClass = splitByTag(gpStats.timesInSystem, gpStats.tags);
  const measuredDays = Math.max(1, params.sim.horizonDays - params.sim.warmupDays);

  const toState = (n: NodeStats): NodeState => ({
    utilisation: n.utilisation,
    // Same criterion the Little's Law check uses.
    stable: isStable(n, horizon - warmup),
    queueLength: n.meanNumberInSystem,
    throughput: n.completed / measuredDays,
    refused: n.refused,
  });

  return {
    waits: byClass((c) => tail(waitsByClass[c])),
    timeInSystem: byClass((c) => tail(tisByClass[c])),
    perNode: {
      'gp-clinic': toState(gpStats),
      'community-visit': toState(communityStats),
      'gp-admin': toState(adminStats),
    },
    completed: byClass((c) => tisByClass[c].length),
    rejections: communityStats.refused,
    // Letters reviewed and then dropped, plus any still stuck in the queue. The measured
    // baseline is that 84% of letters never reach `filed` — the manual chasing Chapter 3 is about.
    unfiledLetters:
      unfiled
      + Math.round(neverReviewedPerDay * measuredDays)
      + Math.max(0, adminStats.admitted - adminStats.completed),
    verification: verify([gpStats, communityStats, adminStats], horizon - warmup),
  };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Arrivals per class per day, after the environment toggles and the declared boundaries.
 *
 * Order matters and is deliberate:
 *   1. winter pressure   — raises volume, and raises the urgent share within it
 *   2. induced demand    — Roemer: capacity added by a lever generates its own demand
 *   3. gaming            — reclassification, which moves demand between classes without
 *                          changing how much of it there is
 */
function arrivalWeights(params: Params): number[] {
  const env = params.environment;
  const base = CLASSES.map((c) => params.arrivals.perDay[c].value);

  // 1. Winter pressure.
  let weights = env.winterPressure
    ? base.map((v, i) =>
        v * env.winterDemandMultiplier.value
        * (CLASSES[i] === 'urgent' ? env.winterUrgentMultiplier.value : 1))
    : base;

  // 2. Induced demand (Roemer). Capacity a lever adds does not stay free — a share of it refills
  //    with demand that was previously going unmet. Zero by default and declared on screen.
  const induced = clamp01(params.boundaries.inducedDemand.value);
  if (induced > 0) {
    const baseSessions = params.capacities.gpSessionsPerDay.value;
    const addedShare = params.levers.extraGpSessions.value / Math.max(1, baseSessions);
    weights = weights.map((v) => v * (1 + induced * addedShare));
  }

  // 3. Monitoring. Deterioration caught early presents as routine rather than urgent. Demand is
  //    redistributed between classes, never destroyed: monitoring does not make people less ill.
  const intensity = params.levers.monitoringIntensity.value;
  const reduction = clamp01(
    Math.max(0, intensity - 1) * params.effects.monitoringEscalationReduction.value,
  );
  if (reduction > 0) {
    const ri = CLASSES.indexOf('routine');
    weights = [...weights];
    for (const cls of ['urgent', 'complex'] as const) {
      const i = CLASSES.indexOf(cls);
      const moved = (weights[i] as number) * reduction;
      weights[i] = (weights[i] as number) - moved;
      weights[ri] = (weights[ri] as number) + moved;
    }
  }

  // 4. Gaming. Complex presentations recorded as routine: the work is unchanged, the numbers
  //    improve. Moves demand between classes, never creates or destroys it.
  const gaming = clamp01(params.boundaries.gaming.value);
  if (gaming > 0) {
    const ci = CLASSES.indexOf('complex');
    const ri = CLASSES.indexOf('routine');
    const moved = (weights[ci] as number) * gaming;
    weights = [...weights];
    weights[ci] = (weights[ci] as number) - moved;
    weights[ri] = (weights[ri] as number) + moved;
  }

  return weights;
}

// --- helpers ---------------------------------------------------------------------------------

function byClass<T>(f: (c: PatientClass) => T): ByClass<T> {
  return { routine: f('routine'), complex: f('complex'), urgent: f('urgent') };
}

function splitByTag(values: readonly number[], tags: readonly string[]): ByClass<number[]> {
  const out: Record<PatientClass, number[]> = { routine: [], complex: [], urgent: [] };
  for (let i = 0; i < values.length; i++) {
    const cls = tags[i] as PatientClass | undefined;
    if (cls && cls in out) out[cls].push(values[i] as number);
  }
  return out;
}

function tail(xs: readonly number[]): Tail {
  if (xs.length === 0) return { p50: 0, p90: 0, mean: 0, max: 0, n: 0 };
  // Loop rather than Math.max(...xs): the spread blows the call stack past ~100k items, and a
  // ten-year run produces half a million.
  let sum = 0;
  let max = -Infinity;
  for (const x of xs) {
    sum += x;
    if (x > max) max = x;
  }
  return {
    p50: percentile(xs, 50),
    p90: percentile(xs, 90),
    mean: sum / xs.length,
    max,
    n: xs.length,
  };
}

export { makeRng } from './rng.ts';
export { QueueNode } from './nodes.ts';
export { simulateNode } from './single-node.ts';
export { simulateNetwork, MINUTES_PER_DAY } from './simulate.ts';
export { verify, closedForm, conservation, littlesLaw, percentile } from './assertions.ts';
export { deriveGpDemand, withUtilisation, measuredGpCapacityPerDay } from './demand.ts';
export type { NodeStats, NodeConfig, WorkItem } from './nodes.ts';
