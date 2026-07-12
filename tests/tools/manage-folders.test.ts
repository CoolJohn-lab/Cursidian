import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerVault } from '../../src/tools/vault.js';
import { createTestVault, cleanupVault, callTool, parseResult } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault();
  registerVault(ctx.server, ctx.config);
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('vault (folders)', () => {
  it('creates a folder', async () => {
    const result = await callTool(ctx.server, 'vault', {
      action: 'create_folder',
      path: 'NewFolder',
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { created: string };
    expect(data.created).toBe('NewFolder');
  });

  it('creates nested folders', async () => {
    const result = await callTool(ctx.server, 'vault', {
      action: 'create_folder',
      path: 'Deep/Nested/Folder',
    });
    expect(result.isError).toBeFalsy();
  });

  it('lists subfolders', async () => {
    await callTool(ctx.server, 'vault', { action: 'create_folder', path: 'Parent/Child1' });
    await callTool(ctx.server, 'vault', { action: 'create_folder', path: 'Parent/Child2' });
    const result = await callTool(ctx.server, 'vault', {
      action: 'list_folders',
      path: 'Parent',
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { subfolders: string[] };
    expect(data.subfolders.length).toBeGreaterThanOrEqual(2);
    for (const sub of data.subfolders) {
      expect(sub).not.toContain('\\');
      expect(sub.startsWith('Parent/')).toBe(true);
    }
  });

  it('lists vault-root subfolders when path is empty', async () => {
    const result = await callTool(ctx.server, 'vault', { action: 'list_folders', path: '' });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { folder: string; subfolders: string[] };
    expect(data.folder).toBe('');
    expect(Array.isArray(data.subfolders)).toBe(true);
  });

  it('deletes an empty folder with confirm', async () => {
    await callTool(ctx.server, 'vault', { action: 'create_folder', path: 'ToDelete' });
    const result = await callTool(ctx.server, 'vault', {
      action: 'delete_folder',
      path: 'ToDelete',
      confirm: true,
    });
    expect(result.isError).toBeFalsy();
  });

  it('fails to delete without confirm', async () => {
    await callTool(ctx.server, 'vault', { action: 'create_folder', path: 'NoConfirm' });
    const result = await callTool(ctx.server, 'vault', {
      action: 'delete_folder',
      path: 'NoConfirm',
      confirm: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('confirm');
  });

  it('returns folder_not_empty when deleting a non-empty folder', async () => {
    await callTool(ctx.server, 'vault', { action: 'create_folder', path: 'NotEmpty' });
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await mkdir(join(ctx.vault, 'NotEmpty'), { recursive: true });
    await writeFile(join(ctx.vault, 'NotEmpty', 'note.md'), '# hi\n', 'utf-8');
    const result = await callTool(ctx.server, 'vault', {
      action: 'delete_folder',
      path: 'NotEmpty',
      confirm: true,
    });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toBe('folder_not_empty');
  });

  it('rejects path traversal', async () => {
    const result = await callTool(ctx.server, 'vault', {
      action: 'create_folder',
      path: '../evil',
    });
    expect(result.isError).toBe(true);
  });

  it('rejects in read-only mode', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { registerVault: reg } = await import('../../src/tools/vault.js');
    const roServer = new McpServer({ name: 'ro', version: '0' });
    reg(roServer, { ...ctx.config, readOnly: true });
    const result = await callTool(roServer, 'vault', {
      action: 'create_folder',
      path: 'x',
    });
    expect(result.isError).toBe(true);
  });
});
