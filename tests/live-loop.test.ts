/**
 * The live loop: approved actions only, exact clock deltas, observed events off the clock
 * response, and a partial run that still records what it did.
 * OWNER: Oriol. The client is a stub; this never touches a world.
 */

import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Action, ApprovalDecision, Plan, PlannedAction } from '@/contracts/action.ts'
import type { SimClient } from '@/agent/tools.ts'
import {
  LiveLoopAbort,
  runLiveLoop,
  type ClockEvent,
  type ObservedEvent,
} from '@/agent/live-loop.ts'

const T0 = 1_700_000_000_000
const MINUTE = 60_000

interface Stub extends SimClient {
  advances: number[]
  actionPosts: Array<{ path: string; body: unknown; key?: string }>
  now: number
}

/** Clock stub: advances exactly the minutes asked for, and echoes our writes back as events. */
function makeStub(
  options: {
    failClockOnAdvance?: number
    failReadClock?: boolean
    worldEvents?: ClockEvent[]
    /** Events the clock already knows about before the run starts. */
    preRunEvents?: ClockEvent[]
  } = {},
): Stub {
  let seq = 0
  const pending: ClockEvent[] = []

  const stub: Stub = {
    advances: [],
    actionPosts: [],
    now: T0,
    async get<T>(path: string): Promise<T> {
      if (path === '/api/clock') {
        if (options.failReadClock) throw new Error('world unreachable')
        return { now: stub.now, paused: true, speed: 60, events: options.preRunEvents ?? [] } as T
      }
      return { resources: [] } as T
    },
    async post<T>(path: string, body: unknown, key?: string): Promise<T> {
      if (path === '/api/clock') {
        const minutes = (body as { advanceMinutes: number }).advanceMinutes
        if (options.failClockOnAdvance !== undefined && stub.advances.length === options.failClockOnAdvance) {
          throw new Error('clock unreachable')
        }
        stub.advances.push(minutes)
        stub.now += minutes * MINUTE
        // Newest first, as the server returns them.
        const events = [...(options.worldEvents ?? []), ...pending.splice(0)]
          .sort((a, b) => b.time - a.time)
        return { now: stub.now, paused: true, speed: 60, events } as T
      }
      stub.actionPosts.push({ path, body, key })
      const type = (body as { type: string }).type
      pending.push({
        id: `e-${++seq}`,
        time: stub.now,
        type,
        actor: 'team14',
        detail: `${type} accepted`,
      })
      return {
        id: `res-${seq}`,
        kind: 'task',
        title: type,
        status: 'open',
        owner: 'gp',
        visibleTo: ['gp'],
        priority: 'routine',
        createdAt: stub.now,
        data: {},
        version: 1,
      } as T
    },
  }
  return stub
}

function planned(id: string, offsetMinutes: number, action: Action, over: Partial<PlannedAction> = {}): PlannedAction {
  return { id, site: 'gp', action, offsetMinutes, tier: 'requires-approval', rationale: `why ${id}`, ...over }
}

const task = (title: string): Action => ({ type: 'create_task', patientId: 'SIM-000001', title })

function makePlan(actions: PlannedAction[]): Plan {
  return { id: 'plan-1', patientId: 'SIM-000001', rationale: 'keep Amira at home', actions }
}

const approve = (id: string): ApprovalDecision => ({ actionId: id, verdict: 'approve', approvedBy: 'dr.khan', at: 1 })

const noFile = { observedPath: false as const }

// ---------------------------------------------------------------------------

describe('clock deltas', () => {
  it('leads in to the first offset, then advances by the gap to the next action', async () => {
    const client = makeStub()
    const plan = makePlan([
      planned('a1', 15, task('one')),
      planned('a2', 45, task('two')),
      planned('a3', 105, task('three')),
    ])

    const result = await runLiveLoop(client, plan, [approve('a1'), approve('a2'), approve('a3')], {
      ...noFile,
      tailMinutes: 30,
    })

    // 15 lead-in, then 45-15, then 105-45, then the 30-minute tail.
    expect(client.advances).toEqual([15, 30, 60, 30])
    expect(result.startSimTime).toBe(T0)
    expect(result.endSimTime).toBe(T0 + 135 * MINUTE)
    expect(result.applied.map((a) => a.outcome)).toEqual(['applied', 'applied', 'applied'])
  })

  it('still steps the clock at zero, because that response carries our own write back', async () => {
    const client = makeStub()
    const plan = makePlan([planned('a1', 0, task('one'))])

    await runLiveLoop(client, plan, [approve('a1')], noFile)

    expect(client.advances).toEqual([0])
  })

  it('runs actions in offset order whatever order the plan lists them in', async () => {
    const client = makeStub()
    const plan = makePlan([planned('late', 60, task('late')), planned('early', 10, task('early'))])

    await runLiveLoop(client, plan, [approve('late'), approve('early')], noFile)

    expect(client.actionPosts.map((p) => (p.body as { title: string }).title)).toEqual(['early', 'late'])
    expect(client.advances).toEqual([10, 50, 0])
  })
})

