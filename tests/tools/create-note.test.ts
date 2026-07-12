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

describe('note (create)', () => {
  it('creates a new note', async () => {
    const result = await callTool(ctx.server, 'note', {
      action: 'create',
      path: 'new-note',
      content: '# Hello',
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { created: string };
    expect(data.created).toBe('new-note.md');
    const exists = await fsp.access(path.join(ctx.vault, 'new-note.md')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('creates note with frontmatter', async () => {
    const result = await callTool(ctx.server, 'note', {
      action: 'create',
      path: 'with-fm',
      content: '# Body',
      frontmatter: { title: 'Test', tags: ['test'] },
    });
    expect(result.isError).toBeFalsy();
    const content = await fsp.readFile(path.join(ctx.vault, 'with-fm.md'), 'utf-8');
    expect(content).toContain('title: Test');
  });

  it('creates intermediate folders', async () => {
    const result = await callTool(ctx.server, 'note', {
      action: 'create',
      path: 'deep/nested/note',
      content: '# Deep',
    });
    expect(result.isError).toBeFalsy();
    const exists = await fsp.access(path.join(ctx.vault, 'deep/nested/note.md')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('fails if note exists and overwrite is false', async () => {
    await callTool(ctx.server, 'note', { action: 'create', path: 'existing', content: 'v1' });
    const result = await callTool(ctx.server, 'note', { action: 'create', path: 'existing', content: 'v2' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('already exists');
  });

  it('overwrites when overwrite is true', async () => {
    await callTool(ctx.server, 'note', { action: 'create', path: 'overwrite-me', content: 'v1' });
    const result = await callTool(ctx.server, 'note', {
      action: 'create',
      path: 'overwrite-me',
      content: 'v2',
      overwrite: true,
    });
    expect(result.isError).toBeFalsy();
    const content = await fsp.readFile(path.join(ctx.vault, 'overwrite-me.md'), 'utf-8');
    expect(content).toBe('v2');
  });

  it('rejects path traversal', async () => {
    const result = await callTool(ctx.server, 'note', { action: 'create', path: '../evil', content: 'x' });
    expect(result.isError).toBe(true);
  });

  it('returns ReadOnlyError in read-only mode', async () => {
    const roConfig = { ...ctx.config, readOnly: true };
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { registerNote: reg } = await import('../../src/tools/note.js');
    const roServer = new McpServer({ name: 'ro', version: '0' });
    reg(roServer, roConfig);
    const result = await callTool(roServer, 'note', { action: 'create', path: 'x', content: 'y' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('read-only');
  });

  it('auto-sets created and updated timestamps in frontmatter', async () => {
    const result = await callTool(ctx.server, 'note', {
      action: 'create',
      path: 'timestamped',
      content: '# Body',
      frontmatter: { title: 'Timestamped' },
    });
    expect(result.isError).toBeFalsy();
    const content = await fsp.readFile(path.join(ctx.vault, 'timestamped.md'), 'utf-8');
    expect(content).toMatch(/created: .+/);
    expect(content).toMatch(/updated: .+/);
  });
});
