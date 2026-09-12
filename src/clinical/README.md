# Clinical safety and evidence — Albert

Two jobs that look like documentation and are actually load-bearing: this work defines the
ranking's hard constraints and the width of the three worlds.

Order matters — **safe state comes first**, because Kaavya needs it to build disqualification
logic into the ranking.

Ranking: hard safety fails disqualify → robustness across worlds → time-to-safe → patient burden
→ staff burden.

## Safe state

`evaluateSafeState` consumes explicit operational facts rather than free text or model judgement.
A discharged patient is safe only when discharge information has been reviewed, follow-up has a
named owner, required care is arranged, the patient has a route for help, required carer
involvement is recorded, urgent work is not overdue, and no rule-generated red flag remains open.

While a plan is running, ordinary incomplete steps are `pending`. Missing discharge information,
failed required care, overdue urgent care, and open red flags disqualify immediately. At the plan
horizon, any remaining unmet requirement disqualifies the plan from ranking.
