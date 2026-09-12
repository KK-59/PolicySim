# The three frozen contracts

Four people can only work in parallel if the interfaces between them are fixed early. These are
the **only real blocking dependencies** in the project. Agree them in one ten-minute conversation,
commit the type definitions, then everyone works against them with mock data.

| Contract | Owner | Consumed by | File |
|---|---|---|---|
| `Params` — every parameter, its type, physical bounds, source tag | Kaavya | Elsa's sliders, Albert's source table, Oriol's extractor | [src/contracts/params.ts](../src/contracts/params.ts) |
| `Metrics` — what a run returns, including the three-world bands | Kaavya | Elsa's views, Kaavya's sensitivity code | [src/contracts/metrics.ts](../src/contracts/metrics.ts) |
| `Action` — typed action with timing offset, matching NHS-SIM's action shapes | Oriol | Albert's plans, Elsa's approval screen, Oriol's ADK tools | [src/contracts/action.ts](../src/contracts/action.ts) |

## Freeze rule

Once committed, a contract changes only by agreement in the group chat — and the person changing
it tells everyone downstream **in the same message**. Update `fixtures/` in the same PR.

## Status

| Contract | Frozen? | When | By |
|---|---|---|---|
| `Params` | ☑ drafted | 12 Sep 2026 | Kaavya (calibrated from live snapshot) |
| `Metrics` | ☑ drafted | 12 Sep 2026 | Kaavya |
| `Action` | ☐ | | Oriol — **blocking Albert and Elsa** |

Drafted, not yet agreed out loud. `Params` and `Metrics` typecheck under `--strict` and
`BASELINE` in [src/contracts/baseline.ts](../src/contracts/baseline.ts) is populated with values
measured from the live world — see [calibration-findings.md](calibration-findings.md).

## Nobody waits for real data

Mock fixtures for all three go in the repo immediately (`fixtures/`). Only Oriol's track touches
the live server.
