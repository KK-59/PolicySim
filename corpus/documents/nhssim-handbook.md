# NHS-SIM Handbook

- ID: nhssim-handbook
- Publisher: Anima Health
- Year: 2026
- Source: ../../docs/nhssim-verified.md
- Parameters: serviceTimes.communityVisit, serviceTimes.documentReviewHop, serviceTimes.bloodResultTurnaround
- Range or CI: no
- Evidence kind: documented
- Applicability: direct

## Evidence

The local verification notes retain the handbook's stated workflow timings and API semantics used by the simulator. Community visits are documented as 90 minutes and discharge-document transitions as 60 minutes per hop.

## Modelling use and caveats

Use these values only for the synthetic NHS-SIM world. They are documented simulator mechanics, not estimates of real NHS performance and they supply no uncertainty range.
