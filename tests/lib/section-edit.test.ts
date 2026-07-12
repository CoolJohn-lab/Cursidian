import { describe, it, expect } from 'vitest';
import { applyPatch, assertReplaceSizeGuard, replaceSection } from '../../src/lib/section-edit.js';

describe('applyPatch', () => {
  it('replaces a unique substring', () => {
    const result = applyPatch('foo bar baz', 'bar', 'qux');
    expect(result).toBe('foo qux baz');
  });

  it('throws when old_string is not found', () => {
    expect(() => applyPatch('hello', 'missing', 'x')).toThrow('not found');
  });

  it('throws when old_string appears more than once', () => {
    expect(() => applyPatch('aaa aaa', 'aaa', 'b')).toThrow('ambiguous');
  });
});

describe('replaceSection', () => {
  const body = ['# Title', '', 'intro', '', '## Section A', 'old line', '', '## Section B', 'keep me'].join('\n');

  it('replaces content under a heading until the next peer heading', () => {
    const result = replaceSection(body, 'Section A', 'new line');
    expect(result).toContain('## Section A');
    expect(result).toContain('new line');
    expect(result).not.toContain('old line');
    expect(result).toContain('## Section B');
    expect(result).toContain('keep me');
  });

  it('throws when heading is not found', () => {
    expect(() => replaceSection(body, 'Missing', 'x')).toThrow('Heading not found');
  });
});

describe('assertReplaceSizeGuard', () => {
  it('allows full-size replacements', () => {
    expect(() => assertReplaceSizeGuard('1234567890', '12345', false)).not.toThrow();
  });

  it('rejects small replacements without force', () => {
    expect(() => assertReplaceSizeGuard('1234567890', '12', false)).toThrow('shrink note body');
  });

  it('allows small replacements with force', () => {
    expect(() => assertReplaceSizeGuard('1234567890', '12', true)).not.toThrow();
  });
});
