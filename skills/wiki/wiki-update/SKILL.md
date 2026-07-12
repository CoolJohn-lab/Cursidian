---
name: wiki-update
description: >
  Sync the current project's knowledge into the Obsidian wiki. Use from any project when the user
  says "update wiki", "sync to wiki", "update obsidian", or wants what they've been working on
  distilled into their knowledge base.
---

# Wiki Update - Sync a Project into the Wiki

Distill the current project's knowledge into the vault. Reading the *project* (code, docs, git log) with normal tools is fine - it lives outside the vault. **All vault reads and writes go through the `user-cursidian` MCP server** (MCP Contract and Failure handling in `llm-wiki/SKILL.md`). Keep `operationStack`; on failure after writes, undo reverse-order; never write vault files directly.

## Preflight

1. Scan the working directory: README, source structure, the dependency manifest, and the git log (decisions, not "fix typo" noise). Derive the project name from the directory.
2. `vault` `manifest` with `manifestOperation: "read"` (fallback: `note` `read` on `_meta/manifest.md`). Find this project's line. If it records a `last_commit`, check reachability (`git merge-base --is-ancestor <sha> HEAD`) and diff from there; if the SHA is gone (rebase/force-push), warn the user and do a full scan. First-time sync: everything is new. If nothing meaningful changed, tell the user and stop.
3. Search for existing pages (`search` `content`, paginate if `truncated`; check `index.md`) before planning creates.

## Decide what to distill

Karpathy's question: **what would you want to know coming back in 3 months with zero context?**

Worth it: architecture decisions and *why*; patterns you'd otherwise re-Google; how tools/services are wired together; trade-offs evaluated and what won; lessons that aren't visible in the code. Not worth it: file listings, boilerplate, dependency versions, individual bug fixes with no broader lesson, anything the code says clearly itself.

The heuristic: if reading the codebase answers the question, don't wiki it. If you'd have to re-derive the reasoning across 20 commits of git blame, wiki it.

## Writes

Push every returned `operationId`.

Project-specific pages go under `projects/<name>/<category>/` with an overview at `projects/<name>/<name>.md` (never `_project.md`). General lessons go to global `concepts/` / `skills/` / `entities/`. Use the Page Template from `llm-wiki/SKILL.md`; mark rationale you inferred (rather than found stated) as `^[inferred]`.

**Merge aggressively.** If a relevant page exists, `note` `read` it and `note` `update` with `expectedRevision` - don't create duplicates. Cross-link new pages both ways.

Don't copy code. "Uses a debounced search with 300ms delay" is knowledge; the debounce function itself is not.

## Bookkeeping

- `vault` `manifest` with `manifestOperation: "upsert_project"` - cwd, current HEAD SHA, sync timestamp. Pass `expectedRevision` from the preflight manifest read. Do **not** hand-edit the project line with `note` `update`.
- `vault` `sync_index` - regenerate the catalog.
- `vault` `log` - `logLine: WIKI_UPDATE project=<name> pages_created=N pages_updated=M` and `hotActivity` for Recent Activity. If Active Threads / Key Takeaways need deeper edits, use `note` `update` on `hot.md` with `expectedRevision` after.

## Verification

After multi-page writes: `note` `read` each changed page; `vault` `sync_index` with `dryRun: true` expecting `wouldWrite: false`. Report residual drift instead of claiming success. Clear `operationStack` only after verification passes.

## Final report

Created/updated paths, manifest project record, index dry-run result, warnings, operation IDs retained for later undo.
