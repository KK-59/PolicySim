# Scripts

| Script | Owner | Does |
|---|---|---|
| `watch.mjs` | Oriol | Probe NHS-SIM every 2 min; fire the snapshot on the first 200 |
| `snapshot.mjs` | Oriol | Bulk reads → `snapshot/<timestamp>/` (raw JSON, untouched) |
| `build-grid.mjs` | Kaavya | Lever combinations → `precomputed/grid.json` (the demo safety net) |
