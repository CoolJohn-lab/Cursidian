---
title: Worker Data Mart
category: concepts
tags: [worker-data-mart, wdm, reporting]
summary: The worker data mart (WDM) is the gold-layer star schema serving workforce reporting, built around the worker dimension and forecast fact tables.
sources: [synthetic-golden-vault]
aliases: [WDM, worker data mart]
---

# Worker Data Mart

The worker data mart, often abbreviated WDM, is the gold-layer star schema
that serves workforce reporting. It is built around
[[entities/worker-dimension]] and fact tables such as
[[entities/fact-person-forecast-history]].

## Key Ideas

- WDM tables are refreshed nightly after the gold-layer medallion job completes. ^[inferred]
- The worker dimension is a slowly changing dimension tracking role and cost centre history.
- Forecast facts in the WDM join to [[entities/fact-public-holiday]] to exclude non-working days from utilisation metrics.

## Related

- [[concepts/medallion-layers]] - the layered architecture the WDM sits on top of
- [[entities/worker-dimension]] - the core dimension table
- [[entities/fact-person-forecast-history]] - the primary forecast fact table
