import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerNote } from '../../src/tools/note.js';
import { registerSearch } from '../../src/tools/search.js';
import { registerVault } from '../../src/tools/vault.js';
import { createTestVault, cleanupVault, callTool, parseResult } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault();
  registerNote(ctx.server, ctx.config);
  registerSearch(ctx.server, ctx.config);
  registerVault(ctx.server, ctx.config);
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('dispatch validation', () => {
  it('note create without content returns invalid_args', async () => {
    const result = await callTool(ctx.server, 'note', { action: 'create', path: 'x' });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toBe('invalid_args');
  });

  it('note delete without confirm returns invalid_args', async () => {
    const result = await callTool(ctx.server, 'note', { action: 'delete', path: 'x' });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toBe('invalid_args');
  });

  it('note rename without newPath returns invalid_args', async () => {
    const result = await callTool(ctx.server, 'note', { action: 'rename', path: 'x' });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toBe('invalid_args');
  });

  it('search content without query returns invalid_args', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'content' });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toBe('invalid_args');
  });

  it('search by_tags without tags returns invalid_args', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'by_tags' });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toBe('invalid_args');
  });

  it('vault log without logLine returns invalid_args', async () => {
    const result = await callTool(ctx.server, 'vault', { action: 'log' });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toBe('invalid_args');
  });

  it('vault delete_folder without confirm returns invalid_args', async () => {
    const result = await callTool(ctx.server, 'vault', {
      action: 'delete_folder',
      path: 'SomeFolder',
    });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string };
    expect(data.error).toBe('invalid_args');
  });
});
