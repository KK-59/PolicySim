# Policy Sandbox — Final PRD
**Team 14 · OpenAI × Anima Healthtech Hackathon · 12 Sep 2026**
**One line:** *Every policy runs in three worlds — optimistic, realistic, pessimistic. See which conclusions survive all three. Then act, with a clinician approving.*

---

## 0. Decisions already made (don't reopen)

| Decision | Choice | Why |
|---|---|---|
| Spine | Deterministic discrete-event simulation (DES) of the neighbourhood, calibrated from an NHS-SIM snapshot | Rigorous, inspectable, runs offline |
| Order | **Neighbourhood mode first, Clinician mode second** | Team preference; neighbourhood mode is the argument, clinician mode is the product |
| Where the engine runs | **Client-side TypeScript**, pure function `run(params, seed) → metrics` | No backend, no Wi-Fi dependency, instant re-runs |
| Where the LLM sits | **Only at the boundaries**: English → parameters (with sources), and numbers → English brief. Never in the causal mechanism | Defensible under questioning |
| Demo safety | **Precomputed grid** shipped as JSON; UI is a lookup | Nothing can crash on stage |
| Live sim dependency | **None** for the core demo. Real-world apply/verify is attempted live with a recorded fallback clip | Server was 502 / 92-second reads this morning |
| Voice | No | Different prize, different game |
| ML models / fine-tuning | No | A model would predict what the engine already computes. "What's next" slide only |

---

## 1. Problem

The 10-Year Health Plan commits to shifting care from hospital to community (Ch. 2) and quantifies the prize (community investment associated with lower non-elective admissions; community spend estimated to unlock acute savings — *verify exact figures and citation before putting them on a slide*). Nobody can test a neighbourhood configuration before committing to it. Planning happens in spreadsheets and meetings; harm is discovered afterwards. HSSIB's July 2025 investigation found patients coming to harm where discharge planning had not accounted for the constraints of the local health and care system.

NHS-SIM lets you observe one world and follow a patient through it. It cannot compare two ways of running the neighbourhood interactively at scale: a world is 50k patients, reads took 90 seconds this morning, and its clock moves in minutes while the question spans years.

**Policy Sandbox is the missing counterfactual layer** — and it closes the loop back to a patient and a clinician.

**Chapters addressed:** 2 (Neighbourhood Health Service design, discharge, community capacity, inverse care law), 3 (single view across services, less manual chasing), 6 (safety signals made visible and actionable; uncertainty shown, not hidden), 8 (evidence before rollout — the trial-to-adoption gap; AI + interoperable data), 9 (productivity).

---

## 2. Input

**The policymaker uploads a policy. That is the whole interaction.**

No form to fill in, no parameters to know, no sliders to understand. A planner, PCN lead or ICB commissioner drops in the document they already have — a board paper, a service specification, an ICB strategy, a chapter of the 10-Year Plan — and optionally types a line of context.

```
┌──────────────────────────────────────────────┐
│   Drop a policy document                     │
│   PDF, DOCX, MD, TXT  ·  or paste text       │
│                                              │
│   ┌────────────────────────────────────┐     │
│   │ Anything else we should know?      │     │
│   │ (optional)                         │     │
│   └────────────────────────────────────┘     │
│                                              │
│                          [ Run the sandbox ] │
└──────────────────────────────────────────────┘
```

**Optional notes box** — free text, for the constraints that are never written in the document: *"assume no extra headcount"*, *"we only care about the over-65s"*, *"this rolls out in January"*. Passed to extraction as additional context, never as a parameter override on its own.

**What happens next, without the user doing anything:**

1. Document parsed to text.
2. Extraction identifies the operational commitments it contains — what moves, from where, to where, by how much, by when.
3. Each commitment is mapped to engine parameters. Where the document gives a number, it is used and tagged **documented**. Where it doesn't, RAG over the evidence corpus supplies a value and range, tagged **literature**. Anything neither source covers is tagged **assumed** and visibly flagged.
4. The extracted parameter set is shown back to the user *before* the run, as a plain-English summary with a source tag per line and an edit affordance on each.
5. The run fires — in **three worlds** (optimistic / realistic / pessimistic, §4.5), not once.

