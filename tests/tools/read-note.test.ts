import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerNote } from '../../src/tools/note.js';
import { createTestVault, seedVault, cleanupVault, callTool, parseResult } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerNote(server, config);
  });
  await seedVault(ctx.vault);
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('note (read)', () => {
  it('reads a note with frontmatter', async () => {
    const result = await callTool(ctx.client, 'note', { action: 'read', path: 'index' });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as {
      frontmatter: Record<string, unknown>;
      content: string;
      contentHash: string;
      revisionHash: string;
    };
    expect(data.frontmatter.title).toBe('Vault Index');
    expect(data.content).toContain('My Vault');
    expect(data.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.revisionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts path with .md extension', async () => {
    const result = await callTool(ctx.client, 'note', { action: 'read', path: 'index.md' });
    expect(result.isError).toBeFalsy();
  });

  it('returns error for non-existent note', async () => {
    const result = await callTool(ctx.client, 'note', { action: 'read', path: 'does-not-exist' });
    expect(result.isError).toBe(true);
  });

  it('reads a note by frontmatter alias and returns canonical path', async () => {
    const { writeNote } = await import('./helpers.js');
    await writeNote(
      ctx.vault,
      'entities/compute.md',
      '---\ntitle: Compute Box\naliases:\n  - compute-box\n---\n\nAlias target body.\n',
    );
    const result = await callTool(ctx.client, 'note', { action: 'read', path: 'compute-box' });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { path: string; content: string };
    expect(data.path).toBe('entities/compute.md');
    expect(data.content).toContain('Alias target body');
  });

  it('returns invalid_args when an alias is claimed by multiple notes', async () => {
    const { writeNote } = await import('./helpers.js');
    await writeNote(
      ctx.vault,
      'entities/collide-a.md',
      '---\ntitle: Collide A\naliases: [shared-read-key]\n---\n\nA\n',
    );
    await writeNote(
      ctx.vault,
      'entities/collide-b.md',
      '---\ntitle: Collide B\naliases: [shared-read-key]\n---\n\nB\n',
    );
    const result = await callTool(ctx.client, 'note', {
      action: 'read',
      path: 'shared-read-key',
    });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string; message: string };
    expect(data.error).toBe('invalid_args');
    expect(data.message).toContain('ambiguous');
  });

  it('returns note_not_found for unknown alias', async () => {
    const result = await callTool(ctx.client, 'note', {
      action: 'read',
      path: 'no-such-alias-xyz',
    });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toBe('note_not_found');
  });

  it('rejects path traversal', async () => {
    const result = await callTool(ctx.client, 'note', { action: 'read', path: '../../../etc/passwd' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('path_traversal');
  });
});
