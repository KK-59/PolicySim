# Oriol — integration and the live loop

**Owns:** snapshot client, calibration extractor, ADK agent, real apply loop, integration, demo tech.
**Hands off to:** Kaavya (calibrated params, observed events), Elsa (approval screen wiring).

The only track exposed to server risk, which is why it is isolated here. Nothing in the core demo
may depend on the live server.

| # | Task | Where | Done means |
|---|---|---|---|
| 1 | **Watcher** — probe every ~2 min, fire the snapshot on the first 200 | `scripts/watch.mjs` | Running now, in the background |
| 2 | **Snapshot client** — bulk reads per PRD §4.1, 8s timeout, two retries with backoff | `src/integration/snapshot-client.ts` | Raw JSON in `snapshot/<timestamp>/`. Bulk only, except the 20–40 patient cohort |
| 3 | **Calibration extractor** — counts → arrival rates, session config → capacities, transitions → routing | `src/integration/calibration.ts` | Numbers handed to Kaavya, each with a source tag |
| 4 | **Publish the `Action` contract** — unblocks Albert's plans and Elsa's approval screen | `src/contracts/action.ts` | Committed and announced early |
| 5 | ADK tool wrappers, one per action type, each with `Idempotency-Key`, `expectedVersion` and a defined 409 fallback | `src/agent/tools.ts` | 409 → re-read → next slot or coordinator task, **and record that it happened** |
| 6 | Approval pause/resume in the agent workflow | `src/agent/approval.ts` | Nothing writes without a per-action approval |
| 7 | **The live loop** — POST → advance clock → re-read → observed event list | `src/agent/live-loop.ts` | Handed to Kaavya's accuracy diff |
| 8 | **Record the fallback clip the first time the loop works end to end** | `demo/` | Recorded on the FIRST success. Not later, not when it is pretty |

Also: attend the 13:00 keynote (one person, and it is you), keep the key out of git, and own
demo tech on the day.
