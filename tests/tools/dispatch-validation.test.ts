import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerNote } from '../../src/tools/note.js';
import { registerSearch } from '../../src/tools/search.js';
import { registerVault } from '../../src/tools/vault.js';
import { createTestVault, cleanupVault, callTool, parseResult } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerNote(server, config);
    registerSearch(server, config);
    registerVault(server, config);
  });
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

type ErrorPayload = {
  error: string;
  code?: string;
  action?: string;
  retryable?: boolean;
  sideEffects?: string;
  details?: {
    required?: string[];
    missing?: string[];
    rejected?: string[];
  };
  recovery?: { tool: string; arguments: Record<string, unknown> };
};

function expectInvalidArgs(
  result: { isError?: boolean },
  expected: {
    missing?: string[];
    rejected?: string[];
    recoveryTool?: string;
  },
) {
  expect(result.isError).toBe(true);
  const data = parseResult(result) as ErrorPayload;
  expect(data.error).toBe('invalid_args');
  expect(data.code).toBe('invalid_args');
  expect(data.retryable).toBe(true);
  expect(data.sideEffects).toBe('none');
  if (expected.missing) {
    expect(data.details?.missing).toEqual(expected.missing);
  }
  if (expected.rejected) {
    expect(data.details?.rejected).toEqual(expected.rejected);
  }
  if (expected.recoveryTool) {
    expect(data.recovery?.tool).toBe(expected.recoveryTool);
    expect(data.recovery?.arguments.action).toBeTruthy();
  }
}

describe('dispatch validation', () => {
  it('note create without content returns invalid_args with recovery', async () => {
    const result = await callTool(ctx.client, 'note', { action: 'create', path: 'x' });
    expectInvalidArgs(result, { missing: ['content'], recoveryTool: 'note' });
    const data = parseResult(result) as ErrorPayload;
    expect(data.recovery?.arguments).toMatchObject({
      action: 'create',
      path: 'x',
      content: '<content>',
    });
  });

  it('note delete without confirm returns invalid_args', async () => {
    const result = await callTool(ctx.client, 'note', { action: 'delete', path: 'x' });
    expectInvalidArgs(result, { missing: ['confirm'], recoveryTool: 'note' });
  });

  it('note rename without newPath returns invalid_args', async () => {
    const result = await callTool(ctx.client, 'note', { action: 'rename', path: 'x' });
    expectInvalidArgs(result, { missing: ['newPath'], recoveryTool: 'note' });
  });

  it('note read rejects arguments that do not apply to the action', async () => {
    const result = await callTool(ctx.client, 'note', {
      action: 'read',
      path: 'x',
      content: 'ignored',
      mode: 'append',
    });
    expectInvalidArgs(result, { rejected: ['content', 'mode'], recoveryTool: 'note' });
  });

  it('search content without query returns invalid_args', async () => {
    const result = await callTool(ctx.client, 'search', { action: 'content' });
    expectInvalidArgs(result, { missing: ['query'], recoveryTool: 'search' });
  });

  it('search by_tags without tags returns invalid_args', async () => {
    const result = await callTool(ctx.client, 'search', { action: 'by_tags' });
    expectInvalidArgs(result, { missing: ['tags'], recoveryTool: 'search' });
  });

  it('search by_tags rejects empty or whitespace-only tags', async () => {
    const empty = await callTool(ctx.client, 'search', { action: 'by_tags', tags: [''] });
    expect(empty.isError).toBe(true);

    const whitespace = await callTool(ctx.client, 'search', { action: 'by_tags', tags: ['  '] });
    expectInvalidArgs(whitespace, { rejected: ['tags'], recoveryTool: 'search' });
  });

  it('search list rejects query argument', async () => {
    const result = await callTool(ctx.client, 'search', {
      action: 'list',
      folder: 'Concepts',
      query: 'should-not-be-here',
    });
    expectInvalidArgs(result, { rejected: ['query'], recoveryTool: 'search' });
  });

  it('vault delete_folder without confirm returns invalid_args', async () => {
    const result = await callTool(ctx.client, 'vault', {
      action: 'delete_folder',
      path: 'SomeFolder',
    });
    expectInvalidArgs(result, { missing: ['confirm'], recoveryTool: 'vault' });
  });

  it('vault health rejects path argument', async () => {
    const result = await callTool(ctx.client, 'vault', {
      action: 'health',
      path: 'should-not-apply',
    });
    expectInvalidArgs(result, { rejected: ['path'], recoveryTool: 'vault' });
  });

  it('vault manifest read rejects sourceKey argument', async () => {
    const result = await callTool(ctx.client, 'vault', {
      action: 'manifest',
      manifestOperation: 'read',
      sourceKey: 'ignored',
    });
    expectInvalidArgs(result, { rejected: ['sourceKey'], recoveryTool: 'vault' });
  });

  it('vault manifest without manifestOperation returns invalid_args', async () => {
    const result = await callTool(ctx.client, 'vault', { action: 'manifest' });
    expectInvalidArgs(result, { missing: ['manifestOperation'], recoveryTool: 'vault' });
  });

  it('hash_mismatch includes structured recovery to re-read', async () => {
    await callTool(ctx.client, 'note', {
      action: 'create',
      path: 'recovery-test',
      content: 'original',
      overwrite: true,
    });
    const read = await callTool(ctx.client, 'note', { action: 'read', path: 'recovery-test' });
    const { revisionHash } = parseResult(read) as { revisionHash: string };

    await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'recovery-test',
      mode: 'replace',
      content: 'changed externally',
    });

    const stale = await callTool(ctx.client, 'note', {
      action: 'update',
      path: 'recovery-test',
      mode: 'append',
      content: ' more',
      expectedRevision: revisionHash,
    });
    expect(stale.isError).toBe(true);
    const data = parseResult(stale) as ErrorPayload;
    expect(data.error).toBe('hash_mismatch');
    expect(data.code).toBe('hash_mismatch');
    expect(data.retryable).toBe(true);
    expect(data.sideEffects).toBe('none');
    expect(data.recovery).toEqual({
      tool: 'note',
      arguments: { action: 'read', path: 'recovery-test' },
    });
    expect(data.details).toMatchObject({
      conflictKind: 'revision',
      check: 'revision',
    });
    expect(typeof (data.details as { currentRevision?: string }).currentRevision).toBe('string');
  });

  it('search tags rejects limit argument', async () => {
    const result = await callTool(ctx.client, 'search', { action: 'tags', limit: 10 });
    expectInvalidArgs(result, { rejected: ['limit'], recoveryTool: 'search' });
  });
});
