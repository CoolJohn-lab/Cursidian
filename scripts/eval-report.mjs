#!/usr/bin/env node
/**
 * Runs the golden-vault eval and writes a markdown scorecard snapshot.
 *
 * Usage:
 *   node scripts/eval-report.mjs
 *   npm run eval:report
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanNpmEnv, resolveSpawn } from './clean-npm-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const baselinePath = path.join(repoRoot, 'tests/eval/snapshots/baseline.json');
const scorecardPath = path.join(repoRoot, 'tests/eval/snapshots/scorecard.md');

const spawn = resolveSpawn('npm', ['run', 'eval']);
const result = spawnSync(spawn.command, spawn.args, {
  stdio: 'inherit',
  env: cleanNpmEnv(),
  shell: spawn.shell,
  cwd: repoRoot,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(baselinePath)) {
  console.error(`Missing baseline after eval: ${baselinePath}`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const generatedAt = new Date().toISOString();
const lines = [
  '# Retrieval eval scorecard',
  '',
  `Generated: ${generatedAt}`,
  '',
  '| Metric | Value |',
  '| --- | --- |',
  `| nDCG@10 | ${Number(baseline.overall?.ndcg ?? 0).toFixed(4)} |`,
  `| Recall@10 | ${Number(baseline.overall?.recall ?? 0).toFixed(4)} |`,
  `| MRR | ${Number(baseline.overall?.mrr ?? 0).toFixed(4)} |`,
  `| Queries | ${baseline.overall?.n ?? '?'} |`,
  '',
  'Source: `tests/eval/snapshots/baseline.json` (from `npm run eval`).',
  '',
];

fs.mkdirSync(path.dirname(scorecardPath), { recursive: true });
fs.writeFileSync(scorecardPath, lines.join('\n'), 'utf8');
console.log(`Wrote ${path.relative(repoRoot, scorecardPath)}`);
