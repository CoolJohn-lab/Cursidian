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
2. Reads use `search` (actions: `content`, `by_tags`, `list`, `recent`, `tags`), `note` (action: `read`), `graph`, `vault` (actions: `health`, `slop_check`, `history`, `manifest` with `manifestOperation: "read"`, `vocabulary` with `vocabularyOperation: "read"`, `list_folders`), `context` (actions: `assemble`, `for_task`, `expand` - always read-only). Writes use `note` (actions: `create`, `update`, `delete`, `rename`, `frontmatter`), `vault` (actions: `sync_index`, `deslop`, `create_folder`, `delete_folder`, `log`, `undo`, `manifest` mutations, `vocabulary` mutations), `context` (action: `feedback` - local telemetry log only, no vault content changes).
3. Edits follow the safe-write protocol: `note` with `action: "read"` -> note the `revisionHash` (and legacy `contentHash`) -> mutate with `expectedRevision`. Prefer surgical modes for small edits (`patch` > `replace_section` > `append`/`prepend`); for wholesale page rewrites (version sync, multi-section overhaul) use a single `replace` instead of chained `replace_section`. Prefer one combined `note` `update` that carries both body and `frontmatter` (merge). If body and frontmatter must be separate ops, update body first, then `frontmatter` with the post-body `revisionHash` - never both in one parallel batch. Serialize per path: `read` -> immediate write with that `revisionHash` -> use the **response** `revisionHash` for any further write to that path. Never parallel `note` mutations (or read-then-batch-write) for the same path. Prefer `expectedRevision` over deprecated `expectedHash`.
4. Mutating skills keep an **operation-ID stack**: after every successful write that returns `operationId`, push it. Clear the stack only after final verification succeeds. On failure after any successful write, roll back with `vault` `undo` in reverse order (see Failure handling).
5. **If an MCP call fails after the recovery rules below are exhausted: stop.** Tell the user which tool was called, with what arguments, what came back (`code`, `sideEffects`, `recovery`, `operationId`s already stacked), and wait. Do not retry with different tools, do not fall back to the filesystem, do not improvise.
6. If the `user-cursidian` server is missing or unreachable, say so and stop. Point the user at `INSTALL.md`. Do not offer a manual alternative.
7. Every vault MCP invocation must set `server: "user-cursidian"` and `toolName` to exactly one of `note` | `search` | `graph` | `vault` | `context`. Discover schemas with `GetMcpTools` first. Never send only `arguments` + `description` (missing `server`/`toolName` fails before Cursidian runs). `search` with `action: "tags"` accepts **no** other arguments (no `limit` / `cursor`).

The only files read outside MCP are **source documents that live outside the vault** - the things being ingested - and **repo** deslop via npm (`slop:check` / `slop:fix` on the Cursidian package tree). Vault deslop is MCP-only (`vault` `slop_check` / `deslop`). The moment content enters the vault, it is MCP-only.

### Tool map (5 tools)

