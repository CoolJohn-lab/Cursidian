#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchUpstream, searchPatched } from './lib/search-baselines.mjs';
import { summariseTimings } from './lib/stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const BASELINE_PATH = path.join(REPO_ROOT, 'tests/benchmarks/baselines.json');
const VAULT =
  process.env.OBSIDIAN_VAULT_PATH ??
  '/Users/jeddowes/Library/CloudStorage/OneDrive-Freshfields/Obsidian/WorkStuff';

const WARMUP = 1;
const RUNS = 5;

const BENCHMARK_CASES = [
  { label: 'list_notes.root', type: 'list', folder: '' },
  { label: 'search_content.adf_pipeline', type: 'search', query: 'ADF pipeline', limit: 20 },
  {
    label: 'search_content.factpublicholiday',
    type: 'search',
    query: 'FactPublicHoliday',
    limit: 10,
  },
  { label: 'read_note.index', type: 'read', path: 'index' },
  {
    label: 'get_backlinks.project_hub',
    type: 'backlinks',
    path: 'projects/data-platform-dlz/data-platform-dlz',
  },
  {
    label: 'search_content.cached_repeat',
    type: 'search',
    query: 'ADF pipeline',
    limit: 20,
    cached: true,
  },
];

/**
 * Times a single benchmark operation for a given baseline implementation.
 */
async function timeOperation(baseline, testCase, repoRoot) {
  const started = performance.now();

  if (testCase.type === 'search') {
    if (baseline === 'upstream') {
      await searchUpstream(VAULT, testCase.query, { limit: testCase.limit });
    } else if (baseline === 'patched') {
      await searchPatched(VAULT, testCase.query, { limit: testCase.limit });
    } else {
      const { createTestServer, callTool, parseResult, resetCaches } = await import(
        path.join(repoRoot, 'scripts/test-lib.mjs')
      );
      if (!testCase.cached) resetCaches();
      const { server } = createTestServer();
      await parseResult(
        await callTool(server, 'search_content', { query: testCase.query, limit: testCase.limit }),
      );
    }
  } else {
    const { createTestServer, callTool, parseResult, resetCaches } = await import(
      path.join(repoRoot, 'scripts/test-lib.mjs')
    );
    if (!testCase.cached) resetCaches();
    const { server } = createTestServer();
    if (testCase.type === 'list') {
      await parseResult(await callTool(server, 'list_notes', { folder: testCase.folder }));
    } else if (testCase.type === 'read') {
      await parseResult(await callTool(server, 'read_note', { path: testCase.path }));
    } else if (testCase.type === 'backlinks') {
      await parseResult(await callTool(server, 'get_backlinks', { path: testCase.path }));
    }
  }

  return performance.now() - started;
}

/**
 * Runs benchmark matrix across upstream/patched/new and compares to baselines.json.
 */
async function main() {
  let savedBaseline = null;
  try {
    savedBaseline = JSON.parse(await fs.readFile(BASELINE_PATH, 'utf-8'));
  } catch {
    // no saved baseline
  }

  const baselines = ['upstream', 'patched', 'new'];
  const allResults = {};

  for (const baseline of baselines) {
    const samples = {};
    for (const testCase of BENCHMARK_CASES) {
      samples[testCase.label] = [];
      for (let i = 0; i < WARMUP + RUNS; i++) {
        const ms = await timeOperation(baseline, testCase, REPO_ROOT);
        if (i >= WARMUP) samples[testCase.label].push({ ms });
      }
    }

    allResults[baseline] = {};
    for (const [label, rows] of Object.entries(samples)) {
      allResults[baseline][label] = summariseTimings(rows);
    }
  }

  const comparison = {};
  if (savedBaseline) {
    for (const testCase of BENCHMARK_CASES) {
      const prev = savedBaseline.timings?.find((t) => t.label === testCase.label);
      comparison[testCase.label] = {
        savedBaselineMs: prev?.ms ?? null,
        newP50: allResults.new[testCase.label]?.p50,
        newP95: allResults.new[testCase.label]?.p95,
        upstreamP50: allResults.upstream[testCase.label]?.p50,
        patchedP50: allResults.patched[testCase.label]?.p50,
        deltaVsBaselineP50:
          prev?.ms != null && allResults.new[testCase.label]
            ? Math.round((allResults.new[testCase.label].p50 - prev.ms) * 100) / 100
            : null,
      };
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    vaultPath: VAULT,
    runsPerCase: RUNS,
    warmup: WARMUP,
    savedBaselinePath: BASELINE_PATH,
    results: allResults,
    comparisonVsBaselinesJson: comparison,
  };

  const outPath = path.join(REPO_ROOT, 'docs/validation/results/benchmark-compare.json');
  await fs.writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');

  console.log('Benchmark p50 (ms):');
  for (const testCase of BENCHMARK_CASES) {
    const u = allResults.upstream[testCase.label].p50;
    const p = allResults.patched[testCase.label].p50;
    const n = allResults.new[testCase.label].p50;
    console.log(`  ${testCase.label}: upstream=${u} patched=${p} new=${n}`);
  }
  console.log(`→ ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
