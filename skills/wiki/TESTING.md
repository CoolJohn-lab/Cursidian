# Wiki skills — golden-path tests

Run these against `tests/fixtures/wiki-vault/` (synthetic) or a personal vault. Do not commit private vault content.

## Preconditions

- MCP `user-cursidian` configured with an absolute `OBSIDIAN_VAULT_PATH`
- Skills copied into `~/.cursor/skills/` per `INSTALL.md`
- For the fixture: point MCP at the absolute path of `tests/fixtures/wiki-vault`

## The MCP-only invariant (applies to every test)

For every golden path below, also verify:

- **No filesystem access to the vault.** The agent never uses Read/Write/StrReplace/Grep/Glob or shell commands on vault paths — every vault read and write is a `user-cursidian` tool call.
- **Failure means stop.** With the MCP server disabled (or pointed at a bad path), the agent reports the failing tool call and stops. It must not offer or attempt to edit vault files directly.

## Golden paths

### llm-wiki

- Agent can state the MCP contract (MCP-only, stop on failure) and summarise the three-layer architecture.

### wiki-setup

1. Point MCP at an empty temp directory (not the fixture).
2. Expect: folders via `vault` action `create_folder`; `index.md`, `log.md`, `hot.md`, `_meta/manifest.md`, `_meta/taxonomy.md` via `note` action `create`.

### wiki-query

1. Ask: "What is Alpha?"
2. Expect: `search` actions `content` / `by_tags`, then `note` action `read` on `concepts/alpha.md`.
3. Answer cites the fixture; **zero writes** (not even `log.md`).

### wiki-lint

1. Run a read-only health check.
2. Expect: `vault` action `health` once, report presented, `vault` action `log` with counts — no other writes.
3. `--consolidate`: dry-run list shown and confirmation requested before any `note` update; finish with `vault` action `sync_index`.

### wiki-capture

1. Capture a short session note into `_raw/` (quick) or a concept page (full).
2. Expect: `note` action `create`; full mode also calls `vault` action `sync_index`, then `vault` action `log` for `log.md`/`hot.md`.

### wiki-ingest

1. Ingest a tiny markdown source into the fixture vault.
2. Expect: pages via MCP; `_meta/manifest.md` updated via MCP (no `.manifest.json` filesystem writes); `log.md` appended via `vault` action `log` or `note` action `update` mode `append`.

### wiki-update

1. From a sample project folder.
2. Expect: project knowledge merged via MCP only; manifest project line updated in `_meta/manifest.md`.

### wiki-status

1. Run status against the fixture.
2. Expect: `note` action `read` on `_meta/manifest.md`, `search` actions `list` and `recent`; optional `hot.md` refresh via MCP.

## Manual dogfood

Against a live personal vault: run query + lint + status after MCP changes. Never copy private notes into this repository.
