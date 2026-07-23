#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTestServer,
  callTool,
  parseResult,
  resetCaches,
} from '../../../scripts/test-lib.mjs';
import { buildIntentGoldenMap } from '../../../scripts/suites/corpus-search.mjs';
import { assertReplaceSizeGuard } from '../../../dist/lib/section-edit.js';
import { normaliseNotePath } from './lib/parse-transcripts.mjs';
import { searchOldUpstream, searchOldPatched, percentile } from './lib/old-search.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CORPUS_PATH = path.join(REPO_ROOT, 'docs/validation/corpus/mcp-calls-30d.jsonl');
const SEARCH_OUTPUT = path.join(REPO_ROOT, 'docs/validation/corpus/search-replay-results.json');
const WRITE_OUTPUT = path.join(REPO_ROOT, 'docs/validation/corpus/write-dryrun-results.json');
const READ_OUTPUT = path.join(REPO_ROOT, 'docs/validation/corpus/read-replay-results.json');
const BENCHMARK_OUTPUT = path.join(REPO_ROOT, 'docs/validation/corpus/benchmark-comparison.json');
const REPLAY_MATRIX_PATH = path.join(REPO_ROOT, 'docs/validation/corpus/replay-matrix.json');

const VAULT_PATH =
  process.env.OBSIDIAN_VAULT_PATH ??
  '/Users/jeddowes/Library/CloudStorage/OneDrive-Freshfields/Obsidian/WorkStuff';

const SUPPLEMENT_QUERIES = [
  {
    query: 'bighand FactPublicHoliday public holidays',
    goldenPath: 'projects/data-platform-dlz/entities/factpublicholiday',
    source: 'f681a293',
  },
  {
    query: 'bighand',
    goldenPath: 'projects/data-platform-dlz/concepts/bighand-data-product',
    source: 'f681a293-retry',
  },
  {
    query: 'ADF pipeline orchestrator',
    goldenPath: 'projects/data-platform-dlz/concepts/orchestration-and-adf',
    source: 'wiki-query-suite',
  },
  {
    query: 'FactPublicHoliday',
    goldenPath: 'projects/data-platform-dlz/entities/factpublicholiday',
    source: 'wiki-query-suite',
  },
  {
    query: 'deployment CI CD',
    goldenPath: 'projects/data-platform-dlz/skills/deployment-and-ci-cd',
    source: 'wiki-query-suite',
  },
  {
    query: 'Unity Catalog metastore',
    goldenPath: 'projects/data-platform-dlz/concepts/metastore-schema-evolution',
    source: 'wiki-query-suite',
  },
];

/**
 * Loads JSONL corpus records from disk.
 */
