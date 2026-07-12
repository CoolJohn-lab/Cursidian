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
2. Reads use `search` (actions: `content`, `by_tags`, `list`, `recent`, `tags`), `note` (action: `read`), `graph`, `vault` (actions: `health`, `history`, `manifest` with `manifestOperation: "read"`, `list_folders`). Writes use `note` (actions: `create`, `update`, `delete`, `rename`, `frontmatter`), `vault` (actions: `sync_index`, `create_folder`, `delete_folder`, `log`, `undo`, `manifest` mutations).
3. Edits follow the safe-write protocol: `note` with `action: "read"` -> note the `revisionHash` (and legacy `contentHash`) -> mutate with the narrowest mode (`patch` > `replace_section` > `append`/`prepend` > `replace`) passing `expectedRevision`. On `hash_mismatch` / revision mismatch, re-read and re-apply once against the fresh content. Prefer `expectedRevision` over deprecated `expectedHash`.
4. Mutating skills keep an **operation-ID stack**: after every successful write that returns `operationId`, push it. Clear the stack only after final verification succeeds. On failure after any successful write, roll back with `vault` `undo` in reverse order (see Failure handling).
5. **If an MCP call fails after the recovery rules below are exhausted: stop.** Tell the user which tool was called, with what arguments, what came back (`code`, `sideEffects`, `recovery`, `operationId`s already stacked), and wait. Do not retry with different tools, do not fall back to the filesystem, do not improvise.
6. If the `user-cursidian` server is missing or unreachable, say so and stop. Point the user at `INSTALL.md`. Do not offer a manual alternative.

The only files read outside MCP are **source documents that live outside the vault** - the things being ingested. Use `Read`/`Glob`/`WebFetch` on those as normal. The moment content enters the vault, it is MCP-only.

### Tool map (4 tools)

| Tool | Actions | Notes |
|---|---|---|
| `search` | `content` (default), `by_tags`, `list`, `recent`, `tags` | `content`: default `limit: 10`; `format: "compact"` for index-only hits; follow `nextCursor` while `truncated` is true. Operational files (`index`/`log`/`hot`/`_raw`/`_archives`) excluded unless `includeOperational: true`. Stopwords stripped; AND then OR-fallback; typo correction when zero hits (disclose when either fired). `list`/`recent`: same exclusion; `list` fails loud (`not_found`) on a missing folder. Responses may set `incomplete: true` with `skipped` paths when the scan could not read every file. |
| `note` | `read`, `create`, `update`, `delete`, `rename`, `frontmatter` | `read`: body, frontmatter, `contentHash`, `revisionHash`, `outgoingLinks`. Mutations return `operationId` / `undoAvailable` when journaling is on. Pass `expectedRevision` on `update`, `frontmatter`, `delete`, `rename`, and `create` with `overwrite: true`. `expectedHash` still works as a deprecated alias. `update` modes: `patch`, `replace_section`, `append`, `prepend`, `replace`. `rename`: `newPath`; rewrites backlinks under one journaled operation. `delete`: `confirm: true`. |
| `graph` | - | One-hop neighborhood: resolved outgoing, **unresolved** outgoing, paginated backlinks (`truncated` / `nextCursor`). Skip neighbors whose `resolvedPath` is null. |
| `vault` | `health`, `sync_index`, `create_folder`, `list_folders`, `delete_folder`, `log`, `history`, `undo`, `manifest` | `health`: orphans / broken links / missing frontmatter / summary warnings / index drift / ambiguous keys / stale / skipped (`incomplete`). `sync_index`: rebuild `index.md` (`dryRun: true` for preview). `log`: append `log.md` + optional `hot.md`. `history`: list journaled ops. `undo`: requires `operationId` + `confirm: true` (optional `force: true`). `manifest`: `manifestOperation` `read` / `upsert_source` / `upsert_project` / `remove` - typed ledger edits; do not hand-edit `_meta/manifest.md` lines. |

### Revision semantics

- `revisionHash` covers the **full note** (frontmatter + body). Use it for concurrency.
- `contentHash` covers the body only; keep reading it, but prefer `revisionHash` / `expectedRevision` for writes.
- Concurrent frontmatter-only edits change `revisionHash` but not `contentHash`.

