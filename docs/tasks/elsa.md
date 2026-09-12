# Elsa — interface and delivery

**Owns:** interface, README, video capture and edit, submission, stall logistics.
**Depends on:** Kaavya's `Metrics`, Oriol's `Action`. **Both mocked until real** — build against `fixtures/` from the start and never wait for the engine.

| # | Task | Where | Done means |
|---|---|---|---|
| 1 | UI skeleton against the frozen `Metrics` interface, on fixtures | `src/ui/` | Renders with no engine and no network |
| 2 | **Upload screen and notes box** — the first fifteen seconds of the demo | `src/ui/screens/Upload.tsx` | Drop a PDF/DOCX/MD/TXT or paste. Optional free-text notes. Build early |
| 3 | Extracted-parameter view | `src/ui/screens/ExtractedParams.tsx` | Plain English, source tag per line, edit per line, amber on `assumed` |
| 4 | **The three-worlds view — the money shot. Build it before the sliders.** | `src/ui/screens/ThreeWorlds.tsx` | Three panels, P10/P50/P90 under the friendly names, delta vs baseline, median and 90th together |
| 5 | Sliders and incident toggles, as post-extraction adjustment | `src/ui/screens/Neighbourhood.tsx` | Incidents are a separate axis, not part of "pessimistic" |
| 6 | Tornado plot and threshold callouts | `src/ui/components/Tornado.tsx` | "Holds while community capacity ≥ X" |
| 7 | Clinician screens: situation → three plan timelines with bands → ranked table → why-this-won → approval → execution log → accuracy panel → Rehearsal Report | `src/ui/screens/` | Approval screen renders an `Action` list and returns approve/edit/reject per action |
| 8 | **README, video capture and edit, submission form, stall state** | root, `demo/` | Submitted early, then resubmitted after polish |

Global: 8-second network timeout everywhere. Recorded clip one keystroke away.
Stall state: laptop on snapshot, timeouts on, clip queued, post-apply screenshots open.
