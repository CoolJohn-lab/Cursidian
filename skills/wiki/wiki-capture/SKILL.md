---
name: wiki-capture
description: >
  Save knowledge from the current conversation as a wiki note. Use when the user says "save this",
  "/wiki-capture", "capture this", "preserve this", "add this to my wiki". Also supports quick mode
  (`/wiki-capture --quick`, "quick capture", "save this gotcha", "drop this to raw") which stages
  findings to _raw/ in under a minute for later promotion by wiki-ingest.
---

# Wiki Capture — Conversation to Wiki Note

Extract the *substance* of this conversation — the knowledge itself, not a summary of what was said. **All vault access is via the `user-cursidian` MCP server** (MCP Contract in `llm-wiki/SKILL.md`). If an MCP call fails, stop and report; never write vault files directly.

## Quick mode (`--quick`)

Fast staging to `_raw/`, no index/log/hot updates — promotion via `wiki-ingest` handles those later.

1. **Gate:** does this session hold reusable findings — a fix found through investigation, a non-obvious gotcha, a debugging conclusion, a reusable pattern? If it's just planning/Q&A with nothing surprising, say "Nothing worth capturing" and stop. Manual invocation leans KEEP; automatic invocation leans SKIP.
2. **Cluster by topic** — one `_raw/` note per topic, not per finding.
3. **Write** each cluster via `note` action `create` to `_raw/<ISO-date>-<slug>`, with frontmatter (`title`, `category`, 2–4 taxonomy tags, `summary` ≤200 chars, `sources: ["<project> session (<date>)"]`) and finding blocks: **Problem / Root cause / Fix / Confirmed by** (or **Behavior / Explanation / Workaround** for gotchas). Mark synthesized claims `^[inferred]`.
4. **Confirm:** list the staged paths and remind the user to run `wiki-ingest` to promote them. Stop — do not run full mode.

## Full mode

1. **Filter.** Worth keeping: decisions and their *why*, technical findings, frameworks or mental models developed, hard-won explanations. Skip logistics, dead-end exploration, and anything already in the wiki (check `index.md` via `note` action `read`). If nothing material emerged, say so and stop.

2. **Classify** to pick the target folder: reasoning/analysis or a decision → `synthesis/`; a definition or mental model → `concepts/`; a summary of an external source → `references/`; a multi-topic session record → `journal/`. Project-specific content goes under `projects/<name>/<category>/` instead.

3. **Rewrite as declarative knowledge.** Not "we discussed X and decided…" but "X works by…" / "Y is preferred over Z because…". Present tense, no chat narration. Mark inferences `^[inferred]` and contested points `^[ambiguous]`.

4. **Write** via `note` action `create`: Page Template frontmatter from `llm-wiki/SKILL.md` with `sources: [conversation:<ISO-date>]`, a `summary`, and at least 2 wikilinks to existing pages (search first with `search` action `content`).

5. **Bookkeeping** via MCP: call `vault` action `sync_index`; then call `vault` action `log` with `logLine: CAPTURE page="<path>" title="<title>"` and `hotActivity: CAPTURE — saved [[path]]`.

6. **Confirm** the saved path and title to the user.
