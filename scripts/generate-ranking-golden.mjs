#!/usr/bin/env node
/**
 * Regenerates `tests/fixtures/ranking-golden.json` - the golden-regression fixture for
 * `scoreSearchCandidate` (Part A item 6 of the MCP hardening plan).
 *
 * Scores the fixed inputs from `tests/fixtures/ranking-golden-cases.ts` with the current
 * `rankSearchResults` implementation and records path -> { relevanceScore, matchReasons }
 * for every candidate. `tests/lib/search-ranking-golden.test.ts` re-runs the same cases and
 * asserts an exact match, so any future change to ranking weights/order/behaviour fails loudly.
 *
 * Only re-run this deliberately (and review the diff) when a ranking change is intentional:
 *
 *   npx tsx scripts/generate-ranking-golden.mjs
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankSearchResults } from '../src/lib/search-ranking.ts';
import { RANKING_GOLDEN_CASES } from '../tests/fixtures/ranking-golden-cases.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'tests', 'fixtures', 'ranking-golden.json');

function main() {
  const golden = RANKING_GOLDEN_CASES.map((testCase) => {
    const ranked = rankSearchResults(
      testCase.candidates,
      testCase.query,
      testCase.caseSensitive,
      testCase.index,
      testCase.options,
    );
    return {
      name: testCase.name,
      query: testCase.query,
      results: ranked.map((r) => ({
        path: r.path,
        relevanceScore: r.relevanceScore,
        matchReasons: r.matchReasons,
      })),
    };
  });

  return fsp.writeFile(outPath, `${JSON.stringify(golden, null, 2)}\n`, 'utf8');
}

await main();
console.log(`Wrote ${RANKING_GOLDEN_CASES.length} golden ranking case(s) to ${outPath}`);