| Tool | Actions | Notes |
|---|---|---|
| `search` | `content` (default), `by_tags`, `list`, `recent`, `tags` | `content`: default `limit: 10`; `format: "compact"` for index-only hits; follow `nextCursor` while `truncated` is true. Operational files (`index`/`log`/`hot`/`_raw`/`_archives`) excluded unless `includeOperational: true`. Stopwords stripped; AND then OR-fallback; typo correction when zero hits (disclose when either fired). `list`/`recent`: same exclusion; `list` fails loud (`not_found`) on a missing folder. `tags`: full tag vocabulary with counts; accepts **no** other arguments (no `limit`/`cursor`). Responses may set `incomplete: true` with `skipped` paths when the scan could not read every file. |
| `note` | `read`, `create`, `update`, `delete`, `rename`, `frontmatter` | `read`: body, frontmatter, `contentHash`, `revisionHash`, `outgoingLinks`. Mutations return `operationId` / `undoAvailable` when journaling is on. Pass `expectedRevision` on `update`, `frontmatter`, `delete`, `rename`, and `create` with `overwrite: true`. `expectedHash` still works as a deprecated alias. `update` modes: `patch`, `replace_section`, `append`, `prepend`, `replace`; optional `frontmatter` merge on the same `update` (one journaled op for body + metadata). Prefer that combined update over separate body then `frontmatter` calls. `rename`: `newPath`; rewrites backlinks under one journaled operation. `delete`: `confirm: true`. |
| `graph` | - | One-hop neighborhood: resolved outgoing, **unresolved** outgoing, paginated backlinks (`truncated` / `nextCursor`). Skip neighbors whose `resolvedPath` is null. |
| `vault` | `health`, `sync_index`, `slop_check`, `deslop`, `create_folder`, `list_folders`, `delete_folder`, `log`, `history`, `undo`, `manifest`, `vocabulary` | `health`: orphans / broken links / missing frontmatter / summary warnings / index drift / ambiguous keys / stale / skipped (`incomplete`); includes `indexMode` (`flat`\|`hub`). `sync_index`: flat rebuild of `index.md`, or hub-mode refresh of existing router blurbs only (`dryRun: true` for preview). `slop_check`: read-only body+frontmatter LLM-slop report. `deslop`: journaled char/emoji fix (`dryRun` / `confirm: true`); may sync index when summaries change (hub-safe). `log`: append `log.md` + optional `hot.md`. `history`: list journaled ops. `undo`: requires `operationId` + `confirm: true` (optional `force: true`). `manifest`: `manifestOperation` `read` / `upsert_source` / `upsert_project` / `remove` - typed ledger edits; do not hand-edit `_meta/manifest.md` lines. `vocabulary`: `vocabularyOperation` `read` / `upsert` / `remove` - typed edits to `_meta/vocabulary.md` domain synonyms (symmetric groups) and pairings (directional, key -> values); `search` `content` expands query tokens against it, scoring expansion-only hits below literal hits; do not hand-edit `_meta/vocabulary.md` lines. |
| `context` | `assemble` (default), `for_task`, `expand`, `feedback` | The Context Generation Engine. `assemble`/`for_task`: `query`/`task` + `tokenBudget` (default 4000) + optional `intent` (`lookup`, `connection`, `onboarding`, `troubleshoot`, `ingest-prep`; inferred from phrasing when omitted). Returns a `ContextBundle`: `items` ordered highest-value-first (`kind`: `summary`/`section`/`body`/`neighbor-note`, `score`, `reasons`, `provenance`, `lifecycle`, `updated`, `staleDays`, `tokens`), `coverage` (`includedPaths`/`consideredPaths`/`droppedForBudget`), `warnings` (staleness, heavy-inference, contradictions, incomplete scans), `citations` (`[[wikilinks]]`), `bundleConfidence` (0-1), and `nextCursor`. Never exceeds `tokenBudget`; composes `search`/`graph` internally (read-only, no new write path). `expand`: continue a prior bundle from its `nextCursor` with a fresh `tokenBudget`. `feedback`: record `feedbackQuery` + `feedbackVerdict` (`insufficient`/`off_target`) to a local `.cursidian/context-feedback.jsonl` log (rejected in read-only vaults). |

### Context bundle (retrieval-ladder-as-cost-model)

`context` is the preferred entry point for "what do I need to know" work - prefer it over hand-rolling `search` -> read -> `graph` loops. It picks the **cheapest sufficient** representation per candidate page: frontmatter `summary` first, then the best-matching `## section`, then full `body` only when budget remains and the page is a primary hit. Overlapping passages (shared heading or >60% word-shingle overlap) are deduplicated, keeping the higher-scored one. `^[inferred]`/`^[ambiguous]` markers and `> Contradicts [[other-page]]` callouts are never stripped from item text; a contradicted page's counterpart is pulled into the same bundle where budget allows, and both sides are called out in `warnings`. Follow `nextCursor` with `context` `expand` when a bundle is thin rather than re-querying `search` by hand.

### Revision semantics

- `revisionHash` covers the **full note** (frontmatter + body). Use it for concurrency.
- `contentHash` covers the body only; keep reading it, but prefer `revisionHash` / `expectedRevision` for writes.
- Concurrent frontmatter-only edits change `revisionHash` but not `contentHash`.
- After every successful write, replace any cached `revisionHash` for that path with the response value. Never reuse a pre-batch read revision for a second write to the same path.

### Pagination and incomplete scans

- `search` actions `content`, `by_tags`, `list`, `recent`, and `graph` backlinks may return `truncated: true` and `nextCursor`. Follow the cursor until `truncated` is false. A stale cursor returns a structured error; recovery is to rerun from page one (no cursor).
- Never treat a single page (e.g. default `limit: 10` compact hits) as the full result set.
- If `incomplete: true` or `skipped` is non-empty, say so in the user report; do not claim a clean or empty vault.

### Failure handling and rollback

Keep a session list: `operationStack: string[]` (newest at the end).

