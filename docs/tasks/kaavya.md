# Kaavya — the spine

**Owns:** engine, parameters, verification, three-worlds sampler, sensitivity, hold-out, accuracy diff.
**Blocked by:** nothing. If the snapshot never arrives, run on literature parameters tagged as such and carry on.
**Hands off to:** Oriol (accuracy diff), Elsa (metrics shape), Albert (which parameters need ranges).

Everything downstream depends on the engine, and it is the component that fails hardest if rushed.

| # | Task | Where | Done means |
|---|---|---|---|
| 1 | **Publish `Params` and `Metrics`** — before writing engine code. Unblocks two people. | `src/contracts/` | Committed, announced, Elsa and Oriol are building against them |
| 2 | Engine core, **single node first** — event queue, clock, arrivals, GP node with capacity | `src/engine/` | One queue behaves correctly before any network exists |
| 3 | **Verification assertions, written alongside** — conservation, Little's Law, M/M/1 on a degenerate config, sane at slider extremes | `src/engine/assertions.ts` | They run on every simulation, not on demand |
| 4 | **The sensitivity check** — halve all slots, confirm downstream metrics move | `tests/` | It moves. If it does not, stop and fix before building on it |
| 5 | Full network — test → result → review → filing; hospital outpatient; community visits; rejection feedback | `src/engine/nodes.ts` | Loop closes; capacity refuses when full |
| 6 | **Three patient classes + priority discipline.** Do not defer. | `src/engine/classes.ts` | Median improves while the tail worsens — the demo's central moment |
| 7 | Three-worlds sampler — sample from ranges, ~1,000 runs, P10/P50/P90 of the **outcome** | `src/worlds/` | Not input corners. Environment is a separate axis |
| 8 | **Precomputed grid export** — lever combinations → JSON | `precomputed/grid.json` | Done before polish, not after. The demo cannot crash |
| 9 | Tornado data and breakeven solver | `src/analysis/` | 2–3 dominant parameters identified; each has a sourced range from Albert |
| 10 | Hold-out comparison and the accuracy diff | `src/analysis/` | Predicted vs observed → matched / missed / extra / timing error, reason per divergence |

**Contract discipline:** `Params` and `Metrics` are yours, which means changing them is a cost you
impose on three other people. Get them right once, in step 1.
