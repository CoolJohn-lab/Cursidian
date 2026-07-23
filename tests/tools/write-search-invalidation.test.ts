import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerNote } from '../../src/tools/note.js';
import { registerSearch } from '../../src/tools/search.js';
import { registerVault } from '../../src/tools/vault.js';
import { clearAllSearchCaches } from '../../src/lib/vault-index.js';
import { createTestVault, seedVault, cleanupVault, callTool, parseResult } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerNote(server, config);
    registerSearch(server, config);
    registerVault(server, config);
  });
  await seedVault(ctx.vault);
});

afterAll(async () => {
  clearAllSearchCaches();
  await cleanupVault(ctx.vault);
});

describe('write -> search cache invalidation', () => {
  it('note create is immediately findable via search content', async () => {
    await callTool(ctx.client, 'search', { action: 'content', query: 'Project A', limit: 5 });

    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'cache-create-visible.md',
      content: '# Cache Create\n\nunique-create-token-xyzzy',
      overwrite: true,
    });

    const data = parseResult(
      await callTool(ctx.client, 'search', {
        action: 'content',
        query: 'unique-create-token-xyzzy',
        limit: 10,
      }),
    ) as { results: Array<{ path: string }> };

    expect(data.results.map((r) => r.path)).toContain('cache-create-visible.md');
  });

  it('note update patch is immediately findable via search content', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'cache-patch-visible.md',
      content: '# Cache Patch\n\nbefore-patch-token',
      overwrite: true,
    });

    await callTool(ctx.client, 'search', {
      action: 'content',
      query: 'before-patch-token',
      limit: 5,
    });

    const read = parseResult(
      await callTool(ctx.client, 'note', { action: 'read', path: 'cache-patch-visible.md' }),
    ) as { contentHash: string };

    await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'cache-patch-visible.md',
      mode: 'patch',
      old_string: 'before-patch-token',
      new_string: 'after-patch-token-unique',
      expectedHash: read.contentHash,
    });

    const data = parseResult(
      await callTool(ctx.client, 'search', {
        action: 'content',
        query: 'after-patch-token-unique',
        limit: 10,
      }),
    ) as { results: Array<{ path: string }> };

    expect(data.results.map((r) => r.path)).toContain('cache-patch-visible.md');
  });

  it('note delete removes the note from search content immediately', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'cache-delete-visible.md',
      content: '# Cache Delete\n\nunique-delete-token-plugh',
      overwrite: true,
    });

    await callTool(ctx.client, 'search', {
      action: 'content',
      query: 'unique-delete-token-plugh',
      limit: 5,
    });

    await callTool(ctx.client, 'note', {
      action: 'delete',
      path: 'cache-delete-visible.md',
      confirm: true,
    });

    const data = parseResult(
      await callTool(ctx.client, 'search', {
        action: 'content',
        query: 'unique-delete-token-plugh',
        limit: 10,
      }),
    ) as { results: Array<{ path: string }> };

    expect(data.results.map((r) => r.path)).not.toContain('cache-delete-visible.md');
  });

  it('note frontmatter tag changes are immediately searchable via tags filter', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'cache-fm-visible.md',
      content: '# Cache Frontmatter\n\nbody for frontmatter cache test',
      frontmatter: { tags: ['pre-fm-tag'] },
      overwrite: true,
    });

    await callTool(ctx.client, 'search', {
      action: 'content',
      query: 'frontmatter cache test',
      tags: ['pre-fm-tag'],
      limit: 5,
    });

    await callTool(ctx.client, 'note', {
      action: 'frontmatter',
      path: 'cache-fm-visible.md',
      fmOperation: 'merge',
      frontmatter: { tags: ['post-fm-tag-unique'] },
    });

    const data = parseResult(
      await callTool(ctx.client, 'search', {
        action: 'content',
        query: 'frontmatter cache test',
        tags: ['post-fm-tag-unique'],
        limit: 10,
      }),
    ) as { results: Array<{ path: string }> };

    expect(data.results.map((r) => r.path)).toContain('cache-fm-visible.md');
  });
});
