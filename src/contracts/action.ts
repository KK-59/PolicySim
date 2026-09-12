/**
 * Action — a typed action with a timing offset, matching NHS-SIM's action shapes.
 * OWNER: Oriol. CONSUMED BY: Albert (patient plans), Elsa (approval screen), Oriol (ADK tools).
 * PRD §4.7, §12. FREEZE BEFORE ANYONE BUILDS.
 *
 * TODO(oriol): publish this early — it unblocks Albert's three plans and Elsa's approval screen.
 *
 * Shape to define:
 *   - ActionType: 'create_task' | 'order_test' | 'draft_prescription' | 'process_document'
 *                 | 'messaging_action' | 'schedule_visit' | 'share_record'
 *   - Per-type payload, matching what POST /api/sites/{site}/actions actually expects
 *     (e.g. order_test → bloodTestOrder.panelId: "fbc").
 *   - site, patientId, offsetMinutes (timing relative to plan start).
 *   - Idempotency-Key and expectedVersion on every write.
 *   - PermissionTier: 'read' | 'low-risk' | 'requires-approval' (Albert's matrix, PRD §4.7).
 *   - ApprovalDecision: approve / edit / reject, per action.
 *   - A defined 409 fallback per type: re-read, next slot, or coordinator task — and record
 *     that the fallback happened.
 *   - Plan: an ordered Action[] plus an id and a one-line rationale.
 */

export {};