describe('the approval gate is the loop door', () => {
  it('writes only what a human approved', async () => {
    const client = makeStub()
    const plan = makePlan([
      planned('a1', 0, task('approved')),
      planned('a2', 10, task('undecided')),
      planned('a3', 20, task('rejected')),
    ])

    const result = await runLiveLoop(
      client,
      plan,
      [approve('a1'), { actionId: 'a3', verdict: 'reject', approvedBy: 'dr.khan', at: 2 }],
      noFile,
    )

    expect(client.actionPosts).toHaveLength(1)
    expect((client.actionPosts[0]?.body as { title: string }).title).toBe('approved')
    expect(result.applied.map((a) => a.plannedActionId)).toEqual(['a1'])
  })

  it('writes nothing at all when no action has a decision', async () => {
    const client = makeStub()
    const plan = makePlan([planned('a1', 0, task('one'))])

    const result = await runLiveLoop(client, plan, [], noFile)

    expect(client.actionPosts).toHaveLength(0)
    expect(result.applied).toHaveLength(0)
  })
})

describe('observed events', () => {
  it('splits our writes from the world, oldest first, timed off the event clock', async () => {
    const world: ClockEvent[] = [
      { id: 'w-1', time: T0 + 5 * MINUTE, type: 'emergency.arrived', actor: 'acute-flow', detail: 'ED arrival' },
    ]
    const client = makeStub({ worldEvents: world })
    const plan = makePlan([planned('a1', 0, task('one'))])

    const result = await runLiveLoop(client, plan, [approve('a1')], { ...noFile, tailMinutes: 30 })

    const ours = result.observed.filter((e) => e.causedByUs)
    const theirs = result.observed.filter((e) => !e.causedByUs)
    expect(ours.map((e) => e.type)).toEqual(['create_task'])
    expect(ours[0]?.sourceActionId).toBe('a1')
    expect(ours[0]?.site).toBe('gp')
    expect(theirs.map((e) => e.type)).toEqual(['emergency.arrived'])
    expect(theirs[0]?.atSimMinutes).toBe(5)
    // Oldest first: the accuracy diff walks it alongside the predicted list.
    expect(result.observed.map((e) => e.id)).toEqual(['e-1', 'w-1'])
  })

  it('does not double-count an event that two windows both report', async () => {
    const repeated: ClockEvent[] = [
      { id: 'w-1', time: T0, type: 'flow.pressure', actor: 'acute-flow', detail: 'busy' },
    ]
    const client = makeStub({ worldEvents: repeated })
    const plan = makePlan([planned('a1', 0, task('one')), planned('a2', 30, task('two'))])

    const result = await runLiveLoop(client, plan, [approve('a1'), approve('a2')], noFile)

    expect(result.observed.filter((e) => e.id === 'w-1')).toHaveLength(1)
  })
})

