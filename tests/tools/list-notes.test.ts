import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerSearch } from '../../src/tools/search.js';
import { createTestVault, seedVault, cleanupVault, callTool, parseResult } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault();
  await seedVault(ctx.vault);
  registerSearch(ctx.server, ctx.config);
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('search (list)', () => {
  it('lists all notes', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'list' });
    const data = parseResult(result) as { count: number };
    expect(data.count).toBeGreaterThan(0);
  });

  it('filters by folder', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'list', folder: 'Daily' });
    const data = parseResult(result) as { notes: Array<{ path: string }> };
    expect(data.notes.every((n) => n.path.startsWith('Daily'))).toBe(true);
  });

  it('supports non-recursive listing', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'list', recursive: false });
    expect(result.isError).toBeFalsy();
  });

  it('lists note paths with forward slashes', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'list', folder: 'Daily' });
    const data = parseResult(result) as { notes: Array<{ path: string }> };
    expect(data.notes.length).toBeGreaterThan(0);
    expect(data.notes.every((n) => !n.path.includes('\\'))).toBe(true);
  });

  it('rejects path traversal in folder', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'list', folder: '../../etc' });
    expect(result.isError).toBe(true);
  });
});
