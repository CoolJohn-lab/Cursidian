---
title: Troubleshooting Failed Loads
category: skills
tags: [skill, troubleshoot, incident]
summary: A troubleshooting checklist for failed ingestion or egress loads, covering contract failures, schema drift, and orchestrator retries.
sources: [synthetic-golden-vault]
aliases: [failed load runbook, incident checklist]
---

# Troubleshooting Failed Loads

Use this checklist when an ingestion or egress load fails.

## Key Ideas

- First check whether the failure is a contract validation error. See [[concepts/contract-generation]].
- If the contract is valid, check for unresolved schema drift. See [[concepts/schema-drift-and-versioning]].
- Check the orchestrator queue for retry exhaustion before escalating. See [[concepts/orchestration-and-scheduling]].
- BigHand feed failures are the most frequent case; check vendor status first. See [[entities/bighand]].

## Related

- [[concepts/orchestration-and-scheduling]] - where retries and queue state live
- [[entities/bighand]] - the most common source of failed loads
