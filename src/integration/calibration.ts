/**
 * Calibration extractor: one live NHS-SIM read turned into engine parameters.
 * OWNER: Oriol. CONSUMED BY: Kaavya (engine params), Albert (source table), Elsa (source chips).
 * PRD §4.2. Under outage, fall back to handbook delays + literature (PRD §4.4).
 *
 * The split here is deliberate: `extractCalibration` is pure, so the arithmetic that decides
 * every number in the model can be tested against a hand-built payload with no network at all.
 * `calibrateFromLive` is the only part that can fail because a server is down.
 *
 * The trap this file is built around: `createdAt` does not mean "arrived". The live site
 * backdates synthetic patient history by up to three years, so a naive min-to-now window turns
 * a 9-day observation into a 1300-day one and divides every arrival rate by 150. `provenance`
 * is what separates the three origins (see `origin()`), and only live demand is an arrival.
 *
 * Tagging rule, and the reason this file exists at all: a number computed from resources the
 * server actually created is `measured`; a number the server declares about itself (capacity
 * resources, appointment session config, counter versions) is `documented`. Nothing else is
 * emitted. Where we cannot see a quantity the parameter table needs, it goes in `gaps` so
 * Albert flags it on screen, because a silently defaulted parameter is the failure mode this
 * whole track exists to avoid.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { NhsSimClient } from './nhssim-client.ts'
import type { ActionResult, Site } from '../contracts/action.ts'

// ---------------------------------------------------------------------------
// Wire shapes: what /api/sites/{site}/view and /appointments actually return.
// Verified against https://sim.animahacks.com, not inferred from the OpenAPI spec.
// ---------------------------------------------------------------------------

/**
 * How the resource came to exist. This is the field that makes the whole extractor honest: the
 * server backdates synthetic history by years, so `createdAt` alone cannot tell a live arrival
 * from a record written to give a patient a plausible past.
 */
export interface ResourceProvenance {
  created?: {
    time?: number
    action?: string
    source?: string
    actor?: { kind?: string; name?: string }
  }
  changes?: unknown[]
}

/**
 * A resource as the view lists it. Structurally the same thing a write returns, so it reuses the
 * frozen `ActionResult` contract and only widens the fields history records may omit.
 */
export interface ViewResource extends Omit<ActionResult, 'priority' | 'visibleTo' | 'provenance'> {
  priority?: string
  visibleTo?: string[]
  provenance?: ResourceProvenance
}

/** Counters the server keeps about itself. Config versions live here, hence `documented`. */
export type ViewCounters = Record<string, number>

export interface SiteView {
  id: string
  now: number
  speed: number
  paused: boolean
  population: number
  counters: ViewCounters
  resources: ViewResource[]
  /** Pagination. The server caps `limit` at 500, so a full site never arrives in one page. */
  resourceTotal?: number
  resourceOffset?: number
  resourceLimit?: number
}

export interface AppointmentSession {
  id: string
  kind: string
  owner: string
  status: string
  title: string
  data: {
    startsAt?: number
    endsAt?: number
    slotMinutes?: number
    mode?: string
    clinician?: string
    location?: string
    blockedSlots?: Array<{ reason?: string; startsAt?: number }>
  }
}

export interface AppointmentsPayload {
  sessions: AppointmentSession[]
  appointments?: unknown[]
  patients?: unknown[]
}

// ---------------------------------------------------------------------------
// Tagged parameters
//
// LOCAL ON PURPOSE: Kaavya owns `Params` in src/contracts/params.ts. `CalibratedParams` is the
// extractor's own output shape and maps onto her `Params` field-for-field once she publishes it:
// `Sourced<T>` here is her `Sourced<T>`, `arrivals` her policy-invariant arrival rates,
// `capacities` her capacities, `routing` her routing probabilities. When params.ts lands, this
// block gets deleted and the import swapped. Nothing downstream should re-derive these numbers.
// ---------------------------------------------------------------------------

export type SourceTag = 'measured' | 'documented' | 'literature' | 'assumed'

