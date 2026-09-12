# Risks and mitigations

See [PRD §9](PRD.md) for the full table.

| Risk | Likelihood | Mitigation | Owner |
|---|---|---|---|
| Server down at demo time | High | Core demo fully offline; recorded apply clip; grid lookup | Oriol |
| No usable snapshot | Medium | Seed from known scenario patients + literature params; say so on screen | Oriol / Kaavya |
| Insensitive seeded world | Medium | Hour-one sensitivity check; dynamics from queueing maths, structure from the sim; say so | Kaavya |
| Corpus returns point estimates, no ranges | Medium | Three worlds collapse. **Flag early** — Kaavya widens with a documented default | Albert |
| Extraction flaky on the day | Medium | Pre-extract the two demo documents; ship parameter sets in the bundle. Gesture survives | Oriol / Elsa |
| Contract churn late in the day | Medium | Freeze by 13:00; changes only by group agreement, announced downstream | Everyone |
