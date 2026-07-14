#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseNotePath } from './lib/transcript-parser.mjs';
import {
  searchUpstream,
  searchPatched,
  searchNew,
  top1Path,
} from './lib/search-baselines.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const REPLAY = path.join(REPO_ROOT, 'docs/validation/corpus/replay-set.json');
const VAULT =
  process.env.OBSIDIAN_VAULT_PATH ??
  '/Users/jeddowes/Library/CloudStorage/OneDrive-Freshfields/Obsidian/WorkStuff';

const BASELINES = ['upstream', 'patched', 'new'];

/**
 * Scores whether top-1 search result matches the golden read path.
 */
function scoreTop1(goldenPath, actualTop1) {
  if (!goldenPath) return { scored: false, hit: null };
  const normGolden = normaliseNotePath(goldenPath);
  const normActual = normaliseNotePath(actualTop1);
  const hit = normActual === normGolden;
  return { scored: true, hit };
}

/**
 * Replays search queries against all three baselines.
 */
async function main() {
  const replay = JSON.parse(await fs.readFile(REPLAY, 'utf-8'));
  const labelled = replay.cases.filter((c) => c.goldenPath);
  const results = { upstream: [], patched: [], new: [] };

  for (const testCase of labelled) {
    const { query, limit, goldenPath, id } = testCase;
    const opts = { limit: limit ?? 30 };

    const upstream = await searchUpstream(VAULT, query, opts);
    const patched = await searchPatched(VAULT, query, opts);
    const newest = await searchNew(REPO_ROOT, query, opts);

    for (const [name, payload] of [
      ['upstream', upstream],
      ['patched', patched],
      ['new', newest],
    ]) {
      const top1 = top1Path(payload);
      const { hit } = scoreTop1(goldenPath, top1);
      results[name].push({
        id,
        query,
        goldenPath,
        top1,
        totalMatches: payload.totalMatches,
        hit,
      });
    }
  }

  const summary = {};
  for (const baseline of BASELINES) {
    const rows = results[baseline];
    const hits = rows.filter((r) => r.hit).length;
    summary[baseline] = {
      labelledCases: rows.length,
      top1Hits: hits,
      top1Accuracy: rows.length ? Math.round((hits / rows.length) * 1000) / 10 : 0,
      zeroResultQueries: rows.filter((r) => r.totalMatches === 0).map((r) => r.query),
    };
  }

  const outPath = path.join(REPO_ROOT, 'docs/validation/results/replay-results.json');
  await fs.writeFile(
    outPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, results }, null, 2)}\n`,
    'utf-8',
  );

  console.log('Replay summary:', JSON.stringify(summary, null, 2));
  console.log(`Details → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
