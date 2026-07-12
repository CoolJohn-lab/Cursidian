---
name: wiki-status
description: >
  Show the current state of the wiki - what's ingested, what's pending, what to do next. Use when
  the user asks "what's the status", "what's left to process", "show me the delta", "wiki
  dashboard". Also use for "refresh hot" / "update hot.md", or when hot.md is more than 48 hours
  stale.
---

# Wiki Status - Delta & Dashboard

Report the state of the wiki so the user can decide what to do next. **All vault access is via the `user-cursidian` MCP server** (MCP Contract in `llm-wiki/SKILL.md`). Scanning *source directories* (from the manifest's `source_dirs`) with `Glob` is fine - they live outside the vault. If an MCP call fails, stop and report.

## Gather

1. `note` action `read` on `_meta/manifest.md` - the ingest ledger (`source_dirs`, per-source lines, project lines). If it doesn't exist, everything is new: report that and recommend `wiki-setup` / a first `wiki-ingest`.
2. `search` action `list` (recursive) - page counts per category.
3. `search` action `recent` - what changed lately.
4. Glob each `source_dirs` entry for documents; compare against manifest lines:
   - **New** - on disk, not in manifest
   - **Modified** - in manifest, mtime newer than recorded
   - **Deleted** - in manifest, gone from disk (wiki pages may be stale)
5. `search` action `list` with `folder: "_raw"` - drafts waiting for promotion (ignore `_raw/_archived/`).

## Report

```markdown
# Wiki Status

## Overview
- Pages: N across M categories · Last ingest: <timestamp>

## Delta
- New sources: N (list them)
- Modified sources: N
- Deleted sources: N
- _raw/ drafts pending: N

## What to Do Next
1. Promote N drafts in _raw/          -> wiki-ingest (raw mode)
2. Ingest N new/modified sources      -> wiki-ingest (append)
3. Lint overdue (no LINT entry in log.md for 30+ days) -> wiki-lint
```

Rank by intent: `_raw/` drafts first (work already done, just needs promotion), then source delta, then maintenance. If nothing is pending, say the wiki is healthy and stop.

## hot.md refresh

When the user asks, or `hot.md`'s `updated` frontmatter is >48h old:

1. `search` action `recent` with `limit: 10` for the most recently modified pages (skip `_raw/`, `_archives/`, special files); read their summaries.
2. Rewrite `hot.md` via `note` action `update` (`expectedHash`): ~500 words across Recent Activity (last 3 operations), Active Threads, Key Takeaways, Flagged Contradictions. Bump `updated`.
3. `vault` action `log` with `logLine: STATUS_HOT refreshed=1` (omit hotActivity - you already rewrote Recent Activity).

This skill writes nothing else - ingestion belongs to `wiki-ingest` / `wiki-update`.