**Why upload rather than sliders.** A real policymaker has a document, not a parameter vector. Asking them to know that "shift care to the community" means setting six sliders is the barrier that keeps tools like this unused. Uploading the artefact they already produced is the entire product insight: *the thing you wrote is now executable.*

Sliders still exist — but as **post-extraction adjustment**, not as the way in. Once the document has been turned into parameters, the user can drag any of them to explore sensitivity and thresholds. First contact is always the document.

**Demo consequence:** the opening shot is a real NHS policy document being dropped onto the page, not a dashboard. That is a far stronger first fifteen seconds.

**Fallback if extraction is weak on the day:** pre-extract two documents ahead of time and ship the parameter sets in the precomputed bundle. The upload gesture still happens on stage; the extraction is cached. Declare it if asked.

---

## 3. Architecture

```
policy document (+notes) ──► parameters (+sources) ──► DES engine ──► metrics ──► plain English brief
      ▲                                                   │
 extraction, then RAG over ~30 docs            deterministic, pure, tested
                                              │
                          Clinician mode: patient-level plans ──► ranked
                                              │
                                    ADK agent: pause for approval
                                              │
                              POST actions to real NHS-SIM world
                                              │
                           advance real clock ──► read ──► predicted vs observed
```

Rule: **no LLM output feeds another LLM output without a verifiable, deterministic step in between.**

---

## 4. Component specs

### 4.1 Snapshot (unblocks everything)
Pull bulk state with the team key the moment `/api/sites/*` returns 200. Save raw JSON to `./snapshot/<timestamp>/`. **All endpoints, auth and gotchas: §12.**

| Endpoint | Gives |
|---|---|
| `GET /api/clock` | sim time, recent events |
| `GET /api/sites/hospital/documents` | discharge summaries: id, patient, status, version |
| `GET /api/sites/gp/documents` | GP-side status (sent / reviewed / filed) |
| `GET /api/sites/pharmacy/pharmacy-workspace` | prescriptions and states, stock, quotes |
| `GET /api/sites/community/view` (no patient) | visits, capacity indicators |
| `GET /api/sites/hospital/attendances` | ED / take / inpatients |
| `GET /api/sites/gp/appointments?date=<simDate>` for 7 days | sessions and slots |
| `GET /api/sites/gp/patients?offset=…` (first pages) | cohort names/IDs; `q=discharge`, `q=COPD` etc. for counts |
| Per-patient `view` for the cohort only (20–40 patients), all five sites | detail for drill-down |

Client rules: 8-second timeout, 2 retries with backoff, cache to disk, never block the UI. Reads are the scarce resource — read bulk, not per patient.

### 4.2 Engine (TypeScript, client-side)
A queueing network with three patient classes (routine / complex / urgent) under priority discipline, GP time shared between clinic and admin (queues coupled).

```
arrivals → GP ─┬─ test → result → review → filing (loop closes)
               ├─ referral → hospital outpatient
               └─ referral → community visit ──► completes after service time
                        ▲                          │
                 rejection feeds back        capacity/day → refuse when full (409)
```

Also modelled: discharge → letter → GP review → file; prescription → approve → dispense → collect; daily capacity reset (parameter, verify). Weekend behaviour as a parameter.

**Not modelled and said plainly on screen:** disease progression, treatment efficacy, adherence, travel, social care.

Contract: `run(params, seed) → metrics`. No global state. Slider change = re-run from scratch. Ten simulated years in well under a second.

### 4.3 Parameters (12–15 total)
Split deliberately:

**Policy-invariant primitives (measured or documented):**
- Arrival rates per class — *count resources per sim-day in snapshot*
- Service / delay times — visit ≈ 90 min, blood result ≈ 120 min (*handbook*); pharmacy approval delay (*measure in Test 4*)
- Capacities — sessions/slots from appointment config; community visits/day (*measure in Test 5*)
- Routing probabilities — status transition counts / totals

**Policy-dependent quantities (never measured, always derived):** waits, queue lengths, utilisation. Waiting time is convex in utilisation (Erlang-C for multi-server); 80→85% barely matters, 92→97% is catastrophic. This is why the model can extrapolate to a new policy regime: it evaluates known mathematics at a new point rather than fitting to past commentary.

