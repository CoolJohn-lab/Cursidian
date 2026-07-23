# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [4.1.0] - 2026-07-23

### Changed

- Placeholder for next release notes.

## [4.1.0] - 2026-07-23

### Changed

- Forward-only documentation: removed migration breadcrumbs (`was llm-wiki`, `formerly DLT`, predecessor MCP narrative) from live guidance and wiki SoT. Denylist is now framed as "do not call" / current contract, not historical migration story.
- Wiki skills now teach current MCP tool labels (`search.content`, `note.read`, `graph`) and denylist in forward-only prose.
- Validation fixtures updated to 5-tool surface labels across benchmark corpus and replay scripts.
- Databricks skill + wiki catalog document dual-router precedence: local DLZ overlay vs marketplace product child skills.

### Added

- Stack doctor script: `~/.cursor/plugins/local/my-agents/scripts/stack-doctor.mjs` validates 16-rule inventory, rule→skill wiring, skill folder names, stale identifiers, and forward-only prose in live guidance files.

## [4.0.1] - 2026-07-23

### Changed

- Wiki skills now teach adaptive retrieval by information need: compact search, outline, direct read, graph, or budgeted context. Context remains preferred for broad/uncertain work without being a mandatory first call.

## [4.0.0] - 2026-07-23

### Added

- `note` `action: "outline"` returns heading outline (`level` / `text` / `line`) without loading the full body; optional `maxDepth` (1-6)
- `note` `update` `dryRun: true` previews the next revision (`wouldChange`, hashes) without writing or creating a journal op
- Wikilink parser covers embeds (`![[...]]`) and preserves `#heading` / `#^blockId` fragments on rename rewrite (`extractEmbeds`, `extractWikilinkEntries`)
- `vault` `health` soft `schemaWarnings` for missing Page Template `sources` / `created` (hard-required fields unchanged)
- `vault` `health` `provenanceStats` for body markers `^[inferred]` / `^[ambiguous]` (counts + sample lines; not a hard failure)
- Context logdump scorer `docs/validation/scripts/score-context-logdump.mjs` + TD-CGE-001 freeze report under `docs/validation/results/`

### Changed

- Agent-facing MCP surface expands (outline, update dryRun, embed/block-ref rewrite, soft health schema/provenance) - major release for the 3.2 backlog ship
- Harden `listSections` / outline parsing with `assertParseableSize` and match-iteration caps
- Rename backlink rewrite matches path without fragment; graph/backlinks already resolve embed targets via `extractWikilinks`

### Fixed

- TD-CGE-001 closed as **no action** after schemaVersion 2 freeze re-score (n=204; focus/ranking agreement 99.5%) - no assembler weight churn

## [3.1.1] - 2026-07-23

### Changed

- TD-HARDEN-001: note body/path mutations (create/update/delete/rename/frontmatter/sync_index/deslop/undo) no longer wipe all search caches; rely on signature-keyed invalidation. Vocabulary/manifest writes clear only vocabulary + search-result caches. Dropped the no-op `clearVaultSearchStateCache` call from `clearAllSearchCaches` (the helper now aliases `clearVaultSnapshotCache`).

## [3.1.0] - 2026-07-23

### Changed

- Decompose `scoreSearchCandidate` (`search-ranking.ts`) into named, unit-testable sub-scorers (`scoreExactIdentity`, `scoreAliasSignals`, `scoreTitleAndPathTokens`, `scoreCompoundBasename`, `scoreStemAffinity`, `scoreTitleSpecificity`, `scoreSurfaceCoverage`, `scoreWeakBasenamePenalty`, `scoreTagAndSummary`, `scoreBodyAndProximity`, `scoreOperationalPenalty`) and `assembleContextDetailed` (`context-assembler.ts`) into three named stages (`resolveCandidatePool`, `selectPassages`, `finalizeBundle`); both are now thin orchestrators. No ranking weights, order, or behaviour changed - verified by a new golden-regression fixture (`tests/fixtures/ranking-golden.json`, `tests/lib/search-ranking-golden.test.ts`)

