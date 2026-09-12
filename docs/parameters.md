# Parameters

12–15 total. Every parameter shows its source tag on screen. **A parameter with no source is
flagged, never silently defaulted.**

Owner of this table: **Albert** (sourcing). Owner of the parameter set itself: **Kaavya**.

Source tags: `measured` (from the snapshot) · `documented` (from the uploaded policy or the
handbook) · `literature` (from the corpus, with a range) · `assumed` (flagged amber on screen).

## Policy-invariant primitives

| Parameter | Value | Range | Units | Bounds | Source | Citation |
|---|---|---|---|---|---|---|
| Arrival rate — routine | | | /sim-day | | | |
| Arrival rate — complex | | | /sim-day | | | |
| Arrival rate — urgent | | | /sim-day | | | |
| Community visit service time | | | min | | | |
| Blood result turnaround | | | min | | | |
| Pharmacy approval delay | | | min | | | |
| GP sessions / slots per day | | | count | | | |
| Community visits per day | | | count | | | |
| Routing probabilities | | | share | | | |

## Policy levers (5–6)

Set by extraction from the uploaded document, then exposed as sliders for post-extraction
adjustment. They are **not** the way the user gets in.

| Lever | Default | Range | Source |
|---|---|---|---|
| Community capacity multiplier | | | |
| Hospital → community routing share | | | |
| Follow-up channel mix | | | |
| Monitoring intensity | | | |
| Extra GP sessions | | | |
| Discharge timing (weekday vs weekend) | | | |

## Declared boundaries — defaulted to 0, each with a reverse breakeven

| Boundary | Default | Breakeven | Source |
|---|---|---|---|
| Induced demand (Roemer) | 0 | | |
| Substitution / bottleneck relocation | 0 | | |
| Gaming / reclassification | 0 | | |

## Environment axis (separate from the three worlds)

| Toggle | Effect |
|---|---|
| Winter pressure | |
| Staff shortage | |

## Never parameters — always derived

Waits, queue lengths, utilisation. Waiting time is convex in utilisation; 80→85% barely matters,
92→97% is catastrophic. This is why the model can extrapolate to a new policy regime: it evaluates
known mathematics at a new point rather than fitting to past commentary.

## Not modelled, and said plainly on screen

Disease progression, treatment efficacy, adherence, travel, social care.
