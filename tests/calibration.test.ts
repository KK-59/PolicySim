/**
 * Calibration extractor tests: the arithmetic, against a hand-built payload.
 * OWNER: Oriol.
 *
 * Nothing here touches the network. The whole point of `extractCalibration` being pure is that
 * the numbers Kaavya's engine runs on can be checked against a fixture whose answers were worked
 * out by hand: 10 sim-days, 20 routine arrivals, therefore 2.0/sim-day and nothing else.
 *
 * The fixture is built by a helper rather than pasted as JSON so the counts stay legible: a
 * wall of 30 literal resources hides exactly the arithmetic these tests exist to pin down.
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildHandoff,
  classifyArrival,
  extractCalibration,
  isArrival,
  mergeViewPages,
  origin,
  slotsInSession,
  writeCalibrationHandoff,
  type AppointmentsPayload,
  type SiteView,
  type SourceTag,
  type ViewResource,
} from '../src/integration/calibration.ts'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 0, 1)
/** Ten days after the first arrival, so every rate below divides by exactly 10. */
const NOW = T0 + 10 * DAY

const SOURCE_TAGS: SourceTag[] = ['measured', 'documented', 'literature', 'assumed']

function resource(overrides: Partial<ViewResource> & { id: string }): ViewResource {
  return {
    kind: 'request',
    title: 'fixture resource',
    status: 'open',
    owner: 'triage',
    priority: 'routine',
    createdAt: T0 + DAY,
    data: {},
    version: 1,
    ...overrides,
  }
}

/**
 * 20 routine + 5 complex + 10 urgent arrivals over exactly 10 sim-days, plus two capacity
 * resources that must not be counted as demand.
 */
function fixtureResources(): ViewResource[] {
  const out: ViewResource[] = []

  // 13 routine requests, one per unique patient. The first one opens the window at T0.
  for (let i = 0; i < 13; i++) {
    out.push(resource({
      id: `r-req-${i}`,
      patientId: `SIM-R${i}`,
      createdAt: i === 0 ? T0 : T0 + ((i % 9) + 1) * DAY,
    }))
  }

  // Two patients whose work moves between owners. These are the only routing evidence, and
  // they are routine arrivals as well, which is what makes the 20 add up.
  out.push(resource({ id: 'r-a1', kind: 'task', owner: 'gp', patientId: 'SIM-A', createdAt: T0 + 1 * DAY }))
  out.push(resource({ id: 'r-a2', kind: 'task', owner: 'pharmacy', patientId: 'SIM-A', createdAt: T0 + 2 * DAY }))
  out.push(resource({ id: 'r-a3', kind: 'task', owner: 'gp', patientId: 'SIM-A', createdAt: T0 + 3 * DAY }))
  out.push(resource({ id: 'r-b1', kind: 'task', owner: 'gp', patientId: 'SIM-B', createdAt: T0 + 1 * DAY }))
  out.push(resource({ id: 'r-b2', kind: 'task', owner: 'diagnostics', patientId: 'SIM-B', createdAt: T0 + 2 * DAY }))

  // 2 community visits, each with a 60 minute due window.
  for (let i = 0; i < 2; i++) {
    out.push(resource({
      id: `r-visit-${i}`,
      kind: 'visit',
      owner: 'community',
      status: 'scheduled',
      patientId: `SIM-V${i}`,
      createdAt: T0 + (i + 4) * DAY,
      dueAt: T0 + (i + 4) * DAY + 60 * 60_000,
    }))
  }

  // 5 referrals: complex, because a referral opens a pathway across two services.
  for (let i = 0; i < 5; i++) {
    out.push(resource({
      id: `r-ref-${i}`,
      kind: 'referral',
      owner: 'referrals',
      patientId: `SIM-C${i}`,
      createdAt: T0 + (i + 2) * DAY,
      dueAt: T0 + (i + 2) * DAY + 1440 * 60_000,
    }))
  }

  // 10 urgent tasks, urgent by the server's own priority field.
  for (let i = 0; i < 10; i++) {
    out.push(resource({
      id: `r-urg-${i}`,
      kind: 'task',
      owner: 'gp',
      priority: 'urgent',
      patientId: `SIM-U${i}`,
      createdAt: T0 + ((i % 9) + 1) * DAY,
    }))
  }

  // Service furniture. No patientId, and excluded by kind regardless.
  out.push(resource({ id: 'capacity-gp', kind: 'capacity', owner: 'gp', status: 'available', data: { total: 6, remaining: 4 } }))
  out.push(resource({ id: 'capacity-community', kind: 'capacity', owner: 'community', status: 'available', data: { total: 4, remaining: 3 } }))

  return out
}