**Policy levers (5–6):** community capacity multiplier; hospital→community routing share; follow-up channel mix; monitoring intensity; extra GP sessions; discharge timing (weekday vs weekend). These are **set by extraction from the uploaded document** (§2), then exposed as sliders for post-extraction adjustment and threshold-hunting. They are not the way the user gets in.

**Declared boundaries as explicit parameters defaulted to 0, each with reverse breakeven:** induced demand (Roemer), substitution / bottleneck relocation, gaming/reclassification.

Every parameter shows its source tag: **measured / documented / literature / assumed**. A parameter with no source is flagged, never silently defaulted. All overridable before a run.

### 4.4 Calibration under outage (the realistic version)
The original 30–60-day polling calibration is **not feasible today** (server load). Calibrate from:
1. One bulk snapshot (counts → arrival rates; session config → capacities; transitions → routing).
2. Handbook-documented delays.
3. Literature for the rest (tagged).
Upgrade to the long calibration only if the server stabilises. Hour-one sensitivity check: halve all slots in the engine and confirm downstream metrics move; if nothing moves, fix before building on it.

### 4.5 The three worlds

Every policy is run in three worlds. They are **output percentiles, not input corners.**

Sample the parameters from their RAG-supplied ranges, run ~1,000 simulations, and report percentiles of the *result*:

| World | Definition |
|---|---|
| **Optimistic** | P90 of the outcome distribution |
| **Realistic** | P50 — the central estimate |
| **Pessimistic** | P10 |

**Why percentiles and not "set every parameter to its worst value."** Stacking twelve worst cases at once produces a corner of parameter space with a vanishingly small probability of occurring — it isn't a pessimistic scenario, it's an impossible one, and a judge who models for a living will say so. Sampling and taking percentiles gives you three worlds that are each actually plausible, and the machinery is the probabilistic run you were building anyway.

**What varies and what doesn't.** Optimism and pessimism are over *evidence uncertainty only* — where in its published range each effect size lands, plus the boundary parameters (induced demand, substitution, gaming) which are sampled upward from zero in the lower percentiles. **Environment is a separate axis**: winter pressure and staff shortage stay as explicit toggles, so "pessimistic" never becomes an undifferentiated bag of everything bad. Each world can be run under calm or stressed conditions independently.

**What it buys you.** The claim stops being a number and becomes a robustness statement: *"this policy reduces median wait in all three worlds, but the 90th-percentile harm to the complex tail appears in two of them."* Conclusions that survive all three are recommendations; conclusions that only appear in the optimistic world are flagged as such on screen.

Label the worlds P10 / P50 / P90 underneath the friendly names, so the method is visible without needing explanation.

### 4.6 Validation
- **Verification assertions on every run:** conservation (no work item vanishes); Little's Law L = λW; agreement with M/M/1 closed form on a degenerate config; sane behaviour at slider extremes.
- **Regime hold-out (if an incident fires):** calibrate on calm baseline, *predict* the staff-shortage / winter-pressure world before observing it, then compare. Incidents are operator-only; plan for it, don't depend on it. **Fallback hold-out:** calibrate on one snapshot, predict state after a real clock advance, compare.
- **Sensitivity:** tornado plot (expect 2–3 dominant parameters); breakeven for the headline claim. The probabilistic runs that generate the three worlds (§4.5) are the same machinery — uncertainty in the literature propagates straight into the spread between worlds.
- **Accuracy panel (Clinician mode):** predicted vs observed events after real apply — matched %, median timing error, missed, extra, with a reason per divergence. Accumulates over the day.

### 4.7 Clinician mode (the product layer)
1. From the recommended policy, list affected patients; click one (Amira Khan `SIM-000001`).
2. One view across hospital, GP, pharmacy, community, home (from snapshot).
3. OpenAI model proposes 3 concrete plans as typed action lists with timing offsets; Albert's checklist defines "safe state" and which actions are auto vs approval.
3b. **Each plan is run in all three worlds.** A plan that only wins in the optimistic world is not a recommendation. Robustness across worlds is the ranking's first tiebreak after hard safety fails.
4. Each plan runs through the same engine (patient-level twin over the snapshot). Rank: hard safety fails disqualify → time-to-safe → patient burden → staff burden. "Why plan 4 won" and "what plan 2 would have cost" generated from the event log.
5. **ADK workflow pauses for approval.** Clinician approves/edits/rejects per action.
6. Approved actions `POST /api/sites/{site}/actions` to the real world with `Idempotency-Key` and `expectedVersion`. Reads: `create_task`, `order_test` (`bloodTestOrder.panelId: "fbc"`), `draft_prescription`, `process_document` (`review` → `file`), `messaging_action`, `schedule_visit`, `share_record`. On 409 (capacity/stale): re-read, fall back (next slot or coordinator task), record it.
7. `POST /api/clock {"paused":true,"advanceMinutes":121}` → read affected views → accuracy panel.
8. Generate **Rehearsal Report** (one page): what was tested, results, who approved what, accuracy.

