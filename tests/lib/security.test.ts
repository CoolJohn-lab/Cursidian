import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { assertSafePath, assertSafePathAsync, assertNotReadOnly, ReadOnlyError, SecurityError } from '../../src/lib/security.js';

const VAULT = '/tmp/test-vault';

describe('assertSafePath', () => {
  it('passes for a path inside the vault', () => {
    expect(() => assertSafePath(VAULT, '/tmp/test-vault/notes/foo.md')).not.toThrow();
  });

  it('passes for the vault root itself', () => {
    expect(() => assertSafePath(VAULT, VAULT)).not.toThrow();
  });

  it('throws SecurityError for ../ traversal', () => {
    const evil = path.resolve(VAULT, '../../../etc/passwd');
    expect(() => assertSafePath(VAULT, evil)).toThrow(SecurityError);
  });

  it('throws SecurityError for absolute path outside vault', () => {
    expect(() => assertSafePath(VAULT, '/etc/passwd')).toThrow(SecurityError);
  });

  it('throws SecurityError for sibling directory', () => {
    expect(() => assertSafePath(VAULT, '/tmp/other-vault/note.md')).toThrow(SecurityError);
  });

  it('throws SecurityError for path that starts with vault name but escapes', () => {
    expect(() => assertSafePath(VAULT, '/tmp/test-vault-evil/note.md')).toThrow(SecurityError);
  });
});

describe('assertSafePathAsync', () => {
  it('passes for a path inside vault (file may not exist yet)', async () => {
    const tmpDir = os.tmpdir();
    // File does not exist — static check passes, ENOENT is silently swallowed
    await expect(assertSafePathAsync(tmpDir, path.join(tmpDir, 'file.md'))).resolves.toBeUndefined();
  });

  it('throws SecurityError for path outside vault', async () => {
    await expect(assertSafePathAsync(VAULT, '/etc/passwd')).rejects.toThrow(SecurityError);
  });
});

describe('assertNotReadOnly', () => {
  it('does not throw when readOnly is false', () => {
    expect(() => assertNotReadOnly(false)).not.toThrow();
  });

  it('throws ReadOnlyError when readOnly is true', () => {
    expect(() => assertNotReadOnly(true)).toThrow(ReadOnlyError);
  });

  it('ReadOnlyError message is descriptive', () => {
    expect(() => assertNotReadOnly(true)).toThrow('read-only mode');
  });
});
