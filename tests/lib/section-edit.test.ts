import { describe, it, expect } from 'vitest';
import {
  applyPatch,
  assertBodySizeGuard,
  assertReplaceSizeGuard,
  replaceSection,
  SectionEditError,
} from '../../src/lib/section-edit.js';

describe('applyPatch', () => {
  it('replaces a unique substring', () => {
    const result = applyPatch('foo bar baz', 'bar', 'qux');
    expect(result).toBe('foo qux baz');
  });

  it('throws when old_string is not found', () => {
    expect(() => applyPatch('hello', 'missing', 'x')).toThrow(SectionEditError);
    expect(() => applyPatch('hello', 'missing', 'x')).toThrow('not found');
  });

  it('throws when old_string appears more than once', () => {
    expect(() => applyPatch('aaa aaa', 'aaa', 'b')).toThrow(SectionEditError);
    try {
      applyPatch('aaa aaa', 'aaa', 'b');
    } catch (e) {
      expect(e).toBeInstanceOf(SectionEditError);
      expect((e as SectionEditError).code).toBe('invalid_args');
    }
  });
});

describe('replaceSection', () => {
  const body = [
    '# Title',
    '',
    'intro',
    '',
    '## Section A',
    'old line',
    '',
    '## Section B',
    'keep me',
  ].join('\n');

  it('replaces content under a heading until the next peer heading', () => {
    const result = replaceSection(body, 'Section A', 'new line');
    expect(result).toContain('## Section A');
    expect(result).toContain('new line');
    expect(result).not.toContain('old line');
    expect(result).toContain('## Section B');
    expect(result).toContain('keep me');
  });

  it('accepts headings with leading # markers at the matching level', () => {
    const result = replaceSection(body, '## Section A', 'hashed heading body');
    expect(result).toContain('hashed heading body');
    expect(result).not.toContain('old line');
  });

  it('does not match a different ATX level when # markers are provided', () => {
    expect(() => replaceSection(body, '### Section A', 'x')).toThrow(SectionEditError);
    try {
      replaceSection(body, '### Section A', 'x');
    } catch (e) {
      expect((e as SectionEditError).code).toBe('not_found');
    }
  });

  it('throws when heading is not found', () => {
    expect(() => replaceSection(body, 'Missing', 'x')).toThrow(SectionEditError);
    try {
      replaceSection(body, 'Missing', 'x');
    } catch (e) {
      expect(e).toBeInstanceOf(SectionEditError);
      expect((e as SectionEditError).code).toBe('not_found');
    }
  });

  it('throws when heading appears more than once', () => {
    const dup = ['## Same', 'A', '', '## Same', 'B'].join('\n');
    expect(() => replaceSection(dup, 'Same', 'x')).toThrow(SectionEditError);
    try {
      replaceSection(dup, '## Same', 'x');
    } catch (e) {
      expect(e).toBeInstanceOf(SectionEditError);
      expect((e as SectionEditError).code).toBe('invalid_args');
      expect((e as SectionEditError).message).toContain('ambiguous');
    }
  });
});

describe('assertReplaceSizeGuard', () => {
  it('allows full-size replacements', () => {
    expect(() => assertReplaceSizeGuard('1234567890', '12345', false)).not.toThrow();
  });

  it('rejects small replacements without force', () => {
    expect(() => assertReplaceSizeGuard('1234567890', '12', false)).toThrow(SectionEditError);
    try {
      assertReplaceSizeGuard('1234567890', '12', false);
    } catch (e) {
      expect(e).toBeInstanceOf(SectionEditError);
      expect((e as SectionEditError).code).toBe('invalid_args');
      expect((e as Error).message).toContain('shrink note body');
    }
  });

  it('allows small replacements with force', () => {
    expect(() => assertReplaceSizeGuard('1234567890', '12', true)).not.toThrow();
  });
});

describe('assertBodySizeGuard', () => {
  it('rejects growth over 2x without force on large notes', () => {
    const existing = 'x'.repeat(2_000);
    expect(() =>
      assertBodySizeGuard(existing + existing + existing, existing, {
        force: false,
        maxFileSize: 1_000_000,
      }),
    ).toThrow(SectionEditError);
  });

  it('allows 2x growth on small notes without force', () => {
    expect(() =>
      assertBodySizeGuard('x'.repeat(100), 'small', { force: false, maxFileSize: 1_000_000 }),
    ).not.toThrow();
  });

  it('rejects hard maxFileSize even with force', () => {
    expect(() =>
      assertBodySizeGuard('huge'.repeat(100), 'x', { force: true, maxFileSize: 10 }),
    ).toThrow(/maxFileSize/i);
  });

  it('allows intentional growth with force under maxFileSize', () => {
    const existing = 'x'.repeat(2_000);
    expect(() =>
      assertBodySizeGuard(existing + existing + existing, existing, {
        force: true,
        maxFileSize: 1_000_000,
      }),
    ).not.toThrow();
  });
});
