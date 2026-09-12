/**
 * Approved actions POST -> advance clock (POST /api/clock {"advanceMinutes": N}) -> take the
 * event stream straight out of that response -> observed event list -> hand to Kaavya's
 * accuracy diff.
 * OWNER: Oriol. PRD §4.7 steps 6-7.
 *
 * The clock response IS the observation. POST /api/clock returns {now, paused, speed, events[]}
 * with up to 100 entries, newest first, each {id, time, type, actor, detail}. That beats diffing
 * views: ~20KB instead of ~550KB, it already carries timestamps and causes, and the actor tells
 * us whether an event is one of our writes echoed back or something the world did on its own.
 * That split is exactly what the predicted-vs-observed panel needs. Views are re-read only when
 * resource state is genuinely needed, which is the stale-version fallback inside tools.ts.
 *
 * Determinism: the world stays paused while advancing and moves exactly the minutes asked for,
 * so the whole run is reproducible from the plan's offsets alone.
 *
 * Resumability: a run that dies halfway has already recorded every AppliedAction it made and
 * every event it saw. Pass the partial result back as `resumeFrom` and the loop skips what it
 * already applied instead of writing it twice.
 */

import type {
  ActionType,
  ApprovalDecision,
  AppliedAction,
  Plan,
  PlannedAction,
  Site,
} from '../contracts/action.ts'
import { resolveApproved, type ApprovalGateOptions } from './approval.ts'
import { applyPlannedAction, type SimClient, type ToolContext } from './tools.ts'

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/** One entry of the clock response's `events[]`. */
export interface ClockEvent {
  id: string
  /** Epoch ms in sim time. */
  time: number
  /** An action type when it is our write echoed back, else a world event like `emergency.arrived`. */
  type: string
  /** Our team id for our own writes, else a subsystem such as `acute-flow` or `patient-demand`. */
  actor: string
  detail: string
}

export interface ClockResponse {
  now: number
  paused?: boolean
  speed?: number
  events?: ClockEvent[]
}

/**
 * The wire event plus what the loop knows that the server does not: whether we caused it, how
 * far into the plan it happened, and which planned action was in flight at the time.
 */
export interface ObservedEvent extends ClockEvent {
  causedByUs: boolean
  /** Minutes since the loop started, from our own clock deltas. The timing-error axis. */
  atSimMinutes: number
  /** The action whose step produced this window. Attribution, not proof of causation. */
  sourceActionId?: string
  /** Site the in-flight action targeted. */
  site?: Site
}

/** A clock advance whose response we never got. The world moved; we did not see it move. */
export interface ObservationGap {
  afterActionId: string
  minutes: number
  error: string
}

