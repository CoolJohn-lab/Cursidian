import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerSearch } from '../../src/tools/search.js';
import {
  createTestVault,
  cleanupVault,
  writeNote,
  callTool,
  parseResult,
} from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault();
  await writeNote(ctx.vault, 'n1.md', '---\ntags: [shared, n1]\n---\n\n# N1');
  await writeNote(ctx.vault, 'n2.md', '---\ntags: [shared, n2]\n---\n\n# N2');
  await writeNote(ctx.vault, 'n3.md', '---\ntags: [other]\n---\n\n# N3');
  registerSearch(ctx.server, ctx.config);
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('search (by_tags)', () => {
  it('finds notes matching all tags', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'by_tags', tags: ['shared'], limit: 2 });
    const data = parseResult(result) as { results: unknown[] };
    expect(data.results.length).toBe(2);
  });

  it('ANDs multiple tags', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'by_tags', tags: ['shared', 'n1'] });
    const data = parseResult(result) as { results: Array<{ path: string }> };
    expect(data.results.length).toBe(1);
    expect(data.results[0].path).toContain('n1');
  });
});
