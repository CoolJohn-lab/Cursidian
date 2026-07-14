import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateTokensTotal } from '../../src/lib/token-estimate.js';

describe('estimateTokens', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates roughly chars/4 for plain prose', () => {
    const text = 'a'.repeat(400);
    expect(estimateTokens(text)).toBe(100);
  });

  it('rounds up for partial character groups', () => {
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('adds a bump for code fences', () => {
    const plain = 'x'.repeat(40);
    const withFence = '```\n' + 'x'.repeat(40) + '\n```';
    expect(estimateTokens(withFence)).toBeGreaterThan(estimateTokens(plain));
  });

  it('adds a bump for markdown table rows', () => {
    const withTable = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    const withoutTable = 'a b\n --- ---\n1 2\n';
    expect(estimateTokens(withTable)).toBeGreaterThanOrEqual(estimateTokens(withoutTable));
  });

  it('is monotonic with length for similar content', () => {
    const short = 'hello world';
    const long = 'hello world '.repeat(10);
    expect(estimateTokens(long)).toBeGreaterThan(estimateTokens(short));
  });
});

describe('estimateTokensTotal', () => {
  it('sums estimates across fragments', () => {
    const total = estimateTokensTotal(['abcd', 'efgh', 'ijkl']);
    expect(total).toBe(estimateTokens('abcd') + estimateTokens('efgh') + estimateTokens('ijkl'));
  });

  it('returns 0 for an empty list', () => {
    expect(estimateTokensTotal([])).toBe(0);
  });
});