/** Every number the extractor emits is one of these. There is no untagged path out of here. */
export interface Sourced<T = number> {
  value: T
  units: string
  source: SourceTag
  /** One line, shown on screen beside the value: how this number came about. */
  derivation: string
  /** The endpoint and field it came from. */
  citation: string
  /** Physical bounds, where we can state them. Extraction clamps to this. */
  range?: [number, number]
}

/** The three demand classes in docs/parameters.md. */
export type ArrivalClass = 'routine' | 'complex' | 'urgent'

export type ArrivalRates = Record<ArrivalClass, Sourced>

export interface Capacities {
  /** Concurrent service slots the site declares, keyed by owner: gp, community, diagnostics... */
  concurrentSlots: Record<string, Sourced>
  /** Appointment-session config, present only when an appointments read was supplied. */
  gpSessionsPerDay?: Sourced
  gpSlotMinutes?: Sourced
  gpSlotsPerDay?: Sourced
  /** Version of the session config the numbers above were read at. */
  appointmentSessionVersion?: Sourced
  /** Community home visits actually created per sim-day, as opposed to the declared slots. */
  communityVisitsPerDay?: Sourced
}

/** Keyed `from->to` by owner, e.g. `gp->pharmacy`. Shares out of each origin sum to 1. */
export type RoutingProbabilities = Record<string, Sourced>

/**
 * Server-declared due windows, per resource kind. NOT service times: the server stamps a fixed
 * `dueAt` when it creates the resource, so this is the SLA it promises, not the time work took.
 * Real service times need two reads of the same resource and belong to the live loop.
 */
export type DueWindows = Record<string, Sourced>

/** Provenance of the read itself. Not parameters, and never fed to the engine. */
export interface CalibrationMeta {
  site: string
  /** Sim clock at read time, and the ISO rendering of it for the source table. */
  observedAt: number
  observedAtIso: string
  windowStart: number
  windowEnd: number
  windowDays: number
  resourcesObserved: number
  /** Arrivals counted, and what was set aside before counting them. */
  arrivalsCounted: number
  historyExcluded: number
  teamWritesExcluded: number
  /** Total resources the site holds, when the payload reported it. Pages are a sample of this. */
  resourceTotal: number | null
  appointmentsDate: string | null
}

export interface CalibratedParams {
  meta: CalibrationMeta
  population: Sourced
  arrivals: ArrivalRates
  capacities: Capacities
  routing: RoutingProbabilities
  dueWindows: DueWindows
  /** Parameters the table needs that this read cannot see. Flagged on screen, never defaulted. */
  gaps: string[]
}

export interface ExtractOptions {
  /** Site the view came from. Only used for labelling and citations. */
  site?: string
  /** Appointment session config for a single day, from GET /api/sites/{site}/appointments. */
  appointments?: AppointmentsPayload
  /** The date that appointments payload was read for, YYYY-MM-DD. */
  appointmentsDate?: string
  /** Below this many transitions out of an owner, the routing share is flagged as thin. */
  minRoutingSample?: number
}

// ---------------------------------------------------------------------------
// Classification
//
// The counts are measured; these sets are our reading of what each kind means. They live as
// named constants so the reading is reviewable rather than buried in a conditional.
// ---------------------------------------------------------------------------

/** Describes the service, not patient demand. Never counted as an arrival. */
const INFRA_KINDS = new Set([
  'capacity', 'staff', 'bed', 'robot', 'device', 'theatre-slot',
  'pharmacy-product', 'pharmacy-quote', 'pharmacy-basket', 'pharmacy-movement',
])

/** Work that arrives already needing a same-day decision. */
const URGENT_KINDS = new Set(['hospital-attendance', 'emergency', 'flow-alert', 'handover'])

/** Work that opens a pathway across more than one service, so it cannot be a single contact. */
const COMPLEX_KINDS = new Set([
  'referral', 'pharmacy-referral', 'discharge-summary', 'care-plan', 'care-package',
  'mental-health-plan', 'surgery', 'genomic-test',
])

/** Kinds whose `dueAt` is a meaningful promise about turnaround. */
const DUE_WINDOW_KINDS = ['test', 'prescription', 'visit', 'referral'] as const

/**
 * Provenance actions that mean "this record was written to give a patient a past", not "this
 * work arrived". These carry a backdated createdAt, and on the live site they stretch back
 * three years, so counting them as arrivals stretches the denominator into nonsense.
 */
