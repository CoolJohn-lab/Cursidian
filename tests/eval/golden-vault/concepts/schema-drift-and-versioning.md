---
title: Schema Drift and Versioning
category: concepts
tags: [schema-drift, versioning, contract]
summary: Schema drift detection compares incoming feed structure against the current contract version and flags unexpected changes before load.
sources: [synthetic-golden-vault]
aliases: [schema drift detection]
---

# Schema Drift and Versioning

Schema drift detection runs before every ingestion load. It compares the
incoming feed's structure against the currently active
[[concepts/contract-generation]] version and flags additions, removals, or
type changes for review.

## Key Ideas

- Additive drift (new optional columns) is auto-approved; breaking drift blocks the load. ^[inferred]
- Drift on [[entities/bighand]] feeds is the most common trigger for a contract regeneration.
- Unresolved drift alerts route to the same on-call process as failed loads. See [[skills/troubleshooting-failed-loads]].

## Related

- [[concepts/contract-generation]] - the contract that drift is measured against
- [[skills/contract-schema-review]] - how to review and approve drift
