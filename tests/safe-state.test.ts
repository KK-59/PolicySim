import { describe, expect, it } from 'vitest'
import {
  evaluateSafeState,
  type DischargeSafetySnapshot,
} from '@/clinical/safe-state.ts'

function snapshot(overrides: Partial<DischargeSafetySnapshot> = {}): DischargeSafetySnapshot {
  return {
    patientId: 'SIM-000001',
    assessedAt: 1_000,
    dischargeDocumentStatus: 'reviewed',
    followUpOwner: 'Neighbourhood team',
    requiredCare: [
      {
        id: 'visit-1',
        label: 'Community home visit',
        required: true,
        priority: 'routine',
        status: 'scheduled',
        dueAt: 2_000,
      },
    ],
    communication: {
      patientInformed: true,
      escalationRouteProvided: true,
      carerRequired: true,
      carerInvolved: true,
    },
    concerns: [],
    ...overrides,
  }
}

describe('discharge safe state', () => {
  it('passes only when the complete operational handover is evidenced', () => {
    const result = evaluateSafeState(snapshot(), { atPlanEnd: true })

    expect(result.state).toBe('safe')
    expect(result.safe).toBe(true)
    expect(result.disqualified).toBe(false)
    expect(result.checks.every((check) => check.status === 'pass')).toBe(true)
  })

  it('keeps incomplete work pending while a plan is still running', () => {
    const result = evaluateSafeState(snapshot({
      followUpOwner: undefined,
      communication: {
        patientInformed: false,
        escalationRouteProvided: false,
        carerRequired: true,
        carerInvolved: false,
      },
    }))

    expect(result.state).toBe('pending')
    expect(result.disqualified).toBe(false)
    expect(result.disqualificationReasons).toEqual([])
  })

  it('disqualifies a plan that ends before every requirement is met', () => {
    const result = evaluateSafeState(snapshot({ followUpOwner: undefined }), { atPlanEnd: true })

    expect(result.state).toBe('unsafe')
    expect(result.disqualified).toBe(true)
    expect(result.disqualificationReasons).toContain('No follow-up owner is named.')
  })

  it('immediately disqualifies missing discharge information', () => {
    const result = evaluateSafeState(snapshot({ dischargeDocumentStatus: 'missing' }))

    expect(result.state).toBe('unsafe')
    expect(result.disqualified).toBe(true)
    expect(result.disqualificationReasons).toContain('No discharge information is available.')
  })

  it('immediately disqualifies failed or overdue required care', () => {
    const failed = evaluateSafeState(snapshot({
      requiredCare: [{
        id: 'visit-1',
        label: 'Community home visit',
        required: true,
        priority: 'routine',
        status: 'cancelled',
      }],
    }))
    expect(failed.disqualified).toBe(true)

    const overdue = evaluateSafeState(snapshot({
      requiredCare: [{
        id: 'test-1',
        label: 'Urgent blood test',
        required: true,
        priority: 'urgent',
        status: 'scheduled',
        dueAt: 999,
      }],
    }))
    expect(overdue.disqualified).toBe(true)
    expect(overdue.disqualificationReasons.join(' ')).toContain('Urgent blood test')
  })

  it('treats an open rule-generated red flag as a hard failure', () => {
    const result = evaluateSafeState(snapshot({
      concerns: [{ id: 'red-1', label: 'Urgent result awaiting review', severity: 'red', status: 'open' }],
    }))

    expect(result.state).toBe('unsafe')
    expect(result.disqualified).toBe(true)
    expect(result.checks.find((check) => check.id === 'no-open-red-flags')).toMatchObject({
      status: 'fail',
      hard: true,
      evidenceIds: ['red-1'],
    })
  })

  it('does not require a carer or optional action unless the record says it does', () => {
    const result = evaluateSafeState(snapshot({
      requiredCare: [{
        id: 'optional-1',
        label: 'Optional wellbeing call',
        required: false,
        priority: 'routine',
        status: 'planned',
      }],
      communication: {
        patientInformed: true,
        escalationRouteProvided: true,
        carerRequired: false,
        carerInvolved: false,
      },
    }), { atPlanEnd: true })

    expect(result.safe).toBe(true)
  })
})
