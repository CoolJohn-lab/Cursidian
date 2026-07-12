/**
 * Parses a markdown heading line into its level (1-6) and text.
 * Returns null when the line is not an ATX-style heading.
 */
function parseHeadingLine(line: string): { level: number; text: string } | null {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
  if (!match) {
    return null;
  }
  return { level: match[1].length, text: match[2].trim() };
}

/**
 * Normalises heading text for case-insensitive comparison.
 */
function normaliseHeading(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Replaces the body content under a markdown heading until the next heading
 * of equal or higher level. The heading line itself is preserved.
 */
export function replaceSection(
  body: string,
  heading: string,
  newSectionContent: string,
): string {
  const lines = body.split('\n');
  const target = normaliseHeading(heading);
  let startIdx = -1;
  let headingLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseHeadingLine(lines[i]);
    if (parsed && normaliseHeading(parsed.text) === target) {
      startIdx = i;
      headingLevel = parsed.level;
      break;
    }
  }

  if (startIdx === -1) {
    throw new Error(`Heading not found: "${heading}"`);
  }

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const parsed = parseHeadingLine(lines[i]);
    if (parsed && parsed.level <= headingLevel) {
      endIdx = i;
      break;
    }
  }

  const before = lines.slice(0, startIdx + 1);
  const after = lines.slice(endIdx);
  const trimmed = newSectionContent.replace(/^\n+|\n+$/g, '');
  const sectionLines = trimmed.length > 0 ? ['', trimmed, ''] : [''];

  return [...before, ...sectionLines, ...after].join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Applies a unique find/replace patch to note body content.
 * Fails when old_string is missing or appears more than once.
 */
export function applyPatch(body: string, oldString: string, newString: string): string {
  if (oldString.length === 0) {
    throw new Error('old_string must not be empty');
  }

  const firstIdx = body.indexOf(oldString);
  if (firstIdx === -1) {
    throw new Error('old_string not found in note body');
  }

  const secondIdx = body.indexOf(oldString, firstIdx + oldString.length);
  if (secondIdx !== -1) {
    throw new Error('old_string is ambiguous (found multiple times); provide more context');
  }

  return body.slice(0, firstIdx) + newString + body.slice(firstIdx + oldString.length);
}

/**
 * Rejects replace operations that would truncate a note unless force is set.
 */
export function assertReplaceSizeGuard(
  existingBody: string,
  newBody: string,
  force: boolean | undefined,
): void {
  if (force) {
    return;
  }

  if (existingBody.length === 0) {
    return;
  }

  const ratio = newBody.length / existingBody.length;
  if (ratio < 0.5) {
    throw new Error(
      `Replace would shrink note body to ${Math.round(ratio * 100)}% of original size. ` +
        'Use mode "patch" or "replace_section" for partial edits, or set force: true to overwrite.',
    );
  }
}