Permission tiers: reads free; `create_task`/`messaging_action` low-risk; `order_test`, `draft_prescription`, `process_document file`, `schedule_visit` always require approval. Red flags bypass the agent to a human task via rules.

### 4.8 Interface (React, client-side)

Two modes, same engine, two altitudes. The demo goes A → B.

- **Mode A — Neighbourhood** (planner / PCN lead / ICB). How does the neighbourhood respond to the uploaded policy: direction, shape, thresholds, who wins and who loses. Not a prediction — a stress test.
- **Mode B — Clinician** (GP / care coordinator). Take the recommended policy down to a named patient, rehearse three concrete plans through the same engine — each across all three worlds — approve the winner, apply it to the real NHS-SIM world, measure predicted vs observed.

- Landing: **upload, not a menu.** The document is the entry point (§2); mode A opens automatically once the run completes, with mode B reachable from any affected patient.
- Neighbourhood: extracted-parameter summary with source tags, then **three worlds side by side** (P10 / P50 / P90) as the primary view, with 5–6 sliders for post-extraction adjustment and incident toggles as a separate axis. Everything shown as **delta vs locked baseline**, never absolutes. Three panels read at a glance; five would not. Median and 90th-percentile side by side. Tornado plot. Threshold callouts ("holds while community capacity ≥ X"). Parameter panel with source tags. Brief.
- Clinician: patient queue → situation view → three plan timelines (each with its three-world band) → ranked table → why/what-happens → approval → execution log → accuracy panel → report.
- Global: 8-second network timeout; recorded clip one keystroke away.

### 4.9 Extraction and retrieval

**Two stages, don't conflate them.**

*Stage 1 — extraction from the uploaded document.* Parse to text (PDF/DOCX/MD/TXT). One LLM call returns a list of operational commitments with any numbers the document itself states, plus a span quote for each so the user can see where it came from. Constrained JSON. Numbers found here are tagged **documented**.

*Stage 2 — retrieval to fill gaps.* For every parameter the document doesn't pin down, RAG over the corpus supplies a value and range, tagged **literature**. Remaining gaps default to baseline and are tagged **assumed**, shown in amber.

**Corpus:** ~30 curated documents (10YP chapters, NHS Confederation community analysis, HSSIB discharge report, UCR standard, Core20PLUS5, NHS-SIM handbook) (10YP chapters, NHS Confederation community analysis, HSSIB discharge report, UCR standard, Core20PLUS5, NHS-SIM handbook). Chunk so each passage keeps its number *and* the context qualifying it. Constrained JSON decoding against the parameter schema; clamp to physical bounds.

---

## 5. What we claim (and don't)

- Not: "waits fall to 9.4 days."
- Yes: "reduces median wait across most parameter assumptions, but only while community capacity stays above X, and the 90th percentile worsens throughout."
- Headline outputs are **ordinal** (A better than B?), **structural** (what shape, where does it break?), **threshold** (holds while…), and **robust** (does it hold in all three worlds?).
- A conclusion that appears only in the optimistic world is labelled as such on screen, never presented as a finding.
- The simulator is ground truth; the engine is a fast, inspectable model of its rules over a snapshot of our real world, verified against it.
- Operational outcomes only. Synthetic people. Human approves every write.

**Rehearsed answer to "why not just use NHS-SIM?":** "It is the ground truth. We snapshot it, model its rules so three worlds run in milliseconds instead of fifteen minutes, then apply the recommendation back to it and measure how well we predicted it. Here's the accuracy panel."

---

## 6. Demo runbook (3 minutes judged · 45 seconds stall)

