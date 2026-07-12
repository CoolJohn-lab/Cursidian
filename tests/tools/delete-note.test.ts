import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { registerNote } from '../../src/tools/note.js';
import { createTestVault, cleanupVault, callTool, parseResult } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault();
  registerNote(ctx.server, ctx.config);
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('note (delete)', () => {
  it('deletes a note', async () => {
    await callTool(ctx.server, 'note', { action: 'create', path: 'to-delete', content: '# Delete me' });
    const result = await callTool(ctx.server, 'note', { action: 'delete', path: 'to-delete', confirm: true });
    expect(result.isError).toBeFalsy();
    const exists = await fsp
      .access(path.join(ctx.vault, 'to-delete.md'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('returns error for non-existent note', async () => {
    const result = await callTool(ctx.server, 'note', { action: 'delete', path: 'ghost', confirm: true });
    expect(result.isError).toBe(true);
  });

  it('returns ReadOnlyError in read-only mode', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { registerNote: reg } = await import('../../src/tools/note.js');
    const roServer = new McpServer({ name: 'ro', version: '0' });
    reg(roServer, { ...ctx.config, readOnly: true });
    const result = await callTool(roServer, 'note', { action: 'delete', path: 'x', confirm: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('read-only');
  });

  it('rejects path traversal', async () => {
    const result = await callTool(ctx.server, 'note', {
      action: 'delete',
      path: '../../../etc/passwd',
      confirm: true,
    });
    expect(result.isError).toBe(true);
  });
});
