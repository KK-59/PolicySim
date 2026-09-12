/**
 * The interface's only data source.
 *
 * `metrics`, `sweep` and `params` now come from the engine, precomputed by
 * `npm run ui-data` (scripts/build-ui-data.ts). Precomputed rather than run in the browser, per
 * PRD §0: a thousand sampled simulations is a build step, not a page load, and a lookup cannot be
 * slow or throw on stage. Nothing else in src/ui/ moved to make this happen, which is what
 * freezing the contracts first bought.
 *
 * `extraction` is still a fixture — reading a real policy document is not built — and says so on
 * its own screen rather than hiding behind the general banner. Presenting a fabricated number as
 * a measured one is the single thing this project may not do, and that applies to a page at a
 * time, not just to the build as a whole.
 */

import metricsJson from '../../../fixtures/metrics.live.json'
import sweepJson from '../../../fixtures/sweep.live.json'
import extractedJson from '../../../fixtures/extracted.mock.json'
import paramsJson from '../../../fixtures/params.live.json'

import type { Metrics } from '@/contracts/metrics'
import type { Params, SourceTag } from '@/contracts/params'

export const metrics = metricsJson as unknown as Metrics
export const params = paramsJson as unknown as Params

/**
 * True while the outcomes are fabricated. Drives the site-wide banner.
 *
 * The engine writes no `_synthetic` key, so this goes false the moment `npm run ui-data` has run
 * and stays true if it has not — the banner fails safe rather than needing to be remembered.
 */
export const IS_SYNTHETIC = Boolean((metricsJson as { _synthetic?: string })._synthetic)
export const SYNTHETIC_NOTE = (metricsJson as { _synthetic?: string })._synthetic ?? ''

/**
 * Extraction is separate. The outcomes are real while the document read that produced the
 * parameters is not, and one screen being honest does not license the other being quiet.
 */
export const IS_EXTRACTION_SYNTHETIC = true
export const EXTRACTION_NOTE =
  'The commitments below are a worked example, not a document this build parsed. '
  + 'The parameters they map to are the calibrated baseline, and the outcomes are the engine\'s.'

// ---------------------------------------------------------------------------
// Sweep: our own shape, standing in for precomputed/grid.json
// ---------------------------------------------------------------------------

export type WorldName = 'optimistic' | 'realistic' | 'pessimistic'

export const WORLD_ORDER: readonly WorldName[] = ['optimistic', 'realistic', 'pessimistic']

/** P10 / P50 / P90 shown under the friendly name, so the method is visible without explanation. */
export const WORLD_PERCENTILE: Record<WorldName, string> = {
  optimistic: 'P10',
  realistic: 'P50',
  pessimistic: 'P90',
}

export interface SweepPoint {
  x: number
  y: number
}

export interface SweepSeries {
  patientClass: 'routine' | 'complex'
  metric: 'p50' | 'p90'
  label: string
  direction: 'lower-is-better' | 'higher-is-better'
  worlds: { world: WorldName; points: SweepPoint[] }[]
  ghosts: { id: number; points: SweepPoint[] }[]
}

export interface Sweep {
  lever: {
    path: string
    label: string
    unit: string
    baseValue: number
    baseUnit: string
    positions: number[]
  }
  baselineIndex: number
  policyIndex: number
  breakpoint: number | null
  breakpointByWorld: Record<WorldName, number | null>
  series: SweepSeries[]
}

export const sweep = sweepJson as unknown as Sweep

// ---------------------------------------------------------------------------
// Extracted commitments
// ---------------------------------------------------------------------------

export interface Commitment {
  id: string
  text: string
  span: string | null
  paramPath: string
  label: string
  value: number
  range?: [number, number]
  bounds: [number, number]
  source: SourceTag
  citation: string | null
  note: string
}

export interface Extraction {
  document: { filename: string; pages: number; extractedAt: number; notes: string }
  commitments: Commitment[]
}

export const extraction = extractedJson as unknown as Extraction

// ---------------------------------------------------------------------------
// Formatting. Waits are stored in minutes and read in days.
// ---------------------------------------------------------------------------

const MIN_PER_DAY = 1440

export const toDays = (minutes: number) => minutes / MIN_PER_DAY

/** A delta always carries its sign: the reader must never have to infer direction. */
export function signed(value: number | null | undefined, dp = 1, unit = ''): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const v = Number(value.toFixed(dp))
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  return `${sign}${Math.abs(v).toFixed(dp)}${unit}`
}

export const fmt = (value: number | null | undefined, dp = 1) =>
  value == null || !Number.isFinite(value) ? '—' : value.toFixed(dp)

/**
 * Is this delta an improvement? Depends on the metric's direction, never on its sign.
 * The direction trap in metrics.ts is a real bug source; this is the one place it is decided.
 */
export function isBetter(delta: number, direction: 'lower-is-better' | 'higher-is-better') {
  return direction === 'lower-is-better' ? delta < 0 : delta > 0
}

export const SOURCE_LABEL: Record<SourceTag, string> = {
  measured: 'measured',
  documented: 'documented',
  literature: 'literature',
  assumed: 'assumed',
}

/** What each tag actually means, in the product's own words. Rendered on hover and in the key. */
export const SOURCE_MEANING: Record<SourceTag, string> = {
  measured: 'Counted in the NHS-SIM snapshot.',
  documented: 'Stated in the uploaded policy, or in the NHS-SIM handbook.',
  literature: 'Retrieved from the evidence corpus, with a published range.',
  assumed: 'Neither source covers it. Never silently defaulted.',
}

/** Declared limits, shown on screen rather than footnoted. PRD §4.2. */
export const NOT_MODELLED: { term: string; detail: string }[] = [
  {
    term: 'Disease progression',
    detail: 'Patients do not get sicker or better inside the model. Pathways move, conditions do not.',
  },
  {
    term: 'Treatment efficacy',
    detail: 'No clinical outcome is claimed. Everything here is an operational outcome.',
  },
  { term: 'Adherence', detail: 'Every patient is assumed to attend and to follow the plan.' },
  { term: 'Travel and geography', detail: 'Distance to a service costs nothing in this model.' },
  {
    term: 'Social care',
    detail: 'The largest real constraint on discharge, and entirely outside the simulator.',
  },
]

/** Narrowed accessors. The fixture is committed, so a miss is a build error, not a runtime state. */
export function seriesFor(patientClass: 'routine' | 'complex'): SweepSeries {
  const found = sweep.series.find((s) => s.patientClass === patientClass) ?? sweep.series[0]
  if (!found) throw new Error('sweep fixture contains no series')
  return found
}

export function leverAt(index: number): number {
  const v = sweep.lever.positions[index]
  if (v === undefined) throw new Error(`no lever position at index ${index}`)
  return v
}

export function worldPoints(series: SweepSeries, world: WorldName): SweepPoint[] {
  const found = series.worlds.find((w) => w.world === world)
  if (!found) throw new Error(`series ${series.patientClass} has no ${world} world`)
  return found.points
}
