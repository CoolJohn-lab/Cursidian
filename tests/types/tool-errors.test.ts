import { describe, it, expect } from 'vitest';
import { err, mapToolError, toolError } from '../../src/types/index.js';
import { ReadOnlyError, SecurityError } from '../../src/lib/security.js';
import { SectionEditError } from '../../src/lib/section-edit.js';

describe('structured tool errors', () => {
  it('toolError returns JSON payload with isError', () => {
    const result = toolError({
      error: 'hash_mismatch',
      message: 'Note content has changed since read (hash mismatch).',
      path: 'log.md',
      hint: 'Re-read and retry.',
    });
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text) as {
      error: string;
      message: string;
      path: string;
      hint: string;
    };
    expect(payload.error).toBe('hash_mismatch');
    expect(payload.message).toContain('hash mismatch');
    expect(payload.path).toBe('log.md');
    expect(payload.hint).toBe('Re-read and retry.');
  });

  it('err emits structured JSON with optional code', () => {
    const result = err('boom', 'invalid_args', { path: 'x.md' });
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text) as { error: string; message: string; path: string };
    expect(payload.error).toBe('invalid_args');
    expect(payload.message).toBe('boom');
    expect(payload.path).toBe('x.md');
  });

  it('mapToolError maps SecurityError and ReadOnlyError', () => {
    const secure = mapToolError(new SecurityError('escape'), { path: '../x' });
    const securePayload = JSON.parse(secure.content[0].text) as { error: string; hint?: string };
    expect(securePayload.error).toBe('path_traversal');
    expect(securePayload.hint).toBeTruthy();

    const readOnly = mapToolError(new ReadOnlyError());
    const readOnlyPayload = JSON.parse(readOnly.content[0].text) as { error: string };
    expect(readOnlyPayload.error).toBe('read_only');
  });

  it('mapToolError maps SectionEditError codes', () => {
    const missing = mapToolError(new SectionEditError('not_found', 'Heading not found: "X"'), {
      path: 'n.md',
    });
    const missingPayload = JSON.parse(missing.content[0].text) as { error: string; path?: string };
    expect(missingPayload.error).toBe('not_found');
    expect(missingPayload.path).toBe('n.md');

    const ambiguous = mapToolError(
      new SectionEditError('invalid_args', 'heading is ambiguous (found multiple times)'),
    );
    const ambiguousPayload = JSON.parse(ambiguous.content[0].text) as { error: string };
    expect(ambiguousPayload.error).toBe('invalid_args');
  });

  it('mapToolError maps ENOENT to note_not_found', () => {
    const enoent = Object.assign(new Error("ENOENT: no such file or directory, open 'missing.md'"), {
      code: 'ENOENT',
    });
    const result = mapToolError(enoent, { path: 'missing.md' });
    const payload = JSON.parse(result.content[0].text) as { error: string; path?: string; hint?: string };
    expect(payload.error).toBe('note_not_found');
    expect(payload.path).toBe('missing.md');
    expect(payload.hint).toContain('search');
  });
});
