import { describe, it, expect } from 'vitest';
import {
  err,
  invalidArgsError,
  mapToolError,
  ok,
  toolError,
} from '../../src/types/index.js';
import { ReadOnlyError, SecurityError, FileTooLargeError } from '../../src/lib/security.js';
import { SectionEditError } from '../../src/lib/section-edit.js';
import { PathResolveError } from '../../src/lib/vault-index.js';
import { AlreadyExistsError, PartialUpdateError } from '../../src/lib/vault-io.js';

function parsePayload(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('structured tool errors', () => {
  it('ok wraps success metadata with status and changed', () => {
    const result = ok({ path: 'a.md', content: 'hi' }, { action: 'read', changed: false, paths: ['a.md'] });
    expect(result.isError).toBeUndefined();
    const payload = parsePayload(result);
    expect(payload.action).toBe('read');
    expect(payload.status).toBe('success');
    expect(payload.changed).toBe(false);
    expect(payload.paths).toEqual(['a.md']);
    expect(payload.path).toBe('a.md');
    expect(payload.content).toBe('hi');
  });

  it('toolError normalizes code, retryable, and sideEffects defaults', () => {
    const result = toolError({
      error: 'hash_mismatch',
      message: 'Note content has changed since read (hash mismatch).',
      path: 'log.md',
      hint: 'Re-read and retry.',
    });
    expect(result.isError).toBe(true);
    const payload = parsePayload(result);
    expect(payload.error).toBe('hash_mismatch');
    expect(payload.code).toBe('hash_mismatch');
    expect(payload.retryable).toBe(false);
    expect(payload.sideEffects).toBe('none');
    expect(payload.details).toEqual({});
    expect(payload.path).toBe('log.md');
    expect(payload.hint).toBe('Re-read and retry.');
  });

  it('err emits structured JSON with optional code', () => {
    const result = err('boom', 'invalid_args', { path: 'x.md' });
    expect(result.isError).toBe(true);
    const payload = parsePayload(result);
    expect(payload.error).toBe('invalid_args');
    expect(payload.code).toBe('invalid_args');
    expect(payload.message).toBe('boom');
    expect(payload.path).toBe('x.md');
  });

  it('invalidArgsError includes required, missing, rejected, and recovery', () => {
    const result = invalidArgsError({
      tool: 'note',
      action: 'create',
      message: 'missing required arguments: content',
      required: ['path', 'content'],
      missing: ['content'],
      rejected: ['mode'],
      path: 'draft.md',
      arguments: { action: 'create', path: 'draft.md', content: '<content>' },
    });
    const payload = parsePayload(result);
    expect(payload.error).toBe('invalid_args');
    expect(payload.code).toBe('invalid_args');
    expect(payload.retryable).toBe(true);
    expect(payload.sideEffects).toBe('none');
    expect(payload.details).toEqual({
      required: ['path', 'content'],
      missing: ['content'],
      rejected: ['mode'],
    });
    expect(payload.recovery).toEqual({
      tool: 'note',
      arguments: { action: 'create', path: 'draft.md', content: '<content>' },
    });
  });

  it('mapToolError maps SecurityError with recovery', () => {
    const secure = mapToolError(new SecurityError('escape'), {
      tool: 'note',
      action: 'read',
      path: '../x',
      arguments: { action: 'read', path: '../x' },
    });
    const payload = parsePayload(secure);
    expect(payload.error).toBe('path_traversal');
    expect(payload.code).toBe('path_traversal');
    expect(payload.retryable).toBe(true);
    expect(payload.recovery).toEqual({ tool: 'note', arguments: { action: 'read', path: '../x' } });
    expect(payload.hint).toBeTruthy();
  });

  it('mapToolError maps ReadOnlyError with recovery', () => {
    const readOnly = mapToolError(new ReadOnlyError(), {
      tool: 'note',
      action: 'create',
      arguments: { action: 'create', path: 'x.md', content: 'body' },
    });
    const payload = parsePayload(readOnly);
    expect(payload.error).toBe('read_only');
    expect(payload.code).toBe('read_only');
    expect(payload.retryable).toBe(true);
    expect(payload.recovery).toEqual({
      tool: 'note',
      arguments: { action: 'create', path: 'x.md', content: 'body' },
    });
    expect(payload.details).toEqual({ configuration: 'OBSIDIAN_READ_ONLY' });
  });

  it('mapToolError maps FileTooLargeError with recovery', () => {
    const result = mapToolError(new FileTooLargeError(2_000_000, 1_000_000), {
      tool: 'note',
      action: 'read',
      path: 'big.md',
      arguments: { action: 'read', path: 'big.md' },
    });
    const payload = parsePayload(result);
    expect(payload.error).toBe('file_too_large');
    expect(payload.code).toBe('file_too_large');
    expect(payload.retryable).toBe(true);
    expect(payload.path).toBe('big.md');
    expect(payload.recovery).toEqual({ tool: 'note', arguments: { action: 'read', path: 'big.md' } });
  });

  it('mapToolError maps AlreadyExistsError with recovery', () => {
    const result = mapToolError(new AlreadyExistsError('File already exists'), {
      tool: 'note',
      action: 'create',
      path: 'exists.md',
      arguments: { action: 'create', path: 'exists.md', content: 'body' },
    });
    const payload = parsePayload(result);
    expect(payload.error).toBe('already_exists');
    expect(payload.code).toBe('already_exists');
    expect(payload.retryable).toBe(true);
    expect(payload.path).toBe('exists.md');
    expect(payload.details).toEqual({ existingPath: 'exists.md' });
    expect(payload.recovery).toEqual({
      tool: 'note',
      arguments: { action: 'create', path: 'exists.md', content: 'body' },
    });
  });

  it('mapToolError maps PartialUpdateError with sideEffects partial', () => {
    const result = mapToolError(
      new PartialUpdateError('rollback incomplete', ['a.md'], ['a.md'], ['b.md']),
      { tool: 'note', action: 'rename', path: 'a.md' },
    );
    const payload = parsePayload(result);
    expect(payload.error).toBe('partial_update');
    expect(payload.code).toBe('partial_update');
    expect(payload.retryable).toBe(false);
    expect(payload.sideEffects).toBe('partial');
    expect(payload.details).toEqual({ completed: ['a.md'], restored: ['a.md'], unresolved: ['b.md'] });
    expect(payload.recovery).toEqual({ tool: 'vault', arguments: { action: 'health' } });
  });

  it('mapToolError maps SectionEditError codes', () => {
    const missing = mapToolError(new SectionEditError('not_found', 'Heading not found: "X"'), {
      tool: 'note',
      action: 'update',
      path: 'n.md',
      arguments: { action: 'update', path: 'n.md', mode: 'replace_section', heading: 'X' },
    });
    const missingPayload = parsePayload(missing);
    expect(missingPayload.error).toBe('not_found');
    expect(missingPayload.code).toBe('not_found');
    expect(missingPayload.retryable).toBe(true);
    expect(missingPayload.path).toBe('n.md');
    expect(missingPayload.recovery).toEqual({
      tool: 'note',
      arguments: { action: 'update', path: 'n.md', mode: 'replace_section', heading: 'X' },
    });

    const ambiguous = mapToolError(
      new SectionEditError('invalid_args', 'heading is ambiguous (found multiple times)'),
      { tool: 'note', action: 'update', path: 'n.md' },
    );
    const ambiguousPayload = parsePayload(ambiguous);
    expect(ambiguousPayload.error).toBe('invalid_args');
    expect(ambiguousPayload.retryable).toBe(true);
  });

  it('mapToolError maps PathResolveError to invalid_args with candidate array', () => {
    const result = mapToolError(new PathResolveError('shared', ['a.md', 'b.md']), {
      tool: 'note',
      action: 'read',
      path: 'shared',
      arguments: { action: 'read', path: 'shared' },
    });
    const payload = parsePayload(result);
    expect(payload.error).toBe('invalid_args');
    expect(payload.code).toBe('invalid_args');
    expect(payload.message).toContain('ambiguous');
    expect(payload.details).toEqual({
      required: [],
      missing: [],
      rejected: [],
      candidates: ['a.md', 'b.md'],
    });
    expect(payload.recovery).toEqual({
      tool: 'note',
      arguments: { action: 'read', path: 'a.md' },
    });
    expect(payload.hint).toContain('a.md');
    expect(payload.hint).toContain('b.md');
  });

  it('mapToolError maps ENOENT to note_not_found with search recovery', () => {
    const enoent = Object.assign(new Error("ENOENT: no such file or directory, open 'missing.md'"), {
      code: 'ENOENT',
    });
    const result = mapToolError(enoent, {
      tool: 'note',
      action: 'read',
      path: 'missing.md',
      arguments: { action: 'read', path: 'missing.md' },
    });
    const payload = parsePayload(result);
    expect(payload.error).toBe('note_not_found');
    expect(payload.code).toBe('note_not_found');
    expect(payload.retryable).toBe(true);
    expect(payload.path).toBe('missing.md');
    expect(payload.recovery).toEqual({ tool: 'search', arguments: { action: 'list' } });
    expect(payload.hint).toContain('search');
  });
});