export interface LiveLoopResult {
  applied: AppliedAction[]
  observed: ObservedEvent[]
  startSimTime: number
  endSimTime: number
  /** Empty on a clean run. Non-empty means the observed list has holes in it. */
  observationGaps: ObservationGap[]
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LiveLoopOptions extends ApprovalGateOptions {
  /** Minutes to advance after the final write so scheduled results land. Default 0. */
  tailMinutes?: number
  /** Where the observed list is written. `false` disables writing (tests). */
  observedPath?: string | false
  /** Where the full run report goes. false to skip. */
  runPath?: string | false
  /** A previous partial result. Already-applied actions are skipped, not repeated. */
  resumeFrom?: LiveLoopResult
  /** Our team id, e.g. "team14". Learned from the first echoed write when omitted. */
  teamId?: string
  /** Where coordinator tasks are raised when a 409 cannot be resolved. */
  coordinatorSite?: Site
  newKey?: () => string
  /** Called after each step, so Elsa's execution log can stream rather than wait. */
  onStep?: (step: LiveLoopStep) => void
}

export interface LiveLoopStep {
  planned: PlannedAction
  applied: AppliedAction
  advancedMinutes: number
  elapsedMinutes: number
  observed: ObservedEvent[]
}

/** Thrown only when the run cannot continue. Carries everything recorded up to that point. */
export class LiveLoopAbort extends Error {
  constructor(message: string, readonly partial: LiveLoopResult) {
    super(message)
    this.name = 'LiveLoopAbort'
  }
}

export const DEFAULT_OBSERVED_PATH = 'fixtures/observed.live.json'

/** POST /api/clock caps a single step at one week. */
const MAX_ADVANCE_MINUTES = 10_080

const OUR_EVENT_TYPES: ReadonlySet<string> = new Set<ActionType>([
  'create_task', 'order_test', 'draft_prescription', 'schedule_visit',
  'share_record', 'messaging_action', 'process_document',
])

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export async function readClock(client: SimClient): Promise<ClockResponse> {
  return client.get<ClockResponse>('/api/clock')
}

/**
 * Advance and collect. Sends `paused: true` alongside `advanceMinutes` because stepping a
 * running clock is a 409, and splits anything over a week into successive steps.
 */
export async function advanceClock(client: SimClient, minutes: number): Promise<ClockResponse> {
  const total = Math.max(0, Math.round(minutes))
  let remaining = total
  let last: ClockResponse | undefined
  const events: ClockEvent[] = []

  do {
    const step = Math.min(remaining, MAX_ADVANCE_MINUTES)
    const res = await client.post<ClockResponse>('/api/clock', { paused: true, advanceMinutes: step })
    events.push(...(res.events ?? []))
    last = res
    remaining -= step
  } while (remaining > 0)

  return { ...(last as ClockResponse), events }
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

export async function runLiveLoop(
  client: SimClient,
  plan: Plan,
  decisions: readonly ApprovalDecision[],
  options: LiveLoopOptions = {},
): Promise<LiveLoopResult> {
  const approved = resolveApproved(plan, decisions, options)
    .map((a) => a.planned)
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes)

  const resume = options.resumeFrom
  const done = new Set((resume?.applied ?? []).map((a) => a.plannedActionId))
  const applied: AppliedAction[] = [...(resume?.applied ?? [])]
  const observed: ObservedEvent[] = [...(resume?.observed ?? [])]
  const seenEventIds = new Set(observed.map((e) => e.id))
  // Clock advances we could not read back. The accuracy diff must know the observation is
  // incomplete rather than conclude nothing happened.
  const observationGaps: ObservationGap[] = [...(resume?.observationGaps ?? [])]

  // A resumed run assumes the clock is where the previous run left it: at the offset of the
  // last action it applied.
  let elapsedMinutes = approved
    .filter((p) => done.has(p.id))
    .reduce((max, p) => Math.max(max, p.offsetMinutes), 0)

  let teamId = options.teamId
  let simTime = resume?.startSimTime ?? 0
  let startSimTime = resume?.startSimTime ?? 0
  let endSimTime = resume?.endSimTime ?? 0

  const ctx: ToolContext = {
    client,
    simTime: () => simTime,
    coordinatorSite: options.coordinatorSite,
    newKey: options.newKey,
    versions: new Map<string, number>(),
  }

  const result = (): LiveLoopResult => ({ applied, observed, startSimTime, endSimTime, observationGaps })

  const absorb = (res: ClockResponse, planned: PlannedAction | undefined): ObservedEvent[] => {
    if (typeof res.now === 'number') {
      simTime = res.now
      endSimTime = res.now
    }
    const fresh: ObservedEvent[] = []
    // Newest-first on the wire; the observed list reads oldest-first, like the predicted list.
    for (const event of [...(res.events ?? [])].reverse()) {
      if (seenEventIds.has(event.id)) continue // windows overlap between advances
      // The first clock read returns the last ~100 events, most of which predate this run.
      // Attributing those to the action we just sent would overstate what we caused, which is
      // exactly the number the accuracy diff is measuring. History is not an observation.
      if (startSimTime > 0 && typeof event.time === 'number' && event.time < startSimTime) continue
      seenEventIds.add(event.id)
      const ours = OUR_EVENT_TYPES.has(event.type)
      if (ours && !teamId) teamId = event.actor // learn the team id from our own echo
      // `clock.changed` carries our team as its actor, but it is the loop stepping the clock,
      // not a clinical write. Counting it doubled `causedByUs` for a six-action plan, which
      // would halve the matched percentage on the accuracy panel.
      const isClockStep = event.type === 'clock.changed'
      const observedEvent: ObservedEvent = {
        ...event,
        causedByUs: !isClockStep && (ours || (teamId !== undefined && event.actor === teamId)),
        // Prefer the event's own timestamp: a window covers many minutes and the timing error
        // Kaavya measures is per event, not per step. `elapsedMinutes` is the fallback.
        atSimMinutes: typeof event.time === 'number' && startSimTime > 0
          ? Math.round((event.time - startSimTime) / 60_000)
          : elapsedMinutes,
      }
      if (planned) {
        observedEvent.sourceActionId = planned.id
        observedEvent.site = planned.site
      }
      fresh.push(observedEvent)
    }
    observed.push(...fresh)
    return fresh
  }

  try {
    if (!resume) {
      const clock = await readClock(client)
      startSimTime = typeof clock.now === 'number' ? clock.now : 0
      simTime = startSimTime
      endSimTime = startSimTime
      // Everything the clock already knows about happened BEFORE this run. The world is paused,
      // so the previous rehearsal's last events carry exactly this timestamp and a timestamp
      // filter alone cannot separate them from our first write, which lands at the same instant.
      // Recording their ids is the only reliable discriminator.
      for (const event of clock.events ?? []) seenEventIds.add(event.id)
    }

    const pending = approved.filter((p) => !done.has(p.id))

    // Lead-in: the first action is planned for its own offset, not for minute zero.
    const first = pending[0]
    if (first && first.offsetMinutes > elapsedMinutes) {
      const lead = first.offsetMinutes - elapsedMinutes
      elapsedMinutes += lead
      absorb(await advanceClock(client, lead), undefined)
    }

    for (let i = 0; i < pending.length; i++) {
      const planned = pending[i]
      if (!planned) continue

      let step: AppliedAction
      try {
        step = await applyPlannedAction(ctx, planned)
      } catch (err) {
        // A planner bug (wrong type for the tool) must not lose the rest of the run.
        step = {
          plannedActionId: planned.id,
          outcome: 'failed',
          error: err instanceof Error ? err.message : String(err),
          simTime,
        }
      }
      applied.push(step)

      const next = pending[i + 1]
      const target = next ? next.offsetMinutes : planned.offsetMinutes + (options.tailMinutes ?? 0)
      const delta = Math.max(0, target - elapsedMinutes)
      elapsedMinutes += delta

      // Posted even when delta is 0: the clock response is the only place our own write is
      // echoed back, so skipping it would lose the observation.
      //
      // A failure here is NOT fatal. The write already landed in the world; losing the whole
      // run because the observation call was slow would throw away work we cannot undo. The
      // sim server is intermittently flaky, so we record the gap and keep going.
      let fresh: ObservedEvent[] = []
      try {
        fresh = absorb(await advanceClock(client, delta), planned)
      } catch (err) {
        observationGaps.push({
          afterActionId: planned.id,
          minutes: delta,
          error: err instanceof Error ? err.message : String(err),
        })
      }

      options.onStep?.({ planned, applied: step, advancedMinutes: delta, elapsedMinutes, observed: fresh })
    }

    return result()
  } catch (err) {
    throw new LiveLoopAbort(
      `Live loop stopped after ${applied.length} of ${approved.length} actions: ${err instanceof Error ? err.message : String(err)}`,
      result(),
    )
  } finally {
    // Runs on the abort path too: the world is never left changed without a record of it.
    const finished = result()
    // A run that died before it saw anything has nothing to hand over. Writing an empty list
    // would destroy the previous rehearsal's handoff, which may be the only one we have if the
    // server is down at demo time.
    if (finished.observed.length > 0 || finished.applied.length > 0) {
      await writeObserved(options.observedPath ?? DEFAULT_OBSERVED_PATH, finished)
    }
    // Never blanks an existing handoff: a run that dies before it applies anything has nothing
    // to say, and overwriting the previous rehearsal's report with an empty one loses evidence.
    // OPT-IN, deliberately. A default path here means every test that runs the loop overwrites
    // the real handoff with stub data, and the accuracy diff gets built on fiction. Only the
    // CLI, which knows it is doing a real run, asks for the report.
    if (options.runPath && (finished.applied.length > 0 || finished.observationGaps.length > 0)) {
      await writeRunReport(options.runPath, finished)
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Dynamic import so the module stays importable from the browser bundle Elsa builds. */
/**
 * Sibling of the observed file carrying the WHOLE run: what was applied, which fallbacks fired,
 * and which windows we never saw. A gap that exists only in memory tells the accuracy diff the
 * world did nothing, which is the exact conclusion the gap type exists to prevent.
 */
export const DEFAULT_RUN_PATH = 'fixtures/run.live.json'

export async function writeRunReport(path: string | false, result: LiveLoopResult): Promise<void> {
  if (path === false) return
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, JSON.stringify(result, null, 2))
}

export async function writeObserved(path: string | false, result: LiveLoopResult): Promise<void> {
  if (path === false) return
  try {
    const { writeFile, mkdir } = await import('node:fs/promises')
    const dir = path.replace(/\/[^/]*$/, '')
    if (dir && dir !== path) await mkdir(dir, { recursive: true })
    await writeFile(path, `${JSON.stringify(result.observed, null, 2)}\n`, 'utf8')
  } catch (err) {
    // Losing the file must not lose the run: the caller still gets the in-memory result.
    console.warn(`Could not write ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
