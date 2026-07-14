---
title: BigHand
category: entities
tags: [bighand, source-system, entity]
summary: BigHand is a third-party time capture and billing source system that feeds worker activity data into the CDF platform.
sources: [synthetic-golden-vault]
aliases: [BigHand feed, BigHand source system]
---

# BigHand

BigHand is a third-party time capture and billing system used as a primary
source feed for the CDF platform. Its extracts are ingested hourly and feed
[[entities/fact-person-forecast-history]] via the gold-layer worker data
mart.

## Key Ideas

- BigHand contracts change more often than other feeds because of vendor releases. See [[concepts/schema-drift-and-versioning]].
- BigHand ingestion runs through the standard [[concepts/ingestion-vs-egress]] pipeline, landing first in bronze.
- BigHand feed failures are the most common troubleshooting escalation. See [[skills/troubleshooting-failed-loads]].

## Related

- [[concepts/contract-generation]] - governs the BigHand feed contract
- [[projects/cdf-platform]] - the platform BigHand feeds into
