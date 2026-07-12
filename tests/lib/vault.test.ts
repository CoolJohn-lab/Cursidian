import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolvePath, resolveDir, toRelativePath, noteNameFromPath } from '../../src/lib/vault.js';

const VAULT = path.resolve('/vault');

describe('resolvePath', () => {
  it('adds .md extension when missing', () => {
    expect(resolvePath(VAULT, 'notes/foo')).toBe(path.resolve(VAULT, 'notes/foo.md'));
  });

  it('does not double .md extension', () => {
    expect(resolvePath(VAULT, 'notes/foo.md')).toBe(path.resolve(VAULT, 'notes/foo.md'));
  });

  it('resolves nested path', () => {
    expect(resolvePath(VAULT, 'Projects/sub/note')).toBe(
      path.resolve(VAULT, 'Projects/sub/note.md'),
    );
  });
});

describe('resolveDir', () => {
  it('resolves directory path', () => {
    expect(resolveDir(VAULT, 'Projects')).toBe(path.resolve(VAULT, 'Projects'));
  });
});

describe('toRelativePath', () => {
  it('returns relative path from vault root with forward slashes', () => {
    expect(toRelativePath(VAULT, path.join(VAULT, 'notes', 'foo.md'))).toBe('notes/foo.md');
  });
});

describe('noteNameFromPath', () => {
  it('extracts note name without extension', () => {
    expect(noteNameFromPath('Projects/my-project.md')).toBe('my-project');
  });

  it('works with just filename', () => {
    expect(noteNameFromPath('note.md')).toBe('note');
  });
});
