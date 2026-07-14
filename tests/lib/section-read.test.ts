import { describe, it, expect } from 'vitest';
import { listSections, extractSection, findBestSection } from '../../src/lib/section-read.js';

const BODY = `# Title

Intro paragraph.

## Ingestion

Ingestion details go here. Mentions the ADF pipeline.

### Sub-step

Nested content.

## Egress

Egress details go here.
`;

describe('listSections', () => {
  it('slices body into heading sections with correct levels', () => {
    const sections = listSections(BODY);
    expect(sections.map((s) => s.heading)).toEqual(['Title', 'Ingestion', 'Sub-step', 'Egress']);
    expect(sections[0]!.level).toBe(1);
    expect(sections[1]!.level).toBe(2);
    expect(sections[2]!.level).toBe(3);
  });

  it('stops a section at the next heading of equal or higher level', () => {
    const sections = listSections(BODY);
    const ingestion = sections.find((s) => s.heading === 'Ingestion')!;
    expect(ingestion.body).toContain('ADF pipeline');
    expect(ingestion.body).toContain('Sub-step');
    expect(ingestion.body).not.toContain('Egress details');
  });

  it('returns an empty array for a body with no headings', () => {
    expect(listSections('just plain text\nno headings here')).toEqual([]);
  });
});

describe('extractSection', () => {
  it('finds a section by heading text (case-insensitive)', () => {
    const section = extractSection(BODY, 'ingestion');
    expect(section).not.toBeNull();
    expect(section!.body).toContain('ADF pipeline');
  });

  it('returns null when the heading does not exist', () => {
    expect(extractSection(BODY, 'Nonexistent Heading')).toBeNull();
  });

  it('strips leading ATX markers from the heading argument', () => {
    const section = extractSection(BODY, '## Egress');
    expect(section).not.toBeNull();
    expect(section!.heading).toBe('Egress');
  });
});

describe('findBestSection', () => {
  it('prefers the section whose heading matches a query token', () => {
    const best = findBestSection(BODY, ['egress']);
    expect(best?.heading).toBe('Egress');
  });

  it('falls back to body token matches when no heading matches', () => {
    const best = findBestSection(BODY, ['pipeline']);
    expect(best?.heading).toBe('Ingestion');
  });

  it('returns null when no tokens are provided', () => {
    expect(findBestSection(BODY, [])).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(findBestSection(BODY, ['zzz-nonexistent-token'])).toBeNull();
  });
});