const HISTORY_ACTIONS = new Set(['generate_history', 'seed_blood_results'])

/**
 * Where a resource came from. Three origins, and they are used differently:
 * `demand` is the simulation generating new work, and is the only thing that is an arrival;
 * `history` is backdated backfill, useful for routing but never for rates;
 * `team` is our own agent's writes, excluded from everything, because calibrating routing on
 * the actions we are about to test is circular.
 *
 * A resource with no provenance is treated as demand: that is the conservative reading, and it
 * keeps hand-built fixtures free of provenance boilerplate.
 */
export type ResourceOrigin = 'demand' | 'history' | 'team'

export function origin(resource: ViewResource): ResourceOrigin {
  const created = resource.provenance?.created
  if (created?.actor?.kind === 'team') return 'team'
  if (created?.action && HISTORY_ACTIONS.has(created.action)) return 'history'
  return 'demand'
}

/** Demand, as opposed to the furniture of the service, its backfilled past, or our own writes. */
export function isArrival(resource: ViewResource): boolean {
  if (!resource.patientId || INFRA_KINDS.has(resource.kind)) return false
  return origin(resource) === 'demand'
}

/** Priority first, because the server states it; kind only decides what priority leaves open. */
export function classifyArrival(resource: ViewResource): ArrivalClass {
  const priority = resource.priority ?? 'routine'
  if (priority === 'urgent' || priority === 'emergency') return 'urgent'
  if (URGENT_KINDS.has(resource.kind)) return 'urgent'
  if (COMPLEX_KINDS.has(resource.kind)) return 'complex'
  return 'routine'
}

// ---------------------------------------------------------------------------
// The pure extractor
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000

/**
 * A live view payload in, tagged parameters out. Pure: same payload, same numbers, no clock,
 * no network, no randomness. Everything in this file that matters is decided here.
 */
export function extractCalibration(view: SiteView, opts: ExtractOptions = {}): CalibratedParams {
  const site = opts.site ?? view.id
  const gaps: string[] = []
  const arrivalResources = view.resources.filter(isArrival)
  const window = observationWindow(view, arrivalResources)

  if (window.days <= 0) {
    gaps.push('observation window has zero length; arrival rates are not derivable from this read')
  }

  const meta: CalibrationMeta = {
    site,
    observedAt: view.now,
    observedAtIso: new Date(view.now).toISOString(),
    windowStart: window.start,
    windowEnd: window.end,
    windowDays: round(window.days, 3),
    resourcesObserved: view.resources.length,
    arrivalsCounted: arrivalResources.length,
    historyExcluded: view.resources.filter((r) => origin(r) === 'history').length,
    teamWritesExcluded: view.resources.filter((r) => origin(r) === 'team').length,
    resourceTotal: view.resourceTotal ?? null,
    appointmentsDate: opts.appointmentsDate ?? null,
  }

  return {
    meta,
    population: {
      value: view.population,
      units: 'people',
      source: 'measured',
      derivation: 'population field of the site view payload',
      citation: `GET /api/sites/${site}/view → population`,
      range: [1, 10_000_000],
    },
    arrivals: arrivalRates(arrivalResources, window, site, gaps),
    capacities: capacities(view, arrivalResources, window, site, opts, gaps),
    routing: routingProbabilities(view.resources, site, opts.minRoutingSample ?? 5, gaps),
    dueWindows: dueWindows(view.resources, site, gaps),
    gaps,
  }
}

interface Window {
  start: number
  end: number
  days: number
}

/**
 * The window runs from the first arrival we can see to the clock reading on the payload, not to
 * the last arrival: the quiet stretch between the last arrival and `now` is observed silence and
 * belongs in the denominator. A payload whose clock predates its own resources falls back to the
 * last createdAt, because a negative window is worse than a slightly short one.
 */
function observationWindow(view: SiteView, arrivals: ViewResource[]): Window {
  if (arrivals.length === 0) return { start: view.now, end: view.now, days: 0 }
  const times = arrivals.map((r) => r.createdAt)
  const start = Math.min(...times)
  const latest = Math.max(...times)
  const end = Math.max(view.now, latest)
  return { start, end, days: (end - start) / MS_PER_DAY }
}

