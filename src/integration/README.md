# Integration — Oriol

The only track exposed to server risk, which is why it is isolated here. Nothing else in the
repo may import from a live-network module at demo time.

Rules: 8-second timeout, two retries with backoff, cache to disk. Read **bulk**, never
per-patient except for the 20–40 patient drill-down cohort. Raw JSON lands in
`snapshot/<timestamp>/` untouched — parse downstream, never in the fetch.

All endpoints, auth and gotchas: PRD §4.1 and §12.
