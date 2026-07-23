import { describe, it, expect } from 'vitest';
import { buildNoteOutline, outlineFromSections } from '../../src/lib/outline.js';

const BODY = `# Title

Intro.

## Ingestion

Details.

### Sub-step

Nested.

## Egress

Out.
`;

describe('buildNoteOutline', () => {
  it('returns level, text, and 1-based line for each heading', () => {
    const outline = buildNoteOutline(BODY);
    expect(outline).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Ingestion', line: 5 },
      { level: 3, text: 'Sub-step', line: 9 },
      { level: 2, text: 'Egress', line: 13 },
    ]);
  });

  it('filters by maxDepth', () => {
    const outline = buildNoteOutline(BODY, { maxDepth: 2 });
    expect(outline.map((e) => e.text)).toEqual(['Title', 'Ingestion', 'Egress']);
  });

  it('returns empty for body with no headings', () => {
    expect(buildNoteOutline('plain text only')).toEqual([]);
  });

  it('matches outlineFromSections for the same body', () => {
    expect(buildNoteOutline(BODY, { maxDepth: 3 })).toEqual(
      outlineFromSections(BODY, { maxDepth: 3 }),
    );
  });
});