function fixtureView(overrides: Partial<SiteView> = {}): SiteView {
  return {
    id: 'gp',
    now: NOW,
    speed: 60,
    paused: true,
    population: 50_000,
    counters: { appointmentSessionVersion: 1, completed: 668 },
    resources: fixtureResources(),
    resourceTotal: 1200,
    resourceOffset: 700,
    resourceLimit: 500,
    ...overrides,
  }
}

/** Two 4-hour sessions at 15 minutes a slot, one protected break each: 16 - 1 = 15 slots apiece. */
function fixtureAppointments(): AppointmentsPayload {
  const session = (id: string, startsAt: number) => ({
    id,
    kind: 'appointment-session',
    owner: 'gp',
    status: 'open',
    title: id,
    data: {
      startsAt,
      endsAt: startsAt + 4 * 60 * 60_000,
      slotMinutes: 15,
      mode: 'in-person',
      blockedSlots: [{ reason: 'Protected break', startsAt: startsAt + 2 * 60 * 60_000 }],
    },
  })
  return { sessions: [session('session-am', NOW), session('session-pm', NOW + 5 * 60 * 60_000)] }
}

// ---------------------------------------------------------------------------

describe('classification', () => {
  it('excludes service furniture and anything with no patient from demand', () => {
    expect(isArrival(resource({ id: 'x', kind: 'capacity', owner: 'gp' }))).toBe(false)
    expect(isArrival(resource({ id: 'x', kind: 'request', owner: 'triage' }))).toBe(false)
    expect(isArrival(resource({ id: 'x', kind: 'request', patientId: 'SIM-1' }))).toBe(true)
  })

  it('reads origin off provenance, defaulting to demand when there is none', () => {
    expect(origin(resource({ id: 'x' }))).toBe('demand')
    expect(origin(resource({
      id: 'x',
      provenance: { created: { action: 'generate_history', actor: { kind: 'simulation' } } },
    }))).toBe('history')
    expect(origin(resource({
      id: 'x',
      provenance: { created: { action: 'create_task', actor: { kind: 'team', name: 'team14' } } },
    }))).toBe('team')
  })

  it('keeps backdated history and our own writes out of the arrival count', () => {
    // The live server backdates synthetic history by years. Counted as arrivals, one such
    // record stretches the window from days to years and divides every rate by a hundred.
    const backdated = resource({
      id: 'r-old',
      kind: 'encounter',
      owner: 'gp',
      patientId: 'SIM-OLD',
      createdAt: T0 - 900 * DAY,
      provenance: { created: { action: 'generate_history', actor: { kind: 'simulation' } } },
    })
    const ourWrite = resource({
      id: 'r-team',
      kind: 'task',
      owner: 'gp',
      patientId: 'SIM-TEAM',
      createdAt: T0 + 5 * DAY,
      provenance: { created: { action: 'create_task', actor: { kind: 'team', name: 'team14' } } },
    })

    expect(isArrival(backdated)).toBe(false)
    expect(isArrival(ourWrite)).toBe(false)

    const view = fixtureView({ resources: [...fixtureResources(), backdated, ourWrite] })
    const { arrivals, meta } = extractCalibration(view)
    expect(meta.windowStart).toBe(T0)
    expect(meta.windowDays).toBe(10)
    expect(meta.historyExcluded).toBe(1)
    expect(meta.teamWritesExcluded).toBe(1)
    expect(meta.arrivalsCounted).toBe(35)
    expect(arrivals.routine.value).toBe(2)
  })

  it('reads the priority field before it reads the kind', () => {
    expect(classifyArrival(resource({ id: 'x', kind: 'referral', priority: 'urgent' }))).toBe('urgent')
    expect(classifyArrival(resource({ id: 'x', kind: 'referral' }))).toBe('complex')
    expect(classifyArrival(resource({ id: 'x', kind: 'hospital-attendance' }))).toBe('urgent')
    expect(classifyArrival(resource({ id: 'x', kind: 'request' }))).toBe('routine')
  })
})

