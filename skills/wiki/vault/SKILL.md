---
name: vault
description: >
  Shared MCP contract and page schema for the Obsidian wiki (Karpathy LLM-wiki pattern).
  Use when any wiki skill needs tool rules, safe writes, failure/undo, or the page template;
  or when discussing vault layout / knowledge-distillation strategy. Ops live in wiki-ingest,
  wiki-query, wiki-lint, and the other wiki skills. Durable product facts live in the wiki.
---

# Vault - MCP contract and schema

You maintain a **compiled** wiki: distill once, keep current, query the artifact. Obsidian is the IDE; the wiki is the codebase.

## Must read (wiki SoT)

Before inventing product facts or tool behaviour, `note` `read` via **`user-cursidian`**:

| Path | Holds |
|------|-------|
| `projects/cursidian/cursidian` | Product overview, agent usage, project pages |
| `projects/cursidian/concepts/mcp-tool-surface` | Full tool/action map, concurrency, retired names |
| `concepts/cursor-rule-skill-wiki-stack` | Rule -> skill -> wiki layer contract |

This skill is the **protocol** layer (hard rules agents must not violate). Wiki pages are the **durable SoT** when facts change.

## The MCP Contract - read this first

**All vault access goes through the `user-cursidian` MCP server. There is no other path.**

1. **Never** touch vault files with filesystem tools (`Read`, `Write`, `StrReplace`, `Grep`, `Glob`) or shell (`cat`, `sed`, `mkdir`, `mv`, `rm`, ...). Covers pages, `index.md`, `log.md`, `hot.md`, `_meta/`, `_raw/` - everything.
2. **Reads:** `search` (`content`, `by_tags`, `list`, `recent`, `tags`), `note` `read`, `graph`, `vault` (`health`, `slop_check`, `history`, `manifest`/`vocabulary` read, `list_folders`), `context` (`assemble`, `for_task`, `expand`). **Writes:** `note` (`create`, `update`, `delete`, `rename`, `frontmatter`), `vault` (`sync_index`, `deslop`, `create_folder`, `delete_folder`, `log`, `undo`, `manifest`/`vocabulary` mutations), `context` `feedback` (local telemetry only).
3. **Safe write:** `note` `read` -> `revisionHash` -> mutate with `expectedRevision`. Prefer `patch` > `replace_section` > `append`/`prepend`; wholesale rewrite -> one `replace`. Prefer one combined `update` with body + `frontmatter` (merge). Serialize per path: `read` -> write -> use **response** `revisionHash` for the next write. Never parallel same-path mutations. Prefer `expectedRevision` over deprecated `expectedHash`.
4. Keep an **operation-ID stack** (`operationStack`): push every returned `operationId`. Clear only after final verification. On failure after writes, `vault` `undo` reverse-order.
5. After recovery rules are exhausted: **stop**. Report tool, args, `code` / `sideEffects` / `recovery` / stacked ids. No filesystem fallback.
6. If `user-cursidian` is missing/unreachable: stop; point at `skills/wiki/INSTALL.md`.
7. Every call: `server: "user-cursidian"` + `toolName` one of `note` | `search` | `graph` | `vault` | `context`. Discover schemas with `GetMcpTools` first. Never send only `arguments` + `description`. `search` `tags` accepts **no** other arguments.

Outside MCP: source docs **outside** the vault (ingest), and **repo** deslop via npm. Vault deslop is MCP-only (`slop_check` / `deslop`).

### Tool map (essentials)

| Tool | Actions (summary) |
|---|---|
| `search` | `content` (default limit 10; `format: "compact"`; paginate `nextCursor`), `by_tags`, `list`, `recent`, `tags`. Operational paths excluded unless `includeOperational: true`. |
| `note` | `read` (+ `revisionHash`), `create`/`update`/`delete`/`rename`/`frontmatter`. Mutations return `operationId`. `delete` needs `confirm: true`. |
| `graph` | One-hop neighborhood; skip null `resolvedPath`; paginate backlinks. |
| `vault` | `health`, `sync_index` (flat rebuild vs hub preserve - check `indexMode`), `slop_check`/`deslop`, folders, `log`, `history`/`undo`, `manifest`, `vocabulary`. |
| `context` | Prefer over hand-rolled search->read loops (session-first). `assemble`/`for_task` (+ `tokenBudget`, optional `intent`); returns `focus` + `guidance.nextStep`; `expand` via `nextCursor`; `feedback` for bad bundles. |

