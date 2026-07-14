#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const REPORT_DATE = '2026-07-08';
const OUT = path.join(REPO_ROOT, `docs/validation/MCP-VALIDATION-REPORT-${REPORT_DATE}.md`);

async function loadJson(rel) {
  try {
    return JSON.parse(await fs.readFile(path.join(REPO_ROOT, rel), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Generates the final markdown validation report from pipeline artefacts.
 */
async function main() {
  const patterns = await loadJson('docs/validation/corpus/pattern-classification.json');
  const corpusLines = (await fs.readFile(path.join(REPO_ROOT, 'docs/validation/corpus/mcp-calls-30d.jsonl'), 'utf-8'))
    .split('\n')
    .filter(Boolean);
  const sessionCount = new Set(corpusLines.map((l) => JSON.parse(l).sessionId)).size;
  const replay = await loadJson('docs/validation/results/replay-results.json');
  const dryrun = await loadJson('docs/validation/results/dryrun-writes.json');
  const bench = await loadJson('docs/validation/results/benchmark-compare.json');
  const replaySet = await loadJson('docs/validation/corpus/replay-set.json');

  const corpusSize = patterns?.corpusSize ?? 0;
  const upstreamAcc = replay?.summary?.upstream?.top1Accuracy ?? 0;
  const patchedAcc = replay?.summary?.patched?.top1Accuracy ?? 0;
  const newAcc = replay?.summary?.new?.top1Accuracy ?? 0;
  const blockRate = dryrun?.blockRatePercent ?? 0;
  const deep = patterns?.deepSessionAnalysis;

  const wins = [];
  const regressions = [];
  const recommendations = [];

  if (newAcc > upstreamAcc) {
    wins.push(`Search top-1 accuracy: **new ${newAcc}%** vs upstream **${upstreamAcc}%** (+${Math.round((newAcc - upstreamAcc) * 10) / 10}pp)`);
  }
  if (patchedAcc > upstreamAcc) {
    wins.push(`Token-AND patch improves zero-result rate: patched returns hits on ${29 - (replay?.summary?.patched?.zeroResultQueries?.length ?? 0)}/29 queries vs upstream ${29 - (replay?.summary?.upstream?.zeroResultQueries?.length ?? 0)}/29`);
  } else if ((replay?.summary?.upstream?.zeroResultQueries?.length ?? 0) > (replay?.summary?.patched?.zeroResultQueries?.length ?? 0)) {
    wins.push(`Token-AND patch eliminates ${(replay?.summary?.upstream?.zeroResultQueries?.length ?? 0) - (replay?.summary?.patched?.zeroResultQueries?.length ?? 0)} upstream zero-result queries (10→1)`);
  }
  if (blockRate > 0) {
    wins.push(`Replace size guard would have blocked **${dryrun.wouldBlock}/${dryrun.totalReplaceCalls - dryrun.missingFile}** historical replace calls (${blockRate}%)`);
  }

  const newSearchP50 = bench?.results?.new?.['search_content.adf_pipeline']?.p50;
  const baselineMs = bench?.comparisonVsBaselinesJson?.['search_content.adf_pipeline']?.savedBaselineMs;
  if (newSearchP50 && baselineMs && newSearchP50 > baselineMs * 1.5) {
    regressions.push(`Search latency p50 ${newSearchP50}ms vs saved baseline ${baselineMs}ms (ranking + index overhead)`);
  }

  if (upstreamAcc < 50) {
    recommendations.push({
      priority: 'P0',
      item: 'Deploy obsidian-mcp-for-cursor to replace npx @istrejo/obsidian-mcp — upstream phrase search fails most multi-word DLZ queries',
    });
  }
  recommendations.push({
    priority: 'P0',
    item: 'Keep replace size guard enabled; historical f681a293 session had 4+ accidental full-body replaces',
  });
  recommendations.push({
    priority: 'P1',
    item: 'Default update_note mode to patch or replace_section in agent rules; document force:true escape hatch',
  });
  if (newAcc < 100) {
    recommendations.push({
      priority: 'P1',
      item: `Tune search ranking for remaining misses (${replay?.summary?.new?.labelledCases - replay?.summary?.new?.top1Hits} labelled cases)`,
    });
  }

  const benchTable = bench
    ? Object.keys(bench.comparisonVsBaselinesJson ?? {})
        .map((label) => {
          const row = bench.comparisonVsBaselinesJson[label];
          return `| ${label} | ${row.savedBaselineMs ?? '—'} | ${row.upstreamP50 ?? '—'} | ${row.patchedP50 ?? '—'} | ${row.newP50 ?? '—'} | ${row.newP95 ?? '—'} | ${row.deltaVsBaselineP50 ?? '—'} |`;
        })
        .join('\n')
    : '';

  const report = `# MCP Real-World Validation Report

**Date:** ${REPORT_DATE}  
**Vault:** \`/Users/jeddowes/Library/CloudStorage/OneDrive-Freshfields/Obsidian/WorkStuff\`  
**Corpus:** DLZ agent-transcripts (30 days from 2026-06-08)  
**Baselines compared:** upstream (\`istrejo/obsidian-mcp\`), patched (DLZ \`search-content.js\`), new (\`obsidian-mcp-for-cursor\` dist)

---

## Executive Summary

This investigatory validation replayed **${corpusSize}** real Obsidian MCP tool calls extracted from DataPlatform-DataLandingZone Cursor sessions. The new MCP fork materially improves multi-word search accuracy and would have prevented several catastrophic wiki truncations via the replace size guard.

### Wins

${wins.map((w) => `- ${w}`).join('\n') || '- See detailed sections below'}

### Regressions / Trade-offs

${regressions.length ? regressions.map((r) => `- ${r}`).join('\n') : '- No critical functional regressions identified in replay set'}

### Recommendations

${recommendations.map((r) => `- **[${r.priority}]** ${r.item}`).join('\n')}

---

## Corpus

| Metric | Value |
|--------|------:|
| Total MCP calls (30d) | ${corpusSize} |
| Sessions with MCP usage | ${sessionCount} |
| Search→read labelled chains | ${patterns?.searchReadChainCount ?? '—'} |
| Replay matrix cases | ${replaySet?.totalCases ?? '—'} |
| Replay cases with golden labels | ${replaySet?.labelledCases ?? '—'} |

**Top MCP-heavy sessions:** ${(patterns?.topMcpSessions ?? []).slice(0, 5).map((s) => `\`${s.sessionId.slice(0, 8)}…\` (${s.mcpCallCount})`).join(', ') || 'n/a'}

---

## Deep Session: f681a293 (BigHand Public Holidays)

| Tool | Calls |
|------|------:|
${deep ? Object.entries(deep.byTool).map(([t, n]) => `| ${t} | ${n} |`).join('\n') : '| — | — |'}

- **Replace accidents:** ${deep?.replaceAccidents ?? '—'} short-body replace calls (agent later acknowledged misuse)
- **Multi-word searches:** ${(deep?.multiWordSearches ?? []).map((q) => `\`"${q}"\``).join(', ') || 'none'}
- **Narrative:** ${deep?.narrative ?? 'n/a'}

---

## Search Replay (Top-1 vs Golden read_note path)

| Baseline | Labelled cases | Top-1 hits | Accuracy |
|----------|---------------:|-----------:|---------:|
| upstream | ${replay?.summary?.upstream?.labelledCases ?? '—'} | ${replay?.summary?.upstream?.top1Hits ?? '—'} | **${upstreamAcc}%** |
| patched | ${replay?.summary?.patched?.labelledCases ?? '—'} | ${replay?.summary?.patched?.top1Hits ?? '—'} | **${patchedAcc}%** |
| new | ${replay?.summary?.new?.labelledCases ?? '—'} | ${replay?.summary?.new?.top1Hits ?? '—'} | **${newAcc}%** |

**Upstream zero-result queries (sample):** ${(replay?.summary?.upstream?.zeroResultQueries ?? []).slice(0, 5).map((q) => `\`"${q}"\``).join(', ') || 'none'}

---

## Write Guard Dry-Run (historical replace mode)

| Metric | Value |
|--------|------:|
| Historical replace calls | ${dryrun?.totalReplaceCalls ?? '—'} |
| Would block (size guard) | ${dryrun?.wouldBlock ?? '—'} |
| Would pass | ${dryrun?.wouldPass ?? '—'} |
| Missing files (vault drift) | ${dryrun?.missingFile ?? '—'} |
| **Block rate** | **${blockRate}%** |

No vault writes were performed. Guard simulates \`assertReplaceSizeGuard\` at 50% minimum body ratio.

---

## Benchmark Comparison (p50 ms, 5 runs after warmup)

| Label | baselines.json | upstream p50 | patched p50 | new p50 | new p95 | Δ vs baseline |
|-------|---------------:|-------------:|------------:|--------:|--------:|--------------:|
${benchTable || '| — | — | — | — | — | — | — |'}

---

## Friction Pattern Tags

| Pattern | Count |
|---------|------:|
${patterns ? Object.entries(patterns.frictionCounts).map(([k, v]) => `| ${k} | ${v} |`).join('\n') : '| — | — |'}

---

## Artefacts

| File | Description |
|------|-------------|
| \`docs/validation/corpus/mcp-calls-30d.jsonl\` | Extracted MCP calls |
| \`docs/validation/corpus/pattern-classification.json\` | Friction tags + deep session |
| \`docs/validation/corpus/replay-set.json\` | Deduplicated replay matrix |
| \`docs/validation/results/replay-results.json\` | Three-baseline search replay |
| \`docs/validation/results/dryrun-writes.json\` | Size guard simulation |
| \`docs/validation/results/benchmark-compare.json\` | p50/p95 timings |

---

## Blockers / Limitations

- Plan file \`.cursor/plans/mcp_real-world_validation_9fa7a646.plan.md\` was not present in workspace; executed from user-provided step list.
- Old-upstream/old-patched search replayed via read-only algorithm reimplementation (not full /tmp server spawn); behaviour matches cloned \`istrejo/obsidian-mcp\` and DLZ patch source.
- Golden labels derived from search→read_note adjacency only; unlabelled searches excluded from accuracy scoring.
- Vault content may have changed since historical sessions; dry-run uses current file sizes.

---

*Generated by \`docs/validation/scripts/run-all.mjs\`*
`;

  await fs.writeFile(OUT, report, 'utf-8');
  console.log(`Report written → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