### Security

- Strip `__proto__` / `constructor` / `prototype` keys from YAML frontmatter and object merges (`sanitizeMergeSource`) so note content cannot pollute `Object.prototype`
- Cap parser input size and regex match iterations for wikilinks, tags, manifest, and vocabulary
- Bound vault/note tool string and array arguments at the zod schema edge (`schema-primitives`)

### Fixed

- Graceful MCP shutdown: drain in-flight path-locked writes on SIGINT/SIGTERM/stdin close; reap orphan `.cursidian-*.tmp` files on startup
- Distinguish ENOENT from access errors via `probePath`; fail distinctly when journal manifest persist fails after a successful write (`ManifestPersistError`)
- Scrub control characters from log lines; validate `OBSIDIAN_LOG_FILE`; use non-blocking append stream instead of `appendFileSync`
- Apply body size guard to all update modes (not only replace); cap typo-correction tokens/matrix size; coalesce concurrent backlink builds; cache vocabulary by mtime
- Sign pagination cursors with HMAC; reject unknown markers instead of resetting to page 1
- Confine `~`-expanded vault paths to the home directory; async `realpath` vault check; consistent boolean env parsing; enforce journal snapshot maxFileSize; sanitize readdir path segments

## [3.0.5] - 2026-07-23

### Changed

- Apply machine-local Prettier formatting across the repo (style-only)
- Refresh retrieval/context eval snapshots after verify (nDCG within gate epsilon)

## [3.0.4] - 2026-07-23

### Fixed

- Windows CI eval gate: dynamic `import()` of `dist/` now uses `file://` URLs via `pathToFileURL` (Node ESM rejects bare `D:\...` paths)

## [3.0.3] - 2026-07-23

### Fixed

- ESLint cleanups across `src/`, `tests/`, `scripts/`, and `docs/validation/scripts/`: prefer `import type`, drop unused imports/bindings, and restore the broken `hits` loop in `scripts/slop-scan-files.mjs`

## [3.0.2] - 2026-07-23

### Added

- First-party slop engine (`src/lib/slop-engine/`) with vendored rules under `rules/slop/` and slim [`.cursidian-slop.json`](.cursidian-slop.json)

### Changed

- `npm run slop:*` and vault `slop_check` / `deslop` use the in-repo engine (via `tsx` before `tsc`); decorative emoji remains `EMOJI_RE`-only (no emoji codepoint flood in config)

### Removed

- Runtime dependency on `llm-slop-detector` (MIT packs snapshotted once into `rules/slop/`)

### Migration

- Rename any custom `.llmsloprc.json` edits into `.cursidian-slop.json` (a stub remains that points at the new name). Optional IDE highlighter extension is unrelated to the package gate.

## [3.0.1] - 2026-07-22

### Added

- ContextSearches logdump **schemaVersion 2**: `callId`, `packageVersion`, precomputed `quality` snapshot (sufficiency / confidence / tokens / depth share), and `ranking` diagnostics (search hits, post-rerank candidates, compact items/dropped without passage text) for accuracy and efficacy analysis
- `assembleContextDetailed` / `expandContextDetailed` plus `buildContextQualitySnapshot` helpers

### Changed

- Deferred context quality optimisation until richer logs accumulate; 3.0 quality baseline documented in wiki (see `projects/cursidian/concepts/context-quality-metrics`)

## [3.0.0] - 2026-07-22

### Changed

- **Major 3.0 baseline.** Declares the Cursor Obsidian LLM-wiki agent platform shipped across 2.11-2.12 as the supported public contract: five MCP tools (`note`, `search`, `graph`, `vault`, `context` with `focus`/`guidance`); protocol skill named `vault` (not `llm-wiki`); machine-wide **rule -> skill -> wiki** golden standard (no project `.cursor/rules`); hub `indexMode` for curated vault indexes; package-owned `slop` in the 11-skill install set
- Semver major so consumers can treat pre-3.x (discrete-tool / `user-obsidian` / `llm-wiki` skill naming / root `hot`+`log` session cache) as outside the supported upgrade path without a cutover checklist

