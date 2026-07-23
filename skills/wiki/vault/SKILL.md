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

## Wiki sources of truth

Before inventing product facts or tool behaviour, consult these via **`user-cursidian`**. Choose `context`, compact `search`, `note outline`, or `note read` according to the information needed; a full read is not automatic.

| Path                                           | Holds                                            |
| ---------------------------------------------- | ------------------------------------------------ |
| `projects/cursidian/cursidian`                 | Product overview, agent usage, project pages     |
| `projects/cursidian/concepts/mcp-tool-surface` | Full tool/action map, concurrency, retired names |
| `concepts/cursor-rule-skill-wiki-stack`        | Rule -> skill -> wiki layer contract             |

This skill is the **protocol** layer (hard rules agents must not violate). Wiki pages are the **durable SoT** when facts change.

## The MCP Contract - read this first

**All vault access goes through the `user-cursidian` MCP server. There is no other path.**

1. **Never** touch vault files with filesystem tools (`Read`, `Write`, `StrReplace`, `Grep`, `Glob`) or shell (`cat`, `sed`, `mkdir`, `mv`, `rm`, ...). Covers pages, `index.md`, `_meta/`, `_raw/` - everything.
2. **Reads:** `search` (`content`, `by_tags`, `list`, `recent`, `tags`), `note` `read` / `outline`, `graph`, `vault` (`health`, `slop_check`, `history`, `manifest`/`vocabulary` read, `list_folders`), `context` (`assemble`, `for_task`, `expand`). **Writes:** `note` (`create`, `update`, `delete`, `rename`, `frontmatter`), `vault` (`sync_index`, `deslop`, `create_folder`, `delete_folder`, `undo`, `manifest`/`vocabulary` mutations), `context` `feedback` (local telemetry only).
3. **Safe write:** `note` `read` -> `revisionHash` -> mutate with `expectedRevision`. Prefer `patch` > `replace_section` > `append`/`prepend`; wholesale rewrite -> one `replace`. Prefer one combined `update` with body + `frontmatter` (merge). Serialize per path: `read` -> write -> use **response** `revisionHash` for the next write. Never parallel same-path mutations. Prefer `expectedRevision` over deprecated `expectedHash`.
4. Keep an **operation-ID stack** (`operationStack`): push every returned `operationId`. Clear only after final verification. On failure after writes, `vault` `undo` reverse-order.
5. After recovery rules are exhausted: **stop**. Report tool, args, `code` / `sideEffects` / `recovery` / stacked ids. No filesystem fallback.
6. If `user-cursidian` is missing/unreachable: stop; point at `skills/wiki/INSTALL.md`.
7. Every call: `server: "user-cursidian"` + `toolName` one of `note` | `search` | `graph` | `vault` | `context`. Discover schemas with `GetMcpTools` first. Never send only `arguments` + `description`. `search` `tags` accepts **no** other arguments.

Outside MCP: source docs **outside** the vault (ingest). On-disk deslop (repos / cursor-global) -> skill `slop` (wiki `skills/local-deslop`). Vault deslop is MCP-only (`slop_check` / `deslop`) via skill `wiki-slop`.

### Tool map (essentials)

