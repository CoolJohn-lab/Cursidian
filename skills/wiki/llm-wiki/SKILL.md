---
name: llm-wiki
description: >
  The foundational knowledge distillation pattern for an AI-maintained Obsidian wiki, based on
  Andrej Karpathy's LLM Wiki architecture. Use when the user wants to understand the wiki pattern,
  discuss knowledge management strategy or wiki structure, or when any other wiki skill needs the
  shared schema: the MCP contract, vault layout, page template, or special files. This is the
  theory skill - operations live in wiki-ingest, wiki-query, wiki-lint, and the other wiki skills.
---

# LLM Wiki - Knowledge Distillation Pattern

You maintain a persistent, compounding knowledge base. The wiki is a **compiled artifact**: knowledge is distilled once and kept current, not re-derived on every query. The human curates sources and asks questions; you do the bookkeeping. Obsidian is the IDE, the wiki is the codebase.

## The MCP Contract - read this first

**All vault access goes through the `user-cursidian` MCP server. There is no other path.**

1. **Never** touch vault files with filesystem tools (`Read`, `Write`, `StrReplace`, `Grep`, `Glob`) or shell commands (`cat`, `sed`, `echo >`, `mkdir`, `mv`, `rm`, ...). This covers every file in the vault: pages, `index.md`, `log.md`, `hot.md`, `_meta/`, `_raw/` - everything.
2. Reads use `search` (actions: `content`, `by_tags`, `list`, `recent`, `tags`), `note` (action: `read`), `graph`, `vault` (action: `health`). Writes use `note` (actions: `create`, `update`, `delete`, `rename`, `frontmatter`), `vault` (actions: `sync_index`, `create_folder`, `list_folders`, `delete_folder`, `log`).
3. Edits follow the safe-write protocol: `note` with `action: "read"` -> note the `contentHash` -> `note` with `action: "update"` using the narrowest mode (`patch` > `replace_section` > `append`/`prepend` > `replace`) passing `expectedHash`. On a hash-mismatch error, re-read and re-apply against the fresh content.
4. **If an MCP call fails, errors, or returns something that doesn't make sense: stop.** Tell the user exactly which tool was called, with what arguments, and what came back. Then wait for instructions. Do not retry with different tools, do not fall back to the filesystem, do not improvise. "Edit the files manually" is never an option.
5. If the `user-cursidian` server is missing or unreachable, say so and stop. Point the user at `INSTALL.md`. Do not offer a manual alternative.

The only files read outside MCP are **source documents that live outside the vault** - the things being ingested. Use `Read`/`Glob`/`WebFetch` on those as normal. The moment content enters the vault, it is MCP-only.

### Tool map (4 tools)

| Tool | Actions | Notes |
|---|---|---|
| `search` | `content` (default), `by_tags`, `list`, `recent`, `tags` | `content`: default `limit: 10`; `format: "compact"` for index-only hits; `verbose` for matchReasons; operational files (`index`/`log`/`hot`/`_raw`/`_archives`) excluded unless `includeOperational: true`; stopwords stripped; AND then OR-fallback; typo correction when zero hits. `by_tags`/`tags`: same operational exclusion. `list`/`recent`: same operational exclusion by default; honor `includeOperational`; `list` fails loud (`not_found`) on a missing folder. `tags`: tag vocabulary with counts. |
| `note` | `read`, `create`, `update`, `delete`, `rename`, `frontmatter` | `read`: body, frontmatter, `contentHash`, `outgoingLinks`. `create`: auto-creates parent folders; auto-sets `created`/`updated`. `update`: modes `patch`, `replace_section` (body until next same-or-higher heading; nested subsections included), `append`, `prepend`, `replace`; pass `expectedHash`. `rename`: `newPath`; rewrites backlinks. `frontmatter`: `fmOperation` set/merge/delete (read frontmatter via `read`). `delete`: `confirm: true`. |
| `graph` | - | One-hop neighborhood: outgoing wikilinks + backlinks (depth 1) |
| `vault` | `health`, `sync_index`, `create_folder`, `list_folders`, `delete_folder`, `log` | `health`: orphans/broken links/frontmatter/index drift/stale. `sync_index`: rebuild `index.md`. `log`: append `log.md` + optional `hot.md` Recent Activity. Folder delete requires `confirm`, empty folders only. |

### Retrieval ladder

Use the cheapest call that answers the question; escalate only when it can't.

1. `search` with `action: "list"` or `action: "tags"` - what exists
2. Frontmatter `summary` from search hits - use `search` with `action: "content"`, `format: "compact"`, `limit: 10`
3. `search` with `action: "by_tags"` - metadata filter
4. `search` with `action: "content"` - full text (default) or compact metadata
5. `note` with `action: "read"` - full body (last resort)
6. `graph` - link neighborhood (outgoing + backlinks)

## Three-Layer Architecture

