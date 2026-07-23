import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  decodeSignatureCursor,
  diffVaultSignatures,
  encodeSignatureCursor,
  paginateByPath,
  resolveCursorMarker,
  StaleCursorError,
} from '../../src/lib/pagination.js';

function sigLine(absolute: string, mtimeMs: number, size: number, contentHash: string): string {
  return `${absolute}\0${mtimeMs}\0${size}\0${contentHash}`;
}

describe('pagination', () => {
  const items = [
    { path: 'a.md', value: 1 },
    { path: 'b.md', value: 2 },
    { path: 'c.md', value: 3 },
  ];
  const signature = 'sig-123';
  const vaultPath = path.join('/vault');

  it('paginates with signature-bound nextCursor', () => {
    const first = paginateByPath(items, 2, null, signature);
    expect(first.page.map((item) => item.path)).toEqual(['a.md', 'b.md']);
    expect(first.truncated).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    const marker = resolveCursorMarker(first.nextCursor, signature, { vaultPath });
    const second = paginateByPath(items, 2, marker, signature);
    expect(second.page.map((item) => item.path)).toEqual(['c.md']);
    expect(second.truncated).toBe(false);
  });

  it('rejects stale cursor when signature changed', () => {
    const cursor = encodeSignatureCursor('old-signature', 'b.md');
    expect(() => resolveCursorMarker(cursor, signature, { vaultPath })).toThrow(StaleCursorError);
  });

  it('rejects a cursor whose marker was tampered with', () => {
    const good = encodeSignatureCursor('sig-abc', 'notes/a.md');
    const decoded = JSON.parse(Buffer.from(good, 'base64url').toString('utf8')) as {
      b: string;
      m: string;
    };
    const forged = JSON.parse(decoded.b) as { v: number; signature: string; marker: string };
    forged.marker = 'secret/other.md';
    const tampered = Buffer.from(
      JSON.stringify({ b: JSON.stringify(forged), m: decoded.m }),
      'utf8',
    ).toString('base64url');
    expect(() => decodeSignatureCursor(tampered)).toThrow(StaleCursorError);
  });

  it('throws on an unknown marker instead of silently returning page 1', () => {
    expect(() => paginateByPath([{ path: 'a' }], 10, 'does-not-exist', 'sig')).toThrow(
      StaleCursorError,
    );
  });

  it('attaches changedPaths details on stale cursor', () => {
    const absA = path.join(vaultPath, 'entities', 'a.md');
    const absB = path.join(vaultPath, 'entities', 'b.md');
    const cursorSig = sigLine(absA, 1, 10, 'hash-a-old');
    const currentSig = [sigLine(absA, 2, 20, 'hash-a-new'), sigLine(absB, 3, 30, 'hash-b')].join(
      '\n',
    );
    const cursor = encodeSignatureCursor(cursorSig, 'entities/a.md');

    let caught: StaleCursorError | undefined;
    try {
      resolveCursorMarker(cursor, currentSig, { vaultPath });
    } catch (e) {
      caught = e as StaleCursorError;
    }

    expect(caught).toBeInstanceOf(StaleCursorError);
    expect(caught!.details).toMatchObject({
      changedPathCount: 2,
      changedPathsTruncated: false,
      cursorSignatureFingerprint: createHash('sha256').update(cursorSig).digest('hex').slice(0, 16),
      currentSignatureFingerprint: createHash('sha256')
        .update(currentSig)
        .digest('hex')
        .slice(0, 16),
    });
    expect(caught!.details!.changedPaths).toEqual([
      {
        path: 'entities/a.md',
        change: 'modified',
        before: { mtimeMs: 1, size: 10, contentHash: 'hash-a-old' },
        after: { mtimeMs: 2, size: 20, contentHash: 'hash-a-new' },
      },
      {
        path: 'entities/b.md',
        change: 'added',
        after: { mtimeMs: 3, size: 30, contentHash: 'hash-b' },
      },
    ]);
  });

  it('diffs added, removed, and modified paths as vault-relative', () => {
    const absKeep = path.join(vaultPath, 'keep.md');
    const absGone = path.join(vaultPath, 'gone.md');
    const absNew = path.join(vaultPath, 'folder', 'new.md');
    const absEdited = path.join(vaultPath, 'edited.md');

    const cursorSig = [
      sigLine(absKeep, 1, 1, 'same'),
      sigLine(absGone, 1, 1, 'gone'),
      sigLine(absEdited, 1, 1, 'old'),
    ].join('\n');
    const currentSig = [
      sigLine(absKeep, 1, 1, 'same'),
      sigLine(absNew, 2, 2, 'new'),
      sigLine(absEdited, 1, 1, 'new'),
    ].join('\n');

    const details = diffVaultSignatures(cursorSig, currentSig, vaultPath);
    expect(details.changedPathCount).toBe(3);
    expect(details.changedPathsTruncated).toBe(false);
    expect(details.changedPaths.map((entry) => [entry.path, entry.change])).toEqual([
      ['edited.md', 'modified'],
      ['folder/new.md', 'added'],
      ['gone.md', 'removed'],
    ]);
  });

  it('caps changedPaths at 25 and sets truncated', () => {
    const lines: string[] = [];
    for (let i = 0; i < 30; i++) {
      lines.push(sigLine(path.join(vaultPath, `n${String(i).padStart(2, '0')}.md`), 1, 1, `h${i}`));
    }
    const details = diffVaultSignatures('', lines.join('\n'), vaultPath);
    expect(details.changedPathCount).toBe(30);
    expect(details.changedPathsTruncated).toBe(true);
    expect(details.changedPaths).toHaveLength(25);
    expect(details.changedPaths.every((entry) => entry.change === 'added')).toBe(true);
  });
});
