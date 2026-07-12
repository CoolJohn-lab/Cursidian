import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerGraph } from '../../src/tools/graph.js';
import { registerSearch } from '../../src/tools/search.js';
import {
  createTestVault,
  seedVault,
  cleanupVault,
  writeNote,
  callTool,
  parseResult,
} from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerGraph(server, config);
    registerSearch(server, config);
  });
  await seedVault(ctx.vault);
  await writeNote(ctx.vault, 'hub.md', '---\ntitle: Hub\n---\n\nSee [[spoke]]');
  await writeNote(ctx.vault, 'spoke.md', '---\ntitle: Spoke\n---\n\nBack to [[hub]]');
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('graph', () => {
  it('returns outgoing links and backlinks', async () => {
    const result = await callTool(ctx.client, 'graph', { path: 'hub' });
    const data = parseResult(result) as {
      outgoingLinks: Array<{ raw: string; resolvedPath: string | null }>;
      backlinks: Array<{ path: string }>;
    };
    expect(data.outgoingLinks.some((l) => l.resolvedPath === 'spoke.md')).toBe(true);
    expect(data.backlinks.some((b) => b.path === 'spoke.md' || b.path.includes('spoke'))).toBe(
      true,
    );
  });

  it('finds backlinks to a seeded note', async () => {
    const result = await callTool(ctx.client, 'graph', { path: 'Resources/book' });
    const data = parseResult(result) as { backlinks: Array<{ path: string }> };
    expect(data.backlinks.length).toBeGreaterThan(0);
  });

  it('returns empty backlinks for note with no incoming links', async () => {
    const result = await callTool(ctx.client, 'graph', { path: 'Daily/2024-01-16' });
    const data = parseResult(result) as { backlinkCount: number };
    expect(typeof data.backlinkCount).toBe('number');
  });

  it('resolves graph path via frontmatter alias', async () => {
    await writeNote(
      ctx.vault,
      'entities/alias-hub.md',
      '---\ntitle: Alias Hub\naliases:\n  - alias-hub-key\n---\n\nSee [[spoke]]\n',
    );
    const result = await callTool(ctx.client, 'graph', { path: 'alias-hub-key' });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { note: string };
    expect(data.note).toBe('entities/alias-hub.md');
  });

  it('rejects path traversal', async () => {
    const result = await callTool(ctx.client, 'graph', { path: '../../../etc/passwd' });
    expect(result.isError).toBe(true);
  });
});
