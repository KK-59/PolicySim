/**
 * The approval gate: nothing writes without a per-action decision, and an edit is re-validated.
 * OWNER: Oriol.
 */

import { describe, expect, it } from 'vitest'
import type { Action, ApprovalDecision, Plan, PlannedAction } from '@/contracts/action.ts'
import {
  ApprovalError,
  canAutoApprove,
  createApprovalGate,
  resolveApproved,
  validateAction,
} from '@/agent/approval.ts'

function planned(id: string, action: Action, over: Partial<PlannedAction> = {}): PlannedAction {
  return {
    id,
    site: 'gp',
    action,
    offsetMinutes: 0,
    tier: 'requires-approval',
    rationale: `why ${id}`,
    ...over,
  }
}

const task = (): Action => ({ type: 'create_task', patientId: 'SIM-000001', title: 'Call Amira' })
const test1 = (): Action => ({ type: 'order_test', patientId: 'SIM-000001' })

function makePlan(actions: PlannedAction[]): Plan {
  return { id: 'plan-1', patientId: 'SIM-000001', rationale: 'keep Amira at home', actions }
}

describe('nothing writes without a decision', () => {
  it('leaves a requires-approval action out of getApproved until a human decides', () => {
    const plan = makePlan([planned('a1', test1())])
    const gate = createApprovalGate(plan)

    expect(gate.pending().map((p) => p.id)).toEqual(['a1'])
    expect(gate.getApproved()).toHaveLength(0)

    gate.submitDecision('a1', 'approve')
    expect(gate.getApproved().map((a) => a.planned.id)).toEqual(['a1'])
    expect(gate.isComplete()).toBe(true)
  })

  it('never auto-approves a requires-approval action, flag or no flag', () => {
    const plan = makePlan([planned('a1', task(), { tier: 'requires-approval' })])
    const gate = createApprovalGate(plan, { autoApproveLowRisk: true })

    expect(gate.getApproved()).toHaveLength(0)
    expect(gate.pending().map((p) => p.id)).toEqual(['a1'])
  })

  it('auto-approves low-risk only when the flag is passed', () => {
    const low = planned('a1', task(), { tier: 'low-risk' })

    expect(createApprovalGate(makePlan([low])).getApproved()).toHaveLength(0)

    const opted = createApprovalGate(makePlan([low]), { autoApproveLowRisk: true })
    expect(opted.getApproved()).toHaveLength(1)
    expect(opted.decisionFor('a1')?.approvedBy).toBe('auto:low-risk')
  })

  it('caps auto-approval by type, so a mis-tiered order_test still needs a human', () => {
    const misTiered = planned('a1', test1(), { tier: 'low-risk' })
    expect(canAutoApprove(misTiered, true)).toBe(false)
    expect(createApprovalGate(makePlan([misTiered]), { autoApproveLowRisk: true }).getApproved()).toHaveLength(0)
  })

  it('drops rejected actions and keeps plan order', () => {
    const plan = makePlan([planned('a1', task()), planned('a2', test1()), planned('a3', task())])
    const gate = createApprovalGate(plan)
    gate.submitDecision('a3', 'approve')
    gate.submitDecision('a2', 'reject')
    gate.submitDecision('a1', 'approve')

    expect(gate.getApproved().map((a) => a.planned.id)).toEqual(['a1', 'a3'])
    expect(gate.snapshot()).toMatchObject({ total: 3, approved: 2, rejected: 1, pending: 0, complete: true })
  })

  it('refuses a decision for an action that is not in the plan', () => {
    const gate = createApprovalGate(makePlan([planned('a1', task())]))
    expect(() => gate.submitDecision('nope', 'approve')).toThrow(ApprovalError)
  })
})

