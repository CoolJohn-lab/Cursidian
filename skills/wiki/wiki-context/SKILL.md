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

1. **Infer intent and budget.** Map the request to `lookup` (default fact-finding), `connection` ("how are X and Y related"), `onboarding` ("getting started with...", "what should I know before working on..."), `troubleshoot` (errors/failures/bugs), or `ingest-prep` (preparing to add a source) - or omit `intent` and let the server infer it from phrasing. Default `tokenBudget` is 4000; raise it when `guidance` says expand, tighten it for a narrow fact check.
2. **Assemble.** For a coding/working task, call `context` with `action: "for_task"` and `task: "<what the agent needs to do>"`. For a direct question, use `action: "assemble"` with `query`. Pass `intent`/`tokenBudget` from step 1.
3. **Present the bundle.**
   - Lead with `focus` paths (1-3 primary reads), then supporting items. Cite every path as `[[wikilink]]` - use the bundle's `citations` array, which already strips the `.md` suffix.
   - Report `bundleConfidence`, `guidance.nextStep` / `guidance.reason`, and the top detractor from `warnings` (stale sources, heavily-inferred sources, incomplete scans, contradiction callouts).
   - Never strip `^[inferred]`/`^[ambiguous]` markers or `> Contradicts [[...]]` callouts from item text - surface them in the answer.
   - Mention what was dropped for budget (`coverage.droppedForBudget`) when it looks relevant to the ask.
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
> **Bundle confidence:** [0-1] - [guidance.nextStep]: [guidance.reason] - [top detractor from warnings, or "no warnings"]
>
> [Synthesized briefing citing focus first, then supporting items as [[wikilinks]]]
>
> **Dropped for budget:** [paths, or "none"]
>
> **Next step:** [from guidance: expand / refine / sufficient]

## When not to use this skill

A single narrow fact lookup is often faster via `wiki-query`'s index-only mode. Reach for `wiki-context` when the ask spans multiple pages, precedes real work on a task, or needs the freshness/provenance guarantees a raw search does not carry.
