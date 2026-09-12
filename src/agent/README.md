# ADK agent and the live loop — Oriol

One tool wrapper per action type, each with `Idempotency-Key`, `expectedVersion` and a defined
409 fallback (re-read → next slot → coordinator task, and record that it happened).

**The workflow pauses for approval.** Nothing writes to the real world without a clinician
approving that specific action. Permission tiers come from Albert's matrix (`src/clinical/`).

**Record the fallback clip the first time the loop works end to end.** Not later, not when it is
pretty. The first success gets recorded.