describe('edits are re-validated against the contract', () => {
  it('replaces the action when the edit is valid', () => {
    const plan = makePlan([planned('a1', test1())])
    const gate = createApprovalGate(plan, { approver: 'dr.khan' })
    const edited: Action = {
      type: 'order_test',
      patientId: 'SIM-000001',
      bloodTestOrder: {
        panel: 'FBC',
        specimen: 'blood',
        priority: 'urgent',
        collection: 'now',
        clinicalDetails: 'post-discharge check',
        panelId: 'fbc',
      },
    }

    gate.submitDecision('a1', 'edit', edited)
    const approved = gate.getApproved()

    expect(approved[0]?.planned.action).toEqual(edited)
    expect(approved[0]?.decision.approvedBy).toBe('dr.khan')
    // The original plan object is untouched, so the approval screen can still show the diff.
    expect(plan.actions[0]?.action).toEqual(test1())
  })

  it('rejects an edit that breaks the contract', () => {
    const gate = createApprovalGate(makePlan([planned('a1', test1())]))
    const broken = {
      type: 'order_test',
      patientId: 'SIM-000001',
      bloodTestOrder: { panel: 'FBC', specimen: 'blood', priority: 'whenever', collection: 'now', clinicalDetails: 'x' },
    } as unknown as Action

    expect(() => gate.submitDecision('a1', 'edit', broken)).toThrow(/priority/)
    expect(gate.getApproved()).toHaveLength(0)
  })

  it('refuses an edit that changes the action type or the patient', () => {
    const gate = createApprovalGate(makePlan([planned('a1', test1())]))
    expect(() => gate.submitDecision('a1', 'edit', task())).toThrow(/cannot change the action type/)
    expect(() => gate.submitDecision('a1', 'edit', { type: 'order_test', patientId: 'SIM-000002' }))
      .toThrow(/cannot change the patient/)
  })

  it('needs the edited action when the verdict is edit', () => {
    const gate = createApprovalGate(makePlan([planned('a1', test1())]))
    expect(() => gate.submitDecision('a1', 'edit')).toThrow(ApprovalError)
  })
})

describe('validateAction', () => {
  it('accepts the verified minimum bodies', () => {
    for (const action of [
      { type: 'create_task', patientId: 'SIM-000001' },
      { type: 'order_test', patientId: 'SIM-000001' },
      { type: 'draft_prescription', patientId: 'SIM-000001' },
      { type: 'schedule_visit', patientId: 'SIM-000001' },
      { type: 'share_record', patientId: 'SIM-000001', resourceId: 'document-batch-2-001' },
      {
        type: 'messaging_action',
        patientId: 'SIM-000001',
        resourceId: 'messaging-example-1',
        expectedVersion: 1,
        messagingCommand: { kind: 'reply', body: 'on my way' },
      },
      {
        type: 'process_document',
        patientId: 'SIM-000001',
        resourceId: 'document-batch-2-001',
        expectedVersion: 1,
        documentCommand: 'file',
      },
    ]) {
      expect(validateAction(action), JSON.stringify(action)).toMatchObject({ ok: true })
    }
  })

  it('catches the shapes the server would reject', () => {
    expect(validateAction({ type: 'share_record', patientId: 'SIM-000001' }).errors).toContain(
      'action.resourceId is required',
    )
    expect(validateAction({ type: 'messaging_action', patientId: 'SIM-000001' }).ok).toBe(false)
    expect(validateAction({ type: 'nonsense', patientId: 'SIM-000001' }).ok).toBe(false)
    expect(validateAction({ type: 'create_task' }).errors).toContain('action.patientId is required')
    expect(validateAction('not an object').ok).toBe(false)
  })

  it('warns about live requirements the frozen contract does not encode', () => {
    const messaging = validateAction({
      type: 'messaging_action',
      patientId: 'SIM-000001',
      messagingCommand: { kind: 'note', body: 'seen' },
    })
    expect(messaging.ok).toBe(true)
    expect(messaging.warnings.join(' ')).toContain('conversation')

    const assign = validateAction({
      type: 'process_document',
      patientId: 'SIM-000001',
      resourceId: 'document-batch-2-001',
      expectedVersion: 1,
      documentCommand: 'assign',
    })
    expect(assign.warnings.join(' ')).toContain('clinician')
  })
})

describe('resolveApproved', () => {
  it('applies the same rules to decisions that arrive from the UI, last one winning', () => {
    const plan = makePlan([planned('a1', task()), planned('a2', test1())])
    const decisions: ApprovalDecision[] = [
      { actionId: 'a1', verdict: 'reject', approvedBy: 'dr.khan', at: 1 },
      { actionId: 'a1', verdict: 'approve', approvedBy: 'dr.khan', at: 2 },
    ]

    const approved = resolveApproved(plan, decisions)
    expect(approved.map((a) => a.planned.id)).toEqual(['a1'])
  })

  it('throws when a decision names an action the plan does not contain', () => {
    const plan = makePlan([planned('a1', task())])
    expect(() => resolveApproved(plan, [{ actionId: 'ghost', verdict: 'approve', approvedBy: 'x', at: 1 }]))
      .toThrow(ApprovalError)
  })
})
