# Calibration findings — live snapshot, 12 Sep 2026

Measured against the live sim, world `team-4551d2471320`, sim clock paused at
**2026-09-21T12:02Z**, population **50,000**.

> **The server is up and fast.** 30–600 ms per call, no 502s. The PRD was written around
> "92-second reads this morning" — that is stale. Calibration is unblocked. Keep the offline-first
> demo posture anyway (PRD §0), but the `literature`-only fallback is no longer necessary for the
> primitives below.

## Host

Both `sim.animahacks.com` and `sim.animahealth.com` returned **byte-identical clock state and event
IDs** with the same key. They are aliases for the same world. The PRD §12 warning that "a key from
one host is meaningless on the other" did not hold today. Point everything at `animahacks.com`
anyway — it is the documented host.

## Measured primitives — these can be tagged `measured`, not `literature`

### Service times, from `provenance.changes` timestamps

Every resource carries a full transition log. Differencing consecutive change timestamps gives
service times directly. **They are deterministic** — mean equals median, zero variance:

| Transition | n | Minutes |
|---|---|---|
| `visit: schedule_visit → visit.completed` | 7 | **90** |
| `discharge-summary: sent → reviewed` | 20 | **60** |
| `discharge-summary: reviewed → filed` | 8 | **60** |
| `discharge-summary: seed → sent` | 56 | **60** |

The 90-minute community visit matches the handbook figure exactly, so that parameter upgrades from
`documented` to `measured`.

**Consequence for the engine:** the ground truth uses *constant* service times, not distributions.
Your DES should draw its stochasticity from arrivals and routing, not service. If you put a
distribution on service time, say so — it is a deliberate divergence from the simulator, and a
judge comparing predicted-vs-observed will see the spread.

### Capacities

| Thing | Value | Where |
|---|---|---|
| Community slots/day | **4** (`total: 4, remaining: 4`) | `capacity-community` resource |
| GP sessions/day | **6** | `appointments?date=` |
| Session length | **240 min** (4h) | `startsAt`→`endsAt` |
| Slot length | **15 min** | `data.slotMinutes` |
| Blocked slots/session | **1** (protected break) | `data.blockedSlots` |
| **Usable GP slots/day** | **90** = 6 × (16 − 1) | derived |
| Clinicians | 3 — Dr Maya Shah (in-person), Dr Daniel Brooks (telephone), Nurse Alex Morgan (in-person) | session `clinician` |
| Staffing | 4 doctors, 4 nurses, **8 staffed spaces** | `view.staffing` |

### Arrival rates

A&E arrivals, counted from `createdAt` across 9 full sim-days:

| Sim day | Arrivals |
|---|---|
| 13–20 Sep | 144, 142, 141, 143, 142, 142, 140, 143 |

**≈142/sim-day, σ ≈ 1.2.** Extremely stable — the generator is near-deterministic.
Acuity mix: 1,309 at acuity 3, 3 at acuity 2.

## ⚠️ The gridlock caveat — read this before calibrating anything

`staffing.waiting = 1308`. Of 1,312 attendances: **1,307 waiting**, 1 assessing, 2 take,
2 inpatient.

Nothing is being served. The sim generates arrivals continuously but only processes work when a
team submits actions, and this world has had 22 actions total. The queue has grown linearly for
nine days.

**So:** arrival rates are measurable. **Service rates are not** — there is no served flow to
measure. Do not infer a service rate from throughput here; you would measure zero.

This is also a demo point in your favour: the ground truth is a system in unbounded queue growth,
which is precisely the regime where waiting time is most convex in utilisation and where a
spreadsheet is most misleading.

Similarly, the only 7 community visits in the world were created by `team14` via `schedule_visit`.
There is **no baseline community referral flow** to measure a routing share from.

## Recommendations per lever

