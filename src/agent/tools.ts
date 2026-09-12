/**
 * ADK tool wrappers, one per action type: create_task, order_test, draft_prescription,
 * schedule_visit, share_record, messaging_action, process_document.
 * OWNER: Oriol. PRD §4.7 step 6, §8.2 step 5.
 *
 * Deterministic on purpose: no model call happens in this file. The LLM proposes a Plan and a
 * clinician approves it; by the time an action reaches here the only decisions left are
 * mechanical (fresh idempotency key, current expectedVersion, what to do with a 409).
 *
 * Every write carries a fresh `Idempotency-Key`. A retry after a conflict changes the body
 * (new version, later slot), so it MUST carry a new key too: reusing the key with a changed
 * body is exactly what the server rejects with "Idempotency key reused with different action".
 *
 * Every 409 fallback is recorded in `AppliedAction.fallback`. The presence of that field is the
 * proof the fallback fired, which is the thing the demo clip has to show. Nothing is swallowed.
 *
 * The three live 409 messages and their fallbacks are in docs/nhssim-verified.md. Two notes that
 * shape the code below:
 *   - `process_document` is stateful (sent -> assign -> review -> file) and each stage bumps the
 *     resource version, so stage N+1 needs the version stage N returned, not the one the plan was
 *     authored with. `ToolContext.versions` carries that forward.
 *   - The server wants `clinician` on `assign` and `text` on `review`, which the frozen Action
 *     contract does not name. Extra fields on the action object are passed through to the wire
 *     untouched, so a plan can carry them today; adding them to the contract needs group sign-off.
 */

import {
  ApiError,
  ConflictError,
  newIdempotencyKey,
} from '../integration/nhssim-client.ts'
import type {
  Action,
  ActionResult,
  ActionType,
  AppliedAction,
  CreateTaskAction,
  FallbackKind,
  PlannedAction,
  ScheduleVisitAction,
  Site,
} from '../contracts/action.ts'

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * The slice of NhsSimClient the agent uses. Structural on purpose: tests pass a stub and never
 * touch the network, and nothing here can reach fetch() by accident.
 */
export interface SimClient {
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>
  post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T>
}

export interface ToolContext {
  client: SimClient
  /** Sim-clock reading stamped on each AppliedAction. The live loop owns the clock, so it supplies this. */
  simTime: () => number
  /** Where a coordinator task is raised. Defaults to the site the conflicting action targeted. */
  coordinatorSite?: Site
  /** Injectable so tests can assert that each attempt used a different key. */
  newKey?: () => string
  /**
   * resourceId -> latest version this run has seen. process_document is stateful
   * (sent -> assign -> review -> file) and every stage bumps the version, so an
   * expectedVersion authored when the plan was written is stale by the second stage.
   * Keeping the ledger here means the second stage costs no extra GET.
   */
  versions?: Map<string, number>
}

export type ToolFn = (ctx: ToolContext, planned: PlannedAction) => Promise<AppliedAction>

// ---------------------------------------------------------------------------
// View reads — used to refresh a stale expectedVersion, and by the live loop's diff
// ---------------------------------------------------------------------------

export interface ViewResource {
  id: string
  kind?: string
  title?: string
  status?: string
  owner?: string
  patientId?: string
  version?: number
  createdAt?: number
  updatedAt?: number
  data?: Record<string, unknown>
}

/**
 * GET /api/sites/{site}/view -> {id, now, speed, paused, population, counters{}, resources[]}.
 * `counters` is where the server publishes the version numbers that feed `expectedVersion`
 * (documentVersion, pharmacyVersion, bloodPatient:SIM-000001, ...).
 */
export interface ViewPayload {
  id?: string
  now?: number
  speed?: number
  paused?: boolean
  population?: number
  resources?: ViewResource[]
  counters?: Record<string, number>
  resourceTotal?: number
  resourceOffset?: number
  resourceLimit?: number
}

export function readView(client: SimClient, site: Site, patientId?: string): Promise<ViewPayload> {
  return client.get<ViewPayload>(`/api/sites/${site}/view`, patientId ? { patient: patientId } : undefined)
}

