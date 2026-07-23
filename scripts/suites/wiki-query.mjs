import { assertTopSearchPath, resolveExpectTopPaths } from './corpus-search.mjs';

export async function runWikiQuerySuite(ctx) {
  const { createTestServer, callTool, parseResult, runCase } = ctx;
  const { server } = await createTestServer();
  const results = [];

  results.push(
    await runCase(
      'bootstrap index.md',
      async () => {
        const data = parseResult(await callTool(server, 'note', { action: 'read', path: 'index' }));
        if (!data.outgoingLinks?.length) throw new Error('index should expose outgoing links');
      },
      ctx,
    ),
  );

  results.push(
    await runCase(
      'bootstrap project hub',
      async () => {
        parseResult(
          await callTool(server, 'note', {
            action: 'read',
            path: 'projects/data-platform-dlz/data-platform-dlz',
          }),
        );
      },
      ctx,
    ),
  );

  // Intent pages only - never the project hub (hub is bootstrap, not ranking golden).
  const queries = [
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
      query: 'FactPublicHoliday',
      expectTopPath: 'projects/data-platform-dlz/entities/factpublicholiday',
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
      query: 'office coverage Dublin Bratislava',
      expectTopPath: 'projects/data-platform-dlz/entities/factpublicholiday',
    },
    {
      query: 'public holiday BigHand',
      expectTopPath: 'projects/data-platform-dlz/entities/factpublicholiday',
    },
  ];

  for (const testCase of queries) {
    results.push(
      await runCase(
        `wiki-query search: ${testCase.query}`,
        async () => {
          const data = parseResult(
            await callTool(server, 'search', { action: 'content', query: testCase.query, limit: 5 }),
          );
          if (data.results.length === 0) throw new Error('no results');
          assertTopSearchPath(data.results, resolveExpectTopPaths(testCase));
          if ((data.results[0].relevanceScore ?? 0) <= 0) {
            throw new Error('top result has zero relevance');
          }
        },
        ctx,
      ),
    );
  }

  results.push(
    await runCase(
      'relationship query via graph backlinks',
      async () => {
        const data = parseResult(
          await callTool(server, 'graph', {
            path: 'projects/data-platform-dlz/concepts/orchestration-and-adf',
          }),
        );
        if ((data.backlinkCount ?? data.backlinks?.length ?? 0) < 1) {
          throw new Error('expected backlinks to orchestration page');
        }
      },
      ctx,
    ),
  );

  results.push(
    await runCase(
      'tier-2 search list project folder',
      async () => {
        const data = parseResult(
          await callTool(server, 'search', {
            action: 'list',
            folder: 'projects/data-platform-dlz/concepts',
          }),
        );
        if (data.notes.length < 5) throw new Error('expected multiple concept pages');
      },
      ctx,
    ),
  );

  return results;
}
