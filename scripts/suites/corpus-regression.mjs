import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCorpusSearchSuite } from './corpus-search.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SEARCH_RESULTS_PATH = path.join(
  REPO_ROOT,
  'docs/validation/corpus/search-replay-results.json',
);

/**
 * Validates corpus replay JSON has zero search regressions vs old-patched.
 */
export async function runCorpusRegressionSuite(ctx) {
  const corpusResults = await runCorpusSearchSuite(ctx);
  const results = [...corpusResults];

  results.push(
    await ctx.runCase(
      'corpus replay: newWorseThanPatched is empty',
      async () => {
        let raw;
        try {
          raw = await fs.readFile(SEARCH_RESULTS_PATH, 'utf-8');
        } catch {
          throw new Error(
            `missing ${SEARCH_RESULTS_PATH}; run docs/validation/scripts/replay-transcript-calls.mjs first`,
          );
        }
        const payload = JSON.parse(raw);
        const regressions = payload.summary?.newWorseThanPatched ?? [];
        if (regressions.length > 0) {
          const summary = regressions
            .slice(0, 5)
            .map((r) => `${r.query} (patched ${r.patchedRank}, new ${r.newRank ?? '—'})`)
            .join('; ');
          throw new Error(`${regressions.length} regressions: ${summary}`);
        }
      },
      ctx,
    ),
  );

  return results;
}
