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

---

# Real documents

Three genuine NHS England publications, downloaded from their official source. Full provenance in
[real/SOURCES.md](real/SOURCES.md). All three parse cleanly and all fit under the 120,000 character
cap, so nothing is truncated.

There is no "expected" column here. Nobody published a key saying what these documents mean in
engine units, which is exactly why the synthetic fixture above still earns its place.

## real/B2034 — Delivery plan for recovering urgent and emergency care services (Jan 2023)

99,974 chars, 49 pages, not truncated. **3 commitments accepted, 0 rejected.**

| Lever | Value | Documented? | Quoted from |
|---|---|---|---|
| `communityCapacityMultiplier` | 2 | **inferred** | "...we will offer more joined-up care for older people living with frailty, including scaling" |
| `monitoringIntensity` | 2.5 | **inferred** | "Greater use of 'virtual wards', which allow people to be safely monitored from... their own home" |
| `hospitalToCommunityShare` | 0.2 | **inferred** | "By autumn 2023, NHS England will develop a new planning framework and national standard for rapid discharge" |

## real/PRN00283 — Delivery plan for recovering access to primary care (May 2023)

96,682 chars, 46 pages, not truncated. **4 commitments accepted, 0 rejected.**

| Lever | Value | Documented? | Quoted from |
|---|---|---|---|
| `communityCapacityMultiplier` | 1.15 | inferred | "26,000 more direct patient care professionals in general practice and 50 million more appointments" |
| `communityCapacityMultiplier` | 1.03 | inferred | "could save 10 million appointments in general practice a year once scaled" |
| `hospitalToCommunityShare` | 0.5 | inferred | "We estimate up to 50% more patients could be self-referring by March 2024." |
| `telephoneFollowUpShare` | 0.8 | inferred | "Around 10% of patients request, and around 20% need, a face-to-face appointment." |

## real/10-year-health-plan (executive summary, Jul 2025)

32,894 chars, 11 pages, not truncated. **3 accepted, 1 rejected.** The rejection is the system
working: a span it could not verify was dropped rather than reported.

| Lever | Value | Documented? | Quoted from |
|---|---|---|---|
| `communityCapacityMultiplier` | 2 | inferred | "deliver more urgent care in the community, in people's homes or through neighbourhood health centres" |
| `telephoneFollowUpShare` | 0.7 | inferred | "care should happen closer to home" |
| `monitoringIntensity` | 2 | inferred | "use continuous monitoring to help make proactive management of patients the new normal" |

---

# What the real documents actually show

**Zero rejections across the two largest documents.** Every commitment's quote was found verbatim
in the source. On `main` this would not have happened: the headline "10,000 virtual ward beds"
sentence fails the old span check purely because of the curly quotes around 'virtual wards'.

**But every single value is `documented: false`.** Not one number was lifted directly; all were
inferred from prose. "Scaling urgent community response across the whole country" is not a
multiplier, and the model turning it into `2` is a judgement, not a reading. The extractor is
being honest by flagging this, and `to-params.ts` tags such values `literature` or `assumed`
rather than `measured`, which is the right behaviour.

**Read the implication carefully.** Real policy documents state intent, money and headcount. They
rarely state the operational ratio a queueing model needs. So the pipeline's job on a real
document is less "read the number" and more "propose a number, show its provenance, and let a
human correct it". That is a defensible product, but it is a different claim from "we extract
what the policy says", and the demo should say the honest one.

**Two quality issues visible above, worth naming before a judge does:**

- PRN00283 maps "26,000 more GP staff and 50 million more appointments" onto
  `communityCapacityMultiplier`. That is general practice capacity, so `extraGpSessions` is the
  better home for it. The lever set has no clean slot for "more GP appointments via more staff".
- The same document yields two different values for the same lever (1.15 and 1.03) from two
  different sentences. Nothing reconciles competing commitments to one parameter.

## Documents we downloaded and cut

Kept out because they produce nothing usable, not because they are bad documents:

| Document | Why cut |
|---|---|
| 10 Year Health Plan (full, 171pp) | 468,807 chars; only 26% reaches the model, so the screen shows a truncation warning. The executive summary carries the same commitments intact. |
| NHS Long Term Plan 2019 | 385,406 chars, truncates, and yields one usable lever. |
| NHS Long Term Workforce Plan 2023 | Headcount and training places, not service levers. Nothing maps. |
| UCR 2-hour standards (B0252, 2020) | A data-field specification for CSDS returns. No policy commitments at all. |
| Community health service UCR guidance | Extracts five commitments whose values are all 1 or 0, meaning "no change". A policy that moves no lever makes an empty demo. |
