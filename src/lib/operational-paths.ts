/**
 * Wiki special-file basenames excluded from default search and lightly penalised when included.
 */
export const OPERATIONAL_BASENAMES = new Set(['hot', 'log', 'index']);

/**
 * Returns true when a note path is operational metadata (index, log, hot, _raw, _archives).
 * Used by search content mode to exclude catalog/ops files unless includeOperational is set.
 */
export function isOperationalPath(relativePath: string): boolean {
  const norm = relativePath.replace(/\\/g, '/').toLowerCase();
  if (norm.startsWith('_archives/') || norm.startsWith('_raw/')) {
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
    norm === 'log.md' ||
    norm === 'hot.md' ||
    norm.startsWith('_meta/') ||
    norm.startsWith('_raw/') ||
    norm.startsWith('_archives/') ||
    norm.startsWith('.cursidian-trash/')
  ) {
    return true;
  }
  return false;
}
