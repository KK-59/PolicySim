import { describe, expect, it } from 'vitest'
import {
  evaluateRedFlags,
  redFlagsAsSafetyConcerns,
  redFlagsToHumanTasks,
  type RedFlagFacts,
} from '@/clinical/red-flags.ts'

function facts(overrides: Partial<RedFlagFacts> = {}): RedFlagFacts {
  return {
    patientId: 'SIM-000001',
    assessedAt: 1_000,
    results: [],
    careActions: [],
    medicationReconciliation: { required: false, completed: false },
    capacityRefusals: [],
    recordConflicts: [],
    ...overrides,
  }
}

describe('red-flag rules', () => {
  it('does not interpret pending, non-critical, or reviewed results', () => {
    const flags = evaluateRedFlags(facts({
      results: [
        { id: 'r1', label: 'Pending result', critical: true, status: 'pending' },
        { id: 'r2', label: 'Available routine result', critical: false, status: 'available' },
        { id: 'r3', label: 'Reviewed critical result', critical: true, status: 'reviewed' },
      ],
    }))

    expect(flags).toEqual([])
  })

  it('escalates an explicitly critical available result', () => {
    const flags = evaluateRedFlags(facts({
      results: [{ id: 'result-1', label: 'Potassium result', critical: true, status: 'available' }],
    }))

    expect(flags).toEqual([expect.objectContaining({
      ruleId: 'critical-result-unreviewed',
      evidenceIds: ['result-1'],
      bypassAgent: true,
    })])
  })

  it('escalates overdue urgent care but not an action exactly at its deadline', () => {
    const flags = evaluateRedFlags(facts({
      careActions: [
        { id: 'late', label: 'Urgent review', required: true, priority: 'urgent', status: 'scheduled', dueAt: 999 },
        { id: 'due-now', label: 'Due now', required: true, priority: 'urgent', status: 'scheduled', dueAt: 1_000 },
        { id: 'optional', label: 'Optional call', required: false, priority: 'urgent', status: 'planned', dueAt: 900 },
      ],
    }))

    expect(flags.map((item) => item.evidenceIds)).toEqual([['late']])
    expect(flags[0]?.ruleId).toBe('urgent-care-overdue')
  })

  it('escalates failed required care without also reporting it as overdue', () => {
    const flags = evaluateRedFlags(facts({
      careActions: [{
        id: 'visit-1',
        label: 'Community visit',
        required: true,
        priority: 'urgent',
        status: 'cancelled',
        dueAt: 900,
      }],
    }))

    expect(flags).toHaveLength(1)
    expect(flags[0]?.ruleId).toBe('required-care-failed')
  })

  it('escalates explicit reconciliation, capacity, and record-conflict failures', () => {
    const flags = evaluateRedFlags(facts({
      medicationReconciliation: { required: true, completed: false, evidenceId: 'rx-1' },
      capacityRefusals: [{ id: 'refusal-1', label: 'Home visit', requiredCare: true, resolved: false }],
      recordConflicts: [{ id: 'conflict-1', label: 'Conflicting medication lists', resolved: false }],
    }))

    expect(flags.map((item) => item.ruleId)).toEqual([
      'medication-reconciliation-incomplete',
      'capacity-refusal-unresolved',
      'record-conflict-unresolved',
    ])
  })

  it('ignores requirements that are completed, replaced, or resolved', () => {
    const flags = evaluateRedFlags(facts({
      medicationReconciliation: { required: true, completed: true },
      capacityRefusals: [{ id: 'refusal-1', label: 'Home visit', requiredCare: true, resolved: true }],
      recordConflicts: [{ id: 'conflict-1', label: 'Conflicting medication lists', resolved: true }],
    }))

    expect(flags).toEqual([])
  })

  it('creates human tasks and safe-state concerns without clinical reinterpretation', () => {
    const flags = evaluateRedFlags(facts({
      results: [{ id: 'result-1', label: 'Critical result', critical: true, status: 'available' }],
    }))
    const concerns = redFlagsAsSafetyConcerns(flags)
    const tasks = redFlagsToHumanTasks(flags)

    expect(concerns[0]).toMatchObject({ severity: 'red', status: 'open' })
    expect(tasks[0]).toMatchObject({
      site: 'gp',
      tier: 'low-risk',
      action: { type: 'create_task', patientId: 'SIM-000001', title: 'Critical result awaiting review' },
    })
  })
})
