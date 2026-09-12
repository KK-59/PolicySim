# Documents

Policy documents for uploading into Policy Sandbox. Two kinds, kept apart on purpose.

| Folder | What it holds | Provenance |
|---|---|---|
| `real/` | Genuine published policy documents, downloaded from their official source | Real. Every file's source URL, publisher and date are recorded in `real/SOURCES.md` |
| `generated/` | Documents we wrote ourselves as test fixtures | **Not real.** Written by Team 14. Each carries a header saying so |

## The rule

**Nothing in `generated/` may be presented as a real policy.** Those files describe no real
organisation and no real commitment. They exist so the pipeline can be demonstrated and tested
against known answers when a real document is unavailable, too large, or too vague.

Every generated file opens with a header marking it synthetic. Do not remove it, and do not move
a file between these folders.

## Why generated documents are useful anyway

A real document tells you whether the system copes with real prose. A generated one tells you
something a real document cannot: whether extraction got the **right answer**. Because we wrote
the commitments, we know what every value should be, so the extraction can be scored rather than
eyeballed. That is what `EXTRACTION-RESULTS.md` records.

Both matter. A system that scores well only on documents we wrote has proved nothing about the
real world, and a system that reads a real document with no ground truth to check against cannot
be said to have read it correctly.

## Running one

```bash
npm run dev          # then upload through the interface
```

Supported formats: PDF, DOCX, MD, TXT. Documents over 120,000 characters are truncated, and the
extraction result reports `truncated: true` when that happens.

Results, with expected values where we have them: **[EXTRACTION-RESULTS.md](EXTRACTION-RESULTS.md)**.