| Error / situation | Agent action |
|---|---|
| `hash_mismatch` / revision mismatch | Prefer `details.currentRevision` from the error for frontmatter-only merges and full `replace` retries. For body `patch` / `replace_section`, re-read that path, re-derive `old_string` / heading from the fresh body, then retry **once** with the fresh `expectedRevision`. If the second attempt fails, stop and report. |
| Same path written twice in one workflow | After each success, replace cached `revisionHash` from the response; never reuse a pre-batch read. |
| Parallel same-path tool calls | Forbidden. Serialize: one note at a time. |
| Cursor auto-review / Smart Mode blocks a write | Re-call the **same** mutation with `requestSmartModeApproval: true` and the exact returned `smartModeBlockReason`. Do not invent filesystem workarounds or skip the page. After approval resumes, re-read which planned writes actually landed before continuing the sweep. |
| Correctable `invalid_args`, `already_exists`, `not_found` | Follow the structured `recovery` payload **once** (exact tool + argument template). Candidate paths are arrays in `details`, never comma-joined strings. Use `details.conflictKind` / `suggestion` when present (e.g. widen `old_string`, or `replace` for wholesale rewrite). |
| Any error **after** one or more successful writes in this workflow | Call `vault` with `action: "undo"`, `confirm: true`, for each stacked `operationId` in **reverse** order. Then stop and report what was undone vs what failed. |
| `sideEffects: "partial"` | Stop immediately. Report `completed` / `restored` / `unresolved` from the error. Do not continue the workflow; do not invent further repairs without user instruction. |
| Undo conflict (file no longer matches post-write revision) | Stop. Report conflicts. Do **not** pass `force: true` unless the user explicitly authorizes destructive override. |
| `undoAvailable: false` (backups disabled) | Mutations may still have succeeded; warn the user that undo is unavailable and stop on failure instead of attempting undo. |

Never clear `operationStack` until final verification passes. Never fall back to filesystem tools.

### Mutating skill workflow shape

Every write skill (setup, ingest, capture, update, lint consolidate, status hot-refresh) follows:

1. **Preflight** - read-only discovery; collect inputs the user must supply before any write.
2. **Announce write scope** - before the first mutation in a multi-page workflow, send one short message listing the paths about to change and why. The user's trigger phrase (e.g. "update wiki") is the authorization - do **not** add a blocking confirmation round-trip (wiki-lint consolidate keeps its stricter confirm because it is cleanup the user has not itemized). Stating scope also helps Cursor auto-review classify the writes as requested.
3. **Write sequencing** - one note at a time. Prefer combined body+`frontmatter` on a single `note` `update`. Push `operationId` after each success before starting the next note. Do not read all pages upfront then write in parallel; read immediately before each write (or chain the response `revisionHash`).
4. **Operation stack** - push every returned `operationId`.
5. **Rollback** - on failure after writes, undo reverse-order as above.
6. **Verification** - after multi-page write workflows: `note` `read` each changed page; `vault` `sync_index` with `dryRun: true` expecting `wouldWrite: false` (flat rebuild or hub blurb refresh - check health `indexMode`); report residual drift instead of claiming success.
7. **Final report** - created / updated / renamed paths, manifest record (if any), index state, warnings, and operation IDs retained for later undo. Then clear the stack.

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
| `index.md` | **Flat mode** (default): full leaf catalog by category `- [[page]] - one-line summary ( #tag #tag)`. Note the space after `(` - `(#tag` breaks parsing. Regenerate via `vault` `sync_index`. **Hub mode** (`indexMode: hub` in frontmatter): curated router - hubs/top-level only; leaves belong on hub page catalogs. `sync_index` preserves the curated body (never dumps every leaf). Health treats a leaf as catalogued if it is on `index.md` **or** within 2 outbound hops of a listed page (hub -> catalog -> leaf); hub mode does not require index blurbs to match frontmatter `summary`. New hubs go on `index.md`; new leaves go on the relevant hub. |
| `log.md` | Append-only operation log: `- [ISO-timestamp] INGEST source="..." pages_created=N pages_updated=M` |
| `hot.md` | ~500-word session cache: Recent Activity, Active Threads, Key Takeaways, Flagged Contradictions. Refresh after material changes when the workflow says so. |
| `_meta/manifest.md` | Ingest ledger - mutate only via `vault` `manifest` |
| `_meta/vocabulary.md` | Domain synonyms/pairings for search expansion - mutate only via `vault` `vocabulary` |

Read `indexMode` from `vault` `health` (or `note` `read` on `index.md`) before treating "missing from index" as a defect. Flat vaults expect every leaf on `index.md`; hub vaults do not.

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

### `_meta/vocabulary.md`

Domain synonyms and word pairings that widen `search` `content` recall - e.g. a query for "integration" also finding pages that only say "ingestion". A normal markdown note, read via `vault` `vocabulary` (`vocabularyOperation: "read"`) or `note` `read`, and written **only** via `vault` `vocabulary` upsert/remove.

```markdown
---
title: Wiki Vocabulary
synonyms:
  - [ingestion, ingest, "inbound source"]
pairings:
  integration: [ingestion, egress]
---

# Wiki Vocabulary
```

`synonyms` groups are symmetric (any member expands to every other member); `pairings` are directional (the key expands to its values, not the reverse). Missing or malformed vocabulary degrades to no expansion - search still works normally. Expansion-only matches are scored below literal matches, so a page containing the literal query term always outranks one found only through expansion.

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
