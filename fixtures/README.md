# Mock fixtures

**Nobody waits for real data.** These go in the repo immediately, before anything works.

| File | Shape | Owner |
|---|---|---|
| `params.mock.json` | A complete `Params` object with a source tag on every field | Kaavya |
| `metrics.mock.json` | A complete `Metrics` object including the three-world bands | Kaavya |
| `actions.mock.json` | Three plans for SIM-000001 as `Action[]` with timing offsets | Albert |
| `extracted.mock.json` | What extraction returns: commitments + span quotes + source tags | Oriol |
| `observed.mock.json` | An observed event list, for testing the accuracy diff offline | Oriol |

Keep them valid against the contracts. If a contract changes, these change in the same PR.
