#!/usr/bin/env node
/**
 * Runs the retrieval eval (tests/eval/eval.mjs) and turns its JSON snapshot into a
 * committed markdown scorecard (nDCG@10, Recall@10, MRR, overall and by intent).
 * Also folds in context bundle metrics (token efficiency, budget adherence) from
 * snapshots/bundle-baseline.json when that file was produced by the same run.
 *
 * Requires `npm run build` to have produced dist/ (eval.mjs runs against the
 * compiled ranker, matching what actually ships). Fails loudly on eval failure
 * unless --report-only is passed, matching eval.mjs's own convention.
 *
 * Usage:
 *   node scripts/eval-report.mjs
 *   node scripts/eval-report.mjs --report-only
 */
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const evalScript = path.join(repoRoot, 'tests', 'eval', 'eval.mjs');
const snapshotPath = path.join(repoRoot, 'tests', 'eval', 'snapshots', 'baseline.json');
const bundleSnapshotPath = path.join(repoRoot, 'tests', 'eval', 'snapshots', 'bundle-baseline.json');
const scorecardPath = path.join(repoRoot, 'tests', 'eval', 'snapshots', 'scorecard.md');

function parseArgs(argv) {
  return { reportOnly: argv.includes('--report-only') };
}

function formatScore(value) {
  return typeof value === 'number' ? value.toFixed(3) : 'n/a';
}

function renderScorecard(snapshot, bundleSnapshot) {
  const lines = [];
  lines.push('# Retrieval Eval Scorecard');
  lines.push('');
  lines.push(
    `Generated ${snapshot.generatedAt} from \`tests/eval/golden-vault\` (top-${snapshot.topK}, n=${snapshot.overall.n} queries).`,
  );
  lines.push('');
  lines.push('Regenerate with `npm run eval:report` (after `npm run build`). This file is committed so score trend is visible across commits - diff it like any other file.');
  lines.push('');
  lines.push('## Overall');
  lines.push('');
  lines.push('| Metric | Score |');
  lines.push('|---|---|');
  lines.push(`| nDCG@${snapshot.topK} | ${formatScore(snapshot.overall.ndcg)} |`);
  lines.push(`| Recall@${snapshot.topK} | ${formatScore(snapshot.overall.recall)} |`);
  lines.push(`| MRR | ${formatScore(snapshot.overall.mrr)} |`);
  lines.push('');
  lines.push('## By intent');
  lines.push('');
  lines.push('| Intent | n | nDCG@10 | Recall@10 | MRR |');
  lines.push('|---|---|---|---|---|');
  for (const [intent, stats] of Object.entries(snapshot.byIntent ?? {})) {
    lines.push(`| ${intent} | ${stats.n} | ${formatScore(stats.ndcg)} | ${formatScore(stats.recall)} | ${formatScore(stats.mrr)} |`);
  }
  lines.push('');

  if (bundleSnapshot) {
    lines.push('## Context bundle metrics');
    lines.push('');
    lines.push(
      `From \`context assemble\` (n=${bundleSnapshot.overall.n} labelled queries; skips queries with no \`relevant_paths\`).`,
    );
    lines.push('');
    lines.push('| Metric | Score |');
    lines.push('|---|---|');
    lines.push(`| Token efficiency (relevant tokens / tokensUsed) | ${formatScore(bundleSnapshot.overall.avgTokenEfficiency)} |`);
    lines.push(`| Budget adherence (tokensUsed <= budget) | ${formatScore(bundleSnapshot.overall.budgetAdherenceRate)} |`);
    lines.push('');
    lines.push('| Intent | n | Token efficiency | Budget adherence |');
    lines.push('|---|---|---|---|');
    for (const [intent, stats] of Object.entries(bundleSnapshot.byIntent ?? {})) {
      lines.push(`| ${intent} | ${stats.n} | ${formatScore(stats.avgTokenEfficiency)} | ${formatScore(stats.budgetAdherenceRate)} |`);
    }
    lines.push('');
  }

  lines.push('## Maintaining this scorecard');
  lines.push('');
  lines.push(
    'When a real query returns a bad bundle, add it to `tests/eval/queries.jsonl` with the correct `relevant_paths` (see CONTRIBUTING.md), then re-run `npm run eval:report`. Bumping `tests/eval/snapshots/baseline.json` (the gate reference) is a deliberate, separately reviewed commit - see `npm run eval -- --gate`.',
  );
  lines.push('');
  lines.push(
    'Use `npm run eval -- --sweep` to check whether a different `RANK_WEIGHTS.expandedTokenMultiplier` scores better on nDCG@10 without regressing MRR; it prints a recommendation only and never edits source or writes a snapshot.',
  );
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const { reportOnly } = parseArgs(process.argv.slice(2));

  console.log('> eval-report: running npm run eval to refresh the snapshot');
  const result = spawnSync(process.execPath, [evalScript, ...(reportOnly ? ['--report-only'] : [])], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    if (reportOnly) {
      console.warn('[WARN] eval-report: eval run failed (report-only, not failing)');
      return;
    }
    console.error('[FAIL] eval-report: eval run failed');
    process.exit(result.status ?? 1);
  }

  if (!fs.existsSync(snapshotPath)) {
    const message = `eval-report: no snapshot at ${path.relative(repoRoot, snapshotPath)} after running eval`;
    if (reportOnly) {
      console.warn(`[WARN] ${message}`);
      return;
    }
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }

  const snapshot = JSON.parse(await fsp.readFile(snapshotPath, 'utf-8'));
  const bundleSnapshot = fs.existsSync(bundleSnapshotPath)
    ? JSON.parse(await fsp.readFile(bundleSnapshotPath, 'utf-8'))
    : null;
  const markdown = renderScorecard(snapshot, bundleSnapshot);
  await fsp.writeFile(scorecardPath, markdown, 'utf-8');
  console.log(`\nWrote scorecard: ${path.relative(repoRoot, scorecardPath)}`);
}

main();
