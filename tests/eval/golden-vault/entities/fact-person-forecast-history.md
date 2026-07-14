---
title: FactPersonForecastHistory
category: entities
tags: [fact-table, forecast, worker-data-mart, entity]
summary: FactPersonForecastHistory is the gold-layer fact table recording forecast hours per worker per day in the worker data mart.
sources: [synthetic-golden-vault]
aliases: [FactPersonForecastHistory, person forecast history, forecast fact table]
---

# FactPersonForecastHistory

FactPersonForecastHistory is the central fact table of the
[[concepts/worker-data-mart]]. Each row records forecast hours for one
worker on one day, joined against [[entities/worker-dimension]] and
[[entities/fact-public-holiday]] to exclude non-working days.

## Key Ideas

- The table is populated by a nightly gold-layer job that reads silver-layer BigHand extracts. See [[entities/bighand]].
- Forecast values are recalculated, not appended, when an upstream schedule changes. ^[inferred]
- Consumers query this table through the egress reporting feed, not directly. See [[concepts/ingestion-vs-egress]].

## Related

- [[concepts/worker-data-mart]] - the mart this fact table belongs to
- [[entities/worker-dimension]] - the dimension it joins against
