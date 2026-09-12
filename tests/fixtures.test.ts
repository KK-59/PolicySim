/**
 * Guards the interface fixtures against contract drift.
 *
 * These exist because the drift already happened once: `NodeId` lost four members and `Metrics`
 * gained `breakevens` and `unfiledResults` when the engine landed, and nothing failed. The fixture
 * is cast to `Metrics` in src/ui/data, so a cast that has quietly become a lie renders wrong
 * numbers rather than throwing. A failing test is the cheap way to find out.
 *
 * If one of these breaks, the fix is `node scripts/build-mock-metrics.mjs`, not a looser test.
 */

import { describe, expect, it } from 'vitest'

import metricsJson from '../fixtures/metrics.mock.json'
import sweepJson from '../fixtures/sweep.mock.json'
import type { Metrics, NodeId } from '../src/contracts/metrics.ts'

const metrics = metricsJson as unknown as Metrics

/** Kept in step with the NodeId union by hand, because a type cannot be enumerated at runtime. */
const NODE_IDS: NodeId[] = ['gp-clinic', 'gp-admin', 'test', 'community-visit']

const WORLDS = ['optimistic', 'realistic', 'pessimistic'] as const

describe('metrics fixture', () => {
  it('carries every top-level field Metrics requires', () => {
    for (const key of ['worlds', 'delta', 'findings', 'tornado', 'thresholds', 'breakevens', 'flags', 'run']) {
      expect(metrics, `Metrics.${key} missing`).toHaveProperty(key)
    }
  })

  it('carries every WorldBands outcome, on both worlds and delta', () => {
    const outcomes = ['waits', 'timeInSystem', 'perNode', 'completed', 'rejections', 'unfiledLetters', 'unfiledResults']
    for (const band of ['worlds', 'delta'] as const) {
      for (const key of outcomes) {
        expect(metrics[band], `${band}.${key} missing`).toHaveProperty(key)
      }
    }
  })

  it('names only nodes the contract still has', () => {
    const used = Object.keys(metrics.worlds.perNode)
    expect(used.length).toBeGreaterThan(0)
    for (const node of used) {
      expect(NODE_IDS, `perNode has "${node}", which NodeId no longer includes`).toContain(node)
    }
  })

  it('gives every three-world band all three worlds and a direction', () => {
    for (const world of WORLDS) {
      expect(metrics.worlds.waits.routine).toHaveProperty(world)
      expect(metrics.worlds.rejections).toHaveProperty(world)
    }
    expect(metrics.worlds.waits.routine.direction).toBe('lower-is-better')
  })

  it('never reports a finding as surviving all three unless it holds in all three', () => {
    for (const f of metrics.findings) {
      expect(f.survivesAllThree, `"${f.id}" claims robustness it does not have`).toBe(
        f.holdsIn.length === 3,
      )
      if (f.optimisticOnly) {
        expect(f.holdsIn).toEqual(['optimistic'])
      }
    }
  })

  it('labels itself synthetic so the interface can say so on screen', () => {
    expect((metricsJson as { _synthetic?: string })._synthetic).toBeTruthy()
  })
})

describe('sweep fixture', () => {
  const sweep = sweepJson as unknown as {
    lever: { positions: number[] }
    policyIndex: number
    series: { worlds: { world: string; points: { x: number; y: number }[] }[]; ghosts: unknown[] }[]
  }

  it('gives every world a point at every lever position', () => {
    const n = sweep.lever.positions.length
    for (const series of sweep.series) {
      expect(series.worlds).toHaveLength(3)
      for (const w of series.worlds) {
        expect(w.points, `${w.world} is short of positions`).toHaveLength(n)
      }
    }
  })

  it('puts the policy index inside the swept range', () => {
    expect(sweep.policyIndex).toBeGreaterThanOrEqual(0)
    expect(sweep.policyIndex).toBeLessThan(sweep.lever.positions.length)
  })

  it('starts every world at zero, because position one is the baseline', () => {
    for (const series of sweep.series) {
      for (const w of series.worlds) {
        expect(Math.abs(w.points[0]!.y), `${w.world} does not start at the baseline`).toBeLessThan(0.001)
      }
    }
  })
})
