import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerNote } from '../../src/tools/note.js';
import { createTestVault, cleanupVault, callTool, parseResult } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

async function readFrontmatter(ctx: TestContext, notePath: string) {
  const result = await callTool(ctx.server, 'note', { action: 'read', path: notePath });
  const data = parseResult(result) as { frontmatter: Record<string, unknown> };
  return data.frontmatter;
}

beforeAll(async () => {
  ctx = await createTestVault();
  registerNote(ctx.server, ctx.config);
  await callTool(ctx.server, 'note', {
    action: 'create',
    path: 'fm-note',
    content: '# Body content',
    frontmatter: { title: 'Original', tags: ['a'] },
  });
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('note (frontmatter)', () => {
  it('reads frontmatter via action=read', async () => {
    const frontmatter = await readFrontmatter(ctx, 'fm-note');
    expect(frontmatter.title).toBe('Original');
  });

  it('sets frontmatter replacing all keys', async () => {
    const result = await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'set',
      frontmatter: { title: 'New Title', status: 'active' },
    });
    expect(result.isError).toBeFalsy();
    const data = await readFrontmatter(ctx, 'fm-note');
    expect(data.title).toBe('New Title');
    expect(data.tags).toBeUndefined();
  });

  it('merges frontmatter', async () => {
    await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'set',
      frontmatter: { title: 'T', existing: 'keep' },
    });
    const result = await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'merge',
      frontmatter: { newKey: 'added' },
    });
    expect(result.isError).toBeFalsy();
    const data = await readFrontmatter(ctx, 'fm-note');
    expect(data.existing).toBe('keep');
    expect(data.newKey).toBe('added');
  });

  it('deletes specific keys', async () => {
    await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'set',
      frontmatter: { keep: 'yes', remove: 'yes' },
    });
    const result = await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'delete',
      keys: ['remove'],
    });
    expect(result.isError).toBeFalsy();
    const data = await readFrontmatter(ctx, 'fm-note');
    expect(data.keep).toBe('yes');
    expect(data.remove).toBeUndefined();
  });

  it('rejects destructive operations in read-only mode', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { registerNote: reg } = await import('../../src/tools/note.js');
    const roServer = new McpServer({ name: 'ro', version: '0' });
    reg(roServer, { ...ctx.config, readOnly: true });
    const result = await callTool(roServer, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'set',
      frontmatter: { x: 1 },
    });
    expect(result.isError).toBe(true);
  });

  it('rejects path traversal', async () => {
    const result = await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: '../../../etc/passwd',
      fmOperation: 'set',
      frontmatter: { x: 1 },
    });
    expect(result.isError).toBe(true);
  });

  it('rejects set without data and leaves frontmatter unchanged', async () => {
    await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'set',
      frontmatter: { title: 'Seed', tags: ['a'] },
    });
    const before = await readFrontmatter(ctx, 'fm-note');

    const result = await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'set',
    });
    expect(result.isError).toBe(true);

    const after = await readFrontmatter(ctx, 'fm-note');
    expect(after).toEqual(before);
  });

  it('rejects set with empty data and leaves frontmatter unchanged', async () => {
    await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'set',
      frontmatter: { title: 'Seed', tags: ['a'] },
    });
    const before = await readFrontmatter(ctx, 'fm-note');

    const result = await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'set',
      frontmatter: {},
    });
    expect(result.isError).toBe(true);

    const after = await readFrontmatter(ctx, 'fm-note');
    expect(after).toEqual(before);
  });

  it('rejects merge without data and leaves frontmatter unchanged', async () => {
    await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'set',
      frontmatter: { title: 'Seed', tags: ['a'] },
    });
    const before = await readFrontmatter(ctx, 'fm-note');

    const result = await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'merge',
    });
    expect(result.isError).toBe(true);

    const after = await readFrontmatter(ctx, 'fm-note');
    expect(after).toEqual(before);
  });

  it('rejects delete without keys and leaves frontmatter unchanged', async () => {
    await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'set',
      frontmatter: { title: 'Seed', tags: ['a'] },
    });
    const before = await readFrontmatter(ctx, 'fm-note');

    const result = await callTool(ctx.server, 'note', {
      action: 'frontmatter',
      path: 'fm-note',
      fmOperation: 'delete',
    });
    expect(result.isError).toBe(true);

    const after = await readFrontmatter(ctx, 'fm-note');
    expect(after).toEqual(before);
  });
});