function arrivalRates(
  arrivals: ViewResource[],
  window: Window,
  site: string,
  gaps: string[],
): ArrivalRates {
  const counts: Record<ArrivalClass, number> = { routine: 0, complex: 0, urgent: 0 }
  for (const resource of arrivals) counts[classifyArrival(resource)] += 1

  const rate = (klass: ArrivalClass): Sourced => {
    const n = counts[klass]
    // A class with no observations is reported as the zero it is and flagged, never widened
    // into a guess: Kaavya needs to know the difference between "none arrived" and "we did not
    // look long enough", and only the flag carries that.
    if (n === 0) {
      gaps.push(`no ${klass} arrivals observed in a ${window.days.toFixed(2)} sim-day window; rate reported as 0, do not treat it as calibrated`)
    }
    return {
      value: window.days > 0 ? round(n / window.days, 3) : 0,
      units: '/sim-day',
      source: 'measured',
      derivation: `${n} ${klass} arrivals with a patientId, created inside a ${window.days.toFixed(2)} sim-day window, divided by that window`,
      citation: `GET /api/sites/${site}/view → resources[].kind + priority + createdAt`,
      range: [0, 100_000],
    }
  }

  return { routine: rate('routine'), complex: rate('complex'), urgent: rate('urgent') }
}

function capacities(
  view: SiteView,
  arrivals: ViewResource[],
  window: Window,
  site: string,
  opts: ExtractOptions,
  gaps: string[],
): Capacities {
  const concurrentSlots: Record<string, Sourced> = {}
  // `capacity-<owner>` resources are the server describing its own service, so they are
  // documented, not measured: nothing was counted to produce them.
  for (const resource of view.resources) {
    if (resource.kind !== 'capacity') continue
    const total = numberField(resource.data, 'total')
    if (total === null) continue
    concurrentSlots[resource.owner] = {
      value: total,
      units: 'concurrent slots',
      source: 'documented',
      derivation: `capacity resource "${resource.id}" declares total ${total}`,
      citation: `GET /api/sites/${site}/view → resources[] where kind = capacity`,
      range: [0, 1000],
    }
  }
  if (Object.keys(concurrentSlots).length === 0) {
    gaps.push('no capacity resources in this view; concurrent service slots are unsourced')
  }

  const result: Capacities = { concurrentSlots }

  const visits = arrivals.filter((r) => r.kind === 'visit')
  if (visits.length > 0 && window.days > 0) {
    result.communityVisitsPerDay = {
      value: round(visits.length / window.days, 3),
      units: 'visits/sim-day',
      source: 'measured',
      derivation: `${visits.length} visit resources created in a ${window.days.toFixed(2)} sim-day window`,
      citation: `GET /api/sites/${site}/view → resources[] where kind = visit`,
      range: [0, 1000],
    }
  } else {
    gaps.push('no visit resources in this view; community visits per day come from the declared capacity only')
  }

  const version = view.counters['appointmentSessionVersion']
  if (typeof version === 'number') {
    result.appointmentSessionVersion = {
      value: version,
      units: 'version',
      source: 'documented',
      derivation: 'appointment session config version the capacities below were read at',
      citation: `GET /api/sites/${site}/view → counters.appointmentSessionVersion`,
      range: [0, 1_000_000],
    }
  }

  const sessions = opts.appointments?.sessions ?? []
  if (sessions.length === 0) {
    gaps.push('no appointment sessions supplied; GP slots per day are unsourced')
    return result
  }

  const dateNote = opts.appointmentsDate ? ` for ${opts.appointmentsDate}` : ''
  const citation = `GET /api/sites/${site}/appointments${dateNote ? `?date=${opts.appointmentsDate}` : ''} → sessions[]`

  result.gpSessionsPerDay = {
    value: sessions.length,
    units: 'sessions/day',
    source: 'documented',
    derivation: `${sessions.length} appointment sessions published${dateNote}`,
    citation,
    range: [0, 50],
  }

  const slotMinutes = commonestSlotMinutes(sessions)
  if (slotMinutes !== null) {
    result.gpSlotMinutes = {
      value: slotMinutes,
      units: 'min',
      source: 'documented',
      derivation: `commonest slotMinutes across ${sessions.length} published sessions`,
      citation,
      range: [1, 120],
    }
  }

  const slots = sessions.reduce((sum, session) => sum + slotsInSession(session), 0)
  result.gpSlotsPerDay = {
    value: slots,
    units: 'slots/day',
    source: 'documented',
    derivation: `sum over ${sessions.length} sessions of floor((endsAt - startsAt) / slotMinutes) minus blocked slots`,
    citation,
    range: [0, 2000],
  }

  return result
}

