# Real policy documents — provenance and parse results

Eight genuine, public NHS England / DHSC publications, downloaded unmodified from the publisher.
Original filenames kept. Retrieved 12 September 2026.

Character counts come from `parseDocument` in `src/extraction/parse.ts`. The extractor sends at
most **120,000 characters**; anything above that is truncated and reported.

| # | File | Publisher | Published | Bytes | Pages | Chars | Over cap? |
|---|---|---|---|---:|---:|---:|---|
| 1 | `B2034-delivery-plan-for-recovering-urgent-and-emergency-care-services.pdf` | NHS England + DHSC | 30 Jan 2023 | 651,619 | 49 | 99,974 | no (83% of cap) |
| 2 | `PRN00283-delivery-plan-for-recovering-access-to-primary-care-may-2023.pdf` | NHS England | 9 May 2023 | 918,297 | 46 | 96,682 | no (81% of cap) |
| 3 | `Community-health-service-urgent-community-response-guidance.pdf` | NHS England | 16 Jul 2021, last updated 9 Apr 2026 | 531,740 | 29 | 55,697 | no |
| 4 | `fit-for-the-future-10-year-health-plan-for-england-executive-summary.pdf` | DHSC | 3 Jul 2025 | 2,617,556 | 11 | 32,894 | no |
| 5 | `fit-for-the-future-10-year-health-plan-for-england.pdf` | DHSC | 3 Jul 2025 (rev. 15 Jul 2025) | 12,629,317 | 171 | 468,807 | **yes — 25.6% sent** |
| 6 | `nhs-long-term-plan-version-1.2.pdf` | NHS England | Jan 2019 (v1.2, Aug 2019) | 2,225,232 | 136 | 385,406 | **yes — 31.1% sent** |
| 7 | `nhs-long-term-workforce-plan-v1.2.pdf` | NHS England | 30 Jun 2023 | 2,368,423 | 151 | 349,284 | **yes — 34.4% sent** |
| 8 | `B0252-Urgent-community-response-2-hour-and-2-days-standards-guidance-30-November-2020.pdf` | NHS England | 30 Nov 2020 | 427,236 | 26 | 39,963 | no |

All eight parse cleanly through `parseDocument` with no errors and non-zero text (none is a scan).

## Source URLs

