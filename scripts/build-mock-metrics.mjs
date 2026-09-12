#!/usr/bin/env node
/**
 * Builds the SYNTHETIC fixtures the interface renders until Kaavya's engine lands.
 *
 * Everything this writes is labelled synthetic in its own `_synthetic` key and in RunMeta, because
 * the one thing this project may not do is present a fabricated number as a measured one. The
 * shapes conform exactly to the frozen contracts in src/contracts/, so when `run(params, seed)`
 * exists, the UI swaps fixture for engine by changing one import and nothing else moves.
 *
 * Grounding: the baseline values come from src/contracts/baseline.ts, which IS measured — 4
 * community slots/day as the binding constraint, 142.71 arrivals/sim-day, 84% of discharge
 * letters never filed. The policy response curves are invented; the world they act on is not.
 *
 * Writes:
 *   fixtures/metrics.mock.json    Metrics          — worlds, delta, findings, tornado, thresholds
 *   fixtures/sweep.mock.json      (ours)           — lever sweep + sampled runs, for the chart
 *   fixtures/extracted.mock.json  (ours)           — extracted commitments, for the params screen
 */

import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DAY = 1440

/** Deterministic RNG so the demo is identical every time it is opened. */
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20260912)
const gauss = () => {
  const u = 1 - rand()
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
const round = (n, dp = 2) => Number(n.toFixed(dp))

// ---------------------------------------------------------------------------
// The mechanism. Waiting time is convex in utilisation, which is the whole reason
// the engine can extrapolate to a policy regime it has never seen: it evaluates known
// mathematics at a new point rather than fitting to past commentary.
// ---------------------------------------------------------------------------

/** Baseline utilisation per class. Complex is the class the tail lives in. */
const RHO0 = { routine: 0.88, complex: 0.80, urgent: 0.62 }

/**
 * A guard, not a model. If a run ever reaches it, the wait flatlines and every trace above it
 * collapses onto one line, which reads as a real plateau and is not one. The coefficients below
 * are set so the sweep never gets near it.
 */
const RHO_CEILING = 0.985

/**
 * Community can only absorb so much before extra capacity stops being filled by redirected
 * discharges. The concentration effect saturates while relief keeps growing, which is what
 * produces a real threshold rather than an asserted one.
 *
 * Saturation is hyperbolic, not a hard `min()`. A clamp puts a corner in the curve at exactly the
 * cap, and a kink in a response curve is the first thing someone who models for a living will
 * point at. This approaches 1 + HEADROOM smoothly and is differentiable everywhere.
 */
const HEADROOM = 1.2
const effectiveMultiplier = (m) => 1 + (m - 1) / (1 + (m - 1) / HEADROOM)

/**
 * How the lever moves utilisation per class.
 *
 * Routine and urgent relax as community capacity frees GP time. The complex class does NOT:
 * routing more discharges to community concentrates multi-service patients into the one queue
 * whose capacity is smallest, so their utilisation falls more slowly than their arrival share
 * rises. That asymmetry is the median-improves-tail-worsens finding, and it is the demo's
 * central moment. It is a modelling choice, stated here rather than hidden in a constant.
 */
function rhoUnder(multiplier, cls, evidence) {
  const relief = Math.log(multiplier) * (0.20 + 0.03 * evidence)
  const concentration =
    cls === 'complex'
      ? Math.log(effectiveMultiplier(multiplier)) * (0.407 - 0.06 * evidence)
      : 0
  const base = RHO0[cls]
  return Math.max(0.35, Math.min(RHO_CEILING, base - relief + concentration))
}

/**
 * Baseline median wait per class, in DAYS.
 *
 * Deriving a day-scale wait from a minute-scale service time would force utilisation to absurd
 * extremes to make the arithmetic work, and the curve would then live against the ceiling where
 * every trace collapses onto one line. So the baseline wait is stated directly and the queueing
 * result is applied as a RATIO to it: what the mathematics contributes is the convex shape, which
 * is the part that actually justifies extrapolating to a policy regime nobody has observed.
 */
const BASE_P50_DAYS = { routine: 4.2, complex: 12, urgent: 0.35 }

/** ρ/(1−ρ), the M/M/1 queue factor. Everything is scaled by its ratio to the baseline. */
const queueFactor = (rho) => rho / (1 - rho)

/** One run: a lever position plus a draw of where the evidence lands. Returns days. */
function runOnce(multiplier, evidence) {
  const out = {}
  for (const cls of ['routine', 'complex', 'urgent']) {
    const rho = rhoUnder(multiplier, cls, evidence)
    const p50 = BASE_P50_DAYS[cls] * (queueFactor(rho) / queueFactor(RHO0[cls]))
    // p90/p50 ratio widens with utilisation — the tail is where congestion shows first.
    const spread = 1.7 + 4.2 * Math.pow(rho, 6)
    out[cls] = { rho, p50, p90: p50 * spread, mean: p50 * (1 + (spread - 1) * 0.42) }
  }
  return out
}

const SAMPLES = 1000
const LEVERS = Array.from({ length: 26 }, (_, i) => round(1 + (i * 5) / 25, 3))

/** For each lever position, 1,000 runs with evidence sampled from its range. */
const sweep = LEVERS.map((multiplier) => {
  const runs = []
  for (let i = 0; i < SAMPLES; i++) {
    const evidence = Math.max(-1, Math.min(1, gauss() * 0.5))
    runs.push(runOnce(multiplier, evidence))
  }
  return { multiplier, runs }
})

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]

