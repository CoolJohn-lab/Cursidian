---
name: wiki-context
description: >
  Assemble a token-budgeted context bundle for a task before touching code. Use when the user
  says "get me context for X", "prep context to work on Y", "what do I need to know before
  touching Z", or wants a cited, budgeted briefing instead of raw search hits.
---

# Wiki Context - Assemble a Context Bundle

Build the smallest, most relevant, most trustworthy context bundle for a task or question, via the `context` action on the `user-cursidian` MCP server (MCP Contract in `vault/SKILL.md`). If an MCP call fails or returns something unexpected, stop and report it.

## Read-only for vault content

`context` `assemble`/`for_task`/`expand` never write to the vault - they compose `search`/`graph` internally (the CGE surface). The only write this skill performs is `context` `feedback`, a local telemetry log entry, not a vault page; read-only vaults reject it.

## Protocol

1. **Infer intent and starting depth.** Map the request to `lookup` (default fact-finding), `connection` ("how are X and Y related"), `onboarding` ("getting started with...", "what should I know before working on..."), `troubleshoot` (errors/failures/bugs), or `ingest-prep` (preparing to add a source) - or omit `intent` and let the server infer it from phrasing.
   - 300-500 tokens: summary skim
   - 600-1000: route to focus pages
   - 1200-2500: normal task briefing
   - Up to 4000: deliberate body depth or cross-page synthesis
   These are starting bands, not limits. Let `guidance` decide whether to expand.
2. **Assemble.** For a coding/working task, call `context` with `action: "for_task"` and `task: "<what the agent needs to do>"`. For a direct question, use `action: "assemble"` with `query`. Pass `intent`/`tokenBudget` from step 1.
3. **Present the bundle proportionally.**
   - Lead with a concise synthesis from the `focus` items and cite 1-3 primary paths as `[[wikilinks]]`. A focus item already contains evidence; do not automatically full-read its path.
   - Report `bundleConfidence`, `guidance`, warnings, or dropped paths when they affect the task. Do not echo bundle metadata mechanically.
   - Never strip `^[inferred]`/`^[ambiguous]` markers or `> Contradicts [[...]]` callouts from item text - surface them in the answer.
   - Mention `coverage.droppedForBudget` only when a dropped path looks relevant.
4. **Follow `guidance.nextStep`.**
   - `sufficient` -> stop; no further assembly needed.
   - `expand` -> call `context` `action: "expand"` with the prior `nextCursor` and `guidance.suggestedTokenBudget` (or a fresh budget). Do not re-run `search` by hand or re-ask the same query from scratch.
   - `refine_query` -> narrow keywords / switch intent before expanding; the fill is neighbour- or ticket-heavy.
5. **Feedback on bad bundles.** If a bundle turned out insufficient or off-target once the user actually worked with it, call `context` `action: "feedback"` with `feedbackQuery` (the query/task used), `feedbackVerdict` (`insufficient` or `off_target`), and an optional `feedbackNote`. This only appends to a local log (`.cursidian/context-feedback.jsonl`) - it does not change the vault or the bundle already returned. Mention that you logged it.

## Answer format

> **Context for:** [task or query]
>
> **Focus:** [[path-a]], [[path-b]]
>
> [Synthesized briefing citing focus first, then supporting items as [[wikilinks]]]
>
> **Gaps / next step:** [only material warnings, dropped paths, or expand/refine guidance]

## When not to use this skill

A narrow fact, known page, heading check, inventory, or explicit one-hop graph is often cheaper through `wiki-query`'s direct `search` / `outline` / `read` / `graph` modes. Reach for `wiki-context` when the ask is broad or uncertain, spans multiple pages, precedes real work, or needs budgeted freshness/provenance handling.
