import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerSearch } from '../../src/tools/search.js';
import {
  createTestVault,
  seedVault,
  cleanupVault,
  callTool,
  parseResult,
} from './helpers.js';
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

describe('search (tags)', () => {
  it('lists tags with counts', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'tags' });
    const data = parseResult(result) as { totalTags: number; tags: Array<{ tag: string; count: number }> };
    expect(data.totalTags).toBeGreaterThan(0);
    expect(data.tags.length).toBeGreaterThan(0);
  });
});
