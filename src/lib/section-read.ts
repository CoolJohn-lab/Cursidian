import { parseHeadingLine, normaliseHeading } from './section-edit.js';
import { tokenMatchesInText } from './search-tokens.js';
import { assertParseableSize, MAX_MATCH_ITERATIONS } from './limits.js';

export interface SectionSlice {
  heading: string;
  level: number;
  startLine: number;
  endLine: number;
  /** Heading line plus section body. */
  content: string;
  /** Section body only (heading line excluded). */
  body: string;
}

/**
 * Slices a note body into ATX-heading sections. Each section runs from its
 * heading line to the next heading of equal-or-higher level (or end of body).
 * Read-only counterpart to the heading parsing in section-edit.ts.
 */
export function listSections(body: string): SectionSlice[] {
  assertParseableSize(body, 'note body');
  const lines = body.split('\n');
  const headings: Array<{ index: number; level: number; text: string }> = [];

  let iterations = 0;
  for (let i = 0; i < lines.length; i++) {
    if (++iterations > MAX_MATCH_ITERATIONS) {
      break;
    }
    const parsed = parseHeadingLine(lines[i]!);
    if (parsed) {
      headings.push({ index: i, level: parsed.level, text: parsed.text });
    }
  }

  const sections: SectionSlice[] = [];
  for (let h = 0; h < headings.length; h++) {
    const { index, level, text } = headings[h]!;
    let endIdx = lines.length;
    for (let j = h + 1; j < headings.length; j++) {
      if (headings[j]!.level <= level) {
        endIdx = headings[j]!.index;
        break;
      }
    }

    const contentLines = lines.slice(index, endIdx);
    const bodyLines = lines.slice(index + 1, endIdx);
    sections.push({
      heading: text,
      level,
      startLine: index,
      endLine: endIdx,
      content: contentLines.join('\n').trim(),
      body: bodyLines.join('\n').trim(),
    });
  }

  return sections;
}

/**
 * Returns the section matching a heading (case-insensitive), or null when not found.
 * Ambiguous matches (multiple headings with the same text) return the first occurrence -
 * callers doing read-only context slicing don't need write-mode's ambiguity rejection.
 */
export function extractSection(body: string, heading: string): SectionSlice | null {
  const target = normaliseHeading(heading.replace(/^#{1,6}\s*/, ''));
  const sections = listSections(body);
  return sections.find((section) => normaliseHeading(section.heading) === target) ?? null;
}

/**
 * Finds the section whose heading + body best matches the given query tokens.
 * Scoring: heading token hits are weighted higher than body token hits. Returns
 * null when no section scores above zero (caller should fall back to full body).
 */
export function findBestSection(body: string, queryTokens: string[]): SectionSlice | null {
  if (queryTokens.length === 0) {
    return null;
  }

  const sections = listSections(body);
  if (sections.length === 0) {
    return null;
  }

  const scored = sections.map((section) => {
    let score = 0;
    for (const token of queryTokens) {
      if (tokenMatchesInText(token, section.heading, false)) {
        score += 3;
      } else if (tokenMatchesInText(token, section.body, false)) {
        score += 1;
      }
    }
    return { section, score };
  });

  const candidates = scored.filter((entry) => entry.score > 0);
  if (candidates.length === 0) {
    return null;
  }

  // On tied scores, prefer the most specific (shortest) matching section over a
  // broad ancestor heading that merely contains the same text further down.
  candidates.sort((a, b) => b.score - a.score || a.section.body.length - b.section.body.length);
  return candidates[0]!.section;
}
