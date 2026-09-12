/**
 * The calibration -> `Params` adapter, checked against the handoff file we actually ship.
 * OWNER: Oriol.
 *
 * This suite is a contract test, not an arithmetic test. Kaavya's engine will read whatever comes
 * out of `toParams` without re-validating it, and Elsa's panel renders every leaf with its source
 * chip, so the failure that matters here is STRUCTURAL: a section that never got written, a leaf
 * that renders with no provenance, a value that drifted outside its own physical bounds.
 *
 * Everything therefore runs off `walkSourced`, which finds leaves by shape rather than by name.
 * A checklist of paths would pass happily while a whole section was missing; a generic walk
 * cannot, and the expected-path assertion below fails loudly the day the contract grows a field.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Params, Sourced, SourceTag } from '../src/contracts/params.ts'
import type { CalibrationHandoff } from '../src/integration/calibration.ts'
import {
  calibrationFromHandoff,
  countsFromDerivation,
  toParams,
  wilson,
} from '../src/integration/calibration-to-params.ts'

/**
 * Read at runtime rather than imported: `resolveJsonModule` would infer `source: string` for
 * every entry, which does not satisfy `SourceTag`, and the cast would then hide a real shape
 * change in the file.
 */
const handoff = JSON.parse(
  readFileSync(new URL('../fixtures/params.calibrated.json', import.meta.url), 'utf8'),
) as CalibrationHandoff

const SOURCE_TAGS: readonly SourceTag[] = ['measured', 'documented', 'literature', 'assumed']

const params: Params = toParams(calibrationFromHandoff(handoff))

// ---------------------------------------------------------------------------
// The generic walk — the only thing standing between us and a missed leaf
// ---------------------------------------------------------------------------

interface Leaf {
  path: string
  leaf: Sourced
}

/**
 * A node is a candidate leaf as soon as it carries a numeric `value`, NOT once it looks fully
 * formed. That is deliberate: a leaf missing its `bounds` is exactly the bug this suite exists to
 * catch, so it has to be collected and then failed, never skipped as "not a Sourced".
 */
function walkSourced(node: unknown, path = ''): Leaf[] {
  if (typeof node !== 'object' || node === null) return []
  const candidate = node as Record<string, unknown>
  if (typeof candidate.value === 'number') return [{ path, leaf: node as Sourced }]
  return Object.entries(candidate).flatMap(([key, child]) =>
    walkSourced(child, path ? `${path}.${key}` : key),
  )
}

const leaves = walkSourced(params)
const byPath = new Map(leaves.map((entry) => [entry.path, entry.leaf]))

/** Every leaf Kaavya's `Params` declares. Written out so a dropped section cannot pass quietly. */
const EXPECTED_PATHS = [
  'arrivals.perDay.routine',
  'arrivals.perDay.complex',
  'arrivals.perDay.urgent',
  'capacities.gpSessionsPerDay',
  'capacities.gpSlotsPerSession',
  'capacities.communitySlotsPerDay',
  'capacities.staffedSpaces',
  'capacities.gpAdminShare',
  'serviceTimes.gpConsultation',
  'serviceTimes.communityVisit',
  'serviceTimes.documentReviewHop',
  'serviceTimes.bloodResultTurnaround',
  'serviceTimes.pharmacyApproval',
  'routing.gpToTest',
  'routing.gpToHospital',
  'routing.gpToCommunity',
  'routing.letterSentToReviewed',
  'routing.letterReviewedToFiled',
  'routing.communityRejection',
  'levers.communityCapacityMultiplier',
  'levers.extraGpSessions',
  'levers.telephoneFollowUpShare',
  'levers.monitoringIntensity',
  'levers.hospitalToCommunityShare',
  'levers.weekdayDischargeShare',
  'boundaries.inducedDemand',
  'boundaries.substitution',
  'boundaries.gaming',
]

function leafAt(path: string): Sourced {
  const leaf = byPath.get(path)
  if (!leaf) throw new Error(`no leaf at ${path}`)
  return leaf
}

