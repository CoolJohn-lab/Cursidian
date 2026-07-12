import { describe, it, expect } from 'vitest';
import {
  encodeSignatureCursor,
  paginateByPath,
  resolveCursorMarker,
  StaleCursorError,
} from '../../src/lib/pagination.js';

describe('pagination', () => {
  const items = [
    { path: 'a.md', value: 1 },
    { path: 'b.md', value: 2 },
    { path: 'c.md', value: 3 },
  ];
  const signature = 'sig-123';

  it('paginates with signature-bound nextCursor', () => {
    const first = paginateByPath(items, 2, null, signature);
    expect(first.page.map((item) => item.path)).toEqual(['a.md', 'b.md']);
    expect(first.truncated).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    const marker = resolveCursorMarker(first.nextCursor, signature);
    const second = paginateByPath(items, 2, marker, signature);
    expect(second.page.map((item) => item.path)).toEqual(['c.md']);
    expect(second.truncated).toBe(false);
  });

  it('rejects stale cursor when signature changed', () => {
    const cursor = encodeSignatureCursor('old-signature', 'b.md');
    expect(() => resolveCursorMarker(cursor, signature)).toThrow(StaleCursorError);
  });
});
