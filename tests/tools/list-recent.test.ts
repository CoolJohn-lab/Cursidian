import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  ctx = await createTestVault();
  await seedVault(ctx.vault);
  // Write operational files last so they are newest by mtime
  await writeNote(ctx.vault, 'log.md', '# Log\n');
  await writeNote(ctx.vault, 'hot.md', '# Hot\n');
  await writeNote(ctx.vault, 'index.md', '# Index\n');
  registerSearch(ctx.server, ctx.config);
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('search (recent)', () => {
  it('returns recently modified notes', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'recent' });
    const data = parseResult(result) as { notes: Array<{ mtime: string }> };
    expect(data.notes.length).toBeGreaterThan(0);
    for (let i = 1; i < data.notes.length; i++) {
      expect(new Date(data.notes[i - 1].mtime).getTime()).toBeGreaterThanOrEqual(
        new Date(data.notes[i].mtime).getTime(),
      );
    }
  });

  it('excludes operational files by default even when newest', async () => {
    const result = await callTool(ctx.server, 'search', {
      action: 'recent',
      includeOperational: false,
      limit: 20,
    });
    const data = parseResult(result) as { notes: Array<{ path: string }> };
    const paths = data.notes.map((n) => n.path.replace(/\\/g, '/'));
    expect(paths).not.toContain('index.md');
    expect(paths).not.toContain('log.md');
    expect(paths).not.toContain('hot.md');
  });

  it('includes operational files when includeOperational is true', async () => {
    const result = await callTool(ctx.server, 'search', {
      action: 'recent',
      includeOperational: true,
      limit: 20,
    });
    const data = parseResult(result) as { notes: Array<{ path: string }> };
    const paths = data.notes.map((n) => n.path.replace(/\\/g, '/'));
    expect(paths).toContain('index.md');
    expect(paths).toContain('log.md');
    expect(paths).toContain('hot.md');
  });

  it('respects limit', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'recent', limit: 2 });
    const data = parseResult(result) as { notes: unknown[] };
    expect(data.notes.length).toBeLessThanOrEqual(2);
  });

  it('filters by folder', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'recent', folder: 'Daily' });
    const data = parseResult(result) as { notes: Array<{ path: string }> };
    expect(data.notes.every((n) => n.path.startsWith('Daily'))).toBe(true);
  });
});
