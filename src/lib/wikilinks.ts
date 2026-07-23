import path from 'node:path';
import { assertParseableSize, MAX_MATCH_ITERATIONS } from './limits.js';

/**
 * Optional embed bang + single-line Obsidian wikilink; excludes CR/LF/`[` to limit backtracking.
 * Captures: (1) optional `!`, (2) target (may include `#heading` / `#^blockId`), (3) optional `|alias`.
 */
const WIKILINK_OR_EMBED_RE = /(!?)\[\[([^\]|\[\r\n]+)(\|[^\]\[\r\n]+)?\]\]/g;
const INLINE_TAG_RE = /#([\w/\-]+)/g;

/** Parsed wikilink or embed from note body. */
export interface ExtractedWikilink {
  /** Raw target including optional `#heading` / `#^blockId` fragment. */
  target: string;
  /** True when the link was written as `![[...]]`. */
  embed: boolean;
}

/**
 * Splits a wikilink target into path and fragment (`#...` / `#^...`), preserving the `#`.
 */
export function splitWikilinkAnchor(linkTarget: string): { pathPart: string; fragment: string } {
  const trimmed = linkTarget.trim();
  const hashIdx = trimmed.indexOf('#');
  if (hashIdx === -1) {
    return { pathPart: trimmed, fragment: '' };
  }
  return {
    pathPart: trimmed.slice(0, hashIdx).trim(),
    fragment: trimmed.slice(hashIdx),
  };
}

/**
 * Extracts all `[[...]]` / `![[...]]` entries (deduped by target+embed).
 */
export function extractWikilinkEntries(content: string): ExtractedWikilink[] {
  assertParseableSize(content, 'Wikilink source');
  const entries: ExtractedWikilink[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  let iterations = 0;
  WIKILINK_OR_EMBED_RE.lastIndex = 0;
  while ((match = WIKILINK_OR_EMBED_RE.exec(content)) !== null) {
    if (++iterations > MAX_MATCH_ITERATIONS) {
      break;
    }
    const target = match[2]!.trim();
    const embed = match[1] === '!';
    const key = `${embed ? '!' : ''}${target}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({ target, embed });
  }
  return entries;
}

/**
 * Unique wikilink/embed targets (including `#` fragments). Embeds are included.
 */
export function extractWikilinks(content: string): string[] {
  return [...new Set(extractWikilinkEntries(content).map((e) => e.target))];
}

/**
 * Unique embed targets only (`![[...]]`).
 */
export function extractEmbeds(content: string): string[] {
  return [
    ...new Set(
      extractWikilinkEntries(content)
        .filter((e) => e.embed)
        .map((e) => e.target),
    ),
  ];
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
    tags.push(match[1]!.toLowerCase());
  }
  return [...new Set(tags)];
}

function normaliseLinkPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\.md$/i, '');
}

/**
 * Returns true when a wikilink path part (no fragment) refers to the old note path.
 */
function linkTargetsOldPath(linkTarget: string, oldRelativePath: string): boolean {
  const { pathPart } = splitWikilinkAnchor(linkTarget);
  const linkNorm = normaliseLinkPath(pathPart);
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
 * Chooses replacement wikilink path based on how the old link was written (no fragment).
 */
function replacementTarget(linkTarget: string, newRelativePath: string): string {
  const { pathPart } = splitWikilinkAnchor(linkTarget);
  const linkNorm = normaliseLinkPath(pathPart);
  const newNorm = normaliseLinkPath(newRelativePath);
  const newBasename = path.basename(newNorm);

  if (linkNorm.includes('/')) {
    return newNorm;
  }
  return newBasename;
}

/**
 * Rewrites wikilinks and embeds from an old note path to a new note path.
 * Preserves display aliases and `#heading` / `#^blockId` fragments.
 */
export function rewriteWikilinksForRename(
  content: string,
  oldRelativePath: string,
  newRelativePath: string,
): string {
  assertParseableSize(content, 'Wikilink rewrite source');
  let iterations = 0;
  return content.replace(WIKILINK_OR_EMBED_RE, (full, bang, link, alias) => {
    if (++iterations > MAX_MATCH_ITERATIONS) {
      return full;
    }
    const linkTarget = String(link).trim();
    if (!linkTargetsOldPath(linkTarget, oldRelativePath)) {
      return full;
    }
    const { fragment } = splitWikilinkAnchor(linkTarget);
    const replacement = `${replacementTarget(linkTarget, newRelativePath)}${fragment}`;
    const prefix = bang === '!' ? '!' : '';
    return alias ? `${prefix}[[${replacement}${alias}]]` : `${prefix}[[${replacement}]]`;
  });
}

/** @deprecated Use rewriteWikilinksForRename */
export function replaceWikilink(content: string, fromPath: string, toPath: string): string {
  return rewriteWikilinksForRename(content, fromPath, toPath);
}

export function wikilinkMatchesNote(link: string, notePath: string): boolean {
  const { pathPart } = splitWikilinkAnchor(link);
  const noteName = path.basename(notePath, '.md');
  const notePathNormalized = notePath.replace(/\.md$/, '');
  const normalized = pathPart.trim();
  return normalized === noteName || normalized === notePathNormalized || normalized === notePath;
}