1. **Drop the document.** A real ICB board paper onto the page. "This is how neighbourhoods are planned today: this document, a spreadsheet and a meeting. Nobody can run it." Extracted parameters appear with source tags — *documented / literature / assumed*. "Here's what your policy actually says, in numbers, with where each one came from."
2. **Three worlds appear.** Median wait improves in all three — but the 90th-percentile harm to the complex tail shows up in two of them. "The average patient benefits. The complex tail doesn't, and that's not a fluke of one run — it survives the optimistic world too." "The average patient benefits; the complex-needs tail doesn't. Chapter 2 is built around exactly this failure."
3. **Toggle winter pressure.** The conclusion flips. "Direction, range, conditions, where it breaks."
4. **Hold-out plot** (if available): calibrated on calm, predicted the shortage. Else: sensitivity tornado.
5. **Drill to Amira.** "Here's who the tail is." Three plans rehearse across the three worlds; one goes red in the pessimistic world at a named event; winner is the one that holds in all three.
6. **Approve.** The clinician rejects one action, approves the rest. **Apply live** to NHS-SIM if up → open GP Records / Community board → it's there → advance clock → accuracy panel. **If the server hangs >10 s:** "server's under load — here's the same step recorded at 15:40," roll clip.
7. **Report.** "Every recommendation has already been rehearsed, and every rehearsal is checked against what actually happened."

Stall version: steps 2, 5, 6 only.

---

## 7. Build order and timeline (server down → optimise for offline)

| Time | Deliverable | Gate |
|---|---|---|
| Now | Contracts agreed in one conversation. Watcher (probe every 2 min). Portal: create `team14-verify-b` when up. Snapshot script ready to fire | — |
| → 13:00 | Contracts frozen (`Params`, `Metrics`, `Action`). Engine core + verification assertions. UI skeleton on mock fixtures | Hour-one sensitivity check passes |
| 13:00–13:30 | Keynote: one person attends (Oriol). Snapshot fires the moment server is up | — |
| → 15:00 | Neighbourhood mode working on snapshot-or-literature params. Precomputed grid (3 levers × 10 positions). Median/tail finding reproducible. Tornado plot | **15:00 gate:** demo-able offline |
| 15:15 | Mentor clinic 2 (Jack Clark): show it; ask about incidents and load | — |
| → 16:30 | Clinician mode: patient drill-down, three plans × three worlds through engine, ranking, ADK approval pause, real apply attempted, accuracy panel | **16:30 gate:** one real apply-and-verify recorded on video |
| → 17:15 | RAG parameter elicitation; narrative brief; Rehearsal Report | — |
| → 17:45 | Video (problem → product → impact), README (Mermaid diagram, parameters table, run instructions, team, disclaimer), first submission | — |
| → 18:15 | Polish, final submission, seed stall state, rehearse 3× | — |
| 18:30 | Submissions close. Stall. | — |

**Cut from the back if behind:** narrative brief → stage-2 RAG gap-filling (fall back to hand-entered params with sources) → hold-out → tornado. **Never cut:** engine + assertions, precomputed grid, **document upload + extracted-parameter view**, median/tail demo, drill-down to a patient, ADK approval step, one recorded real apply, accuracy panel.

**Note on the upload:** it is now the entry point, so it cannot be cut — but it *can* be cached. If extraction is flaky at 17:00, pre-extract the demo documents and ship the parameter sets in the bundle. The gesture survives; only the live inference is dropped.

---

## 8. Ownership and task breakdown

| Person | Owns |
|---|---|
| **Kaavya** | Engine, parameters, verification, three-worlds sampler, sensitivity, hold-out, accuracy diff |
| **Oriol** | Snapshot client, calibration extractor, ADK agent, real apply loop, integration, demo tech |
| **Albert** | Clinical safety model, patient plans, evidence corpus, parameter sourcing, pitch and narration |
| **Elsa** | Interface, README, video capture and edit, submission, stall logistics |

### 8.0 Freeze these three contracts before anyone builds

Four people can only work in parallel if the interfaces between them are fixed early. These are the only real blocking dependencies in the project — agree them in one ten-minute conversation, commit the type definitions, then everyone works against them with mock data.

