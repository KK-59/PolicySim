# Community Services Data Set technical guidance for the two-hour UCR standard

- ID: ucr-technical-guidance-2026
- Publisher: NHS England
- Year: 2026
- Source: https://www.england.nhs.uk/long-read/community-services-data-set-technical-guidance-for-the-two-hour-urgent-community-response-standard/
- Parameters: capacities.communitySlotsPerDay, serviceTimes.communityVisit
- Range or CI: yes
- Evidence kind: documented
- Applicability: supporting

## Evidence

The technical definition measures whether an urgent community response begins within 120 minutes of the referral. It describes crisis-response intervention as short term, typically lasting up to 48 hours, and specifies the referral and response timestamps required for calculation.

## Modelling use and caveats

The 0-to-48-hour intervention window is a programme-duration boundary, not an individual visit duration. Preserve that context in retrieval.

