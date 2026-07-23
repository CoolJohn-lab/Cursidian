/**
 * Curated search cases with strict expected top-1 paths.
 *
 * Ranking goldens must be intent pages (entity / concept / skill that answers the query).
 * Project hub paths (e.g. data-platform-dlz.md) are invalid here - hubs are for session
 * bootstrap, not ranking quality. Historical hub goldens in replay-matrix.json are
 * transcript archaeology and must not be copied into this suite.
 */
export const CURATED_SEARCH_CASES = [
  {
    query: 'FactPublicHoliday',
    expectTopPath: 'projects/data-platform-dlz/entities/factpublicholiday',
  },
  {
    query: 'bighand',
    expectTopPath: 'projects/data-platform-dlz/concepts/bighand-data-product',
  },
  {
    query: 'ADF pipeline orchestrator',
    expectTopPaths: [
      'projects/data-platform-dlz/concepts/orchestration-and-adf',
      'projects/data-platform-dlz/concepts/adf-pipeline-catalog',
    ],
  },
  {
    query: 'deployment CI CD',
    expectTopPath: 'projects/data-platform-dlz/skills/deployment-and-ci-cd',
  },
  {
    query: 'Unity Catalog metastore',
    expectTopPath: 'projects/data-platform-dlz/concepts/metastore-schema-evolution',
  },
  {
    query: 'bighand FactPublicHoliday public holidays',
    expectTopPath: 'projects/data-platform-dlz/entities/factpublicholiday',
  },
  {
    query: 'office coverage Dublin Bratislava',
    expectTopPath: 'projects/data-platform-dlz/entities/factpublicholiday',
  },
  {
    query: 'public holiday BigHand',
    expectTopPath: 'projects/data-platform-dlz/entities/factpublicholiday',
  },
];

/**
 * Regression cases from validation newWorseThanPatched set.
 */
export const REGRESSION_SEARCH_CASES = [
  {
    query: 'FactPersonCalendar person date calendar',
    expectTopPath: 'projects/data-platform-dlz/entities/factpersoncalendar',
  },
  {
    query: 'FactPerson naming',
    expectTopPath: 'projects/data-platform-dlz/concepts/dlz-naming-and-schema-conventions',
  },
  {
    query: 'medallion',
    expectTopPath: 'projects/data-platform-dlz/concepts/curation-pipeline',
  },
  {
    query: 'ADF debug mode',
    expectTopPath: 'projects/data-platform-dlz/skills/adf-debug-mode-monitoring',
  },
  {
    // Either the product hub or the API ingest notebooks page is a reasonable top hit.
    query: 'BigHand integration ingest',
    expectTopPaths: [
      'projects/data-platform-dlz/concepts/bighand-data-product',
      'projects/data-platform-dlz/concepts/api-ingestion-notebooks',
    ],
  },
  {
    query: 'curated',
    expectTopPath: 'projects/data-platform-dlz/concepts/curation-pipeline',
  },
  {
    query: 'factpersoncalendar',
    expectTopPath: 'projects/data-platform-dlz/entities/factpersoncalendar',
  },
  {
    query: 'ingestion pipeline deployment',
    expectTopPaths: [
      'projects/data-platform-dlz/skills/deployment-and-ci-cd',
      'projects/data-platform-dlz/concepts/ingestion-schedules-and-timeouts',
    ],
  },
  {
    query: 'public holidays API',
    expectTopPath: 'projects/data-platform-dlz/entities/factpublicholiday',
  },
  {
    query: 'public holidays',
    expectTopPath: 'projects/data-platform-dlz/entities/factpublicholiday',
  },
  {
    query: 'Benevity',
    expectTopPath: 'projects/data-platform-dlz/concepts/benevity-integration',
  },
];

/**
 * Additional intent golden paths for replay queries not in the curated/regression sets.
 */
const EXTRA_INTENT_GOLDEN_PATHS = {
  'data contract deploy metadata':
    'projects/data-platform-dlz/concepts/data-contracts-and-metadata',
  'person calendar': 'projects/data-platform-dlz/entities/factpersoncalendar',
  'metadata transformation unity catalog': 'projects/data-platform-dlz/skills/deployment-and-ci-cd',
};

/**
 * Resolves acceptable top-path goldens for a curated/regression case.
 */
export function resolveExpectTopPaths(testCase) {
  if (Array.isArray(testCase.expectTopPaths) && testCase.expectTopPaths.length > 0) {
    return testCase.expectTopPaths;
  }
  if (testCase.expectTopPath) {
    return [testCase.expectTopPath];
  }
  return [];
}

/**
 * Builds a map of query -> primary intent page path for replay golden-label overrides.
 */
export function buildIntentGoldenMap() {
  const map = new Map();
  for (const testCase of [...CURATED_SEARCH_CASES, ...REGRESSION_SEARCH_CASES]) {
    const paths = resolveExpectTopPaths(testCase);
    if (paths.length > 0) {
      // Replay uses the first listed path as the preferred intent label.
      map.set(testCase.query.toLowerCase(), paths[0]);
    }
  }
  for (const [query, path] of Object.entries(EXTRA_INTENT_GOLDEN_PATHS)) {
    map.set(query.toLowerCase(), path);
  }
  return map;
}

/**
 * Normalises a vault path for comparison.
 */
export function normaliseSearchPath(notePath) {
  return String(notePath).replace(/\.md$/i, '').replace(/\\/g, '/').toLowerCase();
}

/**
 * Returns true when a hit path matches any acceptable golden path prefix.
 */
function pathMatchesAnyExpected(hitPath, expectTopPaths) {
  const top = normaliseSearchPath(hitPath);
  return expectTopPaths.some((expectTopPath) => {
    const expected = normaliseSearchPath(expectTopPath);
    return top.includes(expected) || expected.includes(top);
  });
}

/**
 * Asserts the top search hit matches one of the expected path prefixes.
 */
export function assertTopSearchPath(results, expectTopPathOrPaths) {
  if (!results.length) {
    throw new Error('no search results');
  }
  const expectTopPaths = Array.isArray(expectTopPathOrPaths)
    ? expectTopPathOrPaths
    : [expectTopPathOrPaths];
  if (!pathMatchesAnyExpected(results[0].path, expectTopPaths)) {
    throw new Error(`top hit ${results[0].path} expected one of ${expectTopPaths.join(' | ')}`);
  }
}

export async function runCorpusSearchSuite(ctx) {
  const { createTestServer, callTool, parseResult, runCase, resetCaches } = ctx;
  const { server } = await createTestServer();
  const results = [];

  for (const testCase of [...CURATED_SEARCH_CASES, ...REGRESSION_SEARCH_CASES]) {
    results.push(
      await runCase(
        `corpus-search: ${testCase.query}`,
        async () => {
          resetCaches();
          const data = parseResult(
            await callTool(server, 'search', {
              action: 'content',
              query: testCase.query,
              limit: 20,
            }),
          );
          // Accept any listed golden when a query has more than one reasonable top hit.
          assertTopSearchPath(data.results, resolveExpectTopPaths(testCase));
          if ((data.results[0].relevanceScore ?? 0) <= 0) {
            throw new Error('top result has zero relevance');
          }
        },
        ctx,
      ),
    );
  }

  return results;
}
