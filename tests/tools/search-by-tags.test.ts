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
  ctx = await createTestVault((server, config) => {
    registerSearch(server, config);
  });
  await writeNote(ctx.vault, 'n1.md', '---\ntags: [shared, n1]\n---\n\n# N1');
  await writeNote(ctx.vault, 'n2.md', '---\ntags: [shared, n2]\n---\n\n# N2');
  await writeNote(ctx.vault, 'n3.md', '---\ntags: [other]\n---\n\n# N3');
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('search (by_tags)', () => {
  it('finds notes matching all tags', async () => {
    const result = await callTool(ctx.client, 'search', { action: 'by_tags', tags: ['shared'], limit: 2 });
    const data = parseResult(result) as { results: unknown[] };
    expect(data.results.length).toBe(2);
  });

  it('ANDs multiple tags', async () => {
    const result = await callTool(ctx.client, 'search', { action: 'by_tags', tags: ['shared', 'n1'] });
    const data = parseResult(result) as { results: Array<{ path: string }> };
    expect(data.results.length).toBe(1);
    expect(data.results[0].path).toContain('n1');
  });

  it('rejects an empty tags array with invalid_args', async () => {
    const result = await callTool(ctx.client, 'search', { action: 'by_tags', tags: [] });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as {
      error: string;
      details?: { missing?: string[] };
      recovery?: { tool: string; arguments: Record<string, unknown> };
    };
    expect(data.error).toBe('invalid_args');
    expect(data.details?.missing).toContain('tags');
    expect(data.recovery?.tool).toBe('search');
  });

  it('rejects whitespace-only tag strings with invalid_args', async () => {
    const result = await callTool(ctx.client, 'search', {
      action: 'by_tags',
      tags: ['shared', '   '],
    });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as {
      error: string;
      details?: { rejected?: string[] };
      recovery?: { arguments: { tags?: string[] } };
    };
    expect(data.error).toBe('invalid_args');
    expect(data.details?.rejected).toContain('tags');
    expect(data.recovery?.arguments.tags).toEqual(['shared']);
  });

  it('returns an empty result set for a tag that matches nothing', async () => {
    const result = await callTool(ctx.client, 'search', {
      action: 'by_tags',
      tags: ['does-not-exist-anywhere'],
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as {
      results: unknown[];
      totalMatches: number;
      truncated: boolean;
      nextCursor?: string;
    };
    expect(data.results).toEqual([]);
    expect(data.totalMatches).toBe(0);
    expect(data.truncated).toBe(false);
    expect(data.nextCursor).toBeUndefined();
  });

  it('paginates matching notes with limit=1 across every page', async () => {
    await writeNote(ctx.vault, 'concepts/page-a.md', '---\ntags: [pageable]\n---\n\nA');
    await writeNote(ctx.vault, 'concepts/page-b.md', '---\ntags: [pageable]\n---\n\nB');
    await writeNote(ctx.vault, 'concepts/page-c.md', '---\ntags: [pageable]\n---\n\nC');

    const seenPaths = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;

    for (let i = 0; i < 10; i++) {
      const result = await callTool(ctx.client, 'search', {
        action: 'by_tags',
        tags: ['pageable'],
        limit: 1,
        cursor,
      });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as {
        results: Array<{ path: string }>;
        totalMatches: number;
        truncated: boolean;
        nextCursor?: string;
        effectiveLimit: number;
      };
      expect(data.effectiveLimit).toBe(1);
      expect(data.totalMatches).toBe(3);
      expect(data.results).toHaveLength(1);
      seenPaths.add(data.results[0].path);
      pages += 1;

      if (!data.truncated) {
        expect(data.nextCursor).toBeUndefined();
        break;
      }
      expect(data.nextCursor).toBeTruthy();
      cursor = data.nextCursor;
    }

    expect(pages).toBe(3);
    expect(seenPaths).toEqual(
      new Set(['concepts/page-a.md', 'concepts/page-b.md', 'concepts/page-c.md']),
    );
  });

  it('reports a structured error for a stale or forged cursor', async () => {
    const result = await callTool(ctx.client, 'search', {
      action: 'by_tags',
      tags: ['shared'],
      cursor: 'not-a-real-cursor',
    });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string; retryable?: boolean };
    expect(data.error).toBe('invalid_args');
    expect(data.retryable).toBe(true);
  });

  it('excludes operational pages (index/_raw) even when tagged', async () => {
    const tag = 'operational-exclusion-test';
    await writeNote(ctx.vault, 'index.md', `---\ntags: [${tag}]\n---\n\n# Index`);
    await writeNote(ctx.vault, 'concepts/regular.md', `---\ntags: [${tag}]\n---\n\n# Regular`);

    const result = await callTool(ctx.client, 'search', { action: 'by_tags', tags: [tag] });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as {
      results: Array<{ path: string }>;
      totalMatches: number;
      includeOperational: boolean;
    };
    expect(data.includeOperational).toBe(false);
    expect(data.totalMatches).toBe(1);
    expect(data.results).toHaveLength(1);
    expect(data.results[0].path).toBe('concepts/regular.md');
    expect(data.results.some((r) => r.path === 'index.md' || r.path.startsWith('_raw/'))).toBe(
      false,
    );
  });
});
