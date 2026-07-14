---
title: Worker Dimension
category: entities
tags: [dimension, worker-data-mart, entity]
summary: The worker dimension is a slowly changing dimension tracking each worker's role, cost centre, and office history for the worker data mart.
sources: [synthetic-golden-vault]
aliases: [worker dim, DimWorker]
---

# Worker Dimension

The worker dimension is a type-2 slowly changing dimension that tracks each
worker's role, cost centre, and office over time. It is the primary
dimension joined by [[entities/fact-person-forecast-history]] in the
[[concepts/worker-data-mart]].

## Key Ideas

- Role and cost centre changes create a new dimension row rather than overwriting history. ^[inferred]
- The dimension is refreshed from silver-layer HR extracts before the gold-layer fact job runs.

## Related

- [[concepts/worker-data-mart]] - the mart this dimension serves
- [[entities/fact-person-forecast-history]] - the primary fact table joining this dimension
