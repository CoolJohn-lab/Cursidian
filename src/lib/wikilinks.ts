import path from 'node:path';
import { assertParseableSize, MAX_MATCH_ITERATIONS } from './limits.js';

/** Single-line Obsidian wikilinks; excludes CR/LF/`[` to limit backtracking. */
const WIKILINK_RE = /\[\[([^\]|\[\r\n]+)(?:\|[^\]\[\r\n]+)?\]\]/g;
const INLINE_TAG_RE = /#([\w/\-]+)/g;

export function extractWikilinks(content: string): string[] {
  assertParseableSize(content, 'Wikilink source');
  const links: string[] = [];
  let match: RegExpExecArray | null;
  let iterations = 0;
  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(content)) !== null) {
    if (++iterations > MAX_MATCH_ITERATIONS) {
      break;
    }
    links.push(match[1].trim());
  }
  return [...new Set(links)];
}

export function extractTags(content: string): string[] {
  assertParseableSize(content, 'Tag source');
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  let iterations = 0;
  INLINE_TAG_RE.lastIndex = 0;
  while ((match = INLINE_TAG_RE.exec(content)) !== null) {
    if (++iterations > MAX_MATCH_ITERATIONS) {
      break;
    }
    tags.push(match[1].toLowerCase());
  }
  return [...new Set(tags)];
}

function normaliseLinkPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\.md$/i, '');
}

/**
 * Returns true when a wikilink target refers to the old note path.
 */
function linkTargetsOldPath(linkTarget: string, oldRelativePath: string): boolean {
  const linkNorm = normaliseLinkPath(linkTarget);
  const oldNorm = normaliseLinkPath(oldRelativePath);
  const oldBasename = path.basename(oldNorm);

  return (
    linkNorm === oldNorm ||
    linkNorm === `${oldNorm}.md` ||
    linkNorm === oldBasename ||
    linkNorm.endsWith(`/${oldBasename}`)
  );
}

/**
 * Chooses replacement wikilink target based on how the old link was written.
 */
function replacementTarget(linkTarget: string, newRelativePath: string): string {
  const linkNorm = normaliseLinkPath(linkTarget);
  const newNorm = normaliseLinkPath(newRelativePath);
  const newBasename = path.basename(newNorm);

  if (linkNorm.includes('/')) {
    return newNorm;
  }
  return newBasename;
}

/**
 * Rewrites wikilinks from an old note path to a new note path, preserving display aliases.
 */
export function rewriteWikilinksForRename(
  content: string,
  oldRelativePath: string,
  newRelativePath: string,
): string {
  return content.replace(/\[\[([^\]|\[\r\n]+)(\|[^\]\[\r\n]+)?\]\]/g, (full, link, alias) => {
    const linkTarget = String(link).trim();
    if (!linkTargetsOldPath(linkTarget, oldRelativePath)) {
      return full;
    }
    const replacement = replacementTarget(linkTarget, newRelativePath);
    return alias ? `[[${replacement}${alias}]]` : `[[${replacement}]]`;
  });
}

/** @deprecated Use rewriteWikilinksForRename */
export function replaceWikilink(content: string, fromPath: string, toPath: string): string {
  return rewriteWikilinksForRename(content, fromPath, toPath);
}

export function wikilinkMatchesNote(link: string, notePath: string): boolean {
  const noteName = path.basename(notePath, '.md');
  const notePathNormalized = notePath.replace(/\.md$/, '');
  const normalized = link.trim();
  return normalized === noteName || normalized === notePathNormalized || normalized === notePath;
}
