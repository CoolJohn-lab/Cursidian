import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerNote } from '../../src/tools/note.js';
import { createTestVault, seedVault, cleanupVault, callTool, parseResult } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault();
  await seedVault(ctx.vault);
  registerNote(ctx.server, ctx.config);
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('note (read)', () => {
  it('reads a note with frontmatter', async () => {
    const result = await callTool(ctx.server, 'note', { action: 'read', path: 'index' });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as {
      frontmatter: Record<string, unknown>;
      content: string;
      contentHash: string;
    };
    expect(data.frontmatter.title).toBe('Vault Index');
    expect(data.content).toContain('My Vault');
    expect(data.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts path with .md extension', async () => {
    const result = await callTool(ctx.server, 'note', { action: 'read', path: 'index.md' });
    expect(result.isError).toBeFalsy();
  });

  it('returns error for non-existent note', async () => {
    const result = await callTool(ctx.server, 'note', { action: 'read', path: 'does-not-exist' });
    expect(result.isError).toBe(true);
  });

  it('rejects path traversal', async () => {
    const result = await callTool(ctx.server, 'note', { action: 'read', path: '../../../etc/passwd' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('path_traversal');
  });
});
