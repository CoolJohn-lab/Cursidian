import { getCommentScanner } from './comments.js';
import type { CharDef, LoadedRules, ScanFinding } from './types.js';

type Range = [number, number];

export function charDiagnosticMessage(def: CharDef): string {
  const parts = [def.name];
  if (def.replacement !== undefined) {
    const shown =
      def.replacement === ''
        ? 'delete'
        : def.replacement === '\n'
          ? 'newline'
          : def.replacement === ' '
            ? 'regular space'
            : JSON.stringify(def.replacement);
    parts.push(`fix: ${shown}`);
  } else if (def.suggestion) {
    parts.push(def.suggestion);
  }
  return `${parts.join(' - ')} [${def.source}]`;
}

export function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  const end = Math.min(Math.max(0, offset), text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return ranges;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [[ranges[0]![0], ranges[0]![1]]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1]!;
    const curr = ranges[i]!;
    if (curr[0] <= last[1]) {
      last[1] = Math.max(last[1], curr[1]);
    } else {
      merged.push([curr[0], curr[1]]);
    }
  }
  return merged;
}

function invertRanges(ranges: Range[], textLen: number): Range[] {
  const inverted: Range[] = [];
  let cursor = 0;
  for (const [s, e] of ranges) {
    if (s > cursor) inverted.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < textLen) inverted.push([cursor, textLen]);
  return inverted;
}

function offsetInRanges(offset: number, ranges: Range[]): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e] = ranges[mid]!;
    if (offset < s) hi = mid - 1;
    else if (offset >= e) lo = mid + 1;
    else return true;
  }
  return false;
}

function computeMarkdownExclusions(text: string): Range[] {
  const ranges: Range[] = [];
  let i = 0;
  let lineIdx = 0;
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let fenceStart = 0;
  let inFrontmatter = false;
  let frontmatterStart = 0;

  while (i <= text.length) {
    const nl = text.indexOf('\n', i);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(i, lineEnd);
    const nextLineStart = nl === -1 ? text.length : nl + 1;

    if (!inFence) {
      if (lineIdx === 0 && line === '---') {
        inFrontmatter = true;
        frontmatterStart = i;
      } else if (inFrontmatter && (line === '---' || line === '...')) {
        ranges.push([frontmatterStart, nextLineStart]);
        inFrontmatter = false;
      } else if (!inFrontmatter) {
        const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (m) {
          inFence = true;
          fenceChar = m[1]![0]!;
          fenceLen = m[1]!.length;
          fenceStart = i;
        }
      }
    } else {
      const closer = new RegExp(
        '^ {0,3}' + (fenceChar === '`' ? '`' : '~') + '{' + fenceLen + ',}\\s*$',
      );
      if (closer.test(line)) {
        ranges.push([fenceStart, nextLineStart]);
        inFence = false;
      }
    }

    if (nl === -1) break;
    lineIdx++;
    i = nextLineStart;
  }

  if (inFence) ranges.push([fenceStart, text.length]);

  let m: RegExpExecArray | null;
  const inlineCodeRe = /`[^`\n]+`/g;
  while ((m = inlineCodeRe.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }

  const linkRe = /\[[^\]\n]*\]\(([^)\n]+)\)/g;
  while ((m = linkRe.exec(text)) !== null) {
    const parenOpen = m.index + m[0].lastIndexOf('(');
    const parenClose = m.index + m[0].length - 1;
    ranges.push([parenOpen + 1, parenClose]);
  }

  const autolinkRe = /<https?:\/\/[^>\s]+>/gi;
  while ((m = autolinkRe.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }

  return mergeRanges(ranges);
}

/**
 * Ranges to skip during scanning.
 * Returns null when the language is unsupported (do not scan the file).
 */
function computeExcludedRanges(text: string, language: string): Range[] | null {
  if (language === 'markdown') return computeMarkdownExclusions(text);
  if (language === 'plaintext' || language === 'scminput') return [];
  if (language === 'git-commit') {
    // Skip # comment lines only (git strips them).
    const ranges: Range[] = [];
    let i = 0;
    while (i <= text.length) {
      const nl = text.indexOf('\n', i);
      const lineEnd = nl === -1 ? text.length : nl;
      const line = text.slice(i, lineEnd);
      if (line.startsWith('#')) {
        ranges.push([i, nl === -1 ? text.length : nl + 1]);
      }
      if (nl === -1) break;
      i = nl + 1;
    }
    return mergeRanges(ranges);
  }

  const commentScanner = getCommentScanner(language);
  if (commentScanner === null) return null;
  const comments = mergeRanges(commentScanner(text));
  return invertRanges(comments, text.length);
}

export function scanText(text: string, rules: LoadedRules, language: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const excluded = computeExcludedRanges(text, language);
  if (excluded === null) return findings;

  rules.charRegex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = rules.charRegex.exec(text)) !== null) {
    const def = rules.chars.get(m[0]);
    if (!def) continue;
    if (offsetInRanges(m.index, excluded)) continue;
    findings.push({
      offset: m.index,
      length: m[0].length,
      matchText: m[0],
      code: 'char',
      severity: def.severity,
      message: charDiagnosticMessage(def),
      source: def.source,
    });
  }

  for (const p of rules.phrases) {
    p.regex.lastIndex = 0;
    while ((m = p.regex.exec(text)) !== null) {
      if (m[0].length === 0) {
        p.regex.lastIndex++;
        continue;
      }
      if (offsetInRanges(m.index, excluded)) continue;
      const reasonBit = p.reason ? ` - ${p.reason}` : '';
      findings.push({
        offset: m.index,
        length: m[0].length,
        matchText: m[0],
        code: 'phrase',
        severity: p.severity,
        message: `LLM-style phrase: "${m[0]}"${reasonBit} [${p.source}]`,
        source: p.source,
        rulePattern: p.pattern,
      });
    }
  }

  return findings;
}
