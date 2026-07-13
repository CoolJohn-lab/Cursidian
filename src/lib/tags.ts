import { normaliseKey, type VaultIndex, type VaultNoteEntry } from './vault-index.js';

/**
 * Collects unique vault index entries (the index maps many aliases to the same note).
 */
export function uniqueIndexEntries(index: VaultIndex): VaultNoteEntry[] {
  const seen = new Set<string>();
  const entries: VaultNoteEntry[] = [];
  for (const entry of index.values()) {
    if (seen.has(entry.path)) {
      continue;
    }
    seen.add(entry.path);
    entries.push(entry);
  }
  return entries;
}

/**
 * Returns true when a note's frontmatter tags satisfy the requested tag filter (AND semantics).
 */
export function noteMatchesTags(noteTags: string[], requestedTags: string[]): boolean {
  const normalised = new Set(noteTags.map((tag) => normaliseKey(tag)));
  return requestedTags.every((tag) => normalised.has(normaliseKey(tag)));
}

export interface TagCount {
  tag: string;
  count: number;
}

/**
 * Counts frontmatter tags across unique notes; sorted by count desc, then tag asc.
 */
export function countTags(index: VaultIndex): { totalTags: number; tags: TagCount[] } {
  const counts = new Map<string, number>();
  for (const entry of uniqueIndexEntries(index)) {
    for (const tag of entry.tags) {
      const key = normaliseKey(tag);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const tags = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return { totalTags: tags.length, tags };
}
