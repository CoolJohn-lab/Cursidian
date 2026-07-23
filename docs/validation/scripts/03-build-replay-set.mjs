#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseNotePath } from './lib/transcript-parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CORPUS = path.join(REPO_ROOT, 'docs/validation/corpus/mcp-calls-30d.jsonl');
const CHAINS = path.join(REPO_ROOT, 'docs/validation/corpus/search-read-chains.json');
const OUT = path.join(REPO_ROOT, 'docs/validation/corpus/replay-set.json');

/**
 * Builds deduplicated replay matrix from search->read chains and standalone searches.
 */
async function main() {
  const corpus = (await fs.readFile(CORPUS, 'utf-8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  let chains = [];
  try {
    chains = JSON.parse(await fs.readFile(CHAINS, 'utf-8'));
  } catch {
    // built inline if missing
    for (let i = 0; i < corpus.length - 1; i++) {
      const cur = corpus[i];
      const next = corpus[i + 1];
      if (cur.toolName !== 'search_content' || next.toolName !== 'read_note') continue;
      if (cur.sessionId !== next.sessionId) continue;
      chains.push({
        sessionId: cur.sessionId,
        query: cur.arguments.query,
        goldenPath: normaliseNotePath(next.arguments.path),
        limit: cur.arguments.limit ?? 50,
      });
    }
  }

  const seen = new Set();
  const replaySet = [];

  for (const chain of chains) {
    const key = `${chain.query}::${chain.goldenPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    replaySet.push({
      id: `sr-${replaySet.length + 1}`,
      query: chain.query,
      limit: chain.limit ?? 30,
      goldenPath: chain.goldenPath,
      sourceSession: chain.sessionId,
      labelType: 'search_then_read',
    });
  }

  // Add high-value standalone searches from corpus (deduped by query)
  const searchQueries = new Map();
  for (const call of corpus) {
    if (call.toolName !== 'search_content') continue;
    const q = call.arguments.query?.trim();
    if (!q || searchQueries.has(q)) continue;
    searchQueries.set(q, call);
  }

  for (const [query, call] of searchQueries) {
    if (replaySet.some((r) => r.query === query)) continue;
    replaySet.push({
      id: `sq-${replaySet.length + 1}`,
      query,
      limit: call.arguments.limit ?? 30,
      goldenPath: null,
      sourceSession: call.sessionId,
      labelType: 'search_only',
    });
  }

  const labelled = replaySet.filter((r) => r.goldenPath);
  const output = {
    generatedAt: new Date().toISOString(),
    totalCases: replaySet.length,
    labelledCases: labelled.length,
    unlabelledCases: replaySet.length - labelled.length,
    cases: replaySet,
  };

  await fs.writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');
  console.log(
    `Replay set: ${replaySet.length} cases (${labelled.length} with golden labels) → ${OUT}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
