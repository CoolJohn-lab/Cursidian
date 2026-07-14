export async function runWikiQuerySuite(ctx) {
  const { createTestServer, callTool, parseResult, runCase } = ctx;
  const { server } = createTestServer();
  const results = [];

  results.push(
    await runCase('bootstrap hot.md', async () => {
      parseResult(await callTool(server, 'read_note', { path: 'hot' }));
    }, ctx),
  );

  results.push(
    await runCase('bootstrap index.md', async () => {
      const data = parseResult(await callTool(server, 'read_note', { path: 'index' }));
      if (!data.outgoingLinks?.length) throw new Error('index should expose outgoing links');
    }, ctx),
  );

  results.push(
    await runCase('bootstrap project hub', async () => {
      parseResult(
        await callTool(server, 'read_note', { path: 'projects/data-platform-dlz/data-platform-dlz' }),
      );
    }, ctx),
  );

  // Intent pages only — never the project hub (hub is bootstrap, not ranking golden).
  const queries = [
    {
      query: 'ADF pipeline orchestrator',
      expectTopPath: 'projects/data-platform-dlz/concepts/orchestration-and-adf',
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

  for (const { query, expectTopPath } of queries) {
    results.push(
      await runCase(`wiki-query search: ${query}`, async () => {
        const data = parseResult(await callTool(server, 'search_content', { query, limit: 5 }));
        if (data.results.length === 0) throw new Error('no results');
        const topPath = data.results[0].path.replace(/\.md$/i, '').toLowerCase();
        const expected = expectTopPath.toLowerCase();
        if (!topPath.includes(expected)) {
          throw new Error(`top hit ${data.results[0].path} expected ${expectTopPath}`);
        }
        if ((data.results[0].relevanceScore ?? 0) <= 0) {
          throw new Error('top result has zero relevance');
        }
      }, ctx),
    );
  }

  results.push(
    await runCase('relationship query via backlinks', async () => {
      const data = parseResult(
        await callTool(server, 'get_backlinks', {
          path: 'projects/data-platform-dlz/concepts/orchestration-and-adf',
        }),
      );
      if (data.backlinkCount < 1) throw new Error('expected backlinks to orchestration page');
    }, ctx),
  );

  results.push(
    await runCase('tier-2 list_notes project folder', async () => {
      const data = parseResult(
        await callTool(server, 'list_notes', { folder: 'projects/data-platform-dlz/concepts' }),
      );
      if (data.notes.length < 5) throw new Error('expected multiple concept pages');
    }, ctx),
  );

  return results;
}