### Migration

- Cut over to the five-tool surface and skill `vault` before expecting 3.x behaviour; restart `user-cursidian` after upgrading `dist/`
- Fold any remaining vault `hot.md` / `log.md` into project hubs, then delete those files; set `indexMode: hub` on `index.md` when using a curated hub router
- After install: `npm run skills:install`, `npm run mcp:check`, start a **new** agent chat so Cursor reloads skill text

### Added

- Companion workstation planes (Azure nine-tool MCP XOR helpers; Databricks Skills plugin XOR `dlzpipe`) are documented for the cursor tools bundle (wiki / TD-011) - not shipped inside this npm package, but part of the same agent-platform story agents load beside Cursidian

## [2.12.1] - 2026-07-22

### Added

- `slop` skill + `scripts/deslop.mjs` under `skills/wiki/slop/` (on-disk deslop); included in `skills:install` / doctor / check
- Shared `scripts/skill-names.mjs` for the install set (install / doctor / check)

### Changed

- `wiki-slop` skill is vault/MCP-only; on-disk deslop routes to package skill `slop`
- `vault` skill companion list + Outside-MCP note point at `slop` / wiki `skills/local-deslop` for repos and cursor-global
- MCP smoke suites (`edge-cases`, `benchmarks`, `wiki-query`) retargeted to `note` / `search` / `graph`

### Removed

- Orphaned `get_backlinks` register wrapper and its broken unit test (coverage via `graph` / neighborhood tests)

## [2.12.0] - 2026-07-22

### Removed

- `vault` action `log` and `log.md` / `hot.md` session-cache files (breaking)
- `touch-wiki-meta` implementation; operational exclusion of `hot`/`log` / `_archives` basenames
- Skills no longer teach root `synthesis/` or `_archives/` folders (use `concepts/` / `references/.../*-synthesis.md` and `_raw/_archived/`)

### Changed

- Write skills bookkeeping ends at `vault` `sync_index` (+ `manifest` when needed) and a chat report
- `wiki-status`: read-only hub + manifest + `_raw/` delta
- `wiki-setup`: special files are `index` + `_meta/*`; folders omit `synthesis` / `_archives`
- `context` assembler: denser session-first bundles - filter operational/`_meta` neighbours, cap neighbour count by intent, demote journal/ticket distractors, tighten onboarding seed limit, prefer non-neighbour seeds on ties
- Search ranking: generic basename tokens (`failed`/`error`/...) no longer earn basename-primary elevation alone; mild `weak-basename` penalty for distractors
- `wiki-query` / `wiki-context`: follow bundle `focus` and `guidance.nextStep` (`sufficient` | `expand` | `refine_query`)

### Migration

- Fold curated `hot.md` content into project hubs, then delete `hot.md` and `log.md` from the vault

### Added

- `context` bundle fields `focus` (1-3 primary paths) and `guidance` for session-first agents
- Recalibrated `bundleConfidence` penalties for neighbour-heavy / demoted fills
- Always-on `context` logdump to `~/.cursor/logdump/ContextSearches/` (daily JSONL: full input args + output bundle/error); disable with `OBSIDIAN_CONTEXT_LOGDUMP=false`, override dir with `OBSIDIAN_CONTEXT_LOGDUMP_DIR`

## [2.11.6] - 2026-07-22

### Changed

- `wiki-query`: session-first rule - first wiki retrieval in a chat must open with `context` (`assemble`/`for_task`), not a hand-rolled search/read ladder

## [2.11.5] - 2026-07-22

### Changed