/** Blocked slots are subtracted because a protected break is not bookable capacity. */
export function slotsInSession(session: AppointmentSession): number {
  const { startsAt, endsAt, slotMinutes, blockedSlots } = session.data
  if (typeof startsAt !== 'number' || typeof endsAt !== 'number') return 0
  if (typeof slotMinutes !== 'number' || slotMinutes <= 0) return 0
  const total = Math.floor((endsAt - startsAt) / (slotMinutes * 60_000))
  return Math.max(0, total - (blockedSlots?.length ?? 0))
}

function commonestSlotMinutes(sessions: AppointmentSession[]): number | null {
  const tally = new Map<number, number>()
  for (const session of sessions) {
    const minutes = session.data.slotMinutes
    if (typeof minutes !== 'number' || minutes <= 0) continue
    tally.set(minutes, (tally.get(minutes) ?? 0) + 1)
  }
  let best: number | null = null
  let bestCount = 0
  for (const [minutes, count] of tally) {
    // Ties break towards the shorter slot, the conservative reading of capacity.
    if (count > bestCount || (count === bestCount && best !== null && minutes < best)) {
      best = minutes
      bestCount = count
    }
  }
  return best
}

/**
 * Routing is read off each patient's own timeline: order that patient's resources by creation
 * and every change of owner is one observed handoff. Shares are normalised per origin owner, so
 * `gp->pharmacy` answers "of the work that left the GP, how much went to pharmacy".
 *
 * Consecutive resources with the same owner are not transitions and are skipped, otherwise a
 * busy site would swamp its own outbound shares with self-loops.
 *
 * Backdated history counts here even though it is barred from the arrival rates: where a
 * patient's care went is true whenever the record was written. Our own team writes do not
 * count, because calibrating routing on the actions we are about to test is circular.
 */
export function routingProbabilities(
  resources: ViewResource[],
  site: string,
  minSample: number,
  gaps: string[],
): RoutingProbabilities {
  const byPatient = new Map<string, ViewResource[]>()
  for (const resource of resources) {
    if (!resource.patientId || INFRA_KINDS.has(resource.kind)) continue
    if (origin(resource) === 'team') continue
    const list = byPatient.get(resource.patientId)
    if (list) list.push(resource)
    else byPatient.set(resource.patientId, [resource])
  }

  const transitions = new Map<string, number>()
  const originTotals = new Map<string, number>()

  for (const list of byPatient.values()) {
    // Sorted by createdAt then id so the result is deterministic for equal timestamps, which
    // the server produces in bulk whenever the clock is advanced in one jump.
    const ordered = [...list].sort((a, b) => a.createdAt - b.createdAt || compare(a.id, b.id))
    for (let i = 1; i < ordered.length; i++) {
      const from = ordered[i - 1]!.owner
      const to = ordered[i]!.owner
      if (from === to) continue
      const key = `${from}->${to}`
      transitions.set(key, (transitions.get(key) ?? 0) + 1)
      originTotals.set(from, (originTotals.get(from) ?? 0) + 1)
    }
  }

  if (transitions.size === 0) {
    gaps.push('no owner-to-owner transitions in this read; routing probabilities are unsourced')
    return {}
  }

  const thin = [...originTotals.entries()].filter(([, n]) => n < minSample).map(([owner]) => owner)
  if (thin.length > 0) {
    gaps.push(`routing shares out of ${thin.join(', ')} rest on fewer than ${minSample} observed transitions`)
  }

  const routing: RoutingProbabilities = {}
  for (const key of [...transitions.keys()].sort(compare)) {
    const count = transitions.get(key)!
    const from = key.slice(0, key.indexOf('->'))
    const total = originTotals.get(from)!
    routing[key] = {
      value: round(count / total, 4),
      units: 'share',
      source: 'measured',
      derivation: `${count} of ${total} observed handoffs out of ${from}, from per-patient resource timelines`,
      citation: `GET /api/sites/${site}/view → resources[].owner ordered by patientId + createdAt`,
      range: [0, 1],
    }
  }
  return routing
}

