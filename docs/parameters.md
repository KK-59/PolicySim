# Parameters and provenance

Every numeric input to the engine is listed here. A value with no evidence is tagged `assumed`;
it is never silently presented as literature. The runtime definitions are in
[`src/contracts/baseline.ts`](../src/contracts/baseline.ts).

Source tags: `measured` (NHS-SIM snapshot), `documented` (policy or handbook),
`literature` (corpus evidence that measures the same quantity), and `assumed` (visible gap).
A supporting intervention effect is not a source for an intensity, routing share, or local capacity.

## Demand

| Contract path | Value | Range | Source | Citation or note |
|---|---:|---:|---|---|
| `arrivals.targetUtilisation` | 0.94 | 0.85-0.99 | `assumed` | No matched English-practice utilisation distribution found; likely tornado driver. |
| `arrivals.classMix.routine` | 0.80 | 0.70-0.88 | `assumed` | NHS-SIM has no GP demand mix. |
| `arrivals.classMix.complex` | 0.15 | 0.08-0.25 | `assumed` | Complex is a modelled class, absent from NHS-SIM. |
| `arrivals.classMix.urgent` | 0.05 | 0.02-0.10 | `assumed` | ED acuity mix is not a valid GP proxy. |
| `arrivals.perDay.routine` | 58.852 | 46.5-64.4 | `assumed`, derived | From utilisation, capacity, class mix and service times; not sampled independently. |
| `arrivals.perDay.complex` | 11.035 | 5.3-18.3 | `assumed`, derived | Same derivation; inherits the assumed complex share. |
| `arrivals.perDay.urgent` | 3.678 | 1.3-7.3 | `assumed`, derived | Same derivation; inherits the assumed urgent share. |
| `arrivals.edPerDay` | 142 | 140-144 | `measured` | `nhssim-calibration-2026`; 1,312 attendances over about 9 sim-days. |
| `arrivals.dischargeLettersPerDay` | 6.3 | 5-8 | `measured` | `nhssim-calibration-2026`; 57 summaries over about 9 sim-days. |

## Capacity and service

| Contract path | Value | Range | Source | Citation or note |
|---|---:|---:|---|---|
| `capacities.gpSessionsPerDay` | 6 | none | `measured` | Snapshot appointment diary. |
| `capacities.gpSlotsPerSession` | 15 | none | `measured` | 240 minutes / 15-minute slots, less one break. |
| `capacities.communitySlotsPerDay` | 4 | none | `measured` | Snapshot `capacity-community.data.total`. |
| `capacities.staffedSpaces` | 8 | none | `measured` | Snapshot staffing: 4 doctors and 4 nurses. |
| `capacities.gpAdminShare` | 0.296 | 0.163-0.296 | `literature` | `gp-workload-trends-2024`; historical endpoints derived from reported workload, not a CI. |
| `serviceTimes.gpConsultation` | 15 min | none | `measured` | Snapshot `session.data.slotMinutes`; older literature is validation only. |
| `serviceTimes.communityVisit` | 90 min | none | `measured` | `nhssim-calibration-2026`; n=7, zero variance. |
| `serviceTimes.documentReviewHop` | 60 min | none | `measured` | Snapshot elapsed transition time, not clinician effort. |
| `serviceTimes.documentReviewWork` | 4 min | 2-8 | `assumed` | NHS-SIM records elapsed status changes, not work content. |
| `serviceTimes.bloodResultTurnaround` | 120 min | none | `documented` | `nhssim-handbook`; not observed live. |
| `serviceTimes.pharmacyApproval` | 60 min | none | `assumed` | Only one approved prescription exists in the snapshot. |
| `serviceTimes.classMultiplier.routine` | 1.0 | none | `measured` | The measured 15-minute slot is the unit. |
| `serviceTimes.classMultiplier.complex` | 2.0 | 1.5-3.0 | `assumed` | Double-slot mechanism; NHS-SIM has no complex class. |
| `serviceTimes.classMultiplier.urgent` | 1.0 | 1.0-1.5 | `assumed` | No matched simulator observation. |

