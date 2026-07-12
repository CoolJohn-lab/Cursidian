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

Find and fix the structural issues that degrade a wiki over time. **All vault access is via the `user-cursidian` MCP server** (MCP Contract in `llm-wiki/SKILL.md`). If an MCP call fails, stop and report; never inspect or repair vault files with filesystem tools.

## Checks (report-only by default)

Call `vault` with `action: "health"` once and present its structured report. Do not reimplement these checks with dozens of MCP calls unless `vault` health is unavailable.

The report covers:

1. **Orphans** - pages with zero incoming links (ignore `index.md`, `log.md`, `hot.md`, `_meta/`, `_raw/`).
2. **Broken wikilinks** - unresolved outgoing links.
3. **Missing frontmatter** - pages lacking `title`, `category`, `tags`, `summary`, or `updated`. Missing `summary` is a soft warning; flag summaries over 200 chars too.
4. **Index drift** - pages missing from `index.md`, dead index entries, summary mismatches.
5. **Stale pages** - `updated` more than 90 days ago on pages with 3+ incoming links.

For deeper graph questions during consolidate mode, use `graph` / `search` action `content` as needed.

## Report

```markdown
## Wiki Health Report

### Orphans (N)
- [[concepts/foo]] — no incoming links

### Broken links (N)
- [[entities/bar]] → [[nonexistent-page]]

### Missing frontmatter (N) · Index drift (N) · Stale (N) · Contradictions (N)
...
```

Call `vault` action `log` with `logLine: LINT orphans=N broken=N frontmatter=N index=N stale=N` using counts from `vault` health (no hotActivity needed for report-only).

Then offer to fix.

## Consolidate mode (`--consolidate`)

Act-and-report. **Always show a dry-run list of planned changes first and get explicit confirmation** before writing anything.

After confirmation, apply via `note` actions `update` / `frontmatter`:

1. **Fix broken links** - rewrite to the closest unambiguous existing page; if no clear match, unlink to plain text. Never create a page just to satisfy a link.
2. **Rescue orphans** - find plain-text mentions of the orphan's title in other pages (`search` action `content`) and wikilink them; max 3 insertions per orphan. If no mentions exist, add one line to the most closely related page's Related section.
3. **Repair frontmatter** - fill missing `summary`/`tags` from page content; normalize tags against `_meta/taxonomy.md`.
4. **Sync `index.md`** - call `vault` action `sync_index` (preview with `dryRun: true` first if you want to show the user the planned catalog).
5. **Flag contradictions** - add a one-line `> ⚠️ Contradicts [[other-page]]` callout to both pages. Flag, never resolve.

Never merge or delete pages automatically - flag duplicates for the user.

Finish with a summary of changes and `vault` action `log`: `logLine: LINT_CONSOLIDATE links_fixed=N orphans_rescued=N frontmatter=N index=N callouts=N` plus a short `hotActivity` bullet.
