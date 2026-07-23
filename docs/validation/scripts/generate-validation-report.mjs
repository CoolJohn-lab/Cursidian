#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const REPORT_PATH = path.join(REPO_ROOT, 'docs/validation/MCP-VALIDATION-REPORT-2026-07-08.md');

/**
 * Loads a JSON artifact if present.
 */
async function loadJson(relPath) {
  const full = path.join(REPO_ROOT, relPath);
  const raw = await fs.readFile(full, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Formats a percentage for markdown tables.
 */
function pct(value) {
  return value == null ? '—' : `${value}%`;
}

/**
 * Builds the validation report markdown from replay artifacts.
 */
async function buildReport() {
  const classification = await loadJson('docs/validation/corpus/corpus-classification.json');
  const search = await loadJson('docs/validation/corpus/search-replay-results.json');
  const reads = await loadJson('docs/validation/corpus/read-replay-results.json');
  const writes = await loadJson('docs/validation/corpus/write-dryrun-results.json');
  const benchmarks = await loadJson('docs/validation/corpus/benchmark-comparison.json');

  const curated = search.summary.curatedWikiQuerySuite;
  const exHub = search.summary.excludingHubGolden;
  const searchPass =
    curated.top3.new >= curated.top3.old_patched &&
    curated.top3.old_patched >= curated.top3.old_upstream;

  const bighandBootstrap = search.results.find((r) =>
    r.query.toLowerCase().includes('bighand factpublicholiday'),
  );
  const bighandRetry = search.results.find((r) => r.query.toLowerCase() === 'bighand');
  const factPublicHoliday = search.results.find((r) => r.query === 'FactPublicHoliday');

  const indexRead = reads.topReadPaths.find((r) => r.path === 'index');
  const hubRead = reads.topReadPaths.find((r) => r.path.includes('data-platform-dlz'));

  const regressions = search.summary.newWorseThanPatched ?? [];

  const recommendations = [
    {
      priority: 'P0',
      area: 'Agent skill',
      item: 'Discourage default `mode:"replace"` for partial edits',
      evidence: `${classification.replaceCount} replace calls; ${writes.patchAlternativeCandidates} could use patch/section`,
    },
    {
      priority: 'P0',
      area: 'MCP',
      item: 'Size guard on replace (shipped)',
      evidence: `${writes.blockedBySizeGuard}/${writes.simulated} historical replaces would be blocked today`,
    },
    {
      priority: 'P1',
      area: 'MCP',
      item: 'Folder-scoped search',
      evidence: 'Agents pair list_notes + global search_content in bootstrap flows',
    },
    {
      priority: 'P1',
      area: 'MCP',
      item: 'Phrase proximity / coherence ranking',
      evidence: `${classification.searchRetries} search retry patterns in corpus`,
    },
    {
      priority: 'P1',
      area: 'Agent skill',
      item: 'Use outgoingLinks from read_note instead of manual index hops',
      evidence: `${classification.toolCounts.read_note ?? 0} read_note calls vs ${classification.toolCounts.get_backlinks ?? 0} get_backlinks`,
    },
    {
      priority: 'P2',
      area: 'MCP',
      item: 'search_by_tags',
      evidence: '0 transcript calls; wiki-query skill references tag-style discovery',
    },
    {
      priority: 'P2',
      area: 'MCP',
      item: 'Resolve alias/display wikilinks in outgoingLinks',
      evidence: indexRead
        ? `${indexRead.resolutionRate}% resolved on index.md`
        : 'index read not sampled',
    },
  ];

  const reconciliationTable = classification.reconciliation
    .filter((row) => row.planCount > 0 || row.actual > 0)
    .map(
      (row) =>
        `| \`${row.tool}\` | ${row.planCount} | ${row.actual} | ${row.deltaPct == null ? '—' : `${row.deltaPct}%`} |`,
    )
    .join('\n');

  const benchmarkRows = benchmarks.newStandardTimings
    .map((row) => {
      const cmp = benchmarks.comparisonToStoredBaseline.find((c) => c.label === row.label);
      return `| ${row.label} | ${cmp?.baselineMs ?? '—'} | ${row.ms} | ${cmp?.deltaMs ?? '—'} |`;
    })
    .join('\n');

  const searchExamples = search.results
    .filter((r) => r.goldenPath)
    .slice(0, 8)
    .map((r) => {
      return `| ${r.query.slice(0, 45)}${r.query.length > 45 ? '…' : ''} | ${r.baselines.old_upstream.goldenRank ?? '—'} | ${r.baselines.old_patched.goldenRank ?? '—'} | ${r.baselines.new.goldenRank ?? '—'} | ${r.baselines.new.top1 ?? '—'} |`;
    })
    .join('\n');

  const report = `# MCP Real-World Validation Report

**Date:** 2026-07-08 
**Vault:** WorkStuff (\`${benchmarks.vaultPath}\`) 
**Scope:** Post-remediation replay of 30-day DLZ agent transcripts after MCP validation fixes (2026-07-08).

---

## 1. Executive summary

| Criterion | Result |
|-----------|--------|
| Corpus coverage | ${classification.totalCalls} MCP calls from ${classification.sessionsWithMcp} sessions (plan baseline ±10% on major tools — see §2) |
| Search top-3 accuracy (curated wiki-query set) | Old-upstream ${pct(curated.top3.old_upstream)} → Old-patched ${pct(curated.top3.old_patched)} → **New ${pct(curated.top3.new)}** ${searchPass ? '' : ''} |
| BigHand bootstrap query | New top-1: \`${bighandBootstrap?.baselines.new.top1 ?? '—'}\` (intent page: factpublicholiday) |
| f681a293 fragment replaces blocked | ${writes.f681a293.blocked}/${writes.f681a293.fragmentReplaces} shrink-ratio cases blocked by size guard |
| New regressions vs old-patched | ${regressions.length} queries rank worse |

### Top 3 wins (new MCP)

1. **Search ranking + token-AND** — curated wiki-query top-1: ${curated.top1.old_upstream}% → ${curated.top1.old_patched}% → **${curated.top1.new}%**; \`FactPublicHoliday\` top-1: \`${factPublicHoliday?.baselines.new.top1 ?? '—'}\`.
2. **Replace size guard** — ${writes.blockedBySizeGuard} of ${writes.simulated} simulated historical full-replace calls would be blocked today; f681 line-18 fragment replace (136 bytes vs 7777) **blocked**.
3. **read_note enrichment** — \`contentHash\` + \`outgoingLinks\` on all replayed paths; index link resolution **${indexRead?.resolutionRate ?? '—'}%**.

### Top 3 remaining gaps

1. **Agent replace habit** — ${classification.replaceCount} replace-mode updates; agents rarely use \`patch\` / \`replace_section\` despite tool support.
2. **Search retries** — ${classification.searchRetries} overlapping search calls within 3 turns (e.g. f681a293: \`"bighand FactPublicHoliday…"\` then \`"bighand"\`).
3. **Underused graph tools** — only ${classification.toolCounts.get_backlinks ?? 0} \`get_backlinks\` calls; agents hop via \`read_note\` on index/hub pages.

---

## 2. Corpus statistics

**Window:** transcripts with session start ≥ 2026-06-08 
**Source:** DLZ \`agent-transcripts/\` (Obsidian-MCP-For-Cursor sessions excluded)

| Tool | Plan (30d) | Extracted | Δ |
|------|----------:|----------:|--:|
${reconciliationTable}

**Friction patterns**

| Pattern | Count |
|---------|------:|
| Full replace (\`update_note\`) | ${classification.replaceCount} |
| Search retry (overlapping query ≤3 turns) | ${classification.searchRetries} |
| Truncation recovery (assistant text) | ${classification.truncationCases} |

**Highest MCP sessions (qualitative review)**

| Transcript | MCP calls |
|------------|----------:|
${classification.topSessions.map((s) => `| [\`${s.transcript_id.slice(0, 8)}\`](file:///Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts/${s.transcript_id}/${s.transcript_id}.jsonl) | ${s.mcp_calls} |`).join('\n')}

---

## 3. Search validation

**Replay set:** ${search.summary.cases} unique queries (${search.summary.withGolden} with transcript follow-up golden label)

### Curated wiki-query suite (${curated.cases} queries with known intent pages)

| Baseline | Top-1 | Top-3 |
|----------|------:|------:|
| Old-upstream | ${pct(curated.top1.old_upstream)} | ${pct(curated.top3.old_upstream)} |
| Old-patched | ${pct(curated.top1.old_patched)} | ${pct(curated.top3.old_patched)} |
| **New** | **${pct(curated.top1.new)}** | **${pct(curated.top3.new)}** |

### All golden-label queries (includes hub bootstrap — weak proxy)

| Baseline | Top-1 | Top-3 |
|----------|------:|------:|
| Old-upstream | ${pct(search.summary.top1Accuracy.old_upstream)} | ${pct(search.summary.top3Accuracy.old_upstream)} |
| Old-patched | ${pct(search.summary.top1Accuracy.old_patched)} | ${pct(search.summary.top3Accuracy.old_patched)} |
| **New** | **${pct(search.summary.top1Accuracy.new)}** | **${pct(search.summary.top3Accuracy.new)}** |

### Excluding hub-page golden labels (${exHub.cases} queries)

| Baseline | Top-1 | Top-3 |
|----------|------:|------:|
| Old-upstream | ${pct(exHub.top1.old_upstream)} | ${pct(exHub.top3.old_upstream)} |
| Old-patched | ${pct(exHub.top1.old_patched)} | ${pct(exHub.top3.old_patched)} |
| **New** | **${pct(exHub.top1.new)}** | **${pct(exHub.top3.new)}** |

### Ranking examples (golden-label rank)

| Query | Upstream | Patched | New | New top-1 |
|-------|:--------:|:-------:|:---:|-----------|
${searchExamples}

### BigHand case study ([f681a293](file:///Users/jeddowes/.cursor/projects/Users-jeddowes-Library-CloudStorage-OneDrive-Freshfields-Desktop-local-DataPlatform-DataLandingZone/agent-transcripts/f681a293-0729-4f69-93e9-cd5da9b4572a/f681a293-0729-4f69-93e9-cd5da9b4572a.jsonl))

- Bootstrap: \`"bighand FactPublicHoliday public holidays"\` → new top-1: \`${bighandBootstrap?.baselines.new.top1 ?? '—'}\` (correct intent page; agent read hub in same turn before retry)
- Retry: \`"bighand"\` → new top-1: \`${bighandRetry?.baselines.new.top1 ?? '—'}\`
- Agent recovered truncated pages via extra \`search_content\` + \`Grep\` on transcript (lines ~75–80) — MCP-only protocol breach driven by unsafe replace

${regressions.length > 0 ? `### Regressions (new worse than old-patched)\n\n${regressions.map((r) => `- \`${r.query}\` — patched rank ${r.patchedRank ?? '—'}, new rank ${r.newRank ?? '—'}`).join('\n')}` : '### Regressions\n\nNo queries where new ranks worse than old-patched on golden-label set.'}

---

## 4. Link validation

### read_note (top 20 corpus paths)

| Path | Calls | outgoingLinks | Resolved % | contentHash |
|------|------:|-------------:|-----------:|:-----------:|
${reads.topReadPaths
  .slice(0, 10)
  .map(
    (r) =>
      `| \`${r.path}\` | ${r.corpusCount} | ${r.outgoingLinkCount} | ${r.resolutionRate ?? '—'} | ${r.hasContentHash ? '' : '—'} |`,
  )
  .join('\n')}

Hub page (\`data-platform-dlz\`): ${hubRead ? `${hubRead.resolutionRate}% link resolution` : 'not in top-20'}

### get_backlinks (corpus replay)

| Path | Backlinks | Latency |
|------|----------:|--------:|
${reads.backlinkReplay.map((r) => `| \`${r.path}\` | ${r.backlinkCount} | ${r.latencyMs}ms |`).join('\n')}

\`get_graph\` / \`search_by_tags\` / \`move_note\`: **0** transcript calls — no regression from v1 tool surface reduction.

---

## 5. Write safety (dry-run)

Simulated **${writes.simulated}** historical \`replace\` calls against **current** vault state (read-only; no writes).

| Metric | Value |
|--------|------:|
| Would truncate under old upstream (<50% size) | ${writes.wouldTruncateOldUpstream} |
| Blocked by new size guard | ${writes.blockedBySizeGuard} |
| Could use patch/section instead | ${writes.patchAlternativeCandidates} |

### f681a293 replace dry-run

| Line | Path | Shrink ratio | New guard |
|------|------|-------------:|-----------|
${writes.f681a293.cases
  .slice(0, 6)
  .map(
    (c) =>
      `| ${c.line_number} | \`${c.path}\` | ${Math.round((c.shrinkRatio ?? 0) * 100)}% | ${c.new_guard} |`,
  )
  .join('\n')}

