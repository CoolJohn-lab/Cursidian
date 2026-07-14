---
title: CDF Platform
category: projects
tags: [project, cdf, platform]
summary: The CDF platform ingests source system data, applies contract-governed transformations through medallion layers, and serves worker data marts and egress feeds.
sources: [synthetic-golden-vault]
aliases: [CDF, Cloud Data Fabric]
---

# CDF Platform

The CDF platform is the central data platform that ingests operational
source system extracts, transforms them through governed medallion layers,
and publishes curated data marts and egress feeds to downstream consumers.

## Key Ideas

- Ingestion and egress are treated as symmetric but distinct pipelines. See [[concepts/ingestion-vs-egress]].
- Every source feed is bound to a generated contract. See [[concepts/contract-generation]].
- Data moves through bronze, silver, and gold medallion layers. See [[concepts/medallion-layers]].
- The worker data mart is the primary consumption layer for workforce reporting. See [[concepts/worker-data-mart]].

## Related

- [[entities/bighand]] - a major source system feeding the platform
- [[entities/fact-person-forecast-history]] - a gold-layer fact table published from the platform
- [[skills/ingestion-pipeline-authoring]] - how to add a new ingestion pipeline
