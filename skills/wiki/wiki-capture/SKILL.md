---
name: wiki-capture
description: >
  Save knowledge from the current conversation as a wiki note. Use when the user says "save this",
  "/wiki-capture", "capture this", "preserve this", "add this to my wiki". Also supports quick mode
  (`/wiki-capture --quick`, "quick capture", "save this gotcha", "drop this to raw") which stages
  findings to _raw/ in under a minute for later promotion by wiki-ingest.
---

# Wiki Capture - Conversation to Wiki Note

Extract the _substance_ of this conversation - the knowledge itself, not a summary of what was said. **All vault access is via the `user-cursidian` MCP server** (MCP Contract and Failure handling in `vault/SKILL.md`). Keep `operationStack` for mutating modes; if an MCP call fails after writes, undo reverse-order; never write vault files directly.

## Quick mode (`--quick`)

Fast staging to `_raw/`, no index updates - promotion via `wiki-ingest` handles those later.

1. **Gate:** does this session hold reusable findings - a fix found through investigation, a non-obvious gotcha, a debugging conclusion, a reusable pattern? If it's just planning/Q&A with nothing surprising, say "Nothing worth capturing" and stop. Manual invocation leans KEEP; automatic invocation leans SKIP.
2. **Cluster by topic** - one `_raw/` note per topic, not per finding.
3. **Write** each cluster via `note` action `create` to `_raw/<ISO-date>-<slug>`, with frontmatter (`title`, `category`, 2-4 taxonomy tags, `summary` <=200 chars, `sources: ["<project> session (<date>)"]`) and finding blocks: **Problem / Root cause / Fix / Confirmed by** (or **Behavior / Explanation / Workaround** for gotchas). Mark synthesized claims `^[inferred]`. Push each `operationId`.
4. **Confirm:** list the staged paths, operation IDs, and remind the user to run `wiki-ingest` to promote them. Stop - do not run full mode.

## Full mode

### Preflight

1. **Filter.** Worth keeping: decisions and their _why_, technical findings, frameworks or mental models developed, hard-won explanations. Skip logistics, dead-end exploration, and anything already in the wiki.
2. **Duplicate search.** Before creating, run `search` action `content` with `format: "compact"` and 2-3 topic keywords. Follow `nextCursor` while `truncated`. If a page already covers the topic, plan a **merge** (`note` `update` with `expectedRevision`) instead of a new create.
3. **Classify** the target folder: a definition or mental model -> `concepts/`; a summary of an external source -> `references/` (use `*-synthesis.md` for distilled external reading); reasoning/decision for a project -> `projects/<name>/concepts/`; a multi-topic session record -> `journal/`. Do not create a root `synthesis/` folder.
4. **Rewrite as declarative knowledge.** Not "we discussed X and decided..." but "X works by..." / "Y is preferred over Z because...". Present tense, no chat narration. Mark inferences `^[inferred]` and contested points `^[ambiguous]`.

### Writes

Push every `operationId`. Follow `vault` write sequencing: one note at a time; read immediately before each write; chain the response `revisionHash` for any follow-up edit to the same path.

1. **Create or merge** via MCP using the Page Template from `vault/SKILL.md` (`sources: [conversation:<ISO-date>]`, `summary`, >=2 wikilinks). Prefer merge when the duplicate search found a hit. Prefer one combined `note` `update` with body + `frontmatter` merge when both change.
2. **Read back** the changed page with `note` `read` before bookkeeping. If the body or frontmatter is wrong, fix with `update` (or combined update) + `expectedRevision` from that read-back before continuing.
3. **Bookkeeping:** `vault` `sync_index` (flat rebuild or hub preserve). Report paths and operation IDs in chat.

### Verification

`note` `read` the changed page(s); `vault` `sync_index` with `dryRun: true` expecting `wouldWrite: false`. Report residual drift. Clear `operationStack` only after verification passes.

### Final report

Created/updated paths, title, index state, warnings, operation IDs retained for later undo.