| Contract | Owner | Consumed by |
|---|---|---|
| `Params` — every parameter, its type, physical bounds, source tag | Kaavya | Elsa's sliders, Albert's source table, Oriol's extractor |
| `Metrics` — what a run returns, including the three-world bands | Kaavya | Elsa's views, Kaavya's own sensitivity code |
| `Action` — typed action with timing offset, matching NHS-SIM's action shapes | Oriol | Albert's plans, Elsa's approval screen, Oriol's ADK tools |

**Nobody waits for real data.** Mock fixtures for all three go in the repo immediately. Only Oriol's track touches the live server.

---

### 8.1 Kaavya — the spine

Everything downstream depends on the engine, and it's the component that fails hardest if rushed.

1. **Publish `Params` and `Metrics` interfaces.** Before writing engine code. This unblocks two other people.
2. **Engine core, single node first.** Event queue, clock, arrivals, GP node with capacity. Get one queue behaving correctly before adding a network.
3. **Verification assertions, written alongside — not bolted on after.** Conservation (no work item vanishes), Little's Law (L = λW), agreement with the M/M/1 closed form on a degenerate config, sane behaviour at slider extremes. These run on every simulation.
4. **The sensitivity check.** Halve all slots, confirm downstream metrics move. If nothing moves, stop and fix it before building anything on top.
5. **Full network.** Test → result → review → filing; hospital outpatient; community visits; rejection feedback loop.
6. **Three patient classes + priority discipline.** Do not defer this — it is what produces the median-improves-tail-worsens finding, which is the demo's central moment.
7. **Three-worlds sampler.** Sample from ranges, ~1,000 runs, P10/P50/P90 of the *outcome* (§4.5). Not input corners.
8. **Precomputed grid export.** Lever combinations → JSON bundle. This is the demo safety net; do it before polish, not after.
9. **Tornado data and breakeven solver.**
10. **Hold-out comparison and the accuracy diff function** (predicted vs observed event lists, matched / missed / extra / timing error).

*Blocked by nothing.* If the snapshot never arrives, run on literature parameters tagged as such and carry on.

*Hands off to:* Oriol (accuracy diff), Elsa (metrics shape), Albert (which parameters need ranges).

---

### 8.2 Oriol — integration and the live loop

The only track exposed to server risk, which is why it's isolated here.

1. **Watcher.** Probe the sim on a short interval; fire the snapshot the instant it returns 200.
2. **Snapshot client.** Bulk reads per §4.1, 8-second timeout, two retries with backoff, cache to disk, raw JSON to `./snapshot/<timestamp>/`. Read bulk, never per-patient except for the drill-down cohort.
3. **Calibration extractor.** Snapshot → parameters: resource counts to arrival rates, session config to capacities, status transition counts to routing probabilities. Hand the numbers to Kaavya with a source tag on each.
4. **Publish the `Action` contract.** Unblocks Albert's plans and Elsa's approval screen.
5. **ADK tool wrappers**, one per action type — `create_task`, `order_test`, `draft_prescription`, `process_document`, `messaging_action`, `schedule_visit`, `share_record` — each with `Idempotency-Key`, `expectedVersion`, and a defined 409 fallback (re-read, next slot, or coordinator task, and record that it happened).
6. **Approval pause/resume** in the agent workflow.
7. **The live loop.** Approved actions POST → advance clock → re-read affected views → observed event list → hand to Kaavya's accuracy diff.
8. **Record the fallback clip the first time the loop works end to end.** Not later, not when it's pretty. The first success gets recorded.

*Hands off to:* Kaavya (calibrated params, observed events), Elsa (approval screen wiring).

---

### 8.3 Albert — clinical safety and evidence

Two jobs that look like documentation and are actually load-bearing: her work defines the ranking's hard constraints and the width of the three worlds.