- Aligned package docs (`AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `.cursor/README.md`, `skills/wiki/INSTALL.md`) with the machine-wide **rule -> skill -> wiki** golden standard: no project `.cursor/rules`; protocol skill = `vault`; durable Cursidian facts in wiki `projects/cursidian/*`
- Thinned `skills/wiki/vault/SKILL.md` toward golden standard: wiki SoT pointers first; keep MCP contract / failure-undo / page template; drop duplicated narrative that belongs in the wiki

### Added

- `indexMode` on `index.md` frontmatter (`flat` default | `hub`) - vault-scoped index policy for curated hub-router wikis
- Hub-mode `vault` `health`: leaves within 2 outbound hops of pages listed on `index.md` count as catalogued; `missingFromIndex` only for truly uncovered notes; health report includes `indexMode`; hub mode skips summary-mismatch checks
- Hub-mode `vault` `sync_index` / `deslop`: preserve curated `index.md` body (never dump every leaf; hub router blurbs stay intentional)
- Hub-mode health skips summary-mismatch checks (curated short blurbs are not required to match frontmatter `summary`)
- Index parser accepts link-only catalog lines (`- [[path]]`) in addition to `- [[path]] - summary`
- Wiki skills / README / vault tool description: hub `sync_index` documented as **preserve**, not blurb-refresh from frontmatter
- `wiki-setup` documents optional `indexMode: hub` for hub-router vaults
- WorkStuff A+ rule requires `indexMode: hub` on `index.md`
- `context` MCP tool (5th tool, `src/tools/context.ts`) - the Context Generation Engine surface. `action=assemble` (default): token-budgeted, deduplicated, provenance-tagged context bundle for a query. `action=for_task`: same assembly phrased as a task description, with intent presets (`lookup`, `connection`, `onboarding`, `troubleshoot`, `ingest-prep`) inferred from phrasing when omitted. `action=expand`: continue a prior bundle from its `nextCursor` within a fresh token budget. `action=feedback`: record an insufficient/off-target bundle to a local `.cursidian/context-feedback.jsonl` log
- `lib/context-assembler.ts` - `assembleContext`/`expandContext`: composes `search`/`graph` internally (one shared vault snapshot; read-only, inherits existing caching/security), selects the cheapest sufficient passage per candidate (summary -> best section -> full body), greedily fills the token budget by value-per-token, deduplicates >60% shingle-overlapping passages, surfaces staleness/provenance/contradiction warnings, and computes a 0-1 `bundleConfidence`
- `lib/token-estimate.ts` - `estimateTokens`: fast chars/4 heuristic with a mild bump for code fences/tables (no BPE tokenizer dependency)
- `lib/section-read.ts` - `listSections`/`extractSection`/`findBestSection`: read-only ATX-heading slicing, reusing the section-edit heading parser
- `npm run mcp:check` (`scripts/check-mcp-config.mjs`) - read-only guard that `~/.cursor/mcp.json` uses `cursidian`, not `Obsidian-MCP-For-Cursor`, with an absolute vault path
- `docs/MCP-HOST-HYGIENE.md` - clean up stale `user-obsidian` / legacy tool allowlist noise after cutover
- `tests/tools/tool-surface.test.ts` - snapshot test locking the registered MCP tool names, retired-tool denylist (`read_note`, `search_content`, `list_notes`, `get_backlinks`), and the `search`/`note`/`vault` action enums
- Expanded `tests/tools/get-note-neighborhood.test.ts` and `tests/tools/search-by-tags.test.ts` to full statement/branch coverage: pagination across every page, empty neighbourhoods, unresolved outgoing links, invalid paths, `invalid_args` on empty/whitespace tags, and operational-path (`index`/`log`/`hot`) exclusion from tag search
- `tests/eval/` retrieval eval harness - a synthetic CDF-flavoured `golden-vault/` (projects/concepts/entities/skills covering ingestion vs egress, contract generation, medallion layers, the worker data mart, BigHand, and `FactPersonForecastHistory`), 45 labelled queries in `queries.jsonl` (lookup/connection/onboarding/troubleshoot intents), and `eval.mjs` scoring the real `search` tool's ranked results with nDCG@10, Recall@10, and MRR against a `snapshots/baseline.json` scorecard
- `npm run eval` (`node tests/eval/eval.mjs`) - run the retrieval eval standalone; `--report-only` never exits non-zero; `--gate` fails when nDCG@10 drops more than 0.05 vs `snapshots/gate-baseline.json`
- Non-blocking `eval-report` step in `scripts/run-verify-inner.mjs` (after `test`); blocking `eval-gate` step after `build`
- `npm run eval:report` - writes `tests/eval/snapshots/scorecard.md`
- `vault` `vocabulary` action (`read`/`upsert`/`remove`) managing `_meta/vocabulary.md`; `lib/vocabulary.ts` loads synonym groups and directional pairings for query-side expansion at reduced ranking weight
- `lib/query-understanding.ts` - `parseQuery` (quoted phrases, hyphen-preserving normalisation, intent inference)
- Exported `RANK_WEIGHTS` in `search-ranking.ts` (centralised additive weights plus mild freshness verified/stale factors)
- `wiki-context` skill - assemble/for_task/expand/feedback workflow for task briefings
- `npm run skills:doctor` - detect stale `~/.cursor/skills/` vs repo
- Opt-in context telemetry behind `OBSIDIAN_CONTEXT_TELEMETRY=true` (local JSONL only, never stdout)
- `vault` `health` action (`lib/vault-health.ts`) now detects `> Contradicts [[other-page]]` callouts and reports them as `contradictions` (source path, resolved/raw counterpart, `resolved` flag) - detection only, never auto-resolved
- `tests/eval/eval.mjs` also scores `context assemble` bundles for every labelled query: token efficiency (tokens on labelled-relevant items / `tokensUsed`) and budget adherence (`tokensUsed <= budget`), written to `tests/eval/snapshots/bundle-baseline.json`
- `npm run eval -- --sweep` - sweeps `RANK_WEIGHTS.expandedTokenMultiplier` against the compiled ranker and prints which value scores best on nDCG@10 without regressing MRR; read-only, never edits source or writes a snapshot
- `npm run eval:report` now folds context bundle metrics into `tests/eval/snapshots/scorecard.md`
- `mcp:check` (`scripts/check-mcp-config.mjs`) now also does a read-only, source-text check that the registered tool surface still includes all 5 tools (`registerNote`/`registerSearch`/`registerGraph`/`registerVault`/`registerContext`), scanning `dist/tools/index.js` when built or falling back to `src/tools/index.ts`
- Latency guardrail test: `assembleContext` on a 15-note fixture vault completes well under a generous 5s budget and reuses one cached vault snapshot across its internal search + passage-extraction calls (`tests/lib/context-assembler.test.ts`)

### Changed

- Wiki skills (`llm-wiki`, ingest/capture/update/lint) document flat vs hub index behavior so agents stop treating hub-router sparsity as drift
- `vault` tool description notes flat vs hub `sync_index` behavior
- Operational `INFO`/`DEBUG` logs no longer write to stderr by default (Cursor MCP host was labeling them `[error]`); optional `OBSIDIAN_LOG_FILE` or `OBSIDIAN_LOG_STDERR_INFO=true`; `WARN`/`ERROR` stay on stderr; stdout remains MCP JSON-RPC only
- `AGENTS.md` / `skills/wiki/INSTALL.md` - `mcp:check`, CallMcpTool `server`+`toolName` checklist, host hygiene pointer
- Tool surface is now 5 tools (`note`, `search`, `graph`, `vault`, `context`); `AGENTS.md` and `skills/wiki/llm-wiki/SKILL.md` MCP Contract updated accordingly
- `wiki-query` / `wiki-ingest` / `wiki-update` prefer `context` assembly (and vocabulary consult/upsert) over hand-rolled search ladders
- Skills install set is 10 folders (adds `wiki-context`); install verification requires `context` mentions in `llm-wiki` and `wiki-context`

## [2.11.4] - 2026-07-13

### Fixed

- Bump-version test no longer assumes `[Unreleased]` always has notes (passes after a release promotes an empty section)

## [2.11.3] - 2026-07-13

### Changed

- Backfilled empty CHANGELOG sections from git history; `npm run bump` now requires notes under `[Unreleased]` (use `--allow-empty-changelog` to override)
- Updated `docs/PUBLISH.md` for current release flow

## [2.11.2] - 2026-07-13

### Changed

- Stale-cursor `invalid_args` errors include `details.changedPaths` (capped), fingerprints, and change counts so agents can see which vault markdown fingerprints drifted between pages

## [2.11.1] - 2026-07-13

### Fixed

- Vault `slop_check` / `deslop` scan and fix edge cases in frontmatter string values (tests in `tests/lib/slop.test.ts`)

## [2.11.0] - 2026-07-13

### Added

- `vault` actions `slop_check` (read-only) and `deslop` (journaled char/emoji auto-fix with frontmatter coverage; `dryRun` / `confirm: true`)
- MCP wiki deslop closes the frontmatter blind spot that left `summary` em dashes while `index.md` was cleaned

### Changed

- `wiki-slop` skill uses MCP for vault deslop; npm `slop:*:wiki` remains for humans/CI only
- `llm-slop-detector` moved to runtime `dependencies`; `.llmsloprc.json` included in the npm package

## [2.10.1] - 2026-07-13

### Added

- Optional `frontmatter` merge on `note` `update` (one journaled op for body + metadata)
- `details.currentRevision` / `conflictKind` / `suggestion` on `hash_mismatch` and section/patch edit errors
- Skill write-hygiene contract: CallMcpTool `server`+`toolName`, same-path serialization, write-scope announcement, combined updates

### Changed

- `search` `tags` docs: accepts no other arguments (`limit`/`cursor` rejected with `invalid_args`)
- `skills:check` gates CallMcpTool hygiene, revision chaining, and write-scope announcement

## [2.10.0] - 2026-07-12

### Added

- Operation journals under `.cursidian-trash/<operationId>/` with `vault` actions `history` and `undo` (`confirm: true`; optional `force`)
- Full-note `revisionHash` / `expectedRevision` concurrency (frontmatter + body); `expectedHash` kept as deprecated alias
- Multi-path locking and lock-free write primitives for handlers that already hold a path lock
- Typed `vault` action `manifest` (`read` / `upsert_source` / `upsert_project` / `remove`) for `_meta/manifest.md`
- Machine-actionable success/error metadata: `operationId`, `undoAvailable`, `code`, `recovery`, `retryable`, `sideEffects`
- Pagination (`cursor` / `truncated` / `nextCursor`) on `search` content/by_tags/recent and `graph` backlinks; incomplete scans surface `incomplete` + `skipped`
- Rename / `vault log` / create-overwrite all-or-rollback journaling (source note included in rename backups)
- Skill rollback protocol (operation-ID stack, reverse-order undo) across wiki write skills
- `npm run skills:check` static skill contract gate; fixture smoke suite covers revision conflicts, manifest, and undo
- Live `npm run smoke` uses a unique per-run note path, never `overwrite: true`, and always deletes in `finally`

### Changed

- Wiki skills prefer `vault manifest` over hand-editing ledger lines; raw ingest archives via `note rename`
- `wiki-lint` report-only mode performs zero writes (LINT log line only after consolidate confirmation)
- Safe-write docs and skills standardize on `revisionHash` / `expectedRevision`

## [2.9.0] - 2026-07-12

### Added

- Search and graph pagination: `cursor`, `truncated`, `nextCursor`; incomplete scans surface `incomplete` and `skipped` (expanded in 2.10.0)

## [2.8.0] - 2026-07-12

### Added

- Typed `vault` action `manifest` (`read`, `upsert_source`, `upsert_project`, `remove`) for `_meta/manifest.md`

## [2.7.4] - 2026-07-12

### Changed

- Simplified multi-file write operations and lock scope for handlers that already hold a path lock

## [2.7.3] - 2026-07-12

### Added

- Operation journals under `.cursidian-trash/<operationId>/` (foundation for undo; see 2.10.0)

## [2.7.2] - 2026-07-12

### Changed

- Success responses include machine-actionable metadata (`operationId`, `undoAvailable`, `code`, `recovery`, `retryable`, `sideEffects`)

## [2.7.1] - 2026-07-12

### Added

- Full-note `revisionHash` / `expectedRevision` optimistic concurrency (`expectedHash` kept as deprecated alias)
- Multi-path locking for concurrent writes

## [2.7.0] - 2026-07-12

### Changed

- Major internal refactor: operation journal plumbing, typed recovery errors, handler lock primitives (feature-complete summary in 2.10.0)

## [2.6.7] - 2026-07-12

### Fixed

- `assertSafePathAsync` resolves the nearest existing ancestor for not-yet-created paths so symlinked/junction directories inside the vault cannot be used to write outside it; folder create/delete now use the async check

## [2.6.6] - 2026-07-12

### Changed

- README: LLM Slop Detector Cursor plugin mention; expanded deslop and wiki-slop documentation

## [2.6.5] - 2026-07-12

### Changed

- README split into human-written onboarding (top) and agent-oriented reference (below)

## [2.6.4] - 2026-07-12

### Changed

- README documents two-layer product (MCP + wiki skills) and `npm run skills:install`

## [2.6.3] - 2026-07-12

### Changed

- README documents build-time slop gate and `slop:check` / `slop:fix` commands

## [2.6.2] - 2026-07-12

### Changed

- Extended deslop pass across repo source, skills, scripts, and test fixtures

## [2.6.1] - 2026-07-12

### Added

- `wiki-slop` skill; `skills:install` and INSTALL.md cover all nine wiki skills

## [2.6.0] - 2026-07-12

### Added

- `npm run slop:check:wiki` and `slop:fix:wiki` scan/fix the Obsidian vault (same rules as repo; path from `OBSIDIAN_VAULT_PATH` or `mcp.json`)

## [2.5.5] - 2026-07-12

### Changed

- `prebuild` runs `slop:check`; shared `slop-lib.mjs`; AGENTS.md documents slop gate

## [2.5.4] - 2026-07-12

### Added

- `generate-emoji-rules.mjs`; expanded `.llmsloprc.json` decorative emoji ban list

## [2.5.3] - 2026-07-12

### Changed

- Second deslop pass on skills, AGENTS.md, and source comments

## [2.5.2] - 2026-07-12

### Added

- `scripts/fix-slop.mjs` for auto-fixing AI typography and emoji in the repo

### Changed

- Deslop pass on README, wiki skills, and test fixtures

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

- `npm run skills:install` - remove-then-copy the 9 wiki skills into `~/.cursor/skills/`, with verification against nested duplicates and legacy tool names

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

### Added

- `scripts/stress-four-tools.mjs` - live chaos/stress probe for the 4-tool MCP surface against `OBSIDIAN_VAULT_PATH`

## [2.1.3] - 2026-07-12

### Added

- Initial public git release: MCP server, eight wiki skills, CI (Ubuntu + Windows), tests, bump tooling, and docs (~15k LOC; feature list under 1.0.0)

## [2.1.2] - 2026-07-12

### Changed

- Pre-public patch release; see 2.1.0 and 2.2.0 for documented fixes

## [2.1.1] - 2026-07-12

### Changed

- Pre-public patch release; see 2.1.0 for documented fixes

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
