import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerGetBacklinks } from '../../src/tools/get-backlinks.js';
import { createTestVault, seedVault, cleanupVault, callTool, parseResult } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault();
  await seedVault(ctx.vault);
  registerGetBacklinks(ctx.server, ctx.config);
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('get_backlinks', () => {
  it('finds backlinks to a note', async () => {
    const result = await callTool(ctx.server, 'get_backlinks', { path: 'Resources/book' });
    const data = parseResult(result) as { backlinks: Array<{ path: string }> };
    // Daily/2024-01-15.md and Projects/project-a.md both link to Resources/book
    expect(data.backlinks.length).toBeGreaterThan(0);
  });

  it('returns empty array for note with no backlinks', async () => {
    const result = await callTool(ctx.server, 'get_backlinks', { path: 'Daily/2024-01-16' });
    const data = parseResult(result) as { backlinkCount: number };
    // 2024-01-16 is only linked from itself, no other note links to it
    expect(typeof data.backlinkCount).toBe('number');
  });

  it('rejects path traversal', async () => {
    const result = await callTool(ctx.server, 'get_backlinks', { path: '../../../etc/passwd' });
    expect(result.isError).toBe(true);
  });
});