/**
 * Worlds are percentiles of the OUTCOME, not corners of the input.
 * `optimistic` means the favourable tail, which for a wait is the LOW end — hence `direction`.
 */
function worldsFor(values, direction) {
  const s = [...values].sort((a, b) => a - b)
  const low = pct(s, 0.1)
  const high = pct(s, 0.9)
  return {
    optimistic: direction === 'lower-is-better' ? low : high,
    realistic: pct(s, 0.5),
    pessimistic: direction === 'lower-is-better' ? high : low,
    direction,
  }
}

const BASE_IDX = 0
const POLICY_IDX = LEVERS.findIndex((m) => m >= 2.5)

function tailBands(idx, cls, key) {
  const vals = sweep[idx].runs.map((r) => r[cls][key])
  const w = worldsFor(vals, 'lower-is-better')
  const mk = (v) => ({
    p50: round(v * DAY),
    p90: round(v * DAY * 2.4),
    mean: round(v * DAY * 1.35),
    max: round(v * DAY * 6.1),
    n: SAMPLES,
  })
  return { optimistic: mk(w.optimistic), realistic: mk(w.realistic), pessimistic: mk(w.pessimistic), direction: 'lower-is-better' }
}

/** Waits, per class, as three worlds — each world carrying its own within-run tail. */
function waitBands(idx) {
  const out = {}
  for (const cls of ['routine', 'complex', 'urgent']) {
    const p50s = sweep[idx].runs.map((r) => r[cls].p50)
    const p90s = sweep[idx].runs.map((r) => r[cls].p90)
    const means = sweep[idx].runs.map((r) => r[cls].mean)
    const w50 = worldsFor(p50s, 'lower-is-better')
    const w90 = worldsFor(p90s, 'lower-is-better')
    const wMean = worldsFor(means, 'lower-is-better')
    // Metrics stores waits in MINUTES (see metrics.ts); runOnce works in days.
    const mk = (k) => ({
      p50: round(w50[k] * DAY),
      p90: round(w90[k] * DAY),
      mean: round(wMean[k] * DAY),
      max: round(w90[k] * DAY * 2.6),
      n: SAMPLES,
    })
    out[cls] = {
      optimistic: mk('optimistic'),
      realistic: mk('realistic'),
      pessimistic: mk('pessimistic'),
      direction: 'lower-is-better',
    }
  }
  return out
}

const NODES = [
  'gp-clinic', 'gp-admin', 'test', 'result-review',
  'filing', 'hospital-outpatient', 'community-visit', 'pharmacy',
]

