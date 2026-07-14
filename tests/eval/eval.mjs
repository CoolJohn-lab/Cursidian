#!/usr/bin/env node
/**
 * Retrieval quality eval for the golden CDF-flavoured vault.
 *
 * Exercises the real `search` MCP tool (action=content) end to end against
 * tests/eval/golden-vault and scores the ranked results with nDCG@10,
 * Recall@10, and MRR against the labelled queries in tests/eval/queries.jsonl.
 *
 * This imports the compiled dist/ output (dist/config.js, dist/tools/index.js)
 * rather than src/, so the ranking logic under test matches what actually
 * ships. Run `npm run build` before `npm run eval` if dist/ is missing or
 * stale.
 *
 * Usage:
 *   node tests/eval/eval.mjs [--report-only]
 *
 * --report-only: never exits non-zero, even on a hard setup failure. Used by
 * the non-blocking eval-report step in scripts/run-verify-inner.mjs.
 */
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const goldenVaultDir = path.join(__dirname, 'golden-vault');
const queriesPath = path.join(__dirname, 'queries.jsonl');
const snapshotPath = path.join(__dirname, 'snapshots', 'baseline.json');
const distConfigPath = path.join(repoRoot, 'dist', 'config.js');
const distToolsPath = path.join(repoRoot, 'dist', 'tools', 'index.js');
const distVaultIndexPath = path.join(repoRoot, 'dist', 'lib', 'vault-index.js');

const TOP_K = 10;

function parseArgs(argv) {
  return {
    reportOnly: argv.includes('--report-only'),
    gate: argv.includes('--gate'),
  };
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
  return value.toFixed(3);
}

function aggregate(entries) {
  return {
    n: entries.length,
    ndcg: average(entries.map((q) => q.ndcg)),
    recall: average(entries.map((q) => q.recall)),
    mrr: average(entries.map((q) => q.mrr)),
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

async function runEval() {
  for (const [label, distPath] of [
    ['dist/config.js', distConfigPath],
    ['dist/tools/index.js', distToolsPath],
    ['dist/lib/vault-index.js', distVaultIndexPath],
  ]) {
    if (!fs.existsSync(distPath)) {
      throw new Error(`Missing ${label}. Run "npm run build" before "npm run eval".`);
    }
  }

  const { loadConfig } = await import(distConfigPath);
  const { registerAllTools } = await import(distToolsPath);
  const { clearAllSearchCaches } = await import(distVaultIndexPath);

  const queries = await loadQueries();
  if (queries.length === 0) {
    throw new Error('tests/eval/queries.jsonl has no queries');
  }

  const vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-eval-'));
  const priorVault = process.env.OBSIDIAN_VAULT_PATH;
  const priorBackup = process.env.OBSIDIAN_BACKUP_ENABLED;
  const priorLogLevel = process.env.OBSIDIAN_LOG_LEVEL;

  const perQuery = [];

  try {
    await copyDir(goldenVaultDir, vault);
    process.env.OBSIDIAN_VAULT_PATH = vault;
    process.env.OBSIDIAN_BACKUP_ENABLED = 'false';
    process.env.OBSIDIAN_LOG_LEVEL = 'error';
    clearAllSearchCaches();

    const config = loadConfig();
    const server = new McpServer({ name: 'cursidian-eval', version: '0.0.0' });
    registerAllTools(server, config);

    const registeredSearch = server._registeredTools?.search;
    if (!registeredSearch?.handler) {
      throw new Error('search tool did not register (unexpected dist/tools/index.js shape)');
    }

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
}

async function main() {
  const { reportOnly, gate } = parseArgs(process.argv.slice(2));
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
