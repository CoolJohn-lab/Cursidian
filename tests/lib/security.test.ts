import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import {
  assertSafePath,
  assertSafePathAsync,
  assertNotReadOnly,
  findExistingAncestor,
  readFileBounded,
  FileTooLargeError,
  ReadOnlyError,
  SecurityError,
} from '../../src/lib/security.js';

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
  it('passes for a new path inside an existing vault directory', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-sec-'));
    try {
      const newNote = path.join(tmpDir, 'concepts', 'new.md');
      await expect(assertSafePathAsync(tmpDir, newNote)).resolves.toBeUndefined();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws SecurityError for path outside vault', async () => {
    await expect(assertSafePathAsync(VAULT, '/etc/passwd')).rejects.toThrow(SecurityError);
  });

  it('passes for an existing file inside the vault', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-sec-'));
    try {
      const note = path.join(tmpDir, 'existing.md');
      await fsp.writeFile(note, '# hi\n', 'utf-8');
      await expect(assertSafePathAsync(tmpDir, note)).resolves.toBeUndefined();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('assertSafePathAsync symlink containment', () => {
  let root = '';
  let vault = '';
  let outside = '';
  let symlinkOk = false;

  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-symlink-'));
    vault = path.join(root, 'vault');
    outside = path.join(root, 'outside');
    await fsp.mkdir(vault, { recursive: true });
    await fsp.mkdir(outside, { recursive: true });
    const escapeLink = path.join(vault, 'escape');
    try {
      if (process.platform === 'win32') {
        await fsp.symlink(outside, escapeLink, 'junction');
      } else {
        await fsp.symlink(outside, escapeLink, 'dir');
      }
      symlinkOk = true;
    } catch (err) {
      symlinkOk = false;
      if (process.platform !== 'win32') {
        throw new Error(
          `Symlink fixture required on ${process.platform} but creation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  });

  afterAll(async () => {
    if (root) {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects creating a note under a symlinked directory that escapes the vault', async (ctx) => {
    if (!symlinkOk) {
      ctx.skip();
    }
    const target = path.join(vault, 'escape', 'new.md');
    await expect(assertSafePathAsync(vault, target)).rejects.toThrow(SecurityError);
    await expect(assertSafePathAsync(vault, target)).rejects.toThrow(/Symlink-based path traversal/);
  });

  it('allows a new note under a normal directory inside the vault', async (ctx) => {
    if (!symlinkOk) {
      ctx.skip();
    }
    const concepts = path.join(vault, 'concepts');
    await fsp.mkdir(concepts, { recursive: true });
    const target = path.join(concepts, 'safe.md');
    await expect(assertSafePathAsync(vault, target)).resolves.toBeUndefined();
  });
});

describe('findExistingAncestor', () => {
  it('returns the path itself when it exists', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-anc-'));
    try {
      const note = path.join(tmpDir, 'note.md');
      await fsp.writeFile(note, '# hi\n', 'utf-8');
      await expect(findExistingAncestor(note)).resolves.toBe(note);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('walks up to the vault root when intermediate dirs are missing', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-anc-'));
    try {
      const deep = path.join(tmpDir, 'a', 'b', 'c', 'note.md');
      await expect(findExistingAncestor(deep)).resolves.toBe(tmpDir);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('readFileBounded', () => {
  it('throws FileTooLargeError when the file exceeds maxBytes', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-bounded-'));
    try {
      const note = path.join(tmpDir, 'big.md');
      await fsp.writeFile(note, 'x'.repeat(32), 'utf-8');
      await expect(readFileBounded(note, 16)).rejects.toBeInstanceOf(FileTooLargeError);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
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
