import { describe, it, expect } from 'vitest';
import {
  extractWikilinks,
  extractEmbeds,
  extractWikilinkEntries,
  extractTags,
  replaceWikilink,
  wikilinkMatchesNote,
  rewriteWikilinksForRename,
  splitWikilinkAnchor,
} from '../../src/lib/wikilinks.js';

describe('extractWikilinks', () => {
  it('extracts simple wikilinks', () => {
    expect(extractWikilinks('See [[note-a]] and [[note-b]]')).toEqual(['note-a', 'note-b']);
  });

  it('handles alias wikilinks', () => {
    expect(extractWikilinks('See [[note-a|Alias A]]')).toEqual(['note-a']);
  });

  it('includes embed targets', () => {
    expect(extractWikilinks('Embed ![[note-a]] and link [[note-b]]')).toEqual(['note-a', 'note-b']);
  });

  it('keeps heading and block-ref fragments on targets', () => {
    expect(extractWikilinks('[[note-a#Heading]] [[note-b#^block]]')).toEqual([
      'note-a#Heading',
      'note-b#^block',
    ]);
  });

  it('deduplicates repeated links', () => {
    expect(extractWikilinks('[[foo]] and [[foo]]')).toEqual(['foo']);
  });

  it('returns empty array when no links', () => {
    expect(extractWikilinks('No links here')).toEqual([]);
  });

  it('completes quickly on adversarial unclosed brackets', () => {
    const adversarial = '['.repeat(100_000);
    const t0 = performance.now();
    expect(extractWikilinks(adversarial)).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe('extractEmbeds / extractWikilinkEntries', () => {
  it('extractEmbeds returns only bang-prefixed targets', () => {
    expect(extractEmbeds('![[a]] [[b]] ![[c|Alias]]')).toEqual(['a', 'c']);
  });

  it('flags embeds in entries', () => {
    expect(extractWikilinkEntries('![[a|Show]] [[b#^x]]')).toEqual([
      { target: 'a', embed: true },
      { target: 'b#^x', embed: false },
    ]);
  });
});

describe('splitWikilinkAnchor', () => {
  it('splits heading and block-ref fragments', () => {
    expect(splitWikilinkAnchor('note#Heading')).toEqual({
      pathPart: 'note',
      fragment: '#Heading',
    });
    expect(splitWikilinkAnchor('note#^blockId')).toEqual({
      pathPart: 'note',
      fragment: '#^blockId',
    });
    expect(splitWikilinkAnchor('note')).toEqual({ pathPart: 'note', fragment: '' });
  });
});

describe('extractTags', () => {
  it('extracts inline tags', () => {
    expect(extractTags('Content #project/active and #work')).toContain('project/active');
    expect(extractTags('Content #project/active and #work')).toContain('work');
  });

  it('returns lowercase tags', () => {
    expect(extractTags('#Work')).toContain('work');
  });

  it('deduplicates tags', () => {
    expect(extractTags('#foo #foo')).toEqual(['foo']);
  });
});

describe('rewriteWikilinksForRename', () => {
  it('replaces basename links when renaming a nested note', () => {
    const result = rewriteWikilinksForRename(
      'See [[old-name]] for details.',
      'concepts/old-name.md',
      'concepts/new-name.md',
    );
    expect(result).toBe('See [[new-name]] for details.');
  });

  it('replaces path-style links when renaming a nested note', () => {
    const result = rewriteWikilinksForRename(
      '- [[concepts/old-name]] - summary',
      'concepts/old-name.md',
      'concepts/new-name.md',
    );
    expect(result).toContain('[[concepts/new-name]]');
  });

  it('rewrites embeds and preserves the bang', () => {
    const result = rewriteWikilinksForRename(
      'Embed ![[old-name]] and ![[old-name|Alias]]',
      'concepts/old-name.md',
      'concepts/new-name.md',
    );
    expect(result).toBe('Embed ![[new-name]] and ![[new-name|Alias]]');
  });

  it('preserves heading fragments on rewrite', () => {
    const result = rewriteWikilinksForRename(
      'See [[old-name#Key Ideas]]',
      'concepts/old-name.md',
      'concepts/new-name.md',
    );
    expect(result).toBe('See [[new-name#Key Ideas]]');
  });

  it('preserves block-ref fragments on rewrite', () => {
    const result = rewriteWikilinksForRename(
      'See [[old-name#^block1]] and ![[concepts/old-name#^block1]]',
      'concepts/old-name.md',
      'concepts/new-name.md',
    );
    expect(result).toBe('See [[new-name#^block1]] and ![[concepts/new-name#^block1]]');
  });
});

describe('replaceWikilink', () => {
  it('replaces a simple wikilink', () => {
    const result = replaceWikilink('See [[old-note]]', 'old-note.md', 'new-note.md');
    expect(result).toBe('See [[new-note]]');
  });

  it('preserves alias when replacing', () => {
    const result = replaceWikilink('See [[old-note|My Note]]', 'old-note.md', 'new-note.md');
    expect(result).toContain('new-note');
  });

  it('does not replace unrelated links', () => {
    const result = replaceWikilink('See [[other-note]]', 'old-note.md', 'new-note.md');
    expect(result).toBe('See [[other-note]]');
  });
});

describe('wikilinkMatchesNote', () => {
  it('matches by note name', () => {
    expect(wikilinkMatchesNote('book', 'Resources/book.md')).toBe(true);
  });

  it('matches by relative path without extension', () => {
    expect(wikilinkMatchesNote('Resources/book', 'Resources/book.md')).toBe(true);
  });

  it('matches by full relative path', () => {
    expect(wikilinkMatchesNote('Resources/book.md', 'Resources/book.md')).toBe(true);
  });

  it('matches when a heading fragment is present', () => {
    expect(wikilinkMatchesNote('book#Section', 'Resources/book.md')).toBe(true);
  });

  it('does not match different note', () => {
    expect(wikilinkMatchesNote('article', 'Resources/book.md')).toBe(false);
  });
});
