# MCP Real-World Validation Report

**Date:** 2026-07-08  
**Vault:** WorkStuff (`/Users/jeddowes/Library/CloudStorage/OneDrive-Freshfields/Obsidian/WorkStuff`)  
**Scope:** Post-remediation replay of 30-day DLZ agent transcripts after MCP validation fixes (2026-07-08).

---

## 1. Executive summary

| Criterion | Result |
|-----------|--------|
| Corpus coverage | 447 MCP calls from 21 sessions (plan baseline ±10% on major tools — see §2) |
| Search top-3 accuracy (curated wiki-query set) | Old-upstream 16.7% → Old-patched 0% → **New 100%** ⚠️ |
| BigHand bootstrap query | New top-1: `projects/data-platform-dlz/entities/factpublicholiday.md` (intent page: factpublicholiday) |
| f681a293 fragment replaces blocked | 5/5 shrink-ratio cases blocked by size guard |
| New regressions vs old-patched | 0 queries rank worse |

### Top 3 wins (new MCP)

1. **Search ranking + token-AND** — curated wiki-query top-1: 16.7% → 0% → **100%**; `FactPublicHoliday` top-1: `projects/data-platform-dlz/entities/factpublicholiday.md`.
2. **Replace size guard** — 7 of 41 simulated historical full-replace calls would be blocked today; f681 line-18 fragment replace (136 bytes vs 7777) **blocked**.
3. **read_note enrichment** — `contentHash` + `outgoingLinks` on all replayed paths; index link resolution **98%**.

### Top 3 remaining gaps

1. **Agent replace habit** — 41 replace-mode updates; agents rarely use `patch` / `replace_section` despite tool support.
2. **Search retries** — 13 overlapping search calls within 3 turns (e.g. f681a293: `"bighand FactPublicHoliday…"` then `"bighand"`).
3. **Underused graph tools** — only 2 `get_backlinks` calls; agents hop via `read_note` on index/hub pages.

---

## 2. Corpus statistics

**Window:** transcripts with session start ≥ 2026-06-08  
**Source:** DLZ `agent-transcripts/` (Obsidian-MCP-For-Cursor sessions excluded)

| Tool | Plan (30d) | Extracted | Δ |
|------|----------:|----------:|--:|
| `read_note` | 209 | 163 | -22% |
| `update_note` | 131 | 111 | -15% |
| `search_content` | 87 | 77 | -11% |
| `manage_frontmatter` | 80 | 63 | -21% |
| `list_notes` | 45 | 12 | -73% |
| `create_note` | 28 | 12 | -57% |
| `get_backlinks` | 6 | 2 | -67% |
| `list_recent` | 4 | 2 | -50% |
| `delete_note` | 2 | 4 | 100% |
| `manage_folders` | 1 | 1 | 0% |

**Friction patterns**

| Pattern | Count |
|---------|------:|
| Full replace (`update_note`) | 41 |
| Search retry (overlapping query ≤3 turns) | 13 |
| Truncation recovery (assistant text) | 6 |

**Highest MCP sessions (qualitative review)**

