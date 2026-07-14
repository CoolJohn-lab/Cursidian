---
title: Orchestration and Scheduling
category: concepts
tags: [orchestration, scheduling, pipelines]
summary: A central orchestrator schedules ingestion and egress pipelines, retries failed loads, and enforces medallion layer ordering.
sources: [synthetic-golden-vault]
aliases: [main orchestrator, pipeline scheduler]
---

# Orchestration and Scheduling

A single orchestrator schedules both [[concepts/ingestion-vs-egress]]
pipeline types, enforcing that bronze completes before silver, and silver
before gold, per [[concepts/medallion-layers]].

## Key Ideas

- Failed loads are retried up to three times before escalating. See [[skills/troubleshooting-failed-loads]].
- The orchestrator exposes a queue so pipeline owners can inspect pending and failed runs. ^[inferred]
- [[entities/bighand]] ingestion is scheduled hourly; most other feeds run nightly.

## Related

- [[concepts/ingestion-vs-egress]] - the pipeline types the orchestrator schedules
- [[skills/ingestion-pipeline-authoring]] - how new pipelines register with the orchestrator