// ---------------------------------------------------------------------------

describe('toParams — structural completeness', () => {
  it('produces every section the engine reads', () => {
    expect(Object.keys(params).sort()).toEqual([
      'arrivals',
      'boundaries',
      'capacities',
      'environment',
      'levers',
      'meta',
      'routing',
      'serviceTimes',
      'sim',
    ])
  })

  it('finds exactly the leaves the contract declares, no more and no fewer', () => {
    expect([...byPath.keys()].sort()).toEqual([...EXPECTED_PATHS].sort())
  })

  it('carries all three patient classes, including the one NHS-SIM does not have', () => {
    expect(Object.keys(params.arrivals.perDay).sort()).toEqual(['complex', 'routine', 'urgent'])
  })

  it('sets the environment axis explicitly rather than folding it into a world', () => {
    expect(params.environment).toEqual({ winterPressure: false, staffShortage: false })
  })

  it('declares whether the run starts from a served steady state', () => {
    expect(params.sim.startFromSteadyState).toBe(true)
    expect(params.sim.horizonDays).toBeGreaterThan(params.sim.warmupDays)
  })
})

describe('toParams — every leaf is renderable', () => {
  it.each(EXPECTED_PATHS)('%s has bounds, a source and a finite value', (path) => {
    const leaf = leafAt(path)

    expect(Array.isArray(leaf.bounds)).toBe(true)
    expect(leaf.bounds).toHaveLength(2)
    expect(Number.isFinite(leaf.bounds[0])).toBe(true)
    expect(Number.isFinite(leaf.bounds[1])).toBe(true)
    expect(leaf.bounds[0]).toBeLessThanOrEqual(leaf.bounds[1])

    expect(SOURCE_TAGS).toContain(leaf.source)

    expect(Number.isNaN(leaf.value)).toBe(false)
    expect(Number.isFinite(leaf.value)).toBe(true)
    expect(leaf.value).toBeGreaterThanOrEqual(leaf.bounds[0])
    expect(leaf.value).toBeLessThanOrEqual(leaf.bounds[1])
  })

  it.each(EXPECTED_PATHS)('%s is cited unless it is assumed', (path) => {
    const leaf = leafAt(path)
    if (leaf.source === 'assumed') {
      // An assumed leaf renders amber, so it owes the reader a reason instead of a citation.
      expect(leaf.note, `${path} is assumed and must say why`).toBeTruthy()
      return
    }
    expect(typeof leaf.citation, `${path} is ${leaf.source} and must cite something`).toBe('string')
    expect((leaf.citation ?? '').length).toBeGreaterThan(0)
  })

  it.each(EXPECTED_PATHS)('%s has a sampling range that is usable or absent', (path) => {
    const { range, bounds, value } = leafAt(path)
    if (!range) {
      // No range means no contribution to world spread (PRD §8.3), which must be a declared
      // choice rather than an oversight — so the leaf has to say so.
      expect(leafAt(path).note, `${path} has no range and must explain why`).toBeTruthy()
      return
    }
    expect(range).toHaveLength(2)
    expect(Number.isFinite(range[0])).toBe(true)
    expect(Number.isFinite(range[1])).toBe(true)
    expect(range[0]).toBeLessThanOrEqual(range[1])
    expect(range[0]).toBeGreaterThanOrEqual(bounds[0])
    expect(range[1]).toBeLessThanOrEqual(bounds[1])
    // A sampler that cannot draw the point estimate is describing a different parameter.
    expect(value).toBeGreaterThanOrEqual(range[0])
    expect(value).toBeLessThanOrEqual(range[1])
  })

  it('contains no NaN anywhere in the serialised set', () => {
    expect(JSON.stringify(params)).not.toContain('null')
    for (const { leaf } of leaves) {
      for (const n of [leaf.value, ...leaf.bounds, ...(leaf.range ?? [])]) {
        expect(Number.isNaN(n)).toBe(false)
      }
    }
  })
})

