---
title: Contract Schema Review
category: skills
tags: [skill, contract, review]
summary: How to review a generated or drifted schema contract before approving it for promotion to silver.
sources: [synthetic-golden-vault]
aliases: [reviewing a schema contract]
---

# Contract Schema Review

Use this skill when a generated contract or a schema drift alert needs human
review before promotion.

## Key Ideas

- Compare the new contract against the previous version field by field, not just at the table level. ^[inferred]
- Breaking changes (type changes, removed required fields) must be escalated to the source owner before approval. See [[concepts/schema-drift-and-versioning]].
- Approved contracts are versioned and stored alongside the feed definition. See [[concepts/contract-generation]].

## Related

- [[concepts/contract-generation]] - what this skill reviews
- [[concepts/schema-drift-and-versioning]] - the drift detection this skill responds to
