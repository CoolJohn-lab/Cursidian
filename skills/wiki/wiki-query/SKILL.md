---
name: wiki-query
description: >
  Answer questions from the compiled Obsidian wiki. Use when the user asks "what do I know about X",
  "find everything related to Y", or any question the knowledge base should answer, including
  connection questions ("how is X related to Y"). Supports a fast index-only mode ("quick answer",
  "just scan", "don't read the pages") that answers from summaries without reading page bodies.
  First wiki access in a session should open with the context MCP tool.
---

# Wiki Query - Knowledge Retrieval

Answer from the compiled wiki, citing pages. **All vault access is via the `user-cursidian` MCP server** (MCP Contract in `vault/SKILL.md`). If an MCP call fails or returns something unexpected, stop and report it.

## This skill is read-only

Create or modify **nothing** - no pages, no `index.md`, no `hot.md`, not even `log.md`. No `vault` `undo`, `log`, `sync_index`, or `manifest` mutations. If the user's question contains a new finding or an action ("save this", "record that"), answer the question, then point them to `wiki-capture` or `wiki-update` for the write.

## Session-first: open with `context`

**The first wiki retrieval in a chat/session must be `context`** (`assemble` or `for_task`) - not a hand-rolled `search` -> `note` `read` -> `graph` ladder.

Why: `context` budgets tokens, picks summary vs section vs body, carries provenance/staleness warnings, and returns citations in one call. Raw search is a fallback after a thin/empty bundle or for metadata-only asks (below).

Treat "first" as: no prior successful `context` / `search` / `note` `read` of wiki content in this chat yet. Later turns in the same chat may expand the prior bundle (`context` `expand` + `nextCursor`) or narrow with `search` when that is cheaper.

## Protocol

1. **Normal mode (default, including session-first).** Call `context` `action: "assemble"` with the user's question as `query` (or `action: "for_task"` with `task` when the ask is really "help me understand X so I can do Y"). Let `intent` infer from phrasing unless the question is clearly connection-shaped (step 3). Default `tokenBudget` is 4000; raise it if `warnings` / `droppedForBudget` say content was cut and the user needs more.
2. **Index-only mode** ("quick answer", "just scan", "don't read the pages"): still use `context` `assemble`, but with a small `tokenBudget` (300-500) so the bundle stays on frontmatter summaries. Answer from the returned `items`/`citations` only, labelled *"(index-only answer - page bodies not read)"*. If the bundle is empty, fall back once to `search` `action: "content"`, `format: "compact"`, `limit: 10`.
3. **Connection questions** ("how is X related to Y"). Call `context` with `intent: "connection"`. Use `coverage.includedPaths` and each item's `reasons` (look for `neighbor-of:<path>`) to reconstruct the hop sequence. Do not hand-roll `graph` for this.
4. **Thin or low-confidence bundles.** If `bundleConfidence` is low or coverage looks partial, call `context` `action: "expand"` with the returned `nextCursor` and a fresh `tokenBudget` before falling back to manual search. If a bundle was genuinely wrong once you've worked with it, point the user at `wiki-context`'s feedback action - this skill stays read-only.
5. **Metadata-only questions** ("what tags exist", "what's in `_meta/`") don't need `context` - use `search` `action: "tags"` or `action: "by_tags"` directly, or `note` `read` on `index.md`/`hot.md`.
6. **Synthesize.** Cite pages as `[[wikilinks]]` (the bundle's `citations` array already has these). Present contradictions from both sides. Say explicitly what the wiki does *not* cover. Flag stale citations (`staleDays` > 90, or a bundle warning naming the page) inline. Never strip `^[inferred]`/`^[ambiguous]` markers from item text.

## Answer format

> **Based on the wiki:** [answer with [[wikilinks]]]
>
> **Pages consulted:** [[page-a]], [[page-b]]
>
> **Confidence / gaps:** [`bundleConfidence` if from `context`, plus what the wiki doesn't cover]
>
> **Notes:** [OR-fallback / typo correction / incomplete scan / stale or heavily-inferred sources / dropped-for-budget - omit if none]
