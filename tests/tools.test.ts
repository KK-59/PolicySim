/**
 * Tool wrappers: idempotency keys, expectedVersion, and every 409 fallback.
 * OWNER: Oriol.
 *
 * The client is a stub. These tests must never reach the live server: the whole point of the
 * fallback logic is that it behaves the same whether or not a world is up.
 */

import { describe, expect, it } from 'vitest'
import { ConflictError, ApiError } from '@/integration/nhssim-client.ts'
import type { Action, ActionResult, PlannedAction } from '@/contracts/action.ts'
import {
  applyPlannedAction,
  classifyConflict,
  createTaskTool,
  nextSlot,
  processDocumentTool,
  scheduleVisitTool,
  type SimClient,
  type ToolContext,
} from '@/agent/tools.ts'

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

interface PostCall { path: string; body: unknown; key?: string }

interface Stub extends SimClient {
  posts: PostCall[]
  gets: string[]
}

function makeResult(over: Partial<ActionResult> = {}): ActionResult {
  return {
    id: 'res-1',
    kind: 'task',
    title: 'Task',
    status: 'open',
    owner: 'gp',
    visibleTo: ['gp'],
    priority: 'routine',
    createdAt: 1_700_000_000_000,
    data: {},
    version: 1,
    ...over,
  }
}

function makeStub(
  handlers: {
    post?: (call: PostCall, index: number) => unknown
    get?: (path: string) => unknown
  } = {},
): Stub {
  const stub: Stub = {
    posts: [],
    gets: [],
    async post<T>(path: string, body: unknown, key?: string): Promise<T> {
      const call = { path, body, key }
      stub.posts.push(call)
      const handled = handlers.post?.(call, stub.posts.length - 1)
      return (handled ?? makeResult()) as T
    },
    async get<T>(path: string): Promise<T> {
      stub.gets.push(path)
      return (handlers.get?.(path) ?? { resources: [] }) as T
    },
  }
  return stub
}

function ctxFor(client: SimClient, over: Partial<ToolContext> = {}): ToolContext {
  let n = 0
  return {
    client,
    simTime: () => 1_700_000_000_000,
    newKey: () => `key-${++n}`,
    versions: new Map<string, number>(),
    ...over,
  }
}

function plan(action: Action, over: Partial<PlannedAction> = {}): PlannedAction {
  return {
    id: 'pa-1',
    site: 'gp',
    action,
    offsetMinutes: 0,
    tier: 'requires-approval',
    rationale: 'because the test says so',
    ...over,
  }
}

const conflict = (message: string, code = 'conflict') => new ConflictError(code, message, '/api/sites/gp/actions')

// ---------------------------------------------------------------------------

describe('classifyConflict', () => {
  it('separates the three live 409 messages', () => {
    expect(classifyConflict(conflict('Stale resource version'))).toBe('stale-version')
    expect(classifyConflict(conflict('Idempotency key reused with different action'))).toBe('idempotency-reuse')
    expect(classifyConflict(conflict('An unreviewed letter and review note are required'))).toBe('invalid-transition')
    expect(classifyConflict(conflict('Use the document workflow to process this letter'))).toBe('invalid-transition')
  })
})

describe('the happy path', () => {
  it('posts a flat body with an Idempotency-Key and reports applied', async () => {
    const client = makeStub()
    const applied = await createTaskTool(ctxFor(client), plan({ type: 'create_task', patientId: 'SIM-000001' }))

    expect(applied.outcome).toBe('applied')
    expect(applied.fallback).toBeUndefined()
    expect(client.posts).toHaveLength(1)
    expect(client.posts[0]?.path).toBe('/api/sites/gp/actions')
    expect(client.posts[0]?.key).toBe('key-1')
    expect(client.posts[0]?.body).toEqual({ type: 'create_task', patientId: 'SIM-000001' })
  })
})

