import { assertParseableSize, MAX_MATCH_ITERATIONS } from './limits.js';

/** Inline wiki provenance markers: `^[inferred]` / `^[ambiguous]` (Obsidian footnote-style). */
export const PROVENANCE_MARKER_SOURCE = String.raw`\^\[(inferred|ambiguous)\]`;

export type ProvenanceMarkerKind = 'inferred' | 'ambiguous';

export interface ProvenanceMarkerHit {
  kind: ProvenanceMarkerKind;
  /** 1-based line number in the scanned body. */
  line: number;
  /** Trimmed line text (capped). */
  excerpt: string;
}

export interface ProvenanceMarkerScan {
  inferred: number;
  ambiguous: number;
  hits: ProvenanceMarkerHit[];
}

const MAX_EXCERPT = 120;
const MAX_HITS = 50;

/**
 * Scans a note body for `^[inferred]` / `^[ambiguous]` markers.
 * Soft telemetry only - never a hard health failure.
 */
export function scanProvenanceMarkers(body: string): ProvenanceMarkerScan {
  assertParseableSize(body, 'provenance marker source');
  const lines = body.split('\n');
  const hits: ProvenanceMarkerHit[] = [];
  let inferred = 0;
  let ambiguous = 0;
  let iterations = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const re = new RegExp(PROVENANCE_MARKER_SOURCE, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      if (++iterations > MAX_MATCH_ITERATIONS) {
        return { inferred, ambiguous, hits };
      }
      const kind = match[1] as ProvenanceMarkerKind;
      if (kind === 'inferred') {
        inferred += 1;
      } else {
        ambiguous += 1;
      }
      if (hits.length < MAX_HITS) {
        const trimmed = line.trim();
        hits.push({
          kind,
          line: i + 1,
          excerpt: trimmed.length > MAX_EXCERPT ? `${trimmed.slice(0, MAX_EXCERPT)}...` : trimmed,
        });
      }
    }
  }

  return { inferred, ambiguous, hits };
}
