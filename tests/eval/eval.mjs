#!/usr/bin/env node
/**
 * Retrieval quality eval for the golden CDF-flavoured vault.
 *
 * Exercises the real `search` MCP tool (action=content) end to end against
 * tests/eval/golden-vault and scores the ranked results with nDCG@10,
 * Recall@10, and MRR against the labelled queries in tests/eval/queries.jsonl.
 * When the `context` tool is registered, also scores `context assemble`
 * bundles (token efficiency and budget adherence) for the same queries.
 *
 * This imports the compiled dist/ output (dist/config.js, dist/tools/index.js)
 * rather than src/, so the ranking logic under test matches what actually
 * ships. Run `npm run build` before `npm run eval` if dist/ is missing or
 * stale.
 *
 * Usage:
 *   node tests/eval/eval.mjs [--report-only]
 *   node tests/eval/eval.mjs --gate
 *   node tests/eval/eval.mjs --sweep
 *
 * --report-only: never exits non-zero, even on a hard setup failure. Used by
 * the non-blocking eval-report step in scripts/run-verify-inner.mjs.
 * --gate: fails when nDCG@10 regresses vs snapshots/gate-baseline.json.
 * --sweep: tries a small set of RANK_WEIGHTS.expandedTokenMultiplier values
 * against the compiled ranker and prints which scores best on nDCG@10
 * without regressing MRR. Read-only - never edits src/ or writes a snapshot.
 */
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const goldenVaultDir = path.join(__dirname, 'golden-vault');
const queriesPath = path.join(__dirname, 'queries.jsonl');
const snapshotPath = path.join(__dirname, 'snapshots', 'baseline.json');
const bundleSnapshotPath = path.join(__dirname, 'snapshots', 'bundle-baseline.json');
const distConfigPath = path.join(repoRoot, 'dist', 'config.js');
const distToolsPath = path.join(repoRoot, 'dist', 'tools', 'index.js');
const distVaultIndexPath = path.join(repoRoot, 'dist', 'lib', 'vault-index.js');
const distSearchRankingPath = path.join(repoRoot, 'dist', 'lib', 'search-ranking.js');

/** Dynamic import of a repo-local path (Windows needs file:// URLs). */
function importDist(absPath) {
  return import(pathToFileURL(absPath).href);
}

const TOP_K = 10;
/** Sweep never adopts a candidate that regresses MRR by more than this. */
const MRR_REGRESSION_EPSILON = 0.01;
/** Sweep only recommends a candidate whose nDCG@10 beats the current value by more than this (avoids flagging ties). */
const NDCG_IMPROVEMENT_EPSILON = 0.001;
/** Small, deliberately coarse sweep set - this is a diagnostic, not a full grid search. */
const SWEEP_EXPANDED_TOKEN_MULTIPLIERS = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];

function parseArgs(argv) {
  return {
    reportOnly: argv.includes('--report-only'),
    gate: argv.includes('--gate'),
    sweep: argv.includes('--sweep'),
  };
}

function assertDistBuilt(entries) {
  for (const [label, distPath] of entries) {
    if (!fs.existsSync(distPath)) {
      throw new Error(`Missing ${label}. Run "npm run build" before "npm run eval".`);
    }
  }
}

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fsp.copyFile(from, to);
    }
  }
}

async function loadQueries() {
  const raw = await fsp.readFile(queriesPath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(`queries.jsonl line ${i + 1} is not valid JSON: ${message}`);
      }
    });
}

function dcg(relevances) {
  return relevances.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
}