describe('409 fallbacks', () => {
  it('re-reads, takes the new version and retries once under a NEW key', async () => {
    const client = makeStub({
      post: (call, i) => {
        if (i === 0) throw conflict('Stale resource version')
        return makeResult({ id: 'document-batch-2-001', kind: 'document', version: 8 })
      },
      get: () => ({ resources: [{ id: 'document-batch-2-001', version: 7 }] }),
    })

    const applied = await processDocumentTool(
      ctxFor(client),
      plan({
        type: 'process_document',
        patientId: 'SIM-000001',
        resourceId: 'document-batch-2-001',
        expectedVersion: 3,
        documentCommand: 'file',
      }),
    )

    expect(applied.outcome).toBe('applied')
    expect(applied.fallback).toEqual({ kind: 'reread-retry', reason: 'Stale resource version', attempts: 2 })
    expect(client.gets[0]).toBe('/api/sites/gp/view')
    expect(client.posts).toHaveLength(2)
    expect(client.posts[1]?.body).toMatchObject({ expectedVersion: 7 })
    // A changed body under the original key is the one thing the server hard-rejects.
    expect(client.posts[1]?.key).not.toBe(client.posts[0]?.key)
  })

  it('falls back to the next slot when a visit conflicts', async () => {
    const client = makeStub({
      post: (_call, i) => {
        if (i === 0) throw conflict('No capacity in that slot')
        return makeResult({ kind: 'visit', owner: 'community' })
      },
    })

    const startsAt = 1_700_000_000_000
    const applied = await scheduleVisitTool(
      ctxFor(client),
      plan(
        {
          type: 'schedule_visit',
          patientId: 'SIM-000001',
          startsAt,
          endsAt: startsAt + 1_800_000,
          durationMinutes: 30,
        },
        { site: 'community' },
      ),
    )

    expect(applied.outcome).toBe('applied')
    expect(applied.fallback?.kind).toBe('next-slot')
    expect(applied.fallback?.attempts).toBe(2)
    expect(client.posts[1]?.body).toMatchObject({ startsAt: startsAt + 1_800_000, endsAt: startsAt + 3_600_000 })
  })

  it('raises a coordinator task when nothing can be retried, and records it', async () => {
    const client = makeStub({
      post: (_call, i) => {
        if (i === 0) throw conflict('An unreviewed letter and review note are required')
        return makeResult({ id: 'task-99' })
      },
    })

    const applied = await applyPlannedAction(
      ctxFor(client),
      plan({ type: 'order_test', patientId: 'SIM-000001' }),
    )

    // The clinical action did not land, so it is not 'applied' — but the escalation is recorded.
    expect(applied.outcome).toBe('failed')
    expect(applied.fallback?.kind).toBe('coordinator-task')
    expect(applied.result?.id).toBe('task-99')
    expect(client.posts[1]?.body).toMatchObject({ type: 'create_task', patientId: 'SIM-000001' })
  })

  it("records 'abandoned' when the fallback itself fails", async () => {
    const client = makeStub({
      post: (_call, i) => {
        if (i === 0) throw conflict('An unreviewed letter and review note are required')
        throw new ApiError(500, 'server_error', 'nope', '/api/sites/gp/actions')
      },
    })

    const applied = await applyPlannedAction(
      ctxFor(client),
      plan({ type: 'draft_prescription', patientId: 'SIM-000001' }),
    )

    expect(applied.outcome).toBe('failed')
    expect(applied.fallback?.kind).toBe('abandoned')
    expect(applied.fallback?.reason).toContain('coordinator task also failed')
  })

  it("records 'abandoned' when the re-read retry conflicts again", async () => {
    const client = makeStub({
      post: () => {
        throw conflict('Stale resource version')
      },
      get: () => ({ resources: [{ id: 'document-batch-2-001', version: 9 }] }),
    })

    const applied = await processDocumentTool(
      ctxFor(client),
      plan({
        type: 'process_document',
        patientId: 'SIM-000001',
        resourceId: 'document-batch-2-001',
        expectedVersion: 1,
        documentCommand: 'review',
      }),
    )

    expect(applied.fallback?.kind).toBe('abandoned')
    expect(applied.fallback?.reason).toContain('reread-retry retry failed')
    expect(client.posts).toHaveLength(2)
  })

  it('never retries a reused idempotency key, and surfaces it as our bug', async () => {
    const client = makeStub({
      post: () => {
        throw conflict('Idempotency key reused with different action')
      },
    })

    const applied = await createTaskTool(ctxFor(client), plan({ type: 'create_task', patientId: 'SIM-000001' }))

    expect(applied.outcome).toBe('failed')
    expect(applied.fallback).toBeUndefined()
    expect(applied.error).toContain('idempotency-key-reuse')
    expect(client.posts).toHaveLength(1)
  })

  it('falls back to the counters block when the resource is not in the view', async () => {
    const client = makeStub({
      post: (_call, i) => (i === 0 ? (() => { throw conflict('Stale resource version') })() : makeResult()),
      get: () => ({ resources: [], counters: { documentVersion: 12 } }),
    })

    const applied = await processDocumentTool(
      ctxFor(client),
      plan({
        type: 'process_document',
        patientId: 'SIM-000001',
        resourceId: 'document-batch-2-001',
        expectedVersion: 2,
        documentCommand: 'file',
      }),
    )

    expect(applied.fallback?.kind).toBe('reread-retry')
    expect(client.posts[1]?.body).toMatchObject({ expectedVersion: 12 })
  })
})

describe('the version ledger', () => {
  it('carries the version returned by one document stage into the next', async () => {
    const client = makeStub({ post: (_c, i) => makeResult({ id: 'document-batch-2-001', version: 5 + i }) })
    const ctx = ctxFor(client)

    const stage = (command: 'assign' | 'review'): PlannedAction =>
      plan(
        {
          type: 'process_document',
          patientId: 'SIM-000001',
          resourceId: 'document-batch-2-001',
          expectedVersion: 4, // what the plan was authored with, stale by the second stage
          documentCommand: command,
        },
        { id: `pa-${command}` },
      )

    await processDocumentTool(ctx, stage('assign'))
    await processDocumentTool(ctx, stage('review'))

    expect(client.posts[0]?.body).toMatchObject({ expectedVersion: 4 })
    expect(client.posts[1]?.body).toMatchObject({ expectedVersion: 5 })
    expect(client.gets).toHaveLength(0) // no extra read needed
  })
})

describe('nextSlot', () => {
  it('shifts by the visit duration and leaves an unscheduled visit alone', () => {
    expect(nextSlot({ type: 'schedule_visit', patientId: 'SIM-000001', startsAt: 1_000, durationMinutes: 20 }))
      .toMatchObject({ startsAt: 1_000 + 20 * 60_000 })
    expect(nextSlot({ type: 'schedule_visit', patientId: 'SIM-000001' })).toBeUndefined()
  })
})

describe('type safety', () => {
  it('refuses to run a tool against the wrong action type', () => {
    // Thrown synchronously, before any network call: a mis-dispatched tool is a planner bug and
    // the loop catches it per action rather than writing something nobody reviewed.
    expect(() => createTaskTool(ctxFor(makeStub()), plan({ type: 'order_test', patientId: 'SIM-000001' })))
      .toThrow(TypeError)
  })
})
