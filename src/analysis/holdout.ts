/**
 * Regime hold-out. Primary: calibrate on calm baseline, predict the incident world before
 * observing it. Fallback: calibrate on one snapshot, predict state after a real clock advance.
 * Incidents are operator-only — plan for it, do not depend on it.
 * OWNER: Kaavya. PRD §4.6.
 */

export {};
