/**
 * Auto-vs-approve matrix, per action type, per permission tier (PRD §4.7).
 * Reads free; create_task + messaging_action low-risk; order_test, draft_prescription,
 * process_document file, schedule_visit always require approval.
 * OWNER: Albert. Consumed by: Oriol's agent, Elsa's approval screen.
 */

export {};
