# Wiki skills - golden-path tests

Run these against `tests/fixtures/wiki-vault/` (synthetic) or a personal vault. Do not commit private vault content.

Executable coverage (CI / local):

```bash
npm run skills:check
npm run test:file -- tests/tools/mcp-contracts.test.ts
npm run mcp:test -- suite smoke
```

`skills/wiki/TESTING.md` remains the readable specification; the commands above assert the contracts.

## Preconditions

- MCP `user-cursidian` configured with an absolute `OBSIDIAN_VAULT_PATH`
- Skills copied into `~/.cursor/skills/` per `INSTALL.md`
- For the fixture: point MCP at the absolute path of `tests/fixtures/wiki-vault`

## The MCP-only invariant (applies to every test)

- **No filesystem access to the vault.** The agent never uses Read/Write/StrReplace/Grep/Glob or shell commands on vault paths - every vault read and write is a `user-cursidian` tool call (`server: "user-cursidian"` + `toolName`).
- **Failure means stop (after recovery rules).** Follow structured `recovery` once for correctable errors; on failure after successful writes, `vault` `undo` stacked `operationId`s in reverse order. Do not fall back to the filesystem.
- Mutating paths use `expectedRevision`, push `operationId` onto an operation stack, and undo reverse-order on failure after writes.
- One note at a time: read immediately before each write (or chain the response `revisionHash`); prefer combined body + `frontmatter` on one `update`.
- Multi-page workflows announce write scope before the first mutation.
- `search` `tags` is called with no `limit` / `cursor`.
- Post multi-page: `note` `read` each changed page; `vault` `sync_index` `dryRun: true` expects `wouldWrite: false`.

## Golden paths

### vault

- Agent can state the MCP contract (MCP-only, `revisionHash` / `expectedRevision`, operation-ID stack, undo) and summarise the three-layer architecture.

### wiki-setup

1. Point MCP at an empty temp directory (not the fixture). Collect `source_dirs` before any write.
2. Expect: `search` `list` + `vault` `list_folders` preflight; create only missing folders/files; verify both lists afterward.
3. Special files via `note` `create`; manifest `source_dirs` recorded; operation IDs retained.

### wiki-query

1. Ask: "What is Alpha?"
2. Expect: `search` actions `content` / `by_tags` (paginate while `truncated`), then `note` action `read` on `concepts/alpha.md`.
3. Index-only mode answers from compact summaries.
4. Answer cites the fixture; **zero writes**. Disclose OR-fallback / typo correction when they fired.

### wiki-lint

1. Run a read-only health check.
2. Expect: `vault` action `health` once, report presented from real health fields only - **zero writes**.
3. `--consolidate`: dry-run list shown and confirmation requested before any `note` update; contradiction flags only in consolidate; finish with `vault` `sync_index`.

### wiki-capture

1. Capture a short session note into `_raw/` (quick) or a concept page (full).
2. Full mode: compact duplicate search before create; merge when a page exists; read back before bookkeeping.
3. Expect: `note` create/update with `expectedRevision`; full mode also calls `vault` `sync_index`.

### wiki-ingest

1. Ingest a tiny markdown source into the fixture vault.
2. Expect: pages via MCP; ledger via `vault` `manifest` upsert (not hand-edited lines); chat report for bookkeeping.
3. Raw mode: `search` `list` `folder: "_raw"` with `includeOperational: true`; archive via single `note` `rename` to `_raw/_archived/`.

### wiki-update

1. From a sample project folder.
2. Announce planned create/update paths before the first mutation (no blocking confirmation).
3. Expect: one note at a time via MCP; prefer combined body + `frontmatter` update; project line via `vault` `manifest` `upsert_project`.
4. Expect roughly one write op per page (not separate body then frontmatter for every page).

### wiki-status

1. Run status against the fixture.
2. Expect: `vault` `manifest` `read` (or `note` read fallback), `search` `list` / `recent`; `_raw/` via `includeOperational: true` excluding `_archived/`.
3. Report hub working-set / manifest project sync.

### wiki-slop

1. From the Cursidian repo: `npm run slop:check` (expect clean or actionable findings).
2. `npm run slop:fix` then `slop:check` again (chars/emoji cleared; phrases may remain).
3. Against a vault MCP: `vault` `slop_check`, then `deslop` `dryRun: true`, then `deslop` `confirm: true` when the user asked to clean the vault. Expect frontmatter summaries cleaned and `health` `summaryMismatches` empty after.
4. Confirm `npm run build` fails if repo slop is reintroduced (prebuild gate).
5. Agents must not use `slop:fix:wiki` for vault writes.

## Manual dogfood

Against a live personal vault: run query + lint + status after MCP changes. Never copy private notes into this repository.
