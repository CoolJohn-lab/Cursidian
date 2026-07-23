import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankSearchResults } from '../../src/lib/search-ranking.js';
import { RANKING_GOLDEN_CASES } from '../fixtures/ranking-golden-cases.js';

/**
 * Golden-regression test for `scoreSearchCandidate` (Part A item 6 of the MCP hardening
 * plan). `tests/fixtures/ranking-golden.json` was captured from the pre-decomposition
 * implementation via `scripts/generate-ranking-golden.mjs`; this test re-scores the exact
 * same fixed inputs and asserts byte-for-byte identical scores and match reasons, so the
 * `scoreSearchCandidate` decomposition into named sub-scorers cannot silently change
 * ranking weights, order, or behaviour.
 *
 * Only regenerate the fixture (and review the diff) when a ranking change is intentional.
 */

interface GoldenEntry {
  path: string;
  relevanceScore: number;
  matchReasons: string[];
}

interface GoldenCase {
  name: string;
  query: string;
  results: GoldenEntry[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'ranking-golden.json');
const golden: GoldenCase[] = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('scoreSearchCandidate golden regression', () => {
  it('fixture covers exactly the defined golden cases (same names, same order)', () => {
    expect(golden.map((g) => g.name)).toEqual(RANKING_GOLDEN_CASES.map((c) => c.name));
  });

  for (const goldenCase of golden) {
    it(`matches recorded scores and match reasons for "${goldenCase.name}"`, () => {
      const testCase = RANKING_GOLDEN_CASES.find((c) => c.name === goldenCase.name);
      expect(testCase).toBeDefined();

      const ranked = rankSearchResults(
        testCase!.candidates,
        testCase!.query,
        testCase!.caseSensitive,
        testCase!.index,
        testCase!.options,
      );
      const actual: GoldenEntry[] = ranked.map((r) => ({
        path: r.path,
        relevanceScore: r.relevanceScore,
        matchReasons: r.matchReasons,
      }));

      expect(actual).toEqual(goldenCase.results);
    });
  }
});