describe('arrival rates', () => {
  it('divides counted arrivals by the observed window', () => {
    const { arrivals, meta } = extractCalibration(fixtureView())

    expect(meta.windowDays).toBe(10)
    expect(meta.windowStart).toBe(T0)
    expect(meta.windowEnd).toBe(NOW)

    expect(arrivals.routine.value).toBe(2)
    expect(arrivals.complex.value).toBe(0.5)
    expect(arrivals.urgent.value).toBe(1)
  })

  it('runs the window to the clock, not to the last arrival', () => {
    // Same resources, clock five days further on: the silence counts, so every rate halves.
    const { arrivals, meta } = extractCalibration(fixtureView({ now: NOW + 10 * DAY }))
    expect(meta.windowDays).toBe(20)
    expect(arrivals.routine.value).toBe(1)
    expect(arrivals.urgent.value).toBe(0.5)
  })

  it('tags every rate measured and cites the fields it came from', () => {
    const { arrivals } = extractCalibration(fixtureView())
    for (const rate of Object.values(arrivals)) {
      expect(rate.source).toBe('measured')
      expect(rate.units).toBe('/sim-day')
      expect(rate.citation).toContain('/api/sites/gp/view')
      expect(rate.derivation.length).toBeGreaterThan(0)
    }
  })

  it('flags a class it never observed instead of letting the zero pass as calibrated', () => {
    const noUrgent = fixtureView({
      resources: fixtureResources().filter((r) => r.priority !== 'urgent'),
    })
    const { arrivals, gaps } = extractCalibration(noUrgent)
    expect(arrivals.urgent.value).toBe(0)
    expect(gaps.some((g) => g.includes('no urgent arrivals observed'))).toBe(true)
  })
})

describe('capacities', () => {
  it('takes declared concurrent slots from capacity resources, tagged documented', () => {
    const { capacities } = extractCalibration(fixtureView())
    expect(capacities.concurrentSlots['gp']?.value).toBe(6)
    expect(capacities.concurrentSlots['community']?.value).toBe(4)
    expect(capacities.concurrentSlots['gp']?.source).toBe('documented')
  })

  it('counts bookable slots per session and subtracts protected breaks', () => {
    const [session] = fixtureAppointments().sessions
    expect(slotsInSession(session!)).toBe(15)
  })

  it('sums session config into slots per day', () => {
    const { capacities } = extractCalibration(fixtureView(), {
      site: 'gp',
      appointments: fixtureAppointments(),
      appointmentsDate: '2026-01-11',
    })
    expect(capacities.gpSessionsPerDay?.value).toBe(2)
    expect(capacities.gpSlotMinutes?.value).toBe(15)
    expect(capacities.gpSlotsPerDay?.value).toBe(30)
    expect(capacities.gpSlotsPerDay?.source).toBe('documented')
    expect(capacities.gpSlotsPerDay?.citation).toContain('date=2026-01-11')
    expect(capacities.appointmentSessionVersion?.value).toBe(1)
  })

  it('measures community visits per sim-day separately from the declared capacity', () => {
    const { capacities } = extractCalibration(fixtureView())
    expect(capacities.communityVisitsPerDay?.value).toBe(0.2)
    expect(capacities.communityVisitsPerDay?.source).toBe('measured')
  })

  it('flags missing session config rather than inventing slots', () => {
    const { capacities, gaps } = extractCalibration(fixtureView())
    expect(capacities.gpSlotsPerDay).toBeUndefined()
    expect(gaps.some((g) => g.includes('GP slots per day are unsourced'))).toBe(true)
  })
})

describe('routing probabilities', () => {
  it('normalises owner handoffs per origin, ignoring self-loops', () => {
    const { routing } = extractCalibration(fixtureView())

    // SIM-A: gp -> pharmacy -> gp. SIM-B: gp -> diagnostics. Two handoffs leave the GP.
    expect(routing['gp->pharmacy']?.value).toBe(0.5)
    expect(routing['gp->diagnostics']?.value).toBe(0.5)
    expect(routing['pharmacy->gp']?.value).toBe(1)

    // The ten urgent GP tasks each belong to a different patient, so they are not transitions.
    expect(routing['gp->gp']).toBeUndefined()
    expect(routing['gp->pharmacy']?.source).toBe('measured')
  })

  it('ignores our own writes, so routing is not calibrated on the actions under test', () => {
    const ourWrite = resource({
      id: 'r-a4',
      kind: 'visit',
      owner: 'community',
      patientId: 'SIM-A',
      createdAt: T0 + 4 * DAY,
      provenance: { created: { action: 'schedule_visit', actor: { kind: 'team', name: 'team14' } } },
    })
    const { routing } = extractCalibration(
      fixtureView({ resources: [...fixtureResources(), ourWrite] }),
    )
    expect(routing['gp->community']).toBeUndefined()
    expect(routing['gp->pharmacy']?.value).toBe(0.5)
  })

  it('shares out of one origin sum to 1', () => {
    const { routing } = extractCalibration(fixtureView())
    const outOfGp = Object.entries(routing)
      .filter(([key]) => key.startsWith('gp->'))
      .reduce((sum, [, sourced]) => sum + sourced.value, 0)
    expect(outOfGp).toBeCloseTo(1, 10)
  })

  it('flags origins with too few observed transitions to trust', () => {
    const { gaps } = extractCalibration(fixtureView())
    expect(gaps.some((g) => g.includes('fewer than 5 observed transitions'))).toBe(true)
  })
})

