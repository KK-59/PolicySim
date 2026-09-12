# Integration track: what exists, what it does, what to trust

Oriol's track (snapshot, calibration, `Action` contract, agent tools, approval, live apply loop).
Written so the four parts can be assembled without anyone having to read the code first.

**Status: complete and working.** 175 tests, typecheck clean, PR #1 open against `main`.
Both hard gates from `docs/timeline.md` cleared: demo-able offline, and one real apply-and-verify
against the live world.

---

## 1. Run it

```bash
npm install
npm run typecheck     # tsc --noEmit
npm test              # vitest, 175 tests, never touches the network
npm run dev           # Vite dev server (UI)

npm run snapshot      # bulk-read the live world into snapshot/<ISO>/
npm run calibrate     # live read -> engine parameters in Kaavya's Params shape
npm run liveloop      # the demo: approve a plan, apply it for real, observe what happened
```

`npm run liveloop` flags: `--patient SIM-000004`, `--reject a4`, `--no-retarget`, `--plan <path>`.

Secrets live in `.env` (gitignored). Copy `.env.example` and fill in `NHSSIM_TEAM_KEY`.

---

## 2. The one thing that matters most

**The OpenAPI spec understates the contract.** `components.schemas.Action` marks only `type` as
required and enforces everything else server-side, so a request that validates against the spec
can still be rejected. Every shape in `src/contracts/action.ts` was derived by probing the live
server instead. Full findings: **[docs/nhssim-verified.md](nhssim-verified.md)**.

The wire body is **flat**: `type` plus type-specific fields at the top level. There is no nested
payload object. The contract mirrors that exactly, so anything that typechecks is something the
server accepts.

---

## 3. Modules

| File | Lines | What it does |
|---|---|---|
| `src/contracts/action.ts` | 233 | **Frozen contract.** `Action`, `PlannedAction`, `Plan`, `ApprovalDecision`, `PermissionTier`, `AppliedAction` |
| `src/integration/nhssim-client.ts` | 196 | The only thing that calls the network. Auth, timeout, bounded retry, typed `ConflictError` |
| `src/integration/snapshot-client.ts` | 243 | Bulk-reads every site into `snapshot/<ISO>/` with a manifest |
| `src/integration/watcher.ts` | 59 | `probeUntilUp` against `/healthz` |
| `src/integration/calibration.ts` | 812 | Live world read -> source-tagged parameters |
| `src/integration/calibration-to-params.ts` | 715 | Maps those onto Kaavya's `Params`, with Wilson-interval ranges |
| `src/agent/tools.ts` | 445 | Seven typed wrappers, one per action type, each with a defined 409 fallback |
| `src/agent/approval.ts` | 397 | Per-action approval gate and contract re-validation |
| `src/agent/live-loop.ts` | 367 | POST -> advance clock -> read observed events -> hand off |

Tests: `approval` 15, `tools` 12, `live-loop` 14, `calibration` 23, `calibration-to-params` 101,
`snapshot-client` 10. **Every test uses a stub; none touch the live server.**

---

## 4. Handoffs

### To Kaavya (engine)

`npm run calibrate` writes **`fixtures/params.measured.json`** in your `Params` shape.

- **28 parameters**: 14 `measured`, 5 `documented`, 9 `assumed`. No non-`assumed` leaf lacks a
  citation; `sourced()` throws at construction if one does.
- **Arrivals total 142.71/sim-day** (97.0 routine GP + 43.8 urgent + 2.2 complex). Your
  independent A&E count was ~142 with sigma 1.2. Two different methods, same answer. That
  corroboration is the strongest evidence in the parameter set, and it is worth saying on stage.
- **18 of 28 have no sampling `range`.** Per your own contract comment, the three worlds collapse
  toward each other on those. This is the open half of the "ranges into worlds" integration
  moment and it needs Albert.
- Ranges, where present, are **Wilson score intervals** computed from the counts that produced the
  share, not invented spreads.

The live loop writes two files:
- **`fixtures/observed.live.json`** — flat `ObservedEvent[]`, oldest first, for the accuracy diff.
- **`fixtures/run.live.json`** — the whole run: what was applied, which fallbacks fired, and which
  observation windows were lost.

`ObservedEvent` is `{id, time, type, actor, detail, causedByUs, atSimMinutes, sourceActionId?, site?}`.

> **`causedByUs` excludes `clock.changed`.** Those carry our team as actor but are the loop
> stepping the clock, not clinical writes. Counting them doubled the number.