| Lever | Baseline | Source | Verdict |
|---|---|---|---|
| Community capacity multiplier | × **4 slots/day** | `measured` | **Grounded.** Best lever you have — the base is tiny, so the multiplier bites hard and thresholds will be visible |
| Extra GP sessions | **6 sessions/day, 15 usable slots each** | `measured` | **Grounded.** One extra session = +15 slots ≈ +17% |
| Follow-up channel mix | **2 of 6 sessions telephone (33%)** | `measured` | **Grounded.** `data.mode` is `in-person` \| `telephone` |
| Monitoring intensity | devices active; 484 observations `available` | `measured` | Grounded on the base, but the *effect* of monitoring on admission is not in the sim → effect size must be `literature` |
| Hospital → community routing share | **no baseline flow exists** | — | **Not grounded.** Tag `literature`, flag it. The discharge funnel (below) is the closest proxy |
| Discharge timing, weekday vs weekend | **the sim has no weekday logic** | — | **Not grounded.** Sessions are seeded for a fixed 7-day window from world creation (Sat 12th has 6 sessions, Sat 19th has 0). Tag `assumed`, amber on screen |

### The discharge funnel — your best routing evidence

61 discharge summaries: **4 draft → 36 sent → 12 reviewed → 9 filed.**

Of 57 that reached the GP, 21 progressed past `sent` (37%), and 9 reached `filed` (16%). That is a
real, measurable attrition through the letter pathway, and it is exactly the "manual chasing"
Chapter 3 is about. Use it for the review/filing routing probabilities.

## Recommendation on the boundaries

Keep all three at 0 with reverse breakevens, and say **why** on screen:

The simulator generates **142 arrivals/day regardless of what you do**. Induced demand cannot
occur in it, substitution cannot occur in it, and there is no coding or reclassification to game.
So these are not parameters you failed to measure — they are effects the ground truth does not
contain. Declaring them at 0 with a breakeven ("induced demand would have to exceed X% to overturn
this") is the honest treatment, and it is a stronger answer than a fitted number would be.

## Environment axis

The sim ships 8 incident scenarios, including **`winter-pressure`** ("increase urgent arrivals and
reduce available beds") and **`staff-shortage`** ("reduce available home-visit slots") — a direct
match for the two environment toggles in `Params`.

**But `/api/control/incidents` returns 403 with a team key:** *"A team API key cannot unlock
organiser access."* Confirmed operator-gated, as PRD §9 assumed. They stay engine toggles. Ask the
organisers whether team14 can have one fired — if yes, that is your regime hold-out (§4.6);
if no, the snapshot-and-advance-clock fallback is the hold-out.

Other scenarios available if organisers cooperate: `pathology-outage`, `robot-failure`,
`demand-surge`, `wearable-disconnect`, `pharmacy-shortage`, `cyber-readonly`.

## A citation for Albert

The synthetic population is calibrated against real NHS England data. Appointment resources carry:

```
provenance:        "nhs-england-gp-appointments-2025-05-v1"
calibrationPeriod: "2025-05"
sourceUrl:         https://digital.nhs.uk/data-and-information/publications/statistical/
                   appointments-in-general-practice/may-2025
sampling:          "Independent count-weighted public marginals"
```

That is a real, citable provenance chain for the demographic and appointment marginals — worth
saying on stage, and worth a row in the source table.

## API notes not in the PRD

- **`GET /api/plan-lab` → 410.** "The challenge workbook has been retired."
- **`GET /api/control/snapshot` → 403.** Operator-only; there is no cheap bulk export for teams.
  Oriol's per-endpoint snapshot client is the only route.
- **`GET /api/sites/gp/appointments` requires `?date=YYYY-MM-DD`** or it 400s with
  *"A valid date is required"*. Sessions exist only 2026-09-12 → 2026-09-18.
- **`GET /api/team`** returns `{team, world, scopes}` — useful for the watcher's health check.
- The 500-resource cap is real: `gp/view` reports `resourceTotal: 375698` against
  `resourceLimit: 500`. Page deliberately, or read the purpose-built endpoints instead.
- Someone on team14 has already advanced the clock **10,080 minutes (7 days)**. That is why the
  appointment sessions ran out. Agree with Oriol who owns the clock before anyone advances it again.
