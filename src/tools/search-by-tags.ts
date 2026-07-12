import { type Config } from '../config.js';
import { getVaultSnapshot } from '../lib/vault-snapshot.js';
import { noteMatchesTags, uniqueIndexEntries } from '../lib/tags.js';
import { isOperationalPath } from '../lib/operational-paths.js';
import { paginateByPath, resolveCursorMarker, scanMetadataFromSkipped } from '../lib/pagination.js';
import { ok, mapToolError } from '../types/index.js';

export function searchByTagsHandler(config: Config) {
  return async ({
    tags,
    limit,
    cursor,
  }: {
    tags: string[];
    limit?: number;
    cursor?: string;
  }) => {
    try {
      const effectiveLimit = limit ?? 50;
      const snapshot = await getVaultSnapshot(config.vaultPath, config.maxFileSize);
      const marker = resolveCursorMarker(cursor, snapshot.signature);

      const ranked = uniqueIndexEntries(snapshot.index)
        .filter((entry) => !isOperationalPath(entry.path))
        .filter((entry) => noteMatchesTags(entry.tags, tags))
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((entry) => ({
          path: entry.path,
          title: entry.title,
          tags: entry.tags,
          summary: entry.summary,
        }));

      const paged = paginateByPath(ranked, effectiveLimit, marker, snapshot.signature);
      const scan = scanMetadataFromSkipped(snapshot.skipped);

      return ok({
        tags,
        totalMatches: paged.totalMatches,
        results: paged.page,
        truncated: paged.truncated,
        nextCursor: paged.nextCursor,
        effectiveLimit,
        includeOperational: false,
        ...scan,
      });
    } catch (e) {
      return mapToolError(e, {
        tool: 'search',
        action: 'by_tags',
        arguments: { action: 'by_tags', tags, limit: limit ?? 50 },
      });
    }
  };
}
