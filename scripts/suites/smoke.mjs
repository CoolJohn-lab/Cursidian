export async function runSmokeSuite(ctx) {
  const { createTestServer, callTool, parseResult, runCase } = ctx;
  const { server } = createTestServer();
  const smokePath = '_cursidian-smoke-test';
  let contentHash;
  const results = [];

  results.push(
    await runCase('search list', async () => {
      const data = parseResult(await callTool(server, 'search', { action: 'list' }));
      if (!Array.isArray(data.notes)) throw new Error('missing notes');
    }, ctx),
  );

  results.push(
    await runCase('note create', async () => {
      parseResult(
        await callTool(server, 'note', {
          action: 'create',
          path: smokePath,
          content: '# Smoke test\n\nInitial body for MCP smoke test.',
          frontmatter: { tags: ['mcp-smoke'] },
          overwrite: true,
        }),
      );
    }, ctx),
  );

  results.push(
    await runCase('search content ranked', async () => {
      const data = parseResult(
        await callTool(server, 'search', { action: 'content', query: 'smoke test', limit: 5 }),
      );
      if (!data.results?.[0]?.relevanceScore && data.results?.[0]?.relevanceScore !== 0) {
        throw new Error('missing relevanceScore');
      }
    }, ctx),
  );

  results.push(
    await runCase('search by_tags', async () => {
      const data = parseResult(
        await callTool(server, 'search', { action: 'by_tags', tags: ['mcp-smoke'] }),
      );
      if (!Array.isArray(data.results)) throw new Error('missing results');
      if (data.totalMatches < 1) throw new Error('expected mcp-smoke match');
    }, ctx),
  );

  results.push(
    await runCase('search tags', async () => {
      const data = parseResult(await callTool(server, 'search', { action: 'tags' }));
      if (!Array.isArray(data.tags)) throw new Error('missing tags');
    }, ctx),
  );

  results.push(
    await runCase('note read outgoingLinks', async () => {
      const data = parseResult(await callTool(server, 'note', { action: 'read', path: smokePath }));
      if (!data.contentHash) throw new Error('missing contentHash');
      if (!Array.isArray(data.outgoingLinks)) throw new Error('missing outgoingLinks');
      contentHash = data.contentHash;
    }, ctx),
  );

  results.push(
    await runCase('note update patch', async () => {
      parseResult(
        await callTool(server, 'note', {
          action: 'update',
          path: smokePath,
          mode: 'patch',
          old_string: 'Initial body',
          new_string: 'Patched body',
          expectedHash: contentHash,
        }),
      );
    }, ctx),
  );

  results.push(
    await runCase('graph neighborhood', async () => {
      const data = parseResult(await callTool(server, 'graph', { path: smokePath }));
      if (!Array.isArray(data.outgoingLinks) || !Array.isArray(data.backlinks)) {
        throw new Error('missing neighborhood fields');
      }
    }, ctx),
  );

  results.push(
    await runCase('note delete cleanup', async () => {
      parseResult(await callTool(server, 'note', { action: 'delete', path: smokePath, confirm: true }));
    }, ctx),
  );

  return results;
}