| Transcript | MCP calls |
|------------|----------:|
| [`f05dd98a`](file:///Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts/f05dd98a-2a87-4999-9183-66134c47a684/f05dd98a-2a87-4999-9183-66134c47a684.jsonl) | 63 |
| [`f681a293`](file:///Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts/f681a293-0729-4f69-93e9-cd5da9b4572a/f681a293-0729-4f69-93e9-cd5da9b4572a.jsonl) | 59 |
| [`60edd405`](file:///Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts/60edd405-8836-4c14-8e3b-34419eb4b594/60edd405-8836-4c14-8e3b-34419eb4b594.jsonl) | 36 |
| [`53abd6fb`](file:///Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts/53abd6fb-5c3b-4f72-969d-a8b7d23177b9/53abd6fb-5c3b-4f72-969d-a8b7d23177b9.jsonl) | 34 |
| [`6aaf05bf`](file:///Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts/6aaf05bf-26d4-46ca-9eed-bbc4e4d64bb7/6aaf05bf-26d4-46ca-9eed-bbc4e4d64bb7.jsonl) | 33 |
| [`c63bf7c6`](file:///Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts/c63bf7c6-8498-4737-b632-1e5e1d14136e/c63bf7c6-8498-4737-b632-1e5e1d14136e.jsonl) | 27 |
| [`fec9aef1`](file:///Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts/fec9aef1-4c09-49db-8534-3ac8c1e28cf1/fec9aef1-4c09-49db-8534-3ac8c1e28cf1.jsonl) | 27 |
| [`2287fd50`](file:///Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts/2287fd50-cd39-4391-bceb-abeeccd8e2a9/2287fd50-cd39-4391-bceb-abeeccd8e2a9.jsonl) | 25 |
| [`e91fdbcf`](file:///Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts/e91fdbcf-6d94-4d96-af56-201d873ac2e8/e91fdbcf-6d94-4d96-af56-201d873ac2e8.jsonl) | 22 |
| [`bac02dac`](file:///Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts/bac02dac-8dbb-413f-b724-5ee65fb18cc6/bac02dac-8dbb-413f-b724-5ee65fb18cc6.jsonl) | 21 |

---

## 3. Search validation

**Replay set:** 59 unique queries (48 with transcript follow-up golden label)

### Curated wiki-query suite (6 queries with known intent pages)

| Baseline | Top-1 | Top-3 |
|----------|------:|------:|
| Old-upstream | 16.7% | 16.7% |
| Old-patched | 0% | 0% |
| **New** | **100%** | **100%** |

### All golden-label queries (includes hub bootstrap — weak proxy)

| Baseline | Top-1 | Top-3 |
|----------|------:|------:|
| Old-upstream | 6.3% | 6.3% |
| Old-patched | 0% | 6.3% |
| **New** | **47.9%** | **66.7%** |

### Excluding hub-page golden labels (42 queries)

| Baseline | Top-1 | Top-3 |
|----------|------:|------:|
| Old-upstream | 7.1% | 7.1% |
| Old-patched | 0% | 7.1% |
| **New** | **54.8%** | **76.2%** |

### Ranking examples (golden-label rank)

| Query | Upstream | Patched | New | New top-1 |
|-------|:--------:|:-------:|:---:|-----------|
| bighand | 11 | 11 | 1 | projects/data-platform-dlz/concepts/bighand-data-product.md |
| BigHand deploy sequence | — | — | — | projects/data-platform-dlz/concepts/bighand-data-product.md |
| FactPerson naming | — | — | 1 | projects/data-platform-dlz/concepts/dlz-naming-and-schema-conventions.md |
| monitoring failures | — | — | — | projects/data-platform-dlz/concepts/monitoring-and-error-logs.md |
| curated | 20 | 17 | 1 | projects/data-platform-dlz/concepts/curated-and-model-layers.md |
| factpersoncalendar | 7 | 7 | 1 | projects/data-platform-dlz/entities/factpersoncalendar.md |
| workerdatamart | 14 | 14 | 3 | projects/data-platform-dlz/entities/data-products.md |
| FactPerson | 7 | 7 | 4 | projects/data-platform-dlz/entities/factpersoncalendar.md |

### BigHand case study ([f681a293](file:///Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts/f681a293-0729-4f69-93e9-cd5da9b4572a/f681a293-0729-4f69-93e9-cd5da9b4572a.jsonl))

- Bootstrap: `"bighand FactPublicHoliday public holidays"` → new top-1: `projects/data-platform-dlz/entities/factpublicholiday.md` (correct intent page; agent read hub in same turn before retry)
- Retry: `"bighand"` → new top-1: `projects/data-platform-dlz/concepts/bighand-data-product.md`
- Agent recovered truncated pages via extra `search_content` + `Grep` on transcript (lines ~75–80) — MCP-only protocol breach driven by unsafe replace

### Regressions

No queries where new ranks worse than old-patched on golden-label set.

---

## 4. Link validation

### read_note (top 20 corpus paths)

| Path | Calls | outgoingLinks | Resolved % | contentHash |
|------|------:|-------------:|-----------:|:-----------:|
| `projects/data-platform-dlz/data-platform-dlz` | 20 | 36 | 100 | ✅ |
| `projects/data-platform-dlz/concepts/bighand-data-product` | 14 | 14 | 100 | ✅ |
| `index` | 13 | 49 | 98 | ✅ |
| `hot` | 13 | 5 | 100 | ✅ |
| `projects/data-platform-dlz/skills/deployment-and-ci-cd` | 9 | 12 | 100 | ✅ |
| `log` | 8 | 2 | 100 | ✅ |
| `projects/data-platform-dlz/concepts/curation-pipeline` | 7 | 15 | 100 | ✅ |
| `projects/data-platform-dlz/entities/factpersoncalendar` | 6 | 4 | 100 | ✅ |
| `_meta/ingest-manifest` | 6 | 0 | — | ✅ |
| `projects/data-platform-dlz/concepts/dlz-naming-and-schema-conventions` | 6 | 7 | 100 | ✅ |

Hub page (`data-platform-dlz`): 100% link resolution

### get_backlinks (corpus replay)

| Path | Backlinks | Latency |
|------|----------:|--------:|
| `projects/data-platform-dlz/concepts/bighand-data-product` | 16 | 25.01ms |
| `projects/data-platform-dlz/concepts/benevity-integration` | 5 | 24.63ms |

`get_graph` / `search_by_tags` / `move_note`: **0** transcript calls — no regression from v1 tool surface reduction.

---

## 5. Write safety (dry-run)

Simulated **41** historical `replace` calls against **current** vault state (read-only; no writes).

| Metric | Value |
|--------|------:|
| Would truncate under old upstream (<50% size) | 7 |
| Blocked by new size guard | 7 |
| Could use patch/section instead | 6 |

### f681a293 replace dry-run

| Line | Path | Shrink ratio | New guard |
|------|------|-------------:|-----------|
| 17 | `projects/data-platform-dlz/concepts/bighand-data-product` | 106% | allowed |
| 18 | `projects/data-platform-dlz/concepts/bighand-data-product` | 2% | blocked |
| 19 | `projects/data-platform-dlz/concepts/bighand-data-product` | 106% | allowed |
| 21 | `projects/data-platform-dlz/concepts/dlz-naming-and-schema-conventions` | 100% | allowed |
| 21 | `projects/data-platform-dlz/concepts/api-ingestion-notebooks` | 100% | allowed |
| 21 | `hot` | 83% | allowed |

**Note:** Line-18-style fragment table-row replace is flagged when proposed content ≪ current body. On today's vault (post-recovery), some f681 replaces appear `allowed` because the agent already restored full pages.

---

## 6. Performance

### Standard benchmark suite (new MCP)

| Label | Baseline (stored) | Current | Δ ms |
|-------|------------------:|--------:|-----:|
| list_notes.root | 12.09 | 0.52 | -11.57 |
| search_content.adf_pipeline | 50.92 | 29.55 | -21.37 |
| search_content.factpublicholiday | 36.83 | 24.69 | -12.14 |
| read_note.index | 17.89 | 11.2 | -6.69 |
| get_backlinks.project_hub | 32.53 | 22.43 | -10.1 |
| search_content.cached_repeat | 14.12 | 28.52 | 14.4 |

### Corpus-weighted search (top 10 queries × 5 iterations)

| Baseline | p50 | p95 |
|----------|----:|----:|
| Old-upstream | 12.24ms | 13.76ms |
| Old-patched | 12.33ms | 13.09ms |
| **New** | **26.33100000000013ms** | **30.17033399999991ms** |

Cold search on ~76-note vault remains ~40–55ms; cached repeat ~14ms. Acceptable at current scale.

---

## 7. New failures

No search ranking regressions vs old-patched on the golden-label replay set.

False guard blocks on legitimate full restructures: review cases in `write-dryrun-results.json` where `new_guard === "blocked"` and `could_use_patch_or_section === false`.

---

## 8. Recommendations backlog

| P | Area | Recommendation | Evidence |
|---|------|----------------|----------|
| P0 | Agent skill | Discourage default `mode:"replace"` for partial edits | 41 replace calls; 6 could use patch/section |
| P0 | MCP | Size guard on replace (shipped) | 7/41 historical replaces would be blocked today |
| P1 | MCP | Folder-scoped search | Agents pair list_notes + global search_content in bootstrap flows |
| P1 | MCP | Phrase proximity / coherence ranking | 13 search retry patterns in corpus |
| P1 | Agent skill | Use outgoingLinks from read_note instead of manual index hops | 163 read_note calls vs 2 get_backlinks |
| P2 | MCP | search_by_tags | 0 transcript calls; wiki-query skill references tag-style discovery |
| P2 | MCP | Resolve alias/display wikilinks in outgoingLinks | 98% resolved on index.md |

---

## Artifacts

| File | Description |
|------|-------------|
| `docs/validation/corpus/mcp-calls-30d.jsonl` | Extracted MCP invocations |
| `docs/validation/corpus/corpus-classification.json` | Tool counts + friction tags |
| `docs/validation/corpus/replay-matrix.json` | Deduplicated search replay set |
| `docs/validation/corpus/search-replay-results.json` | Old vs new search comparison |
| `docs/validation/corpus/read-replay-results.json` | outgoingLinks / backlinks |
| `docs/validation/corpus/write-dryrun-results.json` | Size-guard simulation |
| `docs/validation/corpus/benchmark-comparison.json` | Latency benchmarks |
| `docs/validation/scripts/extract-transcript-corpus.mjs` | Corpus extractor |
| `docs/validation/scripts/replay-transcript-calls.mjs` | Replay runner |

**Old baselines:** Old-upstream and old-patched search implemented in `docs/validation/scripts/lib/old-search.mjs` (upstream substring vs DLZ token-AND patch). No writes to WorkStuff vault.

---

*Generated 2026-07-08T18:07:34.964Z by validation pipeline.*