> **Check `observationGaps` before trusting the event list.** A non-empty array means a window was
> never read back, so absence of events there is not evidence the world was idle.

### To Albert (clinical)

- `Plan` is `{id, patientId, rationale, actions: PlannedAction[]}`; `PlannedAction` carries `id`,
  `site`, `offsetMinutes`, `tier`, `rationale`.
- `offsetMinutes` is ours, not the server's. The loop realises it by advancing the clock.
- **`tier: 'requires-approval'` can never auto-approve.** `low-risk` only auto-approves behind an
  explicit flag that defaults to false and that the CLI never passes.
- Worked example: **`fixtures/plan.home-first.json`**, six actions, validates clean.
- Four of seven types need only `patientId`. `share_record` needs `resourceId`;
  `messaging_action` needs a conversation `resourceId` + `expectedVersion`; `process_document`
  needs `resourceId` + `expectedVersion` + `documentCommand`.
- **`process_document` is stateful and one-shot**: `sent -> assign -> review -> file`. `assign`
  needs `clinician`, `review` needs `text`. A letter that has been reviewed cannot be reviewed
  again, so each rehearsal consumes one.

### To Elsa (UI)

- Approval screen renders `PlannedAction[]` and returns one `ApprovalDecision` per action:
  `{actionId, verdict: 'approve'|'edit'|'reject', edited?, approvedBy, at}`. Never a blanket approve.
- `verdict: 'edit'` replaces the `Action`; it is re-validated at the loop door regardless of any
  upstream validation, so the screen cannot let an invalid action through.
- Drive it with `createApprovalGate(plan)` -> `pending()`, `submitDecision(...)`, `snapshot()`,
  `getApproved()`.
- **`fixtures/params.mock.json` now holds real calibrated numbers with real source tags**, so the
  parameter panel and its `measured`/`documented`/`assumed` badges can be built against truth.
  It was an empty object until 14:20.

---

## 5. Proven against the live world

Most recent run (`npm run liveloop`, patient SIM-000004):

```
5/6 actions applied      real resource ids returned (r-13530, ...)
1 fallback fired         coordinator-task, recorded in AppliedAction.fallback
30 observed events       6 caused by us, for a 6-action plan
0 observation gaps
```

An earlier run fired **all three** conflict classes and recorded each: stale version -> re-read ->
retry -> succeeded; invalid transition -> coordinator task; stale version on a conversation ->
recovered.

The sixth action fails on `"No service capacity"` — diagnostics is genuinely saturated in this
world. That is the world pushing back, and the system escalating to a human rather than forcing
it. Worth demoing rather than hiding.

---

## 6. Operational warnings

**The server is unreliable.** One full outage (502 on everything including `/healthz`) and several
mid-run timeouts. Consequences:

- The offline precomputed grid is **load-bearing**, not a nice-to-have.
- Mode A (neighbourhood, three worlds) never needs the network: the engine is client-side and the
  snapshot is on disk. It is safe.
- Mode B (clinician, live apply, accuracy) **cannot** be faked. The accuracy panel is by definition
  predicted vs observed. If the server is down there is no observed. The recorded clip is the only
  fallback for that half.

**`POST /api/clock` is never retried**, because it carries no idempotency key and a retry advances
the world twice. A failed advance is recorded as an `observationGap` and the run continues.

**The clock has been advanced during testing** (roughly 90+ sim-minutes across rehearsals). Any
baseline measured before ~13:30 may have moved.

**Two sites are permanently unreadable with a team key**: `control` (403) and `legacy` (501). The
snapshot records them as expected failures rather than treating the run as broken.

---

## 7. Known gaps

- **18 parameters without a sampling range** (section 4). The most consequential open item.
- Resume assumes the clock sits at the last applied offset; after a real mid-run crash it can be
  one gap behind. Not exercised by the demo path.
- `approval.ts` treats the contract's `clinician`/`text` requirements as warnings, not errors, so
  an edit that drops `text` from a review passes validation and then 409s live.
- A rejected action produces no `AppliedAction`, so a UI execution log will never show a skipped row.
- The corpus (`corpus/sources.md`) is empty, so two parameters that should be `literature` are
  tagged `assumed`. They upgrade the moment Albert indexes a source.

## 8. Not done

- **The fallback demo clip is not recorded.** Seven runs are logged under `demo/*.log`, but no
  video exists. Given the server's reliability this is the highest-value remaining task.
