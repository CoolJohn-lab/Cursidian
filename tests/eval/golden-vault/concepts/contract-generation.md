---
title: Contract Generation
category: concepts
tags: [contract, governance, schema]
summary: Contract generation produces a versioned schema contract for every ingested or egressed feed, used to validate structure before load.
sources: [synthetic-golden-vault]
aliases: [schema contracts, data contracts]
---

# Contract Generation

Contract generation is the process of deriving a versioned schema contract
from a source feed's structure, so that downstream ingestion and egress
pipelines can validate incoming or outgoing data before it is loaded.

## Key Ideas

- Contracts are generated automatically from sample payloads the first time a feed is onboarded. ^[inferred]
- A contract failure blocks the load and raises a troubleshooting alert. See [[skills/troubleshooting-failed-loads]].
- Contract versions are tracked alongside schema drift detection. See [[concepts/schema-drift-and-versioning]].
- [[entities/bighand]] feeds are the most frequently regenerated contracts because of vendor schema changes.

## Related

- [[concepts/ingestion-vs-egress]] - contracts apply to both pipeline directions
- [[skills/contract-schema-review]] - how to review a generated contract before promoting it