function nodeBands(idx) {
  const m = sweep[idx].multiplier
  const out = {}
  for (const [i, id] of NODES.entries()) {
    const isCommunity = id === 'community-visit'
    const base = 0.62 + ((i * 7) % 29) / 100
    const u = isCommunity
      ? Math.min(RHO_CEILING, 0.94 - Math.log(m) * 0.30)
      : Math.max(0.3, base - Math.log(m) * 0.06)
    const mk = (d) => ({
      utilisation: round(Math.max(0.2, Math.min(0.995, u + d)), 3),
      queueLength: round(Math.max(0, queueFactor(Math.min(RHO_CEILING, Math.max(0.2, u + d)))), 2),
      throughput: round(142.71 * (isCommunity ? 0.05 * m : 0.3 + i * 0.04), 2),
      refused: Math.max(0, Math.round((isCommunity ? 38 : 4) / m)),
    })
    out[id] = { optimistic: mk(-0.06), realistic: mk(0), pessimistic: mk(0.07), direction: 'lower-is-better' }
  }
  return out
}

function scalarBands(idx, base, sensitivity, direction) {
  const m = sweep[idx].multiplier
  const v = base * (1 - sensitivity * Math.log(m))
  const mk = (d) => round(Math.max(0, v * (1 + d)))
  return {
    optimistic: direction === 'lower-is-better' ? mk(-0.18) : mk(0.18),
    realistic: mk(0),
    pessimistic: direction === 'lower-is-better' ? mk(0.24) : mk(-0.24),
    direction,
  }
}

function bandsAt(idx) {
  return {
    waits: waitBands(idx),
    timeInSystem: {
      routine: tailBands(idx, 'routine', 'mean'),
      complex: tailBands(idx, 'complex', 'mean'),
      urgent: tailBands(idx, 'urgent', 'mean'),
    },
    perNode: nodeBands(idx),
    completed: {
      routine: scalarBands(idx, 34500, -0.04, 'higher-is-better'),
      complex: scalarBands(idx, 780, -0.16, 'higher-is-better'),
      urgent: scalarBands(idx, 108, -0.01, 'higher-is-better'),
    },
    rejections: scalarBands(idx, 1386, 0.71, 'lower-is-better'),
    unfiledLetters: scalarBands(idx, 2911, 0.09, 'lower-is-better'),
  }
}

/** delta = policy − baseline, walked structurally so no field is missed. */
function deltaOf(policy, base) {
  if (typeof policy === 'number') return round(policy - base)
  if (typeof policy === 'string' || typeof policy === 'boolean') return policy
  const out = {}
  for (const k of Object.keys(policy)) out[k] = deltaOf(policy[k], base[k])
  return out
}

const baseBands = bandsAt(BASE_IDX)
const policyBands = bandsAt(POLICY_IDX)
const delta = deltaOf(policyBands, baseBands)

// ---------------------------------------------------------------------------
// Threshold: where does the complex tail stop being harmed?
// ---------------------------------------------------------------------------

/**
 * Where does the harm to the complex tail stop, in each world?
 *
 * The harm rises, peaks, then falls back through zero once added capacity outruns the
 * concentration effect. Searched from the peak, never from the start: index 0 is the baseline,
 * where the delta is zero by construction and means nothing.
 *
 * The answer differs per world, and that difference is the finding. A single breakpoint would
 * be the more comfortable number and the less true one.
 */
function breakpointIn(world) {
  const deltas = LEVERS.map(
    (_, i) => bandsAt(i).waits.complex[world].p90 - baseBands.waits.complex[world].p90,
  )
  const peak = deltas.reduce((best, d, i) => (d > deltas[best] ? i : best), 0)
  if (deltas[peak] <= 0) return null
  const cross = deltas.findIndex((d, i) => i > peak && d <= 0)
  return cross === -1 ? null : LEVERS[cross]
}

const breakpointByWorld = {
  optimistic: breakpointIn('optimistic'),
  realistic: breakpointIn('realistic'),
  pessimistic: breakpointIn('pessimistic'),
}
const breakpoint = breakpointByWorld.realistic

const worldsHarmed = ['optimistic', 'realistic', 'pessimistic'].filter(
  (w) => policyBands.waits.complex[w].p90 > baseBands.waits.complex[w].p90,
)
const medianImprovedIn = ['optimistic', 'realistic', 'pessimistic'].filter(
  (w) => policyBands.waits.routine[w].p50 < baseBands.waits.routine[w].p50,
)