describe('toParams — provenance is honest', () => {
  it('carries our measured GP arrival rate, not the baseline placeholder', () => {
    const routine = leafAt('arrivals.perDay.routine')
    expect(routine.value).toBeCloseTo(97.039, 3)
    expect(routine.source).toBe('measured')
    expect(routine.citation).toContain('/api/sites/gp/view')
  })

  it('records the two-method corroboration on arrivals, totalling ~142/sim-day', () => {
    const total =
      params.arrivals.perDay.routine.value
      + params.arrivals.perDay.urgent.value
      + params.arrivals.perDay.complex.value
    expect(total).toBeGreaterThan(140)
    expect(total).toBeLessThan(144)
    expect(params.arrivals.perDay.routine.note).toMatch(/independent/i)
  })

  it('never presents the ungrounded levers as measured', () => {
    for (const path of ['levers.hospitalToCommunityShare', 'levers.weekdayDischargeShare']) {
      const leaf = leafAt(path)
      expect(['literature', 'assumed']).toContain(leaf.source)
      expect(leaf.note).toMatch(/NOT GROUNDED/)
    }
  })

  it('declares all three boundaries at 0 with the reason', () => {
    for (const leaf of Object.values(params.boundaries)) {
      expect(leaf.value).toBe(0)
      expect(leaf.source).toBe('assumed')
      expect(leaf.note).toMatch(/breakeven/i)
    }
  })

  it('gives the constant service times no range, and says why', () => {
    for (const path of ['serviceTimes.communityVisit', 'serviceTimes.documentReviewHop']) {
      expect(leafAt(path).range).toBeUndefined()
      expect(leafAt(path).note).toMatch(/variance is exactly zero/)
    }
  })

  it('stamps the set with the world and the snapshot it came from', () => {
    expect(params.meta.worldId).toBe('team-4551d2471320')
    expect(params.meta.snapshotId).toBe(handoff.meta.observedAtIso)
    expect(params.meta.calibratedAt).toBe(handoff.meta.observedAt)
  })
})

describe('range helpers', () => {
  it('reads the sample size back out of a derivation string', () => {
    expect(countsFromDerivation('18 of 22 observed handoffs out of gp')).toEqual({
      successes: 18,
      n: 22,
    })
    expect(countsFromDerivation('median dueAt - createdAt over 7 resources')).toBeNull()
  })

  it('brackets the point estimate and stays inside [0, 1] at the counts we actually have', () => {
    for (const [successes, n] of [
      [18, 22],
      [0, 22],
      [2, 6],
      [21, 57],
      [9, 57],
    ] as const) {
      const [lo, hi] = wilson(successes, n)
      expect(lo).toBeGreaterThanOrEqual(0)
      expect(hi).toBeLessThanOrEqual(1)
      expect(lo).toBeLessThanOrEqual(successes / n)
      expect(hi).toBeGreaterThanOrEqual(successes / n)
    }
  })

  it('widens as the sample thins — the whole reason the three worlds separate', () => {
    const thin = wilson(2, 6)
    const thick = wilson(21, 57)
    expect(thin[1] - thin[0]).toBeGreaterThan(thick[1] - thick[0])
  })
})

describe('calibrationFromHandoff', () => {
  it('rejoins every value in the shipped handoff with its tags', () => {
    const calibration = calibrationFromHandoff(handoff)
    expect(calibration.arrivals.routine.value).toBeCloseTo(97.039, 3)
    expect(calibration.arrivals.routine.source).toBe('measured')
    expect(calibration.capacities.gpSessionsPerDay?.value).toBe(6)
    expect(calibration.routing['gp->diagnostics']?.derivation).toContain('18 of 22')
    expect(calibration.meta).toEqual(handoff.meta)
    expect(calibration.gaps).toEqual(handoff.gaps)
  })

  it('refuses a handoff whose source has no matching value', () => {
    const broken: CalibrationHandoff = {
      ...handoff,
      params: {},
      _sources: { 'arrivals.routine': handoff._sources['arrivals.routine']! },
    }
    expect(() => calibrationFromHandoff(broken)).toThrow(/no numeric value/)
  })
})
