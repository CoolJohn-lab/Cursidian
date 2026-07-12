---
name: wiki-query
description: >
  Answer questions from the compiled Obsidian wiki. Use when the user asks "what do I know about X",
  "find everything related to Y", or any question the knowledge base should answer, including
  connection questions ("how is X related to Y"). Supports a fast index-only mode ("quick answer",
  "just scan", "don't read the pages") that answers from summaries without reading page bodies.
---

# Wiki Query - Knowledge Retrieval

Answer from the compiled wiki, citing pages. **All vault access is via the `user-cursidian` MCP server** (MCP Contract in `llm-wiki/SKILL.md`). If an MCP call fails or returns something unexpected, stop and report it.

## This skill is read-only

Create or modify **nothing** - no pages, no `index.md`, no `hot.md`, not even `log.md`. If the user's question contains a new finding or an action ("save this", "record that"), answer the question, then point them to `wiki-capture` or `wiki-update` for the write.

## Protocol

Follow the retrieval ladder from `llm-wiki/SKILL.md` - cheapest call first, escalate only when it can't answer.

1. **Context.** `note` action `read` on `hot.md` (recent activity) and `index.md` (scope). These alone answer many questions.

2. **Search.** Prefer 2-3 specific keywords. Use `search` with `action: "content"`, `format: "compact"`, `limit: 10` first - it returns `title`/`summary`/`tags`/`relevanceScore` cheaply. Escalate to full content search or `note` action `read` only when summaries aren't enough. Stopwords are stripped automatically; OR-fallback and typo correction may apply.

   **Index-only mode** stops here: answer from summaries and index entries, labelled *"(index-only answer - page bodies not read)"*.

3. **Read.** `note` action `read` the 1-3 most promising candidates in full. Follow at most one hop of wikilinks (`graph`) when the answer spans pages.

4. **Connection questions** ("how is X related to Y"). Run the multi-hop walk below, then synthesize.

5. **Synthesize.** Cite pages as `[[wikilinks]]`. Present contradictions from both sides. Say explicitly what the wiki does *not* cover and which sources might fill the gap. Flag stale citations (pages not updated in 90+ days) inline.

### Multi-hop walk (BFS, depth ≤ 3)

`graph` is depth-1 only. For connection questions:

1. Resolve start and goal pages via `search` action `content` / `index.md` (get vault-relative paths).
2. BFS from start: for each frontier page, call `graph` once. Neighbours = unique `outgoingLinks[].resolvedPath` ∪ `backlinks[].path`.
3. Record parent pointers so you can reconstruct the path.
4. Stop when you reach the goal, or when depth = 3, or when you have made **8 neighborhood calls** (whichever first).
5. If a path exists, report it as `A -> B -> C` with one-line role for each hop. If not, say no path within 3 hops and list the closest frontier pages checked.

Do **not** ask for server-side depth>1 - stay within this client-side walk.

## Answer format

> **Based on the wiki:** [answer with [[wikilinks]]]
>
> **Pages consulted:** [[page-a]], [[page-b]]
>
> **Gaps:** [what the wiki doesn't cover]
