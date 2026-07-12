# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [2.5.5] - 2026-07-12


## [2.5.4] - 2026-07-12


## [2.5.3] - 2026-07-12


## [2.5.2] - 2026-07-12


## [2.5.1] - 2026-07-12

### Fixed

- `search` `list` / `recent` exclude operational paths by default and honor `includeOperational` (same set as content search)
- `search` `list` returns `not_found` for a nonexistent folder (empty existing folders still return count 0)
- Stopword-only content queries return `invalid_query` instead of ranking noise
- `vault` `delete_folder` on a non-empty folder returns `folder_not_empty` (not generic `error`)

### Changed

- Wiki docs clarify `replace_section` includes nested subsections, and that `list`/`recent` share content operational exclusion (`vault health` noteCount also excludes `_meta/`)

## [2.5.0] - 2026-07-12

### Fixed

- Replace size-guard failures return `invalid_args` (not `internal_error`)
- `vault` `list_folders` always returns forward-slash vault-relative paths
- `search` `by_tags` / `tags` exclude operational paths (`_raw/`, `_archives/`, index/log/hot) to match content search defaults
- `vault` `sync_index` dry-run sets `wouldWrite: false` when the catalog body is unchanged

## [2.4.0] - 2026-07-12

### Added

- `npm run skills:install` - remove-then-copy the 8 wiki skills into `~/.cursor/skills/`, with verification against nested duplicates and legacy tool names

### Fixed

- Skills install docs: always delete the target skill folder before copying (avoids `skill/skill/SKILL.md` nesting that left Cursor on stale pre-4-tool instructions)
- README tools heading no longer says "Tools (v1)"

## [2.3.0] - 2026-07-12

### Fixed

- Search ranking matches basename/title segments query->text only (no longer boosts `wiki` pages for query `wikilink` via reverse substring)
- Ambiguous title/alias/basename keys fail loud: `note`/`graph` path resolve returns `invalid_args` with candidates; wikilink resolve returns unresolved; `vault` health reports `ambiguousKeys`
- `replace_section` with `#` markers requires matching ATX heading level (plain text still matches any level)

## [2.2.0] - 2026-07-12

### Fixed

- `replace_section` accepts heading text with or without `#` markers; missing headings return `not_found` (not `internal_error`); duplicate headings fail with `invalid_args`
- Morphological search prefix matching is query->text only, so longer query tokens no longer match shorter vault words (e.g. `wikilink` ≠ `wiki`)
- `search` `by_tags` rejects empty or whitespace-only tag strings with `invalid_args`
- `note` / `graph` path args resolve frontmatter aliases (and titles) via the vault index to the canonical note path

## [2.1.4] - 2026-07-12


## [2.1.3] - 2026-07-12


## [2.1.2] - 2026-07-12


## [2.1.1] - 2026-07-12


## [2.1.0] - 2026-07-12

### Fixed

- Typo correction no longer rewrites 4-character tokens at edit distance 2 (e.g. `note` -> `home`)
- Verbose search snippets report only tokens present on each matched line; basename `matchReasons` cite the actual segment
- Frontmatter validation errors refer to `frontmatter` instead of legacy `data` parameter name
- `search` list/recent paths normalized to forward slashes on Windows

### Changed

- Document MCP server reload requirement in `AGENTS.md` after `npm run build`

## [2.0.0] - 2026-07-12

### Changed

- **Breaking:** Consolidated 17 MCP tools into 4 action-dispatch tools: `note`, `search`, `graph`, `vault`. Retired `get_backlinks` (use `graph`) and frontmatter `get` (use `note` with `action: "read"`).
- `search_content` typo correction uses Damerau-Levenshtein (adjacent transposition) with vault document-frequency tie-break; correction vocabulary built from title/basename/tags only (aliases excluded)
- Search ranking no longer applies path-folder boosts (`entities/` / `concepts/` / `skills/`) or a post-hoc specificity floor
- Shared operational path helpers for search, ranking, and vault health
- Renamed ranking stem helper `synonymGroupKey` -> `stemGroupKey`

## [1.0.1] - 2026-07-12

### Added

- `npm run bump` - agent-friendly semver bump for `package.json`, `package-lock.json`, and `CHANGELOG.md` (see `AGENTS.md`)
- `vault_health` tool - one-call structured report (orphans, broken links, missing frontmatter, index drift, stale pages)
- `sync_index` tool - regenerate `index.md` from frontmatter grouped by category
- `rename_note` tool - rename/move notes with mechanical backlink rewriting
- Frontmatter `aliases` indexed for wikilink resolution and search ranking
- `search_content` typo correction via edit-distance fallback (`correctedTokens` in response)
- Auto `created`/`updated` timestamps on `create_note`, `update_note`, and `manage_frontmatter` writes

### Changed

- `search_content` defaults: `limit` 10 (was 50), 2 snippets per hit (was 5), operational files excluded by default
- `search_content` new params: `format: compact|full`, `verbose`, `includeOperational`
- Softer OR fallback when AND returns fewer than 3 hits (≥2 content tokens)
- `search_content` matches title/summary/aliases/tags in addition to body text
- `touch_wiki_meta` tool - append `log.md` and optionally refresh `hot.md` Recent Activity in one call

### Fixed

- `manage_frontmatter` no longer wipes frontmatter when `set`/`merge` is called without `data`, or `delete` without `keys`; returns a clear error instead
- Sandbox npm verification now cleans deprecated `devdir` environment settings before nested npm commands
- Focused test-file runs no longer fail global coverage thresholds when the selected tests pass
- Vitest runs suppress INFO-level logger noise so output highlights real failures

### Changed

- Rewrote all 8 wiki skills as focused, minimal instructions (llm-wiki cut from ~650 to ~150 lines; operational skills to ~40-70 lines each)
- Skills are now strictly **MCP-only**: no filesystem fallback for vault access; on MCP failure the agent reports and stops
- Ingest ledger moved from filesystem `.manifest.json` to MCP-accessible `_meta/manifest.md`
- Config simplified: the vault path lives only in `mcp.json`; removed the `.env` walk-up / `~/.cursidian/config` resolution protocol
- `wiki-query` is now fully read-only (no longer appends to `log.md`)
- Write skills prefer `touch_wiki_meta` for log/hot bookkeeping; `wiki-query` documents a depth-≤3 BFS multi-hop walk
### Removed

- QMD integration, PageIndex preprocessing, URL affinity scoring (`misc/` promotion), staged writes (`_staging/`), confidence formulas, lifecycle state machine, importance tiering, typed-relationship spec, visibility tags, and the Claude Code Stop hook from the wiki skills
- Skill reference files tied to the removed machinery (`ingest-prompts.md`, `url-sources.md`, `pageindex.md`, `RAW-FORMAT.md`)

## [1.0.0] - 2026-07-12

### Added

- Public `cursidian` MCP server for Obsidian vaults (filesystem, no Local REST API)
- `list_tags` tool - vault-wide frontmatter tag counts
- Signature-based vault index invalidation (mtime/size fingerprint, shared with search snapshot cache)
- Tracked wiki skills under `skills/wiki/` (`llm-wiki`, `wiki-query`, `wiki-lint`, `wiki-setup`, `wiki-ingest`, `wiki-capture`, `wiki-update`, `wiki-status`) with `INSTALL.md`
- Absolute `OBSIDIAN_VAULT_PATH` enforcement (`~` / `%USERPROFILE%` expansion)
- Windows CI job (`windows-latest`) alongside Ubuntu
- `.gitattributes` with LF normalization for source files
- `examples/.env.example` and npx-oriented `examples/cursor-mcp.json`
- `CONTRIBUTING.md`
