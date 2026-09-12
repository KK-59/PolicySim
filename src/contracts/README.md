# Frozen contracts

These three files are the only real blocking dependencies in the project. Agree them in one
ten-minute conversation, commit them, then everyone works against them with mock data from
`fixtures/`.

| File | Owner | Consumed by |
|---|---|---|
| `params.ts` | Kaavya | Elsa's sliders, Albert's source table, Oriol's extractor |
| `metrics.ts` | Kaavya | Elsa's views, Kaavya's own sensitivity code |
| `action.ts` | Oriol | Albert's plans, Elsa's approval screen, Oriol's ADK tools |

**Changing anything here breaks three other people.** Raise it in the group chat first, then
tell everyone downstream in the same message.
