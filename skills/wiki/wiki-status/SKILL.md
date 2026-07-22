---
name: wiki-status
description: >
  Show the current state of the wiki - what's ingested, what's pending, what to do next. Use when
  the user asks "what's the status", "what's left to process", "show me the delta", "wiki
  dashboard".
---

# Wiki Status - Delta & Dashboard

Report the state of the wiki so the user can decide what to do next. **All vault access is via the `user-cursidian` MCP server** (MCP Contract and Failure handling in `vault/SKILL.md`). Scanning *source directories* (from the manifest's `source_dirs`) with `Glob` is fine - they live outside the vault. If an MCP call fails, stop and report.

This skill is **read-only**. Live working set lives on hubs: DLZ / ADO / Cursidian.

## Gather

1. `vault` `manifest` with `manifestOperation: "read"` (fallback: `note` `read` on `_meta/manifest.md`) - the ingest ledger (`source_dirs`, sources, projects). If it doesn't exist, everything is new: report that and recommend `wiki-setup` / a first `wiki-ingest`.
2. `search` action `list` (recursive) - page counts per category. Follow `nextCursor` while `truncated`. Note `incomplete` / `skipped` if present.
3. `search` action `recent` - what changed lately (paginate if needed).
4. Glob each `source_dirs` entry for documents; compare against manifest sources:
   - **New** - on disk, not in manifest
   - **Modified** - in manifest, mtime newer than recorded
   - **Deleted** - in manifest, gone from disk (wiki pages may be stale)
5. Discover `_raw/` drafts: `search` action `list` with `folder: "_raw"`, `includeOperational: true`. Follow `nextCursor` while `truncated`. Exclude `_raw/_archived/`.
6. Optionally `note` `read` hub pages for working-set context: `projects/data-platform-dlz/data-platform-dlz`, `projects/ado-work-queue/ado-work-queue`, `projects/cursidian/cursidian`.

## Report

```markdown
# Wiki Status

## Overview
- Pages: N across M categories · Last ingest: <timestamp>
- Project syncs (manifest): <name> @ <lastCommit> (<synced>)

## Delta
- New sources: N (list them)
- Modified sources: N
- Deleted sources: N
- _raw/ drafts pending: N (excluding _archived)

## Incomplete scan
- skipped: N or none

## What to Do Next
1. Promote N drafts in _raw/          -> wiki-ingest (raw mode)
2. Ingest N new/modified sources      -> wiki-ingest (append)
3. Lint overdue (no recent health pass for 30+ days) -> wiki-lint
4. Update hub working-set sections when focus/gotchas change -> wiki-update / note update on the hub
```

Rank by intent: `_raw/` drafts first (work already done, just needs promotion), then source delta, then maintenance. If nothing is pending, say the wiki is healthy and stop.

This skill writes nothing - ingestion belongs to `wiki-ingest` / `wiki-update`.