const findings = [
  {
    id: 'median-improves',
    statement:
      'Median wait for routine patients falls under this policy, and it falls in all three worlds.',
    kind: 'robust',
    holdsIn: medianImprovedIn,
    survivesAllThree: medianImprovedIn.length === 3,
    optimisticOnly: false,
    refersTo: ['waits.routine.p50'],
  },
  {
    id: 'complex-tail-worsens',
    statement: `The 90th-percentile wait for complex patients gets worse, in ${worldsHarmed.length} of the three worlds. The average patient benefits; the complex-needs tail does not.`,
    kind: 'structural',
    holdsIn: worldsHarmed,
    survivesAllThree: worldsHarmed.length === 3,
    optimisticOnly: worldsHarmed.length === 1 && worldsHarmed[0] === 'optimistic',
    refersTo: ['waits.complex.p90'],
  },
  {
    id: 'community-refusals',
    statement:
      'Referrals refused at community capacity fall sharply, because the binding constraint is being relieved directly.',
    kind: 'ordinal',
    holdsIn: ['optimistic', 'realistic', 'pessimistic'],
    survivesAllThree: true,
    optimisticOnly: false,
    refersTo: ['rejections'],
  },
  {
    id: 'letters-unmoved',
    statement:
      'Unfiled discharge letters barely move. This policy does not touch the manual-chasing attrition that loses 84% of them.',
    kind: 'structural',
    holdsIn: ['optimistic', 'realistic', 'pessimistic'],
    survivesAllThree: true,
    optimisticOnly: false,
    refersTo: ['unfiledLetters'],
  },
]

const resolvedIn = Object.entries(breakpointByWorld)
  .filter(([, b]) => b !== null)
  .map(([w]) => w)

if (breakpoint !== null) {
  const unresolved = ['optimistic', 'realistic', 'pessimistic'].filter(
    (w) => worldsHarmed.includes(w) && breakpointByWorld[w] === null,
  )
  findings.push({
    id: 'tail-threshold',
    statement:
      `The harm to the complex tail disappears once community capacity reaches ${breakpoint}x, which is ${round(breakpoint * 4, 1)} visits per day.` +
      (unresolved.length
        ? ` In the ${unresolved.join(' and ')} world it does not clear within any capacity we swept, so this is a condition, not a fix.`
        : ''),
    kind: 'threshold',
    holdsIn: resolvedIn,
    survivesAllThree: resolvedIn.length === 3,
    optimisticOnly: resolvedIn.length === 1 && resolvedIn[0] === 'optimistic',
    refersTo: ['waits.complex.p90'],
  })
}

const tornado = [
  ['levers.communityCapacityMultiplier', 'Community capacity multiplier', 41.2, 8.4, 'measured'],
  ['capacities.gpAdminShare', 'GP admin share of the day', 22.8, 11.9, 'literature'],
  ['arrivals.perDay.complex', 'Complex arrivals per day', 31.5, 14.2, 'assumed'],
  ['levers.hospitalToCommunityShare', 'Hospital to community share', 26.0, 15.8, 'literature'],
  ['routing.gpToCommunity', 'GP to community referral rate', 19.4, 13.1, 'assumed'],
  ['levers.extraGpSessions', 'Extra GP sessions per day', 17.2, 12.6, 'measured'],
  ['serviceTimes.communityVisit', 'Community visit duration', 15.9, 13.4, 'measured'],
  ['levers.telephoneFollowUpShare', 'Telephone follow-up share', 14.8, 13.0, 'measured'],
].map(([path, label, high, low, rangeSource]) => ({
  path,
  label,
  low,
  high,
  swing: round(Math.abs(high - low)),
  rangeSource,
  // The case that quietly collapses the three worlds: it dominates, and nothing sources its range.
  dominantButUnsourced: rangeSource === 'assumed' && Math.abs(high - low) > 15,
})).sort((a, b) => b.swing - a.swing)

const thresholds = Object.entries(breakpointByWorld)
  .filter(([, b]) => b !== null)
  .map(([world, b]) => ({
    path: 'levers.communityCapacityMultiplier',
    label: 'Community capacity multiplier',
    breakpoint: b,
    holdsWhen: 'above',
    findingId: 'tail-threshold',
    statement: `In the ${world} world, the complex tail is no worse off once capacity reaches ${b}x, which is ${round(b * 4, 1)} visits per day.`,
  }))

