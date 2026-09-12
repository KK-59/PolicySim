/**
 * Operational safe state for a discharged patient.
 *
 * This module does not diagnose or infer clinical need. Its input is a set of explicit facts from
 * the patient record, the approved plan, and the rule-based red-flag evaluator. It answers only:
 * has the promised discharge handover been closed safely, and may this plan remain in ranking?
 */

export type DischargeDocumentStatus = 'missing' | 'sent' | 'assigned' | 'reviewed' | 'filed'
export type CareActionStatus = 'planned' | 'scheduled' | 'in-progress' | 'completed' | 'failed' | 'cancelled'
export type SafetyPriority = 'routine' | 'urgent'

export interface RequiredCareAction {
  id: string
  label: string
  /** Optional actions never block safe state. */
  required: boolean
  priority: SafetyPriority
  status: CareActionStatus
  /** Absolute simulator time. An urgent action past this time is a hard failure. */
  dueAt?: number
}

export interface SafetyConcern {
  id: string
  label: string
  severity: 'amber' | 'red'
  status: 'open' | 'resolved'
}

export interface DischargeCommunication {
  patientInformed: boolean
  /** A named telephone number, service, or conversation through which help can be requested. */
  escalationRouteProvided: boolean
  carerRequired: boolean
  carerInvolved: boolean
}

export interface DischargeSafetySnapshot {
  patientId: string
  assessedAt: number
  dischargeDocumentStatus: DischargeDocumentStatus
  /** Named person or team accepting responsibility for follow-up. */
  followUpOwner?: string
  requiredCare: readonly RequiredCareAction[]
  communication: DischargeCommunication
  /** Produced by deterministic red-flag rules, not model judgement. */
  concerns: readonly SafetyConcern[]
}

export type SafeStateRuleId =
  | 'discharge-information-reviewed'
  | 'follow-up-owner-named'
  | 'required-care-arranged'
  | 'patient-informed'
  | 'escalation-route-provided'
  | 'carer-involved-when-required'
  | 'no-overdue-urgent-care'
  | 'no-open-red-flags'

export interface SafeStateCheck {
  id: SafeStateRuleId
  status: 'pass' | 'pending' | 'fail'
  /** A fail here disqualifies immediately, even before the plan horizon ends. */
  hard: boolean
  detail: string
  evidenceIds: string[]
}

export interface SafeStateAssessment {
  patientId: string
  assessedAt: number
  state: 'safe' | 'pending' | 'unsafe'
  safe: boolean
  /** Hard failures always disqualify. At plan end, any unmet requirement also disqualifies. */
  disqualified: boolean
  checks: SafeStateCheck[]
  disqualificationReasons: string[]
}

export interface SafeStateOptions {
  /** True when ranking the plan's final state rather than observing it while actions are pending. */
  atPlanEnd?: boolean
}

const arranged = new Set<CareActionStatus>(['scheduled', 'in-progress', 'completed'])
const failed = new Set<CareActionStatus>(['failed', 'cancelled'])

function incompleteStatus(atPlanEnd: boolean): SafeStateCheck['status'] {
  return atPlanEnd ? 'fail' : 'pending'
}

