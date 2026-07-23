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

Create or modify **nothing** - no pages, no `index.md`. No `vault` `undo`, `sync_index`, or `manifest` mutations. If the user's question contains a new finding or an action ("save this", "record that"), answer the question, then point them to `wiki-capture` or `wiki-update` for the write.

## Choose retrieval by information need

There is no mandatory first read. Use the cheapest surface that preserves enough evidence:

| Ask | Start with |
| --- | ---------- |
| Broad, uncertain, multi-page, task-shaped | `context` `assemble` / `for_task` |
| Narrow fact, path unknown | `search` `content`, `format: "compact"` |
| Known page, headings only | `note` `outline` |
| Known page, exact evidence | `note` `read` |
| Tags, folders, recent notes | `search` `tags` / `list` / `recent` / `by_tags` |
| Known page, explicit one-hop neighborhood | `graph` |
| Uncertain relationship between topics | `context` with `intent: "connection"` |

## Protocol

1. **Context mode.** For a direct question use `action: "assemble"` with `query`; for work preparation use `action: "for_task"` with `task`. Starting budgets: 600-1000 for routing, 1200-2500 for an answer, up to 4000 for deliberate body depth or synthesis. Let intent infer unless `connection` is clear.
2. **Summary-only mode** ("quick answer", "just scan", "don't read the pages"): use compact `search` for a narrow query, or `context` with 300-500 tokens when multiple pages/relationships still matter. Answer from summaries only and label the limitation.
3. **Direct page mode.** Use `note outline` before a full read when headings can identify the relevant area. Use `note read` when the exact wording/body is required. Do not full-read every candidate.
4. **Connection mode.** Use `context intent: "connection"` when the route is uncertain. Use `graph` for an explicit one-hop neighborhood on a known path.
5. **Follow `focus` and `guidance` for context responses.** A focus item is already evidence; do not automatically `note read` its path. Then:
   - `guidance.nextStep === "sufficient"` -> answer from the bundle; do not expand unless the user asks for more depth.
   - `guidance.nextStep === "expand"` -> call `context` `action: "expand"` with `nextCursor` and `guidance.suggestedTokenBudget` (or a fresh budget) before falling back to manual search.
   - `guidance.nextStep === "refine_query"` -> narrow keywords or switch intent; do not treat a noisy neighbour-heavy fill as ground truth.
     If a bundle was genuinely wrong once you've worked with it, point the user at `wiki-context`'s feedback action - this skill stays read-only.
6. **Synthesize proportionally.** Lead with the answer and cite 1-3 primary pages. Surface contradictions, stale or inferred evidence, dropped paths, and confidence only when they affect the conclusion. Never strip `^[inferred]`/`^[ambiguous]` markers from quoted evidence.

## Answer format

> **Based on the wiki:** [concise answer with 1-3 primary [[wikilinks]]]
>
> **Confidence / gaps:** [include only when material]
