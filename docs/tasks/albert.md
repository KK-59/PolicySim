# Albert — clinical safety and evidence

**Owns:** clinical safety model, patient plans, evidence corpus, parameter sourcing, pitch and narration.
**Depends on:** Kaavya's `Params` list (to know what needs sourcing), Oriol's `Action` schema (to write plans).

Two jobs that look like documentation and are actually load-bearing: this work defines the
ranking's hard constraints and the width of the three worlds.

| # | Task | Where | Done means |
|---|---|---|---|
| 1 | **"Safe state" definition** — what must be true for a discharged patient before a plan counts as safe | `src/clinical/safe-state.ts` | **First.** Kaavya blocks on this for the ranking's disqualification logic |
| 2 | Auto-vs-approve matrix, per action type, per tier | `src/clinical/approval-matrix.ts` | Reads free; `create_task`/`messaging_action` low-risk; `order_test`, `draft_prescription`, `process_document file`, `schedule_visit` always approved |
| 3 | Red-flag rules — conditions that bypass the agent to a human task | `src/clinical/red-flags.ts` | Rules, not model judgement |
| 4 | **Three plans for Amira Khan** (`SIM-000001`) as `Action[]` with timing offsets | `src/clinical/plans.ts` | Genuinely different in approach — not three variations of one idea |
| 5 | **Evidence corpus (~30 docs)** — prioritise anything reporting a range or CI | `corpus/` | Chunked so each passage keeps its number **and** the context qualifying it |
| 6 | Parameter source table — every parameter tagged `measured` / `documented` / `literature` / `assumed`, with citation | `docs/parameters.md` | This is what appears on screen. It answers "where did that number come from" |
| 7 | Pitch script, then video narration | `docs/pitch.md` | Written against what is actually on screen, not what we hoped for |

⚠️ **Flag early if the corpus is returning point estimates with no ranges.** The three worlds
collapse toward each other and the demo's central finding weakens. Kaavya can widen with a
documented default — but only if she knows in time.
