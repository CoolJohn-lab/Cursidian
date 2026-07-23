import { describe, it, expect } from 'vitest';
import {
  scanProvenanceMarkers,
  PROVENANCE_MARKER_SOURCE,
} from '../../src/lib/provenance-markers.js';

describe('scanProvenanceMarkers', () => {
  it('counts inferred and ambiguous markers with line samples', () => {
    const body = [
      '# Title',
      '',
      'A solid claim.',
      'Synthesized rationale. ^[inferred]',
      'Conflicting sources. ^[ambiguous]',
      'Two on one line ^[inferred] and ^[ambiguous].',
    ].join('\n');

    const scan = scanProvenanceMarkers(body);
    expect(scan.inferred).toBe(2);
    expect(scan.ambiguous).toBe(2);
    expect(scan.hits).toHaveLength(4);
    expect(scan.hits[0]).toMatchObject({ kind: 'inferred', line: 4 });
    expect(scan.hits[1]).toMatchObject({ kind: 'ambiguous', line: 5 });
    expect(scan.hits[0]!.excerpt).toContain('^[inferred]');
  });

  it('returns zeros when no markers are present', () => {
    expect(scanProvenanceMarkers('plain body\nno markers')).toEqual({
      inferred: 0,
      ambiguous: 0,
      hits: [],
    });
  });

  it('documents the marker regex shape', () => {
    const re = new RegExp(PROVENANCE_MARKER_SOURCE, 'g');
    expect('claim ^[inferred]'.match(re)?.[0]).toBe('^[inferred]');
    re.lastIndex = 0;
    expect('claim ^[ambiguous]'.match(re)?.[0]).toBe('^[ambiguous]');
    re.lastIndex = 0;
    expect('claim [inferred]'.match(re)).toBeNull();
  });
});