/**
 * `dueAt - createdAt` per kind. Documented rather than measured: the server stamps the due time
 * at creation, so this is the promise, not the observation. When every observation agrees the
 * spread is zero and the flat value is the SLA; a spread is recorded in the derivation so nobody
 * reads a median as a constant.
 */
function dueWindows(resources: ViewResource[], site: string, gaps: string[]): DueWindows {
  const out: DueWindows = {}
  for (const kind of DUE_WINDOW_KINDS) {
    const deltas = resources
      .filter((r) => r.kind === kind && typeof r.dueAt === 'number')
      .map((r) => (r.dueAt! - r.createdAt) / 60_000)
      .filter((minutes) => minutes > 0)
      .sort((a, b) => a - b)
    if (deltas.length === 0) {
      gaps.push(`no ${kind} resources with a dueAt in this read; its turnaround window is unsourced`)
      continue
    }
    const min = deltas[0]!
    const max = deltas[deltas.length - 1]!
    const spread = max === min ? 'identical across every observation' : `spread ${min}-${max} min`
    out[kind] = {
      value: round(median(deltas), 2),
      units: 'min',
      source: 'documented',
      derivation: `median dueAt - createdAt over ${deltas.length} ${kind} resources (${spread}); server-set due window, not an observed service time`,
      citation: `GET /api/sites/${site}/view → resources[].dueAt - createdAt where kind = ${kind}`,
      range: [0, 60 * 24 * 90],
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Live read
// ---------------------------------------------------------------------------

export interface LiveOptions {
  site?: Site
  /**
   * How many 500-resource pages to pull from the END of the list. The server orders resources
   * oldest first and caps a page at 500, so the tail is the only part of a 375k-resource site
   * that describes the world as it is now. Two pages is roughly a fortnight of sim time.
   */
  pages?: number
  /**
   * Also pull the first page. The head of the list is where the site keeps its `capacity-*`
   * config resources and the seeded cohort whose timelines are the only cross-owner routing
   * evidence in the payload. It costs one read and none of it can reach the arrival rates,
   * because every resource in it is backdated history.
   */
  includeHeadPage?: boolean
  /**
   * Days to walk backwards from the sim clock looking for published appointment sessions. The
   * clock can be advanced past the last generated session, so `now` alone often returns nothing.
   */
  appointmentLookbackDays?: number
  minRoutingSample?: number
}

/** Server cap. A larger `limit` is a 400, not a truncation. */
const PAGE_LIMIT = 500

/**
 * Fetch, then hand straight to the pure function. Everything that can fail lives here; nothing
 * here decides a number.
 */
export async function calibrateFromLive(
  client: NhsSimClient,
  opts: LiveOptions = {},
): Promise<CalibratedParams> {
  const site = opts.site ?? 'gp'
  const pageCount = Math.max(1, opts.pages ?? 2)

  // One cheap read first, purely to learn resourceTotal so the tail offsets can be computed.
  const probe = await client.get<SiteView>(`/api/sites/${site}/view`, { limit: 1 })
  const total = probe.resourceTotal ?? probe.resources.length

  const offsets: number[] = []
  for (let i = 1; i <= pageCount; i++) {
    const offset = Math.max(0, total - PAGE_LIMIT * i)
    if (offsets.includes(offset)) break
    offsets.push(offset)
    if (offset === 0) break
  }
  if ((opts.includeHeadPage ?? true) && !offsets.includes(0)) offsets.push(0)

  const pages = await Promise.all(
    offsets.map((offset) =>
      client.get<SiteView>(`/api/sites/${site}/view`, { offset, limit: PAGE_LIMIT }),
    ),
  )
  const view = mergeViewPages(pages)

  const found = await findAppointments(client, site, view.now, opts.appointmentLookbackDays ?? 7)

  return extractCalibration(view, {
    site,
    ...(found ? { appointments: found.payload, appointmentsDate: found.date } : {}),
    ...(opts.minRoutingSample !== undefined ? { minRoutingSample: opts.minRoutingSample } : {}),
  })
}

/**
 * Fold several pages of the same site into one view. Later pages win on the scalar fields, since
 * they were read last, and resources are de-duplicated by id because page boundaries shift when
 * the clock moves under a read.
 */
export function mergeViewPages(pages: SiteView[]): SiteView {
  const first = pages[0]
  if (!first) throw new Error('mergeViewPages needs at least one page')
  const seen = new Map<string, ViewResource>()
  for (const page of pages) {
    for (const resource of page.resources) seen.set(resource.id, resource)
  }
  const last = pages[pages.length - 1]!
  return {
    ...last,
    resources: [...seen.values()].sort((a, b) => a.createdAt - b.createdAt || compare(a.id, b.id)),
    resourceOffset: Math.min(...pages.map((p) => p.resourceOffset ?? 0)),
    resourceLimit: seen.size,
  }
}

async function findAppointments(
  client: NhsSimClient,
  site: string,
  now: number,
  lookbackDays: number,
): Promise<{ date: string; payload: AppointmentsPayload } | null> {
  for (let back = 0; back <= lookbackDays; back++) {
    const date = isoDate(now - back * MS_PER_DAY)
    try {
      const payload = await client.get<AppointmentsPayload>(
        `/api/sites/${site}/appointments`,
        { date },
      )
      if (payload.sessions?.length) return { date, payload }
    } catch {
      // A site with no appointments endpoint is a missing capacity source, not a failed
      // calibration: the gap is recorded downstream and the rest of the numbers still stand.
      return null
    }
  }
  return null
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Handoff to Kaavya
// ---------------------------------------------------------------------------

export const HANDOFF_PATH = 'fixtures/params.calibrated.json'

export interface CalibrationHandoff {
  meta: CalibrationMeta
  /** Plain numbers, nested exactly like CalibratedParams, so the engine can load them directly. */
  params: Record<string, unknown>
  /** Same dotted paths as `params`, carrying the tag, the derivation and the citation. */
  _sources: Record<string, Omit<Sourced, 'value'>>
  gaps: string[]
}

/**
 * Split the tagged tree into values and sources. Two shapes for one truth: the engine reads
 * `params` and never has to know about tags, the source table reads `_sources` and never has to
 * walk the engine's config. Every leaf appears in both, which is what makes "no untagged number"
 * checkable rather than merely intended.
 */
export function buildHandoff(calibration: CalibratedParams): CalibrationHandoff {
  const params: Record<string, unknown> = {}
  const sources: Record<string, Omit<Sourced, 'value'>> = {}

  for (const [key, node] of Object.entries(calibration)) {
    if (key === 'meta' || key === 'gaps') continue
    flatten(node, key, params, sources)
  }

  return { meta: calibration.meta, params, _sources: sources, gaps: calibration.gaps }
}

/** Writes the handoff JSON and returns the path written. */
export async function writeCalibrationHandoff(
  calibration: CalibratedParams,
  path: string = HANDOFF_PATH,
): Promise<string> {
  const handoff = buildHandoff(calibration)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8')
  return path
}

function isSourced(node: unknown): node is Sourced {
  if (typeof node !== 'object' || node === null) return false
  const candidate = node as Partial<Sourced>
  return typeof candidate.value === 'number' && typeof candidate.source === 'string'
}

function flatten(
  node: unknown,
  path: string,
  params: Record<string, unknown>,
  sources: Record<string, Omit<Sourced, 'value'>>,
): void {
  if (isSourced(node)) {
    const { value, ...rest } = node
    setPath(params, path, value)
    sources[path] = rest
    return
  }
  if (typeof node !== 'object' || node === null) return
  for (const [key, child] of Object.entries(node)) flatten(child, `${path}.${key}`, params, sources)
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    const next = cursor[part]
    if (typeof next !== 'object' || next === null) cursor[part] = {}
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1]!] = value
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function numberField(data: Record<string, unknown> | undefined, field: string): number | null {
  const value = data?.[field]
  return typeof value === 'number' ? value : null
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]!
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Rounded so a rate is readable on screen and stable across reruns of the same payload. */
function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
