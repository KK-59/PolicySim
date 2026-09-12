# Evidence corpus — Albert

~30 curated documents. Drop source files here; index them in `sources.md`.

**Prioritise anything reporting a range or a confidence interval.** Those ranges become the three
worlds directly, so a source with bounds is worth more than three with point estimates.

Chunk so each passage keeps its number **and** the context qualifying it.

Starting set: 10-Year Health Plan chapters (2, 3, 6, 8, 9), NHS Confederation community analysis,
HSSIB July 2025 discharge investigation, UCR standard, Core20PLUS5, NHS-SIM handbook.

⚠️ If the corpus returns point estimates with no ranges, the three worlds collapse toward each
other and the demo's central finding weakens. **Flag it early** — Kaavya can widen with a
documented default, but only if she knows in time.

## Corpus layout

- `documents/` contains one concise, reviewed evidence card per source. Cards paraphrase rather
  than copy source text and link to the canonical full document.
- `sources.md` is the generated human-readable index and supplies stable citation ids.
- `chunks.jsonl` is the generated retrieval input. Each chunk repeats its caveat so a number is
  never separated from the population or modelling limitation that qualifies it.
- `coverage.md` records which contract fields have directly usable ranges and which remain gaps.

Run `npm run corpus:build` after editing a source card, then `npm run corpus:check`. A card marked
`supporting` or `boundary` is relevant context but must not be converted directly into a parameter.