| Layer | What | Where |
|---|---|---|
| **1. Raw sources** | The user's original documents - immutable, never modified | Outside the vault, wherever the user keeps them |
| **2. The wiki** | Compiled, cross-linked markdown pages | The vault (via MCP) |
| **3. The schema** | These skills - the rules for maintaining the wiki | `~/.cursor/skills/` |

The in-vault `_raw/` folder is not Layer 1 - it is a staging inbox for quick captures awaiting promotion by `wiki-ingest`.

## Vault Layout

**Categories** say what kind of knowledge; **projects** say where it came from.

| Category | Purpose |
|---|---|
| `concepts/` | Ideas, theories, mental models |
| `entities/` | People, orgs, tools, projects |
| `skills/` | How-to knowledge, procedures |
| `references/` | Summaries of specific sources |
| `synthesis/` | Cross-cutting analysis |
| `journal/` | Timestamped observations |

Project-specific knowledge goes under `projects/<name>/<category>/`; general knowledge goes in the global category folders. Every project has an overview page at `projects/<name>/<name>.md` - named after the project, never `_project.md` (Obsidian's graph labels nodes by filename). Project pages and global pages should wikilink each other.

## Special Files

| File | Purpose |
|---|---|
| `index.md` | Catalog by category: `- [[page]] - one-line summary ( #tag #tag)`. Note the space after `(` - `(#tag` breaks parsing. Regenerate via `vault` with `action: "sync_index"` at the end of write sessions (do not hand-edit unless fixing a specific line). |
| `log.md` | Append-only operation log: `- [ISO-timestamp] INGEST source="..." pages_created=N pages_updated=M` |
| `hot.md` | ~500-word session cache: Recent Activity, Active Threads, Key Takeaways, Flagged Contradictions. Refresh after material changes. |
| `_meta/manifest.md` | Ingest ledger - see below |

### `_meta/manifest.md`

Tracks what has been ingested so the delta can be computed. A normal markdown note, read and written **via MCP like everything else**. Legacy `.manifest.json` files are unreachable under the MCP contract - if one exists, tell the user and start a fresh `_meta/manifest.md`.

```markdown
---
title: Wiki Manifest
source_dirs:
  - C:/absolute/path/to/sources
---

# Wiki Manifest

## Sources

- `/abs/path/paper.pdf` | ingested: 2026-07-12T16:00:00Z | mtime: 2026-07-10T09:00:00Z | pages: [[concepts/foo]], [[references/paper]]

## Projects

- `my-project` | cwd: /abs/path/to/project | last_commit: abc123f | synced: 2026-07-12T16:00:00Z
```

Source keys are absolute paths, one canonical form, never mixed with `~`-relative paths.

## Page Template

```markdown
---
title: Page Title
category: concepts
tags: [two-to-five, taxonomy-tags]
summary: One or two sentences, ≤200 chars - lets skills preview the page without reading it.
sources: [where this came from]
aliases: [optional real alternate names for search and wikilinks - not misspellings]
created: 2026-07-12T16:00:00Z
updated: 2026-07-12T16:00:00Z
---

# Page Title

One-paragraph summary.

## Key Ideas

- A claim the source actually makes.
- A generalization the source implies. ^[inferred]
- A point where sources disagree. ^[ambiguous]

## Related

- [[concepts/related-page]] - why it's related
```

Every page needs the frontmatter above, a `summary`, and at least 2 wikilinks. Older pages may carry extra fields (`provenance` ratios, `base_confidence`, `lifecycle`, `tier`, `relationships`) - **decorative leftovers from removed skill machinery**. Tolerate them on read; do not require them on write; do not invent new ones; do not bulk-strip existing pages unless the user asks.

## Provenance Markers

Default (no marker) = paraphrase of what a source says. `^[inferred]` = you synthesized it. `^[ambiguous]` = sources disagree or the source is unclear. A wiki that hides its guessing rots silently; one that marks it stays trustworthy.

## Core Principles

1. **Compile, don't retrieve.** Ingesting a source means updating every relevant page, not writing one summary of the source.
2. **Compound over time.** Merge into existing pages, resolve contradictions, strengthen cross-links. Each ingest makes the wiki smarter, not just bigger.
3. **Provenance matters.** Every claim traces to a source; mark inferences.
4. **Human curates, LLM maintains.** The human picks sources and asks questions; you keep the wiki consistent.
5. **Obsidian is the IDE.** Everything must be valid Obsidian markdown with working `[[wikilinks]]`.
6. **MCP or stop.** The vault is only ever touched through `user-cursidian`. If that fails, report and halt.

## Companion Skills

- **wiki-setup** - bootstrap a new vault
- **wiki-ingest** - distill sources into pages
- **wiki-capture** - save session findings
- **wiki-query** - answer questions (read-only)
- **wiki-lint** - health audit and repair
- **wiki-update** - sync a project into the wiki
- **wiki-status** - delta report and hot.md refresh
