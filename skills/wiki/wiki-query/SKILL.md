---
name: wiki-query
description: >
  Answer questions from the compiled Obsidian wiki. Use when the user asks "what do I know about X",
  "find everything related to Y", or any question the knowledge base should answer, including
  connection questions ("how is X related to Y"). Supports a fast index-only mode ("quick answer",
  "just scan", "don't read the pages") that answers from summaries without reading page bodies.
---

# Wiki Query - Knowledge Retrieval

Answer from the compiled wiki, citing pages. **All vault access is via the `user-cursidian` MCP server** (MCP Contract in `vault/SKILL.md`). If an MCP call fails or returns something unexpected, stop and report it.

## This skill is read-only

Create or modify **nothing** - no pages, no `index.md`, no `hot.md`, not even `log.md`. No `vault` `undo`, `log`, `sync_index`, or `manifest` mutations. If the user's question contains a new finding or an action ("save this", "record that"), answer the question, then point them to `wiki-capture` or `wiki-update` for the write.

## Protocol

Prefer `context` over hand-rolling the search -> read -> `graph` ladder. It composes `search`/`graph` internally, budgets tokens, deduplicates overlapping passages, and carries provenance/staleness warnings that a raw search result does not - see "Context bundle" in `vault/SKILL.md`.

1. **Normal mode.** Call `context` `action: "assemble"` with the user's question as `query` (or `action: "for_task"` with `task` when the ask is really "help me understand X so I can do Y"). Let `intent` infer from phrasing unless the question is clearly connection-shaped (step 3). The default `tokenBudget` (4000) covers most questions; raise it if `warnings` says content was dropped and the user needs more.
2. **Index-only mode** ("quick answer", "just scan", "don't read the pages"): call `context` `assemble` with a small `tokenBudget` (300-500) so the bundle stays to frontmatter summaries. Answer from the returned `items`/`citations` only, labelled *"(index-only answer - page bodies not read)"*. If the bundle is empty, fall back once to `search` `action: "content"`, `format: "compact"`, `limit: 10`.
3. **Connection questions** ("how is X related to Y"). Call `context` with `intent: "connection"` - the server runs the bounded multi-hop walk (depth<=3, <=8 neighborhood calls) and returns the frontier/path as items. Use `coverage.includedPaths` and each item's `reasons` (look for `neighbor-of:<path>`) to reconstruct the hop sequence for the answer. Do not hand-roll `graph` calls for this - the walk is a server-side detail you consume through `context`, not one you re-implement client-side.
4. **Thin or low-confidence bundles.** If `bundleConfidence` is low or coverage looks partial, call `context` `action: "expand"` with the returned `nextCursor` and a fresh `tokenBudget` before falling back to manual search. If a bundle was genuinely wrong for the question once you've worked with it, point the user at `wiki-context`'s feedback action rather than logging it yourself - this skill stays read-only.
5. **Metadata-only questions** ("what tags exist", "what's in `_meta/`") don't need `context` - use `search` `action: "tags"` or `action: "by_tags"` directly, or `note` `read` on `index.md`/`hot.md`.
6. **Synthesize.** Cite pages as `[[wikilinks]]` (the bundle's `citations` array already has these). Present contradictions from both sides - a contradicted page's counterpart is already pulled into the bundle where budget allows. Say explicitly what the wiki does *not* cover. Flag stale citations (`staleDays` > 90, or a bundle warning naming the page) inline. Never strip `^[inferred]`/`^[ambiguous]` markers from item text.

## Answer format

> **Based on the wiki:** [answer with [[wikilinks]]]
>
> **Pages consulted:** [[page-a]], [[page-b]]
>
> **Confidence / gaps:** [`bundleConfidence` if from `context`, plus what the wiki doesn't cover]
>
> **Notes:** [OR-fallback / typo correction / incomplete scan / stale or heavily-inferred sources / dropped-for-budget - omit if none]
