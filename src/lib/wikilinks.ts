import path from 'node:path';

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
const INLINE_TAG_RE = /#([\w/\-]+)/g;

export function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(content)) !== null) {
    links.push(match[1].trim());
  }
  return [...new Set(links)];
}

export function extractTags(content: string): string[] {
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  INLINE_TAG_RE.lastIndex = 0;
  while ((match = INLINE_TAG_RE.exec(content)) !== null) {
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
  return content.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (full, link, alias) => {
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
