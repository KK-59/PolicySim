# Demo runbook

3 minutes judged · 45 seconds stall. Full detail: [PRD §6](PRD.md).

## The shape

1. **Upload.** A real NHS policy document dropped onto the page. Not a dashboard.
2. **Extracted parameters**, with a source tag on every line and amber on anything assumed.
3. **Three worlds side by side** — P10 / P50 / P90. The median improves; the tail worsens.
4. **The robustness statement**, not a number: *"reduces median wait in all three worlds, but the
   90th-percentile harm to the complex tail appears in two of them."*
5. **Down to a patient** — Amira Khan, `SIM-000001`. One view across five services.
6. **Three plans, each across three worlds.** Ranked. Why plan 4 won; what plan 2 would have cost.
7. **The clinician approves.** Per action.
8. **Apply to the real world**, advance the clock, read back. **Accuracy panel.**

## Never cut

Engine + assertions · precomputed grid · document upload + extracted-parameter view ·
median/tail demo · drill-down to a patient · ADK approval step · one recorded real apply ·
accuracy panel.

## Cut from the back if behind

Narrative brief → stage-2 RAG gap-filling (fall back to hand-entered params with sources) →
hold-out → tornado.

The upload is the entry point, so it cannot be cut — but it **can** be cached. If extraction is
flaky at 17:00, ship pre-extracted parameter sets in the bundle. The gesture survives; only the
live inference is dropped. Declare it if asked.

## Stall state (45 seconds)

Laptop on snapshot · timeouts on · recorded clip one keystroke away · post-apply screenshots open.

## Rehearsed answers

**"Why not just use NHS-SIM?"** — *"It is the ground truth. We snapshot it, model its rules so
three worlds run in milliseconds instead of fifteen minutes, then apply the recommendation back to
it and measure how well we predicted it. Here's the accuracy panel."*

**"Why percentiles and not worst-case?"** — *"Stacking twelve worst cases produces a corner of
parameter space with a vanishingly small probability of occurring. That isn't a pessimistic
scenario, it's an impossible one. Sampling and taking percentiles gives three worlds that are each
actually plausible."*

## What we claim

Ordinal (A better than B?), structural (what shape, where does it break?), threshold (holds
while…), robust (does it hold in all three worlds?). **Never** "waits fall to 9.4 days."
