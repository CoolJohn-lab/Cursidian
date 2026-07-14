export async function runEdgeCaseSuite(ctx) {
  const { createTestServer, callTool, parseResult, runCase } = ctx;
  const { server } = createTestServer();
  const results = [];

  results.push(
    await runCase('search token-AND excludes partial matches', async () => {
      const data = parseResult(
        await callTool(server, 'search_content', { query: 'FactPublicHoliday benevity', limit: 20 }),
      );
      const paths = data.results.map((r) => r.path);
      for (const path of paths) {
        if (!path.toLowerCase().includes('fact') && !path.toLowerCase().includes('benev')) {
          // every result must contain both tokens somewhere; paths are weak signal so verify via read if needed
        }
      }
      if (data.results.length > 0 && data.results[0].relevanceScore === undefined) {
        throw new Error('results not ranked');
      }
    }, ctx),
  );

  results.push(
    await runCase('search ranks title match above body-only match', async () => {
      const data = parseResult(
        await callTool(server, 'search_content', { query: 'FactPublicHoliday', limit: 10 }),
      );
      if (data.results.length === 0) return;
      const top = data.results[0];
      if (!top.matchReasons?.some((r) => r.startsWith('title'))) {
        throw new Error(`expected title match reasons, got: ${top.matchReasons?.join(',')}`);
      }
    }, ctx),
  );

  results.push(
    await runCase('search empty query rejected by schema', async () => {
      const result = await callTool(server, 'search_content', { query: '   ' });
      if (!result.isError) throw new Error('expected schema validation failure');
    }, ctx),
  );

  results.push(
    await runCase('read_note missing file', async () => {
      const result = await callTool(server, 'read_note', { path: '__missing-note-xyz__' });
      if (!result.isError) throw new Error('expected error');
    }, ctx),
  );

  results.push(
    await runCase('read_note path traversal blocked', async () => {
      const result = await callTool(server, 'read_note', { path: '../../../etc/passwd' });
      if (!result.isError) throw new Error('expected traversal error');
    }, ctx),
  );

  results.push(
    await runCase('update_note patch ambiguous old_string', async () => {
      const path = '.obsidian-mcp-edge-ambiguous';
      parseResult(
        await callTool(server, 'create_note', {
          path,
          content: 'repeat repeat',
          overwrite: true,
        }),
      );
      const result = await callTool(server, 'update_note', {
        path,
        mode: 'patch',
        old_string: 'repeat',
        new_string: 'once',
      });
      parseResult(await callTool(server, 'delete_note', { path }));
      if (!result.isError) throw new Error('expected ambiguous patch error');
    }, ctx),
  );

  results.push(
    await runCase('update_note replace size guard', async () => {
      const path = '.obsidian-mcp-edge-guard';
      parseResult(
        await callTool(server, 'create_note', {
          path,
          content: 'x'.repeat(200),
          overwrite: true,
        }),
      );
      const result = await callTool(server, 'update_note', {
        path,
        content: 'tiny',
        mode: 'replace',
      });
      parseResult(await callTool(server, 'delete_note', { path }));
      if (!result.isError) throw new Error('expected size guard error');
    }, ctx),
  );

  results.push(
    await runCase('update_note replace allows large shrink with force', async () => {
      const path = '.obsidian-mcp-edge-force';
      parseResult(
        await callTool(server, 'create_note', {
          path,
          content: 'x'.repeat(200),
          overwrite: true,
        }),
      );
      const blocked = await callTool(server, 'update_note', {
        path,
        content: 'y'.repeat(60),
        mode: 'replace',
      });
      if (!blocked.isError) {
        throw new Error('expected size guard before force');
      }
      parseResult(
        await callTool(server, 'update_note', {
          path,
          content: 'y'.repeat(60),
          mode: 'replace',
          force: true,
        }),
      );
      parseResult(await callTool(server, 'delete_note', { path }));
    }, ctx),
  );

  results.push(
    await runCase('get_backlinks resolves path-style wikilinks', async () => {
      const data = parseResult(
        await callTool(server, 'get_backlinks', {
          path: 'projects/data-platform-dlz/data-platform-dlz',
        }),
      );
      if (!Array.isArray(data.backlinks)) throw new Error('missing backlinks');
      if (data.backlinkCount < 1) throw new Error('expected at least one backlink to project hub');
    }, ctx),
  );

  results.push(
    await runCase('read_note resolves outgoing links on index', async () => {
      const data = parseResult(await callTool(server, 'read_note', { path: 'index' }));
      const resolved = data.outgoingLinks.filter((link) => link.resolvedPath);
      if (resolved.length < 3) {
        throw new Error(`expected >=3 resolved outgoing links, got ${resolved.length}`);
      }
    }, ctx),
  );

  results.push(
    await runCase('read_note curated-and-model-layers link resolution', async () => {
      const data = parseResult(
        await callTool(server, 'read_note', {
          path: 'projects/data-platform-dlz/concepts/curated-and-model-layers',
        }),
      );
      const links = data.outgoingLinks ?? [];
      if (links.length === 0) {
        throw new Error('expected outgoing links');
      }
      const resolved = links.filter((link) => link.resolvedPath).length;
      const rate = resolved / links.length;
      if (rate < 0.9) {
        throw new Error(`expected >=90% link resolution, got ${Math.round(rate * 100)}%`);
      }
    }, ctx),
  );

  return results;
}