Full action tables, retired names, and edge cases: wiki `projects/cursidian/concepts/mcp-tool-surface`.

### Revision / pagination

- `revisionHash` = full note; `contentHash` = body only (prefer revision for writes).
- Follow `truncated` / `nextCursor`. If `incomplete` or `skipped`, say so - do not claim a clean vault.

### Failure handling and rollback

| Situation | Action |
|---|---|
| `hash_mismatch` | Prefer `details.currentRevision` for FM-only / full `replace`. For `patch`/`replace_section`, re-read, re-derive strings, retry **once**. |
| Same path twice | Chain response `revisionHash`; never reuse a pre-batch read. |
| Parallel same-path | Forbidden - one note at a time. |
| Smart Mode block | Re-call same mutation with `requestSmartModeApproval: true` + exact `smartModeBlockReason`. |
| Correctable `invalid_args` / `already_exists` / `not_found` | Follow `recovery` **once**. |
| Error after successful writes | `vault` `undo` each stacked `operationId` reverse-order, then stop. |
| `sideEffects: "partial"` | Stop; report; do not invent repairs. |
| Undo conflict | Stop; no `force: true` unless user authorizes. |
| `undoAvailable: false` | Warn; stop on failure (no undo). |

### Mutating skill workflow shape

1. Preflight (read-only). 2. Announce write scope (paths + why) before first mutation. 3. One note at a time; push `operationId`. 4. On failure, undo reverse-order. 5. Verify: `note` `read` changed pages; `vault` `sync_index` `dryRun: true` expect `wouldWrite: false` (respect `indexMode`); prefer `health` with `counts.indexDrift: 0` under hub. 6. Report paths / warnings / op ids; clear stack.

### Retrieval ladder

Cheapest first: `search` `list`/`tags` -> compact `content` summaries -> `by_tags` -> full `content` -> `note` `read` -> `graph`. Prefer `context` for "what do I need to know" work.

## Schema pointers (detail in wiki / template below)

| Topic | Where |
|-------|-------|
| Categories / projects layout | Wiki + table below |
| Special files (`index`/`log`/`hot`/`_meta`) | Brief below; hub vs flat from `vault` `health` `indexMode` |
| Page frontmatter + body shape | Page Template |
| Provenance markers | `^[inferred]` / `^[ambiguous]` |

### Vault layout (summary)

Categories: `concepts/` `entities/` `skills/` `references/` `synthesis/` `journal/`. Project knowledge: `projects/<name>/<category>/` with overview `projects/<name>/<name>.md` (never `_project.md`). `_raw/` is a staging inbox, not Layer-1 sources.

### Special files (summary)

| File | Role |
|------|------|
| `index.md` | Flat: full leaf catalog via `sync_index`. Hub (`indexMode: hub`): curated router; `sync_index` preserves body; leaves catalogued if on index **or** within 2 hops of a listed page. |
| `log.md` / `hot.md` | Append-only log; ~500-word session cache via `vault` `log`. |
| `_meta/manifest.md` | Ingest ledger - **only** via `vault` `manifest`. |
| `_meta/vocabulary.md` | Synonyms/pairings - **only** via `vault` `vocabulary`. |

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

Every page needs that frontmatter, a `summary`, and at least 2 wikilinks. Tolerate legacy decorative fields on read; do not require or invent them on write.

## Critical avoid

| Do not | Do instead |
|--------|------------|
| Filesystem / shell on vault paths | `user-cursidian` only |
| Call retired Obsidian-MCP tool names | 5-tool surface (see wiki mcp-tool-surface) |
| Parallel same-path writes | Serialize + chain `revisionHash` |
| Clear `operationStack` before verify | Undo reverse-order on failure |
| Treat hub sparsity as index drift | Read `indexMode` from `health` |
| Re-copy wiki tables into rules | Thin rule -> this skill -> wiki SoT |

## Core principles

1. Compile, don't retrieve. 2. Compound over time (merge, contradict, link). 3. Mark provenance. 4. Human curates, LLM maintains. 5. Valid Obsidian `[[wikilinks]]`. 6. MCP or stop.

## Companion skills

`wiki-setup` `wiki-ingest` `wiki-capture` `wiki-query` `wiki-context` `wiki-lint` `wiki-update` `wiki-status` `wiki-slop`
