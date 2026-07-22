---
name: wiki-status
description: >
  Show the current state of the wiki - what's ingested, what's pending, what to do next. Use when
  the user asks "what's the status", "what's left to process", "show me the delta", "wiki
  dashboard". Also use for "refresh hot" / "update hot.md", or when hot.md is more than 48 hours
  stale.
---

# Wiki Status - Delta & Dashboard

Report the state of the wiki so the user can decide what to do next. **All vault access is via the `user-cursidian` MCP server** (MCP Contract and Failure handling in `vault/SKILL.md`). Scanning *source directories* (from the manifest's `source_dirs`) with `Glob` is fine - they live outside the vault. If an MCP call fails, stop and report.

Default status is **read-only**. The only optional write is an explicit `hot.md` refresh (see below). Keep `operationStack` only when that refresh runs.

## Gather

1. `vault` `manifest` with `manifestOperation: "read"` (fallback: `note` `read` on `_meta/manifest.md`) - the ingest ledger (`source_dirs`, sources, projects). If it doesn't exist, everything is new: report that and recommend `wiki-setup` / a first `wiki-ingest`.
2. `search` action `list` (recursive) - page counts per category. Follow `nextCursor` while `truncated`. Note `incomplete` / `skipped` if present.
3. `search` action `recent` - what changed lately (paginate if needed).
4. Glob each `source_dirs` entry for documents; compare against manifest sources:
   - **New** - on disk, not in manifest
   - **Modified** - in manifest, mtime newer than recorded
   - **Deleted** - in manifest, gone from disk (wiki pages may be stale)
5. Discover `_raw/` drafts: `search` action `list` with `folder: "_raw"`, `includeOperational: true`. Follow `nextCursor` while `truncated`. Exclude `_raw/_archived/`.

6. `note` `read` on `hot.md` if present. If `updated` is more than 48 hours old, **report** that it is stale. Do **not** rewrite it unless the user explicitly asked to refresh (`refresh hot`, `update hot.md`, or equivalent).

## Report

```markdown
# Wiki Status

## Overview
- Pages: N across M categories · Last ingest: <timestamp>
- hot.md: fresh | stale (>48h) - refresh only on explicit request

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
3. Lint overdue (no LINT_CONSOLIDATE / recent health pass for 30+ days) -> wiki-lint
4. Refresh hot.md (only if user asked, or offer after reporting staleness)
```

Rank by intent: `_raw/` drafts first (work already done, just needs promotion), then source delta, then maintenance. If nothing is pending, say the wiki is healthy and stop.

## hot.md refresh (explicit request only)

When the user **explicitly** asks to refresh hot (not merely because it is stale):

1. `search` action `recent` with `limit: 10` for the most recently modified pages (skip `_raw/`, `_archives/`, special files unless needed); paginate if `truncated`; read their summaries.
2. Rewrite `hot.md` via `note` action `update` (`expectedRevision`): ~500 words across Recent Activity (last 3 operations), Active Threads, Key Takeaways, Flagged Contradictions. Prefer one combined update with body + `frontmatter` merge when bumping `updated`. Chain the response `revisionHash` if a follow-up edit to `hot.md` is needed. Push `operationId`.
3. `vault` action `log` with `logLine: STATUS_HOT refreshed=1` (omit hotActivity - you already rewrote Recent Activity).
4. Verify with `note` `read` on `hot.md`. On failure after the write, undo reverse-order. Clear `operationStack` after success.

This skill writes nothing else - ingestion belongs to `wiki-ingest` / `wiki-update`. Follow `vault` write sequencing (read immediately before each write; never parallel same-path mutations).
