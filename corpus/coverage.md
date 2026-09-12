# Parameter evidence coverage

This table separates a source that is relevant from one that can safely supply a model value.
`Direct` means the reported quantity matches the contract field. `Supporting` means it informs a
scenario or effect but cannot be substituted for the parameter.

| Contract path | Best evidence | Status | Usable range | Decision |
|---|---|---|---|---|
| `arrivals.perDay.*` | `nhssim-calibration-2026` | direct, measured | 140-144 total arrivals/day | Use snapshot range; complex remains assumed because NHS-SIM has no complex class. |
| `capacities.gpSessionsPerDay` | `nhssim-calibration-2026` | direct, measured | none | Keep measured point; do not infer local sessions from national workforce trends. |
| `capacities.gpSlotsPerSession` | `nhssim-calibration-2026` | direct, measured | none | Keep measured point. |
| `capacities.communitySlotsPerDay` | `nhssim-calibration-2026` | direct, measured | none | Keep 4 slots/day; district-nursing standards are supporting only. |
| `capacities.staffedSpaces` | `nhssim-calibration-2026` | direct, measured | none | Keep measured point. |
| `capacities.gpAdminShare` | `gp-workload-trends-2024` | direct, literature | 0.163-0.296 | Use as broad historical prior; label as derived, not a CI. |
| `serviceTimes.gpConsultation` | `gp-consultation-variation-1999` | direct, literature | 4.4-11 minutes | Usable but old; surface caveat. |
| `serviceTimes.communityVisit` | `nhssim-handbook`, `nhssim-calibration-2026` | direct, documented/measured | none | Keep simulator's constant 90 minutes. External 5-95 minute range is heterogeneous validation evidence only. |
| `serviceTimes.documentReviewHop` | `nhssim-calibration-2026` | direct, measured | none | Keep 60 minutes per observed hop. |
| `serviceTimes.bloodResultTurnaround` | `nhssim-handbook` | direct, documented | none | Use handbook point until observed. |
| `serviceTimes.pharmacyApproval` | none | gap | none | Keep assumed and amber. |
| `routing.gpToTest` | `fuller-stocktake-2022` | supporting only | none | No probability found; keep assumed. |
| `routing.gpToHospital` | `fuller-stocktake-2022` | supporting only | none | No probability found; keep assumed. |
| `routing.gpToCommunity` | `fuller-stocktake-2022` | supporting only | none | No probability found; keep assumed. |
| `routing.letterSentToReviewed` | `nhssim-calibration-2026` | direct, measured | none | Use 0.37 point. |
| `routing.letterReviewedToFiled` | `nhssim-calibration-2026` | direct, measured | none | Use 0.16 of all sent as currently defined. |
| `routing.communityRejection` | none | gap | none | Keep assumed and amber. |
| `levers.communityCapacityMultiplier` | uploaded policy | documented at run time | policy-dependent | Extract only an explicit commitment; otherwise assume 1.0. |
| `levers.extraGpSessions` | uploaded policy | documented at run time | policy-dependent | Extract only an explicit commitment; otherwise assume 0. |
| `levers.telephoneFollowUpShare` | uploaded policy | documented at run time | policy-dependent | Baseline 0.33 is measured; a changed share must be documented or user-set. |
| `levers.monitoringIntensity` | `rpm-utilisation-2025` | supporting effect evidence | RR 0.77-0.95 around 0.86 | Do not map the RR to intensity. A separate intervention-effect field would be needed. |
| `levers.hospitalToCommunityShare` | `cochrane-hospital-at-home-2024` | supporting effect evidence | several outcome CIs | No routing-share evidence found; keep assumed unless policy states a share. |
| `levers.weekdayDischargeShare` | none | simulator boundary | none | Keep assumed; NHS-SIM has no weekday mechanism. |
| `boundaries.*` | simulator behaviour | declared boundary | reverse-breakeven only | Keep at 0 for ground-truth reproduction and report sensitivity separately. |

## Dominant-parameter handoff

The current corpus can spread the worlds directly for total arrivals, GP administrative share and
GP consultation time. It cannot honestly provide ranges for local community capacity, GP routing,
community rejection or hospital-to-community routing share. If any of those dominate the tornado,
the correct demo output is a visible evidence gap, not a borrowed effect size disguised as a prior.
