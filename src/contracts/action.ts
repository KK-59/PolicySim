/**
 * Action — a typed action with a timing offset, matching NHS-SIM's action shapes.
 * OWNER: Oriol. CONSUMED BY: Albert (patient plans), Elsa (approval screen), Oriol (ADK tools).
 *
 * FROZEN 2026-09-12. Change only by agreement in the group chat.
 *
 * Every shape below was verified against the live server, not inferred from the OpenAPI spec.
 * The spec declares only `type` as required and enforces the rest server-side, so the minimum
 * bodies recorded here come from probing https://sim.animahacks.com directly.
 *
 * The wire body is FLAT: `type` plus type-specific fields at the top level. These types mirror
 * that exactly, so anything that typechecks is something the server accepts. Do not nest.
 */

/** Sites that accept actions. Path segment of POST /api/sites/{site}/actions. */
export type Site =
  | 'control' | 'gp' | 'hospital' | 'community'
  | 'pharmacy' | 'diagnostics' | 'referrals' | 'wearables' | 'legacy'

/** The seven action types the demo uses, of the 43 the server accepts. */
export type ActionType =
  | 'create_task'
  | 'order_test'
  | 'draft_prescription'
  | 'schedule_visit'
  | 'share_record'
  | 'messaging_action'
  | 'process_document'

// ---------------------------------------------------------------------------
// Per-type payloads. Field names match the wire format exactly.
// ---------------------------------------------------------------------------

export type BloodPanelId = 'fbc' | 'ue' | 'hba1c' | 'lft' | 'crp' | 'lipids'

export interface BloodTestOrder {
  panel: string
  specimen: string
  priority: 'routine' | 'urgent'
  collection: 'now' | 'next-round'
  clinicalDetails: string
  panelId?: BloodPanelId
}

export interface MedicationOrder {
  drug: string
  dose: string
  unit: string
  route: string
  frequency: string
  duration: string
  quantity: number
  indication: string
}

export type MessagingCommand =
  | { kind: 'create'; subject: string; body: string; channel: string; allowReply: boolean }
  | { kind: 'send'; body: string; channel: string }
  | { kind: 'reply'; body: string }
  | { kind: 'note'; body: string }
  | { kind: 'assign'; assignee: string }
  | { kind: 'complete' }
  | { kind: 'reopen' }

export type DocumentCommand = 'send' | 'assign' | 'review' | 'file' | 'annotate'

// ---------------------------------------------------------------------------
// Action — discriminated union on `type`.
// `minimum body` notes record what the live server actually requires.
// ---------------------------------------------------------------------------

interface ActionBase {
  /** Synthetic patient, e.g. "SIM-000001". Required by every type. */
  patientId: string
}

/** minimum body: patientId. Server defaults title. -> kind:task, owner:gp */
export interface CreateTaskAction extends ActionBase {
  type: 'create_task'
  title?: string
  text?: string
}

/** minimum body: patientId. -> kind:test, owner:diagnostics */
export interface OrderTestAction extends ActionBase {
  type: 'order_test'
  bloodTestOrder?: BloodTestOrder
}

/** minimum body: patientId. -> kind:prescription, owner:pharmacy, status:draft */
export interface DraftPrescriptionAction extends ActionBase {
  type: 'draft_prescription'
  medicationOrder?: MedicationOrder
}

/** minimum body: patientId. -> kind:visit, owner:community */
export interface ScheduleVisitAction extends ActionBase {
  type: 'schedule_visit'
  startsAt?: number
  endsAt?: number
  durationMinutes?: number
  location?: string
  clinician?: string
}

/** minimum body: patientId + resourceId. 400 "resourceId required" without it. */
export interface ShareRecordAction extends ActionBase {
  type: 'share_record'
  resourceId: string
  target?: Site
  expectedVersion?: number
}

/** minimum body: patientId + messagingCommand. 400 "Messaging command required" without it. */
export interface MessagingAction extends ActionBase {
  type: 'messaging_action'
  messagingCommand: MessagingCommand
  resourceId?: string
  expectedVersion?: number
}

/**
 * minimum body: patientId + an existing versioned discharge document.
 * 409 "Versioned discharge document required" without resourceId + expectedVersion.
 * This is the type that exercises the optimistic-concurrency path on purpose.
 */
export interface ProcessDocumentAction extends ActionBase {
  type: 'process_document'
  resourceId: string
  expectedVersion: number
  documentCommand: DocumentCommand
  documentTags?: string[]
  documentSnomedCodes?: Array<{ code: string; display: string }>
}

export type Action =
  | CreateTaskAction
  | OrderTestAction
  | DraftPrescriptionAction
  | ScheduleVisitAction
  | ShareRecordAction
  | MessagingAction
  | ProcessDocumentAction

// ---------------------------------------------------------------------------
// Approval and planning — our layer, not the server's.
// ---------------------------------------------------------------------------

/** Albert's matrix (PRD §4.7). Nothing above 'low-risk' writes without a human decision. */
export type PermissionTier = 'read' | 'low-risk' | 'requires-approval'

/**
 * An Action placed in a plan. `offsetMinutes` is OURS: the server has no plan-timing
 * concept, so the live loop schedules by advancing the clock between writes.
 */
export interface PlannedAction {
  id: string
  site: Site
  action: Action
  offsetMinutes: number
  tier: PermissionTier
  /** One line, shown on the approval screen. Why this action, for this patient, now. */
  rationale: string
}

export interface Plan {
  id: string
  patientId: string
  /** One line describing the plan as a whole. */
  rationale: string
  actions: PlannedAction[]
}

export type ApprovalVerdict = 'approve' | 'edit' | 'reject'

/** One decision per action. No blanket approvals. */
export interface ApprovalDecision {
  actionId: string
  verdict: ApprovalVerdict
  /** Present only when verdict === 'edit'. Replaces the action before it is sent. */
  edited?: Action
  approvedBy: string
  at: number
}

// ---------------------------------------------------------------------------
// Results — what the live loop records.
// ---------------------------------------------------------------------------

/** The resource the server returns from a successful POST. */
export interface ActionResult {
  id: string
  kind: string
  title: string
  status: string
  owner: string
  visibleTo: string[]
  priority: string
  patientId?: string
  createdAt: number
  dueAt?: number
  data: Record<string, unknown>
  version: number
  provenance?: Record<string, unknown>
}

/** What we did when a write came back 409. Recorded, never silent. */
export type FallbackKind = 'reread-retry' | 'next-slot' | 'coordinator-task' | 'abandoned'

export interface AppliedAction {
  plannedActionId: string
  outcome: 'applied' | 'rejected' | 'failed'
  result?: ActionResult
  /** Set when the first attempt conflicted. Presence alone proves the fallback fired. */
  fallback?: { kind: FallbackKind; reason: string; attempts: number }
  error?: string
  /** Simulated clock time at the moment of the write. */
  simTime: number
}