const flags = [
  {
    path: 'arrivals.perDay.complex',
    reason: 'dominant-but-unsourced',
    message: 'Complex arrivals dominate the result and nothing sources their range. NHS-SIM has no complex class; this is our construct.',
  },
  {
    path: 'levers.hospitalToCommunityShare',
    reason: 'no-citation',
    message: 'Not grounded. The only community visits in this world were created by our own team, so there is no baseline referral flow to measure.',
  },
  {
    path: 'levers.weekdayDischargeShare',
    reason: 'assumed',
    message: 'NHS-SIM has no weekday logic at all. Sessions are seeded for a fixed 7-day window from world creation.',
  },
  {
    path: 'capacities.gpAdminShare',
    reason: 'no-range',
    message: 'Second-largest swing in the tornado, and it carries a point estimate with no published interval.',
  },
  {
    path: 'boundaries.inducedDemand',
    reason: 'assumed',
    message: 'Declared at zero rather than measured. NHS-SIM generates 142 arrivals/day regardless of what we do, so induced demand cannot occur in the ground truth.',
  },
]

const metrics = {
  _synthetic: 'Generated by scripts/build-mock-metrics.mjs. Stands in for run(params, seed) until src/engine/ exists. Conforms to src/contracts/metrics.ts. Not a measurement.',
  worlds: policyBands,
  delta,
  findings,
  tornado,
  thresholds,
  flags,
  run: {
    samples: SAMPLES,
    seed: 20260912,
    horizonDays: 3650,
    elapsedMs: 412,
    anyVerificationFailed: false,
    paramsMeta: {
      worldId: 'team-4551d2471320',
      snapshotId: '2026-09-21T12:02:00Z',
      sourceDocument: 'ICB-neighbourhood-board-paper.pdf',
      calibratedAt: 1789992120000,
    },
  },
}

// ---------------------------------------------------------------------------
// Sweep — the lever curve plus a thinned ghost cloud, for the chart.
// Ghosts are real sampled runs, not a drawn spread: where the evidence has no range,
// the cloud is genuinely narrow, and the chart must show that rather than invent width.
// ---------------------------------------------------------------------------

const GHOSTS = 70
const sweepOut = {
  _synthetic: 'Generated by scripts/build-mock-metrics.mjs. Stands in for precomputed/grid.json.',
  lever: {
    path: 'levers.communityCapacityMultiplier',
    label: 'Community capacity',
    unit: 'x current',
    baseValue: 4,
    baseUnit: 'visits per day',
    positions: LEVERS,
  },
  baselineIndex: BASE_IDX,
  policyIndex: POLICY_IDX,
  breakpoint,
  breakpointByWorld,
  series: ['routine', 'complex'].map((cls) => {
    const at = (i, key, w) => {
      const b = bandsAt(i)
      return b.waits[cls][w][key]
    }
    const baseRef = (key, w) => bandsAt(BASE_IDX).waits[cls][w][key]
    return {
      patientClass: cls,
      metric: cls === 'complex' ? 'p90' : 'p50',
      label: cls === 'complex' ? '90th-percentile complex wait' : 'Median routine wait',
      direction: 'lower-is-better',
      worlds: ['optimistic', 'realistic', 'pessimistic'].map((w) => ({
        world: w,
        points: LEVERS.map((m, i) => ({
          x: m,
          // Delta against the locked baseline, in DAYS. Never an absolute.
          y: round((at(i, cls === 'complex' ? 'p90' : 'p50', w) - baseRef(cls === 'complex' ? 'p90' : 'p50', w)) / DAY, 3),
        })),
      })),
      ghosts: Array.from({ length: GHOSTS }, (_, g) => {
        const evidence = Math.max(-1, Math.min(1, gauss() * 0.5))
        const key = cls === 'complex' ? 'p90' : 'p50'
        const b0 = runOnce(LEVERS[BASE_IDX], evidence)[cls][key]
        return {
          id: g,
          points: LEVERS.map((m) => ({
            x: m,
            // runOnce already works in days. The world lines round-trip through the minutes
            // conversion that Metrics requires; the ghosts do not, so they must not be divided.
            y: round(runOnce(m, evidence)[cls][key] - b0, 3),
          })),
        }
      }),
    }
  }),
}

// ---------------------------------------------------------------------------
// Extracted commitments — what the uploaded document was turned into.
// ---------------------------------------------------------------------------

