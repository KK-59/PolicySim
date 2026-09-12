/**
 * Approval pause/resume. Clinician approves / edits / rejects PER ACTION.
 * Tiers: reads free; create_task + messaging_action low-risk; order_test, draft_prescription,
 * process_document file, schedule_visit ALWAYS require approval.
 * Red flags bypass the agent entirely to a human task, by rule.
 * OWNER: Oriol, matrix from Albert.
 *
 * The gate is a small state machine Elsa's screen drives: `pending()` renders, `submitDecision()`
 * records one verdict, `getApproved()` hands the live loop exactly what a human said yes to.
 *
 * Two rules make this a gate rather than a formality:
 *   1. There is no blanket approve-all. An action with no decision is simply not returned by
 *      `getApproved()`, so the loop cannot write it.
 *   2. Auto-approval is opt-in (`autoApproveLowRisk`, default false) AND capped by type: only
 *      create_task and messaging_action can ever be auto-approved, whatever tier the plan claims.
 *      A mis-tiered prescription therefore still needs a human, which is the failure mode worth
 *      defending against.
 */

import type {
  Action,
  ActionType,
  ApprovalDecision,
  ApprovalVerdict,
  BloodPanelId,
  DocumentCommand,
  Plan,
  PlannedAction,
  Site,
} from '../contracts/action.ts'

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApprovalError'
  }
}

// ---------------------------------------------------------------------------
// Validation — an edited action is re-checked against the contract before it can be sent
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean
  /** Contract violations. A non-empty list blocks the write. */
  errors: string[]
  /** Live-server requirements the frozen contract does not encode. Shown, not blocking. */
  warnings: string[]
}

const SITES: readonly Site[] = [
  'control', 'gp', 'hospital', 'community',
  'pharmacy', 'diagnostics', 'referrals', 'wearables', 'legacy',
]

const ACTION_TYPES: readonly ActionType[] = [
  'create_task', 'order_test', 'draft_prescription', 'schedule_visit',
  'share_record', 'messaging_action', 'process_document',
]

const PANEL_IDS: readonly BloodPanelId[] = ['fbc', 'ue', 'hba1c', 'lft', 'crp', 'lipids']
const DOCUMENT_COMMANDS: readonly DocumentCommand[] = ['send', 'assign', 'review', 'file', 'annotate']
const MESSAGING_KINDS = ['create', 'send', 'reply', 'note', 'assign', 'complete', 'reopen'] as const

type Bag = Record<string, unknown>