### Pagination and incomplete scans

- `search` actions `content`, `by_tags`, `list`, `recent`, and `graph` backlinks may return `truncated: true` and `nextCursor`. Follow the cursor until `truncated` is false. A stale cursor returns a structured error; recovery is to rerun from page one (no cursor).
- Never treat a single page (e.g. default `limit: 10` compact hits) as the full result set.
- If `incomplete: true` or `skipped` is non-empty, say so in the user report; do not claim a clean or empty vault.

### Failure handling and rollback

Keep a session list: `operationStack: string[]` (newest at the end).

| Error / situation | Agent action |
|---|---|
| `hash_mismatch` / revision mismatch | Re-read the path, then reapply the same intent **once** with the fresh `expectedRevision`. If the second attempt fails, stop and report. |
| Correctable `invalid_args`, `already_exists`, `not_found` | Follow the structured `recovery` payload **once** (exact tool + argument template). Candidate paths are arrays in `details`, never comma-joined strings. |
| Any error **after** one or more successful writes in this workflow | Call `vault` with `action: "undo"`, `confirm: true`, for each stacked `operationId` in **reverse** order. Then stop and report what was undone vs what failed. |
| `sideEffects: "partial"` | Stop immediately. Report `completed` / `restored` / `unresolved` from the error. Do not continue the workflow; do not invent further repairs without user instruction. |
| Undo conflict (file no longer matches post-write revision) | Stop. Report conflicts. Do **not** pass `force: true` unless the user explicitly authorizes destructive override. |
| `undoAvailable: false` (backups disabled) | Mutations may still have succeeded; warn the user that undo is unavailable and stop on failure instead of attempting undo. |

Never clear `operationStack` until final verification passes. Never fall back to filesystem tools.

### Mutating skill workflow shape

Every write skill (setup, ingest, capture, update, lint consolidate, status hot-refresh) follows:

1. **Preflight** - read-only discovery; collect inputs the user must supply before any write.
2. **Operation stack** - push every returned `operationId`.
3. **Rollback** - on failure after writes, undo reverse-order as above.
4. **Verification** - after multi-page write workflows: `note` `read` each changed page; `vault` `sync_index` with `dryRun: true` expecting `wouldWrite: false`; report residual drift instead of claiming success.
5. **Final report** - created / updated / renamed paths, manifest record (if any), index state, warnings, and operation IDs retained for later undo. Then clear the stack.

### Retrieval ladder

Use the cheapest call that answers the question; escalate only when it can't.

1. `search` with `action: "list"` or `action: "tags"` - what exists
2. Frontmatter `summary` from search hits - use `search` with `action: "content"`, `format: "compact"`, `limit: 10` (paginate if `truncated`)
3. `search` with `action: "by_tags"` - metadata filter
4. `search` with `action: "content"` - full text (default) or compact metadata
5. `note` with `action: "read"` - full body (last resort)
6. `graph` - link neighborhood (outgoing + backlinks; skip null `resolvedPath`)

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
| `hot.md` | ~500-word session cache: Recent Activity, Active Threads, Key Takeaways, Flagged Contradictions. Refresh after material changes when the workflow says so. |
| `_meta/manifest.md` | Ingest ledger - mutate only via `vault` `manifest` |

### `_meta/manifest.md`

Tracks what has been ingested so the delta can be computed. A normal markdown note, read via `vault` `manifest` (`manifestOperation: "read"`) or `note` `read`, and written **only** via `vault` `manifest` upsert/remove. Legacy `.manifest.json` files are unreachable under the MCP contract - if one exists, tell the user and start a fresh `_meta/manifest.md`.

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

Source keys are absolute paths, one canonical form (forward slashes, case-preserved), never mixed with `~`-relative paths. Prefer `vault` `manifest` so Windows path normalization stays consistent.

## Page Template

```markdown
---
title: Page Title
category: concepts
tags: [two-to-five, taxonomy-tags]
summary: One or two sentences, <=200 chars - lets skills preview the page without reading it.
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