const extracted = {
  _synthetic: 'Generated by scripts/build-mock-metrics.mjs. Stands in for src/extraction/ until it exists.',
  document: {
    filename: 'ICB-neighbourhood-board-paper.pdf',
    pages: 24,
    extractedAt: 1789995600000,
    notes: 'Assume no extra headcount. Rolls out in January.',
  },
  commitments: [
    {
      id: 'c1',
      text: 'Expand community home-visiting capacity to meet neighbourhood demand.',
      span: 'p.7 §3.2 — "capacity for home visiting will be increased to at least ten visits per day per neighbourhood team"',
      paramPath: 'levers.communityCapacityMultiplier',
      label: 'Community capacity multiplier',
      value: 2.5,
      range: [1.8, 3.2],
      bounds: [0, 10],
      source: 'documented',
      citation: 'ICB board paper p.7 §3.2',
      note: 'The document states 10 visits/day. Measured base is 4, so the multiplier is 2.5.',
    },
    {
      id: 'c2',
      text: 'Shift a share of hospital discharges to community rather than outpatient follow-up.',
      span: 'p.11 §4.1 — "a majority of eligible discharges should be supported in the community"',
      paramPath: 'levers.hospitalToCommunityShare',
      label: 'Hospital to community share',
      value: 0.55,
      range: [0.4, 0.7],
      bounds: [0, 1],
      source: 'literature',
      citation: 'NHS Confederation, community services analysis 2025',
      note: 'The document says "a majority" without a number. Range from the corpus.',
    },
    {
      id: 'c3',
      text: 'Increase the share of follow-ups delivered by telephone.',
      span: 'p.14 §5.3 — "remote-first follow-up where clinically appropriate"',
      paramPath: 'levers.telephoneFollowUpShare',
      label: 'Telephone follow-up share',
      value: 0.5,
      range: [0.4, 0.62],
      bounds: [0, 1],
      source: 'literature',
      citation: 'NHS 10-Year Health Plan, Ch. 3',
      note: 'Measured base in this world is 0.33 — two of six sessions.',
    },
    {
      id: 'c4',
      text: 'No additional GP headcount.',
      span: 'Operator note — "assume no extra headcount"',
      paramPath: 'levers.extraGpSessions',
      label: 'Extra GP sessions per day',
      value: 0,
      bounds: [0, 12],
      source: 'documented',
      citation: 'Free-text note supplied with the upload',
      note: 'Taken from your note, not from the document.',
    },
    {
      id: 'c5',
      text: 'Complex, multi-service patients are a distinct group with their own pathway.',
      span: null,
      paramPath: 'arrivals.perDay.complex',
      label: 'Complex arrivals per day',
      value: 2.2,
      bounds: [0, 1000],
      source: 'assumed',
      citation: null,
      note: 'NHS-SIM has only acuity 2 and 3. The complex class is our construct and nothing sources its share of demand. It is also the third-largest swing in the tornado.',
    },
    {
      id: 'c6',
      text: 'Discharges are timed to weekdays.',
      span: 'p.18 §6.4 — "seven-day discharge planning"',
      paramPath: 'levers.weekdayDischargeShare',
      label: 'Weekday discharge share',
      value: 1,
      bounds: [0, 1],
      source: 'assumed',
      citation: null,
      note: 'NHS-SIM has no weekday logic at all, so this commitment cannot be tested here. Shown so it is not silently dropped.',
    },
  ],
}

await writeFile(join(ROOT, 'fixtures/metrics.mock.json'), JSON.stringify(metrics, null, 2) + '\n')
await writeFile(join(ROOT, 'fixtures/sweep.mock.json'), JSON.stringify(sweepOut, null, 2) + '\n')
await writeFile(join(ROOT, 'fixtures/extracted.mock.json'), JSON.stringify(extracted, null, 2) + '\n')

console.log(`metrics.mock.json    findings=${findings.length} tornado=${tornado.length} flags=${flags.length}`)
console.log(`sweep.mock.json      positions=${LEVERS.length} ghosts=${GHOSTS}`)
console.log(`breakpoint by world  ${JSON.stringify(breakpointByWorld)}`)
console.log(`extracted.mock.json  commitments=${extracted.commitments.length}`)
console.log(`median improves in   ${medianImprovedIn.length}/3 worlds`)
console.log(`complex tail worsens ${worldsHarmed.length}/3 worlds  [${worldsHarmed.join(', ')}]`)
