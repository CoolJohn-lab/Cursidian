---
name: wiki-lint
description: >
 Audit and maintain the health of the Obsidian wiki. Use when the user wants a health check, or
 says "clean up the wiki", "audit my notes", "find orphans", "fix broken links", "link my pages",
 "connect my wiki", or after a large ingest to weave new pages into the graph. Default is
 report-only; add --consolidate (or "clean up") for act-and-report mode, which applies fixes
 after a dry-run preview and explicit user confirmation.
---

# Wiki Lint - Health Audit

Find and fix the structural issues that degrade a wiki over time. **All vault access is via the `user-cursidian` MCP server** (MCP Contract and Failure handling in `vault/SKILL.md`). If an MCP call fails, stop and report; never inspect or repair vault files with filesystem tools.

## Report-only mode (default)

**Zero writes.** Do not call `note` create/update/delete/rename/frontmatter, do not call `vault` `sync_index`, `undo`, or `manifest` mutations.

Call `vault` with `action: "health"` once and present its structured report. Do not reimplement these checks with dozens of MCP calls unless `vault` health is unavailable.

Map **only** fields that `vault` health actually returns:

1. **Orphans** - `orphans` / `counts.orphans` (pages with zero incoming links; health already excludes operational paths).
2. **Broken wikilinks** - `brokenLinks` / `counts.brokenLinks`.
3. **Missing frontmatter** - `missingFrontmatter` / `counts.missingFrontmatter` (required: `title`, `category`, `tags`, `summary`, `updated`). Soft issues live in `summaryWarnings` / `counts.summaryWarnings` (missing or >200 chars).
4. **Index drift** - `indexDrift` / `counts.indexDrift` (missing from index, dead entries, summary mismatches). Respect `indexMode`: under `hub`, missing means uncovered by root index **and** hub links, not "absent from a flat leaf dump."
5. **Ambiguous keys** - `ambiguousKeys` / `counts.ambiguousKeys` (title/alias/basename collisions).
6. **Stale pages** - `stale` / `counts.stale` (old `updated` with enough backlinks; default window from `staleDays`).
7. **Incomplete scan** - if `incomplete: true` or `counts.skipped` / `skipped` is non-empty, list skipped paths and reasons; never claim a clean vault.

There is **no** Contradictions count on `vault` health. Do not invent one in the report-only template. Contradiction discovery is a separate search step that runs only in consolidate mode (below).

### Report template

```markdown
## Wiki Health Report

### Orphans (N)
- [[concepts/foo]] - no incoming links

### Broken links (N)
- [[entities/bar]] -> [[nonexistent-page]]

### Missing frontmatter (N) / Summary warnings (N) / Index drift (N) / Ambiguous keys (N) / Stale (N)
...

### Incomplete scan
- skipped: N (list path + reason) or "none"
```

Then offer to fix via consolidate mode. Still write nothing.

## Consolidate mode (`--consolidate`)

Act-and-report. Keep `operationStack`. **Always show a dry-run list of planned changes first and get explicit confirmation** before writing anything.

After confirmation, apply via `note` actions `update` / `frontmatter` with `expectedRevision` (prefer combined body + `frontmatter` on one `update` when both change). Serialize per path: read immediately before each write; chain the response `revisionHash` for a second edit to the same path; never parallel same-path mutations. Push every `operationId`.

1. **Fix broken links** - rewrite to the closest unambiguous existing page; if no clear match, unlink to plain text. Never create a page just to satisfy a link.
2. **Rescue orphans** - find plain-text mentions of the orphan's title in other pages (`search` action `content`, paginate if `truncated`) and wikilink them; max 3 insertions per orphan. If no mentions exist, add one line to the most closely related page's Related section.
3. **Repair frontmatter** - fill missing `summary`/`tags` from page content; normalize tags against `_meta/taxonomy.md`. Prefer `fmOperation: "merge"` unless `replaceAll` is intentionally required.
4. **Sync `index.md`** - call `vault` action `sync_index` (preview with `dryRun: true` first). Flat mode rebuilds the leaf catalog; hub mode preserves the curated router body - never flatten a hub-router index.
5. **Flag contradictions** - this is consolidate-only. Search for opposing claims with `search` `content`; add a one-line `> Contradicts [[other-page]]` callout to both pages. Flag, never resolve. Contradiction discovery is **not** part of report-only and is **not** a `vault` health field.

Never merge or delete pages automatically - flag duplicates for the user.

### Verification

`note` `read` each changed page; `vault` `sync_index` with `dryRun: true` expecting `wouldWrite: false`. Report residual drift. On failure after writes, undo reverse-order.

### Final report

Summary of changes in chat. Include operation IDs retained for later undo. Clear `operationStack` only after verification passes.