describe('events from before the run', () => {
  it('ignores a previous rehearsal stamped at exactly the start instant', async () => {
    // The world is paused, so the last events of the previous run carry exactly T0, the same
    // instant our own first write lands at. A timestamp filter cannot separate them; only the
    // ids the clock already reported can. Without this the stale echo is attributed to a1.
    const leftovers: ClockEvent[] = [
      { id: 'old-1', time: T0, type: 'messaging_action', actor: 'team14', detail: 'previous run' },
      { id: 'old-2', time: T0, type: 'clock.changed', actor: 'team14', detail: 'Advanced by 0' },
    ]
    const client = makeStub({ preRunEvents: leftovers, worldEvents: leftovers })
    const plan = makePlan([planned('a1', 0, task('one'))])

    const result = await runLiveLoop(client, plan, [approve('a1')], noFile)

    expect(result.observed.map((e) => e.id)).not.toContain('old-1')
    expect(result.observed.map((e) => e.id)).not.toContain('old-2')
    // Our own write, at the same instant, still survives.
    expect(result.observed.filter((e) => e.causedByUs).map((e) => e.type)).toEqual(['create_task'])
  })

  it('does not count its own clock steps as clinical writes', async () => {
    // clock.changed carries our team as actor. Counting it doubled causedByUs for a six-action
    // plan, which would halve the matched percentage on the accuracy panel.
    const client = makeStub({
      worldEvents: [
        { id: 'c-1', time: T0, type: 'clock.changed', actor: 'team14', detail: 'Advanced by 5' },
      ],
    })
    const plan = makePlan([planned('a1', 0, task('one'))])

    const result = await runLiveLoop(client, plan, [approve('a1')], noFile)

    expect(result.observed.find((e) => e.id === 'c-1')?.causedByUs).toBe(false)
    expect(result.observed.filter((e) => e.causedByUs)).toHaveLength(1)
  })
})

describe('resumability', () => {
  it('skips what a previous run already applied and keeps its record', async () => {
    const client = makeStub()
    const plan = makePlan([planned('a1', 0, task('one')), planned('a2', 30, task('two'))])

    const partial = await runLiveLoop(client, makePlan([plan.actions[0] as PlannedAction]), [approve('a1')], noFile)
    expect(partial.applied).toHaveLength(1)

    const resumed = makeStub()
    const result = await runLiveLoop(resumed, plan, [approve('a1'), approve('a2')], {
      ...noFile,
      resumeFrom: partial,
    })

    expect(resumed.actionPosts).toHaveLength(1)
    expect((resumed.actionPosts[0]?.body as { title: string }).title).toBe('two')
    expect(result.applied.map((a) => a.plannedActionId)).toEqual(['a1', 'a2'])
    // The clock was left at minute 0 by the first run, so the gap to a2 is the full 30.
    expect(resumed.advances).toEqual([30, 0])
  })

  it('survives a failed clock advance and records the observation gap', async () => {
    // The write already landed in the world. Aborting the run because the follow-up
    // observation call failed would discard work we cannot undo, and the sim server is
    // intermittently flaky, so the gap is recorded and the run continues.
    const client = makeStub({ failClockOnAdvance: 0 }) // the advance that follows a1
    const plan = makePlan([planned('a1', 0, task('one')), planned('a2', 30, task('two'))])

    const result = await runLiveLoop(client, plan, [approve('a1'), approve('a2')], noFile)

    expect(result.applied.map((a) => a.plannedActionId)).toEqual(['a1', 'a2'])
    expect(result.applied.every((a) => a.outcome === 'applied')).toBe(true)
    // The stub keeps failing, so every advance is lost. Both writes still land, and every
    // gap is recorded: the accuracy diff must see that observation was incomplete rather
    // than conclude the world did nothing.
    expect(result.observationGaps.map((g) => g.afterActionId)).toEqual(['a1', 'a2'])
    expect(result.observed).toHaveLength(0)
  })

  it('still aborts, with partial state, when the world itself is unreachable', async () => {
    const client = makeStub({ failReadClock: true })
    const plan = makePlan([planned('a1', 0, task('one'))])

    await expect(runLiveLoop(client, plan, [approve('a1')], noFile))
      .rejects.toThrow(LiveLoopAbort)
  })
})

describe('the observed file', () => {
  it('writes the event list where the accuracy diff reads it', async () => {
    const path = join(tmpdir(), `observed.live.${Date.now()}.json`)
    const client = makeStub({
      worldEvents: [{ id: 'w-1', time: T0, type: 'request.arrived', actor: 'patient-demand', detail: 'referral' }],
    })
    const plan = makePlan([planned('a1', 0, task('one'))])

    await runLiveLoop(client, plan, [approve('a1')], { observedPath: path })

    const written = JSON.parse(await readFile(path, 'utf8')) as ObservedEvent[]
    expect(written.map((e) => e.id)).toEqual(['e-1', 'w-1'])
    expect(written[0]).toMatchObject({ type: 'create_task', actor: 'team14', causedByUs: true })
  })
})
