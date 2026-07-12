import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { registerNote } from '../../src/tools/note.js';
import {
  createTestVault,
  cleanupVault,
  callTool,
  parseResult,
  writeNote,
} from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerNote(server, config);
  });
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('note concurrency', () => {
  it('returns revisionHash from read', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'revision-read',
      content: '# Body',
      frontmatter: { title: 'Revision Read' },
    });
    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'revision-read' });
    const data = parseResult(read) as { contentHash: string; revisionHash: string };
    expect(data.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.revisionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.revisionHash).not.toBe(data.contentHash);
  });

  it('serializes concurrent body edits so both succeed without lost updates', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'concurrent-body',
      content: 'start marker end',
      overwrite: true,
    });

    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'concurrent-body' });
    const { revisionHash } = parseResult(read) as { revisionHash: string };

    const [r1, r2] = await Promise.all([
      callTool(ctx.client, 'note', {
        action: 'update',
        path: 'concurrent-body',
        mode: 'patch',
        old_string: 'start',
        new_string: 'first',
        expectedRevision: revisionHash,
      }),
      callTool(ctx.client, 'note', {
        action: 'update',
        path: 'concurrent-body',
        mode: 'patch',
        old_string: 'end',
        new_string: 'second',
        expectedRevision: revisionHash,
      }),
    ]);

    const successes = [r1, r2].filter((r) => !r.isError);
    const conflicts = [r1, r2].filter((r) => r.isError);
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    const finalRead = await callTool(ctx.client, 'note', { action: 'read', path: 'concurrent-body' });
    const { content } = parseResult(finalRead) as { content: string };
    expect(content).toMatch(/first|second/);
    expect(content).not.toBe('start marker end');
  });

  it('serializes concurrent frontmatter merges', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'concurrent-fm',
      content: '# Body',
      frontmatter: { title: 'FM', seed: 'keep' },
      overwrite: true,
    });

    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'concurrent-fm' });
    const { revisionHash } = parseResult(read) as { revisionHash: string };

    const [r1, r2] = await Promise.all([
      callTool(ctx.client, 'note', {
        action: 'frontmatter',
        path: 'concurrent-fm',
        fmOperation: 'merge',
        frontmatter: { alpha: '1' },
        expectedRevision: revisionHash,
      }),
      callTool(ctx.client, 'note', {
        action: 'frontmatter',
        path: 'concurrent-fm',
        fmOperation: 'merge',
        frontmatter: { beta: '2' },
        expectedRevision: revisionHash,
      }),
    ]);

    const successes = [r1, r2].filter((r) => !r.isError);
    expect(successes).toHaveLength(1);

    const after = await callTool(ctx.client, 'note', { action: 'read', path: 'concurrent-fm' });
    const { frontmatter } = parseResult(after) as { frontmatter: Record<string, unknown> };
    expect(frontmatter.seed).toBe('keep');
    expect(frontmatter.alpha === '1' || frontmatter.beta === '2').toBe(true);
  });

  it('detects frontmatter-only external edit with expectedRevision but not expectedHash', async () => {
    await writeNote(
      ctx.vault,
      'fm-external.md',
      '---\ntitle: Original\n---\n\nStable body.\n',
    );

    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'fm-external' });
    const { contentHash, revisionHash } = parseResult(read) as {
      contentHash: string;
      revisionHash: string;
    };

    await writeNote(
      ctx.vault,
      'fm-external.md',
      '---\ntitle: Changed externally\n---\n\nStable body.\n',
    );

    const hashUpdate = await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'fm-external',
      mode: 'append',
      content: ' appended',
      expectedHash: contentHash,
    });
    expect(hashUpdate.isError).toBeFalsy();

    await writeNote(
      ctx.vault,
      'fm-external.md',
      '---\ntitle: Changed again\n---\n\nStable body.\n',
    );

    const revisionUpdate = await callTool(ctx.client, 'note', {
      action: 'frontmatter',
      path: 'fm-external',
      fmOperation: 'merge',
      frontmatter: { status: 'draft' },
      expectedRevision: revisionHash,
    });
    expect(revisionUpdate.isError).toBe(true);
    const payload = parseResult(revisionUpdate) as { error: string; message: string };
    expect(payload.error).toBe('hash_mismatch');
    expect(payload.message).toContain('revision mismatch');
  });

  it('includes deprecation warning when expectedHash is used on update', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'deprecated-hash',
      content: 'body text',
      overwrite: true,
    });
    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'deprecated-hash' });
    const { contentHash } = parseResult(read) as { contentHash: string };

    const result = await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'deprecated-hash',
      mode: 'append',
      content: ' more',
      expectedHash: contentHash,
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { warnings?: string[] };
    expect(data.warnings?.[0]).toContain('deprecated');
  });

  it('rejects delete when expectedRevision is stale', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'delete-revision',
      content: '# Delete me',
      overwrite: true,
    });
    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'delete-revision' });
    const { revisionHash } = parseResult(read) as { revisionHash: string };

    await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'delete-revision',
      mode: 'append',
      content: '\nchanged',
    });

    const result = await callTool(ctx.client, 'note', {
      action: 'delete',
      path: 'delete-revision',
      confirm: true,
      expectedRevision: revisionHash,
    });
    expect(result.isError).toBe(true);

    const exists = await fsp
      .access(path.join(ctx.vault, 'delete-revision.md'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it('rejects create overwrite when expectedRevision is stale', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'overwrite-revision',
      content: 'v1',
    });
    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'overwrite-revision' });
    const { revisionHash } = parseResult(read) as { revisionHash: string };

    await writeNote(ctx.vault, 'overwrite-revision.md', 'v2-external');

    const result = await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'overwrite-revision',
      content: 'v3',
      overwrite: true,
      expectedRevision: revisionHash,
    });
    expect(result.isError).toBe(true);

    const content = await fsp.readFile(path.join(ctx.vault, 'overwrite-revision.md'), 'utf-8');
    expect(content).toBe('v2-external');
  });
});
