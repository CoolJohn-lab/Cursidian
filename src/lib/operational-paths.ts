/**
 * Wiki special-file basenames excluded from default search and lightly penalised when included.
 */
export const OPERATIONAL_BASENAMES = new Set(['index']);

/**
 * Returns true when a note path is operational metadata (index, _raw).
 * Used by search content, by_tags, tags, list, and recent unless includeOperational is set.
 */
export function isOperationalPath(relativePath: string): boolean {
  const norm = relativePath.replace(/\\/g, '/').toLowerCase();
  if (norm.startsWith('_raw/')) {
    return true;
  }
  const base = norm.split('/').pop()?.replace(/\.md$/, '') ?? '';
  return OPERATIONAL_BASENAMES.has(base);
}

/**
 * Returns true when a note should be excluded from orphan/stale/frontmatter health checks.
 * Broader than search exclusion: also skips _meta/ and the trash folder.
 */
export function isHealthExcludedPath(relativePath: string): boolean {
  const norm = relativePath.replace(/\\/g, '/').toLowerCase();
  if (
    norm === 'index.md' ||
    norm.startsWith('_meta/') ||
    norm.startsWith('_raw/') ||
    norm.startsWith('.cursidian-trash/')
  ) {
    return true;
  }
  return false;
}
