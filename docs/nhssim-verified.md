# NHS-SIM: what the server actually accepts

Verified by probing the live server on 12 Sep 2026, not read off the OpenAPI spec.

**The spec understates the contract.** `components.schemas.Action` marks only `type` as
required and enforces everything else server-side, so a body that validates against the
spec can still be rejected. Trust this table instead.

Base URL `https://sim.animahacks.com`. Auth `Authorization: Bearer <NHSSIM_TEAM_KEY>`.
Write endpoint `POST /api/sites/{site}/actions` with an `Idempotency-Key` header.
The body is FLAT: `type` plus type-specific fields at the top level.

## The seven demo types

| type | minimum working body | returns |
|---|---|---|
| `create_task` | `patientId` | `kind:task`, `owner:gp` |
| `order_test` | `patientId` | `kind:test`, `owner:diagnostics` |
| `draft_prescription` | `patientId` | `kind:prescription`, `owner:pharmacy`, `status:draft` |
| `schedule_visit` | `patientId` | `kind:visit`, `owner:community` |
| `share_record` | `patientId` + `resourceId` | 400 `resourceId required` without it |
| `messaging_action` | `patientId` + `resourceId` (a conversation) + `expectedVersion` + `messagingCommand` | 400 `Choose a practice conversation` if no conversation |
| `process_document` | `patientId` + `resourceId` + `expectedVersion` + `documentCommand` | see workflow below |

Four of the seven fire on `patientId` alone; the server fills sensible defaults.

## The document workflow

`process_document` is stateful. Stages run `sent -> assign -> review -> file`, and each
step bumps `version`, so the next call needs the new `expectedVersion`.

- `assign` needs `clinician`. `review` needs `text`, which becomes `data.reviewNote`.
- Reviewing a letter that was never assigned returns 409
  `An unreviewed letter and review note are required`.
- `share_record` against a discharge summary returns 409
  `Use the document workflow to process this letter`.

## The three distinct 409s

Each needs a different fallback, which is why `tools.ts` branches on the message:

| message | cause | fallback |
|---|---|---|
| `Stale resource version` | `expectedVersion` behind the server | re-read, take the new version, retry once |
| `Idempotency key reused with different action` | same key, different body | never retry with that key; it is a client bug |
| `An unreviewed letter and review note are required` | invalid state transition | advance the workflow, or raise a coordinator task |

Reproduce the first deliberately by sending a stale `expectedVersion`. That is the
conflict shown in the demo.

## Clock

`POST /api/clock {advanceMinutes}` (0..10080), also takes `{paused, speed}`.
`GET /api/clock` reads it. The world starts PAUSED at speed 60.

## Reads

`GET /api/sites/{site}/view` is the bulk read (~561KB for `gp`): `{id, now, speed, paused,
population, counters{}, resources[]}`. `counters` carries the version numbers that feed
`expectedVersion` (`documentVersion`, `bloodPatient:SIM-000001`, ...).

Sites: `control gp hospital community pharmacy diagnostics referrals wearables legacy`.

## Demo patient

`SIM-000001` is **Amira Khan**. Goals: understand the next step, avoid unnecessary travel,
stay at home with a clear contact for help. Needs: home visit, carer involvement.
She has discharge summary `document-batch-2-001` and conversation `messaging-example-1`,
so every one of the seven types can be exercised on her in one plan.