/** Scores one query's ranked paths against its labelled relevant paths. */
function scoreQuery(rankedPaths, relevantPaths) {
  const relevantSet = new Set(relevantPaths);
  const topK = rankedPaths.slice(0, TOP_K);

  const gains = topK.map((p) => (relevantSet.has(p) ? 1 : 0));
  const idealGains = Array.from({ length: Math.min(relevantSet.size, TOP_K) }, () => 1);
  const idcg = dcg(idealGains);
  const ndcg = idcg > 0 ? dcg(gains) / idcg : 0;

  const hitCount = topK.filter((p) => relevantSet.has(p)).length;
  const recall = relevantSet.size > 0 ? hitCount / relevantSet.size : 0;

  let mrr = 0;
  for (let i = 0; i < topK.length; i++) {
    if (relevantSet.has(topK[i])) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  return { ndcg, recall, mrr, rankedTopK: topK };
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatScore(value) {
  return typeof value === 'number' ? value.toFixed(3) : 'n/a';
}

function aggregate(entries) {
  return {
    n: entries.length,
    ndcg: average(entries.map((q) => q.ndcg)),
    recall: average(entries.map((q) => q.recall)),
    mrr: average(entries.map((q) => q.mrr)),
  };
}

function aggregateBundles(entries) {
  return {
    n: entries.length,
    avgTokenEfficiency: average(entries.map((q) => q.tokenEfficiency)),
    budgetAdherenceRate: average(entries.map((q) => (q.budgetOk ? 1 : 0))),
  };
}

function printScorecard(overall, byIntent) {
  console.log('\nRetrieval Eval Scorecard (golden-vault, top-%d)', TOP_K);
  console.log('='.repeat(64));
  console.log(
    `Overall (n=${overall.n})  nDCG@10=${formatScore(overall.ndcg)}  Recall@10=${formatScore(overall.recall)}  MRR=${formatScore(overall.mrr)}`,
  );
  console.log('-'.repeat(64));
  console.log('By intent:');
  for (const [intent, stats] of byIntent) {
    console.log(
      `  ${intent.padEnd(12)} (n=${String(stats.n).padEnd(2)})  nDCG@10=${formatScore(stats.ndcg)}  Recall@10=${formatScore(stats.recall)}  MRR=${formatScore(stats.mrr)}`,
    );
  }
  console.log('='.repeat(64));
}

function printBundleScorecard(overall) {
  console.log('\nContext Bundle Eval (action=assemble, budget from queries.jsonl)');
  console.log('='.repeat(64));
  console.log(
    `Overall (n=${overall.n})  tokenEfficiency=${formatScore(overall.avgTokenEfficiency)}  budgetAdherence=${formatScore(overall.budgetAdherenceRate)}`,
  );
  console.log('='.repeat(64));
}

/**
 * Copies the golden vault to a temp dir, points OBSIDIAN_VAULT_PATH at it, registers
 * all MCP tools against a fresh server, runs `fn`, then restores env and cleans up.
 * Shared by the normal eval run and --sweep so both exercise the same setup.
 */
async function withEvalServer(fn) {
  const { loadConfig } = await importDist(distConfigPath);
  const { registerAllTools } = await importDist(distToolsPath);
  const { clearAllSearchCaches } = await importDist(distVaultIndexPath);

  const vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-eval-'));
  const priorVault = process.env.OBSIDIAN_VAULT_PATH;
  const priorBackup = process.env.OBSIDIAN_BACKUP_ENABLED;
  const priorLogLevel = process.env.OBSIDIAN_LOG_LEVEL;

  try {
    await copyDir(goldenVaultDir, vault);
    process.env.OBSIDIAN_VAULT_PATH = vault;
    process.env.OBSIDIAN_BACKUP_ENABLED = 'false';
    process.env.OBSIDIAN_LOG_LEVEL = 'error';
    clearAllSearchCaches();

    const config = loadConfig();
    const server = new McpServer({ name: 'cursidian-eval', version: '0.0.0' });
    registerAllTools(server, config);

    return await fn({ server, clearAllSearchCaches });
  } finally {
    if (priorVault === undefined) {
      delete process.env.OBSIDIAN_VAULT_PATH;
    } else {
      process.env.OBSIDIAN_VAULT_PATH = priorVault;
    }
    if (priorBackup === undefined) {
      delete process.env.OBSIDIAN_BACKUP_ENABLED;
    } else {
      process.env.OBSIDIAN_BACKUP_ENABLED = priorBackup;
    }
    if (priorLogLevel === undefined) {
      delete process.env.OBSIDIAN_LOG_LEVEL;
    } else {
      process.env.OBSIDIAN_LOG_LEVEL = priorLogLevel;
    }
    clearAllSearchCaches();
    await fsp.rm(vault, { recursive: true, force: true }).catch(() => {});
  }
}

/** Scores every query's ranked search results via the registered `search` tool. */
async function scoreSearchQueries(server, queries) {
  const registeredSearch = server._registeredTools?.search;
  if (!registeredSearch?.handler) {
    throw new Error('search tool did not register (unexpected dist/tools/index.js shape)');
  }

  const perQuery = [];
  for (const q of queries) {
    const result = await registeredSearch.handler({
      action: 'content',
      query: q.query,
      limit: TOP_K,
      format: 'compact',
    });
    const rankedPaths = result.isError
      ? []
      : (JSON.parse(result.content[0].text).results ?? []).map((r) => r.path);

    const scored = scoreQuery(rankedPaths, q.relevant_paths ?? []);
    perQuery.push({
      query: q.query,
      intent: q.intent,
      budget: q.budget,
      relevantPaths: q.relevant_paths ?? [],
      rankedTopK: scored.rankedTopK,
      ndcg: scored.ndcg,
      recall: scored.recall,
      mrr: scored.mrr,
    });
  }
  return perQuery;
}

/**
 * Scores `context assemble` bundles via the registered `context` tool: token
 * efficiency (tokens spent on labelled-relevant items / tokensUsed) and budget
 * adherence (tokensUsed <= the query's budget). Skipped for queries with no
 * `relevant_paths` label, and a no-op (empty array) when `context` is not
 * registered so older dist/ builds still run the search-only eval.
 */
async function scoreContextBundles(server, queries) {
  const registeredContext = server._registeredTools?.context;
  if (!registeredContext?.handler) {
    return [];
  }

  const perQuery = [];
  for (const q of queries) {
    if (!Array.isArray(q.relevant_paths) || q.relevant_paths.length === 0) {
      continue;
    }
    const budget = q.budget ?? 4000;
    const result = await registeredContext.handler({
      action: 'assemble',
      query: q.query,
      intent: q.intent,
      tokenBudget: budget,
    });

    if (result.isError) {
      perQuery.push({
        query: q.query,
        intent: q.intent,
        budget,
        tokensUsed: 0,
        relevantTokens: 0,
        tokenEfficiency: 0,
        budgetOk: true,
      });
      continue;
    }

    const bundle = JSON.parse(result.content[0].text);
    const relevantSet = new Set(q.relevant_paths);
    const relevantTokens = (bundle.items ?? [])
      .filter((item) => relevantSet.has(item.path))
      .reduce((sum, item) => sum + (item.tokens ?? 0), 0);
    const tokensUsed = bundle.tokensUsed ?? 0;
    const tokenEfficiency = tokensUsed > 0 ? relevantTokens / tokensUsed : 0;
    const budgetOk = tokensUsed <= budget;

    perQuery.push({
      query: q.query,
      intent: q.intent,
      budget,
      tokensUsed,
      relevantTokens,
      tokenEfficiency,
      budgetOk,
    });
  }
  return perQuery;
}

async function runEval() {
  assertDistBuilt([
    ['dist/config.js', distConfigPath],
    ['dist/tools/index.js', distToolsPath],
    ['dist/lib/vault-index.js', distVaultIndexPath],
  ]);

  const queries = await loadQueries();
  if (queries.length === 0) {
    throw new Error('tests/eval/queries.jsonl has no queries');
  }

  const { perQuery, bundlePerQuery } = await withEvalServer(async ({ server }) => ({
    perQuery: await scoreSearchQueries(server, queries),
    bundlePerQuery: await scoreContextBundles(server, queries),
  }));

  const overall = aggregate(perQuery);
  const intents = [...new Set(perQuery.map((q) => q.intent))].sort();
  const byIntent = intents.map((intent) => [
    intent,
    aggregate(perQuery.filter((q) => q.intent === intent)),
  ]);

  printScorecard(overall, byIntent);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    topK: TOP_K,
    overall,
    byIntent: Object.fromEntries(byIntent),
    queries: perQuery,
  };
  await fsp.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fsp.writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
  console.log(`\nWrote snapshot: ${path.relative(repoRoot, snapshotPath)}`);

  if (bundlePerQuery.length === 0) {
    console.warn('[WARN] context tool not registered or no labelled queries; skipped bundle metrics');
    return;
  }

  const bundleOverall = aggregateBundles(bundlePerQuery);
  const bundleIntents = [...new Set(bundlePerQuery.map((q) => q.intent))].sort();
  const bundleByIntent = bundleIntents.map((intent) => [
    intent,
    aggregateBundles(bundlePerQuery.filter((q) => q.intent === intent)),
  ]);

  printBundleScorecard(bundleOverall);

  const bundleSnapshot = {
    generatedAt: new Date().toISOString(),
    overall: bundleOverall,
    byIntent: Object.fromEntries(bundleByIntent),
    queries: bundlePerQuery,
  };
  await fsp.mkdir(path.dirname(bundleSnapshotPath), { recursive: true });
  await fsp.writeFile(bundleSnapshotPath, `${JSON.stringify(bundleSnapshot, null, 2)}\n`, 'utf-8');
  console.log(`Wrote bundle snapshot: ${path.relative(repoRoot, bundleSnapshotPath)}`);
}

/**
 * Sweeps RANK_WEIGHTS.expandedTokenMultiplier against the compiled ranker and prints
 * which value scores best on nDCG@10 without regressing MRR beyond MRR_REGRESSION_EPSILON.
 *
 * Pragmatic, minimally invasive design: `RANK_WEIGHTS` is a module-level exported
 * `const` object in dist/lib/search-ranking.js, so its own properties are still
 * mutable at runtime even though the binding cannot be reassigned. Mutating
 * `expandedTokenMultiplier` here affects every subsequent `scoreSearchCandidate`
 * call in this process (same cached ES module instance the search tool imports),
 * with no source edits and no persisted state. The original value is always
 * restored before this function returns.
 */
async function runSweep() {
  assertDistBuilt([
    ['dist/config.js', distConfigPath],
    ['dist/tools/index.js', distToolsPath],
    ['dist/lib/vault-index.js', distVaultIndexPath],
    ['dist/lib/search-ranking.js', distSearchRankingPath],
  ]);

  const queries = await loadQueries();
  if (queries.length === 0) {
    throw new Error('tests/eval/queries.jsonl has no queries');
  }

  const { RANK_WEIGHTS } = await importDist(distSearchRankingPath);
  const originalMultiplier = RANK_WEIGHTS.expandedTokenMultiplier;

  let results;
  try {
    results = await withEvalServer(async ({ server, clearAllSearchCaches }) => {
      const runs = [];
      for (const multiplier of SWEEP_EXPANDED_TOKEN_MULTIPLIERS) {
        RANK_WEIGHTS.expandedTokenMultiplier = multiplier;
        clearAllSearchCaches();
        const perQuery = await scoreSearchQueries(server, queries);
        runs.push({ expandedTokenMultiplier: multiplier, ...aggregate(perQuery) });
      }
      return runs;
    });
  } finally {
    RANK_WEIGHTS.expandedTokenMultiplier = originalMultiplier;
  }

  const baseline =
    results.find((r) => r.expandedTokenMultiplier === originalMultiplier) ?? results[0];
  const nonRegressing = results.filter(
    (r) => r.mrr >= baseline.mrr - MRR_REGRESSION_EPSILON && r.ndcg > baseline.ndcg + NDCG_IMPROVEMENT_EPSILON,
  );
  const best = [...nonRegressing].sort((a, b) => b.ndcg - a.ndcg)[0] ?? baseline;

  console.log(`\nWeight Sweep: expandedTokenMultiplier (current=${originalMultiplier})`);
  console.log('='.repeat(72));
  for (const r of results) {
    const tags = [
      r.expandedTokenMultiplier === originalMultiplier ? 'current' : null,
      r.expandedTokenMultiplier === best.expandedTokenMultiplier ? 'best' : null,
    ].filter(Boolean);
    const suffix = tags.length > 0 ? `  (${tags.join(', ')})` : '';
    console.log(
      `  expandedTokenMultiplier=${r.expandedTokenMultiplier.toFixed(2)}  nDCG@10=${formatScore(r.ndcg)}  Recall@10=${formatScore(r.recall)}  MRR=${formatScore(r.mrr)}${suffix}`,
    );
  }
  console.log('='.repeat(72));

  if (best.expandedTokenMultiplier === originalMultiplier) {
    console.log(`Current expandedTokenMultiplier=${originalMultiplier} remains best on nDCG@10 with no MRR regression.`);
  } else {
    console.log(
      `Candidate expandedTokenMultiplier=${best.expandedTokenMultiplier} improves nDCG@10 (${formatScore(best.ndcg)} vs current ${formatScore(baseline.ndcg)}) with no MRR regression (epsilon=${MRR_REGRESSION_EPSILON}). This script never edits source - update RANK_WEIGHTS.expandedTokenMultiplier in src/lib/search-ranking.ts deliberately if adopting, then rerun the full eval.`,
    );
  }
}

async function main() {
  const { reportOnly, gate, sweep } = parseArgs(process.argv.slice(2));

  if (sweep) {
    try {
      await runSweep();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[FAIL] eval sweep failed: ${message}`);
      process.exit(1);
    }
    return;
  }

  /** Soft gate epsilon: fail --gate when nDCG drops more than this vs gate-baseline.json. */
  const NDCG_EPSILON = 0.05;
  const gateBaselinePath = path.join(__dirname, 'snapshots', 'gate-baseline.json');

  try {
    let previousNdcg = null;
    if (gate && fs.existsSync(gateBaselinePath)) {
      const floor = JSON.parse(fs.readFileSync(gateBaselinePath, 'utf-8'));
      previousNdcg = Number(floor.overall?.ndcg ?? floor.ndcg);
    }

    await runEval();

    if (gate && previousNdcg !== null && Number.isFinite(previousNdcg)) {
      const latest = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      const latestNdcg = Number(latest.overall?.ndcg);
      if (!Number.isFinite(latestNdcg)) {
        throw new Error('Latest baseline missing overall.ndcg');
      }
      const drop = previousNdcg - latestNdcg;
      console.log(
        `\nEval gate: previous nDCG=${previousNdcg.toFixed(4)} latest=${latestNdcg.toFixed(4)} drop=${drop.toFixed(4)} (epsilon=${NDCG_EPSILON})`,
      );
      if (drop > NDCG_EPSILON) {
        throw new Error(
          `nDCG@10 regressed by ${drop.toFixed(4)} (more than epsilon ${NDCG_EPSILON}). Update tests/eval/snapshots/gate-baseline.json deliberately if this is intentional.`,
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (reportOnly) {
      console.warn(`[WARN] eval-report failed (report-only, not failing the build): ${message}`);
      process.exit(0);
    }
    console.error(`[FAIL] eval failed: ${message}`);
    process.exit(1);
  }
}

main();