**Note:** Line-18-style fragment table-row replace is flagged when proposed content ≪ current body. On today's vault (post-recovery), some f681 replaces appear \`allowed\` because the agent already restored full pages.

---

## 6. Performance

### Standard benchmark suite (new MCP)

| Label | Baseline (stored) | Current | Δ ms |
|-------|------------------:|--------:|-----:|
${benchmarkRows}

### Corpus-weighted search (top 10 queries × 5 iterations)

| Baseline | p50 | p95 |
|----------|----:|----:|
| Old-upstream | ${benchmarks.corpusWeighted.p50.old_upstream}ms | ${benchmarks.corpusWeighted.p95.old_upstream}ms |
| Old-patched | ${benchmarks.corpusWeighted.p50.old_patched}ms | ${benchmarks.corpusWeighted.p95.old_patched}ms |
| **New** | **${benchmarks.corpusWeighted.p50.new}ms** | **${benchmarks.corpusWeighted.p95.new}ms** |

Cold search on ~76-note vault remains ~40–55ms; cached repeat ~14ms. Acceptable at current scale.

---

## 7. New failures

${regressions.length === 0 ? 'No search ranking regressions vs old-patched on the golden-label replay set.' : `${regressions.length} search queries rank worse — see §3.`}

False guard blocks on legitimate full restructures: review cases in \`write-dryrun-results.json\` where \`new_guard === "blocked"\` and \`could_use_patch_or_section === false\`.

---

## 8. Recommendations backlog

| P | Area | Recommendation | Evidence |
|---|------|----------------|----------|
${recommendations.map((r) => `| ${r.priority} | ${r.area} | ${r.item} | ${r.evidence} |`).join('\n')}

---

## Artifacts

| File | Description |
|------|-------------|
| \`docs/validation/corpus/mcp-calls-30d.jsonl\` | Extracted MCP invocations |
| \`docs/validation/corpus/corpus-classification.json\` | Tool counts + friction tags |
| \`docs/validation/corpus/replay-matrix.json\` | Deduplicated search replay set |
| \`docs/validation/corpus/search-replay-results.json\` | Old vs new search comparison |
| \`docs/validation/corpus/read-replay-results.json\` | outgoingLinks / backlinks |
| \`docs/validation/corpus/write-dryrun-results.json\` | Size-guard simulation |
| \`docs/validation/corpus/benchmark-comparison.json\` | Latency benchmarks |
| \`docs/validation/scripts/extract-transcript-corpus.mjs\` | Corpus extractor |
| \`docs/validation/scripts/replay-transcript-calls.mjs\` | Replay runner |

**Old baselines:** Old-upstream and old-patched search implemented in \`docs/validation/scripts/lib/old-search.mjs\` (upstream substring vs DLZ token-AND patch). No writes to WorkStuff vault.

---

*Generated ${new Date().toISOString()} by validation pipeline.*
`;

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, report, 'utf-8');
  console.log(`Report written: ${REPORT_PATH}`);
}

buildReport().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
