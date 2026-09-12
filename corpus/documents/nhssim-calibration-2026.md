# NHS-SIM live-world calibration findings

- ID: nhssim-calibration-2026
- Publisher: Team 14
- Year: 2026
- Source: ../../docs/calibration-findings.md
- Parameters: arrivals.perDay, capacities.gpSessionsPerDay, capacities.gpSlotsPerSession, capacities.communitySlotsPerDay, capacities.staffedSpaces, routing.letterSentToReviewed, routing.letterReviewedToFiled
- Range or CI: yes
- Evidence kind: measured
- Applicability: direct

## Evidence

The 12 September 2026 snapshot observed 1,312 attendances across 9 simulated days, implying approximately 142 arrivals per simulated day with a 140 to 144 sensitivity band. It also observed 6 GP sessions per day, 15 usable slots per session, 4 community slots and 8 staffed spaces.

## Modelling use and caveats

This is the best direct calibration source for the current synthetic world. The snapshot was gridlocked: 1,307 of 1,312 attendances remained waiting, so it cannot identify service throughput or stable queueing performance.