/**
 * The version the server currently holds for one resource. The view is the only bulk read that
 * exposes it, so a stale-version fallback costs one extra GET rather than a per-resource probe.
 * Resources win over counters: a counter is a site-wide number and can lag a specific record.
 */
export async function readResourceVersion(
  client: SimClient,
  site: Site,
  patientId: string,
  resourceId: string,
  counterKey?: string,
): Promise<number | undefined> {
  const view = await readView(client, site, patientId)
  const match = (view.resources ?? []).find((r) => r.id === resourceId)
  if (typeof match?.version === 'number') return match.version
  const counters = view.counters ?? {}
  for (const key of [resourceId, counterKey]) {
    if (key !== undefined && typeof counters[key] === 'number') return counters[key]
  }
  return undefined
}

/** Counter that carries a type's version when the resource itself is not in the view payload. */
const COUNTER_KEY: Partial<Record<ActionType, string>> = {
  process_document: 'documentVersion',
  draft_prescription: 'pharmacyVersion',
  schedule_visit: 'appointmentSessionVersion',
}

// ---------------------------------------------------------------------------
// Conflict classification
// ---------------------------------------------------------------------------

/**
 * A 409 means one of four different things and the right fallback differs for each, so the
 * message is classified once, here, instead of at every call site.
 */
export type ConflictClass =
  | 'idempotency-reuse'
  | 'stale-version'
  | 'slot-conflict'
  | 'invalid-transition'
  | 'unknown'

/**
 * Verified live messages (docs/nhssim-verified.md):
 *   "Stale resource version"                              -> stale-version
 *   "Idempotency key reused with different action"        -> idempotency-reuse
 *   "An unreviewed letter and review note are required"   -> invalid-transition
 *   "Use the document workflow to process this letter"    -> invalid-transition
 * Anything else is 'unknown' and escalates rather than guessing at a retry.
 */
export function classifyConflict(err: ConflictError): ConflictClass {
  const text = `${err.code} ${err.message}`.toLowerCase()
  if (text.includes('idempotency')) return 'idempotency-reuse'
  if (text.includes('version') || text.includes('stale')) return 'stale-version'
  if (/letter|unreviewed|review note|document workflow|transition|state/.test(text)) {
    return 'invalid-transition'
  }
  if (/slot|capacity|booked|availability|overlap|full/.test(text)) return 'slot-conflict'
  return 'unknown'
}

/** A reused key with a changed body is our bug, not the world's. Never retried, always surfaced. */
export function isIdempotencyReuse(err: unknown): boolean {
  return err instanceof ConflictError && classifyConflict(err) === 'idempotency-reuse'
}

// ---------------------------------------------------------------------------
// Fallback plans
// ---------------------------------------------------------------------------

/** What the per-type resolver decided to do about a 409. `undefined` action means escalate to a human. */
type ConflictPlan =
  | { kind: 'reread-retry'; action: Action }
  | { kind: 'next-slot'; action: Action }
  | { kind: 'coordinator-task' }

type ConflictResolver = (
  ctx: ToolContext,
  planned: PlannedAction,
  err: ConflictError,
  cls: ConflictClass,
) => Promise<ConflictPlan>

const DEFAULT_SLOT_MINUTES = 30

/**
 * Shift a visit by one slot. Times are epoch milliseconds on the wire (same scale as
 * `createdAt`), so the shift is in ms even though the plan talks in minutes.
 */
export function nextSlot(action: ScheduleVisitAction): ScheduleVisitAction | undefined {
  if (typeof action.startsAt !== 'number') return undefined
  const shiftMs = (action.durationMinutes ?? DEFAULT_SLOT_MINUTES) * 60_000
  const shifted: ScheduleVisitAction = { ...action, startsAt: action.startsAt + shiftMs }
  if (typeof action.endsAt === 'number') shifted.endsAt = action.endsAt + shiftMs
  return shifted
}

/** The human escalation. Carries the original conflict text so the coordinator sees why. */
export function coordinatorTaskFor(planned: PlannedAction, reason: string): CreateTaskAction {
  return {
    type: 'create_task',
    patientId: planned.action.patientId,
    title: `Coordinator review: ${planned.action.type} conflicted`,
    text: `Planned action ${planned.id} (${planned.action.type}) could not be applied: ${reason}. Rationale: ${planned.rationale}`,
  }
}