## Routing

| Contract path | Value | Range | Source | Citation or note |
|---|---:|---:|---|---|
| `routing.gpToTest` | 0.20 | none | `assumed` | `fuller-stocktake-2022` supports the pathway but gives no probability. |
| `routing.gpToHospital` | 0.10 | none | `assumed` | No transferable probability found. |
| `routing.gpToCommunity` | 0.05 | none | `assumed` | No transferable probability found. |
| `routing.letterSentToReviewed` | 0.37 | none | `measured` | 21 of 57 letters progressed beyond sent. |
| `routing.letterReviewedToFiled` | 0.16 | none | `measured` | 9 of 57 sent letters were filed. |
| `routing.communityRejection` | 0 | none | `assumed` | No baseline community referral flow. |

## Policy levers

Lever values are no-policy baselines. Extraction changes them only when the uploaded policy makes
an explicit commitment; otherwise a user may change them in the interface.

| Contract path | Baseline | Source | Evidence note |
|---|---:|---|---|
| `levers.communityCapacityMultiplier` | 1.0 | `measured` | No change from measured capacity. |
| `levers.extraGpSessions` | 0 | `measured` | No sessions added. |
| `levers.telephoneFollowUpShare` | 0.333 | `measured` | 2 of 6 snapshot sessions are telephone. |
| `levers.monitoringIntensity` | 1.0 | `measured` | Device observations exist; effect is not measurable. |
| `levers.hospitalToCommunityShare` | 0 | `assumed` | Hospital-at-home outcome CIs do not identify a routing share. |
| `levers.weekdayDischargeShare` | 1.0 | `assumed` | NHS-SIM has no weekday mechanism. |

## Effect sizes

| Contract path | Value | Range | Source | Citation or note |
|---|---:|---:|---|---|
| `effects.telephoneServiceMultiplier` | 0.70 | 0.55-0.90 | `assumed` | No matched duration ratio has been curated yet. |
| `effects.telephoneBaselineShare` | 0.333 | none | `measured` | Same 2-of-6 snapshot session mix; prevents double counting. |
| `effects.monitoringEscalationReduction` | 0.10 | 0-0.25 | `assumed` | `rpm-utilisation-2025` provides supporting outcome effects, not class redistribution per intensity unit. |

## Environment and boundaries

| Contract path | Value | Range | Source | Citation or note |
|---|---:|---:|---|---|
| `environment.winterDemandMultiplier` | 1.15 | 1.08-1.25 | `assumed` | Incident exists in NHS-SIM; magnitude remains unsourced. |
| `environment.winterUrgentMultiplier` | 1.60 | 1.30-2.20 | `assumed` | Incident exists in NHS-SIM; magnitude remains unsourced. |
| `environment.shortageCommunityMultiplier` | 0.60 | 0.45-0.80 | `assumed` | Incident exists in NHS-SIM; magnitude remains unsourced. |
| `boundaries.inducedDemand` | 0 | none | `assumed`, declared | NHS-SIM demand does not respond to capacity; report reverse breakeven. |
| `boundaries.substitution` | 0 | none | `assumed`, declared | Not represented in NHS-SIM; report reverse breakeven. |
| `boundaries.gaming` | 0 | none | `assumed`, declared | NHS-SIM has no coding or reclassification mechanism. |

## Outputs, not inputs

Waiting times, queue lengths and utilisation are always derived by the engine. They must never be
entered as policy parameters.

## Current sourcing priorities

The strongest unresolved quantities are `arrivals.targetUtilisation`,
`serviceTimes.classMultiplier.complex`, `serviceTimes.documentReviewWork`,
`effects.telephoneServiceMultiplier`, and the three environment multipliers. Their ranges remain
visible assumptions until matched evidence is found. Use [the coverage matrix](../corpus/coverage.md)
when reviewing tornado dominance.
