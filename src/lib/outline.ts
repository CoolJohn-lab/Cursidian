import { parseHeadingLine } from './section-edit.js';
import { assertParseableSize, MAX_MATCH_ITERATIONS } from './limits.js';
import { listSections } from './section-read.js';

/** Stable agent-facing outline entry (1-based line numbers). */
export interface NoteOutlineEntry {
  level: number;
  text: string;
  line: number;
}

export interface BuildNoteOutlineOptions {
  /** Include headings at this ATX level or shallower (1-6). Default 6. */
  maxDepth?: number;
}

/**
 * Builds a heading outline for a note body without loading section bodies.
 * Caps parse size and line iterations; filters by optional maxDepth.
 */
export function buildNoteOutline(
  body: string,
  options: BuildNoteOutlineOptions = {},
): NoteOutlineEntry[] {
  assertParseableSize(body, 'note body');
  const maxDepth = options.maxDepth ?? 6;
  const depth = Math.min(6, Math.max(1, Math.floor(maxDepth)));

  const lines = body.split('\n');
  const entries: NoteOutlineEntry[] = [];
  let iterations = 0;

  for (let i = 0; i < lines.length; i++) {
    if (++iterations > MAX_MATCH_ITERATIONS) {
      break;
    }
    const parsed = parseHeadingLine(lines[i]!);
    if (!parsed || parsed.level > depth) {
      continue;
    }
    entries.push({
      level: parsed.level,
      text: parsed.text,
      line: i + 1,
    });
  }

  return entries;
}

/**
 * Outline derived from {@link listSections} (same headings; includes section
 * metadata when callers already need slices). Prefer {@link buildNoteOutline}
 * for the note outline MCP surface.
 */
export function outlineFromSections(
  body: string,
  options: BuildNoteOutlineOptions = {},
): NoteOutlineEntry[] {
  const maxDepth = options.maxDepth ?? 6;
  const depth = Math.min(6, Math.max(1, Math.floor(maxDepth)));
  return listSections(body)
    .filter((section) => section.level <= depth)
    .map((section) => ({
      level: section.level,
      text: section.heading,
      line: section.startLine + 1,
    }));
}