async function loadCorpus() {
  const raw = await fs.readFile(CORPUS_PATH, 'utf-8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Builds deduplicated search replay cases with golden read_note labels.
 */
function buildSearchReplaySet(corpus) {
  const byQuery = new Map();

  for (const record of corpus) {
    if (record.toolName !== 'search_content') continue;
    const query = String(record.arguments?.query ?? '').trim();
    if (!query) continue;

    const golden =
      record.line_context?.same_turn_read_paths?.[0] ??
      record.line_context?.next_read_paths?.[0] ??
      record.line_context?.next_mcp_calls?.find((c) => c.toolName === 'read_note')?.arguments?.path;

    const normalisedGolden = golden ? normaliseNotePath(golden) : null;
    const existing = byQuery.get(query.toLowerCase());
    if (!existing) {
      byQuery.set(query.toLowerCase(), {
        query,
        limit: record.arguments?.limit ?? 20,
        goldenPath: normalisedGolden,
        transcript_ids: [record.transcript_id],
        occurrences: 1,
      });
      continue;
    }
    existing.occurrences += 1;
    if (!existing.goldenPath && normalisedGolden) existing.goldenPath = normalisedGolden;
    if (!existing.transcript_ids.includes(record.transcript_id)) {
      existing.transcript_ids.push(record.transcript_id);
    }
  }

  for (const supplement of SUPPLEMENT_QUERIES) {
    const key = supplement.query.toLowerCase();
    const existing = byQuery.get(key);
    if (existing) {
      existing.goldenPath = normaliseNotePath(supplement.goldenPath);
      continue;
    }
    byQuery.set(key, {
      query: supplement.query,
      limit: 20,
      goldenPath: normaliseNotePath(supplement.goldenPath),
      transcript_ids: [supplement.source],
      occurrences: 0,
    });
  }

  // Infer golden labels from the most common read_note follow-up per query.
  for (const testCase of byQuery.values()) {
    if (testCase.goldenPath) continue;
    const followers = corpus
      .filter(
        (r) =>
          r.toolName === 'search_content' &&
          String(r.arguments?.query ?? '').toLowerCase() === testCase.query.toLowerCase(),
      )
      .flatMap((r) => [
        ...(r.line_context?.same_turn_read_paths ?? []),
        ...(r.line_context?.next_read_paths ?? []),
      ])
      .filter(Boolean);
    if (followers.length === 0) continue;
    const counts = new Map();
    for (const p of followers) counts.set(p, (counts.get(p) ?? 0) + 1);
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (best) testCase.goldenPath = best[0];
  }

  const intentGoldens = buildIntentGoldenMap();
  for (const testCase of byQuery.values()) {
    const intentPath = intentGoldens.get(testCase.query.toLowerCase());
    if (intentPath) {
      testCase.goldenPath = normaliseNotePath(intentPath);
    }
  }

  return [...byQuery.values()].sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Evaluates whether ranked search results contain the golden note path.
 */
function evaluateGoldenRank(results, goldenPath) {
  if (!goldenPath) return { goldenTop3Hit: null, goldenRank: null };
  const paths = results.map((r) => normaliseNotePath(r.path));
  const rankIdx = paths.findIndex((p) => p.includes(goldenPath) || goldenPath.includes(p));
  return {
    goldenTop3Hit: rankIdx >= 0 && rankIdx < 3,
    goldenRank: rankIdx >= 0 ? rankIdx + 1 : null,
  };
}

/**
 * Runs new MCP search_content via the in-process test harness.
 */
async function searchNew(server, query, limit) {
  const started = performance.now();
  resetCaches();
  const data = parseResult(await callTool(server, 'search_content', { query, limit }));
  return {
    ...data,
    latencyMs: Math.round((performance.now() - started) * 100) / 100,
  };
}

/**
 * Replays the search matrix across old-upstream, old-patched, and new baselines.
 */
async function replaySearch(cases) {
  const { server } = createTestServer();
  const results = [];

  for (const testCase of cases) {
    const limit = testCase.limit ?? 20;
    const [oldUpstream, oldPatched, newResult] = await Promise.all([
      searchOldUpstream(VAULT_PATH, testCase.query, limit),
      searchOldPatched(VAULT_PATH, testCase.query, limit),
      searchNew(server, testCase.query, limit),
    ]);

    const golden = testCase.goldenPath;
    results.push({
      query: testCase.query,
      goldenPath: golden,
      occurrences: testCase.occurrences,
      transcript_ids: testCase.transcript_ids,
      baselines: {
        old_upstream: {
          latencyMs: oldUpstream.latencyMs,
          resultCount: oldUpstream.totalMatches,
          top1: oldUpstream.results[0]?.path ?? null,
          ...evaluateGoldenRank(oldUpstream.results, golden),
        },
        old_patched: {
          latencyMs: oldPatched.latencyMs,
          resultCount: oldPatched.totalMatches,
          top1: oldPatched.results[0]?.path ?? null,
          ...evaluateGoldenRank(oldPatched.results, golden),
        },
        new: {
          latencyMs: newResult.latencyMs,
          resultCount: newResult.totalMatches,
          top1: newResult.results[0]?.path ?? null,
          relevanceTop1: newResult.results[0]?.relevanceScore ?? null,
          ...evaluateGoldenRank(newResult.results, golden),
        },
      },
    });
  }

  const summary = {
    cases: results.length,
    withGolden: results.filter((r) => r.goldenPath).length,
    top1Accuracy: {
      old_upstream: rate(results, (r) => r.baselines.old_upstream.goldenRank === 1),
      old_patched: rate(results, (r) => r.baselines.old_patched.goldenRank === 1),
      new: rate(results, (r) => r.baselines.new.goldenRank === 1),
    },
    top3Accuracy: {
      old_upstream: rate(results, (r) => r.baselines.old_upstream.goldenTop3Hit),
      old_patched: rate(results, (r) => r.baselines.old_patched.goldenTop3Hit),
      new: rate(results, (r) => r.baselines.new.goldenTop3Hit),
    },
    curatedWikiQuerySuite: computeCuratedMetrics(results),
    excludingHubGolden: computeExcludingHub(results),
    newWorseThanPatched: results
      .filter((r) => {
        if (!r.goldenPath) return false;
        const patchedRank = r.baselines.old_patched.goldenRank ?? 999;
        const newRank = r.baselines.new.goldenRank ?? 999;
        return newRank > patchedRank;
      })
      .map((r) => ({
        query: r.query,
        patchedRank: r.baselines.old_patched.goldenRank,
        newRank: r.baselines.new.goldenRank,
      })),
  };

  return { generatedAt: new Date().toISOString(), vaultPath: VAULT_PATH, summary, results };
}

/**
 * Computes accuracy for the fixed wiki-query supplement set with known intent pages.
 */
function computeCuratedMetrics(results) {
  const curated = results.filter((r) =>
    SUPPLEMENT_QUERIES.some((s) => s.query.toLowerCase() === r.query.toLowerCase()),
  );
  return {
    cases: curated.length,
    top1: {
      old_upstream: rate(curated, (r) => r.baselines.old_upstream.goldenRank === 1),
      old_patched: rate(curated, (r) => r.baselines.old_patched.goldenRank === 1),
      new: rate(curated, (r) => r.baselines.new.goldenRank === 1),
    },
    top3: {
      old_upstream: rate(curated, (r) => r.baselines.old_upstream.goldenTop3Hit),
      old_patched: rate(curated, (r) => r.baselines.old_patched.goldenTop3Hit),
      new: rate(curated, (r) => r.baselines.new.goldenTop3Hit),
    },
    details: curated.map((r) => ({
      query: r.query,
      goldenPath: r.goldenPath,
      newTop1: r.baselines.new.top1,
      newGoldenRank: r.baselines.new.goldenRank,
    })),
  };
}

/**
 * Recomputes accuracy excluding hub-page golden labels (weak bootstrap proxy).
 */
function computeExcludingHub(results) {
  const filtered = results.filter(
    (r) => r.goldenPath && !r.goldenPath.endsWith('data-platform-dlz'),
  );
  return {
    cases: filtered.length,
    top1: {
      old_upstream: rate(filtered, (r) => r.baselines.old_upstream.goldenRank === 1),
      old_patched: rate(filtered, (r) => r.baselines.old_patched.goldenRank === 1),
      new: rate(filtered, (r) => r.baselines.new.goldenRank === 1),
    },
    top3: {
      old_upstream: rate(filtered, (r) => r.baselines.old_upstream.goldenTop3Hit),
      old_patched: rate(filtered, (r) => r.baselines.old_patched.goldenTop3Hit),
      new: rate(filtered, (r) => r.baselines.new.goldenTop3Hit),
    },
  };
}

/**
 * Computes a percentage rate over cases that have golden labels.
 */
function rate(results, predicate) {
  const eligible = results.filter((r) => r.goldenPath);
  if (eligible.length === 0) return 0;
  const hits = eligible.filter(predicate).length;
  return Math.round((hits / eligible.length) * 1000) / 10;
}

/**
 * Replays top read_note paths and measures outgoingLinks resolution on new MCP.
 */
async function replayReads(corpus) {
  const { server } = createTestServer();
  const pathCounts = new Map();
  for (const record of corpus) {
    if (record.toolName !== 'read_note') continue;
    const notePath = record.arguments?.path;
    if (!notePath) continue;
    const key = normaliseNotePath(notePath);
    pathCounts.set(key, (pathCounts.get(key) ?? 0) + 1);
  }

  const topPaths = [...pathCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([p, count]) => ({ path: p, corpusCount: count }));

  const results = [];
  for (const item of topPaths) {
    resetCaches();
    const started = performance.now();
    const data = parseResult(await callTool(server, 'read_note', { path: item.path }));
    const links = data.outgoingLinks ?? [];
    const resolved = links.filter((l) => l.resolvedPath).length;
    results.push({
      path: item.path,
      corpusCount: item.corpusCount,
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      hasContentHash: Boolean(data.contentHash),
      outgoingLinkCount: links.length,
      resolvedLinkCount: resolved,
      resolutionRate: links.length > 0 ? Math.round((resolved / links.length) * 1000) / 10 : null,
    });
  }

  const backlinkCalls = corpus.filter((r) => r.toolName === 'get_backlinks');
  const backlinkResults = [];
  for (const call of backlinkCalls) {
    resetCaches();
    const notePath = call.arguments?.path;
    if (!notePath) continue;
    const started = performance.now();
    const data = parseResult(await callTool(server, 'get_backlinks', { path: notePath }));
    backlinkResults.push({
      path: normaliseNotePath(notePath),
      transcript_id: call.transcript_id,
      backlinkCount: data.backlinkCount ?? data.backlinks?.length ?? 0,
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    topReadPaths: results,
    backlinkReplay: backlinkResults,
  };
}

/**
 * Simulates historical replace-mode update_note calls against current vault state.
 */
async function dryRunWrites(corpus) {
  const { server } = createTestServer();
  const replaceCalls = corpus.filter((record) => {
    if (record.toolName !== 'update_note') return false;
    const mode = record.arguments?.mode ?? 'replace';
    return mode === 'replace';
  });

  const results = [];
  for (const call of replaceCalls) {
    const notePath = call.arguments?.path;
    const proposed = call.arguments?.content;
    if (!notePath || proposed === undefined) {
      results.push({
        transcript_id: call.transcript_id,
        line_number: call.line_number,
        path: notePath ?? null,
        skipped: true,
        reason: 'missing path or content',
      });
      continue;
    }

    let current;
    try {
      resetCaches();
      current = parseResult(await callTool(server, 'read_note', { path: notePath }));
    } catch (error) {
      results.push({
        transcript_id: call.transcript_id,
        line_number: call.line_number,
        path: notePath,
        skipped: true,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const existingBody = current.content ?? '';
    const proposedLen = String(proposed).length;
    const existingLen = existingBody.length;
    const shrinkRatio = existingLen > 0 ? proposedLen / existingLen : 1;

    let newGuard = 'allowed';
    try {
      assertReplaceSizeGuard(existingBody, String(proposed), false);
    } catch {
      newGuard = shrinkRatio < 0.5 ? 'blocked' : 'error';
    }
    if (shrinkRatio < 0.5 && newGuard !== 'blocked') newGuard = 'would_need_force';

    const couldUsePatch = proposedLen < existingLen * 0.3 && proposedLen > 0;

    results.push({
      transcript_id: call.transcript_id,
      line_number: call.line_number,
      path: normaliseNotePath(notePath),
      existingLen,
      proposedLen,
      shrinkRatio: Math.round(shrinkRatio * 1000) / 1000,
      old_upstream_would_truncate: shrinkRatio < 0.5,
      new_guard: newGuard,
      could_use_patch_or_section: couldUsePatch,
      friction_tags: call.friction_tags ?? [],
    });
  }

  const f681Cases = results.filter(
    (r) => r.transcript_id === 'f681a293-0729-4f69-93e9-cd5da9b4572a',
  );
  const blocked = results.filter((r) => r.new_guard === 'blocked').length;
  const truncating = results.filter((r) => r.old_upstream_would_truncate).length;

  return {
    generatedAt: new Date().toISOString(),
    totalReplaceCalls: replaceCalls.length,
    simulated: results.filter((r) => !r.skipped).length,
    blockedBySizeGuard: blocked,
    wouldTruncateOldUpstream: truncating,
    patchAlternativeCandidates: results.filter((r) => r.could_use_patch_or_section).length,
    f681a293: {
      total: f681Cases.length,
      blocked: f681Cases.filter((r) => r.new_guard === 'blocked').length,
      fragmentReplaces: f681Cases.filter((r) => r.shrinkRatio < 0.5).length,
      cases: f681Cases,
    },
    results,
  };
}

/**
 * Runs standard and corpus-weighted latency benchmarks across baselines.
 */
async function runBenchmarks(searchCases) {
  const { server } = createTestServer();
  const baselineLabels = [
    {
      label: 'list_notes.root',
      run: async () => parseResult(await callTool(server, 'list_notes', { folder: '' })),
    },
    {
      label: 'search_content.adf_pipeline',
      run: async () => {
        resetCaches();
        return parseResult(
          await callTool(server, 'search_content', { query: 'ADF pipeline', limit: 20 }),
        );
      },
    },
    {
      label: 'search_content.factpublicholiday',
      run: async () => {
        resetCaches();
        return parseResult(
          await callTool(server, 'search_content', { query: 'FactPublicHoliday', limit: 10 }),
        );
      },
    },
    {
      label: 'read_note.index',
      run: async () => parseResult(await callTool(server, 'read_note', { path: 'index' })),
    },
    {
      label: 'get_backlinks.project_hub',
      run: async () =>
        parseResult(
          await callTool(server, 'get_backlinks', {
            path: 'projects/data-platform-dlz/data-platform-dlz',
          }),
        ),
    },
    {
      label: 'search_content.cached_repeat',
      run: async () =>
        parseResult(await callTool(server, 'search_content', { query: 'ADF pipeline', limit: 20 })),
    },
  ];

  const newTimings = [];
  for (const testCase of baselineLabels) {
    resetCaches();
    const started = performance.now();
    await testCase.run();
    newTimings.push({
      label: testCase.label,
      ms: Math.round((performance.now() - started) * 100) / 100,
    });
  }

  const topQueries = searchCases.slice(0, 10);
  const corpusWeighted = { old_upstream: [], old_patched: [], new: [] };
  for (const testCase of topQueries) {
    for (let i = 0; i < 5; i += 1) {
      resetCaches();
      const newStarted = performance.now();
      await searchNew(server, testCase.query, 20);
      corpusWeighted.new.push(performance.now() - newStarted);
      corpusWeighted.old_upstream.push(
        (await searchOldUpstream(VAULT_PATH, testCase.query, 20)).latencyMs,
      );
      corpusWeighted.old_patched.push(
        (await searchOldPatched(VAULT_PATH, testCase.query, 20)).latencyMs,
      );
    }
  }

  let storedBaseline = null;
  try {
    const raw = await fs.readFile(path.join(REPO_ROOT, 'tests/benchmarks/baselines.json'), 'utf-8');
    storedBaseline = JSON.parse(raw);
  } catch {
    storedBaseline = null;
  }

  return {
    generatedAt: new Date().toISOString(),
    vaultPath: VAULT_PATH,
    newStandardTimings: newTimings,
    comparisonToStoredBaseline: storedBaseline
      ? newTimings.map((t) => {
          const prev = storedBaseline.timings?.find((b) => b.label === t.label);
          return {
            label: t.label,
            currentMs: t.ms,
            baselineMs: prev?.ms ?? null,
            deltaMs: prev ? Math.round((t.ms - prev.ms) * 100) / 100 : null,
          };
        })
      : [],
    corpusWeighted: {
      queries: topQueries.map((q) => q.query),
      iterationsPerQuery: 5,
      p50: {
        old_upstream: percentile(corpusWeighted.old_upstream, 50),
        old_patched: percentile(corpusWeighted.old_patched, 50),
        new: percentile(corpusWeighted.new, 50),
      },
      p95: {
        old_upstream: percentile(corpusWeighted.old_upstream, 95),
        old_patched: percentile(corpusWeighted.old_patched, 95),
        new: percentile(corpusWeighted.new, 95),
      },
    },
  };
}

/**
 * Orchestrates corpus replay, dry-run writes, and benchmark collection.
 */
async function main() {
  process.env.OBSIDIAN_VAULT_PATH = VAULT_PATH;
  const corpus = await loadCorpus();
  const searchCases = buildSearchReplaySet(corpus);

  await fs.mkdir(path.dirname(REPLAY_MATRIX_PATH), { recursive: true });
  await fs.writeFile(REPLAY_MATRIX_PATH, `${JSON.stringify({ searchCases }, null, 2)}\n`, 'utf-8');

  console.log(`Loaded ${corpus.length} corpus records`);
  console.log(`Search replay cases: ${searchCases.length}`);

  console.log('\n=== Search replay ===');
  const searchResults = await replaySearch(searchCases);
  await fs.writeFile(SEARCH_OUTPUT, `${JSON.stringify(searchResults, null, 2)}\n`, 'utf-8');
  console.log(
    `Top-1 accuracy — upstream: ${searchResults.summary.top1Accuracy.old_upstream}% patched: ${searchResults.summary.top1Accuracy.old_patched}% new: ${searchResults.summary.top1Accuracy.new}%`,
  );

  console.log('\n=== Read / backlink replay ===');
  const readResults = await replayReads(corpus);
  await fs.writeFile(READ_OUTPUT, `${JSON.stringify(readResults, null, 2)}\n`, 'utf-8');

  console.log('\n=== Write dry-run ===');
  const writeResults = await dryRunWrites(corpus);
  await fs.writeFile(WRITE_OUTPUT, `${JSON.stringify(writeResults, null, 2)}\n`, 'utf-8');
  console.log(
    `Replace calls: ${writeResults.totalReplaceCalls}, blocked: ${writeResults.blockedBySizeGuard}`,
  );

  console.log('\n=== Benchmarks ===');
  const benchmarkResults = await runBenchmarks(searchCases);
  await fs.writeFile(BENCHMARK_OUTPUT, `${JSON.stringify(benchmarkResults, null, 2)}\n`, 'utf-8');

  console.log('\nReplay complete.');
  console.log(`  ${SEARCH_OUTPUT}`);
  console.log(`  ${READ_OUTPUT}`);
  console.log(`  ${WRITE_OUTPUT}`);
  console.log(`  ${BENCHMARK_OUTPUT}`);

  if (searchResults.summary.newWorseThanPatched.length > 0) {
    console.error(
      `\n${searchResults.summary.newWorseThanPatched.length} search regressions vs old-patched`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
