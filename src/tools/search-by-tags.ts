import { type Config } from '../config.js';
import { getVaultIndex } from '../lib/vault-index.js';
import { noteMatchesTags, uniqueIndexEntries } from '../lib/tags.js';
import { isOperationalPath } from '../lib/operational-paths.js';
import { ok, mapToolError } from '../types/index.js';

export function searchByTagsHandler(config: Config) {
  return async ({ tags, limit }: { tags: string[]; limit?: number }) => {
    try {
      const effectiveLimit = limit ?? 50;
      const index = await getVaultIndex(config.vaultPath);
      const ranked = uniqueIndexEntries(index)
        .filter((entry) => !isOperationalPath(entry.path))
        .filter((entry) => noteMatchesTags(entry.tags, tags))
        .sort((a, b) => a.path.localeCompare(b.path));

      const results = ranked.slice(0, effectiveLimit).map((entry) => ({
        path: entry.path,
        title: entry.title,
        tags: entry.tags,
        summary: entry.summary,
      }));

      return ok({
        tags,
        totalMatches: ranked.length,
        results,
      });
    } catch (e) {
      return mapToolError(e);
    }
  };
}