function isBag(v: unknown): v is Bag {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(bag: Bag, key: string, errors: string[], where: string, required: boolean): void {
  const v = bag[key]
  if (v === undefined) {
    if (required) errors.push(`${where}.${key} is required`)
    return
  }
  if (typeof v !== 'string' || v.trim() === '') errors.push(`${where}.${key} must be a non-empty string`)
}

function num(bag: Bag, key: string, errors: string[], where: string, required: boolean): void {
  const v = bag[key]
  if (v === undefined) {
    if (required) errors.push(`${where}.${key} is required`)
    return
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${where}.${key} must be a finite number`)
}

/**
 * Re-validates an action against the frozen contract. Takes `unknown` because an edit arrives
 * from a form, not from typed code: the compiler has already stopped caring by then.
 */
export function validateAction(action: unknown): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!isBag(action)) return { ok: false, errors: ['action must be an object'], warnings }

  const type = action.type
  if (typeof type !== 'string' || !(ACTION_TYPES as readonly string[]).includes(type)) {
    return { ok: false, errors: [`action.type must be one of ${ACTION_TYPES.join(', ')}`], warnings }
  }
  str(action, 'patientId', errors, 'action', true)

  switch (type as ActionType) {
    case 'create_task': {
      str(action, 'title', errors, 'action', false)
      str(action, 'text', errors, 'action', false)
      break
    }
    case 'order_test': {
      const order = action.bloodTestOrder
      if (order !== undefined) {
        if (!isBag(order)) {
          errors.push('action.bloodTestOrder must be an object')
        } else {
          for (const key of ['panel', 'specimen', 'clinicalDetails']) str(order, key, errors, 'bloodTestOrder', true)
          if (order.priority !== 'routine' && order.priority !== 'urgent') {
            errors.push("bloodTestOrder.priority must be 'routine' or 'urgent'")
          }
          if (order.collection !== 'now' && order.collection !== 'next-round') {
            errors.push("bloodTestOrder.collection must be 'now' or 'next-round'")
          }
          if (order.panelId !== undefined && !(PANEL_IDS as readonly string[]).includes(String(order.panelId))) {
            errors.push(`bloodTestOrder.panelId must be one of ${PANEL_IDS.join(', ')}`)
          }
        }
      }
      break
    }
    case 'draft_prescription': {
      const order = action.medicationOrder
      if (order !== undefined) {
        if (!isBag(order)) {
          errors.push('action.medicationOrder must be an object')
        } else {
          for (const key of ['drug', 'dose', 'unit', 'route', 'frequency', 'duration', 'indication']) {
            str(order, key, errors, 'medicationOrder', true)
          }
          num(order, 'quantity', errors, 'medicationOrder', true)
          if (typeof order.quantity === 'number' && order.quantity <= 0) {
            errors.push('medicationOrder.quantity must be greater than zero')
          }
        }
      }
      break
    }
    case 'schedule_visit': {
      for (const key of ['startsAt', 'endsAt', 'durationMinutes']) num(action, key, errors, 'action', false)
      str(action, 'location', errors, 'action', false)
      str(action, 'clinician', errors, 'action', false)
      const { startsAt, endsAt, durationMinutes } = action
      if (typeof startsAt === 'number' && typeof endsAt === 'number' && endsAt <= startsAt) {
        errors.push('action.endsAt must be after action.startsAt')
      }
      if (typeof durationMinutes === 'number' && durationMinutes <= 0) {
        errors.push('action.durationMinutes must be greater than zero')
      }
      break
    }
    case 'share_record': {
      str(action, 'resourceId', errors, 'action', true)
      num(action, 'expectedVersion', errors, 'action', false)
      if (action.target !== undefined && !(SITES as readonly string[]).includes(String(action.target))) {
        errors.push(`action.target must be one of ${SITES.join(', ')}`)
      }
      break
    }
    case 'messaging_action': {
      const command = action.messagingCommand
      if (!isBag(command)) {
        errors.push('action.messagingCommand is required')
      } else {
        const kind = command.kind
        if (typeof kind !== 'string' || !(MESSAGING_KINDS as readonly string[]).includes(kind)) {
          errors.push(`messagingCommand.kind must be one of ${MESSAGING_KINDS.join(', ')}`)
        } else {
          if (kind === 'create') {
            for (const key of ['subject', 'body', 'channel']) str(command, key, errors, 'messagingCommand', true)
            if (typeof command.allowReply !== 'boolean') errors.push('messagingCommand.allowReply must be a boolean')
          }
          if (kind === 'send') for (const key of ['body', 'channel']) str(command, key, errors, 'messagingCommand', true)
          if (kind === 'reply' || kind === 'note') str(command, 'body', errors, 'messagingCommand', true)
          if (kind === 'assign') str(command, 'assignee', errors, 'messagingCommand', true)
        }
      }
      str(action, 'resourceId', errors, 'action', false)
      num(action, 'expectedVersion', errors, 'action', false)
      // Verified live: the server wants an existing conversation plus its version, which the
      // contract marks optional. Warn rather than block, so the contract stays the authority.
      if (action.resourceId === undefined || action.expectedVersion === undefined) {
        warnings.push('messaging_action needs an existing conversation: resourceId + expectedVersion')
      }
      break
    }
    case 'process_document': {
      str(action, 'resourceId', errors, 'action', true)
      num(action, 'expectedVersion', errors, 'action', true)
      if (!(DOCUMENT_COMMANDS as readonly string[]).includes(String(action.documentCommand))) {
        errors.push(`action.documentCommand must be one of ${DOCUMENT_COMMANDS.join(', ')}`)
      }
      if (action.documentTags !== undefined) {
        const tags = action.documentTags
        if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) {
          errors.push('action.documentTags must be an array of strings')
        }
      }
      if (action.documentSnomedCodes !== undefined) {
        const codes = action.documentSnomedCodes
        const bad = !Array.isArray(codes)
          || codes.some((c) => !isBag(c) || typeof c.code !== 'string' || typeof c.display !== 'string')
        if (bad) errors.push('action.documentSnomedCodes must be an array of {code, display}')
      }
      // Stage requirements the contract does not name (docs/nhssim-verified.md).
      if (action.documentCommand === 'assign' && typeof action.clinician !== 'string') {
        warnings.push("process_document 'assign' needs a clinician")
      }
      if (action.documentCommand === 'review' && typeof action.text !== 'string') {
        warnings.push("process_document 'review' needs text, which becomes data.reviewNote")
      }
      break
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

/** PRD §4.7. Nothing outside this set is auto-approvable, whatever tier a plan claims. */
export const AUTO_APPROVABLE_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  'create_task',
  'messaging_action',
])

/**
 * `requires-approval` can never auto-approve. `low-risk` and `read` may, but only with the flag
 * and only for a type on the list above.
 */
export function canAutoApprove(planned: PlannedAction, autoApproveLowRisk: boolean): boolean {
  if (!autoApproveLowRisk) return false
  if (planned.tier === 'requires-approval') return false
  return AUTO_APPROVABLE_TYPES.has(planned.action.type)
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface ApprovalGateOptions {
  /** Default false. Even when true it only reaches low-risk create_task / messaging_action. */
  autoApproveLowRisk?: boolean
  /** Recorded on every decision this gate produces. */
  approver?: string
  now?: () => number
}

/** A planned action plus the decision that released it. `planned.action` is the EDITED one. */
export interface ApprovedAction {
  planned: PlannedAction
  decision: ApprovalDecision
}

export interface ApprovalSnapshot {
  planId: string
  total: number
  approved: number
  edited: number
  rejected: number
  pending: number
  complete: boolean
}

export interface ApprovalGate {
  readonly plan: Plan
  /** Actions with no decision yet, in plan order. This is what the approval screen renders. */
  pending(): PlannedAction[]
  /** Every decision recorded so far, in the order it was taken. */
  decisions(): ApprovalDecision[]
  decisionFor(actionId: string): ApprovalDecision | undefined
  /** Records one verdict. Throws ApprovalError on an unknown action or an invalid edit. */
  submitDecision(actionId: string, verdict: ApprovalVerdict, edited?: Action): ApprovalDecision
  isComplete(): boolean
  /** Only approved actions, in plan order, edits already applied. The loop's only input. */
  getApproved(): ApprovedAction[]
  snapshot(): ApprovalSnapshot
}

/**
 * An edit may correct the action; it may not turn it into a different action. Changing the type
 * would escape the tier that was reviewed, and changing the patient would apply a plan reviewed
 * for one person to another.
 */
function assertEditIsCompatible(planned: PlannedAction, edited: Action): void {
  if (edited.type !== planned.action.type) {
    throw new ApprovalError(
      `${planned.id}: an edit cannot change the action type (${planned.action.type} -> ${edited.type})`,
    )
  }
  if (edited.patientId !== planned.action.patientId) {
    throw new ApprovalError(`${planned.id}: an edit cannot change the patient`)
  }
  const check = validateAction(edited)
  if (!check.ok) throw new ApprovalError(`${planned.id}: edited action is invalid: ${check.errors.join('; ')}`)
}

export function createApprovalGate(plan: Plan, options: ApprovalGateOptions = {}): ApprovalGate {
  const autoApproveLowRisk = options.autoApproveLowRisk ?? false
  const approver = options.approver ?? 'unknown'
  const now = options.now ?? (() => Date.now())

  const byId = new Map<string, PlannedAction>(plan.actions.map((a) => [a.id, a]))
  const decisions = new Map<string, ApprovalDecision>()
  const order: string[] = []

  const record = (decision: ApprovalDecision): ApprovalDecision => {
    if (!decisions.has(decision.actionId)) order.push(decision.actionId)
    decisions.set(decision.actionId, decision)
    return decision
  }

  for (const planned of plan.actions) {
    if (canAutoApprove(planned, autoApproveLowRisk)) {
      record({ actionId: planned.id, verdict: 'approve', approvedBy: `auto:${planned.tier}`, at: now() })
    }
  }

  const effective = (planned: PlannedAction, decision: ApprovalDecision): PlannedAction =>
    decision.verdict === 'edit' && decision.edited
      ? { ...planned, action: decision.edited }
      : planned

  return {
    plan,
    pending: () => plan.actions.filter((a) => !decisions.has(a.id)),
    decisions: () => order.map((id) => decisions.get(id)).filter((d): d is ApprovalDecision => d !== undefined),
    decisionFor: (actionId) => decisions.get(actionId),
    submitDecision(actionId, verdict, edited) {
      const planned = byId.get(actionId)
      if (!planned) throw new ApprovalError(`No action ${actionId} in plan ${plan.id}`)
      if (verdict === 'edit') {
        if (!edited) throw new ApprovalError(`${actionId}: verdict 'edit' needs the edited action`)
        assertEditIsCompatible(planned, edited)
        return record({ actionId, verdict, edited, approvedBy: approver, at: now() })
      }
      if (edited) throw new ApprovalError(`${actionId}: only verdict 'edit' may carry an edited action`)
      return record({ actionId, verdict, approvedBy: approver, at: now() })
    },
    isComplete: () => plan.actions.every((a) => decisions.has(a.id)),
    getApproved() {
      const out: ApprovedAction[] = []
      for (const planned of plan.actions) {
        const decision = decisions.get(planned.id)
        if (!decision || decision.verdict === 'reject') continue
        out.push({ planned: effective(planned, decision), decision })
      }
      return out
    },
    snapshot() {
      const all = plan.actions.map((a) => decisions.get(a.id))
      const count = (v: ApprovalVerdict) => all.filter((d) => d?.verdict === v).length
      const pending = all.filter((d) => d === undefined).length
      return {
        planId: plan.id,
        total: plan.actions.length,
        approved: count('approve'),
        edited: count('edit'),
        rejected: count('reject'),
        pending,
        complete: pending === 0,
      }
    },
  }
}

/**
 * The same rule applied to decisions that arrived from somewhere else (Elsa's screen, a resumed
 * run). Later decisions supersede earlier ones for the same action; an undecided action is left
 * out, which is how "nothing writes without a decision" is enforced at the loop's door.
 */
export function resolveApproved(
  plan: Plan,
  decisions: readonly ApprovalDecision[],
  options: ApprovalGateOptions = {},
): ApprovedAction[] {
  const gate = createApprovalGate(plan, options)
  const known = new Set(plan.actions.map((a) => a.id))
  for (const decision of decisions) {
    if (!known.has(decision.actionId)) {
      throw new ApprovalError(`Decision references unknown action ${decision.actionId} in plan ${plan.id}`)
    }
    gate.submitDecision(decision.actionId, decision.verdict, decision.edited)
  }
  return gate.getApproved()
}
