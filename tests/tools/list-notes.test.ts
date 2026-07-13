import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { registerSearch } from '../../src/tools/search.js';
import {
  createTestVault,
  seedVault,
  cleanupVault,
  callTool,
  parseResult,
  writeNote,
} from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerSearch(server, config);
  });
  await seedVault(ctx.vault);
  await writeNote(ctx.vault, 'log.md', '# Log\n');
  await writeNote(ctx.vault, 'hot.md', '# Hot\n');
  await writeNote(ctx.vault, '_raw/draft.md', '# Draft\n');
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('search (list)', () => {
  it('lists all notes', async () => {
    const result = await callTool(ctx.client, 'search', { action: 'list' });
    const data = parseResult(result) as { count: number };
    expect(data.count).toBeGreaterThan(0);
  });

  it('excludes operational files by default', async () => {
    const result = await callTool(ctx.client, 'search', { action: 'list' });
    const data = parseResult(result) as { notes: Array<{ path: string }> };
    const paths = data.notes.map((n) => n.path.replace(/\\/g, '/'));
    expect(paths).not.toContain('index.md');
    expect(paths).not.toContain('log.md');
    expect(paths).not.toContain('hot.md');
    expect(paths.some((p) => p.startsWith('_raw/'))).toBe(false);
  });

  it('includes operational files when includeOperational is true', async () => {
    const result = await callTool(ctx.client, 'search', {
      action: 'list',
      includeOperational: true,
    });
    const data = parseResult(result) as { notes: Array<{ path: string }> };
    const paths = data.notes.map((n) => n.path.replace(/\\/g, '/'));
    expect(paths).toContain('index.md');
    expect(paths).toContain('log.md');
    expect(paths).toContain('hot.md');
    expect(paths).toContain('_raw/draft.md');
  });

  it('returns not_found for a nonexistent folder', async () => {
    const result = await callTool(ctx.client, 'search', {
      action: 'list',
      folder: 'nonexistent-folder-xyz',
    });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toBe('not_found');
  });

  it('returns empty success for an empty existing folder', async () => {
    await mkdir(`${ctx.vault}/EmptyFolder`, { recursive: true });
    const result = await callTool(ctx.client, 'search', {
      action: 'list',
      folder: 'EmptyFolder',
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { count: number; notes: unknown[] };
    expect(data.count).toBe(0);
    expect(data.notes).toEqual([]);
  });

  it('filters by folder', async () => {
    const result = await callTool(ctx.client, 'search', { action: 'list', folder: 'Daily' });
    const data = parseResult(result) as { notes: Array<{ path: string }> };
    expect(data.notes.every((n) => n.path.startsWith('Daily'))).toBe(true);
  });

  it('supports non-recursive listing', async () => {
    const result = await callTool(ctx.client, 'search', { action: 'list', recursive: false });
    expect(result.isError).toBeFalsy();
  });

  it('lists note paths with forward slashes', async () => {
    const result = await callTool(ctx.client, 'search', { action: 'list', folder: 'Daily' });
    const data = parseResult(result) as { notes: Array<{ path: string }> };
    expect(data.notes.length).toBeGreaterThan(0);
    expect(data.notes.every((n) => !n.path.includes('\\'))).toBe(true);
  });

  it('rejects path traversal in folder', async () => {
    const result = await callTool(ctx.client, 'search', { action: 'list', folder: '../../etc' });
    expect(result.isError).toBe(true);
  });
});
