# Extraction results

What the pipeline actually pulled out of each document, against what it should have.

Run with `gpt-4.1`, structured outputs with a strict JSON schema, and every commitment's quoted
span verified against the source text before it is accepted. A commitment whose quote cannot be
found in the document is rejected rather than reported, so a citation that looks checkable always
is one.

---

## generated/brackenmoor-neighbourhood-plan.md

**Synthetic.** Written by Team 14, so the expected values are known exactly and extraction can be
scored rather than eyeballed. 3,613 characters, not truncated. Extracted in 3.4s.

**6 of 6 commitments recovered, 0 rejected, every value correct.**

| Lever | Extracted | Expected | |
|---|---|---|---|
| `levers.communityCapacityMultiplier` | 2 | 2 | correct |
| `levers.extraGpSessions` | 2 | 2 | correct |
| `levers.telephoneFollowUpShare` | 0.5 | 0.5 | correct |
| `levers.monitoringIntensity` | 3 | 3 | correct |
| `levers.hospitalToCommunityShare` | 0.4 | 0.4 | correct |
| `levers.weekdayDischargeShare` | 0.75 | 0.75 | correct |

Note the unit conversions are being done, not just the numbers copied. "Double community
home-visit capacity to eight visits per day" became a multiplier of `2` against the measured
baseline of four, and "triple the intensity of remote monitoring" became `3`. The document never
states either number as a multiplier.

**How to read this result.** It proves the mechanism end to end: parse, model call, schema
constraint, span verification, conversion into engine units. It does **not** prove the system
reads real policy well. This document was written to be readable, by the same team that wrote the
extractor. Real policy prose is vaguer, hedged, and buries its numbers in tables and footnotes.
The honest claim is "the pipeline works", not "the pipeline is accurate on real documents".

### What this document caught

Extraction first recovered only 3 of 6. The other three were rejected as *"the quoted span is not
in the document"* when they plainly were. The span verifier normalised whitespace but not markup,
so any commitment written inside `**bold**` failed the check and was silently discarded.

That bug would have been worse on real documents, which carry typographic quotes, en-dashes and
the soft hyphens justified PDFs leave mid-word. The verifier now folds markup and punctuation
variants while still rejecting a span that genuinely is not there. Fixed on branch
`oriol/extraction-span-matching`, with five tests, two of which confirm the safety property still
holds.

Having a document with known answers is what made a silent 50% loss visible. That is the argument
for keeping generated fixtures even once real documents are in hand.
