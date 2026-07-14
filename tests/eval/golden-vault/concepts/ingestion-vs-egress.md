---
title: Ingestion vs Egress
category: concepts
tags: [ingestion, egress, pipelines]
summary: Ingestion pulls source system data into the platform; egress publishes curated data back out to downstream consumers.
sources: [synthetic-golden-vault]
aliases: [inbound vs outbound pipelines]
---

# Ingestion vs Egress

Ingestion pipelines pull extracts from source systems (such as
[[entities/bighand]]) into the bronze medallion layer. Egress pipelines run
in the opposite direction: they read curated gold-layer data, such as
[[entities/fact-person-forecast-history]], and publish it to downstream
consumers on a schedule.

## Key Ideas

- Ingestion pipelines are schema-on-read at bronze and schema-on-write from silver onward. ^[inferred]
- Egress pipelines never write back into the platform; they are read-only consumers of gold-layer marts.
- Both pipeline types are orchestrated by the same scheduler. See [[concepts/orchestration-and-scheduling]].
- Contract generation governs the shape of both ingestion inputs and egress outputs. See [[concepts/contract-generation]].

## Related

- [[concepts/medallion-layers]] - the layered structure both pipeline types move data through
- [[projects/cdf-platform]] - the platform these pipelines belong to
