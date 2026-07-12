import { describe, it, expect } from 'vitest';
import { parseFrontmatter, stringifyFrontmatter, mergeFrontmatter } from '../../src/lib/frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses frontmatter and content separately', () => {
    const raw = `---\ntitle: Test\ntags:\n  - foo\n---\n\n# Body\n`;
    const { data, content } = parseFrontmatter(raw);
    expect(data).toEqual({ title: 'Test', tags: ['foo'] });
    expect(content.trim()).toBe('# Body');
  });

  it('returns empty data for note without frontmatter', () => {
    const { data, content } = parseFrontmatter('# Just content\n');
    expect(data).toEqual({});
    expect(content.trim()).toBe('# Just content');
  });
});

describe('stringifyFrontmatter', () => {
  it('produces YAML frontmatter block', () => {
    const result = stringifyFrontmatter({ title: 'Test' }, '# Body');
    expect(result).toContain('title: Test');
    expect(result).toContain('# Body');
  });

  it('returns content unchanged when data is empty', () => {
    const result = stringifyFrontmatter({}, '# Body');
    expect(result).toBe('# Body');
  });
});

describe('mergeFrontmatter', () => {
  it('merges incoming into existing', () => {
    const result = mergeFrontmatter({ a: 1, b: 2 }, { b: 99, c: 3 });
    expect(result).toEqual({ a: 1, b: 99, c: 3 });
  });

  it('incoming takes precedence', () => {
    const result = mergeFrontmatter({ key: 'old' }, { key: 'new' });
    expect(result.key).toBe('new');
  });
});