| Tool      | Actions (summary)                                                                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search`  | `content` (default limit 10; `format: "compact"`; paginate `nextCursor`), `by_tags`, `list`, `recent`, `tags`. Operational paths excluded unless `includeOperational: true`.                                          |
| `note`    | `read` / `outline` (+ `revisionHash` on read), `create`/`update`/`delete`/`rename`/`frontmatter`. `outline` returns headings without body; `update` accepts `dryRun`. Mutations return `operationId`. `delete` needs `confirm: true`. |
| `graph`   | One-hop neighborhood; skip null `resolvedPath`; paginate backlinks.                                                                                                                                                   |
| `vault`   | `health` (incl. soft `schemaWarnings` / `provenanceStats`), `sync_index` (flat rebuild vs hub preserve - check `indexMode`), `slop_check`/`deslop`, folders, `history`/`undo`, `manifest`, `vocabulary`. |
| `context` | Broad/uncertain/multi-page questions and task briefings. `assemble`/`for_task` (+ `tokenBudget`, optional `intent`); returns `focus` + `guidance.nextStep`; `expand` via `nextCursor`; `feedback` for bad bundles. |

Full action tables, retired names, and edge cases: wiki `projects/cursidian/concepts/mcp-tool-surface`.

### Revision / pagination

- `revisionHash` = full note; `contentHash` = body only (prefer revision for writes).
- Follow `truncated` / `nextCursor`. If `incomplete` or `skipped`, say so - do not claim a clean vault.

### Failure handling and rollback

| Situation                                                   | Action                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `hash_mismatch`                                             | Prefer `details.currentRevision` for FM-only / full `replace`. For `patch`/`replace_section`, re-read, re-derive strings, retry **once**. |
| Same path twice                                             | Chain response `revisionHash`; never reuse a pre-batch read.                                                                              |
| Parallel same-path                                          | Forbidden - one note at a time.                                                                                                           |
| Smart Mode block                                            | Re-call same mutation with `requestSmartModeApproval: true` + exact `smartModeBlockReason`.                                               |
| Correctable `invalid_args` / `already_exists` / `not_found` | Follow `recovery` **once**.                                                                                                               |
| Error after successful writes                               | `vault` `undo` each stacked `operationId` reverse-order, then stop.                                                                       |
| `sideEffects: "partial"`                                    | Stop; report; do not invent repairs.                                                                                                      |
| Undo conflict                                               | Stop; no `force: true` unless user authorizes.                                                                                            |
| `undoAvailable: false`                                      | Warn; stop on failure (no undo).                                                                                                          |

### Mutating skill workflow shape

1. Preflight (read-only). 2. Announce write scope (paths + why) before first mutation. 3. One note at a time; push `operationId`. 4. On failure, undo reverse-order. 5. Verify: `note` `read` changed pages; `vault` `sync_index` `dryRun: true` expect `wouldWrite: false` (respect `indexMode`); prefer `health` with `counts.indexDrift: 0` under hub. 6. Report paths / warnings / op ids; clear stack.

## Adaptive retrieval

Use the cheapest tool that preserves the evidence the task needs. These are defaults, not a mandatory sequence.

| Information need | Start with | Deepen when |
| ---------------- | ---------- | ----------- |
| Broad, uncertain, multi-page, task briefing | `context` `assemble` / `for_task` | `guidance.nextStep` says expand, or the selected passage lacks required detail |
| Narrow fact, path unknown | `search` `content`, `format: "compact"` | Read or outline only the best candidate |
| Known page, headings/shape only | `note` `outline` | A section/body is required |
| Known page, exact evidence | `note` `read` | Always for mutation because writes need `revisionHash` |
| Inventory/taxonomy | `search` `list` / `recent` / `tags` / `by_tags` | Paginate when truncated |
| Explicit one-hop links on a known page | `graph` | Use `context intent: "connection"` when the relationship or path is uncertain |
| Vault state/ledger/vocabulary | Matching read action on `vault` | Use only the fields relevant to the task |

Starting `context` budgets: 300-500 for a summary skim, 600-1000 for routing, 1200-2500 for task context, and up to 4000 for deliberate body depth or synthesis. Follow `focus`, `guidance`, `warnings`, and `nextCursor`; do not automatically full-read every focus path. A returned `focus` item is already evidence.

Keep answers proportional: synthesize first and cite 1-3 primary pages by default. Report confidence, provenance, warnings, and dropped paths when they affect the conclusion rather than echoing the whole bundle.

Detailed rationale and examples: wiki `projects/cursidian/concepts/wiki-retrieval-strategy`.

## Write-only schema

For create/edit work, read `references/page-schema.md` before the first mutation. It contains the page template, vault layout, and special-file rules; read-only retrieval does not need that context.

## Critical avoid

| Do not                               | Do instead                                 |
| ------------------------------------ | ------------------------------------------ |
| Filesystem / shell on vault paths    | `user-cursidian` only                      |
| Call retired Obsidian-MCP tool names | 5-tool surface (see wiki mcp-tool-surface) |
| Parallel same-path writes            | Serialize + chain `revisionHash`           |
| Clear `operationStack` before verify | Undo reverse-order on failure              |
| Treat hub sparsity as index drift    | Read `indexMode` from `health`             |
| Re-copy wiki tables into rules       | Thin rule -> this skill -> wiki SoT        |

## Core principles

1. Compile, don't retrieve. 2. Compound over time (merge, contradict, link). 3. Mark provenance. 4. Human curates, LLM maintains. 5. Valid Obsidian `[[wikilinks]]`. 6. MCP or stop.

## Companion skills

`wiki-setup` `wiki-ingest` `wiki-capture` `wiki-query` `wiki-context` `wiki-lint` `wiki-update` `wiki-status` `wiki-slop` `slop`
