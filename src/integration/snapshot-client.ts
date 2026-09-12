/**
 * Bulk reads per PRD §4.1: /api/clock, hospital+gp documents, pharmacy-workspace,
 * community/view, attendances, gp/appointments (7 days), gp/patients (first pages),
 * plus per-patient view for the drill-down cohort only.
 * 8s timeout, two retries with backoff, raw JSON to snapshot/<timestamp>/.
 * OWNER: Oriol.
 */

export {};
