import path from 'node:path';
import { extractWikilinks } from './wikilinks.js';
import { normaliseKey, resolveWikilinkTarget, type VaultIndex } from './vault-index.js';

export interface ResolvedWikilink {
  raw: string;
  resolvedPath: string | null;
}

/**
 * Checks whether a wikilink target refers to a note path using index-aware matching.
 */
export function wikilinkTargetsNote(link: string, notePath: string, index: VaultIndex): boolean {
  const resolved = resolveWikilinkTarget(link, index);
  if (resolved) {
    return normaliseKey(resolved) === normaliseKey(notePath);
  }

  const noteName = path.basename(notePath, '.md');
  const notePathNormalized = notePath.replace(/\.md$/i, '');
  const pathOnly = link.includes('#') ? link.split('#')[0]!.trim() : link.trim();
  const normalizedKey = normaliseKey(pathOnly);

  return (
    normaliseKey(noteName) === normalizedKey ||
    normaliseKey(notePathNormalized) === normalizedKey ||
    normaliseKey(notePath) === normalizedKey
  );
}

/**
 * Resolves outgoing wikilinks from note content against the vault index.
 */
export function resolveOutgoingLinks(content: string, index: VaultIndex): ResolvedWikilink[] {
  return extractWikilinks(content).map((raw) => ({
    raw,
    resolvedPath: resolveWikilinkTarget(raw, index),
  }));
}