1. https://www.england.nhs.uk/wp-content/uploads/2023/01/B2034-delivery-plan-for-recovering-urgent-and-emergency-care-services.pdf
   (landing page: https://www.england.nhs.uk/long-read/delivery-plan-for-recovering-urgent-and-emergency-care-services-january-2023/)
2. https://www.england.nhs.uk/wp-content/uploads/2023/05/PRN00283-delivery-plan-for-recovering-access-to-primary-care-may-2023.pdf
   (landing page: https://www.england.nhs.uk/publication/delivery-plan-for-recovering-access-to-primary-care/)
3. https://www.england.nhs.uk/wp-content/uploads/2021/07/Community-health-service-urgent-community-response-guidance.pdf
   (landing page: https://www.england.nhs.uk/publication/community-health-services-two-hour-crisis-response-standard-guidance/)
4. https://assets.publishing.service.gov.uk/media/6888a0996478525675738f3a/fit-for-the-future-10-year-health-plan-for-england-executive-summary.pdf
5. https://assets.publishing.service.gov.uk/media/6888a0b1a11f859994409147/fit-for-the-future-10-year-health-plan-for-england.pdf
   (landing page for 4 and 5: https://www.gov.uk/government/publications/10-year-health-plan-for-england-fit-for-the-future)
6. https://webarchive.nationalarchives.gov.uk/ukgwa/20250511091243if_/https://www.longtermplan.nhs.uk/wp-content/uploads/2019/08/nhs-long-term-plan-version-1.2.pdf
   (`longtermplan.nhs.uk` now redirects to the UK Government Web Archive; the archived copy is the
   publisher's own file, byte-served by The National Archives.)
7. https://www.england.nhs.uk/wp-content/uploads/2023/06/nhs-long-term-workforce-plan-v1.2.pdf
   (landing page: https://www.england.nhs.uk/publication/nhs-long-term-workforce-plan/)
8. https://www.england.nhs.uk/wp-content/uploads/2020/11/B0252-Urgent-community-response-2-hour-and-2-days-standards-guidance-30-November-2020.pdf

## Quantified commitments found, by lever

Quotes are verbatim from the parsed text (PDF extraction inserts the odd stray space, which is
preserved here so the span matches).

### 1. `B2034` — Delivery plan for recovering urgent and emergency care services

- **communityCapacityMultiplier / monitoringIntensity** — "Greater use of 'virtual wards', which
  allow people to be safely monitored from the comfort of their own home, will be achieved by an
  extra 3,000 beds to provide over 10,000 in total by this autumn, allowing staff to care for up to
  50,000 patients a month this way over the longer term." (7,000 → 10,000+ beds is ×1.43)
- **communityCapacityMultiplier** — "Our ambition is to scale up capacity ahead of next winter to
  above 10,000 with a longer-term ambition of reaching 40-50 virtual wards per 100,000 people,
  which would mean more than 50,000 admissions a month."
- **communityCapacityMultiplier** — "The NHS has successfully rolled out 7,000 virtual ward beds,
  with capacity increasing by nearly 50% since the summer."
- **monitoringIntensity** — "We will increase utilisation of virtual wards from around 65% to 80%
  by September 2023."
- **communityCapacityMultiplier** — "Ahead of next winter, we will improve use of UCR including
  consistently meeting or exceeding reaching 70% of patients referred within two hours, with a
  service that operates for at least 12 hours a day."
- **weekdayDischargeShare** — "Systems for discharge planning and delivery need to ensure timely
  transfers of care throughout the week, including evenings and weekend."
- **weekdayDischargeShare** — "which has taken the proportion of ward discharges that leave the
  ward before 9am from about 6% to over 9%, and 23% of ward discharges now leave the ward before
  midday"
- **weekdayDischargeShare** — "all hospitals with Type 1 emergency departments provide appropriate
  SDEC seven days a week with a minimum opening of 12 hours per day"
- **hospitalToCommunityShare** (context, no single number) — "£1.6 billion of additional social
  care discharge funding over 2023/24 and 2024/25"; "around 24% of patients with delayed discharges
  are awaiting the start of home-based care".

### 2. `PRN00283` — Delivery plan for recovering access to primary care

- **extraGpSessions** — "Make available an extra £385 million in 2023/24 to employ 26,000 more
  direct patient care staff and deliver 50 million more appointments by March 2024 (compared to
  2019)." (50m/yr on a base of ~330m/yr is roughly +15%, i.e. ~+1 session on a 6-session day)
- **extraGpSessions** — "General practice, comprised of 6,500 individual practices, delivers over
  330 million appointments a year (excluding those for Covid vaccinations)." (the denominator)
- **extraGpSessions** — "This, together with OC and BP expansion, could save 10 million
  appointments in general practice a year once scaled, subject to consultation."
- **telephoneFollowUpShare** — "Around 10% of patients request , and around 20% need, a
  face-to-face appointment." (implies a remote share of ~0.8)
- **telephoneFollowUpShare** — "Now, twice as many patients are seen face-to-face than request it,
  based on need following clinical assessment."
- **monitoringIntensity** — "To make home monitoring easier for patients and practices, we are
  funding the digital tools for patients to send their readings to their practice, where staff can
  review and add them to their clinical record with 'one click'."
- **monitoringIntensity** — "This service currently delivers up to 120,000 checks per month, which
  we will expand with new funding to a further 2.5 million blood pressure checks in community
  pharmacy to support ongoing monitoring in partnership with GP practices"
- **extraGpSessions** (demand-side) — "Effective care navigation could direct over 15% of patients
  to teams that could better help them: administrative teams, self-care, community pharmacy or
  another local service."
- **weekdayDischargeShare** (contextual, opening hours) — "Since 1 October 2022, a PCN must provide
  network appointments between the hours of 6.30pm and 8pm Mondays to Fridays, and between 9am and
  5pm on Saturdays."

### 3. `Community-health-service-urgent-community-response-guidance`

- **communityCapacityMultiplier** — "Providers will be required to achieve, and ideally exceed in
  the majority of cases, the minimum threshold of reaching 70% of 2-hour crisis response demand
  within 2- hours."
- **communityCapacityMultiplier / weekdayDischargeShare** — "ICSs should continue to provide a
  consistent service at scale, from 8am to 8pm, seven days a week (at a minimum) across the full
  geography of each ICS."
- **communityCapacityMultiplier** — "at a minimum operating 12-hours a day, 7 days a week in line
  with national guidance"
- **communityCapacityMultiplier** — "In 2019, savings of 12 hours/day of clinical staff time and
  2.5 hour/day of planning time was saved for each of the 30 teams."
- Referral-mix table (2024/25): "Carer/Relative 23% Self-referral 17% Community Health Service 16%
  General Medical Practitioner Practice 15% Ambulance Service 10% ..." — useful for
  `routing.gpToCommunity` context rather than a lever.

### 4. 10 Year Health Plan — executive summary

- **weekdayDischargeShare** — "neighbourhood health centres will be open at least 12 hours a day
  and 6 days a week"
- **hospitalToCommunityShare** — "deliver more urgent care in the community, in people's homes or
  through neighbourhood health centres to end hospital outpatients as we know it by 2035"
- **monitoringIntensity** — "use continuous monitoring to help make proactive management of
  patients the new normal, allowing clinicians to reach out at the first signs of deterioration to
  prevent an emergency admission to hospital"

### 5. 10 Year Health Plan — full document (truncated to 25.6%)

All of the above, plus, still inside the first 120,000 characters:

- **hospitalToCommunityShare** — "Two-thirds of outpatient appointments - which currently cost in
  total £14 billion a year 30 - will be replaced by automated information, digital advice, direct
  input from specialists and patient-initiated follow ups as we introduce a new digital front door
  to the NHS via the NHS App." (0.67)
- **telephoneFollowUpShare** — "Those who need it, will get a digital or telephone consultation for
  the same day they request it."
- **hospitalToCommunityShare** — "By 2035, most outpatient care will happen outside of hospitals."

### 6. NHS Long Term Plan 2019 (truncated to 31.1%)

- **hospitalToCommunityShare** — "We will therefore redesign services so that over the next five
  years patients will be able to avoid up to a third of face-to-face outpatient visits, removing
  the need for up to 30 million outpatient visits a year." (0.33)
- **telephoneFollowUpShare / hospitalToCommunityShare** — "redesigned hospital support will be able
  to avoid up to a third of outpatient appointments - saving patients 30 million trips to hospital,
  and saving the NHS over £1 billion a year in new expenditure averted."

### 7. NHS Long Term Workforce Plan 2023 (truncated to 34.4%)

Weak for these levers. It is a headcount-and-training document: its numbers are training places
and WTE projections, not service-capacity multipliers. The only lever-adjacent line in the sent
portion is "virtual ward and intermediate care expansion", with no figure attached.

### 8. `B0252` — UCR two-hour and two-day standards guidance (Nov 2020)

Superseded in substance by document 3 and largely a Community Services Data Set field
specification (clock starts, clock stops, CSDS codes). Kept because it is the canonical definition
of the two-hour standard, but it makes no capacity commitment of its own.

## Note on span verification

These are PDFs, so the extracted text is full of typographic quotes and dashes. Under the span
verifier as it stands on `main`, a model quoting those sentences back in plain ASCII has its span
rejected. Checked directly against both normalisers: the fix on `oriol/extraction-span-matching`
rescues, among others, the single most important sentence in the set — the 10,000 virtual ward beds
commitment in `B2034`, which fails on `main` purely because of the curly quotes around
'virtual wards'.

## Considered and not downloaded

NHS England has moved most post-2023 publications to HTML "long reads" with no PDF, and the parser
takes only pdf/docx/md/txt. These were checked and have no publisher PDF:

- Urgent and emergency care plan 2025/26 (NHS England, 6 Jun 2025) — HTML only, and its targets
  (78% four-hour, 0.4-day length-of-stay reduction) do not map onto the six levers.
- Virtual wards operational framework (NHS England, 27 Aug 2024, updated 4 Jul 2025) — HTML only.
  Would otherwise be a strong candidate: ">80% occupancy", "8am-8pm, 7 days a week at a minimum".
- Neighbourhood health guidelines 2025/26 (NHS England, 30 Jan 2025) — HTML only.
- 2025/26 priorities and operational planning guidance — HTML only.
- Planning framework for the NHS in England, 2026/27 to 2030/31 (8 Sep 2025) — HTML only, and sets
  process milestones rather than quantified service targets.
- Hospital discharge and community support guidance (DHSC, updated 26 Jan 2024) — HTML only on
  GOV.UK. PDF copies exist on third-party sites; not used, since they are not the publisher's.
