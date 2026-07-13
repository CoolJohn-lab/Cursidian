import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { registerNote } from '../../src/tools/note.js';
import { registerSearch } from '../../src/tools/search.js';
import { registerVault } from '../../src/tools/vault.js';
import { createTestContextAt, cleanupVault, callTool, parseResult } from '../tools/helpers.js';
import type { TestContext } from '../tools/helpers.js';

/**
 * Executable MCP contract fixtures aligned with skills/wiki/TESTING.md:
 * allowed sequences, zero-write modes, structured recovery, reverse-order undo,
 * and post-write verification.
 */
describe('MCP skill contracts', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContextAt(
      await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-contracts-')),
      { backupEnabled: true },
      (server, config) => {
        registerNote(server, config);
        registerSearch(server, config);
        registerVault(server, config);
      },
    );
  });

  afterAll(async () => {
    await cleanupVault(ctx.vault);
  });

  it('wiki-query zero-write sequence: search then read, no mutations', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'concepts/alpha',
      content: '# Alpha\n\nAlpha concept.',
      frontmatter: { title: 'Alpha', tags: ['concept'], summary: 'Alpha page' },
    });

    const listed = await callTool(ctx.client, 'search', { action: 'list' });
    expect(listed.isError).toBeFalsy();

    const searched = await callTool(ctx.client, 'search', {
      action: 'content',
      query: 'Alpha',
      format: 'compact',
      limit: 10,
    });
    expect(searched.isError).toBeFalsy();
    const hits = parseResult(searched) as { truncated?: boolean; nextCursor?: string };
    if (hits.truncated && hits.nextCursor) {
      const page2 = await callTool(ctx.client, 'search', {
        action: 'content',
        query: 'Alpha',
        format: 'compact',
        cursor: hits.nextCursor,
      });
      expect(page2.isError).toBeFalsy();
    }

    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'concepts/alpha' });
    expect(read.isError).toBeFalsy();
    const body = parseResult(read) as { revisionHash?: string };
    expect(body.revisionHash).toBeTruthy();

    // Zero-write mode must not touch log/hot via vault log.
    const before = await fsp
      .readFile(path.join(ctx.vault, 'log.md'), 'utf8')
      .catch(() => null);
    expect(before).toBeNull();
  });

  it('structured recovery on invalid_args and hash_mismatch', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'concepts/beta',
      content: '# Beta\n\nBody.',
    });

    const invalid = await callTool(ctx.client, 'note', {
      action: 'read',
      path: 'concepts/beta',
      mode: 'patch',
    });
    expect(invalid.isError).toBeTruthy();
    const invalidPayload = JSON.parse(invalid.content[0].text) as {
      error: string;
      code?: string;
      recovery?: { tool: string; arguments: Record<string, unknown> };
    };
    expect(invalidPayload.error).toBe('invalid_args');
    expect(invalidPayload.recovery?.tool).toBe('note');
    expect(invalidPayload.recovery?.arguments?.action).toBe('read');

    const read = parseResult(
      await callTool(ctx.client, 'note', { action: 'read', path: 'concepts/beta' }),
    ) as { revisionHash: string };

    const mismatch = await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'concepts/beta',
      mode: 'append',
      content: '\nx',
      expectedRevision: 'not-a-real-revision',
    });
    expect(mismatch.isError).toBeTruthy();
    const mismatchPayload = JSON.parse(mismatch.content[0].text) as {
      error: string;
      retryable?: boolean;
      recovery?: { tool: string };
    };
    expect(mismatchPayload.error).toBe('hash_mismatch');
    expect(mismatchPayload.retryable).toBe(true);
    expect(mismatchPayload.recovery?.tool).toBe('note');
    expect(read.revisionHash).toBeTruthy();
    const mismatchDetails = mismatchPayload as {
      details?: { conflictKind?: string; currentRevision?: string };
    };
    expect(mismatchDetails.details?.conflictKind).toBe('revision');
    expect(mismatchDetails.details?.currentRevision).toBe(read.revisionHash);
  });

  it('reverse-order undo restores vault after multi-step writes', async () => {
    const opStack: string[] = [];

    const created = parseResult(
      await callTool(ctx.client, 'note', {
        action: 'create',
        path: 'concepts/gamma',
        content: '# Gamma\nv1',
      }),
    ) as { operationId: string };
    opStack.push(created.operationId);

    const read = parseResult(
      await callTool(ctx.client, 'note', { action: 'read', path: 'concepts/gamma' }),
    ) as { revisionHash: string };

    const updated = parseResult(
      await callTool(ctx.client, 'note', {
        action: 'update',
        path: 'concepts/gamma',
        mode: 'replace',
        content: '# Gamma\nv2',
        expectedRevision: read.revisionHash,
      }),
    ) as { operationId: string };
    opStack.push(updated.operationId);

    const manifest = parseResult(
      await callTool(ctx.client, 'vault', {
        action: 'manifest',
        manifestOperation: 'upsert_source',
        sourceKey: 'C:/contracts/source.md',
        sourceIngested: new Date().toISOString(),
        sourcePages: ['concepts/gamma'],
      }),
    ) as { operationId: string };
    opStack.push(manifest.operationId);

    while (opStack.length > 0) {
      const operationId = opStack.pop()!;
      const undone = await callTool(ctx.client, 'vault', {
        action: 'undo',
        operationId,
        confirm: true,
      });
      expect(undone.isError).toBeFalsy();
    }

    const exists = await fsp
      .access(path.join(ctx.vault, 'concepts', 'gamma.md'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('success verification: sync_index dryRun after writes', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'concepts/delta',
      content: '# Delta\n\nDelta body.',
      frontmatter: {
        title: 'Delta',
        category: 'concepts',
        tags: ['x'],
        summary: 'Delta summary',
      },
    });

    await callTool(ctx.client, 'vault', { action: 'sync_index' });

    const dry = parseResult(
      await callTool(ctx.client, 'vault', { action: 'sync_index', dryRun: true }),
    ) as { wouldWrite?: boolean };
    expect(dry.wouldWrite).toBe(false);
  });

  it('slop_check is zero-write', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'concepts/slop-contract',
      content: '# Slop Contract\n\nClean body.',
      frontmatter: {
        title: 'Slop Contract',
        category: 'concepts',
        tags: ['x'],
        summary: 'Clean summary',
      },
    });
    const before = await fsp.readFile(path.join(ctx.vault, 'concepts/slop-contract.md'), 'utf8');
    const result = await callTool(ctx.client, 'vault', { action: 'slop_check' });
    expect(result.isError).toBeFalsy();
    const after = await fsp.readFile(path.join(ctx.vault, 'concepts/slop-contract.md'), 'utf8');
    expect(after).toBe(before);
  });
});
