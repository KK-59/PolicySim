# Parameter evidence coverage

This matrix answers a stricter question than search relevance: can a source safely supply this
exact engine quantity? `Direct` means yes. `Supporting` evidence may justify a mechanism or
scenario, but cannot be substituted for the model field.

| Contract field or group | Best evidence | Status | Usable range | Decision |
|---|---|---|---|---|
| `arrivals.targetUtilisation` | none | gap | none | Keep 0.85-0.99 visibly assumed. This is likely a dominant tornado input. |
| `arrivals.classMix.*` | none | gap | none | Keep assumed. ED acuity is not a GP demand-mix proxy. |
| `arrivals.perDay.*` | derived from utilisation, capacity, mix and service time | derived | propagated only | Never retrieve or perturb independently. |
| `arrivals.edPerDay` | `nhssim-calibration-2026` | direct, measured | 140-144/day | Use snapshot range; keep separate from GP demand. |
| `arrivals.dischargeLettersPerDay` | `nhssim-calibration-2026` | direct, measured | 5-8/day | Use snapshot range. |
| `capacities.gpSessionsPerDay` | `nhssim-calibration-2026` | direct, measured | none | Keep measured point. |
| `capacities.gpSlotsPerSession` | `nhssim-calibration-2026` | direct, measured | none | Keep measured point. |
| `capacities.communitySlotsPerDay` | `nhssim-calibration-2026` | direct, measured | none | Keep 4 slots/day; district-nursing standards are supporting only. |
| `capacities.staffedSpaces` | `nhssim-calibration-2026` | direct, measured | none | Keep measured point. |
| `capacities.gpAdminShare` | `gp-workload-trends-2024` | direct, literature | 0.163-0.296 | Use broad historical endpoints; label as derived, not a CI. |
| `serviceTimes.gpConsultation` | `nhssim-calibration-2026` | direct, measured | none | Keep the simulator's 15-minute slot. Older 4.4-11 minute literature is validation only. |
| `serviceTimes.communityVisit` | `nhssim-handbook`, `nhssim-calibration-2026` | direct, measured | none | Keep the simulator's constant 90 minutes. External 5-95 minute variation is supporting only. |
| `serviceTimes.documentReviewHop` | `nhssim-calibration-2026` | direct, measured | none | Keep 60-minute elapsed turnaround; it is not work content. |
| `serviceTimes.documentReviewWork` | none | gap | none | Keep 2-8 minutes assumed until matched workflow evidence is curated. |
| `serviceTimes.bloodResultTurnaround` | `nhssim-handbook` | direct, documented | none | Use handbook point until observed. |
| `serviceTimes.pharmacyApproval` | none | gap | none | Keep assumed. |
| `serviceTimes.classMultiplier.*` | none | gap | none | Routine is the measured unit; complex and urgent multipliers remain assumptions. |
| `routing.gpToTest` | `fuller-stocktake-2022` | supporting only | none | No probability found; keep assumed. |
| `routing.gpToHospital` | `fuller-stocktake-2022` | supporting only | none | No probability found; keep assumed. |
| `routing.gpToCommunity` | `fuller-stocktake-2022` | supporting only | none | No probability found; keep assumed. |
| `routing.letterSentToReviewed` | `nhssim-calibration-2026` | direct, measured | none | Use 0.37. |
| `routing.letterReviewedToFiled` | `nhssim-calibration-2026` | direct, measured | none | Use 0.16 of all sent. |
| `routing.communityRejection` | none | gap | none | Keep assumed. |
| `levers.communityCapacityMultiplier` | uploaded policy | documented at run time | policy-dependent | Extract only an explicit commitment; otherwise use baseline 1.0. |
| `levers.extraGpSessions` | uploaded policy | documented at run time | policy-dependent | Extract only an explicit commitment; otherwise use 0. |
| `levers.telephoneFollowUpShare` | snapshot or uploaded policy | direct | policy-dependent | Baseline 1/3 is measured; changes must be documented or user-set. |
| `levers.monitoringIntensity` | snapshot or uploaded policy | direct for intensity only | policy-dependent | The baseline is 1.0; literature outcome RRs are not intensity values. |
| `levers.hospitalToCommunityShare` | hospital-at-home reviews | supporting only | outcome CIs only | No routing-share evidence found; keep assumed unless policy states a share. |
| `levers.weekdayDischargeShare` | none | simulator boundary | none | Keep assumed; NHS-SIM has no weekday mechanism. |
| `effects.telephoneServiceMultiplier` | `ten-year-plan-ch3-2025` | mechanism only | none | Keep 0.55-0.90 assumed; find matched telephone versus face-to-face duration evidence. |
| `effects.telephoneBaselineShare` | `nhssim-calibration-2026` | direct, measured | none | Use 1/3 and do not sample independently. |
| `effects.monitoringEscalationReduction` | `rpm-utilisation-2025`, `remote-vitals-hospital-at-home-2024` | supporting only | outcome RRs include null | Keep 0-0.25 assumed. Reviews do not measure class redistribution per intensity unit. |
| `environment.winterDemandMultiplier` | none | gap | none | Keep 1.08-1.25 assumed. |
| `environment.winterUrgentMultiplier` | NHS-SIM incident description | mechanism only | none | Keep 1.3-2.2 assumed; the incident does not expose its magnitude. |
| `environment.shortageCommunityMultiplier` | NHS-SIM incident description | mechanism only | none | Keep 0.45-0.8 assumed; the incident does not expose its magnitude. |
| `boundaries.*` | simulator behaviour | declared boundary | reverse breakeven only | Keep at 0 for ground-truth reproduction and report sensitivity separately. |

## Dominant-parameter handoff

After every grid build, compare the top tornado rows with this matrix. A dominant row passes the
handoff only when it has a direct measured, documented, or literature range. A supporting effect
interval does not count.

The highest-priority unresolved inputs are target GP utilisation, complex-patient share and service
multiplier, document-review work, telephone service-time ratio, and the environment magnitudes.
If they dominate, the honest demo result is a visible evidence gap or reverse breakeven, not a
borrowed number relabelled as literature.
