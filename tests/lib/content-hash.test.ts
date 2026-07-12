import { describe, it, expect } from 'vitest';
import { computeContentHash } from '../../src/lib/content-hash.js';

describe('computeContentHash', () => {
  it('returns a stable SHA-256 hex digest', () => {
    const hash = computeContentHash('# Hello\n\nWorld');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(computeContentHash('# Hello\n\nWorld')).toBe(hash);
  });

  it('changes when body content changes', () => {
    const a = computeContentHash('alpha');
    const b = computeContentHash('beta');
    expect(a).not.toBe(b);
  });
});
