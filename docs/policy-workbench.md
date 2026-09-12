# Policy Workbench

The Policy Workbench turns a plain-language macro policy into explicit simulator actions, requires batch approval, and compares three fresh matched worlds:

- Control: no action, with the same elapsed simulation time.
- Policy A: community visits only.
- Policy B: visits plus the selected GP task, patient message, and diagnostic interactions.

## Run locally

Copy `.env.example` to `.env` and set `NHSSIM_BASE_URL` and `NHSSIM_TEAM_KEY`, then run:

```bash
npm install
npm run dev
```

The React UI is available at `http://127.0.0.1:4173/prevention`. Vite proxies `/api` to the policy API on port 4174.

## Code map

- `src/extraction/policy-workbench.ts`: deterministic policy interpretation, validation, action previews, and eligibility rules.
- `src/clinical/prevention/controlled-experiment.ts`: matched-world execution and API-derived outcome measurement.
- `src/dashboard/server.ts`: policy HTTP API and asynchronous experiment jobs.
- `src/ui/screens/PolicyWorkbench.tsx`: policy editing, batch approval, progress, receipts, and comparison charts.

All NHS-SIM network requests go through `src/integration/nhssim-client.ts`. The experiment creates worlds sequentially to reduce transient gateway failures, retries idempotent calls, and never retries clock advancement.

## Evidence boundary

The report contains direct simulator resource counts, statuses, timestamps, and quantities derived from those fields. It does not invent clinical outcomes, calculate a health score, or claim that an observed association is causal. The live resolver currently supports community policies; appointment, diagnostics, and pharmacy policies remain inspectable previews.

## Verification

```bash
npm run typecheck
npm test
npm run build
```