1. **"Safe state" definition.** What must be true for a discharged patient before the plan counts as safe. Kaavya needs this to build disqualification logic into the ranking, so it comes first.
2. **Auto-vs-approve matrix.** Per action type, per permission tier (§4.7). Reads free; `create_task` and `messaging_action` low-risk; `order_test`, `draft_prescription`, `process_document file`, `schedule_visit` always require approval.
3. **Red-flag rules.** Conditions that bypass the agent entirely to a human task.
4. **Three plans for Amira** (`SIM-000001`), written as action lists against Oriol's `Action` schema with timing offsets. These are the thing being rehearsed; they need to be genuinely different in approach, not three variations of one idea.
5. **Evidence corpus (~30 docs).** Prioritise anything reporting a **range or confidence interval** — those ranges become the three worlds directly, so a source with bounds is worth more than three with point estimates. Chunk so each passage keeps its number *and* the context qualifying it.
6. **Parameter source table.** Every parameter tagged measured / documented / literature / assumed, with the citation. This is what appears on screen next to each extracted value, and it's what makes the "where did that number come from" question answerable.
7. **Pitch script**, then **video narration**.

*Depends on:* Kaavya's `Params` list (to know what needs sourcing), Oriol's `Action` schema (to write plans).

*Note:* if the corpus returns point estimates with no ranges, the three worlds collapse toward each other and the demo's central finding weakens. Flag it early if that's happening — Kaavya can widen with a documented default, but only if she knows in time.

---

### 8.4 Elsa — interface and delivery

Builds against mock data from the start and never waits for the engine.

1. **UI skeleton** against Kaavya's frozen `Metrics` interface, with fixtures.
2. **Upload screen and notes box (§2).** This is the first fifteen seconds of the demo and the thing that makes the project look like a product rather than a physics toy. Build it early.
3. **Extracted-parameter view.** Plain-English summary, source tag per line, per-line edit affordance, amber on anything tagged *assumed*.
4. **The three-worlds view.** Three panels side by side, P10/P50/P90 labelled underneath the friendly names, delta vs locked baseline, median and 90th percentile shown together. **This is the money shot — build it before the sliders.**
5. **Sliders and incident toggles**, as post-extraction adjustment.
6. **Tornado plot and threshold callouts** ("holds while community capacity ≥ X").
7. **Clinician screens:** patient situation view across all five services → three plan timelines each with its three-world band → ranked table → why-this-won panel → approval screen → execution log → accuracy panel → Rehearsal Report.
8. **README** (one-liner, Mermaid architecture diagram, parameter table with sources, run instructions, team, disclaimer), **video capture and edit**, **submission form**, **stall state** (laptop on snapshot, timeouts on, clip queued, post-apply screenshots).

*Depends on:* Kaavya's `Metrics`, Oriol's `Action`. Both mocked until real.

---

### 8.5 Integration moments

Four short, scheduled conversations rather than continuous coordination:

- **Kaavya ↔ Oriol** — calibration handoff. Real parameters replace literature ones; the engine should not need to change shape for this.
- **Kaavya ↔ Albert** — ranges into worlds. Confirm every dominant parameter (from the tornado) has a sourced range, not a point estimate.
- **Oriol ↔ Elsa** — approval screen wiring. The screen must render an `Action` list and return an approve/edit/reject decision per action.
- **Albert ↔ Elsa** — pitch against what's actually on screen. The script cannot describe a view that doesn't exist.

Everyone: commit early and often. Repo history proves it was built today.

---

## 9. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Server down at demo time | High | Core demo is fully offline; recorded apply clip; grid lookup |
| No usable snapshot | Medium | Seed from known scenario patients + literature params; say so |
| Insensitive seeded world | Medium | Hour-one check; dynamics from queueing maths, structure/capacities from sim; say so |
| Judges: "you built your own sim" | Medium | Rehearsed answer + accuracy panel + real apply |
| Judges: "where's the patient/clinician?" | Medium | Clinician mode is mandatory, not optional |
| Hidden sim mechanics wrong in engine | Medium | Parameters visible/editable; divergences logged and shown as findings |
| Scope overrun | High | Gates at 15:00 and 16:30; cut list |
| Incidents never fire | High | Fallback hold-out; incidents as engine toggles regardless |

---

## 10. Submission checklist

- [ ] Video hosted without sign-in (unlisted YouTube / Loom); shows problem, working product, impact
- [ ] Repo public (or judges added); README with one-liner, architecture diagram, parameter table with sources, run instructions, team, disclaimer
- [ ] Submit once early (insurance), resubmit final before 18:30
- [ ] Stall: laptop on snapshot, timeouts on, clip queued, screenshots of sim UI post-apply
- [ ] Team name and all four names on the form

---

## 11. Pitch (one breath)