// ---------------------------------------------------------------------------
// The write path, shared by all seven tools
// ---------------------------------------------------------------------------

function describeError(err: unknown): string {
  if (err instanceof ApiError) return `${err.status} ${err.code}: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

function postAction(ctx: ToolContext, site: Site, action: Action, key: string): Promise<ActionResult> {
  return ctx.client.post<ActionResult>(`/api/sites/${site}/actions`, action, key)
}

function recordFallback(kind: FallbackKind, reason: string, attempts: number): AppliedAction['fallback'] {
  return { kind, reason, attempts }
}

/**
 * One attempt, then at most one fallback attempt. The second attempt always gets its own key
 * because its body differs from the first; retrying a changed body under the original key is
 * the one thing the server treats as a hard conflict.
 */
async function execute(
  ctx: ToolContext,
  planned: PlannedAction,
  action: Action,
  resolve: ConflictResolver,
): Promise<AppliedAction> {
  const simTime = ctx.simTime()
  const mint = ctx.newKey ?? newIdempotencyKey
  const site = planned.site

  const effective = withLedgerVersion(action, ctx.versions)

  let conflict: ConflictError
  try {
    const result = await postAction(ctx, site, effective, mint())
    rememberVersion(ctx, result)
    return { plannedActionId: planned.id, outcome: 'applied', result, simTime }
  } catch (err) {
    if (!(err instanceof ConflictError)) {
      return { plannedActionId: planned.id, outcome: 'failed', error: describeError(err), simTime }
    }
    conflict = err
  }

  const cls = classifyConflict(conflict)
  if (cls === 'idempotency-reuse') {
    // Retrying under the same key would either duplicate a clinical action or loop forever.
    return {
      plannedActionId: planned.id,
      outcome: 'failed',
      error: `idempotency-key-reuse (agent bug, not a world conflict): ${conflict.message}`,
      simTime,
    }
  }

  let plan: ConflictPlan
  try {
    plan = await resolve(ctx, planned, conflict, cls)
  } catch (resolveErr) {
    return {
      plannedActionId: planned.id,
      outcome: 'failed',
      fallback: recordFallback('abandoned', `${conflict.message}; fallback could not be built: ${describeError(resolveErr)}`, 1),
      error: describeError(conflict),
      simTime,
    }
  }

  if (plan.kind === 'coordinator-task') {
    const coordinatorSite = ctx.coordinatorSite ?? site
    try {
      const result = await postAction(ctx, coordinatorSite, coordinatorTaskFor(planned, conflict.message), mint())
      // The clinical action did NOT land, so the outcome stays 'failed'; `result` is the human
      // task that replaced it, which is what the execution log links to.
      return {
        plannedActionId: planned.id,
        outcome: 'failed',
        result,
        fallback: recordFallback('coordinator-task', conflict.message, 2),
        error: describeError(conflict),
        simTime,
      }
    } catch (taskErr) {
      return {
        plannedActionId: planned.id,
        outcome: 'failed',
        fallback: recordFallback('abandoned', `${conflict.message}; coordinator task also failed: ${describeError(taskErr)}`, 2),
        error: describeError(conflict),
        simTime,
      }
    }
  }

  try {
    const result = await postAction(ctx, site, plan.action, mint())
    rememberVersion(ctx, result)
    return {
      plannedActionId: planned.id,
      outcome: 'applied',
      result,
      fallback: recordFallback(plan.kind, conflict.message, 2),
      simTime,
    }
  } catch (retryErr) {
    return {
      plannedActionId: planned.id,
      outcome: 'failed',
      fallback: recordFallback('abandoned', `${conflict.message}; ${plan.kind} retry failed: ${describeError(retryErr)}`, 2),
      error: describeError(retryErr),
      simTime,
    }
  }
}

function expectType<T extends ActionType>(planned: PlannedAction, type: T): Extract<Action, { type: T }> {
  if (planned.action.type !== type) {
    throw new TypeError(`Tool for ${type} was handed ${planned.action.type} (planned action ${planned.id})`)
  }
  return planned.action as Extract<Action, { type: T }>
}

/** Types with no version and no slot have nothing to retry: a human decides. */
const escalate: ConflictResolver = async () => ({ kind: 'coordinator-task' })

/**
 * Re-read the resource, take the server's version, retry once.
 * An invalid-transition 409 ("An unreviewed letter and review note are required") deliberately
 * does NOT auto-advance the workflow: assigning a clinician or writing a review note is a
 * clinical act that nobody approved, so it goes to a human instead.
 */
function rereadResolver(resourceId: string, counterKey?: string): ConflictResolver {
  return async (ctx, planned, _err, cls) => {
    if (cls !== 'stale-version' && cls !== 'unknown') return { kind: 'coordinator-task' }
    const version = await readResourceVersion(
      ctx.client,
      planned.site,
      planned.action.patientId,
      resourceId,
      counterKey,
    )
    if (version === undefined) return { kind: 'coordinator-task' }
    return { kind: 'reread-retry', action: { ...planned.action, expectedVersion: version } as Action }
  }
}

/** resourceId of the types that address an existing record. */
function resourceIdOf(action: Action): string | undefined {
  return 'resourceId' in action ? action.resourceId : undefined
}

/** Prefer a version this run already saw over the one the plan was authored with. */
function withLedgerVersion(action: Action, versions?: Map<string, number>): Action {
  if (!versions || !('expectedVersion' in action)) return action
  const id = resourceIdOf(action)
  if (id === undefined) return action
  const known = versions.get(id)
  if (known === undefined || known === action.expectedVersion) return action
  return { ...action, expectedVersion: known } as Action
}

function rememberVersion(ctx: ToolContext, result: ActionResult): void {
  if (ctx.versions && typeof result.version === 'number') ctx.versions.set(result.id, result.version)
}

// ---------------------------------------------------------------------------
// The seven tools
// ---------------------------------------------------------------------------

export const createTaskTool: ToolFn = (ctx, planned) =>
  execute(ctx, planned, expectType(planned, 'create_task'), escalate)

export const orderTestTool: ToolFn = (ctx, planned) =>
  execute(ctx, planned, expectType(planned, 'order_test'), escalate)

export const draftPrescriptionTool: ToolFn = (ctx, planned) =>
  execute(ctx, planned, expectType(planned, 'draft_prescription'), escalate)

export const scheduleVisitTool: ToolFn = (ctx, planned) => {
  const action = expectType(planned, 'schedule_visit')
  return execute(ctx, planned, action, async () => {
    // Capacity conflicts are the expected 409 here, and the clinical answer is the next slot.
    // With no startsAt there is no slot to move, so it goes to a human instead.
    const shifted = nextSlot(action)
    return shifted ? { kind: 'next-slot', action: shifted } : { kind: 'coordinator-task' }
  })
}

export const shareRecordTool: ToolFn = (ctx, planned) => {
  const action = expectType(planned, 'share_record')
  // share_record against a discharge summary 409s with "Use the document workflow to process
  // this letter", which classifies as invalid-transition and escalates rather than retrying.
  return execute(ctx, planned, action, rereadResolver(action.resourceId))
}

export const messagingActionTool: ToolFn = (ctx, planned) => {
  const action = expectType(planned, 'messaging_action')
  // The server wants an existing conversation (GET /api/sites/gp/messaging-workspace); without a
  // resourceId there is nothing to re-read, so a conflict can only go to a human.
  return execute(ctx, planned, action, action.resourceId ? rereadResolver(action.resourceId) : escalate)
}

export const processDocumentTool: ToolFn = (ctx, planned) => {
  const action = expectType(planned, 'process_document')
  return execute(ctx, planned, action, rereadResolver(action.resourceId, COUNTER_KEY.process_document))
}

export const TOOLS: Record<ActionType, ToolFn> = {
  create_task: createTaskTool,
  order_test: orderTestTool,
  draft_prescription: draftPrescriptionTool,
  schedule_visit: scheduleVisitTool,
  share_record: shareRecordTool,
  messaging_action: messagingActionTool,
  process_document: processDocumentTool,
}

/** Dispatch on `type`. The live loop calls only this. */
export function applyPlannedAction(ctx: ToolContext, planned: PlannedAction): Promise<AppliedAction> {
  return TOOLS[planned.action.type](ctx, planned)
}
