---
name: wiki-setup
description: >
  Initialize a new Obsidian wiki vault with the correct structure and special files. Use when the
  user says "set up my wiki", "initialize obsidian", "create a new vault", "get started with the
  wiki", or needs to repair a broken vault structure.
---

# Wiki Setup - Vault Initialization

You are bootstrapping a new wiki vault (or repairing one). **All vault access is via the `user-cursidian` MCP server** - see the MCP Contract and Failure handling in `llm-wiki/SKILL.md`. If MCP is unavailable or recovery rules are exhausted, stop and report; never create vault files or folders with filesystem tools.

The MCP server already knows the vault path (`OBSIDIAN_VAULT_PATH` in the user's `mcp.json`). If `search` action `list` fails because the server isn't configured, point the user at `INSTALL.md` and stop.

Keep `operationStack: string[]` for every successful write's `operationId`. On failure after writes, undo reverse-order per `llm-wiki`. Follow `llm-wiki` write sequencing: one note/folder op at a time; read immediately before each write that needs `expectedRevision`; chain response revisions when the same path is touched twice.

## Preflight (no writes)

1. **Collect source directories from the user** before creating anything. Absolute paths only. These go into `_meta/manifest.md` `source_dirs`. If the user is unsure, ask once; do not invent paths.
2. `search` action `list` with `recursive: true`, `includeOperational: true`. Follow `nextCursor` while `truncated`. Note which special files already exist (`index.md`, `log.md`, `hot.md`, `_meta/manifest.md`, `_meta/taxonomy.md`, `_meta/vocabulary.md`).
3. `vault` action `list_folders` (and nested as needed) to see which category / `_meta` / `_raw` / `_archives` / `projects` folders already exist.
4. Build a create-only-missing plan. If `index.md` and the category folders already exist, this is a repair - say so.

## Writes (only what is missing)

Push every returned `operationId` onto `operationStack`.

1. Via `vault` action `create_folder`, create missing folders only: `concepts`, `entities`, `skills`, `references`, `synthesis`, `journal`, `projects`, `_meta`, `_raw`, `_archives`.
2. Via `note` action `create` (never `overwrite: true` unless the user explicitly asked to replace a broken file and you passed `expectedRevision`):

**`index.md`** - frontmatter `title: Wiki Index`; body with a `## <Category>` heading per category and a note that the index is auto-maintained.

**`log.md`** - frontmatter `title: Wiki Log`; body:

```markdown
# Wiki Log

- [<ISO timestamp>] INIT categories=concepts,entities,skills,references,synthesis,journal
```

**`hot.md`** - frontmatter `title: Hot Cache`, `updated: <ISO timestamp>`; body with empty sections: Recent Activity, Active Threads, Key Takeaways, Flagged Contradictions.

**`_meta/manifest.md`** - if missing, `note` `create` with frontmatter `title: Wiki Manifest` and `source_dirs:` set to the directories-collected absolute paths; body with empty `## Sources` and `## Projects` sections (schema in `llm-wiki`). Later ingest/update mutations use `vault` `manifest` upserts, which preserve `source_dirs`. Confirm with `vault` `manifest` `read` afterward.

**`_meta/taxonomy.md`** - starter tag vocabulary; a few grouped tags the user cares about. Skills consult this before inventing new tags.

**`_meta/vocabulary.md`** - empty scaffold for domain synonyms/pairings (search query expansion). Create via `note` `create` with frontmatter `title: Wiki Vocabulary`, `synonyms: []`, `pairings: {}`, and a short body pointing editors at `vault` `vocabulary` upsert/remove. Later mutations use `vault` `vocabulary`, not hand-edits.

## Verification

1. Re-run `search` action `list` (`includeOperational: true`, paginate) and `vault` `list_folders`. Confirm every planned folder and file exists.
2. `vault` `sync_index` with `dryRun: true` - expect `wouldWrite: false` after a fresh index create, or report residual drift.
3. If verification fails after writes, undo reverse-order and stop.

## Final report

Report: created folders, created files, skipped (already present), `source_dirs` recorded, warnings, operation IDs retained for later undo. Then clear `operationStack`.

Tell the user:

1. Open the vault in Obsidian (File -> Open Vault)
2. Run `wiki-ingest` to add their first sources
3. Run `wiki-status` anytime to see what's pending
