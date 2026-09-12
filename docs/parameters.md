# Parameters

12–15 total. Every parameter shows its source tag on screen. **A parameter with no source is
flagged, never silently defaulted.**

Owner of this table: **Albert** (sourcing). Owner of the parameter set itself: **Kaavya**.

Source tags: `measured` (from the snapshot) · `documented` (from the uploaded policy or the
handbook) · `literature` (from the corpus, with a range) · `assumed` (flagged amber on screen).

## Policy-invariant primitives

Measured from the live snapshot on 12 Sep 2026 — see [calibration-findings.md](calibration-findings.md)
for how each was derived.

| Parameter | Value | Range | Units | Bounds | Source | Citation |
|---|---|---|---|---|---|---|
| A&E arrival rate (all classes) | 142 | 140–144 | /sim-day | [0, ∞) | `measured` | `attendances.createdAt`, 9 sim-days |
| Arrival rate — routine (acuity 3) | 141.7 | | /sim-day | [0, ∞) | `measured` | 1309/1312 of attendances |
| Arrival rate — urgent (acuity 2) | 0.3 | | /sim-day | [0, ∞) | `measured` | 3/1312 of attendances |
| Arrival rate — complex | | | /sim-day | | `assumed` | ⚠️ sim has no complex class; define it yourself |
| Community visit service time | 90 | — | min | [0, ∞) | `measured` | `provenance.changes`, n=7, zero variance |
| Discharge letter: sent → reviewed | 60 | — | min | [0, ∞) | `measured` | `provenance.changes`, n=20 |
| Discharge letter: reviewed → filed | 60 | — | min | [0, ∞) | `measured` | `provenance.changes`, n=8 |
| Blood result turnaround | | | min | | `documented` | handbook — not yet observed live |
| Pharmacy approval delay | | | min | | `assumed` | ⚠️ only 1 approved rx in world; not measurable yet |
| GP sessions/day | 6 | — | count | [0, 24] | `measured` | `appointments?date=2026-09-12` |
| GP usable slots/day | 90 | — | count | [0, ∞) | `measured` | 6 × (240/15 − 1 protected break) |
| Community slots/day | 4 | — | count | [0, ∞) | `measured` | `capacity-community.data.total` |
| Staffed spaces | 8 | — | count | | `measured` | `view.staffing` (4 doctors, 4 nurses) |
| GP admin share | 0.296 | 0.163–0.296 | share | [0, 1] | `literature` | `gp-workload-trends-2024`; derived 2005–2019 endpoints, not a CI |
| GP consultation time | 8 | 4.4–11 | min | [0, ∞) | `literature` | `gp-consultation-variation-1999`; old UK observational evidence |
| Routing: GP → test | | | share | [0, 1] | `assumed` | ⚠️ `fuller-stocktake-2022` supports the pathway but gives no probability |
| Routing: GP → hospital | | | share | [0, 1] | `assumed` | ⚠️ `fuller-stocktake-2022` supports the pathway but gives no probability |
| Routing: GP → community | | | share | [0, 1] | `assumed` | ⚠️ `fuller-stocktake-2022` supports the pathway but gives no probability |
| Routing: letter sent → reviewed | 0.37 | | share | [0, 1] | `measured` | 21 of 57 progressed past `sent` |
| Routing: letter → filed | 0.16 | | share | [0, 1] | `measured` | 9 of 57 filed |
| Community referral rejection | | | share | [0, 1] | `assumed` | ⚠️ no observed referral flow and no transferable literature probability |
| Hospital → community routing share | | | share | [0, 1] | `assumed` | ⚠️ effect evidence exists, but no baseline routing share in the sim |

**⚠️ Service rates are not measurable.** 1,307 of 1,312 attendances are `waiting` — the world has
had 22 actions total and nothing is being served. Arrival rates are solid; anything requiring
observed throughput is not. See the gridlock caveat in the findings doc.

## Policy levers (5–6)

Set by extraction from the uploaded document, then exposed as sliders for post-extraction
adjustment. They are **not** the way the user gets in.

| Lever | Baseline (measured) | Range | Source | Grounded? |
|---|---|---|---|---|
| Community capacity multiplier | 4 slots/day | | `measured` | ✅ best lever — small base, so thresholds are visible |
| Extra GP sessions | 6 sessions/day, 15 slots each | | `measured` | ✅ +1 session = +15 slots ≈ +17% |
| Follow-up channel mix | 33% telephone (2 of 6 sessions) | | `measured` | ✅ `session.data.mode` |
| Monitoring intensity | devices active, 484 observations | RR 0.77–0.95 is effect evidence, not intensity | `measured` base; `rpm-utilisation-2025` supporting | ⚠️ no dose-response in the sim; do not map RR to intensity |
| Hospital → community routing share | no baseline flow | outcome CIs are supporting only | `assumed` | ❌ `cochrane-hospital-at-home-2024` does not provide a routing share |
| Discharge timing (weekday vs weekend) | — | | `assumed` | ❌ sim has no weekday logic — amber on screen |

## Declared boundaries — defaulted to 0, each with a reverse breakeven

| Boundary | Default | Breakeven | Source |
|---|---|---|---|
| Induced demand (Roemer) | 0 | | declared |
| Substitution / bottleneck relocation | 0 | | declared |
| Gaming / reclassification | 0 | | declared |

**Why 0 is the honest value here.** The simulator generates 142 arrivals/day regardless of what
anyone does. Induced demand and substitution cannot occur in it, and there is no coding to game.
These are not parameters we failed to measure — they are effects the ground truth does not contain.
Declare them at 0 with a reverse breakeven and say so on screen.

## Environment axis (separate from the three worlds)

| Toggle | Maps to sim scenario | Effect | Firable by us? |
|---|---|---|---|
| Winter pressure | `winter-pressure` | Increase urgent arrivals, reduce available beds | ❌ operator-gated (403) |
| Staff shortage | `staff-shortage` | Reduce available home-visit slots | ❌ operator-gated (403) |

Both exist as real scenarios in the sim, so the toggles are faithful — but `/api/control/incidents`
rejects a team key. They stay engine toggles unless the organisers fire one for us.

## Never parameters — always derived

Waits, queue lengths, utilisation. Waiting time is convex in utilisation; 80→85% barely matters,
92→97% is catastrophic. This is why the model can extrapolate to a new policy regime: it evaluates
known mathematics at a new point rather than fitting to past commentary.

## Not modelled, and said plainly on screen

Disease progression, treatment efficacy, adherence, travel, social care.
