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
  await callTool(ctx.server, 'note', {
    action: 'create',
    path: 'editable',
    content: '# Original',
    frontmatter: { title: 'Editable' },
  });
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('note (update)', () => {
  it('replaces content (default mode)', async () => {
    const result = await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      content: '# Replaced\n\nThis is a full replacement body with enough content to pass the size guard when replacing the original note.',
      mode: 'replace',
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { mode: string; contentHash: string };
    expect(data.mode).toBe('replace');
    expect(data.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const content = await fsp.readFile(path.join(ctx.vault, 'editable.md'), 'utf-8');
    expect(content).toContain('Replaced');
  });

  it('appends content preserving frontmatter', async () => {
    await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      content: '# Base',
      mode: 'replace',
      force: true,
    });
    const result = await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      content: '## Appended',
      mode: 'append',
    });
    expect(result.isError).toBeFalsy();
    const raw = await fsp.readFile(path.join(ctx.vault, 'editable.md'), 'utf-8');
    expect(raw).toContain('# Base');
    expect(raw).toContain('## Appended');
  });

  it('prepends content', async () => {
    await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      content: '# Body',
      mode: 'replace',
      force: true,
    });
    const result = await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      content: '## Prepended',
      mode: 'prepend',
    });
    expect(result.isError).toBeFalsy();
    const raw = await fsp.readFile(path.join(ctx.vault, 'editable.md'), 'utf-8');
    const prependedIdx = raw.indexOf('## Prepended');
    const bodyIdx = raw.indexOf('# Body');
    expect(prependedIdx).toBeLessThan(bodyIdx);
  });

  it('returns error for non-existent note', async () => {
    const result = await callTool(ctx.server, 'note', { action: 'update', path: 'ghost', content: 'x' });
    expect(result.isError).toBe(true);
  });

  it('rejects in read-only mode', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { registerNote: reg } = await import('../../src/tools/note.js');
    const roServer = new McpServer({ name: 'ro', version: '0' });
    reg(roServer, { ...ctx.config, readOnly: true });
    const result = await callTool(roServer, 'note', { action: 'update', path: 'editable', content: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('read-only');
  });

  it('rejects path traversal', async () => {
    const result = await callTool(ctx.server, 'note', { action: 'update',
      path: '../../../etc/passwd',
      content: 'evil',
    });
    expect(result.isError).toBe(true);
  });

  it('patches a unique substring', async () => {
    await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      content: '# Title\n\nalpha beta gamma',
      mode: 'replace',
      force: true,
    });
    const result = await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      mode: 'patch',
      old_string: 'beta',
      new_string: 'delta',
    });
    expect(result.isError).toBeFalsy();
    const raw = await fsp.readFile(path.join(ctx.vault, 'editable.md'), 'utf-8');
    expect(raw).toContain('alpha delta gamma');
  });

  it('rejects replace when new body is too small without force', async () => {
    await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      content: '# Long body\n\n' + 'x'.repeat(200),
      mode: 'replace',
      force: true,
    });
    const result = await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      content: 'tiny',
      mode: 'replace',
    });
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text) as { error: string; message: string };
    expect(payload.error).toBe('invalid_args');
    expect(payload.message).toContain('shrink note body');
  });

  it('replaces a section by heading', async () => {
    await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      content: '# Doc\n\n## Details\nold\n\n## Other\nstay',
      mode: 'replace',
      force: true,
    });
    const result = await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      mode: 'replace_section',
      heading: 'Details',
      content: 'new section body',
    });
    expect(result.isError).toBeFalsy();
    const raw = await fsp.readFile(path.join(ctx.vault, 'editable.md'), 'utf-8');
    expect(raw).toContain('new section body');
    expect(raw).not.toContain('old');
    expect(raw).toContain('stay');
  });

  it('replaces a section when heading includes # markers', async () => {
    await callTool(ctx.server, 'note', {
      action: 'update',
      path: 'editable',
      content: '# Doc\n\n## Details\nold\n\n## Other\nstay',
      mode: 'replace',
      force: true,
    });
    const result = await callTool(ctx.server, 'note', {
      action: 'update',
      path: 'editable',
      mode: 'replace_section',
      heading: '## Details',
      content: 'hashed section body',
    });
    expect(result.isError).toBeFalsy();
    const raw = await fsp.readFile(path.join(ctx.vault, 'editable.md'), 'utf-8');
    expect(raw).toContain('hashed section body');
    expect(raw).not.toContain('old');
  });

  it('returns not_found when replace_section heading is missing', async () => {
    await callTool(ctx.server, 'note', {
      action: 'update',
      path: 'editable',
      content: '# Doc\n\n## Details\nbody',
      mode: 'replace',
      force: true,
    });
    const result = await callTool(ctx.server, 'note', {
      action: 'update',
      path: 'editable',
      mode: 'replace_section',
      heading: 'Missing',
      content: 'x',
    });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toBe('not_found');
  });

  it('infers patch mode when old_string and new_string provided without mode', async () => {
    await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      content: '# Infer patch\n\nunique-marker-value',
      mode: 'replace',
      force: true,
    });
    const result = await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      old_string: 'unique-marker-value',
      new_string: 'patched-marker-value',
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { mode: string; inferredMode?: string };
    expect(data.mode).toBe('patch');
    expect(data.inferredMode).toBe('patch');
    const raw = await fsp.readFile(path.join(ctx.vault, 'editable.md'), 'utf-8');
    expect(raw).toContain('patched-marker-value');
  });

  it('rejects update when expectedHash mismatches', async () => {
    await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      content: '# Hash test\n\nbody',
      mode: 'replace',
      force: true,
    });
    const read = await callTool(ctx.server, 'note', { action: 'read', path: 'editable' });
    const { contentHash } = parseResult(read) as { contentHash: string };
    await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      mode: 'patch',
      old_string: 'body',
      new_string: 'changed',
    });
    const result = await callTool(ctx.server, 'note', { action: 'update',
      path: 'editable',
      mode: 'patch',
      old_string: 'changed',
      new_string: 'again',
      expectedHash: contentHash,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('hash mismatch');
  });

  it('bumps updated timestamp in frontmatter', async () => {
    await callTool(ctx.server, 'note', {
      action: 'create',
      path: 'fm-update',
      content: '# Body',
      frontmatter: { title: 'FM', updated: '2020-01-01T00:00:00.000Z' },
      overwrite: true,
    });
    await callTool(ctx.server, 'note', { action: 'update',
      path: 'fm-update',
      content: '# Updated body with enough text to satisfy replace guard requirements easily.',
      mode: 'replace',
      force: true,
    });
    const raw = await fsp.readFile(path.join(ctx.vault, 'fm-update.md'), 'utf-8');
    expect(raw).toContain('updated:');
    expect(raw).not.toContain('2020-01-01T00:00:00.000Z');
  });
});
