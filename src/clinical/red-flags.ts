/**
 * Deterministic red flags that bypass plan generation and create a human-owned task.
 *
 * The evaluator consumes explicit facts. It never decides that a result is clinically critical,
 * interprets free text, or invents a threshold; upstream records must already carry those facts.
 */

import type { PlannedAction } from '../contracts/action.ts'
import type { CareActionStatus, SafetyConcern, SafetyPriority } from './safe-state.ts'

export type RedFlagRuleId =
  | 'critical-result-unreviewed'
  | 'urgent-care-overdue'
  | 'required-care-failed'
  | 'medication-reconciliation-incomplete'
  | 'capacity-refusal-unresolved'
  | 'record-conflict-unresolved'

export interface TrackedResult {
  id: string
  label: string
  /** Set by the source system or a separately validated clinical rule, never inferred here. */
  critical: boolean
  status: 'pending' | 'available' | 'reviewed'
}

export interface TrackedCareAction {
  id: string
  label: string
  required: boolean
  priority: SafetyPriority
  status: CareActionStatus
  dueAt?: number
}

export interface MedicationReconciliationState {
  required: boolean
  completed: boolean
  evidenceId?: string
}

export interface CapacityRefusal {
  id: string
  label: string
  requiredCare: boolean
  resolved: boolean
}

export interface RecordConflict {
  id: string
  label: string
  /** Conflict detection occurs upstream; this module only checks whether it remains open. */
  resolved: boolean
}

export interface RedFlagFacts {
  patientId: string
  assessedAt: number
  results: readonly TrackedResult[]
  careActions: readonly TrackedCareAction[]
  medicationReconciliation: MedicationReconciliationState
  capacityRefusals: readonly CapacityRefusal[]
  recordConflicts: readonly RecordConflict[]
}

export interface RedFlag {
  id: string
  patientId: string
  ruleId: RedFlagRuleId
  label: string
  detail: string
  evidenceIds: string[]
  severity: 'red'
  bypassAgent: true
}

function flag(
  facts: RedFlagFacts,
  ruleId: RedFlagRuleId,
  label: string,
  detail: string,
  evidenceIds: string[],
): RedFlag {
  return {
    id: `red:${facts.patientId}:${ruleId}:${evidenceIds.join('+') || 'state'}`,
    patientId: facts.patientId,
    ruleId,
    label,
    detail,
    evidenceIds,
    severity: 'red',
    bypassAgent: true,
  }
}

export function evaluateRedFlags(facts: RedFlagFacts): RedFlag[] {
  const flags: RedFlag[] = []

  for (const result of facts.results) {
    if (result.critical && result.status === 'available') {
      flags.push(flag(
        facts,
        'critical-result-unreviewed',
        'Critical result awaiting review',
        `${result.label} is explicitly marked critical and has not been reviewed.`,
        [result.id],
      ))
    }
  }

  for (const action of facts.careActions) {
    if (!action.required) continue
    if (action.status === 'failed' || action.status === 'cancelled') {
      flags.push(flag(
        facts,
        'required-care-failed',
        'Required care failed',
        `${action.label} is required but is ${action.status}.`,
        [action.id],
      ))
      continue
    }
    if (
      action.priority === 'urgent'
      && action.dueAt !== undefined
      && action.dueAt < facts.assessedAt
      && action.status !== 'completed'
    ) {
      flags.push(flag(
        facts,
        'urgent-care-overdue',
        'Urgent care is overdue',
        `${action.label} was due before the assessment time and is not complete.`,
        [action.id],
      ))
    }
  }

  if (facts.medicationReconciliation.required && !facts.medicationReconciliation.completed) {
    const evidenceIds = facts.medicationReconciliation.evidenceId
      ? [facts.medicationReconciliation.evidenceId]
      : []
    flags.push(flag(
      facts,
      'medication-reconciliation-incomplete',
      'Medication reconciliation incomplete',
      'The record explicitly requires medication reconciliation and it is not complete.',
      evidenceIds,
    ))
  }

  for (const refusal of facts.capacityRefusals) {
    if (refusal.requiredCare && !refusal.resolved) {
      flags.push(flag(
        facts,
        'capacity-refusal-unresolved',
        'Required care refused at capacity',
        `${refusal.label} was refused and no replacement arrangement is recorded.`,
        [refusal.id],
      ))
    }
  }

  for (const conflict of facts.recordConflicts) {
    if (!conflict.resolved) {
      flags.push(flag(
        facts,
        'record-conflict-unresolved',
        'Patient record conflict unresolved',
        `${conflict.label} is explicitly recorded as a conflict and requires human resolution.`,
        [conflict.id],
      ))
    }
  }

  return flags
}

/** Bridges red-flag output into the safe-state evaluator without losing evidence ids. */
export function redFlagsAsSafetyConcerns(flags: readonly RedFlag[]): SafetyConcern[] {
  return flags.map((item) => ({
    id: item.id,
    label: item.label,
    severity: 'red',
    status: 'open',
  }))
}

/**
 * Red flags bypass plan generation, but the escalation itself is a low-risk administrative write.
 * The approval gate still controls whether low-risk actions may be applied automatically.
 */
export function redFlagsToHumanTasks(flags: readonly RedFlag[]): PlannedAction[] {
  return flags.map((item, index) => ({
    id: `escalate-${index + 1}-${item.ruleId}`,
    site: 'gp',
    offsetMinutes: 0,
    tier: 'low-risk',
    rationale: `Rule-based escalation: ${item.detail}`,
    action: {
      type: 'create_task',
      patientId: item.patientId,
      title: item.label,
      text: `${item.detail} Evidence: ${item.evidenceIds.join(', ') || 'recorded state'}.`,
    },
  }))
}
