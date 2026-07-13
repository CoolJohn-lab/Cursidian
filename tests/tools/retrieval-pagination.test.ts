import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { registerSearch } from '../../src/tools/search.js';
import { registerGraph } from '../../src/tools/graph.js';
import { registerNote } from '../../src/tools/note.js';
import { registerVault } from '../../src/tools/vault.js';
import { encodeSignatureCursor } from '../../src/lib/pagination.js';
import {
  createTestContextAt,
  cleanupVault,
  callTool,
  parseResult,
  seedVault,
  writeNote,
} from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContextAt(
    await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-retrieval-')),
    { maxFileSize: 256 },
    (server, config) => {
      registerSearch(server, config);
      registerGraph(server, config);
      registerNote(server, config);
      registerVault(server, config);
    },
  );
  await seedVault(ctx.vault);
  await writeNote(ctx.vault, 'concepts/tiny.md', '# Tiny\n\nSmall note.\n');
  await writeNote(
    ctx.vault,
    'concepts/huge.md',
    `# Huge\n\n${'x'.repeat(400)}\n`,
  );
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('retrieval pagination and completeness', () => {
  it('search content paginates with truncated and nextCursor', async () => {
    const first = await callTool(ctx.client, 'search', {
      action: 'content',
      query: 'Project',
      limit: 1,
    });
    const page1 = parseResult(first) as {
      results: unknown[];
      truncated: boolean;
      nextCursor?: string;
      totalMatches: number;
      effectiveLimit: number;
    };
    expect(page1.totalMatches).toBeGreaterThan(1);
    expect(page1.results).toHaveLength(1);
    expect(page1.truncated).toBe(true);
    expect(page1.nextCursor).toBeTruthy();
    expect(page1.effectiveLimit).toBe(1);

    const second = await callTool(ctx.client, 'search', {
      action: 'content',
      query: 'Project',
      limit: 1,
      cursor: page1.nextCursor,
    });
    const page2 = parseResult(second) as { results: Array<{ path: string }> };
    expect(page2.results[0]?.path).not.toBe((page1.results[0] as { path: string }).path);
  });

  it('search by_tags paginates results', async () => {
    await writeNote(
      ctx.vault,
      'concepts/tag-a.md',
      '---\ntitle: Tag A\ntags: [pagination-test]\n---\n\nA\n',
    );
    await writeNote(
      ctx.vault,
      'concepts/tag-b.md',
      '---\ntitle: Tag B\ntags: [pagination-test]\n---\n\nB\n',
    );

    const first = await callTool(ctx.client, 'search', {
      action: 'by_tags',
      tags: ['pagination-test'],
      limit: 1,
    });
    const page1 = parseResult(first) as { truncated: boolean; nextCursor?: string; totalMatches: number };
    expect(page1.totalMatches).toBeGreaterThanOrEqual(2);
    expect(page1.truncated).toBe(true);

    const second = await callTool(ctx.client, 'search', {
      action: 'by_tags',
      tags: ['pagination-test'],
      limit: 1,
      cursor: page1.nextCursor,
    });
    expect(second.isError).toBeFalsy();
  });

  it('search list uses signature-bound cursors', async () => {
    const first = await callTool(ctx.client, 'search', { action: 'list', limit: 2 });
    const page1 = parseResult(first) as {
      truncated: boolean;
      nextCursor?: string;
      includeOperational: boolean;
      folder: string | null;
    };
    expect(page1.truncated).toBe(true);
    expect(page1.includeOperational).toBe(false);
    expect(page1.folder).toBeNull();

    const second = await callTool(ctx.client, 'search', {
      action: 'list',
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(second.isError).toBeFalsy();
  });

  it('search recent paginates and reports missing folder like list', async () => {
    const first = await callTool(ctx.client, 'search', { action: 'recent', limit: 2 });
    const page1 = parseResult(first) as { truncated: boolean; nextCursor?: string; effectiveLimit: number };
    expect(page1.effectiveLimit).toBe(2);

    const missing = await callTool(ctx.client, 'search', {
      action: 'recent',
      folder: 'missing-folder-xyz',
    });
    expect(missing.isError).toBe(true);
    const errData = parseResult(missing) as { error: string };
    expect(errData.error).toBe('not_found');
  });

  it('surfaces skipped files as incomplete in search content', async () => {
    const result = await callTool(ctx.client, 'search', { action: 'content', query: 'Tiny' });
    const data = parseResult(result) as {
      incomplete: boolean;
      skipped: Array<{ path: string; reason: string }>;
    };
    expect(data.incomplete).toBe(true);
    expect(data.skipped.some((entry) => entry.path.includes('huge.md'))).toBe(true);
  });

  it('vault health reports skipped files and incomplete scan', async () => {
    const result = await callTool(ctx.client, 'vault', { action: 'health' });
    const data = parseResult(result) as {
      incomplete: boolean;
      skipped: Array<{ path: string }>;
      counts: { skipped: number };
    };
    expect(data.incomplete).toBe(true);
    expect(data.counts.skipped).toBeGreaterThan(0);
    expect(data.skipped.some((entry) => entry.path.includes('huge.md'))).toBe(true);
  });

  it('rejects stale cursor after vault mutation', async () => {
    const listed = await callTool(ctx.client, 'search', { action: 'list', limit: 1 });
    const { nextCursor } = parseResult(listed) as { nextCursor: string };

    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'cursor-invalidation.md',
      content: '# Invalidate\n',
      overwrite: true,
    });

    const stale = await callTool(ctx.client, 'search', {
      action: 'list',
      limit: 1,
      cursor: nextCursor,
    });
    expect(stale.isError).toBe(true);
    const errData = parseResult(stale) as {
      error: string;
      recovery?: { arguments: Record<string, unknown> };
      details?: {
        changedPathCount?: number;
        changedPaths?: Array<{ path: string; change: string }>;
      };
    };
    expect(errData.error).toBe('invalid_args');
    expect(errData.recovery?.arguments.action).toBe('list');
    expect(errData.recovery?.arguments.cursor).toBeUndefined();
    expect(errData.details?.changedPathCount).toBeGreaterThanOrEqual(1);
    expect(
      errData.details?.changedPaths?.some(
        (entry) => entry.path === 'cursor-invalidation.md' && entry.change === 'added',
      ),
    ).toBe(true);
  });

  it('graph returns unresolved outgoing links and paginated backlinks', async () => {
    await writeNote(
      ctx.vault,
      'concepts/broken-out.md',
      '---\ntitle: Broken Out\n---\n\nSee [[missing-neighbor]] and [[concepts/tiny]].\n',
    );
    await writeNote(
      ctx.vault,
      'concepts/backlink-1.md',
      '---\ntitle: BL1\n---\n\nLink [[concepts/broken-out]].\n',
    );
    await writeNote(
      ctx.vault,
      'concepts/backlink-2.md',
      '---\ntitle: BL2\n---\n\nAlso [[concepts/broken-out]].\n',
    );

    const result = await callTool(ctx.client, 'graph', {
      path: 'concepts/broken-out',
      limit: 1,
    });
    const data = parseResult(result) as {
      unresolvedOutgoingLinks: Array<{ raw: string }>;
      truncated: boolean;
      nextCursor?: string;
      backlinkCount: number;
    };
    expect(data.unresolvedOutgoingLinks.some((link) => link.raw === 'missing-neighbor')).toBe(true);
    expect(data.backlinkCount).toBeGreaterThanOrEqual(2);
    expect(data.truncated).toBe(true);
    expect(data.nextCursor).toBeTruthy();
  });

  it('graph backlink cache invalidates after writes', async () => {
    await writeNote(
      ctx.vault,
      'concepts/cache-target.md',
      '---\ntitle: Cache Target\n---\n\nTarget body.\n',
    );

    const before = await callTool(ctx.client, 'graph', { path: 'concepts/cache-target' });
    const beforeData = parseResult(before) as { backlinkCount: number };

    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'concepts/cache-linker.md',
      content: '---\ntitle: Cache Linker\n---\n\nPoints to [[concepts/cache-target]].\n',
      overwrite: true,
    });

    const after = await callTool(ctx.client, 'graph', { path: 'concepts/cache-target' });
    const afterData = parseResult(after) as { backlinkCount: number };
    expect(afterData.backlinkCount).toBeGreaterThan(beforeData.backlinkCount);
  });

  it('rejects manually forged stale cursor', async () => {
    const forged = encodeSignatureCursor('deadbeef', 'concepts/tiny.md');
    const result = await callTool(ctx.client, 'search', {
      action: 'content',
      query: 'Tiny',
      cursor: forged,
    });
    expect(result.isError).toBe(true);
  });
});
