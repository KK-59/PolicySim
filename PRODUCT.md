# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing codebase answers this: React 18 + TypeScript (strict) + Vite 6, Vitest for tests.
Path alias `@` → `src/`. No CSS framework, no component library, no router present as of
2026-09-12 14:25.

Routing is a project decision recorded here because the repo had none: a hand-written hash
router rather than `react-router-dom`. Reason is product truth, not preference: the PRD makes
offline survival load-bearing (§9 "Server down at demo time: High"), the stall plan is "laptop on
snapshot, timeouts on", and a hash router works from `file://` with zero install risk on
hackathon wifi. Revisit after the event.

## Users

Two audiences at two altitudes, and the demo goes A → B.

- **Mode A, the planner.** An NHS neighbourhood planner, PCN clinical director or ICB
  commissioner. Situation: they have written or received a policy document (a board paper, a
  service specification, an ICB strategy) and must decide whether to commit to it. Job: find out
  whether the configuration it describes survives contact with reality before anyone funds it.
  Today that job is done in spreadsheets and meetings, and harm is discovered afterwards.
- **Mode B, the clinician.** A GP or care coordinator holding one named discharged patient. Job:
  choose between concrete plans for that patient and approve or reject each action before
  anything is written to a real record. Not built yet; the interface must not foreclose it.

The immediate audience on 2026-09-12 is a hackathon judging panel, several of whom model for a
living. That is an evaluation context, not a user, but it sets the bar: every number on screen
must be able to answer "where did that come from".

## Product Purpose

Policy Sandbox is the counterfactual layer NHS-SIM is missing. NHS-SIM lets you observe one
world and follow a patient through it; it cannot compare two ways of running a neighbourhood,
because a world is 50k patients, reads take ~90 seconds, and its clock moves in minutes while
the question spans years.

Upload the policy document you already wrote. It is parsed into engine parameters, each tagged
with where it came from, and run forward in three worlds: optimistic, realistic, pessimistic.
Success is not a number. Success is the user learning which of their conclusions survive all
three worlds, and under what conditions they stop holding.

## Positioning

The mechanism a neighbouring product could not truthfully copy:

1. **The document is the input.** Not sliders, not a parameter vector. A real policymaker has a
   document, not twelve numbers. "The thing you wrote is now executable."
2. **Three worlds are output percentiles, not input corners.** Parameters are sampled from their
   published ranges, ~1,000 runs execute, and P10/P50/P90 of the *outcome* are reported. Stacking
   twelve worst cases at once produces a corner of parameter space with a vanishing probability
   of occurring; it is not a pessimistic scenario, it is an impossible one.
3. **The loop closes back to the ground truth.** The recommendation is applied to the real
   NHS-SIM world with a clinician approving each action, then predicted is measured against
   observed.
4. **No LLM sits in the causal mechanism.** The LLM appears only at the boundaries: English →
   parameters, and numbers → English. Never between them.

## Operating Context

- Judged demo, 3 minutes, with a 45-second stall version. Runs on one laptop, possibly offline,
  on a projector.
- The evidence corpus, the parameter source table and the calibration findings are real
  artifacts that the interface cites, not decoration.
- The document being dropped on stage is a real NHS policy document.
- Wifi and the NHS-SIM server are both unreliable; one full 502 outage and several mid-run
  timeouts already happened today.

## Capabilities and Constraints

**Frozen contracts, changeable only by group agreement** (`src/contracts/`):

- `Params` — every engine input as a `Sourced` value: `{value, range?, bounds, source, citation?,
  label?, note?}`. `source` is one of `measured | documented | literature | assumed`.
- `Metrics` — the engine's only output, and therefore the only thing the interface can render.
  Carries `worlds`, `delta`, `findings[]`, `tornado[]`, `thresholds[]`, `flags[]`, `run`.
- `Action` — typed NHS-SIM action plus `PlannedAction`, `Plan`, `ApprovalDecision`. Verified
  against the live server, not inferred from the OpenAPI spec.

**Two percentile axes that must never be conflated on screen.** Within a run across patients is
the *tail* ("the 90th-percentile patient waited 40 days"). Across sampled runs is the *worlds*
("in the pessimistic world, that figure is X"). Both appear at once, so a headline number is
doubly indexed: `worlds.pessimistic.waits.routine.p90`.

**The direction trap.** `ThreeWorlds` carries a `direction` field. `optimistic` always means the
favourable tail, which for a wait is the *low* end. Rendering it as "the high one" is a bug.

**State of the build as of 2026-09-12 14:25.** Only the integration track exists in code
(`src/contracts/`, `src/integration/`, `src/agent/`, 175 passing tests). `src/engine/`,
`src/worlds/`, `src/clinical/`, `src/extraction/`, `src/analysis/` and all of `src/ui/` are
stub files. There is no HTML entry point. The interface must therefore render from fixtures
conforming to the frozen contracts and swap to live modules by changing an import.

**Undecided / not owned here:** the engine's internals, the RAG corpus contents, and the
clinical safe-state rules belong to other people and may land at any time.

## Brand Commitments

- Name: **Policy Sandbox**. Team 14.
- One line: *Every policy runs in three worlds. See which conclusions survive all three.*
- Voice: sober, specific, quantified, and willing to state its own limits out loud. The product
  says what it does not model. It never rounds a caveat away.
- User-pinned visual constraint, recorded not expanded: clean, white, simple. Not dense with
  numbers. Legible to someone who has never seen it. Explicitly a reaction against dashboards
  that look machine-generated.
- No login, no registration, no account. Ever.

## Evidence on Hand

Real, in the repo, and citable on screen:

- `fixtures/params.live.json`, `fixtures/params.mock.json` — 28 calibrated parameters, 14
  `measured`, 5 `documented`, 9 `assumed`, every non-assumed leaf carrying a citation.
- `fixtures/run.live.json` — a real apply against the live world: 5/6 actions applied, real
  resource ids returned, 1 recorded fallback.
- `fixtures/observed.live.json` — 30 observed events, 6 caused by us.
- `fixtures/plan.home-first.json` — a six-action plan that validates clean.
- `docs/calibration-findings.md`, `docs/nhssim-verified.md`, `demo/live-run-*.log`.

Corroboration worth putting on screen: arrivals total 142.71/sim-day from the calibration, and
an independent A&E count arrived at ~142 with sigma 1.2. Two methods, same answer.

**Absences that must not be fabricated.** There is no engine output yet, so any `Metrics` the
interface renders before Kaavya pushes is a fixture and must be labelled as one in the code. The
evidence corpus is empty, so two parameters that should read `literature` currently read
`assumed`. No demo video exists. 18 of 28 parameters have no sampling range, which means the
three worlds genuinely collapse toward each other on those parameters; the interface must not
draw a spread that the data does not support.

## Product Principles

1. **Show the delta, never the absolute.** Every outcome is a change from a locked baseline.
2. **Every number carries its provenance.** Source tag beside the value, citation on demand,
   amber on anything `assumed`. A parameter with no source is flagged, never silently defaulted.
3. **A claim is ordinal, structural, threshold or robust, never a point estimate.** Not "waits
   fall to 9.4 days". Yes "reduces median wait across most assumptions, but only while community
   capacity stays above X".
4. **State the boundary out loud.** What is not modelled appears on screen, not in a footnote.
5. **Nothing on stage may depend on the network.** Mode A is entirely client-side and offline.

## Accessibility & Inclusion

Projected demo in a bright room: contrast must hold at distance, and no finding may be carried
by hue alone, since optimistic/realistic/pessimistic is the core distinction on screen. Keyboard
operability for the demo path. Respect `prefers-reduced-motion`.
