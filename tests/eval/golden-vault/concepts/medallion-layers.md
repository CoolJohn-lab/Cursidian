---
title: Medallion Layers
category: concepts
tags: [medallion, bronze, silver, gold, architecture]
summary: The platform organizes data into bronze (raw), silver (conformed), and gold (curated) layers.
sources: [synthetic-golden-vault]
aliases: [bronze silver gold, layered architecture]
---

# Medallion Layers

The CDF platform structures every dataset into three medallion layers:
bronze holds raw ingested extracts, silver holds conformed and deduplicated
records, and gold holds curated, business-ready marts such as the
[[concepts/worker-data-mart]].

## Key Ideas

- Bronze is append-only and never overwritten, even when upstream contracts change.
- Silver applies contract validation and deduplication. See [[concepts/contract-generation]].
- Gold is the only layer exposed to egress pipelines. See [[concepts/ingestion-vs-egress]].
- [[entities/fact-person-forecast-history]] and [[entities/fact-public-holiday]] are both gold-layer fact tables.

## Related

- [[concepts/worker-data-mart]] - the primary gold-layer consumption layer
- [[projects/cdf-platform]] - the platform this layering belongs to