describe('due windows', () => {
  it('reports the server-set window as documented, never as a measured service time', () => {
    const { dueWindows, gaps } = extractCalibration(fixtureView())
    expect(dueWindows['referral']?.value).toBe(1440)
    expect(dueWindows['visit']?.value).toBe(60)
    expect(dueWindows['referral']?.source).toBe('documented')
    expect(dueWindows['referral']?.derivation).toContain('not an observed service time')
    expect(gaps.some((g) => g.includes('no test resources with a dueAt'))).toBe(true)
  })
})

describe('no untagged numbers', () => {
  it('carries a source tag on every number outside the read metadata', () => {
    const calibration = extractCalibration(fixtureView(), {
      site: 'gp',
      appointments: fixtureAppointments(),
      appointmentsDate: '2026-01-11',
    })

    const untagged: string[] = []
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'number') {
        untagged.push(path)
        return
      }
      if (typeof node !== 'object' || node === null) return
      if (isSourcedLeaf(node)) {
        expect(SOURCE_TAGS).toContain(node.source)
        expect(node.units.length).toBeGreaterThan(0)
        expect(node.citation.length).toBeGreaterThan(0)
        expect(node.derivation.length).toBeGreaterThan(0)
        return
      }
      for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`)
    }

    for (const [key, value] of Object.entries(calibration)) {
      if (key === 'meta' || key === 'gaps') continue
      walk(value, key)
    }

    expect(untagged).toEqual([])
  })
})

describe('purity', () => {
  it('does not mutate the payload and returns the same numbers every time', () => {
    const view = fixtureView()
    const before = JSON.stringify(view)
    const first = extractCalibration(view, { site: 'gp', appointments: fixtureAppointments() })
    const second = extractCalibration(view, { site: 'gp', appointments: fixtureAppointments() })
    expect(JSON.stringify(view)).toBe(before)
    expect(second).toEqual(first)
  })
})

describe('mergeViewPages', () => {
  it('de-duplicates by id and orders by creation, keeping the newest scalars', () => {
    const a = fixtureView({ resources: fixtureResources().slice(0, 5), resourceOffset: 700 })
    const b = fixtureView({
      resources: fixtureResources().slice(3, 10),
      resourceOffset: 200,
      now: NOW + DAY,
    })
    const merged = mergeViewPages([a, b])

    expect(merged.resources).toHaveLength(10)
    expect(new Set(merged.resources.map((r) => r.id)).size).toBe(10)
    expect(merged.now).toBe(NOW + DAY)
    expect(merged.resourceOffset).toBe(200)
    const times = merged.resources.map((r) => r.createdAt)
    expect([...times].sort((x, y) => x - y)).toEqual(times)
  })
})

describe('handoff', () => {
  const calibration = extractCalibration(fixtureView(), {
    site: 'gp',
    appointments: fixtureAppointments(),
    appointmentsDate: '2026-01-11',
  })

  it('emits a plain-number tree and a _sources entry for every leaf in it', () => {
    const handoff = buildHandoff(calibration)

    const params = handoff.params as { arrivals: Record<string, number> }
    expect(params.arrivals['routine']).toBe(2)
    expect(handoff._sources['arrivals.routine']?.source).toBe('measured')
    expect(handoff._sources['capacities.gpSlotsPerDay']?.source).toBe('documented')

    const leaves: string[] = []
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'number') return void leaves.push(path)
      if (typeof node !== 'object' || node === null) return
      for (const [key, child] of Object.entries(node)) walk(child, path ? `${path}.${key}` : key)
    }
    walk(handoff.params, '')

    expect(leaves.length).toBeGreaterThan(0)
    for (const leaf of leaves) expect(handoff._sources[leaf]).toBeDefined()
    expect(Object.keys(handoff._sources).sort()).toEqual(leaves.sort())
  })

  it('writes JSON that round-trips', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'policysim-calibration-'))
    const path = join(dir, 'params.calibrated.json')
    expect(await writeCalibrationHandoff(calibration, path)).toBe(path)

    const parsed = JSON.parse(await readFile(path, 'utf8')) as ReturnType<typeof buildHandoff>
    expect(parsed).toEqual(buildHandoff(calibration))
    expect(parsed.meta.site).toBe('gp')
    expect(Array.isArray(parsed.gaps)).toBe(true)
  })
})

function isSourcedLeaf(node: object): node is { source: SourceTag; units: string; citation: string; derivation: string } {
  const candidate = node as Partial<{ value: number; source: string }>
  return typeof candidate.value === 'number' && typeof candidate.source === 'string'
}