export function evaluateSafeState(
  snapshot: DischargeSafetySnapshot,
  options: SafeStateOptions = {},
): SafeStateAssessment {
  const atPlanEnd = options.atPlanEnd ?? false
  const required = snapshot.requiredCare.filter((action) => action.required)
  const failedRequired = required.filter((action) => failed.has(action.status))
  const unarranged = required.filter((action) => !arranged.has(action.status) && !failed.has(action.status))
  const overdueUrgent = required.filter((action) =>
    action.priority === 'urgent'
      && action.dueAt !== undefined
      && action.dueAt < snapshot.assessedAt
      && action.status !== 'completed',
  )
  const openRedFlags = snapshot.concerns.filter((concern) =>
    concern.severity === 'red' && concern.status === 'open',
  )
  const documentReviewed = snapshot.dischargeDocumentStatus === 'reviewed'
    || snapshot.dischargeDocumentStatus === 'filed'
  const ownerNamed = Boolean(snapshot.followUpOwner?.trim())

  const checks: SafeStateCheck[] = [
    {
      id: 'discharge-information-reviewed',
      status: snapshot.dischargeDocumentStatus === 'missing'
        ? 'fail'
        : documentReviewed ? 'pass' : incompleteStatus(atPlanEnd),
      hard: snapshot.dischargeDocumentStatus === 'missing',
      detail: snapshot.dischargeDocumentStatus === 'missing'
        ? 'No discharge information is available.'
        : documentReviewed
          ? `Discharge information is ${snapshot.dischargeDocumentStatus}.`
          : `Discharge information is ${snapshot.dischargeDocumentStatus} and still needs review.`,
      evidenceIds: [],
    },
    {
      id: 'follow-up-owner-named',
      status: ownerNamed ? 'pass' : incompleteStatus(atPlanEnd),
      hard: false,
      detail: ownerNamed ? `Follow-up owner: ${snapshot.followUpOwner?.trim()}.` : 'No follow-up owner is named.',
      evidenceIds: [],
    },
    {
      id: 'required-care-arranged',
      status: failedRequired.length > 0 ? 'fail' : unarranged.length === 0 ? 'pass' : incompleteStatus(atPlanEnd),
      hard: failedRequired.length > 0,
      detail: failedRequired.length > 0
        ? `Required care failed or was cancelled: ${failedRequired.map((action) => action.label).join(', ')}.`
        : unarranged.length > 0
          ? `Required care is not yet arranged: ${unarranged.map((action) => action.label).join(', ')}.`
          : required.length > 0 ? 'All required care is arranged or completed.' : 'No required care actions are recorded.',
      evidenceIds: (failedRequired.length > 0 ? failedRequired : unarranged).map((action) => action.id),
    },
    {
      id: 'patient-informed',
      status: snapshot.communication.patientInformed ? 'pass' : incompleteStatus(atPlanEnd),
      hard: false,
      detail: snapshot.communication.patientInformed
        ? 'The patient has been informed of the plan.'
        : 'The patient has not yet been informed of the plan.',
      evidenceIds: [],
    },
    {
      id: 'escalation-route-provided',
      status: snapshot.communication.escalationRouteProvided ? 'pass' : incompleteStatus(atPlanEnd),
      hard: false,
      detail: snapshot.communication.escalationRouteProvided
        ? 'A route for help or escalation has been provided.'
        : 'No route for help or escalation has been provided.',
      evidenceIds: [],
    },
    {
      id: 'carer-involved-when-required',
      status: !snapshot.communication.carerRequired || snapshot.communication.carerInvolved
        ? 'pass'
        : incompleteStatus(atPlanEnd),
      hard: false,
      detail: !snapshot.communication.carerRequired
        ? 'Carer involvement is not a recorded requirement.'
        : snapshot.communication.carerInvolved
          ? 'The required carer involvement is recorded.'
          : 'Carer involvement is required but not yet recorded.',
      evidenceIds: [],
    },
    {
      id: 'no-overdue-urgent-care',
      status: overdueUrgent.length === 0 ? 'pass' : 'fail',
      hard: overdueUrgent.length > 0,
      detail: overdueUrgent.length === 0
        ? 'No required urgent care is overdue.'
        : `Required urgent care is overdue: ${overdueUrgent.map((action) => action.label).join(', ')}.`,
      evidenceIds: overdueUrgent.map((action) => action.id),
    },
    {
      id: 'no-open-red-flags',
      status: openRedFlags.length === 0 ? 'pass' : 'fail',
      hard: openRedFlags.length > 0,
      detail: openRedFlags.length === 0
        ? 'No rule-generated red flags remain open.'
        : `Open red flags require human review: ${openRedFlags.map((concern) => concern.label).join(', ')}.`,
      evidenceIds: openRedFlags.map((concern) => concern.id),
    },
  ]

  const hardFailures = checks.filter((check) => check.status === 'fail' && check.hard)
  const unmet = checks.filter((check) => check.status !== 'pass')
  const safe = unmet.length === 0
  const disqualified = hardFailures.length > 0 || (atPlanEnd && unmet.length > 0)

  return {
    patientId: snapshot.patientId,
    assessedAt: snapshot.assessedAt,
    state: safe ? 'safe' : disqualified ? 'unsafe' : 'pending',
    safe,
    disqualified,
    checks,
    disqualificationReasons: (hardFailures.length > 0 ? hardFailures : atPlanEnd ? unmet : [])
      .map((check) => check.detail),
  }
}
