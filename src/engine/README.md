# Engine — Kaavya

Deterministic discrete-event simulation. Contract: `run(params, seed) -> metrics`.
No global state. A slider change is a full re-run. Ten simulated years in well under a second.

Build order (PRD §8.1): single node first → verification assertions alongside → the hour-one
sensitivity check → full network → three patient classes with priority discipline.

**Not modelled, and said plainly on screen:** disease progression, treatment efficacy, adherence,
travel, social care.