"The plan says shift care to the community. We built the counterfactual layer NHS-SIM is missing: upload the policy document you already wrote, we ground it in evidence, and run the neighbourhood forward in three worlds — optimistic, realistic, pessimistic. You don't get a number, you get which conclusions survive all three: better on average, worse for the complex tail, and only while community capacity holds. Then we take it down to a person, rehearse three plans against all three worlds, a clinician approves one, it happens in the neighbourhood — and we measure how well we predicted it."

**What's next slide:** the simulator as a data generator → surrogate models and RL for the agent (Anima's stated ambition). Not today.

---

## 12. APIs and documentation

**Base URL: `https://sim.animahacks.com`** — this is the hosted deployment. Requests to `sim.animahealth.com` hit a *different* set of worlds. Point every client at `animahacks.com` and don't mix them; a key from one host is meaningless on the other.

### Human-readable

| Link | Use it for |
|---|---|
| [Quickstart](https://sim.animahacks.com/docs/quickstart/) | First call: create a world, find a patient, submit an action. Start here. |
| [API reference](https://sim.animahacks.com/docs/api/) | Auth, read/action patterns, versioning, idempotency, error codes |
| [API explorer](https://sim.animahacks.com/docs/explorer/) | Swagger UI — inspect request schemas and execute live calls. **Authorize** with the team key, then *Try it out*. |

### Machine-readable (same host)

| Path | Use it for |
|---|---|
| `/api/openapi.json` | OpenAPI 3.1 spec — feed to a client generator or to the ADK agent as tool definitions |
| `/api/catalogue` | Runtime list of sites, NHS adapters, workspaces and incident scenarios |
| `/docs/handbook.json` | Every published guide with source text, intended for agent consumption |

Generating the TypeScript client from `openapi.json` rather than hand-writing it is worth the ten minutes — it gives Oriol typed action payloads for free, which is most of the `Action` contract in §8.0.

### Auth

`POST /api/keys` is public. It creates or joins a world by team name, normalised to lowercase with all whitespace stripped. Repeating a name returns the same world and a reusable key.

```
Authorization: Bearer YOUR_TEAM_KEY      # no "Bearer" prefix inside the explorer's Authorize box
```

**The team name is a shared join code** — anyone who guesses it joins the world. Use something non-obvious. One key belongs to one world; a team key cannot select another team's world.

### The four calls that matter

| Call | Notes |
|---|---|
| `GET /api/sites/{site}/patients` | Paginated demographic directory; supports `q=` search and `offset` |
| `GET /api/sites/{site}/view?patient=SIM-000001` | That service's visible records. Omit `patient` for service-level state. |
| `POST /api/sites/{site}/actions` | Typed action. Schemas and examples live in the explorer. |
| `POST /api/clock` | `{"paused": true, "advanceMinutes": N}` — processes scheduled results, visits, deliveries |

Sites: `gp`, `hospital`, `pharmacy`, `community`, `wearables`.

NHS-shaped adapters available: PDS (FHIR Patient), ODS (FHIR Organization), DoS (HealthcareService), e-RS (ServiceRequest — create / accept / **reject**), EPS + prescription tracker, GP Connect Tasks, MESH messaging, Shared Care Documents, pathology and radiology DiagnosticReports, and capacity-backed Appointments.

### Gotchas that will cost an hour each

- **`view` caps at 500 resources.** Page with `limit` / `offset`; check `resourceTotal`, `resourceOffset`, `resourceLimit`. A view is a projection of *visible* records, not a full export, and it never exposes hidden scheduled events.
- **Stepping a running clock returns `409`.** Always send `paused: true` alongside `advanceMinutes`.
- **`expectedVersion`** on any update, or you get a `409` on a stale write.
- **`Idempotency-Key` header** on retries after an uncertain network response. Reuse the original request *and* key; a changed body with the same key returns a conflict. `clientRequestId` in the body is the alternative; the header wins if both are present.
- **`501` is deliberate** — a documented unsupported capability, not a bug. Use the alternative the reference names.
- **Incident scenarios are operator-gated.** Confirm with organisers whether the team can fire them; if not, incidents stay as engine toggles only (§9).
- **Organisers can see the request log** — method, redacted path, status, duration, referenced patient IDs. Keep the call pattern sane; don't hammer it for replicates.
