/**
 * Approval pause/resume. Clinician approves / edits / rejects PER ACTION.
 * Tiers: reads free; create_task + messaging_action low-risk; order_test, draft_prescription,
 * process_document file, schedule_visit ALWAYS require approval.
 * Red flags bypass the agent entirely to a human task, by rule.
 * OWNER: Oriol, matrix from Albert.
 */

export {};
