---
title: Ingestion Pipeline Authoring
category: skills
tags: [skill, ingestion, pipelines]
summary: How to author and register a new ingestion pipeline with the orchestrator, from contract generation through bronze landing.
sources: [synthetic-golden-vault]
aliases: [authoring a new ingestion pipeline]
---

# Ingestion Pipeline Authoring

Use this skill when onboarding a new source feed into the CDF platform.

## Key Ideas

- Generate a contract from a sample payload before writing any pipeline code. See [[concepts/contract-generation]].
- Register the new pipeline with the orchestrator so it inherits retry and scheduling behaviour. See [[concepts/orchestration-and-scheduling]].
- Land raw extracts in bronze first; never write directly to silver or gold. See [[concepts/medallion-layers]].

## Related

- [[concepts/ingestion-vs-egress]] - the pipeline category this skill covers
- [[entities/bighand]] - a reference example of an existing ingestion feed
