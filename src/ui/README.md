# Interface — Elsa

Two modes, same engine, two altitudes. The demo goes A → B.

- **Mode A — Neighbourhood** (planner / PCN lead / ICB): how the neighbourhood responds to the
  uploaded policy. Direction, shape, thresholds, who wins and who loses. Not a prediction — a
  stress test.
- **Mode B — Clinician** (GP / care coordinator): the recommended policy down to a named patient.

**Landing is the upload, not a menu.** Mode A opens automatically once the run completes; Mode B
is reachable from any affected patient.

Build order (PRD §8.4): skeleton on fixtures → upload screen → extracted-parameter view →
**three-worlds view (the money shot — before the sliders)** → sliders and incident toggles →
tornado and thresholds → clinician screens.

House rules:
- Everything is **delta vs locked baseline**, never absolutes.
- Median and 90th percentile always shown together.
- P10 / P50 / P90 labelled underneath the friendly names, so the method is visible.
- Anything tagged `assumed` is amber.
- A finding that appears only in the optimistic world is labelled as such on screen.
- Three panels read at a glance; five would not.
- Global 8-second network timeout. Recorded clip one keystroke away.

Build against `fixtures/`. Never wait for the engine.
